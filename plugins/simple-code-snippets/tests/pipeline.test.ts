import { describe, expect, it } from "vitest";

import { minifyCss, minifySnippet, runPipeline, validateSnippet } from "../src/pipeline.js";

const GTM = `<!-- Google Tag Manager -->
<script>
  (function (w, d, s, l, i) {
    w[l] = w[l] || [];
    w[l].push({ "gtm.start": new Date().getTime(), event: "gtm.js" });
    var f = d.getElementsByTagName(s)[0],
      j = d.createElement(s),
      dl = l != "dataLayer" ? "&l=" + l : "";
    j.async = true;
    j.src = "https://www.googletagmanager.com/gtm.js?id=" + i + dl;
    f.parentNode.insertBefore(j, f);
  })(window, document, "script", "dataLayer", "GTM-XXXX");
</script>
<!-- End Google Tag Manager -->`;

describe("validateSnippet", () => {
	it("accepts a well-formed GTM snippet with no warnings", () => {
		expect(validateSnippet(GTM)).toEqual({ errors: [], warnings: [] });
	});

	it("blocks an unclosed <script>", () => {
		const { errors } = validateSnippet("<script>\nconsole.log(1)\n");
		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatch(/Line 1: <script> is never closed/);
	});

	it("blocks an unclosed <style>", () => {
		expect(validateSnippet("<style>body{}").errors[0]).toMatch(/<style> is never closed/);
	});

	it("blocks a stray closing tag", () => {
		expect(validateSnippet("<div></div>\n</script>").errors[0]).toMatch(
			/Line 2: closing <\/script> has no matching opening tag/,
		);
	});

	it("blocks an opening tag missing its >", () => {
		expect(validateSnippet('<script src="x.js"').errors[0]).toMatch(/missing its closing/);
	});

	it("does not treat <script inside a script string as a nested tag", () => {
		const code = `<script>document.write("<script" + ">")</script>`;
		expect(validateSnippet(code).errors).toEqual([]);
	});

	it("warns (non-blocking) about inline event handlers", () => {
		const { errors, warnings } = validateSnippet('<img src="a.png" onload="track()" onerror="x()">');
		expect(errors).toEqual([]);
		expect(warnings.join(" ")).toMatch(/onload=, onerror=/);
	});

	it("warns about handlers on a <script> opening tag too", () => {
		expect(validateSnippet('<script src="a.js" onload="go()"></script>').warnings[0]).toMatch(
			/onload=/,
		);
	});

	it("warns when bare JS would render as visible text", () => {
		expect(validateSnippet("console.log('hi')").warnings.join(" ")).toMatch(/visible text/);
	});

	it("rejects oversized snippets", () => {
		expect(validateSnippet("x".repeat(70 * 1024)).errors[0]).toMatch(/limit is 64 KB/);
	});
});

describe("minifySnippet", () => {
	it("minifies inline JS, keeps tags, drops plain comments", async () => {
		const out = await minifySnippet(GTM);
		expect(out.startsWith("<script>")).toBe(true);
		expect(out.endsWith("</script>")).toBe(true);
		expect(out).not.toContain("Google Tag Manager -->");
		expect(out.length).toBeLessThan(GTM.length * 0.75);
		expect(out).toContain("GTM-XXXX");
	});

	it("leaves external scripts and templates alone", async () => {
		const code = `<script async src="https://example.com/a.js"></script>\n<script type="text/template"> <b> hi </b> </script>`;
		expect(await minifySnippet(code)).toBe(
			`<script async src="https://example.com/a.js"></script><script type="text/template"> <b> hi </b> </script>`,
		);
	});

	it("compacts JSON-LD", async () => {
		const out = await minifySnippet(`<script type="application/ld+json">\n{ "@type": "Thing" }\n</script>`);
		expect(out).toBe(`<script type="application/ld+json">{"@type":"Thing"}</script>`);
	});

	it("minifies CSS", () => {
		expect(minifyCss("/* c */ body {\n  color: red ;\n}\n")).toBe("body{color:red}");
	});
});

describe("runPipeline", () => {
	it("falls back to raw when Terser fails, and turns minification off", async () => {
		const code = "<script>function (</script>";
		const out = await runPipeline({ codeContent: code, isMinified: true });
		expect(out.ok).toBe(true);
		expect(out.isMinified).toBe(false);
		expect(out.compiledContent).toBe(code);
		expect(out.minifyFallback).toMatch(/Minification failed/);
	});

	it("does not save when validation fails", async () => {
		const out = await runPipeline({ codeContent: "<script>", isMinified: true });
		expect(out.ok).toBe(false);
		expect(out.errors).toHaveLength(1);
	});

	it("passes through untouched when minification is off", async () => {
		const out = await runPipeline({ codeContent: `  ${GTM}\n`, isMinified: false });
		expect(out.compiledContent).toBe(GTM);
	});
});
