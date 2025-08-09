import type {
	CacheConfig,
	CacheHandle,
	CacheHandleOptions,
	CreateCacheHandlerOptions,
	HandlerFunction,
} from "./types.ts";
import { defaultGetCacheKey } from "./utils.ts";
import { readFromCache } from "./read.ts";
import { writeToCache } from "./write.ts";

// Public cache handler
export function createCacheHandler(
	options: CreateCacheHandlerOptions = {},
): CacheHandle {
	const baseHandler: HandlerFunction | undefined = options.handler;
	const getCacheKey = options.getCacheKey || defaultGetCacheKey;

	const handle: CacheHandle = async (
		request: Request,
		callOpts: CacheHandleOptions = {},
	): Promise<Response> => {
		// Only cache GET
		if (request.method !== "GET") {
			const handler = callOpts.handler || baseHandler;
			if (!handler) {
				return new Response("No handler provided", { status: 500 });
			}
			return handler(request, { mode: "miss", background: false });
		}

		const { cached, needsBackgroundRevalidation } = await readFromCache(
			request,
			options,
		);
		if (cached) {
			if (needsBackgroundRevalidation) {
				const handler = baseHandler || callOpts.handler;
				if (handler) {
					const scheduler = callOpts.runInBackground || options.runInBackground;
					const revalidatePromise = (async () => {
						try {
							const response = await handler(request, {
								mode: "stale",
								background: true,
							});
							await writeToCache(request, response, options);
						} catch (err) {
							console.warn("SWR background revalidation failed", err);
						}
					})();
					if (scheduler) {
						scheduler(revalidatePromise);
					} else {
						queueMicrotask(() => void revalidatePromise);
					}
				}
			}
			return cached;
		}

		// Cache miss
		const handler = callOpts.handler || baseHandler;
		if (!handler) {
			return new Response("Cache miss and no handler provided", {
				status: 500,
			});
		}
		const response = await handler(request, {
			mode: "miss",
			background: false,
		});
		return writeToCache(request, response, options);
	};

	return handle;
}
