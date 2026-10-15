import cloudflare from "@astrojs/cloudflare";
import { cacheCloudflare } from "@astrojs/cloudflare/cache";
import react from "@astrojs/react";
import { d1, r2 } from "@emdash-cms/cloudflare";
import { defineConfig, fontProviders } from "astro/config";
import emdash from "emdash/astro";
import { simpleCodeSnippetsPlugin } from "emdash-plugin-simple-code-snippets";

// ---------------------------------------------------------------------------
// Edge HTML cache (Cloudflare Workers Cache)
//
// Public pages are cached at Cloudflare's edge, so repeat visits are answered
// without running the Worker or querying D1. EmDash purges the affected pages
// automatically (by cache tag) whenever content, menus, settings, taxonomies
// or widgets change in the admin, via the REST API (WP2EM), or via scheduled
// publishing. MAX_AGE is only a safety net for changes EmDash can't tag.
//
// Signed-in requests and /_emdash (admin + API) are never stored.
//
// ROLLBACK: set EDGE_CACHE to false (or revert this commit) and redeploy.
// Each deploy gets a fresh cache, so nothing from this setup lingers.
// ---------------------------------------------------------------------------
const EDGE_CACHE = true;
const MAX_AGE = 300; // seconds a page counts as fresh
const SWR = 86400; // seconds a stale page may be served while refreshing

// Each rule also carries the tag EmDash purges for that collection/taxonomy.
// That covers responses rendered *before* the content existed (e.g. the
// redirect to /404 for a page slug you haven't published yet) and the RSS
// feed, neither of which carry EmDash's own per-entry cache hints.
//
// Every rule also carries SITE_TAG, so changes that affect every page (e.g.
// the Simple Code Snippets plugin, see src/middleware.ts) can purge them all.
// Keep in sync with SITE_TAG in src/middleware.ts.
const SITE_TAG = "site";
const edge = (...tags) => ({ maxAge: MAX_AGE, swr: SWR, tags: [...tags, SITE_TAG] });

export default defineConfig({
	output: "server",
	adapter: cloudflare(),
	...(EDGE_CACHE && {
		cache: { provider: cacheCloudflare() },
		routeRules: {
			"/": edge("posts"),
			"/posts": edge("posts"),
			"/posts/[slug]": edge("posts"),
			"/pages/[slug]": edge("pages"),
			"/category/[slug]": edge("posts", "emdash:taxonomy:category"),
			"/tag/[slug]": edge("posts", "emdash:taxonomy:tag"),
			"/rss.xml": edge("posts"),
			// /search is deliberately left uncached.
		},
	}),
	image: {
		layout: "constrained",
		responsiveStyles: true,
	},
	integrations: [
		react(),
		emdash({
			database: d1({ binding: "DB", session: "auto" }),
			storage: r2({ binding: "MEDIA" }),
			// Native plugin, lives in plugins/simple-code-snippets (pnpm workspace).
			plugins: [simpleCodeSnippetsPlugin()],
		}),
	],
	fonts: [
		{
			provider: fontProviders.google(),
			name: "Inter",
			cssVariable: "--font-body",
			weights: [400, 500, 600, 700],
			fallbacks: ["sans-serif"],
		},
		{
			provider: fontProviders.google(),
			name: "JetBrains Mono",
			cssVariable: "--font-mono",
			weights: [400, 500],
			fallbacks: ["monospace"],
		},
	],
	devToolbar: { enabled: false },
});
