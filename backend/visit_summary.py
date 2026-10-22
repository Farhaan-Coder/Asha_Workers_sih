"""
LLM-generated visit summary — adapted from MOM-generator's
backend/mom_generator.py (https://github.com/Ishant5436/MOM-generator),
which turns a meeting transcript into structured minutes (title, attendees,
decisions, action items) via a single LLM call with JSON-schema output.

Adapted here for ASHA home visits: instead of meeting minutes, the model
produces a plain-language visit summary, the symptoms it heard mentioned,
and any advice/follow-up the ASHA worker gave — clinical framing instead of
business-meeting framing. Same reason as rag.py for not doing MOM-
generator's map-reduce chunking: a home-visit transcript is one short
conversation, not an hour-long recording, so a single LLM call over the
whole thing is enough.

This is explicitly a SECOND, independent read of the transcript — additive
to extraction.py's deterministic keyword-based form filling, not a
replacement for it. extraction.py stays the reliable, zero-dependency core
that always runs; this is the "AI summarizes the visit and identifies
symptoms" layer, clearly labeled as AI-generated (not a claimed
ground-truth extraction) so an ASHA worker treats it as a second opinion.
Not called automatically inside extract_all() — a 1-2B local model takes
several seconds, which is fine for an on-demand "Generate AI Summary"
button but too slow to add to the save-a-record critical path.

Provider order matches rag.py: Ollama -> Gemini -> OpenAI. Unlike rag.py's
transcript Q&A, there is no keyword-fallback "answer" here if no LLM is
configured — summarization without an LLM is just extraction.py's job again,
so the fallback instead reuses extraction.py's own keyword-based
symptoms/counseling lists (labeled as such, not presented as an AI summary).
"""
from __future__ import annotations

import json
import os
import urllib.request

import extraction

SYSTEM_PROMPT = (
    "You are reviewing a Hindi/Hinglish transcript of an ASHA health worker's home "
    "visit. Read it and produce a JSON object with exactly these keys:\n"
    '  "summary": a 2-3 sentence plain-language summary of what happened during the visit.\n'
    '  "symptoms_identified": an array of every symptom or physical complaint the PATIENT '
    "described, translated to English, one item per symptom — e.g. a patient who said "
    '"headache" and "blurry vision" and "swelling on my face" must produce '
    '["headache", "blurred vision", "facial swelling"], not an empty list and not one '
    "merged string. A measured vital sign (like a BP reading) is NOT a symptom by itself — "
    "list the complaint that prompted the measurement instead.\n"
    '  "advice_given": an array of advice, counseling, or next steps the ASHA worker gave.\n'
    "Only include what is explicitly in the transcript — use an empty array if nothing "
    "applies to a field. Respond with ONLY the JSON object, no other text."
)


def _extract_json(text: str) -> dict | None:
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:]
    try:
        return json.loads(text)
    except Exception:
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                return json.loads(text[start:end + 1])
            except Exception:
                return None
        return None


def _normalize(data: dict, model: str) -> dict:
    return {
        "summary": str(data.get("summary") or "").strip() or None,
        "symptoms_identified": [str(s).strip() for s in (data.get("symptoms_identified") or []) if str(s).strip()],
        "advice_given": [str(s).strip() for s in (data.get("advice_given") or []) if str(s).strip()],
        "model": model,
    }


def _try_ollama(transcript: str) -> dict | None:
    host = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
    try:
        with urllib.request.urlopen(f"{host}/api/tags", timeout=1.5) as resp:
            models = [m["name"] for m in json.loads(resp.read().decode()).get("models", [])]
    except Exception:
        return None
    if not models:
        return None
    model = os.environ.get("OLLAMA_CHAT_MODEL")
    model = model if model in models else models[0]
    try:
        req = urllib.request.Request(
            f"{host}/api/chat",
            data=json.dumps({
                "model": model,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": f"Transcript:\n\"\"\"\n{transcript}\n\"\"\""},
                ],
                "format": "json",
                "stream": False,
                "options": {"temperature": 0},
            }).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=45) as resp:
            body = json.loads(resp.read().decode())
            parsed = _extract_json(body["message"]["content"])
            return _normalize(parsed, f"ollama:{model}") if parsed else None
    except Exception as e:
        print(f"[visit_summary] Ollama failed: {e!r}")
        return None


def _try_gemini(transcript: str) -> dict | None:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return None
    model = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
    try:
        req = urllib.request.Request(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}",
            data=json.dumps({
                "contents": [{"parts": [{"text": f"{SYSTEM_PROMPT}\n\nTranscript:\n\"\"\"\n{transcript}\n\"\"\""}]}],
                "generationConfig": {"temperature": 0, "responseMimeType": "application/json"},
            }).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=20) as resp:
            body = json.loads(resp.read().decode())
            text = body["candidates"][0]["content"]["parts"][0]["text"]
            parsed = _extract_json(text)
            return _normalize(parsed, f"gemini:{model}") if parsed else None
    except Exception as e:
        print(f"[visit_summary] Gemini failed: {e!r}")
        return None


def _try_openai(transcript: str) -> dict | None:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return None
    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key)
        model = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": f"Transcript:\n\"\"\"\n{transcript}\n\"\"\""},
            ],
            temperature=0,
            response_format={"type": "json_object"},
        )
        parsed = _extract_json(resp.choices[0].message.content)
        return _normalize(parsed, f"openai:{model}") if parsed else None
    except Exception as e:
        print(f"[visit_summary] OpenAI failed: {e!r}")
        return None


def _fallback(transcript: str) -> dict:
    """No LLM configured. Reuses extraction.py's own keyword-based danger-sign
    and counseling detection — labeled as keyword-derived, not an AI summary,
    since that's exactly what it is."""
    visit_type = extraction.detect_visit_type(transcript)
    danger = extraction.extract_danger_signs(transcript, visit_type)
    symptoms = [d["sign"] for d in danger["danger_signs"]]
    advice = extraction._extract_counseling(transcript)
    return {
        "summary": None,
        "symptoms_identified": symptoms,
        "advice_given": advice,
        "model": "keyword_fallback (no LLM configured — same detection extraction.py already does, not a generated summary)",
    }


def generate_visit_summary(transcript: str) -> dict:
    transcript = (transcript or "").strip()
    if not transcript:
        return {"error": "no_transcript", "detail": "This visit has no recorded transcript to summarize."}

    for provider in (_try_ollama, _try_gemini, _try_openai):
        result = provider(transcript)
        if result:
            return result
    return _fallback(transcript)
