"""
patient_risk_engine.py
======================
Clinical Machine Learning and Rule-Based Patient Risk & Triage Engine.

Integrates:
1. `model_condition.joblib` (XGBoost Classifier for general health condition)
2. `model_maternal_risk.joblib` (SVM-RBF Pipeline for maternal risk tier)
3. Clinical Triage Rules (Syndromic surveillance: Pre-eclampsia, Sepsis/SIRS, Shock, Hypoxaemia)
"""

import os
import logging
import joblib
import numpy as np

logger = logging.getLogger(__name__)

MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")
MODEL_CONDITION_PATH = os.path.join(MODELS_DIR, "model_condition.joblib")
MODEL_MATERNAL_PATH = os.path.join(MODELS_DIR, "model_maternal_risk.joblib")

# Fallback paths if not found in backend/models
DOWNLOADS_DIR = os.path.expanduser("~/Downloads")
FALLBACK_MODEL_CONDITION = os.path.join(DOWNLOADS_DIR, "model_condition.joblib")
FALLBACK_MODEL_MATERNAL = os.path.join(DOWNLOADS_DIR, "model_maternal_risk.joblib")


def convert_blood_sugar_to_mmol(val, unit=None) -> float:
    """Normalize blood sugar value to mmol/L."""
    if val is None:
        return 5.5
    try:
        fval = float(val)
        if fval <= 0:
            return 5.5
        # If explicitly marked as mg/dL, or if value > 30 (unlikely to be mmol/L), convert
        if (unit and "mg" in str(unit).lower()) or fval > 30:
            return round(fval / 18.0, 2)
        return round(fval, 2)
    except (ValueError, TypeError):
        return 5.5


def convert_temp_f_to_c(f_val: float) -> float:
    """Convert Fahrenheit to Celsius."""
    return round((float(f_val) - 32.0) * 5.0 / 9.0, 2)


def convert_temp_c_to_f(c_val: float) -> float:
    """Convert Celsius to Fahrenheit."""
    return round(float(c_val) * 9.0 / 5.0 + 32.0, 2)


def normalize_temperature(temp_val, default_f=98.6) -> tuple[float, float]:
    """
    Returns (temp_in_F, temp_in_C).
    Heuristic: if value < 50, it's likely Celsius; if >= 50, Fahrenheit.
    """
    if temp_val is None:
        return (default_f, convert_temp_f_to_c(default_f))
    try:
        t = float(temp_val)
        if t <= 0:
            return (default_f, convert_temp_f_to_c(default_f))
        if t < 50.0:
            # Celsius provided
            return (convert_temp_c_to_f(t), round(t, 2))
        else:
            # Fahrenheit provided
            return (round(t, 2), convert_temp_f_to_c(t))
    except (ValueError, TypeError):
        return (default_f, convert_temp_f_to_c(default_f))


SEVERITY_WEIGHTS = {"info": 0, "monitor": 1, "concerning": 2, "urgent": 3}


