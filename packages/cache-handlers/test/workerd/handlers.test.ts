import { beforeEach, describe, expect, test, vi } from "vitest";
import { createCacheHandler } from "../../src/handlers.ts";

describe("Cache Handler - Workerd Environment", () => {
	beforeEach(async () => {
		// no global cache deletion in workerd test env; use unique names
	});

	describe("Core handler", () => {
		test("miss invokes handler and caches", async () => {
			const cacheName = `wk-miss-${Date.now()}`;
			const handle = createCacheHandler({ cacheName });
			const missHandler = vi.fn(() =>
				new Response("fresh", {
					headers: {
						"cache-control": "max-age=60, public",
						"cache-tag": "x",
					},
				})
			);
			const resp = await handle(new Request("https://example.com/api/miss"), {
				handler: missHandler,
			});
			expect(missHandler).toHaveBeenCalledTimes(1);
			expect(await resp.text()).toBe("fresh");
			const cache = await caches.open(cacheName);
			expect(await cache.match("https://example.com/api/miss")).toBeTruthy();
		});
		test("hit returns cached without re-invoking", async () => {
			const cacheName = `wk-hit-${Date.now()}`;
			const handle = createCacheHandler({ cacheName });
			const url = `https://example.com/api/hit-${Date.now()}`;
			await (
				await caches.open(cacheName)
			).put(
				new URL(url),
				new Response("cached", {
					headers: { expires: new Date(Date.now() + 60000).toUTCString() },
				}),
			);
			const hitHandler = vi.fn(() => new Response("fresh"));
			const resp = await handle(new Request(url), {
				handler: hitHandler,
			});
			expect(hitHandler).not.toHaveBeenCalled();
			expect(await resp.text()).toBe("cached");
		});
	});

	describe("Workerd-specific features", () => {
		test("works with CloudFlare-style Request/Response objects", async () => {
			const handle = createCacheHandler({ cacheName: "test" });

			// Test with a CloudFlare Worker style request
			const request = new Request("https://example.com/api/cf-test", {
				method: "GET",
				headers: {
					"CF-Ray": "test-ray-id",
					"CF-IPCountry": "US",
				},
			});

			const result = await handle(request, {
				handler: () =>
					new Response("cloudflare data", {
						status: 200,
						headers: {
							"cache-control": "max-age=1800, public",
							"cache-tag": "cloudflare",
							"CF-Cache-Status": "MISS",
						},
					}),
			});

			expect(await result.text()).toBe("cloudflare data");
			expect(result.headers.get("CF-Cache-Status")).toBe("MISS");

			// Verify caching worked in workerd environment
			const cache = await caches.open("test");
			const cached = await cache.match(request);
			expect(cached).toBeTruthy();
			expect(cached!.headers.get("cache-tag")).toBe("cloudflare");
		});

		test("cache operations work with workerd native Cache API", async () => {
			// Direct test of workerd Cache API integration
			const cache = await caches.open("test-native");

			const testRequest = new Request("https://test.example/native-api");
			const testResponse = new Response("native cache data", {
				headers: {
					"cache-control": "max-age=3600",
					"content-type": "text/plain",
				},
			});

			// Test native put operation
			await cache.put(testRequest, testResponse.clone());

			// Test native match operation
			const cachedResponse = await cache.match(testRequest);
			expect(cachedResponse).toBeTruthy();
			expect(await cachedResponse!.text()).toBe("native cache data");

			// Test native delete operation
			await cache.delete(testRequest);
			const deletedResponse = await cache.match(testRequest);
			expect(deletedResponse).toBeUndefined();

			// Note: caches.delete() not implemented in workerd test environment
		});
	});
});
