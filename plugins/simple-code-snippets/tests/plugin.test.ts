import { describe, expect, it } from "vitest";

import { CONFIG_KEY } from "../src/config.js";
import { createPlugin } from "../src/index.js";

/** Minimal stand-in for the parts of PluginContext this plugin uses. */
function fakeCtx(input?: unknown) {
	const store = new Map<string, unknown>();
	const kv = {
		get: async <T,>(key: string) => (store.has(key) ? (store.get(key) as T) : null),
		set: async (key: string, value: unknown) => void store.set(key, structuredClone(value)),
		delete: async (key: string) => store.delete(key),
		list: async (prefix = "") =>
			[...store.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, value]) => ({ key, value })),
	};
	const log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
	return { store, ctx: { kv, log, input } as never };
}

const plugin = createPlugin();
const hooks = plugin.hooks;
const page = { page: { url: "https://x.test/", path: "/" } } as never;

async function save(ctxStore: ReturnType<typeof fakeCtx>, body: unknown) {
	const { ctx } = fakeCtx(body);
	// Share the same backing store across calls.
	(ctx as { kv: unknown }).kv = (ctxStore.ctx as { kv: unknown }).kv;
	return plugin.routes["settings/save"]!.handler(ctx) as Promise<Record<string, unknown>>;
}

describe("Simple Code Snippets plugin", () => {
	it("declares the page-fragments capability", () => {
		expect(plugin.capabilities).toContain("hooks.page-fragments:register");
	});

	it("seeds a disabled default config on install", async () => {
		const h = fakeCtx();
		await hooks["plugin:install"]!.handler({} as never, h.ctx);
		expect(h.store.get(CONFIG_KEY)).toMatchObject({ isEnabled: false, placement: "head" });
	});

	it("injects nothing while disabled, then injects into the chosen placement", async () => {
		const h = fakeCtx();
		await hooks["plugin:install"]!.handler({} as never, h.ctx);
		expect(await hooks["page:fragments"]!.handler(page, h.ctx)).toBeNull();

		const res = await save(h, {
			isEnabled: true,
			placement: "footer",
			isMinified: true,
			codeContent: "<script>\n  console.log( 'hello' );\n</script>",
		});
		expect(res.success).toBe(true);

		const fragment = await hooks["page:fragments"]!.handler(page, h.ctx);
		expect(fragment).toEqual({
			kind: "html",
			placement: "body:end",
			html: '<script>console.log("hello");</script>',
			key: "simple-code-snippets",
		});
		// The editor keeps the original formatting.
		expect((h.store.get(CONFIG_KEY) as { codeContent: string }).codeContent).toContain("\n");
	});

	it("rejects invalid snippets without overwriting the saved config", async () => {
		const h = fakeCtx();
		await save(h, { isEnabled: true, placement: "head", isMinified: false, codeContent: "<style>a{}</style>" });
		const res = await save(h, { isEnabled: true, placement: "head", isMinified: false, codeContent: "<script>" });
		expect(res.success).toBe(false);
		expect((h.store.get(CONFIG_KEY) as { codeContent: string }).codeContent).toBe("<style>a{}</style>");
	});

	it("rejects malformed input", async () => {
		const h = fakeCtx();
		const res = await save(h, { isEnabled: "yes", placement: "sidebar" });
		expect(res.success).toBe(false);
	});

	it("deletes data on uninstall only when asked", async () => {
		const h = fakeCtx();
		await hooks["plugin:install"]!.handler({} as never, h.ctx);
		await hooks["plugin:uninstall"]!.handler({ deleteData: false } as never, h.ctx);
		expect(h.store.has(CONFIG_KEY)).toBe(true);
		await hooks["plugin:uninstall"]!.handler({ deleteData: true } as never, h.ctx);
		expect(h.store.has(CONFIG_KEY)).toBe(false);
	});

	it("delete route resets everything to defaults", async () => {
		const h = fakeCtx();
		await save(h, { isEnabled: true, placement: "footer", isMinified: false, codeContent: "<b>x</b>" });
		await plugin.routes["settings/delete"]!.handler(h.ctx);
		expect(h.store.get(CONFIG_KEY)).toMatchObject({ isEnabled: false, codeContent: null });
	});
});
