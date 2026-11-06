// Copyright (c) 2026 NIDHI AI SOLUTIONS PRIVATE LIMITED. All rights reserved.

import { createAppPageTagger } from "../app-page.ts";

/**
 * Netlify's edge function for an app's pages on the host (PWA-01,
 * pm/plan.md §16.2): a page under /<slug>/ is the host's `index.html` with
 * the app's own tags, so the app installs as its own PWA from any of its
 * pages. Its settings are the site's: PDS_API_ORIGIN (pds-core's Functions
 * URL, ending in /api) and APPS_BASE_DOMAIN. Any other request goes on.
 */

declare const Netlify: { env: { get(name: string): string | undefined } };

interface Context {
  next(): Promise<Response>;
}

let tagger: {
  key: string;
  tag: ReturnType<typeof createAppPageTagger>;
} | null = null;

export default async function appPage(
  request: Request,
  context: Context,
): Promise<Response | undefined> {
  const api = Netlify.env.get("PDS_API_ORIGIN");
  const appsBaseDomain = Netlify.env.get("APPS_BASE_DOMAIN");
  if (api === undefined || appsBaseDomain === undefined) return undefined;
  const key = `${api} ${appsBaseDomain}`;
  // Kept between requests, so an app's manifest is asked for once in 15 s.
  if (tagger?.key !== key)
    tagger = { key, tag: createAppPageTagger({ api, appsBaseDomain }) };
  return (await tagger.tag(request, () => context.next())) ?? undefined;
}

export const config = { path: "/*" };
