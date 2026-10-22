"""
Transcript Q&A — adapted from SwDC-kjsse/mom_generator_rag's RAG-based
"chat with your meeting" feature (backend/rag.py: chunk transcript -> embed
into ChromaDB -> retrieve top-k -> answer via Ollama/cloud LLM), for
Sukanya's "ask a question about this home visit" use case.

Deliberately simpler than the source project, on purpose, not as a shortcut:
that project chunks + vector-retrieves because meeting transcripts can run
to hours. An ASHA home-visit transcript is one conversation — a few hundred
to a couple of thousand characters — so chunking and retrieval solve a
problem this domain doesn't have. The whole transcript is passed to the LLM
directly as context; no vector search needed at this scope.

Cross-visit "have we seen a case like this before" retrieval — the problem
the source project's Chroma index *is* the right shape for — is handled
separately by vectorstore.py's Mongo-backed cosine search over saved
records, not duplicated here.

Provider order, same graceful-degradation pattern as extraction.py's
enhance_with_ollama and transcribe.py's multi-engine fallback:
  1. Local Ollama (OLLAMA_HOST, default http://localhost:11434) — free, private,
     works offline once a model is pulled (`ollama pull llama3.2:1b`).
  2. Gemini (GEMINI_API_KEY) — free tier, cloud.
  3. OpenAI (OPENAI_API_KEY) — paid, cloud.
  4. None available -> return the transcript's most keyword-relevant lines
     directly, with no generated answer, rather than failing. Never fabricate
     an answer with no LLM behind it.

Observed during integration testing (2026-08-27): against a real transcript
(the preeclampsia sample), llama3.2:1b answered BP + symptoms correctly with
no fabrication. Against a placeholder/degenerate transcript (literally the
string "sample transcript", left over from API testing before any real visit
had a recorded conversation), it confabulated a plausible-sounding but
entirely invented clinical summary instead of saying there was nothing to
summarize — small (1-2B parameter) local models are noticeably more prone to
this than the cloud fallbacks. SYSTEM_PROMPT already instructs the model not
to guess; that instruction is not reliably followed at this model size. If
this matters for a deployment, use a larger local model (`ollama pull
llama3.1:8b` or similar) or a cloud provider, not a smaller Ollama model.
"""
from __future__ import annotations

import json
import os
import re
import urllib.request

OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_CHAT_MODEL = os.environ.get("OLLAMA_CHAT_MODEL")  # None = auto-pick from what's pulled

SYSTEM_PROMPT = (
    "You are a clinical assistant helping an ASHA health worker review a home-visit "
    "transcript. Answer the question using ONLY what is in the transcript below. "
    "If the answer isn't in the transcript, say so plainly — never guess or invent "
    "a clinical detail. Be concise and specific (cite the value or phrase, e.g. "
    "'BP was stated as 155/100', not just 'BP was high')."
)


def _ollama_available() -> bool:
    try:
        urllib.request.urlopen(f"{OLLAMA_HOST}/api/tags", timeout=1.5)
        return True
    except Exception:
        return False


def _ollama_models() -> list[str]:
    try:
        with urllib.request.urlopen(f"{OLLAMA_HOST}/api/tags", timeout=1.5) as resp:
            data = json.loads(resp.read().decode())
            return [m["name"] for m in data.get("models", [])]
    except Exception:
        return []


def _ask_ollama(transcript: str, question: str) -> dict | None:
    if not _ollama_available():
        return None
    models = _ollama_models()
    if not models:
        return None
    model = OLLAMA_CHAT_MODEL if OLLAMA_CHAT_MODEL in models else models[0]
    prompt = f"Transcript:\n\"\"\"\n{transcript}\n\"\"\"\n\nQuestion: {question}"
    try:
        req = urllib.request.Request(
            f"{OLLAMA_HOST}/api/chat",
            data=json.dumps({
                "model": model,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ],
                "stream": False,
                "options": {"temperature": 0},
            }).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = json.loads(resp.read().decode())
            return {"answer": body["message"]["content"].strip(), "model": f"ollama:{model}"}
    except Exception as e:
        print(f"[rag] Ollama chat failed: {e!r}")
        return None


def _ask_gemini(transcript: str, question: str) -> dict | None:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return None
    model = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
    prompt = f"{SYSTEM_PROMPT}\n\nTranscript:\n\"\"\"\n{transcript}\n\"\"\"\n\nQuestion: {question}"
    try:
        req = urllib.request.Request(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}",
            data=json.dumps({
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": 0},
            }).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=20) as resp:
            body = json.loads(resp.read().decode())
            text = body["candidates"][0]["content"]["parts"][0]["text"]
            return {"answer": text.strip(), "model": f"gemini:{model}"}
    except Exception as e:
        print(f"[rag] Gemini chat failed: {e!r}")
        return None


def _ask_openai(transcript: str, question: str) -> dict | None:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return None
    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key)
        model = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
        prompt = f"Transcript:\n\"\"\"\n{transcript}\n\"\"\"\n\nQuestion: {question}"
        resp = client.chat.completions.create(
            model=model,
            messages=[{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": prompt}],
            temperature=0,
        )
        return {"answer": resp.choices[0].message.content.strip(), "model": f"openai:{model}"}
    except Exception as e:
        print(f"[rag] OpenAI chat failed: {e!r}")
        return None


_ROLE_LABELS = {"asha", "patient", "mother", "worker", "speaker"}


def _keyword_fallback(transcript: str, question: str) -> dict:
    """No LLM available anywhere. Rather than fail, surface the transcript
    lines that share the most words with the question — a crude but honest
    substitute that never invents a clinical fact.

    Speaker-label words (every line starts with "ASHA:"/"Patient:") are
    excluded from scoring on both sides — otherwise a question containing
    "patient" ties every line spoken by the patient at score 1, drowning out
    the line that actually contains the answer."""
    q_words = {w for w in re.findall(r"\w+", question.lower()) if len(w) > 1} - _ROLE_LABELS
    lines = [l.strip() for l in re.split(r"[\n।.]", transcript) if l.strip()]
    scored = []
    for line in lines:
        body = re.sub(r"^\s*(asha|patient|mother|worker|speaker\s*\d*)\s*:", "", line, flags=re.IGNORECASE)
        line_words = set(re.findall(r"\w+", body.lower())) - _ROLE_LABELS
        overlap = len(q_words & line_words)
        if overlap > 0:
            scored.append((overlap, line))
    scored.sort(key=lambda x: x[0], reverse=True)
    top = [line for _, line in scored[:3]]
    return {
        "answer": (
            "No local or cloud LLM is configured, so I can't generate a written answer — "
            "here are the transcript lines most related to your question:"
        ) if top else "No local or cloud LLM is configured, and no matching lines were found in the transcript.",
        "excerpts": top,
        "model": "keyword_fallback",
    }


def ask_about_transcript(transcript: str, question: str) -> dict:
    transcript = (transcript or "").strip()
    question = (question or "").strip()
    if not transcript:
        return {"error": "no_transcript", "detail": "This visit has no recorded transcript to ask about."}
    if not question:
        return {"error": "empty_question"}

    for provider in (_ask_ollama, _ask_gemini, _ask_openai):
        result = provider(transcript, question)
        if result:
            return result
    return _keyword_fallback(transcript, question)
