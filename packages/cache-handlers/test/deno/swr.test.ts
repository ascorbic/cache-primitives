import { assertEquals, assertExists } from "jsr:@std/assert";
import { describe, it } from "jsr:@std/testing/bdd";
import { createCacheHandler } from "../../src/index.ts";
import { writeToCache } from "../../src/write.ts";
import { readFromCache } from "../../src/read.ts";
import type { CacheConfig, RevalidationHandler } from "../../src/types.ts";

describe("Stale-While-Revalidate Support", () => {
	const testCacheName = "swr-test-cache";

	// Clean up cache after each test
	async function cleanup() {
		await caches.delete(testCacheName);
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

	function wait(ms: number) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	it("should parse stale-while-revalidate directive from cache-control", async () => {
		const config: CacheConfig = { cacheName: testCacheName };

		const request = new Request("https://example.com/test");
		const response = createTestResponse(
			"content",
			"max-age=1, stale-while-revalidate=5",
		);

		await writeToCache(request, response, config);

		// Verify the cache contains the response with SWR headers
		const cache = await caches.open(testCacheName);
		const cachedResponse = await cache.match(request);

		assertExists(cachedResponse?.headers.get("expires"));
		// We no longer emit a custom x-swr-expires header; SWR window is derived from cache-control only
		await cachedResponse?.text();

		await cleanup();
	});

	it("should serve fresh content when not expired", async () => {
		const writeConfig: CacheConfig = { cacheName: testCacheName };

		const request = new Request("https://example.com/fresh");
		const response = createTestResponse(
			"fresh content",
			"max-age=10, stale-while-revalidate=20",
		);

		// Cache the response
		await writeToCache(request, response, writeConfig);

		// Read should return the cached response
		const { cached: cachedResponse } = await readFromCache(
			request,
			writeConfig,
		);
		assertExists(cachedResponse);
		assertEquals(await cachedResponse!.text(), "fresh content");

		await cleanup();
	});

	it("should serve stale content during SWR window and trigger revalidation", async () => {
		let revalidationCalled = false;
		let revalidationRequest: Request | undefined;
		let waitUntilCalled = false;

		const revalidationHandler: RevalidationHandler = (request) => {
			revalidationCalled = true;
			revalidationRequest = request;
			return Promise.resolve(createTestResponse(
				"revalidated content",
				"max-age=10, stale-while-revalidate=20",
			));
		};

		const waitUntil = (promise: Promise<unknown>) => {
			waitUntilCalled = true;
			// In a real scenario, the platform would handle this promise
			promise.catch(() => {}); // Prevent unhandled rejection
		};

		// config retained for conceptual clarity (not directly used)

		const handle = createCacheHandler({
			cacheName: testCacheName,
			handler: revalidationHandler,
			runInBackground: (p) => waitUntil(p),
		});

		const request = new Request("https://example.com/stale");
		const response = createTestResponse(
			"original content",
			"max-age=0.1, stale-while-revalidate=2",
		);

		// Cache the response
		await writeToCache(request, response, { cacheName: testCacheName });

		// Wait for content to become stale but within SWR window
		await wait(150); // 150ms > 100ms (max-age)

		// Read should return stale content and trigger revalidation
		const staleResponse = await handle(request);
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
		const writeConfig: CacheConfig = { cacheName: testCacheName };

		const request = new Request("https://example.com/expired");
		const response = createTestResponse(
			"expired content",
			"max-age=0.1, stale-while-revalidate=0.1",
		);

		// Cache the response
		await writeToCache(request, response, writeConfig);

		// Wait for content to expire beyond SWR window
		await wait(250); // 250ms > 200ms (max-age + stale-while-revalidate)

		// Read should return null
		const { cached: expiredResponse } = await readFromCache(
			request,
			writeConfig,
		);
		assertEquals(expiredResponse, null);

		await cleanup();
	});

	it("should fallback to queueMicrotask when waitUntil is not provided", async () => {
		let revalidationCalled = false;

		const revalidationHandler: RevalidationHandler = (_request) => {
			revalidationCalled = true;
			return Promise.resolve(
				createTestResponse("revalidated content", "max-age=10"),
			);
		};

		// No waitUntil provided - should use queueMicrotask

		const handle = createCacheHandler({
			cacheName: testCacheName,
			handler: revalidationHandler,
		});

		const request = new Request("https://example.com/fallback");
		const response = createTestResponse(
			"original content",
			"max-age=0.1, stale-while-revalidate=2",
		);

		// Cache the response
		await writeToCache(request, response, { cacheName: testCacheName });

		// Wait for content to become stale
		await wait(150);

		// Read should return stale content and trigger revalidation via queueMicrotask
		const staleResponse = await handle(request);
		assertExists(staleResponse);
		assertEquals(await staleResponse.text(), "original content");

		// Give time for microtask to execute
		await wait(10);

		assertEquals(
			revalidationCalled,
			true,
			"Revalidation should be called via queueMicrotask",
		);

		await cleanup();
	});

	it("should serve stale content without revalidation handler (no background work)", async () => {
		const writeConfig: CacheConfig = { cacheName: testCacheName };

		const request = new Request("https://example.com/no-handler");
		const response = createTestResponse(
			"content",
			"max-age=0.1, stale-while-revalidate=2",
		);

		// Cache the response
		await writeToCache(request, response, writeConfig);

		// Wait for content to become stale
		await wait(150);

		// Read should return stale content (library serves stale if within SWR window even without handler)
		const { cached: result, needsBackgroundRevalidation } = await readFromCache(
			request,
			writeConfig,
		);
		assertExists(result);
		assertEquals(needsBackgroundRevalidation, true);
		await result?.text();

		await cleanup();
	});

	it("should handle revalidation with CDN-Cache-Control header", async () => {
		let revalidationCalled = false;

		const revalidationHandler: RevalidationHandler = (_request) => {
			revalidationCalled = true;
			return Promise.resolve(
				createTestResponse("revalidated content", "max-age=10"),
			);
		};

		const waitUntil = (p: Promise<unknown>) => {
			p.catch(() => {});
		};

		const handle = createCacheHandler({
			cacheName: testCacheName,
			handler: revalidationHandler,
			runInBackground: (p) => waitUntil(p),
		});

		const request = new Request("https://example.com/cdn-cache");
		const response = new Response("cdn content", {
			headers: {
				"content-type": "text/plain",
				"cdn-cache-control": "max-age=0.1, stale-while-revalidate=2",
			},
		});

		// Cache the response
		await writeToCache(request, response, { cacheName: testCacheName });

		// Wait for content to become stale
		await wait(150);

		// Read should return stale content and trigger revalidation
		const staleResponse = await handle(request);
		assertExists(staleResponse);
		const body = await staleResponse.text();
		// Depending on timing, we may see original stale body or revalidated body
		assertEquals(["cdn content", "revalidated content"].includes(body), true);

		// Give time for revalidation
		await wait(10);

		assertEquals(
			revalidationCalled,
			true,
			"Revalidation should work with CDN-Cache-Control",
		);

		await cleanup();
	});
});
