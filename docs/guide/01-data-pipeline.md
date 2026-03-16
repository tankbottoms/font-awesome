# Data Pipeline: From Raw Content to Searchable Knowledge Base

How to take any indexable content -- PDFs, markdown, webpages, JSON feeds, APIs -- and build a knowledge base with FTS5 full-text search and semantic embeddings, all as a build step that produces static assets ready for instant client-side search.

---

## Overview

```
  RAW CONTENT                BUILD STEP                    STATIC OUTPUT
  ───────────                ──────────                    ─────────────
  PDFs                  ┌─ ingest.ts ──────┐          items.json (compact)
  Markdown         ────>│  Parse + normalize│────>     search-terms.json
  Webpages              │  SQLite + FTS5    │          embeddings.bin
  JSON/CSV              └──────────────────┘          embedding-names.json
  APIs                         │
                        ┌──────▼───────────┐
                        │  embed.ts         │
                        │  ONNX model       │
                        │  384-dim vectors  │
                        └──────────────────┘
```

The pipeline has two stages:

1. **Ingest** -- Parse source content into a normalized SQLite database with FTS5 full-text search
2. **Embed** -- Generate semantic vector embeddings for each item using an ONNX model

Both stages run locally with Bun. No external services, no API keys (except for the content sources themselves). The output is a set of static files that ship with your frontend.

---

## Stage 1: Ingest (`bun run ingest`)

### What It Does

Reads raw content from any source, normalizes it into a flat schema, and creates a SQLite database with FTS5 full-text indexing.

### Content Sources

The ingest script is where you adapt the pipeline to your content. Here are patterns for common source types:

#### PDFs

```typescript
import { readFileSync } from "fs";

// Option 1: Use a PDF text extraction library
import { PdfReader } from "pdfreader";

async function extractPDF(path: string): Promise<{ title: string; text: string }> {
  const buffer = readFileSync(path);
  const reader = new PdfReader();
  const pages: string[] = [];

  return new Promise((resolve) => {
    let currentPage = "";
    reader.parseBuffer(buffer, (err, item) => {
      if (!item) {
        pages.push(currentPage);
        resolve({ title: path.split("/").pop()!, text: pages.join("\n\n") });
        return;
      }
      if (item.page) { pages.push(currentPage); currentPage = ""; }
      if (item.text) currentPage += item.text + " ";
    });
  });
}

// Option 2: Use an external tool (poppler's pdftotext)
import { execSync } from "child_process";

function extractPDFCli(path: string): string {
  return execSync(`pdftotext "${path}" -`, { encoding: "utf8" });
}
```

#### Markdown Files

```typescript
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

interface MarkdownItem {
  name: string;
  title: string;
  body: string;
  headings: string[];
  tags: string[];
}

function parseMarkdownDir(dir: string): MarkdownItem[] {
  const files = readdirSync(dir).filter(f => f.endsWith(".md"));
  return files.map(file => {
    const raw = readFileSync(join(dir, file), "utf8");

    // Extract YAML frontmatter if present
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    const frontmatter = fmMatch ? parseYaml(fmMatch[1]) : {};
    const body = fmMatch ? fmMatch[2] : raw;

    // Extract headings for search enrichment
    const headings = [...body.matchAll(/^#+\s+(.+)$/gm)].map(m => m[1]);

    return {
      name: file.replace(".md", ""),
      title: frontmatter.title || headings[0] || file,
      body: body.replace(/[#*_`\[\]()]/g, " ").trim(),
      headings,
      tags: frontmatter.tags || [],
    };
  });
}
```

#### Webpages

```typescript
// Fetch and extract text from web pages
async function fetchPage(url: string): Promise<{ title: string; text: string }> {
  const html = await fetch(url).then(r => r.text());

  // Simple extraction (for production, use cheerio or mozilla/readability)
  const titleMatch = html.match(/<title>(.*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1] : url;

  // Strip HTML tags, decode entities
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return { title, text };
}

// For structured content, use sitemaps or RSS feeds
async function fetchSitemap(sitemapUrl: string): Promise<string[]> {
  const xml = await fetch(sitemapUrl).then(r => r.text());
  return [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(m => m[1]);
}
```

#### JSON / CSV / API Responses

```typescript
// JSON array
const items = JSON.parse(readFileSync("data/products.json", "utf8"));

// CSV (using Bun's built-in or a library)
import { parse } from "csv-parse/sync";
const csv = readFileSync("data/catalog.csv", "utf8");
const rows = parse(csv, { columns: true, skip_empty_lines: true });

// API with pagination
async function fetchAll(baseUrl: string): Promise<any[]> {
  const items: any[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const resp = await fetch(`${baseUrl}?limit=${limit}&offset=${offset}`);
    const data = await resp.json();
    items.push(...data.results);
    if (data.results.length < limit) break;
    offset += limit;
  }
  return items;
}
```

### SQLite Schema

The core schema has three parts: items, FTS5 virtual table, and sync triggers.

```sql
-- Core content table
CREATE TABLE items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,       -- URL-safe identifier
  label TEXT NOT NULL,             -- Human-readable title
  body TEXT,                       -- Full text content
  search_terms TEXT,               -- JSON array of extra search terms
  aliases TEXT,                    -- JSON array of alternative names
  categories TEXT,                 -- JSON array of category labels
  source TEXT,                     -- Where this came from
  metadata TEXT                    -- JSON blob for anything else
);

-- FTS5 full-text search index
-- "content=" syncs with the items table automatically via triggers
CREATE VIRTUAL TABLE items_fts USING fts5(
  name, label, body, search_terms, aliases, categories,
  content=items, content_rowid=id
);

-- Auto-sync triggers: keep FTS5 in sync with items table
CREATE TRIGGER items_ai AFTER INSERT ON items BEGIN
  INSERT INTO items_fts(rowid, name, label, body, search_terms, aliases, categories)
  VALUES (new.id, new.name, new.label, new.body, new.search_terms, new.aliases, new.categories);
END;

CREATE TRIGGER items_ad AFTER DELETE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, name, label, body, search_terms, aliases, categories)
  VALUES ('delete', old.id, old.name, old.label, old.body, old.search_terms, old.aliases, old.categories);
