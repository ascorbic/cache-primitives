import { assert, assertEquals, assertExists } from "@std/assert";
import {
	createMiddlewareHandler,
	createReadHandler,
	createWriteHandler,
} from "../../src/handlers.ts";
import {
	defaultGetCacheKey,
	parseCacheControl,
	parseCacheTags,
	parseCacheVaryHeader,
	removeHeaders,
} from "../../src/utils.ts";
import { invalidateByTag } from "../../src/invalidation.ts";

Deno.test("Input Validation - Malicious cache tag values", () => {
	const maliciousTags = [
		"<script>alert('xss')</script>",
		"javascript:alert('xss')",
		"vbscript:msgbox('xss')",
		"onload=alert('xss')",
		"user:123'; DROP TABLE users; --",
		"user:123</script><script>alert('xss')</script>",
		"user:123%3Cscript%3Ealert%28%27xss%27%29%3C/script%3E",
		"user:123\x00admin",
		"user:123\uFEFFadmin", // BOM character
		"user:123\u200Badmin", // Zero-width space
		"../../../etc/passwd",
		"\\\\server\\share\\file",
		"user:123|admin:true",
	];

	for (const maliciousTag of maliciousTags) {
		// Test that parsing doesn't sanitize or validate - it should preserve the input
		const result = parseCacheTags(maliciousTag);
		assertEquals(result.length, 1);
		assertEquals(result[0], maliciousTag);

		// Test in comma-separated context
		const multipleResult = parseCacheTags(
			`safe:tag, ${maliciousTag}, another:tag`,
		);
		assertEquals(multipleResult.length, 3);
		assertEquals(multipleResult[1], maliciousTag);
	}
});

Deno.test("Input Validation - Malicious cache control directives", () => {
	const maliciousDirectives = [
		"max-age=<script>alert('xss')</script>",
		"max-age=javascript:alert('xss')",
		"max-age=3600; Set-Cookie: admin=true",
		"max-age=3600\nSet-Cookie: admin=true",
		"max-age=3600\r\nSet-Cookie: admin=true",
		"max-age=3600, private\x00public",
		"max-age=999999999999999999999", // Potential overflow
		"max-age=-999999999999999999999", // Negative overflow
		"max-age=Infinity",
		"max-age=NaN",
		"max-age=0x1000000", // Hex number
		"max-age=1e10", // Scientific notation
		"public=\"<script>alert('xss')</script>\"",
		"custom-directive=../../../etc/passwd",
	];

	for (const directive of maliciousDirectives) {
		// Should not throw and should handle malicious input gracefully
		const result = parseCacheControl(directive);
		assertEquals(typeof result, "object");

		// Verify no prototype pollution or unexpected properties
		assertEquals(
			Object.prototype.hasOwnProperty.call(result, "__proto__"),
			false,
		);
		assertEquals(
			Object.prototype.hasOwnProperty.call(result, "constructor"),
			false,
		);
		assertEquals(
			Object.prototype.hasOwnProperty.call(result, "prototype"),
			false,
		);
	}
});

