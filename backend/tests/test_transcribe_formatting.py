"""
Tests for dialogue turn formatting and transcript enhancement in backend/transcribe.py.
"""
import pytest
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import transcribe


def test_format_dialogue_turns_heuristic():
    raw = (
        "नमस्ते अनीता जी कैसी हैं आप? "
        "दीदी मुझे कल से बहुत सिरदर्द हो रहा है। "
        "अच्छा मैं आपका बीपी चेक करती हूँ आपका बीपी 155/100 है। "
        "क्या यह खतरनाक है दीदी? "
        "हाँ आपको तुरंत अस्पताल जाना होगा।"
    )
    formatted = transcribe.format_dialogue_turns(raw)
    
    assert "ASHA:" in formatted
    assert "Patient:" in formatted or "Mother:" in formatted or "Speaker" in formatted
    assert "155/100" in formatted


def test_preserve_existing_speaker_labels():
    raw = "ASHA: नमस्ते दीदी।\n\nPatient: नमस्ते, मैं ठीक हूँ।"
    formatted = transcribe.format_dialogue_turns(raw)
    assert formatted.startswith("ASHA:")
    assert "Patient:" in formatted
