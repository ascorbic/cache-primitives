import {
	assert,
	assertEquals,
	assertExists,
	assertRejects,
	assertThrows,
} from "@std/assert";
import { readFromCache } from "../../src/read.ts";
import { writeToCache } from "../../src/write.ts";
import { defaultGetCacheKey, isCacheValid } from "../../src/utils.ts";
import {
	getCacheStats,
	invalidateByPath,
	invalidateByTag,
} from "../../src/invalidation.ts";
import { parseCacheControl, parseCacheTags } from "../../src/utils.ts";

import { FailingCache } from "./test_utils.ts";

Deno.test("Error Handling - ReadHandler with cache match failure", async () => {
	const failingCache = new FailingCache("match");
	const request = new Request("https://example.com/api/users");
	await assertRejects(
		() => readFromCache(request, { cache: failingCache }),
		Error,
		"Cache match failed",
	);
	await caches.delete("test");
});

Deno.test("Error Handling - WriteHandler with cache put failure", async () => {
	const failingCache = new FailingCache("put");

	const response = new Response("test data", {
		headers: {
			"cache-control": "max-age=3600, public",
			"cache-tag": "user:123",
		},
	});
	Object.defineProperty(response, "url", {
		value: "https://example.com/api/users",
		writable: false,
	});

	// Should handle cache put failure gracefully
	const request = new Request("https://example.com/api/users");
	await assertRejects(
		() => writeToCache(request, response, { cache: failingCache }),
		Error,
		"Cache put failed",
	);
});

Deno.test(
	"Error Handling - WriteHandler with missing response URL",
	async () => {
		const config = { cacheName: "test" } as const;

		const response = new Response("test data", {
			headers: {
				"cache-control": "max-age=3600, public",
				"cache-tag": "user:123",
			},
		});
		// Don't set URL property, leaving it empty

		const request = new Request("https://example.com/api/users");
		const result = await writeToCache(request, response, config);

		// Should return response with headers removed but not cache it
		assertExists(result);
		assertEquals(result.headers.has("cache-tag"), false);
		assertEquals(await result.text(), "test data");

		// With missing response URL, it should still cache based on request URL
		const cache = await caches.open("test");
		const cached = await cache.match(
			new Request("https://example.com/api/users"),
		);
		assertExists(cached); // Should be cached using request URL
		if (cached) {
			await cached.text(); // Clean up resource
		}
		await caches.delete("test");
	},
);

Deno.test(
	"Error Handling - InvalidateByTag with cache operations failure",
	async () => {
		const failingCache = new FailingCache("match");

		// Should throw when cache.match fails during metadata retrieval
		await assertRejects(
			() => invalidateByTag("user", { cache: failingCache }),
			Error,
			"Cache match failed",
		);
	},
);

Deno.test("Error Handling - InvalidateByTag with delete failure", async () => {
	const cache = await caches.open("test");

	// Add a valid cached response
	await cache.put(
		new Request("http://example.com/api/users"),
		new Response("users data", {
			headers: {
				"cache-tag": "user",
				expires: new Date(Date.now() + 3600000).toUTCString(),
			},
		}),
	);

	// Create a cache that fails on delete
	const failingDeleteCache = new FailingCache("delete");
	// Override keys to return the cached entry
	failingDeleteCache.matchAll = () =>
		Promise.resolve([
			new Response("users data", {
				headers: {
					"cache-tag": "user",
					expires: new Date(Date.now() + 3600000).toUTCString(),
				},
			}),
		] as Response[]);
	failingDeleteCache.match = () =>
		Promise.resolve(
			new Response("users data", {
				headers: {
					"cache-tag": "user",
					expires: new Date(Date.now() + 3600000).toUTCString(),
				},
			}),
		);

	// Should handle delete failures gracefully and return count of successful deletes
	const deletedCount = await invalidateByTag("user", {
		cache: failingDeleteCache,
	});
	assertEquals(deletedCount, 0); // No successful deletes
	await caches.delete("test");
});

Deno.test(
	"Error Handling - GetCacheStats with corrupted metadata",
	async () => {
		await caches.delete("test"); // Clean start
		const cache = await caches.open("test");

		// Put corrupted metadata directly in the metadata store
		await cache.put(
			new Request("https://cache-internal/cache-tag-metadata"),
			new Response('{"valid":["https://example.com/api/valid"],"corru', {
				headers: { "Content-Type": "application/json" },
			}),
		);

		const stats = await getCacheStats({ cacheName: "test" });

		// Should return empty stats when metadata is corrupted
		assertEquals(stats.totalEntries, 0);
		assertEquals(Object.keys(stats.entriesByTag).length, 0);
		await caches.delete("test");
	},
);

