// @ts-check
import assert from "node:assert";
import { describe, it } from "node:test";
import { CacheHeaders, ONE_DAY } from "../dist/index.js";

describe("CacheHeaders", () => {
  it("should append cache tags", () => {
    const headers = new CacheHeaders({
      "Cache-Tag": "tag1",
    });
    headers.tag("tag2");
    assert.strictEqual(headers.get("Cache-Tag"), "tag1,tag2");
  });

  it("should append cache tags with multiple values", () => {
    const headers = new CacheHeaders({
      "Cache-Tag": "tag1,tag2",
    });
    headers.tag("tag3", "tag4");
    assert.strictEqual(headers.get("Cache-Tag"), "tag1,tag2,tag3,tag4");
  });

  it("should deduplicate cache tags", () => {
    const headers = new CacheHeaders({
      "Cache-Tag": "tag1",
    });
    headers.tag("tag1");
    assert.strictEqual(headers.get("Cache-Tag"), "tag1");
  });

  it("should set swr headers", () => {
    const headers = new CacheHeaders().swr();
    assert.strictEqual(
      headers.get("CDN-Cache-Control"),
      "public,s-maxage=0,stale-while-revalidate=604800",
    );

    assert.strictEqual(
      headers.get("Cache-Control"),
      "public,max-age=0,must-revalidate",
    );
  });

  it("should set immutable headers", () => {
    const headers = new CacheHeaders().immutable();
    assert.strictEqual(
      headers.get("Cache-Control"),
      "public,max-age=31536000,immutable",
    );
    assert.strictEqual(
      headers.get("CDN-Cache-Control"),
      "public,s-maxage=31536000,immutable",
    );
  });

  it("should merge default headers", () => {
    const headers = new CacheHeaders({
      "Cache-Control": "s-maxage=3600",
      "Content-Type": "application/json",
    });
    assert.strictEqual(
      headers.get("Cache-Control"),
      "public,max-age=0,must-revalidate",
      "should remove s-maxage and set defaults",
    );
    assert.strictEqual(
      headers.get("CDN-Cache-Control"),
      "public,s-maxage=3600,must-revalidate",
      "should use s-maxage from Cache-Control if present",
    );
    assert.strictEqual(
      headers.get("Content-Type"),
      "application/json",
      "should preserve other headers",
    );
  });

  it("should chain methods", () => {
    const headers = new CacheHeaders([["content-type", "application/json"]])
      .swr(ONE_DAY)
      .tag("tag1")
      .tag("tag2", "tag3");
    assert.strictEqual(
      headers.get("CDN-Cache-Control"),
      "public,s-maxage=0,stale-while-revalidate=86400",
    );
    assert.strictEqual(
      headers.get("Cache-Control"),
      "public,max-age=0,must-revalidate",
    );
    assert.strictEqual(headers.get("Cache-Tag"), "tag1,tag2,tag3");
    assert.strictEqual(headers.get("Content-Type"), "application/json");
  });

  it("can return headers as a plain object", () => {
    const headers = new CacheHeaders([["x-foo", "bar"]])
      .swr()
      .tag("tag1")
      .tag("tag2", "tag3")
      .toObject();
    assert.deepStrictEqual(headers, {
      "x-foo": "bar",
      "cdn-cache-control": "public,s-maxage=0,stale-while-revalidate=604800",
      "cache-control": "public,max-age=0,must-revalidate",
      "cache-tag": "tag1,tag2,tag3",
    });
  });

  it("copies headers to an existing object", () => {
    const existing = new Headers([["x-foo", "bar"]]);
    const headers = new CacheHeaders().swr().tag("tag1").tag("tag2", "tag3");

    const copied = headers.copyTo(existing);

    assert.strictEqual(existing.get("x-foo"), "bar");
    assert.strictEqual(
      existing.get("CDN-Cache-Control"),
      "public,s-maxage=0,stale-while-revalidate=604800",
    );
    assert.strictEqual(existing.get("Cache-Tag"), "tag1,tag2,tag3");
    assert.strictEqual(existing, copied);
  });
});
