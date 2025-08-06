# cache-tag

A modern CDN cache library that implements support for modern CDN cache primitives using web-standard middleware. Works across CloudFlare Workers, Netlify Edge Functions, Deno Deploy, and Node.js 20+, using Request/Response/CacheStorage APIs with zero dependencies and ESM-only.

## Features

- **Web Standards Compliant**: Built on standard HTTP headers (`Cache-Control`, `CDN-Cache-Control`, `Cache-Tag`, `Expires`, `ETag`, `Last-Modified`)
- **Three Handler Patterns**: Read, Write, and Middleware handlers for flexible cache management
- **Cache Tagging**: Tag-based cache invalidation using standard `Cache-Tag` headers
- **HTTP Conditional Requests**: Full RFC 7232 support with ETag and Last-Modified validation for bandwidth optimization
- **Cross-Platform**: Works on Deno, Node.js 20+, CloudFlare Workers, Netlify Edge Functions
- **Security**: Comprehensive input validation and sanitization
- **Zero Dependencies**: Pure web standards implementation, ESM-only
- **TypeScript**: Fully typed with comprehensive type definitions

## Installation

```bash
npm install cache-tag
```

## Quick Start

### Basic Middleware Usage

```typescript
import { createCacheHandlers } from "cache-tag";

const { middleware } = createCacheHandlers();

// Use with your framework
async function handleRequest(request: Request): Promise<Response> {
	return middleware(request, async () => {
		// Your application logic
		return new Response("Hello World", {
			headers: {
				"cache-control": "max-age=3600, public",
				"cache-tag": "homepage, content",
			},
		});
	});
}
```

### Individual Handlers

```typescript
import { createCacheHandlers } from "cache-tag";

const { read, write } = createCacheHandlers();

async function handleRequest(request: Request): Promise<Response> {
	// Check for cached response
	const cached = await read(request);
	if (cached) {
		return cached;
	}

	// Generate fresh response
	const response = new Response("Fresh content", {
		headers: {
			"cache-control": "max-age=1800, public",
			"cache-tag": "api, users",
		},
	});

	// Cache and return (removes processed headers)
	return await write(request, response);
}
```

## Platform Usage Examples

### CloudFlare Workers

```typescript
import { createCacheHandlers } from "cache-tag";

const { middleware } = createCacheHandlers({
	cacheName: "cloudflare-cache",
	maxTtl: 86400, // 24 hours
});

export default {
	async fetch(request: Request): Promise<Response> {
		return middleware(request, async () => {
			const response = await fetch(request);

			// Add cache headers
			const headers = new Headers(response.headers);
			headers.set("cache-control", "max-age=3600, public");
			headers.set("cache-tag", "api, content");

			return new Response(response.body, {
				status: response.status,
				statusText: response.statusText,
				headers,
			});
		});
	},
};
```

### Netlify Edge Functions

```typescript
import { createCacheHandlers } from "cache-tag";

const { middleware } = createCacheHandlers({
	cacheName: "netlify-edge-cache",
	defaultTtl: 300, // 5 minutes
});

export default async (request: Request): Promise<Response> => {
	return middleware(request, async () => {
		// Your application logic
		return new Response(
			JSON.stringify({ message: "Hello from Netlify Edge!" }),
			{
				headers: {
					"content-type": "application/json",
					"cache-control": "max-age=1800, public",
					"cache-tag": "api, edge-function",
				},
			},
		);
	});
};
```

### Deno Deploy

```typescript
import { createCacheHandlers } from "cache-tag";

const { middleware } = createCacheHandlers({
	cacheName: "deno-deploy-cache",
	features: {
		cacheControl: true,
		cdnCacheControl: true,
		cacheTags: true,
		vary: true,
	},
});

Deno.serve(async (request: Request): Promise<Response> => {
	return middleware(request, async () => {
		const url = new URL(request.url);

		return new Response(`Hello from Deno Deploy! Path: ${url.pathname}`, {
			headers: {
				"cache-control": "max-age=600, public",
				"cache-tag": `page:${url.pathname}, deno`,
			},
		});
	});
});
```

### Node.js 20+ with Web Standards