class PatientRiskEngine:
    _instance = None

    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            cls._instance = super(PatientRiskEngine, cls).__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._load_models()
        self._initialized = True

    def _load_models(self):
        self.cond_dict = None
        self.mat_dict = None

        # Load condition model
        cond_path = MODEL_CONDITION_PATH if os.path.exists(MODEL_CONDITION_PATH) else FALLBACK_MODEL_CONDITION
        if os.path.exists(cond_path):
            try:
                self.cond_dict = joblib.load(cond_path)
                logger.info(f"Loaded Condition model from {cond_path}")
            except Exception as e:
                logger.error(f"Failed to load condition model from {cond_path}: {e}")

        # Load maternal risk model
        mat_path = MODEL_MATERNAL_PATH if os.path.exists(MODEL_MATERNAL_PATH) else FALLBACK_MODEL_MATERNAL
        if os.path.exists(mat_path):
            try:
                self.mat_dict = joblib.load(mat_path)
                logger.info(f"Loaded Maternal Risk model from {mat_path}")
            except Exception as e:
                logger.error(f"Failed to load maternal model from {mat_path}: {e}")

    def calculate_features(
        self,
        age: float = 25.0,
        systolic_bp: float = 120.0,
        diastolic_bp: float = 80.0,
        heart_rate: float = 75.0,
        spo2: float = 98.0,
        blood_sugar_mmol: float = 5.5,
        body_temp_f: float = 98.6,
        body_temp_c: float = 37.0,
        fall_detected: bool = False
    ) -> dict:
        sbp = float(systolic_bp) if systolic_bp else 120.0
        dbp = float(diastolic_bp) if diastolic_bp else 80.0
        hr = float(heart_rate) if heart_rate else 75.0
        o2 = float(spo2) if spo2 else 98.0
        
        pulse_pressure = sbp - dbp
        map_val = dbp + pulse_pressure / 3.0
        shock_index = hr / max(sbp, 1.0)
        oxygen_strain = hr / max(o2, 1.0)
        fall_flag = 1 if fall_detected in (True, 1, "Yes", "true", "1") else 0

        return {
            "Age": float(age) if age else 25.0,
            "SystolicBP": sbp,
            "DiastolicBP": dbp,
            "HeartRate": hr,
            "SpO2": o2,
            "BloodSugar": float(blood_sugar_mmol) if blood_sugar_mmol else 5.5,
            "BodyTemp_F": float(body_temp_f),
            "BodyTemp_C": float(body_temp_c),
            "FallFlag": fall_flag,
            "PulsePressure": pulse_pressure,
            "MAP": map_val,
            "ShockIndex": shock_index,
            "OxygenStrain": oxygen_strain,
        }

    def predict_condition(
        self,
        heart_rate: float = 75.0,
        spo2: float = 98.0,
        systolic_bp: float = 120.0,
        diastolic_bp: float = 80.0,
        body_temp_c: float = 37.0,
        fall_detected: bool = False
    ) -> dict:
        """Predict general health condition using XGBoost model."""
        feats = self.calculate_features(
            systolic_bp=systolic_bp,
            diastolic_bp=diastolic_bp,
            heart_rate=heart_rate,
            spo2=spo2,
            body_temp_c=body_temp_c,
            fall_detected=fall_detected
        )

        if not self.cond_dict or "model" not in self.cond_dict:
            # Heuristic fallback if model not loaded
            sbp, dbp = feats["SystolicBP"], feats["DiastolicBP"]
            if sbp >= 140 or dbp >= 90:
                pred = "Hypertension"
            elif feats["SpO2"] < 92:
                pred = "Asthma"
            else:
                pred = "Healthy"
            return {
                "prediction": pred,
                "confidence": 0.85,
                "probabilities": {pred: 0.85, "Healthy": 0.15},
                "model_used": "heuristic_fallback"
            }

        model = self.cond_dict["model"]
        le = self.cond_dict["label_encoder"]
        # ['HeartRate', 'SpO2', 'SystolicBP', 'DiastolicBP', 'BodyTemp', 'FallFlag', 'PulsePressure', 'MAP', 'ShockIndex', 'OxygenStrain']
        x = np.array([[
            feats["HeartRate"],
            feats["SpO2"],
            feats["SystolicBP"],
            feats["DiastolicBP"],
            feats["BodyTemp_C"],
            feats["FallFlag"],
            feats["PulsePressure"],
            feats["MAP"],
            feats["ShockIndex"],
            feats["OxygenStrain"]
        ]])

        try:
            pred_idx = model.predict(x)[0]
            pred_label = le.inverse_transform([pred_idx])[0]
            probas = model.predict_proba(x)[0]
            classes = le.classes_
            prob_dict = {str(c): round(float(p), 4) for c, p in zip(classes, probas)}
            confidence = round(float(np.max(probas)), 4)
            return {
                "prediction": str(pred_label),
                "confidence": confidence,
                "probabilities": prob_dict,
                "model_used": "XGBoost (Condition)"
            }
        except Exception as e:
            logger.error(f"Inference error in condition model: {e}")
            return {
                "prediction": "Healthy",
                "confidence": 0.70,
                "probabilities": {"Healthy": 0.70},
                "error": str(e)
            }

    def predict_maternal_risk(
        self,
        age: float = 25.0,
        systolic_bp: float = 120.0,
        diastolic_bp: float = 80.0,
        blood_sugar_mmol: float = 5.5,
        body_temp_f: float = 98.6,
        heart_rate: float = 75.0
    ) -> dict:
        """Predict maternal health risk tier using SVM-RBF model."""
        feats = self.calculate_features(
            age=age,
            systolic_bp=systolic_bp,
            diastolic_bp=diastolic_bp,
            blood_sugar_mmol=blood_sugar_mmol,
            body_temp_f=body_temp_f,
            heart_rate=heart_rate
        )

        if not self.mat_dict or "model" not in self.mat_dict:
            sbp, dbp = feats["SystolicBP"], feats["DiastolicBP"]
            if sbp >= 140 or dbp >= 90 or feats["BloodSugar"] >= 11.1:
                pred = "high risk"
            elif sbp >= 130 or dbp >= 80 or feats["BloodSugar"] >= 7.8:
                pred = "mid risk"
            else:
                pred = "low risk"
            return {
                "prediction": pred,
                "confidence": 0.80,
                "probabilities": {pred: 0.80, "low risk": 0.20},
                "model_used": "heuristic_fallback"
            }

        model = self.mat_dict["model"]
        le = self.mat_dict["label_encoder"]
        # ['Age', 'SystolicBP', 'DiastolicBP', 'BloodSugar', 'BodyTemp', 'HeartRate', 'PulsePressure', 'MAP', 'ShockIndex']
        x = np.array([[
            feats["Age"],
            feats["SystolicBP"],
            feats["DiastolicBP"],
            feats["BloodSugar"],
            feats["BodyTemp_F"],
            feats["HeartRate"],
            feats["PulsePressure"],
            feats["MAP"],
            feats["ShockIndex"]
        ]])

        try:
            pred_idx = model.predict(x)[0]
            pred_label = le.inverse_transform([pred_idx])[0]
            classes = le.classes_

            if hasattr(model, "predict_proba"):
                probas = model.predict_proba(x)[0]
                prob_dict = {str(c): round(float(p), 4) for c, p in zip(classes, probas)}
                confidence = round(float(np.max(probas)), 4)
            else:
                prob_dict = {str(pred_label): 0.85}
                confidence = 0.85

            return {
                "prediction": str(pred_label),
                "confidence": confidence,
                "probabilities": prob_dict,
                "model_used": "SVM_RBF (Maternal Risk)"
            }
        except Exception as e:
            logger.error(f"Inference error in maternal model: {e}")
            return {
                "prediction": "low risk",
                "confidence": 0.70,
                "probabilities": {"low risk": 0.70},
                "error": str(e)
            }

    def evaluate_clinical_rules(self, row: dict, units: str = "F", is_pregnant: bool = True) -> dict:
        """
        Evidence-based clinical rules from patient_risk_colab_1.ipynb
        Returns triage_band, severity_score, issue_count, issues, top_issue.
        """
        out = []
        sbp = row.get("SystolicBP")
        dbp = row.get("DiastolicBP")
        hr = row.get("HeartRate")
        temp = row.get("BodyTemp")
        spo2 = row.get("SpO2")
        bs = row.get("BloodSugar")
        age = row.get("Age")

        # Blood pressure
        if sbp is not None and dbp is not None:
            try:
                sbp, dbp = float(sbp), float(dbp)
                if sbp >= 160 or dbp >= 110:
                    out.append(("Severe-range hypertension (>=160/110)", "urgent"))
                    if is_pregnant:
                        out.append(("Screen for pre-eclampsia / eclampsia", "urgent"))
                elif sbp >= 140 or dbp >= 90:
                    out.append(("Stage 2 hypertension (>=140/90)", "concerning"))
                    if is_pregnant:
                        out.append(("Possible gestational hypertension", "concerning"))
                elif sbp >= 130 or dbp >= 80:
                    out.append(("Stage 1 hypertension (130-139/80-89)", "monitor"))
                elif sbp >= 120:
                    out.append(("Elevated blood pressure", "monitor"))
                if sbp < 90 or dbp < 60:
                    out.append(("Hypotension (<90/60)", "concerning"))
                pp = sbp - dbp
                if pp < 25:
                    out.append(("Narrow pulse pressure (<25 mmHg)", "monitor"))
                elif pp > 60:
                    out.append(("Wide pulse pressure (>60 mmHg)", "monitor"))
            except (ValueError, TypeError):
                pass

        # Heart rate
        if hr is not None:
            try:
                hr = float(hr)
                if hr >= 140:
                    out.append(("CRITICAL EMERGENCY: Severe maternal tachycardia / arrhythmia (HR >= 140 bpm) - Urgent 108 Transfer", "urgent"))
                elif hr > 120:
                    out.append(("Marked tachycardia (>120 bpm)", "urgent"))
                elif hr > 100:
                    out.append(("Tachycardia (>100 bpm)", "concerning"))
                elif hr < 50:
                    out.append(("CRITICAL: Severe bradycardia (<50 bpm)", "urgent"))
                elif hr < 60:
                    out.append(("Bradycardia (<60 bpm)", "monitor"))
            except (ValueError, TypeError):
                pass

        # Glucose (mmol/L)
        if bs is not None:
            try:
                bs = float(bs)
                if bs >= 11.1:
                    out.append(("Hyperglycaemia, diabetic range (>=11.1 mmol/L)", "urgent"))
                    out.append(("Possible gestational or pre-existing diabetes", "concerning"))
                elif bs >= 7.8:
                    out.append(("Impaired glucose tolerance (7.8-11.0 mmol/L)", "concerning"))
                elif bs < 3.9:
                    out.append(("Hypoglycaemia (<3.9 mmol/L)", "urgent"))
            except (ValueError, TypeError):
                pass

        # SpO2
        if spo2 is not None:
            try:
                spo2 = float(spo2)
                if spo2 < 88:
                    out.append(("Severe hypoxaemia (<88%) - oxygen needed", "urgent"))
                elif spo2 < 90:
                    out.append(("Significant hypoxaemia (88-89%)", "urgent"))
                elif spo2 < 95:
                    out.append(("Mild hypoxaemia (90-94%)", "concerning"))
            except (ValueError, TypeError):
                pass

        # Temperature
        fever = False
        if temp is not None:
            try:
                temp = float(temp)
                if units == "F":
                    if temp >= 102.2:
                        out.append(("High fever (>=102.2 F)", "urgent"))
                        fever = True
                    elif temp >= 100.4:
                        out.append(("Fever (>=100.4 F) - possible infection", "concerning"))
                        fever = True
                    elif temp >= 99.5:
                        out.append(("Low-grade fever", "monitor"))
                    elif temp < 96.8:
                        out.append(("Hypothermia (<96.8 F)", "concerning"))
                else:
                    if temp >= 39.0:
                        out.append(("High fever (>=39.0 C)", "urgent"))
                        fever = True
                    elif temp >= 38.0:
                        out.append(("Fever (>=38.0 C) - possible infection", "concerning"))
                        fever = True
                    elif temp >= 37.5:
                        out.append(("Low-grade fever", "monitor"))
                    elif temp < 36.0:
                        out.append(("Hypothermia (<36.0 C)", "concerning"))
            except (ValueError, TypeError):
                pass

        # Maternal Age
        if is_pregnant and age is not None:
            try:
                age = float(age)
                if age < 15:
                    out.append(("Very young maternal age (<15)", "urgent"))
                elif age < 18:
                    out.append(("Adolescent pregnancy (<18)", "concerning"))
                elif age >= 40:
                    out.append(("Advanced maternal age (>=40)", "concerning"))
                elif age >= 35:
                    out.append(("Advanced maternal age (35-39)", "monitor"))
            except (ValueError, TypeError):
                pass

        if row.get("FallDetected") in (True, "Yes", 1, "true"):
            out.append(("Fall detected - injury / syncope assessment", "urgent"))

        # Cross-vital syndrome patterns
        if fever and hr is not None and float(hr) > 100:
            out.append(("SIRS pattern (fever + tachycardia) - sepsis workup", "urgent"))
        if sbp is not None and hr is not None and float(sbp) < 90 and float(hr) > 100:
            out.append(("Shock pattern (hypotension + tachycardia)", "urgent"))
        if spo2 is not None and hr is not None and float(spo2) < 92 and float(hr) > 100:
            out.append(("Cardiorespiratory distress", "urgent"))
        if sbp is not None and bs is not None and float(sbp) >= 140 and float(bs) >= 11.1:
            out.append(("Metabolic cluster (hypertension + hyperglycaemia)", "concerning"))
        if sbp is not None and hr is not None and float(sbp) >= 160 and float(hr) > 100:
            out.append(("Hypertensive emergency pattern", "urgent"))

        seen, uniq = set(), []
        for t, s in out:
            if t not in seen:
                seen.add(t)
                uniq.append((t, s))

        if any(s == "urgent" for _, s in uniq):
            band = "URGENT - clinician review"
        elif any(s == "concerning" for _, s in uniq):
            band = "PRIORITY - same-day review"
        elif uniq:
            band = "ROUTINE - monitor"
        else:
            band = "STABLE - no flags"

        severity_score = sum(SEVERITY_WEIGHTS[s] for _, s in uniq)
        issues_list = [t for t, _ in uniq]
        top_issue = issues_list[0] if issues_list else "No abnormal findings"

        return {
            "issue_count": len(uniq),
            "severity_score": severity_score,
            "triage_band": band,
            "issues": issues_list,
            "top_issue": top_issue
        }


