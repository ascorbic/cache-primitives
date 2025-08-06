/** The CDN that the cache headers are being used with. Will work with other CDNs, but may miss platform-specific headers and directives. */
export type CDN =
  | "netlify"
  | "cloudflare"
  | "akamai"
  | "vercel"
  | "fastly"
  | (string & {});

/** Number of seconds in one minute */
export const ONE_MINUTE = 60;
/** Number of seconds in one hour */
export const ONE_HOUR = 3600;
/** Number of seconds in one day */
export const ONE_DAY = 86400;
/** Number of seconds in one week */
export const ONE_WEEK = 604800;
/** Number of seconds in one year */
export const ONE_YEAR = 31536000;

// The tiered directive is used by Netlify to indicate that it should use a tiered cache, with a central cache shared by all edge nodes.
const tieredDirective = "durable";

const cdnCacheControlHeaderNames = new Map<CDN, string>([
  ["netlify", "Netlify-CDN-Cache-Control"],
  ["cloudflare", "Cloudflare-CDN-Cache-Control"],
  ["akamai", "Akamai-Cache-Control"],
  ["vercel", "Vercel-CDN-Cache-Control"],
  ["fastly", "Cache-Control"],
]);

type Global = typeof globalThis & {
  process?: {
    env?: {
      CDN?: string;
      VERCEL?: string;
    };
  };
};

function detectCDN(): CDN | undefined {
  if ((globalThis as Global).process?.env?.CDN) {
    return (globalThis as Global).process.env.CDN as CDN;
  }
  if ((globalThis as Global).process?.env.VERCEL) {
    return "vercel";
  }
  if ("Netlify" in globalThis) {
    return "netlify";
  }

  return undefined;
}

function parseCacheControlHeader(
  header?: string | null,
): Record<string, string> {
  if (!header) {
    return {};
  }
  return header.split(",").reduce(
    (acc, directive) => {
      const [key, value] = directive.split("=");
      acc[key] = value;
      return acc;
    },
    {} as Record<string, string>,
  );
}

function serializeCacheControlHeader(
  directives: Record<string, string>,
): string {
  return Object.entries(directives)
    .map(([key, value]) => {
      return value ? `${key}=${value}` : key;
    })
    .join(",");
}

export class CacheHeaders extends Headers {
  #cdn?: CDN;

  public constructor(init?: HeadersInit, cdn?: CDN) {
    super(init);
    this.#cdn = cdn ?? detectCDN();
    const cdnDirectives = parseCacheControlHeader(
      this.get(this.cdnCacheControlHeaderName),
    );
    const directives = parseCacheControlHeader(this.get("Cache-Control"));

    const sMaxAge =
      cdnDirectives["s-maxage"] ??
      cdnDirectives["max-age"] ??
      directives["s-maxage"] ??
      ONE_YEAR.toString();

    cdnDirectives.public = "";
    cdnDirectives["s-maxage"] = sMaxAge;
    delete cdnDirectives["max-age"];
    cdnDirectives["must-revalidate"] = "";
    if (this.#cdn === "netlify") {
      cdnDirectives[tieredDirective] = "";
    }

    // If the CDN cache-control header is the same as the browser cache-control header, we merge the directives.
    if (this.cdnCacheControlHeaderName === "Cache-Control") {
      Object.assign(directives, cdnDirectives);
    } else {
      this.setCdnCacheControl(cdnDirectives);
      delete directives["s-maxage"];
      directives.public = "";
    }

    if (!directives["max-age"]) {
      directives["max-age"] = "0";
      directives["must-revalidate"] = "";
    }
    this.setCacheControl(directives);
  }

  /**
   * Adds a cache tag to the cache tags header. Cache tags are used to invalidate the cache for a URL.
   * @param tag The cache tag to add. Can be a string or an array of strings.
   */

  tag(tag: string | Array<string>, ...tags: Array<string>): this {
    if (Array.isArray(tag)) {
      tag = tag.join(",");
    }
    this.setCacheTags([...new Set([...this.getCacheTags(), tag, ...tags])]);
    return this;
  }

