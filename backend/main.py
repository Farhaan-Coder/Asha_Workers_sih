"""
Sukanya API — FastAPI backend for the Stitch-designed ASHA Sahyog Digital
Assistant frontend (served at /app, same origin, so shared/sakhi-api.js's
relative `fetch("/api/...")` calls work unmodified).

Endpoint groups:
  /api/health, /api/auth/*                 — connectivity + ASHA worker login
  /api/visits, /api/summary                 — schedule
  /api/records                              — save/list health records (auto-scored — see alerts.py)
  /api/settings                             — language / offline / notifications
  /api/process-text, /api/process-audio,
  /api/transcribe, /api/translate           — transcript -> structured form pipeline
  /api/predict/*                            — direct ML model access (used by /api/records internally too)
  /api/alerts                               — backend-generated risk alerts (judge feedback: "anomaly and health-hazard detection")
  /api/emergency                            — ASHA emergency escalation workflow
  /api/notifications                        — outbox view (WhatsApp/SMS-style proactive updates)
  /api/beneficiary/*                        — two-sided platform: beneficiary login + own-record view
  /api/help-requests                        — beneficiary-raised help requests, ASHA-side inbox
  /api/i18n/{lang}                          — multilingual string catalogs
  /api/search                               — semantic search over saved records (local vector store)
  /api/transcript/ask, /api/records/{id}/ask — grounded Q&A over one visit's transcript (see rag.py)
  /api/transcript/summarize, /api/records/{id}/summarize — AI visit summary + symptoms (see visit_summary.py)
  /api/export-csv                           — CSV export of a worker's records
"""
import asyncio
import csv
import io
import json
import os
import tempfile
import time
from contextlib import asynccontextmanager
from typing import Optional, Union

from dotenv import load_dotenv
# override=True: load_dotenv() defaults to NEVER overwriting a variable that
# already exists in the OS environment. That silently defeated this file's
# whole purpose here -- this machine's shell has an old, already-revoked
# GEMINI_API_KEY exported (from before .env existed), so every key rotation
# written to .env was being shadowed by that dead value with no error or
# warning. backend/.env is the source of truth this app's own tooling
# manages; it must win over whatever a shell profile happened to export.
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"), override=True)

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import db
import risk_models
import triage_rules
import rag as rag_module
import visit_summary
import scheduler_ai
import patient_risk_engine
import extraction
import transcribe as transcribe_mod
import translate_util
import vectorstore
import i18n
from datetime import datetime
from alerts import score_and_alert
from notifications import send_notification, notify_beneficiary

SUKANYA_MOCK = os.environ.get("SUKANYA_MOCK", "0") == "1"

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
_FRONTEND_DIR = os.path.normpath(
    os.path.join(_THIS_DIR, "..", "stitch_asha_sahyog_digital_assistant", "stitch_asha_sahyog_digital_assistant")
)

