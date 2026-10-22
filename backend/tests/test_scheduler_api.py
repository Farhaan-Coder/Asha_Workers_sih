import os, sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi.testclient import TestClient
import time
import pytest
from main import app
import db

client = TestClient(app)

@pytest.fixture
def auth_headers():
    db.init_db()
    mobile = "9876543210"
    pin = db.create_login_pin(mobile)
    token, worker = db.verify_login_pin(mobile, pin)
    return {"Authorization": f"Bearer {token}"}


def test_scheduler_status():
    res = client.get("/api/scheduler/status")
    assert res.status_code == 200
    data = res.json()
    assert "provider" in data
    assert "online" in data


def test_suggest_next_visit_endpoint(auth_headers):
    payload = {
        "patient_name": "Sushma Devi",
        "visit_type": "anc_visit",
        "form": {
            "patient": {"name": "Sushma Devi", "age": 28},
            "vitals": {"bp_systolic": 150, "bp_diastolic": 95}
        },
        "danger": {"danger_signs": [{"category": "urgent_care", "sign": "Headache"}]},
        "transcript": "Patient feels dizzy and headache. BP is 150/95."
    }
    res = client.post("/api/scheduler/suggest-next-visit", json=payload, headers=auth_headers)
    assert res.status_code == 200
    data = res.json()
    assert "recommended_date" in data
    assert "recommended_time" in data
    assert data["priority"] == "priority"


def test_allocate_tasks_endpoint(auth_headers):
    # First create two visits
    today_str = time.strftime("%Y-%m-%d")
    client.post("/api/visits", json={
        "patient_name": "Pooja Verma",
        "visit_type": "pnc_visit",
        "priority": "routine",
        "scheduled_at": time.time(),
        "scheduled_date": today_str
    }, headers=auth_headers)

    client.post("/api/visits", json={
        "patient_name": "Kavita Singh",
        "visit_type": "anc_visit",
        "priority": "priority",
        "scheduled_at": time.time(),
        "scheduled_date": today_str
    }, headers=auth_headers)

    res = client.post("/api/scheduler/allocate-tasks", json={"date": today_str}, headers=auth_headers)
    assert res.status_code == 200
    data = res.json()
    assert "allocated_schedule" in data
    assert len(data["allocated_schedule"]) >= 2
    # Ensure priority is first in the list
    assert data["allocated_schedule"][0]["priority"] == "priority"


