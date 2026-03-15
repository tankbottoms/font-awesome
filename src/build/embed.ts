/**
 * Embedding Generation Pipeline (Bun/TypeScript)
 *
 * Generates 384-dim normalized embeddings for each icon using all-MiniLM-L6-v2 (ONNX)
 * via @xenova/transformers, loading from local model files (no network required).
 *
 * Usage: bun run src/build/embed.ts
 * Requires: data/icons.db (from ingest.ts)
 *           models/Xenova/all-MiniLM-L6-v2/ (symlinked from chroma cache)
 */

import { Database } from "bun:sqlite";
import { env, pipeline } from "@xenova/transformers";
import { statSync } from "fs";
import { resolve } from "path";

const DB_PATH = "data/icons.db";
const MODEL_DIR = resolve(import.meta.dir, "../../models");

// -- Configure @xenova/transformers to load from local files only --
env.localModelPath = MODEL_DIR + "/";
env.allowRemoteModels = false;
env.allowLocalModels = true;
// Disable caching since we're loading directly from local files
env.useFSCache = false;
env.useBrowserCache = false;

console.log("Loading embedding model (all-MiniLM-L6-v2) from local files...");
console.log(`  Model path: ${MODEL_DIR}/Xenova/all-MiniLM-L6-v2/`);

const embedder = await pipeline(
  "feature-extraction",
  "Xenova/all-MiniLM-L6-v2",
  { local_files_only: true, quantized: false }
);

console.log("  Model loaded successfully.\n");

const db = new Database(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");

// Get all icons with their searchable text
const icons = db
  .prepare(
    `SELECT id, name, label, search_terms, aliases, categories
     FROM icons ORDER BY id`
  )
  .all() as {
  id: number;
  name: string;
  label: string;
  search_terms: string | null;
  aliases: string | null;
  categories: string | null;
}[];

console.log(`Generating embeddings for ${icons.length} icons...`);

/** Build a search document string from an icon's metadata */
function buildSearchDoc(icon: (typeof icons)[0]): string {
  const parts = [icon.label, icon.name.replace(/-/g, " ")];

  if (icon.search_terms) {
    try {
      parts.push(...JSON.parse(icon.search_terms));
    } catch {}
  }
  if (icon.aliases) {
    try {
      parts.push(
        ...JSON.parse(icon.aliases).map((a: string) => a.replace(/-/g, " "))
      );
    } catch {}
  }
  if (icon.categories) {
    try {
      parts.push(...JSON.parse(icon.categories));
    } catch {}
  }

  return parts.join(" ");
}

// Clear existing embeddings
db.run("DELETE FROM icon_embeddings");

const insertEmbed = db.prepare(
  "INSERT INTO icon_embeddings (icon_id, embedding) VALUES (?, ?)"
);

// Process in batches
const BATCH_SIZE = 64;
const startTime = Date.now();
let processed = 0;

db.run("BEGIN");

for (let i = 0; i < icons.length; i += BATCH_SIZE) {
  const batch = icons.slice(i, i + BATCH_SIZE);
  const docs = batch.map(buildSearchDoc);

  // Generate embeddings for entire batch
  const output = await embedder(docs, {
    pooling: "mean",
    normalize: true,
  });

  // Store each embedding as a Float32Array blob
  for (let j = 0; j < batch.length; j++) {
    const embedding = output[j].data;
    const f32 = new Float32Array(embedding);
    const buffer = Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
    insertEmbed.run(batch[j].id, buffer);
  }

  processed += batch.length;
  if (processed % 256 === 0 || processed === icons.length) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const rate = (processed / ((Date.now() - startTime) / 1000)).toFixed(0);
    process.stdout.write(
      `\r  ${processed}/${icons.length} (${rate} icons/sec, ${elapsed}s)`
    );
  }
}

db.run("COMMIT");

const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
console.log(`\n\nEmbeddings complete in ${totalTime}s`);

// Verify
const count = (
  db.prepare("SELECT COUNT(*) as c FROM icon_embeddings").get() as {
    c: number;
  }
).c;
const sampleRow = db
  .prepare("SELECT embedding FROM icon_embeddings LIMIT 1")
  .get() as { embedding: Buffer };
const dims = sampleRow.embedding.length / 4; // Float32 = 4 bytes

console.log(`Stored ${count} embeddings (${dims} dimensions each)`);

// -- Quick similarity test --
console.log("\n=== Embedding Similarity Test ===");

async function searchByEmbedding(query: string, topK = 5) {
  const qOutput = await embedder([query], {
    pooling: "mean",
    normalize: true,
  });
  const qVec = new Float32Array(qOutput[0].data);

  const allEmbeddings = db
    .prepare(
      `SELECT e.icon_id, e.embedding, i.name, i.label
       FROM icon_embeddings e JOIN icons i ON e.icon_id = i.id`
    )
    .all() as {
    icon_id: number;
    embedding: Buffer;
    name: string;
    label: string;
  }[];

  const scored = allEmbeddings.map((row) => {
    const buf = row.embedding;
    const vec = new Float32Array(
      buf.buffer,
      buf.byteOffset,
      buf.byteLength / 4
    );
    let dot = 0;
    for (let k = 0; k < qVec.length; k++) dot += qVec[k] * vec[k];
    return { name: row.name, label: row.label, score: dot };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

const testQueries = [
  "social media",
  "spinning loader",
  "delete remove",
  "navigation menu",
  "cloud computing",
  "notification alert",
  "money payment",
  "play video",
];

for (const q of testQueries) {
  const results = await searchByEmbedding(q);
  console.log(
    `  "${q}": ${results.map((r) => `${r.name} (${r.score.toFixed(3)})`).join(", ")}`
  );
}

// DB size
const sizeMB = statSync(DB_PATH).size / 1024 / 1024;
console.log(`\nDatabase size: ${sizeMB.toFixed(2)} MB`);

db.close();
console.log("Done.");
