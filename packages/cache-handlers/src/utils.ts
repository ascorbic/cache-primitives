import type {
	CacheConfig,
	CacheVary,
	InvalidationOptions,
	ParsedCacheHeaders,
} from "./types.ts";

const DEFAULT_CACHE_NAME = "cache-primitives-default";

export async function getCache(
	options: InvalidationOptions = {},
): Promise<Cache> {
	return (
		options.cache ??
			(await caches.open(options.cacheName ?? DEFAULT_CACHE_NAME))
	);
}

export function parseCacheControl(
	headerValue: string,
): Record<string, string | number | boolean> {
	const directives: Record<string, string | number | boolean> = {};
	const parts = headerValue.split(",").map((part) => part.trim());

	for (const part of parts) {
		const [key, value] = part.split("=", 2);
		if (!key) {
			continue;
		}
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

export function parseCacheVaryHeader(headerValue: string): CacheVary {
	const vary: CacheVary = { headers: [], cookies: [], query: [] };

	// Parse comma-separated cache-vary directives
	const directives = headerValue
		.split(",")
		.map((d) => d.trim())
		.filter((d) => d.length > 0);

	for (const directive of directives) {
		const equalIndex = directive.indexOf("=");
		if (equalIndex === -1) {
			continue;
		}

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

	const cacheControlHeader = features.cacheControl !== false
		? headers.get("cache-control")
		: null;
	const cdnCacheControlHeader = features.cdnCacheControl !== false
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

		if (typeof directives["stale-while-revalidate"] === "number") {
			result.staleWhileRevalidate = directives["stale-while-revalidate"];
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
		const conditionalConfig = typeof features.conditionalRequests === "object"
			? features.conditionalRequests
			: {};

		if (!etag && conditionalConfig.etag === "generate") {
			result.shouldGenerateETag = true;
		}
	}

	// Cache only when explicitly allowed by headers (no implicit caching)
	const hasExplicitCacheHeaders = !!finalCacheControl ||
		!!headers.get("cache-tag") ||
		!!headers.get("expires");
	result.shouldCache = hasExplicitCacheHeaders &&
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

export function defaultGetCacheKey(request: Request, vary?: CacheVary): string {
	// Only support GET requests for caching
	if (request.method !== "GET") {
		// Return a cache key that will never match anything, but don't throw
		return `unsupported-method:${request.method}:${request.url}`;
	}

	const url = new URL(request.url);
	let key = `${url.origin}${url.pathname}`;

	if (vary) {
		const varyParts: string[] = [];

		// Handle query parameters with proper sorting
		if (vary.query.length > 0) {
			const searchKey = new URLSearchParams();
			const sortedQueries = [...vary.query].sort(); // Don't mutate original array
			for (const queryName of sortedQueries) {
				const value = url.searchParams.get(queryName) || "";
				searchKey.set(queryName, value);
			}
			if (searchKey.size > 0) {
				key += `?${searchKey.toString()}`;
			}
		}

		// Handle headers with collision-resistant format
		if (vary.headers.length > 0) {
			const headerPairs = vary.headers
				.sort() // Sort for consistency
				.map((headerName) => {
					const value = request.headers.get(headerName) || "";
					return `${headerName.toLowerCase()}:${value}`;
				});
			varyParts.push(`h=${headerPairs.join(",")}`);
		}

		// Handle cookies with more robust parsing
		if (vary.cookies.length > 0) {
			const cookieValues = vary.cookies
				.sort() // Sort for consistency
				.map((cookieName) => {
					const value = getCookieValue(request, cookieName) || "";
					return `${cookieName}:${value}`;
				});
			varyParts.push(`c=${cookieValues.join(",")}`);
		}

		// Use collision-resistant separator
		if (varyParts.length > 0) {
			key += `::${varyParts.join("::")}`;
		}
	} else {
		// Normalize query parameters even without vary to ensure consistency
		const sortedSearchParams = new URLSearchParams();
		const entries = Array.from(url.searchParams.entries()).sort(([a], [b]) =>
			a.localeCompare(b)
		);
		for (const [name, value] of entries) {
			sortedSearchParams.append(name, value);
		}

		if (sortedSearchParams.size > 0) {
			key += `?${sortedSearchParams.toString()}`;
		}
	}

	return key;
}

function getCookieValue(request: Request, cookieName: string): string | null {
	const cookieHeader = request.headers.get("cookie");
	if (!cookieHeader) {
		return null;
	}

	// Parse cookies more carefully to handle edge cases
	const cookies = cookieHeader.split(";");
	for (const cookie of cookies) {
		const trimmed = cookie.trim();
		const equalIndex = trimmed.indexOf("=");

		if (equalIndex === -1) {
			// Cookie without value
			if (trimmed === cookieName) {
				return "";
			}
		} else {
			const name = trimmed.slice(0, equalIndex).trim();
			const value = trimmed.slice(equalIndex + 1).trim();

			if (name === cookieName) {
				return value;
			}
		}
	}

	return null;
}

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

export function isCacheValid(expiresHeader: string | null): boolean {
	if (!expiresHeader) {
		return true;
	}
	const expiresAt = new Date(expiresHeader);
	// Invalid dates are treated as never expiring for safety
	if (isNaN(expiresAt.getTime())) {
		return true;
	}
	return Date.now() < expiresAt.getTime();
}

export function validateCacheTag(tag: string): string {
	if (typeof tag !== "string") {
		throw new Error("Cache tag must be a string");
	}
	if (tag.length === 0) {
		throw new Error("Cache tag cannot be empty");
	}
	if (tag.length > 100) {
		throw new Error("Cache tag too long (max 100 characters)");
	}

	// Remove ALL control characters (0-31) and DEL (127) except space (32)
	// deno-lint-ignore no-control-regex
	const sanitized = tag.replace(/[\x00-\x1F\x7F]/g, "").trim();

	if (sanitized.length === 0) {
		throw new Error("Cache tag cannot be empty after sanitization");
	}

	// Validate against common injection patterns
	if (
		sanitized.includes("<") ||
		sanitized.includes(">") ||
		sanitized.includes('"')
	) {
		throw new Error('Cache tag contains invalid characters (<, >, ")');
	}

	return sanitized;
}

export function validateCacheTags(tags: string[]): string[] {
	if (!Array.isArray(tags)) {
		throw new Error("Cache tags must be an array");
	}
	if (tags.length > 100) {
		throw new Error("Too many cache tags (max 100)");
	}
	return tags.map(validateCacheTag);
}
