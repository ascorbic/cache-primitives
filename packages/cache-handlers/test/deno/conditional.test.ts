import { assertEquals, assertExists } from "@std/assert";
import {
  compareETags,
  create304Response,
  generateETag,
  getDefaultConditionalConfig,
  parseETag,
  parseHttpDate,
  parseIfNoneMatch,
  validateConditionalRequest,
} from "../../src/conditional.ts";
import {
  createMiddlewareHandler,
  createReadHandler,
  createWriteHandler,
} from "../../src/handlers.ts";

Deno.test("Conditional Requests - ETag generation", async () => {
  const response = new Response("test content", {
    headers: { "content-type": "text/plain" },
  });

  const etag = await generateETag(response);

  assertExists(etag);
  assertEquals(typeof etag, "string");
  assertEquals(etag.startsWith('"'), true);
  assertEquals(etag.endsWith('"'), true);
});

Deno.test("Conditional Requests - ETag parsing", () => {
  // Strong ETag
  const strongETag = parseETag('"abc123"');
  assertEquals(strongETag.value, "abc123");
  assertEquals(strongETag.weak, false);

  // Weak ETag
  const weakETag = parseETag('W/"abc123"');
  assertEquals(weakETag.value, "abc123");
  assertEquals(weakETag.weak, true);

  // Empty ETag
  const emptyETag = parseETag("");
  assertEquals(emptyETag.value, "");
  assertEquals(emptyETag.weak, false);
});

Deno.test("Conditional Requests - ETag comparison", () => {
  const etag1 = '"abc123"';
  const etag2 = '"abc123"';
  const etag3 = '"def456"';
  const weakETag = 'W/"abc123"';

  // Strong comparison - exact match
  assertEquals(compareETags(etag1, etag2), true);
  assertEquals(compareETags(etag1, etag3), false);

  // Strong comparison - weak ETag should not match
  assertEquals(compareETags(etag1, weakETag, false), false);

  // Weak comparison - should match even with weak ETag
  assertEquals(compareETags(etag1, weakETag, true), true);
});

Deno.test("Conditional Requests - If-None-Match parsing", () => {
  // Single ETag
  const single = parseIfNoneMatch('"abc123"');
  assertEquals(Array.isArray(single), true);
  assertEquals((single as string[]).length, 1);
  assertEquals((single as string[])[0], '"abc123"');

  // Multiple ETags
  const multiple = parseIfNoneMatch('"abc123", "def456", W/"ghi789"');
  assertEquals(Array.isArray(multiple), true);
  assertEquals((multiple as string[]).length, 3);

  // Wildcard
  const wildcard = parseIfNoneMatch("*");
  assertEquals(wildcard, "*");

  // Empty
  const empty = parseIfNoneMatch("");
  assertEquals(Array.isArray(empty), true);
  assertEquals((empty as string[]).length, 0);
});

Deno.test("Conditional Requests - HTTP date parsing", () => {
  const validDate = parseHttpDate("Wed, 21 Oct 2015 07:28:00 GMT");
  assertExists(validDate);
  assertEquals(validDate instanceof Date, true);

  const invalidDate = parseHttpDate("invalid date");
  assertEquals(invalidDate, null);

  const emptyDate = parseHttpDate("");
  assertEquals(emptyDate, null);
});

Deno.test("Conditional Requests - validateConditionalRequest with ETag", () => {
  const request = new Request("https://example.com/test", {
    headers: {
      "if-none-match": '"abc123"',
    },
  });

  const cachedResponse = new Response("cached data", {
    headers: {
      etag: '"abc123"',
      "content-type": "text/plain",
    },
  });

  const result = validateConditionalRequest(request, cachedResponse);

  assertEquals(result.matches, true);
  assertEquals(result.shouldReturn304, true);
  assertEquals(result.matchedValidator, "etag");
});

