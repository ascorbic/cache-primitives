import { assert, assertEquals, assertRejects } from "@std/assert";
import { writeToCache } from "../../src/write.ts";
import {
	defaultGetCacheKey,
	parseCacheControl,
	parseCacheTags,
	parseResponseHeaders,
} from "../../src/utils.ts";
import { invalidateByTag } from "../../src/invalidation.ts";

Deno.test("Security - Header injection via cache tags", () => {
	// Test that cache tags with newlines/CRLF are properly handled
	const maliciousTags = "user:123\nSet-Cookie: admin=true\r\nX-Admin: true";
	const result = parseCacheTags(maliciousTags);

	// Should split on commas only, newlines should be preserved in tag values
	// This tests that the library doesn't accidentally create header injection vulnerabilities
	assertEquals(result.length, 1);
	assertEquals(result[0], "user:123\nSet-Cookie: admin=true\r\nX-Admin: true");
});

Deno.test("Security - Cache control directive injection", () => {
	// Test malicious cache control directives
	const maliciousHeader =
		"max-age=3600, private\nSet-Cookie: admin=true\r\nX-Admin: true";
	const result = parseCacheControl(maliciousHeader);

	// Should parse the max-age correctly
	assertEquals(result["max-age"], 3600);
	// The injection attempt gets parsed as a single directive name (newlines preserved)
	const injectionKey = Object.keys(result).find((key) =>
		key.includes("set-cookie")
	);
	assertEquals(typeof injectionKey, "string");
	assertEquals(injectionKey, "private\nset-cookie: admin");
	if (injectionKey) {
		assertEquals(result[injectionKey], "true\r\nX-Admin: true");
	}
});

Deno.test("Security - Extremely long cache keys", () => {
	// Test that extremely long URLs don't cause memory issues
	const longPath = "/api/" + "a".repeat(100000); // 100KB path
	const request = new Request(`https://example.com${longPath}`);

	// Should not throw and should handle gracefully
	const cacheKey = defaultGetCacheKey(request);
	const parsedUrl = new URL(cacheKey);
	assert(
		parsedUrl.host === "example.com",
		"Cache key should have host 'example.com'",
	);
	assert(cacheKey.length > 100000, "Cache key should be long");
});

Deno.test("Security - Vary header bomb attack", () => {
	// Test handling of excessive vary headers that could cause memory/performance issues
	const manyHeaders = new Headers();
	for (let i = 0; i < 1000; i++) {
		manyHeaders.set(`custom-header-${i}`, `value-${i}`);
	}

	const request = new Request("https://example.com/api/users", {
		headers: manyHeaders,
	});
	const vary = {
		headers: Array.from({ length: 1000 }, (_, i) => `custom-header-${i}`),
		cookies: [],
		query: [],
	};

	// Should not cause excessive memory usage or hang
	const start = Date.now();
	const cacheKey = defaultGetCacheKey(request, vary);
	const duration = Date.now() - start;

	// Should complete in reasonable time (less than 100ms)
	assert(duration < 100, `Cache key generation took too long: ${duration}ms`);
	const parsedUrl = new URL(cacheKey);
	assert(
		parsedUrl.host === "example.com",
		"Cache key should have host 'example.com'",
	);
});

Deno.test("Security - Cache pollution via tag injection", async () => {
	await caches.open("test");
	const config = { cacheName: "test" } as const;
	const legitimateResponse = new Response("legitimate data", {
		headers: {
			"cache-control": "max-age=3600, public",
			"cache-tag": "user:123",
			"content-type": "application/json",
		},
	});
	Object.defineProperty(legitimateResponse, "url", {
		value: "https://example.com/api/users/123",
		writable: false,
	});

	const request1 = new Request("https://example.com/api/users/123");
	await writeToCache(request1, legitimateResponse, config);

	// Now try to pollute cache with malicious tags
	const maliciousResponse = new Response("malicious data", {
		headers: {
			"cache-control": "max-age=3600, public",
			"cache-tag": "user:123, admin:true, __proto__:polluted",
			"content-type": "application/json",
		},
	});
	Object.defineProperty(maliciousResponse, "url", {
		value: "https://example.com/api/users/123",
		writable: false,
	});

	const request2 = new Request("https://example.com/api/admin");
	await writeToCache(request2, maliciousResponse, config);

	// Verify that tag-based invalidation works correctly and doesn't cause prototype pollution
	const deletedCount = await invalidateByTag("user:123", { cacheName: "test" });
	assertEquals(deletedCount, 2); // Should delete both entries

	// Verify no pollution occurred in the global object
	assertEquals(
		Object.prototype.hasOwnProperty.call(Object.prototype, "polluted"),
		false,
	);
	assertEquals(
		Object.prototype.hasOwnProperty.call(Object.prototype, "admin"),
		false,
	);
	await caches.delete("test");
});

