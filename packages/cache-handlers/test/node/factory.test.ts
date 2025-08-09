import { beforeEach, describe, expect, test } from "vitest";
import { caches, Request, Response } from "undici";
import { createCacheHandler } from "../../src/index.js";

describe("Unified Cache Handler - Node.js with undici", () => {
	beforeEach(async () => {
		// Clean up test cache before each test
		await caches.delete("test");
	});

	test("cache miss then hit integration", async () => {
		const cacheName = "test";
		const handle = createCacheHandler({ cacheName });
		const request = new Request("http://example.com/api/data");
		let invoked = 0;
		// First call (miss)
		const miss = await handle(request as any, {
			handler: (() => {
				invoked++;
				return Promise.resolve(
					new Response("integration test data", {
						headers: {
							"cache-control": "max-age=3600, public",
							"cache-tag": "integration",
							"content-type": "application/json",
						},
					}),
				);
			}) as any,
		});
		expect(invoked).toBe(1);
		expect(await miss.clone().text()).toBe("integration test data");
		// Second call (hit)
		const hit = await handle(request as any, {
			handler: (() => {
				invoked++;
				return Promise.resolve(new Response("should not be called"));
			}) as any,
		});
		expect(invoked).toBe(1);
		expect(await hit.text()).toBe("integration test data");
	});
});