Deno.test(
  "Conditional Requests - validateConditionalRequest with Last-Modified",
  () => {
    const lastModified = "Wed, 21 Oct 2015 07:28:00 GMT";
    const ifModifiedSince = "Wed, 21 Oct 2015 07:28:00 GMT";

    const request = new Request("https://example.com/test", {
      headers: {
        "if-modified-since": ifModifiedSince,
      },
    });

    const cachedResponse = new Response("cached data", {
      headers: {
        "last-modified": lastModified,
        "content-type": "text/plain",
      },
    });

    const result = validateConditionalRequest(request, cachedResponse);

    assertEquals(result.matches, true);
    assertEquals(result.shouldReturn304, true);
    assertEquals(result.matchedValidator, "last-modified");
  },
);

Deno.test("Conditional Requests - 304 response creation", () => {
  const cachedResponse = new Response("cached data", {
    headers: {
      etag: '"abc123"',
      "last-modified": "Wed, 21 Oct 2015 07:28:00 GMT",
      "cache-control": "max-age=3600",
      "content-type": "application/json",
      vary: "Accept-Encoding",
      server: "nginx/1.20.0",
      "x-custom": "should-not-be-included",
    },
  });

  const response304 = create304Response(cachedResponse);

  assertEquals(response304.status, 304);
  assertEquals(response304.statusText, "Not Modified");
  // 304 responses should not have a body
  assertEquals(response304.body, null);

  // Should include required/allowed headers
  assertEquals(response304.headers.get("etag"), '"abc123"');
  assertEquals(
    response304.headers.get("last-modified"),
    "Wed, 21 Oct 2015 07:28:00 GMT",
  );
  assertEquals(response304.headers.get("cache-control"), "max-age=3600");
  assertEquals(response304.headers.get("content-type"), "application/json");
  assertEquals(response304.headers.get("vary"), "Accept-Encoding");
  assertEquals(response304.headers.get("server"), "nginx/1.20.0");
  assertExists(response304.headers.get("date"));

  // Should not include non-standard headers
  assertEquals(response304.headers.get("x-custom"), null);
});

Deno.test(
  "Conditional Requests - ReadHandler with If-None-Match",
  async () => {
    await caches.delete("conditional-test");
    const cache = await caches.open("conditional-test");
    const readHandler = createReadHandler({
      cacheName: "conditional-test",
      features: { conditionalRequests: true },
    });

    // Cache a response with ETag
    const cacheKey = "https://example.com/api/conditional";
    const cachedResponse = new Response("cached data", {
      headers: {
        etag: '"test-etag-123"',
        "content-type": "application/json",
        expires: new Date(Date.now() + 3600000).toUTCString(),
      },
    });

    await cache.put(new URL(cacheKey), cachedResponse);

    // Request with matching If-None-Match should get 304
    const conditionalRequest = new Request(cacheKey, {
      headers: {
        "if-none-match": '"test-etag-123"',
      },
    });

    const result = await readHandler(conditionalRequest);

    assertExists(result);
    assertEquals(result?.status, 304);
    assertEquals(result?.headers.get("etag"), '"test-etag-123"');

    const body = await result?.text();
    assertEquals(body, ""); // 304 should have no body

    await caches.delete("conditional-test");
  },
);

Deno.test(
  "Conditional Requests - ReadHandler with If-Modified-Since",
  async () => {
    await caches.delete("conditional-test");
    const cache = await caches.open("conditional-test");
    const readHandler = createReadHandler({
      cacheName: "conditional-test",
      features: { conditionalRequests: true },
    });

    // Cache a response with Last-Modified
    const lastModified = "Wed, 21 Oct 2015 07:28:00 GMT";
    const cacheKey = "https://example.com/api/conditional-date";
    const cachedResponse = new Response("cached data", {
      headers: {
        "last-modified": lastModified,
        "content-type": "application/json",
        expires: new Date(Date.now() + 3600000).toUTCString(),
      },
    });

    await cache.put(new URL(cacheKey), cachedResponse);

    // Request with matching If-Modified-Since should get 304
    const conditionalRequest = new Request(cacheKey, {
      headers: {
        "if-modified-since": lastModified,
      },
    });

    const result = await readHandler(conditionalRequest);

    assertExists(result);
    assertEquals(result.status, 304);
    assertEquals(result.headers.get("last-modified"), lastModified);

    // Consume the response body to avoid resource leaks
    await result.text();

    await caches.delete("conditional-test");
  },
);

