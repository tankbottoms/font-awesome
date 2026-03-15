# Font Awesome Icon Explorer

A neo-brutalist web application for browsing **3,860 icons** from Font Awesome Pro 6.5.1 and Free 7.2.0. Features hybrid search combining FTS5 keyword matching with semantic vector embeddings (all-MiniLM-L6-v2 ONNX), organized by 10 style families across 3 icon families (classic, sharp, duotone).

**Live:** [fontawesome-explorer.atsignhandle.workers.dev](https://fontawesome-explorer.atsignhandle.workers.dev/)

## Features

- **3,860 unique icons** merged from Pro 6.5.1 (3,762) and Free 7.2.0 (1,970)
- **10 style variants:** solid, regular, light, thin, duotone, sharp solid, sharp regular, sharp light, sharp thin, brands
- **Hybrid search:** FTS5 keyword/prefix matching (~0.18ms) with semantic embedding fallback (~35-55ms)
- **Pre-computed embeddings:** 3,860 x 384-dim Float32Array (5.65MB binary blob)
- **Client-side ONNX inference:** all-MiniLM-L6-v2 quantized model via Transformers.js WASM
- **Browser model caching:** ONNX model cached in browser storage after first load
- **Color controls:** random per-icon colors, color picker, duotone primary/secondary, spectrum cycling
- **Resizable grid:** floating +/- toolbar for glyph and text size adjustment
- **Copy formats:** CSS class, Unicode, SVG, HTML snippet
- **Dark/light theme toggle**
- **Zero dependencies at runtime** -- single HTML file with inline CSS/JS and icon data

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Bun |
| Build scripts | TypeScript |
| Frontend | Vanilla HTML/CSS/JS (single file) |
| Search (keyword) | Client-side inverted index (FTS5-like) |
| Search (semantic) | Transformers.js + all-MiniLM-L6-v2 ONNX |
| Embeddings | Pre-computed 384-dim Float32Array binary |
| Deployment | Cloudflare Workers (static assets) |
| Icons | Font Awesome Pro 6.5.1 + Free 7.2.0 |
| Design | Neo-brutalist (monospace, hard shadows, rectangular badges) |

## Quick Start

```bash
# Install dependencies
bun install

# Serve locally
python3 -m http.server 8765 --directory dist

# Deploy to Cloudflare Workers
npx wrangler deploy
```

## Project Structure

```
fontawesome/
+-- index.html              # Main app (self-contained, ~430KB)
+-- dist/                   # Deploy directory (Cloudflare Workers assets)
|   +-- index.html          # Production copy
|   +-- data/               # Search terms, embeddings
|   +-- downloaded/         # Webfont files (woff2, css)
+-- data/
|   +-- embeddings.bin      # Pre-computed icon embeddings (5.65MB)
|   +-- embedding-names.json # Icon name order for embedding lookup
|   +-- search-terms.js     # Extended search terms (aliases, categories)
|   +-- icons.db            # SQLite build artifact
+-- downloaded/             # Source Font Awesome packages
|   +-- fontawesome-pro-6.5.1-web/
|   +-- fontawesome-free-7.2.0-web/
|   +-- fontawesome-free-6.7.2-web/
+-- src/build/              # Build-time TypeScript scripts
|   +-- ingest.ts           # Parse metadata into SQLite
|   +-- embed.ts            # Generate embeddings binary
+-- static/screenshots/     # Development screenshots
+-- mockup.html             # Design mockup reference
+-- wrangler.toml           # Cloudflare Workers config
+-- PROMPT.md               # Original implementation plan
```

## Search Architecture

1. **Keyword search** runs on every keystroke via client-side inverted index
   - Exact token match, prefix match, substring fallback
   - ~0.18ms average latency
2. **Semantic search** activates when keyword results < 10
   - Query embedded via all-MiniLM-L6-v2 ONNX (WASM)
   - Cosine similarity against 3,860 pre-computed icon embeddings
   - Score fusion: `0.7 * FTS + 0.3 * cosine`
3. Model cached in browser storage after first download (~22MB)

## Deployment

Deployed to Cloudflare Workers with static assets:

```bash
# Copy latest build to dist
cp -f index.html dist/index.html

# Deploy
npx wrangler deploy
```

## Configuration

Font Awesome Pro license key is required for building from source. Store in `.env`:

```
FA_PRO_LICENSE_KEY=your-key-here
```

## License

MIT
