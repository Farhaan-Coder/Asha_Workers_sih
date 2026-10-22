"""
Clinical extraction: Hindi/Hinglish/English home-visit transcript ->
structured NHM form + danger-sign checklist + multi-provider AI refinement.

Deliberately multi-layered:
1. High-speed deterministic regex & keyword extraction (zero dependency, always available).
2. Anti-hallucination evidence contract (literal matched utterance quotes).
3. Best-effort LLM refinement using Gemma 4 12B / Ollama / Gemini / OpenAI via scheduler_ai.
4. Harmonized payload supporting canonical NHM schemas AND frontend form bindings (Part 1, Part 2, Smart Form).
"""
from __future__ import annotations

import json
import os
import re
import time
from typing import Optional, Any
try:
    from . import indic_numbers
except (ImportError, ValueError):
    import indic_numbers

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
_SCHEMAS_DIR = os.path.join(_THIS_DIR, "configs", "schemas")

_schemas_cache = {}


def init_schemas():
    for name in ("anc_visit", "pnc_visit", "delivery", "child_health", "danger_signs"):
        path = os.path.join(_SCHEMAS_DIR, f"{name}.json")
        with open(path, encoding="utf-8") as f:
            _schemas_cache[name] = json.load(f)
    return _schemas_cache


# ── Visit type detection ──
_VISIT_TYPE_KEYWORDS = {
    "delivery": ["प्रसव", "डिलीवरी", "जन्म हुआ", "delivery", "birth weight", "जन्म के समय", "बाळंतपण", "प्रसूती"],
    "pnc_visit": ["नवजात", "प्रसव के बाद", "postnatal", "pnc", "hbnc", "cord", "गर्भनाल", "दूध पिलाना", "स्तनपान", "बाळ", "नाळ"],
    "child_health": ["hbyc", "टीकाकरण", "immunization", "दस्त", "diarrhea", "बच्चे का वजन", "developmental", "baby", "infant", "लसीकरण"],
    "anc_visit": ["गर्भवती", "प्रेग्नेंट", "anc", "antenatal", "गर्भावस्था", "हफ्ते की गर्भवती", "weeks pregnant", "महीने की गर्भवती", "गरोदर", "गरोदरपण"],
}


def detect_visit_type(transcript: str) -> str:
    text = indic_numbers.normalize_indic_numbers_in_text(transcript).lower()
    scores = {vt: 0 for vt in _VISIT_TYPE_KEYWORDS}
    for vt, keywords in _VISIT_TYPE_KEYWORDS.items():
        for kw in keywords:
            if kw.lower() in text:
                scores[vt] += 1
    best = max(scores, key=scores.get)
    return best if scores[best] > 0 else "anc_visit"  # ANC is the most common home visit type


# ── Numeric vitals extraction ──
_NUM = r"(\d{1,3}(?:\.\d+)?)"

# "by"/"over" alongside "/" and "बटा" and "x"
_BP_RE = re.compile(rf"{_NUM}\s*(?:/|बटा|बाय|by|over|x|चे|आणि)\s*{_NUM}", re.IGNORECASE)
_WEIGHT_RE = re.compile(rf"{_NUM}\s*(?:kg|किलो|किग्रा)", re.IGNORECASE)
_TEMP_RE = re.compile(
    rf"{_NUM}\s*(?:(?:°|डिग्री|degrees?|deg\.?)\s*(F|फ|C|से)?|(Fahrenheit|फारेनहाइट|F|Celsius|सेल्सियस|C|से)\b)",
    re.IGNORECASE,
)
_HB_RE = re.compile(rf"(?:हीमोग्लोबिन|hemoglobin|hb)\D{{0,8}}{_NUM}", re.IGNORECASE)
_WEEKS_RE = re.compile(rf"{_NUM}\s*(?:हफ्ते|हफ़्ते|सप्ताह|आठवडे|weeks?)", re.IGNORECASE)
_MONTHS_RE = re.compile(rf"{_NUM}\s*(?:महीने|माह|महिने|months?)", re.IGNORECASE)
_HR_RE = re.compile(rf"(?:pulse|heart rate|नब्ज़|हार्ट रेट|दिल की धड़कन|नाडी)\D{{0,8}}{_NUM}", re.IGNORECASE)
_SPO2_RE = re.compile(rf"(?:spo2|oxygen|ऑक्सीजन|ऑक्सिजन)\D{{0,8}}{_NUM}", re.IGNORECASE)


