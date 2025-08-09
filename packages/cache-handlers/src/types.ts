/**
 * Configuration options for cache handlers.
 *
 * @example
 * ```typescript
 * const config: CacheConfig = {
 *   cacheName: "my-app-cache",
 *   defaultTtl: 300,
 *   maxTtl: 86400,
 *   features: {
 *     cacheTags: true,
 *     cacheControl: true
 *   }
 * };
 * ```
 */
export interface CacheConfig {
	/**
	 * Name of the cache to use
	 * @default "cache-primitives-default"
	 */
	cacheName?: string;

	/**
	 * Cache instance to use instead of opening by name
	 */
	cache?: Cache;

	/**
	 * Custom function to generate a cache key from a request.
	 * This allows for more advanced cache key generation strategies.
	 */
	getCacheKey?: (request: Request) => Promise<string> | string;

	/**
	 * Features to enable/disable
	 */
	features?: {
		/**
		 * Support Cache-Control header
		 * @default true
		 */
		cacheControl?: boolean;

		/**
		 * Support CDN-Cache-Control header
		 * @default true
		 */
		cdnCacheControl?: boolean;

		/**
		 * Support Cache-Tag header for invalidation
		 * @default true
		 */
		cacheTags?: boolean;

		/**
		 * Support Vary header for cache key generation
		 * @default true
		 */
		vary?: boolean;

		/**
		 * Support cache-vary header for backend-driven cache variations.
		 * @default true
		 */
		cacheVary?: boolean;

		/**
		 * Support HTTP conditional requests (ETag, Last-Modified, 304 responses)
		 * @default true
		 */
		conditionalRequests?: boolean | ConditionalRequestConfig;
	};

	/**
	 * Default TTL in seconds when no cache headers are present
	 * @default undefined (no caching without explicit headers)
	 */
	defaultTtl?: number;

	/**
	 * Maximum TTL in seconds to prevent excessive caching
	 * @default 31536000 (1 year)
	 */
	maxTtl?: number;

	/**
	 * WaitUntil handler for background tasks (like revalidation).
	 * Similar to Cloudflare Workers' ctx.waitUntil().
	 * Allows the platform to keep processes alive for background work.
	 * If not provided, queueMicrotask will be used as fallback.
	 */
	waitUntil?: (promise: Promise<unknown>) => void;
}

/**
 * Configuration for HTTP conditional requests support.
 *
 * @example
 * ```typescript
 * const config: ConditionalRequestConfig = {
 *   etag: 'generate', // Generate ETags for responses without them
 *   lastModified: true, // Support Last-Modified headers
 *   weakValidation: true, // Support weak ETag validation
 *   etagGenerator: (response) => generateMD5Hash(response.body)
 * };
 * ```
 */
export interface ConditionalRequestConfig {
	/**
	 * ETag support configuration
	 * - true: Preserve existing ETags only
	 * - 'generate': Generate ETags for responses without them
	 * - 'preserve-only': Only preserve existing ETags, don't generate
	 * @default true
	 */
	etag?: boolean | "generate" | "preserve-only";

	/**
	 * Support Last-Modified headers for conditional requests
	 * @default true
	 */
	lastModified?: boolean;

	/**
	 * Support weak ETag validation (W/ prefix)
	 * @default true
	 */
	weakValidation?: boolean;

	/**
	 * Custom ETag generation function
	 * Only used when etag is 'generate'
	 */
	etagGenerator?: (response: Response) => string | Promise<string>;
}

/**
 * Conditional request validation result
 */
export interface ConditionalValidationResult {
	/**
	 * Whether the cached resource matches the conditional request
	 */
	matches: boolean;

	/**
	 * Whether to return a 304 Not Modified response
	 */
	shouldReturn304: boolean;

	/**
	 * The validator that matched (etag or last-modified)
	 */
	matchedValidator?: "etag" | "last-modified";
}

/**
 * Cache vary rules for request-specific caching.
 * Allows responses to specify which request attributes should affect the cache key.
 *
 * @example
 * ```typescript
 * const vary: CacheVary = {
 *   headers: ["Accept-Language", "User-Agent"],
 *   cookies: ["session_id", "user_pref"],
 *   query: ["version", "format"]
 * };
 * ```
 */
