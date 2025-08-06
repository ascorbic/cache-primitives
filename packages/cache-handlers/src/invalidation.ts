import type { InvalidationOptions } from "./types.ts";
import { getCache, parseCacheTags, validateCacheTag } from "./utils.ts";
import { safeJsonParse, getErrorHandler } from "./errors.ts";

const METADATA_KEY = "https://cache-internal/cache-primitives-metadata";

/**
 * Invalidate cached responses by tag.
 *
 * Removes all cached responses that have the specified tag. Uses metadata
 * for efficient lookup when available, falls back to scanning all cache
 * entries if metadata is missing or corrupted.
 *
 * @param tag - The cache tag to invalidate (will be validated and sanitized)
 * @param options - Optional cache configuration (cache instance or name)
 * @returns Promise resolving to the number of invalidated entries
 *
 * @example
 * ```typescript
 * // Invalidate all responses tagged with "users"
 * const count = await invalidateByTag("users");
 * console.log(`Invalidated ${count} cache entries`);
 *
 * // Use custom cache
 * await invalidateByTag("api", { cacheName: "api-cache" });
 *
 * // Use specific cache instance
 * const cache = await caches.open("my-cache");
 * await invalidateByTag("content", { cache });
 * ```
 */
export async function invalidateByTag(
	tag: string,
	options: InvalidationOptions = {},
): Promise<number> {
	const validatedTag = validateCacheTag(tag);
	const cache = await getCache(options);
	const metadataResponse = await cache.match(METADATA_KEY);

	let metadata: Record<string, string[]> = {};
	let keysToDelete: string[] = [];

	metadata = await safeJsonParse(
		metadataResponse || null,
		{} as Record<string, string[]>,
		`invalidation metadata for tag: ${validatedTag}`,
	);
	keysToDelete = metadata[validatedTag] || [];

	// Note: Fallback to full cache scan is not available in Deno Cache API
	// This function relies on metadata for efficient invalidation

	let deletedCount = 0;
	for (const key of keysToDelete) {
		const deleted = await cache.delete(key);
		if (deleted) {
			deletedCount++;
		}
	}

	// Clean up tag metadata after successful deletion
	if (metadataResponse && metadata[validatedTag]) {
		delete metadata[validatedTag];
		await cache.put(
			METADATA_KEY,
			new Response(JSON.stringify(metadata), {
				headers: { "Content-Type": "application/json" },
			}),
		);
	}

	return deletedCount;
}

/**
 * Invalidate cached responses by URL path.
 *
 * Removes cached responses for a specific path or path prefix. Handles both
 * exact path matches and hierarchical invalidation (when path ends with "/").
 * Cache keys are matched against the path portion, ignoring query parameters.
 *
 * @param path - The URL path to invalidate (e.g., "/api/users" or "/api/users/")
 * @param options - Optional cache configuration (cache instance or name)
 * @returns Promise resolving to the number of invalidated entries
 *
 * @example
 * ```typescript
 * // Invalidate exact path
 * await invalidateByPath("/api/users");
 *
 * // Invalidate path and all sub-paths
 * await invalidateByPath("/api/users/"); // Also removes /api/users/123, etc.
 *
 * // Use custom cache
 * const count = await invalidateByPath("/api/posts", { cacheName: "api-cache" });
 * console.log(`Removed ${count} cached responses`);
 * ```
 */
export async function invalidateByPath(
	path: string,
	options: InvalidationOptions = {},
): Promise<number> {
	const cache = await getCache(options);

	// In Deno, we can't enumerate cache keys, so we work with metadata
	const metadataResponse = await cache.match(METADATA_KEY);
	if (!metadataResponse) {
		return 0; // No metadata means no tracked entries
	}

	let metadata: Record<string, string[]> = {};
	try {
		metadata = await metadataResponse.json();
	} catch (error) {
		console.warn("Failed to parse invalidation metadata:", error);
		return 0;
	}

	let deletedCount = 0;
	const keysToDelete = new Set<string>();

	// Find all cache keys that match the path
	for (const tag in metadata) {
		for (const key of metadata[tag]) {
			try {
				const url = new URL(key);
				const requestPath = url.pathname;

				if (requestPath === path || requestPath.startsWith(`${path}/`)) {
					keysToDelete.add(key);
				}
			} catch {
				// Skip malformed URLs
			}
		}
	}

	// Delete the matching entries
	for (const key of keysToDelete) {
		const deleted = await cache.delete(key);
		if (deleted) {
			deletedCount++;
		}
	}

	// Clean up metadata for deleted entries
	if (deletedCount > 0) {
		const updatedMetadata: Record<string, string[]> = {};
		for (const tag in metadata) {
			updatedMetadata[tag] = metadata[tag].filter(
				(key) => !keysToDelete.has(key),
			);
			if (updatedMetadata[tag].length === 0) {
				delete updatedMetadata[tag];
			}
		}

		await cache.put(
			METADATA_KEY,
			new Response(JSON.stringify(updatedMetadata), {
				headers: { "Content-Type": "application/json" },
			}),
		);
	}

	return deletedCount;
}

