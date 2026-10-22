"""
Sukanya persistence layer — MongoDB (local mongod, no Atlas dependency).

Mirrors the shape of the original sqlite db.py (workers, visits, records,
settings) plus the new collections needed for the SIH round-2 feedback:
alerts, notifications, help_requests, beneficiaries.

IMPORTANT — id/timestamp contract with the frontend:
`shared/sakhi-api.js` and `shared/sakhi-app.js` treat every id and timestamp
as a plain JS Number: `Number(recordId)`, `records.find(x => x.id === recId)`,
`new Date(r.created_at * 1000)`. Mongo's native `_id` (ObjectId) and BSON
dates would silently break every one of those (NaN compares, Invalid Date).
So every document gets a small monotonic integer `id` (via the `counters`
collection) in addition to Mongo's internal `_id`, and every timestamp is
stored as epoch-seconds float via `time.time()` — never `datetime`/ISODate.
"""
import os
import time
import random
import string
from datetime import datetime

from pymongo import MongoClient, ASCENDING

MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:27017")
MONGO_DB_NAME = os.environ.get("MONGO_DB_NAME", "sukanya")

_client = None
_db = None


def get_db():
    global _client, _db
    if _db is None:
        _client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=3000)
        _db = _client[MONGO_DB_NAME]
    return _db


def init_db():
    db = get_db()
    db.workers.create_index([("mobile", ASCENDING)], unique=True)
    db.beneficiaries.create_index([("mobile", ASCENDING)], unique=True)
    db.sessions.create_index([("token", ASCENDING)], unique=True)
    db.visits.create_index([("worker_id", ASCENDING), ("scheduled_at", ASCENDING)])
    db.records.create_index([("worker_id", ASCENDING), ("created_at", ASCENDING)])
    db.records.create_index([("visit_id", ASCENDING)])
    db.alerts.create_index([("worker_id", ASCENDING), ("created_at", ASCENDING)])
    db.notifications.create_index([("created_at", ASCENDING)])
    db.help_requests.create_index([("created_at", ASCENDING)])
    return db


def _next_id(name: str) -> int:
    """Atomic auto-increment counter, mimicking sqlite's AUTOINCREMENT."""
    db = get_db()
    doc = db.counters.find_one_and_update(
        {"_id": name},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,
    )
    return doc["seq"]


def _strip_mongo_id(doc):
    if doc is None:
        return None
    doc = dict(doc)
    doc.pop("_id", None)
    return doc


# ── Auth (ASHA workers) ──
PIN_TTL_S = 5 * 60


def create_login_pin(mobile: str) -> str:
    db = get_db()
    pin = "".join(random.choices(string.digits, k=4))
    if not db.workers.find_one({"mobile": mobile}):
        db.workers.insert_one(
            {"id": _next_id("workers"), "mobile": mobile, "name": None, "created_at": time.time()}
        )
    db.login_pins.update_one(
        {"mobile": mobile},
        {"$set": {"pin": pin, "expires_at": time.time() + PIN_TTL_S}},
        upsert=True,
    )
    return pin


def verify_login_pin(mobile: str, pin: str):
    db = get_db()
    row = db.login_pins.find_one({"mobile": mobile})
    if not row or row["pin"] != pin or row["expires_at"] < time.time():
        return None, None
    worker = db.workers.find_one({"mobile": mobile})
    if not worker:
        return None, None
    token = "".join(random.choices(string.ascii_letters + string.digits, k=32))
    db.sessions.insert_one({"token": token, "worker_id": worker["id"], "created_at": time.time()})
    db.login_pins.delete_one({"mobile": mobile})
    return token, _strip_mongo_id(worker)


def get_worker_by_token(token: str):
    if not token:
        return None
    db = get_db()
    session = db.sessions.find_one({"token": token})
    if not session:
        return None
    worker = db.workers.find_one({"id": session["worker_id"]})
    return _strip_mongo_id(worker)


# ── Auth (beneficiaries — patients / household members) ──
def create_beneficiary_pin(mobile: str, name: str = None) -> str:
    db = get_db()
    pin = "".join(random.choices(string.digits, k=4))
    if not db.beneficiaries.find_one({"mobile": mobile}):
        db.beneficiaries.insert_one(
            {"id": _next_id("beneficiaries"), "mobile": mobile, "name": name, "created_at": time.time()}
        )
    db.login_pins.update_one(
        {"mobile": "ben:" + mobile},
        {"$set": {"pin": pin, "expires_at": time.time() + PIN_TTL_S}},
        upsert=True,
    )
    return pin