export interface CacheVary {
	headers: string[];
	cookies: string[];
	query: string[];
}

/**
 * Parsed cache header information from a Response.
 * Contains all caching directives and metadata extracted from HTTP headers.
 *
 * @example
 * ```typescript
 * const parsed: ParsedCacheHeaders = {
 *   shouldCache: true,
 *   ttl: 3600,
 *   staleWhileRevalidate: 86400,
 *   tags: ["user:123", "api"],
 *   isPrivate: false,
 *   noCache: false,
 *   noStore: false,
 *   headersToRemove: ["cache-tag", "cdn-cache-control"]
 * };
 * ```
 */
export interface ParsedCacheHeaders {
	/**
	 * Whether the response should be cached
	 */
	shouldCache: boolean;

	/**
	 * TTL in seconds
	 */
	ttl?: number;

	/**
	 * Stale-while-revalidate duration in seconds.
	 * If present, allows serving stale content for this duration after expiration
	 * while fetching fresh content in the background.
	 */
	staleWhileRevalidate?: number;

	/**
	 * Cache tags
	 */
	tags: string[];

	/**
	 * Parsed cache-vary rules.
	 */
	vary?: CacheVary;

	/**
	 * Headers to remove from the response after processing
	 */
	headersToRemove: string[];

	/**
	 * Whether the response is private (not cacheable)
	 */
	isPrivate: boolean;

	/**
	 * Whether the response has no-cache directive
	 */
	noCache: boolean;

	/**
	 * Whether the response has no-store directive
	 */
	noStore: boolean;

	/**
	 * ETag value for conditional requests
	 */
	etag?: string;

	/**
	 * Last-Modified date for conditional requests
	 */
	lastModified?: string;

	/**
	 * Whether ETag should be generated if not present
	 */
	shouldGenerateETag?: boolean;
}

/**
 * Render / handling mode information passed to user handler.
 * - miss: cache miss foreground render
 * - stale: background refresh in progress
 * - manual: manual revalidation trigger
 */
export type HandlerMode = "miss" | "stale" | "manual";

export interface HandlerInfo {
	mode: HandlerMode;
	background: boolean;
}

/**
 * User provided handler function.
 */
export type HandlerFunction = (
	request: Request,
	info: HandlerInfo,
) => Promise<Response> | Response;

/**
 * SWR policy (reserved for future strategies).
 */
export type SWRPolicy = "background" | "blocking" | "off";

/**
 * Options for createCacheHandler. Extends CacheConfig with higher-level
 * handler settings. SWR behaviour beyond simple miss handling will be
 * added in subsequent iterations.
 */
export interface CreateCacheHandlerOptions extends CacheConfig {
	/** Default handler used on cache misses. */
	handler?: HandlerFunction;

	/** SWR policy (future). */
	swr?: SWRPolicy;

	/** Deduplication window (ms) for background revalidation. */
	dedupeMs?: number;

	/**
	 * Background scheduler analogous to waitUntil.
	 */
	runInBackground?: (p: Promise<unknown>) => void;
}

export interface CacheHandleFunctionOptions {
	handler?: HandlerFunction;
	runInBackground?: (p: Promise<unknown>) => void;
	swr?: SWRPolicy;
}
/**
 * Call options for createCacheHandler returned function.
 */
export interface CacheHandleOptions extends CacheHandleFunctionOptions {}

/**
 * Bare cache handle function returned by createCacheHandler.
 * Performs read -> (miss -> handler -> write) flow. No attached methods.
 */
export type CacheHandle = (
	request: Request,
	options?: CacheHandleOptions,
) => Promise<Response>;

/**
 * Options for cache invalidation operations.
 *
 * @example
 * ```typescript
 * const options: InvalidationOptions = {
 *   cacheName: "my-custom-cache"
 * };
 *
 * await invalidateByTag("users", options);
 * ```
 */
export interface InvalidationOptions {
	/**
	 * Cache instance to invalidate from
	 */
	cache?: Cache;

	/**
	 * Cache name to open and invalidate from
	 * @default "cache-primitives-default"
	 */
	cacheName?: string;
}
