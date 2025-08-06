import type {
	CacheConfig,
	CacheVary,
	InvalidationOptions,
	ParsedCacheHeaders,
	ConditionalRequestConfig,
} from "./types.ts";

const DEFAULT_CACHE_NAME = "cache-primitives-default";

/**
 * Get a cache instance based on the provided options.
 *
 * @param options - The options containing the cache or cache name
 * @returns A promise resolving to a Cache instance
 *
 * @example
 * ```typescript
 * // Using default cache name
 * const cache = await getCache();
 *
 * // Using custom cache name
 * const cache = await getCache({ cacheName: "my-cache" });
 *
 * // Using existing cache instance
 * const existingCache = await caches.open("existing");
 * const cache = await getCache({ cache: existingCache });
 * ```
 */
export async function getCache(
	options: InvalidationOptions = {},
): Promise<Cache> {
	return (
		options.cache ??
		(await caches.open(options.cacheName ?? DEFAULT_CACHE_NAME))
	);
}

/**
 * Parse cache control directives from a header value.
 *
 * Handles both simple boolean directives (like "public", "private") and
 * key-value directives (like "max-age=3600"). Numeric values are automatically
 * converted to numbers.
 *
 * @param headerValue - The value of the Cache-Control header
 * @returns A record of cache control directives
 *
 * @example
 * ```typescript
 * const directives = parseCacheControl("max-age=3600, public, must-revalidate");
 * // Returns: { "max-age": 3600, "public": true, "must-revalidate": true }
 *
 * const complexDirectives = parseCacheControl('private, max-age=0, s-maxage="300"');
 * // Returns: { "private": true, "max-age": 0, "s-maxage": "300" }
 * ```
 */
