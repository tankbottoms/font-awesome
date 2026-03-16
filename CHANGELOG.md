# Changelog

## 2026-03-16 (v1.3.0)

### Added
- **Mobile-first responsive layout** with swipeable horizontal tab strip, clean search bar, uniform button sizing
- **Live search strategy indicator** showing FTS5/Embedding/Fusion steps with timing and hit counts
- **Toast notifications** for hybrid search result breakdowns (keyword + semantic counts)
- **Icon detail color cycling** with fast rainbow mode (30ms interval) and long-press toggle
- **Font prefetching** after search results render for instant detail popup
- **Self-hosted transformers.js** v3.4.1 (no CDN dependency) with source map
- **Self-hosted canvas-confetti** (no CDN dependency)
- **HuggingFace CORS proxy** error handling with 502 fallback responses
- **Service worker v3** with graceful cross-origin fetch fallback
- **Intro popup** (mobile only, dismissible via localStorage)
- **Content Explorer Template** skill documenting the architecture for reuse

### Changed
- Desktop tabs equally spaced across full search bar width
- Mobile tabs: single horizontal line with touch swipe scrolling
- Mobile search: borderless input with header-btn-matched controls below
- Mobile copy button: floating icon without border box
- Dark mode contrast improvements (Tokyo Night palette)
- Search placeholder updated with example queries
- Benchmark recommendations reformatted with structured layout
- Removed `table-layout: fixed` from meta-tables (fixes column overlap)
- Viewport `maximum-scale=1.0` prevents iOS input zoom

### Fixed
- `_origWarn` ReferenceError (block scoping bug in try/catch)
- Google Fonts 404 on API page (replaced with system monospace stack)
- Font Awesome CSS 404 on API page (uses self-hosted assets)
- `FetchEvent.respondWith` error on cross-origin fetches
- Console warnings suppressed (content-length, dtype during model load)
- Fathom analytics script removed (broken endpoint)

### Removed
- All external CDN dependencies at runtime (transformers.js, confetti, Google Fonts)
- Debug console.log statements from production code
- Dead `index.ts` placeholder file

## 2026-03-15 (v1.2.0)

### Added
- **JSON API** with 6 endpoints: /api/search, /api/smart, /api/icons, /api/icon/:name, /api/docs, /api/skill
- **Interactive API docs** at /api/docs with try-me panels, theme-aware (matches landing page dark/light)
- **Claude Code skill** downloadable from /api/skill with one-line installer
- **Smart search endpoint** using expanded terms corpus (categories, aliases, synonyms) for broader results
- API badge in header navigation bar
- Version field in all API JSON responses
- Architecture documentation in docs/architecture.md
- Theme persistence via localStorage (dark/light preference saved across pages)
- Compressed mp4 demo video (3MB vs 34MB mov)

### Changed
- Converted from static-only to Worker + static assets hybrid (ASSETS binding)
- Moved mockup.html to docs/prototype.html
- Updated README with API section, project structure, architecture doc link
- Cleaned up tracked files: removed css/, index.ts, .mov from git

### Removed
- PROMPT.md scrubbed from git history
- Dead index.ts placeholder
- Redundant css/ directory (derived from downloaded/)

## 2026-03-15 (v1.1.0)

### Added
- Enhanced model download progress: speed tracking, ETA countdown, distinct cached vs fresh messages
- Benchmark report popup: full 20-query FTS5 vs Embedding comparison accessible from About overlay
- Arrow key grid navigation: ArrowUp/Down/Left/Right to move selection, Enter to open detail
- Letter-jump navigation now sets arrow-key cursor position (integrated with arrow nav)
- Detail panel opens with random colors on every open (randomizeDetailColors on each openDetail)
- MIT LICENSE file (M.P.)
- Comprehensive .gitignore (excludes downloaded/, data/, webfonts/, dev artifacts, CLAUDE.md)

### Changed
- Model download status shows "Downloading embedding model to local storage: X MB / Y MB -- ~Ns remaining"
- Cached model shows "Semantic model loaded from cache -- 0.Xs"
- Fresh model shows "Semantic model cached locally -- loaded in Xs"
- .icon-card.selected uses outline instead of border-width to avoid layout shift

## 2026-03-15

### Added
- Pastel background colors on style filter tabs (All through Brands)
- Pastel colors on header navigation buttons (GitHub, Fork, Docs, Theme, About)
- Rainbow color cycling animation on bold text in intro narrative
- Rainbow animation on About/Docs popup titles, section headers, and bold text
- Cycle colors button: spectrum hue cycling for primary, saturation cycling for duo
- Floating bottom toolbar with +/- controls for glyph and text size
- 2x zoom toggle on detail popup hero glyph
- Browser caching for ONNX embedding model (Cache API)
- Byte-level progress display during model download
- FA flag glyph as favicon (SVG data URI)
- `.env` file for FA Pro license key storage
- `AGENTS.md`, `TODO.md`, `CHANGELOG.md` project documentation
- `static/screenshots/` directory for development screenshots

### Changed
- Smart search enabled by default on page load
- Style filter tabs sized to match header buttons
- Updated `CLAUDE.md` with project-specific architecture docs
- Updated `README.md` with full project documentation
- Updated `.gitignore` with `.playwright-cli/`, `.wrangler/`, `.claude/`

### Fixed
- TDZ error: moved `TAB_PASTELS` declaration before `buildTabs()` call
- Random colors lost on tab switch: re-apply after `renderGrid()`
- Duotone icons not getting random colors: set CSS custom properties on `<i>` element
- Duotone secondary color used random hue instead of lighter variant of primary
- `/` keyboard shortcut leaking character into search input
- Loading indicator not showing download bytes

## 2026-03-15 (earlier)

### Added
- Initial icon explorer with 3,860 icons from FA Pro 6.5.1 + Free 7.2.0
- Client-side inverted index for FTS5-like keyword search
- Semantic embedding search via all-MiniLM-L6-v2 ONNX (Transformers.js WASM)
- Pre-computed embeddings pipeline (3,860 x 384 dimensions, 5.65MB binary)
- Hybrid search with score fusion (0.7 FTS + 0.3 cosine)
- 10 style family tabs with icon counts
- Detail popup with style comparison, copy formats
- Random color assignment with duotone support
- Color picker and duo color controls
- Dark/light theme toggle
- Neo-brutalist design (monospace, hard shadows, rectangular badges)
- Cloudflare Workers deployment via wrangler
