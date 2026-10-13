const RELEASE = "2026-10-05-motm-intelligence-v38";
const CACHE_NAME = "eastbourne-u13-webapp-v272-motm-intelligence";
const FIREBASE_HOSTS = ["eastbourneu13-default-rtdb.firebaseio.com"];
const ASSETS = [
  "./manifest.webmanifest",
  "./assets/icon.svg",
  "./assets/euyfc-live-192.png",
  "./assets/euyfc-live-512.png",
  "./assets/badge.svg",
  "./assets/badgeeu.jfif",
  "./assets/football-pro.png",
  "./assets/starting-xi.png",
  "./assets/pitch-background.png",
  "./assets/App-Splash.mp4",
  "./matchday.html",
  "./matchday.webmanifest",
  "./live-score.html",
  "./live-score.webmanifest",
  "./import-results.html",
  "./Detailed_Upload.html"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      await Promise.all(ASSETS.map(asset => cache.add(asset).catch(() => undefined)));
      const shellResponse = await fetch(`./index.html?appv=${encodeURIComponent(RELEASE)}`, { cache: "reload" });
      if (!shellResponse.ok) throw new Error(`App shell returned ${shellResponse.status}`);
      await cache.put("./index.html", shellResponse);
    })
  );
  self.skipWaiting();
});

self.addEventListener("message", event => {
  if (event.data && event.data.type === "skip-waiting") self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)));
      await self.clients.claim();
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      await Promise.all(windows.map(client => {
        const clientUrl = new URL(client.url);
        const isAdminPortal = clientUrl.pathname.endsWith("/management.html") || clientUrl.pathname.endsWith("/beta/management.html") || clientUrl.pathname.endsWith("/matchday.html") || clientUrl.pathname.endsWith("/beta/matchday.html") || clientUrl.pathname.endsWith("/live-score.html") || clientUrl.pathname.endsWith("/beta/live-score.html");
        if (isAdminPortal || clientUrl.searchParams.get("appv") === RELEASE) return undefined;
        clientUrl.searchParams.set("appv", RELEASE);
        return client.navigate(clientUrl.toString());
      }));
    })()
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (FIREBASE_HOSTS.includes(url.hostname)) {
    event.respondWith(fetch(event.request));
    return;
  }
  if (url.pathname.endsWith("/management.html") || url.pathname.endsWith("/beta/management.html") || url.pathname.endsWith("/matchday.html") || url.pathname.endsWith("/beta/matchday.html") || url.pathname.endsWith("/live-score.html") || url.pathname.endsWith("/beta/live-score.html")) {
    event.respondWith(fetch(event.request, { cache: "no-store" }).catch(() => caches.match(event.request)));
    return;
  }
  if (event.request.mode === "navigate" || url.pathname.endsWith("/index.html")) {
    const networkUrl = new URL(event.request.url);
    if (networkUrl.pathname.endsWith("/") || networkUrl.pathname.endsWith("/index.html")) networkUrl.searchParams.set("appv", RELEASE);
    event.respondWith(
      fetch(networkUrl.toString(), { cache: "reload", credentials: "same-origin" }).then(response => {
        if (!response.ok) throw new Error(`Navigation returned ${response.status}`);
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put("./index.html", copy));
        return response;
      }).catch(() => caches.match("./index.html"))
    );
    return;
  }
  event.respondWith(
    fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match(event.request).then(response => response || caches.match("./index.html")))
  );
});

self.addEventListener("message", event => {
  if (!event.data || event.data.type !== "show-notification") return;
  self.registration.showNotification(event.data.title || "Eastbourne United", event.data.options || {});
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || new URL("./index.html", self.location).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(clients => {
      const existing = clients.find(client => client.url === targetUrl || (!event.notification.data?.url && (client.url.includes("index.html") || client.url.endsWith("/"))));
      if (existing) return existing.focus();
      return self.clients.openWindow(targetUrl);
    })
  );
});
