"use strict";

// Increase this number for every deployment.
const VERSION = 2;
const scope = self.registration.scope;
const cachePrefix = "warehouse-shell:" + scope + ":";
const cacheName = cachePrefix + VERSION;
const home = new URL("./", scope).href;
const index = new URL("./index.html", scope).href;
const staticFiles = new Set([
  "style.css",
  "app.js",
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
].map((path) => new URL(path, scope).href));

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    const urls = [index, ...staticFiles];
    await cache.addAll(urls.map((url) => new Request(url, { cache: "reload" })));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const oldVersions = keys.filter((key) => key.startsWith(cachePrefix) && key !== cacheName);
    await Promise.all(oldVersions.map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function cachedOrFetch(cacheKey, request) {
  return (await caches.match(cacheKey, { cacheName })) || fetch(request);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const page = new URL(request.url);
  page.search = "";
  if (request.mode === "navigate" && (page.href === home || page.href === index)) {
    event.respondWith(cachedOrFetch(index, request));
  } else if (staticFiles.has(request.url)) {
    event.respondWith(cachedOrFetch(request.url, request));
  }
});
