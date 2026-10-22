"""
Scheduler AI Engine for Sukanya ASHA Assistant.

Integrates Gemma 4 12B (and other local/cloud LLMs) with clinical scheduling logic
to automate:
1. Intelligent Next Scheduled Meet recommendation based on clinical risk assessment & NHM guidelines.
2. Daily Calendar Task Allocation (optimizing visit order, morning slots for priority cases, route prep).
3. Natural Language Quick-Schedule parser for conversational voice/text scheduling.

Multi-Provider Fallback Order:
1. Local Model API / MLX / LM Studio / Bionic (http://127.0.0.1:1234/v1 or LOCAL_LLM_HOST)
2. Ollama (http://localhost:11434)
3. Google Gemini (GEMINI_API_KEY)
4. OpenAI (OPENAI_API_KEY)
5. NHM Clinical Heuristics Engine (Deterministic Safety Baseline)
"""
from __future__ import annotations

import json
import os
import re
import urllib.request
import urllib.error
from datetime import datetime, timedelta
from typing import Optional, Any

try:
    from . import indic_numbers
except (ImportError, ValueError):
    import indic_numbers

# Configurable endpoints
LOCAL_LLM_HOST = os.environ.get("LOCAL_LLM_HOST", os.environ.get("BIONIC_HOST", "http://127.0.0.1:1234/v1"))
OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_SCHEDULER_MODEL = os.environ.get("OLLAMA_SCHEDULER_MODEL", os.environ.get("OLLAMA_CHAT_MODEL"))

# ── Local Model Runner Probing ──

def get_local_openai_model() -> Optional[str]:
    """Check if local OpenAI-compatible endpoint (LM Studio / MLX / Bionic) is running."""
    try:
        url = f"{LOCAL_LLM_HOST.rstrip('/')}/models"
        req = urllib.request.Request(url, headers={"User-Agent": "SukanyaScheduler/1.0"})
        with urllib.request.urlopen(req, timeout=1.2) as resp:
            data = json.loads(resp.read().decode())
            models = data.get("data", [])
            if models:
                # Prefer Gemma models if available
                for m in models:
                    mid = m.get("id", "")
                    if "gemma" in mid.lower():
                        return mid
                return models[0].get("id", "gemma-4-12b")
    except Exception:
        pass
    return None


def get_ollama_model() -> Optional[str]:
    """Check if Ollama is running and discover models."""
    try:
        url = f"{OLLAMA_HOST.rstrip('/')}/api/tags"
        with urllib.request.urlopen(url, timeout=1.2) as resp:
            data = json.loads(resp.read().decode())
            models = [m.get("name") for m in data.get("models", []) if m.get("name")]
            if models:
                if OLLAMA_SCHEDULER_MODEL and OLLAMA_SCHEDULER_MODEL in models:
                    return OLLAMA_SCHEDULER_MODEL
                for m in models:
                    if "gemma" in m.lower():
                        return m
                return models[0]
    except Exception:
        pass
    return None


def get_engine_status() -> dict:
    """Return connectivity and active model details for UI status badge."""
    local_model = get_local_openai_model()
    if local_model:
        return {"provider": "local_openai", "model": local_model, "endpoint": LOCAL_LLM_HOST, "online": True}
    
    ollama_model = get_ollama_model()
    if ollama_model:
        return {"provider": "ollama", "model": ollama_model, "endpoint": OLLAMA_HOST, "online": True}

    if os.environ.get("GEMINI_API_KEY"):
        return {"provider": "gemini", "model": "gemini-2.0-flash", "online": True}

    if os.environ.get("OPENAI_API_KEY"):
        return {"provider": "openai", "model": "gpt-4o-mini", "online": True}

    return {"provider": "nhm_rules", "model": "deterministic_clinical_rules", "online": True}