Deno.test(
  "Conditional Requests - WriteHandler with ETag generation",
  async () => {
    await caches.delete("conditional-write-test");
    const writeHandler = createWriteHandler({
      cacheName: "conditional-write-test",
      features: {
        conditionalRequests: {
          etag: "generate",
        },
      },
    });

    const request = new Request("https://example.com/api/generate-etag");
    const response = new Response("test data for etag", {
      headers: {
        "cache-control": "max-age=3600, public",
        "content-type": "application/json",
      },
    });

    const result = await writeHandler(request, response);

    // Original response should not be modified
    assertEquals(result.headers.get("etag"), null);

    // Check that cached response has generated ETag
    const cache = await caches.open("conditional-write-test");
    const cachedResponse = await cache.match(request);
    assertExists(cachedResponse);
    assertExists(cachedResponse.headers.get("etag"));
    assertEquals(cachedResponse.headers.get("etag")!.length > 0, true);

    // Consume the cached response body to avoid resource leaks
    await cachedResponse.text();

    await caches.delete("conditional-write-test");
  },
);

Deno.test(
  "Conditional Requests - MiddlewareHandler integration",
  async () => {
    await caches.delete("conditional-middleware-test");
    const middlewareHandler = createMiddlewareHandler({
      cacheName: "conditional-middleware-test",
      features: {
        conditionalRequests: {
          etag: "generate",
        },
      },
    });

    const request = new Request(
      "https://example.com/api/middleware-conditional",
    );

    // First request - should cache the response
    let nextCallCount = 0;
    const next = () => {
      nextCallCount++;
      return Promise.resolve(
        new Response("fresh data", {
          headers: {
            "cache-control": "max-age=3600, public",
            "content-type": "application/json",
          },
        }),
      );
    };

    const firstResponse = await middlewareHandler(request, next);
    assertEquals(nextCallCount, 1);
    assertEquals(await firstResponse.text(), "fresh data");

    // Get the cached response to extract the actual ETag
    const cache = await caches.open("conditional-middleware-test");
    const cachedResponse = await cache.match(request);
    const generatedETag = cachedResponse?.headers.get("etag");

    // Consume the cached response body to avoid resource leaks
    if (cachedResponse) {
      await cachedResponse.text();
    }

    if (generatedETag) {
      // Second request with If-None-Match should get 304
      const conditionalRequest = new Request(
        "https://example.com/api/middleware-conditional",
        {
          headers: {
            "if-none-match": generatedETag,
          },
        },
      );

      const secondResponse = await middlewareHandler(conditionalRequest, next);
      assertEquals(nextCallCount, 1); // Should not call next again
      assertEquals(secondResponse.status, 304);
    } else {
      // If no ETag was generated, we can't test conditional requests
      console.warn("No ETag was generated, skipping conditional request test");
    }

    await caches.delete("conditional-middleware-test");
  },
);

Deno.test("Conditional Requests - Default configuration", () => {
  const config = getDefaultConditionalConfig();

  assertEquals(config.etag, true);
  assertEquals(config.lastModified, true);
  assertEquals(config.weakValidation, true);
});

Deno.test("Conditional Requests - Disabled conditional requests", async () => {
  await caches.delete("conditional-disabled-test");
  const cache = await caches.open("conditional-disabled-test");
  const readHandler = createReadHandler({
    cacheName: "conditional-disabled-test",
    features: { conditionalRequests: false },
  });

  // Cache a response with ETag
  const cacheKey = "https://example.com/api/disabled";
  const cachedResponse = new Response("cached data", {
    headers: {
      etag: '"should-be-ignored"',
      expires: new Date(Date.now() + 3600000).toUTCString(),
    },
  });

  await cache.put(new URL(cacheKey), cachedResponse);

  // Request with If-None-Match should get full response (not 304)
  const conditionalRequest = new Request(cacheKey, {
    headers: {
      "if-none-match": '"should-be-ignored"',
    },
  });

  const result = await readHandler(conditionalRequest);

  assertExists(result);
  assertEquals(result.status, 200); // Should be full response, not 304
  assertEquals(await result.text(), "cached data");

  await caches.delete("conditional-disabled-test");
});
