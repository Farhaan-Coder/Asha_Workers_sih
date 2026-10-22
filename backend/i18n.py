"""
Multilingual string catalogs — response to the SIH round-2 feedback:
"Make it multilingual: support multiple regional languages so that the
application is accessible to both ASHA workers and beneficiaries across
different regions."

Deliberately a simple JSON-catalog + client-side key-swap design (see
shared/sakhi-i18n.js), not a translation service call per page load — this
needs to work fully offline on a shared health-center workstation. Coverage
is the highest-traffic strings (nav, dashboard, auth, alerts, emergency,
settings, common form labels) across five languages, not every string on
every screen; extending coverage is adding keys to these five files, not
architecture work — see README for the honest scope note.

Languages: English, Hindi, Bengali, Tamil, Marathi — chosen as a spread of
script families (Devanagari x2 with different languages, Bengali, Tamil)
plus English, to demonstrate the mechanism generalizes rather than being
Hindi-only.
"""
import json
import os

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
_LOCALES_DIR = os.path.join(_THIS_DIR, "locales")

SUPPORTED_LANGUAGES = ["en", "hi", "bn", "ta", "mr"]

_cache = {}


def get_catalog(lang: str) -> dict:
    lang = lang if lang in SUPPORTED_LANGUAGES else "en"
    if lang not in _cache:
        path = os.path.join(_LOCALES_DIR, f"{lang}.json")
        with open(path, encoding="utf-8") as f:
            _cache[lang] = json.load(f)
    # Fill any key missing in this language with the English string, so a
    # partially-translated catalog never renders a blank label.
    if lang != "en":
        en = get_catalog("en")
        merged = dict(en)
        merged.update(_cache[lang])
        return merged
    return _cache[lang]
