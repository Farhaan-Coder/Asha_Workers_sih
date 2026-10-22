# Sukanya Backend

FastAPI + MongoDB backend for the Stitch-designed ASHA Sahyog Digital Assistant
frontend (`stitch_asha_sahyog_digital_assistant/`). Built to close the gaps
named in the SIH26_167 ("Error 404: Sleep Not Found") Round 2 judge feedback.

## Judge feedback -> what was built

| Feedback | What answers it |
|---|---|
| "Strengthen the ML layer... risk identification, prioritisation handled by the backend" | `risk_models.py` (SVM maternal-risk + XGBoost condition classifier, both trained from `patient_risk_colab_1.ipynb`) + `triage_rules.py` (clinical threshold rules). `alerts.score_and_alert()` runs all three on **every** `POST /api/records`, unconditionally. |
| "Reduce ASHA-worker dependency... automated decision-making" | The ASHA worker never marks a visit priority manually — `score_and_alert` flips `visit.priority` to `"priority"` itself when the score crosses a threshold. The home dashboard's existing "N High Priority Visits" counter reflects that automatically. `POST /api/records`'s response (`{id, assessment, alert_id}`) is rendered directly on the form as an "Automated Health Risk Assessment" panel right after saving (`shared/sakhi-record.js`'s `renderAssessmentPanel`) — the assessment was previously computed but never actually shown to the worker, only used internally to decide alerts. |
| "Add anomaly and health-hazard detection... automatically generate alerts" | `alerts` Mongo collection, auto-inserted by `score_and_alert`, surfaced on the home dashboard (`GET /api/alerts`) with zero ASHA input. |
| "Make it multilingual" | `i18n.py` + `locales/{en,hi,bn,ta,mr}.json`, applied client-side by `shared/sakhi-i18n.js` via `data-i18n` attributes. Covers nav/dashboard/auth/alerts/emergency/settings/common form labels — not yet every string on every screen (see Known Limitations). |
| "Make the platform two-sided... beneficiary direct access" | `beneficiary_login/` + `beneficiary_home/` pages, separate auth namespace (`/api/beneficiary/*`), beneficiaries see their own vitals/counseling/next-visit-date (not clinician-facing danger-sign detail). |
| "Give beneficiaries proactive updates... WhatsApp/SMS" | `notifications.py` outbox pattern: every message is written to the `notifications` collection first, then handed to a pluggable provider (`ConsoleProvider` by default — zero credentials; `TwilioWhatsAppProvider` if `TWILIO_*` env vars are set). `GET /api/notifications` is the "sent messages" view. |
| "Allow beneficiaries to request help" | `POST /api/beneficiary/help-requests` + ASHA-side inbox rendered inline on the Settings page. |
| "Emergency workflow for ASHA workers" | Red "Emergency" button on the home dashboard sidebar -> `POST /api/emergency` -> urgent alert + notification to `SUKANYA_EMERGENCY_CONTACT`. |

## Setup

```bash
cd backend
python3.12 -m venv .venv        # 3.11/3.12 — xgboost==2.0.3 has no 3.13/3.14 wheels yet
source .venv/bin/activate
pip install -r requirements.txt

# MongoDB (local, no Atlas — see vectorstore.py for why)
brew tap mongodb/brew
brew install mongodb-community
brew services start mongodb/brew/mongodb-community

# Risk models — copy your two .joblib files here:
#   backend/models/risk/model_maternal_risk.joblib
#   backend/models/risk/model_condition.joblib

# Voice transcription (mlx-whisper, in requirements.txt on Apple Silicon) needs
# ffmpeg for anything that isn't already a 16kHz mono WAV:
brew install ffmpeg

# Optional — local LLM for grounded transcript Q&A (rag.py). Without this,
# /api/transcript/ask still works, just via the keyword-excerpt fallback.
brew install ollama
ollama serve &
ollama pull llama3.2:1b

uvicorn main:app --port 8000
```

Open `http://localhost:8000/` (redirects to the splash screen, or straight to
the dashboard if already logged in). Demo login: any mobile number, PIN is
returned directly in the response (no SMS gateway — same dev-grade auth
pattern the original Sakhi backend used).

**Only one process may hold port 8000.** If a stray FastAPI process from an
earlier run (or a different project) is still bound to it, the OS will route
requests to whichever process claimed the port, non-deterministically — you
can hit `/api/records` and get a 200 from this backend, then hit it again a
minute later and get a 404 from something else entirely, with nothing in
*this* server's logs to explain it. Check with `lsof -nP -iTCP:8000
-sTCP:LISTEN` before reporting a "random 404"; kill anything that isn't this
`uvicorn main:app` process.

Set `SUKANYA_MOCK=1` to skip real audio transcription and use a canned
transcript for `/api/process-audio` — every other layer (Mongo, scoring,
alerts, schema validation) runs unmodified. Useful for demoing on a machine
with no Whisper backend installed.

## Architecture

```
main.py            FastAPI app, all routes
db.py               MongoDB persistence — integer ids + epoch-seconds timestamps
                     (NOT ObjectId/ISODate — the frontend JS does Number(id) and
                     new Date(x*1000) everywhere; Mongo's native types break that)
risk_models.py      SVM maternal-risk + XGBoost condition classifiers
triage_rules.py     Deterministic ACOG/AHA/ADA/WHO threshold rules
alerts.py           Runs the above on every saved record, decides alert/no-alert
notifications.py    Outbox + pluggable provider (console default, Twilio optional)
extraction.py       Transcript -> structured NHM form (regex/keyword, not an LLM)
transcribe.py       Multi-engine audio transcription (adapted from MOM-generator)
diarization.py      Optional speaker diarization (torch/speechbrain — not installed by default)
rag.py              Grounded Q&A over one visit's transcript (adapted from
                     SwDC-kjsse/mom_generator_rag's chat-with-meeting RAG feature —
                     see its module docstring for why this is deliberately NOT
                     chunked/vector-retrieved the way that project's is)
vectorstore.py      Local embedding + brute-force cosine similarity search across
                     saved records (the "similar prior cases" retrieval case)
i18n.py             Multilingual string catalogs
configs/schemas/    NHM-aligned JSON schemas (ANC/PNC/delivery/child health/danger signs)
```

### Transcript Q&A (`rag.py`)

`POST /api/transcript/ask {transcript, question}` and `POST
/api/records/{id}/ask {question}` — "ask a question about this visit,"
answered strictly from that visit's own transcript (never from other
records). Wired into the frontend's transcript panel (`shared/sakhi-record.js`
`showTranscriptPanel`) — it appears both right after Voice Studio extraction
and when loading a stored record.

Provider order: local Ollama -> Gemini -> OpenAI -> keyword-excerpt fallback
(no LLM). To enable the local path: `brew install ollama && ollama serve &&
ollama pull llama3.2:1b`. See `rag.py`'s docstring for an observed
hallucination caveat with 1-2B local models on degenerate input — use a
larger model or a cloud provider if that matters for your deployment.

This is intentionally *not* the chunk-into-a-vector-DB-and-retrieve design
the source RAG project uses — that solves a problem (multi-hour meeting
transcripts) this domain doesn't have (one home-visit conversation, a few
hundred to a couple thousand characters). Cross-visit retrieval — "find a
similar prior case" — is the one place this domain does need vector search,
and that's what `vectorstore.py` + `GET /api/search` already do, backed by
MongoDB rather than a second vector store.

### AI visit summary (`visit_summary.py`)

`POST /api/transcript/summarize {transcript}` and `POST
/api/records/{id}/summarize` — adapted from the plain (non-RAG)
`Ishant5436/MOM-generator` repo's `mom_generator.py`, which turns a meeting
transcript into structured minutes via one LLM call. Reframed here for a
clinical visit: the model returns `{summary, symptoms_identified,
advice_given, model}` instead of meeting attendees/decisions/action-items.

Wired into the transcript panel as a "Generate" button under "AI Visit
Summary," explicitly labeled as a second, AI-generated read — additive to
`extraction.py`'s deterministic form filling, never a replacement for it.
Same provider order as `rag.py` (Ollama -> Gemini -> OpenAI); if none is
configured, it falls back to reusing `extraction.py`'s own keyword-detected
symptoms/counseling rather than fabricating a summary with no LLM behind it.

Verified against `llama3.2:1b` locally: the first prompt draft returned an
empty `symptoms_identified` array on every test (the model correctly wrote
a summary mentioning the symptoms but didn't populate the structured field)
— fixed by adding a concrete example to the system prompt showing the
expected translation and list format. After that fix it correctly extracted
2 of 3 symptoms on the preeclampsia sample and both symptoms on the newborn
sample. Small (1-2B) local models need this kind of explicit-example prompt
engineering more than larger models do; worth keeping in mind if the prompt
is changed later.

## Known limitations (honest scope notes)

- **Extraction is deterministic, not an LLM.** `extraction.py` fills forms via
  regex/keyword matching against the transcript — reliable and zero-dependency,
  but it will miss phrasing the keyword lists don't cover. The three curated
  Hindi transcripts already in `shared/sakhi-record.js`'s demo tab, plus
  standard `NNN/NNN` BP notation, are well covered. An optional Ollama
  refinement pass exists (`extraction.enhance_with_ollama`) but is not required.
  Its danger-sign/symptom keyword lists (`_DANGER_RULES` in extraction.py) are
  Hindi + English only. `/api/process-audio` and `/api/process-text` now
  translate any non-English transcript to English (`translate_util.py`,
  Google Translate primary / Gemini text-translation fallback) before
  extraction runs, so Marathi and Bengali visits get the same keyword
  coverage as English/Hindi ones without needing four more copies of every
  clinical keyword pattern — but a number **spoken as fully-verbalized words**
  ("one hundred sixty-eight") rather than digits ("168") still won't be
  extracted in any language: `_BP_RE`/`_TEMP_RE`/etc. only match digit
  sequences (`\d`, which does cover Devanagari numerals ०-९, just not
  spelled-out number words). Real ASHA workers reading a BP cuff/thermometer
  digital display overwhelmingly say the digits, not the fully-spelled words,
  so this mostly shows up with synthesized/TTS test audio rather than real
  speech — but it's a real gap, not a guess.
- **Transcription auto-detects language; a real bug in the previous version
  forced everything through Hindi decoding.** `transcribe()` used to default
  to `language="hi"` end-to-end (backend default and two hardcoded frontend
  call sites). Whisper doesn't treat a wrong `language` as "translate this" —
  it decodes the audio as if every sound belongs to that language's phonology,
  so English or regional-language audio came out as fully-formed but
  meaningless Hindi text with no error to indicate anything was wrong (verified:
  an English clip about a patient's BP became Hindi word-salad under
  `language="hi"`; the identical clip auto-detected correctly as English and
  transcribed perfectly). Fixed by defaulting to `language=None`/`"auto"`
  everywhere. One remaining honest limitation: genuine intra-sentence
  code-switching (Hindi and English mixed within the same utterance, common
  in real ASHA-patient conversations) is still hard for Whisper's single-
  detected-language-per-clip approach — this fix solves "wrong language
  entirely," not "two languages in one sentence," which is an open problem
  industry-wide, not something specific to this integration.
- **Multilingual coverage is the highest-traffic strings, not exhaustive.**
  Extending it is adding a `data-i18n` attribute + a key in five JSON files,
  not new plumbing.
- **PNC/delivery/child_health vitals aren't wired to the ML models.** Both
  joblib models were trained on ANC-shaped vitals (BP/HR/SpO2/temp/glucose).
  `alerts.score_record` only calls them for `visit_type == "anc_visit"`;
  `triage_rules.assess_vitals` (which tolerates partial input) still runs for
  every visit type where vitals exist.
- **Real WhatsApp/SMS requires Twilio credentials the demo doesn't ship with.**
  The outbox pattern (write first, dispatch via provider) means the workflow
  is fully visible and testable without them; swapping in real credentials
  is an env-var change, not a code change.
- **Diarization needs `torch`+`speechbrain` installed separately** (large
  download, not forced on). Transcripts work fine without speaker labels.
- **Bengali transcription accuracy is unreliable on the local Whisper models
  installed here.** Tested against synthesized Bengali speech (macOS `say -v
  Piya`) on both `mlx-community/whisper-turbo` and `whisper-medium-mlx`: both
  produced garbled, wrong-script hallucinated output (turbo rendered
  Gujarati-looking text, medium rendered Telugu-looking text) rather than
  Bengali. Hindi and English transcribe reliably on the same setup. This may
  be specific to the synthetic TTS voice rather than real speech — it was not
  verified against an actual Bengali speaker — but treat Bengali audio input
  as lower-confidence until checked against real recordings. The Gemini
  fallback (below) is the most promising path to test next, since it wasn't
  actually reachable during this investigation.
- **Gemini fallback (audio transcription AND text translation) requires a
  valid `GEMINI_API_KEY` in `backend/.env` — it does not have one right now.**
  Two separate problems, both found and fixed/flagged this session: (1)
  `google-genai` was listed commented-out in `requirements.txt` and never
  installed, so `_try_gemini_audio()`'s `from google import genai` raised
  `ImportError` on every call, silently falling through — now installed. (2)
  The `GEMINI_API_KEY` value that was available in the shell environment is
  **rejected by Google as a leaked key** (`403 PERMISSION_DENIED: Your API key
  was reported as leaked`) — it cannot be used at all, and has been removed
  from `backend/.env` rather than left in place. Generate a fresh key at
  https://aistudio.google.com/app/apikey and put it in `backend/.env`
  (`GEMINI_API_KEY=...`, gitignored) for the Gemini fallback to actually
  activate — until then, the app runs fine on Whisper + Google Translate
  alone (both confirmed working), it just has no fallback if those fail.
