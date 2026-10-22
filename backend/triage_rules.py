"""
Deterministic vitals triage — a threshold rule engine citing published
clinical guidelines (ACOG/AHA for blood pressure, ADA for glucose, WHO for
SpO2, standard fever cutoffs), plus a handful of cross-vital syndrome
patterns (SIRS, shock, hypertensive emergency).

Unlike risk_models.py, this is not a trained model, so it never returns
"insufficient_vitals" for a partial set — a partial vitals set is the normal
case here. Each check runs independently and is skipped when its inputs are
missing. Passing zero vitals returns an explicit "no_vitals_provided" error.
"""
SEVERITY = {"info": 0, "monitor": 1, "concerning": 2, "urgent": 3}


def _mmol_from_mg_dl(mg_dl):
    return mg_dl / 18.0


def assess_vitals(
    systolic_bp=None, diastolic_bp=None, heart_rate=None,
    body_temp=None, temp_unit="C",
    spo2=None,
    blood_sugar=None, blood_sugar_unit=None,
    age=None, fall_detected=False, pregnant=True,
):
    """Flag clinical issues from whatever vitals are given.

    temp_unit: "C" or "F". blood_sugar_unit: "mmol/L" or "mg/dL" — REQUIRED
    whenever blood_sugar is given (thresholds below are ADA/WHO cutoffs in
    mmol/L; silently treating an mg/dL reading as mmol/L would misclassify
    a normal reading as severe hypoglycaemia).
    """
    has_data = (
        (systolic_bp is not None and diastolic_bp is not None)
        or heart_rate is not None
        or blood_sugar is not None
        or spo2 is not None
        or body_temp is not None
        or (pregnant and age is not None)
        or fall_detected
    )
    if not has_data:
        return {"error": "no_vitals_provided"}

    if blood_sugar is not None:
        if blood_sugar_unit not in ("mmol/L", "mg/dL"):
            return {
                "error": "missing_blood_sugar_unit",
                "detail": "blood_sugar_unit must be 'mmol/L' or 'mg/dL' whenever blood_sugar is given.",
            }
        if blood_sugar_unit == "mg/dL":
            blood_sugar = _mmol_from_mg_dl(blood_sugar)

    if body_temp is not None and temp_unit not in ("C", "F"):
        return {"error": "invalid_temp_unit", "detail": "temp_unit must be 'C' or 'F'."}

    out = []
    sbp, dbp, hr, temp = systolic_bp, diastolic_bp, heart_rate, body_temp

    # --- blood pressure ---
    if sbp is not None and dbp is not None:
        if sbp >= 160 or dbp >= 110:
            out.append(("Severe-range hypertension (>=160/110)", "urgent"))
            if pregnant:
                out.append(("Screen for pre-eclampsia / eclampsia", "urgent"))
        elif sbp >= 140 or dbp >= 90:
            out.append(("Stage 2 hypertension (>=140/90)", "concerning"))
            if pregnant:
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

    # --- heart rate ---
    if hr is not None:
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

    # --- glucose (mmol/L) ---
    if blood_sugar is not None:
        bs = blood_sugar
        if bs >= 11.1:
            out.append(("Hyperglycaemia, diabetic range (>=11.1 mmol/L)", "urgent"))
            out.append(("Possible gestational or pre-existing diabetes", "concerning"))
        elif bs >= 7.8:
            out.append(("Impaired glucose tolerance (7.8-11.0 mmol/L)", "concerning"))
        elif bs < 3.9:
            out.append(("Hypoglycaemia (<3.9 mmol/L)", "urgent"))

    # --- SpO2 ---
    if spo2 is not None:
        if spo2 < 88:
            out.append(("Severe hypoxaemia (<88%) - oxygen needed", "urgent"))
        elif spo2 < 90:
            out.append(("Significant hypoxaemia (88-89%)", "urgent"))
        elif spo2 < 95:
            out.append(("Mild hypoxaemia (90-94%)", "concerning"))

    # --- temperature ---
    fever = False
    if temp is not None:
        if temp_unit == "F":
            if temp >= 102.2:
                out.append(("High fever (>=102.2 F)", "urgent")); fever = True
            elif temp >= 100.4:
                out.append(("Fever (>=100.4 F) - possible infection", "concerning")); fever = True
            elif temp >= 99.5:
                out.append(("Low-grade fever", "monitor"))
            elif temp < 96.8:
                out.append(("Hypothermia (<96.8 F)", "concerning"))
        else:
            if temp >= 39.0:
                out.append(("High fever (>=39.0 C)", "urgent")); fever = True
            elif temp >= 38.0:
                out.append(("Fever (>=38.0 C) - possible infection", "concerning")); fever = True
            elif temp >= 37.5:
                out.append(("Low-grade fever", "monitor"))
            elif temp < 36.0:
                out.append(("Hypothermia (<36.0 C)", "concerning"))

    # --- maternal age ---
    if pregnant and age is not None:
        if age < 15:
            out.append(("Very young maternal age (<15)", "urgent"))
        elif age < 18:
            out.append(("Adolescent pregnancy (<18)", "concerning"))
        elif age >= 40:
            out.append(("Advanced maternal age (>=40)", "concerning"))
        elif age >= 35:
            out.append(("Advanced maternal age (35-39)", "monitor"))

    if fall_detected:
        out.append(("Fall detected - injury / syncope assessment", "urgent"))

    # --- cross-vital syndrome patterns ---
    if fever and hr is not None and hr > 100:
        out.append(("SIRS pattern (fever + tachycardia) - sepsis workup", "urgent"))
    if sbp is not None and hr is not None and sbp < 90 and hr > 100:
        out.append(("Shock pattern (hypotension + tachycardia)", "urgent"))
    if spo2 is not None and hr is not None and spo2 < 92 and hr > 100:
        out.append(("Cardiorespiratory distress", "urgent"))
    if sbp is not None and blood_sugar is not None and sbp >= 140 and blood_sugar >= 11.1:
        out.append(("Metabolic cluster (hypertension + hyperglycaemia)", "concerning"))
    if sbp is not None and hr is not None and sbp >= 160 and hr > 100:
        out.append(("Hypertensive emergency pattern", "urgent"))

    seen, uniq = set(), []
    for finding, severity in out:
        if finding not in seen:
            seen.add(finding)
            uniq.append((finding, severity))

    if any(s == "urgent" for _, s in uniq):
        band = "URGENT - clinician review"
    elif any(s == "concerning" for _, s in uniq):
        band = "PRIORITY - same-day review"
    elif uniq:
        band = "ROUTINE - monitor"
    else:
        band = "STABLE - no flags"

    return {
        "triage_band": band,
        "severity_score": sum(SEVERITY[s] for _, s in uniq),
        "issue_count": len(uniq),
        "issues": [{"finding": f, "severity": s} for f, s in uniq],
    }