  /**
   * Sets stale-while-revalidate directive for the CDN cache. By default the browser is sent a must-revalidate
   * directive to ensure that the browser always revalidates the cache with the server.
   * @param value The number of seconds to set the stale-while-revalidate directive to. Defaults to 1 week.
   */

  swr(value: number = ONE_WEEK): this {
    const cdnDirectives = this.getCdnCacheControl();
    cdnDirectives["stale-while-revalidate"] = value.toString();
    delete cdnDirectives["must-revalidate"];
    this.setCdnCacheControl(cdnDirectives);
    this.ttl(0);
    return this;
  }

  /**
   * Sets cache headers for content that should be cached for a long time and never revalidated.
   * The CDN cache will cache the content for the specified time, and the browser will cache the content
   * indefinitely without revalidating. Do not use this unless the URL is fingerprinted or otherwise unique.
   * Otherwise, the browser will cache the content indefinitely and never check for updates, including for new deploys.
   * @param value The number of seconds to set the CDN cache-control s-maxage directive to. Defaults to 1 year.
   */

  immutable(value: number = ONE_YEAR): this {
    const cdnDirectives = this.getCdnCacheControl();
    cdnDirectives.public = "";
    cdnDirectives["s-maxage"] = value.toString();
    cdnDirectives.immutable = "";
    delete cdnDirectives["must-revalidate"];
    this.setCdnCacheControl(cdnDirectives);

    const directives = this.getCacheControl();
    directives.public = "";
    directives["max-age"] = value.toString();
    delete directives["must-revalidate"];

    directives.immutable = "";
    this.setCacheControl(directives);
    return this;
  }

  /**
   * Sets the s-maxage for items in the CDN cache. This is the maximum amount of time that the CDN will cache the content.
   * If used with swr, the content will revalidate in the background after the max age has passed. Otherwise, the content will be
   * removed from the cache after the max age has passed.
   */

  ttl(value: number): this {
    const cdnDirectives = this.getCdnCacheControl();
    cdnDirectives["s-maxage"] = value.toString();
    this.setCdnCacheControl(cdnDirectives);

    if (cdnDirectives.immutable) {
      const directives = this.getCacheControl();
      directives.immutable = "";
      directives["max-age"] = value.toString();
      this.setCacheControl(directives);
    }

    return this;
  }

  /**
   * Returns the headers as a plain object.
   */

  toObject(): Record<string, string> {
    return Object.fromEntries(this.entries());
  }

  /**
   * Copy the headers from this instance to another Headers instance.
   */

  copyTo<T extends Headers>(headers: T): T {
    this.forEach((value, key) => {
      headers.set(key, value);
    });
    return headers;
  }

  private get cacheTagHeaderName(): string {
    switch (this.#cdn) {
      case "netlify":
        return "Netlify-Cache-Tag";
      case "fastly":
        return "Surrogate-Key";
      default:
        return "Cache-Tag";
    }
  }

  private get cdnCacheControlHeaderName(): string {
    return (
      cdnCacheControlHeaderNames.get(this.#cdn ?? "") ?? "CDN-Cache-Control"
    );
  }

  /**
   * The parsed cache-control header for the CDN cache.
   */
  public getCdnCacheControl(): Record<string, string> {
    return parseCacheControlHeader(this.get(this.cdnCacheControlHeaderName));
  }
  public setCdnCacheControl(directives: Record<string, string>): void {
    this.set(
      this.cdnCacheControlHeaderName,
      serializeCacheControlHeader(directives),
    );
  }

  /**
   * The parsed cache-control header for the browser cache.
   */
  public getCacheControl(): Record<string, string> {
    return parseCacheControlHeader(this.get("Cache-Control"));
  }

  public setCacheControl(directives: Record<string, string>): void {
    this.set("Cache-Control", serializeCacheControlHeader(directives));
  }

  /**
   * The parsed content of the cache tags header.
   */

  public getCacheTags(): Array<string> {
    return this.get(this.cacheTagHeaderName)?.split(",") ?? [];
  }
  public setCacheTags(tags: Array<string>): void {
    this.set(this.cacheTagHeaderName, tags.join(","));
  }
}
