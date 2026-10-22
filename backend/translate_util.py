"""
Text translation to English — shared by POST /api/translate and the
process-text/process-audio pipeline's "translate before extraction" step.

Why translate at all: extraction.py's regex/keyword patterns only cover
Hindi and English (documented limitation in README.md). A Marathi or
Bengali visit transcribes fine (Whisper is multilingual) but then silently
extracts almost nothing, because there is no Marathi/Bengali keyword list
to match against. Translating the transcript to English first — rather
than hand-writing four more copies of every clinical keyword pattern in
extraction.py — makes extraction language-agnostic for all four languages
this app targets (en/hi/mr/bn) using the coverage that already exists.

Primary: deep_translator's GoogleTranslator (no API key, scrapes Google's
public translate endpoint) — this is what /api/translate already used and
had already been debugged (see _looks_like_error_page below).
Fallback: Gemini text translation (needs GEMINI_API_KEY) — a plain text
prompt, no audio involved, used only when GoogleTranslator raises or comes
back empty/error-page.
"""
from __future__ import annotations

import os
import re
try:
    from . import indic_numbers
except (ImportError, ValueError):
    import indic_numbers


def refine_english_clinical_transcript(text: str) -> str:
    """Post-processes translated English transcript to ensure accurate medical formatting and numbers."""
    if not text:
        return text
    
    # 1. Convert any leftover Indic digits
    res = indic_numbers.convert_indic_digits(text)
    
    # 2. Fix BP formats: "140 x 90", "140 by 90", "140 over 90" -> "140/90 mmHg"
    res = re.sub(r"\b(\d{2,3})\s*(?:x|by|over|/)\s*(\d{2,3})\b(?!\s*mmHg)", r"\1/\2 mmHg", res, flags=re.IGNORECASE)
    
    # 3. Standardize Age: "Patient age 27 year old", "age is 27 years", "age: 27" -> "Age: 27"
    res = re.sub(r"\b(?:patient\s+)?age(?:\s+is|\s*:)?\s*(\d{1,2})\s*(?:years?\s*old|years?|yrs?|yr)?\b", r"Age: \1", res, flags=re.IGNORECASE)
    
    # 4. Standardize Weight
    res = re.sub(r"\b(\d{1,3}(?:\.\d+)?)\s*(?:kgs?|kilograms?)\b", r"\1 kg", res, flags=re.IGNORECASE)

    # 5. Standardize Temperature
    res = re.sub(r"\b(\d{2,3}(?:\.\d+)?)\s*(?:degrees?\s*f(?:ahrenheit)?|deg\s*f|°\s*f|fahrenheit)\b", r"\1°F", res, flags=re.IGNORECASE)
    
    # 6. Standardize Pulse
    res = re.sub(r"\b(?:pulse|heart rate)\s*(?:is|:)?\s*(\d{2,3})\b(?!\s*bpm)", r"Pulse: \1 bpm", res, flags=re.IGNORECASE)

    return res.strip()


def _looks_like_error_page(text: str) -> bool:
    return "Error 500" in text or "That's an error" in text or "That’s an error" in text


LANGUAGE_NAME_MAP = {
    "en": "English",
    "hi": "Hindi",
    "mr": "Marathi",
    "bn": "Bengali",
    "ta": "Tamil",
    "te": "Telugu",
    "gu": "Gujarati",
    "kn": "Kannada",
    "pa": "Punjabi",
    "ml": "Malayalam",
    "or": "Odia",
    "ur": "Urdu",
}


def _try_google_translate_lang(text: str, target_lang: str = "en", source_lang: str = "auto") -> str | None:
    from deep_translator import GoogleTranslator
    src = source_lang or "auto"
    tgt = target_lang or "en"
    for _attempt in range(2):
        try:
            candidate = GoogleTranslator(source=src, target=tgt).translate(text)
            if candidate and not _looks_like_error_page(candidate):
                return candidate
        except Exception as e:
            print(f"[translate_util] GoogleTranslator ({src}->{tgt}) failed: {e}")
    return None


def _try_gemini_translate_lang(text: str, target_lang: str = "en") -> str | None:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return None
    try:
        from google import genai
        client = genai.Client(api_key=api_key)
        target_name = LANGUAGE_NAME_MAP.get(target_lang, target_lang)
        prompt = (
            f"Translate the following ASHA health-worker clinical home-visit transcript to {target_name}. "
            "Preserve all patient demographics, vitals (BP, temperature, pulse, sugar, weight), dosages, and medical instructions accurately. "
            f"Output ONLY the translated {target_name} text, nothing else.\n\n" + text
        )
        response = client.models.generate_content(model="gemini-2.5-flash", contents=[prompt])
        candidate = (response.text or "").strip()
        return candidate or None
    except Exception as e:
        print(f"[translate_util] Gemini text translation ({target_lang}) failed: {e}")
        return None


def translate_text(text: str, target_lang: str = "en", source_lang: str = "auto") -> dict:
    """Translates text into any target language (e.g. en, hi, mr, bn, ta, te, gu, kn).
    Returns {"translated_text": str, "target_language": str, "backend": str, "skipped": bool}.
    """
    if not text or not text.strip():
        return {"translated_text": text, "target_language": target_lang, "backend": "none", "skipped": True}

    target_lang = (target_lang or "en").lower().strip()
    source_lang = (source_lang or "auto").lower().strip()

    # Pre-process text to convert Indic numerals and number words
    normalized_input = indic_numbers.normalize_indic_numbers_in_text(text)

    # If source and target are the same language, skip translation
    if source_lang == target_lang and source_lang != "auto":
        refined = refine_english_clinical_transcript(normalized_input) if target_lang == "en" else normalized_input
        return {"translated_text": refined, "target_language": target_lang, "backend": "none", "skipped": True}

    # Step 1: Deep-Translator Google Translate
    translated = _try_google_translate_lang(normalized_input, target_lang=target_lang, source_lang=source_lang)
    if translated is not None:
        refined = refine_english_clinical_transcript(translated) if target_lang == "en" else translated
        return {"translated_text": refined, "target_language": target_lang, "backend": "google_translate", "skipped": False}

    # Step 2: Gemini 2.5 Flash Fallback
    translated = _try_gemini_translate_lang(normalized_input, target_lang=target_lang)
    if translated is not None:
        refined = refine_english_clinical_transcript(translated) if target_lang == "en" else translated
        return {"translated_text": refined, "target_language": target_lang, "backend": "gemini", "skipped": False}

    # Fallback to normalized input
    return {"translated_text": normalized_input, "target_language": target_lang, "backend": "none", "skipped": False}


def to_english(text: str, source_language: str | None = None) -> dict:
    """Returns {"english": <str>, "backend": <str>, "skipped": <bool>}.
    Normalizes Indic numbers and refines clinical metrics for maximum accuracy.
    """
    res = translate_text(text, target_lang="en", source_lang=source_language or "auto")
    return {
        "english": res["translated_text"],
        "backend": res["backend"],
        "skipped": res["skipped"],
    }

