/**
 * HTTP Conditional Request utilities for cache validation.
 *
 * Implements RFC 7232 conditional request handling including:
 * - ETag generation and comparison
 * - Last-Modified date handling
 * - If-None-Match and If-Modified-Since validation
 * - 304 Not Modified response generation
 */

import type {
	ConditionalRequestConfig,
	ConditionalValidationResult,
} from "./types.ts";

/**
 * Generate an ETag based on response content.
 *
 * @param response - The response to generate an ETag for
 * @returns The generated ETag string
 */
export async function generateETag(response: Response): Promise<string> {
	// Clone the response to avoid consuming the body
	const cloned = response.clone();
	const body = await cloned.arrayBuffer();

	// Use Web Crypto API for SHA-1 hashing (fast and sufficient for ETags as it doesn't need to be cryptographically secure)
	const hashBuffer = await crypto.subtle.digest("SHA-1", body);

	// Convert hash to hex string
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	const hashHex = hashArray
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");

	// Format as a quoted string (full hash for collision avoidance)
	return `"${hashHex}"`;
}

/**
 * Parse ETag value, handling both strong and weak ETags.
 *
 * @param etag - The ETag header value
 * @returns Parsed ETag info
 */
export function parseETag(etag: string): { value: string; weak: boolean } {
	if (!etag) {
		return { value: "", weak: false };
	}

	const trimmed = etag.trim();
	if (trimmed.startsWith("W/")) {
		// Weak ETag
		return {
			value: trimmed.slice(2).replace(/^"|"$/g, ""),
			weak: true,
		};
	} else {
		// Strong ETag
		return {
			value: trimmed.replace(/^"|"$/g, ""),
			weak: false,
		};
	}
}

/**
 * Compare two ETags according to HTTP/1.1 specification.
 *
 * @param etag1 - First ETag
 * @param etag2 - Second ETag
 * @param weakComparison - Whether to use weak comparison
 * @returns true if ETags match
 */
export function compareETags(
	etag1: string,
	etag2: string,
	weakComparison = false,
): boolean {
	if (!etag1 || !etag2) {
		return false;
	}

	const parsed1 = parseETag(etag1);
	const parsed2 = parseETag(etag2);

	// If either is weak and we're doing strong comparison, they don't match
	if (!weakComparison && (parsed1.weak || parsed2.weak)) {
		return false;
	}

	return parsed1.value === parsed2.value;
}

/**
 * Parse If-None-Match header value.
 * Handles multiple ETags and the special "*" value.
 *
 * @param headerValue - The If-None-Match header value
 * @returns Array of ETag values, or "*" for any
 */
export function parseIfNoneMatch(headerValue: string): string[] | "*" {
	if (!headerValue) {
		return [];
	}

	const trimmed = headerValue.trim();
	if (trimmed === "*") {
		return "*";
	}

	// Split by comma and clean up each ETag
	return trimmed
		.split(",")
		.map((etag) => etag.trim())
		.filter((etag) => etag.length > 0);
}

/**
 * Parse and validate an HTTP date header value.
 * Used for both Last-Modified and If-Modified-Since headers.
 *
 * @param dateString - The HTTP date header value
 * @returns Parsed Date object or null if invalid
 */
export function parseHttpDate(dateString: string): Date | null {
	if (!dateString) {
		return null;
	}

	const date = new Date(dateString);
	return isNaN(date.getTime()) ? null : date;
}

/**
 * Validate conditional request against cached response.
 * Implements the logic for If-None-Match and If-Modified-Since headers.
 *
 * @param request - The incoming request with conditional headers
 * @param cachedResponse - The cached response to validate against
 * @param config - Conditional request configuration
 * @returns Validation result indicating whether to return 304
 */
export function validateConditionalRequest(
	request: Request,
	cachedResponse: Response,
	config: ConditionalRequestConfig = {},
): ConditionalValidationResult {
	const ifNoneMatch = request.headers.get("if-none-match");
	const ifModifiedSince = request.headers.get("if-modified-since");

	// If no conditional headers, no validation needed
	if (!ifNoneMatch && !ifModifiedSince) {
		return {
			matches: false,
			shouldReturn304: false,
		};
	}

	let etagMatches = false;
	let modifiedSinceMatches = false;
	let matchedValidator: "etag" | "last-modified" | undefined;

	// Check If-None-Match (ETag validation)
	if (ifNoneMatch && config.etag !== false) {
		const cachedETag = cachedResponse.headers.get("etag");
		if (cachedETag) {
			const requestETags = parseIfNoneMatch(ifNoneMatch);

			if (requestETags === "*") {
				etagMatches = true;
				matchedValidator = "etag";
			} else if (Array.isArray(requestETags)) {
				const useWeakComparison = config.weakValidation !== false;
				etagMatches = requestETags.some((requestETag) =>
					compareETags(cachedETag, requestETag, useWeakComparison)
				);
				if (etagMatches) {
					matchedValidator = "etag";
				}
			}
		}
	}

	// Check If-Modified-Since (Last-Modified validation)
	if (ifModifiedSince && config.lastModified !== false && !etagMatches) {
		const cachedLastModified = cachedResponse.headers.get("last-modified");
		if (cachedLastModified) {
			const requestDate = parseHttpDate(ifModifiedSince);
			const cachedDate = parseHttpDate(cachedLastModified);

			if (requestDate && cachedDate) {
				// Resource matches if it hasn't been modified since the request date
				modifiedSinceMatches = cachedDate.getTime() <= requestDate.getTime();
				if (modifiedSinceMatches && !matchedValidator) {
					matchedValidator = "last-modified";
				}
			}
		}
	}

	const matches = etagMatches || modifiedSinceMatches;

	return {
		matches,
		shouldReturn304: matches,
		matchedValidator,
	};
}

/**
 * Create a 304 Not Modified response based on the cached response.
 * Includes only the headers that are required or allowed in 304 responses.
 *
 * @param cachedResponse - The cached response to base the 304 response on
 * @returns A 304 Not Modified response
 */
export function create304Response(cachedResponse: Response): Response {
	const headers = new Headers();

	// Headers that MUST be included if they would have been sent in a 200 response
	const requiredHeaders = [
		"cache-control",
		"content-location",
		"date",
		"etag",
		"expires",
		"last-modified",
		"vary",
	];

	// Headers that MAY be included
	const optionalHeaders = [
		"server",
		"content-encoding",
		"content-language",
		"content-type",
	];

	// Copy required headers
	for (const headerName of requiredHeaders) {
		const value = cachedResponse.headers.get(headerName);
		if (value) {
			headers.set(headerName, value);
		}
	}

	// Copy optional headers that exist
	for (const headerName of optionalHeaders) {
		const value = cachedResponse.headers.get(headerName);
		if (value) {
			headers.set(headerName, value);
		}
	}

	// Ensure Date header is present
	if (!headers.has("date")) {
		headers.set("date", new Date().toUTCString());
	}
	cachedResponse.body?.cancel();
	// 304 responses MUST NOT contain a message body
	return new Response(undefined, {
		status: 304,
		statusText: "Not Modified",
		headers,
	});
}

/**
 * Get default conditional request configuration.
 *
 * @returns Default configuration object
 */
export function getDefaultConditionalConfig(): ConditionalRequestConfig {
	return {
		etag: true,
		lastModified: true,
		weakValidation: true,
	};
}
