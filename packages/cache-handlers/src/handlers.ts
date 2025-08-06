import type {
	CacheConfig,
	MiddlewareHandler,
	ReadHandler,
	WriteHandler,
} from "./types.ts";
import {
	defaultGetCacheKey,
	getCache,
	parseResponseHeaders,
	removeHeaders,
	validateCacheTags,
} from "./utils.ts";
import {
	validateConditionalRequest,
	create304Response,
	getDefaultConditionalConfig,
	generateETag,
} from "./conditional.ts";
import { updateTagMetadata, updateVaryMetadata } from "./metadata.ts";
import { safeJsonParse } from "./errors.ts";

const METADATA_KEY = "https://cache-internal/cache-primitives-metadata";
const VARY_METADATA_KEY = "https://cache-internal/cache-vary-metadata";

/**
 * Create a cache reading handler that checks for cached responses.
 *
 * Uses standard HTTP headers (Expires) for cache validation and includes
 * robust error handling for corrupted metadata. The handler automatically
 * cleans up expired or corrupted cache entries.
 *
 * @param config - The cache configuration options
 * @returns A read handler function that returns cached response or null
 *
 * @example
 * ```typescript
 * const readHandler = createReadHandler({
 *   cacheName: "api-cache",
 *   features: { cacheTags: true }
 * });
 *
 * const request = new Request("https://api.example.com/users");
 * const cachedResponse = await readHandler(request);
 *
 * if (cachedResponse) {
 *   console.log("Cache hit - serving from cache");
 *   return cachedResponse;
 * } else {
 *   console.log("Cache miss - need to fetch fresh data");
 * }
 * ```
 */
export function createReadHandler(config: CacheConfig = {}): ReadHandler {
	const getCacheKey = config.getCacheKey || defaultGetCacheKey;

	return async (request: Request): Promise<Response | null> => {
		// Only support GET requests for caching
		if (request.method !== "GET") {
			return null; // Non-GET requests are never cached
		}

		const cache = await getCache(config);
		const varyMetadataResponse = await cache.match(VARY_METADATA_KEY);
		let varyMetadata: Record<string, any> = {};
		varyMetadata = await safeJsonParse(
			varyMetadataResponse?.clone() || null,
			{} as Record<string, any>,
			"vary metadata parsing in read handler",
		);

		const vary = varyMetadata[request.url];
		const cacheKey = await getCacheKey(request, vary);
		const cacheRequest = new Request(cacheKey);

		const cachedResponse = await cache.match(cacheRequest);
		if (!cachedResponse) {
			return null;
		}

		// Check expiration first
		const expiresHeader = cachedResponse.headers.get("expires");
		if (expiresHeader) {
			const expiresAt = new Date(expiresHeader);
			if (Date.now() >= expiresAt.getTime()) {
				await cache.delete(cacheRequest);
				return null;
			}
		}

		// Handle conditional requests (If-None-Match, If-Modified-Since)
		const features = config.features ?? {};
		if (features.conditionalRequests !== false) {
			const conditionalConfig =
				typeof features.conditionalRequests === "object"
					? features.conditionalRequests
					: getDefaultConditionalConfig();

			const validation = validateConditionalRequest(
				request,
				cachedResponse,
				conditionalConfig,
			);

			if (validation.shouldReturn304) {
				return create304Response(cachedResponse);
			}
		}

		return cachedResponse;
	};
}

/**
 * Create a cache writing handler that processes both request and response.
 *
 * The handler requires request context to enable proper cache key generation
 * and supports standard HTTP headers for caching directives. It automatically
 * parses cache headers, validates tags, and stores responses with proper
 * expiration metadata.
 *
 * @param config - The cache configuration options
 * @returns A write handler function that accepts (request, response) parameters
 *
 * @example
 * ```typescript
 * const writeHandler = createWriteHandler({
 *   maxTtl: 86400, // 24 hours max
 *   features: { cacheTags: true, cacheControl: true }
 * });
 *
 * const request = new Request("https://api.example.com/users");
 * const response = new Response(JSON.stringify({ users: [] }), {
 *   headers: {
 *     "content-type": "application/json",
 *     "cache-control": "max-age=3600, public",
 *     "cache-tag": "users, api"
 *   }
 * });
 *
 * // Cache the response and return cleaned version
 * const cleanedResponse = await writeHandler(request, response);
 * // Note: cache-tag header is removed from returned response
 * ```
 */
