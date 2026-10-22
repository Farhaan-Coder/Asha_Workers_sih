"""
Risk scoring models — two small classifiers trained separately from any LLM
pipeline, loaded lazily from models/risk/*.joblib.

Both were trained by patient_risk_colab_1.ipynb ("Patient Risk Modelling") —
every formula and unit below is read directly from that notebook's
`engineer()` and `assess_frame()` calls, not guessed.

model_maternal_risk.joblib
    sklearn Pipeline (StandardScaler + SVC, RBF kernel) predicting maternal
    risk level (low risk / mid risk / high risk), trained on the UCI
    "Maternal Health Risk" dataset (id 863). Features: Age, SystolicBP,
    DiastolicBP, BloodSugar (mmol/L), BodyTemp (Fahrenheit), HeartRate, plus
    three engineered features computed here from the raw six.

model_condition.joblib
    XGBoost multiclass classifier predicting a general condition category
    (Healthy / Hypertension / Diabetes Mellitus / Heart Disease / Asthma),
    trained on a synthetic wearable-monitoring dataset. Features: HeartRate,
    SpO2, SystolicBP, DiastolicBP, BodyTemp (Celsius), FallFlag, plus four
    engineered features computed here from the raw six.

Engineered features (notebook's `engineer()`):
    PulsePressure = SystolicBP - DiastolicBP
    MAP           = DiastolicBP + (SystolicBP - DiastolicBP) / 3
    ShockIndex    = HeartRate / SystolicBP
    OxygenStrain  = HeartRate / SpO2                    (condition model only)
    FallFlag      = 1 if a fall was detected else 0     (condition model only)

Requires xgboost==2.0.3 in this venv — the bundled condition model was
trained with an older xgboost and its Booster buffer format is not readable
by newer xgboost releases (confirmed: fails on 3.4.1, loads fine on 2.0.3).
scikit-learn is pinned to 1.6.1 to match the pickled estimator version.
"""
import os
import warnings
import joblib

warnings.filterwarnings("ignore", message="X does not have valid feature names")

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
_MODELS_DIR = os.path.join(_THIS_DIR, "models", "risk")

_maternal_risk_bundle = None
_condition_bundle = None
_maternal_risk_load_failed = False
_condition_load_failed = False


def _load(filename):
    path = os.path.join(_MODELS_DIR, filename)
    if not os.path.isfile(path):
        return None
    return joblib.load(path)


def _get_maternal_risk_bundle():
    global _maternal_risk_bundle, _maternal_risk_load_failed
    if _maternal_risk_bundle is None and not _maternal_risk_load_failed:
        try:
            _maternal_risk_bundle = _load("model_maternal_risk.joblib")
        except Exception as e:
            print(f"[risk_models] Failed to load model_maternal_risk.joblib: {e!r}")
            _maternal_risk_load_failed = True
        if _maternal_risk_bundle is None:
            _maternal_risk_load_failed = True
    return _maternal_risk_bundle


def _get_condition_bundle():
    global _condition_bundle, _condition_load_failed
    if _condition_bundle is None and not _condition_load_failed:
        try:
            _condition_bundle = _load("model_condition.joblib")
        except Exception as e:
            print(f"[risk_models] Failed to load model_condition.joblib: {e!r}")
            _condition_load_failed = True
        if _condition_bundle is None:
            _condition_load_failed = True
    return _condition_bundle


def models_available():
    return {
        "maternal_risk": _get_maternal_risk_bundle() is not None,
        "condition": _get_condition_bundle() is not None,
    }


def _pulse_pressure(sbp, dbp):
    return sbp - dbp


def _map(sbp, dbp):
    return dbp + (sbp - dbp) / 3


def _shock_index(hr, sbp):
    return hr / sbp if sbp else None


def _oxygen_strain(hr, spo2):
    return hr / spo2 if spo2 else None


def _celsius_to_fahrenheit(c):
    return c * 9 / 5 + 32


def predict_maternal_risk(age, systolic_bp, diastolic_bp, blood_sugar, body_temp_c, heart_rate,
                           blood_sugar_unit=None):
    """Predict maternal risk level from ANC vitals. All six vitals required —
    a missing value returns "insufficient_vitals" naming what's missing,
    never a guess. blood_sugar_unit ("mmol/L" or "mg/dL") is REQUIRED
    whenever blood_sugar is given."""
    bundle = _get_maternal_risk_bundle()
    if bundle is None:
        return {"error": "model_not_loaded"}

    fields = {
        "age": age, "systolic_bp": systolic_bp, "diastolic_bp": diastolic_bp,
        "blood_sugar": blood_sugar, "body_temp_c": body_temp_c, "heart_rate": heart_rate,
    }
    missing = [k for k, v in fields.items() if v is None]
    if missing:
        return {"error": "insufficient_vitals", "missing": missing}

    if blood_sugar_unit not in ("mmol/L", "mg/dL"):
        return {
            "error": "missing_blood_sugar_unit",
            "detail": "blood_sugar_unit must be 'mmol/L' or 'mg/dL' whenever blood_sugar is given.",
        }
    if blood_sugar_unit == "mg/dL":
        blood_sugar = blood_sugar / 18.0

    body_temp_f = _celsius_to_fahrenheit(body_temp_c)
    pp = _pulse_pressure(systolic_bp, diastolic_bp)
    map_ = _map(systolic_bp, diastolic_bp)
    si = _shock_index(heart_rate, systolic_bp)

    X = [[age, systolic_bp, diastolic_bp, blood_sugar, body_temp_f, heart_rate, pp, map_, si]]
    model = bundle["model"]
    le = bundle["label_encoder"]
    pred = model.predict(X)
    label = le.inverse_transform(pred)[0]
    proba = model.predict_proba(X)[0]

    return {
        "risk_level": label,
        "probabilities": {cls: round(float(p), 4) for cls, p in zip(le.classes_, proba)},
        "model": bundle.get("name", "maternal_risk"),
    }


def predict_condition(heart_rate, spo2, systolic_bp, diastolic_bp, body_temp_c, fall_flag=0):
    """Predict a general condition category from wearable-style vitals.
    body_temp_c is passed UNCONVERTED (Celsius) — do not "fix" to Fahrenheit."""
    bundle = _get_condition_bundle()
    if bundle is None:
        return {"error": "model_not_loaded"}

    fields = {
        "heart_rate": heart_rate, "spo2": spo2, "systolic_bp": systolic_bp,
        "diastolic_bp": diastolic_bp, "body_temp_c": body_temp_c,
    }
    missing = [k for k, v in fields.items() if v is None]
    if missing:
        return {"error": "insufficient_vitals", "missing": missing}

    pp = _pulse_pressure(systolic_bp, diastolic_bp)
    map_ = _map(systolic_bp, diastolic_bp)
    si = _shock_index(heart_rate, systolic_bp)
    ox = _oxygen_strain(heart_rate, spo2)

    X = [[heart_rate, spo2, systolic_bp, diastolic_bp, body_temp_c, fall_flag, pp, map_, si, ox]]
    model = bundle["model"]
    le = bundle["label_encoder"]
    pred = model.predict(X)
    label = le.inverse_transform(pred)[0]
    proba = model.predict_proba(X)[0]

    return {
        "condition": label,
        "probabilities": {cls: round(float(p), 4) for cls, p in zip(le.classes_, proba)},
        "model": bundle.get("name", "condition"),
    }
