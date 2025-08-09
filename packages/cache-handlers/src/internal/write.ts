import type { CacheConfig } from "../types.ts";
import {
	defaultGetCacheKey,
	getCache,
	parseResponseHeaders,
	removeHeaders,
	validateCacheTags,
} from "../utils.ts";
import { generateETag } from "../conditional.ts";
import { updateTagMetadata, updateVaryMetadata } from "../metadata.ts";

const METADATA_KEY = "https://cache-internal/cache-primitives-metadata";
const VARY_METADATA_KEY = "https://cache-internal/cache-vary-metadata";

export async function writeToCache(
	request: Request,
	response: Response,
	config: CacheConfig = {},
): Promise<Response> {
	if (request.method !== "GET") return response;
	const getCacheKey = config.getCacheKey || defaultGetCacheKey;
	const cache = await getCache(config);
	const cacheInfo = parseResponseHeaders(response, config);
	if (!cacheInfo.shouldCache) {
		return removeHeaders(response, cacheInfo.headersToRemove);
	}
	const cacheKey = await getCacheKey(request, cacheInfo.vary);
	const responseToCache = response.clone();
	const headers = new Headers(responseToCache.headers);
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
	await cache.put(cacheKey, cacheResponse);
	if (cacheInfo.tags.length > 0) {
		const validatedTags = validateCacheTags(cacheInfo.tags);
		await updateTagMetadata(cache, METADATA_KEY, validatedTags, cacheKey);
	}
	if (cacheInfo.vary) {
		await updateVaryMetadata(
			cache,
			VARY_METADATA_KEY,
			request.url,
			cacheInfo.vary,
		);
	}
	return removeHeaders(response, cacheInfo.headersToRemove);
}
