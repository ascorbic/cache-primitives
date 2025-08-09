import { beforeEach, describe, expect, test, vi } from "vitest";
import { caches, Response as UResponse } from "undici";
import { createCacheHandler } from "../../src/handlers.ts";

describe("Cache Handler - Node.js with undici", () => {
	beforeEach(async () => {
		// Clean up test cache before each test
		await caches.delete("test");
	});

	test("cache miss invokes handler and caches response", async () => {
		const handle = createCacheHandler({ cacheName: "test" });
		const request = new Request("http://example.com/api/users");
		const handler = vi.fn((_req: Request) =>
			new Response("fresh data", {
				headers: {
					"cache-control": "max-age=3600, stale-while-revalidate=60, public",
					"cache-tag": "user:123",
					"content-type": "application/json",
				},
			})
		);
		const response = await handle(request, { handler });
		expect(handler).toHaveBeenCalledTimes(1);
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
			new UResponse("cached data", {
				headers: { expires: expiresAt.toUTCString(), "cache-tag": "user" },
			}),
		);
		const handler = vi.fn(() => new Response("should not run"));
		const resp = await handle(new Request("http://example.com/api/users"), {
			handler,
		});
		expect(handler).not.toHaveBeenCalled();
		expect(await resp.text()).toBe("cached data");
	});

	test("expired within SWR window serves stale and triggers background revalidation", async () => {
		const runInBackground = vi.fn();
		const handle = createCacheHandler({
			cacheName: "test",
			runInBackground,
		});
		const cache = await caches.open("test");
		const now = Date.now();
		const expired = new Date(now - 1000); // already expired
		await cache.put(
			new URL("http://example.com/api/users"),
			new UResponse("stale data", {
				headers: {
					expires: expired.toUTCString(),
					"cache-control": "max-age=1, stale-while-revalidate=60, public",
				},
			}),
		);
		const handler = vi.fn((_req: Request) =>
			new Response("revalidated", {
				headers: {
					"cache-control": "max-age=30, stale-while-revalidate=60, public",
				},
			})
		);
		const resp = await handle(new Request("http://example.com/api/users"), {
			handler,
		});
		expect(await resp.text()).toBe("stale data");
		expect(runInBackground).toHaveBeenCalledTimes(1);
	});
});
