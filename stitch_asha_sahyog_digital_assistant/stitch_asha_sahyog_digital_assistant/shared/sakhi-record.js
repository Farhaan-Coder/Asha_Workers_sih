/**
 * Voice -> Audio-to-Transcript -> Structured Form Flow.
 * Ported and enhanced from MOM-generator (https://github.com/Ishant5436/MOM-generator)
 * for Sukanya / Sakhi ASHA Sahyog Digital Assistant.
 *
 * Provides:
 *   - Universal Audio/Video Ingestion (MP3, WAV, M4A, OGG, WEBM, MP4, MOV, MKV, VTT, SRT)
 *   - Live Audio Recording with Visual Waveform, Timer, and Speech Recognition
 *   - Multi-Engine Audio-to-Transcript Conversion (/api/transcribe)
 *   - Interactive Transcript Editor (speaker tags, copy, English translation)
 *   - Automatic Form Field Population & Accordion Expansion
 *   - Inline Field-Level Voice Dictation for individual inputs
 *   - Stored Health Records Database & Vector DB Viewer
 */
(function (global) {
  "use strict";

  const API = global.SukanyaAPI || global.SakhiAPI;
  const UI = global.SukanyaUI || global.SakhiUI;

  function resolvePath(obj, path) {
    return path.split(".").reduce((acc, key) => {
      return acc && typeof acc === "object" ? acc[key] : undefined;
    }, obj);
  }

  function setPath(obj, path, value) {
    const keys = path.split(".");
    let cur = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (typeof cur[k] !== "object" || cur[k] === null) cur[k] = {};
      cur = cur[k];
    }
    cur[keys[keys.length - 1]] = value;
  }

  // ── Speech Recognition & English Transmission Languages ──
  const SPEECH_LANG_KEY = "sukanya_speech_lang";
  const SPEECH_LANGUAGES = [
    { code: "hi", name: "हिन्दी (Hindi)", prompt: "Speak in Hindi (उदा. मरीज का नाम, उम्र, बीपी, लक्षण...)" },
    { code: "mr", name: "मराठी (Marathi)", prompt: "Speak in Marathi (उदा. रुग्णाचे नाव, वय, रक्तदाब, लक्षणे...)" },
    { code: "en", name: "English", prompt: "Speak in English (e.g. Patient name, age, blood pressure, symptoms...)" },
    { code: "ta", name: "தமிழ் (Tamil)", prompt: "Speak in Tamil (உதா. நோயாளி பெயர், வயது, இரத்த அழுத்தம்...)" },
    { code: "bn", name: "বাংলা (Bengali)", prompt: "Speak in Bengali (উদা. রোগীর নাম, বয়স, রক্তচাপ...)" },
    { code: "auto", name: "Auto-Detect", prompt: "Speak naturally in any regional language — auto-detects & translates" },
  ];

  function getSelectedSpeechLang() {
    try {
      return localStorage.getItem(SPEECH_LANG_KEY) || "hi";
    } catch (_) {
      return "hi";
    }
  }

  function setSelectedSpeechLang(lang) {
    try {
      localStorage.setItem(SPEECH_LANG_KEY, lang);
    } catch (_) {}
    document.querySelectorAll(".select-speech-lang, #vs-speech-lang, #nhm-transcribe-lang, #nhm-transcribe-lang-part2, #smart-transcribe-lang").forEach((sel) => {
      if (sel.value !== lang) sel.value = lang;
    });
  }

  function syncSpeechLangDropdowns() {
    const current = getSelectedSpeechLang();
    document.querySelectorAll(".select-speech-lang, #vs-speech-lang, #nhm-transcribe-lang, #nhm-transcribe-lang-part2, #smart-transcribe-lang").forEach((sel) => {
      sel.value = current;
      if (!sel.dataset.boundLangChange) {
        sel.dataset.boundLangChange = "true";
        sel.addEventListener("change", (e) => {
          setSelectedSpeechLang(e.target.value);
          const langObj = SPEECH_LANGUAGES.find(l => l.code === e.target.value) || SPEECH_LANGUAGES[0];
          UI.showToast(`Transcription language: ${langObj.name} (Auto-transmits to English)`, "info");
        });
      }
    });
  }

  // ── Indic Numbers & Clinical Refinement Engine ──
  const INDIC_DIGIT_MAP = {
    '०': '0', '१': '1', '२': '2', '३': '3', '४': '4', '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
    '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4', '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9',
    '௦': '0', '௧': '1', '௨': '2', '௩': '3', '௪': '4', '௫': '5', '௬': '6', '௭': '7', '௮': '8', '௯': '9',
  };

  const INDIC_WORD_NUMBERS = {
    // Marathi (0-100+)
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
    "एकाहत्तर": 71, "बाहत्तर": 72, "त्र्याहत्तर": 73, "चौर्‍याहत्तर": 74, "चौऱ्याहत्तर": 74, "पंच्याहत्तर": 75,
    "शहात्तर": 76, "सत्याहत्तर": 77, "अठ्याहत्तर": 78, "एकोणऐंशी": 79, "ऐंशी": 80,
    "एक्क्यांशी": 81, "ब्यांशी": 82, "त्र्यांशी": 83, "चौऱ्यांशी": 84, "पंच्यांशी": 85,
    "शहांशी": 86, "सत्यांशी": 87, "अठ्ठ्यांशी": 88, "एकोणनव्वद": 89, "नव्वद": 90,
    "एक्क्याण्णव": 91, "ब्याण्णव": 92, "त्र्याण्णव": 93, "चौऱ्याण्णव": 94, "पंच्याण्णव": 95,
    "शहाण्णव": 96, "सत्त्याण्णव": 97, "अठ्ठाण्णव": 98, "नव्व्याण्णव": 99, "शंभर": 100,

    // Hindi (0-100+)
    "दो": 2, "पांच": 5, "पाँच": 5, "छह": 6, "नौ": 9, "दस": 10,
    "ग्यारह": 11, "बारह": 12, "तेरह": 13, "चौदह": 14, "पंद्रह": 15,
    "सोलह": 16, "सत्रह": 17, "अठारह": 18, "उन्नीस": 19, "बीस": 20,
    "इक्कीस": 21, "बाईस": 22, "तेईस": 23, "चौबीस": 24, "पच्चीस": 25,
    "छब्बीस": 26, "सत्ताईस": 27, "सत्ताइस": 27, "अट्ठाईस": 28, "अट्ठाइस": 28, "उनतीस": 29,
    "इकत्तीस": 31, "तैंतीस": 33, "चौंतीस": 34, "पैंतीस": 35, "सैंतीस": 37, "अड़तीस": 38, "उनतालीस": 39,
    "इकतालीस": 41, "बयालीस": 42, "तैंतालीस": 43, "चवालीस": 44, "पैंतालीस": 45, "छियालीस": 46, "सैंतालीस": 47, "अड़तालीस": 48, "उनचास": 49, "पचास": 50,
    "इक्यावन": 51, "बावन": 52, "तिरेपन": 53, "चौवन": 54, "पचपन": 55, "छप्पन": 56, "सत्तावन": 57, "अट्ठावन": 58, "उनसठ": 59,
    "इकसठ": 61, "बासठ": 62, "तिरसठ": 63, "चौंसठ": 64, "पैंसठ": 65, "छियासठ": 66, "सरसठ": 67, "अड़सठ": 68, "उनहत्तर": 69,
    "इकहत्तर": 71, "बहत्तर": 72, "तिहत्तर": 73, "चौहत्तर": 74, "पचहत्तर": 75, "छिहत्तर": 76, "सतहत्तर": 77, "अठहत्तर": 78, "उन्नासी": 79, "अस्सी": 80,
    "इक्यासी": 81, "बयासी": 82, "तिरासी": 83, "चौरासी": 84, "पचासी": 85, "छियासी": 86, "सत्तासी": 87, "अठासी": 88, "नवासी": 89, "नब्बे": 90,
    "इक्यानवे": 91, "बानवे": 92, "तिरानवे": 93, "चौरानवे": 94, "पंचानवे": 95, "छियानवे": 96, "सत्तानवे": 97, "अट्ठानवे": 98, "निन्यानवे": 99, "सौ": 100
  };

  const HUNDREDS_PREFIXES = {
    "एकशे": 100, "एक सौ": 100, "एकसौ": 100, "दोनशे": 200, "दो सौ": 200, "तीनशे": 300, "तीन सौ": 300, "चारशे": 400, "पाचशे": 500
  };

  function convertIndicDigits(text) {
    if (!text) return "";
    return String(text).replace(/[०-९০-৯௦-௯]/g, (ch) => INDIC_DIGIT_MAP[ch] || ch);
  }

  function parseIndicSpokenNumber(text) {
    if (!text) return null;
    let clean = convertIndicDigits(String(text).trim());

    // 1. Direct regex for standalone age or number e.g. "वय 27", "age 28", "27"
    const explicitAgeM = clean.match(/(?:वय|उम्र|age|age is)\s*[:=]?\s*(\d{1,3})/i);
    if (explicitAgeM) return parseInt(explicitAgeM[1], 10);

    // 2. Check compound hundreds e.g. "एकशे चाळीस" (140)
    for (const [hPhrase, hBase] of Object.entries(HUNDREDS_PREFIXES)) {
      if (clean.includes(hPhrase)) {
        const afterH = clean.split(hPhrase)[1].trim();
        for (const [word, val] of Object.entries(INDIC_WORD_NUMBERS)) {
          if (afterH.includes(word)) return hBase + val;
        }
        const digitM = afterH.match(/\b(\d{1,2})\b/);
        if (digitM) return hBase + parseInt(digitM[1], 10);
        return hBase;
      }
    }

    // 3. Check individual word numbers
    for (const [word, val] of Object.entries(INDIC_WORD_NUMBERS)) {
      const reg = new RegExp(`(^|[^\\w\\u0900-\\u097F])${word}([^\\w\\u0900-\\u097F]|$)`);
      if (reg.test(clean)) return val;
    }

    // 4. Any clean number in digits
    const m = clean.match(/\b(\d{1,4})\b/);
    if (m) return parseInt(m[1], 10);

    return null;
  }

  function refineClinicalText(text) {
    if (!text) return "";
    let out = convertIndicDigits(text);

    // Convert compound hundreds
    for (const [hPhrase, hBase] of Object.entries(HUNDREDS_PREFIXES)) {
      for (const [word, val] of Object.entries(INDIC_WORD_NUMBERS)) {
        out = out.split(`${hPhrase} ${word}`).join(String(hBase + val));
        out = out.split(`${hPhrase}-${word}`).join(String(hBase + val));
      }
    }

    // Convert individual word numbers
    for (const [word, val] of Object.entries(INDIC_WORD_NUMBERS)) {
      const reg = new RegExp(`(^|[^\\w\\u0900-\\u097F])${word}([^\\w\\u0900-\\u097F]|$)`, "g");
      out = out.replace(reg, `$1${val}$2`);
    }

    // Blood pressure formatting: "140 बटा 90", "140 by 90", "140 over 90", "140 x 90" -> "140/90"
    out = out.replace(/(\d{2,3})\s*(?:बटा|बाय|by|over|x|चे|आणि|\/)\s*(\d{2,3})/gi, "$1/$2");

    // Standardize age keywords: "वय सत्तावीस" -> "Age: 27", "वय 27 वर्षे" -> "Age: 27 years"
    out = out.replace(/(?:वय|उम्र)\s*[:=]?\s*(\d{1,2})/gi, "Age: $1");

    return out;
  }

  function ensureSectionExpanded(input) {
    if (!input) return;
    // 1. Check standard form-section-toggle and details
    const section = input.closest(".form-section-toggle") || input.closest("details");
    if (section) {
      const content = section.querySelector(".form-content");
      const header = section.querySelector(".toggle-header");
      if (content && header && (content.classList.contains("hidden") || content.style.display === "none")) {
        header.click();
      }
      if (section.tagName === "DETAILS" && !section.open) section.open = true;
    }
    // 2. Un-hide any parent hidden containers (e.g. Part 2 forms, custom accordions)
    let parent = input.parentElement;
    while (parent && parent !== document.body) {
      if (parent.classList && (parent.classList.contains("hidden") || parent.style.display === "none")) {
        parent.classList.remove("hidden");
        parent.style.display = "block";
        const prev = parent.previousElementSibling;
        if (prev) {
          const icon = prev.querySelector(".chevron-icon, .material-symbols-outlined[data-icon='expand_more']");
          if (icon) icon.style.transform = "rotate(180deg)";
        }
      }
      parent = parent.parentElement;
    }
  }

  function autofill(root, form, visitType) {
    if (!form) return 0;
    let filled = 0;
    root.querySelectorAll("[data-sukanya-field], [data-sakhi-field]").forEach((input) => {
      const spec = input.getAttribute("data-sukanya-field") || input.getAttribute("data-sakhi-field");
      if (spec === "_pregnant") {
        if (input.type === "radio") {
          const wantYes = visitType === "anc_visit";
          input.checked = input.value === "yes" ? wantYes : !wantYes;
          if (input.checked) {
            ensureSectionExpanded(input);
            filled++;
          }
        }
        return;
      }
      let value = null;
      for (const candidate of spec.split(",")) {
        const v = resolvePath(form, candidate.trim());
        if (v !== undefined && v !== null && v !== "") {
          value = v;
          break;
        }
      }
      if (value == null) return;
      const format = input.getAttribute("data-sukanya-format") || input.getAttribute("data-sakhi-format");
      if (format === "weeks") value = `${value} weeks`;
      else if (format === "months") value = `${value} months`;
      else if (Array.isArray(value)) value = value.join(", ");
      if (input.type === "checkbox" || input.type === "radio") input.checked = !!value;
      else input.value = value;
      input.classList.add("ring-2", "ring-secondary");
      ensureSectionExpanded(input);
      filled++;
    });
    return filled;
  }

  function showTranscriptPanel(container, transcript, recordId, translation) {
    const prior = document.getElementById("sukanya-transcript-panel") || document.getElementById("sakhi-transcript-panel");
    if (prior) prior.remove();
    const panel = (window.SukanyaUI || window.SakhiUI).el(
      "div",
      "mb-6 border border-primary/20 rounded-2xl p-4 bg-primary-container/10 shadow-sm transition-all flex flex-col gap-3"
    );
    panel.id = "sukanya-transcript-panel";
    
    const refinedTranscript = refineClinicalText(transcript);
    const rawEnglish = translation && translation.english ? translation.english : "";
    const englishText = refineClinicalText(rawEnglish);

    const translationsCache = {
      orig: transcript,
      en: englishText || refinedTranscript,
    };
    let activeLang = "orig";

    const langButtons = [
      { code: "orig", label: "🎙️ Original Spoken" },
      { code: "en", label: "🇬🇧 English" },
      { code: "hi", label: "🇮🇳 हिन्दी (Hindi)" },
      { code: "mr", label: "🚩 मराठी (Marathi)" },
      { code: "bn", label: "🇧🇩 বাংলা (Bengali)" },
      { code: "ta", label: "🇮🇳 தமிழ் (Tamil)" },
      { code: "te", label: "🇮🇳 తెలుగు (Telugu)" },
      { code: "gu", label: "🇮🇳 ગુજરાતી (Gujarati)" },
      { code: "kn", label: "🇮🇳 ಕನ್ನಡ (Kannada)" },
    ];

    panel.innerHTML = `
      <div class="flex items-center justify-between flex-wrap gap-2">
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-primary text-[22px]">record_voice_over</span>
          <div>
            <h4 class="font-label-md text-sm text-primary font-extrabold">Clinical Voice Transcript &amp; Translations</h4>
            <p class="text-[11px] text-on-surface-variant">Multilingual transcript with AI clinical diarization &amp; translation.</p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button type="button" id="btn-panel-copy-transcript" class="text-xs px-3 py-1.5 rounded-lg bg-surface-container-high hover:bg-surface-container text-primary font-bold flex items-center gap-1 shadow-xs active:scale-95 transition-transform">
            <span class="material-symbols-outlined text-xs">content_copy</span> Copy
          </button>
          <span class="text-xs px-2.5 py-0.5 rounded-full bg-primary/10 text-primary font-bold">✨ Transcribed &amp; Diarized</span>
        </div>
      </div>

      <!-- Language Selector Tabs -->
      <div class="flex items-center gap-1.5 overflow-x-auto pb-1 pt-1 no-scrollbar border-b border-primary/15" id="transcript-lang-tabs">
        ${langButtons.map(btn => `
          <button type="button" class="transcript-lang-pill text-xs font-bold px-3 py-1 rounded-lg transition-all shrink-0 border ${btn.code === 'orig' ? 'bg-primary text-white border-primary shadow-xs' : 'bg-surface-container-low text-primary border-outline/50 hover:bg-surface-container'}" data-lang="${btn.code}">
            ${btn.label}
          </button>
        `).join("")}
      </div>

      <!-- Active Transcript View -->
      <div class="relative bg-surface-container-lowest p-3.5 rounded-xl border border-outline/40 shadow-xs">
        <div class="flex items-center justify-between text-[11px] font-bold text-on-surface-variant mb-1.5 border-b border-outline-variant pb-1">
          <span id="transcript-active-lang-badge" class="text-primary flex items-center gap-1">
            <span class="material-symbols-outlined text-sm">translate</span>
            <span>Language: Original Spoken</span>
          </span>
          <span id="transcript-backend-badge" class="text-[10px] bg-surface-container px-2 py-0.5 rounded text-on-surface-variant">Live Audio Engine</span>
        </div>
        <p id="transcript-active-text" class="font-mono text-xs text-on-surface leading-relaxed" style="white-space:pre-wrap">${transcript}</p>
        <div id="transcript-translating-indicator" class="hidden absolute inset-0 bg-white/80 backdrop-blur-2xs rounded-xl flex items-center justify-center gap-2 text-xs font-bold text-primary">
          <span class="material-symbols-outlined text-base animate-spin">refresh</span>
          <span>Translating with Gemma Clinical Engine...</span>
        </div>
      </div>

      <!-- Ask a Question Section -->
      <div class="mt-2 pt-3 border-t border-primary/15">
        <div class="flex items-center gap-2 mb-2">
          <span class="material-symbols-outlined text-primary text-[18px]">forum</span>
          <p class="text-xs font-bold text-primary">Ask a question about this visit</p>
        </div>
        <div class="flex gap-2">
          <input type="text" id="transcript-ask-input" placeholder="e.g. What was the patient's blood pressure or symptom?" class="flex-1 h-9 px-3 text-xs border border-outline rounded-lg bg-surface" />
          <button type="button" id="transcript-ask-btn" class="h-9 px-3.5 bg-primary text-on-primary rounded-lg text-xs font-bold hover:bg-primary-container transition-colors">Ask</button>
        </div>
        <div id="transcript-ask-answer" class="hidden mt-2 text-xs bg-surface-container-lowest p-3 rounded-lg border border-outline/40"></div>
      </div>

      <!-- AI Summary Section -->
      <div class="mt-2 pt-3 border-t border-primary/15">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            <span class="material-symbols-outlined text-primary text-[18px]">auto_awesome</span>
            <p class="text-xs font-bold text-primary">AI Visit Summary</p>
          </div>
          <button type="button" id="transcript-summarize-btn" class="h-8 px-3 bg-primary text-on-primary rounded-lg text-xs font-bold hover:bg-primary-container transition-colors">Generate</button>
        </div>
        <p class="text-[10px] text-on-surface-variant -mt-1 mb-2">A second, AI-generated read of the transcript — not a substitute for the structured form above.</p>
        <div id="transcript-summary-result" class="hidden text-xs bg-surface-container-lowest p-3 rounded-lg border border-outline/40"></div>
      </div>
    `;

    // Interactive Language Pills Switching
    const langPills = panel.querySelectorAll(".transcript-lang-pill");
    const activeTextEl = panel.querySelector("#transcript-active-text");
    const activeBadgeEl = panel.querySelector("#transcript-active-lang-badge");
    const backendBadgeEl = panel.querySelector("#transcript-backend-badge");
    const translatingIndicator = panel.querySelector("#transcript-translating-indicator");

    langPills.forEach((pill) => {
      pill.addEventListener("click", async () => {
        const lang = pill.getAttribute("data-lang");
        if (lang === activeLang && translationsCache[lang]) return;
        activeLang = lang;

        langPills.forEach((p) => {
          p.classList.remove("bg-primary", "text-white", "border-primary", "shadow-xs");
          p.classList.add("bg-surface-container-low", "text-primary", "border-outline/50");
        });
        pill.classList.remove("bg-surface-container-low", "border-outline/50");
        pill.classList.add("bg-primary", "text-white", "border-primary", "shadow-xs");

        const btnMeta = langButtons.find((b) => b.code === lang);
        activeBadgeEl.innerHTML = `<span class="material-symbols-outlined text-sm">translate</span> <span>Language: ${btnMeta ? btnMeta.label : lang.toUpperCase()}</span>`;

        if (translationsCache[lang]) {
          activeTextEl.textContent = translationsCache[lang];
          return;
        }

        // Fetch translation from API
        translatingIndicator.classList.remove("hidden");
        try {
          const API = window.SukanyaAPI || window.SakhiAPI;
          const res = await API.translate(transcript, lang, "auto");
          const trans = res.translated_text || res.english || transcript;
          translationsCache[lang] = trans;
          activeTextEl.textContent = trans;
          if (backendBadgeEl && res.backend) {
            backendBadgeEl.textContent = `✨ ${res.backend.replace(/_/g, " ").toUpperCase()}`;
          }
        } catch (err) {
          (window.SukanyaUI || window.SakhiUI).showToast(`Could not translate to ${lang}: ${err.message}`, "error");
          activeTextEl.textContent = transcript;
        } finally {
          translatingIndicator.classList.add("hidden");
        }
      });
    });

    const copyBtn = panel.querySelector("#btn-panel-copy-transcript");
    if (copyBtn) {
      copyBtn.addEventListener("click", () => {
        const currentText = activeTextEl ? activeTextEl.textContent : transcript;
        navigator.clipboard.writeText(currentText).then(() => {
          (window.SukanyaUI || window.SakhiUI).showToast("Transcript copied to clipboard!", "success");
        });
      });
    }
    const askBtn = panel.querySelector("#transcript-ask-btn");
    const askInput = panel.querySelector("#transcript-ask-input");
    const answerBox = panel.querySelector("#transcript-ask-answer");
    if (askBtn) {
      askBtn.addEventListener("click", async () => {
        const question = (askInput.value || "").trim();
        if (!question) return;
        answerBox.classList.remove("hidden");
        answerBox.textContent = "Thinking...";
        try {
          const API = window.SukanyaAPI || window.SakhiAPI;
          const result = recordId
            ? await API.askAboutRecord(recordId, question)
            : await API.askAboutTranscript(transcript, question);
          if (result.error) {
            answerBox.textContent = result.detail || "Could not answer that question.";
          } else {
            let html = `<p class="text-on-surface">${result.answer}</p>`;
            if (result.excerpts && result.excerpts.length) {
              html += `<ul class="mt-2 list-disc list-inside text-on-surface-variant">${result.excerpts.map((e) => `<li>${e}</li>`).join("")}</ul>`;
            }
            html += `<p class="mt-1 text-[10px] text-on-surface-variant/70">via ${result.model || "unknown"}</p>`;
            answerBox.innerHTML = html;
          }
        } catch (err) {
          answerBox.textContent = err.message || "Could not answer that question.";
        }
      });
      askInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") askBtn.click();
      });
    }

    const summarizeBtn = panel.querySelector("#transcript-summarize-btn");
    const summaryBox = panel.querySelector("#transcript-summary-result");
    if (summarizeBtn) {
      summarizeBtn.addEventListener("click", async () => {
        summaryBox.classList.remove("hidden");
        summaryBox.textContent = "Generating summary...";
        summarizeBtn.disabled = true;
        try {
          const API = window.SukanyaAPI || window.SakhiAPI;
          const result = recordId
            ? await API.summarizeRecord(recordId)
            : await API.summarizeTranscript(transcript);
          if (result.error) {
            summaryBox.textContent = result.detail || "Could not generate a summary.";
          } else {
            let html = "";
            if (result.summary) html += `<p class="text-on-surface mb-2">${result.summary}</p>`;
            if (result.symptoms_identified && result.symptoms_identified.length) {
              html += `<p class="font-bold text-primary text-[11px] mb-1">Symptoms identified</p><ul class="list-disc list-inside text-on-surface-variant mb-2">${result.symptoms_identified.map((s) => `<li>${s}</li>`).join("")}</ul>`;
            }
            if (result.advice_given && result.advice_given.length) {
              html += `<p class="font-bold text-primary text-[11px] mb-1">Advice given</p><ul class="list-disc list-inside text-on-surface-variant mb-2">${result.advice_given.map((s) => `<li>${s}</li>`).join("")}</ul>`;
            }
            html += `<p class="mt-1 text-[10px] text-on-surface-variant/70">via ${result.model || "unknown"}</p>`;
            summaryBox.innerHTML = html || "No summary content returned.";
          }
        } catch (err) {
          summaryBox.textContent = err.message || "Could not generate a summary.";
        } finally {
          summarizeBtn.disabled = false;
        }
      });
    }

    container.insertBefore(panel, container.firstChild);
  }

  /**
   * Universal Voice Studio Modal with tabs for:
   * 1. Live Recording (MediaRecorder + Waveform + Timer)
   * 2. File Upload (Audio/Video ingestion)
   * 3. Sample Audio Clips
   * 4. Text / Subtitles Input
   */
  function openVoiceStudioModal(arg1, arg2) {
    const UI = window.SukanyaUI || window.SakhiUI;
    const API = window.SukanyaAPI || window.SakhiAPI;

    let getMetadata = typeof arg1 === "function" ? arg1 : (arg1 && arg1.getMetadata ? arg1.getMetadata : () => ({}));
    let onResult = typeof arg2 === "function" ? arg2 : (arg1 && arg1.onResult ? arg1.onResult : () => {});

    let mediaStream = null;
    let mediaRecorder = null;
    let recordedChunks = [];
    let recordTimerInterval = null;
    let recordStartTime = null;
    let selectedFile = null;
    let currentTranscript = "";
    let currentAudioBase64 = null;
    let currentAudioMimeType = "audio/webm";

    const overlay = UI.el("div", "fixed inset-0 z-[120] bg-black/60 flex items-center justify-center p-3 md:p-6 overflow-y-auto");
    overlay.id = "voice-studio-overlay";

    overlay.innerHTML = `
      <div class="bg-surface-container-lowest rounded-2xl shadow-2xl w-full max-w-xl p-5 md:p-6 border border-outline max-h-[90vh] flex flex-col my-auto">
        <!-- Header -->
        <div class="flex items-center justify-between pb-3 border-b border-outline/60">
          <div class="flex items-center gap-2">
            <span class="w-8 h-8 rounded-full bg-primary text-on-primary flex items-center justify-center">
              <span class="material-symbols-outlined text-[18px]">mic</span>
            </span>
            <div>
              <h3 class="font-headline-sm text-primary font-bold leading-tight">Voice Studio</h3>
              <p class="text-xs text-on-surface-variant">Audio to Transcript &amp; Clinical Extraction Engine</p>
            </div>
          </div>
          <button type="button" id="vs-close-btn" class="w-8 h-8 flex items-center justify-center rounded-full hover:bg-surface-container text-on-surface-variant">
            <span class="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <!-- Spoken Voice Language Selector -->
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 bg-surface-container-low border border-outline/50 rounded-xl my-2 text-xs">
          <div class="flex items-center gap-1.5 font-bold text-primary">
            <span class="material-symbols-outlined text-base text-secondary">record_voice_over</span>
            <span>Spoken Language:</span>
          </div>
          <div class="flex items-center gap-2">
            <select id="vs-speech-lang" class="select-speech-lang bg-surface-container-lowest text-primary font-bold text-xs px-2.5 py-1.5 rounded-lg border border-outline focus:ring-1 focus:ring-primary cursor-pointer shadow-2xs">
              <option value="hi">🇮🇳 हिन्दी (Hindi)</option>
              <option value="mr">🇮🇳 मराठी (Marathi)</option>
              <option value="en">🇬🇧 English</option>
              <option value="ta">🇮🇳 தமிழ் (Tamil)</option>
              <option value="bn">🇮🇳 বাংলা (Bengali)</option>
              <option value="auto">🌐 Auto-Detect</option>
            </select>
            <span class="text-[10px] bg-secondary/15 text-secondary font-extrabold px-2 py-1 rounded-md border border-secondary/30 flex items-center gap-1">
              <span class="material-symbols-outlined text-xs">g_translate</span>
              <span>Transmits in English</span>
            </span>
          </div>
        </div>

        <!-- Studio Navigation Tabs -->
        <div class="flex border-b border-outline/40 mb-3 gap-1 bg-surface-container-low p-1 rounded-xl">
          <button type="button" data-tab="mic" class="vs-tab-btn flex-1 py-2 text-xs font-semibold rounded-lg bg-primary text-on-primary shadow-sm flex items-center justify-center gap-1.5 transition-all">
            <span class="material-symbols-outlined text-[16px]">mic</span> Record Live
          </button>
          <button type="button" data-tab="upload" class="vs-tab-btn flex-1 py-2 text-xs font-semibold rounded-lg text-on-surface-variant hover:bg-surface-container flex items-center justify-center gap-1.5 transition-all">
            <span class="material-symbols-outlined text-[16px]">upload_file</span> Upload Media
          </button>
          <button type="button" data-tab="samples" class="vs-tab-btn flex-1 py-2 text-xs font-semibold rounded-lg text-on-surface-variant hover:bg-surface-container flex items-center justify-center gap-1.5 transition-all">
            <span class="material-symbols-outlined text-[16px]">headphones</span> Audio Clips
          </button>
          <button type="button" data-tab="text" class="vs-tab-btn flex-1 py-2 text-xs font-semibold rounded-lg text-on-surface-variant hover:bg-surface-container flex items-center justify-center gap-1.5 transition-all">
            <span class="material-symbols-outlined text-[16px]">article</span> Text/Script
          </button>
        </div>

        <!-- Body Tabs Container -->
        <div class="flex-1 overflow-y-auto py-2">
          
          <!-- TAB 1: Live Mic Recording -->
          <div id="vs-pane-mic" class="vs-pane flex flex-col items-center text-center py-4">
            <div id="vs-rec-indicator" class="relative w-20 h-20 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center mb-3 shadow-inner">
              <span class="material-symbols-outlined text-4xl" id="vs-rec-icon">mic</span>
              <div id="vs-pulse-ring" class="hidden absolute inset-0 rounded-full bg-secondary/30 animate-ping"></div>
            </div>
            
            <div class="text-2xl font-mono font-bold text-primary mb-1" id="vs-timer">00:00</div>
            <p class="text-xs text-on-surface-variant mb-4 font-medium" id="vs-mic-status">Ready to record. Speak in Hindi / Hinglish.</p>
            
            <!-- Soundwave animation bars -->
            <div id="vs-soundwave" class="hidden flex items-center gap-1.5 h-8 mb-4">
              <span class="w-1.5 bg-secondary rounded-full h-3 animate-pulse"></span>
              <span class="w-1.5 bg-secondary rounded-full h-6 animate-pulse" style="animation-delay:0.15s"></span>
              <span class="w-1.5 bg-secondary rounded-full h-8 animate-pulse" style="animation-delay:0.3s"></span>
              <span class="w-1.5 bg-secondary rounded-full h-5 animate-pulse" style="animation-delay:0.45s"></span>
              <span class="w-1.5 bg-secondary rounded-full h-3 animate-pulse" style="animation-delay:0.6s"></span>
            </div>

            <!-- Audio Player Preview (post-record) -->
            <audio id="vs-mic-audio-player" class="hidden w-full mb-3 rounded-lg" controls></audio>

            <div class="flex gap-2 w-full max-w-sm">
              <button type="button" id="vs-start-rec-btn" class="flex-1 h-touch-target-min bg-primary text-on-primary rounded-xl font-label-md text-xs font-semibold shadow-sm hover:bg-primary-container flex items-center justify-center gap-2 transition-all">
                <span class="material-symbols-outlined text-[18px]">fiber_manual_record</span> Start Recording
              </button>
              <button type="button" id="vs-stop-rec-btn" class="hidden flex-1 h-touch-target-min bg-error text-on-error rounded-xl font-label-md text-xs font-semibold shadow-sm hover:opacity-90 flex items-center justify-center gap-2 transition-all">
                <span class="material-symbols-outlined text-[18px]">stop</span> Stop &amp; Transcribe
              </button>
            </div>
          </div>

          <!-- TAB 2: File Upload (Audio / Video / Subtitles) -->
          <div id="vs-pane-upload" class="vs-pane hidden flex-col gap-3 py-2">
            <div id="vs-dropzone" class="border-2 border-dashed border-outline hover:border-primary rounded-2xl p-6 text-center cursor-pointer transition-colors bg-surface-container-low/40">
              <span class="material-symbols-outlined text-4xl text-primary mb-2">cloud_upload</span>
              <p class="text-xs font-semibold text-primary">Click to browse or drag &amp; drop audio/video file</p>
              <p class="text-[11px] text-on-surface-variant mt-1">Supports MP3, WAV, M4A, OGG, WEBM, FLAC, MP4, MOV, MKV, VTT, SRT</p>
              <input type="file" id="vs-file-input" accept="audio/*,video/*,.mp3,.wav,.m4a,.ogg,.webm,.flac,.aac,.mp4,.mov,.mkv,.m4v,.avi,.vtt,.srt,.txt" class="hidden" />
            </div>

            <div id="vs-file-info" class="hidden bg-surface-container-low p-3 rounded-xl border border-outline/50 flex flex-col gap-2">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <span class="material-symbols-outlined text-primary text-[20px]">audio_file</span>
                  <span class="text-xs font-semibold text-primary truncate max-w-[200px]" id="vs-file-name">file.wav</span>
                </div>
                <span class="text-[11px] text-on-surface-variant font-mono" id="vs-file-size">0 KB</span>
              </div>
              <audio id="vs-upload-audio-player" class="w-full h-8" controls></audio>
            </div>

            <button type="button" id="vs-transcribe-upload-btn" class="h-touch-target-min bg-primary text-on-primary rounded-xl font-label-md text-xs font-semibold shadow-sm hover:bg-primary-container flex items-center justify-center gap-2 disabled:opacity-50 transition-all" disabled>
              <span class="material-symbols-outlined text-[18px]">transcribe</span> Transcribe Selected Media
            </button>
          </div>

          <!-- TAB 3: Curated Audio Examples -->
          <div id="vs-pane-samples" class="vs-pane hidden flex-col gap-2 py-2">
            <p class="text-xs text-on-surface-variant mb-1">Select a curated role-play audio sample to test the pipeline:</p>
            <div class="flex flex-col gap-2" id="vs-samples-list">
              <div class="sample-item p-3 rounded-xl border border-outline bg-surface-container-low hover:border-primary cursor-pointer transition-all flex items-center justify-between" data-sample="preeclampsia">
                <div>
                  <h4 class="text-xs font-bold text-error flex items-center gap-1">
                    <span class="material-symbols-outlined text-[16px]">warning</span> ANC Visit — Preeclampsia (DANGER)
                  </h4>
                  <p class="text-[11px] text-on-surface-variant mt-0.5">Sunita Sharma, 28y, BP 155/100, severe headache, blurry vision</p>
                </div>
                <span class="material-symbols-outlined text-primary">play_circle</span>
              </div>

              <div class="sample-item p-3 rounded-xl border border-outline bg-surface-container-low hover:border-primary cursor-pointer transition-all flex items-center justify-between" data-sample="routine_anc">
                <div>
                  <h4 class="text-xs font-bold text-secondary flex items-center gap-1">
                    <span class="material-symbols-outlined text-[16px]">check_circle</span> ANC Visit — Normal Routine
                  </h4>
                  <p class="text-[11px] text-on-surface-variant mt-0.5">Anita Devi, 24y, BP 110/70, 58kg, 6 months (24 weeks), IFA pills</p>
                </div>
                <span class="material-symbols-outlined text-primary">play_circle</span>
              </div>

              <div class="sample-item p-3 rounded-xl border border-outline bg-surface-container-low hover:border-primary cursor-pointer transition-all flex items-center justify-between" data-sample="pnc_sepsis">
                <div>
                  <h4 class="text-xs font-bold text-error flex items-center gap-1">
                    <span class="material-symbols-outlined text-[16px]">emergency</span> PNC Mother — Postpartum Sepsis (DANGER)
                  </h4>
                  <p class="text-[11px] text-on-surface-variant mt-0.5">Pooja Kumari, 22y, 102°F fever, foul lochia, heavy bleeding</p>
                </div>
                <span class="material-symbols-outlined text-primary">play_circle</span>
              </div>

              <div class="sample-item p-3 rounded-xl border border-outline bg-surface-container-low hover:border-primary cursor-pointer transition-all flex items-center justify-between" data-sample="newborn_danger">
                <div>
                  <h4 class="text-xs font-bold text-error flex items-center gap-1">
                    <span class="material-symbols-outlined text-[16px]">emergency</span> PNC Newborn — Not Feeding (DANGER)
                  </h4>
                  <p class="text-[11px] text-on-surface-variant mt-0.5">Baby of Rina, 100.5°F fever, weak cry, lethargic</p>
                </div>
                <span class="material-symbols-outlined text-primary">play_circle</span>
              </div>

              <div class="sample-item p-3 rounded-xl border border-outline bg-surface-container-low hover:border-primary cursor-pointer transition-all flex items-center justify-between" data-sample="child_diarrhea">
                <div>
                  <h4 class="text-xs font-bold text-error flex items-center gap-1">
                    <span class="material-symbols-outlined text-[16px]">warning</span> Child Health — Diarrhea &amp; SAM (DANGER)
                  </h4>
                  <p class="text-[11px] text-on-surface-variant mt-0.5">Rahul, 8 months, 6.2kg, acute diarrhea 3 days, dehydrated</p>
                </div>
                <span class="material-symbols-outlined text-primary">play_circle</span>
              </div>
            </div>
          </div>

          <!-- TAB 4: Text Input -->
          <div id="vs-pane-text" class="vs-pane hidden flex-col gap-2 py-2">
            <p class="text-xs text-on-surface-variant mb-1">Paste or type home-visit conversation (Hindi / English / Hinglish):</p>
            <textarea id="vs-paste-input" rows="6" class="w-full p-3 border border-outline rounded-xl font-mono text-xs focus:ring-2 focus:ring-primary outline-none leading-relaxed" placeholder="ASHA: नमस्ते अनीता देवी जी, आपकी उम्र 24 साल है। आपका BP 110/70 है और वजन 58 kg है..."></textarea>
            <div class="flex gap-2">
              <button type="button" id="vs-text-extract-btn" class="flex-1 h-touch-target-min border border-outline hover:bg-surface-container text-primary rounded-xl font-label-md text-xs font-semibold flex items-center justify-center gap-2">
                <span class="material-symbols-outlined text-[18px]">subject</span> Review Transcript
              </button>
              <button type="button" id="vs-text-instant-autofill-btn" class="flex-[1.5] h-touch-target-min bg-primary text-on-primary rounded-xl font-label-md text-xs font-bold shadow-sm hover:bg-primary-container flex items-center justify-center gap-2">
                <span class="material-symbols-outlined text-[18px]">assignment_turned_in</span> Instant Autofill Form
              </button>
            </div>
          </div>

          <!-- Transcript Result Workspace -->
          <div id="vs-transcript-workspace" class="hidden mt-4 pt-4 border-t border-outline/60 flex flex-col gap-3">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold text-primary flex items-center gap-1.5">
                <span class="material-symbols-outlined text-[18px] text-secondary">forum</span>
                <span>Clinical Dialogue Transcript</span>
              </span>
              <div class="flex items-center gap-2">
                <button type="button" id="vs-toggle-view-btn" class="text-[11px] font-bold text-primary hover:underline bg-surface-container-low px-2 py-0.5 rounded border border-outline/60">
                  📝 Raw Text
                </button>
                <span class="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold" id="vs-backend-badge">MLX Whisper</span>
              </div>
            </div>

            <!-- Styled Dialogue Bubble Preview -->
            <div id="vs-dialogue-bubbles" class="space-y-2 max-h-60 overflow-y-auto p-3 bg-surface-container-low/50 rounded-xl border border-outline/60 text-xs leading-relaxed"></div>

            <!-- Raw Editable Textarea (Hidden by default or toggled) -->
            <textarea id="vs-transcript-editor" rows="5" class="hidden w-full p-3 border border-outline rounded-xl font-mono text-xs bg-surface-container-lowest focus:ring-2 focus:ring-primary outline-none leading-relaxed" placeholder="Transcript text..."></textarea>

            <!-- Multi-Language Translation Box -->
            <div id="vs-translation-box" class="hidden bg-accent-blue p-3.5 rounded-xl border border-blue-200 text-xs flex flex-col gap-1.5 shadow-xs">
              <div class="flex items-center justify-between font-bold text-blue-950">
                <span class="flex items-center gap-1.5" id="vs-translation-label">
                  <span class="material-symbols-outlined text-[18px] text-blue-700">g_translate</span>
                  <span id="vs-translation-title">English Translation (Gemma)</span>
                </span>
                <button type="button" id="vs-copy-translation-btn" class="text-[11px] px-2 py-0.5 rounded bg-white/80 hover:bg-white text-blue-900 font-bold border border-blue-200 flex items-center gap-1">
                  <span class="material-symbols-outlined text-xs">content_copy</span> Copy
                </button>
              </div>
              <p class="text-slate-900 text-xs font-mono leading-relaxed bg-white/70 p-2.5 rounded-lg border border-blue-100" id="vs-translation-text" style="white-space:pre-wrap"></p>
            </div>

            <!-- Workspace Actions & Multi-Language Translate Selector -->
            <div class="flex flex-col sm:flex-row gap-2 pt-1">
              <button type="button" id="vs-copy-btn" class="flex-1 h-touch-target-min border border-outline hover:bg-surface-container text-primary rounded-xl text-xs font-bold flex items-center justify-center gap-1">
                <span class="material-symbols-outlined text-[18px]">content_copy</span> Copy Raw
              </button>
              
              <div class="flex-[2] flex gap-1.5">
                <select id="vs-translate-target-lang" class="w-1/2 h-touch-target-min text-xs px-2.5 bg-surface-container-low border border-outline rounded-xl font-bold text-primary focus:ring-2 focus:ring-primary outline-none">
                  <option value="en" selected>🇬🇧 English</option>
                  <option value="hi">🇮🇳 हिन्दी (Hindi)</option>
                  <option value="mr">🚩 मराठी (Marathi)</option>
                  <option value="bn">🇧🇩 বাংলা (Bengali)</option>
                  <option value="ta">🇮🇳 தமிழ் (Tamil)</option>
                  <option value="te">🇮🇳 తెలుగు (Telugu)</option>
                  <option value="gu">🇮🇳 ગુજરાતી (Gujarati)</option>
                  <option value="kn">🇮🇳 ಕನ್ನಡ (Kannada)</option>
                </select>
                <button type="button" id="vs-translate-btn" class="w-1/2 h-touch-target-min bg-primary hover:bg-primary-container text-on-primary rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-xs active:scale-95 transition-transform">
                  <span class="material-symbols-outlined text-[18px]">translate</span> Translate
                </button>
              </div>

              <button type="button" id="vs-autofill-btn" class="flex-[2] h-touch-target-min bg-secondary text-white rounded-xl text-xs font-bold shadow-md hover:bg-secondary-dark flex items-center justify-center gap-1.5 active:scale-98 transition-transform">
                <span class="material-symbols-outlined text-[18px]">assignment_turned_in</span> Autofill Health Form
              </button>
            </div>
          </div>

        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Tab Switching Logic
    const tabBtns = overlay.querySelectorAll(".vs-tab-btn");
    const panes = overlay.querySelectorAll(".vs-pane");
    tabBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetTab = btn.getAttribute("data-tab");
        tabBtns.forEach((b) => {
          b.classList.remove("bg-primary", "text-on-primary", "shadow-sm");
          b.classList.add("text-on-surface-variant");
        });
        btn.classList.add("bg-primary", "text-on-primary", "shadow-sm");
        btn.classList.remove("text-on-surface-variant");

        panes.forEach((p) => p.classList.add("hidden"));
        const activePane = overlay.querySelector(`#vs-pane-${targetTab}`);
        if (activePane) activePane.classList.remove("hidden");
      });
    });

    // Cleanup & Close Logic
    const closeBtn = overlay.querySelector("#vs-close-btn");
    const cleanup = () => {
      if (recordTimerInterval) clearInterval(recordTimerInterval);
      if (mediaRecorder && mediaRecorder.state !== "inactive") {
        try { mediaRecorder.stop(); } catch (_) {}
      }
      if (mediaStream) {
        mediaStream.getTracks().forEach((t) => t.stop());
      }
      overlay.remove();
    };
    closeBtn.addEventListener("click", cleanup);

    // Speech Language Selector within Voice Studio
    const vsSpeechLangSelect = overlay.querySelector("#vs-speech-lang");
    function updateMicStatusPrompt() {
      const curLang = getSelectedSpeechLang();
      const obj = SPEECH_LANGUAGES.find((l) => l.code === curLang) || SPEECH_LANGUAGES[0];
      if (micStatusEl) {
        micStatusEl.textContent = obj.prompt;
      }
    }
    if (vsSpeechLangSelect) {
      vsSpeechLangSelect.value = getSelectedSpeechLang();
      vsSpeechLangSelect.addEventListener("change", (e) => {
        setSelectedSpeechLang(e.target.value);
        updateMicStatusPrompt();
      });
    }

    // Live Recording Controls
    const startRecBtn = overlay.querySelector("#vs-start-rec-btn");
    const stopRecBtn = overlay.querySelector("#vs-stop-rec-btn");
    const timerEl = overlay.querySelector("#vs-timer");
    const micStatusEl = overlay.querySelector("#vs-mic-status");
    const soundwaveEl = overlay.querySelector("#vs-soundwave");
    const pulseRingEl = overlay.querySelector("#vs-pulse-ring");
    const micAudioPlayer = overlay.querySelector("#vs-mic-audio-player");

    updateMicStatusPrompt();

    function updateTimer() {
      const elapsed = Math.floor((Date.now() - recordStartTime) / 1000);
      const m = String(Math.floor(elapsed / 60)).padStart(2, "0");
      const s = String(elapsed % 60).padStart(2, "0");
      timerEl.textContent = `${m}:${s}`;
    }

    startRecBtn.addEventListener("click", async () => {
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        recordedChunks = [];
        mediaRecorder = new MediaRecorder(mediaStream);

        mediaRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) recordedChunks.push(e.data);
        };

        mediaRecorder.onstart = () => {
          recordStartTime = Date.now();
          recordTimerInterval = setInterval(updateTimer, 500);
          startRecBtn.classList.add("hidden");
          stopRecBtn.classList.remove("hidden");
          soundwaveEl.classList.remove("hidden");
          pulseRingEl.classList.remove("hidden");
          micAudioPlayer.classList.add("hidden");
          const curLang = getSelectedSpeechLang();
          const obj = SPEECH_LANGUAGES.find((l) => l.code === curLang) || SPEECH_LANGUAGES[0];
          micStatusEl.textContent = `Listening... ${obj.prompt}`;
        };

        mediaRecorder.onstop = async () => {
          clearInterval(recordTimerInterval);
          soundwaveEl.classList.add("hidden");
          pulseRingEl.classList.add("hidden");
          stopRecBtn.classList.add("hidden");
          startRecBtn.classList.remove("hidden");
          startRecBtn.innerHTML = `<span class="material-symbols-outlined text-[18px]">replay</span> Record Again`;

          const mime = mediaRecorder.mimeType || "audio/webm";
          const blob = new Blob(recordedChunks, { type: mime });
          currentAudioMimeType = mime;
          
          const reader = new FileReader();
          reader.onloadend = () => {
            if (reader.result && typeof reader.result === "string") {
              currentAudioBase64 = reader.result.split(",")[1] || null;
            }
          };
          reader.readAsDataURL(blob);

          micAudioPlayer.src = URL.createObjectURL(blob);
          micAudioPlayer.classList.remove("hidden");
          micStatusEl.textContent = "Recording complete. Transcribing & translating to English...";

          await executeAudioTranscription(blob, "live-recording.webm");
        };

        mediaRecorder.start(250);
      } catch (err) {
        micStatusEl.textContent = "Could not access microphone: " + err.message;
        UI.showToast("Microphone access denied", "error");
      }
    });

    stopRecBtn.addEventListener("click", () => {
      if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
      }
      if (mediaStream) {
        mediaStream.getTracks().forEach((t) => t.stop());
      }
    });

    // File Upload Handling
    const dropzone = overlay.querySelector("#vs-dropzone");
    const fileInput = overlay.querySelector("#vs-file-input");
    const fileInfo = overlay.querySelector("#vs-file-info");
    const fileNameEl = overlay.querySelector("#vs-file-name");
    const fileSizeEl = overlay.querySelector("#vs-file-size");
    const uploadAudioPlayer = overlay.querySelector("#vs-upload-audio-player");
    const transcribeUploadBtn = overlay.querySelector("#vs-transcribe-upload-btn");

    dropzone.addEventListener("click", () => fileInput.click());
    dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("border-primary", "bg-primary-container/10"); });
    dropzone.addEventListener("dragleave", () => { dropzone.classList.remove("border-primary", "bg-primary-container/10"); });
    dropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzone.classList.remove("border-primary", "bg-primary-container/10");
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleSelectedFile(e.dataTransfer.files[0]);
      }
    });
    fileInput.addEventListener("change", (e) => {
      if (e.target.files && e.target.files.length > 0) {
        handleSelectedFile(e.target.files[0]);
      }
    });

    function handleSelectedFile(file) {
      selectedFile = file;
      fileNameEl.textContent = file.name;
      fileSizeEl.textContent = `${(file.size / 1024).toFixed(1)} KB`;
      fileInfo.classList.remove("hidden");
      currentAudioMimeType = file.type || "audio/webm";
      
      const reader = new FileReader();
      reader.onloadend = () => {
        if (reader.result && typeof reader.result === "string") {
          currentAudioBase64 = reader.result.split(",")[1] || null;
        }
      };
      reader.readAsDataURL(file);

      uploadAudioPlayer.src = URL.createObjectURL(file);
      transcribeUploadBtn.disabled = false;
    }

    transcribeUploadBtn.addEventListener("click", async () => {
      if (!selectedFile) return;
      await executeAudioTranscription(selectedFile, selectedFile.name);
    });

    // Curated Audio Examples Handling
    const sampleItems = overlay.querySelectorAll(".sample-item");
    const SAMPLE_TEXT_FALLBACKS = {
      preeclampsia: "नमस्ते दीदी, मुझे बहुत तेज सिरदर्द हो रहा है और आँखों से धुंधला दिख रहा है। मेरा नाम सुनीता शर्मा है, उम्र 28 वर्ष। ब्लड प्रेशर चेक किया तो 155/100 आया। पैरों में भी बहुत सूजन है।",
      routine_anc: "दीदी सब ठीक है। मेरा नाम अनिता देवी है, उम्र 24 साल, 6 महीना (24 हफ्ते) चल रहा है। बीपी 110/70 है, वजन 58 किलो। खून की गोली (IFA) रोज खा रही हूँ।",
      pnc_sepsis: "दीदी, डिलीवरी के 5 दिन बाद तेज बुखार 102 डिग्री हो गया है और बदबूदार खून आ रहा है। नाम पूजा कुमारी, उम्र 22 साल। बहुत कमजोरी लग रही है।",
      newborn_danger: "दीदी बच्चा दूध नहीं पी रहा है, साँस बहुत तेज चल रही है (68 प्रति मिनट), और शरीर पीला पड़ गया है। बच्चे का नाम राहुल, उम्र 4 दिन।",
      child_diarrhea: "राहुल, 8 महीने, 3 दिन से दस्त और पानी की कमी।",
    };

    sampleItems.forEach((item) => {
      item.addEventListener("click", async () => {
        sampleItems.forEach((s) => s.classList.remove("border-primary", "bg-primary-container/20", "ring-2", "ring-primary"));
        item.classList.add("border-primary", "bg-primary-container/20", "ring-2", "ring-primary");
        const activeSampleKey = item.getAttribute("data-sample");
        const fallbackText = SAMPLE_TEXT_FALLBACKS[activeSampleKey] || "";
        
        UI.showLoading("Loading clinical audio sample & translating...");
        try {
          let res = null;
          try {
            const examples = await API.audioExamples();
            const target = examples.find((e) => e.key === activeSampleKey || e.id === activeSampleKey);
            if (target && target.audio_base64) {
              currentAudioBase64 = target.audio_base64;
              currentAudioMimeType = "audio/wav";
              const byteCharacters = atob(target.audio_base64);
              const byteNumbers = new Array(byteCharacters.length);
              for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
              const byteArray = new Uint8Array(byteNumbers);
              const blob = new Blob([byteArray], { type: "audio/wav" });
              const lang = getSelectedSpeechLang();
              res = await API.transcribeAudio(blob, { language: lang, diarize: true });
            }
          } catch (_) {}

          if (!res || !res.transcript) {
            const trans = await API.translate(fallbackText);
            res = {
              transcript: fallbackText,
              translation: trans,
              backend: "curated_audio_sample",
            };
          }
          UI.hideLoading();
          displayTranscriptResult(res.transcript, res.backend || "sample_bank", res.translation);
          UI.showToast("Audio sample loaded! Click 'Autofill Health Form' to populate.", "success");
        } catch (err) {
          UI.hideLoading();
          UI.showToast("Sample error: " + err.message, "error");
        }
      });
    });

    // Paste Text / Subtitles Input Handling
    const pasteInput = overlay.querySelector("#vs-paste-input");
    const textExtractBtn = overlay.querySelector("#vs-text-extract-btn") || overlay.querySelector("#vs-paste-transcribe-btn");
    const textInstantAutofillBtn = overlay.querySelector("#vs-text-instant-autofill-btn");

    if (textExtractBtn) {
      textExtractBtn.addEventListener("click", async () => {
        const txt = (pasteInput.value || "").trim();
        if (!txt) {
          UI.showToast("Please enter transcript text", "error");
          return;
        }
        UI.showLoading("Processing transcript & translating to English...");
        try {
          const trans = await API.translate(txt);
          UI.hideLoading();
          displayTranscriptResult(txt, "manual_script", trans);
        } catch (err) {
          UI.hideLoading();
          displayTranscriptResult(txt, "manual_script");
        }
      });
    }

    if (textInstantAutofillBtn) {
      textInstantAutofillBtn.addEventListener("click", async () => {
        const txt = (pasteInput.value || "").trim();
        if (!txt) {
          UI.showToast("Please enter transcript text", "error");
          return;
        }
        cleanup();
        UI.showLoading("Translating to English & extracting clinical fields...");
        try {
          const meta = typeof getMetadata === "function" ? getMetadata() : {};
          const res = await API.processText(txt, meta.visit_type || "auto");
          res.transcript = txt;
          UI.hideLoading();
          onResult(res);
        } catch (err) {
          UI.hideLoading();
          UI.showToast("Extraction error: " + err.message, "error");
        }
      });
    }

    // Execute Audio-to-Transcript API Call
    let currentEnglish = "";

    async function executeAudioTranscription(fileBlob, filename) {
      const speechLang = getSelectedSpeechLang();
      const langObj = SPEECH_LANGUAGES.find((l) => l.code === speechLang) || SPEECH_LANGUAGES[0];
      UI.showLoading(`Transcribing speech (${langObj.name}) & transmitting to English...`);
      try {
        const res = await API.transcribeAudio(fileBlob, { language: speechLang, diarize: true });
        UI.hideLoading();
        displayTranscriptResult(res.transcript || "", res.backend || "speech_engine", res.translation);
      } catch (err) {
        UI.hideLoading();
        UI.showToast("Transcription error: " + err.message, "error");
      }
    }

    const workspace = overlay.querySelector("#vs-transcript-workspace");
    const editor = overlay.querySelector("#vs-transcript-editor");
    const bubblesEl = overlay.querySelector("#vs-dialogue-bubbles");
    const toggleViewBtn = overlay.querySelector("#vs-toggle-view-btn");
    const backendBadge = overlay.querySelector("#vs-backend-badge");
    const copyBtn = overlay.querySelector("#vs-copy-btn");
    const translateBtn = overlay.querySelector("#vs-translate-btn");
    const translateLangSelect = overlay.querySelector("#vs-translate-target-lang");
    const autofillBtn = overlay.querySelector("#vs-autofill-btn");
    const translationBox = overlay.querySelector("#vs-translation-box");
    const translationTitle = overlay.querySelector("#vs-translation-title");
    const translationText = overlay.querySelector("#vs-translation-text");
    const copyTranslationBtn = overlay.querySelector("#vs-copy-translation-btn");

    let isRawView = false;

    function renderBubbles(transcript) {
      if (!bubblesEl) return;
      const lines = transcript.split(/\n+/).filter(l => l.trim());
      if (lines.length === 0) {
        bubblesEl.innerHTML = `<p class="text-on-surface-variant italic">No transcript recorded yet.</p>`;
        return;
      }

      bubblesEl.innerHTML = lines.map(line => {
        const isAsha = /^(?:ASHA|Worker|Doctor|Nurse):/i.test(line);
        const isPatient = /^(?:Patient|Mother|Beneficiary|Relative):/i.test(line);
        const cleanContent = line.replace(/^(?:ASHA|Worker|Doctor|Nurse|Patient|Mother|Beneficiary|Relative|Speaker\s*\d+):\s*/i, "").trim();
        
        if (isAsha) {
          return `
            <div class="flex flex-col items-start gap-1">
              <span class="text-[10px] font-extrabold uppercase text-secondary bg-emerald-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                <span class="material-symbols-outlined text-xs">health_and_safety</span> ASHA (Worker)
              </span>
              <div class="bg-emerald-50 text-emerald-950 p-2.5 rounded-2xl rounded-tl-sm border border-emerald-200 max-w-[90%] shadow-xs">
                ${cleanContent || line}
              </div>
            </div>`;
        } else if (isPatient) {
          return `
            <div class="flex flex-col items-end gap-1 ml-auto">
              <span class="text-[10px] font-extrabold uppercase text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                <span class="material-symbols-outlined text-xs">person</span> Patient / Mother
              </span>
              <div class="bg-blue-50 text-blue-950 p-2.5 rounded-2xl rounded-tr-sm border border-blue-200 max-w-[90%] shadow-xs text-right">
                ${cleanContent || line}
              </div>
            </div>`;
        } else {
          return `
            <div class="p-2 bg-surface-container-lowest rounded-xl border border-outline/50 text-on-surface">
              ${line}
            </div>`;
        }
      }).join("");
    }

    if (toggleViewBtn) {
      toggleViewBtn.addEventListener("click", () => {
        isRawView = !isRawView;
        if (isRawView) {
          bubblesEl.classList.add("hidden");
          editor.classList.remove("hidden");
          toggleViewBtn.textContent = "💬 Dialogue View";
        } else {
          editor.classList.add("hidden");
          bubblesEl.classList.remove("hidden");
          toggleViewBtn.textContent = "📝 Raw Text";
          renderBubbles(editor.value);
        }
      });
    }

    function displayTranscriptResult(transcript, backend, translation) {
      const refinedOrig = refineClinicalText(transcript);
      currentTranscript = refinedOrig;
      editor.value = refinedOrig;
      renderBubbles(refinedOrig);
      backendBadge.textContent = `✨ ${backend.replace(/_/g, " ").toUpperCase()}`;
      
      let english = translation && translation.english ? translation.english : "";
      english = refineClinicalText(english);
      currentEnglish = english;
      if (english && english.trim() !== refinedOrig.trim()) {
        translationText.textContent = english;
        if (translationTitle) translationTitle.textContent = "English Translation (Gemma)";
        translationBox.classList.remove("hidden");
      } else {
        translationBox.classList.add("hidden");
      }

      workspace.classList.remove("hidden");
      workspace.scrollIntoView({ behavior: "smooth" });
    }

    copyBtn.addEventListener("click", () => {
      const txt = editor.value || currentTranscript;
      navigator.clipboard.writeText(txt).then(() => {
        UI.showToast("Transcript copied to clipboard!", "success");
      });
    });

    if (copyTranslationBtn) {
      copyTranslationBtn.addEventListener("click", () => {
        const txt = translationText ? translationText.textContent : "";
        if (txt) {
          navigator.clipboard.writeText(txt).then(() => {
            UI.showToast("Translation copied to clipboard!", "success");
          });
        }
      });
    }

    translateBtn.addEventListener("click", async () => {
      const txt = (editor.value || currentTranscript).trim();
      if (!txt) return;
      const targetLang = translateLangSelect ? translateLangSelect.value : "en";
      const targetLabel = translateLangSelect && translateLangSelect.options[translateLangSelect.selectedIndex] ? translateLangSelect.options[translateLangSelect.selectedIndex].text : targetLang.toUpperCase();
      
      UI.showLoading(`Translating to ${targetLabel}...`);
      try {
        const res = await API.translate(txt, targetLang, "auto");
        UI.hideLoading();
        const translatedResult = res.translated_text || res.english || "";
        if (targetLang === "en") {
          currentEnglish = refineClinicalText(translatedResult);
        }
        if (translationTitle) {
          translationTitle.textContent = `${targetLabel} Translation (Gemma)`;
        }
        translationText.textContent = translatedResult || "No translation returned.";
        translationBox.classList.remove("hidden");
        UI.showToast(`Translated to ${targetLabel} successfully!`, "success");
      } catch (err) {
        UI.hideLoading();
        UI.showToast("Translation error: " + err.message, "error");
      }
    });

    autofillBtn.addEventListener("click", async () => {
      const txt = (editor.value || currentTranscript).trim();
      const englishTxt = (currentEnglish || txt).trim();
      if (!txt && !englishTxt) {
        UI.showToast("No transcript to extract", "error");
        return;
      }
      cleanup();
      UI.showLoading("Transmitting in English & autofilling clinical fields...");
      try {
        const meta = typeof getMetadata === "function" ? getMetadata() : {};
        const res = await API.processText(englishTxt, meta.visit_type || "auto");
        res.transcript = txt;
        res.translation = { english: englishTxt };
        res.audio_base64 = currentAudioBase64;
        res.audio_mime_type = currentAudioMimeType || "audio/webm";
        try {
          if (currentAudioBase64) {
            sessionStorage.setItem("sukanya_last_audio_base64", currentAudioBase64);
            sessionStorage.setItem("sukanya_last_audio_mime", currentAudioMimeType || "audio/webm");
          }
        } catch (_) {}
        UI.hideLoading();
        onResult(res);
      } catch (err) {
        UI.hideLoading();
        UI.showToast("Extraction error: " + err.message, "error");
      }
    });
  }

  /**
   * Inline field-level dictation helper.
   * Records short speech in selected language, translates to English, and populates input.
   * Accurately converts Marathi/Hindi/Tamil/Bengali numbers (words or digits) to standard English numbers.
   */
  async function startFieldDictation(inputEl) {
    const UI = window.SukanyaUI || window.SakhiUI;
    const API = window.SukanyaAPI || window.SakhiAPI;

    let stream = null;
    let rec = null;
    const chunks = [];
    const speechLang = getSelectedSpeechLang();
    const langObj = SPEECH_LANGUAGES.find((l) => l.code === speechLang) || SPEECH_LANGUAGES[0];

    const toastPill = UI.el(
      "div",
      "fixed bottom-20 left-1/2 -translate-x-1/2 z-[130] bg-primary text-on-primary px-4 py-3 rounded-2xl shadow-xl flex items-center gap-3 border border-outline animate-bounce"
    );
    toastPill.innerHTML = `
      <span class="w-3 h-3 rounded-full bg-error animate-ping"></span>
      <span class="text-xs font-semibold">Listening (${langObj.name})... transmits in English</span>
      <button type="button" class="bg-surface-container-lowest text-primary text-xs font-bold px-2.5 py-1 rounded-lg hover:bg-surface-container">Done</button>
    `;
    document.body.appendChild(toastPill);

    const doneBtn = toastPill.querySelector("button");

    const cleanup = () => {
      if (rec && rec.state !== "inactive") {
        try { rec.stop(); } catch (_) {}
      }
      if (stream) stream.getTracks().forEach((t) => t.stop());
      toastPill.remove();
    };

    doneBtn.addEventListener("click", cleanup);

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
      rec.onstop = async () => {
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        UI.showLoading(`Transcribing (${langObj.name}) & transmitting to English...`);
        try {
          const res = await API.transcribeAudio(blob, { language: speechLang, diarize: false });
          UI.hideLoading();
          
          const rawTranscript = res.transcript || "";
          let cleanText = (res.translation && res.translation.english) ? res.translation.english : rawTranscript;
          cleanText = cleanText.replace(/^ASHA:\s*/i, "").replace(/^Patient:\s*/i, "").trim();

          if (cleanText || rawTranscript) {
            const fieldHint = [
              inputEl.name,
              inputEl.id,
              inputEl.placeholder,
              inputEl.getAttribute("aria-label"),
              inputEl.closest("label") ? inputEl.closest("label").textContent : ""
            ].filter(Boolean).join(" ").toLowerCase();

            const isAge = fieldHint.includes("age") || fieldHint.includes("वय") || fieldHint.includes("उम्र");
            const isBp = fieldHint.includes("bp") || fieldHint.includes("pressure") || fieldHint.includes("रक्तदाब");
            const isNumeric = inputEl.type === "number" || isAge;

            let finalVal = cleanText;

            if (isAge || isNumeric) {
              // Parse Marathi / Hindi / English spoken number words & digits into English numbers
              const parsedNum = parseIndicSpokenNumber(rawTranscript) ?? parseIndicSpokenNumber(cleanText);
              if (parsedNum !== null) {
                finalVal = String(parsedNum);
                UI.showToast(`Number noted: ${finalVal}`, "success");
              } else {
                const numMatch = cleanText.match(/\d+(?:\.\d+)?/);
                if (numMatch) finalVal = numMatch[0];
              }
            } else if (isBp) {
              const refined = refineClinicalText(rawTranscript + " " + cleanText);
              const bpMatch = refined.match(/\b\d{2,3}\s*\/\s*\d{2,3}\b/);
              if (bpMatch) {
                finalVal = bpMatch[0];
                UI.showToast(`Blood pressure recorded: ${finalVal} mmHg`, "success");
              }
            } else {
              finalVal = refineClinicalText(cleanText);
            }

            inputEl.value = inputEl.value && !isNumeric ? `${inputEl.value} ${finalVal}` : finalVal;
            inputEl.classList.add("ring-2", "ring-secondary");
            inputEl.dispatchEvent(new Event("input", { bubbles: true }));
            inputEl.dispatchEvent(new Event("change", { bubbles: true }));
            ensureSectionExpanded(inputEl);
            if (!isAge && !isBp) {
              UI.showToast("Voice recorded in English!", "success");
            }
          }
        } catch (err) {
          UI.hideLoading();
          UI.showToast("Voice transcription error: " + err.message, "error");
        }
      };
      rec.start(250);
    } catch (err) {
      toastPill.remove();
      UI.showToast("Microphone access unavailable: " + err.message, "error");
    }
  }

  function handleExtractionResult(mainEl, root, result) {
    const UI = window.SukanyaUI || window.SakhiUI;
    const API = window.SukanyaAPI || window.SakhiAPI;
    window.__sakhiLastResult = result;
    if (result.transcript) {
      showTranscriptPanel(mainEl, result.transcript, null, result.translation);
    }
    const count = autofill(root, result.form, result.visit_type);
    
    // If backend returned health_assessment directly, render it immediately
    if (result.health_assessment) {
      renderAssessmentPanel(mainEl, result.health_assessment);
    } else if (result.form && API && API.assessPatient) {
      API.assessPatient(result.form)
        .then((ass) => {
          if (ass && ass.status === "success") {
            renderAssessmentPanel(mainEl, ass);
          }
        })
        .catch(() => {});
    }

    UI.showToast(
      `Extracted ${count} field${count === 1 ? "" : "s"} (${(result.visit_type || "visit").replace("_", " ")})`,
      "success"
    );
  }

  /** Rebuilds the form object from DOM */
  function collectFormFromDOM(root, baseForm) {
    const out = baseForm ? JSON.parse(JSON.stringify(baseForm)) : {};
    root.querySelectorAll("[data-sukanya-field], [data-sakhi-field]").forEach((input) => {
      const spec = input.getAttribute("data-sukanya-field") || input.getAttribute("data-sakhi-field");
      if (spec === "_pregnant") return;
      const primaryPath = spec.split(",")[0].trim();
      let value = input.type === "checkbox" ? input.checked : input.value;
      if (typeof value === "string") value = value.trim();
      if (value === "" || value == null) return;
      const format = input.getAttribute("data-sukanya-format") || input.getAttribute("data-sakhi-format");
      if (format === "weeks" || format === "months") {
        const m = /^(\d+)/.exec(value);
        value = m ? parseInt(m[1], 10) : value;
      } else if (format === "list") {
        value = value.split(",").map((s) => s.trim()).filter(Boolean);
      }
      setPath(out, primaryPath, value);
    });
    return out;
  }

  /**
   * Renders the backend's automated risk assessment (triage rules + XGBoost Condition
   * + SVM Maternal Risk models — see backend/patient_risk_engine.py).
   */
  function renderAssessmentPanel(container, assessment, alertId) {
    const prior = document.getElementById("sukanya-assessment-panel");
    if (prior) prior.remove();
    if (!assessment) return;

    const UI = window.SukanyaUI || window.SakhiUI;
    const triage = assessment.triage;
    const maternal = assessment.maternal_risk;
    const condition = assessment.condition;

    const bandTone = {
      "URGENT - clinician review": { bg: "bg-red-500/10", text: "text-red-700", border: "border-red-500/30", badge: "bg-red-600 text-white" },
      "PRIORITY - same-day review": { bg: "bg-amber-500/10", text: "text-amber-800", border: "border-amber-500/30", badge: "bg-amber-600 text-white" },
      "ROUTINE - monitor": { bg: "bg-emerald-500/10", text: "text-emerald-800", border: "border-emerald-500/30", badge: "bg-emerald-600 text-white" },
      "STABLE - no flags": { bg: "bg-emerald-500/10", text: "text-emerald-800", border: "border-emerald-500/30", badge: "bg-emerald-600 text-white" },
    };

    let html = `
      <div class="flex items-center justify-between gap-2 mb-3">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <span class="material-symbols-outlined text-[20px]">vital_signs</span>
          </div>
          <div>
            <h4 class="font-headline-sm text-sm font-bold text-primary">Live Patient Health &amp; Risk Assessment</h4>
            <p class="text-[11px] text-on-surface-variant">Real-time XGBoost &amp; SVM Triage Engine</p>
          </div>
        </div>
        ${assessment.priority_label ? `<span class="px-2.5 py-1 rounded-full text-xs font-extrabold ${assessment.priority_label === 'HIGH RISK' ? 'bg-red-100 text-red-700 border border-red-300' : (assessment.priority_label === 'MODERATE RISK' ? 'bg-amber-100 text-amber-800 border border-amber-300' : 'bg-emerald-100 text-emerald-800 border border-emerald-300')}">${assessment.priority_label}</span>` : ''}
      </div>
    `;

    // Clinical Triage Rules Banner
    if (triage && !triage.error) {
      const tone = bandTone[triage.triage_band] || bandTone["ROUTINE - monitor"];
      const issuesList = triage.issues || [];
      html += `
        <div class="mb-3 p-3.5 rounded-xl border ${tone.border} ${tone.bg}">
          <div class="flex items-center justify-between mb-1.5">
            <span class="font-extrabold text-xs tracking-wide uppercase ${tone.text} flex items-center gap-1.5">
              <span class="material-symbols-outlined text-[18px]">warning</span>
              ${triage.triage_band}
            </span>
            ${triage.severity_score != null ? `<span class="text-[10px] px-2 py-0.5 rounded-full ${tone.badge} font-bold">Severity Score: ${triage.severity_score}</span>` : ''}
          </div>
          ${issuesList.length ? `
            <ul class="mt-2 list-disc list-inside text-xs ${tone.text} space-y-1">
              ${issuesList.map((i) => `<li>${typeof i === 'string' ? i : (i.finding || i.issue || JSON.stringify(i))}</li>`).join("")}
            </ul>
          ` : `
            <p class="text-xs ${tone.text} mt-1">No critical physiological flags from recorded vitals.</p>
          `}
        </div>
      `;
    } else if (triage && triage.error === "no_vitals_provided") {
      html += `<p class="text-xs text-on-surface-variant mb-3">No vitals were recorded for this visit, so the rule-based triage check has nothing to assess.</p>`;
    }

    // Recommended Clinical Action
    if (assessment.recommended_action) {
      html += `
        <div class="mb-3 p-3 rounded-xl bg-surface-container-low border border-primary/20">
          <p class="text-xs font-bold text-primary flex items-center gap-1.5">
            <span class="material-symbols-outlined text-[16px]">health_and_safety</span>
            Recommended Clinical Action
          </p>
          <p class="text-xs text-on-surface mt-1 font-medium">${assessment.recommended_action}</p>
        </div>
      `;
    }

    // Machine Learning Prediction Models (Condition + Maternal Risk)
    const renderModelResult = (label, res, fallbackKey) => {
      if (!res) return "";
      if (res.error === "insufficient_vitals") {
        return `<p class="text-xs text-on-surface-variant mb-2"><b>${label}:</b> not available — missing ${res.missing.join(", ")}.</p>`;
      }
      if (res.error === "model_not_loaded") {
        return `<p class="text-xs text-on-surface-variant mb-2"><b>${label}:</b> model not loaded on this server.</p>`;
      }
      if (res.error) return "";
      const value = res.prediction || res[fallbackKey];
      if (!value) return "";
      const prob = res.confidence != null ? res.confidence : (res.probabilities ? res.probabilities[value] : null);
      const isConcern = value && value !== "Healthy" && value !== "low risk";
      const modelUsed = res.model_used ? `<span class="text-[10px] text-on-surface-variant/70 ml-1">(${res.model_used})</span>` : "";
      return `
        <div class="p-2.5 rounded-xl bg-surface-container-lowest border border-outline-variant flex items-center justify-between">
          <div>
            <span class="text-xs font-semibold text-primary">${label}:</span>
            <span class="text-xs ${isConcern ? "text-red-600 font-extrabold" : "text-emerald-700 font-bold"} ml-1">${value}</span>
            ${modelUsed}
          </div>
          ${prob != null ? `<span class="text-[11px] px-2.5 py-0.5 rounded-full ${isConcern ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-800'} font-extrabold">${Math.round(prob * 100)}% conf</span>` : ""}
        </div>
      `;
    };

    const modelHtml = renderModelResult("Condition Model", condition, "condition") + renderModelResult("Maternal Risk Model", maternal, "risk_level");
    if (modelHtml) {
      html += `<div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">${modelHtml}</div>`;
    }

    if (alertId) {
      html += `<div class="flex items-center gap-2 text-xs text-red-600 font-bold mt-2">
        <span class="material-symbols-outlined text-[16px]">notifications_active</span>
        An automated priority alert has been synced to the ASHA Command Center.
      </div>`;
    }

    // AI Next Scheduled Meet Section (Gemma 4 12B / NHM Rules)
    html += `<div id="ai-next-visit-container" class="mt-4 pt-3 border-t border-outline-variant">
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-1.5 text-xs font-bold text-primary">
          <span class="material-symbols-outlined text-sm">event_upcoming</span>
          <span>AI Next Scheduled Meet Recommendation</span>
        </div>
        <span class="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-bold">Gemma 4 12B</span>
      </div>
      <div id="ai-next-visit-card" class="p-3 bg-surface-container-low rounded-lg border border-outline text-xs text-on-surface-variant flex flex-col gap-2">
        <p class="animate-pulse flex items-center gap-1 text-primary"><span class="material-symbols-outlined text-sm">hourglass_top</span> Analyzing clinical findings for next meet...</p>
      </div>
    </div>`;

    const panel = UI.el("div", "mb-6 border border-primary/20 rounded-2xl p-4 bg-surface-container-lowest shadow-sm");
    panel.id = "sukanya-assessment-panel";
    panel.innerHTML = html;

    const slot = document.getElementById("sukanya-assessment-slot");
    if (slot) {
      slot.innerHTML = "";
      slot.appendChild(panel);
    } else {
      const voiceBanner = container.querySelector(".bg-gradient-to-r") || document.querySelector(".bg-gradient-to-r");
      if (voiceBanner && voiceBanner.parentNode) {
        voiceBanner.parentNode.insertBefore(panel, voiceBanner.nextSibling);
      } else {
        container.insertBefore(panel, container.firstChild);
      }
    }

    // Fetch AI Next Visit Recommendation asynchronously
    const lastRes = window.__sakhiLastResult || {};
    const patientName = ((lastRes.form && lastRes.form.patient && lastRes.form.patient.name) || "Patient").trim();
    const visitType = lastRes.visit_type || "anc_visit";
    
    const API = window.SukanyaAPI || window.SakhiAPI;
    if (API && API.suggestNextVisit) {
      API.suggestNextVisit({
        patient_name: patientName,
        visit_type: visitType,
        form: lastRes.form || null,
        danger: lastRes.danger || null,
        assessment: assessment || null,
        transcript: lastRes.transcript || null,
      }).then((sugg) => {
        const cardEl = document.getElementById("ai-next-visit-card");
        if (!cardEl || !sugg) return;
        const isPriority = sugg.priority === "priority";
        const priorityBadge = isPriority
          ? `<span class="bg-accent-saffron text-tertiary-container px-2 py-0.5 rounded font-bold uppercase text-[10px]">🚨 High Priority</span>`
          : `<span class="bg-accent-green text-on-secondary-container px-2 py-0.5 rounded font-bold uppercase text-[10px]">Routine</span>`;

        cardEl.innerHTML = `
          <div class="flex justify-between items-start">
            <div>
              <p class="font-bold text-sm text-primary">📅 ${sugg.recommended_date} at ${sugg.recommended_time}</p>
              <p class="text-xs text-on-surface mt-1">${sugg.reason}</p>
            </div>
            ${priorityBadge}
          </div>
          ${sugg.suggested_actions && sugg.suggested_actions.length ? `
            <div class="mt-1">
              <span class="font-bold text-[11px] text-primary">Preparation Checklist:</span>
              <ul class="list-disc list-inside text-[11px] text-on-surface-variant mt-0.5">
                ${sugg.suggested_actions.map((a) => `<li>${a}</li>`).join("")}
              </ul>
            </div>
          ` : ""}
          <div class="flex items-center justify-between pt-2 mt-1 border-t border-outline-variant">
            <span class="text-[10px] text-on-surface-variant font-medium">Model: ${sugg.model || "gemma-4-12b"}</span>
            <button type="button" id="btn-confirm-next-visit" class="px-3 py-1.5 bg-primary text-on-primary rounded-lg font-bold text-xs hover:bg-primary-container flex items-center gap-1">
              <span class="material-symbols-outlined text-sm">calendar_add_on</span> Add to Calendar
            </button>
          </div>
        `;

        const btnAdd = document.getElementById("btn-confirm-next-visit");
        if (btnAdd) {
          btnAdd.addEventListener("click", async () => {
            try {
              btnAdd.disabled = true;
              btnAdd.innerHTML = `<span class="material-symbols-outlined text-sm animate-spin">refresh</span> Adding...`;
              await API.createVisit({
                patient_name: patientName,
                visit_type: visitType,
                priority: sugg.priority,
                scheduled_date: sugg.recommended_date,
                time_slot: sugg.recommended_time,
                notes: sugg.reason + " Actions: " + (sugg.suggested_actions || []).join(", "),
                source: "ai_followup",
              });
              UI.showToast(`Follow-up scheduled for ${sugg.recommended_date}!`, "success");
              btnAdd.className = "px-3 py-1.5 bg-accent-green text-on-secondary-container rounded-lg font-bold text-xs flex items-center gap-1 cursor-default";
              btnAdd.innerHTML = `<span class="material-symbols-outlined text-sm">check_circle</span> Added to Schedule`;
            } catch (err) {
              UI.showToast(err.message || "Could not add to calendar", "error");
              btnAdd.disabled = false;
              btnAdd.textContent = "Add to Calendar";
            }
          });
        }
      }).catch((err) => {
        const cardEl = document.getElementById("ai-next-visit-card");
        if (cardEl) cardEl.innerHTML = `<p class="text-xs text-error">Could not load AI suggestion: ${err.message}</p>`;
      });
    }
  }

  async function saveRecordAndGo(nextUrl) {
    const API = window.SukanyaAPI || window.SakhiAPI;
    const UI = window.SukanyaUI || window.SakhiUI;
    const params = new URLSearchParams(window.location.search);
    const visitId = params.get("visit_id");
    const result = window.__sakhiLastResult;
    const form = collectFormFromDOM(document, result ? result.form : null);

    const audioBase64 = (result && result.audio_base64) || sessionStorage.getItem("sukanya_last_audio_base64") || null;
    const audioMimeType = (result && result.audio_mime_type) || sessionStorage.getItem("sukanya_last_audio_mime") || "audio/webm";

    try {
      if (API.isLoggedIn()) {
        const saved = await API.createRecord({
          visit_id: visitId ? Number(visitId) : null,
          visit_type: (result && result.visit_type) || "anc_visit",
          form,
          danger: result ? result.danger : null,
          transcript: result ? result.transcript : null,
          audio_base64: audioBase64,
          audio_mime_type: audioMimeType,
        });
        if (saved && saved.next_visit_recommendation && saved.next_visit_recommendation.recommended_date) {
          const rec = saved.next_visit_recommendation;
          UI.showToast(`Record & Audio saved! Next follow-up auto-scheduled for ${rec.recommended_date}!`, "success");
        } else {
          UI.showToast("Health record & Voice Audio saved successfully!", "success");
        }
        const mainEl = document.querySelector("main") || document.body;
        renderAssessmentPanel(mainEl, saved.assessment, saved.alert_id);
        renderStoredRecords();
        if (nextUrl) {
          try {
            const targetUrl = new URL(nextUrl, window.location.href);
            if (saved && saved.id) targetUrl.searchParams.set("record_id", String(saved.id));
            if (visitId || (saved && saved.visit_id)) targetUrl.searchParams.set("visit_id", String(visitId || saved.visit_id));
            setTimeout(() => (window.location.href = targetUrl.toString()), 800);
          } catch (_) {
            setTimeout(() => (window.location.href = nextUrl), 800);
          }
        }
        return saved;
      } else {
        UI.showToast("Please log in first to save records", "error");
      }
    } catch (err) {
      UI.showToast(err.message || "Could not save record", "error");
    }
  }

  /** Render all stored records into the UI */
  async function renderStoredRecords() {
    const container = document.getElementById("stored-records-list");
    const countBadge = document.getElementById("stored-count");
    if (!container) return;

    const API = window.SukanyaAPI || window.SakhiAPI;
    const UI = window.SukanyaUI || window.SakhiUI;

    try {
      const records = (await API.listRecords()) || [];
      if (countBadge) countBadge.textContent = records.length;

      if (!records || records.length === 0) {
        container.innerHTML = `
          <div class="text-center py-12 bg-surface-container-lowest rounded-2xl border border-outline/50 p-6 shadow-sm">
            <span class="material-symbols-outlined text-4xl text-on-surface-variant/40 mb-2">folder_off</span>
            <p class="font-headline-sm text-primary font-bold text-base">No Stored Records Yet</p>
            <p class="font-body-sm text-on-surface-variant mt-1 text-xs">Fill the form or record an audio consultation to save records here.</p>
          </div>
        `;
        return;
      }

      container.innerHTML = records.map((r) => {
        let form = r.form;
        if (typeof form === "string") {
          try { form = JSON.parse(form); } catch(_) { form = {}; }
        } else if (!form || typeof form !== "object") {
          form = {};
        }

        let danger = r.danger;
        if (typeof danger === "string") {
          try { danger = JSON.parse(danger); } catch(_) { danger = {}; }
        } else if (!danger || typeof danger !== "object") {
          danger = {};
        }

        let assessment = r.assessment;
        if (typeof assessment === "string") {
          try { assessment = JSON.parse(assessment); } catch(_) { assessment = {}; }
        } else if (!assessment || typeof assessment !== "object") {
          assessment = {};
        }
        
        let pName = "";
        if (form.patient && typeof form.patient === "object" && form.patient.name) pName = form.patient.name;
        else if (form.child && typeof form.child === "object" && form.child.name) pName = form.child.name;
        else if (typeof form.patient === "string" && form.patient) pName = form.patient;
        else if (form.patient_name) pName = form.patient_name;
        else if (form.name) pName = form.name;
        else if (r.patient_name) pName = r.patient_name;
        else pName = `Beneficiary Record #${r.id}`;

        let pAge = "";
        if (form.patient && typeof form.patient === "object" && form.patient.age) pAge = form.patient.age;
        else if (form.child && typeof form.child === "object" && form.child.age_months) pAge = `${form.child.age_months} months`;
        else if (form.age) pAge = form.age;

        let pMobile = "";
        if (form.patient && typeof form.patient === "object" && form.patient.mobile) pMobile = form.patient.mobile;
        else if (form.mobile) pMobile = form.mobile;

        const vtype = ((r.visit_type || "anc_visit") + "").replace(/_/g, " ").toUpperCase();
        const dateStr = r.created_at ? new Date(r.created_at * 1000).toLocaleString("en-GB", { hour12: false }) : "Recent";
        
        const vitals = (form.vitals && typeof form.vitals === "object") ? form.vitals : form;
        const bpSys = vitals.bp_systolic || form.bp_systolic;
        const bpDia = vitals.bp_diastolic || form.bp_diastolic;
        const bp = (bpSys && bpDia) ? `${bpSys}/${bpDia} mmHg` : null;
        const weight = vitals.weight_kg || form.weight_kg ? `${vitals.weight_kg || form.weight_kg} kg` : null;
        const temp = vitals.temperature_celsius || form.temperature_celsius ? `${vitals.temperature_celsius || form.temperature_celsius}°C` : null;
        const spo2 = vitals.spo2 || form.spo2 ? `${vitals.spo2 || form.spo2}%` : null;
        const hr = vitals.heart_rate || form.heart_rate ? `${vitals.heart_rate || form.heart_rate} bpm` : null;

        const hasDanger = (Array.isArray(danger.danger_signs) && danger.danger_signs.length > 0) || 
                          (assessment.triage && assessment.triage.severity_score && assessment.triage.severity_score >= 3);
        const triageBand = (assessment.triage && assessment.triage.triage_band) || (hasDanger ? "PRIORITY - HIGH RISK" : null);

        return `
          <div class="bg-surface-container-lowest rounded-2xl border ${hasDanger ? 'border-red-300 shadow-red-50/50' : 'border-outline'} shadow-sm p-4 hover:shadow-md transition-all flex flex-col gap-3" data-record-id="${r.id}">
            <div class="flex justify-between items-start flex-wrap gap-2">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-[11px] font-extrabold px-2.5 py-1 rounded-lg ${hasDanger ? 'bg-red-100 text-error border border-red-200' : 'bg-emerald-100 text-secondary border border-emerald-200'}">
                  ${hasDanger ? '🚨 HIGH RISK' : vtype}
                </span>
                ${triageBand ? `<span class="text-[10px] bg-surface-container-low text-primary font-bold px-2 py-0.5 rounded-md">${triageBand}</span>` : ""}
                <span class="text-xs text-on-surface-variant font-medium">${dateStr}</span>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-xs font-mono font-bold text-on-surface-variant bg-surface-container-low px-2 py-0.5 rounded">ID #${r.id}</span>
                <button type="button" class="btn-delete-record text-on-surface-variant hover:text-error text-xs p-1" data-id="${r.id}" title="Delete record">
                  <span class="material-symbols-outlined text-[18px]">delete</span>
                </button>
              </div>
            </div>

            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h4 class="font-headline-sm text-primary font-extrabold text-base">${pName}</h4>
                <p class="font-body-sm text-xs text-on-surface-variant mt-0.5">
                  ${pAge ? `Age: ${pAge} • ` : ''}${pMobile ? `📱 +91 ${pMobile}` : 'No phone listed'}
                </p>
              </div>
              <div class="flex items-center gap-2 flex-wrap text-xs font-semibold">
                ${bp ? `<span class="bg-surface-container-low px-2.5 py-1 rounded-lg text-primary">BP: <strong class="text-secondary">${bp}</strong></span>` : ''}
                ${weight ? `<span class="bg-surface-container-low px-2.5 py-1 rounded-lg text-on-surface-variant">Wt: <strong>${weight}</strong></span>` : ''}
                ${spo2 ? `<span class="bg-surface-container-low px-2.5 py-1 rounded-lg text-on-surface-variant">SpO2: <strong>${spo2}</strong></span>` : ''}
                ${temp ? `<span class="bg-surface-container-low px-2.5 py-1 rounded-lg text-on-surface-variant">Temp: <strong>${temp}</strong></span>` : ''}
                ${hr ? `<span class="bg-surface-container-low px-2.5 py-1 rounded-lg text-on-surface-variant">HR: <strong>${hr}</strong></span>` : ''}
              </div>
            </div>

            ${Array.isArray(danger.danger_signs) && danger.danger_signs.length > 0 ? `
              <div class="bg-red-50 border border-red-200 rounded-xl p-2.5 text-xs text-error">
                <span class="font-bold">⚠️ Danger Signs:</span> ${danger.danger_signs.map(s => typeof s === 'object' ? (s.sign || s.category) : s).join(", ")}
              </div>
            ` : ''}

            ${r.audio_base64 ? `
              <div class="bg-surface-container-low rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border border-outline/40 shadow-2xs">
                <div class="flex items-center gap-2.5">
                  <span class="w-8 h-8 rounded-full bg-secondary/15 text-secondary flex items-center justify-center shrink-0">
                    <span class="material-symbols-outlined text-[18px]">mic</span>
                  </span>
                  <div>
                    <p class="text-xs font-bold text-primary">Voice Checkup Audio</p>
                    <p class="text-[10px] text-on-surface-variant">Original recorded audio file</p>
                  </div>
                </div>
                <audio class="h-9 w-full sm:w-72 rounded-lg" controls src="data:${r.audio_mime_type || 'audio/webm'};base64,${r.audio_base64}"></audio>
              </div>
            ` : ''}

            ${r.transcript ? `
              <div class="bg-surface-container-low rounded-xl p-3 text-xs text-on-surface font-mono border border-outline/30 line-clamp-2" title="${r.transcript}">
                <span class="font-bold text-primary">Transcript:</span> ${r.transcript}
              </div>
            ` : ''}

            <div class="flex items-center gap-2 pt-2 border-t border-outline-variant/60">
              <button type="button" class="btn-load-record flex-1 bg-secondary hover:bg-secondary-dark text-white font-label-md text-xs py-2.5 px-3 rounded-xl transition-all flex items-center justify-center gap-1.5 font-bold shadow-sm active:scale-95" data-id="${r.id}">
                <span class="material-symbols-outlined text-[18px]">edit_document</span>
                <span>Load / Edit in Form</span>
              </button>
              <button type="button" class="btn-view-details border border-outline hover:bg-surface-container-high text-primary font-label-md text-xs py-2.5 px-4 rounded-xl transition-all flex items-center justify-center gap-1.5 font-bold" data-id="${r.id}" onclick="window.location.href='../health_record_expanded_view/code.html?visit_id=${r.visit_id || r.id}'">
                <span class="material-symbols-outlined text-[18px]">visibility</span>
                <span>Expanded View</span>
              </button>
            </div>
          </div>
        `;
      }).join("");

      // Bind Load Record buttons
      container.querySelectorAll(".btn-load-record").forEach((btn) => {
        btn.addEventListener("click", () => {
          const rawId = btn.getAttribute("data-id");
          const record = records.find((x) => String(x.id) === String(rawId));
          if (record) {
            loadRecordIntoForm(record);
          }
        });
      });

      // Bind Delete Record buttons
      container.querySelectorAll(".btn-delete-record").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const rawId = btn.getAttribute("data-id");
          if (confirm(`Delete stored health record #${rawId}?`)) {
            try {
              btn.disabled = true;
              btn.style.opacity = "0.5";
              if (API.deleteRecord) {
                await API.deleteRecord(rawId);
              }
              UI.showToast(`Record #${rawId} deleted successfully`, "info");
              await renderStoredRecords();
            } catch (err) {
              btn.disabled = false;
              btn.style.opacity = "1";
              UI.showToast(err.message || "Error deleting record", "error");
            }
          }
        });
      });

    } catch (err) {
      container.innerHTML = `<div class="p-6 bg-red-50 border border-red-200 rounded-2xl text-xs text-error font-semibold">Error loading stored records: ${err.message}</div>`;
    }
  }

  function loadRecordIntoForm(record) {
    const UI = window.SukanyaUI || window.SakhiUI;
    let form = record.form;
    if (typeof form === "string") {
      try { form = JSON.parse(form); } catch(_) { form = {}; }
    } else if (!form || typeof form !== "object") {
      form = {};
    }

    let danger = record.danger;
    if (typeof danger === "string") {
      try { danger = JSON.parse(danger); } catch(_) { danger = {}; }
    } else if (!danger || typeof danger !== "object") {
      danger = {};
    }

    window.__sakhiLastResult = {
      form: form,
      danger: danger,
      visit_type: record.visit_type,
      transcript: record.transcript,
    };

    const mainEl = document.querySelector("main") || document.body;
    if (record.transcript) {
      showTranscriptPanel(mainEl, record.transcript, record.id);
    }
    const count = autofill(document, form, record.visit_type);

    const formTabBtn = document.getElementById("tab-btn-form");
    if (formTabBtn) formTabBtn.click();

    UI.showToast(`Loaded stored record #${record.id} (${count} fields populated)`, "success");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function initFormPage(rootSelector) {
    const UI = window.SukanyaUI || window.SakhiUI;
    const API = window.SukanyaAPI || window.SakhiAPI;
    if (!UI.requireAuthOrRedirect("../secure_login_smart_layout/code.html")) return;

    syncSpeechLangDropdowns();

    const root = document.querySelector(rootSelector) || document.body;
    const mainEl = document.querySelector("main") || root;
    const recordBtn = document.getElementById("btn-record-visit");
    const saveBtn = document.getElementById("btn-save-record");
    const saveDraftBtn = document.getElementById("btn-save-draft");
    const exportCsvBtn = document.getElementById("btn-export-csv");

    const params = new URLSearchParams(window.location.search);
    const visitId = params.get("visit_id");
    let visitType = "auto";

    const getMetadata = () => ({ visit_type: visitType });

    if (visitId) {
      API.listVisits()
        .then((visits) => {
          const v = visits.find((x) => String(x.id) === String(visitId));
          if (v) {
            visitType = v.visit_type;
            const nameField = root.querySelector('[data-sukanya-field="patient.name,child.name"], [data-sakhi-field="patient.name,child.name"]');
            if (nameField && !nameField.value) nameField.value = v.patient_name;
          }
        })
        .catch(() => {});

      API.listRecords(visitId)
        .then((records) => {
          if (records && records.length > 0) {
            loadRecordIntoForm(records[0]);
          }
        })
        .catch(() => {});
    }

    const recordId = params.get("record_id");
    if (recordId) {
      API.getRecord(recordId)
        .then((rec) => {
          if (rec) loadRecordIntoForm(rec);
        })
        .catch(() => {});
    }

    // Check if coming from Home Page Voice Studio extraction
    const pendingExtract = sessionStorage.getItem("sukanya_last_extract");
    if (pendingExtract) {
      try {
        const parsed = JSON.parse(pendingExtract);
        sessionStorage.removeItem("sukanya_last_extract");
        setTimeout(() => handleExtractionResult(mainEl, root, parsed), 100);
      } catch (_) {}
    }

    const onVoiceStudioClick = () => {
      openVoiceStudioModal(getMetadata, (result) => handleExtractionResult(mainEl, root, result));
    };

    root.querySelectorAll("#btn-record-visit, .btn-record-visit, [data-voice-studio], #btn-record-float").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        onVoiceStudioClick();
      });
    });
    if (saveBtn) saveBtn.addEventListener("click", () => saveRecordAndGo(null));
    if (saveDraftBtn) saveDraftBtn.addEventListener("click", () => saveRecordAndGo(null));
    if (exportCsvBtn) {
      exportCsvBtn.addEventListener("click", () => {
        window.location.href = "/api/export-csv";
      });
    }

    // Connect all inline mic buttons to field dictation or voice studio
    root.querySelectorAll('button[aria-label*="voice" i], .mic-btn').forEach((btn) => {
      if (btn.id === "btn-record-visit") return;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const container = btn.closest(".relative") || btn.parentElement;
        const targetInput = container ? container.querySelector("input, textarea") : null;
        if (targetInput) {
          startFieldDictation(targetInput);
        } else {
          onVoiceStudioClick();
        }
      });
    });

    // Tab switching (Form Entry vs Stored Records)
    const tabBtnForm = document.getElementById("tab-btn-form");
    const tabBtnStored = document.getElementById("tab-btn-stored");
    const tabViewForm = document.getElementById("tab-view-form");
    const tabViewStored = document.getElementById("tab-view-stored");

    if (tabBtnForm && tabBtnStored && tabViewForm && tabViewStored) {
      tabBtnForm.addEventListener("click", () => {
        tabBtnForm.classList.add("bg-primary", "text-on-primary", "shadow-sm");
        tabBtnForm.classList.remove("text-on-surface-variant", "hover:bg-surface-container-high");
        tabBtnStored.classList.remove("bg-primary", "text-on-primary", "shadow-sm");
        tabBtnStored.classList.add("text-on-surface-variant", "hover:bg-surface-container-high");
        tabViewForm.classList.remove("hidden");
        tabViewForm.style.display = "flex";
        tabViewStored.classList.add("hidden");
        tabViewStored.style.display = "none";
      });

      tabBtnStored.addEventListener("click", () => {
        tabBtnStored.classList.add("bg-primary", "text-on-primary", "shadow-sm");
        tabBtnStored.classList.remove("text-on-surface-variant", "hover:bg-surface-container-high");
        tabBtnForm.classList.remove("bg-primary", "text-on-primary", "shadow-sm");
        tabBtnForm.classList.add("text-on-surface-variant", "hover:bg-surface-container-high");
        tabViewStored.classList.remove("hidden");
        tabViewStored.style.display = "flex";
        tabViewForm.classList.add("hidden");
        tabViewForm.style.display = "none";
        renderStoredRecords();
      });

      if (params.get("tab") === "stored") {
        tabBtnStored.click();
      }
    }

    // Wire Collapsible Sections & Switch Toggles (Maternal Health, Child Health, Basic Info)
    root.querySelectorAll(".form-section-toggle, [data-collapsible]").forEach((section) => {
      const header = section.querySelector(".toggle-header");
      const content = section.querySelector(".form-content");
      const switchBtn = section.querySelector('[role="switch"]');
      const thumb = switchBtn ? switchBtn.querySelector("span") : null;
      const chevron = section.querySelector(".chevron-icon, [data-icon='expand_more'], [data-icon='expand_less']");
      const titleEl = section.querySelector("h3");

      const toggleSection = (forceState) => {
        if (!content) return;
        const isHidden = content.classList.contains("hidden") || content.style.display === "none";
        const willOpen = forceState !== undefined ? forceState : isHidden;

        if (willOpen) {
          content.classList.remove("hidden");
          content.style.display = "block";
          section.classList.remove("opacity-90");
          section.classList.add("opacity-100", "shadow-sm");
          if (switchBtn) {
            switchBtn.setAttribute("aria-checked", "true");
            switchBtn.classList.remove("bg-surface-dim");
            switchBtn.classList.add("bg-primary");
          }
          if (thumb) {
            thumb.classList.remove("translate-x-0");
            thumb.classList.add("translate-x-5");
          }
          if (chevron) {
            chevron.classList.add("rotate-180");
            chevron.style.transform = "rotate(180deg)";
          }
          if (titleEl) {
            titleEl.classList.remove("text-on-surface-variant");
            titleEl.classList.add("text-primary", "font-bold");
          }
        } else {
          content.classList.add("hidden");
          content.style.display = "none";
          section.classList.remove("opacity-100", "shadow-sm");
          section.classList.add("opacity-90");
          if (switchBtn) {
            switchBtn.setAttribute("aria-checked", "false");
            switchBtn.classList.remove("bg-primary");
            switchBtn.classList.add("bg-surface-dim");
          }
          if (thumb) {
            thumb.classList.remove("translate-x-5");
            thumb.classList.add("translate-x-0");
          }
          if (chevron) {
            chevron.classList.remove("rotate-180");
            chevron.style.transform = "rotate(0deg)";
          }
          if (titleEl) {
            titleEl.classList.add("text-on-surface-variant");
            titleEl.classList.remove("text-primary", "font-bold");
          }
        }
      };

      if (header) {
        header.addEventListener("click", (e) => {
          e.preventDefault();
          toggleSection();
        });
      }
      if (switchBtn) {
        switchBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          toggleSection();
        });
      }
    });

    // Live vitals assessment listener (Real-time XGBoost + SVM evaluation)
    let vitalsTimeout = null;
    const triggerLiveAssessment = () => {
      clearTimeout(vitalsTimeout);
      vitalsTimeout = setTimeout(async () => {
        const formData = collectFormFromDOM(root);
        const vitals = (formData && formData.vitals) || {};
        const hasVitals = vitals.bp_systolic || vitals.bp_diastolic || vitals.heart_rate || vitals.spo2 || vitals.temperature_celsius || vitals.blood_sugar;
        if (hasVitals && API && API.assessPatient) {
          try {
            const assessment = await API.assessPatient(formData);
            if (assessment && assessment.status === "success") {
              renderAssessmentPanel(mainEl, assessment);
            }
          } catch (_) {}
        }
      }, 400);
    };

    root.querySelectorAll('input, select, textarea').forEach((inp) => {
      inp.addEventListener('input', triggerLiveAssessment);
      inp.addEventListener('change', triggerLiveAssessment);
    });

    renderStoredRecords();
  }

  global.toggleAccordion = function(id, btnElement, isHeaderBtn) {
    let content = document.getElementById(id);
    if (!content && btnElement) {
      const sec = btnElement.closest(".form-section-toggle");
      if (sec) content = sec.querySelector(".form-content");
    }
    if (!content) return;
    const isHidden = content.classList.contains("hidden") || content.style.display === "none";
    if (isHidden) {
      content.classList.remove("hidden");
      content.style.display = "block";
    } else {
      content.classList.add("hidden");
      content.style.display = "none";
    }
  };

  global.SukanyaForm = {
    init: initFormPage,
    saveRecordAndGo,
    autofill,
    renderStoredRecords,
    loadRecordIntoForm,
    openVoiceStudioModal,
    renderAssessmentPanel,
    startFieldDictation,
    toggleAccordion: global.toggleAccordion,
  };
  global.SakhiForm = global.SukanyaForm;

  // No DOMContentLoaded listener here on purpose: sakhi-app.js's own
  // DOMContentLoaded dispatcher already calls window.SukanyaForm.init() for
  // every one of these page keys ("form-part1"/"form-part2"/"form-smart" via
  // its PAGES table, "form-expanded" via its `page.startsWith("form-")`
  // fallback -- see the bottom of sakhi-app.js). Having a second listener
  // here meant initFormPage("main") ran twice on every load of this page,
  // which attached every listener it sets up -- mic-button dictation,
  // save/save-draft, per-keystroke live-assessment triggers, tab switching --
  // twice each. The visible symptom was small (the field-dictation "Done"
  // pill appearing twice per click), but the real effect was every one of
  // those handlers, and every API call some of them make, firing twice.
})(window);
