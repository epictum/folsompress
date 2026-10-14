/**
 * Edge cache pre-fill ("warming")
 *
 * The edge cache (see astro.config.mjs) makes repeat visits fast, but the first
 * visit after EmDash purges a page (publish, menu/settings edit, deploy) still
 * pays for a full render + D1 queries. This module refills the cache right
 * after a purge so visitors almost never hit a cold page — the same goal as
 * WordPress's Simply Static, without rebuilding or redeploying on publish.
 *
 * How it works (runs on the existing every-minute cron):
 *   1. Probe two pages through the edge cache. Each cached page carries the
 *      time it was rendered (RENDERED_HEADER), so we can tell a cache hit
 *      from a fresh render.
 *   2. If both probes came from cache, nothing was purged: stop. That's two
 *      cheap cache hits a minute (~2,900 requests/day).
 *   3. If either probe had to render, something was purged: refill the home
 *      page, post index, RSS feed, and the post/page/category/tag links found
 *      on them (capped at MAX_URLS).
 *
 * Requests go to this same Worker through the `ctx.exports` loopback, which
 * passes through Workers Cache exactly like a visitor's request.
 *
 * ROLLBACK: set EDGE_WARM to false and redeploy. Nothing else depends on it.
 */

export const EDGE_WARM = true;

/** Response header recording when the Worker rendered a cacheable page. */
export const RENDERED_HEADER = "x-edge-rendered";

/** Pages checked every minute. "/" covers posts, settings and menus; the
 * about page covers the `pages` collection. A slug that doesn't exist still
 * works as a probe — its redirect is cached and purged the same way. */
const PROBES = ["/", "/pages/about"];

/** Always refilled after a purge, before discovered links. */
const SEEDS = ["/", "/posts", "/rss.xml", "/pages/about"];

/** Upper bound on refills per run. The Workers Free plan allows 50
 * subrequests per invocation, and EmDash's scheduled tasks share that budget. */
const MAX_URLS = 25;

/** A page rendered longer ago than this was served from the edge cache. */
const CACHE_HIT_AGE_MS = 15_000;

const CONCURRENCY = 3;

const LINK_RE = /href="(\/(?:posts|pages|category|tag)\/[^"?#\s]+)"/g;

/**
 * Stamp cacheable public responses with their render time. Called from the
 * Worker's fetch handler; the stamp is stored in the edge cache with the page.
 */
export function stampRendered(request: Request, response: Response): Response {
	if (!EDGE_WARM || request.method !== "GET") return response;
	const cdn = response.headers.get("cloudflare-cdn-cache-control");
	if (!cdn || /no-store|private/i.test(cdn)) return response;
	const stamped = new Response(response.body, response);
	stamped.headers.set(RENDERED_HEADER, String(Date.now()));
	return stamped;
}

type Loopback = { fetch(request: Request): Promise<Response> };

function wasCached(response: Response): boolean {
	const rendered = Number(response.headers.get(RENDERED_HEADER));
	return Number.isFinite(rendered) && rendered > 0 && Date.now() - rendered > CACHE_HIT_AGE_MS;
}

async function get(self: Loopback, origin: string, path: string) {
	const response = await self.fetch(
		new Request(origin + path, {
			headers: { "user-agent": "folsompress-edge-warm/1" },
			redirect: "manual",
		}),
	);
	const isHtml = (response.headers.get("content-type") ?? "").includes("text/html");
	const body = isHtml ? await response.text() : (await response.arrayBuffer(), "");
	return { path, cached: wasCached(response), status: response.status, body };
}

/** Run the probe and, if anything was purged, refill the cache. */
export async function warmEdgeCache(
	env: { EMDASH_SITE_URL?: string },
	ctx: ExecutionContext,
): Promise<void> {
	if (!EDGE_WARM) return;

	const self = (ctx as unknown as { exports?: { default?: Loopback } }).exports?.default;
	if (!self) {
		console.warn("[edge-warm] ctx.exports loopback unavailable; skipping");
		return;
	}
	const origin = (env.EMDASH_SITE_URL ?? "").replace(/\/$/, "");
	if (!origin) {
		console.warn("[edge-warm] EMDASH_SITE_URL is not set; skipping");
		return;
	}

	try {
		const probes = await Promise.all(PROBES.map((p) => get(self, origin, p)));
		if (probes.every((p) => p.cached)) return; // nothing purged

		const done = new Map(probes.map((p) => [p.path, p]));
		const queue: string[] = [];
		const enqueue = (path: string) => {
			if (!done.has(path) && !queue.includes(path) && done.size + queue.length < MAX_URLS) {
				queue.push(path);
			}
		};
		const discover = (html: string) => {
			for (const m of html.matchAll(LINK_RE)) enqueue(m[1]);
		};

		SEEDS.forEach(enqueue);
		probes.forEach((p) => discover(p.body));

		while (queue.length) {
			const batch = queue.splice(0, CONCURRENCY);
			const results = await Promise.all(batch.map((p) => get(self, origin, p)));
			for (const r of results) {
				done.set(r.path, r);
				if (r.path === "/posts") discover(r.body);
			}
		}

		const refilled = [...done.values()].filter((r) => !r.cached).length;
		console.log(`[edge-warm] refilled ${refilled} of ${done.size} pages`);
	} catch (error) {
		console.error("[edge-warm] failed:", error);
	}
}
