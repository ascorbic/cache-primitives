/**
 * Cache invalidation and statistics utilities.
 *
 * @example
 * ```typescript
 * import { invalidateByTag, getCacheStats } from "cache-primitives";
 *
 * // Invalidate by tag
 * await invalidateByTag("users");
 *
 * // Get cache statistics
 * const stats = await getCacheStats();
 * console.log(`Cache has ${stats.totalEntries} entries`);
 * ```
 */
export {
	getCacheStats,
	invalidateAll,
	invalidateByPath,
	invalidateByTag,
	regenerateCacheStats,
} from "./invalidation.ts";

/**
 * Utility functions for advanced cache operations.
 *
 * @example
 * ```typescript
 * import {
 *   parseCacheControl,
 *   parseCacheTags,
 *   defaultGetCacheKey
 * } from "cache-primitives";
 *
 * // Parse cache control header
 * const directives = parseCacheControl("max-age=3600, public");
 *
 * // Generate cache key
 * const key = defaultGetCacheKey(request);
 * ```
 */
export {
	defaultGetCacheKey,
	getCache,
	isCacheValid,
	parseCacheVaryHeader,
	parseResponseHeaders,
	removeHeaders,
} from "./utils.ts";

/**
 * Advanced metadata management utilities.
 *
 * @example
 * ```typescript
 * import { cleanupVaryMetadata } from "cache-primitives";
 *
 * // Clean up expired vary metadata
 * await cleanupVaryMetadata(cache, metadataKey);
 * ```
 */
export {
	atomicMetadataUpdate,
	cleanupVaryMetadata,
	updateTagMetadata,
	updateVaryMetadata,
} from "./metadata.ts";

/**
 * Error handling utilities for customizable error management.
 *
 * @example
 * ```typescript
 * import { setErrorHandler, createSilentErrorHandler } from "cache-primitives";
 *
 * // Use silent error handler for tests
 * setErrorHandler(createSilentErrorHandler());
 * ```
 */
export {
	createDefaultErrorHandler,
	createSilentErrorHandler,
	getErrorHandler,
	setErrorHandler,
} from "./errors.ts";
export type { ErrorHandler, LogLevel } from "./errors.ts";

/**
 * HTTP conditional request utilities for cache validation.
 *
 * @example
 * ```typescript
 * import {
 *   validateConditionalRequest,
 *   create304Response,
 *   generateETag,
 *   compareETags,
 *   parseHttpDate
 * } from "cache-primitives";
 *
 * // Validate conditional request
 * const validation = validateConditionalRequest(request, cachedResponse);
 * if (validation.shouldReturn304) {
 *   return create304Response(cachedResponse);
 * }
 *
 * // Generate ETag for a response
 * const etag = await generateETag(response);
 *
 * // Parse HTTP dates (Last-Modified, If-Modified-Since)
 * const date = parseHttpDate("Wed, 21 Oct 2015 07:28:00 GMT");
 * ```
 */
export {
	compareETags,
	create304Response,
	generateETag,
	getDefaultConditionalConfig,
	parseETag,
	parseHttpDate,
	parseIfNoneMatch,
	validateConditionalRequest,
} from "./conditional.ts";

/**
 * TypeScript type definitions for cache-primitives library.
 *
 * @example
 * ```typescript
 * import type {
 *   CacheConfig,
 *   CacheHandle,
 * } from "cache-primitives";
 *
 * const handle = createCacheHandler({ cacheName: "my-cache" });
 * ```
 */
export type {
	CacheConfig,
	CacheHandle,
	CacheHandleOptions,
	ConditionalRequestConfig,
	ConditionalValidationResult,
	CreateCacheHandlerOptions,
	HandlerFunction as UnifiedHandlerFn,
	HandlerInfo,
	HandlerMode,
	InvalidationOptions,
	ParsedCacheHeaders,
	RevalidationHandler,
	SWRPolicy,
} from "./types.ts";

// Public unified cache handler (intentionally do NOT export low-level read/write helpers)
export { createCacheHandler } from "./handlers.ts";
