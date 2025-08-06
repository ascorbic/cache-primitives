import { describe, test, expect, beforeEach } from "vitest";
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

describe("Conditional Requests - Workerd Environment", () => {
	beforeEach(async () => {
		// Note: caches.delete() is not implemented in workerd test environment
		// Tests will use unique cache names to avoid conflicts
	});

	describe("ETag utilities in Workerd", () => {
		test("generates valid ETags in workerd", async () => {
			const response = new Response("workerd test content", {
				headers: { "content-type": "text/plain" },
			});

			const etag = await generateETag(response);

			expect(etag).toBeTruthy();
			expect(typeof etag).toBe("string");
			expect(etag.startsWith('"')).toBe(true);
			expect(etag.endsWith('"')).toBe(true);
		});

		test("parses ETags correctly in workerd", () => {
			// Strong ETag
			const strongETag = parseETag('"workerd-abc123"');
			expect(strongETag.value).toBe("workerd-abc123");
			expect(strongETag.weak).toBe(false);

			// Weak ETag
			const weakETag = parseETag('W/"workerd-abc123"');
			expect(weakETag.value).toBe("workerd-abc123");
			expect(weakETag.weak).toBe(true);
		});

		test("compares ETags correctly in workerd", () => {
			const etag1 = '"workerd-test"';
			const etag2 = '"workerd-test"';
			const etag3 = '"workerd-different"';
			const weakETag = 'W/"workerd-test"';

			// Strong comparison
			expect(compareETags(etag1, etag2)).toBe(true);
			expect(compareETags(etag1, etag3)).toBe(false);
			expect(compareETags(etag1, weakETag, false)).toBe(false);

			// Weak comparison
			expect(compareETags(etag1, weakETag, true)).toBe(true);
		});
	});

	describe("Conditional validation in Workerd", () => {
		test("validates ETag conditional requests in workerd", () => {
			const request = new Request("https://worker.example.com/test", {
				headers: {
					"if-none-match": '"workerd-etag-123"',
					"cf-ray": "test-ray-id",
				},
			});

			const cachedResponse = new Response("cached worker data", {
				headers: {
					etag: '"workerd-etag-123"',
					"content-type": "application/json",
					"cf-cache-status": "HIT",
				},
			});

			const result = validateConditionalRequest(request, cachedResponse);

			expect(result.matches).toBe(true);
			expect(result.shouldReturn304).toBe(true);
			expect(result.matchedValidator).toBe("etag");
		});

		test("validates Last-Modified conditional requests in workerd", () => {
			const lastModified = "Wed, 21 Oct 2015 07:28:00 GMT";

			const request = new Request("https://worker.example.com/test", {
				headers: {
					"if-modified-since": lastModified,
					"cf-ipcountry": "US",
				},
			});

			const cachedResponse = new Response("cached worker data", {
				headers: {
					"last-modified": lastModified,
					"content-type": "application/json",
					server: "cloudflare",
				},
			});

			const result = validateConditionalRequest(request, cachedResponse);

			expect(result.matches).toBe(true);
			expect(result.shouldReturn304).toBe(true);
			expect(result.matchedValidator).toBe("last-modified");
		});
	});

	describe("304 Response creation in Workerd", () => {
		test("creates proper 304 Not Modified response in workerd", () => {
			const cachedResponse = new Response("cached worker data", {
				headers: {
					etag: '"workerd-abc123"',
					"cache-control": "public, max-age=3600",
					"content-type": "application/json",
					vary: "Accept-Encoding",
					"cf-cache-status": "HIT",
					server: "cloudflare",
					"x-worker-custom": "should-not-be-included",
				},
			});

			const response304 = create304Response(cachedResponse);

			expect(response304.status).toBe(304);
			expect(response304.statusText).toBe("Not Modified");

			// Should include required/allowed headers
			expect(response304.headers.get("etag")).toBe('"workerd-abc123"');
			expect(response304.headers.get("cache-control")).toBe(
				"public, max-age=3600",
			);
			expect(response304.headers.get("content-type")).toBe("application/json");
			expect(response304.headers.get("vary")).toBe("Accept-Encoding");
			expect(response304.headers.get("server")).toBe("cloudflare");
			expect(response304.headers.get("date")).toBeTruthy();

			// Should not include custom headers
			expect(response304.headers.get("x-worker-custom")).toBe(null);
			expect(response304.headers.get("cf-cache-status")).toBe(null);
		});
	});

	describe("Handler integration in Workerd", () => {
		test("ReadHandler returns 304 for matching ETag in workerd", async () => {
			const cacheName = `workerd-conditional-read-${Date.now()}`;
			const cache = await caches.open(cacheName);
			const readHandler = createReadHandler({
				cacheName,
				features: { conditionalRequests: true },
			});

			// Cache a response with ETag
			const cacheKey = `https://worker.example.com/api/conditional-${Date.now()}`;
			const cachedResponse = new Response("cached worker data", {
				headers: {
					etag: '"workerd-etag-456"',
					"content-type": "application/json",
					expires: new Date(Date.now() + 3600000).toUTCString(),
					server: "cloudflare",
				},
			});

			await cache.put(new Request(cacheKey), cachedResponse);

			// Request with matching If-None-Match should get 304
			const conditionalRequest = new Request(cacheKey, {
				headers: {
					"if-none-match": '"workerd-etag-456"',
					"cf-ray": "test-conditional-ray",
				},
			});

			const result = await readHandler(conditionalRequest);

			expect(result).toBeTruthy();
			expect(result!.status).toBe(304);
			expect(result!.headers.get("etag")).toBe('"workerd-etag-456"');
			expect(result!.headers.get("server")).toBe("cloudflare");
		});

		test("WriteHandler generates ETags when configured in workerd", async () => {
			const cacheName = `workerd-conditional-write-${Date.now()}`;
			const writeHandler = createWriteHandler({
				cacheName,
				features: {
					conditionalRequests: {
						etag: "generate",
					},
				},
			});

			const request = new Request(
				`https://worker.example.com/api/generate-etag-${Date.now()}`,
			);
			const response = new Response("workerd test data for etag generation", {
				headers: {
					"cache-control": "public, max-age=3600",
					"content-type": "application/json",
					server: "cloudflare",
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
			expect(cachedResponse!.headers.get("server")).toBe("cloudflare");
		});

		test("MiddlewareHandler handles conditional requests in workerd", async () => {
			const cacheName = `workerd-conditional-middleware-${Date.now()}`;
			const middlewareHandler = createMiddlewareHandler({
				cacheName,
				features: {
					conditionalRequests: {
						etag: "generate",
					},
				},
			});

			const requestUrl = `https://worker.example.com/api/middleware-conditional-${Date.now()}`;
			const request = new Request(requestUrl, {
				headers: {
					"cf-ray": "middleware-test-ray",
					"cf-ipcountry": "US",
				},
			});

			// First request - should cache the response
			let nextCallCount = 0;
			const next = () => {
				nextCallCount++;
				return Promise.resolve(
					new Response("fresh worker data", {
						headers: {
							"cache-control": "public, max-age=3600",
							"content-type": "application/json",
							server: "cloudflare",
							"x-edge-location": "DFW",
						},
					}),
				);
			};

			const firstResponse = await middlewareHandler(request, next);
			expect(nextCallCount).toBe(1);
			expect(await firstResponse.text()).toBe("fresh worker data");

			// Get the cached response to extract the ETag
			const cache = await caches.open(cacheName);
			const cachedResponse = await cache.match(request);
			const etag = cachedResponse?.headers.get("etag");

			if (etag) {
				// Second request with matching If-None-Match should get 304
				const conditionalRequest = new Request(requestUrl, {
					headers: {
						"if-none-match": etag,
						"cf-ray": "conditional-test-ray",
						"cf-ipcountry": "US",
					},
				});

				const secondResponse = await middlewareHandler(
					conditionalRequest,
					next,
				);
				expect(nextCallCount).toBe(1); // Should not call next again
				expect(secondResponse.status).toBe(304);
				expect(secondResponse.headers.get("etag")).toBe(etag);
			}
		});
	});

	describe("Workerd-specific conditional request features", () => {
		test("handles Cloudflare-style requests with conditional headers", async () => {
			const cacheName = `workerd-cf-conditional-${Date.now()}`;
			const middlewareHandler = createMiddlewareHandler({
				cacheName,
				features: { conditionalRequests: true },
			});

			// Simulate a typical Cloudflare Worker request with CF headers
			const request = new Request(
				`https://worker.example.com/api/cf-conditional-${Date.now()}`,
				{
					method: "GET",
					headers: {
						"user-agent": "Mozilla/5.0",
						"cf-ray": "conditional-cf-ray-123",
						"cf-ipcountry": "US",
						"cf-visitor": '{"scheme":"https"}',
						accept: "application/json",
					},
				},
			);

			const next = async () => {
				return new Response(
					JSON.stringify({
						message: "Hello from Cloudflare Worker",
						timestamp: Date.now(),
						country: "US",
					}),
					{
						headers: {
							"content-type": "application/json",
							"cache-control": "public, max-age=300",
							etag: '"cf-generated-etag"',
							server: "cloudflare",
							"cf-cache-status": "MISS",
						},
					},
				);
			};

			const response = await middlewareHandler(request, next);

			expect(response.headers.get("content-type")).toBe("application/json");
			expect(response.headers.get("server")).toBe("cloudflare");
			expect(response.headers.get("etag")).toBe('"cf-generated-etag"'); // Should preserve existing ETag

			const data = await response.json();
			expect(data.message).toBe("Hello from Cloudflare Worker");
			expect(data.country).toBe("US");

			// Verify response was cached with ETag
			const cache = await caches.open(cacheName);
			const cached = await cache.match(request);
			expect(cached).toBeTruthy();
			expect(cached!.headers.get("etag")).toBe('"cf-generated-etag"');
		});

		test("workerd environment supports Web API standards", () => {
			// Test that workerd provides the expected Web APIs for conditional requests
			expect(typeof URL).toBe("function");
			expect(typeof Headers).toBe("function");
			expect(typeof Request).toBe("function");
			expect(typeof Response).toBe("function");

			// Test Date handling (important for Last-Modified)
			const date = new Date("Wed, 21 Oct 2015 07:28:00 GMT");
			expect(date.toUTCString()).toBe("Wed, 21 Oct 2015 07:28:00 GMT");

			// Test header manipulation
			const headers = new Headers();
			headers.set("if-none-match", '"test-etag"');
			headers.set("if-modified-since", "Wed, 21 Oct 2015 07:28:00 GMT");
			expect(headers.get("if-none-match")).toBe('"test-etag"');
			expect(headers.get("if-modified-since")).toBe(
				"Wed, 21 Oct 2015 07:28:00 GMT",
			);
		});
	});

	describe("Configuration options in Workerd", () => {
		test("respects disabled conditional requests in workerd", async () => {
			const cacheName = `workerd-conditional-disabled-${Date.now()}`;
			const cache = await caches.open(cacheName);
			const readHandler = createReadHandler({
				cacheName,
				features: { conditionalRequests: false },
			});

			// Cache a response with ETag
			const cacheKey = `https://worker.example.com/api/disabled-${Date.now()}`;
			const cachedResponse = new Response("cached worker data", {
				headers: {
					etag: '"workerd-should-be-ignored"',
					expires: new Date(Date.now() + 3600000).toUTCString(),
					server: "cloudflare",
				},
			});

			await cache.put(new Request(cacheKey), cachedResponse);

			// Request with If-None-Match should get full response (not 304)
			const conditionalRequest = new Request(cacheKey, {
				headers: {
					"if-none-match": '"workerd-should-be-ignored"',
					"cf-ray": "disabled-test-ray",
				},
			});

			const result = await readHandler(conditionalRequest);

			expect(result).toBeTruthy();
			expect(result!.status).toBe(200); // Should be full response, not 304
			expect(await result!.text()).toBe("cached worker data");
			expect(result!.headers.get("server")).toBe("cloudflare");
		});
	});
});
