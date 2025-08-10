import { assertEquals, assertExists } from "jsr:@std/assert";
import { spy } from "jsr:@std/testing/mock";
import { describe, it } from "jsr:@std/testing/bdd";
import { createCacheHandler } from "../../src/index.ts";
import { writeToCache } from "../../src/write.ts";
import { readFromCache } from "../../src/read.ts";
import type { CacheConfig } from "../../src/types.ts";

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
		const handler = spy((_request: Request) => {
			return Promise.resolve(
				createTestResponse(
					"revalidated content",
					"max-age=10, stale-while-revalidate=20",
				),
			);
		});

		const runInBackground = spy((p: Promise<unknown>) => {
			p.catch(() => {}); // Prevent unhandled rejection in test env
		});

		const handle = createCacheHandler({
			cacheName: testCacheName,
			handler,
			runInBackground,
		});

		const request = new Request("https://example.com/stale");
		const response = createTestResponse(
			"original content",
			"max-age=0.1, stale-while-revalidate=2",
		);

		await writeToCache(request, response, { cacheName: testCacheName });

		await wait(150); // allow to become stale inside SWR window

		const staleResponse = await handle(request);
		assertEquals(await staleResponse.text(), "original content");

		await wait(10); // allow background task scheduling

		assertEquals(
			handler.calls.length,
			1,
			"Revalidation handler should be called once",
		);
		assertEquals(
			runInBackground.calls.length,
			1,
			"Background scheduler should be invoked once",
		);
		const revalidationRequest = handler.calls[0].args[0] as Request;
		assertEquals(revalidationRequest.url, request.url);

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
		const handler = spy((_request: Request) => {
			return Promise.resolve(
				createTestResponse("revalidated content", "max-age=10"),
			);
		});

		const handle = createCacheHandler({ cacheName: testCacheName, handler });

		const request = new Request("https://example.com/fallback");
		const response = createTestResponse(
			"original content",
			"max-age=0.1, stale-while-revalidate=2",
		);

		await writeToCache(request, response, { cacheName: testCacheName });

		await wait(150); // become stale

		const staleResponse = await handle(request);
		assertExists(staleResponse);
		assertEquals(await staleResponse.text(), "original content");

		await wait(10); // allow microtask
		assertEquals(
			handler.calls.length,
			1,
			"Handler should be invoked via microtask",
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
		const handler = spy((_request: Request) => {
			return Promise.resolve(
				createTestResponse("revalidated content", "max-age=10"),
			);
		});
		const runInBackground = spy((p: Promise<unknown>) => {
			p.catch(() => {});
		});

		const handle = createCacheHandler({
			cacheName: testCacheName,
			handler,
			runInBackground,
		});

		const request = new Request("https://example.com/cdn-cache");
		const response = new Response("cdn content", {
			headers: {
				"content-type": "text/plain",
				"cdn-cache-control": "max-age=0.1, stale-while-revalidate=2",
			},
		});

		await writeToCache(request, response, { cacheName: testCacheName });
		await wait(150); // stale

		const staleResponse = await handle(request);
		assertExists(staleResponse);
		const body = await staleResponse.text();
		assertEquals(["cdn content", "revalidated content"].includes(body), true);

		await wait(10);
		assertEquals(
			handler.calls.length,
			1,
			"Handler should be called once for revalidation",
		);
		assertEquals(
			runInBackground.calls.length,
			1,
			"Background scheduler should be called once",
		);

		await cleanup();
	});
});