Deno.test("Error Handling - ParseCacheControl with malformed input", () => {
	const malformedInputs = [
		"",
		"   ",
		"=",
		"==",
		"max-age=",
		"=3600",
		"max-age=abc",
		"max-age=3600=extra",
		"max-age=3600, =",
		"max-age=3600, ,",
		"max-age=3600,,private",
		"max-age=3600, , , private",
	];

	for (const input of malformedInputs) {
		// Should not throw and handle gracefully
		const result = parseCacheControl(input);
		assertEquals(typeof result, "object");
	}
});

Deno.test("Error Handling - ParseCacheTags with edge cases", () => {
	const edgeCases = [
		"",
		"   ",
		",",
		",,",
		", , ,",
		"tag1,",
		",tag2",
		"tag1,,tag2",
		"  tag1  ,  ,  tag2  ",
	];

	for (const input of edgeCases) {
		// Should not throw and filter empty tags
		const result = parseCacheTags(input);
		assertEquals(Array.isArray(result), true);
		// Should not contain empty strings
		assertEquals(
			result.every((tag) => tag.length > 0),
			true,
		);
	}
});

Deno.test("Error Handling - GenerateCacheKey with invalid URLs", () => {
	// Test with various potentially problematic URLs
	const problematicUrls = [
		"https://example.com/",
		"https://example.com",
		"https://example.com/path?",
		"https://example.com/path?=",
		"https://example.com/path?key=",
		"https://example.com/path?=value",
		"https://example.com/path?key1=value1&",
		"https://example.com/path?&key=value",
	];

	for (const url of problematicUrls) {
		const request = new Request(url);
		// Should not throw
		const cacheKey = defaultGetCacheKey(request);
		assertEquals(typeof cacheKey, "string");
		assert(
			cacheKey.startsWith("https://example.com/"),
			`Expected cache key to start with 'https://example.com/', got ${cacheKey}`,
		);
	}
});

Deno.test("Error Handling - IsCacheValid with edge case expire headers", () => {
	const now = Date.now();

	// Test with various edge case values
	const edgeCases = [
		{ expiresHeader: new Date(0).toUTCString() },
		{ expiresHeader: new Date(now + 3600000).toUTCString() },
		{ expiresHeader: null },
		{ expiresHeader: "invalid-date" },
		{ expiresHeader: "" },
		{ expiresHeader: "Wed, 21 Oct 2015 07:28:00 GMT" },
		{ expiresHeader: "0" },
	];

	for (const { expiresHeader } of edgeCases) {
		// Should not throw and return boolean
		const result = isCacheValid(expiresHeader);
		assertEquals(typeof result, "boolean");
	}
});

Deno.test("Error Handling - Simulated upstream handler throwing", () => {
	const upstream = () => {
		throw new Error("Upstream service failed");
	};
	assertThrows(() => upstream(), Error, "Upstream service failed");
});

Deno.test("Error Handling - Simulated cache read failure before upstream", async () => {
	const failingCache = new FailingCache("match");
	const request = new Request("https://example.com/api/users");
	await assertRejects(
		() => readFromCache(request, { cache: failingCache }),
		Error,
		"Cache match failed",
	);
});

Deno.test(
	"Error Handling - InvalidateByPath with malformed cache keys",
	async () => {
		const config = { cacheName: "test" } as const;
		await caches.delete("test"); // Clean start

		// Create one valid entry with proper metadata
		const response = new Response("data", {
			headers: {
				"cache-control": "max-age=3600, public",
				"cache-tag": "test",
			},
		});
		const request = new Request("https://example.com/valid/path");
		await writeToCache(request, response, config);

		// Put malformed metadata in the metadata store
		const cache = await caches.open("test");
		await cache.put(
			new Request("https://cache-internal/cache-tag-metadata"),
			new Response(
				JSON.stringify({
					test: [
						"https://example.com/valid/path", // Valid URL
						"invalid-malformed-url", // Malformed URL
						"not://valid/protocol", // Invalid protocol
					],
				}),
				{
					headers: { "Content-Type": "application/json" },
				},
			),
		);

		// Should handle malformed keys gracefully and only delete valid ones
		const deletedCount = await invalidateByPath("/valid", {
			cacheName: "test",
		});
		assertEquals(deletedCount, 1); // Only the valid one should match
		await caches.delete("test");
	},
);

Deno.test("Error Handling - Response body reading errors", async () => {
	await caches.open("test");
	const config = { cacheName: "test" } as const;

	// Create a response with a body that will error when read
	const response = new Response(
		new ReadableStream({
			start(controller) {
				controller.error(new Error("Stream error"));
			},
		}),
		{
			headers: {
				"cache-control": "max-age=3600, public",
				"cache-tag": "user:123",
			},
		},
	);
	Object.defineProperty(response, "url", {
		value: "https://example.com/api/users",
		writable: false,
	});

	// Should handle stream errors gracefully by throwing
	const request = new Request("https://example.com/api/users");
	await assertRejects(
		() => writeToCache(request, response, config),
		Error,
		"Stream error",
	);
	await caches.delete("test");
});
