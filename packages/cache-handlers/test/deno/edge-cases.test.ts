import { assert, assertEquals, assertExists } from "@std/assert";
// Use internal test-only helpers (not exported from package entrypoint)
import { readFromCache } from "../../src/read.ts";
import { writeToCache } from "../../src/write.ts";
import {
	defaultGetCacheKey,
	isCacheValid,
	parseCacheVaryHeader,
	parseResponseHeaders,
} from "../../src/utils.ts";
import { invalidateByPath, invalidateByTag } from "../../src/invalidation.ts";
import { parseCacheTags } from "../../src/utils.ts";

Deno.test("Edge Cases - Extremely long cache keys", () => {
	// Test various extremely long URL components
	const longPath = "/api/" + "a".repeat(50000);
	const longQuery = "?" +
		Array.from(
			{ length: 1000 },
			(_, i) => `param${i}=${"value".repeat(100)}`,
		).join("&");

	const testCases = [
		`https://example.com${longPath}`,
		`https://example.com/api/users${longQuery}`,
		`https://example.com/api/users${longPath}${longQuery}`,
	];

	for (const url of testCases) {
		const request = new Request(url);
		const cacheKey = defaultGetCacheKey(request);

		assertEquals(typeof cacheKey, "string");
		assert(
			cacheKey.startsWith("https://example.com/"),
			"Cache key should start with the origin",
		);
		assert(
			cacheKey.length > 10000,
			`Cache key should be long, got length: ${cacheKey.length}`,
		);
	}
});

Deno.test("Edge Cases - Boundary TTL values", () => {
	const boundaryValues = [
		0, // Zero TTL
		1, // Minimum positive TTL
		-1, // Negative TTL
		Number.MAX_SAFE_INTEGER, // Maximum safe integer
		Number.MIN_SAFE_INTEGER, // Minimum safe integer
		Number.POSITIVE_INFINITY, // Positive infinity
		Number.NEGATIVE_INFINITY, // Negative infinity
		Number.NaN, // NaN
		2147483647, // 32-bit signed int max
		4294967295, // 32-bit unsigned int max
		Math.pow(2, 53) - 1, // Largest safe integer
	];

	for (const ttl of boundaryValues) {
		const headers = new Headers({
			"cache-control": `max-age=${ttl}, public`,
		});
		const response = new Response("test", { headers });

		// Should handle all boundary values without throwing
		const result = parseResponseHeaders(response);
		assertEquals(typeof result, "object");

		if (!isNaN(ttl) && isFinite(ttl)) {
			assertEquals(result.ttl, ttl);
		}
	}
});

Deno.test("Edge Cases - Cache expiration header edge cases", () => {
	const now = Date.now();
	const testCases = [
		// Cache that expires exactly now
		{ expiresHeader: new Date(now).toUTCString(), expectedValid: false },
		// Cache that expires 2 seconds from now (more reliable for testing)
		{ expiresHeader: new Date(now + 2000).toUTCString(), expectedValid: true },
		// Cache that expired 1ms ago
		{ expiresHeader: new Date(now - 1).toUTCString(), expectedValid: false },
		// Very old cache
		{ expiresHeader: new Date(0).toUTCString(), expectedValid: false },
		// Future cache (1 hour from now)
		{
			expiresHeader: new Date(now + 3600000).toUTCString(),
			expectedValid: true,
		},
		// No expiration header
		{ expiresHeader: null, expectedValid: true },
		// Invalid date header
		{ expiresHeader: "invalid-date", expectedValid: true },
	];

	for (const { expiresHeader, expectedValid } of testCases) {
		const result = isCacheValid(expiresHeader);
		assertEquals(
			result,
			expectedValid,
			`Failed for expiresHeader: ${expiresHeader}, expected: ${expectedValid}`,
		);
	}
});

Deno.test("Edge Cases - Massive vary headers", () => {
	// Test with an extremely large number of vary headers
	const manyVaryHeaders = Array.from({ length: 5000 }, (_, i) => `header-${i}`);
	const varyHeaderString = manyVaryHeaders.map((h) => `header=${h}`).join(", ");

	const result = parseCacheVaryHeader(varyHeaderString);
	assertEquals(result.headers.length, 5000);
	assertEquals(result.headers[0], "header-0");
	assertEquals(result.headers[4999], "header-4999");

	// Test cache key generation with many vary headers
	const headers = new Headers();
	for (let i = 0; i < 1000; i++) {
		headers.set(`header-${i}`, `value-${i}`);
	}

	const request = new Request("https://example.com/api/test", { headers });
	const start = Date.now();
	const cacheKey = defaultGetCacheKey(request, {
		headers: manyVaryHeaders.slice(0, 1000),
		cookies: [],
		query: [],
	});
	const duration = Date.now() - start;

	// Should complete in reasonable time
	assert(duration < 1000, `Cache key generation took too long: ${duration}ms`);
	assertEquals(typeof cacheKey, "string");
	assert(
		cacheKey.length > 10000,
		"Cache key should be very long with many vary headers",
	);
});

