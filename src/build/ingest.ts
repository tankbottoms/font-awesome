/**
 * Icon Data Ingestion Pipeline
 *
 * Parses icon-families.json from Pro 6.5.1 (primary) and Free 7.2.0 (supplement),
 * plus categories.yml, into a unified SQLite database with FTS5 full-text search.
 *
 * Usage: bun run src/build/ingest.ts
 * Output: data/icons.db
 */

import { Database } from "bun:sqlite";
import { readFileSync } from "fs";
import { parse as parseYaml } from "yaml";

const PRO_PATH = "downloaded/fontawesome-pro-6.5.1-web/metadata";
const FREE_PATH = "downloaded/fontawesome-free-7.2.0-web/metadata";
const DB_PATH = "data/icons.db";

// ── Types ──

interface IconFamilyEntry {
  aliases?: { names?: string[]; unicodes?: Record<string, string[]> };
  changes?: string[];
  ligatures?: string[];
  search?: { terms?: string[] };
  unicode: string;
  label: string;
  voted?: boolean;
  svgs: Record<string, Record<string, SvgEntry>>;
  familyStylesByLicense: {
    free: { family: string; style: string }[];
    pro: { family: string; style: string }[];
  };
}

interface SvgEntry {
  lastModified: number;
  raw: string;
  viewBox: number[];
  width: number;
  height: number;
  path: string | string[];
}

interface CategoryEntry {
  icons: string[];
  label: string;
}

// ── Load data ──

console.log("Loading icon-families.json (Pro 6.5.1)...");
const proData: Record<string, IconFamilyEntry> = JSON.parse(
  readFileSync(`${PRO_PATH}/icon-families.json`, "utf8")
);
console.log(`  ${Object.keys(proData).length} icons`);

console.log("Loading icon-families.json (Free 7.2.0)...");
const freeData: Record<string, IconFamilyEntry> = JSON.parse(
  readFileSync(`${FREE_PATH}/icon-families.json`, "utf8")
);
console.log(`  ${Object.keys(freeData).length} icons`);

console.log("Loading categories.yml...");
const categories: Record<string, CategoryEntry> = parseYaml(
  readFileSync(`${PRO_PATH}/categories.yml`, "utf8")
);
console.log(`  ${Object.keys(categories).length} categories`);

// Build reverse category map: icon name -> category labels
const iconCategories = new Map<string, string[]>();
for (const [, cat] of Object.entries(categories)) {
  for (const iconName of cat.icons) {
    const existing = iconCategories.get(iconName) || [];
    existing.push(cat.label);
    iconCategories.set(iconName, existing);
  }
}

// ── Create database ──

console.log("\nCreating database...");

// Remove existing DB
try {
  require("fs").unlinkSync(DB_PATH);
} catch {}

