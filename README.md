# Khata — Expense Tracker (PWA)

A mobile-first, installable, offline-capable expense tracker. React + Tailwind
+ Recharts, data stored on-device in IndexedDB. No backend, no cloud
database, no Android Studio, no laptop required.

---

## 1. Files created / modified for the PWA conversion

**Created**

- `public/manifest.webmanifest` — app name, icons, theme colors, standalone display mode.
- `public/sw.js` — the service worker (offline caching).
- `public/icon-192.png`, `public/icon-512.png` — Android home-screen icons.
- `public/icon-maskable-192.png`, `public/icon-maskable-512.png` — adaptive-icon versions for Android's masked icon shapes.
- `public/apple-touch-icon.png`, `public/favicon-32.png` — bonus icons (harmless extras, mainly for iOS/browser tabs).
- `src/registerSW.js` — registers the service worker on load.

**Modified**

- `index.html` — added the manifest link, icon links, theme/background-color meta tags, and `viewport-fit=cover` (needed for safe-area insets on notched phones).
- `src/main.jsx` — calls `registerServiceWorker()` after mounting the app.
- `src/App.jsx` —
  - Added `useInstallPrompt()` and `useOnlineStatus()` hooks.
  - Added a new **Install App** section under **More**, with steps + a one-tap install button where Chrome supports it, plus an offline banner.
  - Added safe-area padding (`env(safe-area-inset-*)`) to the top bar, bottom nav, and modals so content doesn't sit under the status bar or the gesture-navigation bar.
  - Set all form inputs to `font-size: 16px` (prevents mobile browsers from zooming in when you tap a field) and `touch-action: manipulation` on buttons (removes tap delay).
  - Strengthened the backup notice to explicitly say data is local-only and not cloud-backed-up.
- `package.json` — removed the `@capacitor/*` dependencies and the `android` script, since they're not needed for the PWA path. Everything else (dev/build/preview scripts, React/Tailwind/Recharts) is unchanged.

**Untouched — exactly as before**

- `src/db.js` (IndexedDB wrapper) — no changes.
- All existing functionality: dashboard, expense list, calendar, analytics/charts, budgets, recurring expenses, categories, payment methods, search/filters, edit/delete/duplicate, CSV export, JSON export/import.

---

## 2. Deploying using only your Android phone

You don't need to run a build yourself. The easiest path is: put the code on
GitHub, then connect a free static-hosting service that builds it in the
cloud automatically. Both steps work fully inside Chrome on your phone.

### Step A — Get the code onto GitHub

1. Install the **GitHub** app from the Play Store (or use github.com in Chrome).
2. Sign in / create a free account.
3. Create a new repository (e.g. `khata-app`) — keep it **Public** or **Private**, either works.
4. Upload this project's files into the repo. The easiest way on mobile:
   - On github.com (desktop-site mode works better for this), open your repo → **Add file → Upload files** → select all files from this project (keeping the folder structure: `public/`, `src/`, `index.html`, `package.json`, etc.) → Commit.

### Step B — Connect a free static host (auto-builds from GitHub)

Pick **one**: Netlify, Vercel, or Cloudflare Pages. All three have mobile-friendly web dashboards and a free tier, and all three run `npm install && npm run build` on their own servers — your phone never needs Node.js.

**Using Netlify (example):**

1. Go to netlify.com in Chrome → sign up with your GitHub account.
2. **Add new site → Import an existing project → GitHub** → pick your `khata-app` repo.
3. Build settings:
   - Build command: `npm run build`
   - Publish directory: `dist`
4. Deploy. Netlify gives you a free `https://your-app-name.netlify.app` URL — already HTTPS, which PWAs require.

Vercel and Cloudflare Pages work the same way: import from GitHub, build command `npm run build`, output directory `dist`.

That's it — every time you update the code on GitHub, the host rebuilds and redeploys automatically.

---

## 3. Installing the deployed PWA on Android Chrome

1. Open your deployed URL (e.g. `https://your-app-name.netlify.app`) in **Chrome** on your phone.
2. Tap the Chrome menu (⋮) in the top-right corner.
3. Tap **"Add to Home screen"** or **"Install app"**.
4. Confirm.
5. Open **Khata** from your home screen — it opens full-screen, without Chrome's address bar, like a native app.

(If Chrome thinks the site qualifies for a fast-track install, it may also show its own **"Install app"** banner or the in-app **Install App** button under More → Install App will work with one tap.)

---

## 4. How offline mode works

- `public/sw.js` is a service worker: a background script the browser runs even when the site isn't open.
- On first visit, it caches the app shell (HTML, manifest, icons).
- After that, it uses a **stale-while-revalidate** strategy for your JS/CSS/asset files: it serves the cached copy instantly (works offline) while quietly fetching a fresh copy in the background for next time.
- Page navigations use a **network-first** strategy with a cached fallback, so the app still opens even with zero signal.
- The service worker never touches IndexedDB — your expense data is separate browser storage, untouched by caching logic.
- A small banner appears at the top of the app whenever your phone goes offline, just so you know changes are being saved locally rather than synced anywhere.

---

## 5. How expense data is stored

- Everything (expenses, recurring rules, budget) lives in **IndexedDB**, inside Chrome's storage for that specific site/installed app.
- It survives: closing the app, closing Chrome, restarting your phone.
- It does **not** survive: uninstalling the installed PWA, clearing Chrome's site data/storage for that site, or clearing app data from Android Settings. Same rule as any other Android app's local storage.
- It is **not** synced to any server or cloud account — this is by design (no backend, works fully offline).

---

## 6. Backup and restore

**Export** (More → Backup & Data):
- **Export CSV** — spreadsheet-friendly, columns: Date, Time, Category, Description, Payment Method, Amount, Notes.
- **Export JSON** — full backup (expenses + recurring rules), use this one for restoring later.

**Restore**:
- More → Backup & Data → **Import JSON Backup** → pick a previously exported `.json` file → confirm.

**Recommended habit:** export a JSON backup every so often (weekly is reasonable for daily use), and always right before uninstalling the app, clearing browser data, or switching phones — since local data doesn't leave the device on its own.

---

## 7. Local development (optional — only if you ever get access to a computer)

```bash
npm install
npm run dev      # local dev server with hot reload
npm run build    # production build into dist/
npm run preview  # preview the production build locally
```

None of this is required for day-to-day use once it's deployed — this section is only useful if you want to test changes before pushing them to GitHub.
