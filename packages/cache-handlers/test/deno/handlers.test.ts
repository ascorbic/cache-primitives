import { assertEquals, assertExists } from "jsr:@std/assert";
import { createCacheHandler } from "../../src/handlers.ts";
import { assertSpyCalls, spy } from "jsr:@std/testing/mock";

// Unified handler tests replacing legacy read/write/middleware handlers

Deno.test("cache miss invokes handler and caches response", async () => {
	await caches.delete("test-miss");
	const cacheName = "test-miss";
	const handle = createCacheHandler({ cacheName });
	const url = "http://example.com/api/users";
	const handler = spy(() =>
		Promise.resolve(
			new Response("fresh", {
				headers: {
					"cache-control": "max-age=3600, public",
					"cache-tag": "user:123",
					"content-type": "application/json",
				},
			}),
		)
	);
	const res = await handle(new Request(url), { handler });
	assertSpyCalls(handler, 1);
	assertEquals(await res.clone().text(), "fresh");
	const cache = await caches.open(cacheName);
	const cached = await cache.match(url);
	assertExists(cached);
	await cached?.text();
	await caches.delete(cacheName);
});

Deno.test("cache hit returns cached without invoking handler", async () => {
	await caches.delete("test-hit");
	const cacheName = "test-hit";
	const handle = createCacheHandler({ cacheName });
	const url = "http://example.com/api/users";
	const prime = spy(() =>
		Promise.resolve(
			new Response("value", {
				headers: { "cache-control": "max-age=3600, public" },
			}),
		)
	);
	await handle(new Request(url), { handler: prime });
	const missHandler = spy(() => Promise.resolve(new Response("should-not")));
	const second = await handle(new Request(url), { handler: missHandler });
	assertSpyCalls(prime, 1);
	assertSpyCalls(missHandler, 0);
	assertEquals(await second.text(), "value");
	await caches.delete(cacheName);
});

Deno.test("expired cached entry is ignored and handler re-invoked", async () => {
	await caches.delete("test-expired");
	const cacheName = "test-expired";
	const cache = await caches.open(cacheName);
	const url = "http://example.com/api/users";
	// Put expired response
	await cache.put(
		new URL(url),
		new Response("old", {
			headers: { expires: new Date(Date.now() - 1000).toUTCString() },
		}),
	);
	const handle = createCacheHandler({ cacheName });
	const handler = spy(() =>
		Promise.resolve(
			new Response("new", {
				headers: { "cache-control": "max-age=60, public" },
			}),
		)
	);
	const res = await handle(new Request(url), { handler });
	assertSpyCalls(handler, 1);
	assertEquals(await res.text(), "new");
	await caches.delete(cacheName);
});

Deno.test("non-cacheable response is not stored", async () => {
	await caches.delete("test-non-cacheable");
	const cacheName = "test-non-cacheable";
	const handle = createCacheHandler({ cacheName });
	const url = "http://example.com/api/users";
	const handler = spy(() =>
		Promise.resolve(
			new Response("nc", { headers: { "cache-control": "no-cache, private" } }),
		)
	);
	await handle(new Request(url), { handler });
	const cache = await caches.open(cacheName);
	const cached = await cache.match(url);
	assertEquals(cached, undefined);
	assertSpyCalls(handler, 1);
	await caches.delete(cacheName);
});

Deno.test("second call after cacheable response strips cache-tag header from returned response", async () => {
	await caches.delete("test-strip");
	const cacheName = "test-strip";
	const handle = createCacheHandler({ cacheName });
	const url = "http://example.com/api/users";
	const prime = spy(() =>
		Promise.resolve(
			new Response("body", {
				headers: {
					"cache-control": "max-age=3600, public",
					"cache-tag": "user:1",
				},
			}),
		)
	);
	const first = await handle(new Request(url), { handler: prime });
	assertSpyCalls(prime, 1);
	// Returned response should not expose cache-tag header (implementation strips during write)
	assertEquals(first.headers.has("cache-tag"), false);
	const miss = spy(() => Promise.resolve(new Response("should-not")));
	const second = await handle(new Request(url), { handler: miss });
	assertSpyCalls(miss, 0);
	assertEquals(await second.text(), "body");
	await caches.delete(cacheName);
});

Deno.test("cached response served instead of invoking handler (middleware analogue)", async () => {
	await caches.delete("test-middleware-analogue");
	const cacheName = "test-middleware-analogue";
	const handle = createCacheHandler({ cacheName });
	const url = "http://example.com/api/users";
	const prime = spy(() =>
		Promise.resolve(
			new Response("prime", {
				headers: { "cache-control": "max-age=120, public" },
			}),
		)
	);
	await handle(new Request(url), { handler: prime });
	const miss = spy(() => Promise.resolve(new Response("miss")));
	const hit = await handle(new Request(url), { handler: miss });
	assertSpyCalls(prime, 1);
	assertSpyCalls(miss, 0);
	assertEquals(await hit.text(), "prime");
	await caches.delete(cacheName);
});
