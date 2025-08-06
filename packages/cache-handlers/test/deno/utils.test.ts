import { assertArrayIncludes, assertEquals } from "@std/assert";
import {
	defaultGetCacheKey,
	isCacheValid,
	parseCacheControl,
	parseCacheTags,
	parseCacheVaryHeader,
	parseResponseHeaders,
	removeHeaders,
} from "../../src/utils.ts";

Deno.test("parseCacheControl - simple directives", () => {
	const result = parseCacheControl("max-age=3600, public");
	assertEquals(result["max-age"], 3600);
	assertEquals(result.public, true);
});

Deno.test("parseCacheControl - complex directives with quotes", () => {
	const result = parseCacheControl(
		'max-age=86400, s-maxage="7200", must-revalidate',
	);
	assertEquals(result["max-age"], 86400);
	assertEquals(result["s-maxage"], 7200);
	assertEquals(result["must-revalidate"], true);
});

Deno.test("parseCacheControl - no-cache and private", () => {
	const result = parseCacheControl("no-cache, private, max-age=0");
	assertEquals(result["no-cache"], true);
	assertEquals(result.private, true);
	assertEquals(result["max-age"], 0);
});

Deno.test("parseCacheTags - single tag", () => {
	const result = parseCacheTags("user:123");
	assertEquals(result, ["user:123"]);
});

Deno.test("parseCacheTags - multiple tags", () => {
	const result = parseCacheTags("user:123, post:456, category:tech");
	assertEquals(result, ["user:123", "post:456", "category:tech"]);
});

Deno.test("parseCacheTags - empty tags filtered out", () => {
	const result = parseCacheTags("user:123, , post:456,  ");
	assertEquals(result, ["user:123", "post:456"]);
});

Deno.test("parseResponseHeaders - cacheable response", () => {
	const headers = new Headers({
		"cache-control": "max-age=3600, public",
		"cache-tag": "user:123, post:456",
	});
	const response = new Response("test", { headers });

	const result = parseResponseHeaders(response);
	assertEquals(result.shouldCache, true);
	assertEquals(result.ttl, 3600);
	assertEquals(result.tags, ["user:123", "post:456"]);
	assertEquals(result.isPrivate, false);
	assertEquals(result.noCache, false);
});

Deno.test("parseResponseHeaders - private response", () => {
	const headers = new Headers({
		"cache-control": "max-age=3600, private",
	});
	const response = new Response("test", { headers });

	const result = parseResponseHeaders(response);
	assertEquals(result.shouldCache, false);
	assertEquals(result.isPrivate, true);
});

Deno.test("parseResponseHeaders - CDN cache control overrides", () => {
	const headers = new Headers({
		"cache-control": "max-age=3600, public",
		"cdn-cache-control": "max-age=7200, private",
	});
	const response = new Response("test", { headers });

	const result = parseResponseHeaders(response);
	assertEquals(result.shouldCache, false);
	assertEquals(result.ttl, 7200);
	assertEquals(result.isPrivate, true);
	assertArrayIncludes(result.headersToRemove, ["cdn-cache-control"]);
});

Deno.test("parseResponseHeaders - with default TTL", () => {
	const headers = new Headers();
	const response = new Response("test", { headers });
	const config = { defaultTtl: 1800 };

	const result = parseResponseHeaders(response, config);
	assertEquals(result.shouldCache, false); // No explicit cache headers
	assertEquals(result.ttl, undefined);
});

Deno.test("parseResponseHeaders - max TTL limit", () => {
	const headers = new Headers({
		"cache-control": "max-age=86400, public", // 24 hours
	});
	const response = new Response("test", { headers });
	const config = { maxTtl: 3600 }; // 1 hour limit

	const result = parseResponseHeaders(response, config);
	assertEquals(result.shouldCache, true);
	assertEquals(result.ttl, 3600); // Limited to maxTtl
});

Deno.test("defaultGetCacheKey - basic request", () => {
	const request = new Request("https://example.com/api/users?page=1");
	const result = defaultGetCacheKey(request);
	assertEquals(result, "https://example.com/api/users?page=1");
});

Deno.test("defaultGetCacheKey - with vary headers", () => {
	const headers = new Headers({
		accept: "application/json",
		"user-agent": "test-agent",
	});
	const request = new Request("https://example.com/api/users", { headers });
	const vary = { headers: ["accept", "user-agent"], cookies: [], query: [] };

	const result = defaultGetCacheKey(request, vary);
	assertEquals(
		result,
		"https://example.com/api/users|header-accept=application/json|header-user-agent=test-agent",
	);
});

Deno.test("defaultGetCacheKey - POST request", () => {
	const request = new Request("http://example.com/api/users", {
		method: "POST",
	});
	const result = defaultGetCacheKey(request);
	assertEquals(result, "http://example.com/api/users");
});

Deno.test("parseCacheVaryHeader - single header", () => {
	const result = parseCacheVaryHeader("header=Accept");
	assertEquals(result, { headers: ["Accept"], cookies: [], query: [] });
});

Deno.test("parseCacheVaryHeader - multiple headers", () => {
	const result = parseCacheVaryHeader(
		"header=Accept,header=User-Agent,header=Accept-Encoding",
	);
	assertEquals(result, {
		headers: ["Accept", "User-Agent", "Accept-Encoding"],
		cookies: [],
		query: [],
	});
});

Deno.test("parseCacheVaryHeader - asterisk filtered out", () => {
	const result = parseCacheVaryHeader(
		"header=Accept,header=*,header=User-Agent",
	);
	assertEquals(result, {
		headers: ["Accept", "*", "User-Agent"],
		cookies: [],
		query: [],
	});
});

Deno.test("removeHeaders - removes specified headers", () => {
	const headers = new Headers({
		"cache-control": "max-age=3600",
		"cdn-cache-control": "max-age=7200",
		"cache-tag": "user:123",
		"content-type": "application/json",
	});
	const response = new Response("test", { headers });

	const result = removeHeaders(response, ["cdn-cache-control", "cache-tag"]);

	assertEquals(result.headers.has("cache-control"), true);
	assertEquals(result.headers.has("content-type"), true);
	assertEquals(result.headers.has("cdn-cache-control"), false);
	assertEquals(result.headers.has("cache-tag"), false);
});

Deno.test("removeHeaders - no headers to remove", () => {
	const headers = new Headers({
		"content-type": "application/json",
	});
	const response = new Response("test", { headers });

	const result = removeHeaders(response, []);
	assertEquals(result, response); // Should return same response
});

Deno.test("isCacheValid - valid cache with expires header", () => {
	const futureDate = new Date(Date.now() + 3600000); // 1 hour from now
	assertEquals(isCacheValid(futureDate.toUTCString()), true);
});

Deno.test("isCacheValid - expired cache with expires header", () => {
	const pastDate = new Date(Date.now() - 3600000); // 1 hour ago
	assertEquals(isCacheValid(pastDate.toUTCString()), false);
});

Deno.test("isCacheValid - no expires header", () => {
	assertEquals(isCacheValid(null), true);
});
