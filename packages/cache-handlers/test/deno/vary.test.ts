import { assertEquals, assertExists } from "@std/assert";
import { createReadHandler, createWriteHandler } from "../../src/handlers.ts";
import { defaultGetCacheKey, parseCacheVaryHeader } from "../../src/utils.ts";

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
		"http://example.com/api/users?utm_source=google|header-accept-language=en-US|header-x-forwarded-for=123.123.123.123|cookie-user-role=admin";
	assertEquals(cacheKey, expectedKey);
});

Deno.test("Vary - read and write handlers", async () => {
	const cache = await caches.open("test");
	const readHandler = createReadHandler({ cacheName: "test" });
	const writeHandler = createWriteHandler({ cacheName: "test" });

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

	await writeHandler(request1, response);

	const cachedResponse1 = await readHandler(request1);
	assertExists(cachedResponse1);
	// Clean up the response to prevent resource leaks
	if (cachedResponse1) {
		await cachedResponse1.text();
	}

	const cachedResponse2 = await readHandler(request2);
	assertEquals(cachedResponse2, null);

	const cachedResponse3 = await readHandler(request3);
	assertEquals(cachedResponse3, null);
	await caches.delete("test");
});