def verify_beneficiary_pin(mobile: str, pin: str):
    db = get_db()
    row = db.login_pins.find_one({"mobile": "ben:" + mobile})
    if not row or row["pin"] != pin or row["expires_at"] < time.time():
        return None, None
    beneficiary = db.beneficiaries.find_one({"mobile": mobile})
    if not beneficiary:
        return None, None
    token = "".join(random.choices(string.ascii_letters + string.digits, k=32))
    db.sessions.insert_one(
        {"token": token, "beneficiary_id": beneficiary["id"], "created_at": time.time()}
    )
    db.login_pins.delete_one({"mobile": "ben:" + mobile})
    return token, _strip_mongo_id(beneficiary)


def get_beneficiary_by_token(token: str):
    if not token:
        return None
    db = get_db()
    session = db.sessions.find_one({"token": token, "beneficiary_id": {"$exists": True}})
    if not session:
        return None
    beneficiary = db.beneficiaries.find_one({"id": session["beneficiary_id"]})
    return _strip_mongo_id(beneficiary)


def link_beneficiary_to_visits(mobile: str):
    """Beneficiary's own visits/records are matched by phone number against
    visits.patient_mobile / records.form.patient.mobile — the simplest join
    that needs no separate linking step from the ASHA side."""
    db = get_db()
    visits = list(db.visits.find({"patient_mobile": mobile}))
    return [_strip_mongo_id(v) for v in visits]


# ── Visits ──
def create_visit(
    worker_id,
    patient_name,
    visit_type,
    priority,
    scheduled_at,
    patient_mobile=None,
    time_slot=None,
    scheduled_date=None,
    notes=None,
    source="manual",
):
    db = get_db()
    if not scheduled_date and scheduled_at:
        scheduled_date = time.strftime("%Y-%m-%d", time.localtime(scheduled_at))

    doc = {
        "id": _next_id("visits"),
        "worker_id": worker_id,
        "patient_name": patient_name,
        "patient_mobile": patient_mobile,
        "visit_type": visit_type,
        "priority": priority,
        "scheduled_at": scheduled_at,
        "scheduled_date": scheduled_date,
        "time_slot": time_slot,
        "notes": notes,
        "source": source,
        "status": "pending",
        "created_at": time.time(),
    }
    db.visits.insert_one(doc)
    return doc["id"]


def seed_default_visits(worker_id: int):
    """Populates realistic initial visits and high-risk alerts for an ASHA worker's today catchment schedule."""
    db = get_db()
    today_str = datetime.now().strftime("%Y-%m-%d")
    now_ts = time.time()

    sample_visits = [
        {
            "patient_name": "Sunita Sharma",
            "patient_mobile": "9876543210",
            "visit_type": "anc_visit",
            "priority": "priority",
            "time_slot": "09:30",
            "scheduled_date": today_str,
            "notes": "34w High Risk ANC — Severe Headache, BP 155/100, Preeclampsia Monitoring",
            "source": "catchment_roster",
        },
        {
            "patient_name": "Anita Devi",
            "patient_mobile": "9812345678",
            "visit_type": "anc_visit",
            "priority": "routine",
            "time_slot": "11:00",
            "scheduled_date": today_str,
            "notes": "24w Routine ANC Follow-up, Hemoglobin Check & IFA Distribution",
            "source": "catchment_roster",
        },
        {
            "patient_name": "Pooja Kumari",
            "patient_mobile": "9823456789",
            "visit_type": "pnc_visit",
            "priority": "priority",
            "time_slot": "14:00",
            "scheduled_date": today_str,
            "notes": "Day 5 PNC Visit — Postpartum Fever, Wound Sepsis Triage",
            "source": "catchment_roster",
        },
        {
            "patient_name": "Rahul (Child of Radha)",
            "patient_mobile": "9834567890",
            "visit_type": "child_health",
            "priority": "routine",
            "time_slot": "16:30",
            "scheduled_date": today_str,
            "notes": "8-Month Growth Monitoring & Booster Immunization Assessment",
            "source": "catchment_roster",
        },
    ]

    inserted_ids = []
    for v in sample_visits:
        vid = create_visit(
            worker_id=worker_id,
            patient_name=v["patient_name"],
            visit_type=v["visit_type"],
            priority=v["priority"],
            scheduled_at=now_ts,
            patient_mobile=v["patient_mobile"],
            time_slot=v["time_slot"],
            scheduled_date=v["scheduled_date"],
            notes=v["notes"],
            source=v["source"],
        )
        inserted_ids.append(vid)

    # Also seed a high risk alert if no open alerts exist
    if not db.alerts.count_documents({"worker_id": worker_id, "status": "open"}):
        db.alerts.insert_one({
            "id": _next_id("alerts"),
            "worker_id": worker_id,
            "visit_id": inserted_ids[0] if inserted_ids else None,
            "record_id": None,
            "severity": "urgent",
            "title": "Sunita Sharma: Suspected Preeclampsia Alert (BP 155/100)",
            "detail": "High-risk gestational hypertension detected with severe headache. Priority morning home checkup recommended.",
            "status": "open",
            "created_at": now_ts,
        })
    return inserted_ids


