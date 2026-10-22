"""
Automatic risk scoring + alerting — the direct response to the SIH round-2
judge feedback:

  "Strengthen the ML layer: make the system more intelligent so that risk
   identification, prioritisation, and recommendations are increasingly
   handled by the backend rather than relying on the ASHA worker... Add
   anomaly and health-hazard detection: build a backend intelligence layer
   that can identify abnormal patterns, potential health risks, and
   high-risk cases and automatically generate alerts for appropriate
   intervention."

Before this module, `predict_triage` / `predict_maternal_risk` /
`predict_condition` existed as callable endpoints but nothing on the save
path ever called them — the ASHA worker had to manually decide a visit was
high-priority. `score_and_alert()` runs unconditionally inside
`POST /api/records`, so every saved record is scored the moment it's
created, with zero extra taps from the ASHA worker.
"""
import time

import db
import risk_models
import triage_rules
from notifications import notify_emergency_contact

VITALS_PATHS = {
    "anc_visit": "vitals",
    "pnc_visit": None,  # PNC schema splits vitals across mother_assessment/infant_assessment — no single flat block
    "delivery": None,
    "child_health": None,
}


def _num(value):
    """Coerce a form value to float, or None if it isn't numeric.

    Health record forms hand back plain strings for every input regardless
    of visible type (`collectFormFromDOM` in shared/sakhi-record.js only
    parses fields tagged `data-sukanya-format="weeks"/"months"/"list"` —
    everything else, including BP/weight/heart-rate/SpO2 number inputs,
    arrives as a string). triage_rules and risk_models both do numeric
    comparisons (`sbp >= 160`) that raise TypeError on a str, so every vital
    is coerced here before it reaches them, once, at the scoring boundary —
    rather than requiring every caller of extraction.py or the frontend to
    remember to send numbers.
    """
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _get_anc_vitals(form: dict):
    v = (form or {}).get("vitals") or {}
    return {k: _num(val) for k, val in v.items()}


def score_record(visit_type: str, form: dict, danger: dict) -> dict:
    """Runs every available automated check against one saved record.
    Returns an `assessment` dict stored alongside the record and used to
    decide whether an alert fires. Never raises — a model/rule that can't
    run on this record's fields is simply omitted (e.g. "insufficient_vitals"),
    not treated as an error."""
    assessment = {"triage": None, "maternal_risk": None, "condition": None, "danger_band": None}

    if visit_type == "anc_visit":
        v = _get_anc_vitals(form)
        age = _num((form.get("patient") or {}).get("age"))
        bs = _num((form.get("anc_details") or {}).get("blood_sugar_fasting"))
        assessment["triage"] = triage_rules.assess_vitals(
            systolic_bp=v.get("bp_systolic"), diastolic_bp=v.get("bp_diastolic"),
            heart_rate=v.get("heart_rate"), body_temp=v.get("temperature_celsius"), temp_unit="C",
            spo2=v.get("spo2"),
            blood_sugar=bs,
            blood_sugar_unit="mg/dL",
            age=int(age) if age is not None else None, pregnant=True,
        )

        if all(v.get(k) is not None for k in ("bp_systolic", "bp_diastolic", "heart_rate")):
            if age is not None and bs is not None and v.get("temperature_celsius") is not None:
                assessment["maternal_risk"] = risk_models.predict_maternal_risk(
                    age=age, systolic_bp=v["bp_systolic"], diastolic_bp=v["bp_diastolic"],
                    blood_sugar=bs, blood_sugar_unit="mg/dL",
                    body_temp_c=v["temperature_celsius"], heart_rate=v["heart_rate"],
                )
        if all(v.get(k) is not None for k in ("heart_rate", "spo2", "bp_systolic", "bp_diastolic", "temperature_celsius")):
            assessment["condition"] = risk_models.predict_condition(
                heart_rate=v["heart_rate"], spo2=v["spo2"], systolic_bp=v["bp_systolic"],
                diastolic_bp=v["bp_diastolic"], body_temp_c=v["temperature_celsius"], fall_flag=0,
            )

    if danger and danger.get("danger_signs"):
        categories = [d["category"] for d in danger["danger_signs"]]
        if "immediate_referral" in categories:
            assessment["danger_band"] = "immediate_referral"
        elif "urgent_care" in categories:
            assessment["danger_band"] = "urgent_care"
        else:
            assessment["danger_band"] = "monitor_closely"

    return assessment


