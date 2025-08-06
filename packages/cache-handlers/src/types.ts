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

// CacheMetadata removed - now using standard HTTP headers instead

/**
 * Parsed cache header information from a Response.
 * Contains all caching directives and metadata extracted from HTTP headers.
 *
 * @example
 * ```typescript
 * const parsed: ParsedCacheHeaders = {
 *   shouldCache: true,
 *   ttl: 3600,
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
 * Handler that checks for cached responses using standard HTTP headers.
 *
 * Includes robust error handling for corrupted metadata and automatic
 * cache validation using the Expires header. Returns null if no valid
 * cached response is found.
 *
 * @example
 * ```typescript
 * const readHandler: ReadHandler = createReadHandler();
 * const request = new Request("https://api.example.com/users");
 * const cachedResponse = await readHandler(request);
 *
 * if (cachedResponse) {
 *   console.log("Cache hit!");
 *   return cachedResponse;
 * }
 * ```
 */
export interface ReadHandler {
	(request: Request): Promise<Response | null>;
}

/**
 * Handler that caches responses using both request and response context.
 *
 * The request parameter enables proper cache key generation and supports
 * request-aware caching strategies. Uses standard HTTP headers for cache
 * metadata and includes comprehensive input validation.
 *
 * @example
 * ```typescript
 * const writeHandler: WriteHandler = createWriteHandler();
 * const request = new Request("https://api.example.com/users");
 * const response = new Response(JSON.stringify({users: []}), {
 *   headers: {
 *     "cache-control": "max-age=3600, public",
 *     "cache-tag": "users, api"
 *   }
 * });
 *
 * const cachedResponse = await writeHandler(request, response);
 * ```
 */
export interface WriteHandler {
	(request: Request, response: Response): Promise<Response>;
}

/**
 * Middleware handler that combines read and write operations.
 *
 * Automatically manages the complete cache flow: checks for cached responses
 * first, then processes fresh responses through the write handler if no
 * cached version exists.
 *
 * @example
 * ```typescript
 * const middlewareHandler: MiddlewareHandler = createMiddlewareHandler();
 *
 * const response = await middlewareHandler(request, async () => {
 *   // Your application logic here
 *   return new Response("Hello World", {
 *     headers: {
 *       "cache-control": "max-age=300, public",
 *       "cache-tag": "greeting"
 *     }
 *   });
 * });
 * ```
 */
export interface MiddlewareHandler {
	(request: Request, next: () => Promise<Response>): Promise<Response>;
}

/**
 * Collection of all cache handler types.
 * Returned by the createCacheHandlers factory function.
 */
export interface CacheHandlers {
	read: ReadHandler;
	write: WriteHandler;
	middleware: MiddlewareHandler;
}

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
