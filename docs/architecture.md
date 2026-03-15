# Font Awesome Icon Explorer -- Architecture Reference

## Purpose

A single-page web application for browsing, searching, and copying 3,860 Font Awesome icons across 10 style families. Designed as a zero-dependency, self-contained tool for developers who need quick access to icon names, CSS classes, unicode codes, and HTML snippets.

**Live deployment:** https://fontawesome-explorer.atsignhandle.workers.dev/

---

## Application Architecture

### Single HTML File

The entire frontend is a single `index.html` (~480KB) containing:

- Inline CSS (neo-brutalist design system)
- Inline JavaScript (search engine, grid renderer, UI logic)
- Embedded icon data array (3,860 icons as JSON, ~390KB)
- No external JS/CSS framework dependencies at runtime

This design eliminates build steps, module bundlers, and framework overhead. The only external resources are the Font Awesome webfont CSS (loaded from CDN for icon rendering) and the ONNX model (loaded on-demand for semantic search).

### Worker + Static Assets Hybrid

Deployed to Cloudflare Workers using the hybrid pattern:

```
Request --> CF Worker (src/worker.ts)
              |
              +-- /api/*  --> JSON API responses (search, browse, docs)
              |
              +-- /*      --> env.ASSETS.fetch() --> Static files from dist/
```

The Worker intercepts API routes and passes everything else through to the static asset binding. This means the main site loads with zero Worker compute cost -- only API calls invoke the Worker.

---

## Search Architecture

The explorer implements a two-tier search system: fast keyword search for exact/prefix matches, and semantic search for conceptual queries.

### Tier 1: Inverted Index (FTS5-like Keyword Search)

**Client-side** (in `index.html`) and **server-side** (in `src/worker.ts`):

```
Icon data + search terms --> Tokenize --> Inverted index (Map<token, Set<iconName>>)
```

**Index construction:**

1. For each of 3,860 icons, concatenate: icon name, label, and expanded search terms
2. Tokenize on whitespace/punctuation, filter tokens < 2 chars
3. Build inverted index mapping each token to the set of icon names containing it

**Query scoring:**

| Match type | Score |
|-----------|-------|
| Exact token match | +3 |
| Prefix match (token starts with query) | +1 |
| Substring match on icon name | +2 |
| Icon name starts with query | +5 |
| Unicode hex match | +10 |

**Performance:** ~0.18ms average on client, sub-millisecond on Worker.

### Tier 2: Semantic Embedding Search (Client-side ONNX)

**Client-side only** (not available in the API -- see "Smart Search" for the API alternative):

```
Query text --> all-MiniLM-L6-v2 ONNX model (WASM) --> 384-dim embedding
           --> Cosine similarity against 3,860 pre-computed icon embeddings
           --> Score fusion: 0.7 * FTS + 0.3 * cosine
```

**Components:**

| Component | Size | Source |
|-----------|------|--------|
| Transformers.js runtime | ~2MB | cdn.jsdelivr.net |
| all-MiniLM-L6-v2 ONNX model | ~22MB | huggingface.co |
| Pre-computed embeddings | 5.65MB | `dist/data/embeddings.bin` |
| Embedding name index | 54KB | `dist/data/embedding-names.json` |

**Embedding pipeline (build-time):**

1. `src/build/ingest.ts` -- Parses FA Pro + Free metadata into SQLite, merges duplicates
2. `src/build/embed.ts` -- Generates 384-dimensional embeddings for each icon using concatenated name + label + search terms as input text

**Browser model caching:**

The ONNX model is cached in the browser's Cache API after first download. Subsequent loads read from cache (~0.3s) instead of re-downloading (~35-55s on slow connections). Progress tracking shows download speed, ETA, and byte-level progress.

**Hybrid fusion:**

When keyword results return < 10 matches, semantic search activates and results are merged using weighted score fusion: `final_score = 0.7 * fts_score + 0.3 * cosine_similarity`.

### Tier 2 Alternative: Smart Search (API)

The `/api/smart` endpoint provides "semantic-like" search without ML models by leveraging the expanded search terms corpus (354KB of categories, aliases, synonyms from the Font Awesome metadata):

- Category match boost (+4 for matching category names)
- Alias exact match (+3)
- Multi-word phrase containment (+2)
- Substring match on longer terms (+1)

This produces conceptually broader results than keyword search (e.g., "spinning loader" finds spinner, circle-notch) while running in sub-millisecond time on the Worker.

---

## Search Terms Corpus

The `search-terms.json` file (354KB, 3,477 entries) maps icon names to arrays of:

- **Aliases:** Alternative names ("home" for "house", "search" for "magnifying-glass")
- **Categories:** Groupings ("Buildings", "Medical + Health", "Users + People")
- **Synonyms:** Related concepts ("rotate" for "spinner", "navigate" for "compass")
- **Unicode descriptions:** Official Unicode character names

This corpus was extracted from Font Awesome's official metadata and provides the foundation for both client-side search term boosting and server-side smart search.

---

## Data Pipeline

```
FA Pro 6.5.1 + Free 7.2.0 packages
    |
    v
src/build/ingest.ts --> data/icons.db (SQLite with FTS5)
    |                    + icons-data.json
    |                    + data/search-terms.json
    v
src/build/embed.ts  --> data/embeddings.bin (Float32Array, 3860 x 384)
    |                    + data/embedding-names.json
    v
Manual: embed data array into index.html line ~1389
Copy: index.html --> dist/index.html
Copy: search-terms.json --> dist/data/search-terms.js (JS wrapper)
Copy: embeddings.bin --> dist/data/embeddings.bin
Copy: embedding-names.json --> dist/data/embedding-names.json
```