```typescript
import { createCacheHandlers } from "cache-tag";
import { createServer } from "node:http";

const { middleware } = createCacheHandlers({
	cacheName: "node-cache",
	maxTtl: 3600,
});

createServer(async (req, res) => {
	const request = new Request(`http://localhost:3000${req.url}`, {
		method: req.method,
		headers: req.headers as HeadersInit,
		body: req.method !== "GET" && req.method !== "HEAD" ? req : undefined,
	});

	const response = await middleware(request, async () => {
		return new Response(
			JSON.stringify({
				message: "Hello from Node.js!",
				path: req.url,
			}),
			{
				headers: {
					"content-type": "application/json",
					"cache-control": "max-age=300, public",
					"cache-tag": "api, node",
				},
			},
		);
	});

	res.statusCode = response.status;
	response.headers.forEach((value, key) => {
		res.setHeader(key, value);
	});

	if (response.body) {
		const reader = response.body.getReader();
		const pump = async () => {
			const { done, value } = await reader.read();
			if (done) return;
			res.write(value);
			return pump();
		};
		await pump();
	}

	res.end();
}).listen(3000);
```

## Cache Invalidation

### By Tag

```typescript
import { invalidateByTag, getCacheStats } from "cache-tag";

// Invalidate all responses tagged with 'users'
const deletedCount = await invalidateByTag("users");
console.log(`Invalidated ${deletedCount} entries`);

// Get statistics before and after
const stats = await getCacheStats();
console.log(`Total entries: ${stats.totalEntries}`);
console.log("Entries by tag:", stats.entriesByTag);
```

### By Path

```typescript
import { invalidateByPath } from "cache-tag";

// Invalidate specific path
await invalidateByPath("/api/users");

// Invalidate path and all sub-paths
await invalidateByPath("/api/users/"); // Also invalidates /api/users/123, /api/users/profile, etc.
```

### Clear All Cache

```typescript
import { invalidateAll } from "cache-tag";

// Clear entire cache
const deletedCount = await invalidateAll();
console.log(`Cleared ${deletedCount} entries from cache`);
```

## Configuration

### Basic Configuration

```typescript
import { createCacheHandlers } from "cache-tag";

const handlers = createCacheHandlers({
	// Custom cache name (default: 'cache-tag-default')
	cacheName: "my-app-cache",

	// Or provide cache instance directly
	cache: await caches.open("custom-cache"),

	// Default TTL when no cache headers present (no caching by default)
	defaultTtl: 300, // 5 minutes

	// Maximum TTL to prevent excessive caching
	maxTtl: 86400, // 24 hours
});
```

### Feature Configuration

```typescript
const handlers = createCacheHandlers({
	features: {
		// Support Cache-Control header (default: true)
		cacheControl: true,

		// Support CDN-Cache-Control header (default: true)
		cdnCacheControl: true,

		// Support Cache-Tag header for invalidation (default: true)
		cacheTags: true,

		// Support Vary header for cache key generation (default: true)
		vary: true,

		// Support cache-vary header for backend-driven cache variations (default: true)
		cacheVary: true,

		// Support HTTP conditional requests (default: true)
		conditionalRequests: {
			etag: true, // Enable ETag validation
			lastModified: true, // Enable Last-Modified validation
			weakValidation: true, // Allow weak ETag comparison
			etag: "generate", // Auto-generate ETags for cached responses
		},

		// Or simply enable with defaults
		conditionalRequests: true,

		// Or disable completely
		conditionalRequests: false,
	},
});
```

### Custom Cache Key Generation

```typescript
const handlers = createCacheHandlers({
	getCacheKey: async (request, vary) => {
		const url = new URL(request.url);

		// Custom cache key strategy
		let key = `${request.method}:${url.pathname}`;

		// Include user ID from header in cache key
		const userId = request.headers.get("x-user-id");
		if (userId) {
			key += `:user:${userId}`;
		}

		// Apply vary rules if present
		if (vary) {
			// ... apply vary logic
		}

		return key;
	},
});
```

## Supported HTTP Headers

### Cache-Control

Standard HTTP cache control directives:

```http
Cache-Control: max-age=3600, public
Cache-Control: max-age=0, no-cache, must-revalidate
Cache-Control: private, no-store
```

Supported directives:

- `max-age=<seconds>`: Cache duration
- `public`: Cache can be stored by any cache
- `private`: Cache only in private caches
- `no-cache`: Must revalidate before serving
- `no-store`: Must not cache at all
- `must-revalidate`: Must revalidate when stale

### CDN-Cache-Control

CDN-specific cache control (takes precedence over Cache-Control):

```http
CDN-Cache-Control: max-age=7200, public
```

This header allows different caching behavior for CDNs vs. browsers. When present, it overrides `Cache-Control` for cache decisions.

### Cache-Tag

For cache invalidation by tags:

```http
Cache-Tag: user:123, post:456, api, content
```

- Maximum 100 tags per response
- Tags are sanitized to prevent header injection
- Used for targeted cache invalidation

### Cache-Vary

Backend-driven cache variations:

```http
Cache-Vary: header=Accept-Language, cookie=session_id, query=version
```

Allows responses to specify which request attributes should affect the cache key:

- `header=<name>`: Vary by request header
- `cookie=<name>`: Vary by specific cookie
- `query=<name>`: Vary by query parameter

### Expires

Absolute expiration time:

```http
Expires: Wed, 21 Oct 2024 07:28:00 GMT
```

Used internally for cache validation. Set automatically based on `max-age`.

## HTTP Conditional Requests

The library implements full support for HTTP conditional requests according to RFC 7232, enabling efficient cache validation and bandwidth optimization through 304 Not Modified responses.

### What are Conditional Requests?

Conditional requests allow clients to make requests that are processed only if certain conditions are met. They use validators like ETags and Last-Modified dates to determine if cached content is still fresh, avoiding unnecessary data transfer when content hasn't changed.

### Supported Conditional Headers

#### If-None-Match (ETag Validation)

```http
If-None-Match: "abc123"
If-None-Match: "abc123", "def456"
If-None-Match: *
```

- Compares against the response's `ETag` header
- Supports multiple ETags and the wildcard `*`
- Supports both strong and weak ETag comparison

#### If-Modified-Since (Date Validation)

```http
If-Modified-Since: Wed, 21 Oct 2015 07:28:00 GMT
```

- Compares against the response's `Last-Modified` header
- Returns 304 if content hasn't been modified since the given date

### Configuration

Enable conditional requests in your cache configuration:

```typescript
import { createCacheHandlers } from "cache-tag";