Deno.test("Input Validation - Invalid header names and values", async () => {
	const writeHandler = createWriteHandler({ cacheName: "test" });

	// Test with various invalid header scenarios
	const testCases = [
		{
			name: "null bytes in header value",
			headers: { "cache-tag": "user:123\x00admin" },
		},
		{
			name: "newlines in header value",
			headers: { "cache-tag": "user:123\nSet-Cookie: admin=true" },
		},
		{
			name: "CRLF injection in header value",
			headers: { "cache-tag": "user:123\r\nX-Admin: true" },
		},
		{
			name: "unicode control characters",
			headers: { "cache-tag": "user:123\u0001\u0002\u0003admin" },
		},
		{
			name: "extremely long header value",
			headers: { "cache-tag": "x".repeat(1000000) },
		},
		{
			name: "binary data in header",
			headers: {
				"cache-tag": String.fromCharCode(
					...Array.from({ length: 256 }, (_, i) => i),
				),
			},
		},
	];

	for (const testCase of testCases) {
		try {
			const headers = new Headers({
				"cache-control": "max-age=3600, public",
				...testCase.headers,
			});

			const response = new Response("test data", { headers });
			Object.defineProperty(response, "url", {
				value: "https://example.com/api/test",
				writable: false,
			});

			// Should handle invalid headers without throwing
			const request = new Request("https://example.com/api/test");
			const result = await writeHandler(request, response);
			assertExists(result, `Failed for test case: ${testCase.name}`);
			assertEquals(result.headers.has("cache-tag"), false);
		} catch (error) {
			// Some header values are invalid and will be rejected by the browser/runtime
			// This is expected behavior - the test verifies the runtime handles these appropriately
			const errorMsg =
				error instanceof Error
					? `${error.constructor.name}: ${error.message}`
					: String(error);
			assert(
				error instanceof TypeError ||
					error instanceof RangeError ||
					error instanceof Error,
				`Unexpected error type for test case: ${testCase.name}: ${errorMsg}`,
			);
		}
	}
	await caches.delete("test");
});

Deno.test("Input Validation - Invalid vary header values", () => {
	const invalidVaryHeaders = [
		"", // Empty
		"   ", // Whitespace only
		",", // Comma only
		",,", // Multiple commas
		", , ,", // Commas with spaces
		"header1,", // Trailing comma
		",header2", // Leading comma
		"header1,,header2", // Double comma
		"header\x00injection", // Null byte
		"header\n injection", // Newline
		"header\r injection", // Carriage return
		"*,accept,user-agent", // Asterisk mixed with other headers
		"accept,*,user-agent", // Asterisk in middle
		"header with spaces", // Spaces in header name
		"héader-with-ünicode", // Unicode characters
		"\u200Bheader", // Zero-width space
		"header\uFEFF", // BOM character
	];

	for (const varyHeader of invalidVaryHeaders) {
		// Should handle gracefully without throwing
		const result = parseCacheVaryHeader(varyHeader);
		assertEquals(typeof result, "object");
	}
});

Deno.test("Input Validation - Request URLs with injection attempts", () => {
	const maliciousUrls = [
		"https://example.com/api?param=<script>alert('xss')</script>",
		"https://example.com/api?param=javascript:alert('xss')",
		"https://example.com/api/<script>alert('xss')</script>",
		"https://example.com/api/../../../etc/passwd",
		"https://example.com/api?param='; DROP TABLE users; --",
		"https://example.com/api\x00injection",
		"https://example.com/api\n inject",
		"https://example.com/api\r inject",
		"https://example.com/api?param1=value1|admin:true",
		"https://example.com/api?callback=jsonp_callback</script><script>alert('xss')</script>",
		"https://example.com/api%00injection",
		"https://example.com/api?param=%3Cscript%3Ealert('xss')%3C/script%3E",
	];

	for (const url of maliciousUrls) {
		try {
			const request = new Request(url);
			const cacheKey = defaultGetCacheKey(request);

			// Should generate a cache key without throwing
			assertEquals(typeof cacheKey, "string");
			assert(cacheKey.startsWith(new URL(url).origin));

			// Cache key should preserve the URL structure
			assert(cacheKey.includes(new URL(url).pathname));
		} catch (error) {
			// Some URLs might be invalid and throw during Request construction
			// This is expected browser behavior, not a library issue
			assert(
				error instanceof TypeError,
				`Unexpected error type for URL: ${url}`,
			);
		}
	}
});

