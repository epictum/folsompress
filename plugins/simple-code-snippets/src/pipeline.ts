/**
 * Validation and minification pipeline (PRD §3.3).
 *
 *   1. Form submit → 2. Validation (syntax & tags) → 3. Minify (Terser) → 4. Commit
 *
 * Everything in this module is pure so it can be unit tested without an
 * EmDash host. Terser is pure JavaScript and runs inside Cloudflare Workers;
 * it is imported lazily so pages that only read the snippet never load it.
 */

import { MAX_SNIPPET_BYTES } from "./config.js";

// ── Scanning ────────────────────────────────────────────────────

type RawTextTag = "script" | "style";

export interface RawTextBlock {
	tag: RawTextTag;
	/** The full opening tag, e.g. `<script async src="…">` */
	openTag: string;
	/** Attribute text inside the opening tag */
	attrs: string;
	/** Content between the opening and closing tags */
	body: string;
	/** Line number (1-based) where the opening tag starts */
	line: number;
	/** Line number (1-based) where the body starts */
	bodyLine: number;
}

export type Segment = { kind: "markup"; text: string } | { kind: "raw"; block: RawTextBlock };

export interface ScanResult {
	segments: Segment[];
	errors: string[];
}

const RAW_OPEN_RE = /<(script|style)\b([^>]*)>/gi;
const STRAY_CLOSE_RE = /<\/(script|style)\s*>/gi;
const DANGLING_OPEN_RE = /<(script|style)\b[^>]*$/i;

function lineAt(source: string, index: number): number {
	let line = 1;
	for (let i = 0; i < index && i < source.length; i++) {
		if (source.charCodeAt(i) === 10) line++;
	}
	return line;
}

/**
 * Split a snippet into markup and `<script>` / `<style>` raw-text blocks,
 * following HTML parsing rules: once a script or style opens, only its own
 * closing tag ends it.
 */
export function scanSnippet(code: string): ScanResult {
	const segments: Segment[] = [];
	const errors: string[] = [];
	let cursor = 0;

	const pushMarkup = (text: string, offset: number) => {
		if (!text) return;
		for (const m of text.matchAll(STRAY_CLOSE_RE)) {
			errors.push(
				`Line ${lineAt(code, offset + (m.index ?? 0))}: closing </${m[1]!.toLowerCase()}> has no matching opening tag.`,
			);
		}
		segments.push({ kind: "markup", text });
	};

	RAW_OPEN_RE.lastIndex = 0;
	for (;;) {
		RAW_OPEN_RE.lastIndex = cursor;
		const open = RAW_OPEN_RE.exec(code);
		if (!open) break;

		const tag = open[1]!.toLowerCase() as RawTextTag;
		pushMarkup(code.slice(cursor, open.index), cursor);

		const bodyStart = open.index + open[0].length;
		const closeRe = new RegExp(`</${tag}\\s*>`, "ig");
		closeRe.lastIndex = bodyStart;
		const close = closeRe.exec(code);

		if (!close) {
			errors.push(`Line ${lineAt(code, open.index)}: <${tag}> is never closed. Add </${tag}>.`);
			cursor = code.length;
			break;
		}

		segments.push({
			kind: "raw",
			block: {
				tag,
				openTag: open[0],
				attrs: open[2] ?? "",
				body: code.slice(bodyStart, close.index),
				line: lineAt(code, open.index),
				bodyLine: lineAt(code, bodyStart),
			},
		});
		cursor = close.index + close[0].length;
	}

	const tail = code.slice(cursor);
	const dangling = DANGLING_OPEN_RE.exec(tail);
	if (dangling) {
		errors.push(
			`Line ${lineAt(code, cursor + dangling.index)}: <${dangling[1]!.toLowerCase()} tag is missing its closing ">".`,
		);
		pushMarkup(tail.slice(0, dangling.index), cursor);
	} else {
		pushMarkup(tail, cursor);
	}

	return { segments, errors };
}

// ── Validation ──────────────────────────────────────────────────

