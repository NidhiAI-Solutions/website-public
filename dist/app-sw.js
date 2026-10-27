// Copyright (c) 2026 NIDHI AI SOLUTIONS PRIVATE LIMITED. All rights reserved.

/*
 * The service worker of an installed app (pm/tasks.md APP-04; pm/plan.md
 * §4.4), registered by /<slug>/install with the scope /<slug>/. It keeps the
 * host's shell, so an installed app opens even offline to the host's own
 * page, which then draws the app's frame when it can. It keeps no user
 * data: an app's offline data is the app's own, in its frame. It never
 * answers for /api, for another origin, or for anything but GET.
 */

const SHELL = "app-shell-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(["/index.html"]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith("app-shell-") && name !== SHELL)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") {
    // Every page of the host is its one shell.
    event.respondWith(fetch(request).catch(() => caches.match("/index.html")));
    return;
  }
  // The host's files: the network first, then whatever the host's own worker keeps.
  event.respondWith(fetch(request).catch(() => caches.match(request)));
});
