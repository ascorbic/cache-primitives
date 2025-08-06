import { assertEquals, assertExists } from "@std/assert";
import { createCacheHandlers } from "../../src/index.ts";

Deno.test("createCacheHandlers - creates all handlers", async () => {
	const handlers = createCacheHandlers({ cacheName: "test" });

	assertExists(handlers.read);
	assertExists(handlers.write);
	assertExists(handlers.middleware);
	assertEquals(typeof handlers.read, "function");
	assertEquals(typeof handlers.write, "function");
	assertEquals(typeof handlers.middleware, "function");

	await caches.delete("test");
});