def test_nl_schedule_endpoint(auth_headers):
    payload = {
        "prompt": "Schedule routine ANC checkup for Meera Devi next Wednesday at 11:00 AM"
    }
    res = client.post("/api/scheduler/nl-schedule", json=payload, headers=auth_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["ok"] is True
    assert "visit_id" in data
    assert "Meera" in data["visit"]["patient_name"]


def test_assess_patient_api_endpoint(auth_headers):
    payload = {
        "age": 32,
        "systolic_bp": 155,
        "diastolic_bp": 100,
        "heart_rate": 105,
        "spo2": 96.0,
        "body_temp": 101.5,
        "blood_sugar": 160,
        "blood_sugar_unit": "mg/dL",
        "is_pregnant": True
    }
    res = client.post("/api/assess-patient", json=payload, headers=auth_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "success"
    assert "condition" in data
    assert "maternal_risk" in data
    assert "triage" in data
    assert data["priority_label"] in ["HIGH RISK", "MODERATE RISK"]
    assert "URGENT" in data["triage"]["triage_band"] or "PRIORITY" in data["triage"]["triage_band"]


def test_update_visit_priority(auth_headers):
    # 1. Create a visit
    create_res = client.post(
        "/api/visits",
        json={
            "patient_name": "Radha Devi",
            "visit_type": "anc_visit",
            "priority": "routine",
            "time_slot": "10:00",
        },
        headers=auth_headers,
    )
    assert create_res.status_code == 200
    vid = create_res.json()["id"]

    # 2. Toggle priority to 'priority'
    patch_res = client.patch(
        f"/api/visits/{vid}/priority",
        json={"priority": "priority"},
        headers=auth_headers,
    )
    assert patch_res.status_code == 200
    assert patch_res.json()["ok"] is True
    assert patch_res.json()["priority"] == "priority"

    # 3. Verify in list
    list_res = client.get("/api/visits", headers=auth_headers)
    assert list_res.status_code == 200
    found = [v for v in list_res.json() if str(v.get("id")) == str(vid)]
    assert len(found) == 1
    assert found[0]["priority"] == "priority"


def test_ai_route_optimization(auth_headers):
    # Create sample morning routine & priority visits
    client.post(
        "/api/visits",
        json={"patient_name": "Kavita Bai", "visit_type": "anc_visit", "priority": "priority", "time_slot": "15:00"},
        headers=auth_headers,
    )
    client.post(
        "/api/visits",
        json={"patient_name": "Rani Kumari", "visit_type": "child_health", "priority": "routine", "time_slot": "09:00"},
        headers=auth_headers,
    )

    res = client.post(
        "/api/scheduler/allocate-tasks",
        json={"date": "2026-08-27"},
        headers=auth_headers,
    )
    assert res.status_code == 200
    data = res.json()
    assert "allocated_schedule" in data
    assert "kit_checklist" in data
    assert len(data["kit_checklist"]) > 0
    assert data["high_priority_count"] >= 1
    # Check that high priority visit is in morning slot
    sched = data["allocated_schedule"]
    prios = [s for s in sched if s["priority"] == "priority"]
    if prios:
        assert prios[0]["time_slot"] < "12:00"


def test_stored_records_lifecycle(auth_headers):
    # 1. Create a record with JSON string or dict
    rec_res = client.post(
        "/api/records",
        json={
            "visit_type": "anc_visit",
            "form": {
                "patient": {"name": "Laxmi Devi", "age": "26", "mobile": "9876543210"},
                "vitals": {"bp_systolic": 120, "bp_diastolic": 80, "weight_kg": 54}
            },
            "transcript": "Checking blood pressure and weight for Laxmi Devi.",
        },
        headers=auth_headers,
    )
    assert rec_res.status_code == 200
    rec_id = rec_res.json()["id"]

    # 2. Get record by ID
    get_res = client.get(f"/api/records/{rec_id}", headers=auth_headers)
    assert get_res.status_code == 200
    rec_data = get_res.json()
    assert rec_data["patient_name"] == "Laxmi Devi"
    assert rec_data["form"]["patient"]["name"] == "Laxmi Devi"

    # 3. List records
    list_res = client.get("/api/records", headers=auth_headers)
    assert list_res.status_code == 200
    records = list_res.json()
    assert any(str(r["id"]) == str(rec_id) for r in records)

    # 4. Delete record
    del_res = client.delete(f"/api/records/{rec_id}", headers=auth_headers)
    assert del_res.status_code == 200
    assert del_res.json()["success"] is True


def test_multilingual_translation_api():
    # 1. Translate to English
    res_en = client.post(
        "/api/translate",
        json={"text": "सुनीता देवी का ब्लड प्रेशर 120/80 है", "target_language": "en"},
    )
    assert res_en.status_code == 200
    data_en = res_en.json()
    assert "translated_text" in data_en
    assert data_en["target_language"] == "en"

    # 2. Translate to Hindi
    res_hi = client.post(
        "/api/translate",
        json={"text": "Patient Sunita Devi blood pressure is 120/80", "target_language": "hi"},
    )
    assert res_hi.status_code == 200
    data_hi = res_hi.json()
    assert "translated_text" in data_hi
    assert data_hi["target_language"] == "hi"

    # 3. Translate to Marathi
    res_mr = client.post(
        "/api/translate",
        json={"text": "Patient Sunita Devi blood pressure is 120/80", "target_language": "mr"},
    )
    assert res_mr.status_code == 200
    data_mr = res_mr.json()
    assert "translated_text" in data_mr
    assert data_mr["target_language"] == "mr"


def test_multilingual_quick_schedule(auth_headers):
    # Test English Quick Schedule
    res_en = client.post(
        "/api/scheduler/nl-schedule",
        json={"prompt": "Schedule high priority ANC visit for Sunita Devi tomorrow at 09:30"},
        headers=auth_headers,
    )
    assert res_en.status_code == 200
    v_en = res_en.json()["visit"]
    assert "Sunita" in v_en["patient_name"]
    assert v_en["priority"] == "priority"
    assert v_en["visit_type"] == "anc_visit"
    assert v_en["time_slot"] == "09:30"

    # Test Marathi Quick Schedule with Indic Digits
    res_mr = client.post(
        "/api/scheduler/nl-schedule",
        json={"prompt": "सुनीता देवीसाठी उद्या सकाळी १०:३० वाजता हाय प्रायोरिटी भेट शेड्यूल करा"},
        headers=auth_headers,
    )
    assert res_mr.status_code == 200
    v_mr = res_mr.json()["visit"]
    assert "Sunita" in v_mr["patient_name"] or "सुनीता" in v_mr["patient_name"] or "Devi" in v_mr["patient_name"]
    assert v_mr["priority"] == "priority"
    assert v_mr["time_slot"] == "10:30"


def test_stored_record_with_audio(auth_headers):
    mock_audio_b64 = "GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwH/////////FUmpZpkq17GDD0JATYCGQ2hyb21lV0GGQ2hyb21lFlSua8+5nwA="
    res = client.post(
        "/api/records",
        json={
            "visit_type": "anc_visit",
            "form": {
                "patient": {"name": "Meera Bai", "age": "24", "mobile": "9811122233"},
                "vitals": {"bp_systolic": 110, "bp_diastolic": 70, "weight_kg": 52}
            },
            "transcript": "Consultation with Meera Bai: BP normal at 110/70.",
            "audio_base64": mock_audio_b64,
            "audio_mime_type": "audio/webm",
        },
        headers=auth_headers,
    )
    assert res.status_code == 200
    rec_id = res.json()["id"]

    # Verify retrieved record contains the audio payload
    get_res = client.get(f"/api/records/{rec_id}", headers=auth_headers)
    assert get_res.status_code == 200
    data = get_res.json()
    assert data["audio_base64"] == mock_audio_b64
    assert data["audio_mime_type"] == "audio/webm"
    assert data["patient_name"] == "Meera Bai"

    # Cleanup
    client.delete(f"/api/records/{rec_id}", headers=auth_headers)


def test_seed_demo_visits_api(auth_headers):
    res = client.post("/api/visits/seed-demo", headers=auth_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["ok"] is True
    assert data["seeded_visits_count"] >= 4

    # Verify visits are returned
    list_res = client.get("/api/visits", headers=auth_headers)
    assert list_res.status_code == 200
    visits = list_res.json()
    assert len(visits) >= 4
    names = [v["patient_name"] for v in visits]
    assert "Sunita Sharma" in names
    assert "Anita Devi" in names




