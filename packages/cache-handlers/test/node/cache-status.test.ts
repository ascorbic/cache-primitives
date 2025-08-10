import { describe, expect, it } from "vitest";
import { createCacheHandler } from "../../src/index.ts";

function makeResponse(body: string, cacheControl: string) {
	return new Response(body, { headers: { "cache-control": cacheControl } });
}

describe("Cache-Status header", () => {
	it("emits miss then hit with default cache name when enabled as boolean", async () => {
		const handler = () => makeResponse("ok", "max-age=60");
		const handle = createCacheHandler({
			handler,
			features: { cacheStatusHeader: true },
		});
		const req = new Request("https://example.com/ttl");
		const missRes = await handle(req);
		expect(missRes.headers.get("cache-status")).toMatch(
			/^cache-handlers; miss/,
		);
		const hitRes = await handle(req);
		expect(hitRes.headers.get("cache-status")).toMatch(/^cache-handlers; hit/);
	});

	it("uses custom cache name when string provided", async () => {
		const handler = () => makeResponse("custom", "max-age=30");
		const handle = createCacheHandler({
			handler,
			features: { cacheStatusHeader: "edge-cache" },
		});
		const req = new Request("https://example.com/custom");
		await handle(req); // miss
		const hit = await handle(req); // hit
		expect(hit.headers.get("cache-status")).toMatch(/^edge-cache; hit/);
	});
});
