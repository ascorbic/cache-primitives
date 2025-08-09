import type { CacheConfig } from "./types.ts";
import { defaultGetCacheKey, getCache, parseCacheControl } from "./utils.ts";
import {
	create304Response,
	getDefaultConditionalConfig,
	validateConditionalRequest,
} from "./conditional.ts";
import { safeJsonParse } from "./errors.ts";

const VARY_METADATA_KEY = "https://cache-internal/cache-vary-metadata";

export async function readFromCache(
	request: Request,
	config: CacheConfig = {},
): Promise<{ cached: Response | null; needsBackgroundRevalidation: boolean }> {
	if (request.method !== "GET") {
		return { cached: null, needsBackgroundRevalidation: false };
	}
	const getCacheKey = config.getCacheKey || defaultGetCacheKey;
	const cache = await getCache(config);
	const varyMetadataResponse = await cache.match(VARY_METADATA_KEY);
	interface VaryEntry {
		timestamp?: number;
		headers?: unknown;
		cookies?: unknown;
		query?: unknown;
	}
	function isStringArray(value: unknown): value is string[] {
		return Array.isArray(value) && value.every((v) => typeof v === "string");
	}
	let varyMetadata: Record<string, VaryEntry> = {};
	varyMetadata = await safeJsonParse(
		varyMetadataResponse?.clone() || null,
		{} as Record<string, VaryEntry>,
		"vary metadata parsing in cache handler",
	);
	const vary = varyMetadata[request.url] as VaryEntry | undefined;
	// Only pass vary data if present; defaultGetCacheKey expects CacheVary shape
	const varyArg = vary
		? {
			headers: isStringArray(vary.headers) ? vary.headers : [],
			cookies: isStringArray(vary.cookies) ? vary.cookies : [],
			query: isStringArray(vary.query) ? vary.query : [],
		}
		: undefined;
	const cacheKey = await getCacheKey(request, varyArg);
	const cacheRequest = new Request(cacheKey);
	let cachedResponse: Response | null = (await cache.match(cacheKey)) ?? null;
	let needsBackgroundRevalidation = false;
	if (cachedResponse) {
		const expiresHeader = cachedResponse.headers.get("expires");
		if (expiresHeader) {
			const expiresAt = new Date(expiresHeader).getTime();
			const now = Date.now();
			if (!isNaN(expiresAt) && now >= expiresAt) {
				let swrSeconds: number | undefined;
				const cc = cachedResponse.headers.get("cache-control");
				if (cc) {
					const directives = parseCacheControl(cc);
					if (typeof directives["stale-while-revalidate"] === "number") {
						swrSeconds = directives["stale-while-revalidate"] as number;
					}
				}
				if (swrSeconds && now < expiresAt + swrSeconds * 1000) {
					needsBackgroundRevalidation = true;
				} else {
					cachedResponse.body?.cancel();
					await cache.delete(cacheRequest);
					cachedResponse = null;
				}
			}
		}
	}
	if (cachedResponse) {
		const features = config.features ?? {};
		if (features.conditionalRequests !== false) {
			const conditionalConfig = typeof features.conditionalRequests === "object"
				? features.conditionalRequests
				: getDefaultConditionalConfig();
			const validation = validateConditionalRequest(
				request,
				cachedResponse,
				conditionalConfig,
			);
			if (validation.shouldReturn304) {
				return {
					cached: create304Response(cachedResponse),
					needsBackgroundRevalidation: false,
				};
			}
		}
	}
	return { cached: cachedResponse, needsBackgroundRevalidation };
}