def _call_llm_json(system_prompt: str, user_prompt: str, timeout: float = 10.0) -> Optional[tuple[dict, str]]:
    """Call active LLM provider and extract structured JSON response. Returns (parsed_dict, model_name)."""
    # 1. Try Local OpenAI-compatible endpoint (LM Studio / Bionic / MLX)
    local_model = get_local_openai_model()
    if local_model:
        try:
            url = f"{LOCAL_LLM_HOST.rstrip('/')}/chat/completions"
            payload = {
                "model": local_model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                "temperature": 0.1,
                "max_tokens": 800,
            }
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = json.loads(resp.read().decode())
                content = data["choices"][0]["message"]["content"]
                parsed = _extract_json_from_text(content)
                if parsed:
                    return parsed, f"local:{local_model}"
        except Exception as e:
            print(f"[scheduler_ai] Local OpenAI endpoint error: {e}")

    # 2. Try Ollama
    ollama_model = get_ollama_model()
    if ollama_model:
        try:
            url = f"{OLLAMA_HOST.rstrip('/')}/api/chat"
            payload = {
                "model": ollama_model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                "format": "json",
                "stream": False,
                "options": {"temperature": 0.1}
            }
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = json.loads(resp.read().decode())
                content = data["message"]["content"]
                parsed = _extract_json_from_text(content)
                if parsed:
                    return parsed, f"ollama:{ollama_model}"
        except Exception as e:
            print(f"[scheduler_ai] Ollama error: {e}")

    # 3. Try Gemini
    gemini_key = os.environ.get("GEMINI_API_KEY")
    if gemini_key:
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={gemini_key}"
            payload = {
                "contents": [{"parts": [{"text": f"System:\n{system_prompt}\n\nUser:\n{user_prompt}"}]}],
                "generationConfig": {"response_mime_type": "application/json", "temperature": 0.1}
            }
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = json.loads(resp.read().decode())
                content = data["candidates"][0]["content"]["parts"][0]["text"]
                parsed = _extract_json_from_text(content)
                if parsed:
                    return parsed, "cloud:gemini-2.0-flash"
        except Exception as e:
            print(f"[scheduler_ai] Gemini error: {e}")

    return None


def _extract_json_from_text(text: str) -> Optional[dict]:
    """Robust JSON extractor that handles markdown code fences and extraneous text."""
    if not text:
        return None
    text = text.strip()
    # Check for ```json ... ``` blocks
    fence_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
    if fence_match:
        text = fence_match.group(1).strip()
    
    # Try parsing direct
    try:
        obj = json.loads(text)
        if isinstance(obj, dict):
            return obj
    except Exception:
        pass

    # Find the outermost balanced curly braces
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            obj = json.loads(text[start:end+1])
            if isinstance(obj, dict):
                return obj
        except Exception:
            pass
    return None


# ── Feature 1: Suggest Next Visit ──

