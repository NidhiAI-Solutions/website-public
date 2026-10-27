// Copyright (c) 2026 NIDHI AI SOLUTIONS PRIVATE LIMITED. All rights reserved.

import { createAppServer } from "../app-origin.ts";

/**
 * Netlify's edge function for `*.apps.<domain>` (pm/plan.md §4.4; pds-core
 * docs/deployment.md "Serving app bundles at the edge"). Its settings are
 * the site's: PDS_API_ORIGIN (pds-core's Functions URL, ending in /api) and
 * APPS_BASE_DOMAIN. Any other host's request goes on to the site.
 */

declare const Netlify: { env: { get(name: string): string | undefined } };

let server: { key: string; serve: ReturnType<typeof createAppServer> } | null =
  null;

export default async function serveApp(
  request: Request,
): Promise<Response | undefined> {
  const api = Netlify.env.get("PDS_API_ORIGIN");
  const appsBaseDomain = Netlify.env.get("APPS_BASE_DOMAIN");
  if (api === undefined || appsBaseDomain === undefined) return undefined;
  const key = `${api} ${appsBaseDomain}`;
  // Kept between requests, so the live version is asked for once in 15 s.
  if (server?.key !== key)
    server = { key, serve: createAppServer({ api, appsBaseDomain }) };
  return (await server.serve(request)) ?? undefined;
}

export const config = { path: "/*" };