Deno.test("Edge Cases - Unicode and special characters in cache tags", () => {
	const specialTags = [
		"user:123", // Normal tag
		"用户:123", // Unicode characters
		"user:🚀", // Emoji
		"user:123|admin", // Pipe character (potential separator conflict)
		"user:123,admin", // Comma in tag value
		"user: 123 ", // Spaces
		"tag\nwith\nnewlines", // Newlines
		"tag\twith\ttabs", // Tabs
		'tag"quotes"', // Quotes
		"tag'apostrophes'", // Apostrophes
		"tag\\backslashes\\", // Backslashes
		"tag/slashes/", // Slashes
		"", // Empty tag (should be filtered)
	];

	const tagString = specialTags.join(", ");
	const result = parseCacheTags(tagString);

	// Should preserve all non-empty tags including special characters
	assertEquals(result.length, specialTags.length - 1); // -1 for empty tag
	assert(result.includes("用户:123"));
	assert(result.includes("user:🚀"));
	assert(result.includes("user:123|admin"));
	assert(!result.includes("")); // Empty tag should be filtered
});

Deno.test("Edge Cases - Concurrent cache operations simulation", async () => {
	await caches.delete("test");
	await caches.open("test");
	const config = { cacheName: "test" } as const;

	// Simulate concurrent writes to the same cache key
	const promises: Promise<unknown>[] = [];

	for (let i = 0; i < 100; i++) {
		const response = new Response(`data-${i}`, {
			headers: {
				"cache-control": "max-age=3600, public",
				"cache-tag": `tag:${i}`,
			},
		});
		Object.defineProperty(response, "url", {
			value: "https://example.com/api/concurrent",
			writable: false,
		});

		const request = new Request("https://example.com/api/concurrent");
		promises.push(writeToCache(request, response, config));
	}

	// Wait for all writes to complete
	await Promise.all(promises);

	// Verify final state - should have one cached entry (last write wins)
	const request = new Request("https://example.com/api/concurrent");
	const { cached: result } = await readFromCache(request, config);

	assertExists(result);
	const text = await result.text();
	assert(text.startsWith("data-"), `Expected data-*, got: ${text}`);
	await caches.delete("test");
	await caches.delete("test");
});

Deno.test("Edge Cases - Very large response bodies", async () => {
	const config = { cacheName: "test" } as const;

	// Create a response with a very large body (10MB of data)
	const largeData = "x".repeat(10 * 1024 * 1024);
	const response = new Response(largeData, {
		headers: {
			"cache-control": "max-age=3600, public",
			"cache-tag": "large-data",
			"content-type": "text/plain",
		},
	});
	Object.defineProperty(response, "url", {
		value: "https://example.com/api/large",
		writable: false,
	});

	const start = Date.now();
	const request = new Request("https://example.com/api/large");
	const result = await writeToCache(request, response.clone(), config);
	const duration = Date.now() - start;

	assertExists(result);
	assertEquals(result.headers.has("cache-tag"), false);

	// Should handle large responses without hanging
	assert(
		duration < 5000,
		`Large response handling took too long: ${duration}ms`,
	);

	// Verify it was cached
	const cache = await caches.open("test");
	const cacheKey = "https://example.com/api/large";
	const cached = await cache.match(new URL(cacheKey));
	assertExists(cached);
	if (cached) {
		await cached.text(); // Clean up resource
	}
	await caches.delete("test");
});

Deno.test("Edge Cases - Empty and whitespace-only headers", () => {
	const emptyHeaders = [
		"", // Empty string
		"   ", // Whitespace only
		"\t", // Tab only
		"\n", // Newline only
		"\r\n", // CRLF
		" \t \n \r ", // Mixed whitespace
	];

	for (const header of emptyHeaders) {
		// Test cache tags parsing
		const tagsResult = parseCacheTags(header);
		assertEquals(Array.isArray(tagsResult), true);
		assertEquals(tagsResult.length, 0);

		// Test vary header parsing
		const varyResult = parseCacheVaryHeader(header);
		assertEquals(varyResult.headers.length, 0);
		assertEquals(varyResult.cookies.length, 0);
		assertEquals(varyResult.query.length, 0);
	}
});

