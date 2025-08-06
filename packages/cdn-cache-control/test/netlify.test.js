import assert from "node:assert";
import { describe, it } from "node:test";
import { CacheHeaders } from "../dist/index.js";

describe("Netlify", () => {
  it("sets tiered header on Netlify", () => {
    const headers = new CacheHeaders(undefined, "netlify").swr();
    assert.strictEqual(
      headers.get("Netlify-CDN-Cache-Control"),
      "public,s-maxage=0,durable,stale-while-revalidate=604800",
    );
  });

  it("should detect Netlify CDN", () => {
    const headers = new CacheHeaders(undefined, "netlify").immutable();
    assert(headers.has("Netlify-CDN-Cache-Control"));
  });
});
