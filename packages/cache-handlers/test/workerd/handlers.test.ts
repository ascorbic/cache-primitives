import { beforeEach, describe, expect, test } from "vitest";
import {
	createMiddlewareHandler,
	createReadHandler,
	createWriteHandler,
} from "../../src/handlers.js";

describe("Cache Handlers - Workerd Environment", () => {
	beforeEach(async () => {
		// Note: caches.delete() is not implemented in workerd test environment
		// Instead, we'll use unique cache names or rely on cache expiration
	});

	describe("ReadHandler", () => {
		test("returns null for cache miss", async () => {
			const cacheName = `test-miss-${Date.now()}`;
			const readHandler = createReadHandler({ cacheName });
			const request = new Request("https://example.com/api/users-miss");

			const result = await readHandler(request);

			expect(result).toBe(null);
		});

		test("returns cached response", async () => {
			const cacheName = `test-cached-${Date.now()}`;
			const cache = await caches.open(cacheName);
			const readHandler = createReadHandler({ cacheName });

			// Put a response in cache with standard headers
			const cacheKey = `https://example.com/api/users-cached-${Date.now()}`;
			const expiresAt = new Date(Date.now() + 3600000); // 1 hour from now
			const cachedResponse = new Response("cached data", {
				headers: {
					"content-type": "application/json",
					"cache-tag": "user",
					expires: expiresAt.toUTCString(),
				},
			});

			await cache.put(new URL(cacheKey), cachedResponse);

			const request = new Request(cacheKey);
			const result = await readHandler(request);

			expect(result).toBeTruthy();
			expect(await result!.text()).toBe("cached data");
			expect(result!.headers.get("content-type")).toBe("application/json");
			expect(result!.headers.get("cache-tag")).toBe("user");
		});

		test("removes expired cache", async () => {
			const cache = await caches.open("test");
			const readHandler = createReadHandler({ cacheName: "test" });

			// Put an expired response in cache
			const cacheKey = "https://example.com/api/users";
			const expiredAt = new Date(Date.now() - 3600000); // 1 hour ago
			const expiredResponse = new Response("expired data", {
				headers: {
					expires: expiredAt.toUTCString(),
				},
			});

			await cache.put(new URL(cacheKey), expiredResponse.clone());

			const request = new Request("https://example.com/api/users");
			const result = await readHandler(request);

			expect(result).toBe(null);

			// Should also remove from cache
			const stillCached = await cache.match(new URL(cacheKey));
			expect(stillCached).toBeUndefined();
		});
	});

	describe("WriteHandler", () => {
		test("caches cacheable response", async () => {
			const writeHandler = createWriteHandler({ cacheName: "test" });

			const request = new Request("https://example.com/api/users");
			const response = new Response("test data", {
				headers: {
					"cache-control": "max-age=3600, public",
					"cache-tag": "user:123",
					"content-type": "application/json",
				},
			});

			const result = await writeHandler(request, response);

			// Should remove processed headers
			expect(result.headers.has("cache-tag")).toBe(false);
			expect(result.headers.get("cache-control")).toBe("max-age=3600, public");
			expect(result.headers.get("content-type")).toBe("application/json");

			// Should be cached
			const cache = await caches.open("test");
			const cacheKey = "https://example.com/api/users";
			const cached = await cache.match(new URL(cacheKey));
			expect(cached).toBeTruthy();
			expect(await cached!.text()).toBe("test data");

			// Should have standard headers
			expect(cached!.headers.get("cache-tag")).toBe("user:123");
			expect(cached!.headers.get("expires")).toBeTruthy();
		});

		test("does not cache non-cacheable response", async () => {
			const writeHandler = createWriteHandler({ cacheName: "test" });

			const request = new Request("https://example.com/api/users");
			const response = new Response("test data", {
				headers: {
					"cache-control": "no-cache, private",
					"content-type": "application/json",
				},
			});

			const result = await writeHandler(request, response);

			expect(result.headers.get("cache-control")).toBe("no-cache, private");
			expect(result.headers.get("content-type")).toBe("application/json");

			// Should not be cached
			const cache = await caches.open("test");
			const cacheKey = "https://example.com/api/users";
			const cached = await cache.match(new URL(cacheKey));
			expect(cached).toBeUndefined();
		});
	});

	describe("MiddlewareHandler", () => {
		test("returns cached response when available", async () => {
			const cache = await caches.open("test");
			const middlewareHandler = createMiddlewareHandler({ cacheName: "test" });

			// Put a response in cache
			const cacheKey = "https://example.com/api/users";
			const expiresAt = new Date(Date.now() + 3600000);
			const cachedResponse = new Response("cached data", {
				headers: {
					"content-type": "application/json",
					"cache-tag": "user",
					expires: expiresAt.toUTCString(),
				},
			});

			await cache.put(new URL(cacheKey), cachedResponse);

			const request = new Request("https://example.com/api/users");
			let nextCalled = false;
			const next = () => {
				nextCalled = true;
				return Promise.resolve(new Response("fresh data"));
			};

			const result = await middlewareHandler(request, next);

			expect(nextCalled).toBe(false); // Should not call next()
			expect(await result.text()).toBe("cached data");
		});

		test("calls next() and caches response", async () => {
			const middlewareHandler = createMiddlewareHandler({ cacheName: "test" });

			const request = new Request("https://example.com/api/users");
			let nextCalled = false;
			const next = () => {
				nextCalled = true;
				return Promise.resolve(
					new Response("fresh data", {
						headers: {
							"cache-control": "max-age=3600, public",
							"cache-tag": "user:123",
						},
					}),
				);
			};

			const result = await middlewareHandler(request, next);

			expect(nextCalled).toBe(true);
			expect(await result.text()).toBe("fresh data");
			expect(result.headers.has("cache-tag")).toBe(false); // Should be removed

			// Should be cached for next time
			const cache = await caches.open("test");
			const cacheKey = "https://example.com/api/users";
			const cached = await cache.match(new URL(cacheKey));
			expect(cached).toBeTruthy();

			expect(cached!.headers.get("cache-tag")).toBe("user:123");
			expect(cached!.headers.get("expires")).toBeTruthy();
		});
	});

	describe("Workerd-specific features", () => {
		test("works with CloudFlare-style Request/Response objects", async () => {
			const middlewareHandler = createMiddlewareHandler({ cacheName: "test" });

			// Test with a CloudFlare Worker style request
			const request = new Request("https://example.com/api/cf-test", {
				method: "GET",
				headers: {
					"CF-Ray": "test-ray-id",
					"CF-IPCountry": "US",
				},
			});

			let nextCalled = false;
			const next = () => {
				nextCalled = true;
				return Promise.resolve(
					new Response("cloudflare data", {
						status: 200,
						headers: {
							"cache-control": "max-age=1800, public",
							"cache-tag": "cloudflare",
							"CF-Cache-Status": "MISS",
						},
					}),
				);
			};

			const result = await middlewareHandler(request, next);

			expect(nextCalled).toBe(true);
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
