"""
Tests for DB scheduling and visit management extensions in backend/db.py.
"""
import time
import os
import sys
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import db


@pytest.fixture(autouse=True)
def init_database():
    db.init_db()


def test_create_and_query_visit_with_slots():
    worker_id = 999
    scheduled_at = time.time() + 86400
    date_str = time.strftime("%Y-%m-%d", time.localtime(scheduled_at))

    visit_id = db.create_visit(
        worker_id=worker_id,
        patient_name="Pooja Sharma",
        visit_type="anc_visit",
        priority="priority",
        scheduled_at=scheduled_at,
        patient_mobile="9876543210",
        time_slot="10:30 AM",
        scheduled_date=date_str,
        notes="High risk BP follow-up",
        source="ai_allocated"
    )

    assert isinstance(visit_id, int)
    visit = db.get_visit(visit_id)
    assert visit is not None
    assert visit["patient_name"] == "Pooja Sharma"
    assert visit["time_slot"] == "10:30 AM"
    assert visit["scheduled_date"] == date_str
    assert visit["notes"] == "High risk BP follow-up"
    assert visit["source"] == "ai_allocated"

    # Query visits by date
    visits_on_date = db.list_visits(worker_id=worker_id, date_str=date_str)
    assert len(visits_on_date) >= 1
    assert any(v["id"] == visit_id for v in visits_on_date)


def test_batch_update_visit_slots():
    worker_id = 999
    v1 = db.create_visit(worker_id, "Patient A", "anc_visit", "routine", time.time())
    v2 = db.create_visit(worker_id, "Patient B", "pnc_visit", "priority", time.time())

    updates = [
        {"id": v1, "time_slot": "01:30 PM", "notes": "Shifted to afternoon"},
        {"id": v2, "time_slot": "09:00 AM", "notes": "Prioritized morning"}
    ]

    db.batch_update_visit_slots(worker_id, updates)

    visit_a = db.get_visit(v1)
    visit_b = db.get_visit(v2)
    assert visit_a["time_slot"] == "01:30 PM"
    assert visit_a["notes"] == "Shifted to afternoon"
    assert visit_b["time_slot"] == "09:00 AM"
    assert visit_b["notes"] == "Prioritized morning"
