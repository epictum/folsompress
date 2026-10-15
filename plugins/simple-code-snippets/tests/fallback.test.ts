import { describe, expect, it, vi } from "vitest";

// Terser parses fine (syntax check passes) but fails while compressing.
vi.mock("terser", () => ({
	minify: async (_code: string, options: { compress?: unknown }) => {
		if (options.compress) throw new Error("internal compressor error");
		return { code: "" };
	},
}));

const { runPipeline } = await import("../src/pipeline.js");

describe("minification fallback", () => {
	it("saves raw and turns minification off when Terser fails after a clean parse", async () => {
		const code = "<script>console.log(1)</script>";
		const out = await runPipeline({ codeContent: code, isMinified: true });
		expect(out.ok).toBe(true);
		expect(out.isMinified).toBe(false);
		expect(out.compiledContent).toBe(code);
		expect(out.minifyFallback).toMatch(/Minification failed/);
	});
});
