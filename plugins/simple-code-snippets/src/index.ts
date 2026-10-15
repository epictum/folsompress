/**
 * Simple Code Snippets — native EmDash plugin
 *
 * Injects one administrator-supplied snippet (JS, CSS, or HTML) into the
 * <head> or before </body> of every public page.
 *
 * Why native: raw markup reaches pages only through the `page:fragments`
 * hook, which EmDash runs for trusted (native) plugins and never for
 * sandboxed/registry plugins.
 */

import type { PageFragmentContribution, PluginContext, ResolvedPlugin } from "emdash";
import { definePlugin } from "emdash";

import {
	CONFIG_KEY,
	PLUGIN_ID,
	PLUGIN_VERSION,
	type SaveResult,
	type SnippetConfig,
	defaultConfig,
	isPlacement,
	normalizeConfig,
} from "./config.js";
import { runPipeline } from "./pipeline.js";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function loadConfig(ctx: Pick<PluginContext, "kv">): Promise<SnippetConfig> {
	return normalizeConfig(await ctx.kv.get<unknown>(CONFIG_KEY));
}

export function createPlugin(): ResolvedPlugin {
	return definePlugin({
		id: PLUGIN_ID,
		version: PLUGIN_VERSION,
		// Required for the page:fragments hook to be registered at all.
		capabilities: ["hooks.page-fragments:register"],

		hooks: {
			// PRD §4 — installation routine: seed the single default row.
			"plugin:install": async (_event, ctx) => {
				const existing = await ctx.kv.get<unknown>(CONFIG_KEY);
				if (existing === null) {
					await ctx.kv.set(CONFIG_KEY, defaultConfig());
					ctx.log.info("Simple Code Snippets: default configuration created");
				}
			},

			// PRD §4 — uninstallation routine: drop the plugin's data.
			"plugin:uninstall": async (event, ctx) => {
				if (!event.deleteData) return;
				const keys = await ctx.kv.list("config:");
				for (const { key } of keys) await ctx.kv.delete(key);
				ctx.log.info("Simple Code Snippets: configuration deleted");
			},

			// Edge render: contribute the snippet to the requested placement.
			"page:fragments": {
				// A broken read must never take a page down with it.
				errorPolicy: "continue",
				handler: async (_event, ctx): Promise<PageFragmentContribution | null> => {
					const config = await loadConfig(ctx);
					const html = config.compiledContent ?? config.codeContent;
					if (!config.isEnabled || !html || !html.trim()) return null;

					return {
						kind: "html",
						placement: config.placement === "head" ? "head" : "body:end",
						html,
						key: PLUGIN_ID,
					};
				},
			},
		},

		routes: {
			// GET current configuration for the admin page.
			settings: {
				handler: async (ctx) => {
					const config = await loadConfig(ctx);
					return { config };
				},
			},

			// POST: validate → minify → commit (PRD §3.3).
			"settings/save": {
				methods: ["POST"],
				handler: async (ctx): Promise<SaveResult> => {
					const input = isRecord(ctx.input) ? ctx.input : {};

					if (typeof input.isEnabled !== "boolean") {
						return { success: false, errors: ["isEnabled must be true or false."] };
					}
					if (!isPlacement(input.placement)) {
						return { success: false, errors: ['placement must be "head" or "footer".'] };
					}
					if (typeof input.isMinified !== "boolean") {
						return { success: false, errors: ["isMinified must be true or false."] };
					}
					const codeContent = typeof input.codeContent === "string" ? input.codeContent : "";

					const result = await runPipeline({ codeContent, isMinified: input.isMinified });
					if (!result.ok) {
						return { success: false, errors: result.errors, warnings: result.warnings };
					}

					const config: SnippetConfig = {
						isEnabled: input.isEnabled,
						placement: input.placement,
						codeContent: codeContent.length > 0 ? codeContent : null,
						compiledContent: result.compiledContent.length > 0 ? result.compiledContent : null,
						isMinified: result.isMinified,
						updatedAt: new Date().toISOString(),
					};
					await ctx.kv.set(CONFIG_KEY, config);

					if (result.minifyFallback) {
						ctx.log.warn("Simple Code Snippets: minification fell back to raw snippet", {
							reason: result.minifyFallback,
						});
					}

					return {
						success: true,
						config,
						warnings: result.warnings,
						minifyFallback: result.minifyFallback,
					};
				},
			},

			// POST: permanently delete all settings (behind the confirmation modal).
			"settings/delete": {
				methods: ["POST"],
				handler: async (ctx) => {
					const keys = await ctx.kv.list("config:");
					for (const { key } of keys) await ctx.kv.delete(key);
					const config = defaultConfig();
					await ctx.kv.set(CONFIG_KEY, config);
					return { success: true, config };
				},
			},
		},

		admin: {
			entry: "emdash-plugin-simple-code-snippets/admin",
			pages: [{ path: "/settings", label: "Code Snippets", icon: "code" }],
		},
	});
}

export default createPlugin;