def _is_urgent(assessment: dict) -> tuple[bool, list[str]]:
    reasons = []
    triage = assessment.get("triage") or {}
    if triage.get("triage_band") == "URGENT - clinician review":
        reasons.append(f"Triage rules: {triage.get('issue_count')} urgent finding(s) — " +
                        "; ".join(i["finding"] for i in triage.get("issues", []) if i["severity"] == "urgent"))

    maternal = assessment.get("maternal_risk") or {}
    if maternal.get("risk_level") == "high risk":
        prob = maternal.get("probabilities", {}).get("high risk")
        reasons.append(f"Maternal risk model: high risk ({prob:.0%} confidence)" if prob else "Maternal risk model: high risk")

    condition = assessment.get("condition") or {}
    if condition.get("condition") not in (None, "Healthy"):
        prob = condition.get("probabilities", {}).get(condition["condition"])
        reasons.append(f"Condition model: {condition['condition']} ({prob:.0%} confidence)" if prob else f"Condition model: {condition['condition']}")

    if assessment.get("danger_band") == "immediate_referral":
        reasons.append("Danger-sign checklist: immediate referral criteria met")

    return (len(reasons) > 0), reasons


def _is_priority(assessment: dict) -> tuple[bool, list[str]]:
    reasons = []
    triage = assessment.get("triage") or {}
    if triage.get("triage_band") == "PRIORITY - same-day review":
        reasons.append("Triage rules: same-day review recommended")
    maternal = assessment.get("maternal_risk") or {}
    if maternal.get("risk_level") == "mid risk":
        reasons.append("Maternal risk model: mid risk")
    if assessment.get("danger_band") == "urgent_care":
        reasons.append("Danger-sign checklist: urgent care criteria met")
    return (len(reasons) > 0), reasons


def score_and_alert(worker_id: int, visit_id: int, record_id: int, visit_type: str, form: dict, danger: dict) -> dict:
    """Called synchronously from POST /api/records. Scores the record, and
    when the score crosses a threshold: (1) inserts an `alerts` document,
    (2) flips the linked visit's priority to "priority" so the home
    dashboard's existing "N High Priority Visits" counter reflects the
    backend's decision with no frontend change required, (3) queues a
    notification to the configured emergency/PHC contact for urgent cases."""
    assessment = score_record(visit_type, form, danger)

    urgent, urgent_reasons = _is_urgent(assessment)
    priority, priority_reasons = _is_priority(assessment)

    alert_id = None
    if urgent:
        alert_id = db.create_alert(
            worker_id, visit_id, record_id, "urgent",
            title="Urgent: automated risk flag",
            detail=" | ".join(urgent_reasons),
            source="auto_scoring",
        )
        if visit_id:
            db.update_visit_priority(visit_id, "priority")
        notify_emergency_contact(
            reason=" | ".join(urgent_reasons),
            visit_id=visit_id, record_id=record_id, worker_id=worker_id,
        )
    elif priority:
        alert_id = db.create_alert(
            worker_id, visit_id, record_id, "priority",
            title="Priority: elevated risk detected",
            detail=" | ".join(priority_reasons),
            source="auto_scoring",
        )
        if visit_id:
            db.update_visit_priority(visit_id, "priority")

    return {"assessment": assessment, "alert_id": alert_id, "urgent": urgent, "priority": priority}
