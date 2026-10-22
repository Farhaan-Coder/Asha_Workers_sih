/**
 * Complete Multilingual UI Engine for Sukanya ASHA
 * Supports 5 regional languages: English (en), Hindi (hi), Bengali (bn), Tamil (ta), Marathi (mr).
 * Features:
 * - Instant 100% offline phrase dictionary embedded directly for fast rendering
 * - Deep DOM text-node and attribute translation
 * - Dynamic MutationObserver for AJAX / API loaded content
 * - Seamless language switching with localStorage persistence across all pages
 */
(function (global) {
  "use strict";

  const LANG_KEY = "sukanya_lang";
  const ALT_LANG_KEY = "asha_language";
  const DEFAULT_LANG = "en";

  // Comprehensive embedded phrase mapping dictionary for 100% offline & instant translation
  const DICTIONARY = {
    // Navigation & Brand
    "app_name": { en: "Sukanya ASHA", hi: "सुकन्या आशा", bn: "সুকন্যা আশা", ta: "சுகன்யா ஆஷா", mr: "सुकन्या आशा" },
    "app_subtitle": { en: "Digital Health Assistant", hi: "डिजिटल स्वास्थ्य सहायक", bn: "ডিজিটাল স্বাস্থ্য সহকারী", ta: "டிஜிட்டல் சுகாதார உதவியாளர்", mr: "डिजिटल आरोग्य सहाय्यक" },
    "ai_badge_title": { en: "Gemma 4 12B AI", hi: "जेम्मा 4 12B एआई", bn: "জেমা 4 12B এআই", ta: "ஜெம்மா 4 12B ஏஐ", mr: "जेम्मा 4 12B एआय" },
    "ai_badge_subtitle": { en: "Clinical Triage & Schedule", hi: "क्लिनिकल ट्राइएज और अनुसूची", bn: "ক্লিনিকাল ট্রায়াজ এবং সময়সূচী", ta: "மருத்துவ பரிசோதனை & அட்டவணை", mr: "क्लिनिकल ट्रायज आणि वेळापत्रक" },
    "nav_home": { en: "Home Dashboard", hi: "होम डैशबोर्ड", bn: "হোম ড্যাশবোর্ড", ta: "முகப்பு கட்டுப்பாட்டகம்", mr: "मुख्य डॅशबोर्ड" },
    "nav_calendar": { en: "Visit Schedule", hi: "भ्रमण अनुसूची", bn: "পরিদর্শন সময়সূচী", ta: "பார்வை அட்டவணை", mr: "भेट वेळापत्रक" },
    "nav_schedule": { en: "Visit Schedule", hi: "भ्रमण अनुसूची", bn: "পরিদর্শন সময়সূচী", ta: "பார்வை அட்டவணை", mr: "भेट वेळापत्रक" },
    "nav_records": { en: "Smart Health Form", hi: "स्मार्ट स्वास्थ्य प्रपत्र", bn: "স্মার্ট স্বাস্থ্য ফর্ম", ta: "ஸ்மார்ட் சுகாதார படிவம்", mr: "स्मार्ट आरोग्य अर्ज" },
    "nav_forms": { en: "NHM Form (Part 1 & 2)", hi: "एनएचएम प्रपत्र (भाग 1 और 2)", bn: "এনএইচএম ফর্ম (পার্ট ১ এবং ২)", ta: "என்.எச்.எம் படிவம் (பாகம் 1 & 2)", mr: "एनएचएम अर्ज (भाग १ आणि २)" },
    "nav_nhm_forms": { en: "NHM Form (Part 1 & 2)", hi: "एनएचएम प्रपत्र (भाग 1 और 2)", bn: "এনএইচএম ফর্ম (পার্ট ১ এবং ২)", ta: "என்.எச்.எம் படிவம் (பாகம் 1 & 2)", mr: "एनएचएम अर्ज (भाग १ आणि २)" },
    "nav_settings": { en: "Settings", hi: "सेटिंग्स", bn: "সেটিংস", ta: "அமைப்புகள்", mr: "सेटिंग्ज" },
    "nav_logout": { en: "Log Out of ASHA Session", hi: "आशा सत्र से लॉग आउट करें", bn: "আশা সেশন থেকে লগ আউট করুন", ta: "ஆஷா அமர்விலிருந்து வெளியேறு", mr: "आशा सत्रातून लॉग आउट करा" },
    "emergency_sos": { en: "Emergency SOS (108)", hi: "आपातकालीन एसओएस (108)", bn: "জরুরী এসওএস (১০৮)", ta: "அவசர உதவி எஸ்.ஓ.எஸ் (108)", mr: "आपत्कालीन एसओएस (१०८)" },
    "emergency_button": { en: "Emergency SOS (108)", hi: "आपातकालीन एसओएस (108)", bn: "জরুরী এসওএস (১০৮)", ta: "அவசர உதவி எஸ்.ஓ.எஸ் (108)", mr: "आपत्कालीन एसओएस (१०८)" },

    // Settings Page
    "settings_title": { en: "Settings & System Configuration", hi: "सेटिंग्स और सिस्टम कॉन्फ़िगरेशन", bn: "সেটিংস এবং সিস্টেম কনফিগারেশন", ta: "அமைப்புகள் மற்றும் கணினி கட்டமைப்பு", mr: "सेटिंग्ज आणि सिस्टम संरचना" },
    "settings_subtitle": { en: "Manage offline sync, alerts, AI integration, and community requests.", hi: "ऑफ़लाइन सिंक, अलर्ट, एआई एकीकरण और सामुदायिक अनुरोधों का प्रबंधन करें।", bn: "অফলাইন সিঙ্ক, সতর্কতা, এআই ইন্টিগ্রেশন এবং কমিউনিটি অনুরোধ পরিচালনা করুন।", ta: "ஆஃப்லைன் ஒத்திசைவு, விழிப்பூட்டல்கள், ஏஐ ஒருங்கிணைப்பு மற்றும் சமூக கோரிக்கைகளை நிர்வகிக்கவும்.", mr: "ऑफलाइन सिंक, सूचना, एआय एकत्रीकरण आणि समुदाय विनंत्या व्यवस्थापित करा." },
    "settings_language": { en: "Language Preference", hi: "भाषा प्राथमिकता", bn: "भाषा पसंद", ta: "மொழி தேர்வு", mr: "भाषा प्राधान्य" },
    "settings_language_desc": { en: "Choose your preferred app interface language", hi: "अपनी पसंदीदा ऐप इंटरफ़ेस भाषा चुनें", bn: "আপনার পছন্দের অ্যাপ ইন্টারফেসের ভাষা চয়ন করুন", ta: "உங்கள் விருப்பமான பயன்பாட்டு இடைமுக மொழியைத் தேர்ந்தெடுக்கவும்", mr: "आपली पसंतीची अ‍ॅप भाषा निवडा" },
    "settings_offline_mode": { en: "Offline Sync Cache", hi: "ऑफ़लाइन सिंक कैश", bn: "অফলাইন সিঙ্ক ক্যাশ", ta: "ஆஃப்லைன் ஒத்திசைவு தற்காலிக சேமிப்பு", mr: "ऑफलाइन सिंक कॅशे" },
    "settings_offline_desc": { en: "Automatically store visits and sync when online", hi: "भ्रमणों को स्वचालित रूप से संग्रहीत करें और ऑनलाइन होने पर सिंक करें", bn: "স্বয়ংক্রিয়ভাবে পরিদর্শন সংরক্ষণ করুন এবং অনলাইন হলে সিঙ্ক করুন", ta: "பார்வைகளை தானாக சேமித்து, ஆன்லைனில் இருக்கும்போது ஒத்திசைக்கவும்", mr: "भेटी आपोआप साठवा आणि ऑनलाइन झाल्यावर सिंक करा" },
    "settings_notifications": { en: "Urgent Triage Push Alerts", hi: "तत्काल ट्राइएज पुश अलर्ट", bn: "জরুরী ট্রায়াজ পুশ সতর্কতা", ta: "அவசர பரிசோதனை அறிவிப்புகள்", mr: "तातडीच्या ट्रायज पुश सूचना" },
    "settings_notifications_desc": { en: "Instant notifications for high-risk maternal & child danger signs", hi: "उच्च जोखिम वाले मातृ एवं शिशु खतरे के संकेतों के लिए तत्काल सूचनाएं", bn: "উচ্চ ঝুঁকিপূর্ণ মাতৃত্ব এবং শিশু বিপদের লক্ষণগুলির জন্য তাত্ক্ষণিক বিজ্ঞপ্তি", ta: "அதிக ஆபத்துள்ள தாய் மற்றும் குழந்தை ஆபத்து அறிகுறிகளுக்கான உடனடி அறிவிப்புகள்", mr: "उच्च जोखमीच्या माता आणि बाल धोक्याच्या लक्षणांसाठी त्वरित सूचना" },
    "settings_emergency_hub": { en: "Emergency SOS & Healthcare Contacts", hi: "आपातकालीन एसओएस और स्वास्थ्य संपर्क", bn: "জরুরী এসওএস এবং স্বাস্থ্যসেবা পরিচিতি", ta: "அவசர உதவி எஸ்.ஓ.எஸ் & சுகாதார தொடர்புகள்", mr: "आपत्कालीन एसओएस आणि आरोग्य संपर्क" },
    "settings_emergency_hub_desc": { en: "Configure 108 ambulance, medical officer, and custom emergency numbers", hi: "108 एम्बुलेंस, चिकित्सा अधिकारी और कस्टम आपातकालीन नंबर कॉन्फ़िगर करें", bn: "১০৮ অ্যাম্বুলেন্স, মেডিকেল অফিসার এবং কাস্টম জরুরী নম্বর কনফিগার করুন", ta: "108 ஆம்புலன்ஸ், மருத்துவ அலுவலர் மற்றும் தனிப்பயன் அவசர எண்களை உள்ளமைக்கவும்", mr: "१०८ रुग्णवाहिका, वैद्यकीय अधिकारी आणि सानुकूल आपत्कालीन क्रमांक कॉन्फिगर करा" },
    "settings_manage_contacts": { en: "Manage", hi: "प्रबंधित करें", bn: "পরিচালনা করুন", ta: "நிர்வகி", mr: "व्यवस्थापित करा" },
    "settings_logout": { en: "Log Out of ASHA Session", hi: "आशा सत्र से लॉग आउट करें", bn: "আশা সেশন থেকে লগ আউট করুন", ta: "ஆஷா அமர்விலிருந்து வெளியேறு", mr: "आशा सत्रातून लॉग आउट करा" },

    // Smart Health Record & Voice Studio
    "form_smart_title": { en: "Smart Health Record", hi: "स्मार्ट स्वास्थ्य रिकॉर्ड", bn: "স্মার্ট স্বাস্থ্য রেকর্ড", ta: "ஸ்மார்ட் சுகாதார பதிவு", mr: "स्मार्ट आरोग्य नोंद" },
    "form_smart_subtitle": { en: "Enter household clinical data or view previously stored records.", hi: "घरेलू क्लिनिकल डेटा दर्ज करें या पहले संग्रहीत रिकॉर्ड देखें।", bn: "পারিবারিক ক্লিনিকাল ডেটা লিখুন বা পূর্বে সংরক্ষিত রেকর্ডগুলি দেখুন।", ta: "வீட்டு மருத்துவத் தரவை உள்ளிடவும் அல்லது முன்பு சேமிக்கப்பட்ட பதிவுகளைப் பார்க்கவும்.", mr: "कौटुंबिक वैद्यकीय माहिती प्रविष्ट करा किंवा पूर्वी जतन केलेल्या नोंदी पहा." },
    "btn_save_draft": { en: "Save Draft", hi: "ड्राफ्ट सहेजें", bn: "খসড়া সংরক্ষণ", ta: "வரைவை சேமி", mr: "मसुदा जतन करा" },
    "btn_save_record": { en: "Save Record", hi: "रिकॉर्ड सहेजें", bn: "রেকর্ড সংরক্ষণ", ta: "பதிவை சேமி", mr: "नोंद जतन करा" },
    "tab_form_entry": { en: "Health Record Form", hi: "स्वास्थ्य रिकॉर्ड प्रपत्र", bn: "স্বাস্থ্য রেকর্ড ফর্ম", ta: "சுகாதார பதிவு படிவம்", mr: "आरोग्य नोंद अर्ज" },
    "tab_stored_records": { en: "Stored Records", hi: "संग्रहीत रिकॉर्ड्स", bn: "সংরক্ষিত রেকর্ড", ta: "சேமிக்கப்பட்ட பதிவுகள்", mr: "जतन केलेल्या नोंदी" },
    "voice_studio_title": { en: "Audio-to-Transcript Voice Studio", hi: "ऑडियो-टू-ट्रांसक्रिप्ट वॉयस स्टूडियो", bn: "অডিও-টু-ট্রান্সক্রিপ্ট ভয়েস স্টুডিও", ta: "ஆடியோ-டூ-டிரான்ஸ்கிரிப்ட் குரல் ஸ்டுடியோ", mr: "ऑडिओ-टू-ट्रान्सक्रिप्ट व्हॉईस स्टुडिओ" },
    "voice_studio_badge": { en: "✨ AI Powered", hi: "✨ एआई संचालित", bn: "✨ এআই চালিত", ta: "✨ ஏஐ ஆற்றல் பெற்றது", mr: "✨ एआय समर्थित" },
    "voice_studio_desc": { en: "Record patient conversation, upload audio/video, or dictation to autofill health record.", hi: "स्वास्थ्य रिकॉर्ड को स्वतः भरने के लिए बातचीत रिकॉर्ड करें, ऑडियो/वीडियो अपलोड करें या बोलकर लिखवाएं।", bn: "স্বাস্থ্য রেকর্ড স্বয়ংক্রিয়ভাবে পূরণ করতে রোগীর কথোপকথন রেকর্ড করুন, অডিও/ভিডিও আপলোড করুন বা নির্দেশ দিন।", ta: "சுகாதார பதிவை தானாக நிரப்ப நோயாளி உரையாடலை பதிவு செய்யவும், ஆடியோ/வீடியோவை பதிவேற்றவும்.", mr: "आरोग्य नोंद आपोआप भरण्यासाठी संभाषण रेकॉर्ड करा, ऑडिओ/व्हिडिओ अपलोड करा किंवा डिक्टेशन द्या." },
    "btn_open_voice_studio": { en: "Open Voice Studio", hi: "वॉयस स्टूडियो खोलें", bn: "ভয়েস স্টুডিও খুলুন", ta: "குரல் ஸ்டுடியோவைத் திறக்கவும்", mr: "व्हॉईस स्टुडिओ उघडा" },
    "risk_assessment_title": { en: "Live Patient Health & Risk Assessment", hi: "लाइव रोगी स्वास्थ्य और जोखिम मूल्यांकन", bn: "লাইভ রোগীর স্বাস্থ্য এবং ঝুঁকি মূল্যায়ন", ta: "நேரலை நோயாளி உடல்நலம் & ஆபத்து மதிப்பீடு", mr: "थेट रुग्ण आरोग्य आणि जोखीम मूल्यांकन" },
    "risk_assessment_subtitle": { en: "Real-time XGBoost & SVM Triage Engine", hi: "रियल-टाइम एक्सजीबूस्ट और एसवीएम ट्राइएज इंजन", bn: "রিয়েল-টাইম এক্সজিবুস্ট এবং এসভিএম ট্রায়াজ ইঞ্জিন", ta: "நிகழ்நேர XGBoost & SVM பரிசோதனை அமைப்பு", mr: "रिअल-टाइम XGBoost आणि SVM ट्रायज इंजिन" },
    "badge_high_risk": { en: "HIGH RISK", hi: "उच्च जोखिम", bn: "উচ্চ ঝুঁকি", ta: "அதிக ஆபத்து", mr: "उच्च जोखीम" },
    "badge_mod_risk": { en: "MODERATE RISK", hi: "मध्यम जोखिम", bn: "মাঝারি ঝুঁকি", ta: "மிதமான ஆபத்து", mr: "मध्यम जोखीम" },
    "badge_low_risk": { en: "LOW RISK", hi: "कम जोखिम", bn: "কম ঝুঁকি", ta: "குறைந்த ஆபத்து", mr: "कमी जोखीम" },
    "urgent_review_title": { en: "URGENT - CLINICIAN REVIEW", hi: "तत्काल - चिकित्सक समीक्षा आवश्यक", bn: "জরুরী - চিকিৎসক পর্যালোচনা প্রয়োজন", ta: "அவசரம் - மருத்துவர் ஆய்வு தேவை", mr: "तातडीचे - वैद्यकीय तपासणी आवश्यक" },
    "recommended_action_title": { en: "Recommended Clinical Action", hi: "अनुशंसित क्लिनिकल कार्रवाई", bn: "সুপারিশকৃত ক্লিনিকাল পদক্ষেপ", ta: "பரிந்துரைக்கப்பட்ட மருத்துவ நடவடிக்கை", mr: "शिफारस केलेली वैद्यकीय कृती" },
    "condition_model_label": { en: "Condition Model:", hi: "रोग स्थिति मॉडल:", bn: "শারীরিক অবস্থা মডেল:", ta: "நோய் நிலை மாதிரி:", mr: "आरोग्य स्थिती मॉडेल:" },
    "maternal_risk_model_label": { en: "Maternal Risk Model:", hi: "मातृ जोखिम मॉडल:", bn: "মাতৃত্বের ঝুঁকি মডেল:", ta: "தாய்மை ஆபத்து மாதிரி:", mr: "माता जोखीम मॉडेल:" },
    "ai_next_scheduled_title": { en: "AI Next Scheduled Meet Recommendation", hi: "एआई अगली निर्धारित भेंट अनुशंसा", bn: "এআই পরবর্তী নির্ধারিত সাক্ষাত্কারের সুপারিশ", ta: "ஏஐ அடுத்த திட்டமிடப்பட்ட சந்திப்பு பரிந்துரை", mr: "एआय पुढील नियोजित भेट शिफारस" },
    "ask_question_title": { en: "Ask a question about this visit", hi: "इस भेंट के बारे में प्रश्न पूछें", bn: "এই পরিদর্শন সম্পর্কে একটি প্রশ্ন জিজ্ঞাসা করুন", ta: "இந்த சந்திப்பு பற்றி ஒரு கேள்வியைக் கேளுங்கள்", mr: "या भेटीबद्दल प्रश्न विचारा" },
    "ask_question_placeholder": { en: "e.g. What was the patient's blood pressure?", hi: "उदा. मरीज का रक्तचाप (बीपी) क्या था?", bn: "উদাঃ রোগীর রক্তচাপ কত ছিল?", ta: "உதா: நோயாளியின் இரத்த அழுத்தம் என்ன?", mr: "उदा. रुग्णाचा रक्तदाब काय होता?" },
    "btn_ask": { en: "Ask", hi: "पूछें", bn: "জিজ্ঞাসা করুন", ta: "கேட்கவும்", mr: "विचारा" },
    "ai_visit_summary_title": { en: "AI Visit Summary", hi: "एआई भेंट सारांश", bn: "এআই পরিদর্শন সারাংশ", ta: "ஏஐ சந்திப்பு சுருக்கம்", mr: "एआय भेट सारांश" },
    "ai_visit_summary_desc": { en: "A second, AI-generated read of the transcript — not a substitute for the structured form above.", hi: "ट्रांसक्रिप्ट का एआई-जनित सारांश — ऊपर दिए गए संरचित फॉर्म का विकल्प नहीं है।", bn: "ট্রান্সক্রিপ্টের দ্বিতীয় এআই-জেনারেটেড সারসংক্ষেপ।", ta: "பதிவின் இரண்டாவது ஏஐ உருவாக்கிய சுருக்கம்.", mr: "ट्रान्सक्रिप्टचा एआय-व्युत्पन्न सारांश." },
    "btn_generate": { en: "Generate", hi: "उत्पन्न करें", bn: "তৈরি করুন", ta: "உருவாக்கு", mr: "तयार करा" },

    // Form Sections
    "section_basic_info": { en: "Basic Information", hi: "बुनियादी जानकारी", bn: "প্রাথমিক তথ্য", ta: "அடிப்படை தகவல்", mr: "मूलभूत माहिती" },
    "label_head_name": { en: "Head of Household Name", hi: "परिवार के मुखिया का नाम", bn: "পরিবারের প্রধানের নাম", ta: "குடும்பத் தலைவர் பெயர்", mr: "कुटुंब प्रमुखाचे नाव" },
    "placeholder_enter_name": { en: "Enter full name", hi: "पूरा नाम दर्ज करें", bn: "সম্পূর্ণ নাম লিখুন", ta: "முழு பெயரை உள்ளிடவும்", mr: "पूर्ण नाव प्रविष्ट करा" },
    "label_age": { en: "Age", hi: "आयु / उम्र", bn: "বয়স", ta: "வயது", mr: "वय" },
    "placeholder_age": { en: "e.g. 34", hi: "उदा. 34", bn: "উদাঃ ৩৪", ta: "உதா: 34", mr: "उदा. 34" },
    "label_mobile": { en: "Mobile Number", hi: "मोबाइल नंबर", bn: "মোবাইল নম্বর", ta: "கைபேசி எண்", mr: "मोबाईल नंबर" },
    "placeholder_mobile": { en: "10-digit mobile number", hi: "10-अंकीय मोबाइल नंबर", bn: "১০-সংখ্যার মোবাইল নম্বর", ta: "10 இலக்க கைபேசி எண்", mr: "१० अंकी मोबाईल नंबर" },
    "section_vitals": { en: "Vitals & Clinical Examination", hi: "महत्वपूर्ण संकेत और नैदानिक जांच", bn: "শারীরিক লক্ষণ ও ক্লিনিকাল পরীক্ষা", ta: "முக்கிய அறிகுறிகள் & மருத்துவ பரிசோதனை", mr: "महत्त्वाची लक्षणे आणि क्लिनिकल तपासणी" },
    "label_systolic_bp": { en: "Systolic BP (mmHg)", hi: "सिस्टोलिक बीपी (mmHg)", bn: "সিস্টোলিক বিপি (mmHg)", ta: "சிஸ்டாலிக் பிபி (mmHg)", mr: "सिस्टॉलिक बीपी (mmHg)" },
    "label_diastolic_bp": { en: "Diastolic BP (mmHg)", hi: "डायस्टोलिक बीपी (mmHg)", bn: "ডায়াস্টোলিক বিপি (mmHg)", ta: "டயஸ்டாலிக் பிபி (mmHg)", mr: "डायस्टॉलिक बीपी (mmHg)" },
    "label_heart_rate": { en: "Heart Rate / Pulse (bpm)", hi: "हृदय गति / पल्स (bpm)", bn: "হার্ট রেট / পালস (bpm)", ta: "இதய துடிப்பு (bpm)", mr: "हृदय गती / नाडी (bpm)" },
    "label_spo2": { en: "Oxygen SpO2 (%)", hi: "ऑक्सीजन स्तर SpO2 (%)", bn: "অক্সিজেন মাত্রা SpO2 (%)", ta: "ஆக்ஸிஜன் அளவு SpO2 (%)", mr: "ऑक्सिजन पातळी SpO2 (%)" },
    "label_blood_sugar": { en: "Blood Sugar (mg/dL)", hi: "ब्लड शुगर (mg/dL)", bn: "রক্তের শর্করা (mg/dL)", ta: "இரத்த சர்க்கரை (mg/dL)", mr: "रक्त शर्करा (mg/dL)" },
    "label_temperature": { en: "Body Temperature (°F)", hi: "शरीर का तापमान (°F)", bn: "শরীরের তাপমাত্রা (°F)", ta: "உடல் வெப்பநிலை (°F)", mr: "शरीराचे तापमान (°F)" },
    "section_maternal": { en: "Maternal Health & Danger Signs", hi: "मातृ स्वास्थ्य और खतरे के संकेत", bn: "মাতৃস্বাস্থ্য এবং বিপদের লক্ষণ", ta: "தாய்மை நலம் & ஆபத்து அறிகுறிகள்", mr: "माता आरोग्य आणि धोक्याची लक्षणे" },
    "section_immunization": { en: "Universal Immunization & Vaccination", hi: "सार्वभौमिक टीकाकरण और वैक्सीन", bn: "সর্বজনীন টিকাদান এবং ভ্যাকসিন", ta: "தடுப்பூசி & மருந்துகள்", mr: "सार्वत्रिक लसीकरण आणि लस" },

    // Dashboard & Scheduler
    "dash_today_visits": { en: "Today's Scheduled Visits", hi: "आज के निर्धारित भ्रमण", bn: "আজকের নির্ধারিত পরিদর্শন", ta: "இன்றைய திட்டமிடப்பட்ட பார்வைகள்", mr: "आजच्या नियोजित भेटी" },
    "dash_high_risk_alerts": { en: "High Risk Triage Alerts", hi: "उच्च जोखिम ट्राइएज अलर्ट", bn: "উচ্চ ঝুঁকি ট্রায়াজ সতর্কতা", ta: "அதிக ஆபத்து எச்சரிக்கைகள்", mr: "उच्च जोखीम सूचना" },
    "dash_immunization_due": { en: "Immunizations Due", hi: "टीकाकरण देय", bn: "বাকি টিকাদান", ta: "நிலுவையிலுள்ள தடுப்பூசிகள்", mr: "बाकी लसीकरण" },
    "dash_saved_records": { en: "Saved Health Records", hi: "सहेजे गए स्वास्थ्य रिकॉर्ड", bn: "সংরক্ষিত স্বাস্থ্য রেকর্ড", ta: "சேமிக்கப்பட்ட சுகாதார பதிவுகள்", mr: "जतन केलेल्या आरोग्य नोंदी" },
    "scheduler_title": { en: "Smart AI Visit Scheduler", hi: "स्मार्ट एआई भ्रमण अनुसूची", bn: "স্মার্ট এআই পরিদর্শন সময়সূচী", ta: "ஸ்மார்ட் ஏஐ சந்திப்பு அட்டவணை", mr: "स्मार्ट एआय भेट वेळापत्रक" },
    "scheduler_subtitle": { en: "Gemma AI travel optimizer and priority-based route allocator.", hi: "जेम्मा एआई यात्रा अनुकूलक और प्राथमिकता आधारित रूट आवंटक।", bn: "জেমা এআই ভ্রমণ অপ্টিমাইজার এবং রুট বরাদ্কারী।", ta: "ஜெம்மா ஏஐ பயண உகப்பாக்கி மற்றும் வழி ஒதுக்கீடு.", mr: "जेम्मा एआय प्रवास ऑप्टिमायझर आणि मार्ग वाटप." },
    "btn_optimize_schedule": { en: "AI Optimize Day", hi: "दिन अनुकूलित करें", bn: "দিনটি অপ্টিমাইজ করুন", ta: "நாளை மேம்படுத்து", mr: "दिवस ऑप्टिमाइझ करा" },
    "filter_risk_label": { en: "Filter by Risk:", hi: "जोखिम अनुसार फ़िल्टर:", bn: "ঝুঁকি অনুযায়ী ফিল্টার:", ta: "ஆபத்து அடிப்படையில் வடிகட்டவும்:", mr: "जोखमीनुसार फिल्टर करा:" },
    "filter_all": { en: "All", hi: "सभी", bn: "সব", ta: "அனைத்தும்", mr: "सर्व" },
    "filter_emergency": { en: "Emergency", hi: "आपातकालीन", bn: "জরুরী", ta: "அவசரம்", mr: "आपत्कालीन" },
    "filter_high": { en: "High Risk", hi: "उच्च जोखिम", bn: "উচ্চ ঝুঁকি", ta: "அதிக ஆபத்து", mr: "उच्च जोखीम" },
    "filter_moderate": { en: "Moderate Risk", hi: "मध्यम जोखिम", bn: "মাঝারি ঝুঁকি", ta: "மிதமான ஆபத்து", mr: "मध्यम जोखीम" },
    "filter_routine": { en: "Routine", hi: "नियमित", bn: "নিয়মিত", ta: "வழக்கமான", mr: "नियमित" },
    "btn_schedule_new": { en: "Schedule New Visit", hi: "नया भ्रमण निर्धारित करें", bn: "নতুন পরিদর্শন নির্ধারণ করুন", ta: "புதிய சந்திப்பை திட்டமிடு", mr: "नवीन भेट निश्चित करा" },

    // Direct Phrase Matching Fallback (for arbitrary text nodes)
    "Sukanya ASHA": { hi: "सुकन्या आशा", bn: "সুকন্যা আশা", ta: "சுகன்யா ஆஷா", mr: "सुकन्या आशा" },
    "Digital Health Assistant": { hi: "डिजिटल स्वास्थ्य सहायक", bn: "ডিজিটাল স্বাস্থ্য সহকারী", ta: "டிஜிட்டல் சுகாதார உதவியாளர்", mr: "डिजिटल आरोग्य सहाय्यक" },
    "Home Dashboard": { hi: "होम डैशबोर्ड", bn: "হোম ড্যাশবোর্ড", ta: "முகப்பு கட்டுப்பாட்டகம்", mr: "मुख्य डॅशबोर्ड" },
    "Home": { hi: "होम", bn: "হোম", ta: "முகப்பு", mr: "मुख्य" },
    "Visit Schedule": { hi: "भ्रमण अनुसूची", bn: "পরিদর্শন সময়সূচী", ta: "பார்வை அட்டவணை", mr: "भेट वेळापत्रक" },
    "Schedule": { hi: "अनुसूची", bn: "সময়সূচী", ta: "அட்டவணை", mr: "वेळापत्रक" },
    "Smart Health Form": { hi: "स्मार्ट स्वास्थ्य प्रपत्र", bn: "স্মার্ট স্বাস্থ্য ফর্ম", ta: "ஸ்மார்ட் சுகாதார படிவம்", mr: "स्मार्ट आरोग्य अर्ज" },
    "Smart Health Record": { hi: "स्मार्ट स्वास्थ्य रिकॉर्ड", bn: "স্মার্ট স্বাস্থ্য रिकॉर्ड", ta: "ஸ்மார்ட் சுகாதார பதிவு", mr: "स्मार्ट आरोग्य नोंद" },
    "Forms": { hi: "प्रपत्र", bn: "ফর্ম", ta: "படிவங்கள்", mr: "अर्ज" },
    "NHM Form (Part 1 & 2)": { hi: "एनएचएम प्रपत्र (भाग 1 और 2)", bn: "এনএইচএম ফর্ম (পার্ট ১ এবং ২)", ta: "என்.எச்.எம் படிவம் (பாகம் 1 & 2)", mr: "एनएचएम अर्ज (भाग १ आणि २)" },
    "Settings": { hi: "सेटिंग्स", bn: "সেটিংস", ta: "அமைப்புகள்", mr: "सेटिंग्ज" },
    "Settings & Preferences": { hi: "सेटिंग्स और प्राथमिकताएं", bn: "সেটিংস এবং পছন্দসমূহ", ta: "அமைப்புகள் & விருப்பத்தேர்வுகள்", mr: "सेटिंग्ज आणि प्राधान्ये" },
    "Settings & System Configuration": { hi: "सेटिंग्स और सिस्टम कॉन्फ़िगरेशन", bn: "সেটিংস এবং সিস্টেম কনফিগারেশন", ta: "அமைப்புகள் மற்றும் கணினி கட்டமைப்பு", mr: "सेटिंग्ज आणि सिस्टम संरचना" },
    "Manage offline sync, alerts, AI integration, and community requests.": { hi: "ऑफ़लाइन सिंक, अलर्ट, एआई एकीकरण और सामुदायिक अनुरोधों का प्रबंधन करें।", bn: "অফলাইন সিঙ্ক, সতর্কতা, এআই ইন্টিগ্রেশন এবং কমিউনিটি অনুরোধ পরিচালনা করুন।", ta: "ஆஃப்லைன் ஒத்திசைவு, விழிப்பூட்டல்கள், ஏஐ ஒருங்கிணைப்பு மற்றும் சமூக கோரிக்கைகளை நிர்வகிக்கவும்.", mr: "ऑफलाइन सिंक, सूचना, एआय एकत्रीकरण आणि समुदाय विनंत्या व्यवस्थापित करा." },
    "Language Preference": { hi: "भाषा प्राथमिकता", bn: "भाषा पसंद", ta: "மொழி தேர்வு", mr: "भाषा प्राधान्य" },
    "Choose your preferred app interface language": { hi: "अपनी पसंदीदा ऐप इंटरफ़ेस भाषा चुनें", bn: "আপনার পছন্দের অ্যাপ ইন্টারফেসের ভাষা চয়ন করুন", ta: "உங்கள் விருப்பமான பயன்பாட்டு இடைமுக மொழியைத் தேர்ந்தெடுக்கவும்", mr: "आपली पसंतीची अ‍ॅप भाषा निवडा" },
    "Offline Sync Cache": { hi: "ऑफ़लाइन सिंक कैश", bn: "অফলাইন সিঙ্ক ক্যাশ", ta: "ஆஃப்லைன் ஒத்திசைவு தற்காலிக சேமிப்பு", mr: "ऑफलाइन सिंक कॅशे" },
    "Automatically store visits and sync when online": { hi: "भ्रमणों को स्वचालित रूप से संग्रहीत करें और ऑनलाइन होने पर सिंक करें", bn: "স্বয়ংক্রিয়ভাবে পরিদর্শন সংরক্ষণ করুন এবং অনলাইন হলে সিঙ্ক করুন", ta: "பார்வைகளை தானாக சேமித்து, ஆன்லைனில் இருக்கும்போது ஒத்திசைக்கவும்", mr: "भेटी आपोआप साठवा आणि ऑनलाइन झाल्यावर सिंक करा" },
    "Urgent Triage Push Alerts": { hi: "तत्काल ट्राइएज पुश अलर्ट", bn: "জরুরী ট্রায়াজ পুশ সতর্কতা", ta: "அவசர பரிசோதனை அறிவிப்புகள்", mr: "तातडीच्या ट्रायज पुश सूचना" },
    "Instant notifications for high-risk maternal & child danger signs": { hi: "उच्च जोखिम वाले मातृ एवं शिशु खतरे के संकेतों के लिए तत्काल सूचनाएं", bn: "উচ্চ ঝুঁকিপূর্ণ মাতৃত্ব এবং শিশু বিপদের লক্ষণগুলির জন্য তাত্ক্ষণিক বিজ্ঞপ্তি", ta: "அதிக ஆபத்துள்ள தாய் மற்றும் குழந்தை ஆபத்து அறிகுறிகளுக்கான உடனடி அறிவிப்புகள்", mr: "उच्च जोखमीच्या माता आणि बाल धोक्याच्या लक्षणांसाठी त्वरित सूचना" },
    "Log Out of ASHA Session": { hi: "आशा सत्र से लॉग आउट करें", bn: "আশা সেশন থেকে লগ আউট করুন", ta: "ஆஷா அமர்விலிருந்து வெளியேறு", mr: "आशा सत्रातून लॉग आउट करा" },
    "Emergency SOS (108)": { hi: "आपातकालीन एसओएस (108)", bn: "জরুরী এসওএস (১০৮)", ta: "அவசர உதவி எஸ்.ஓ.எஸ் (108)", mr: "आपत्कालीन एसओएस (१०८)" },
    "Gemma 4 12B AI": { hi: "जेम्मा 4 12B एआई", bn: "জেমা 4 12B এআই", ta: "ஜெம்மா 4 12B ஏஐ", mr: "जेम्मा 4 12B एआय" },
    "Clinical Triage & Schedule": { hi: "क्लिनिकल ट्राइएज और अनुसूची", bn: "ক্লিনিকাল ট্রায়াজ এবং সময়সূচী", ta: "மருத்துவ பரிசோதனை & அட்டவணை", mr: "क्लिनिकल ट्रायज आणि वेळापत्रक" },
    "Start Voice Visit": { hi: "वॉयस भेंट शुरू करें", bn: "ভয়েস পরিদর্শন শুরু করুন", ta: "குரல் சந்திப்பைத் தொடங்கு", mr: "व्हॉईस भेट सुरू करा" },
    "Visits Today": { hi: "आज के भ्रमण", bn: "আজকের পরিদর্শন", ta: "இன்றைய சந்திப்புகள்", mr: "आजच्या भेटी" },
    "Scheduled for today": { hi: "आज के लिए निर्धारित", bn: "আজকের জন্য निर्धारित", ta: "இன்று திட்டமிடப்பட்டுள்ளது", mr: "आजसाठी नियोजित" },
    "High Risk": { hi: "उच्च जोखिम", bn: "উচ্চ ঝুঁকি", ta: "அதிக ஆபத்து", mr: "उच्च जोखीम" },
    "Require urgent triage": { hi: "तत्काल जांच आवश्यक", bn: "জরুরী ট্রায়াজ প্রয়োজন", ta: "அவசர பரிசோதனை தேவை", mr: "तातडीची तपासणी आवश्यक" },
    "Immunization": { hi: "टीकाकरण", bn: "টিকাদান", ta: "தடுப்பூசி", mr: "लसीकरण" },
    "Children due this week": { hi: "इस सप्ताह देय बच्चे", bn: "এই সপ্তাহে বাকি শিশুরা", ta: "இந்த வாரம் தடுப்பூசி செலுத்த வேண்டிய குழந்தைகள்", mr: "या आठवड्यात बाकी असलेली मुले" },
    "Saved Data": { hi: "सहेजा गया डेटा", bn: "সংরক্ষিত তথ্য", ta: "சேமிக்கப்பட்ட தரவு", mr: "जतन केलेली माहिती" },
    "Database records stored": { hi: "डेटाबेस रिकॉर्ड्स संग्रहीत", bn: "ডাটাবেস রেকর্ড সংরক্ষিত", ta: "தரவுத்தள பதிவுகள் சேமிக்கப்பட்டன", mr: "डेटाबेस नोंदी जतन केल्या" },
    "Today's Visit Schedule": { hi: "आज की भ्रमण अनुसूची", bn: "আজকের পরিদর্শন সময়সূচী", ta: "இன்றைய சந்திப்பு அட்டவணை", mr: "आजचे भेट वेळापत्रक" },
    "View Full Calendar": { hi: "पूरा कैलेंडर देखें", bn: "সম্পূর্ণ ক্যালেন্ডার দেখুন", ta: "முழு காலெண்டரைக் காண்க", mr: "संपूर्ण कॅलेंडर पहा" },
    "All Visits": { hi: "सभी भ्रमण", bn: "সমস্ত পরিদর্শন", ta: "அனைத்து சந்திப்புகள்", mr: "सर्व भेटी" },
    "High-Risk Triage Alerts": { hi: "उच्च जोखिम ट्राइएज अलर्ट", bn: "উচ্চ ঝুঁকি ট্রায়াজ সতর্কতা", ta: "அதிக ஆபத்து எச்சரிக்கைகள்", mr: "उच्च जोखीम ट्रायज सूचना" },
    "Clinical Quick Actions": { hi: "त्वरित क्लिनिकल क्रियाएं", bn: "ক্লিনিকাল দ্রুত পদক্ষেপ", ta: "மருத்துவ விரைவு நடவடிக்கைகள்", mr: "क्लिनिकल जलद कृती" },
    "NHM Form Part 1": { hi: "एनएचएम प्रपत्र भाग 1", bn: "এনএইচএম ফর্ম পার্ট ১", ta: "என்.எச்.எம் படிவம் பாகம் 1", mr: "एनएचएम अर्ज भाग १" },
    "NHM Form Part 2": { hi: "एनएचएम प्रपत्र भाग 2", bn: "এনএইচএম ফর্ম পার্ট ২", ta: "என்.எச்.எம் படிவம் பாகம் 2", mr: "एनएचएम अर्ज भाग २" },
    "AI Route Allocator": { hi: "एआई रूट आवंटक", bn: "এআই রুট বরাদ্কারী", ta: "ஏஐ வழி ஒதுக்கீடு", mr: "एआय मार्ग वाटप" },
    "Gemma Travel Optimizer": { hi: "जेम्मा यात्रा अनुकूलक", bn: "জেমা ভ্রমণ অপ্টিমাইজার", ta: "ஜெம்மா பயண உகப்பாக்கி", mr: "जेम्मा प्रवास ऑप्टिमायझर" },
    "Vitals & Demographics": { hi: "महत्वपूर्ण संकेत और जनसांख्यिकी", bn: "শারীরিক লক্ষণ ও জনসংখ্যাতাত্ত্বিক", ta: "முக்கிய அறிகுறிகள் & மக்கள்தொகை", mr: "महत्त्वाची लक्षणे आणि लोकसंख्याशास्त्र" },
    "General & Maternal": { hi: "सामान्य और मातृ स्वास्थ्य", bn: "সাধারণ এবং মাতৃত্ব", ta: "பொது & தாய்மை", mr: "सामान्य आणि माता आरोग्य" },
    "Open Voice Studio": { hi: "वॉयस स्टूडियो खोलें", bn: "ভয়েস স্টুডিও খুলুন", ta: "குரல் ஸ்டுடியோவைத் திறக்கவும்", mr: "व्हॉईस स्टुडिओ उघडा" },
    "Manual Form": { hi: "मैनुअल प्रपत्र", bn: "ম্যানুয়াল ফর্ম", ta: "கையேடு படிவம்", mr: "मॅन्युअल अर्ज" },
    "Voice AI Engine": { hi: "वॉयस एआई इंजन", bn: "ভয়েস এআই ইঞ্জিন", ta: "குரல் ஏஐ அமைப்பு", mr: "व्हॉईस एआय इंजिन" },
    "Instant Audio-to-Transcript & Clinical Extraction": { hi: "त्वरित ऑडियो-टू-ट्रांसक्रिप्ट और क्लिनिकल निष्कर्षण", bn: "তাত্ক্ষণিক অডিও-টু-ট্রান্সক্রিপ্ট এবং ক্লিনিকাল নিষ্কাশন", ta: "உடனடி ஆடியோ-டூ-டிரான்ஸ்கிரிப்ட் மற்றும் மருத்துவ பிரித்தெடுத்தல்", mr: "त्वरित ऑडिओ-टू-ट्रान्सक्रिप्ट आणि क्लिनिकल माहिती निष्कर्षण" }
  };

  let activeLang = getLanguage();
  let isTranslating = false;

  function getLanguage() {
    return localStorage.getItem(LANG_KEY) || localStorage.getItem(ALT_LANG_KEY) || DEFAULT_LANG;
  }

  function getTranslation(key, lang) {
    if (!lang) lang = activeLang;
    if (DICTIONARY[key]) {
      if (DICTIONARY[key][lang]) return DICTIONARY[key][lang];
      if (lang === "en" && DICTIONARY[key].en) return DICTIONARY[key].en;
    }
    return null;
  }

  function translateText(text, lang) {
    if (!text || lang === "en") return text;
    const clean = text.trim();
    if (!clean) return text;

    // 1. Direct dictionary match
    const direct = getTranslation(clean, lang);
    if (direct) return text.replace(clean, direct);

    // 2. Case-insensitive dictionary match
    const lower = clean.toLowerCase();
    for (const [key, val] of Object.entries(DICTIONARY)) {
      if (key.toLowerCase() === lower && val[lang]) {
        return text.replace(clean, val[lang]);
      }
    }

    return text;
  }

  function walkAndTranslate(root, lang) {
    if (!root) return;
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function (node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const tag = parent.tagName.toUpperCase();
          if (["SCRIPT", "STYLE", "NOSCRIPT", "CODE", "SVG"].includes(tag)) {
            return NodeFilter.FILTER_REJECT;
          }
          if (parent.classList.contains("material-symbols-outlined") || parent.getAttribute("data-icon")) {
            return NodeFilter.FILTER_REJECT;
          }
          if (!node.nodeValue || !node.nodeValue.trim()) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      },
      false
    );

    const nodesToTranslate = [];
    while (walker.nextNode()) {
      nodesToTranslate.push(walker.currentNode);
    }

    nodesToTranslate.forEach((node) => {
      const currentVal = node.nodeValue;
      const trimmed = currentVal.trim();
      if (!trimmed) return;

      if (!node._sukanyaOrigText) {
        node._sukanyaOrigText = trimmed;
      }

      const orig = node._sukanyaOrigText;
      if (lang === "en") {
        node.nodeValue = currentVal.replace(trimmed, orig);
      } else {
        const trans = translateText(orig, lang);
        if (trans && trans !== orig) {
          node.nodeValue = currentVal.replace(trimmed, trans);
        }
      }
    });

    // Translate Placeholders
    root.querySelectorAll("input, textarea").forEach((el) => {
      const ph = el.getAttribute("placeholder");
      if (ph) {
        if (!el._sukanyaOrigPh) {
          el._sukanyaOrigPh = ph;
        }
        const origPh = el._sukanyaOrigPh;
        if (lang === "en") {
          el.setAttribute("placeholder", origPh);
        } else {
          el.setAttribute("placeholder", translateText(origPh, lang));
        }
      }
    });
  }

  function apply(lang) {
    activeLang = lang || getLanguage();
    document.documentElement.lang = activeLang;

    isTranslating = true;
    try {
      // 1. Tagged elements with data-i18n
      document.querySelectorAll("[data-i18n]").forEach((el) => {
        const key = el.getAttribute("data-i18n");
        const trans = getTranslation(key, activeLang);
        if (trans) {
          el.textContent = trans;
        }
      });

      // 2. Tagged elements with data-i18n-placeholder
      document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
        const key = el.getAttribute("data-i18n-placeholder");
        const trans = getTranslation(key, activeLang);
        if (trans) {
          el.setAttribute("placeholder", trans);
        }
      });

      // 3. Deep DOM text node translation
      if (document.body) {
        walkAndTranslate(document.body, activeLang);
      }

      // 4. Update language selectors if present on page
      document.querySelectorAll("#setting-language, [name='language'], .lang-select").forEach((sel) => {
        if (sel.value !== activeLang) {
          sel.value = activeLang;
        }
      });
    } finally {
      isTranslating = false;
    }
  }

  function setLanguage(lang) {
    if (!lang) lang = DEFAULT_LANG;
    localStorage.setItem(LANG_KEY, lang);
    localStorage.setItem(ALT_LANG_KEY, lang);
    activeLang = lang;
    apply(lang);

    window.dispatchEvent(new CustomEvent("sukanya:lang-changed", { detail: { language: lang } }));

    // Sync with backend API in background
    if (global.SakhiAPI && typeof global.SakhiAPI.putSettings === "function") {
      global.SakhiAPI.putSettings({ language: lang }).catch(() => {});
    }
  }

  function t(key) {
    const trans = getTranslation(key, activeLang);
    return trans || key;
  }

  // Setup DOM observer for dynamic content (e.g. dynamic cards, triage alerts)
  function setupObserver() {
    let debounceTimer = null;
    const observer = new MutationObserver((mutations) => {
      if (isTranslating) return;
      let shouldTranslate = false;
      for (const m of mutations) {
        if (m.type === "childList" && m.addedNodes.length > 0) {
          shouldTranslate = true;
          break;
        }
      }
      if (shouldTranslate && activeLang !== "en") {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          apply(activeLang);
        }, 120);
      }
    });

    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  // Auto-bind any language selector on the page
  function bindLanguageSelectors() {
    document.querySelectorAll("#setting-language, [name='language'], .lang-select").forEach((sel) => {
      sel.value = getLanguage();
      sel.addEventListener("change", (e) => {
        setLanguage(e.target.value);
      });
    });
  }

  // Run on DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      apply(getLanguage());
      bindLanguageSelectors();
      setupObserver();
    });
  } else {
    apply(getLanguage());
    bindLanguageSelectors();
    setupObserver();
  }

  global.SukanyaI18n = { apply, setLanguage, getLanguage, t, DICTIONARY };
})(window);
