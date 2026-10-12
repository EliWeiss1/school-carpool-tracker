/*
 * The smallest service worker that makes the app installable.
 *
 * Chrome will not offer its install prompt without a fetch handler, so this
 * exists for that and for one kindness: if the phone has no signal when the app
 * is opened, it says so instead of showing the browser's dinosaur page.
 *
 * It deliberately caches NOTHING. /display and /announce are live, and a board
 * that quietly shows last hour's arrivals is worse than one that says it cannot
 * connect. Only page loads (navigations) are touched; every other request --
 * Supabase, the Edge Functions, the Deepgram socket -- goes straight to the
 * network exactly as it would without a worker.
 */

const OFFLINE_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#10151f">
<title>No connection</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; flex-direction: column;
    justify-content: center; padding: 0 24px; background: #10151f; color: #fff;
    font-family: system-ui, sans-serif; line-height: 1.7; }
  p.eyebrow { margin: 0; font: 500 12px ui-monospace, monospace;
    letter-spacing: 0.14em; text-transform: uppercase; color: #ffc24d; }
  h1 { margin: 12px 0 0; font-size: 32px; line-height: 1.1;
    letter-spacing: -0.03em; }
  p { max-width: 28rem; color: #c3cad5; }
  button { margin-top: 12px; min-height: 56px; padding: 0 24px; border: 0;
    border-radius: 12px; background: #f5a524; color: #10151f;
    font: 600 16px system-ui, sans-serif; cursor: pointer; }
  button:focus-visible { outline: 3px solid #f5a524; outline-offset: 2px; }
</style>
</head>
<body>
  <p class="eyebrow">Pickup line</p>
  <h1>No connection</h1>
  <p>CarpoolCaller needs a connection to show who has arrived. Check your wifi or signal, then try again.</p>
  <div><button type="button" onclick="location.reload()">Try again</button></div>
</body>
</html>`;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;

  event.respondWith(
    fetch(event.request).catch(
      () =>
        new Response(OFFLINE_PAGE, {
          status: 503,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
    ),
  );
});
