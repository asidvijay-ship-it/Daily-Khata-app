// Registers the service worker so the app can work offline once loaded.
// Runs only in production-like contexts (https or localhost) since
// browsers refuse to register service workers on plain http.
export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const isLocalhost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  if (window.location.protocol !== "https:" && !isLocalhost) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("Service worker registration failed:", err);
    });
  });
}