def list_visits(worker_id=None, status=None, date_str=None):
    db = get_db()
    q = {}
    if worker_id is not None:
        q["worker_id"] = worker_id
    if status:
        q["status"] = status
    if date_str:
        q["$or"] = [
            {"scheduled_date": date_str},
            {
                "scheduled_at": {
                    "$gte": time.mktime(time.strptime(f"{date_str} 00:00:00", "%Y-%m-%d %H:%M:%S")),
                    "$lte": time.mktime(time.strptime(f"{date_str} 23:59:59", "%Y-%m-%d %H:%M:%S")),
                }
            },
        ]
    rows = db.visits.find(q)
    results = [_strip_mongo_id(r) for r in rows]

    def _sort_key(v):
        d = v.get("scheduled_date") or ""
        ts = str(v.get("time_slot") or "10:00")
        sat = v.get("scheduled_at") or 0
        return (d, ts, sat)

    results.sort(key=_sort_key)
    return results


def get_visit(visit_id):
    db = get_db()
    return _strip_mongo_id(db.visits.find_one({"id": visit_id}))


def update_visit_status(visit_id, status):
    db = get_db()
    try:
        vid_int = int(visit_id)
        q = {"$or": [{"id": vid_int}, {"id": str(visit_id)}]}
    except (ValueError, TypeError):
        q = {"id": str(visit_id)}
    db.visits.update_one(q, {"$set": {"status": status}})


def update_visit_priority(visit_id, priority):
    db = get_db()
    try:
        vid_int = int(visit_id)
        q = {"$or": [{"id": vid_int}, {"id": str(visit_id)}]}
    except (ValueError, TypeError):
        q = {"id": str(visit_id)}
    db.visits.update_one(q, {"$set": {"priority": priority}})


def batch_update_visit_slots(worker_id: int, updates: list[dict]):
    db = get_db()
    for u in updates:
        vid = u.get("id")
        if vid is None:
            continue
        fields = {}
        if "time_slot" in u:
            fields["time_slot"] = u["time_slot"]
        if "priority" in u:
            fields["priority"] = u["priority"]
        if "notes" in u:
            fields["notes"] = u["notes"]
        if "clinical_prep" in u:
            fields["notes"] = u["clinical_prep"]
        if "scheduled_date" in u:
            fields["scheduled_date"] = u["scheduled_date"]

        # Keep scheduled_at timestamp aligned with date and time
        date_val = u.get("scheduled_date")
        time_val = u.get("time_slot")
        if date_val and time_val:
            try:
                dt = datetime.strptime(f"{date_val} {time_val}", "%Y-%m-%d %H:%M")
                fields["scheduled_at"] = dt.timestamp()
            except Exception:
                pass

        if fields:
            try:
                vid_int = int(vid)
                q = {"$or": [{"id": vid_int}, {"id": str(vid)}]}
            except (ValueError, TypeError):
                q = {"id": str(vid)}
            if worker_id is not None:
                try:
                    w_int = int(worker_id)
                    wq = {"$or": [{"worker_id": w_int}, {"worker_id": str(worker_id)}]}
                except (ValueError, TypeError):
                    wq = {"worker_id": str(worker_id)}
                q = {"$and": [q, wq]}
            db.visits.update_one(q, {"$set": fields})


