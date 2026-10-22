"""
Unit and integration tests for backend/scheduler_ai.py
Testing AI-driven next visit suggestion, daily calendar task allocation,
and natural language scheduling with Gemma 4 12B / local runner / NHM fallback.
"""
import pytest
from datetime import datetime, timedelta

import scheduler_ai


def test_suggest_next_visit_high_risk_anc():
    """High risk maternal condition (severe BP 155/100) must trigger urgent follow-up within 3-7 days."""
    form_data = {
        "patient": {"name": "Sushma Devi", "age": 28},
        "vitals": {"bp_systolic": 155, "bp_diastolic": 100, "heart_rate": 88, "temperature_celsius": 37.0},
        "anc_details": {"gestational_age_weeks": 28}
    }
    danger_signs = {"danger_signs": [{"category": "urgent_care", "sign": "Severe headache & blurred vision"}]}
    assessment = {"triage": {"status": "urgent", "flag": "Hypertension Stage 2"}, "danger_band": "urgent_care"}
    transcript = "Patient reports severe headache and blurry vision. BP is 155/100."

    res = scheduler_ai.suggest_next_visit(
        patient_name="Sushma Devi",
        visit_type="anc_visit",
        form_data=form_data,
        danger_signs=danger_signs,
        assessment=assessment,
        transcript=transcript,
    )

    assert "recommended_date" in res
    assert "recommended_time" in res
    assert res["priority"] == "priority"
    assert "reason" in res
    assert len(res.get("suggested_actions", [])) > 0

    # Ensure recommended date is within 7 days from today
    rec_date = datetime.strptime(res["recommended_date"], "%Y-%m-%d").date()
    today = datetime.now().date()
    days_diff = (rec_date - today).days
    assert 1 <= days_diff <= 7, f"High risk ANC must be within 1-7 days, got {days_diff} days"


def test_suggest_next_visit_routine_anc():
    """Routine normal ANC visit (gestational age 16 weeks, normal BP) should be scheduled in ~4 weeks."""
    form_data = {
        "patient": {"name": "Anita Sharma", "age": 24},
        "vitals": {"bp_systolic": 110, "bp_diastolic": 70, "heart_rate": 74, "temperature_celsius": 36.6},
        "anc_details": {"gestational_age_weeks": 16}
    }
    res = scheduler_ai.suggest_next_visit(
        patient_name="Anita Sharma",
        visit_type="anc_visit",
        form_data=form_data,
        danger_signs={},
        assessment={"triage": {"status": "normal"}, "danger_band": None},
        transcript="Normal routine ANC checkup.",
    )

    assert res["priority"] == "routine"
    rec_date = datetime.strptime(res["recommended_date"], "%Y-%m-%d").date()
    today = datetime.now().date()
    days_diff = (rec_date - today).days
    assert days_diff >= 14, f"Routine ANC should be scheduled >= 2 weeks out, got {days_diff} days"


def test_suggest_next_visit_pnc_newborn():
    """PNC newborn with fever (100.5F) should be scheduled for immediate/urgent follow-up."""
    form_data = {
        "patient": {"name": "Kavita Devi", "age": 22},
        "infant_assessment": {"temperature_celsius": 38.1, "feeding": "poor"}
    }
    danger_signs = {"danger_signs": [{"category": "immediate_referral", "sign": "High fever & not feeding"}]}

    res = scheduler_ai.suggest_next_visit(
        patient_name="Kavita Devi",
        visit_type="pnc_visit",
        form_data=form_data,
        danger_signs=danger_signs,
        assessment={"danger_band": "immediate_referral"},
        transcript="Newborn has fever and poor feeding.",
    )

    assert res["priority"] == "priority"
    rec_date = datetime.strptime(res["recommended_date"], "%Y-%m-%d").date()
    today = datetime.now().date()
    days_diff = (rec_date - today).days
    assert 1 <= days_diff <= 3


def test_allocate_daily_tasks():
    """Task allocation should sort high priority visits earlier in the day and assign valid time slots."""
    visits = [
        {"id": 1, "patient_name": "Ravi Kumar", "visit_type": "child_health", "priority": "routine", "scheduled_at": 1700000000},
        {"id": 2, "patient_name": "Sushma Devi", "visit_type": "anc_visit", "priority": "priority", "scheduled_at": 1700000000},
        {"id": 3, "patient_name": "Pooja Verma", "visit_type": "pnc_visit", "priority": "routine", "scheduled_at": 1700000000},
    ]

    target_date = datetime.now().strftime("%Y-%m-%d")
    result = scheduler_ai.allocate_daily_tasks(target_date, visits)

    assert "allocated_schedule" in result
    schedule = result["allocated_schedule"]
    assert len(schedule) == 3

    # Priority visit should be scheduled first
    assert schedule[0]["patient_name"] == "Sushma Devi"
    assert schedule[0]["priority"] == "priority"
    assert "time_slot" in schedule[0]
    assert "clinical_prep" in schedule[0]


def test_parse_natural_language_schedule():
    """NL parsing should extract patient name, visit type, priority, and date."""
    prompt = "Schedule high priority ANC follow-up for Sunita Devi next Tuesday at 10:30 AM"
    parsed = scheduler_ai.parse_natural_language_schedule(prompt)

    assert "Sunita" in parsed["patient_name"]
    assert parsed["visit_type"] == "anc_visit"
    assert parsed["priority"] == "priority"
    assert "10:30" in parsed.get("time_slot", "")
    assert "scheduled_date" in parsed
