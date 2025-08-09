import { beforeEach, describe, expect, test, vi } from "vitest";
import { caches } from "undici";
import { createCacheHandler } from "../../src/index.ts";

describe("Unified Cache Handler - Node.js with undici", () => {
	beforeEach(async () => {
		// Clean up test cache before each test
		await caches.delete("test");
	});

	test("cache miss then hit integration", async () => {
		const cacheName = "test";
		const handle = createCacheHandler({ cacheName });
		const request = new Request("http://example.com/api/data");
		const handler = vi.fn(() =>
			new Response("integration test data", {
				headers: {
					"cache-control": "max-age=3600, public",
					"cache-tag": "integration",
					"content-type": "application/json",
				},
			})
		);
		const miss = await handle(request, { handler });
		expect(handler).toHaveBeenCalledTimes(1);
		expect(await miss.text()).toBe("integration test data");
		// Second call (hit)
		const hit = await handle(request, {
			handler: vi.fn(() => new Response("should not be called")),
		});
		expect(handler).toHaveBeenCalledTimes(1); // still only initial miss call
		expect(await hit.text()).toBe("integration test data");
	});
});