// Enable with default settings
const { middleware } = createCacheHandlers({
	features: {
		conditionalRequests: true,
	},
});

// Custom configuration
const { middleware } = createCacheHandlers({
	features: {
		conditionalRequests: {
			etag: true, // Enable ETag validation (default: true)
			lastModified: true, // Enable Last-Modified validation (default: true)
			weakValidation: true, // Allow weak ETag comparison (default: true)
			etag: "generate", // Auto-generate ETags for responses
		},
	},
});

// Disable conditional requests completely
const { middleware } = createCacheHandlers({
	features: {
		conditionalRequests: false,
	},
});
```

### Basic Usage Examples

#### Automatic ETag Generation

```typescript
import { createCacheHandlers } from "cache-tag";

const { middleware } = createCacheHandlers({
	features: {
		conditionalRequests: {
			etag: "generate", // Automatically generate ETags
		},
	},
});

// Your responses automatically get ETags
const response = await middleware(request, async () => {
	return new Response(JSON.stringify({ data: "content" }), {
		headers: {
			"content-type": "application/json",
			"cache-control": "max-age=3600, public",
		},
	});
});
```

#### Manual ETag Setting

```typescript
const { middleware } = createCacheHandlers({
	features: { conditionalRequests: true },
});

const response = await middleware(request, async () => {
	const content = await generateContent();
	const etag = `"v${content.version}-${content.hash}"`;

	return new Response(JSON.stringify(content), {
		headers: {
			"content-type": "application/json",
			"cache-control": "max-age=1800, public",
			etag: etag,
			"last-modified": content.lastModified.toUTCString(),
		},
	});
});
```

### Advanced Examples

#### API with Conditional Requests

```typescript
import { createCacheHandlers } from "cache-tag";

const { middleware } = createCacheHandlers({
	cacheName: "api-cache",
	features: {
		conditionalRequests: {
			etag: "generate",
			lastModified: true,
			weakValidation: true,
		},
	},
});

