---
name: content-explorer-template
description: Template for building a Bun/TypeScript content explorer with SQLite FTS5, WASM embeddings, hybrid search, haptic feedback, Cloudflare Workers deployment, and a neo-brutalist landing page
---

# Content Explorer Template

A reference architecture for building fast, single-file content search tools with hybrid keyword + semantic search, pre-built SQLite data, and Cloudflare Workers deployment.

This template was extracted from the [Font Awesome Icon Explorer](https://fontawesome-explorer.atsignhandle.workers.dev/) -- a production app serving 3,860 icons with sub-millisecond keyword search and ~40ms semantic search, all running client-side in the browser.

---

## Architecture Overview

```
                     BUILD TIME                          RUNTIME
            ┌──────────────────────┐          ┌──────────────────────┐
            │  Raw Content Source  │          │    Cloudflare Edge   │
            │  (metadata, files)   │          │                      │
            └──────┬───────────────┘          │  ┌────────────────┐  │
                   │                          │  │  Worker (API)  │  │
            ┌──────▼───────────────┐          │  │  Inverted idx  │  │
            │  ingest.ts (Bun)     │          │  │  Smart search  │  │
            │  Parse → SQLite FTS5 │          │  └────────────────┘  │
            └──────┬───────────────┘          │                      │
                   │                          │  ┌────────────────┐  │
            ┌──────▼───────────────┐          │  │  Static Assets │  │
            │  embed.ts (Bun)      │          │  │  index.html    │  │
            │  ONNX model →        │          │  │  embeddings.bin│  │
            │  384-dim Float32     │          │  │  search-terms  │  │
            └──────┬───────────────┘          │  └────────────────┘  │
                   │                          └──────────────────────┘
            ┌──────▼───────────────┐
            │  Export              │                 CLIENT SIDE
            │  icons.json (394KB)  │          ┌──────────────────────┐
            │  search-terms.json   │          │  Single HTML File    │
            │  embeddings.bin      │          │  ├ Inline CSS         │
            │  (5.7MB Float32)     │          │  ├ Inline JS          │
            └──────────────────────┘          │  ├ Inline data JSON   │
                                              │  ├ FTS5 inverted idx  │
                                              │  ├ WASM embedder      │
                                              │  ├ Haptic feedback    │
                                              │  └ Confetti on copy   │
                                              └──────────────────────┘
```

Two systems share one repo:

1. **Frontend** -- a single HTML file (~430KB) with inline CSS, JS, and a JSON array of all content items. No framework, no bundler. Runs entirely in the browser.
2. **Worker API** -- Cloudflare Worker that serves static assets via `[assets]` binding AND provides JSON API endpoints under `/api/`.

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Runtime** | Bun | Build scripts, TypeScript execution |
| **Database** | SQLite + FTS5 | Full-text search index at build time |
| **Embeddings** | all-MiniLM-L6-v2 (ONNX) | 384-dim semantic vectors |
| **Frontend** | Vanilla JS (single file) | No framework, no bundler |
| **Deployment** | Cloudflare Workers | Edge compute + static asset serving |
| **Search** | Hybrid FTS5 + cosine similarity | Sub-ms keyword + ~40ms semantic |
| **Feedback** | Haptic engine (iOS/Android) | Touch feedback on interactions |
| **Effects** | canvas-confetti | Copy celebration |

### Client-Side Bundle Sizes

| Asset | Size | Gzip | Purpose |
|-------|------|------|---------|
| `index.html` | ~430 KB | ~80 KB | SPA with inline data, CSS, JS |
| `embeddings.bin` | 5.7 MB | ~4.2 MB | Pre-computed 384-dim vectors |
| `search-terms.js` | ~50 KB | ~15 KB | Expanded search metadata |
| FA CSS + webfonts | ~350 KB | ~120 KB | Icon rendering |
| **Total** | ~6.5 MB | ~4.4 MB | Full app with semantic search |

### Load Performance (Cloudflare Edge)

| Metric | Value | Notes |
|--------|-------|-------|
| First Contentful Paint | ~200ms | HTML + inline CSS, edge-cached |
| Icon grid rendered | ~400ms | JSON parsed, DOM built |
| FTS5 search ready | ~500ms | Inverted index built from inline data |
| Embeddings loaded | ~1-2s | 5.7MB binary fetch (edge-cached) |
| Semantic model ready | ~3-8s | ONNX model download + WASM init |
| Service worker cache | instant | Subsequent visits fully cached |

---

## Data Pipeline

### Step 1: Ingest Content into SQLite

```bash
bun run src/build/ingest.ts
```

Reads raw content metadata and creates a normalized SQLite database with FTS5 full-text search.

**Schema pattern:**

```sql
-- Core content table
CREATE TABLE items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  category TEXT,
  metadata TEXT,        -- JSON blob for extensible fields
  tier TEXT DEFAULT 'free',
  source_id INTEGER REFERENCES sources(id)
);

-- Full-text search (FTS5)
CREATE VIRTUAL TABLE items_fts USING fts5(
  name, label, search_terms, aliases, categories,
  content=items, content_rowid=id
);

-- Auto-sync triggers
CREATE TRIGGER items_ai AFTER INSERT ON items BEGIN
  INSERT INTO items_fts(rowid, name, label, search_terms, aliases, categories)
  VALUES (new.id, new.name, new.label, new.search_terms, new.aliases, new.categories);
END;
```

**Key pattern:** Parse source metadata, normalize into compact JSON, insert in a single transaction for speed.

```typescript
import Database from "bun:sqlite";

const db = new Database("data/content.db", { create: true });
db.exec("PRAGMA journal_mode=WAL");
db.exec("PRAGMA synchronous=NORMAL");

// Transaction wrap for bulk inserts (10x+ faster)
const insertItem = db.prepare(`INSERT INTO items (...) VALUES (...)`);
db.transaction(() => {
  for (const item of parsedItems) {
    insertItem.run(item.name, item.label, JSON.stringify(item.searchTerms));
  }
})();
```

### Step 2: Generate Embeddings

```bash
bun run src/build/embed.ts
```

Uses the all-MiniLM-L6-v2 ONNX model to create 384-dimensional embeddings for each content item.

**Document construction** -- combine all searchable fields into one text:

```typescript
const doc = [item.label, item.name.replace(/-/g, " "), ...item.searchTerms].join(", ");
```

**Batch embedding generation:**

```typescript
import { pipeline } from "@xenova/transformers";

const embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
  quantized: true,
});

const BATCH_SIZE = 64;
for (let i = 0; i < docs.length; i += BATCH_SIZE) {
  const batch = docs.slice(i, i + BATCH_SIZE);
  const output = await embedder(batch, { pooling: "mean", normalize: true });

  for (let j = 0; j < batch.length; j++) {
    const embedding = output[j].data; // Float32Array, 384 dims
    const buffer = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
    insertEmbedding.run(items[i + j].id, buffer);
  }
}
```

**Binary export for frontend:**

```typescript
// Export as sequential Float32Array for browser loading
const allEmbeddings = new Float32Array(itemCount * 384);
let offset = 0;
for (const row of db.prepare("SELECT embedding FROM item_embeddings ORDER BY item_id").all()) {
  const f32 = new Float32Array(row.embedding.buffer);
  allEmbeddings.set(f32, offset);
  offset += 384;
}
Bun.write("dist/data/embeddings.bin", allEmbeddings.buffer);
```

### Step 3: Export for Frontend + Worker

```typescript
// Compact JSON format -- single-letter keys for compression
const items = db.prepare("SELECT * FROM items").all().map(row => ({
  n: row.name,        // name
  u: row.unicode,     // unique ID
  L: row.label,       // display label
  T: row.tier[0],     // 'p'=pro, 'f'=free
  C: row.category,    // category
  B: row.isBrand ? 1 : 0,
}));

Bun.write("src/data/items.json", JSON.stringify(items));
```

---

## Frontend: Single-File SPA

### Structure

```html
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>/* All CSS inline (~900 lines) */</style>
  <script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js" defer></script>
</head>
<body>
  <div class="fixed-top">
    <header><!-- Title, nav buttons --></header>
    <div class="tabs-container"><!-- Filter category tabs --></div>
    <div class="search-container"><!-- Search bar + controls --></div>
  </div>
  <div class="grid-container"><!-- Content grid --></div>
  <div class="detail-overlay"><!-- Detail popup --></div>

  <script>
    // Inline JSON data array (~390KB line)
    const ALL_ITEMS = [{"n":"item-name","L":"Item Label",...}, ...];

    // All JavaScript inline (~1400 lines)
    // - Inverted index builder
    // - Embedding loader + cosine search
    // - Hybrid fusion
    // - Haptic engine
    // - Confetti engine
    // - UI rendering
  </script>
</body>
</html>
```

### Search: Inverted Index (Keyword)

Build at page load from the inline JSON data. Average latency: **0.18ms**.

```javascript
const searchIndex = new Map(); // token -> Set<itemName>

function buildSearchIndex() {
  for (const item of ALL_ITEMS) {
    const tokens = tokenize(item.n + " " + item.L + " " + (SEARCH_TERMS[item.n] || []).join(" "));
    for (const token of tokens) {
      if (!searchIndex.has(token)) searchIndex.set(token, new Set());
      searchIndex.get(token).add(item.n);
    }
  }
}

function tokenize(text) {
  return text.toLowerCase().split(/[\s,;:\-_]+/).filter(t => t.length > 0);
}
```

**Scoring:**

```javascript
function ftsSearch(query) {
  const tokens = tokenize(query);
  const scores = new Map();

  for (const token of tokens) {
    for (const [indexToken, items] of searchIndex) {
      let score = 0;
      if (indexToken === token) score = 3;           // exact
      else if (indexToken.startsWith(token)) score = 2; // prefix
      else if (token.length >= 3 && indexToken.includes(token)) score = 1; // substring

      if (score > 0) {
        for (const name of items) {
          scores.set(name, (scores.get(name) || 0) + score);
        }
      }
    }
  }

  // Boost items whose name starts with query
  const normalized = query.replace(/\s+/g, "-");
  for (const [name, score] of scores) {
    if (name.startsWith(normalized)) scores.set(name, score + 5);
  }

  return [...scores.entries()].sort((a, b) => b[1] - a[1]);
}
```

### Search: Semantic Embeddings (WASM)

Load pre-computed 384-dim vectors from `embeddings.bin`. Query embedding generated in-browser via ONNX WASM runtime. Average latency: **35-55ms**.

```javascript
let embeddingData = null; // Float32Array
let embedder = null;      // transformers.js pipeline
const DIMS = 384;

async function loadEmbeddings() {
  const resp = await fetch("/data/embeddings.bin");
  const ab = await resp.arrayBuffer();
  embeddingData = new Float32Array(ab);
}

async function loadEmbedder() {
  // Note: browser may request transformers.min.js.map which returns 404 -- expected CDN behavior
  const { pipeline, env } = await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.4.1");

  env.useBrowserCache = true;
  env.cacheDir = "content-explorer-models";
  env.allowLocalModels = false;
  env.remoteHost = location.origin + "/hf-proxy"; // CORS proxy via worker

  embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
    quantized: true,
    progress_callback: (p) => { /* update UI with download progress */ },
  });
}

async function embeddingSearch(query, topK = 50) {
  const output = await embedder(query, { pooling: "mean", normalize: true });
  const qVec = output.data; // Float32Array[384]

  const scores = [];
  for (let i = 0; i < embeddingData.length / DIMS; i++) {
    let dot = 0;
    const offset = i * DIMS;
    for (let d = 0; d < DIMS; d++) dot += qVec[d] * embeddingData[offset + d];
    scores.push({ index: i, score: dot });
  }

  return scores.sort((a, b) => b.score - a.score).slice(0, topK);
}
```

### Search: Hybrid Fusion

Combines keyword and semantic results. Formula: `0.7 * FTS5_rank + 0.3 * cosine_rank`.

```javascript
async function hybridSearch(query) {
  const ftsResults = ftsSearch(query);
  const embResults = await embeddingSearch(query);

  const fused = new Map();
  const maxFts = Math.max(ftsResults.length, 1);
  const maxEmb = Math.max(embResults.length, 1);

  // Normalize FTS scores by rank position
  ftsResults.forEach(([name], i) => {
    fused.set(name, 0.7 * (1 - i / maxFts));
  });

  // Add embedding scores
  embResults.forEach((result, i) => {
    const name = EMBEDDING_NAMES[result.index];
    const existing = fused.get(name) || 0;
    fused.set(name, existing + 0.3 * (1 - i / maxEmb));
  });

  return [...fused.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => itemMap.get(name));
}
```

### Keyboard Shortcut: `/` to Focus Search

```javascript
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && document.activeElement !== searchInput) {
    e.preventDefault();
    searchInput.focus();
    // Guard: some browsers insert "/" despite preventDefault
    searchInput.value = searchInput.value.replace(/^\/+/, "");
  }
});
```

---

## Haptic Feedback Engine

Cross-platform haptics using the iOS checkbox switch trick and Android `navigator.vibrate()` API.

### Platform Detection

```javascript
const _isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const _isAndroid = /Android/.test(navigator.userAgent);
```

### Preset Patterns

Each pattern is an array of `{duration, intensity, delay}` objects:

```javascript
const HAPTIC_PRESETS = {
  success:   [{ duration: 60, intensity: 0.7 }, { duration: 80, intensity: 1.0, delay: 40 }, { duration: 40, intensity: 0.5, delay: 40 }],
  nudge:     [{ duration: 120, intensity: 1.0 }, { duration: 80, intensity: 0.6, delay: 60 }],
  error:     [{ duration: 60, intensity: 1.0 }, { duration: 60, intensity: 1.0, delay: 30 }, { duration: 60, intensity: 1.0, delay: 30 }],
  light:     [{ duration: 30, intensity: 0.5 }, { duration: 20, intensity: 0.3, delay: 30 }],
  medium:    [{ duration: 50, intensity: 0.8 }, { duration: 40, intensity: 0.6, delay: 40 }],
  selection: [{ duration: 15, intensity: 0.5 }, { duration: 15, intensity: 0.3, delay: 20 }],
  pulse:     [{ duration: 20, intensity: 0.4 }],
};
```

### iOS Implementation (Checkbox Switch PWM)

iOS Safari triggers native haptic feedback when toggling `<input type="checkbox" switch>`. By clicking a hidden label at varying frequencies (PWM), you control haptic intensity.

```javascript
const TOGGLE_MIN = 16;  // ms at intensity 1.0 (every frame)
const TOGGLE_MAX = 184; // ms range above min

function ensureHapticElement() {
  const label = document.createElement("label");
  label.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0.01;overflow:hidden;z-index:-1;";
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.setAttribute("switch", "");
  label.appendChild(cb);
  document.body.appendChild(label);
  return label;
}

function runIOSHapticPattern(vibrations) {
  // Build phase timeline from vibration objects
  const phases = [];
  let offset = 0;
  for (const v of vibrations) {
    if (v.delay) { phases.push({ start: offset, end: offset + v.delay, type: "pause" }); offset += v.delay; }
    phases.push({ start: offset, end: offset + v.duration, type: "vibrate", intensity: v.intensity });
    offset += v.duration;
  }

  // RAF loop: click label at frequency proportional to intensity
  let startTime = null, lastToggle = 0;
  function run(time) {
    if (!startTime) startTime = time;
    const elapsed = time - startTime;
    if (elapsed >= offset) return;

    const phase = phases.find(p => elapsed >= p.start && elapsed < p.end);
    if (phase?.type === "vibrate") {
      const interval = TOGGLE_MIN + TOGGLE_MAX * (1 - phase.intensity);
      if (time - lastToggle >= interval) { hapticLabel.click(); lastToggle = time; }
    }
    requestAnimationFrame(run);
  }

  hapticLabel.click(); // Initial click within user gesture context
  requestAnimationFrame(run);
}
```

### Android Implementation (PWM Vibration)

```javascript
function toVibratePattern(vibrations) {
  const PWM_CYCLE = 20; // ms
  const result = [];
  for (const v of vibrations) {
    if (v.delay) result.push(0, v.delay);
    if (v.intensity >= 1) { result.push(v.duration, 0); continue; }
    const on = Math.max(1, Math.round(PWM_CYCLE * v.intensity));
    const off = PWM_CYCLE - on;
    let remaining = v.duration;
    while (remaining >= PWM_CYCLE) { result.push(on, off); remaining -= PWM_CYCLE; }
  }
  return result;
}
```

### Usage

```javascript
function haptic(preset) {
  const pattern = HAPTIC_PRESETS[preset];
  if (navigator.vibrate) navigator.vibrate(toVibratePattern(pattern));
  if (_isIOS) runIOSHapticPattern(pattern);
}

// Wire to UI events:
// - Search keystroke:    haptic("pulse")
// - Search results:      haptic("selection")
// - Nav button tap:      haptic("light")
// - Detail open:         haptic("medium")
// - Zoom +/-:            haptic("selection")
// - Copy action:         haptic("success")
// - Color cycle start:   hapticPulse("pulse", 500)  // returns stop()
```

---

## Confetti on Copy

Uses [canvas-confetti](https://github.com/catdad/canvas-confetti) with a dedicated canvas layer above all overlays.

```javascript
let confettiInstance = null;

function getConfetti() {
  if (confettiInstance) return confettiInstance;
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:99999;";
  document.body.appendChild(canvas);
  confettiInstance = confetti.create(canvas, { resize: true });
  return confettiInstance;
}

function shootConfetti(durationMs = 3000) {
  const fire = getConfetti();
  const start = Date.now();

  // Cannons from left + right edges
  const t1 = setInterval(() => {
    if (Date.now() - start > durationMs) return clearInterval(t1);
    fire({ particleCount: 10, angle: 55, spread: 60, origin: { x: 0, y: 0.65 }, colors: COLORS });
    fire({ particleCount: 10, angle: 125, spread: 60, origin: { x: 1, y: 0.65 }, colors: COLORS });
  }, 200);

  // Emoji shapes after 50% duration
  setTimeout(() => {
    const sparkle = confetti.shapeFromText({ text: "\u2728", scalar: 3.5 });
    const party = confetti.shapeFromText({ text: "\uD83C\uDF89", scalar: 3.5 });
    const t2 = setInterval(() => {
      if (Date.now() - start > durationMs) return clearInterval(t2);
      fire({ particleCount: 2, angle: 90, spread: 80, origin: { x: 0.5, y: 1 }, shapes: [sparkle, party], scalar: 3.5, flat: true });
    }, 300);
  }, durationMs * 0.5);
}
```

**Critical:** Create the canvas with `z-index: 99999` so confetti renders above modal overlays (which typically use z-index 200-300).

---

## Cloudflare Workers API

### Worker Entry Point

```typescript
// src/worker.ts
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // API routes
    if (path === "/api/search") return handleSearch(url);
    if (path === "/api/smart") return handleSmartSearch(url);
    if (path === "/api/icons") return handleBrowse(url);
    if (path.startsWith("/api/icon/")) return handleIconDetail(path);
    if (path === "/api/docs") return handleDocs();
    if (path.startsWith("/hf-proxy/")) return handleHFProxy(path);

    // Static assets (index.html, embeddings.bin, etc.)
    return env.ASSETS.fetch(request);
  },
};
```

### Wrangler Configuration

```toml
name = "content-explorer"
main = "src/worker.ts"
compatibility_date = "2026-03-15"
compatibility_flags = ["nodejs_compat"]
workers_dev = true

[observability.logs]
enabled = true
invocation_logs = true

[assets]
directory = "dist"
binding = "ASSETS"
```

The `[assets]` binding serves static files from `dist/` at the edge. The worker handles `/api/*` routes and falls through to assets for everything else.

### HuggingFace CORS Proxy

The ONNX model files are hosted on HuggingFace, which has CORS restrictions. The worker proxies these requests:

```typescript
async function handleHFProxy(path: string): Promise<Response> {
  const hfPath = path.replace("/hf-proxy/", "");
  const hfUrl = `https://huggingface.co/${hfPath}`;

  const response = await fetch(hfUrl, {
    headers: { "User-Agent": "content-explorer/1.0" },
  });

  return new Response(response.body, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("Content-Type") || "application/octet-stream",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
```

### Worker-Side Inverted Index

The worker builds its own inverted index at V8 isolate startup (once per cold start):

```typescript
import iconsData from "./data/icons.json";
import searchTermsData from "./data/search-terms.json";

// Built once per isolate, reused across requests
const invertedIndex = new Map<string, Set<string>>();
const iconMap = new Map<string, Icon>();

for (const icon of iconsData) {
  iconMap.set(icon.n, icon);
  const terms = searchTermsData[icon.n] || [];
  const tokens = tokenize([icon.n, icon.L, ...terms].join(" "));
  for (const token of tokens) {
    if (!invertedIndex.has(token)) invertedIndex.set(token, new Set());
    invertedIndex.get(token).add(icon.n);
  }
}
```

### API Endpoints

| Endpoint | Method | Parameters | Description |
|----------|--------|------------|-------------|
| `/api/search` | GET | `q`, `limit`, `style` | Keyword search (inverted index) |
| `/api/smart` | GET | `q`, `limit`, `style` | Smart search (keywords + expanded terms + categories) |
| `/api/icons` | GET | `limit`, `offset`, `style` | Paginated browse |
| `/api/icon/:name` | GET | -- | Single item detail with all variants |
| `/api/docs` | GET | -- | Interactive API documentation page |
| `/hf-proxy/*` | GET | -- | CORS proxy for HuggingFace model files |

### API Response Format

```json
{
  "query": "arrow",
  "count": 42,
  "results": [
    {
      "name": "arrow-up",
      "unicode": "f062",
      "label": "Arrow Up",
      "tier": "pro",
      "styles": ["solid", "regular", "light", "thin"],
      "brands": false
    }
  ]
}
```

---

## Service Worker Caching

```javascript
const CACHE_NAME = "content-explorer-v1";
const PRECACHE_URLS = ["/", "/index.html", "/data/embeddings.bin", "/data/search-terms.js"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Suppress source map 404s (CDN doesn't publish .map files)
  if (url.pathname.endsWith(".map")) {
    event.respondWith(new Response("", { status: 200, headers: { "Content-Type": "application/json" } }));
    return;
  }

  // Navigation: network-first with cache fallback
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).then((r) => {
        caches.open(CACHE_NAME).then((c) => c.put(event.request, r.clone()));
        return r;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  // Same-origin: cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
  }
});
```

---

## Mobile-First Responsive Design

### Layout Reordering with CSS `order`

The `.fixed-top` container uses flexbox column + `order` to reorder sections without touching HTML:

```css
@media (max-width: 768px) {
  .fixed-top { display: flex; flex-direction: column; }
  .site-header     { order: 1; }
  .narrative       { order: 4; display: none; }  /* shown as popup */
  .tabs-container  { order: 2; }
  .search-container { order: 3; }
}
```

### Prevent iOS Auto-Zoom on Input Focus

iOS Safari zooms when input `font-size` < 16px:

```css
@media (max-width: 768px) {
  .search-input { font-size: 16px; }
}
```

### Touch-Scrollable Tabs

```css
.style-tabs {
  overflow-x: auto;
  flex-wrap: nowrap;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  scroll-snap-type: x proximity;
}
.style-tabs::-webkit-scrollbar { display: none; }
.style-tab { scroll-snap-align: start; flex-shrink: 0; }
```

### Dismissible Intro Popup (Mobile)

```javascript
function checkShowIntro() {
  if (window.innerWidth > 768) return;
  if (localStorage.getItem("intro-dismissed") === "1") return;
  const narrative = document.querySelector(".narrative");
  document.getElementById("intro-popup-content").innerHTML = narrative.innerHTML;
  document.getElementById("intro-popup").classList.add("open");
}

function dismissIntro() {
  document.getElementById("intro-popup").classList.remove("open");
  localStorage.setItem("intro-dismissed", "1");
}
```

---

## Design System: Neo-Brutalist

| Property | Value |
|----------|-------|
| Typography | Monospace: `ui-monospace, 'Cascadia Code', Menlo, Consolas` |
| Border radius | `0` everywhere |
| Shadows | Hard offset: `2px 2px 0px` |
| Borders | `2px solid #000` for primary containers |
| Badges | Pastel backgrounds, 1px border, uppercase monospace |
| Animations | Rainbow text via `@keyframes` hue cycling |
| Theme | Light/dark toggle via CSS custom properties on `:root` |

---

## Critical Pitfalls

- **TDZ errors**: The inline JSON data is a single ~390KB line. `const`/`let` declarations must appear before any code that references them.
- **Duotone CSS variables**: `--fa-primary-color` and `--fa-secondary-color` MUST be set on the `<i>` element directly, not on a parent.
- **`/` key shortcut**: Some browsers insert `/` into input despite `preventDefault`. Guard with `input.value.replace(/^\/+/, "")`.
- **HuggingFace model loading**: May fail behind VPN/corporate proxy. Use the worker HF proxy (`/hf-proxy/`) to bypass CORS.
- **Source map 404s**: CDN-served minified JS references `.map` files that don't exist. Suppress via service worker.
- **iOS haptics**: Only work within user gesture context (click/tap handler). `requestAnimationFrame` chains from the initial gesture are allowed.
- **Confetti z-index**: Create a dedicated canvas at `z-index: 99999` to render above modal overlays.

---

## Adapting This Template

To build your own content explorer:

1. **Define your data model** -- what are your content items? What fields are searchable?
2. **Write `ingest.ts`** -- parse your source data into the SQLite schema above
3. **Write `embed.ts`** -- generate embeddings for your searchable text
4. **Export JSON** -- compact format with single-letter keys for the inline data array
5. **Copy `index.html`** -- replace the icon grid with your content cards, update CSS
6. **Copy `src/worker.ts`** -- adapt API endpoints for your data shape
7. **Deploy** -- `npx wrangler deploy`

The architecture scales to ~10,000 items before the inline JSON approach needs pagination. Beyond that, move to worker-side search only and lazy-load results.
