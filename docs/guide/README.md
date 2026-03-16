# Content Explorer Builder Guide

How to take any indexable content -- PDFs, markdown, webpages, JSON, APIs -- and build a fast, beautiful, engaging search experience with FTS5 keyword search, WASM semantic embeddings, and a gamified UI.

This guide was extracted from the [Font Awesome Icon Explorer](https://fontawesome-explorer.atsignhandle.workers.dev/), a production app searching 3,860 icons with sub-millisecond keyword search and ~40ms semantic search, all running client-side.

---

## Chapters

### [01 - Data Pipeline](01-data-pipeline.md)

From raw content to searchable knowledge base. Covers ingesting PDFs, markdown, webpages, and APIs into SQLite FTS5, generating 384-dim semantic embeddings with ONNX, and exporting static assets for the frontend.

### [02 - Hybrid Search](02-hybrid-search.md)

Client-side search architecture combining a JavaScript inverted index (0.18ms) with WASM ONNX embedding search (35-55ms). Covers scoring, score fusion formula (0.7 FTS + 0.3 cosine), progressive search activation, and scaling considerations.

### [03 - Engagement](03-engagement.md)

Dopamine-driven UX with canvas-confetti, cross-platform haptic feedback (Android Vibration API + iOS checkbox switch trick), rainbow animations, and staggered entry effects. Includes preset patterns and wiring guides.

### [04 - Style Guide](04-style-guide.md)

Neo-brutalist design system: monospace typography, hard-offset shadows, rectangular badges, pastel category accents, Tokyo Night dark theme. Full CSS variable system ready to fork.

### [05 - BYO Content](05-byo-content.md)

Step-by-step guide to forking this architecture for your own content. Covers data model definition, ingest script adaptation, frontend card templates, Worker API customization, and deployment. Includes scaling tiers and a complete checklist.

---

## Quick Start

```bash
bun install
bun run ingest    # Parse content -> SQLite FTS5
bun run embed     # Generate semantic embeddings
bun run dev       # Serve locally (http://localhost:8765)
bun run deploy    # Deploy to Cloudflare Workers
```

## Architecture

```
  RAW CONTENT              BUILD TIME                 RUNTIME (CLIENT)
  ───────────              ──────────                 ────────────────
  PDFs, MD,           ┌─ ingest.ts ─┐           Inverted index (0.18ms)
  webpages,      ───> │ SQLite FTS5 │ ───>      ONNX WASM embedding (40ms)
  JSON, APIs          └─────────────┘           Hybrid fusion
                      ┌─ embed.ts ──┐           Haptic feedback
                      │ 384-dim ONNX│ ───>      Confetti celebrations
                      └─────────────┘           Neo-brutalist UI
```
