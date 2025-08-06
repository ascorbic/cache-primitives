import { describe, test, expect, beforeEach } from "vitest";
import { caches, Request, Response } from "undici";
import {
	generateETag,
	parseETag,
	compareETags,
	validateConditionalRequest,
	create304Response,
} from "../../src/conditional.js";
import {
	createReadHandler,
	createWriteHandler,
	createMiddlewareHandler,
} from "../../src/handlers.js";

// Ensure undici's implementations are available globally
globalThis.caches = caches;
globalThis.Request = Request;
globalThis.Response = Response;

describe("Conditional Requests - Node.js with undici", () => {
	beforeEach(async () => {
		// Note: unique cache names to avoid conflicts since caches.delete may not work
	});

	describe("ETag utilities", () => {
		test("generates valid ETags", async () => {
			const response = new Response("test content", {
				headers: { "content-type": "text/plain" },
			});

			const etag = await generateETag(response);

			expect(etag).toBeTruthy();
			expect(typeof etag).toBe("string");
			expect(etag.startsWith('"')).toBe(true);
			expect(etag.endsWith('"')).toBe(true);
		});

		test("parses ETags correctly", () => {
			// Strong ETag
			const strongETag = parseETag('"abc123"');
			expect(strongETag.value).toBe("abc123");
			expect(strongETag.weak).toBe(false);

			// Weak ETag
			const weakETag = parseETag('W/"abc123"');
			expect(weakETag.value).toBe("abc123");
			expect(weakETag.weak).toBe(true);
		});

		test("compares ETags correctly", () => {
			const etag1 = '"abc123"';
			const etag2 = '"abc123"';
			const etag3 = '"def456"';
			const weakETag = 'W/"abc123"';

			// Strong comparison
			expect(compareETags(etag1, etag2)).toBe(true);
			expect(compareETags(etag1, etag3)).toBe(false);
			expect(compareETags(etag1, weakETag, false)).toBe(false);

			// Weak comparison
			expect(compareETags(etag1, weakETag, true)).toBe(true);
		});
	});

	describe("Conditional validation", () => {
		test("validates ETag conditional requests", () => {
			const request = new Request("https://example.com/test", {
				headers: {
					"if-none-match": '"abc123"',
				},
			});

			const cachedResponse = new Response("cached data", {
				headers: {
					etag: '"abc123"',
					"content-type": "text/plain",
				},
			});

			const result = validateConditionalRequest(request, cachedResponse);

			expect(result.matches).toBe(true);
			expect(result.shouldReturn304).toBe(true);
			expect(result.matchedValidator).toBe("etag");
		});

		test("validates Last-Modified conditional requests", () => {
			const lastModified = "Wed, 21 Oct 2015 07:28:00 GMT";

			const request = new Request("https://example.com/test", {
				headers: {
					"if-modified-since": lastModified,
				},
			});

			const cachedResponse = new Response("cached data", {
				headers: {
					"last-modified": lastModified,
					"content-type": "text/plain",
				},
			});

			const result = validateConditionalRequest(request, cachedResponse);

			expect(result.matches).toBe(true);
			expect(result.shouldReturn304).toBe(true);
			expect(result.matchedValidator).toBe("last-modified");
		});
	});

	describe("304 Response creation", () => {
		test("creates proper 304 Not Modified response", () => {
			const cachedResponse = new Response("cached data", {
				headers: {
					etag: '"abc123"',
					"cache-control": "max-age=3600",
					"content-type": "application/json",
					vary: "Accept-Encoding",
					"x-custom": "should-not-be-included",
				},
			});

			const response304 = create304Response(cachedResponse);

			expect(response304.status).toBe(304);
			expect(response304.statusText).toBe("Not Modified");

			// Should include required headers
			expect(response304.headers.get("etag")).toBe('"abc123"');
			expect(response304.headers.get("cache-control")).toBe("max-age=3600");
			expect(response304.headers.get("content-type")).toBe("application/json");
			expect(response304.headers.get("vary")).toBe("Accept-Encoding");
			expect(response304.headers.get("date")).toBeTruthy();

			// Should not include custom headers
			expect(response304.headers.get("x-custom")).toBe(null);
		});
	});

	describe("Handler integration", () => {
		test("ReadHandler returns 304 for matching ETag", async () => {
			const cacheName = `conditional-read-${Date.now()}`;
			const cache = await caches.open(cacheName);
			const readHandler = createReadHandler({
				cacheName,
				features: { conditionalRequests: true },
			});

			// Cache a response with ETag
			const cacheKey = `https://example.com/api/conditional-${Date.now()}`;
			const cachedResponse = new Response("cached data", {
				headers: {
					etag: '"test-etag-123"',
					"content-type": "application/json",
					expires: new Date(Date.now() + 3600000).toUTCString(),
				},
			});

			await cache.put(new Request(cacheKey), cachedResponse);

			// Request with matching If-None-Match should get 304
			const conditionalRequest = new Request(cacheKey, {
				headers: {
					"if-none-match": '"test-etag-123"',
				},
			});

			const result = await readHandler(conditionalRequest);

			expect(result).toBeTruthy();
			expect(result!.status).toBe(304);
			expect(result!.headers.get("etag")).toBe('"test-etag-123"');
		});

		test("WriteHandler generates ETags when configured", async () => {
			const cacheName = `conditional-write-${Date.now()}`;
			const writeHandler = createWriteHandler({
				cacheName,
				features: {
					conditionalRequests: {
						etag: "generate",
					},
				},
			});

			const request = new Request(
				`https://example.com/api/generate-etag-${Date.now()}`,
			);
			const response = new Response("test data for etag", {
				headers: {
					"cache-control": "max-age=3600, public",
					"content-type": "application/json",
				},
			});

			const result = await writeHandler(request, response);

			// Original response should not have ETag
			expect(result.headers.get("etag")).toBe(null);

			// Check that cached response has generated ETag
			const cache = await caches.open(cacheName);
			const cachedResponse = await cache.match(request);
			expect(cachedResponse).toBeTruthy();
			expect(cachedResponse!.headers.get("etag")).toBeTruthy();
		});

		test("MiddlewareHandler handles conditional requests", async () => {
			const cacheName = `conditional-middleware-${Date.now()}`;
			const middlewareHandler = createMiddlewareHandler({
				cacheName,
				features: {
					conditionalRequests: {
						etag: "generate",
					},
				},
			});

			const requestUrl = `https://example.com/api/middleware-conditional-${Date.now()}`;
			const request = new Request(requestUrl);

			// First request - should cache the response
			let nextCallCount = 0;
			const next = () => {
				nextCallCount++;
				return Promise.resolve(
					new Response("fresh data", {
						headers: {
							"cache-control": "max-age=3600, public",
							"content-type": "application/json",
						},
					}),
				);
			};

			const firstResponse = await middlewareHandler(request, next);
			expect(nextCallCount).toBe(1);
			expect(await firstResponse.text()).toBe("fresh data");

			// Get the cached response to extract the ETag
			const cache = await caches.open(cacheName);
			const cachedResponse = await cache.match(request);
			const etag = cachedResponse?.headers.get("etag");

			if (etag) {
				// Second request with matching If-None-Match should get 304
				const conditionalRequest = new Request(requestUrl, {
					headers: {
						"if-none-match": etag,
					},
				});

				const secondResponse = await middlewareHandler(
					conditionalRequest,
					next,
				);
				expect(nextCallCount).toBe(1); // Should not call next again
				expect(secondResponse.status).toBe(304);
			}
		});
	});

	describe("Configuration options", () => {
		test("respects disabled conditional requests", async () => {
			const cacheName = `conditional-disabled-${Date.now()}`;
			const cache = await caches.open(cacheName);
			const readHandler = createReadHandler({
				cacheName,
				features: { conditionalRequests: false },
			});

			// Cache a response with ETag
			const cacheKey = `https://example.com/api/disabled-${Date.now()}`;
			const cachedResponse = new Response("cached data", {
				headers: {
					etag: '"should-be-ignored"',
					expires: new Date(Date.now() + 3600000).toUTCString(),
				},
			});

			await cache.put(new Request(cacheKey), cachedResponse);

			// Request with If-None-Match should get full response (not 304)
			const conditionalRequest = new Request(cacheKey, {
				headers: {
					"if-none-match": '"should-be-ignored"',
				},
			});

			const result = await readHandler(conditionalRequest);

			expect(result).toBeTruthy();
			expect(result!.status).toBe(200); // Should be full response, not 304
			expect(await result!.text()).toBe("cached data");
		});
	});
});