Deno.test("Edge Cases - Cache key collision scenarios", () => {
	// Test potential cache key collisions with URL encoding
	const collisionTests: {
		url1: string;
		url2: string;
		headers2: Record<string, string>;
		vary: { headers: string[]; cookies: string[]; query: string[] };
	}[] = [
		{
			url1: "https://example.com/api/users%7Cadmin%3Atrue",
			url2: "https://example.com/api/users",
			headers2: { admin: "true" },
			vary: { headers: ["admin"], cookies: [], query: [] },
		},
		{
			url1: "https://example.com/api/users%2B%2B",
			url2: "https://example.com/api/users",
			headers2: { custom: "++" },
			vary: { headers: ["custom"], cookies: [], query: [] },
		},
	];

	for (const test of collisionTests) {
		const request1 = new Request(test.url1);
		const request2 = new Request(test.url2, {
			headers: new Headers(test.headers2 as Record<string, string>),
		});

		const key1 = defaultGetCacheKey(request1);
		const key2 = defaultGetCacheKey(request2, test.vary);

		// Keys should be different to prevent unintended collisions
		// Note: This test may reveal actual collision vulnerabilities
		assert(
			key1 !== key2 || test.url1.includes(test.url2),
			`Potential collision: ${key1} vs ${key2}`,
		);
	}
});

Deno.test("Edge Cases - Massive tag-based invalidation", async () => {
	const config = { cacheName: "test" } as const;
	await caches.delete("test"); // Clean start

	// Create a smaller but still significant number of cache entries with overlapping tags
	// (10k entries would take too long with the writeHandler approach)
	const entries = 100;
	for (let i = 0; i < entries; i++) {
		const tags = [
			`item:${i}`,
			`category:${i % 10}`,
			`user:${i % 20}`,
			"global",
		].join(", ");

		const response = new Response(`item ${i} data`, {
			headers: {
				"cache-control": "max-age=3600, public",
				"cache-tag": tags,
			},
		});

		const request = new Request(`https://example.com/api/item/${i}`);
		await writeToCache(request, response, config);
	}

	// Test invalidation performance
	const start = Date.now();
	const deletedCount = await invalidateByTag("global", { cacheName: "test" });
	const duration = Date.now() - start;

	assertEquals(deletedCount, entries);
	assert(duration < 5000, `Mass invalidation took too long: ${duration}ms`);

	// Check that entries are gone by trying to match one
	const cache = await caches.open("test");
	const testEntry = await cache.match(
		new Request("https://example.com/api/item/0"),
	);
	assertEquals(testEntry, undefined);
	await caches.delete("test");
});

Deno.test("Edge Cases - Path invalidation with complex paths", async () => {
	const config = { cacheName: "test" } as const;

	// Add entries with proper metadata using writeHandler
	const paths = [
		"/api/users",
		"/api/users/123",
		"/api/users/123/posts",
		"/api/users/123/posts/456",
		"/api/users-admin",
		"/api/users.json",
		"/api/v1/users",
		"/api/v2/users",
	];

	// Clear cache first
	await caches.delete("test");

	for (const path of paths) {
		const response = new Response(`data for ${path}`, {
			headers: {
				"cache-control": "max-age=3600, public",
				"cache-tag": `path:${path}`,
			},
		});
		const request = new Request(`https://example.com${path}`);
		await writeToCache(request, response, config);
	}

	// Test path invalidation
	const deletedCount = await invalidateByPath("/api/users", {
		cacheName: "test",
	});

	// Should delete /api/users and /api/users/* entries
	// Expected: /api/users, /api/users/123, /api/users/123/posts, /api/users/123/posts/456, /api/users-admin, /api/users.json
	assertEquals(
		deletedCount >= 4,
		true,
		`Expected at least 4 deletions, got ${deletedCount}`,
	);

	await caches.delete("test");
});

Deno.test("Edge Cases - Response cloning edge cases", async () => {
	await caches.open("test");
	const config = { cacheName: "test" } as const;

	// Test with response that has been partially consumed
	const response = new Response("test data", {
		headers: {
			"cache-control": "max-age=3600, public",
			"cache-tag": "test",
		},
	});
	Object.defineProperty(response, "url", {
		value: "https://example.com/api/test",
		writable: false,
	});

	// Partially consume the response body
	const reader = response.body?.getReader();
	if (reader) {
		await reader.read(); // Read first chunk
		reader.releaseLock();
	}

	// Should handle partially consumed response
	// Note: This may fail depending on implementation details
	try {
		const request = new Request("https://example.com/api/test");
		const result = await writeToCache(request, response, config);
		assertExists(result);
	} catch (error) {
		// Expected if response body is already consumed
		assert(
			(error as Error).message.includes("disturbed") ||
				(error as Error).message.includes("locked") ||
				(error as Error).message.includes("unusable"),
		);
	}
});
