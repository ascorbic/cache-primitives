export class FailingCache implements Cache {
	constructor(private errorOnMethod: string) {}

	match(_request: RequestInfo | URL): Promise<Response | undefined> {
		if (this.errorOnMethod === "match") {
			throw new Error("Cache match failed");
		}
		return Promise.resolve(undefined);
	}

	put(_request: RequestInfo | URL, _response: Response): Promise<void> {
		if (this.errorOnMethod === "put") {
			throw new Error("Cache put failed");
		}
		return Promise.resolve();
	}

	delete(_request: RequestInfo | URL): Promise<boolean> {
		if (this.errorOnMethod === "delete") {
			throw new Error("Cache delete failed");
		}
		return Promise.resolve(false);
	}

	keys(): Promise<readonly Request[]> {
		if (this.errorOnMethod === "keys") {
			throw new Error("Cache keys failed");
		}
		return Promise.resolve([]);
	}

	matchAll(
		_request?: RequestInfo | URL,
		_options?: CacheQueryOptions,
	): Promise<readonly Response[]> {
		if (this.errorOnMethod === "matchAll") {
			throw new Error("Cache matchAll failed");
		}
		return Promise.resolve([]);
	}

	add(): Promise<void> {
		throw new Error("Not implemented");
	}
	addAll(): Promise<void> {
		throw new Error("Not implemented");
	}
}
