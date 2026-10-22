"""
Indic Number Normalizer: Converts spoken number words in Marathi, Hindi, Bengali,
and Tamil, as well as Devanagari/Bengali/Tamil digits, into standard Arabic digits (0-9).
"""
from __future__ import annotations

import re
from typing import Optional, Union

# Unicode Indic digits to standard Arabic digits
INDIC_DIGIT_MAP = {
    # Devanagari (Hindi, Marathi, Nepali)
    '०': '0', '१': '1', '२': '2', '३': '3', '४': '4', '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
    # Bengali / Assamese
    '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4', '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9',
    # Tamil
    '௦': '0', '௧': '1', '௨': '2', '௩': '3', '௪': '4', '௫': '5', '௬': '6', '௭': '7', '௮': '8', '௯': '9',
}

# Marathi Number Words (0-100+)
MARATHI_NUMBER_WORDS = {
    "शून्य": 0, "एक": 1, "दोन": 2, "तीन": 3, "चार": 4, "पाच": 5,
    "सहा": 6, "सात": 7, "आठ": 8, "नऊ": 9, "दहा": 10,
    "अकरा": 11, "बारा": 12, "तेरा": 13, "चौदा": 14, "पंधरा": 15,
    "सोळा": 16, "सतरा": 17, "अठरा": 18, "एकोणीस": 19, "वीस": 20,
    "एकवीस": 21, "बावीस": 22, "तेवीस": 23, "चोवीस": 24, "पंचवीस": 25,
    "सव्वीस": 26, "सत्तावीस": 27, "अठ्ठावीस": 28, "एकोणतीस": 29, "तीस": 30,
    "एकतीस": 31, "बत्तीस": 32, "तेहेतीस": 33, "तेहतीस": 33, "चौतीस": 34, "पस्तीस": 35,
    "छत्तीस": 36, "सदतीस": 37, "अडतीस": 38, "एकोणचाळीस": 39, "चाळीस": 40,
    "एक्केचाळीस": 41, "एकेचाळीस": 41, "बेचाळीस": 42, "त्रेचाळीस": 43, "चव्वेचाळीस": 44, "पंचेचाळीस": 45,
    "शेहेचाळीस": 46, "सत्तेचाळीस": 47, "अठ्ठेचाळीस": 48, "एकोणपन्नास": 49, "पन्नास": 50,
    "एक्कावन्न": 51, "बावन्न": 52, "त्रेपन्न": 53, "चौपन्न": 54, "पंचावन्न": 55,
    "छप्पन्न": 56, "सत्तावन्न": 57, "अठ्ठावन्न": 58, "एकोणसाठ": 59, "साठ": 60,
    "एकसष्ठ": 61, "बासष्ठ": 62, "त्रेसष्ठ": 63, "चौसष्ठ": 64, "पासष्ठ": 65,
    "सहासष्ठ": 66, "सदुसष्ठ": 67, "अडुसष्ठ": 68, "एकोणसत्तर": 69, "सत्तर": 70,
    "एकाहत्तर": 71, "बाहत्तर": 72, "बहात्तर": 72, "त्र्याहत्तर": 73, "चौर्‍याहत्तर": 74, "चौऱ्याहत्तर": 74, "पंच्याहत्तर": 75,
    "शहात्तर": 76, "सत्याहत्तर": 77, "अठ्याहत्तर": 78, "अठ्ठ्याहत्तर": 78, "एकोणऐंशी": 79, "ऐंशी": 80,
    "एक्क्यांशी": 81, "ब्यांशी": 82, "त्र्यांशी": 83, "चौऱ्यांशी": 84, "पंच्यांशी": 85,
    "शहांशी": 86, "सत्यांशी": 87, "अठ्ठ्यांशी": 88, "अठ्यांशी": 88, "एकोणनव्वद": 89, "नव्वद": 90,
    "एक्क्याण्णव": 91, "ब्याण्णव": 92, "त्र्याण्णव": 93, "चौऱ्याण्णव": 94, "पंच्याण्णव": 95,
    "शहाण्णव": 96, "सत्त्याण्णव": 97, "अठ्ठाण्णव": 98, "अठ्ठ्याण्णव": 98, "नव्व्याण्णव": 99, "शंभर": 100,
}