def _first_match_float(regex, text):
    m = regex.search(text)
    return float(m.group(1)) if m else None


def _extract_vitals(text: str) -> dict:
    norm_text = indic_numbers.normalize_indic_numbers_in_text(text)
    vitals = {
        "weight_kg": None, "bp_systolic": None, "bp_diastolic": None,
        "hemoglobin_gm_percent": None, "temperature_celsius": None,
        "heart_rate": None, "spo2": None,
    }
    bp = _BP_RE.search(norm_text)
    if bp:
        vitals["bp_systolic"] = int(float(bp.group(1)))
        vitals["bp_diastolic"] = int(float(bp.group(2)))
    w = _first_match_float(_WEIGHT_RE, norm_text)
    if w is not None:
        vitals["weight_kg"] = w
    hb = _first_match_float(_HB_RE, norm_text)
    if hb is not None:
        vitals["hemoglobin_gm_percent"] = hb
    temp_m = _TEMP_RE.search(norm_text)
    if temp_m:
        val = float(temp_m.group(1))
        unit_hint = (temp_m.group(2) or temp_m.group(3) or "").lower()
        if unit_hint.startswith("f") or unit_hint == "फ" or (not unit_hint and val > 50):
            val = (val - 32) * 5 / 9  # Fahrenheit -> Celsius; schema stores Celsius
        vitals["temperature_celsius"] = round(val, 1)
    hr = _first_match_float(_HR_RE, norm_text)
    if hr is not None:
        vitals["heart_rate"] = int(hr)
    spo2 = _first_match_float(_SPO2_RE, norm_text)
    if spo2 is not None:
        vitals["spo2"] = int(spo2)
    return vitals


def _extract_gestational_weeks_and_months(text: str) -> tuple[Optional[int], Optional[int]]:
    norm_text = indic_numbers.normalize_indic_numbers_in_text(text)
    weeks = None
    months = None
    
    # Check explicit weeks
    m_weeks = _WEEKS_RE.search(norm_text)
    if m_weeks:
        weeks = int(float(m_weeks.group(1)))
        months = max(1, min(9, int(round(weeks / 4.33))))
    
    # Check explicit months
    m_months = _MONTHS_RE.search(norm_text)
    if m_months:
        raw_m = int(float(m_months.group(1)))
        if 1 <= raw_m <= 9:
            months = raw_m
            if weeks is None:
                weeks = int(round(months * 4.33))
                
    return weeks, months


