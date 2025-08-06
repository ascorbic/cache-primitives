import { assertEquals, assertExists } from "jsr:@std/assert";
import { describe, it } from "jsr:@std/testing/bdd";
import { createReadHandler, createWriteHandler } from "../../src/index.ts";
import type { CacheConfig, RevalidationHandler } from "../../src/types.ts";

describe("Stale-While-Revalidate Support", () => {
	const testCacheName = "swr-test-cache";
	
	// Clean up cache after each test
	async function cleanup() {
		const cache = await caches.open(testCacheName);
		const keys = await cache.keys();
		await Promise.all(keys.map(request => cache.delete(request)));
	}

	// Helper to create test responses
	function createTestResponse(content: string, cacheControl: string) {
		return new Response(content, {
			headers: {
				"content-type": "text/plain",
				"cache-control": cacheControl,
			},
		});
	}

	// Helper to wait for a specific duration
	function wait(ms: number) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	it("should parse stale-while-revalidate directive from cache-control", async () => {
		const config: CacheConfig = { cacheName: testCacheName };
		const writeHandler = createWriteHandler(config);

		const request = new Request("https://example.com/test");
		const response = createTestResponse("content", "max-age=1, stale-while-revalidate=5");

		await writeHandler(request, response);

		// Verify the cache contains the response with SWR headers
		const cache = await caches.open(testCacheName);
		const cachedResponse = await cache.match(request);
		
		assertExists(cachedResponse);
		assertExists(cachedResponse.headers.get("expires"));
		assertExists(cachedResponse.headers.get("x-swr-expires"));

		await cleanup();
	});

	it("should serve fresh content when not expired", async () => {
		const config: CacheConfig = { cacheName: testCacheName };
		const readHandler = createReadHandler(config);
		const writeHandler = createWriteHandler(config);

		const request = new Request("https://example.com/fresh");
		const response = createTestResponse("fresh content", "max-age=10, stale-while-revalidate=20");

		// Cache the response
		await writeHandler(request, response);

		// Read should return the cached response
		const cachedResponse = await readHandler(request);
		assertExists(cachedResponse);
		assertEquals(await cachedResponse.text(), "fresh content");

		await cleanup();
	});

	it("should serve stale content during SWR window and trigger revalidation", async () => {
		let revalidationCalled = false;
		let revalidationRequest: Request | undefined;
		let waitUntilCalled = false;

		const revalidationHandler: RevalidationHandler = async (request) => {
			revalidationCalled = true;
			revalidationRequest = request;
			return createTestResponse("revalidated content", "max-age=10, stale-while-revalidate=20");
		};

		const waitUntil = (promise: Promise<any>) => {
			waitUntilCalled = true;
			// In a real scenario, the platform would handle this promise
			promise.catch(() => {}); // Prevent unhandled rejection
		};

		const config: CacheConfig = {
			cacheName: testCacheName,
			revalidationHandler,
			waitUntil,
		};

		const readHandler = createReadHandler(config);
		const writeHandler = createWriteHandler(config);

		const request = new Request("https://example.com/stale");
		const response = createTestResponse("original content", "max-age=0.1, stale-while-revalidate=2");

		// Cache the response
		await writeHandler(request, response);

		// Wait for content to become stale but within SWR window
		await wait(150); // 150ms > 100ms (max-age)

		// Read should return stale content and trigger revalidation
		const staleResponse = await readHandler(request);
		assertExists(staleResponse);
		assertEquals(await staleResponse.text(), "original content");

		// Give some time for background revalidation to be triggered
		await wait(10);

		assertEquals(revalidationCalled, true, "Revalidation should be called");
		assertEquals(waitUntilCalled, true, "waitUntil should be called");
		assertExists(revalidationRequest);
		assertEquals(revalidationRequest!.url, request.url);

		await cleanup();
	});

	it("should return null when content is expired beyond SWR window", async () => {
		const config: CacheConfig = { cacheName: testCacheName };
		const readHandler = createReadHandler(config);
		const writeHandler = createWriteHandler(config);

		const request = new Request("https://example.com/expired");
		const response = createTestResponse("expired content", "max-age=0.1, stale-while-revalidate=0.1");

		// Cache the response
		await writeHandler(request, response);

		// Wait for content to expire beyond SWR window
		await wait(250); // 250ms > 200ms (max-age + stale-while-revalidate)

		// Read should return null
		const expiredResponse = await readHandler(request);
		assertEquals(expiredResponse, null);

		await cleanup();
	});

	it("should fallback to queueMicrotask when waitUntil is not provided", async () => {
		let revalidationCalled = false;

		const revalidationHandler: RevalidationHandler = async (request) => {
			revalidationCalled = true;
			return createTestResponse("revalidated content", "max-age=10");
		};

		const config: CacheConfig = {
			cacheName: testCacheName,
			revalidationHandler,
			// No waitUntil provided - should use queueMicrotask
		};

		const readHandler = createReadHandler(config);
		const writeHandler = createWriteHandler(config);

		const request = new Request("https://example.com/fallback");
		const response = createTestResponse("original content", "max-age=0.1, stale-while-revalidate=2");

		// Cache the response
		await writeHandler(request, response);

		// Wait for content to become stale
		await wait(150);

		// Read should return stale content and trigger revalidation via queueMicrotask
		const staleResponse = await readHandler(request);
		assertExists(staleResponse);
		assertEquals(await staleResponse.text(), "original content");

		// Give time for microtask to execute
		await wait(10);

		assertEquals(revalidationCalled, true, "Revalidation should be called via queueMicrotask");

		await cleanup();
	});

	it("should not trigger revalidation without revalidation handler", async () => {
		const config: CacheConfig = {
			cacheName: testCacheName,
			// No revalidationHandler provided
		};

		const readHandler = createReadHandler(config);
		const writeHandler = createWriteHandler(config);

		const request = new Request("https://example.com/no-handler");
		const response = createTestResponse("content", "max-age=0.1, stale-while-revalidate=2");

		// Cache the response
		await writeHandler(request, response);

		// Wait for content to become stale
		await wait(150);

		// Read should return null since there's no revalidation handler
		const result = await readHandler(request);
		assertEquals(result, null);

		await cleanup();
	});

	it("should handle revalidation with CDN-Cache-Control header", async () => {
		let revalidationCalled = false;

		const revalidationHandler: RevalidationHandler = async (request) => {
			revalidationCalled = true;
			return createTestResponse("revalidated content", "max-age=10");
		};

		const config: CacheConfig = {
			cacheName: testCacheName,
			revalidationHandler,
			waitUntil: (promise: Promise<any>) => {
				promise.catch(() => {});
			},
		};

		const readHandler = createReadHandler(config);
		const writeHandler = createWriteHandler(config);

		const request = new Request("https://example.com/cdn-cache");
		const response = new Response("cdn content", {
			headers: {
				"content-type": "text/plain",
				"cdn-cache-control": "max-age=0.1, stale-while-revalidate=2",
			},
		});

		// Cache the response
		await writeHandler(request, response);

		// Wait for content to become stale
		await wait(150);

		// Read should return stale content and trigger revalidation
		const staleResponse = await readHandler(request);
		assertExists(staleResponse);
		assertEquals(await staleResponse.text(), "cdn content");

		// Give time for revalidation
		await wait(10);

		assertEquals(revalidationCalled, true, "Revalidation should work with CDN-Cache-Control");

		await cleanup();
	});
});