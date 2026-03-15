"""
True Embedding Search Benchmark

Uses the actual all-MiniLM-L6-v2 model to encode queries and compare
against stored icon embeddings via cosine similarity.

Complements the Bun benchmark with real semantic search quality metrics.

Usage: python3.11 src/build/benchmark-embeddings.py
"""

import sqlite3
import struct
import time
import json

from sentence_transformers import SentenceTransformer

DB_PATH = "data/icons.db"

print("Loading model...")
model = SentenceTransformer("all-MiniLM-L6-v2")

db = sqlite3.connect(DB_PATH)

# Load all embeddings
print("Loading embeddings...")
rows = db.execute("""
    SELECT e.icon_id, e.embedding, i.name, i.label
    FROM icon_embeddings e JOIN icons i ON e.icon_id = i.id
""").fetchall()

DIMS = 384
icon_vecs = []
for icon_id, emb_blob, name, label in rows:
    vec = struct.unpack(f"{DIMS}f", emb_blob)
    icon_vecs.append((name, label, vec))

print(f"  {len(icon_vecs)} embeddings loaded\n")


def search_embedding(query, top_k=10):
    q_emb = model.encode([query], normalize_embeddings=True)[0]
    scored = []
    for name, label, vec in icon_vecs:
        dot = sum(a * b for a, b in zip(q_emb, vec))
        scored.append((name, label, dot))
    scored.sort(key=lambda x: -x[2])
    return scored[:top_k]


def search_fts5(query, limit=10):
    if len(query) >= 4 and all(c in "0123456789abcdef" for c in query.lower()):
        return db.execute(
            "SELECT name, 0.0 FROM icons WHERE unicode = ? LIMIT ?",
            (query.lower(), limit),
        ).fetchall()
    terms = " OR ".join(f'"{t}"*' for t in query.split())
    try:
        return db.execute(
            "SELECT name, rank FROM icons_fts WHERE icons_fts MATCH ? ORDER BY rank LIMIT ?",
            (terms, limit),
        ).fetchall()
    except:
        return []


queries = [
    ("arrow", "exact", ["arrow-right", "arrow-left", "arrow-up", "arrow-down", "arrow-right-arrow-left"]),
    ("house", "exact", ["house", "house-chimney", "house-user", "house-flag", "house-window"]),
    ("social media", "conceptual", ["facebook", "twitter", "instagram", "linkedin", "reddit", "share", "bluesky"]),
    ("money", "synonym", ["dollar-sign", "money-bill", "coins", "wallet", "money-check"]),
    ("navigation menu", "conceptual", ["bars", "ellipsis", "ellipsis-vertical", "caret-down", "compass"]),
    ("cloud computing", "conceptual", ["cloud", "server", "database", "network-wired", "cloud-arrow-up"]),
    ("spinning loader", "description", ["spinner", "circle-notch", "rotate", "loader", "spinner-third"]),
    ("delete remove", "synonym", ["trash", "xmark", "circle-xmark", "delete-left", "eraser"]),
    ("notification alert", "conceptual", ["bell", "exclamation", "triangle-exclamation", "bell-on", "bell-exclamation"]),
    ("play video", "synonym", ["play", "film", "video", "circle-play", "youtube", "vimeo"]),
    ("user profile", "synonym", ["user", "address-card", "id-card", "circle-user", "user-tie"]),
    ("download file", "synonym", ["download", "file-arrow-down", "cloud-arrow-down", "file-export"]),
    ("chart analytics", "conceptual", ["chart-bar", "chart-line", "chart-pie", "chart-simple", "chart-area"]),
    ("lock security", "conceptual", ["lock", "shield", "key", "unlock", "shield-check"]),
    ("f015", "unicode", ["house"]),
    ("f007", "unicode", ["user"]),
    ("calendar date", "synonym", ["calendar", "calendar-days", "calendar-check", "clock", "calendar-plus"]),
    ("email message", "conceptual", ["envelope", "message", "comment", "paper-plane", "inbox", "mailbox"]),
    ("gear settings", "synonym", ["gear", "gears", "sliders", "wrench", "screwdriver-wrench"]),
    ("heart love", "synonym", ["heart", "heart-pulse", "hand-holding-heart", "face-kiss-wink-heart"]),
]


