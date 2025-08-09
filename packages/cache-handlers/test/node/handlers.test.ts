import { beforeEach, describe, expect, test } from "vitest";
import { caches, Request, Response } from "undici";
import { createCacheHandler } from "../../src/handlers.js";

describe("Cache Handler - Node.js with undici", () => {
	beforeEach(async () => {
		// Clean up test cache before each test
		await caches.delete("test");
	});

	test("cache miss invokes handler and caches response", async () => {
		const handle = createCacheHandler({ cacheName: "test" });
		const request = new Request("http://example.com/api/users");
		let invoked = false;
		const response = await handle(request as any, {
			handler: (async (_req: any) => {
				invoked = true;
				return new Response("fresh data", {
					headers: {
						"cache-control": "max-age=3600, stale-while-revalidate=60, public",
						"cache-tag": "user:123",
						"content-type": "application/json",
					},
				});
			}) as any,
		});
		expect(invoked).toBe(true);
		expect(await response.text()).toBe("fresh data");
		// Headers cleaned
		expect(response.headers.has("cache-tag")).toBe(false);
		// Verify cached
		const cache = await caches.open("test");
		const cached = await cache.match("http://example.com/api/users");
		expect(cached).toBeTruthy();
		expect(cached!.headers.get("cache-tag")).toBe("user:123");
	});

	test("cache hit returns cached response without calling handler", async () => {
		const handle = createCacheHandler({ cacheName: "test" });
		const cache = await caches.open("test");
		const expiresAt = new Date(Date.now() + 1000 * 60);
		await cache.put(
			new URL("http://example.com/api/users"),
			new Response("cached data", {
				headers: { expires: expiresAt.toUTCString(), "cache-tag": "user" },
			}),
		);
		let invoked = false;
		const resp = await handle(
			new Request("http://example.com/api/users") as any,
			{
				handler: (async (_req: any) => {
					invoked = true;
					return new Response("should not run");
				}) as any,
			},
		);
		expect(invoked).toBe(false);
		expect(await resp.text()).toBe("cached data");
	});

	test("expired within SWR window serves stale and triggers background revalidation", async () => {
		let backgroundTriggered = false;
		const handle = createCacheHandler({
			cacheName: "test",
			runInBackground: () => {
				backgroundTriggered = true;
			},
		});
		const cache = await caches.open("test");
		const now = Date.now();
		const expired = new Date(now - 1000); // already expired
		await cache.put(
			new URL("http://example.com/api/users"),
			new Response("stale data", {
				headers: {
					expires: expired.toUTCString(),
					"cache-control": "max-age=1, stale-while-revalidate=60, public",
				},
			}),
		);
		let invoked = 0;
		const resp = await handle(
			new Request("http://example.com/api/users") as any,
			{
				handler: (async (_req: any) => {
					invoked++;
					return new Response("revalidated", {
						headers: {
							"cache-control": "max-age=30, stale-while-revalidate=60, public",
						},
					});
				}) as any,
			},
		);
		expect(await resp.text()).toBe("stale data");
		expect(backgroundTriggered).toBe(true);
	});
});
