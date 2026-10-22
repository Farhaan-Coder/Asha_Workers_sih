import pytest
try:
    from backend import indic_numbers, extraction, translate_util
except (ImportError, ValueError):
    import indic_numbers
    import extraction
    import translate_util


def test_convert_indic_digits():
    assert indic_numbers.convert_indic_digits("वय २७ वर्षे") == "वय 27 वर्षे"
    assert indic_numbers.convert_indic_digits("बीपी १४०/९०") == "बीपी 140/90"
    assert indic_numbers.convert_indic_digits("वजन ५८.५ किलो") == "वजन 58.5 किलो"
    assert indic_numbers.convert_indic_digits("বয়স ২৭ বছর") == "বয়স 27 বছর"
    assert indic_numbers.convert_indic_digits("வயது ௨௭") == "வயது 27"


def test_parse_indic_spoken_number_marathi():
    assert indic_numbers.parse_indic_spoken_number("सत्तावीस") == 27
    assert indic_numbers.parse_indic_spoken_number("पंचवीस") == 25
    assert indic_numbers.parse_indic_spoken_number("अठ्ठावीस") == 28
    assert indic_numbers.parse_indic_spoken_number("तीस") == 30
    assert indic_numbers.parse_indic_spoken_number("पस्तीस") == 35
    assert indic_numbers.parse_indic_spoken_number("चाळीस") == 40
    assert indic_numbers.parse_indic_spoken_number("दोन") == 2
    assert indic_numbers.parse_indic_spoken_number("दहा") == 10
    assert indic_numbers.parse_indic_spoken_number("एकशे चाळीस") == 140
    assert indic_numbers.parse_indic_spoken_number("एकशे वीस") == 120
    assert indic_numbers.parse_indic_spoken_number("माझं वय सत्तावीस वर्षे आहे") == 27
    assert indic_numbers.parse_indic_spoken_number("वय पंचवीस") == 25
    assert indic_numbers.parse_indic_spoken_number("२७") == 27


def test_parse_indic_spoken_number_hindi():
    assert indic_numbers.parse_indic_spoken_number("सत्ताइस") == 27
    assert indic_numbers.parse_indic_spoken_number("पच्चीस") == 25
    assert indic_numbers.parse_indic_spoken_number("अट्ठाइस") == 28
    assert indic_numbers.parse_indic_spoken_number("एक सौ बीस") == 120
    assert indic_numbers.parse_indic_spoken_number("उम्र पच्चीस साल") == 25


def test_normalize_indic_numbers_in_text():
    text = "रुग्णाचे नाव अनिता, वय सत्तावीस वर्षे, रक्तदाब एकशे चाळीस बटा नव्वद, वजन अठ्ठावन्न किलो"
    norm = indic_numbers.normalize_indic_numbers_in_text(text)
    assert "27" in norm
    assert "140/90" in norm
    assert "58" in norm


def test_marathi_demographics_extraction():
    # Marathi patient age as word number
    transcript = "रुग्णाचे नाव अनिता कांबळे, वय सत्तावीस वर्षे, मोबाईल ९८७६५४३२१०"
    demo = extraction._extract_demographics(transcript)
    assert demo["patient_name"] == "अनिता कांबळे"
    assert demo["patient_age"] == 27
    assert demo["patient_mobile"] == "9876543210"

    # Standalone Marathi age input (e.g. dictated into age field)
    demo_single = extraction._extract_demographics("सत्तावीस")
    assert demo_single["patient_age"] == 27

    # Indic numerals age input
    demo_indic = extraction._extract_demographics("वय २७")
    assert demo_indic["patient_age"] == 27


def test_marathi_vitals_extraction():
    transcript = "रक्तदाब एकशे चाळीस बटा नव्वद, वजन ५८ किलो, नाडी बहात्तर, ताप १०२ डिग्री"
    vitals = extraction._extract_vitals(transcript)
    assert vitals["bp_systolic"] == 140
    assert vitals["bp_diastolic"] == 90
    assert vitals["weight_kg"] == 58.0
    assert vitals["heart_rate"] == 72


def test_translate_util_refinement():
    refined = translate_util.refine_english_clinical_transcript("Patient age 27 year old, BP 140 by 90, weight 58 kgs, pulse 72")
    assert "140/90 mmHg" in refined
    assert "Age: 27" in refined
    assert "58 kg" in refined
    assert "Pulse: 72 bpm" in refined