export function parseCacheControl(
	headerValue: string,
): Record<string, string | number | boolean> {
	const directives: Record<string, string | number | boolean> = {};
	const parts = headerValue.split(",").map((part) => part.trim());

	for (const part of parts) {
		const [key, value] = part.split("=", 2);
		if (!key) continue;
		const cleanKey = key.trim().toLowerCase();

		if (value !== undefined) {
			const cleanValue = value.trim().replace(/^["']|["']$/g, "");
			directives[cleanKey] = isNaN(Number(cleanValue))
				? cleanValue
				: Number(cleanValue);
		} else {
			directives[cleanKey] = true;
		}
	}

	return directives;
}

/**
 * Parse cache tags from the standard Cache-Tag header.
 *
 * Handles both comma-space and comma-only separators for flexibility.
 * Empty tags are filtered out and all tags are trimmed of whitespace.
 *
 * @param headerValue - The value of the Cache-Tag header
 * @returns An array of cleaned cache tag strings
 *
 * @example
 * ```typescript
 * const tags = parseCacheTags("user:123, post:456, api");
 * // Returns: ["user:123", "post:456", "api"]
 *
 * const tagsWithSpaces = parseCacheTags(" user , , post , api ");
 * // Returns: ["user", "post", "api"] (empty tags filtered out)
 *
 * const commaOnly = parseCacheTags("user,post,api");
 * // Returns: ["user", "post", "api"]
 * ```
 */
export function parseCacheTags(headerValue: string): string[] {
	// Parse tags with flexible comma handling
	// Prefer ", " (comma + space) separation, fallback to plain comma
	let tags: string[];
	if (headerValue.includes(", ")) {
		tags = headerValue.split(", ");
	} else {
		tags = headerValue.split(",");
	}

	return tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0);
}

/**
 * Parse the cache-vary header for backend-driven cache variations.
 *
 * Supports header, cookie, and query parameter variations that affect
 * cache key generation. Multiple directives can be comma-separated.
 *
 * @param headerValue - The value of the cache-vary header
 * @returns The parsed cache-vary rules
 *
 * @example
 * ```typescript
 * const vary = parseCacheVaryHeader("header=Accept-Language, cookie=session_id, query=version");
 * // Returns: {
 * //   headers: ["Accept-Language"],
 * //   cookies: ["session_id"],
 * //   query: ["version"]
 * // }
 *
 * const multipleHeaders = parseCacheVaryHeader("header=Accept, header=User-Agent, cookie=theme");
 * // Returns: {
 * //   headers: ["Accept", "User-Agent"],
 * //   cookies: ["theme"],
 * //   query: []
 * // }
 * ```
 */
export function parseCacheVaryHeader(headerValue: string): CacheVary {
	const vary: CacheVary = { headers: [], cookies: [], query: [] };

	// Parse comma-separated cache-vary directives
	const directives = headerValue
		.split(",")
		.map((d) => d.trim())
		.filter((d) => d.length > 0);

	for (const directive of directives) {
		const equalIndex = directive.indexOf("=");
		if (equalIndex === -1) continue;

		const type = directive.substring(0, equalIndex).trim();
		const value = directive.substring(equalIndex + 1).trim();

		if (type === "header") {
			vary.headers.push(value);
		} else if (type === "cookie") {
			vary.cookies.push(value);
		} else if (type === "query") {
			vary.query.push(value);
		}
	}

	return vary;
}

/**
 * Parse standard HTTP cache headers from a Response to determine caching behavior.
 *
 * Supports Cache-Control, CDN-Cache-Control, Cache-Tag, and cache-vary headers.
 * Prioritizes CDN-Cache-Control over Cache-Control for CDN-aware caching. Includes
 * comprehensive validation and security checks.
 *
 * @param response - The response to parse headers from
 * @param config - The cache configuration options
 * @returns Parsed cache header information with security validation applied
 *
 * @example
 * ```typescript
 * const response = new Response("data", {
 *   headers: {
 *     "cache-control": "max-age=3600, public",
 *     "cache-tag": "user:123, api",
 *     "cdn-cache-control": "max-age=7200"
 *   }
 * });
 *
 * const parsed = parseResponseHeaders(response);
 * // Returns: {
 * //   shouldCache: true,
 * //   ttl: 7200, // CDN-Cache-Control takes precedence
 * //   tags: ["user:123", "api"],
 * //   headersToRemove: ["cdn-cache-control", "cache-tag"],
 * //   isPrivate: false,
 * //   noCache: false,
 * //   noStore: false
 * // }
 * ```
 */
export function parseResponseHeaders(
	response: Response,
	config: CacheConfig = {},
): ParsedCacheHeaders {
	const result: ParsedCacheHeaders = {
		shouldCache: false,
		tags: [],
		headersToRemove: [],
		isPrivate: false,
		noCache: false,
		noStore: false,
	};

	const { headers } = response;
	const features = config.features ?? {};

	const cacheControlHeader =
		features.cacheControl !== false ? headers.get("cache-control") : null;
	const cdnCacheControlHeader =
		features.cdnCacheControl !== false
			? headers.get("cdn-cache-control")
			: null;

	const finalCacheControl = cdnCacheControlHeader || cacheControlHeader;

	if (cdnCacheControlHeader) {
		result.headersToRemove.push("cdn-cache-control");
	}

	if (finalCacheControl) {
		const directives = parseCacheControl(finalCacheControl);
		result.isPrivate = !!directives.private;
		result.noCache = !!directives["no-cache"];
		result.noStore = !!directives["no-store"];

		if (typeof directives["max-age"] === "number") {
			result.ttl = directives["max-age"];
		}
	}

	if (features.cacheTags !== false) {
		const cacheTag = headers.get("cache-tag");
		if (cacheTag) {
			result.tags = parseCacheTags(cacheTag);
			result.headersToRemove.push("cache-tag");
		}
	}

	if (features.cacheVary !== false) {
		const cacheVary = headers.get("cache-vary");
		if (cacheVary) {
			result.vary = parseCacheVaryHeader(cacheVary);
			result.headersToRemove.push("cache-vary");
		}
	}

	// Handle conditional request headers
	if (features.conditionalRequests !== false) {
		const etag = headers.get("etag");
		const lastModified = headers.get("last-modified");

		if (etag) {
			result.etag = etag;
			// Don't remove ETag header - it should be preserved in cached response
		}

		if (lastModified) {
			result.lastModified = lastModified;
			// Don't remove Last-Modified header - it should be preserved in cached response
		}

		// Determine if we should generate ETag if missing
		const conditionalConfig =
			typeof features.conditionalRequests === "object"
				? features.conditionalRequests
				: {};

		if (!etag && conditionalConfig.etag === "generate") {
			result.shouldGenerateETag = true;
		}
	}

	// Cache only when explicitly allowed by headers (no implicit caching)
	const hasExplicitCacheHeaders =
		!!finalCacheControl ||
		!!headers.get("cache-tag") ||
		!!headers.get("expires");
	result.shouldCache =
		hasExplicitCacheHeaders &&
		!result.isPrivate &&
		!result.noCache &&
		!result.noStore;

	if (result.shouldCache && !result.ttl && config.defaultTtl) {
		result.ttl = config.defaultTtl;
	}

	if (!result.ttl || result.ttl <= 0) {
		result.shouldCache = false;
	}

	if (result.ttl && config.maxTtl && result.ttl > config.maxTtl) {
		result.ttl = config.maxTtl;
	}

	return result;
}

/**
 * Default implementation for generating a cache key from a Request.
 *
 * Generates a cache key based on the request method and pathname, with optional
 * vary rules for request-specific caching. The key format is optimized for
 * efficient lookup and collision avoidance.
 *
 * @param request - The request to generate a key for
 * @param vary - Optional cache-vary rules for request-specific variations
 * @returns The generated cache key string
 *
 * @example
 * ```typescript
 * const request = new Request("https://api.example.com/users?page=1");
 * const key = defaultGetCacheKey(request);
 * // Returns: "GET:/users"
 *
 * const vary: CacheVary = {
 *   headers: ["Accept-Language"],
 *   cookies: ["theme"],
 *   query: ["page"]
 * };
 * const varyKey = defaultGetCacheKey(request, vary);
 * // Returns: "GET:/users|header=accept-language:en|cookie=theme:dark|query=page:1"
 * ```
 */
export function defaultGetCacheKey(request: Request, vary?: CacheVary): string {
	const url = new URL(request.url);
	let key = `${url.origin}${url.pathname}`;

	if (vary) {
		const varyParts: string[] = [];

		if (vary.query.length > 0) {
			const searchKey = new URLSearchParams();
			const sortedQueries = vary.query.sort((a, b) => a.localeCompare(b));
			for (const queryName of sortedQueries) {
				const value = url.searchParams.get(queryName) || "";
				searchKey.set(queryName, value);
			}
			key += `?${searchKey.toString()}`;
		}

		if (vary.headers.length > 0) {
			for (const headerName of vary.headers) {
				const value = request.headers.get(headerName) || "";
				varyParts.push(`header-${headerName.toLowerCase()}=${value}`);
			}
		}

		if (vary.cookies.length > 0) {
			const cookies = request.headers.get("cookie") || "";
			const cookieMap = new Map<string, string>(
				cookies.split(";").map((c) => {
					const [key, ...value] = c.trim().split("=");
					return [key || "", value.join("=")];
				}),
			);
			for (const cookieName of vary.cookies) {
				const value = cookieMap.get(cookieName) || "";
				varyParts.push(`cookie-${cookieName}=${value}`);
			}
		}
		if (varyParts.length > 0) {
			key += `|${varyParts.join("|")}`;
		}
	} else {
		key += url.search;
	}

	return key;
}

/**
 * Create a new Response with specified headers removed.
 *
 * Creates a new Response instance with the same body, status, and statusText,
 * but with specified headers removed. Used to clean cache-specific headers
 * from responses before returning to clients.
 *
 * @param response - The original response
 * @param headersToRemove - Array of header names to remove (case-insensitive)
 * @returns A new response without the specified headers
 *
 * @example
 * ```typescript
 * const response = new Response("data", {
 *   headers: {
 *     "content-type": "application/json",
 *     "cache-tag": "user:123",
 *     "cdn-cache-control": "max-age=3600"
 *   }
 * });
 *
 * const cleaned = removeHeaders(response, ["cache-tag", "cdn-cache-control"]);
 * // Returned response only has "content-type" header
 * ```
 */
export function removeHeaders(
	response: Response,
	headersToRemove: string[],
): Response {
	if (headersToRemove.length === 0) {
		return response;
	}

	const newHeaders = new Headers(response.headers);
	for (const headerName of headersToRemove) {
		newHeaders.delete(headerName);
	}

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: newHeaders,
	});
}

