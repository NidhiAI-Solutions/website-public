// Copyright (c) 2026 NIDHI AI SOLUTIONS PRIVATE LIMITED. All rights reserved.

import { isAppSlug } from "../src/lib/slugs.ts";
import { slugOfHost } from "./app-origin.ts";

/**
 * An app's own tags in the host's pages (PWA-01, pm/plan.md §16.2; pds-core
 * bundles.md "The web manifest"). Every host page under /<slug>/ is the
 * host's `index.html` with the app's manifest link, its home-screen icon and
 * title, its theme colour and its title in place of the platform's, so
 * installing from any page of the app installs that app, on its own scope.
 * The platform's own paths, files, and an app pds-core does not serve keep
 * the platform's. Netlify's edge function and the dev server share it.
 */

export interface AppManifest {
  id?: string;
  name?: string;
  short_name?: string;
  theme_color?: string;
  icons?: { src?: string; sizes?: string; type?: string }[];
}

export interface AppPageSettings {
  /** pds-core's API, ending in /api. */
  api: string;
  /** The domain apps are served under: their own origins are left alone. */
  appsBaseDomain: string;
  fetch?: typeof fetch;
  now?: () => number;
}

/** How long an app's manifest is kept, as the live version is (app-origin.ts). */
const MANIFEST_MS = 15_000;

/** The app a host page is under, or null for the platform's own pages and files. */
export function slugOfPage(pathname: string): string | null {
  const segments = pathname.split("/").filter((s) => s !== "");
  const [first] = segments;
  if (first === undefined || !isAppSlug(first)) return null;
  // A file (with an extension) is never a page.
  if (segments.at(-1)?.includes(".")) return null;
  return first;
}

const escape = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** The largest https icon, for Apple's home screen, which reads no manifest icons. */
function homeScreenIcon(manifest: AppManifest): string | null {
  const icons = (manifest.icons ?? []).filter(
    (icon) => typeof icon.src === "string" && icon.src.startsWith("https://"),
  );
  const size = (icon: { sizes?: string }) =>
    Math.max(
      0,
      ...(icon.sizes ?? "")
        .split(/\s+/)
        .map((s) => Number(s.split("x")[0]) || 0),
    );
  const largest = icons.sort((a, b) => size(b) - size(a))[0];
  return largest?.src ?? null;
}

/** The host's page with the app's tags in place of the platform's. */
export function withAppTags(
  html: string,
  slug: string,
  manifest: AppManifest,
): string {
  const name = manifest.name ?? slug;
  const shortName = manifest.short_name ?? name;
  const icon = homeScreenIcon(manifest);
  let page = html
    // The platform's own manifest gives way to the app's.
    .replace(/\s*<link rel="manifest"[^>]*>/g, "")
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escape(name)}</title>`);
  if (typeof manifest.theme_color === "string")
    page = page.replace(/\s*<meta name="theme-color"[^>]*>/g, "");
  const tags = [
    `<link rel="manifest" href="/api/apps/${encodeURIComponent(slug)}/manifest.webmanifest">`,
    ...(typeof manifest.theme_color === "string"
      ? [`<meta name="theme-color" content="${escape(manifest.theme_color)}">`]
      : []),
    ...(icon === null
      ? []
      : [`<link rel="apple-touch-icon" href="${escape(icon)}">`]),
    `<meta name="apple-mobile-web-app-title" content="${escape(shortName)}">`,
    '<meta name="apple-mobile-web-app-capable" content="yes">',
    '<meta name="mobile-web-app-capable" content="yes">',
  ];
  return page.replace("</head>", `    ${tags.join("\n    ")}\n  </head>`);
}

/**
 * The tagger: a host page under /<slug>/ answered with the app's tags, from
 * `page` (the host's own answer, its `index.html`), or null where the
 * platform's page stands as it is.
 */
export function createAppPageTagger(settings: AppPageSettings) {
  const fetchFn: typeof fetch = (input, init) =>
    (settings.fetch ?? fetch)(input, init);
  const now = settings.now ?? Date.now;
  const kept = new Map<string, { manifest: AppManifest; at: number }>();

  /** The app's manifest, or null when pds-core does not serve the app. */
  async function manifestOf(slug: string): Promise<AppManifest | null> {
    const found = kept.get(slug);
    if (found !== undefined && now() - found.at < MANIFEST_MS)
      return found.manifest;
    try {
      const response = await fetchFn(
        `${settings.api}/apps/${encodeURIComponent(slug)}/manifest.webmanifest`,
        { headers: { accept: "application/manifest+json, application/json" } },
      );
      if (!response.ok) return null;
      const manifest = (await response.json()) as AppManifest;
      kept.set(slug, { manifest, at: now() });
      return manifest;
    } catch {
      return null;
    }
  }

  return async function tag(
    request: Request,
    page: () => Promise<Response>,
  ): Promise<Response | null> {
    if (request.method !== "GET" && request.method !== "HEAD") return null;
    if (!(request.headers.get("accept") ?? "").includes("text/html"))
      return null;
    const url = new URL(request.url);
    if (slugOfHost(url.host, settings.appsBaseDomain) !== null) return null;
    const slug = slugOfPage(url.pathname);
    if (slug === null) return null;
    const manifest = await manifestOf(slug);
    if (manifest === null) return null;
    const answer = await page();
    if (!(answer.headers.get("content-type") ?? "").includes("text/html"))
      return answer;
    const headers = new Headers(answer.headers);
    // The body is rewritten: its length no longer holds.
    headers.delete("content-length");
    return new Response(withAppTags(await answer.text(), slug, manifest), {
      status: answer.status,
      headers,
    });
  };
}