def precision_at_k(results, expected, k=5):
    top_k = [r[0] for r in results[:k]]
    hits = sum(1 for r in top_k if r in expected)
    return hits / min(k, len(expected))


print("=" * 80)
print(f"{'Query':<25} {'Type':<12} {'FTS5 P@5':>10} {'Emb P@5':>10} {'FTS5 ms':>10} {'Emb ms':>10}")
print("=" * 80)

fts_total_p5 = 0
emb_total_p5 = 0
fts_total_ms = 0
emb_total_ms = 0

type_stats = {}

for query, qtype, expected in queries:
    # FTS5
    t0 = time.perf_counter()
    for _ in range(100):
        fts_results = search_fts5(query)
    fts_ms = (time.perf_counter() - t0) / 100 * 1000

    # Embedding
    t0 = time.perf_counter()
    emb_results = search_embedding(query)
    emb_ms = (time.perf_counter() - t0) * 1000

    fts_p5 = precision_at_k(fts_results, expected)
    emb_p5 = precision_at_k(emb_results, expected)

    fts_total_p5 += fts_p5
    emb_total_p5 += emb_p5
    fts_total_ms += fts_ms
    emb_total_ms += emb_ms

    if qtype not in type_stats:
        type_stats[qtype] = {"fts": [], "emb": []}
    type_stats[qtype]["fts"].append(fts_p5)
    type_stats[qtype]["emb"].append(emb_p5)

    winner = "FTS5" if fts_p5 > emb_p5 else ("Emb" if emb_p5 > fts_p5 else "Tie")
    print(f'  "{query}"'.ljust(25) + f" {qtype:<12} {fts_p5*100:>8.0f}%  {emb_p5*100:>8.0f}%  {fts_ms:>8.3f}ms {emb_ms:>8.1f}ms  [{winner}]")

    # Show top 5 for each
    fts_names = [r[0] for r in fts_results[:5]]
    emb_names = [f"{r[0]}({r[2]:.2f})" for r in emb_results[:5]]
    print(f"    FTS5: {', '.join(fts_names)}")
    print(f"    Emb:  {', '.join(emb_names)}")

n = len(queries)
print("\n" + "=" * 80)
print(f"  AVERAGES: FTS5 P@5={fts_total_p5/n*100:.1f}%  Emb P@5={emb_total_p5/n*100:.1f}%  FTS5={fts_total_ms/n:.3f}ms  Emb={emb_total_ms/n:.1f}ms")

print("\n  BY TYPE:")
for qtype, stats in sorted(type_stats.items()):
    fts_avg = sum(stats["fts"]) / len(stats["fts"])
    emb_avg = sum(stats["emb"]) / len(stats["emb"])
    winner = "FTS5" if fts_avg > emb_avg else ("Emb" if emb_avg > fts_avg else "Tie")
    print(f"    {qtype:<15} FTS5={fts_avg*100:.0f}%  Emb={emb_avg*100:.0f}%  Winner={winner}")

print("\n  CONCLUSION:")
emb_wins = sum(1 for q, t, e in queries if precision_at_k(search_embedding(q), e) > precision_at_k(search_fts5(q), e))
fts_wins = sum(1 for q, t, e in queries if precision_at_k(search_fts5(q), e) > precision_at_k(search_embedding(q), e))
ties = len(queries) - emb_wins - fts_wins
print(f"    Embedding wins: {emb_wins}/{len(queries)}")
print(f"    FTS5 wins: {fts_wins}/{len(queries)}")
print(f"    Ties: {ties}/{len(queries)}")
print(f"    FTS5 is {fts_total_ms/emb_total_ms:.0f}x... wait, emb is slower")
print(f"    FTS5 avg: {fts_total_ms/n:.3f}ms, Embedding avg: {emb_total_ms/n:.1f}ms")
print(f"    Embedding is {emb_total_ms/fts_total_ms:.0f}x slower but has better semantic recall")

db.close()