def _extract_demographics(text: str) -> dict:
    norm_text = indic_numbers.normalize_indic_numbers_in_text(text)
    demo = {
        "patient_name": None,
        "patient_age": None,
        "patient_mobile": None,
        "child_name": None,
        "child_age_months": None,
    }

    # 1. Mobile Number (10-digit Indian numbers)
    mob_m = re.search(r"(?:मोबाइल|फोन|phone|mobile|contact|number)?\D{0,7}(?:(?:\+91[\s-]?)?([6-9]\d{9}))", norm_text, re.IGNORECASE)
    if mob_m:
        demo["patient_mobile"] = mob_m.group(1)

    # 2. Child age in months e.g. "8 महीने", "8 महिने", "8 months"
    child_age_m = re.search(r"(?:बच्चे|baby|child|बाळ)?\D{0,8}(\d{1,2})\s*(?:महीने|माह|महिने|months?)", norm_text, re.IGNORECASE)
    if child_age_m:
        demo["child_age_months"] = int(child_age_m.group(1))

    # 3. Patient age in years e.g. "उम्र 24 साल", "24 वर्ष", "वय 27 वर्षे", "वय सत्तावीस", "age is 28 years", "28 years old"
    age_m = re.search(r"(?:उम्र|वय|age)\D{0,6}(\d{1,2})", norm_text, re.IGNORECASE)
    if not age_m:
        age_m = re.search(r"(\d{1,2})\s*(?:साल|वर्ष|वर्षे|years?\s*old)", norm_text, re.IGNORECASE)
    if not age_m:
        # Check standalone spoken integer e.g. if input is just the age like "सत्तावीस" or "27"
        single_num = indic_numbers.parse_indic_spoken_number(text)
        if single_num and 10 <= single_num <= 99:
            demo["patient_age"] = single_num
    elif age_m:
        val = int(age_m.group(1))
        if 10 <= val <= 99:
            demo["patient_age"] = val

    # 4. Child Name
    child_name_m = re.search(r"(?:बच्चे का नाम|बाळाचे नाव|child(?:'s)?\s*name\s*(?:is|:)?)\s*([A-Za-z\u0900-\u097F]+(?:\s+[A-Za-z\u0900-\u097F]+)?)", norm_text, re.IGNORECASE)
    if child_name_m:
        cname = child_name_m.group(1).strip()
        cname = re.sub(r"\s+(?:है|था|हूँ|आहे|होते|is|was)$", "", cname).strip()
        if cname and len(cname) > 1 and cname.lower() not in {"baby", "child", "बच्चा", "बाळ"}:
            demo["child_name"] = cname

    # 5. Patient Name
    name_patterns = [
        r"(?:मेरा नाम|माझं नाव|माझे नाव|patient\s*name(?:\s*is)?|name\s*is|मरीज का नाम|मरीज़ का नाम|रुग्णाचे नाव)\s*(?:है|आहे|:)?\s*([A-Za-z\u0900-\u097F]+(?:\s+[A-Za-z\u0900-\u097F]+)?)",
        r"(?:नमस्ते|नमस्कार|hello|hi)\s+([A-Za-z\u0900-\u097F]+(?:\s+[A-Za-z\u0900-\u097F]+)?)\s*(?:जी|ji|दीदी|didi|ताई)",
        r"(?:Patient|मरीज|रुग्ण):\s*(?:मैं|मी\s+)?([A-Za-z\u0900-\u097F]+(?:\s+[A-Za-z\u0900-\u097F]+)?)\s*(?:बात कर रही|बोल रही|बोलत आहे)",
    ]
    for pat in name_patterns:
        m = re.search(pat, norm_text, re.IGNORECASE)
        if m:
            pname = m.group(1).strip()
            pname = re.sub(r"\s+(?:जी|ji|दीदी|didi|ताई|है|था|हूँ|आहे|होते|is|was|आपकी|आपका|ना)$", "", pname).strip()
            if pname and pname.lower() not in {"di", "didi", "tai", "asha", "patient", "दीदी", "ताई", "नमस्ते", "नमस्कार", "आशा", "दी", "हाँ", "हो"}:
                demo["patient_name"] = pname
                break

    return demo


def _extract_supplements(text: str) -> list[str]:
    supplements = []
    t_lower = text.lower()
    if any(k in t_lower for k in ["ifa", "आयरन", "iron", "लाल गोली", "आईएफए"]):
        supplements.append("IFA Tablets")
    if any(k in t_lower for k in ["calcium", "कैल्शियम", "सफेद गोली"]):
        supplements.append("Calcium")
    if any(k in t_lower for k in ["folic", "फोलिक"]):
        supplements.append("Folic Acid")
    if any(k in t_lower for k in ["tt", "टीटी", "tetanus"]):
        supplements.append("TT Injection")
    return supplements


