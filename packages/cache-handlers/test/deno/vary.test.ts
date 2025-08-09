import { assertEquals, assertExists } from "@std/assert";
import { defaultGetCacheKey, parseCacheVaryHeader } from "../../src/utils.ts";
import { writeToCache } from "../../src/write.ts";
import { readFromCache } from "../../src/read.ts";

Deno.test("Vary - parseCacheVaryHeader", () => {
  const headerValue =
    "header=Accept-Language,header=X-Forwarded-For, cookie=user-role, query=utm_source";
  const vary = parseCacheVaryHeader(headerValue);

  assertEquals(vary.headers, ["Accept-Language", "X-Forwarded-For"]);
  assertEquals(vary.cookies, ["user-role"]);
  assertEquals(vary.query, ["utm_source"]);
});

Deno.test("Vary - defaultGetCacheKey", () => {
  const request = new Request(
    "http://example.com/api/users?utm_source=google",
    {
      headers: {
        "Accept-Language": "en-US",
        "X-Forwarded-For": "123.123.123.123",
        Cookie: "user-role=admin; other-cookie=value",
      },
    },
  );

  const vary = {
    headers: ["Accept-Language", "X-Forwarded-For"],
    cookies: ["user-role"],
    query: ["utm_source"],
  };

  const cacheKey = defaultGetCacheKey(request, vary);

  const expectedKey =
    "http://example.com/api/users?utm_source=google::h=accept-language:en-US,x-forwarded-for:123.123.123.123::c=user-role:admin";
  assertEquals(cacheKey, expectedKey);
});

Deno.test("Vary - writeToCache/readFromCache integration", async () => {
  await caches.open("test");

  const response = new Response("test data", {
    headers: {
      "cache-control": "max-age=3600, public",
      "cache-vary": "header=Accept-Language, cookie=user-role",
    },
  });

  const request1 = new Request("https://example.com/api/test", {
    headers: {
      "Accept-Language": "en-US",
      Cookie: "user-role=admin",
    },
  });

  const request2 = new Request("https://example.com/api/test", {
    headers: {
      "Accept-Language": "fr-FR",
      Cookie: "user-role=admin",
    },
  });

  const request3 = new Request("https://example.com/api/test", {
    headers: {
      "Accept-Language": "en-US",
      Cookie: "user-role=editor",
    },
  });

  await writeToCache(request1, response, { cacheName: "test" });

  const { cached: cachedResponse1 } = await readFromCache(request1, {
    cacheName: "test",
  });
  assertExists(cachedResponse1);
  await cachedResponse1?.text();

  const { cached: cachedResponse2 } = await readFromCache(request2, {
    cacheName: "test",
  });
  assertEquals(cachedResponse2, null);

  const { cached: cachedResponse3 } = await readFromCache(request3, {
    cacheName: "test",
  });
  assertEquals(cachedResponse3, null);
  await caches.delete("test");
});
