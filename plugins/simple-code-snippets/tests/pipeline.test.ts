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

	it("blocks a malformed closing tag that lets one script swallow the next", () => {
		const code = [
			'<script async src="https://example.com/gtag.js"></ dsfsfgh script>',
			"<script>",
			"  gtag('js', new Date());",
			"</script>",
		].join("\n");
		const { errors } = validateSnippet(code);
		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatch(/^Line 1: "<\/ dsfsfgh script>" is not a valid closing tag.*Change it to <\/script>/);
	});

	it("blocks a new <script> that starts inside an unclosed one", () => {
		const code = ['<script async src="https://example.com/a.js">', "<script>", "go();", "</script>"].join("\n");
		expect(validateSnippet(code).errors[0]).toMatch(
			/^Line 2: a new <script> starts inside the <script> opened on line 1\. Add <\/script> before line 2\./,
		);
	});

	it("blocks code written inside an external <script src>", () => {
		const code = '<script src="https://example.com/a.js">\n  go();\n</script>';
		expect(validateSnippet(code).errors[0]).toMatch(/^Line 1: this <script> loads a src file, so browsers ignore/);
	});

	it("reports every misspelled closing tag, not just the first", () => {
		const code = [
			"<script>a();</scrrript>",
			'<script async src="https://example.com/a.js"></scrrript>',
			"<script>",
			"b();",
			"</scrrript>",
		].join("\n");
		const { errors } = validateSnippet(code);
		expect(errors).toHaveLength(3);
		expect(errors.map((e) => e.slice(0, 7))).toEqual(["Line 1:", "Line 2:", "Line 5:"]);
		for (const e of errors) expect(e).toMatch(/looks like a misspelled <\/script>.*Change it to <\/script>/);
	});

	it("reports each missing closer when several scripts run together", () => {
		const code = ["<script>a();", '<script async src="https://example.com/a.js">', "<script>", "b();", "</script>"].join(
			"\n",
		);
		const { errors } = validateSnippet(code);
		expect(errors).toHaveLength(2);
		expect(errors[0]).toMatch(/^Line 2: a new <script> starts inside the <script> opened on line 1/);
		expect(errors[1]).toMatch(/^Line 3: a new <script> starts inside the <script> opened on line 2/);
	});

	it("flags a misspelled opening tag once, without a knock-on stray-closer error", () => {
		const { errors } = validateSnippet("<scirpt>\nb();\n</script>");
		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatch(/^Line 1: "<scirpt…>" looks like a misspelled <script>/);
	});

	it("does not mistake real elements like <noscript> for misspellings", () => {
		const code = '<noscript><iframe src="https://example.com/ns.html"></iframe></noscript>';
		expect(validateSnippet(code).errors).toEqual([]);
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
	it("blocks a JavaScript syntax error with the line to fix, minified or not", async () => {
		const code = "<script>\nconsole.log(1);\nfunction (\n</script>";
		for (const isMinified of [false, true]) {
			const out = await runPipeline({ codeContent: code, isMinified });
			expect(out.ok).toBe(false);
			expect(out.errors[0]).toMatch(/^Line 3: JavaScript syntax error in the <script> that starts on line 1/);
		}
	});

	it("reports tag problems and syntax errors together", async () => {
		const code = ["<script>a();</scrpit>", "<script>", "go(;", "</script>"].join("\n");
		const out = await runPipeline({ codeContent: code, isMinified: false });
		expect(out.ok).toBe(false);
		expect(out.errors).toHaveLength(2);
		expect(out.errors[0]).toMatch(/^Line 1: "<\/scrpit>" looks like a misspelled/);
		expect(out.errors[1]).toMatch(/^Line 3: JavaScript syntax error in the <script> that starts on line 2/);
	});

	it("blocks invalid JSON-LD even with minification off", async () => {
		const out = await runPipeline({
			codeContent: '<script type="application/ld+json">{"a":1,}</script>',
			isMinified: false,
		});
		expect(out.ok).toBe(false);
		expect(out.errors[0]).toMatch(/does not contain valid JSON/);
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
