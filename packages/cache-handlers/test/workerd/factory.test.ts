import { beforeEach, describe, expect, test } from "vitest";
import { createCacheHandler } from "../../src/index.js";

describe("Unified Cache Handler - Workerd Environment", () => {
	beforeEach(async () => {
		// Note: caches.delete() is not implemented in workerd test environment
		// Tests will use unique cache names to avoid conflicts
	});

	test("handles cache miss then populates and hits cache", async () => {
		const cacheName = `test-${Date.now()}`;
		const handle = createCacheHandler({ cacheName });
		const url = `https://example.com/api/workerd-integration-${Date.now()}`;
		let invoked = 0;
		const miss = await handle(new Request(url) as any, {
			handler: () => {
				invoked++;
				return Promise.resolve(
					new Response("workerd integration test data", {
						headers: {
							"cache-control": "max-age=3600, public",
							"content-type": "application/json",
							"cache-tag": "integration:workerd",
							server: "workerd/1.0",
						},
					}),
				);
			},
		});
		expect(invoked).toBe(1);
		expect(await miss.clone().text()).toBe("workerd integration test data");
		const hit = await handle(new Request(url) as any, {
			handler: () => {
				invoked++;
				return Promise.resolve(new Response("should not run"));
			},
		});
		expect(invoked).toBe(1);
		expect(await hit.text()).toBe("workerd integration test data");
	});

	test("workerd environment provides standard Web APIs", async () => {
		// Test that workerd provides the expected global APIs
		expect(typeof caches).toBe("object");
		expect(typeof caches.open).toBe("function");
		expect(typeof caches.delete).toBe("function");
		expect(typeof Request).toBe("function");
		expect(typeof Response).toBe("function");
		expect(typeof Headers).toBe("function");

		// Test URL and URLSearchParams (common in Workers)
		expect(typeof URL).toBe("function");
		expect(typeof URLSearchParams).toBe("function");

		// Test basic workerd functionality
		const url = new URL("https://example.com/test?param=value");
		expect(url.hostname).toBe("example.com");
		expect(url.searchParams.get("param")).toBe("value");
	});

	test("works with Cloudflare-style request", async () => {
		const cacheName = `cf-${Date.now()}`;
		const handle = createCacheHandler({ cacheName });
		const request = new Request(
			`https://worker.example.com/api/data-${Date.now()}`,
			{
				method: "GET",
				headers: {
					"user-agent": "Mozilla/5.0",
					"cf-ray": "test-ray-123",
					"cf-ipcountry": "US",
				},
			},
		);
		const response = await handle(request as any, {
			handler: () =>
				Promise.resolve(
					new Response(
						JSON.stringify({
							message: "Hello from origin",
							timestamp: Date.now(),
							country: "US",
						}),
						{
							headers: {
								"content-type": "application/json",
								"cache-control": "public, max-age=300",
								"cache-tag": "api:data",
								"x-origin": "cloudflare-worker",
							},
						},
					),
				),
		});
		expect(response.headers.get("content-type")).toBe("application/json");
		expect(response.headers.get("x-origin")).toBe("cloudflare-worker");
		const cache = await caches.open(cacheName);
		const cached = await cache.match(request);
		expect(cached).toBeTruthy();
	});
});
