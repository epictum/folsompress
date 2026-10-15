/**
 * Purge the edge cache when the Simple Code Snippets plugin is saved.
 *
 * The snippet is injected into every public page, but EmDash only purges the
 * edge cache (see astro.config.mjs) for content, menus, settings and the like.
 * Plugins can't purge it themselves, so without this a saved snippet would
 * only appear once each cached page expired (up to MAX_AGE, plus one visit).
 *
 * After a successful POST to the plugin's save or delete route, purge every
 * page carrying SITE_TAG, which all edge rules in astro.config.mjs add.
 *
 * ROLLBACK: delete this file and redeploy. Nothing else depends on it.
 */

import { defineMiddleware } from "astro:middleware";

/** Keep in sync with SITE_TAG in astro.config.mjs. */
const SITE_TAG = "site";

const SNIPPET_WRITE_ROUTE =
	/^\/_emdash\/api\/plugins\/simple-code-snippets\/settings\/(save|delete)\/?$/;

export const onRequest = defineMiddleware(async (context, next) => {
	const response = await next();

	if (
		context.request.method === "POST" &&
		response.ok &&
		SNIPPET_WRITE_ROUTE.test(context.url.pathname) &&
		context.cache?.enabled
	) {
		try {
			await context.cache.invalidate({ tags: [SITE_TAG] });
		} catch (error) {
			// The save itself succeeded; pages will still refresh on their own.
			console.warn("[snippets] edge cache purge failed", error);
		}
	}

	return response;
});
