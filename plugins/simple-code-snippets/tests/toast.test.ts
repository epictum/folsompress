import { Toasty } from "@cloudflare/kumo";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { useOptionalToastManager } from "../src/toast.js";

function probe(onResult: (manager: ReturnType<typeof useOptionalToastManager>) => void) {
	return function Probe() {
		onResult(useOptionalToastManager());
		return null;
	};
}

describe("useOptionalToastManager", () => {
	it("returns null instead of throwing when there is no toast provider", () => {
		let result: ReturnType<typeof useOptionalToastManager> | "unset" = "unset";
		const Probe = probe((m) => {
			result = m;
		});
		expect(() => renderToString(createElement(Probe))).not.toThrow();
		expect(result).toBeNull();
	});

	it("returns the admin's toast manager inside <Toasty>", () => {
		let result: ReturnType<typeof useOptionalToastManager> | "unset" = "unset";
		const Probe = probe((m) => {
			result = m;
		});
		renderToString(createElement(Toasty, null, createElement(Probe)));
		expect(result).not.toBeNull();
		expect(typeof (result as unknown as { add: unknown }).add).toBe("function");
	});
});
