// Copyright (c) 2026 NIDHI AI SOLUTIONS PRIVATE LIMITED. All rights reserved.

/**
 * An app's origin, `<slug>.apps.<domain>`, served from pds-core's /serve
 * (pds-core docs/deployment.md "Serving app bundles at the edge",
 * docs/api/bundles.md "Serving"). Netlify's edge function and the dev server
 * share it. The `Host` only selects which bundle is served; it never
 * authorises anything, and nothing here sets a cookie.
 */

export interface AppServerSettings {
  /** pds-core's API, ending in /api. */
  api: string;
  /** The domain apps are served under: `<slug>.apps.<appsBaseDomain>`. */
  appsBaseDomain: string;
  fetch?: typeof fetch;
  now?: () => number;
}

const SLUG = /^[a-z0-9-]{3,40}$/;

/** How long the live version is kept (pds-core caches it for as long). */
const VERSION_MS = 15_000;

/** pds-core's isolation headers, added where a response lacks one (pds-core pm/plan.md §14.3). */
const ISOLATION: [string, string][] = [
  ["origin-agent-cluster", "?1"],
  ["x-content-type-options", "nosniff"],
  ["referrer-policy", "strict-origin-when-cross-origin"],
];

/** The slug a host names, or null for a host that is not an app's origin. */
export function slugOfHost(
  host: string,
  appsBaseDomain: string,
): string | null {
  const suffix = `.apps.${appsBaseDomain.toLowerCase()}`;
  const name = host.toLowerCase();
  return name.endsWith(suffix) ? name.slice(0, -suffix.length) : null;
}

/** The response's headers, as the browser should have them from an app's origin. */
function headersOf(upstream: Response): Headers {
  const headers = new Headers(upstream.headers);
  headers.delete("set-cookie");
  // fetch has already decoded the body, so its encoding and length no longer hold.
  headers.delete("content-encoding");
  headers.delete("content-length");
  // The browser's URL carries no version, so it revalidates by ETag instead.
  if (headers.get("cache-control")?.includes("immutable"))
    headers.set("cache-control", "public, max-age=0, must-revalidate");
  for (const [name, value] of ISOLATION)
    if (!headers.has(name)) headers.set(name, value);
  return headers;
}

function plain(status: number, text: string, extra: [string, string][] = []) {
  return new Response(text, {
    status,
    headers: [
      ["content-type", "text/plain; charset=utf-8"],
      ...ISOLATION,
      ...extra,
    ],
  });
}

/**
 * The app server: a request for an app's origin answered, or null for any
 * other host, which the caller serves as the host's own.
 */
export function createAppServer(settings: AppServerSettings) {
  const fetchFn: typeof fetch = (input, init) =>
    (settings.fetch ?? fetch)(input, init);
  const now = settings.now ?? Date.now;
  const versions = new Map<string, { version: string; at: number }>();

  /** The live version, or pds-core's refusal. */
  async function liveVersion(slug: string): Promise<string | Response> {
    const kept = versions.get(slug);
    if (kept !== undefined && now() - kept.at < VERSION_MS) return kept.version;
    const live = await fetchFn(`${settings.api}/serve/${slug}/_version`, {
      headers: { accept: "application/json" },
    });
    if (!live.ok)
      return new Response(live.body, {
        status: live.status,
        headers: headersOf(live),
      });
    const { data } = (await live.json()) as { data: { version: string } };
    versions.set(slug, { version: data.version, at: now() });
    return data.version;
  }

  return async function serve(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    const slug = slugOfHost(url.host, settings.appsBaseDomain);
    if (slug === null) return null;
    if (!SLUG.test(slug)) return plain(404, "Not found");
    if (request.method !== "GET" && request.method !== "HEAD")
      return plain(405, "Method not allowed", [["allow", "GET, HEAD"]]);
    // Bundles are built with the base path /<slug>/.
    const prefix = `/${slug}/`;
    if (!url.pathname.startsWith(prefix))
      return new Response(null, {
        status: 302,
        headers: [["location", `${url.origin}${prefix}`], ...ISOLATION],
      });

    try {
      const version = await liveVersion(slug);
      if (version instanceof Response) return version;
      const path = url.pathname.slice(prefix.length);
      const headers = new Headers();
      const etag = request.headers.get("if-none-match");
      if (etag !== null) headers.set("if-none-match", etag);
      const upstream = await fetchFn(
        `${settings.api}/serve/${slug}/${path}?v=${encodeURIComponent(version)}`,
        { method: request.method, headers },
      );
      return new Response(upstream.status === 304 ? null : upstream.body, {
        status: upstream.status,
        headers: headersOf(upstream),
      });
    } catch {
      return plain(502, "The app could not be reached.");
    }
  };
}
