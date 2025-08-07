import { beforeEach, describe, expect, test } from "vitest";
import { caches, Request, Response } from "undici";
import {
  createMiddlewareHandler,
  createReadHandler,
  createWriteHandler,
} from "../../src/handlers.js";

describe("Cache Handlers - Node.js with undici", () => {
  beforeEach(async () => {
    // Clean up test cache before each test
    await caches.delete("test");
  });

  describe("ReadHandler", () => {
    test("returns null for cache miss", async () => {
      const readHandler = createReadHandler({ cacheName: "test" });
      const request = new Request("http://example.com/api/users");

      const result = await readHandler(request);

      expect(result).toBe(null);
    });

    test("returns cached response", async () => {
      const cache = await caches.open("test");
      const readHandler = createReadHandler({ cacheName: "test" });

      // Put a response in cache with standard headers
      const cacheKey = "http://example.com/api/users";
      const expiresAt = new Date(Date.now() + 3600000); // 1 hour from now
      const cachedResponse = new Response("cached data", {
        headers: {
          "content-type": "application/json",
          "cache-tag": "user",
          expires: expiresAt.toUTCString(),
        },
      });

      await cache.put(new URL(cacheKey), cachedResponse);

      const request = new Request("http://example.com/api/users");
      const result = await readHandler(request);

      expect(result).toBeTruthy();
      expect(await result!.text()).toBe("cached data");
      expect(result!.headers.get("content-type")).toBe("application/json");
      expect(result!.headers.get("cache-tag")).toBe("user");
    });

    test("removes expired cache", async () => {
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

      await cache.put(new URL(cacheKey), expiredResponse.clone());

      const request = new Request("http://example.com/api/users");
      const result = await readHandler(request);

      expect(result).toBe(null);

      // Should also remove from cache
      const stillCached = await cache.match(new URL(cacheKey));
      expect(stillCached).toBeUndefined();
    });
  });

  describe("WriteHandler", () => {
    test("caches cacheable response", async () => {
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
      expect(result.headers.has("cache-tag")).toBe(false);
      expect(result.headers.get("cache-control")).toBe("max-age=3600, public");
      expect(result.headers.get("content-type")).toBe("application/json");

      // Should be cached
      const cache = await caches.open("test");
      const cacheKey = "http://example.com/api/users";
      const cached = await cache.match(new URL(cacheKey));
      expect(cached).toBeTruthy();
      expect(await cached!.text()).toBe("test data");

      // Should have standard headers
      expect(cached!.headers.get("cache-tag")).toBe("user:123");
      expect(cached!.headers.get("expires")).toBeTruthy();
    });

    test("does not cache non-cacheable response", async () => {
      const writeHandler = createWriteHandler({ cacheName: "test" });

      const request = new Request("http://example.com/api/users");
      const response = new Response("test data", {
        headers: {
          "cache-control": "no-cache, private",
          "content-type": "application/json",
        },
      });

      const result = await writeHandler(request, response);

      expect(result.headers.get("cache-control")).toBe("no-cache, private");
      expect(result.headers.get("content-type")).toBe("application/json");

      // Should not be cached
      const cache = await caches.open("test");
      const cacheKey = "http://example.com/api/users";
      const cached = await cache.match(new URL(cacheKey));
      expect(cached).toBeUndefined();
    });
  });

  describe("MiddlewareHandler", () => {
    test("returns cached response when available", async () => {
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

      await cache.put(new URL(cacheKey), cachedResponse);

      const request = new Request("http://example.com/api/users");
      let nextCalled = false;
      const next = () => {
        nextCalled = true;
        return Promise.resolve(new Response("fresh data"));
      };

      const result = await middlewareHandler(request, next);

      expect(nextCalled).toBe(false); // Should not call next()
      expect(await result.text()).toBe("cached data");
    });

    test("calls next() and caches response", async () => {
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

      expect(nextCalled).toBe(true);
      expect(await result.text()).toBe("fresh data");
      expect(result.headers.has("cache-tag")).toBe(false); // Should be removed

      // Should be cached for next time
      const cache = await caches.open("test");
      const cacheKey = "http://example.com/api/users";
      const cached = await cache.match(new URL(cacheKey));
      expect(cached).toBeTruthy();

      expect(cached!.headers.get("cache-tag")).toBe("user:123");
      expect(cached!.headers.get("expires")).toBeTruthy();
    });
  });
});
