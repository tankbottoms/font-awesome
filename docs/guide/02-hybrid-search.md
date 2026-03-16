# Hybrid Search: Fast Client-Side FTS5 + WASM Semantic Search

How to build a search experience that combines sub-millisecond keyword matching with semantic understanding, all running in the browser with zero server round-trips.

---

## Architecture

```
  User types query
       │
       ▼
  ┌─────────────────────┐
  │ Step 1: FTS5 Search  │  ~0.18ms
  │ Inverted index scan  │  Exact, prefix, substring matching
  └──────────┬──────────┘
             │
             │ < 10 results?
             │
       ┌─────▼─────┐
       │    YES     │
       ▼            ▼
  ┌─────────────────────┐
  │ Step 2: Embedding    │  ~35-55ms
  │ ONNX WASM inference  │  Cosine similarity against pre-computed vectors
  └──────────┬──────────┘
             │
             ▼
  ┌─────────────────────┐
  │ Step 3: Score Fusion │
  │ 0.7 * FTS + 0.3 * E │  Merge and rank both result sets
  └──────────┬──────────┘
             │
             ▼
       Display results
```

The search is progressive: keyword search runs on every keystroke (fast enough for real-time). Semantic search only activates when keyword results are sparse, adding conceptual matches without slowing down common queries.

---

## Step 1: Inverted Index (Keyword Search)

### Building the Index

At page load, build an inverted index from the inline JSON data array. This maps every token to the set of items containing it.

```javascript
const searchIndex = new Map();  // token -> Set<itemName>

function buildSearchIndex() {
  for (const item of ALL_ITEMS) {
    // Combine all searchable text for this item
    const text = [
      item.n,                              // name
      item.L,                              // label
      ...(SEARCH_TERMS[item.n] || []),     // expanded terms
    ].join(" ");

    const tokens = tokenize(text);
    for (const token of tokens) {
      if (!searchIndex.has(token)) searchIndex.set(token, new Set());
      searchIndex.get(token).add(item.n);
    }
  }
}

function tokenize(text) {
  return text
    .toLowerCase()
    .split(/[\s,;:\-_]+/)
    .filter(t => t.length >= 2);  // Drop single chars
}
```

**Build time:** ~50ms for 3,860 items. Runs once at page load.

### Search Scoring

Multi-signal scoring with boosting for exact matches and name-starts-with:

```javascript
function ftsSearch(query) {
  const tokens = tokenize(query);
  const scores = new Map();  // itemName -> score

  for (const queryToken of tokens) {
    for (const [indexToken, items] of searchIndex) {
      let score = 0;

      // Exact match: strongest signal
      if (indexToken === queryToken) score = 3;

      // Prefix match: "arr" matches "arrow"
      else if (indexToken.startsWith(queryToken)) score = 2;

      // Substring match: "rrow" matches "arrow" (min 3 chars to avoid noise)
      else if (queryToken.length >= 3 && indexToken.includes(queryToken)) score = 1;

      if (score > 0) {
        for (const name of items) {
          scores.set(name, (scores.get(name) || 0) + score);
        }
      }
    }
  }

  // Boost: item name starts with query (strongest relevance signal)
  const normalized = query.toLowerCase().replace(/\s+/g, "-");
  for (const [name, score] of scores) {
    if (name.startsWith(normalized)) {
      scores.set(name, score + 5);
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 200);
}
```

**Latency:** ~0.18ms average. Fast enough for real-time search-as-you-type.

### Scoring Reference

| Match Type | Score | Example |
|-----------|-------|---------|
| Exact token | +3 | Query "arrow" matches index token "arrow" |
| Prefix | +2 | Query "arr" matches "arrow" |
| Substring | +1 | Query "ouse" matches "house" (min 3 chars) |
| Name starts with | +5 | Query "arrow" boosts item named "arrow-up" |

---

## Step 2: Semantic Embedding Search (WASM)

### Loading the Model

The embedding pipeline uses Transformers.js with an ONNX WASM backend. The model downloads once and is cached in the browser.