/**
 * Invalidate all cached responses (clear cache).
 *
 * Removes all entries from the specified cache, including metadata.
 * Use with caution as this operation cannot be undone and will clear
 * the entire cache.
 *
 * @param options - Optional cache configuration (cache instance or name)
 * @returns Promise resolving to the number of invalidated entries
 *
 * @example
 * ```typescript
 * // Clear default cache
 * const count = await invalidateAll();
 * console.log(`Cleared ${count} cache entries`);
 *
 * // Clear specific cache
 * await invalidateAll({ cacheName: "api-cache" });
 *
 * // Clear using cache instance
 * const cache = await caches.open("temp-cache");
 * await invalidateAll({ cache });
 * ```
 */
export async function invalidateAll(
	options: InvalidationOptions = {},
): Promise<number> {
	const cache = await getCache(options);

	// In Deno, we can't enumerate cache keys, so we work with metadata
	const metadataResponse = await cache.match(METADATA_KEY);
	if (!metadataResponse) {
		return 0; // No metadata means no tracked entries
	}

	let metadata: Record<string, string[]> = {};
	try {
		metadata = await metadataResponse.json();
	} catch (error) {
		console.warn("Failed to parse invalidation metadata:", error);
		return 0;
	}

	let deletedCount = 0;
	const keysToDelete = new Set<string>();

	// Collect all cache keys from metadata
	for (const tag in metadata) {
		for (const key of metadata[tag]) {
			keysToDelete.add(key);
		}
	}

	// Delete all entries
	for (const key of keysToDelete) {
		const deleted = await cache.delete(key);
		if (deleted) {
			deletedCount++;
		}
	}

	// Clear metadata
	await cache.delete(METADATA_KEY);

	return deletedCount;
}

/**
 * Get cache statistics.
 *
 * Returns information about the cache contents, including total number
 * of entries and breakdown by cache tags. Statistics are based on
 * metadata, so they may not reflect manual cache modifications.
 *
 * @param options - Optional cache configuration (cache instance or name)
 * @returns Promise resolving to cache statistics object
 *
 * @example
 * ```typescript
 * const stats = await getCacheStats();
 * console.log(`Total entries: ${stats.totalEntries}`);
 * console.log("Entries by tag:", stats.entriesByTag);
 * // Example output:
 * // {
 * //   totalEntries: 42,
 * //   entriesByTag: {
 * //     "users": 15,
 * //     "api": 27,
 * //     "content": 8
 * //   }
 * // }
 *
 * // Check specific cache
 * const apiStats = await getCacheStats({ cacheName: "api-cache" });
 * ```
 */
export async function getCacheStats(
	options: InvalidationOptions = {},
): Promise<{ totalEntries: number; entriesByTag: Record<string, number> }> {
	const cache = await getCache(options);
	const metadataResponse = await cache.match(METADATA_KEY);
	if (!metadataResponse) {
		return { totalEntries: 0, entriesByTag: {} };
	}

	let metadata: Record<string, string[]> = {};
	try {
		metadata = await metadataResponse.json();
	} catch (error) {
		console.warn(
			"Failed to parse cache stats metadata, using empty object:",
			error,
		);
		metadata = {};
	}
	const entriesByTag: Record<string, number> = {};
	const uniqueKeys = new Set<string>();

	for (const tag in metadata) {
		entriesByTag[tag] = metadata[tag].length;
		for (const key of metadata[tag]) {
			uniqueKeys.add(key);
		}
	}

	return { totalEntries: uniqueKeys.size, entriesByTag };
}

/**
 * Regenerate cache statistics from scratch.
 *
 * Scans all cache entries and rebuilds the metadata from their headers.
 * This can be useful if the metadata becomes out of sync due to manual
 * cache modifications or corruption. This operation may be slow for large caches.
 *
 * @param options - Optional cache configuration (cache instance or name)
 * @returns Promise resolving to the regenerated cache statistics
 *
 * @example
 * ```typescript
 * // Regenerate stats for default cache
 * const stats = await regenerateCacheStats();
 * console.log(`Rebuilt stats for ${stats.totalEntries} entries`);
 *
 * // Regenerate for specific cache
 * await regenerateCacheStats({ cacheName: "corrupted-cache" });
 *
 * // Use after manual cache operations
 * const cache = await caches.open("manual-cache");
 * await cache.put("key", response); // Manual operation
 * const freshStats = await regenerateCacheStats({ cache });
 * ```
 */
export async function regenerateCacheStats(
	options: InvalidationOptions = {},
): Promise<{ totalEntries: number; entriesByTag: Record<string, number> }> {
	// In Deno, we can't enumerate cache keys, so this function cannot work
	// without the ability to list all cache entries. Return empty stats.
	console.warn(
		"regenerateCacheStats: Cannot enumerate cache keys in Deno environment",
	);
	return { totalEntries: 0, entriesByTag: {} };
}