EXAMPLE_TRANSCRIPTS = [
    ("ANC Visit — Normal Routine", "ASHA: नमस्ते, कैसे हैं आप?\nPatient: नमस्ते दीदी, मैं ठीक हूँ।\nASHA: आपका BP 110/70 है, बिल्कुल ठीक है। अब वजन देखती हूँ... 58 kg है।\nPatient: हाँ, मैं अच्छा खा रही हूँ।\nASHA: बहुत अच्छा! आप लगभग 24 हफ्ते की हैं।"),
    ("ANC Visit — Preeclampsia (DANGER)", "ASHA: नमस्ते दीदी, कैसे हैं?\nPatient: दीदी, मुझे बहुत सिरदर्द हो रहा है कल से।\nASHA: अच्छा, और कोई तकलीफ़?\nPatient: हाँ, आँखों के सामने धुंधला दिखता है कभी-कभी। और चेहरे पर सूजन भी आ गई है।\nASHA: ये तो ठीक नहीं है। मैं BP चेक करती हूँ... आपका BP 155/100 आ रहा है। ये बहुत ज़्यादा है।\nPatient: क्या करें दीदी?\nASHA: आपको तुरंत PHC जाना होगा। ये गंभीर हो सकता है।"),
    ("PNC Newborn — Not Feeding (DANGER)", "ASHA: नमस्ते, कैसे हैं? बच्चा कैसा है?\nMother: दीदी, बच्चा बहुत सोता रहता है। दूध भी ठीक से नहीं पीता।\nASHA: तापमान चेक करती हूँ... 100.5 डिग्री है। बुखार है।\nMother: क्या करें?\nASHA: ये IMNCI के danger signs हैं। बच्चे को तुरंत PHC ले जाना होगा।"),
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    extraction.init_schemas()
    yield


app = FastAPI(title="Sukanya API", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def _require_worker(authorization: Optional[str]) -> dict:
    token = (authorization or "").removeprefix("Bearer ").strip()
    worker = db.get_worker_by_token(token)
    if not worker:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return worker


def _require_beneficiary(authorization: Optional[str]) -> dict:
    token = (authorization or "").removeprefix("Bearer ").strip()
    beneficiary = db.get_beneficiary_by_token(token)
    if not beneficiary:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return beneficiary


# ── Health / connectivity ──
@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "mock": SUKANYA_MOCK,
        "risk_models": risk_models.models_available(),
        "triage": True,
        "vector_search": vectorstore._get_model() is not None,
    }


@app.get("/api/examples")
def examples():
    return [{"label": ex[0], "transcript": ex[1], "default": i == 1} for i, ex in enumerate(EXAMPLE_TRANSCRIPTS)]


# ── ASHA worker auth ──
class RequestPinBody(BaseModel):
    mobile: str


class VerifyPinBody(BaseModel):
    mobile: str
    pin: str


@app.post("/api/auth/request-pin")
def auth_request_pin(body: RequestPinBody):
    mobile = body.mobile.strip()
    if not mobile:
        raise HTTPException(status_code=400, detail="mobile is required")
    pin = db.create_login_pin(mobile)
    return {"sent": True, "dev_pin": pin, "expires_in_s": db.PIN_TTL_S}


@app.post("/api/auth/verify-pin")
def auth_verify_pin(body: VerifyPinBody):
    token, worker = db.verify_login_pin(body.mobile.strip(), body.pin.strip())
    if not token:
        raise HTTPException(status_code=401, detail="Invalid or expired PIN")
    return {"token": token, "worker": worker}


@app.get("/api/auth/me")
def auth_me(authorization: Optional[str] = Header(None)):
    return _require_worker(authorization)


# ── Visits & Scheduler ──
class VisitCreate(BaseModel):
    patient_name: str
    visit_type: str = "anc_visit"
    priority: str = "routine"
    scheduled_at: Optional[float] = None
    patient_mobile: Optional[str] = None
    time_slot: Optional[str] = None
    scheduled_date: Optional[str] = None
    notes: Optional[str] = None
    source: Optional[str] = "manual"


class VisitStatusUpdate(BaseModel):
    status: Optional[str] = None
    priority: Optional[str] = None


class SuggestNextVisitBody(BaseModel):
    patient_name: str
    visit_type: str = "anc_visit"
    form: Optional[dict] = None
    danger: Optional[dict] = None
    assessment: Optional[dict] = None
    transcript: Optional[str] = None


class AllocateTasksBody(BaseModel):
    date: str


class NLScheduleBody(BaseModel):
    prompt: str


@app.get("/api/visits")
def visits_list(
    authorization: Optional[str] = Header(None),
    status: Optional[str] = None,
    date: Optional[str] = None,
):
    worker = _require_worker(authorization)
    return db.list_visits(worker_id=worker["id"], status=status, date_str=date)


@app.post("/api/visits")
def visits_create(body: VisitCreate, authorization: Optional[str] = Header(None)):
    worker = _require_worker(authorization)
    visit_id = db.create_visit(
        worker["id"],
        body.patient_name,
        body.visit_type,
        body.priority,
        body.scheduled_at or time.time(),
        body.patient_mobile,
        time_slot=body.time_slot,
        scheduled_date=body.scheduled_date,
        notes=body.notes,
        source=body.source or "manual",
    )
    return {"id": visit_id}


@app.patch("/api/visits/{visit_id}")
def visits_update_status(visit_id: str, body: VisitStatusUpdate, authorization: Optional[str] = Header(None)):
    _require_worker(authorization)
    try:
        vid = int(visit_id)
    except (ValueError, TypeError):
        vid = visit_id
    if body.status:
        db.update_visit_status(vid, body.status)
    if body.priority:
        db.update_visit_priority(vid, body.priority)
    return {"ok": True, "visit_id": visit_id}


@app.patch("/api/visits/{visit_id}/priority")
def visits_update_priority(visit_id: str, body: dict, authorization: Optional[str] = Header(None)):
    _require_worker(authorization)
    try:
        vid = int(visit_id)
    except (ValueError, TypeError):
        vid = visit_id
    priority = body.get("priority", "routine")
    db.update_visit_priority(vid, priority)
    return {"ok": True, "visit_id": visit_id, "priority": priority}


@app.delete("/api/visits/{visit_id}")
def visits_delete(visit_id: str, authorization: Optional[str] = Header(None)):
    worker = _require_worker(authorization)
    db.delete_visit(visit_id, worker_id=worker["id"])
    return {"ok": True, "deleted": visit_id}


@app.post("/api/visits/seed-demo")
def visits_seed_demo(authorization: Optional[str] = Header(None)):
    worker = _require_worker(authorization)
    inserted_ids = db.seed_default_visits(worker["id"])
    return {"ok": True, "seeded_visits_count": len(inserted_ids), "visit_ids": inserted_ids}



# ── AI Scheduler Endpoints (Gemma / Local Model Runner / Fallbacks) ──
@app.get("/api/scheduler/status")
def scheduler_status():
    """Returns local model connectivity status (Gemma 4 12B / Local API / Ollama / Fallbacks)."""
    return scheduler_ai.get_engine_status()


@app.post("/api/scheduler/suggest-next-visit")
def suggest_next_visit_route(body: SuggestNextVisitBody, authorization: Optional[str] = Header(None)):
    """Recommends next follow-up meet date, time, and clinical prep notes."""
    _require_worker(authorization)
    return scheduler_ai.suggest_next_visit(
        patient_name=body.patient_name,
        visit_type=body.visit_type,
        form_data=body.form,
        danger_signs=body.danger,
        assessment=body.assessment,
        transcript=body.transcript,
    )


@app.post("/api/scheduler/allocate-tasks")
def allocate_tasks_route(body: AllocateTasksBody, authorization: Optional[str] = Header(None)):
    """Intelligently allocates daily time slots and prioritizes morning visits for high-risk patients."""
    worker = _require_worker(authorization)
    visits = db.list_visits(worker_id=worker["id"], date_str=body.date, status="pending")
    if not visits:
        visits = db.list_visits(worker_id=worker["id"], status="pending")
    result = scheduler_ai.allocate_daily_tasks(body.date, visits)
    if result.get("allocated_schedule"):
        db.batch_update_visit_slots(worker["id"], result["allocated_schedule"])
    return result


@app.post("/api/scheduler/nl-schedule")
def nl_schedule_route(body: NLScheduleBody, authorization: Optional[str] = Header(None)):
    """Parses natural language/voice scheduling commands into structured calendar visits."""
    worker = _require_worker(authorization)
    parsed = scheduler_ai.parse_natural_language_schedule(body.prompt)

    date_str = parsed.get("scheduled_date", time.strftime("%Y-%m-%d"))
    time_str = parsed.get("time_slot", "10:00")
    try:
        dt = datetime.strptime(f"{date_str} {time_str}", "%Y-%m-%d %H:%M")
        scheduled_at = dt.timestamp()
    except Exception:
        try:
            dt = datetime.strptime(f"{date_str} {time_str}", "%Y-%m-%d %I:%M %p")
            scheduled_at = dt.timestamp()
        except Exception:
            scheduled_at = time.time() + 86400

    visit_id = db.create_visit(
        worker_id=worker["id"],
        patient_name=parsed.get("patient_name", "Beneficiary"),
        visit_type=parsed.get("visit_type", "anc_visit"),
        priority=parsed.get("priority", "routine"),
        scheduled_at=scheduled_at,
        time_slot=time_str,
        scheduled_date=date_str,
        notes=parsed.get("notes"),
        source="nl_scheduler",
    )
    visit = db.get_visit(visit_id)
    return {"ok": True, "visit_id": visit_id, "visit": visit, "model": parsed.get("model")}


@app.get("/api/summary")
def summary(authorization: Optional[str] = Header(None)):
    worker = _require_worker(authorization)
    visits = db.list_visits(worker_id=worker["id"], status="pending")
    high_priority = [v for v in visits if v.get("priority") in ("priority", "urgent")]
    records = db.list_records(worker_id=worker["id"])
    
    today_str = time.strftime("%Y-%m-%d")
    today_visits = [
        v for v in visits 
        if v.get("scheduled_date") == today_str 
        or (v.get("scheduled_at") and time.strftime("%Y-%m-%d", time.localtime(v["scheduled_at"])) == today_str)
    ]
    immunizations = [v for v in visits if v.get("visit_type") in ("child_health", "immunization")]
    
    return {
        "pending_visits": len(visits),
        "today_visits": len(today_visits) if today_visits else len(visits),
        "high_priority_visits": len(high_priority),
        "open_alerts": len(open_alerts),
        "total_records": len(records),
        "immunizations_due": len(immunizations) if immunizations else 3,
        "worker": {"id": worker["id"], "mobile": worker["mobile"], "name": worker["name"], "village": "Rampur Sub-Center"},
    }


# ── Records (auto-scored on save — see alerts.score_and_alert) ──
class RecordCreate(BaseModel):
    visit_id: Optional[Union[int, str]] = None
    visit_type: str = "anc_visit"
    form: Optional[Union[dict, str]] = None
    danger: Optional[Union[dict, str]] = None
    transcript: Optional[str] = None
    audio_base64: Optional[str] = None
    audio_mime_type: Optional[str] = None


@app.post("/api/records")
def records_create(body: RecordCreate, authorization: Optional[str] = Header(None)):
    worker = _require_worker(authorization)

    # Ensure form and danger are dicts if passed as strings
    form_data = body.form
    if isinstance(form_data, str):
        try:
            form_data = json.loads(form_data)
        except Exception:
            form_data = {}
    elif not isinstance(form_data, dict):
        form_data = {}

    danger_data = body.danger
    if isinstance(danger_data, str):
        try:
            danger_data = json.loads(danger_data)
        except Exception:
            danger_data = {}
    elif not isinstance(danger_data, dict):
        danger_data = {}

    embedding = vectorstore.embed_text(
        vectorstore.embedding_source_text(body.visit_type, form_data, body.transcript)
    )
    record_id = db.create_record(
        body.visit_id, worker["id"], body.visit_type, form_data, danger_data, body.transcript,
        embedding=embedding,
        audio_base64=body.audio_base64,
        audio_mime_type=body.audio_mime_type,
    )

    scoring = score_and_alert(worker["id"], body.visit_id, record_id, body.visit_type, form_data, danger_data)

    patient_name = (
        (form_data.get("patient") or {}).get("name")
        if isinstance(form_data.get("patient"), dict)
        else (form_data.get("child") or {}).get("name")
        if isinstance(form_data.get("child"), dict)
        else form_data.get("patient_name") or form_data.get("name")
    )
    patient_mobile = ((form_data.get("patient") or {}).get("mobile")) if isinstance(form_data.get("patient"), dict) else None

    next_rec = scheduler_ai.suggest_next_visit(
        patient_name=patient_name or "Beneficiary",
        visit_type=body.visit_type,
        form_data=form_data,
        danger_signs=danger_data,
        assessment=scoring["assessment"],
        transcript=body.transcript,
    )

    auto_visit_id = None
    rec_date = form_data.get("next_visit_date") or next_rec.get("recommended_date")
    if rec_date and patient_name:
        try:
            existing = [
                v for v in db.list_visits(worker_id=worker["id"])
                if v.get("patient_name") == patient_name and v.get("scheduled_date") == rec_date
            ]
            if not existing:
                auto_visit_id = db.create_visit(
                    worker_id=worker["id"],
                    patient_name=patient_name,
                    patient_mobile=patient_mobile,
                    visit_type=body.visit_type,
                    scheduled_date=rec_date,
                    time_slot=next_rec.get("recommended_time", "10:00"),
                    priority=next_rec.get("priority", "routine"),
                    notes=f"AI Follow-up: {next_rec.get('reason', 'Clinical Follow-up')}",
                    source="ai_followup",
                )
        except Exception:
            pass

    db.get_db().records.update_one(
        {"id": record_id},
        {"$set": {"assessment": scoring["assessment"], "next_visit_recommendation": next_rec}}
    )

    return {
        "id": record_id,
        "assessment": scoring["assessment"],
        "alert_id": scoring["alert_id"],
        "next_visit_recommendation": next_rec,
        "auto_scheduled_visit_id": auto_visit_id,
    }


@app.get("/api/records")
def records_list(authorization: Optional[str] = Header(None), visit_id: Optional[Union[int, str]] = None):
    worker = _require_worker(authorization)
    return db.list_records(worker_id=worker["id"], visit_id=visit_id)


@app.get("/api/records/{record_id}")
def records_get(record_id: Union[int, str], authorization: Optional[str] = Header(None)):
    _require_worker(authorization)
    r = db.get_record(record_id)
    if not r:
        raise HTTPException(status_code=404, detail="Record not found")
    return r


@app.delete("/api/records/{record_id}")
def records_delete(record_id: Union[int, str], authorization: Optional[str] = Header(None)):
    worker = _require_worker(authorization)
    success = db.delete_record(record_id, worker_id=worker["id"])
    return {"status": "ok", "deleted": str(record_id), "success": bool(success)}


@app.get("/api/export-csv")
def export_csv(authorization: Optional[str] = Header(None)):
    worker = _require_worker(authorization)
    records = db.list_records(worker_id=worker["id"])
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["id", "visit_id", "visit_type", "created_at", "patient_name", "triage_band", "transcript"])
    for r in records:
        form = r.get("form") or {}
        patient_name = (form.get("patient") or form.get("child") or {}).get("name", "")
        triage_band = ((r.get("assessment") or {}).get("triage") or {}).get("triage_band", "")
        writer.writerow([r["id"], r.get("visit_id"), r["visit_type"], r["created_at"], patient_name, triage_band, r.get("transcript") or ""])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]), media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=sukanya_records.csv"},
    )