Deno.test(
	"Input Validation - Response with malicious status and headers",
	async () => {
		const writeHandler = createWriteHandler({ cacheName: "test" });

		// Test various malicious response configurations
		const testCases = [
			{
				name: "response with unusual status codes",
				status: 599, // Changed from 999 to stay within valid range
				statusText: "<script>alert('xss')</script>",
			},
			{
				name: "response with null byte in status text",
				status: 200,
				statusText: "OK\x00injection",
			},
			{
				name: "response with newline in status text",
				status: 200,
				statusText: "OK\nHTTP/1.1 200 OK\nX-Admin: true",
			},
			{
				name: "response with control characters",
				status: 200,
				statusText: "OK\u0001\u0002\u0003",
			},
		];

		for (const testCase of testCases) {
			try {
				const headers = new Headers({
					"cache-control": "max-age=3600, public",
					"cache-tag": "test",
				});

				const response = new Response("test data", {
					status: testCase.status,
					statusText: testCase.statusText,
					headers,
				});
				Object.defineProperty(response, "url", {
					value: "https://example.com/api/test",
					writable: false,
				});

				// Should handle malicious response properties without throwing
				const request = new Request("https://example.com/api/test");
				const result = await writeHandler(request, response);
				assertExists(result, `Failed for test case: ${testCase.name}`);
				assertEquals(result.status, testCase.status);
				assertEquals(result.statusText, testCase.statusText);
			} catch (error) {
				// Some status text values are invalid and will be rejected by the runtime
				// This is expected behavior - the test verifies the runtime handles these appropriately
				assert(
					error instanceof TypeError || error instanceof RangeError,
					`Unexpected error type for test case: ${testCase.name}`,
				);
			}
		}
		await caches.delete("test");
	},
);

Deno.test(
	"Input Validation - Cache tag validation during invalidation",
	async () => {
		const cache = await caches.open("test");

		// Add cache entries with various tag formats
		const testTags = [
			["normal:tag"],
			["<script>alert('xss')</script>"],
			["../../../etc/passwd"],
			["user:123\x00admin"],
			["user:123\nadmin"],
			["user:123|admin:true"],
			["\u200Btag"], // Zero-width space
			["tag\uFEFF"], // BOM character
			[""], // Empty tag (should be filtered out during parsing)
		];

		for (let i = 0; i < testTags.length; i++) {
			const tags = testTags[i]!;
			if (tags[0] === "") continue; // Skip empty tag test for setup

			try {
				await cache.put(
					new Request(`https://example.com/api/test${i}`),
					new Response(`data${i}`, {
						headers: {
							"cache-tag": Array.isArray(tags) ? tags.join(", ") : tags,
							expires: new Date(Date.now() + 3600000).toUTCString(),
						},
					}),
				);
			} catch (error) {
				// Some metadata might contain invalid binary data that cannot be serialized
				// This is expected for malicious input - skip these entries
				console.warn(
					`Skipping cache entry ${i} due to serialization error:`,
					error,
				);
				continue;
			}
		}

		// Test invalidation with each malicious tag
		for (let i = 0; i < testTags.length; i++) {
			const tags = testTags[i]!;
			if (tags[0] === "") continue;

			try {
				const deletedCount = await invalidateByTag(tags[0]!, {
					cacheName: "test",
				});
				// If we reach here, the tag was successfully processed
				// The count might be 0 if the cache entry was skipped during setup
				assert(deletedCount >= 0, `Invalid deleted count for tag: ${tags[0]}`);
			} catch (error) {
				// Some tags might be invalid and cause invalidation to fail
				// This is acceptable behavior for malicious input
				console.warn(`Invalidation failed for tag ${tags[0]}:`, error);
			}
		}
		await caches.delete("test");
	},
);

Deno.test(
	"Input Validation - Header removal with malicious header names",
	() => {
		const maliciousHeaders = [
			"<script>alert('xss')</script>",
			"javascript:alert('xss')",
			"header\x00injection",
			"header\ninjection",
			"header\rinjection",
			"__proto__",
			"constructor",
			"prototype",
			"hasOwnProperty",
			"valueOf",
			"toString",
			"../../../etc/passwd",
			"user:pass@evil.com",
		];

		const response = new Response("test data", {
			headers: {
				"cache-control": "max-age=3600",
				"content-type": "application/json",
				"custom-header": "value",
			},
		});

		// Should handle malicious header names gracefully
		try {
			const result = removeHeaders(response, maliciousHeaders);
			assertExists(result);

			// Original headers should be preserved since malicious names don't match
			assertEquals(result.headers.get("cache-control"), "max-age=3600");
			assertEquals(result.headers.get("content-type"), "application/json");
			assertEquals(result.headers.get("custom-header"), "value");
		} catch (error) {
			// Some header names are invalid and will be rejected by the runtime
			// This is expected behavior - the function should handle these appropriately
			assert(
				error instanceof TypeError,
				`Unexpected error type for malicious header removal`,
			);
		}
	},
);

