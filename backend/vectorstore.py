"""
Local vector search over saved health records — MongoDB is used as a plain
document store here (no Atlas, no $vectorSearch aggregation stage); the
embedding for each record's transcript + symptoms is stored as a plain
array field on the `records` document, and similarity search is brute-force
cosine similarity computed in Python at query time.

Why local instead of Atlas Vector Search: this project's own stated privacy
posture (see README: "data fiduciary stays within the institution, no
cross-border transfer... DPDP Act alignment") rules out sending patient
transcripts to a managed cloud cluster, and a laptop demo for judges
shouldn't depend on network access to a cloud database. Brute-force cosine
over a few hundred/thousand records is well under a second in Python — fine
at this scale. If this needs to scale past a few tens of thousands of
records, swap this module for Atlas Vector Search or a local FAISS index;
the call sites (`embed_text`, `semantic_search`) wouldn't need to change.

Embedding model: sentence-transformers' multilingual MiniLM
(paraphrase-multilingual-MiniLM-L12-v2) — chosen specifically because ASHA
visit transcripts are Hindi/Hinglish. An English-only embedding model would
cluster every Hindi transcript together regardless of content, which is a
silent failure mode worth avoiding deliberately.

Everything here is optional: if sentence-transformers isn't installed (it's
a ~470MB download — not forced on by default so the base backend stays
light), `embed_text` returns None and callers skip storing/searching
embeddings entirely. The rest of the app (forms, risk scoring, alerts) does
not depend on this module.
"""
import math
import os

_model = None
_model_load_failed = False

MODEL_NAME = os.environ.get("SUKANYA_EMBED_MODEL", "paraphrase-multilingual-MiniLM-L12-v2")


def _get_model():
    global _model, _model_load_failed
    if _model is None and not _model_load_failed:
        try:
            from sentence_transformers import SentenceTransformer
            _model = SentenceTransformer(MODEL_NAME)
        except Exception as e:
            print(f"[vectorstore] Embedding model unavailable ({e!r}); semantic search disabled, "
                  f"exact-match filtering on records still works.")
            _model_load_failed = True
    return _model


def embed_text(text: str):
    if not text or not text.strip():
        return None
    model = _get_model()
    if model is None:
        return None
    try:
        vec = model.encode(text, normalize_embeddings=True)
        return vec.tolist()
    except Exception as e:
        print(f"[vectorstore] embedding failed: {e!r}")
        return None


def _cosine(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def semantic_search(query: str, worker_id: int = None, top_k: int = 5):
    """Returns the top_k most similar records by transcript/symptom meaning
    (not keyword match) — e.g. a query in English can retrieve a matching
    Hindi transcript. Used for "find similar prior cases" during risk
    review, and for the beneficiary/ASHA history search."""
    import db

    query_vec = embed_text(query)
    if query_vec is None:
        return {"results": [], "note": "Semantic search unavailable (embedding model not installed)."}

    candidates = db.all_records_with_embeddings()
    if worker_id is not None:
        candidates = [c for c in candidates if c.get("worker_id") == worker_id]

    scored = []
    for rec in candidates:
        emb = rec.get("embedding")
        if not emb:
            continue
        score = _cosine(query_vec, emb)
        scored.append((score, rec))

    scored.sort(key=lambda x: x[0], reverse=True)
    out = []
    for score, rec in scored[:top_k]:
        out.append({
            "record_id": rec["id"], "visit_id": rec.get("visit_id"),
            "visit_type": rec.get("visit_type"), "transcript": rec.get("transcript"),
            "similarity": round(float(score), 4),
        })
    return {"results": out}


def embedding_source_text(visit_type: str, form: dict, transcript: str) -> str:
    """What actually gets embedded per record: the transcript (if any) plus
    a flattened symptoms/counseling summary — not the raw JSON form, since
    embedding structural JSON keys adds noise rather than clinical meaning."""
    parts = []
    if transcript:
        parts.append(transcript)
    if isinstance(form, dict):
        symptoms = form.get("symptoms_reported") or []
        if symptoms:
            parts.append("Symptoms: " + ", ".join(symptoms))
        counseling = form.get("counseling_provided") or []
        if counseling:
            parts.append("Counseling: " + ", ".join(counseling))
    return "\n".join(parts)