// API endpoint with conditional request support
async function handleAPIRequest(request: Request): Promise<Response> {
	return middleware(request, async () => {
		const url = new URL(request.url);
		const resourceId = url.pathname.split("/").pop();

		// Fetch resource data
		const resource = await getResource(resourceId);

		return new Response(JSON.stringify(resource), {
			headers: {
				"content-type": "application/json",
				"cache-control": "max-age=600, public",
				etag: `"resource-${resource.id}-v${resource.version}"`,
				"last-modified": resource.updatedAt.toUTCString(),
				"cache-tag": `resource:${resource.id}, type:${resource.type}`,
			},
		});
	});
}

// Client requests:
// GET /api/resource/123
// Response: 200 OK with ETag: "resource-123-v5"
//
// Next request with same ETag:
// GET /api/resource/123
// If-None-Match: "resource-123-v5"
// Response: 304 Not Modified (no body, saves bandwidth)
```

#### Static File Server with ETags

```typescript
import { createCacheHandlers } from "cache-tag";

const { middleware } = createCacheHandlers({
	cacheName: "static-files",
	maxTtl: 31536000, // 1 year for static assets
	features: {
		conditionalRequests: {
			etag: "generate",
			lastModified: true,
		},
	},
});

async function serveStaticFile(request: Request): Promise<Response> {
	return middleware(request, async () => {
		const url = new URL(request.url);
		const filePath = url.pathname;

		// Check if file exists and get metadata
		const fileInfo = await getFileInfo(filePath);
		if (!fileInfo) {
			return new Response("Not Found", { status: 404 });
		}

		// Read file content
		const content = await readFile(filePath);
		const mimeType = getMimeType(filePath);

		return new Response(content, {
			headers: {
				"content-type": mimeType,
				"cache-control": "public, max-age=31536000, immutable",
				"last-modified": fileInfo.lastModified.toUTCString(),
				"cache-tag": `static, file:${filePath}`,
			},
		});
	});
}
```

#### Content Management System

```typescript
import { createCacheHandlers, invalidateByTag } from "cache-tag";

const { middleware } = createCacheHandlers({
	features: {
		conditionalRequests: {
			etag: "generate",
			lastModified: true,
		},
	},
});

// Serve content with conditional requests
async function serveContent(request: Request): Promise<Response> {
	return middleware(request, async () => {
		const url = new URL(request.url);
		const slug = url.pathname.slice(1) || "home";

		const page = await getPageBySlug(slug);
		if (!page) {
			return new Response("Page not found", { status: 404 });
		}

		const html = await renderPage(page);

		return new Response(html, {
			headers: {
				"content-type": "text/html",
				"cache-control": "max-age=300, public", // 5 minute cache
				etag: `"page-${page.id}-${page.version}"`,
				"last-modified": page.updatedAt.toUTCString(),
				"cache-tag": `page:${page.id}, author:${page.authorId}, category:${page.category}`,
			},
		});
	});
}

// When content is updated, invalidate cache
async function updatePage(pageId: string, updates: PageUpdates) {
	await updatePageInDatabase(pageId, updates);

	// Invalidate all cached versions of this page
	await invalidateByTag(`page:${pageId}`);
}
```

### Manual ETag Operations

You can also use the conditional request utilities directly:

```typescript
import {
	generateETag,
	validateConditionalRequest,
	create304Response,
	compareETags,
} from "cache-tag";

// Generate ETag for any response
const response = new Response("content");
const etag = await generateETag(response);
console.log(etag); // "1234567-1699123456789"

// Validate conditional request manually
const request = new Request("https://example.com", {
	headers: { "if-none-match": '"1234567-1699123456789"' },
});

const cachedResponse = new Response("cached content", {
	headers: {
		etag: '"1234567-1699123456789"',
		"content-type": "text/plain",
	},
});

const validation = validateConditionalRequest(request, cachedResponse);
if (validation.shouldReturn304) {
	return create304Response(cachedResponse);
}

// Compare ETags directly
const matches = compareETags('"abc123"', '"abc123"'); // true
const weakMatches = compareETags('"abc123"', 'W/"abc123"', true); // true (weak comparison)
```

### Platform-Specific Examples

#### CloudFlare Workers with Conditional Requests

```typescript
import { createCacheHandlers } from "cache-tag";