```javascript
let embeddingData = null;   // Float32Array of all pre-computed embeddings
let embeddingNames = null;  // Array of item names (same order as embeddings)
let embedder = null;        // Transformers.js pipeline instance
const DIMS = 384;           // all-MiniLM-L6-v2 output dimensions

// Load pre-computed embeddings (5.7MB binary fetch)
async function loadEmbeddings() {
  const [embResp, namesResp] = await Promise.all([
    fetch("/data/embeddings.bin"),
    fetch("/data/embedding-names.json"),
  ]);
  embeddingData = new Float32Array(await embResp.arrayBuffer());
  embeddingNames = await namesResp.json();
}

// Load ONNX model for query embedding (22MB, cached after first load)
async function loadEmbedder() {
  const { pipeline, env } = await import("/downloaded/transformers.min.js");

  // Configure for self-hosted model files
  env.useBrowserCache = true;
  env.cacheDir = "content-explorer-models";
  env.allowLocalModels = false;
  env.remoteHost = location.origin + "/hf-proxy";  // CORS proxy via Worker

  embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
    quantized: true,            // Quantized model = smaller download
    progress_callback: (p) => {
      if (p.status === "download") {
        updateModelProgress(p.loaded, p.total);
      }
    },
  });
}
```

### Self-Hosting Model Assets

To avoid CDN dependencies at runtime, self-host the Transformers.js library and use the Worker as a CORS proxy for model files:

```
dist/downloaded/
  transformers.min.js          # Transformers.js v3.4.1 (~180KB)
  ort-wasm-simd-threaded.wasm  # ONNX Runtime WASM backend (~10MB)
  ort-wasm-simd.wasm           # Fallback without threading
```

The Worker proxies HuggingFace model file requests:

```typescript
// In src/worker.ts
async function handleHFProxy(path: string): Promise<Response> {
  const hfPath = path.replace("/hf-proxy/", "");
  const resp = await fetch(`https://huggingface.co/${hfPath}`, {
    headers: { "User-Agent": "content-explorer/1.0" },
  });
  return new Response(resp.body, {
    status: resp.status,
    headers: {
      "Content-Type": resp.headers.get("Content-Type") || "application/octet-stream",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
```

### Cosine Similarity Search

Once the model is loaded, compute query embeddings and find nearest neighbors by dot product (vectors are pre-normalized, so dot product = cosine similarity):

```javascript
async function embeddingSearch(query, topK = 50) {
  if (!embedder || !embeddingData) return [];

  // Embed the query text
  const output = await embedder(query, { pooling: "mean", normalize: true });
  const qVec = output.data;  // Float32Array[384]

  // Brute-force cosine similarity against all pre-computed embeddings
  const itemCount = embeddingData.length / DIMS;
  const scores = new Array(itemCount);

  for (let i = 0; i < itemCount; i++) {
    let dot = 0;
    const offset = i * DIMS;
    for (let d = 0; d < DIMS; d++) {
      dot += qVec[d] * embeddingData[offset + d];
    }
    scores[i] = { index: i, score: dot };
  }

  // Sort by similarity and return top K
  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, topK);
}
```

**Latency breakdown:**

| Operation | Time |
|-----------|------|
| Query embedding (ONNX WASM) | 25-40ms |
| Cosine similarity (3,860 items) | 2-5ms |
| Sort + slice | 1-2ms |
| **Total** | **~35-55ms** |

---

## Step 3: Hybrid Score Fusion

When keyword search returns fewer than 10 results, activate semantic search and merge both result sets using weighted rank fusion.

```javascript
async function hybridSearch(query) {
  // Step 1: Keyword search (always runs, instant)
  const ftsResults = ftsSearch(query);

  // If keyword search found enough, skip embedding search
  if (ftsResults.length >= 10) {
    return ftsResults.map(([name]) => itemMap.get(name));
  }

  // Step 2: Semantic search (runs only when needed)
  const embResults = await embeddingSearch(query);

  // Step 3: Score fusion
  const fused = new Map();

  // Normalize FTS scores by rank position (1st place = 0.7, last = 0)
  const maxFts = Math.max(ftsResults.length, 1);
  ftsResults.forEach(([name], i) => {
    fused.set(name, 0.7 * (1 - i / maxFts));
  });

  // Add embedding scores (1st place = 0.3, last = 0)
  const maxEmb = Math.max(embResults.length, 1);
  embResults.forEach((result, i) => {
    const name = embeddingNames[result.index];
    const existing = fused.get(name) || 0;
    fused.set(name, existing + 0.3 * (1 - i / maxEmb));
  });

  // Sort by fused score
  return [...fused.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => itemMap.get(name));
}
```

### Fusion Weights

The default weights `0.7 * FTS + 0.3 * cosine` work well for most content types:

| Weight Split | When to Use |
|-------------|-------------|
| 0.7 / 0.3 (default) | Structured content with good metadata (icons, products, docs) |
| 0.5 / 0.5 | Long-form content where exact keywords matter less (articles, papers) |
| 0.3 / 0.7 | Conceptual search where users describe what they want, not exact terms |

---

## Live Search Strategy Indicator

Show users which search strategies are active. This builds trust and helps debug search quality.

```javascript
function updateSearchStrategy(step, timing) {
  const indicators = {
    fts: document.getElementById("step-fts"),
    embedding: document.getElementById("step-embedding"),
    fusion: document.getElementById("step-fusion"),
  };

  // Activate current step with timing
  indicators[step].classList.add("active");
  indicators[step].querySelector(".timing").textContent = `${timing}ms`;
}

// HTML for the strategy indicator
/*
<div class="search-strategy">
  <span id="step-fts" class="step">FTS5 <span class="timing"></span></span>
  <span class="arrow">-></span>
  <span id="step-embedding" class="step">Embedding <span class="timing"></span></span>
  <span class="arrow">-></span>
  <span id="step-fusion" class="step">Fusion <span class="timing"></span></span>
</div>
*/
```

---

## Worker-Side Search (API)

The Worker maintains its own inverted index for API consumers. This mirrors the client-side keyword search but runs on the Cloudflare edge.

```typescript
// src/worker.ts
import iconsData from "./data/items.json";
import searchTermsData from "./data/search-terms.json";

// Built once per V8 isolate, reused across requests
const invertedIndex = new Map<string, Set<string>>();
const itemMap = new Map<string, Item>();

for (const item of iconsData) {
  itemMap.set(item.n, item);
  const terms = searchTermsData[item.n] || [];
  const tokens = tokenize([item.n, item.L, ...terms].join(" "));
  for (const token of tokens) {
    if (!invertedIndex.has(token)) invertedIndex.set(token, new Set());
    invertedIndex.get(token)!.add(item.n);
  }
}
```

The Worker provides two search modes:

| Endpoint | Strategy | Use Case |
|----------|----------|----------|
| `/api/search?q=arrow` | Keyword only (inverted index) | Exact queries, autocomplete |
| `/api/smart?q=weather` | Keywords + expanded terms + category boosting | Agent queries, conceptual search |

The "smart" search on the Worker doesn't use embeddings (no ONNX model on the edge) but compensates with the expanded search terms corpus (354KB of categories, aliases, and synonyms).

---

## Performance Benchmarks

From `bun run benchmark` on the Font Awesome dataset (3,860 items):

| Search Method | Avg Latency | Best For |
|--------------|-------------|----------|
| FTS5 (keyword) | 0.18ms | Known terms: "arrow", "house" |
| Embedding (semantic) | 209ms (build-time SQLite) | Conceptual: "spinning loader" |
| Client WASM embedding | 35-55ms | Same as above, in-browser |
| Hybrid fusion | 36-56ms | Everything (adaptive) |

**FTS5 is 1,151x faster than embedding search.** This is why the hybrid approach runs keyword search first and only falls back to embedding search when needed.

---

## Scaling Considerations

| Item Count | Inverted Index Build | FTS Latency | Embedding Latency | Embedding File |
|-----------|---------------------|-------------|-------------------|---------------|
| 1,000 | ~15ms | < 0.1ms | ~10ms | 1.5MB |
| 5,000 | ~60ms | ~0.2ms | ~20ms | 7.3MB |
| 10,000 | ~120ms | ~0.5ms | ~40ms | 14.6MB |
| 50,000 | ~600ms | ~2ms | ~200ms | 73MB |

**Cutoff recommendations:**

- **< 10,000 items:** Ship everything client-side. Inline JSON + embeddings.bin loads fast on modern connections.
- **10,000 - 50,000 items:** Lazy-load the data JSON and embeddings. Show a loading state.
- **> 50,000 items:** Move to server-side search. Use the Worker with SQLite D1 or external vector DB. Client does async fetch per query.