END;

CREATE TRIGGER items_au AFTER UPDATE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, name, label, body, search_terms, aliases, categories)
  VALUES ('delete', old.id, old.name, old.label, old.body, old.search_terms, old.aliases, old.categories);
  INSERT INTO items_fts(rowid, name, label, body, search_terms, aliases, categories)
  VALUES (new.id, new.name, new.label, new.body, new.search_terms, new.aliases, new.categories);
END;

-- Embedding storage
CREATE TABLE item_embeddings (
  item_id INTEGER PRIMARY KEY REFERENCES items(id),
  embedding BLOB NOT NULL          -- Float32Array, 384 dimensions = 1,536 bytes
);
```

### Bulk Insert Pattern

Always wrap inserts in a transaction. Without this, SQLite commits after every row -- 100x slower.

```typescript
import { Database } from "bun:sqlite";

const db = new Database("data/content.db");
db.exec("PRAGMA journal_mode = WAL");    // Write-ahead logging (concurrent reads)
db.exec("PRAGMA synchronous = NORMAL");  // Faster writes, still crash-safe

const insertItem = db.prepare(`
  INSERT INTO items (name, label, body, search_terms, aliases, categories, source)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

// Transaction: all-or-nothing, 100x faster than individual inserts
db.exec("BEGIN");

for (const item of parsedItems) {
  insertItem.run(
    item.name,
    item.label,
    item.body,
    item.searchTerms?.length ? JSON.stringify(item.searchTerms) : null,
    item.aliases?.length ? JSON.stringify(item.aliases) : null,
    item.categories?.length ? JSON.stringify(item.categories) : null,
    item.source
  );
}

db.exec("COMMIT");
```

### Verification

After ingestion, verify the FTS5 index works:

```typescript
const ftsTest = db.prepare(`
  SELECT name, label, rank FROM items_fts
  WHERE items_fts MATCH ? ORDER BY rank LIMIT 5
`);

for (const q of ["your", "test", "queries"]) {
  const results = ftsTest.all(q);
  console.log(`"${q}": ${results.map(r => r.name).join(", ")}`);
}
```

### Export for Frontend

After ingestion, export a compact JSON array for embedding in the frontend. Use single-letter keys to minimize size.

```typescript
const items = db.prepare("SELECT * FROM items ORDER BY id").all();

const compact = items.map(row => ({
  n: row.name,                           // name (identifier)
  L: row.label,                          // label (display)
  C: row.categories ? JSON.parse(row.categories)[0] : null,  // primary category
  // Add your content-specific fields here
}));

Bun.write("src/data/items.json", JSON.stringify(compact));

// Also export search terms as a separate file (keeps main data lean)
const searchTerms: Record<string, string[]> = {};
for (const row of items) {
  const terms: string[] = [];
  if (row.search_terms) terms.push(...JSON.parse(row.search_terms));
  if (row.aliases) terms.push(...JSON.parse(row.aliases));
  if (row.categories) terms.push(...JSON.parse(row.categories));
  if (terms.length) searchTerms[row.name] = terms;
}
Bun.write("src/data/search-terms.json", JSON.stringify(searchTerms));
```

---

## Stage 2: Embed (`bun run embed`)

### What It Does

Generates 384-dimensional normalized vector embeddings for each item using the all-MiniLM-L6-v2 ONNX model. These enable semantic search -- finding items by meaning, not just keyword match.

### Document Construction

The quality of embeddings depends on what text you feed the model. Concatenate all searchable fields into a single "search document":

```typescript
function buildSearchDoc(item: Item): string {
  const parts = [
    item.label,                          // Human-readable title
    item.name.replace(/-/g, " "),        // Tokenized identifier
  ];

  // Add search terms, aliases, categories
  if (item.search_terms) {
    try { parts.push(...JSON.parse(item.search_terms)); } catch {}
  }
  if (item.aliases) {
    try { parts.push(...JSON.parse(item.aliases).map(a => a.replace(/-/g, " "))); } catch {}
  }
  if (item.categories) {
    try { parts.push(...JSON.parse(item.categories)); } catch {}
  }

  // For longer content (articles, docs), use the first ~500 words
  if (item.body) {
    parts.push(item.body.split(/\s+/).slice(0, 500).join(" "));
  }

  return parts.join(" ");
}
```

### Batch Embedding Generation

Process items in batches for efficiency. The model handles batch input natively.

```typescript
import { env, pipeline } from "@xenova/transformers";

// Load model from local files (no network needed at build time)
env.localModelPath = "./models/";
env.allowRemoteModels = false;

const embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
  local_files_only: true,
  quantized: false,         // Full precision for build-time quality
});

const BATCH_SIZE = 64;      // Larger batches = faster, more memory
const items = db.prepare("SELECT * FROM items ORDER BY id").all();

db.run("DELETE FROM item_embeddings");
const insertEmbed = db.prepare(
  "INSERT INTO item_embeddings (item_id, embedding) VALUES (?, ?)"
);

db.run("BEGIN");

for (let i = 0; i < items.length; i += BATCH_SIZE) {
  const batch = items.slice(i, i + BATCH_SIZE);
  const docs = batch.map(buildSearchDoc);

  const output = await embedder(docs, {
    pooling: "mean",       // Average all token embeddings
    normalize: true,       // Unit vectors for cosine similarity via dot product
  });

  for (let j = 0; j < batch.length; j++) {
    const f32 = new Float32Array(output[j].data);
    const buffer = Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
    insertEmbed.run(batch[j].id, buffer);
  }
}

db.run("COMMIT");
```

### Binary Export for Frontend

Export embeddings as a flat binary file. This is the most compact format and loads directly into a Float32Array in the browser.

```typescript
const count = db.prepare("SELECT COUNT(*) as c FROM item_embeddings").get().c;
const DIMS = 384;

// Sequential Float32Array: item 0 dims [0..383], item 1 dims [0..383], ...
const allEmbeddings = new Float32Array(count * DIMS);
let offset = 0;

const rows = db.prepare(
  "SELECT e.embedding, i.name FROM item_embeddings e JOIN items i ON e.item_id = i.id ORDER BY i.id"
).all();

const names: string[] = [];

for (const row of rows) {
  const f32 = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
  allEmbeddings.set(f32, offset);
  offset += DIMS;
  names.push(row.name);
}

// Write binary embeddings (this is what the browser loads)
Bun.write("dist/data/embeddings.bin", allEmbeddings.buffer);

// Write name index (maps array position to item name)
Bun.write("dist/data/embedding-names.json", JSON.stringify(names));

console.log(`Exported ${count} embeddings (${(count * DIMS * 4 / 1024 / 1024).toFixed(1)}MB)`);
```

### Model Setup

Download the ONNX model files once. They live in your repo (gitignored) or a shared model cache.

```bash
# Download all-MiniLM-L6-v2 ONNX model files
mkdir -p models/Xenova/all-MiniLM-L6-v2

# The model files (~90MB total, includes tokenizer + ONNX weights)
# Option 1: From HuggingFace directly
git clone https://huggingface.co/Xenova/all-MiniLM-L6-v2 models/Xenova/all-MiniLM-L6-v2

# Option 2: If you have chromadb installed, symlink from its cache
ln -s ~/.cache/chroma/onnx_models/all-MiniLM-L6-v2 models/Xenova/all-MiniLM-L6-v2
```

### Sizing Guide

| Item Count | Embedding File Size | Build Time (M1 Mac) |
|-----------|--------------------|--------------------|
| 1,000 | 1.5 MB | ~2s |
| 5,000 | 7.3 MB | ~8s |
| 10,000 | 14.6 MB | ~15s |
| 50,000 | 73 MB | ~75s |

Beyond ~10,000 items, consider quantizing embeddings to Float16 (halves file size, minimal quality loss) or using server-side search instead of shipping all embeddings to the client.

---

## Complete Build Flow

```bash
# 1. Install dependencies
bun install

# 2. Ingest raw content into SQLite + FTS5
bun run ingest

# 3. Generate embeddings
bun run embed

# 4. Serve locally
bun run dev

# 5. Deploy
bun run deploy
```

### package.json Scripts

```json
{
  "scripts": {
    "dev": "bunx http-server dist -p 8765 -c-1 --cors",
    "ingest": "bun run src/build/ingest.ts",
    "embed": "bun run src/build/embed.ts",
    "benchmark": "bun run src/build/benchmark.ts",
    "deploy": "cp -f index.html dist/index.html && npx wrangler deploy"
  }
}
```

---

## What the Pipeline Produces

| File | Size (3,860 items) | Purpose |
|------|--------------------|---------|
| `data/content.db` | ~30 MB | SQLite with FTS5 (build artifact, not deployed) |
| `src/data/items.json` | ~394 KB | Compact JSON for Worker + frontend inline |
| `src/data/search-terms.json` | ~354 KB | Extended search terms map |
| `dist/data/embeddings.bin` | 5.65 MB | Float32Array binary blob |
| `dist/data/embedding-names.json` | ~54 KB | Name-to-index mapping |

The SQLite database stays on your machine. Only the static exports ship to the browser.