# ── Danger-sign keyword rules ──
_DANGER_RULES = [
    {"keys": ["बहुत सिरदर्द", "सिरदर्द", "severe headache", "headache"], "sign": "Severe headache",
     "category": "immediate_referral", "checklist": "maternal", "field": "severe_headache_blurred_vision"},
    {"keys": ["धुंधला", "धुंधली", "blurred vision", "blurry"], "sign": "Blurred vision",
     "category": "immediate_referral", "checklist": "maternal", "field": "severe_headache_blurred_vision"},
    {"keys": ["सूजन", "swelling", "edema"], "sign": "Swelling (face/hands)",
     "category": "immediate_referral", "checklist": "maternal", "field": "swelling_face_hands"},
    {"keys": ["खून बह", "रक्तस्राव", "bleeding", "heavy bleeding"], "sign": "Vaginal bleeding",
     "category": "immediate_referral", "checklist": "maternal", "field": "severe_vaginal_bleeding"},
    {"keys": ["दौरे", "मिर्गी", "convulsion", "fit आया", "seizure"], "sign": "Convulsions",
     "category": "immediate_referral", "checklist": "maternal", "field": "convulsions"},
    {"keys": ["पेट में तेज़ दर्द", "पेट दर्द", "abdominal pain", "severe abdominal"], "sign": "Severe abdominal pain",
     "category": "urgent_care", "checklist": "maternal", "field": "severe_abdominal_pain"},
    {"keys": ["साँस लेने में तकलीफ", "सांस फूलना", "difficulty breathing", "breathless"], "sign": "Difficult breathing",
     "category": "immediate_referral", "checklist": "maternal", "field": "fast_difficult_breathing"},
    {"keys": ["बच्चे की हलचल कम", "हलचल कम", "reduced movement", "kicks कम"], "sign": "Reduced fetal movement",
     "category": "urgent_care", "checklist": "maternal", "field": "reduced_fetal_movement"},
    {"keys": ["पानी की थैली", "पानी टूट", "water broke", "prom"], "sign": "Water break / PROM",
     "category": "immediate_referral", "checklist": "maternal", "field": "water_break_prom"},
    {"keys": ["दुर्गंध", "बदबूदार", "foul smell", "foul discharge"], "sign": "Foul vaginal discharge",
     "category": "urgent_care", "checklist": "maternal", "field": "foul_vaginal_discharge"},
    {"keys": ["तेज़ बुखार", "बुखार", "fever", "high temperature"], "sign": "Fever",
     "category": "urgent_care", "checklist": "maternal", "field": "high_fever"},
    # newborn
    {"keys": ["दूध नहीं पीता", "दूध ठीक से नहीं पीता", "not feeding", "poor feeding"], "sign": "Not feeding well",
     "category": "immediate_referral", "checklist": "newborn", "field": "not_feeding_well"},
    {"keys": ["सुस्त", "बेहोश", "lethargic", "unresponsive", "no movement"], "sign": "Lethargy / no movement",
     "category": "immediate_referral", "checklist": "newborn", "field": "no_movement"},
    {"keys": ["तेज़ साँस", "साँस तेज़", "fast breathing", "rapid breathing"], "sign": "Fast breathing",
     "category": "urgent_care", "checklist": "newborn", "field": "fast_breathing_gte60"},
    {"keys": ["पीलिया", "jaundice", "yellow skin"], "sign": "Jaundice",
     "category": "urgent_care", "checklist": "newborn", "field": "jaundice"},
    {"keys": ["नाभि में मवाद", "नाभि लाल", "cord pus", "umbilicus red"], "sign": "Umbilicus red / pus",
     "category": "urgent_care", "checklist": "newborn", "field": "umbilicus_red_pus"},
]

_CATEGORY_URGENCY = {"immediate_referral": 3, "urgent_care": 2, "monitor_closely": 1}


def _find_sentence(text: str, phrase: str) -> str:
    """Return the sentence/line containing `phrase`, for evidence citation."""
    idx = text.lower().find(phrase.lower())
    if idx == -1:
        return phrase
    start = max(text.rfind("\n", 0, idx), text.rfind("।", 0, idx), text.rfind(".", 0, idx))
    end_candidates = [e for e in (text.find("\n", idx), text.find("।", idx), text.find(".", idx)) if e != -1]
    end = min(end_candidates) if end_candidates else len(text)
    return text[start + 1:end].strip() or phrase