const { middleware } = createCacheHandlers({
	cacheName: "cf-conditional-cache",
	features: {
		conditionalRequests: {
			etag: "generate",
			lastModified: true,
		},
	},
});

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		return middleware(request, async () => {
			// Your CloudFlare Worker logic
			const data = await env.KV.get("content");
			const lastModified = await env.KV.get("content:last-modified");

			return new Response(data, {
				headers: {
					"content-type": "application/json",
					"cache-control": "public, max-age=300",
					"last-modified": lastModified || new Date().toUTCString(),
					"cf-cache-status": "MISS", // This will be removed from final response
				},
			});
		});
	},
};
```

#### Next.js API Routes

```typescript
// pages/api/data.ts
import { createCacheHandlers } from "cache-tag";
import type { NextApiRequest, NextApiResponse } from "next";

const { middleware } = createCacheHandlers({
	features: {
		conditionalRequests: {
			etag: "generate",
		},
	},
});

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse,
) {
	// Convert to Web API Request
	const request = new Request(`http://localhost:3000${req.url}`, {
		method: req.method,
		headers: req.headers as HeadersInit,
	});

	const response = await middleware(request, async () => {
		const data = await fetchApiData();

		return new Response(JSON.stringify(data), {
			headers: {
				"content-type": "application/json",
				"cache-control": "max-age=60, public",
			},
		});
	});

	// Convert back to Next.js response
	res.status(response.status);
	response.headers.forEach((value, key) => {
		res.setHeader(key, value);
	});

	if (response.body) {
		const text = await response.text();
		res.send(text);
	} else {
		res.end();
	}
}
```

### Benefits of Conditional Requests

1. **Bandwidth Savings**: 304 responses have no body, saving network transfer
2. **Improved Performance**: Clients can use cached content when still valid
3. **Server Efficiency**: Less processing when content hasn't changed
4. **Better UX**: Faster page loads when content is cached
5. **Standards Compliance**: Works with all HTTP clients and browsers

### Best Practices

1. **Use ETags for Dynamic Content**: Generated ETags work well for API responses and dynamic pages

2. **Use Last-Modified for Static Content**: File modification dates are ideal for static assets

3. **Combine Both Validators**: ETags take precedence over Last-Modified when both are present

4. **Generate Meaningful ETags**: Include version numbers, hashes, or timestamps in custom ETags

5. **Consider Weak vs Strong ETags**: Use weak ETags (`W/"123"`) for content that's semantically equivalent but not byte-for-byte identical

6. **Cache Long-Lived Content**: Static assets with ETags can be cached for long periods safely

```typescript
// Good ETag practices
return new Response(content, {
	headers: {
		// Strong ETag for exact content
		etag: `"${contentHash}-${version}"`,

		// Or weak ETag for semantic equivalence
		etag: `W/"${semanticVersion}"`,

		// Include last modified for additional validation
		"last-modified": lastModifiedDate.toUTCString(),

		// Long cache with conditional requests
		"cache-control": "max-age=31536000, public",
	},
});
```

## API Reference

### Factory Functions

#### `createCacheHandlers(config?): CacheHandlers`

Creates all three cache handlers with shared configuration.

**Parameters:**

- `config` (optional): `CacheConfig` - Configuration options

**Returns:** Object with `read`, `write`, and `middleware` handlers

```typescript
const { read, write, middleware } = createCacheHandlers({
	cacheName: "my-cache",
	defaultTtl: 300,
});
```

### Individual Handler Creators

#### `createReadHandler(config?): ReadHandler`

Creates a cache reading handler.

**Parameters:**

- `config` (optional): `CacheConfig` - Configuration options

**Returns:** `(request: Request) => Promise<Response | null>`

#### `createWriteHandler(config?): WriteHandler`

Creates a cache writing handler.

**Parameters:**

- `config` (optional): `CacheConfig` - Configuration options

**Returns:** `(request: Request, response: Response) => Promise<Response>`

#### `createMiddlewareHandler(config?): MiddlewareHandler`

Creates a middleware handler that combines read and write operations.

**Parameters:**

- `config` (optional): `CacheConfig` - Configuration options

**Returns:** `(request: Request, next: () => Promise<Response>) => Promise<Response>`

### Cache Invalidation

#### `invalidateByTag(tag, options?): Promise<number>`

Invalidate cached responses by tag.

**Parameters:**

- `tag`: `string` - The cache tag to invalidate
- `options` (optional): `InvalidationOptions` - Cache options

**Returns:** Promise resolving to number of invalidated entries

#### `invalidateByPath(path, options?): Promise<number>`

Invalidate cached responses by URL path.

**Parameters:**

- `path`: `string` - The URL path to invalidate
- `options` (optional): `InvalidationOptions` - Cache options

**Returns:** Promise resolving to number of invalidated entries

#### `invalidateAll(options?): Promise<number>`

Clear entire cache.

**Parameters:**

- `options` (optional): `InvalidationOptions` - Cache options

**Returns:** Promise resolving to number of invalidated entries

### Cache Statistics

#### `getCacheStats(options?): Promise<CacheStats>`

Get cache statistics.

**Parameters:**

- `options` (optional): `InvalidationOptions` - Cache options

**Returns:** Promise resolving to cache statistics object

```typescript
const stats = await getCacheStats();
// {
//   totalEntries: 42,
//   entriesByTag: {
//     "user": 15,
//     "api": 27,
//     "content": 8
//   }
// }
```

#### `regenerateCacheStats(options?): Promise<CacheStats>`

Regenerate cache statistics from scratch. Useful if metadata becomes out of sync.

### Utility Functions

#### `parseCacheControl(headerValue): Record<string, string | number | boolean>`

Parse Cache-Control header directives.

#### `parseCacheTags(headerValue): string[]`

Parse Cache-Tag header into array of tags.

#### `parseCacheVaryHeader(headerValue): CacheVary`

Parse cache-vary header into structured rules.

#### `defaultGetCacheKey(request, vary?): string`

Default cache key generation strategy.

#### `isCacheValid(expiresHeader): boolean`

Check if cached response is still valid using Expires header.

#### `getCache(options): Promise<Cache>`

Get cache instance from options.

## Security

### Input Validation

The library includes comprehensive input validation:

- **Cache Tags**: Limited to 100 tags, maximum 1000 characters each, sanitized to prevent header injection
- **Headers**: Malicious headers are sanitized or removed
- **Cache Keys**: Protected against collision attacks
- **Metadata**: JSON parsing includes error handling for corrupted data

### Header Sanitization

```typescript
// Cache tags are automatically sanitized
const response = new Response("content", {
	headers: {
		"cache-tag": "user\r\nSet-Cookie: evil=true", // Newlines removed
	},
});
```

### Best Practices

1. **Set Maximum TTL**: Always configure `maxTtl` to prevent excessive caching
2. **Validate Input**: The library validates input, but validate your own data
3. **Use HTTPS**: Ensure secure transport for cached content
4. **Monitor Cache Size**: Use `getCacheStats()` to monitor cache growth
5. **Regular Cleanup**: Consider periodic cache cleanup strategies

## Error Handling

The library includes robust error handling:

- **Corrupted Metadata**: Automatically detected and cleaned
- **Invalid JSON**: Graceful fallback to empty objects
- **Network Failures**: Non-blocking error handling
- **Invalid Headers**: Sanitization and validation

```typescript
// Error handling is built-in
const { middleware } = createCacheHandlers();

