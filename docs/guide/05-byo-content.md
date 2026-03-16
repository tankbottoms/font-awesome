# BYO Content: Building Your Own Explorer

How to take this architecture and apply it to any searchable content -- product catalogs, documentation sites, recipe databases, component libraries, research papers, legal filings, or anything else you can index.

---

## What You Get

Fork this repo and you inherit:

| Feature | Cost to Adapt |
|---------|--------------|
| Sub-millisecond keyword search | Replace data source only |
| Semantic embedding search (WASM) | Replace data source + rebuild embeddings |
| Hybrid score fusion | Zero (works with any content) |
| Haptic feedback on mobile | Zero (content-agnostic) |
| Confetti on copy/share | Zero (wire to your completion events) |
| Neo-brutalist design system | Swap colors and fonts |
| Cloudflare Workers deployment | Update wrangler.toml |
| JSON API for agents/integrations | Adapt endpoint response shapes |
| Service worker caching | Update precache URLs |

---

## Step-by-Step: From Icons to Your Content

### 1. Define Your Data Model

What are your items? What fields are searchable?

```typescript
// Example: Recipe database
interface Recipe {
  name: string;        // URL-safe slug: "chicken-tikka-masala"
  title: string;       // Display: "Chicken Tikka Masala"
  cuisine: string;     // Category: "Indian"
  ingredients: string[];
  tags: string[];      // "spicy", "weeknight", "one-pot"
  prepTime: number;    // minutes
  description: string; // Full text for embedding
}
```

```typescript
// Example: Documentation site
interface DocPage {
  name: string;        // URL path: "api/authentication"
  title: string;       // "Authentication Guide"
  section: string;     // "API Reference"
  body: string;        // Full markdown content
  headings: string[];  // All h2/h3 headings
  tags: string[];      // "auth", "oauth", "jwt"
}
```

```typescript
// Example: Product catalog
interface Product {
  name: string;        // SKU or slug
  title: string;       // Product name
  category: string;    // "Electronics > Headphones"
  brand: string;
  description: string;
  specs: Record<string, string>;
  price: number;
}
```

### 2. Write Your Ingest Script

Copy `src/build/ingest.ts` and replace the Font Awesome parsing with your content source.

```typescript
// src/build/ingest.ts (adapted for recipes)
import { Database } from "bun:sqlite";
import { readFileSync } from "fs";

const DB_PATH = "data/content.db";
const db = new Database(DB_PATH);

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA synchronous = NORMAL");

// Create tables (same schema pattern, different fields)
db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    category TEXT,
    search_terms TEXT,
    metadata TEXT
  )
`);

db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
    name, label, category, search_terms,
    content=items, content_rowid=id
  )
`);

// ... triggers (same pattern as 01-data-pipeline.md) ...

// Parse your source data
const recipes: Recipe[] = JSON.parse(readFileSync("data/recipes.json", "utf8"));

const insert = db.prepare(`
  INSERT INTO items (name, label, category, search_terms, metadata)
  VALUES (?, ?, ?, ?, ?)
`);

db.exec("BEGIN");
for (const recipe of recipes) {
  insert.run(
    recipe.name,
    recipe.title,
    recipe.cuisine,
    JSON.stringify([...recipe.ingredients, ...recipe.tags]),
    JSON.stringify({ prepTime: recipe.prepTime }),
  );
}
db.exec("COMMIT");
```

### 3. Build Embeddings

`src/build/embed.ts` works with any content. The only change is the `buildSearchDoc` function -- what text you feed the embedding model.

```typescript
function buildSearchDoc(item: Item): string {
  const parts = [item.label];

  // Add all searchable text
  if (item.category) parts.push(item.category);
  if (item.search_terms) {
    try { parts.push(...JSON.parse(item.search_terms)); } catch {}
  }

  // For long content, use the first 500 words
  // (embedding models handle ~256 tokens well, ~512 max)
  if (item.body) {
    parts.push(item.body.split(/\s+/).slice(0, 500).join(" "));
  }

  return parts.join(" ");
}
```

### 4. Export Compact JSON

Map your data model to single-letter keys for the frontend inline data.

```typescript
// Export for the frontend
const items = db.prepare("SELECT * FROM items ORDER BY id").all();

const compact = items.map(row => ({
  n: row.name,
  L: row.label,
  C: row.category,
  // Add your display fields
  M: row.metadata ? JSON.parse(row.metadata) : null,
}));

Bun.write("src/data/items.json", JSON.stringify(compact));
```

### 5. Adapt the Frontend

In `index.html`, replace the icon-specific rendering with your content cards.

**The grid rendering function:**

```javascript
function renderCard(item) {
  const card = document.createElement("div");
  card.className = "card";

  // YOUR CONTENT HERE
  // For icons: renders the glyph + name + style badges
  // For recipes: render title + cuisine + prep time + ingredient count
  // For docs: render title + section + first paragraph
  // For products: render image + name + price + category

  card.innerHTML = `
    <div class="card-title">${item.L}</div>
    <div class="card-category badge">${item.C || ""}</div>
    <!-- Your content-specific fields -->
  `;

  card.addEventListener("click", () => showDetail(item));
  return card;
}
```

**The detail overlay:**

```javascript
function showDetail(item) {
  const overlay = document.querySelector(".overlay");
  const content = overlay.querySelector(".overlay-content");

  content.innerHTML = `
    <h2>${item.L}</h2>
    <div class="detail-meta">
      <span class="badge">${item.C}</span>
    </div>
    <div class="detail-body">
      <!-- Your content-specific detail view -->
    </div>
    <div class="detail-actions">
      <button class="btn" onclick="copyItem('${item.n}')">Copy</button>
    </div>
  `;

  overlay.classList.add("open");
  haptic("medium");
}
```