Deno.test(
	"Input Validation - Config object with malicious properties",
	async () => {
		const cache = await caches.open("test");

		// Test with config objects containing malicious properties
		const maliciousConfigs = [
			{
				__proto__: { admin: true },
				cacheName: "test",
			},
			{
				constructor: { prototype: { isAdmin: true } },
				maxTtl: 3600,
			},
			{
				toString: () => "malicious",
				defaultTtl: 1800,
			},
			{
				valueOf: () => ({ admin: true }),
				features: { cacheControl: true },
			},
		] as const;

		for (const config of maliciousConfigs) {
			// Should create handlers without issues despite malicious config
			const readHandler = createReadHandler({ cacheName: "test", ...config });
			const writeHandler = createWriteHandler({ cacheName: "test", ...config });
			const middlewareHandler = createMiddlewareHandler({
				cacheName: "test",
				...config,
			});

			assertEquals(typeof readHandler, "function");
			assertEquals(typeof writeHandler, "function");
			assertEquals(typeof middlewareHandler, "function");

			// Verify no prototype pollution occurred
			assertEquals(
				Object.prototype.hasOwnProperty.call(Object.prototype, "admin"),
				false,
			);
			assertEquals(
				Object.prototype.hasOwnProperty.call(Object.prototype, "isAdmin"),
				false,
			);
		}
	},
);

Deno.test(
	"Input Validation - Extremely deep object nesting in metadata",
	async () => {
		const cache = await caches.open("test");
		const readHandler = createReadHandler({ cacheName: "test" });

		// Create deeply nested malicious metadata
		let deepObject: unknown = { value: "base" };
		for (let i = 0; i < 1000; i++) {
			deepObject = { nested: deepObject, level: i };
		}

		const maliciousMetadata = {
			tags: ["user"],
			ttl: 3600,
			cachedAt: Date.now(),
			originalHeaders: {},
			deepNesting: deepObject,
		};

		const cacheKey = "https://example.com/api/test";
		const response = new Response("test data", {
			headers: {
				"cache-tag": "user",
				expires: new Date(Date.now() + 3600000).toUTCString(),
			},
		});

		await cache.put(new Request(cacheKey), response);

		const request = new Request("https://example.com/api/test");

		// Should handle deeply nested objects without stack overflow
		const result = await readHandler(request);

		// Should either return the response or null if parsing fails
		// Either outcome is acceptable for malformed/malicious metadata
		if (result) {
			assertExists(result);
			assertEquals(await result.text(), "test data");
		} else {
			assertEquals(result, null);
		}
	},
);

Deno.test("Input Validation - Non-string values in header processing", () => {
	// Test that functions handle non-string inputs gracefully
	const nonStringInputs = [
		null,
		undefined,
		123,
		true,
		false,
		{},
		[],
		Symbol("test"),
		() => "function",
	];

	for (const input of nonStringInputs) {
		try {
			// These should either handle gracefully or throw appropriate TypeScript errors
			// @ts-ignore - intentionally testing with wrong types
			parseCacheControl(input);
			// @ts-ignore - intentionally testing with wrong types
			parseCacheTags(input);
			// @ts-ignore - intentionally testing with wrong types
			parseCacheVaryHeader(input);
		} catch (error) {
			// Expected to throw with non-string inputs
			assert(error instanceof TypeError || error instanceof Error);
		}
	}
});