def extract_danger_signs(transcript: str, visit_type: str) -> dict:
    maternal_checklist = {f["field"]: "not_assessed" for f in _DANGER_RULES if f["checklist"] == "maternal"}
    newborn_checklist = {f["field"]: "not_assessed" for f in _DANGER_RULES if f["checklist"] == "newborn"}

    danger_signs = []
    evidence_all = []
    worst_category = None

    for rule in _DANGER_RULES:
        for key in rule["keys"]:
            if key.lower() in transcript.lower():
                evidence = _find_sentence(transcript, key)
                danger_signs.append({
                    "sign": rule["sign"],
                    "category": rule["category"],
                    "clinical_value": None,
                    "utterance_evidence": evidence,
                    "confidence": 0.6,
                })
                evidence_all.append(evidence)
                if rule["checklist"] == "maternal":
                    maternal_checklist[rule["field"]] = "detected"
                elif rule["checklist"] == "newborn":
                    newborn_checklist[rule["field"]] = "detected"
                if worst_category is None or _CATEGORY_URGENCY[rule["category"]] > _CATEGORY_URGENCY[worst_category]:
                    worst_category = rule["category"]
                break  # one hit per rule is enough

    if worst_category == "immediate_referral":
        decision, facility = "refer_immediately", "PHC"
    elif worst_category == "urgent_care":
        decision, facility = "refer_within_24h", "PHC"
    elif danger_signs:
        decision, facility = "continue_monitoring", None
    else:
        decision, facility = "routine_followup", None

    nhm_visit_type = {
        "anc_visit": "antenatal", "pnc_visit": "postnatal_mother",
        "delivery": "postnatal_mother", "child_health": "child_under5",
    }.get(visit_type, "antenatal")

    return {
        "visit_type": nhm_visit_type,
        "danger_signs": danger_signs,
        "referral_decision": {
            "decision": decision,
            "reason": (
                f"{len(danger_signs)} danger sign(s) detected from transcript keywords: "
                + ", ".join(d["sign"] for d in danger_signs)
            ) if danger_signs else "No danger-sign keywords detected in transcript.",
            "evidence_utterances": evidence_all,
            "recommended_facility": facility,
        },
        "maternal_danger_signs_checklist": maternal_checklist,
        "newborn_danger_signs_checklist": newborn_checklist,
    }


# ── Form extraction per visit type ──
_COUNSELING_KEYWORDS = [
    ("PHC जाने", "Advised to visit PHC"), ("phc", "Advised to visit PHC"),
    ("आराम", "Advised rest"), ("पौष्टिक खाना", "Nutrition counselling"),
    ("स्तनपान", "Breastfeeding counselling"), ("IFA", "IFA/iron supplementation counselling"),
    ("टीका", "Immunization counselling"),
]


def _extract_counseling(text: str):
    out = []
    for kw, label in _COUNSELING_KEYWORDS:
        if kw.lower() in text.lower() and label not in out:
            out.append(label)
    return out


def _extract_symptoms(text: str, danger_signs: list):
    return [d["sign"] for d in danger_signs]


