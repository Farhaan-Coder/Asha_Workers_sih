"""
Tests for advanced transcript extraction, patient demographics, vitals,
danger signs, multi-page form compatibility, and multi-provider AI refinement.
"""
import pytest
import sys
import os

# Add backend directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import extraction


def test_extract_patient_demographics_hindi():
    transcript = (
        "ASHA: नमस्ते अनीता देवी जी, आपकी उम्र 24 साल है ना?\n"
        "Patient: हाँ दीदी। मेरा मोबाइल नंबर 9876543210 है।"
    )
    res = extraction.extract_all(transcript, "anc_visit")
    form = res["form"]
    
    assert form["patient"]["name"] == "अनीता देवी" or "अनीता" in form["patient"]["name"]
    assert form["patient"]["age"] == 24
    assert form["patient"]["mobile"] == "9876543210"


def test_extract_patient_demographics_english():
    transcript = (
        "ASHA: Hello, what is your name and age?\n"
        "Patient: My name is Sunita Sharma and age is 28 years. Phone number is 9812345678."
    )
    res = extraction.extract_all(transcript, "anc_visit")
    form = res["form"]
    
    assert "Sunita" in (form["patient"]["name"] or "")
    assert form["patient"]["age"] == 28
    assert form["patient"]["mobile"] == "9812345678"


def test_extract_pregnancy_months_and_weeks():
    transcript = "ASHA: आप कितने महीने की गर्भवती हैं?\nPatient: दीदी, 6 महीने हो गए हैं।"
    res = extraction.extract_all(transcript, "anc_visit")
    form = res["form"]
    
    # Should populate gestational_weeks (~24 to 26 weeks) or gestational_months
    assert form["pregnancy"]["gestational_weeks"] is not None
    assert 24 <= form["pregnancy"]["gestational_weeks"] <= 26
    # Convenience flat alias for Part 2 & Smart Form
    assert form.get("maternal", {}).get("months_pregnant") in [6, "6", 24, 25, 26]


def test_extract_supplements_and_counseling():
    transcript = "ASHA: क्या आप IFA की गोलियां और कैल्शियम ले रही हैं?\nPatient: हाँ दीदी, रोज़ ले रही हूँ।"
    res = extraction.extract_all(transcript, "anc_visit")
    form = res["form"]
    
    supplements = form.get("maternal", {}).get("supplements", "") or form.get("counseling_provided", [])
    assert any("IFA" in str(s) or "iron" in str(s).lower() or "calcium" in str(s).lower() for s in (supplements if isinstance(supplements, list) else [supplements]))


def test_extract_general_health_and_symptoms_alias():
    transcript = (
        "Patient: दीदी, मुझे बहुत तेज़ सिरदर्द है और चक्कर आ रहे हैं।\n"
        "ASHA: आपका बीपी 150/95 है।"
    )
    res = extraction.extract_all(transcript, "anc_visit")
    form = res["form"]
    
    # Check that both symptoms_reported AND general.symptoms / symptoms aliases exist
    assert len(form.get("symptoms_reported", [])) > 0
    assert "Severe headache" in form.get("symptoms_reported", [])
    assert form.get("symptoms") is not None or form.get("general", {}).get("problems") is not None


def test_child_health_extraction():
    transcript = "ASHA: बच्चे का नाम राहुल है और उम्र 8 महीने है। वजन 7.5 kg है।"
    res = extraction.extract_all(transcript, "child_health")
    form = res["form"]
    
    assert form["child"]["name"] == "राहुल" or "राहुल" in str(form["child"]["name"])
    assert form["child"]["age_months"] == 8
    assert form["child"]["weight_kg"] == 7.5
    assert form["vitals"]["weight_kg"] == 7.5


def test_metadata_override():
    transcript = "Patient: मेरा नाम अनीता है, उम्र 20 साल है।"
    metadata = {"patient_name": "Sita Devi", "patient_age": 25, "patient_mobile": "9999988888"}
    res = extraction.extract_all(transcript, "anc_visit", metadata=metadata)
    form = res["form"]
    
    # Metadata should override transcript
    assert form["patient"]["name"] == "Sita Devi"
    assert form["patient"]["age"] == 25
    assert form["patient"]["mobile"] == "9999988888"