/**
 * Check if a cached response is still valid using the Expires header.
 *
 * Compares the Expires header timestamp against the current time to determine
 * if a cached response is still valid. Invalid dates are treated as never
 * expiring for backward compatibility.
 *
 * @param expiresHeader - The value of the Expires header (RFC 2822 format)
 * @returns True if the cache is valid (not expired), false if expired
 *
 * @example
 * ```typescript
 * const futureDate = new Date(Date.now() + 3600000).toUTCString();
 * const valid = isCacheValid(futureDate);
 * // Returns: true
 *
 * const pastDate = new Date(Date.now() - 3600000).toUTCString();
 * const expired = isCacheValid(pastDate);
 * // Returns: false
 *
 * const invalid = isCacheValid("invalid-date");
 * // Returns: true (treats invalid dates as never expiring)
 *
 * const missing = isCacheValid(null);
 * // Returns: true (no expiration specified)
 * ```
 */
export function isCacheValid(expiresHeader: string | null): boolean {
	if (!expiresHeader) return true;
	const expiresAt = new Date(expiresHeader);
	// Invalid dates are treated as never expiring for safety
	if (isNaN(expiresAt.getTime())) return true;
	return Date.now() < expiresAt.getTime();
}

/**
 * Validate and sanitize a single cache tag for security.
 *
 * Prevents header injection attacks by removing newlines, tabs, and carriage
 * returns. Enforces tag length constraints and ensures tags are non-empty
 * after sanitization.
 *
 * @param tag - The cache tag to validate
 * @returns The sanitized cache tag
 * @throws Error if the tag is invalid (empty, too long, not a string)
 *
 * @example
 * ```typescript
 * const clean = validateCacheTag("user:123");
 * // Returns: "user:123"
 *
 * const sanitized = validateCacheTag("user\r\n:123\t");
 * // Returns: "user:123" (newlines and tabs removed)
 *
 * try {
 *   validateCacheTag("");
 * } catch (error) {
 *   // Throws: "Cache tag cannot be empty"
 * }
 *
 * try {
 *   validateCacheTag("x".repeat(1001));
 * } catch (error) {
 *   // Throws: "Cache tag too long (max 1000 characters)"
 * }
 * ```
 */