def delete_visit(visit_id: int, worker_id: int = None):
    db = get_db()
    try:
        vid_int = int(visit_id)
        q = {"$or": [{"id": vid_int}, {"id": str(visit_id)}]}
    except (ValueError, TypeError):
        q = {"id": str(visit_id)}
    if worker_id is not None:
        try:
            w_int = int(worker_id)
            wq = {"$or": [{"worker_id": w_int}, {"worker_id": str(worker_id)}]}
        except (ValueError, TypeError):
            wq = {"worker_id": str(worker_id)}
        q = {"$and": [q, wq]}
    res = db.visits.delete_one(q)
    return res.deleted_count > 0


# ── Records ──
def create_record(visit_id, worker_id, visit_type, form, danger, transcript, assessment=None, embedding=None, audio_base64=None, audio_mime_type=None):
    db = get_db()
    if isinstance(form, str):
        try:
            form = json.loads(form)
        except Exception:
            pass
    if isinstance(danger, str):
        try:
            danger = json.loads(danger)
        except Exception:
            pass

    doc = {
        "id": _next_id("records"),
        "visit_id": visit_id,
        "worker_id": worker_id,
        "visit_type": visit_type,
        "form_json": form,
        "danger_json": danger,
        "transcript": transcript,
        "assessment": assessment,
        "embedding": embedding,
        "audio_base64": audio_base64,
        "audio_mime_type": audio_mime_type or "audio/webm",
        "created_at": time.time(),
    }
    db.records.insert_one(doc)
    if visit_id is not None:
        try:
            vid_int = int(visit_id)
            vq = {"$or": [{"id": vid_int}, {"id": str(visit_id)}]}
        except (ValueError, TypeError):
            vq = {"id": str(visit_id)}
        db.visits.update_one(vq, {"$set": {"status": "completed"}})
    return doc["id"]


def _record_out(r):
    r = _strip_mongo_id(r)
    if r is not None:
        r.pop("embedding", None)  # large float vector — never needed by the UI
        form = r.pop("form_json", None) or r.get("form") or {}
        danger = r.pop("danger_json", None) or r.get("danger") or {}
        r["form"] = form
        r["danger"] = danger

        # Extract patient_name if not already present
        if "patient_name" not in r or not r["patient_name"]:
            if isinstance(form, dict):
                p = form.get("patient") or {}
                c = form.get("child") or {}
                if isinstance(p, dict) and p.get("name"):
                    r["patient_name"] = p.get("name")
                elif isinstance(c, dict) and c.get("name"):
                    r["patient_name"] = c.get("name")
                elif isinstance(p, str) and p:
                    r["patient_name"] = p
                elif form.get("name"):
                    r["patient_name"] = form.get("name")
    return r


def list_records(worker_id=None, visit_id=None):
    db = get_db()
    conditions = []
    if worker_id is not None:
        try:
            w_int = int(worker_id)
            conditions.append({"$or": [{"worker_id": w_int}, {"worker_id": str(worker_id)}]})
        except (ValueError, TypeError):
            conditions.append({"worker_id": str(worker_id)})
    if visit_id is not None:
        try:
            v_int = int(visit_id)
            conditions.append({"$or": [{"visit_id": v_int}, {"visit_id": str(visit_id)}]})
        except (ValueError, TypeError):
            conditions.append({"visit_id": str(visit_id)})

    if len(conditions) == 1:
        q = conditions[0]
    elif len(conditions) > 1:
        q = {"$and": conditions}
    else:
        q = {}

    rows = db.records.find(q).sort("created_at", -1)
    return [_record_out(r) for r in rows]


def get_record(record_id):
    db = get_db()
    try:
        r_int = int(record_id)
        q = {"$or": [{"id": r_int}, {"id": str(record_id)}]}
    except (ValueError, TypeError):
        q = {"id": str(record_id)}
    return _record_out(db.records.find_one(q))


def get_record_raw(record_id):
    """Includes embedding — for internal vector-search use only."""
    db = get_db()
    try:
        r_int = int(record_id)
        q = {"$or": [{"id": r_int}, {"id": str(record_id)}]}
    except (ValueError, TypeError):
        q = {"id": str(record_id)}
    return _strip_mongo_id(db.records.find_one(q))