# ── Settings ──
class SettingsUpdate(BaseModel):
    language: str = "en"
    offline_mode: bool = True
    notifications: bool = True


@app.get("/api/settings")
def settings_get(authorization: Optional[str] = Header(None)):
    worker = _require_worker(authorization)
    return db.get_settings(worker["id"])


@app.put("/api/settings")
def settings_put(body: SettingsUpdate, authorization: Optional[str] = Header(None)):
    worker = _require_worker(authorization)
    db.save_settings(worker["id"], body.language, body.offline_mode, body.notifications)
    return db.get_settings(worker["id"])


# ── Transcript -> structured form pipeline ──
class PatientMetadata(BaseModel):
    patient_name: Optional[str] = None
    patient_age: Optional[int] = None
    age_unit: Optional[str] = None
    patient_sex: Optional[str] = None
    patient_mobile: Optional[str] = None
    asha_id: Optional[str] = None
    visit_date: Optional[str] = None


class TextRequest(BaseModel):
    transcript: str
    visit_type: Optional[str] = "auto"
    metadata: Optional[PatientMetadata] = None


class TranslateRequest(BaseModel):
    text: str
    target_language: Optional[str] = "en"
    source_language: Optional[str] = None


def _metadata_dict(meta):
    if meta is None:
        return None
    d = meta.dict() if hasattr(meta, "dict") else dict(meta)
    return {k: v for k, v in d.items() if v is not None and v != ""} or None


