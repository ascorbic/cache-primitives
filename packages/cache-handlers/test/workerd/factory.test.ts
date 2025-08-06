import { describe, test, expect, beforeEach } from "vitest";
import { createCacheHandlers } from "../../src/index.js";

describe("Cache Factory - Workerd Environment", () => {
	beforeEach(async () => {
		// Note: caches.delete() is not implemented in workerd test environment
		// Tests will use unique cache names to avoid conflicts
	});

	test("createCacheHandlers - creates all handlers", async () => {
		const handlers = createCacheHandlers({ cacheName: "test" });

		expect(handlers.read).toBeTruthy();
		expect(handlers.write).toBeTruthy();
		expect(handlers.middleware).toBeTruthy();
		expect(typeof handlers.read).toBe("function");
		expect(typeof handlers.write).toBe("function");
		expect(typeof handlers.middleware).toBe("function");
	});

	test("handlers work together in workerd integration", async () => {
		const { read, write, middleware } = createCacheHandlers({
			cacheName: "test",
		});

		const request = new Request("https://example.com/api/workerd-integration");

		// Initially no cache hit
		const cacheResult = await read(request);
		expect(cacheResult).toBe(null);

		// Write a response to cache
		const response = new Response("workerd integration test data", {
			headers: {
				"cache-control": "max-age=3600, public",
				"cache-tag": "integration:workerd",
				"content-type": "application/json",
				server: "workerd/1.0",
			},
		});

		const processedResponse = await write(request, response);
		expect(processedResponse.headers.has("cache-tag")).toBe(false);
		expect(processedResponse.headers.get("server")).toBe("workerd/1.0");

		// Now should get cache hit
		const cachedResult = await read(request);
		expect(cachedResult).toBeTruthy();
		expect(await cachedResult!.text()).toBe("workerd integration test data");

		// Middleware should also work
		let nextCalled = false;
		const middlewareResult = await middleware(request, () => {
			nextCalled = true;
			return Promise.resolve(new Response("should not be called"));
		});

		expect(nextCalled).toBe(false);
		expect(await middlewareResult.text()).toBe("workerd integration test data");
	});

	test("workerd environment provides standard Web APIs", async () => {
		// Test that workerd provides the expected global APIs
		expect(typeof caches).toBe("object");
		expect(typeof caches.open).toBe("function");
		expect(typeof caches.delete).toBe("function");
		expect(typeof Request).toBe("function");
		expect(typeof Response).toBe("function");
		expect(typeof Headers).toBe("function");

		// Test URL and URLSearchParams (common in Workers)
		expect(typeof URL).toBe("function");
		expect(typeof URLSearchParams).toBe("function");

		// Test basic workerd functionality
		const url = new URL("https://example.com/test?param=value");
		expect(url.hostname).toBe("example.com");
		expect(url.searchParams.get("param")).toBe("value");
	});

	test("handlers work with Cloudflare Worker patterns", async () => {
		const { middleware } = createCacheHandlers({ cacheName: "test" });

		// Simulate a typical Cloudflare Worker request pattern
		const request = new Request("https://worker.example.com/api/data", {
			method: "GET",
			headers: {
				"user-agent": "Mozilla/5.0",
				"cf-ray": "test-ray-123",
				"cf-ipcountry": "US",
			},
		});

		const next = async () => {
			// Simulate fetching from origin
			return new Response(
				JSON.stringify({
					message: "Hello from origin",
					timestamp: Date.now(),
					country: "US",
				}),
				{
					headers: {
						"content-type": "application/json",
						"cache-control": "public, max-age=300",
						"cache-tag": "api:data",
						"x-origin": "cloudflare-worker",
					},
				},
			);
		};

		const response = await middleware(request, next);

		expect(response.headers.get("content-type")).toBe("application/json");
		expect(response.headers.get("x-origin")).toBe("cloudflare-worker");
		expect(response.headers.has("cache-tag")).toBe(false); // Should be removed by write handler

		const data = await response.json();
		expect(data.message).toBe("Hello from origin");
		expect(data.country).toBe("US");

		// Verify response was cached
		const cache = await caches.open("test");
		const cached = await cache.match(request);
		expect(cached).toBeTruthy();
		expect(cached!.headers.get("cache-tag")).toBe("api:data");
	});
});