const db = new Database(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA synchronous = NORMAL");

// Source packages
db.exec(`
  CREATE TABLE sources (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    tier TEXT NOT NULL,
    version TEXT NOT NULL
  )
`);

// Icons table
db.exec(`
  CREATE TABLE icons (
    id INTEGER PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    label TEXT NOT NULL,
    unicode TEXT NOT NULL,
    search_terms TEXT,
    aliases TEXT,
    categories TEXT,
    tier TEXT NOT NULL,
    source_id INTEGER REFERENCES sources(id)
  )
`);

// Style variants
db.exec(`
  CREATE TABLE icon_styles (
    id INTEGER PRIMARY KEY,
    icon_id INTEGER REFERENCES icons(id),
    family TEXT NOT NULL,
    style TEXT NOT NULL,
    svg_path TEXT,
    svg_viewbox TEXT,
    svg_width INTEGER,
    svg_height INTEGER,
    UNIQUE(icon_id, family, style)
  )
`);

// Embeddings table (blob storage, no vec0)
db.exec(`
  CREATE TABLE icon_embeddings (
    icon_id INTEGER PRIMARY KEY REFERENCES icons(id),
    embedding BLOB NOT NULL
  )
`);

// FTS5
db.exec(`
  CREATE VIRTUAL TABLE icons_fts USING fts5(
    name, label, search_terms, aliases, categories,
    content=icons, content_rowid=id
  )
`);

// Triggers for FTS sync
db.exec(`
  CREATE TRIGGER icons_ai AFTER INSERT ON icons BEGIN
    INSERT INTO icons_fts(rowid, name, label, search_terms, aliases, categories)
    VALUES (new.id, new.name, new.label, new.search_terms, new.aliases, new.categories);
  END
`);

db.exec(`
  CREATE TRIGGER icons_ad AFTER DELETE ON icons BEGIN
    INSERT INTO icons_fts(icons_fts, rowid, name, label, search_terms, aliases, categories)
    VALUES ('delete', old.id, old.name, old.label, old.search_terms, old.aliases, old.categories);
  END
`);

db.exec(`
  CREATE TRIGGER icons_au AFTER UPDATE ON icons BEGIN
    INSERT INTO icons_fts(icons_fts, rowid, name, label, search_terms, aliases, categories)
    VALUES ('delete', old.id, old.name, old.label, old.search_terms, old.aliases, old.categories);
    INSERT INTO icons_fts(rowid, name, label, search_terms, aliases, categories)
    VALUES (new.id, new.name, new.label, new.search_terms, new.aliases, new.categories);
  END
`);

// ── Insert sources ──

const insertSource = db.prepare(
  "INSERT INTO sources (name, tier, version) VALUES (?, ?, ?)"
);
insertSource.run("pro-6.5.1", "pro", "6.5.1");
insertSource.run("free-7.2.0", "free", "7.2.0");

// ── Insert icons ──

const insertIcon = db.prepare(`
  INSERT INTO icons (name, label, unicode, search_terms, aliases, categories, tier, source_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertStyle = db.prepare(`
  INSERT OR IGNORE INTO icon_styles (icon_id, family, style, svg_path, svg_viewbox, svg_width, svg_height)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const getIconId = db.prepare("SELECT id FROM icons WHERE name = ?");

function determineTier(entry: IconFamilyEntry): "free" | "pro" {
  return entry.familyStylesByLicense.free.length > 0 ? "free" : "pro";
}

function insertIconEntry(
  name: string,
  entry: IconFamilyEntry,
  sourceId: number
) {
  const searchTerms = entry.search?.terms || [];
  const aliasNames = entry.aliases?.names || [];
  const cats = iconCategories.get(name) || [];
  const tier = determineTier(entry);

  insertIcon.run(
    name,
    entry.label,
    entry.unicode,
    searchTerms.length ? JSON.stringify(searchTerms) : null,
    aliasNames.length ? JSON.stringify(aliasNames) : null,
    cats.length ? JSON.stringify(cats) : null,
    tier,
    sourceId
  );

  const row = getIconId.get(name) as { id: number } | null;
  if (!row) return;
  const iconId = row.id;

  // Insert all SVG style variants
  for (const [family, styles] of Object.entries(entry.svgs)) {
    for (const [style, svg] of Object.entries(styles)) {
      const pathStr =
        typeof svg.path === "string" ? svg.path : JSON.stringify(svg.path);
      const viewBox = svg.viewBox ? svg.viewBox.join(" ") : null;
      insertStyle.run(
        iconId,
        family,
        style,
        pathStr,
        viewBox,
        svg.width,
        svg.height
      );
    }
  }
}

// Wrap in transaction for speed
console.log("Ingesting Pro 6.5.1 icons...");
const proSourceId = 1;
const freeSourceId = 2;

db.exec("BEGIN");

let proCount = 0;
for (const [name, entry] of Object.entries(proData)) {
  insertIconEntry(name, entry, proSourceId);
  proCount++;
}
console.log(`  ${proCount} pro icons inserted`);

// Add free-only icons (not in pro)
let freeExtra = 0;
for (const [name, entry] of Object.entries(freeData)) {
  if (proData[name]) continue; // Skip duplicates
  insertIconEntry(name, entry, freeSourceId);
  freeExtra++;
}
console.log(`  ${freeExtra} extra free icons inserted`);

db.exec("COMMIT");

// ── Verify ──

const totalIcons = (
  db.prepare("SELECT COUNT(*) as c FROM icons").get() as { c: number }
).c;
const totalStyles = (
  db.prepare("SELECT COUNT(*) as c FROM icon_styles").get() as { c: number }
).c;
const freeCount = (
  db
    .prepare("SELECT COUNT(*) as c FROM icons WHERE tier = 'free'")
    .get() as { c: number }
).c;
const proOnlyCount = (
  db
    .prepare("SELECT COUNT(*) as c FROM icons WHERE tier = 'pro'")
    .get() as { c: number }
).c;

console.log("\n=== Database Summary ===");
console.log(`Total icons: ${totalIcons}`);
console.log(`Total style variants: ${totalStyles}`);
console.log(`Free tier: ${freeCount}`);
console.log(`Pro only: ${proOnlyCount}`);

// Test FTS5
console.log("\n=== FTS5 Test Queries ===");
const ftsTest = db.prepare(`
  SELECT name, label, rank FROM icons_fts WHERE icons_fts MATCH ? ORDER BY rank LIMIT 5
`);

for (const q of ["arrow", "house home", "social", "cloud"]) {
  const results = ftsTest.all(q) as { name: string; label: string }[];
  console.log(
    `  "${q}": ${results.map((r) => r.name).join(", ") || "(no results)"}`
  );
}

// Style breakdown
const styleBreakdown = db
  .prepare(
    `
  SELECT family || '/' || style as fs, COUNT(*) as c
  FROM icon_styles
  GROUP BY family, style
  ORDER BY c DESC
`
  )
  .all() as { fs: string; c: number }[];

console.log("\n=== Style Breakdown ===");
for (const row of styleBreakdown) {
  console.log(`  ${row.fs}: ${row.c}`);
}

// File size
const stat = require("fs").statSync(DB_PATH);
console.log(`\nDatabase size: ${(stat.size / 1024 / 1024).toFixed(2)} MB`);

db.close();
console.log("\nDone. Database written to", DB_PATH);
