import { assertEquals } from "@std/assert";
import {
  getCacheStats,
  invalidateAll,
  invalidateByPath,
  invalidateByTag,
} from "../../src/invalidation.ts";
import { writeToCache } from "../../src/write.ts";

async function setupTestCache(): Promise<Cache> {
  await caches.delete("test"); // Clean up any existing cache
  const cache = await caches.open("test");

  // Add some test responses using WriteHandler to create proper metadata
  await writeToCache(
    new Request("https://example.com/api/users"),
    new Response("users data", {
      headers: {
        "cache-control": "max-age=3600, public",
        "cache-tag": "user, api",
      },
    }),
    { cacheName: "test" },
  );

  await writeToCache(
    new Request("https://example.com/api/posts"),
    new Response("posts data", {
      headers: {
        "cache-control": "max-age=3600, public",
        "cache-tag": "post, api",
      },
    }),
    { cacheName: "test" },
  );

  await writeToCache(
    new Request("https://example.com/api/users/123"),
    new Response("user 123 data", {
      headers: {
        "cache-control": "max-age=3600, public",
        "cache-tag": "user:123, user, api",
      },
    }),
    { cacheName: "test" },
  );

  await writeToCache(
    new Request("https://example.com/static/image.jpg"),
    new Response("image data", {
      headers: {
        "cache-control": "max-age=3600, public",
        "cache-tag": "static",
      },
    }),
    { cacheName: "test" },
  );

  return cache;
}

Deno.test("invalidateByTag - removes entries with matching tag", async () => {
  const cache = await setupTestCache();

  const deletedCount = await invalidateByTag("user", { cacheName: "test" });

  assertEquals(deletedCount, 2); // Should delete /api/users and /api/users/123

  // Check that user-tagged entries are gone
  assertEquals(
    await cache.match(new Request("https://example.com/api/users")),
    undefined,
  );
  assertEquals(
    await cache.match(new Request("https://example.com/api/users/123")),
    undefined,
  );

  // Check that other entries remain
  const postsResponse = await cache.match(
    new Request("https://example.com/api/posts"),
  );
  assertEquals(postsResponse !== undefined, true);
  if (postsResponse) await postsResponse.text(); // Clean up resource

  const staticResponse = await cache.match(
    new Request("https://example.com/static/image.jpg"),
  );
  assertEquals(staticResponse !== undefined, true);
  if (staticResponse) await staticResponse.text(); // Clean up resource
  await caches.delete("test");
});

Deno.test("invalidateByTag - returns 0 for non-existent tag", async () => {
  const cache = await setupTestCache();

  const deletedCount = await invalidateByTag("nonexistent", {
    cacheName: "test",
  });

  assertEquals(deletedCount, 0);

  // All entries should still be there - check by trying to match some of them
  const usersResponse = await cache.match(
    new Request("https://example.com/api/users"),
  );
  assertEquals(usersResponse !== undefined, true);
  if (usersResponse) await usersResponse.text(); // Clean up resource
  await caches.delete("test");
});

Deno.test("invalidateByPath - removes entries with matching path", async () => {
  const cache = await setupTestCache();

  const deletedCount = await invalidateByPath("/api/users", {
    cacheName: "test",
  });

  assertEquals(deletedCount, 2); // Should delete /api/users and /api/users/123

  // Check that path-matching entries are gone
  assertEquals(
    await cache.match(new Request("https://example.com/api/users")),
    undefined,
  );
  assertEquals(
    await cache.match(new Request("https://example.com/api/users/123")),
    undefined,
  );

  // Check that other entries remain
  const postsResponse = await cache.match(
    new Request("https://example.com/api/posts"),
  );
  assertEquals(postsResponse !== undefined, true);
  if (postsResponse) await postsResponse.text(); // Clean up resource
  await caches.delete("test");
});

Deno.test("invalidateByPath - exact path match only", async () => {
  const cache = await setupTestCache();

  const deletedCount = await invalidateByPath("/api/posts", {
    cacheName: "test",
  });

  assertEquals(deletedCount, 1); // Should only delete /api/posts

  // Check that only the exact match is gone
  assertEquals(
    await cache.match(new Request("https://example.com/api/posts")),
    undefined,
  );

  // Check that other entries remain
  const usersResponse = await cache.match(
    new Request("https://example.com/api/users"),
  );
  assertEquals(usersResponse !== undefined, true);
  if (usersResponse) await usersResponse.text(); // Clean up resource
  await caches.delete("test");
});

Deno.test("invalidateAll - removes all entries", async () => {
  const cache = await setupTestCache();

  const deletedCount = await invalidateAll({ cacheName: "test" });

  assertEquals(deletedCount, 4);
  // Verify entries are gone
  assertEquals(
    await cache.match(new Request("https://example.com/api/users")),
    undefined,
  );
  await caches.delete("test");
});

Deno.test("getCacheStats - returns correct statistics", async () => {
  const cache = await setupTestCache();

  const stats = await getCacheStats({ cacheName: "test" });

  assertEquals(stats.totalEntries, 4);
  assertEquals(stats.entriesByTag.user, 2);
  assertEquals(stats.entriesByTag.api, 3);
  assertEquals(stats.entriesByTag.post, 1);
  assertEquals(stats.entriesByTag["user:123"], 1);
  assertEquals(stats.entriesByTag.static, 1);
  await caches.delete("test");
});

Deno.test("getCacheStats - empty cache", async () => {
  await caches.delete("test"); // Ensure cache is clean
  const stats = await getCacheStats({ cacheName: "test" });

  assertEquals(stats.totalEntries, 0);
  assertEquals(Object.keys(stats.entriesByTag).length, 0);
  await caches.delete("test");
});
