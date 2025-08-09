import { assertEquals, assertExists } from "@std/assert";
import { createCacheHandler } from "../../src/handlers.ts";

// Unified handler tests replacing legacy read/write/middleware handlers

Deno.test("cache miss invokes handler and caches response", async () => {
  await caches.delete("test-miss");
  const cacheName = "test-miss";
  const handle = createCacheHandler({ cacheName });
  let invoked = 0;
  const url = "http://example.com/api/users";
  const res = await handle(new Request(url), {
    handler: () => {
      invoked++;
      return Promise.resolve(
        new Response("fresh", {
          headers: {
            "cache-control": "max-age=3600, public",
            "cache-tag": "user:123",
            "content-type": "application/json",
          },
        }),
      );
    },
  });
  assertEquals(invoked, 1);
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
  let invoked = 0;
  const url = "http://example.com/api/users";
  await handle(new Request(url), {
    handler: () => {
      invoked++;
      return Promise.resolve(
        new Response("value", {
          headers: { "cache-control": "max-age=3600, public" },
        }),
      );
    },
  });
  const second = await handle(new Request(url), {
    handler: () => {
      invoked++;
      return Promise.resolve(new Response("should-not"));
    },
  });
  assertEquals(invoked, 1);
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
  let invoked = 0;
  const res = await handle(new Request(url), {
    handler: () => {
      invoked++;
      return Promise.resolve(
        new Response("new", {
          headers: { "cache-control": "max-age=60, public" },
        }),
      );
    },
  });
  assertEquals(invoked, 1);
  assertEquals(await res.text(), "new");
  await caches.delete(cacheName);
});

Deno.test("non-cacheable response is not stored", async () => {
  await caches.delete("test-non-cacheable");
  const cacheName = "test-non-cacheable";
  const handle = createCacheHandler({ cacheName });
  let invoked = 0;
  const url = "http://example.com/api/users";
  await handle(new Request(url), {
    handler: () => {
      invoked++;
      return Promise.resolve(
        new Response("nc", {
          headers: { "cache-control": "no-cache, private" },
        }),
      );
    },
  });
  const cache = await caches.open(cacheName);
  const cached = await cache.match(url);
  assertEquals(cached, undefined);
  assertEquals(invoked, 1);
  await caches.delete(cacheName);
});

Deno.test("second call after cacheable response strips cache-tag header from returned response", async () => {
  await caches.delete("test-strip");
  const cacheName = "test-strip";
  const handle = createCacheHandler({ cacheName });
  const url = "http://example.com/api/users";
  const first = await handle(new Request(url), {
    handler: () =>
      Promise.resolve(
        new Response("body", {
          headers: {
            "cache-control": "max-age=3600, public",
            "cache-tag": "user:1",
          },
        }),
      ),
  });
  // Returned response should not expose cache-tag header (implementation strips during write)
  assertEquals(first.headers.has("cache-tag"), false);
  const second = await handle(new Request(url), {
    handler: () => Promise.resolve(new Response("should-not")),
  });
  assertEquals(await second.text(), "body");
  await caches.delete(cacheName);
});

Deno.test("cached response served instead of invoking handler (middleware analogue)", async () => {
  await caches.delete("test-middleware-analogue");
  const cacheName = "test-middleware-analogue";
  const handle = createCacheHandler({ cacheName });
  const url = "http://example.com/api/users";
  let invoked = 0;
  await handle(new Request(url), {
    handler: () => {
      invoked++;
      return Promise.resolve(
        new Response("prime", {
          headers: { "cache-control": "max-age=120, public" },
        }),
      );
    },
  });
  const hit = await handle(new Request(url), {
    handler: () => {
      invoked++;
      return Promise.resolve(new Response("miss"));
    },
  });
  assertEquals(invoked, 1);
  assertEquals(await hit.text(), "prime");
  await caches.delete(cacheName);
});
