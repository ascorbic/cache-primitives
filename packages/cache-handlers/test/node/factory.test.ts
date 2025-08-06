import { describe, test, expect, beforeEach } from "vitest";
import { caches, Request, Response } from "undici";
import { createCacheHandlers } from "../../src/index.js";

// Ensure undici's implementations are available globally
globalThis.caches = caches;
globalThis.Request = Request;
globalThis.Response = Response;

describe("Cache Factory - Node.js with undici", () => {
	beforeEach(async () => {
		// Clean up test cache before each test
		await caches.delete("test");
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

	test("handlers work together in integration", async () => {
		const { read, write, middleware } = createCacheHandlers({
			cacheName: "test",
		});

		const request = new Request("http://example.com/api/data");

		// Initially no cache hit
		const cacheResult = await read(request);
		expect(cacheResult).toBe(null);

		// Write a response to cache
		const response = new Response("integration test data", {
			headers: {
				"cache-control": "max-age=3600, public",
				"cache-tag": "integration",
				"content-type": "application/json",
			},
		});

		const processedResponse = await write(request, response);
		expect(processedResponse.headers.has("cache-tag")).toBe(false);

		// Now should get cache hit
		const cachedResult = await read(request);
		expect(cachedResult).toBeTruthy();
		expect(await cachedResult!.text()).toBe("integration test data");

		// Middleware should also work
		let nextCalled = false;
		const middlewareResult = await middleware(request, () => {
			nextCalled = true;
			return Promise.resolve(new Response("should not be called"));
		});

		expect(nextCalled).toBe(false);
		expect(await middlewareResult.text()).toBe("integration test data");
	});
});