export function createWriteHandler(config: CacheConfig = {}): WriteHandler {
	const getCacheKey = config.getCacheKey || defaultGetCacheKey;

	return async (request: Request, response: Response): Promise<Response> => {
		// Only support GET requests for caching
		if (request.method !== "GET") {
			return response; // Return response as-is for non-GET requests
		}

		const cache = await getCache(config);
		const cacheInfo = parseResponseHeaders(response, config);

		if (!cacheInfo.shouldCache) {
			return removeHeaders(response, cacheInfo.headersToRemove);
		}

		const cacheKey = await getCacheKey(request, cacheInfo.vary);

		const responseToCache = response.clone();
		const headers = new Headers(responseToCache.headers);

		// Handle ETag generation if needed
		if (cacheInfo.shouldGenerateETag) {
			const features = config.features ?? {};
			const conditionalConfig =
				typeof features.conditionalRequests === "object"
					? features.conditionalRequests
					: {};

			if (conditionalConfig.etagGenerator) {
				const etag = await conditionalConfig.etagGenerator(responseToCache);
				headers.set("etag", etag);
			} else {
				const etag = await generateETag(responseToCache);
				headers.set("etag", etag);
			}
		}

		if (cacheInfo.ttl) {
			const expiresAt = new Date(Date.now() + cacheInfo.ttl * 1000);
			headers.set("expires", expiresAt.toUTCString());
		}

		if (cacheInfo.tags.length > 0) {
			const validatedTags = validateCacheTags(cacheInfo.tags);
			headers.set("cache-tag", validatedTags.join(", "));
		}

		const cacheResponse = new Response(responseToCache.body, {
			status: responseToCache.status,
			statusText: responseToCache.statusText,
			headers,
		});

		const cacheRequest = new Request(cacheKey);
		await cache.put(cacheRequest, cacheResponse);

		if (cacheInfo.tags.length > 0) {
			const validatedTags = validateCacheTags(cacheInfo.tags);
			// Use the same key that's actually stored in cache (normalized URL)
			const actualCacheKey = cacheRequest.url;

			// Use atomic metadata update to prevent race conditions
			await updateTagMetadata(
				cache,
				METADATA_KEY,
				validatedTags,
				actualCacheKey,
			);
		}

		if (cacheInfo.vary) {
			// Use atomic metadata update with built-in memory leak prevention
			await updateVaryMetadata(
				cache,
				VARY_METADATA_KEY,
				request.url,
				cacheInfo.vary,
			);
		}

		return removeHeaders(response, cacheInfo.headersToRemove);
	};
}

/**
 * Create a middleware handler that combines read and write operations.
 *
 * Automatically checks cache first, then processes the response through
 * the write handler if no cached version exists. This provides a complete
 * caching solution with a single function call.
 *
 * @param config - The cache configuration options
 * @returns A middleware handler function that manages the complete cache flow
 *
 * @example
 * ```typescript
 * const middlewareHandler = createMiddlewareHandler({
 *   cacheName: "app-cache",
 *   defaultTtl: 300,
 *   maxTtl: 3600
 * });
 *
 * // Use with any web framework
 * const response = await middlewareHandler(request, async () => {
 *   // Your application logic here
 *   const data = await fetchUserData();
 *   return new Response(JSON.stringify(data), {
 *     headers: {
 *       "content-type": "application/json",
 *       "cache-control": "max-age=1800, public",
 *       "cache-tag": "users, api"
 *     }
 *   });
 * });
 *
 * // Returns cached response if available, otherwise executes next()
 * // and caches the result for future requests
 * ```
 */
export function createMiddlewareHandler(
	config: CacheConfig = {},
): MiddlewareHandler {
	const readHandler = createReadHandler(config);
	const writeHandler = createWriteHandler(config);

	return async (
		request: Request,
		next: () => Promise<Response>,
	): Promise<Response> => {
		const cachedResponse = await readHandler(request);
		if (cachedResponse) {
			return cachedResponse;
		}

		const response = await next();

		return writeHandler(request, response);
	};
}