// This won't crash even with invalid cache data
const response = await middleware(request, next);
```

## Performance Considerations

### Cache Key Strategy

- Default cache keys include method and pathname
- Custom cache key functions allow optimization for your use case
- Consider vary headers for request-specific caching

### Memory Usage

- Cache metadata is stored separately from response data
- Large responses are streamed, not loaded into memory
- Consider cache size limits based on your platform

### Network Efficiency

- CDN-Cache-Control header allows different CDN/browser caching
- Cache tags enable efficient bulk invalidation
- Vary headers prevent over-caching

## TypeScript

Fully typed with comprehensive TypeScript definitions:

```typescript
import type {
	CacheConfig,
	CacheHandlers,
	CacheVary,
	InvalidationOptions,
	MiddlewareHandler,
	ParsedCacheHeaders,
	ReadHandler,
	WriteHandler,
} from "cache-tag";
```

### Type Definitions

```typescript
interface CacheConfig {
	cacheName?: string;
	cache?: Cache;
	getCacheKey?: (
		request: Request,
		vary?: CacheVary,
	) => Promise<string> | string;
	features?: {
		cacheControl?: boolean;
		cdnCacheControl?: boolean;
		cacheTags?: boolean;
		vary?: boolean;
		cacheVary?: boolean;
		conditionalRequests?: boolean | ConditionalRequestConfig;
	};
	defaultTtl?: number;
	maxTtl?: number;
}

