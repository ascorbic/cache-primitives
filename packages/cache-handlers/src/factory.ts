import type { CacheConfig, CacheHandlers } from "./types.ts";
import {
	createMiddlewareHandler,
	createReadHandler,
	createWriteHandler,
} from "./handlers.ts";

/**
 * Create cache handlers with the given configuration.
 *
 * This is the main factory function that creates read, write, and middleware
 * handlers with shared configuration. All handlers use the same cache instance
 * and settings for consistent behavior.
 *
 * @param config - Optional configuration options for cache behavior
 * @returns Object containing read, write, and middleware handlers
 *
 * @example
 * ```typescript
 * // Basic usage
 * const { read, write, middleware } = createCacheHandlers();
 *
 * // With configuration
 * const handlers = createCacheHandlers({
 *   cacheName: "api-cache",
 *   defaultTtl: 300,
 *   maxTtl: 86400,
 *   features: {
 *     cacheTags: true,
 *     cacheControl: true
 *   }
 * });
 *
 * // Use middleware pattern
 * const response = await handlers.middleware(request, async () => {
 *   return new Response("Hello World", {
 *     headers: { "cache-control": "max-age=3600, public" }
 *   });
 * });
 *
 * // Use individual handlers
 * const cached = await handlers.read(request);
 * if (!cached) {
 *   const fresh = new Response("Fresh data");
 *   return await handlers.write(request, fresh);
 * }
 * ```
 */
export function createCacheHandlers(config: CacheConfig = {}): CacheHandlers {
	return {
		read: createReadHandler(config),
		write: createWriteHandler(config),
		middleware: createMiddlewareHandler(config),
	};
}
