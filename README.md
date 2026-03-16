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
- **JSON API:** keyword search, smart search, icon detail, browse -- with interactive docs
- **Color controls:** random per-icon colors, color picker, duotone primary/secondary, spectrum cycling
- **Resizable grid:** floating +/- toolbar for glyph and text size adjustment
- **Copy formats:** CSS class, Unicode, SVG, HTML snippet
- **Dark/light theme toggle** (Tokyo Night dark theme)
- **Zero dependencies at runtime** -- single HTML file with inline CSS/JS and icon data

## Demo

<div align="center">
  <video src="https://github.com/user-attachments/assets/e05f8a8d-7462-4413-9ca5-6d24c8745b6a" width="800" controls></video>
</div>

## API

Programmatic access at `https://fontawesome-explorer.atsignhandle.workers.dev/api/`:

| Endpoint | Description |
|----------|-------------|
| `GET /api/search?q=arrow&limit=5` | Keyword search (inverted index) |
| `GET /api/smart?q=weather&limit=5` | Smart search (expanded terms, categories, aliases) |
| `GET /api/icons?limit=50&offset=0` | Browse/paginate all icons |
| `GET /api/icon/house` | Single icon detail with all styles |
| `GET /api/docs` | Interactive API documentation |
| `GET /api/skill` | Claude Code skill (downloadable) |

**Claude Code skill installer:**

```bash
curl -sL https://fontawesome-explorer.atsignhandle.workers.dev/api/skill -o ~/.claude/skills/fontawesome.md
```

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Bun |
| Build scripts | TypeScript |
| Frontend | Vanilla HTML/CSS/JS (single file) |
| API | Cloudflare Worker (TypeScript) |
| Search (keyword) | Client-side + server-side inverted index |
| Search (semantic) | Transformers.js + all-MiniLM-L6-v2 ONNX |
| Embeddings | Pre-computed 384-dim Float32Array binary |
| Deployment | Cloudflare Workers (Worker + static assets) |
| Icons | Font Awesome Pro 6.5.1 + Free 7.2.0 |
| Design | Neo-brutalist (monospace, hard shadows, rectangular badges) |

## Quick Start

```bash
# Install dependencies
bun install

# Serve locally
python3 -m http.server 8765 --directory dist

# Deploy to Cloudflare Workers
cp -f index.html dist/index.html
npx wrangler deploy
```

## Project Structure

```
fontawesome/
+-- index.html              # Main app (ALL frontend code, ~480KB)
+-- src/
|   +-- worker.ts           # CF Worker: API routes, search, docs, skill
|   +-- data/
|   |   +-- icons.json      # All 3,860 icons (bundled into Worker)
|   |   +-- search-terms.json  # Extended search terms (354KB)
|   +-- build/
|       +-- ingest.ts       # Data pipeline: FA packages --> SQLite
|       +-- embed.ts        # Embedding pipeline: SQLite --> Float32Array
+-- dist/                   # Deploy target (CF Workers assets, gitignored)
|   +-- index.html          # Production copy
|   +-- data/               # Embeddings, search terms
|   +-- downloaded/         # Webfont files (woff2, css)
+-- data/                   # Build artifacts (gitignored)
+-- docs/                   # Architecture docs, prototype
+-- static/videos/          # Demo videos
+-- wrangler.toml           # CF Workers config
```

See [docs/architecture.md](docs/architecture.md) for detailed architecture reference.

## Search Architecture

1. **Keyword search** runs on every keystroke via client-side inverted index
   - Exact token match, prefix match, substring fallback
   - ~0.18ms average latency
2. **Semantic search** activates when keyword results < 10
   - Query embedded via all-MiniLM-L6-v2 ONNX (WASM)
   - Cosine similarity against 3,860 pre-computed icon embeddings
   - Score fusion: `0.7 * FTS + 0.3 * cosine`
3. Model cached in browser storage after first download (~22MB)

## Configuration

Font Awesome Pro license key is required for building from source. Store in `.env`:

```
FA_PRO_LICENSE_KEY=your-key-here
```

## License

MIT