export interface ValidationResult {
	/** Blocking: the snippet is not saved. */
	errors: string[];
	/** Non-blocking: saved, but surfaced to the administrator. */
	warnings: string[];
}

const EVENT_HANDLER_RE = /\s(on[a-z]+)\s*=/gi;
const TAG_RE = /<[a-z][^>]*>/gi;
const JS_URL_RE = /\b(?:href|src|action|formaction)\s*=\s*["']?\s*javascript:/i;
const STRUCTURAL_RE = /<\/?(html|head|body)\b/i;
const COMMENT_RE = /<!--[\s\S]*?-->/g;
const ANY_TAG_RE = /<\/?[a-z!][^>]*>/gi;
const INSECURE_SRC_RE = /\bsrc\s*=\s*["']?http:\/\//i;

export function validateSnippet(code: string): ValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];

	const bytes = new TextEncoder().encode(code).length;
	if (bytes > MAX_SNIPPET_BYTES) {
		errors.push(
			`Snippet is ${Math.ceil(bytes / 1024)} KB; the limit is ${MAX_SNIPPET_BYTES / 1024} KB.`,
		);
		return { errors, warnings };
	}

	const { segments, errors: tagErrors } = scanSnippet(code);
	errors.push(...tagErrors);

	const handlers = new Set<string>();
	let visibleText = false;

	for (const seg of segments) {
		const tags =
			seg.kind === "markup"
				? (seg.text.match(TAG_RE) ?? [])
				: [seg.block.openTag];

		for (const tag of tags) {
			for (const m of tag.matchAll(EVENT_HANDLER_RE)) handlers.add(m[1]!.toLowerCase());
		}

		if (seg.kind === "markup") {
			if (JS_URL_RE.test(seg.text)) {
				warnings.push("A javascript: URL was found. These run code when clicked or loaded.");
			}
			if (STRUCTURAL_RE.test(seg.text)) {
				warnings.push(
					"The snippet contains <html>, <head>, or <body> tags. Your page already has these; remove them to avoid broken markup.",
				);
			}
			const text = seg.text.replace(COMMENT_RE, "").replace(ANY_TAG_RE, "");
			if (text.trim().length > 0) visibleText = true;
		}

		const openTags = seg.kind === "markup" ? seg.text : seg.block.openTag;
		if (INSECURE_SRC_RE.test(openTags)) {
			warnings.push(
				"A resource loads over http://. Browsers block insecure content on HTTPS pages; use https://.",
			);
		}
	}

	if (handlers.size > 0) {
		warnings.push(
			`Inline event handler${handlers.size > 1 ? "s" : ""} found (${[...handlers]
				.map((h) => `${h}=`)
				.join(", ")}). These run code from attributes and are a common XSS vector; prefer addEventListener inside a <script>.`,
		);
	}

	if (visibleText) {
		warnings.push(
			"Some text sits outside any tag and will show up as visible text on the page. Wrap JavaScript in <script>…</script> and CSS in <style>…</style>.",
		);
	}

	return { errors, warnings: [...new Set(warnings)] };
}

// ── Minification ────────────────────────────────────────────────

export class MinifyError extends Error {
	override name = "MinifyError";
}

const TYPE_ATTR_RE = /\btype\s*=\s*["']?([^"'\s>]+)/i;
const SRC_ATTR_RE = /\bsrc\s*=/i;
const JS_TYPES = new Set([
	"",
	"text/javascript",
	"application/javascript",
	"application/ecmascript",
	"text/ecmascript",
	"module",
]);
const JSON_TYPES = new Set(["application/ld+json", "application/json", "importmap", "speculationrules"]);

function scriptType(attrs: string): string {
	return (TYPE_ATTR_RE.exec(attrs)?.[1] ?? "").toLowerCase();
}

/** Small, safe CSS minifier: comments, whitespace, and redundant semicolons. */
export function minifyCss(css: string): string {
	return css
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/\s+/g, " ")
		.replace(/\s*([{}:;,>])\s*/g, "$1")
		.replace(/;}/g, "}")
		.trim();
}