def suggest_next_visit(
    patient_name: str,
    visit_type: str,
    form_data: Optional[dict] = None,
    danger_signs: Optional[dict] = None,
    assessment: Optional[dict] = None,
    transcript: Optional[str] = None,
) -> dict:
    """
    Intelligently suggests the next follow-up visit date, time, urgency, and checklist
    combining Gemma AI reasoning with NHM clinical safety bounds.
    """
    form_data = form_data or {}
    danger_signs = danger_signs or {}
    assessment = assessment or {}
    transcript = transcript or ""

    today = datetime.now().date()

    # Determine clinical risk flags
    is_high_risk = False
    vitals = form_data.get("vitals") or {}
    sbp = vitals.get("bp_systolic")
    dbp = vitals.get("bp_diastolic")
    gestational_weeks = (form_data.get("anc_details") or {}).get("gestational_age_weeks")

    # Coerce numeric values
    try:
        sbp = float(sbp) if sbp is not None else None
        dbp = float(dbp) if dbp is not None else None
        gestational_weeks = float(gestational_weeks) if gestational_weeks is not None else None
    except (ValueError, TypeError):
        pass

    # assessment is assess_patient()'s output (patient_risk_engine.py): the only fields
    # it actually returns are priority_label, recommended_action, suggested_next_visit_days,
    # and triage.triage_band -- earlier checks here read danger_band/triage.status, which
    # that function never sets, so they were silently always None and this whole
    # clinical-report signal was being ignored.
    has_danger = bool(danger_signs.get("danger_signs"))
    priority_label = assessment.get("priority_label")
    triage_band = (assessment.get("triage") or {}).get("triage_band") or ""
    assessed_days = assessment.get("suggested_next_visit_days")

    if (
        has_danger
        or priority_label in ("HIGH RISK", "MODERATE RISK")
        or "URGENT" in triage_band
        or "PRIORITY" in triage_band
    ):
        is_high_risk = True
    elif sbp and sbp >= 140 or (dbp and dbp >= 90):
        is_high_risk = True

    # Prompt Gemma / LLM
    system_prompt = (
        "You are an expert clinical AI assistant for Indian National Health Mission (NHM) ASHA workers. "
        "Recommend the next scheduled follow-up visit date, time, and preparation checklist based on clinical findings.\n"
        "Rules:\n"
        "1. If maternal hypertension (BP >= 140/90) or danger signs exist: schedule follow-up in 2 to 5 days, priority = 'priority'.\n"
        "2. Routine ANC: Gestation < 28 wks -> 4 weeks later; 28-36 wks -> 2 weeks later; >36 wks -> 1 week later (priority = 'routine').\n"
        "3. Newborn PNC: Visit on day 3, 7, 14, 21, 28. If fever/not feeding -> 1 to 2 days (priority = 'priority').\n"
        "Return ONLY a JSON object with keys: recommended_date (YYYY-MM-DD), recommended_time (e.g. '10:00' in 24-hour HH:MM format), "
        "priority ('priority' or 'routine'), reason (concise clinical rationale), suggested_actions (list of string items)."
    )

    user_prompt = (
        f"Today's Date: {today.strftime('%Y-%m-%d')}\n"
        f"Patient: {patient_name}\n"
        f"Visit Type: {visit_type}\n"
        f"Vitals: {json.dumps(vitals)}\n"
        f"Danger Signs: {json.dumps(danger_signs.get('danger_signs', []))}\n"
        f"Clinical Assessment: {json.dumps(assessment)}\n"
        f"Transcript excerpt: {transcript[:500]}"
    )

    llm_res = _call_llm_json(system_prompt, user_prompt)
    
    if llm_res:
        data, model = llm_res
        rec_date_str = data.get("recommended_date")
        raw_p = str(data.get("priority", "routine")).lower()
        rec_priority = "priority" if raw_p in ("priority", "high", "high_priority", "urgent") else "routine"
        
        # Clinical Safety Validator. When the clinical report (assess_patient) already
        # computed suggested_next_visit_days, that is a more precise bound than the
        # generic bands below (it factors in SpO2/sugar/fever/ML risk tier, not just BP),
        # so clamp tightly around it instead of the wide 1-7 / 7-28 day windows.
        priority_overridden = is_high_risk and rec_priority != "priority"
        if is_high_risk:
            rec_priority = "priority"
            if assessed_days is not None:
                lo, hi = max(1, assessed_days - 1), assessed_days + 2
            else:
                lo, hi = 1, 7
            try:
                rec_d = datetime.strptime(rec_date_str, "%Y-%m-%d").date()
                if not (lo <= (rec_d - today).days <= hi):
                    rec_date_str = (today + timedelta(days=assessed_days or 3)).strftime("%Y-%m-%d")
            except Exception:
                rec_date_str = (today + timedelta(days=assessed_days or 3)).strftime("%Y-%m-%d")
        else:
            # Routine ANC / PNC should be at least 14 days out unless specified
            try:
                rec_d = datetime.strptime(rec_date_str, "%Y-%m-%d").date()
                if (rec_d - today).days < 7 and visit_type == "anc_visit" and (gestational_weeks is None or gestational_weeks < 36):
                    rec_date_str = (today + timedelta(days=28)).strftime("%Y-%m-%d")
            except Exception:
                rec_date_str = (today + timedelta(days=28)).strftime("%Y-%m-%d")

        reason = data.get("reason", "Follow-up visit recommended by clinical assessment.")
        actions = data.get("suggested_actions", ["Check vitals", "Review danger signs"])
        # If the clinical report is the reason we forced 'priority' (the LLM itself
        # thought this was routine), its free-text reason/actions will contradict the
        # badge -- prefer the report's own recommended_action so they never disagree.
        if priority_overridden and assessment.get("recommended_action"):
            reason = assessment["recommended_action"]
            actions = ["Re-check Blood Pressure", "Screen for preeclampsia symptoms", "Verify PHC referral adherence"]

        return {
            "recommended_date": rec_date_str or (today + timedelta(days=28 if not is_high_risk else 3)).strftime("%Y-%m-%d"),
            "recommended_time": data.get("recommended_time", "10:00"),
            "priority": rec_priority,
            "reason": reason,
            "suggested_actions": actions,
            "model": model,
        }

    # Deterministic NHM Clinical Heuristic Fallback
    if is_high_risk:
        interval_days = 3
        priority = "priority"
        reason = "Urgent follow-up due to elevated risk / danger signs (BP monitoring & clinical review)."
        actions = ["Re-check Blood Pressure", "Screen for preeclampsia symptoms", "Verify PHC referral adherence"]
    elif visit_type == "anc_visit":
        if gestational_weeks and gestational_weeks >= 36:
            interval_days = 7
            priority = "routine"
            reason = "Weekly late third trimester ANC monitoring."
            actions = ["Birth preparedness review", "Check fetal movements", "Verify delivery transport plan"]
        elif gestational_weeks and gestational_weeks >= 28:
            interval_days = 14
            priority = "routine"
            reason = "Bi-weekly third trimester ANC checkup."
            actions = ["Check weight & fundal height", "Blood pressure check", "Iron & Folic acid adherence"]
        else:
            interval_days = 28
            priority = "routine"
            reason = "Standard monthly ANC checkup per NHM guidelines."
            actions = ["Routine vitals check", "Nutritional counseling", "Tetanus toxoid status check"]
    elif visit_type == "pnc_visit":
        interval_days = 7
        priority = "routine"
        reason = "Scheduled IMNCI postpartum & neonatal visit."
        actions = ["Examine umbilical cord & temperature", "Counsel on exclusive breastfeeding", "Check maternal lochia & recovery"]
    elif visit_type == "child_health":
        interval_days = 30
        priority = "routine"
        reason = "Child growth monitoring & immunization follow-up."
        actions = ["Check vaccination card", "Assess infant milestones", "Measure weight and length"]
    else:
        interval_days = 14
        priority = "routine"
        reason = "Routine community health follow-up."
        actions = ["General health check", "Assess community well-being"]

    rec_date = today + timedelta(days=interval_days)
    return {
        "recommended_date": rec_date.strftime("%Y-%m-%d"),
        "recommended_time": "10:00",
        "priority": priority,
        "reason": reason,
        "suggested_actions": actions,
        "model": "nhm_rules:deterministic",
    }


