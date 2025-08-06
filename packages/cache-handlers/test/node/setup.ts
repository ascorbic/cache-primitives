// Setup global web APIs using undici's implementations
import { caches, Request, Response } from "undici";

// Make undici's implementations available globally to match the Web API
if (!globalThis.caches) {
	globalThis.caches = caches;
}

if (!globalThis.Request) {
	globalThis.Request = Request;
}

if (!globalThis.Response) {
	globalThis.Response = Response;
}
