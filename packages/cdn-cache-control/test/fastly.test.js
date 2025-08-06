// @ts-check
import assert from "node:assert";
import { describe, it } from "node:test";
import { CacheHeaders } from "../dist/index.js";

describe("Fastly", () => {
  it("merges cdn-cache-control header into cache-control", () => {
    const headers = new CacheHeaders(undefined, "fastly").immutable();
    assert.strictEqual(
      headers.get("Cache-Control"),
      "public,s-maxage=31536000,max-age=31536000,immutable",
    );
  });
});