def extract_form(transcript: str, visit_type: str, danger_result: dict) -> dict:
    vitals = _extract_vitals(transcript)
    symptoms = _extract_symptoms(transcript, danger_result["danger_signs"])
    counseling = _extract_counseling(transcript)
    demo = _extract_demographics(transcript)
    weeks, months = _extract_gestational_weeks_and_months(transcript)
    supplements = _extract_supplements(transcript)

    # General / Symptoms string summary for cross-page compatibility
    symptoms_str = ", ".join(symptoms) if symptoms else None
    supplements_str = ", ".join(supplements) if supplements else None

    base_form = {
        "patient": {
            "name": demo["patient_name"],
            "husband_name": None,
            "age": demo["patient_age"],
            "address": None,
            "mobile": demo["patient_mobile"],
            "caste_category": None,
            "bpl_status": None,
        },
        "vitals": vitals,
        "symptoms_reported": symptoms,
        "symptoms": symptoms_str,
        "counseling_provided": counseling,
        "general": {
            "problems": symptoms_str,
            "conditions": "High Risk" if danger_result["danger_signs"] else "Routine",
            "symptoms": symptoms_str,
        },
        "maternal": {
            "months_pregnant": months or (int(round(weeks / 4.33)) if weeks else None),
            "supplements": supplements_str,
        },
        "notes": f"Visit {visit_type.replace('_', ' ').title()} - {len(danger_result['danger_signs'])} danger sign(s) detected",
    }

    if visit_type == "anc_visit":
        base_form["pregnancy"] = {
            "lmp_date": None, "edd": None, "gestational_weeks": weeks,
            "gravida": None, "para": None, "previous_complications": None,
            "expected_delivery_place": None,
        }
        base_form["anc_details"] = {
            "visit_number": None, "facility_or_home": None, "urine_albumin": None,
            "urine_sugar": None, "blood_sugar_fasting": None, "blood_sugar_pp": None,
            "tt_dose_given": "yes" if "TT Injection" in supplements else None,
            "ifa_tablets_given": "yes" if "IFA Tablets" in supplements else None,
            "folic_acid_given": "yes" if "Folic Acid" in supplements else None,
            "fundal_height": None, "fetal_heart_rate": None, "fetal_presentation": None,
            "fetal_movements": "reduced" if any(
                d["sign"] == "Reduced fetal movement" for d in danger_result["danger_signs"]
            ) else None,
        }
        base_form["lab_results"] = {"blood_group": None, "hiv_status": None, "vdrl_status": None, "hbsag_status": None}
        base_form["birth_preparedness"] = {
            "facility_identified": None, "transport_arranged": None,
            "funds_saved": None, "blood_donor_identified": None, "escort_arranged": None,
        }
        base_form["next_visit_date"] = None
        return base_form

    if visit_type == "pnc_visit":
        base_form["visit_info"] = {"visit_day": None, "visit_date": None, "days_since_delivery": None}
        base_form["mother_assessment"] = {
            "general_condition": None, "temperature": vitals["temperature_celsius"],
            "vaginal_bleeding": "heavy" if any(
                d["sign"] == "Vaginal bleeding" for d in danger_result["danger_signs"]
            ) else None,
            "vaginal_discharge": None, "breast_condition": None,
            "uterine_tenderness": None, "wound_condition": None,
            "ifa_tablets_given": "yes" if "IFA Tablets" in supplements else None,
            "contraception_discussed": None, "contraception_method": None,
        }
        base_form["infant_assessment"] = {
            "weight_kg": vitals["weight_kg"], "temperature": vitals["temperature_celsius"],
            "feeding_status": "not_feeding_well" if any(
                d["sign"] == "Not feeding well" for d in danger_result["danger_signs"]
            ) else None,
            "breastfeeding_frequency": None,
            "cord_condition": "pus" if any(
                d["sign"] == "Umbilicus red / pus" for d in danger_result["danger_signs"]
            ) else None,
            "skin_condition": None,
            "jaundice": "mild" if any(
                d["sign"] == "Jaundice" for d in danger_result["danger_signs"]
            ) else None,
            "activity_level": "lethargic" if any(
                d["sign"] == "Lethargy / no movement" for d in danger_result["danger_signs"]
            ) else None,
            "cry": None, "breathing": None, "warmth_maintained": None,
            "immunization_status": None,
        }
        return base_form

    if visit_type == "delivery":
        base_form["delivery"] = {
            "date": None, "time": None, "place": None, "conducted_by": None,
            "type": None, "complications": None,
        }
        base_form["outcome"] = {"live_births": None, "stillbirths": None}
        base_form["infant"] = {
            "sex": None, "birth_weight_kg": vitals["weight_kg"], "term": None,
            "cried_at_birth": None, "breastfed_within_1hr": None, "birth_defects": None,
            "vaccines_given": {"opv_0": None, "bcg": None, "hep_b_0": None, "vitamin_k": None},
        }
        base_form["mother_status"] = {"condition": None, "complications": None, "ifa_given": None}
        return base_form

    # child_health
    base_form["child"] = {
        "name": demo["child_name"] or demo["patient_name"],
        "age_months": demo["child_age_months"] or (demo["patient_age"] * 12 if demo["patient_age"] else None),
        "sex": None,
        "weight_kg": vitals["weight_kg"],
    }
    base_form["visit_info"] = {"hbyc_visit_month": None, "visit_date": None}
    base_form["growth_assessment"] = {
        "weight_kg": vitals["weight_kg"], "weight_for_age": None,
        "visible_wasting": None, "edema_both_feet": None, "pallor": None,
    }
    base_form["feeding"] = {
        "breastfeeding_status": None, "complementary_feeding_started": None,
        "complementary_feeding_age_months": None, "diet_description": None,
    }
    base_form["immunization"] = {"up_to_date": None, "vaccines_due": [], "vaccines_given_today": []}
    base_form["development"] = {"milestones_appropriate": None, "concerns": None, "red_flags": []}
    base_form["illness_assessment"] = {
        "diarrhea": "दस्त" in transcript.lower() or "diarrhea" in transcript.lower(),
        "diarrhea_duration_days": None, "blood_in_stool": None,
        "cough": None, "fast_breathing": any(
            d["sign"] == "Fast breathing" for d in danger_result["danger_signs"]
        ), "fever": any(d["sign"] == "Fever" for d in danger_result["danger_signs"]),
        "fever_duration_days": None, "ear_problem": None,
        "not_eating_drinking": any(
            d["sign"] == "Not feeding well" for d in danger_result["danger_signs"]
        ), "vomiting_everything": None,
        "lethargic_unconscious": any(
            d["sign"] == "Lethargy / no movement" for d in danger_result["danger_signs"]
        ),
    }
    base_form["deworming"] = {"given": None, "date": None}
    base_form["vitamin_a"] = {"given": None, "dose_number": None}

    return base_form