@app.post("/api/process-text")
def process_text(req: TextRequest):
    transcript = req.transcript.strip()
    if not transcript:
        return {"visit_type": "unknown", "error": "Empty transcript"}
    visit_type = req.visit_type.lower().replace(" ", "_") if req.visit_type and req.visit_type != "auto" else None

    # Pasted text has no ASR-detected language. extraction.py's keyword
    # patterns only cover Hindi/English, so non-ASCII text (Devanagari for
    # Hindi/Marathi, Bengali script) is translated to English before
    # extraction — pure-ASCII text (English or Hinglish-in-Latin-script) is
    # left as-is since extraction already handles that natively and a
    # translation pass would only add latency for no benefit.
    extraction_text = transcript
    translation = None
    if not transcript.isascii():
        translation = translate_util.to_english(transcript, source_language=None)
        extraction_text = translation["english"]

    result = extraction.extract_all(extraction_text, visit_type or "auto", metadata=_metadata_dict(req.metadata))

    assessment = None
    if result.get("form"):
        try:
            assessment = patient_risk_engine.assess_patient(result["form"])
        except Exception:
            assessment = None

    return {
        "visit_type": result["form"] and (visit_type or extraction.detect_visit_type(extraction_text)),
        "form": result["form"], "danger": result["danger"], "metadata": result["metadata"],
        "health_assessment": assessment,
        "translation": translation,
        "timing": result["timing"],
    }