### 6. Adapt the Worker API

In `src/worker.ts`, update the response shape for your content type.

```typescript
function handleSearch(url: URL): Response {
  const query = url.searchParams.get("q") || "";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 200);

  const results = search(query).slice(0, limit).map(name => {
    const item = itemMap.get(name)!;
    return {
      name: item.n,
      title: item.L,
      category: item.C,
      // Your content-specific fields
    };
  });

  return json({ query, count: results.length, results });
}
```

### 7. Deploy

```bash
# Update wrangler.toml with your project name
# name = "recipe-explorer"

bun run deploy
```

---

## Content Source Patterns

### Static Files (Markdown, JSON, CSV)

Simplest case. Read files at build time, parse, ingest.

```
your-content/
  articles/
    getting-started.md
    api-reference.md
    deployment.md
  metadata.json
```

```typescript
// ingest.ts
const files = readdirSync("your-content/articles").filter(f => f.endsWith(".md"));
for (const file of files) {
  const raw = readFileSync(`your-content/articles/${file}`, "utf8");
  // Parse frontmatter, extract headings, insert into SQLite
}
```

### API / CMS

Fetch from an API at build time. Good for headless CMS, databases, SaaS platforms.

```typescript
// ingest.ts
async function fetchFromCMS() {
  let page = 1;
  const allItems = [];

  while (true) {
    const resp = await fetch(`https://api.your-cms.com/content?page=${page}&per_page=100`);
    const data = await resp.json();
    allItems.push(...data.items);
    if (data.items.length < 100) break;
    page++;
  }

  return allItems;
}
```

### PDFs / Documents

Extract text at build time using CLI tools or libraries.

```typescript
// ingest.ts
import { execSync } from "child_process";

function extractPDF(path: string): string {
  return execSync(`pdftotext "${path}" -`, { encoding: "utf8" });
}

const pdfDir = "your-content/pdfs";
const files = readdirSync(pdfDir).filter(f => f.endsWith(".pdf"));

for (const file of files) {
  const text = extractPDF(`${pdfDir}/${file}`);
  // Insert into SQLite with the extracted text as the body
}
```

### Web Scraping

Fetch and parse web pages at build time.

```typescript
// ingest.ts
const urls = await fetchSitemap("https://docs.example.com/sitemap.xml");

for (const url of urls) {
  const html = await fetch(url).then(r => r.text());
  const { title, text } = extractContent(html);
  // Insert into SQLite
}
```

---

## Scaling Tiers

| Content Size | Strategy | Notes |
|-------------|----------|-------|
| < 1,000 items | Inline JSON in HTML | Single file, instant load |
| 1,000 - 5,000 items | Inline JSON + lazy embeddings | Fetch embeddings.bin on demand |
| 5,000 - 10,000 items | Lazy-load JSON + embeddings | Show loading state, fetch both |
| 10,000 - 50,000 items | Server-side keyword search, client embedding | Worker handles keyword, client does semantic |
| > 50,000 items | Full server-side search | Worker + D1 database or external search service |

### Inline Data Threshold

The single-file approach works until the HTML exceeds ~1MB. At that point:

```javascript
// Instead of inline: const ALL_ITEMS = [{...}, ...];
// Lazy-load:
let ALL_ITEMS = null;
async function loadData() {
  ALL_ITEMS = await fetch("/data/items.json").then(r => r.json());
  buildSearchIndex();
  renderGrid();
}
loadData();
```

---

## Checklist: BYO Content Explorer

### Data Pipeline

- [ ] Define your data model (what fields? what's searchable?)
- [ ] Write `src/build/ingest.ts` for your content source
- [ ] Create SQLite schema with FTS5 virtual table + sync triggers
- [ ] Bulk insert in a transaction
- [ ] Export compact JSON with single-letter keys
- [ ] Export search-terms.json for expanded search
- [ ] Run `bun run embed` to generate embeddings
- [ ] Verify FTS5 queries return relevant results

### Frontend

- [ ] Replace card rendering with your content template
- [ ] Replace detail overlay with your content detail view
- [ ] Update tab categories for your content types
- [ ] Wire copy/share actions to confetti + haptics
- [ ] Update meta tags (title, description, OG image)
- [ ] Test search with your content's vocabulary

### Backend

- [ ] Update Worker API response shapes
- [ ] Update `/api/docs` with your endpoint documentation
- [ ] Optionally add a Claude Code skill (`/api/skill`)
- [ ] Update wrangler.toml project name

### Deployment

- [ ] Update `package.json` project name and scripts
- [ ] Run `bun run dev` to verify locally
- [ ] Deploy with `bun run deploy`
- [ ] Verify all API endpoints return correct data
- [ ] Test mobile layout + haptics + confetti

---

## Example: Converting This Repo for a Recipe Database

```bash
# 1. Fork this repo
git clone git@github.com:tankbottoms/font-awesome.git recipe-explorer
cd recipe-explorer

# 2. Replace data source
#    - Delete downloaded/ (FA packages)
#    - Add your recipe JSON to data/recipes.json

# 3. Edit ingest script
#    src/build/ingest.ts -> parse recipes instead of FA icons

# 4. Rebuild
bun run ingest
bun run embed

# 5. Edit frontend
#    index.html -> replace icon cards with recipe cards

# 6. Edit worker
#    src/worker.ts -> update API response format

# 7. Deploy
bun run deploy
```

Total adaptation time for someone familiar with the codebase: 2-4 hours for a basic content type, a day for complex content with custom detail views.