Deno.test("Security - Extremely long cache keys", () => {
	// Test that extremely long URLs don't cause memory issues
	const longPath = "/api/" + "a".repeat(100000); // 100KB path
	const request = new Request(`https://example.com${longPath}`);

	// Should not throw and should handle gracefully
	const cacheKey = defaultGetCacheKey(request);
	assert(
		cacheKey.startsWith("https://example.com"),
		"Cache key should start with origin",
	);
	assert(cacheKey.length > 100000, "Cache key should be long");
});

Deno.test("Security - Vary header bomb attack", () => {
	// Test handling of excessive vary headers that could cause memory/performance issues
	const manyHeaders = new Headers();
	for (let i = 0; i < 1000; i++) {
		manyHeaders.set(`custom-header-${i}`, `value-${i}`);
	}

	const request = new Request("https://example.com/api/users", {
		headers: manyHeaders,
	});
	const vary = {
		headers: Array.from({ length: 1000 }, (_, i) => `custom-header-${i}`),
		cookies: [],
		query: [],
	};

	// Should not cause excessive memory usage or hang
	const start = Date.now();
	const cacheKey = defaultGetCacheKey(request, vary);
	const duration = Date.now() - start;

	// Should complete in reasonable time (less than 100ms)
	assert(duration < 100, `Cache key generation took too long: ${duration}ms`);
	assert(
		cacheKey.startsWith("https://example.com"),
		"Cache key should start with origin",
	);
});

Deno.test("Security - Cache key collision attack", () => {
	// Test potential cache key collisions with specially crafted URLs
	const request1 = new Request("https://example.com/api/users|admin:true");
	const request2 = new Request("https://example.com/api/users", {
		headers: { admin: "true" },
	});

	const key1 = defaultGetCacheKey(request1);
	const key2 = defaultGetCacheKey(request2, {
		headers: ["admin"],
		cookies: [],
		query: [],
	});

	// Document the actual behavior - collision vulnerability is now fixed with :: separators
	assertEquals(key1, "https://example.com/api/users|admin:true");
	assertEquals(key2, "https://example.com/api/users::h=admin:true");

	// These keys are not identical, which is good.
	assertEquals(key1 !== key2, true);
});

Deno.test("Security - TTL overflow attack", () => {
	// Test handling of extremely large TTL values
	const headers = new Headers({
		"cache-control": `max-age=${Number.MAX_SAFE_INTEGER}, public`,
	});
	const response = new Response("test", { headers });

	const result = parseResponseHeaders(response);
	assertEquals(result.shouldCache, true);
	assertEquals(result.ttl, Number.MAX_SAFE_INTEGER);

	// Test with config max TTL to ensure it's properly limited
	const limitedResult = parseResponseHeaders(response, { maxTtl: 86400 });
	assertEquals(limitedResult.ttl, 86400);
});

Deno.test("Security - Metadata size bomb", async () => {
	await caches.open("test");
	const config = { cacheName: "test" } as const;

	// Create a response with extremely large metadata (security attack)
	const hugeTags = Array.from({ length: 10000 }, (_, i) => `tag:${i}`);
	const response = new Response("test data", {
		headers: {
			"cache-control": "max-age=3600, public",
			"cache-tag": hugeTags.join(", "),
		},
	});
	Object.defineProperty(response, "url", {
		value: "http://example.com/api/users",
		writable: false,
	});

	// Should reject large metadata as a security measure
	const request = new Request("https://example.com/api/users");

	await assertRejects(
		() => writeToCache(request, response, config),
		Error,
		"Too many cache tags",
	);
});
