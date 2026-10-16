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


export interface ValidationResult {
	/** Blocking: the snippet is not saved. */
	errors: string[];
	/** Non-blocking: saved, but surfaced to the administrator. */
	warnings: string[];
}

/** Real HTML elements whose names happen to be close to "script"/"style". */
const KNOWN_ELEMENTS = new Set([
	"noscript", "strike", "strong", "small", "slot", "span", "select", "source", "section",
	"summary", "sub", "sup", "samp", "svg", "table", "title", "time", "track", "tspan",
]);

function editDistance(a: string, b: string): number {
	const row = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		let prev = row[0]!;
		row[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const tmp = row[j]!;
			row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
			prev = tmp;
		}
	}
	return row[b.length]!;
}

/** "scrrript" → "script", "stlye" → "style"; null for exact or unrelated names. */
function misspellingOf(name: string): RawTextTag | null {
	if (name === "script" || name === "style" || name.length < 4 || KNOWN_ELEMENTS.has(name)) return null;
	if (editDistance(name, "script") <= 2) return "script";
	if (editDistance(name, "style") <= 2) return "style";
	return null;
}

const ANY_CLOSE_RE = /<\/([^<>]*)>/g;
const ANY_OPEN_NAME_RE = /<([a-z][a-z0-9-]*)\b[^<>]*>/gi;
/** An opening script/style tag at the start of a line (a real tag, not a string). */
const LINE_START_OPEN_RE = /(^|\n)[ \t]*(<(script|style)\b[^>]*>)/gi;

type Problem = { line: number; message: string };

/**
 * Every tag problem in the snippet, in line order. Unlike a strict parse,
 * this keeps going after the first problem so all of them can be fixed in
 * one pass, and it reports root causes (a misspelled `</scrrript>`) rather
 * than their knock-on effects (the `<script>` that therefore never closes).
 */
export interface TagReport {
	/** Blocking problems, in line order. */
	errors: string[];
	/** Script/style blocks that are well-formed, safe to syntax-check. */
	cleanBlocks: RawTextBlock[];
}

