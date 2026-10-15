/**
 * Simple Code Snippets — plugin descriptor
 *
 * Add to astro.config.mjs:
 *
 *   import { simpleCodeSnippetsPlugin } from "emdash-plugin-simple-code-snippets";
 *
 *   emdash({
 *     plugins: [simpleCodeSnippetsPlugin()],
 *   })
 */

import type { PluginDescriptor } from "emdash";

import { PLUGIN_ID, PLUGIN_VERSION } from "./config.js";

export function simpleCodeSnippetsPlugin(): PluginDescriptor {
	return {
		id: PLUGIN_ID,
		version: PLUGIN_VERSION,
		format: "native",
		entrypoint: "emdash-plugin-simple-code-snippets/plugin",
		options: {},
		adminEntry: "emdash-plugin-simple-code-snippets/admin",
		adminPages: [{ path: "/settings", label: "Code Snippets", icon: "code" }],
	};
}

export default simpleCodeSnippetsPlugin;
