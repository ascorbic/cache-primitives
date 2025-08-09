# cache-handlers

Unified, modern HTTP caching + invalidation + conditional requests built directly on standard Web APIs (`Request`, `Response`, `CacheStorage`). One small API: `createCacheHandler` – works on Cloudflare Workers, Netlify Edge, Deno, workerd, and Node 20+ (with Undici polyfills).

## Highlights

- Single handler: read -> serve (fresh/stale) -> optional background revalidate (SWR) -> write
- Uses only standard headers for core caching logic: `Cache-Control` (+ `stale-while-revalidate`), `CDN-Cache-Control`, `Cache-Tag`, `Vary`, `ETag`, `Last-Modified`
- Optional custom extension header: `Cache-Vary` (library-defined – lets your backend declare specific header/cookie/query components for key derivation without bloating the standard `Vary` header)
- Stale-While-Revalidate implemented purely via directives (no custom headers)
- Tag & path invalidation helpers (`invalidateByTag`, `invalidateByPath`, `invalidateAll` + stats)
- Optional automatic ETag generation & conditional 304 responses
- Backend-driven Vary via custom `Cache-Vary` (header= / cookie= / query=)
- Zero runtime dependencies, ESM only, fully typed
- Same code everywhere (Edge runtimes, Deno, Node + Undici)

## Install

```bash
pnpm add cache-handlers
# or
npm i cache-handlers
```

## Quick Start

```ts
import { createCacheHandler } from "cache-handlers";

async function upstream(req: Request) {
	return new Response("Hello World", {
		headers: {
			// Fresh for 60s, allow serving stale for 5m while background refresh runs
			"cache-control": "public, max-age=60, stale-while-revalidate=300",
			// Tag for later invalidation
			"cache-tag": "home, content",
		},
	});
}

const handle = createCacheHandler({
	cacheName: "app-cache",
	handler: upstream,
	features: { conditionalRequests: { etag: "generate" } },
});

addEventListener("fetch", (event: FetchEvent) => {
	event.respondWith(handle(event.request));
});
```

### Lifecycle

1. Request arrives; cache checked (GET only is cached)
2. Miss -> `handler` runs, response cached
3. Hit & still fresh -> served instantly
4. Expired but inside `stale-while-revalidate` window -> stale response served, background revalidation queued
5. Conditional client request (If-None-Match / If-Modified-Since) may yield a 304

## Node 20+ Usage (Undici Polyfill)

Node 20 ships `fetch` et al, but _not_ `caches` yet. Use `undici` to polyfill CacheStorage.

```ts
import { createServer } from "node:http";
import { caches, install } from "undici"; // polyfills
import { createCacheHandler } from "cache-handlers";

if (!globalThis.caches) {
	// @ts-ignore
	globalThis.caches = caches as unknown as CacheStorage;
}
install(); // idempotent

const handle = createCacheHandler({
	cacheName: "node-cache",
	handler: (req) => fetch(req),
	features: { conditionalRequests: { etag: "generate" } },
});

createServer(async (req, res) => {
	const request = new Request(`http://localhost:3000${req.url}`, {
		method: req.method,
		headers: req.headers as HeadersInit,
	});

	const response = await handle(request);
	res.statusCode = response.status;
	response.headers.forEach((v, k) => res.setHeader(k, v));
	if (response.body) {
		const buf = Buffer.from(await response.arrayBuffer());
		res.end(buf);
	} else res.end();
}).listen(3000, () => console.log("Listening on :3000"));
```

## Other Runtimes

### Cloudflare Workers

```ts
import { createCacheHandler } from "cache-handlers";

const handle = createCacheHandler({
	cacheName: "cf-cache",
	handler: (req) => fetch(req),
});

export default { fetch: (req: Request) => handle(req) };
```

### Netlify Edge

```ts
import { createCacheHandler } from "cache-handlers";
export default createCacheHandler({ handler: (r) => fetch(r) });
```

### Deno / Deploy

```ts
import { createCacheHandler } from "cache-handlers";
const handle = createCacheHandler({ handler: (r) => fetch(r) });
Deno.serve((req) => handle(req));
```

## SWR (Stale-While-Revalidate)

Just send the directive in your upstream response:

```http
Cache-Control: public, max-age=30, stale-while-revalidate=300
```

No custom headers are added. While inside the SWR window the _stale_ cached response is returned immediately and a background revalidation run is triggered (if a `handler` was supplied).

To use a runtime scheduler (eg Workers' `event.waitUntil`):

```ts
addEventListener("fetch", (event) => {
	const handle = createCacheHandler({
		handler: (r) => fetch(r),
		runInBackground: (p) => event.waitUntil(p),
	});
	event.respondWith(handle(event.request));
});
```

## Invalidation

Tag and path invalidation helpers work against the same underlying cache.

```ts
import {
	invalidateByTag,
	invalidateByPath,
	invalidateAll,
	getCacheStats,
} from "cache-handlers";

