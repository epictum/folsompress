import handler, { createScheduledHandler, PluginBridge } from "@emdash-cms/cloudflare/worker";

import { stampRendered, warmEdgeCache } from "./edge-warm";

export { PluginBridge };

const emdashScheduled = createScheduledHandler();

export default {
	...handler,
	// Stamp cacheable pages with their render time (used by the edge warmer).
	async fetch(request, env, ctx) {
		const response = await handler.fetch!(request, env, ctx);
		return stampRendered(request, response);
	},
	// EmDash maintenance (scheduled publishing, plugin cron, backups), then
	// refill the edge cache if anything was purged since the last run.
	scheduled(controller, env, ctx) {
		emdashScheduled(controller, env, ctx);
		ctx.waitUntil(warmEdgeCache(env as { EMDASH_SITE_URL?: string }, ctx));
	},
} satisfies ExportedHandler;