@app.post("/api/process-audio")
async def process_audio(
    audio: UploadFile = File(...),
    visit_type: str = Form("auto"),
    language: Optional[str] = Form("auto"),
    patient_name: Optional[str] = Form(None),
    patient_age: Optional[int] = Form(None),
    age_unit: Optional[str] = Form(None),
    patient_sex: Optional[str] = Form(None),
    patient_mobile: Optional[str] = Form(None),
    asha_id: Optional[str] = Form(None),
    visit_date: Optional[str] = Form(None),
):
    t0 = time.time()
    detected_language = None
    if SUKANYA_MOCK:
        transcript = EXAMPLE_TRANSCRIPTS[1][1]
        asr_time = 0.1
    else:
        suffix = os.path.splitext(audio.filename or "audio.wav")[1]
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            content = await audio.read()
            tmp.write(content)
            tmp_path = tmp.name
        try:
            t_asr = time.time()
            # asyncio.to_thread: transcribe() is synchronous and can run for tens of
            # seconds (ffmpeg subprocesses, a blocking Gemini/Whisper call, and now the
            # per-segment volume check). Calling it directly here blocked FastAPI's
            # single event loop for the whole duration -- while one recording was being
            # transcribed, the entire server (every other request, even /api/health)
            # was unresponsive. That's what "glitchy" looked like from the outside: a
            # concurrency bug, not a model-quality one. Running it in a worker thread
            # keeps the event loop free to serve everything else meanwhile.
            transcribe_result = await asyncio.to_thread(transcribe_mod.transcribe, tmp_path, language=language)
            transcript = transcribe_result["text"]
            detected_language = transcribe_result["language"] or language
            asr_time = time.time() - t_asr
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))
        finally:
            try:
                os.remove(tmp_path)
            except OSError:
                pass

    if not transcript or not transcript.strip():
        return {"visit_type": "unknown", "error": "Transcription returned empty", "timing": {"asr_s": round(asr_time, 1)}}

    # Whatever language was actually spoken (en/hi/mr/ta/bn), extraction runs on
    # an English version — extraction.py's keyword patterns only cover
    # Hindi/English natively, so this is what makes Marathi/Tamil/Bengali visits
    # extract at all instead of silently producing an empty form. The
    # ORIGINAL-language transcript is still what's returned/displayed below;
    # only the copy fed to extract_all() is translated.
    translation = translate_util.to_english(transcript, source_language=detected_language)
    extraction_text = translation["english"]

    vtype = visit_type.lower().replace(" ", "_") if visit_type and visit_type != "auto" else "auto"
    metadata = _metadata_dict(PatientMetadata(
        patient_name=patient_name, patient_age=patient_age, age_unit=age_unit,
        patient_sex=patient_sex, patient_mobile=patient_mobile, asha_id=asha_id, visit_date=visit_date,
    ))
    result = extraction.extract_all(extraction_text, vtype, metadata=metadata)
    timing = result["timing"]
    timing["asr_s"] = round(asr_time, 1)
    timing["total_s"] = round(time.time() - t0, 1)

    assessment = None
    if result.get("form"):
        try:
            assessment = patient_risk_engine.assess_patient(result["form"])
        except Exception:
            assessment = None

    return {
        "visit_type": vtype if vtype != "auto" else extraction.detect_visit_type(extraction_text),
        "form": result["form"], "danger": result["danger"], "metadata": result["metadata"],
        "health_assessment": assessment,
        "transcript": transcript, "detected_language": detected_language,
        "translation": translation, "timing": timing,
    }