def _deep_merge_forms(base: dict, extra: dict) -> dict:
    """Deep merge AI refined fields into base form without overwriting non-null values with nulls."""
    out = dict(base)
    for k, v in extra.items():
        if k not in out or out[k] is None:
            out[k] = v
        elif isinstance(out[k], dict) and isinstance(v, dict):
            out[k] = _deep_merge_forms(out[k], v)
        elif v is not None and (out[k] is None or out[k] == "" or out[k] == []):
            out[k] = v
    return out


def enhance_with_ai(transcript: str, visit_type: str, draft_form: dict, timeout_s: float = 4.0) -> dict:
    """Multi-provider AI enhancement via Gemma 4 12B / Ollama / Gemini / OpenAI.
    Gracefully degrades to the deterministic draft if no LLM is running."""
    try:
        from scheduler_ai import _call_llm_json
        sys_prompt = (
            "You are a clinical extraction engine for Indian ASHA home visits. "
            "Refine the draft JSON form using the transcript. Extract accurate patient name, age, mobile, "
            "vitals, symptoms, and gestational data. Only populate fields explicitly mentioned. "
            "Return valid JSON matching the draft schema."
        )
        user_prompt = f"Visit Type: {visit_type}\nTranscript:\n{transcript}\n\nCurrent Draft JSON:\n{json.dumps(draft_form, ensure_ascii=False)}"
        res = _call_llm_json(sys_prompt, user_prompt, timeout=timeout_s)
        if res and isinstance(res[0], dict):
            return _deep_merge_forms(draft_form, res[0])
    except Exception:
        pass
    return draft_form


def extract_all(transcript: str, visit_type: str, metadata: dict = None) -> dict:
    t0 = time.time()
    if not visit_type or visit_type == "auto":
        visit_type = detect_visit_type(transcript)

    danger = extract_danger_signs(transcript, visit_type)
    form = extract_form(transcript, visit_type, danger)
    form = enhance_with_ai(transcript, visit_type, form)
    form = apply_metadata(form, visit_type, metadata)

    next_visit_rec = None
    try:
        from scheduler_ai import suggest_next_visit
        p_name = (
            (form.get("patient") or {}).get("name")
            or (form.get("child") or {}).get("name")
            or (metadata or {}).get("patient_name")
            or "Beneficiary"
        )
        next_visit_rec = suggest_next_visit(
            patient_name=p_name,
            visit_type=visit_type,
            form_data=form,
            danger_signs=danger,
            transcript=transcript,
        )
        if next_visit_rec and next_visit_rec.get("recommended_date"):
            form["next_visit_date"] = next_visit_rec["recommended_date"]
    except Exception:
        pass

    return {
        "form": form,
        "danger": danger,
        "metadata": metadata,
        "next_visit_recommendation": next_visit_rec,
        "timing": {"extract_s": round(time.time() - t0, 3)},
    }


def apply_metadata(form: dict, visit_type: str, metadata: dict):
    """ASHA-entered header fields (name/age/mobile/etc.) override whatever the
    text extractor found — identifiers should never depend on keyword luck."""
    if not metadata:
        return form
    name = metadata.get("patient_name")
    mobile = metadata.get("patient_mobile")
    age = metadata.get("patient_age")

    if visit_type == "child_health":
        if name:
            form.setdefault("child", {})["name"] = name
        if age is not None:
            unit = metadata.get("age_unit")
            form.setdefault("child", {})["age_months"] = age * 12 if unit == "years" else age
    else:
        if name:
            form.setdefault("patient", {})["name"] = name
        if mobile:
            form.setdefault("patient", {})["mobile"] = mobile
        if age is not None:
            form.setdefault("patient", {})["age"] = age
    return form