/** Markup outside script/style: drop plain comments, collapse line breaks between tags. */
function minifyMarkup(html: string): string {
	return html
		.replace(/<!--(?!\[if|<!|>)[\s\S]*?-->/g, "")
		.replace(/>\s*\n\s*</g, "><")
		.replace(/\n\s*\n/g, "\n")
		// Line breaks at the edges sit next to a <script>/<style> block.
		.replace(/^\s*\n\s*/, "")
		.replace(/\s*\n\s*$/, "");
}

async function minifyScript(block: RawTextBlock): Promise<string> {
	const type = scriptType(block.attrs);
	const body = block.body;

	if (!body.trim()) return body;
	if (SRC_ATTR_RE.test(block.attrs)) return body.trim();

	if (JSON_TYPES.has(type)) {
		try {
			return JSON.stringify(JSON.parse(body));
		} catch (err) {
			throw new MinifyError(
				`Line ${block.line}: <script type="${type}"> does not contain valid JSON (${(err as Error).message}).`,
			);
		}
	}

	// Templates and other non-JS script types are left exactly as written.
	if (!JS_TYPES.has(type)) return body;

	const { minify } = await import("terser");
	try {
		const result = await minify(body, {
			module: type === "module",
			compress: true,
			mangle: true,
			format: { comments: false, inline_script: true },
		});
		return result.code ?? "";
	} catch (err) {
		const e = err as { message?: string; line?: number };
		const line = typeof e.line === "number" ? block.bodyLine + e.line - 1 : block.line;
		throw new MinifyError(`Line ${line}: ${e.message ?? "Terser could not parse this script."}`);
	}
}

/**
 * Minify a validated snippet. Inline JavaScript goes through Terser, JSON
 * script blocks are compacted, CSS is lightly minified, and markup loses
 * comments and blank lines. Throws `MinifyError` on failure.
 */
export async function minifySnippet(code: string): Promise<string> {
	const { segments, errors } = scanSnippet(code);
	if (errors.length > 0) throw new MinifyError(errors[0]!);

	const parts: string[] = [];
	for (const seg of segments) {
		if (seg.kind === "markup") {
			parts.push(minifyMarkup(seg.text));
			continue;
		}
		const { block } = seg;
		const body = block.tag === "style" ? minifyCss(block.body) : await minifyScript(block);
		parts.push(`${block.openTag}${body}</${block.tag}>`);
	}
	return parts.join("").trim();
}

// ── Full save pipeline ──────────────────────────────────────────

export interface PipelineInput {
	codeContent: string;
	isMinified: boolean;
}

export interface PipelineOutput {
	ok: boolean;
	errors: string[];
	warnings: string[];
	/** What pages will receive. */
	compiledContent: string;
	/** Final minify flag (false if the fallback kicked in). */
	isMinified: boolean;
	/** Message for the warning banner when Terser failed. */
	minifyFallback?: string;
}

export async function runPipeline(input: PipelineInput): Promise<PipelineOutput> {
	const { errors, warnings } = validateSnippet(input.codeContent);
	if (errors.length > 0) {
		return { ok: false, errors, warnings, compiledContent: "", isMinified: input.isMinified };
	}

	if (!input.isMinified || !input.codeContent.trim()) {
		return {
			ok: true,
			errors,
			warnings,
			compiledContent: input.codeContent.trim(),
			isMinified: input.isMinified,
		};
	}

	try {
		const compiled = await minifySnippet(input.codeContent);
		return { ok: true, errors, warnings, compiledContent: compiled, isMinified: true };
	} catch (err) {
		// PRD fallback: disable minification, save the raw snippet, warn.
		const reason = err instanceof Error ? err.message : String(err);
		return {
			ok: true,
			errors,
			warnings,
			compiledContent: input.codeContent.trim(),
			isMinified: false,
			minifyFallback: `Minification failed, so it was turned off and your snippet was saved unminified. ${reason}`,
		};
	}
}