await invalidateByTag("home");
await invalidateByPath("/docs/intro");
const removed = await invalidateAll();
const stats = await getCacheStats();
console.log(stats.totalEntries, stats.entriesByTag);
```

## Configuration Overview (`CreateCacheHandlerOptions`)

| Option                                      | Purpose                                                  |
| ------------------------------------------- | -------------------------------------------------------- |
| `cacheName`                                 | Named cache to open (default `cache-primitives-default`) |
| `cache`                                     | Provide a `Cache` instance directly                      |
| `handler`                                   | Function invoked on misses / background revalidation     |
| `revalidationHandler`                       | Alternate function used only for background refresh      |
| `defaultTtl`                                | Fallback TTL (seconds) when no cache headers present     |
| `maxTtl`                                    | Upper bound to clamp any TTL (seconds)                   |
| `getCacheKey`                               | Custom key generator `(request) => string`               |
| `runInBackground`                           | Scheduler for SWR tasks (eg `waitUntil`)                 |
| `features.conditionalRequests`              | `true`, `false` or config object (ETag, Last-Modified)   |
| `features.cacheTags`                        | Enable `Cache-Tag` parsing (default true)                |
| `features.cacheVary`                        | Enable `Cache-Vary` parsing (default true)               |
| `features.vary`                             | Respect standard `Vary` header (default true)            |
| `features.cacheControl` / `cdnCacheControl` | Header support toggles                                   |

Minimal example:

```ts
createCacheHandler({ handler: (r) => fetch(r) });
```

## Conditional Requests (ETag / Last-Modified)

Enable with auto ETag generation:

```ts
createCacheHandler({
	handler: (r) => fetch(r),
	features: { conditionalRequests: { etag: "generate", lastModified: true } },
});
```

### Stand‑alone Helpers

Exported for advanced/manual workflows:

```ts
import {
	generateETag,
	parseETag,
	compareETags,
	validateConditionalRequest,
	create304Response,
	getDefaultConditionalConfig,
} from "cache-handlers";
```

Example manual validation:

```ts
const cached = new Response("data", {
	headers: { etag: await generateETag(new Response("data")) },
});
const validation = validateConditionalRequest(request, cached);
if (validation.shouldReturn304) return create304Response(cached);
```

## Backend-Driven Variations (`Cache-Vary` – custom header)

`Cache-Vary` is a _non-standard_, library-specific response header. It augments the standard `Vary` mechanism by letting you list only the precise components you want included in the cache key (headers, cookies, query params) without emitting a large `Vary` header externally. The library consumes & strips it when constructing the internal key.

Add selective vary dimensions without inflating the standard `Vary` header:

```http
Cache-Vary: header=Accept-Language, cookie=session_id, query=version
```

Each listed dimension becomes part of the derived cache key. Standard `Vary` remains fully respected; `Cache-Vary` is additive and internal – safe to use even if unknown to intermediaries.

## Types

```ts
import type {
	CacheConfig,
	CreateCacheHandlerOptions,
	CacheHandle,
	CacheHandleOptions,
	InvalidationOptions,
	ConditionalRequestConfig,
	HandlerFunction,
	HandlerInfo,
	HandlerMode,
} from "cache-handlers";
```

## Best Practices

1. Always bound TTLs with `maxTtl`.
2. Use `stale-while-revalidate` for latency-sensitive endpoints.
3. Include cache tags for selective purge (`cache-tag: user:123, list:users`).
4. Generate or preserve ETags to leverage client 304s.
5. Keep cache keys stable & explicit if customizing via `getCacheKey`.

## Troubleshooting

| Symptom               | Check                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| Response never cached | Ensure it's a GET and has `Cache-Control`/`CDN-Cache-Control` permitting caching (no `no-store`/`private`) |
| Invalidation no-op    | Response needs a `Cache-Tag` matching the tag you pass                                                     |
| SWR not triggering    | Make sure `stale-while-revalidate` directive is present and entry has expired `max-age`                    |
| 304s never served     | Enable `conditionalRequests` and return `ETag` or `Last-Modified`                                          |

## Changelog (Summary)

### 0.1.0

- Unified `createCacheHandler` (replaces separate read/write/middleware APIs)
- Directive-based SWR (no custom headers)
- Tag & path invalidation + stats
- Conditional requests (ETag / Last-Modified / 304 generation)
- Backend-driven variation via `Cache-Vary`
- Cross-runtime compatibility (Workers / Netlify / Deno / Node+Undici / workerd)

## License

MIT

---

Have ideas / issues? PRs welcome.
