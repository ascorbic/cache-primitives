/**
 * Metadata management utilities with atomic operations to prevent race conditions.
 */

import { getErrorHandler, safeJsonParse } from "./errors.ts";
import type { CacheVary } from "./types.ts";

// Strongly typed metadata entry for Vary data (LRU tracking via timestamp)
interface VaryEntry {
	// Arbitrary vary data structure (headers/cookies/query lists etc.)
	// Use unknown to avoid any; callers narrow as needed
	[key: string]: unknown;
	timestamp: number; // LRU timestamp (ms)
}

const METADATA_LOCK_PREFIX = "https://cache-internal/lock-";
const METADATA_LOCK_TIMEOUT = 5000; // 5 seconds
const MAX_RETRY_ATTEMPTS = 5;
const RETRY_BASE_DELAY = 10; // Base delay in ms

/**
 * Atomic metadata update with retry logic to prevent race conditions.
 */
export async function atomicMetadataUpdate<T>(
	cache: Cache,
	metadataKey: string,
	updateFn: (current: T) => T,
	defaultValue: T,
	maxRetries = MAX_RETRY_ATTEMPTS,
): Promise<void> {
	const lockKey = `${METADATA_LOCK_PREFIX}${encodeURIComponent(metadataKey)}`;
	let attempt = 0;

	while (attempt < maxRetries) {
		try {
			// Try to acquire lock
			const lockAcquired = await tryAcquireLock(cache, lockKey);
			if (!lockAcquired) {
				// Wait with exponential backoff and retry
				await sleep(RETRY_BASE_DELAY * Math.pow(2, attempt));
				attempt++;
				continue;
			}

			try {
				// Read current metadata
				const metadataResponse = await cache.match(metadataKey);
				const currentData = await safeJsonParse(
					metadataResponse || null,
					defaultValue,
					`atomic metadata update for ${metadataKey}`,
				);

				// Apply update
				const updatedData = updateFn(currentData);

				// Write back updated metadata
				await cache.put(metadataKey, Response.json(updatedData));

				return; // Success
			} finally {
				// Always release lock
				await releaseLock(cache, lockKey);
			}
		} catch (error) {
			getErrorHandler().handleRecoverableError(
				`metadata update attempt ${attempt + 1}`,
				error instanceof Error ? error : new Error(String(error)),
			);
			attempt++;

			if (attempt >= maxRetries) {
				getErrorHandler().handleCriticalError(
					`metadata update after ${maxRetries} attempts`,
					error instanceof Error ? error : new Error(String(error)),
				);
			}

			// Wait before retry
			await sleep(RETRY_BASE_DELAY * Math.pow(2, attempt));
		}
	}

	throw new Error(
		`Failed to acquire lock for metadata update after ${maxRetries} attempts`,
	);
}

/**
 * Try to acquire a lock by putting a lock entry in the cache.
 * Returns true if lock was successfully acquired.
 */
async function tryAcquireLock(cache: Cache, lockKey: string): Promise<boolean> {
	try {
		// Check if lock already exists
		const existingLock = await cache.match(lockKey);
		if (existingLock) {
			// Check if lock has expired
			const lockData = await existingLock.json();
			const now = Date.now();
			if (now - lockData.timestamp < METADATA_LOCK_TIMEOUT) {
				return false; // Lock still valid
			}
			// Lock expired, we can proceed
		}

		// Create lock with timestamp
		const lockData = {
			timestamp: Date.now(),
			pid: Math.random().toString(36).substring(2), // Simple process identifier
		};

		await cache.put(lockKey, Response.json(lockData));

		return true;
	} catch (error) {
		getErrorHandler().handleRecoverableError(
			"lock acquisition",
			error instanceof Error ? error : new Error(String(error)),
		);
		return false;
	}
}

/**
 * Release a lock by deleting the lock entry.
 */
async function releaseLock(cache: Cache, lockKey: string): Promise<void> {
	try {
		await cache.delete(lockKey);
	} catch (error) {
		getErrorHandler().handleRecoverableError(
			"lock release",
			error instanceof Error ? error : new Error(String(error)),
		);
		// Not critical - locks will expire anyway
	}
}

/**
 * Simple sleep utility for retry delays.
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Update cache tag metadata atomically.
 */
export async function updateTagMetadata(
	cache: Cache,
	metadataKey: string,
	tags: string[],
	cacheKey: string,
): Promise<void> {
	await atomicMetadataUpdate(
		cache,
		metadataKey,
		(metadata: Record<string, string[]>) => {
			for (const tag of tags) {
				if (!metadata[tag]) {
					metadata[tag] = [];
				}
				// Avoid duplicates
				if (!metadata[tag].includes(cacheKey)) {
					metadata[tag].push(cacheKey);
				}
			}
			return metadata;
		},
		{} as Record<string, string[]>,
	);
}

/**
 * Update vary metadata atomically with size limits and cleanup.
 */
export async function updateVaryMetadata(
	cache: Cache,
	metadataKey: string,
	requestUrl: string,
	varyData: CacheVary,
	maxEntries = 1000,
): Promise<void> {
	await atomicMetadataUpdate(
		cache,
		metadataKey,
		(metadata: Record<string, VaryEntry>) => {
			// Add timestamp for LRU cleanup
			const entry: VaryEntry = {
				...varyData,
				timestamp: Date.now(),
			};
			metadata[requestUrl] = entry;

			// Implement LRU cleanup if we exceed maxEntries
			const entries: Array<[string, VaryEntry]> = Object.entries(
				metadata,
			) as Array<[string, VaryEntry]>;
			if (entries.length > maxEntries) {
				// Sort by timestamp (oldest first) and keep newest maxEntries
				entries.sort(([, a], [, b]) => a.timestamp - b.timestamp);
				const toKeep = entries.slice(-maxEntries);
				const cleanedMetadata: Record<string, VaryEntry> = {};
				for (const [k, v] of toKeep) {
					cleanedMetadata[k] = v;
				}
				return cleanedMetadata;
			}
			return metadata;
		},
		{} as Record<string, VaryEntry>,
	);
}

/**
 * Clean up expired vary metadata entries.
 */
export async function cleanupVaryMetadata(
	cache: Cache,
	metadataKey: string,
	maxAge = 24 * 60 * 60 * 1000, // 24 hours default
): Promise<void> {
	await atomicMetadataUpdate(
		cache,
		metadataKey,
		(metadata: Record<string, VaryEntry>) => {
			const now = Date.now();
			const cleanedMetadata: Record<string, VaryEntry> = {};
			for (
				const [k, v] of Object.entries(metadata) as Array<[string, VaryEntry]>
			) {
				if (now - v.timestamp < maxAge) {
					cleanedMetadata[k] = v;
				}
			}
			return cleanedMetadata;
		},
		{} as Record<string, VaryEntry>,
	);
}