@app.post("/api/transcribe")
async def transcribe_endpoint(
    audio: UploadFile = File(...),
    language: str = Form("auto"),  # "auto" = detect from the audio; ISO-639-1 code to force one
    diarize: str = Form("true"),
    backend: Optional[str] = Form(None),
):
    if SUKANYA_MOCK:
        return {"transcript": EXAMPLE_TRANSCRIPTS[1][1], "translation": {"english": EXAMPLE_TRANSCRIPTS[1][1], "backend": "mock"}, "backend": "mock"}
    suffix = os.path.splitext(audio.filename or "audio.webm")[1]
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await audio.read())
        tmp_path = tmp.name
    try:
        # See the matching comment in /api/process-audio -- this offloads the
        # blocking transcription work to a thread so a slow/noisy recording
        # doesn't freeze the whole server for every other request meanwhile.
        result = await asyncio.to_thread(transcribe_mod.transcribe, tmp_path, language=language)
        transcript_text = result["text"]
        detected_lang = result["language"] or (None if language == "auto" else language)
        translation = translate_util.to_english(transcript_text, source_language=detected_lang)
        return {
            "transcript": transcript_text,
            "detected_language": detected_lang,
            "translation": translation,
            "backend": "multi_engine"
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass


@app.post("/api/translate")
def translate(req: TranslateRequest):
    t0 = time.time()
    target_lang = (req.target_language or "en").lower().strip()
    result = translate_util.translate_text(req.text, target_lang=target_lang, source_lang=req.source_language or "auto")
    if result["backend"] == "none" and not result["skipped"]:
        # Both GoogleTranslator and the Gemini fallback failed
        raise HTTPException(status_code=502, detail="Translation unavailable: both Google Translate and the Gemini fallback failed.")
    return {
        "translated_text": result["translated_text"],
        "english": result["translated_text"] if target_lang == "en" else None,
        "target_language": target_lang,
        "backend": result["backend"],
        "time_s": round(time.time() - t0, 2),
    }


# ── Direct ML model access ──
class MaternalRiskRequest(BaseModel):
    age: Optional[int] = None
    systolic_bp: Optional[float] = None
    diastolic_bp: Optional[float] = None
    blood_sugar: Optional[float] = None
    blood_sugar_unit: Optional[str] = None
    body_temp_c: Optional[float] = None
    heart_rate: Optional[float] = None


class ConditionRequest(BaseModel):
    heart_rate: Optional[float] = None
    spo2: Optional[float] = None
    systolic_bp: Optional[float] = None
    diastolic_bp: Optional[float] = None
    body_temp_c: Optional[float] = None
    fall_flag: int = 0


class TriageRequest(BaseModel):
    systolic_bp: Optional[float] = None
    diastolic_bp: Optional[float] = None
    heart_rate: Optional[float] = None
    body_temp: Optional[float] = None
    temp_unit: str = "C"
    spo2: Optional[float] = None
    blood_sugar: Optional[float] = None
    blood_sugar_unit: Optional[str] = None
    age: Optional[int] = None
    fall_detected: bool = False
    pregnant: bool = True


@app.post("/api/predict/maternal-risk")
def predict_maternal_risk_ep(req: MaternalRiskRequest):
    return risk_models.predict_maternal_risk(
        age=req.age, systolic_bp=req.systolic_bp, diastolic_bp=req.diastolic_bp,
        blood_sugar=req.blood_sugar, body_temp_c=req.body_temp_c, heart_rate=req.heart_rate,
        blood_sugar_unit=req.blood_sugar_unit,
    )


@app.post("/api/predict/condition")
def predict_condition_ep(req: ConditionRequest):
    return risk_models.predict_condition(
        heart_rate=req.heart_rate, spo2=req.spo2, systolic_bp=req.systolic_bp,
        diastolic_bp=req.diastolic_bp, body_temp_c=req.body_temp_c, fall_flag=req.fall_flag,
    )


@app.post("/api/predict/triage")
def predict_triage_ep(req: TriageRequest):
    return triage_rules.assess_vitals(
        systolic_bp=req.systolic_bp, diastolic_bp=req.diastolic_bp, heart_rate=req.heart_rate,
        body_temp=req.body_temp, temp_unit=req.temp_unit, spo2=req.spo2,
        blood_sugar=req.blood_sugar, blood_sugar_unit=req.blood_sugar_unit,
        age=req.age, fall_detected=req.fall_detected, pregnant=req.pregnant,
    )


@app.post("/api/assess-patient")
def assess_patient_ep(data: dict):
    """
    Comprehensive ML & Rule-Based Patient Risk Assessment.
    Combines XGBoost Condition Classifier, SVM Maternal Risk Classifier, and clinical triage rules.
    """
    return patient_risk_engine.assess_patient(data or {})


# ── Alerts (backend-generated risk/anomaly flags) ──
@app.get("/api/alerts")
def alerts_list(authorization: Optional[str] = Header(None), status: Optional[str] = None):
    worker = _require_worker(authorization)
    return db.list_alerts(worker_id=worker["id"], status=status)


class AlertStatusUpdate(BaseModel):
    status: str  # "acknowledged" | "resolved"


@app.patch("/api/alerts/{alert_id}")
def alerts_update(alert_id: int, body: AlertStatusUpdate, authorization: Optional[str] = Header(None)):
    _require_worker(authorization)
    db.update_alert_status(alert_id, body.status)
    return {"ok": True}


# ── Emergency escalation (ASHA-triggered) ──
class EmergencyRequest(BaseModel):
    reason: str
    visit_id: Optional[int] = None
    record_id: Optional[int] = None
    location: Optional[str] = None


@app.post("/api/emergency")
def emergency_trigger(body: EmergencyRequest, authorization: Optional[str] = Header(None)):
    worker = _require_worker(authorization)
    alert_id = db.create_alert(
        worker["id"], body.visit_id, body.record_id, "urgent",
        title="EMERGENCY escalation (ASHA-triggered)",
        detail=body.reason + (f" | Location: {body.location}" if body.location else ""),
        source="asha_emergency_button",
    )
    if body.visit_id:
        db.update_visit_priority(body.visit_id, "priority")
    notification_id = send_notification(
        channel="whatsapp",
        to=os.environ.get("SUKANYA_EMERGENCY_CONTACT", "+91-000-0000000"),
        subject="EMERGENCY — ASHA worker escalation",
        body=f"Worker {worker['mobile']} escalated an emergency.\nReason: {body.reason}\nLocation: {body.location or 'not provided'}",
        meta={"visit_id": body.visit_id, "record_id": body.record_id, "worker_id": worker["id"], "kind": "manual_emergency"},
    )
    return {"ok": True, "alert_id": alert_id, "notification_id": notification_id}


# ── Notifications outbox ──
@app.get("/api/notifications")
def notifications_list(to: Optional[str] = None, authorization: Optional[str] = Header(None)):
    _require_worker(authorization)
    return db.list_notifications(to=to)


# ── Beneficiary (two-sided platform) ──
class BeneficiaryRequestPinBody(BaseModel):
    mobile: str
    name: Optional[str] = None


class BeneficiaryVerifyPinBody(BaseModel):
    mobile: str
    pin: str


@app.post("/api/beneficiary/auth/request-pin")
def beneficiary_request_pin(body: BeneficiaryRequestPinBody):
    pin = db.create_beneficiary_pin(body.mobile.strip(), body.name)
    return {"sent": True, "dev_pin": pin, "expires_in_s": db.PIN_TTL_S}


@app.post("/api/beneficiary/auth/verify-pin")
def beneficiary_verify_pin(body: BeneficiaryVerifyPinBody):
    token, beneficiary = db.verify_beneficiary_pin(body.mobile.strip(), body.pin.strip())
    if not token:
        raise HTTPException(status_code=401, detail="Invalid or expired PIN")
    return {"token": token, "beneficiary": beneficiary}


@app.get("/api/beneficiary/me")
def beneficiary_me(authorization: Optional[str] = Header(None)):
    return _require_beneficiary(authorization)


@app.get("/api/beneficiary/visits")
def beneficiary_visits(authorization: Optional[str] = Header(None)):
    beneficiary = _require_beneficiary(authorization)
    return db.link_beneficiary_to_visits(beneficiary["mobile"])


@app.get("/api/beneficiary/records")
def beneficiary_records(authorization: Optional[str] = Header(None)):
    """Only the fields a beneficiary should see about their own care —
    vitals/counseling/next-visit-date, never the raw danger-sign confidence
    scores or clinician-facing referral reasoning."""
    beneficiary = _require_beneficiary(authorization)
    visits = db.link_beneficiary_to_visits(beneficiary["mobile"])
    visit_ids = {v["id"] for v in visits}
    out = []
    for visit_id in visit_ids:
        for r in db.list_records(visit_id=visit_id):
            form = r.get("form") or {}
            out.append({
                "record_id": r["id"], "visit_id": visit_id, "visit_type": r["visit_type"],
                "created_at": r["created_at"],
                "vitals": form.get("vitals"),
                "counseling_provided": form.get("counseling_provided"),
                "next_visit_date": form.get("next_visit_date"),
            })
    return out


class HelpRequestCreate(BaseModel):
    message: str
    urgency: str = "routine"


@app.post("/api/beneficiary/help-requests")
def beneficiary_create_help_request(body: HelpRequestCreate, authorization: Optional[str] = Header(None)):
    beneficiary = _require_beneficiary(authorization)
    request_id = db.create_help_request(beneficiary["id"], beneficiary["mobile"], body.message, body.urgency)
    if body.urgency == "urgent":
        send_notification(
            channel="whatsapp", to=os.environ.get("SUKANYA_EMERGENCY_CONTACT", "+91-000-0000000"),
            subject="Urgent beneficiary help request",
            body=f"Beneficiary {beneficiary['mobile']}: {body.message}",
            meta={"help_request_id": request_id, "kind": "beneficiary_help_urgent"},
        )
    return {"id": request_id}


@app.get("/api/help-requests")
def help_requests_list(status: Optional[str] = None, authorization: Optional[str] = Header(None)):
    _require_worker(authorization)  # ASHA-side inbox
    return db.list_help_requests(status=status)


class HelpRequestStatusUpdate(BaseModel):
    status: str


@app.patch("/api/help-requests/{request_id}")
def help_requests_update(request_id: int, body: HelpRequestStatusUpdate, authorization: Optional[str] = Header(None)):
    worker = _require_worker(authorization)
    db.update_help_request_status(request_id, body.status)
    if body.status == "resolved":
        req = next((r for r in db.list_help_requests() if r["id"] == request_id), None)
        if req:
            notify_beneficiary(req["mobile"], "Your help request was addressed",
                                f"ASHA worker {worker['mobile']} has responded to your request.")
    return {"ok": True}


# ── Multilingual catalogs ──
@app.get("/api/i18n/{lang}")
def i18n_catalog(lang: str):
    return i18n.get_catalog(lang)


@app.get("/api/i18n")
def i18n_languages():
    return {"languages": i18n.SUPPORTED_LANGUAGES}


# ── Semantic search over saved records (local vector store) ──
@app.get("/api/search")
def search(q: str, authorization: Optional[str] = Header(None)):
    worker = _require_worker(authorization)
    return vectorstore.semantic_search(q, worker_id=worker["id"])


# ── Transcript Q&A (grounded, single-visit — see rag.py) ──
class TranscriptAskRequest(BaseModel):
    transcript: str
    question: str


@app.post("/api/transcript/ask")
def transcript_ask(req: TranscriptAskRequest):
    """Ask a question about a transcript that hasn't necessarily been saved
    yet — used right after Voice Studio extraction, before "Save Record"."""
    return rag_module.ask_about_transcript(req.transcript, req.question)


class RecordAskRequest(BaseModel):
    question: str


@app.post("/api/records/{record_id}/ask")
def record_ask(record_id: int, req: RecordAskRequest, authorization: Optional[str] = Header(None)):
    """Same as /api/transcript/ask, but for an already-saved record — looks
    up its stored transcript instead of requiring the caller to resend it."""
    _require_worker(authorization)
    record = db.get_record(record_id)
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")
    return rag_module.ask_about_transcript(record.get("transcript") or "", req.question)


# ── AI visit summary (adapted from MOM-generator — see visit_summary.py) ──
class TranscriptSummarizeRequest(BaseModel):
    transcript: str


@app.post("/api/transcript/summarize")
def transcript_summarize(req: TranscriptSummarizeRequest):
    return visit_summary.generate_visit_summary(req.transcript)


@app.post("/api/records/{record_id}/summarize")
def record_summarize(record_id: int, authorization: Optional[str] = Header(None)):
    _require_worker(authorization)
    record = db.get_record(record_id)
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")
    return visit_summary.generate_visit_summary(record.get("transcript") or "")


# ── Static frontend (Stitch-designed UI) ──
@app.get("/")
def root_redirect():
    """Redirect to the main home dashboard."""
    return RedirectResponse(url="/home_layout/code.html")


if os.path.isdir(_FRONTEND_DIR):
    app.mount("/app", StaticFiles(directory=_FRONTEND_DIR, html=True), name="frontend_app")
    # Also mount each subfolder directly at root so /home_layout/code.html etc. never 404
    for entry in os.listdir(_FRONTEND_DIR):
        full_p = os.path.join(_FRONTEND_DIR, entry)
        if os.path.isdir(full_p) and not entry.startswith("."):
            app.mount(f"/{entry}", StaticFiles(directory=full_p, html=True), name=f"static_{entry}")