def delete_record(record_id, worker_id=None):
    db = get_db()
    try:
        rid_int = int(record_id)
        q = {"$or": [{"id": rid_int}, {"id": str(record_id)}]}
    except (ValueError, TypeError):
        q = {"id": str(record_id)}
    if worker_id is not None:
        try:
            w_int = int(worker_id)
            wq = {"$or": [{"worker_id": w_int}, {"worker_id": str(worker_id)}]}
        except (ValueError, TypeError):
            wq = {"worker_id": str(worker_id)}
        q = {"$and": [q, wq]}
    res = db.records.delete_one(q)
    return res.deleted_count > 0


def all_records_with_embeddings():
    db = get_db()
    return [
        _strip_mongo_id(r)
        for r in db.records.find({"embedding": {"$ne": None}})
    ]


# ── Settings ──
def get_settings(worker_id):
    db = get_db()
    row = db.settings.find_one({"worker_id": worker_id})
    if not row:
        return {"worker_id": worker_id, "language": "en", "offline_mode": True, "notifications": True}
    return _strip_mongo_id(row)


def save_settings(worker_id, language, offline_mode, notifications):
    db = get_db()
    db.settings.update_one(
        {"worker_id": worker_id},
        {"$set": {"language": language, "offline_mode": bool(offline_mode), "notifications": bool(notifications)}},
        upsert=True,
    )


# ── Alerts (backend-generated — see alerts.py for the scoring logic) ──
def create_alert(worker_id, visit_id, record_id, severity, title, detail, source):
    db = get_db()
    doc = {
        "id": _next_id("alerts"),
        "worker_id": worker_id,
        "visit_id": visit_id,
        "record_id": record_id,
        "severity": severity,  # "urgent" | "priority" | "monitor"
        "title": title,
        "detail": detail,
        "source": source,  # "triage_rules" | "maternal_risk_model" | "condition_model" | "danger_signs"
        "status": "open",  # "open" | "acknowledged" | "resolved"
        "created_at": time.time(),
    }
    db.alerts.insert_one(doc)
    return doc["id"]


def list_alerts(worker_id=None, status=None):
    db = get_db()
    q = {}
    if worker_id is not None:
        q["worker_id"] = worker_id
    if status:
        q["status"] = status
    rows = db.alerts.find(q).sort("created_at", -1)
    return [_strip_mongo_id(r) for r in rows]


def update_alert_status(alert_id, status):
    db = get_db()
    db.alerts.update_one({"id": alert_id}, {"$set": {"status": status}})


# ── Notifications outbox (see notifications.py for provider dispatch) ──
def create_notification(channel, to, subject, body, meta=None):
    db = get_db()
    doc = {
        "id": _next_id("notifications"),
        "channel": channel,  # "whatsapp" | "sms" | "email" | "console"
        "to": to,
        "subject": subject,
        "body": body,
        "meta": meta or {},
        "status": "queued",
        "created_at": time.time(),
        "sent_at": None,
    }
    db.notifications.insert_one(doc)
    return doc["id"]


def mark_notification_sent(notification_id, ok, provider_detail=None):
    db = get_db()
    db.notifications.update_one(
        {"id": notification_id},
        {"$set": {"status": "sent" if ok else "failed", "sent_at": time.time(), "provider_detail": provider_detail}},
    )


def list_notifications(to=None, limit=50):
    db = get_db()
    q = {}
    if to is not None:
        q["to"] = to
    rows = db.notifications.find(q).sort("created_at", -1).limit(limit)
    return [_strip_mongo_id(r) for r in rows]


# ── Beneficiary help requests ──
def create_help_request(beneficiary_id, mobile, message, urgency="routine"):
    db = get_db()
    doc = {
        "id": _next_id("help_requests"),
        "beneficiary_id": beneficiary_id,
        "mobile": mobile,
        "message": message,
        "urgency": urgency,  # "routine" | "urgent"
        "status": "open",  # "open" | "acknowledged" | "resolved"
        "created_at": time.time(),
    }
    db.help_requests.insert_one(doc)
    return doc["id"]


def list_help_requests(status=None):
    db = get_db()
    q = {}
    if status:
        q["status"] = status
    rows = db.help_requests.find(q).sort("created_at", -1)
    return [_strip_mongo_id(r) for r in rows]


def update_help_request_status(request_id, status):
    db = get_db()
    db.help_requests.update_one({"id": request_id}, {"$set": {"status": status}})
