import pytest
import numpy as np
import sys, os

# Ensure backend dir is on python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from patient_risk_engine import (
    PatientRiskEngine,
    assess_patient,
    convert_blood_sugar_to_mmol,
    convert_temp_f_to_c,
    convert_temp_c_to_f
)


def test_unit_conversions():
    # Blood sugar
    assert convert_blood_sugar_to_mmol(180, "mg/dL") == pytest.approx(10.0, 0.1)
    assert convert_blood_sugar_to_mmol(180, "mg/dl") == pytest.approx(10.0, 0.1)
    assert convert_blood_sugar_to_mmol(15.0, "mmol/L") == pytest.approx(15.0, 0.01)
    # Auto-detection if unit unspecified: > 30 is almost certainly mg/dL
    assert convert_blood_sugar_to_mmol(180, None) == pytest.approx(10.0, 0.1)
    assert convert_blood_sugar_to_mmol(7.5, None) == pytest.approx(7.5, 0.01)

    # Temperature
    assert convert_temp_c_to_f(37.0) == pytest.approx(98.6, 0.1)
    assert convert_temp_f_to_c(98.6) == pytest.approx(37.0, 0.1)
    assert convert_temp_c_to_f(39.0) == pytest.approx(102.2, 0.1)


def test_feature_engineering():
    engine = PatientRiskEngine()
    features = engine.calculate_features(
        age=25,
        systolic_bp=130,
        diastolic_bp=80,
        heart_rate=86,
        spo2=98,
        blood_sugar_mmol=15.0,
        body_temp_f=98.0,
        body_temp_c=36.7,
        fall_detected=False
    )
    
    assert features["PulsePressure"] == 50
    assert features["MAP"] == pytest.approx(80 + 50/3, 0.01)
    assert features["ShockIndex"] == pytest.approx(86 / 130, 0.01)
    assert features["OxygenStrain"] == pytest.approx(86 / 98, 0.01)
    assert features["FallFlag"] == 0


def test_maternal_risk_model_prediction():
    engine = PatientRiskEngine()
    # High risk maternal sample (Hypertension + high sugar)
    res = engine.predict_maternal_risk(
        age=35,
        systolic_bp=145,
        diastolic_bp=95,
        blood_sugar_mmol=13.5,
        body_temp_f=98.6,
        heart_rate=88
    )
    assert res is not None
    assert res["prediction"] in ["high risk", "mid risk", "low risk"]
    assert "confidence" in res
    assert "probabilities" in res
    assert sum(res["probabilities"].values()) == pytest.approx(1.0, 0.05)


def test_condition_model_prediction():
    engine = PatientRiskEngine()
    # Diabetic/Hypertensive vitals sample
    res = engine.predict_condition(
        heart_rate=95,
        spo2=97,
        systolic_bp=140,
        diastolic_bp=90,
        body_temp_c=37.0,
        fall_detected=False
    )
    assert res is not None
    assert res["prediction"] in ["Asthma", "Diabetes Mellitus", "Healthy", "Heart Disease", "Hypertension"]
    assert "confidence" in res
    assert "probabilities" in res
    assert sum(res["probabilities"].values()) == pytest.approx(1.0, 0.05)


def test_clinical_rule_triage_severe_hypertension():
    engine = PatientRiskEngine()
    triage = engine.evaluate_clinical_rules({
        "Age": 28,
        "SystolicBP": 165,
        "DiastolicBP": 112,
        "HeartRate": 85,
        "BodyTemp": 98.6,
        "is_pregnant": True
    }, units="F", is_pregnant=True)

    assert "URGENT" in triage["triage_band"]
    assert triage["severity_score"] >= 3
    assert any("Severe-range hypertension" in i for i in triage["issues"])
    assert any("Screen for pre-eclampsia" in i for i in triage["issues"])


def test_clinical_rule_triage_sirs_sepsis():
    engine = PatientRiskEngine()
    triage = engine.evaluate_clinical_rules({
        "Age": 24,
        "SystolicBP": 110,
        "DiastolicBP": 70,
        "HeartRate": 115,
        "BodyTemp": 102.5,
        "is_pregnant": False
    }, units="F", is_pregnant=False)

    assert "URGENT" in triage["triage_band"]
    assert any("SIRS pattern" in i for i in triage["issues"])


def test_clinical_rule_triage_healthy_stable():
    engine = PatientRiskEngine()
    triage = engine.evaluate_clinical_rules({
        "Age": 26,
        "SystolicBP": 118,
        "DiastolicBP": 78,
        "HeartRate": 72,
        "SpO2": 98,
        "BodyTemp": 98.4,
        "BloodSugar": 5.4,
        "is_pregnant": False
    }, units="F", is_pregnant=False)

    assert "STABLE" in triage["triage_band"] or "ROUTINE" in triage["triage_band"]
    assert triage["severity_score"] == 0


def test_assess_patient_complete_synthesis():
    data = {
        "age": 29,
        "systolic_bp": 142,
        "diastolic_bp": 92,
        "heart_rate": 84,
        "spo2": 96.0,
        "body_temp": 98.6,
        "blood_sugar": 140,  # mg/dL
        "is_pregnant": True
    }
    result = assess_patient(data)
    
    assert "condition" in result
    assert "maternal_risk" in result
    assert "triage" in result
    assert "recommended_action" in result
    assert "suggested_next_visit_days" in result
    assert result["suggested_next_visit_days"] >= 1
