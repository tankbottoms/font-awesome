# Changelog

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