### Build requirements

- **Bun runtime** for TypeScript execution
- **Font Awesome Pro license** (key in `.env`) for downloading Pro 6.5.1 package
- **SQLite** (via Bun's built-in bun:sqlite) for intermediate data processing

---

## Deployment Model

### For this project

```bash
# Edit index.html (all frontend code lives here)
# Copy to deploy target
cp -f index.html dist/index.html

# Deploy Worker + static assets
npx wrangler deploy
```

The `dist/` directory contains:

| Path | Purpose |
|------|---------|
| `dist/index.html` | Main application |
| `dist/data/embeddings.bin` | Pre-computed embedding vectors |
| `dist/data/embedding-names.json` | Icon name order for embedding lookup |
| `dist/data/search-terms.js` | Extended search terms (JS module) |
| `dist/downloaded/` | Webfont files (woff2, css) for FA rendering |

### Replicating for other icon sets or datasets

The architecture generalizes to any searchable catalog:

1. **Data array:** Replace `allIcons` with your dataset. Each entry needs a unique name and searchable text fields.

2. **Search terms:** Build an expanded terms map (`name -> [aliases, categories, synonyms]`). The richer this corpus, the better keyword search performs.

3. **Embeddings (optional):** If you want semantic search:
   - Use any sentence-transformer model (all-MiniLM-L6-v2 is a good balance of size/quality)
   - Pre-compute embeddings for all items at build time
   - Store as a flat Float32Array binary blob
   - Load Transformers.js + ONNX model in the browser for query embedding
   - Compute cosine similarity against pre-computed vectors

4. **Single-file pattern:** Embed the data array directly in the HTML. For datasets > 1MB, consider lazy-loading the data from a separate JSON file.

5. **Worker hybrid:** Use Cloudflare Workers with `[assets]` binding for zero-cost static serving + API routes. The Worker only executes on API calls; static pages are served directly from the CDN.

6. **Browser caching:** Use the Cache API for large model files. Show download progress with speed/ETA for better UX on slow connections.

---

## API Reference

Base URL: `https://fontawesome-explorer.atsignhandle.workers.dev`

| Endpoint | Description |
|----------|-------------|
| `GET /api/search?q=&limit=&style=` | Keyword search (inverted index) |
| `GET /api/smart?q=&limit=&style=` | Smart search (expanded terms) |
| `GET /api/icons?limit=&offset=&style=` | Browse/paginate all icons |
| `GET /api/icon/:name` | Single icon detail |
| `GET /api/docs` | Interactive API documentation |
| `GET /api/skill` | Claude Code skill (downloadable markdown) |

All responses are JSON with CORS enabled. See `/api/docs` for interactive examples.

---

## Design System

Neo-brutalist aesthetic:

- **Typography:** JetBrains Mono (monospace)
- **Borders:** 2px solid, `border-radius: 0` everywhere
- **Shadows:** Hard-offset (`2px 2px 0px` or `3px 3px 0px`)
- **Colors:** Pastel backgrounds with dark text, category-specific pastels for badges
- **Animations:** Rainbow CSS cycling on headings
- **Icons:** Font Awesome thin (`fa-thin`) for UI elements

---

## Directory Structure

```
fontawesome/
+-- index.html              # Main app (ALL frontend code, ~480KB)
+-- src/
|   +-- worker.ts           # CF Worker: API routes, search, docs, skill
|   +-- data/
|   |   +-- icons.json      # All 3,860 icons (extracted from index.html)
|   |   +-- search-terms.json  # Expanded terms corpus (354KB)
|   +-- build/
|       +-- ingest.ts       # Data pipeline: FA packages --> SQLite
|       +-- embed.ts        # Embedding pipeline: SQLite --> Float32Array
+-- dist/                   # Deploy target (Cloudflare Workers assets)
|   +-- index.html          # Production copy of main app
|   +-- data/               # Runtime data files (embeddings, search terms)
|   +-- downloaded/         # Webfont files (woff2, css)
+-- data/                   # Build artifacts (not deployed)
|   +-- icons.db            # SQLite database (intermediate)
|   +-- embeddings.bin      # Pre-computed embeddings (copied to dist/)
|   +-- embedding-names.json
|   +-- search-terms.json
|   +-- benchmark-report.md # FTS5 vs embedding comparison
+-- static/                 # Development assets (not deployed)
|   +-- screenshots/        # Development screenshots
|   +-- videos/             # Demo videos
+-- docs/                   # Documentation
|   +-- architecture.md     # This file
|   +-- prototype.html      # Original design mockup
+-- downloaded/             # Source FA packages (proprietary, gitignored)
+-- wrangler.toml           # CF Workers config
+-- package.json            # Dependencies (build-time only)
+-- tsconfig.json           # TypeScript config
```

### What goes where

| Directory | Content | Deployed? | Git tracked? |
|-----------|---------|-----------|--------------|
| `dist/` | Production-ready files | Yes (CF Workers assets) | No (gitignored) |
| `data/` | Build artifacts, intermediate files | No | No (gitignored) |
| `src/data/` | Worker data (icons.json, search-terms.json) | Yes (bundled into Worker) | Yes |
| `src/build/` | Build-time scripts | No | Yes |
| `static/` | Development screenshots, videos | No | Partially (videos yes, screenshots no) |
| `docs/` | Architecture docs, prototype | No | Yes |
| `downloaded/` | FA Pro/Free packages | No | No (gitignored, proprietary) |