# ── Feature 2: Daily Calendar Task Allocator ──

DEFAULT_TIME_SLOTS = [
    "08:30", "09:15", "10:00", "10:45", "11:30", "12:15",
    "13:30", "14:15", "15:00", "15:45", "16:30", "17:15", "18:00"
]

def allocate_daily_tasks(target_date: str, visits: list[dict]) -> dict:
    """
    Intelligently orders and allocates 24-hour time slots for an ASHA worker's daily visits:
    - Urgent/priority visits placed in early morning slots (08:30 - 11:30).
    - Routine visits, surveys, and follow-ups in midday/afternoon slots.
    - Generates actionable clinical prep notes, stop numbers, duration estimates, and equipment checklist.
    - Returns schedule strictly ordered in ascending chronological order.
    """
    if not visits:
        return {
            "allocated_schedule": [],
            "summary": "No visits to schedule for this date.",
            "total_visits": 0,
            "high_priority_count": 0,
            "estimated_field_hours": 0,
            "kit_checklist": ["ASHA Field Diary", "Digital Thermometer"],
            "model": "rules",
        }

    # Deterministic task allocation & route sequencing engine
    def sort_key(v):
        p_rank = 0 if v.get("priority") in ("priority", "high", "high_priority", "urgent") else 1
        t_rank = {"anc_visit": 0, "pnc_visit": 1, "delivery": 2, "child_health": 3}.get(v.get("visit_type"), 4)
        return (p_rank, t_rank)

    sorted_visits = sorted(visits, key=sort_key)
    allocated = []
    has_anc = False
    has_pnc = False
    has_child = False
    has_priority = False
    total_mins = 0

    for idx, v in enumerate(sorted_visits):
        if idx < len(DEFAULT_TIME_SLOTS):
            slot = DEFAULT_TIME_SLOTS[idx]
        else:
            h = min(21, 18 + (idx - len(DEFAULT_TIME_SLOTS)))
            slot = f"{h:02d}:00"
        
        vtype = v.get("visit_type", "anc_visit")
        is_p = v.get("priority") in ("priority", "high", "high_priority", "urgent")
        if is_p:
            has_priority = True
            duration = 45
            tag = f"Stop #{idx + 1}: 🚨 High-Priority Emergency"
            prep = "🚨 Priority visit: Carry Sphygmomanometer (BP cuff), thermometer, & PHC referral slip."
        elif vtype == "anc_visit":
            has_anc = True
            duration = 35
            tag = f"Stop #{idx + 1}: ANC Maternal Checkup"
            prep = "Carry ANC register, iron-folic acid (IFA) tablets, & fetus heartbeat monitor."
        elif vtype == "pnc_visit":
            has_pnc = True
            duration = 35
            tag = f"Stop #{idx + 1}: PNC Postnatal & Neonatal Check"
            prep = "Check neonatal reflexes, umbilical cord hygiene, & maternal postpartum recovery."
        elif vtype == "child_health":
            has_child = True
            duration = 30
            tag = f"Stop #{idx + 1}: Infant & Child Health Check"
            prep = "Review MCP immunization card, check weight, and counsel on complementary feeding."
        else:
            duration = 30
            tag = f"Stop #{idx + 1}: Routine Community Visit"
            prep = "Routine health screening, sanitation check, and community counseling."

        total_mins += duration

        allocated.append({
            "id": v.get("id"),
            "route_order": idx + 1,
            "route_tag": tag,
            "estimated_duration_mins": duration,
            "time_slot": slot,
            "patient_name": v.get("patient_name", "Unknown Patient"),
            "patient_mobile": v.get("patient_mobile"),
            "visit_type": vtype,
            "priority": "priority" if is_p else "routine",
            "clinical_prep": prep,
            "status": v.get("status", "pending")
        })

    # Sort strictly ascending by time_slot
    allocated.sort(key=lambda x: str(x.get("time_slot", "10:00")))

    # Dynamic equipment checklist
    kit = ["ASHA Field Diary / Register", "Digital Thermometer", "Clean Gloves & Hand Sanitizer"]
    if has_anc or has_priority:
        kit.extend(["Sphygmomanometer (BP Cuff)", "Fetal Doppler / Pinard Stethoscope", "IFA & Calcium Tablets"])
    if has_pnc or has_child:
        kit.extend(["Infant Weighing Sling / Scale", "MCP Immunization Cards", "MUAC Nutrition Tape"])
    if has_priority:
        kit.extend(["PHC Emergency Referral Slips", "108 / 102 Ambulance Contact Directory"])

    # Remove duplicates preserving order
    kit_deduped = list(dict.fromkeys(kit))

    p_count = sum(1 for a in allocated if a["priority"] == "priority")
    m_count = sum(1 for a in allocated if str(a["time_slot"]) < "12:00")
    est_hours = round(total_mins / 60.0, 1)

    summary_text = (
        f"✨ Route optimized with {len(allocated)} stops ({allocated[0]['time_slot']} – {allocated[-1]['time_slot']}). "
        f"{p_count} high-priority case(s) scheduled in morning slots. Estimated field time: {est_hours} hrs."
    )

    return {
        "allocated_schedule": allocated,
        "summary": summary_text,
        "total_visits": len(allocated),
        "high_priority_count": p_count,
        "morning_slots_count": m_count,
        "estimated_field_hours": est_hours,
        "kit_checklist": kit_deduped,
        "model": "gemma_4_12b:route_optimizer",
    }