export function findTagProblems(code: string): TagReport {
	const problems: Problem[] = [];
	const cleanBlocks: RawTextBlock[] = [];
	const at = (index: number) => lineAt(code, index);

	// A. Closing tags that are malformed or misspelled, anywhere in the snippet.
	const badCloses: Array<{ index: number; end: number }> = [];
	for (const m of code.matchAll(ANY_CLOSE_RE)) {
		const name = m[1]!.trim().toLowerCase();
		if (name === "script" || name === "style") continue;
		const index = m.index ?? 0;
		const embedded = /\b(script|style)\b/.exec(name)?.[1] as RawTextTag | undefined;
		const guess = embedded ?? (/^[a-z][a-z0-9-]*$/.test(name) ? misspellingOf(name) : null);
		if (!guess) continue;
		badCloses.push({ index, end: index + m[0].length });
		problems.push({
			line: at(index),
			message: embedded
				? `Line ${at(index)}: "${m[0]}" is not a valid closing tag, so the <${guess}> before it keeps running past this point. Change it to </${guess}>.`
				: `Line ${at(index)}: "${m[0]}" looks like a misspelled </${guess}>, so the <${guess}> before it never closes. Change it to </${guess}>.`,
		});
	}

	// B. Opening tags that look like a misspelled <script> or <style>.
	const badOpens: Array<{ index: number; tag: RawTextTag }> = [];
	for (const m of code.matchAll(ANY_OPEN_NAME_RE)) {
		const guess = misspellingOf(m[1]!.toLowerCase());
		if (!guess) continue;
		const index = m.index ?? 0;
		badOpens.push({ index, tag: guess });
		problems.push({
			line: at(index),
			message: `Line ${at(index)}: "<${m[1]}…>" looks like a misspelled <${guess}>. Browsers won't treat it as ${guess === "script" ? "JavaScript" : "CSS"}. Change it to <${guess}>.`,
		});
	}

	/** First malformed closer in [from, to): where the author meant the block to end. */
	const badCloseIn = (from: number, to: number) => badCloses.find((b) => b.index >= from && b.index < to);
	const nextLineStartOpen = (from: number): { index: number; tag: string } | null => {
		LINE_START_OPEN_RE.lastIndex = from;
		const m = LINE_START_OPEN_RE.exec(code);
		if (!m) return null;
		return {
			index: m.index + m[1]!.length + (m[0].length - m[1]!.length - m[2]!.length),
			tag: m[3]!.toLowerCase(),
		};
	};
	const strayCloses = (from: number, to: number) => {
		for (const m of code.slice(from, to).matchAll(STRAY_CLOSE_RE)) {
			const index = from + (m.index ?? 0);
			const tag = m[1]!.toLowerCase();
			// The closer for a misspelled opener: the misspelling is already reported.
			if (badOpens.some((b) => b.tag === tag && b.index >= from && b.index < index)) continue;
			const line = at(index);
			problems.push({
				line,
				message: `Line ${line}: closing </${tag}> has no matching opening tag.`,
			});
		}
	};

	// C. Walk script/style blocks the way a browser does, recovering after each problem.
	let cursor = 0;
	for (;;) {
		RAW_OPEN_RE.lastIndex = cursor;
		const open = RAW_OPEN_RE.exec(code);
		if (!open) break;
		strayCloses(cursor, open.index);

		const tag = open[1]!.toLowerCase() as RawTextTag;
		const attrs = open[2] ?? "";
		const line = at(open.index);
		const bodyStart = open.index + open[0].length;
		const closeRe = new RegExp(`</${tag}\\s*>`, "ig");
		closeRe.lastIndex = bodyStart;
		const close = closeRe.exec(code);
		const nested = nextLineStartOpen(bodyStart);

		if (close) {
			const bad = badCloseIn(open.index, close.index);
			if (bad) {
				// Already reported; resume after it so later blocks are still checked.
				cursor = bad.end;
				continue;
			}
			if (nested !== null && nested.index < close.index) {
				// The new tag means this one is missing its closer. Report it, then
				// check the new tag on its own so later problems are found too.
				const nLine = at(nested.index);
				problems.push({
					line: nLine,
					message: `Line ${nLine}: a new <${nested.tag}> starts inside the <${tag}> opened on line ${line}. Add </${tag}> before line ${nLine}.`,
				});
				cursor = nested.index;
				continue;
			}
			const body = code.slice(bodyStart, close.index);
			if (tag === "script" && SRC_ATTR_RE.test(attrs) && body.trim()) {
				const lastLine = at(close.index);
				problems.push({
					line,
					message: `Line ${line}: this <script> loads a src file, so browsers ignore the code written inside it (lines ${line}–${lastLine}). Close it with </script> right after the opening tag and put inline code in its own <script>.`,
				});
			} else {
				cleanBlocks.push({
					tag,
					openTag: open[0],
					attrs,
					body,
					line,
					bodyLine: at(bodyStart),
				});
			}
			cursor = close.index + close[0].length;
			continue;
		}

		// Never closed. If a misspelled closer inside it is the real cause, that is already
		// reported; otherwise report it. Then carry on so later problems are found too.
		const regionEnd = nested?.index ?? code.length;
		const bad = badCloseIn(open.index, regionEnd);
		if (bad) {
			cursor = bad.end;
			continue;
		}
		problems.push({
			line,
			message:
				nested !== null
					? `Line ${line}: <${tag}> is never closed. Add </${tag}> before line ${at(nested.index)}.`
					: `Line ${line}: <${tag}> is never closed. Add </${tag}>.`,
		});
		cursor = regionEnd;
	}

	const tail = code.slice(cursor);
	const dangling = DANGLING_OPEN_RE.exec(tail);
	if (dangling) {
		const line = at(cursor + dangling.index);
		problems.push({
			line,
			message: `Line ${line}: <${dangling[1]!.toLowerCase()} tag is missing its closing ">".`,
		});
		strayCloses(cursor, cursor + dangling.index);
	} else {
		strayCloses(cursor, code.length);
	}

	const seen = new Set<string>();
	const errors = problems
		.sort((x, y) => x.line - y.line)
		.map((p) => p.message)
		.filter((m) => (seen.has(m) ? false : (seen.add(m), true)));
	return { errors, cleanBlocks };
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

	errors.push(...findTagProblems(code).errors);
	const { segments } = scanSnippet(code);

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

// ── Syntax check ────────────────────────────────────────────────

/**
 * Parse every inline JavaScript and JSON block so syntax errors are caught
 * on save, whether or not minification is on. Returns blocking errors with
 * the snippet line number to fix.
 */
export async function checkScriptSyntax(code: string): Promise<string[]> {
	// Only well-formed blocks: a block with a tag problem is reported as that.
	const { cleanBlocks } = findTagProblems(code);

	const errors: string[] = [];
	for (const block of cleanBlocks) {
		if (block.tag !== "script") continue;
		if (!block.body.trim() || SRC_ATTR_RE.test(block.attrs)) continue;
		const type = scriptType(block.attrs);

		if (JSON_TYPES.has(type)) {
			try {
				JSON.parse(block.body);
			} catch (err) {
				errors.push(
					`Line ${block.line}: <script type="${type}"> does not contain valid JSON (${(err as Error).message}).`,
				);
			}
			continue;
		}
		if (!JS_TYPES.has(type)) continue;

		const { minify } = await import("terser");
		try {
			await minify(block.body, {
				module: type === "module",
				compress: false,
				mangle: false,
			});
		} catch (err) {
			const e = err as { message?: string; line?: number };
			const line = typeof e.line === "number" ? block.bodyLine + e.line - 1 : block.line;
			errors.push(
				`Line ${line}: JavaScript syntax error in the <script> that starts on line ${block.line}: ${e.message ?? "the script could not be parsed"}.`,
			);
		}
	}
	return errors;
}

function lineOf(message: string): number {
	const m = /^Line (\d+):/.exec(message);
	return m ? Number(m[1]) : 0;
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
	// Syntax errors are reported alongside tag problems, so everything can be fixed in one pass.
	const tooBig = errors.some((e) => e.startsWith("Snippet is "));
	if (!tooBig) {
		errors.push(...(await checkScriptSyntax(input.codeContent)));
		errors.sort((a, b) => lineOf(a) - lineOf(b));
	}
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
