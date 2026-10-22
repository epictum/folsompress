/**
 * Shared types and defaults for Simple Code Snippets.
 *
 * The PRD's `ext_code_injection_settings` table maps onto a single
 * plugin-scoped KV record. EmDash stores plugin KV in the site's database
 * (D1 on Cloudflare), namespaced by plugin ID, so the configuration stays
 * isolated to this plugin without the plugin owning a raw table.
 *
 * PRD column        → field
 * ---------------------------------
 * id = 1            → the single KV key below (one configuration row)
 * is_enabled        → isEnabled
 * placement         → placement
 * code_content      → codeContent   (raw snippet, exactly as typed)
 * is_minified       → isMinified
 * updated_at        → updatedAt
 *
 * `compiledContent` is an addition: the minified output is stored next to
 * the raw snippet so the editor keeps the administrator's formatting while
 * pages receive the minified version.
 */

export const PLUGIN_ID = "simple-code-snippets";
export const PLUGIN_VERSION = "1.4.2";

/** Single configuration record (the PRD's `id = 1` row). */
export const CONFIG_KEY = "config:settings";

/** Hard cap on snippet size, to keep the per-page payload sane. */
export const MAX_SNIPPET_BYTES = 64 * 1024;

export type Placement = "head" | "footer";

export interface SnippetConfig {
	isEnabled: boolean;
	placement: Placement;
	codeContent: string | null;
	compiledContent: string | null;
	isMinified: boolean;
	updatedAt: string;
}

export function defaultConfig(now: Date = new Date()): SnippetConfig {
	return {
		isEnabled: false,
		placement: "head",
		codeContent: null,
		compiledContent: null,
		isMinified: false,
		updatedAt: now.toISOString(),
	};
}

export function isPlacement(value: unknown): value is Placement {
	return value === "head" || value === "footer";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read a stored record defensively; anything malformed falls back to defaults. */
export function normalizeConfig(value: unknown): SnippetConfig {
	const base = defaultConfig();
	if (!isRecord(value)) return base;
	return {
		isEnabled: typeof value.isEnabled === "boolean" ? value.isEnabled : base.isEnabled,
		placement: isPlacement(value.placement) ? value.placement : base.placement,
		codeContent: typeof value.codeContent === "string" ? value.codeContent : null,
		compiledContent: typeof value.compiledContent === "string" ? value.compiledContent : null,
		isMinified: typeof value.isMinified === "boolean" ? value.isMinified : base.isMinified,
		updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : base.updatedAt,
	};
}

/** Response shape for the save route, shared with the admin page. */
export interface SaveResult {
	success: boolean;
	config?: SnippetConfig;
	/** Blocking validation errors (nothing was saved). */
	errors?: string[];
	/** Non-blocking security or structure warnings (saved anyway). */
	warnings?: string[];
	/** Set when Terser failed and minification was turned off automatically. */
	minifyFallback?: string;
}
