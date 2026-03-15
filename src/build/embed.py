"""
Embedding Generation Pipeline (Python)

Generates 384-dim embeddings for each icon using sentence-transformers
all-MiniLM-L6-v2 (cached locally), and stores them as blobs in SQLite.

Usage: python3.11 src/build/embed.py
Requires: data/icons.db (from ingest.ts)
"""

import sqlite3
import struct
import time
import sys

from sentence_transformers import SentenceTransformer
import json

DB_PATH = "data/icons.db"

print("Loading model all-MiniLM-L6-v2 (cached)...")
model = SentenceTransformer("all-MiniLM-L6-v2")
print(f"  Model loaded, embedding dim: {model.get_sentence_embedding_dimension()}")

db = sqlite3.connect(DB_PATH)
db.execute("PRAGMA journal_mode = WAL")

# Get all icons
rows = db.execute("""
    SELECT id, name, label, search_terms, aliases, categories
    FROM icons ORDER BY id
""").fetchall()

print(f"\nGenerating embeddings for {len(rows)} icons...")


def build_search_doc(row):
    icon_id, name, label, search_terms, aliases, categories = row
    parts = [label, name.replace("-", " ")]
    if search_terms:
        try:
            parts.extend(json.loads(search_terms))
        except:
            pass
    if aliases:
        try:
            parts.extend(a.replace("-", " ") for a in json.loads(aliases))
        except:
            pass
    if categories:
        try:
            parts.extend(json.loads(categories))
        except:
            pass
    return " ".join(parts)


# Build all search documents
docs = [build_search_doc(r) for r in rows]
icon_ids = [r[0] for r in rows]

# Generate embeddings in one batch (sentence-transformers handles batching internally)
start = time.time()
embeddings = model.encode(docs, show_progress_bar=True, normalize_embeddings=True, batch_size=128)
elapsed = time.time() - start
print(f"\n  Embeddings generated in {elapsed:.1f}s ({len(rows)/elapsed:.0f} icons/sec)")

# Store in database
print("Storing embeddings...")
db.execute("DELETE FROM icon_embeddings")

insert_sql = "INSERT INTO icon_embeddings (icon_id, embedding) VALUES (?, ?)"
batch = []
for i, (icon_id, emb) in enumerate(zip(icon_ids, embeddings)):
    # Pack as float32 blob
    blob = struct.pack(f"{len(emb)}f", *emb.tolist())
    batch.append((icon_id, blob))

db.executemany(insert_sql, batch)
db.commit()

# Verify
count = db.execute("SELECT COUNT(*) FROM icon_embeddings").fetchone()[0]
sample = db.execute("SELECT embedding FROM icon_embeddings LIMIT 1").fetchone()[0]
dims = len(sample) // 4
print(f"  Stored {count} embeddings ({dims} dimensions each)")


# Quick similarity test
def search_by_embedding(query, top_k=5):
    q_emb = model.encode([query], normalize_embeddings=True)[0]

    all_rows = db.execute("""
        SELECT e.icon_id, e.embedding, i.name, i.label
        FROM icon_embeddings e JOIN icons i ON e.icon_id = i.id
    """).fetchall()

    results = []
    for icon_id, emb_blob, name, label in all_rows:
        vec = struct.unpack(f"{dims}f", emb_blob)
        dot = sum(a * b for a, b in zip(q_emb, vec))
        results.append((name, label, dot))

    results.sort(key=lambda x: -x[2])
    return results[:top_k]


print("\n=== Embedding Similarity Test ===")
test_queries = [
    "social media",
    "spinning loader",
    "delete remove",
    "navigation menu",
    "cloud computing",
    "notification alert",
    "money payment",
    "play video",
]

for q in test_queries:
    results = search_by_embedding(q)
    result_str = ", ".join(f"{r[0]} ({r[2]:.3f})" for r in results)
    print(f'  "{q}": {result_str}')

# DB size
import os
size_mb = os.path.getsize(DB_PATH) / 1024 / 1024
print(f"\nDatabase size: {size_mb:.2f} MB")
db.close()
print("Done.")
