"""
Notification outbox — the response to two SIH round-2 asks:

  "Give beneficiaries proactive updates: appointment information, schedules,
   reminders, and relevant health updates could be delivered through
   WhatsApp/SMS..."
  "Emergency workflow for ASHA workers: provide a dedicated emergency-services
   option that allows workers to quickly escalate critical cases..."

Every outbound message is written to the `notifications` collection first
(status="queued"), then handed to whichever provider is configured, which
flips it to "sent"/"failed". The UI's "sent messages" view (GET
/api/notifications) reads straight from that collection, so the whole
workflow is demoable and auditable without any real WhatsApp/SMS credentials.

Providers:
  - ConsoleProvider (default) — logs the message and marks it sent. Zero
    setup, zero credentials, always available.
  - TwilioWhatsAppProvider — used automatically when TWILIO_ACCOUNT_SID /
    TWILIO_AUTH_TOKEN / TWILIO_WHATSAPP_FROM are all set in the environment.
    Not required for the app to run; this is the swap-in path for a real
    deployment, not something judges need to configure to see the workflow.
"""
import os

import db


class ConsoleProvider:
    name = "console"

    def send(self, channel, to, subject, body):
        print(f"[notify:{channel}] to={to} subject={subject!r} body={body!r}")
        return True, "printed to server console (no real gateway configured)"


class TwilioWhatsAppProvider:
    name = "twilio_whatsapp"

    def __init__(self):
        from twilio.rest import Client  # imported lazily — optional dependency
        self._client = Client(os.environ["TWILIO_ACCOUNT_SID"], os.environ["TWILIO_AUTH_TOKEN"])
        self._from = os.environ["TWILIO_WHATSAPP_FROM"]

    def send(self, channel, to, subject, body):
        try:
            msg = self._client.messages.create(
                from_=f"whatsapp:{self._from}", to=f"whatsapp:{to}",
                body=f"{subject}\n\n{body}" if subject else body,
            )
            return True, msg.sid
        except Exception as e:
            return False, str(e)


def _get_provider():
    if all(os.environ.get(k) for k in ("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_WHATSAPP_FROM")):
        try:
            return TwilioWhatsAppProvider()
        except Exception as e:
            print(f"[notifications] Twilio configured but failed to init ({e!r}); falling back to console")
    return ConsoleProvider()


def send_notification(channel: str, to: str, subject: str, body: str, meta: dict = None) -> int:
    notification_id = db.create_notification(channel, to, subject, body, meta)
    provider = _get_provider()
    ok, detail = provider.send(channel, to, subject, body)
    db.mark_notification_sent(notification_id, ok, provider_detail=f"{provider.name}: {detail}")
    return notification_id


EMERGENCY_CONTACT = os.environ.get("SUKANYA_EMERGENCY_CONTACT", "+91-000-0000000")  # PHC/district duty line, demo default


def notify_emergency_contact(reason: str, visit_id, record_id, worker_id):
    return send_notification(
        channel="whatsapp",
        to=EMERGENCY_CONTACT,
        subject="URGENT: automated risk alert",
        body=(
            f"Automated backend scoring flagged an urgent case.\n"
            f"Worker ID: {worker_id} | Visit ID: {visit_id} | Record ID: {record_id}\n"
            f"Reason: {reason}\n"
            f"Please review and dispatch support if appropriate."
        ),
        meta={"visit_id": visit_id, "record_id": record_id, "worker_id": worker_id, "kind": "auto_alert"},
    )


def notify_beneficiary(mobile: str, subject: str, body: str, meta: dict = None):
    return send_notification(channel="whatsapp", to=mobile, subject=subject, body=body, meta=meta)