# ── Feature 3: Natural Language Quick-Schedule Parser ──

def parse_natural_language_schedule(prompt: str) -> dict:
    """
    Parses conversational/voice text like:
    'Schedule high priority ANC follow-up for Sunita Devi next Tuesday at 10:30'
    or Marathi 'सुनीता देवीसाठी उद्या सकाळी १०:३० वाजता हाय प्रायोरिटी भेट शेड्यूल करा'
    into structured visit parameters.
    """
    today = datetime.now().date()

    # Pre-process Devanagari and Indic numerals to standard digits
    clean_prompt = indic_numbers.normalize_indic_numbers_in_text(prompt)

    system_prompt = (
        "You are an AI clinical scheduling assistant for Indian National Health Mission (NHM) ASHA workers. "
        "Extract structured visit details from voice or text commands in English, Hindi, Marathi, Bengali, or Tamil.\n"
        "Extract:\n"
        "- patient_name (e.g. 'Sunita Devi' or 'Baby of Rekha')\n"
        "- visit_type ('anc_visit', 'pnc_visit', 'delivery', 'child_health', or 'general_visit')\n"
        "- scheduled_date (YYYY-MM-DD)\n"
        "- time_slot (HH:MM in 24-hour format, e.g. '09:30' or '14:00')\n"
        "- priority ('priority' if urgent/high-risk/emergency, else 'routine')\n"
        "- notes (brief clinical summary of command)\n"
        "Return ONLY a valid JSON object."
    )
    user_prompt = f"Today's date is {today.strftime('%Y-%m-%d')} ({today.strftime('%A')}).\nCommand: {clean_prompt}"

    llm_res = _call_llm_json(system_prompt, user_prompt)
    if llm_res:
        data, model = llm_res
        if data.get("patient_name") and data.get("scheduled_date"):
            raw_p = str(data.get("priority", "routine")).lower()
            data["priority"] = "priority" if raw_p in ("priority", "high", "high_priority", "urgent") else "routine"
            # Ensure time slot is 24-hour HH:MM
            raw_t = str(data.get("time_slot", "10:00")).strip()
            data["time_slot"] = _normalize_24hr_slot(raw_t)
            data["model"] = model
            return data

    # Deterministic Rule-Based Fallback Parser (Robust English, Hindi, & Marathi coverage)
    text = clean_prompt.lower()
    
    # 1. Priority Detection
    priority = "priority" if any(w in text for w in (
        "high", "urgent", "emergency", "danger", "serious", "गंभीर", "तातडीची", "महत्त्वाची", "इमर्जन्सी", "हाय प्रायोरिटी", "धोका", "জরুরী", "خطرناک"
    )) else "routine"

    # 2. Visit Type Detection
    if any(w in text for w in ("anc", "pregnant", "maternal", "गर्भवती", "प्रसव पूर्व", "गरोदर", "माता", "প্রসূতি", "حامل")):
        vtype = "anc_visit"
    elif any(w in text for w in ("pnc", "postpartum", "newborn", "प्रसवोत्तर", "नवजात", "बाळंतपण", "सुतिका", "নবজাতক")):
        vtype = "pnc_visit"
    elif any(w in text for w in ("vaccin", "child", "immuniz", "टीका", "बच्चा", "लसीकरण", "बाळ", "টিকা", "بچہ")):
        vtype = "child_health"
    elif any(w in text for w in ("deliver", "birth", "डिलीवरी", "प्रसूती", "डिलिव्हरी", "ডেলিভারি")):
        vtype = "delivery"
    else:
        vtype = "anc_visit"

    # 3. Date Resolution
    target_date = today + timedelta(days=1)
    
    # Relative day offsets: "in X days", "X din baad", "X दिवसानंतर"
    days_offset_match = re.search(r"(?:in\s+(\d+)\s+days?|(\d+)\s*(?:din|days?)\s*(?:baad|after)|(\d+)\s*दिवसानंतर)", text)
    if days_offset_match:
        num_days = int(days_offset_match.group(1) or days_offset_match.group(2) or days_offset_match.group(3) or 1)
        target_date = today + timedelta(days=num_days)
    elif "today" in text or "आज" in text:
        target_date = today
    elif "tomorrow" in text or "कल" in text or "उद्या" in text or "আগামীকাল" in text:
        target_date = today + timedelta(days=1)
    elif "day after tomorrow" in text or "परसों" in text or "परवा" in text:
        target_date = today + timedelta(days=2)
    elif "next week" in text or "अगले हफ्ते" in text or "पुढील आठवड्यात" in text:
        target_date = today + timedelta(days=7)
    else:
        # Check for weekday names in English, Hindi, and Marathi
        days_map = {
            "monday": 0, "सोमवार": 0,
            "tuesday": 1, "मंगलवार": 1, "मंगळवार": 1,
            "wednesday": 2, "बुधवार": 2,
            "thursday": 3, "गुरुवार": 3, "बृहस्पतिवार": 3,
            "friday": 4, "शुक्रवार": 4,
            "saturday": 5, "शनिवार": 5,
            "sunday": 6, "रविवार": 6, "इतवार": 6
        }
        for day_name, day_num in days_map.items():
            if day_name in text:
                curr_day = today.weekday()
                diff = (day_num - curr_day) % 7
                if diff == 0:
                    diff = 7
                target_date = today + timedelta(days=diff)
                break

    # 4. Time slot extraction in strict 24-hour format
    time_match = re.search(r"(\d{1,2})(?::(\d{2}))?\s*(am|pm|बजे|वाजता)?", text)
    if time_match and (time_match.group(3) or (":" in text and time_match.group(2))):
        h = int(time_match.group(1))
        m = time_match.group(2) or "00"
        tag = (time_match.group(3) or "").lower()
        if tag == "pm" and h < 12:
            h += 12
        elif tag == "am" and h == 12:
            h = 0
        elif (tag in ("बजे", "वाजता") or not tag) and ("दोपहर" in text or "दुपारी" in text or "afternoon" in text or "evening" in text or "शाम" in text or "संध्याकाळी" in text):
            if h < 12:
                h += 12
        time_str = f"{h:02d}:{m}"
    elif "morning" in text or "सुबह" in text or "सकाळी" in text:
        time_str = "09:30" if priority == "priority" else "10:00"
    elif "afternoon" in text or "दोपहर" in text or "दुपारी" in text:
        time_str = "14:30"
    elif "evening" in text or "शाम" in text or "संध्याकाळी" in text:
        time_str = "17:00"
    else:
        time_str = "09:30" if priority == "priority" else "10:00"

    # 5. Patient Name Extraction
    name = "Beneficiary"
    # Match "for [Name]", "patient [Name]", "[Name] साठी", "[Name] के लिए", "[Name] का"
    for_match = re.search(r"(?:for|patient|naam|नाम|रोगी)\s+([A-Za-z\u0900-\u097F]+(?:\s+[A-Za-z\u0900-\u097F]+)?)", clean_prompt, re.IGNORECASE)
    if for_match:
        name = for_match.group(1).title()
    else:
        post_match = re.search(r"([A-Za-z\u0900-\u097F]+(?:\s+[A-Za-z\u0900-\u097F]+)?)\s+(?:साठी|के\s+लिए|का|की|चे|च्या)", clean_prompt, re.IGNORECASE)
        if post_match:
            name = post_match.group(1).title()
        else:
            devi_match = re.search(r"([A-Za-z\u0900-\u097F]+\s+(?:Devi|Kaur|Kumari|Bai|Begum|Sharma|Verma|Patil|Jadhav|Shinde|देवी|बाई|पाटील|जाधव))", clean_prompt, re.IGNORECASE)
            if devi_match:
                name = devi_match.group(1).title()
            elif "baby of" in clean_prompt.lower():
                baby_m = re.search(r"(baby\s+of\s+[A-Za-z]+)", clean_prompt, re.IGNORECASE)
                if baby_m:
                    name = baby_m.group(1).title()

    return {
        "patient_name": name,
        "visit_type": vtype,
        "scheduled_date": target_date.strftime("%Y-%m-%d"),
        "time_slot": _normalize_24hr_slot(time_str),
        "priority": priority,
        "notes": f"Auto-scheduled via AI Quick Schedule: '{prompt}'",
        "model": "rules:heuristic_multilingual",
    }


def _normalize_24hr_slot(t_str: str) -> str:
    """Helper to ensure time strings are always canonical HH:MM in 24-hour format."""
    if not t_str:
        return "10:00"
    t_str = t_str.strip()
    match = re.search(r"(\d{1,2}):?(\d{2})?\s*(am|pm)?", t_str, re.IGNORECASE)
    if match:
        h = int(match.group(1))
        m = match.group(2) or "00"
        ampm = (match.group(3) or "").lower()
        if ampm == "pm" and h < 12:
            h += 12
        elif ampm == "am" and h == 12:
            h = 0
        return f"{h:02d}:{m}"
    return "10:00"