export function validateCacheTag(tag: string): string {
	if (typeof tag !== "string") {
		throw new Error("Cache tag must be a string");
	}
	if (tag.length === 0) {
		throw new Error("Cache tag cannot be empty");
	}
	if (tag.length > 1000) {
		throw new Error("Cache tag too long (max 1000 characters)");
	}
	// Remove control characters to prevent header injection attacks
	const sanitized = tag.replace(/[\r\n\t]/g, "").trim();
	if (sanitized.length === 0) {
		throw new Error("Cache tag cannot be empty after sanitization");
	}
	return sanitized;
}

/**
 * Validate and sanitize an array of cache tags.
 *
 * Enforces limits on tag count (maximum 100 tags) and validates each
 * individual tag using validateCacheTag(). This prevents abuse and
 * ensures system stability.
 *
 * @param tags - Array of cache tags to validate
 * @returns Array of sanitized cache tags
 * @throws Error if the tags array is invalid, not an array, or exceeds limits
 *
 * @example
 * ```typescript
 * const clean = validateCacheTags(["user:123", "api", "content"]);
 * // Returns: ["user:123", "api", "content"]
 *
 * const sanitized = validateCacheTags(["user\r\n:123", "api\t"]);
 * // Returns: ["user:123", "api"]
 *
 * try {
 *   validateCacheTags(new Array(101).fill("tag"));
 * } catch (error) {
 *   // Throws: "Too many cache tags (max 100)"
 * }
 *
 * try {
 *   validateCacheTags("not-an-array" as any);
 * } catch (error) {
 *   // Throws: "Cache tags must be an array"
 * }
 * ```
 */
export function validateCacheTags(tags: string[]): string[] {
	if (!Array.isArray(tags)) {
		throw new Error("Cache tags must be an array");
	}
	if (tags.length > 100) {
		throw new Error("Too many cache tags (max 100)");
	}
	return tags.map(validateCacheTag);
}