# Hindi Number Words (0-100+)
HINDI_NUMBER_WORDS = {
    "शून्य": 0, "एक": 1, "दो": 2, "तीन": 3, "चार": 4, "पांच": 5, "पाँच": 5,
    "छह": 6, "छ:": 6, "सात": 7, "आठ": 8, "नौ": 9, "दस": 10,
    "ग्यारह": 11, "बारह": 12, "तेरह": 13, "चौदह": 14, "पंद्रह": 15,
    "सोलह": 16, "सत्रह": 17, "अठारह": 18, "उन्नीस": 19, "बीस": 20,
    "इक्कीस": 21, "बाईस": 22, "तेईस": 23, "चौबीस": 24, "पच्चीस": 25,
    "छब्बीस": 26, "सत्ताईस": 27, "सत्ताइस": 27, "अट्ठाईस": 28, "अट्ठाइस": 28, "उनतीस": 29, "तीस": 30,
    "इकत्तीस": 31, "बत्तीस": 32, "तैंतीस": 33, "चौंतीस": 34, "पैंतीस": 35,
    "छत्तीस": 36, "सैंतीस": 37, "अड़तीस": 38, "उनतालीस": 39, "चालीस": 40,
    "इकतालीस": 41, "बयालीस": 42, "तैंतालीस": 43, "चवालीस": 44, "पैंतालीस": 45,
    "छियालीस": 46, "सैंतालीस": 47, "अड़तालीस": 48, "उनचास": 49, "पचास": 50,
    "इक्यावन": 51, "बावन": 52, "तिरेपन": 53, "चौवन": 54, "पचपन": 55,
    "छप्पन": 56, "सत्तावन": 57, "अट्ठावन": 58, "उनसठ": 59, "साठ": 60,
    "इकसठ": 61, "बासठ": 62, "तिरसठ": 63, "चौंसठ": 64, "पैंसठ": 65,
    "छियासठ": 66, "सरसठ": 67, "अड़सठ": 68, "उनहत्तर": 69, "सत्तर": 70,
    "इकहत्तर": 71, "बहत्तर": 72, "तिहत्तर": 73, "चौहत्तर": 74, "पचहत्तर": 75,
    "छिहत्तर": 76, "सतहत्तर": 77, "अठहत्तर": 78, "उन्नासी": 79, "अस्सी": 80,
    "इक्यासी": 81, "बयासी": 82, "तिरासी": 83, "चौरासी": 84, "पचासी": 85,
    "छियासी": 86, "सत्तासी": 87, "अठासी": 88, "नवासी": 89, "नब्बे": 90,
    "इक्यानवे": 91, "बानवे": 92, "तिरानवे": 93, "चौरानवे": 94, "पंचानवे": 95,
    "छियानवे": 96, "सत्तानवे": 97, "अट्ठानवे": 98, "निन्यानवे": 99, "सौ": 100,
}

# Bengali Number Words
BENGALI_NUMBER_WORDS = {
    "শূন্য": 0, "এক": 1, "দুই": 2, "তিন": 3, "চার": 4, "পাঁচ": 5,
    "ছয়": 6, "সাত": 7, "আট": 8, "নয়": 9, "দশ": 10,
    "এগারো": 11, "বারো": 12, "তেরো": 13, "চোদ্দ": 14, "পনেরো": 15,
    "ষোল": 16, "সতেরো": 17, "আঠারো": 18, "উনিশ": 19, "কুড়ি": 20, "বিশ": 20,
    "পঁচিশ": 25, "সাতাশ": 27, "আটাশ": 28, "ত্রিশ": 30, "পঁয়ত্রিশ": 35, "চল্লিশ": 40,
    "পঞ্চাশ": 50, "ষাট": 60, "সত্তর": 70, "আশি": 80, "নব্বই": 90, "একশ": 100, "একশো": 100,
}

# Tamil Number Words
TAMIL_NUMBER_WORDS = {
    "பூஜ்ஜியம்": 0, "ஒன்று": 1, "இரண்டு": 2, "மூன்று": 3, "நான்கு": 4, "ஐந்து": 5,
    "ஆறு": 6, "ஏழு": 7, "எட்டு": 8, "ஒன்பது": 9, "பத்து": 10,
    "இருபது": 20, "இருபத்தைந்து": 25, "இருபத்தேழு": 27, "இருபத்தெட்டு": 28, "முப்பது": 30,
    "முப்பத்தைந்து": 35, "நாற்பது": 40, "ஐம்பது": 50, "அறுபது": 60, "எழுபது": 70,
    "எண்பது": 80, "தொண்ணூறு": 90, "நூறு": 100,
}

# Compound prefix multipliers
HUNDREDS_PREFIXES = {
    "एकशे": 100, "एक सौ": 100, "एकसौ": 100, "दोनशे": 200, "दो सौ": 200, "दौ सौ": 200,
    "तीनशे": 300, "तीन सौ": 300, "चारशे": 400, "चार सौ": 400, "पाचशे": 500, "पांच सौ": 500,
}

