import { assertEquals, assertExists } from "@std/assert";
import {
	createMiddlewareHandler,
	createReadHandler,
	createWriteHandler,
} from "../../src/handlers.ts";

Deno.test("ReadHandler - returns null for cache miss", async () => {
	await caches.delete("test"); // Clean up any existing cache
	const readHandler = createReadHandler({ cacheName: "test" });

	const request = new Request("http://example.com/api/users");
	const result = await readHandler(request);

	assertEquals(result, null);
	await caches.delete("test");
});

Deno.test("ReadHandler - returns cached response", async () => {
	await caches.delete("test"); // Clean up any existing cache
	const cache = await caches.open("test");
	const readHandler = createReadHandler({ cacheName: "test" });

	// Manually put a response in cache with standard headers
	const cacheKey = "http://example.com/api/users";
	const expiresAt = new Date(Date.now() + 3600000); // 1 hour from now
	const cachedResponse = new Response("cached data", {
		headers: {
			"content-type": "application/json",
			"cache-tag": "user",
			expires: expiresAt.toUTCString(),
		},
	});

	await cache.put(new Request(cacheKey), cachedResponse);

	const request = new Request("http://example.com/api/users");
	const result = await readHandler(request);

	assertExists(result);
	assertEquals(await result.text(), "cached data");
	assertEquals(result.headers.get("content-type"), "application/json");
	assertEquals(result.headers.get("cache-tag"), "user");
	await caches.delete("test");
});

Deno.test(
	"ReadHandler - removes expired cache",
	{ sanitizeResources: false },
	async () => {
		await caches.delete("test"); // Clean up any existing cache
		const cache = await caches.open("test");
		const readHandler = createReadHandler({ cacheName: "test" });

		// Put an expired response in cache
		const cacheKey = "http://example.com/api/users";
		const expiredAt = new Date(Date.now() - 3600000); // 1 hour ago
		const expiredResponse = new Response("expired data", {
			headers: {
				expires: expiredAt.toUTCString(),
			},
		});

		// Clone the response so we can consume both copies
		const expiredResponseCopy = expiredResponse.clone();
		await cache.put(new Request(cacheKey), expiredResponse);
		// Consume the original to prevent resource leak
		await expiredResponseCopy.text();

		const request = new Request("http://example.com/api/users");
		const result = await readHandler(request);

		assertEquals(result, null);

		// If a response was returned, consume it to prevent resource leak
		if (result) {
			await result.text();
		}

		// Should also remove from cache
		const stillCached = await cache.match(new Request(cacheKey));
		// If there was still a cached response, consume it to prevent resource leak
		if (stillCached) {
			await stillCached.text();
		}
		assertEquals(stillCached, undefined);

		await caches.delete("test");
	},
);

Deno.test("WriteHandler - caches cacheable response", async () => {
	await caches.delete("test"); // Clean up any existing cache
	const writeHandler = createWriteHandler({ cacheName: "test" });

	const request = new Request("http://example.com/api/users");
	const response = new Response("test data", {
		headers: {
			"cache-control": "max-age=3600, public",
			"cache-tag": "user:123",
			"content-type": "application/json",
		},
	});

	const result = await writeHandler(request, response);

	// Should remove processed headers
	assertEquals(result.headers.has("cache-tag"), false);
	assertEquals(result.headers.get("cache-control"), "max-age=3600, public");
	assertEquals(result.headers.get("content-type"), "application/json");

	// Should be cached
	const cache = await caches.open("test");
	const cacheKey = "http://example.com/api/users";
	const cached = await cache.match(new Request(cacheKey));
	assertExists(cached);
	assertEquals(await cached.text(), "test data");

	// Should have standard headers
	assertEquals(cached.headers.get("cache-tag"), "user:123");
	assertExists(cached.headers.get("expires"));
	await caches.delete("test");
});

Deno.test("WriteHandler - does not cache non-cacheable response", async () => {
	await caches.delete("test"); // Clean up any existing cache
	const writeHandler = createWriteHandler({ cacheName: "test" });

	const request = new Request("http://example.com/api/users");
	const response = new Response("test data", {
		headers: {
			"cache-control": "no-cache, private",
			"content-type": "application/json",
		},
	});

	const result = await writeHandler(request, response);

	assertEquals(result.headers.get("cache-control"), "no-cache, private");
	assertEquals(result.headers.get("content-type"), "application/json");

	// Should not be cached
	const cache = await caches.open("test");
	const cacheKey = "http://example.com/api/users";
	const cached = await cache.match(new Request(cacheKey));
	assertEquals(cached, undefined);
	await caches.delete("test");
});

Deno.test(
	"MiddlewareHandler - returns cached response when available",
	async () => {
		await caches.delete("test"); // Clean up any existing cache
		const cache = await caches.open("test");
		const middlewareHandler = createMiddlewareHandler({ cacheName: "test" });

		// Put a response in cache
		const cacheKey = "http://example.com/api/users";
		const expiresAt = new Date(Date.now() + 3600000);
		const cachedResponse = new Response("cached data", {
			headers: {
				"content-type": "application/json",
				"cache-tag": "user",
				expires: expiresAt.toUTCString(),
			},
		});

		await cache.put(new Request(cacheKey), cachedResponse);

		const request = new Request("http://example.com/api/users");
		let nextCalled = false;
		const next = () => {
			nextCalled = true;
			return Promise.resolve(new Response("fresh data"));
		};

		const result = await middlewareHandler(request, next);

		assertEquals(nextCalled, false); // Should not call next()
		assertEquals(await result.text(), "cached data");
		await caches.delete("test");
	},
);

Deno.test("MiddlewareHandler - calls next() and caches response", async () => {
	await caches.delete("test"); // Clean up any existing cache
	const middlewareHandler = createMiddlewareHandler({ cacheName: "test" });

	const request = new Request("http://example.com/api/users");
	let nextCalled = false;
	const next = () => {
		nextCalled = true;
		return Promise.resolve(
			new Response("fresh data", {
				headers: {
					"cache-control": "max-age=3600, public",
					"cache-tag": "user:123",
				},
			}),
		);
	};

	const result = await middlewareHandler(request, next);

	assertEquals(nextCalled, true);
	assertEquals(await result.text(), "fresh data");
	assertEquals(result.headers.has("cache-tag"), false); // Should be removed

	// Should be cached for next time
	const cache = await caches.open("test");
	const cacheKey = "http://example.com/api/users";
	const cached = await cache.match(new Request(cacheKey));
	assertExists(cached);

	assertEquals(cached.headers.get("cache-tag"), "user:123");
	assertExists(cached.headers.get("expires"));

	// Clean up response resources
	if (cached) {
		await cached.text();
	}
	await caches.delete("test");
});