interface ConditionalRequestConfig {
	etag?: boolean | "generate"; // Enable ETag validation, optionally generate ETags
	lastModified?: boolean; // Enable Last-Modified validation
	weakValidation?: boolean; // Allow weak ETag comparison
}

interface ReadHandler {
	(request: Request): Promise<Response | null>;
}

interface WriteHandler {
	(request: Request, response: Response): Promise<Response>;
}

interface MiddlewareHandler {
	(request: Request, next: () => Promise<Response>): Promise<Response>;
}
```

## Examples

### E-commerce Product Cache

```typescript
import { createCacheHandlers } from "cache-tag";

const { middleware } = createCacheHandlers({
	defaultTtl: 1800, // 30 minutes
	maxTtl: 86400, // 24 hours
});

async function handleProductRequest(request: Request): Promise<Response> {
	return middleware(request, async () => {
		const url = new URL(request.url);
		const productId = url.pathname.split("/").pop();

		const product = await getProduct(productId);

		return new Response(JSON.stringify(product), {
			headers: {
				"content-type": "application/json",
				"cache-control": "max-age=3600, public",
				"cache-tag": `product:${productId}, category:${product.category}, inventory`,
			},
		});
	});
}

// Invalidate when product changes
await invalidateByTag(`product:${productId}`);

// Invalidate entire category
await invalidateByTag(`category:electronics`);

// Invalidate all inventory-related cache
await invalidateByTag("inventory");
```

### API Rate Limiting with Cache

```typescript
import { createCacheHandlers } from "cache-tag";

const { read, write } = createCacheHandlers({
	cacheName: "rate-limit-cache",
});

async function rateLimitedAPI(request: Request): Promise<Response> {
	const ip = request.headers.get("cf-connecting-ip") || "unknown";
	const cacheKey = `rate-limit:${ip}`;

	// Check if rate limited
	const rateLimitRequest = new Request(cacheKey);
	const cached = await read(rateLimitRequest);

	if (cached) {
		return new Response("Rate limited", {
			status: 429,
			headers: { "retry-after": "60" },
		});
	}

	// Process request
	const response = await processAPIRequest(request);

	// Set rate limit
	const rateLimitResponse = new Response("rate-limited", {
		headers: {
			"cache-control": "max-age=60", // 1 minute rate limit
			"cache-tag": `rate-limit, ip:${ip}`,
		},
	});

	await write(rateLimitRequest, rateLimitResponse);

	return response;
}
```

## Troubleshooting

### Common Issues

**Cache not working:**

- Ensure responses have appropriate cache headers (`Cache-Control` or `CDN-Cache-Control`)
- Check that `maxTtl` is not too restrictive
- Verify cache instance is accessible

**Invalidation not working:**

- Ensure responses include `Cache-Tag` headers
- Check tag names match exactly (case-sensitive)
- Verify cache instance is the same

**Memory issues:**

- Monitor cache size with `getCacheStats()`
- Set appropriate `maxTtl` values
- Consider periodic cleanup with `invalidateAll()`

**Conditional requests not working:**

- Ensure responses include `ETag` or `Last-Modified` headers
- Check that `conditionalRequests` feature is enabled
- Verify client sends `If-None-Match` or `If-Modified-Since` headers
- Use browser dev tools to confirm 304 responses

### Debugging

```typescript
// Enable debug logging
const { middleware } = createCacheHandlers({
	// Add custom cache key to debug
	getCacheKey: (request, vary) => {
		const key = defaultGetCacheKey(request, vary);
		console.log("Cache key:", key);
		return key;
	},
});

// Check cache contents
const stats = await getCacheStats();
console.log("Cache stats:", stats);
```

## License

MIT License - see LICENSE file for details.

## Contributing

Contributions welcome! Please ensure:

1. All tests pass (`pnpm test`)
2. Code is formatted (`pnpm format`)
3. Types are valid (`pnpm check`)
4. Security considerations are addressed

## Changelog

### 0.1.0 (Initial Release)

- Web standards-based caching with Request/Response/CacheStorage APIs
- Three handler patterns: Read, Write, and Middleware
- Cache tagging with standard Cache-Tag headers
- HTTP conditional requests with ETag and Last-Modified validation (RFC 7232)
- Cross-platform support (Deno, Node.js 20+, CloudFlare Workers, Netlify Edge Functions)
- Comprehensive input validation and security features
- Zero dependencies, ESM-only