def assess_patient(data: dict) -> dict:
    """
    Unified entrypoint for health assessment.
    Takes arbitrary vitals dict / form data, normalizes values, executes ML models and clinical triage.
    """
    engine = PatientRiskEngine()

    # Parse demographic and vital inputs. Field names below match BOTH a
    # flat/generic caller (age=, systolic_bp=, ...) AND the shape
    # extraction.py actually produces (form["patient"]["age"],
    # form["vitals"]["heart_rate"/"temperature_celsius"],
    # form["anc_details"]["blood_sugar_fasting"]) — a form straight from
    # extract_all() used to silently fall through every branch below to the
    # hardcoded defaults (25yo/75bpm/98.6F/5.5mmol) for age, heart rate,
    # temperature and blood sugar, scoring every real visit on placeholder
    # vitals instead of what the patient actually reported.
    vitals = data.get("vitals") or {}
    age = (data.get("age") or data.get("Age")
           or (data.get("patient") or {}).get("age")
           or (data.get("demographics") or {}).get("age"))
    try:
        age = float(age) if age else 25.0
    except (ValueError, TypeError):
        age = 25.0

    sbp = data.get("systolic_bp") or data.get("SystolicBP") or vitals.get("bp_systolic")
    dbp = data.get("diastolic_bp") or data.get("DiastolicBP") or vitals.get("bp_diastolic")
    hr = (data.get("heart_rate") or data.get("pulse") or data.get("HeartRate")
          or vitals.get("heart_rate") or vitals.get("pulse"))
    spo2 = data.get("spo2") or data.get("oxygen") or data.get("SpO2") or vitals.get("spo2")
    raw_sugar = (data.get("blood_sugar") or data.get("glucose") or data.get("BloodSugar")
                 or vitals.get("blood_sugar")
                 or (data.get("anc_details") or {}).get("blood_sugar_fasting"))
    sugar_unit = data.get("blood_sugar_unit") or data.get("sugar_unit") or "mg/dL"
    sugar_mmol = convert_blood_sugar_to_mmol(raw_sugar, sugar_unit)

    raw_temp = (data.get("body_temp") or data.get("temperature") or data.get("BodyTemp")
                or vitals.get("temperature") or vitals.get("temperature_celsius"))
    temp_f, temp_c = normalize_temperature(raw_temp)

    is_pregnant = data.get("is_pregnant")
    if is_pregnant is None:
        is_pregnant = bool(data.get("maternal", {}).get("is_pregnant") or data.get("gestational_weeks") or data.get("maternal", {}).get("months_pregnant"))

    fall_detected = bool(data.get("fall_detected") or data.get("FallDetected"))

    # Convert numeric fields
    def to_float_opt(val, default=None):
        if val is None or val == "":
            return default
        try:
            return float(val)
        except (ValueError, TypeError):
            return default

    sbp_val = to_float_opt(sbp, 120.0)
    dbp_val = to_float_opt(dbp, 80.0)
    hr_val = to_float_opt(hr, 75.0)
    spo2_val = to_float_opt(spo2, 98.0)

    # 1. Condition Model Inference
    condition_res = engine.predict_condition(
        heart_rate=hr_val,
        spo2=spo2_val,
        systolic_bp=sbp_val,
        diastolic_bp=dbp_val,
        body_temp_c=temp_c,
        fall_detected=fall_detected
    )

    # 2. Maternal Risk Model Inference
    maternal_res = engine.predict_maternal_risk(
        age=age,
        systolic_bp=sbp_val,
        diastolic_bp=dbp_val,
        blood_sugar_mmol=sugar_mmol,
        body_temp_f=temp_f,
        heart_rate=hr_val
    )

    # 3. Clinical Rules Triage
    rules_input = {
        "Age": age,
        "SystolicBP": sbp_val,
        "DiastolicBP": dbp_val,
        "HeartRate": hr_val,
        "SpO2": spo2_val,
        "BloodSugar": sugar_mmol,
        "BodyTemp": temp_f,
        "FallDetected": fall_detected
    }
    triage_res = engine.evaluate_clinical_rules(rules_input, units="F", is_pregnant=is_pregnant)

    # 4. Action Recommendation & Visit Scheduling Days
    band = triage_res["triage_band"]
    mat_risk = maternal_res.get("prediction", "low risk")

    if "URGENT" in band or mat_risk == "high risk":
        recommended_action = "🚨 URGENT: Refer to Primary Health Centre (PHC) immediately. Alert Medical Officer."
        suggested_next_visit_days = 1
        priority_label = "HIGH RISK"
    elif "PRIORITY" in band or mat_risk == "mid risk":
        recommended_action = "⚠️ PRIORITY: Schedule same-week clinical review. Monitor BP & vitals daily."
        suggested_next_visit_days = 3
        priority_label = "MODERATE RISK"
    elif "ROUTINE" in band:
        recommended_action = "ℹ️ ROUTINE: Standard maternal & child health follow-up. Counsel on nutrition."
        suggested_next_visit_days = 14
        priority_label = "LOW RISK"
    else:
        recommended_action = "✅ STABLE: All vitals within normal parameters. Monthly routine checkup."
        suggested_next_visit_days = 30
        priority_label = "STABLE"

    return {
        "status": "success",
        "condition": condition_res,
        "maternal_risk": maternal_res,
        "triage": triage_res,
        "priority_label": priority_label,
        "recommended_action": recommended_action,
        "suggested_next_visit_days": suggested_next_visit_days,
        "normalized_vitals": {
            "age": age,
            "systolic_bp": sbp_val,
            "diastolic_bp": dbp_val,
            "heart_rate": hr_val,
            "spo2": spo2_val,
            "blood_sugar_mmol": sugar_mmol,
            "body_temp_f": temp_f,
            "body_temp_c": temp_c,
            "is_pregnant": is_pregnant,
            "fall_detected": fall_detected
        }
    }
