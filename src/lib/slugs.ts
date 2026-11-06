// Copyright (c) 2026 NIDHI AI SOLUTIONS PRIVATE LIMITED. All rights reserved.

/**
 * Platform paths and hosts that are never an app's slug
 * (pds-core docs/api/apps.md; pm/plan.md §4.1). `creator` is the host's
 * /creator page (ONB-03), asked of pds-core as its API-118; `demo` is the
 * /demo page (LND-01, LND-02), asked of pds-core too (pm/plan.md §10);
 * `marketplace` is the agent catalog, /marketplace (AGT-05), which pds-core
 * reserves as its API-132. `nidhi` is Nidhi's site, /nidhi (NID-01), and
 * `agent-os`, `mars`, `inllu` and `stuzee` the products' landing pages
 * (PRD-01), each asked of pds-core too (pm/plan.md §10).
 */
export const RESERVED_SLUGS: readonly string[] = [
  "admin",
  "register",
  "api",
  "www",
  "install",
  "apps",
  "me",
  "static",
  "assets",
  "auth",
  "platform",
  "creator",
  "demo",
  "marketplace",
  "nidhi",
  "agent-os",
  "mars",
  "inllu",
  "stuzee",
];

/** pds-core's slug format: 3–40 lower-case letters, digits and hyphens. */
const SLUG_FORMAT = /^[a-z0-9-]{3,40}$/;

export function isReservedSlug(segment: string): boolean {
  return RESERVED_SLUGS.includes(segment);
}

/** True when the segment could name an app: the right shape, and not reserved. */
export function isAppSlug(segment: string): boolean {
  return SLUG_FORMAT.test(segment) && !isReservedSlug(segment);
}

/**
 * Why a slug cannot name a new app, or null when it can: pds-core's format,
 * then its reserved words. pds-core checks again; this spares a round trip.
 */
export function appSlugProblem(
  slug: string,
): "slugFormat" | "slugReserved" | null {
  if (!SLUG_FORMAT.test(slug)) return "slugFormat";
  return isReservedSlug(slug) ? "slugReserved" : null;
}