# Combine all word number maps (sorted longest-key first for safe greediness)
ALL_INDIC_WORDS = {}
for d in (MARATHI_NUMBER_WORDS, HINDI_NUMBER_WORDS, BENGALI_NUMBER_WORDS, TAMIL_NUMBER_WORDS):
    ALL_INDIC_WORDS.update(d)


def convert_indic_digits(text: str) -> str:
    """Replaces Unicode Devanagari, Bengali, and Tamil digits with ASCII 0-9."""
    if not text:
        return text
    chars = []
    for ch in text:
        chars.append(INDIC_DIGIT_MAP.get(ch, ch))
    return "".join(chars)


def parse_indic_spoken_number(text: str) -> Optional[int]:
    """Extracts a single numerical integer from a spoken phrase in Marathi/Hindi/Tamil/Bengali/English.
    
    Examples:
        "सत्तावीस" -> 27
        "माझं वय सत्तावीस वर्षे आहे" -> 27
        "वय पंचवीस" -> 25
        "२७" -> 27
        "age 28" -> 28
    """
    if not text:
        return None
    
    clean = convert_indic_digits(text.strip())
    
    # 1. Direct digit match if pure number
    pure_digit_m = re.search(r"\b(\d{1,4})\b", clean)
    if pure_digit_m:
        return int(pure_digit_m.group(1))

    # 2. Check compound hundreds e.g. "एकशे चाळीस" (140), "एक सौ बीस" (120)
    for h_phrase, h_base in HUNDREDS_PREFIXES.items():
        if h_phrase in clean:
            after_h = clean.split(h_phrase, 1)[1].strip()
            # check words after hundreds
            for w, val in sorted(ALL_INDIC_WORDS.items(), key=lambda x: -len(x[0])):
                if w in after_h:
                    return h_base + val
            # check if digit after hundreds e.g. "एकशे 40"
            d_m = re.search(r"\b(\d{1,2})\b", after_h)
            if d_m:
                return h_base + int(d_m.group(1))
            return h_base

    # 3. Check exact or embedded Indic number words (sorted longest first)
    for word, val in sorted(ALL_INDIC_WORDS.items(), key=lambda x: -len(x[0])):
        # match whole word
        pattern = rf"(?<![\w\u0900-\u097F]){re.escape(word)}(?![\w\u0900-\u097F])"
        if re.search(pattern, clean):
            return val

    # 4. Fallback search for any digits
    any_digit = re.search(r"\d+", clean)
    if any_digit:
        return int(any_digit.group(0))

    return None


def normalize_indic_numbers_in_text(text: str) -> str:
    """Finds all Indic digits and spoken number words in text and replaces them with standard Arabic digits.
    
    Examples:
        "रुग्णाचे नाव अनिता, वय सत्तावीस वर्षे, रक्तदाब एकशे चाळीस बटा नव्वद"
        -> "रुग्णाचे नाव अनिता, वय 27 वर्षे, रक्तदाब 140/90"
        
        "वय २५, बीपी १२०/८०, वजन ५८ किलो"
        -> "वय 25, बीपी 120/80, वजन 58 किलो"
    """
    if not text:
        return text

    # Step 1: Convert all unicode Indic numerals to ASCII 0-9
    out = convert_indic_digits(text)

    # Step 2: Handle compound hundreds like "एकशे चाळीस" -> "140", "एक सौ बीस" -> "120"
    for h_phrase, h_base in HUNDREDS_PREFIXES.items():
        for w, val in sorted(ALL_INDIC_WORDS.items(), key=lambda x: -len(x[0])):
            compound = f"{h_phrase} {w}"
            if compound in out:
                out = out.replace(compound, str(h_base + val))
            compound_dash = f"{h_phrase}-{w}"
            if compound_dash in out:
                out = out.replace(compound_dash, str(h_base + val))

    # Step 3: Handle single number words
    for word, val in sorted(ALL_INDIC_WORDS.items(), key=lambda x: -len(x[0])):
        pattern = rf"(?<![\w\u0900-\u097F]){re.escape(word)}(?![\w\u0900-\u097F])"
        out = re.sub(pattern, str(val), out)

    # Step 4: Refine blood pressure spoken formats:
    # "140 बटा 90", "140 आणि 90", "140 चे 90", "140 by 90", "140 over 90" -> "140/90"
    out = re.sub(r"(\d{2,3})\s*(?:बटा|आणि|चे|by|over|x|to)\s*(\d{2,3})", r"\1/\2", out, flags=re.IGNORECASE)

    # Step 5: Refine Age phrases:
    # "वय 27 वर्षे", "उम्र 27 साल", "27 वर्षे वय"
    out = re.sub(r"वय\s*:\s*(\d+)", r"Age: \1", out, flags=re.IGNORECASE)

    return out
