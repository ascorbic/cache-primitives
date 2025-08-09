// Setup global web APIs using undici's implementations
// @ts-ignore The undici types are wrong
import { caches, install } from "undici";

// Make undici's implementations available globally to match the Web API
if (!globalThis.caches) {
	globalThis.caches = caches as CacheStorage;
}

install();
