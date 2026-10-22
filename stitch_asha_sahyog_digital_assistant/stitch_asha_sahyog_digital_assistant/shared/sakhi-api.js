/**
 * Sukanya API client — shared by every page in this frontend.
 *
 * Assumes the page is served same-origin from the Sukanya FastAPI backend
 * (mounted at /app — see api.py). All calls are relative paths, so this
 * works unmodified whether the backend is on localhost:8000 or deployed
 * elsewhere, as long as this frontend is served from the same origin.
 */
(function (global) {
  "use strict";

  const TOKEN_KEY = "sukanya_token";
  const WORKER_KEY = "sukanya_worker";

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || localStorage.getItem("sakhi_token");
  }
  function setToken(token) {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem("sakhi_token", token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem("sakhi_token");
    }
  }
  function getWorker() {
    try {
      return JSON.parse(localStorage.getItem(WORKER_KEY) || localStorage.getItem("sakhi_worker") || "null");
    } catch (e) {
      return null;
    }
  }
  function setWorker(worker) {
    if (worker) {
      localStorage.setItem(WORKER_KEY, JSON.stringify(worker));
      localStorage.setItem("sakhi_worker", JSON.stringify(worker));
    } else {
      localStorage.removeItem(WORKER_KEY);
      localStorage.removeItem("sakhi_worker");
    }
  }
  function isLoggedIn() {
    return !!getToken();
  }
  function logout() {
    setToken(null);
    setWorker(null);
  }

  async function request(path, opts) {
    opts = opts || {};
    const headers = Object.assign(
      { "Content-Type": "application/json" },
      opts.headers || {}
    );
    const token = getToken();
    if (token) headers["Authorization"] = "Bearer " + token;
    if (opts.body instanceof FormData) delete headers["Content-Type"];

    let res;
    try {
      res = await fetch(path, Object.assign({}, opts, { headers }));
    } catch (networkErr) {
      throw new Error(
        "Could not reach the Sukanya backend. Is it running? (" + networkErr.message + ")"
      );
    }

    if (!res.ok) {
      let detail = res.statusText;
      try {
        const body = await res.json();
        detail = body.detail || JSON.stringify(body);
      } catch (e) {
        /* body wasn't JSON */
      }
      if (res.status === 401) {
        setToken(null);
        setWorker(null);
      }
      const err = new Error(`${res.status} ${detail}`);
      err.status = res.status;
      throw err;
    }

    const ct = res.headers.get("content-type") || "";
    return ct.includes("application/json") ? res.json() : res.text();
  }

  const SukanyaAPI = {
    getToken,
    setToken,
    getWorker,
    setWorker,
    isLoggedIn,
    logout,

    health: () => request("/api/health"),

    requestPin: (mobile) =>
      request("/api/auth/request-pin", {
        method: "POST",
        body: JSON.stringify({ mobile }),
      }),
    verifyPin: (mobile, pin) =>
      request("/api/auth/verify-pin", {
        method: "POST",
        body: JSON.stringify({ mobile, pin }),
      }),
    me: () => request("/api/auth/me"),

    listVisits: (status, date) => {
      const params = new URLSearchParams();
      if (status) params.append("status", status);
      if (date) params.append("date", date);
      const qs = params.toString();
      return request("/api/visits" + (qs ? "?" + qs : ""));
    },
    createVisit: (visit) =>
      request("/api/visits", { method: "POST", body: JSON.stringify(visit) }),
    updateVisitStatus: (id, status) =>
      request(`/api/visits/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    updateVisitPriority: (id, priority) =>
      request(`/api/visits/${id}/priority`, {
        method: "PATCH",
        body: JSON.stringify({ priority }),
      }),
    deleteVisit: (id) => request(`/api/visits/${id}`, { method: "DELETE" }),
    seedDemoVisits: () => request("/api/visits/seed-demo", { method: "POST" }),

    // Gemma 4 12B AI Scheduler Endpoints
    getSchedulerStatus: () => request("/api/scheduler/status"),
    suggestNextVisit: (data) =>
      request("/api/scheduler/suggest-next-visit", { method: "POST", body: JSON.stringify(data) }),
    allocateTasks: (date) =>
      request("/api/scheduler/allocate-tasks", { method: "POST", body: JSON.stringify({ date }) }),
    nlSchedule: (prompt) =>
      request("/api/scheduler/nl-schedule", { method: "POST", body: JSON.stringify({ prompt }) }),

    summary: () => request("/api/summary"),

    createRecord: (record) =>
      request("/api/records", { method: "POST", body: JSON.stringify(record) }),
    listRecords: (visitId) =>
      request("/api/records" + (visitId ? "?visit_id=" + visitId : "")),
    getRecord: (id) => request(`/api/records/${id}`),
    deleteRecord: (id) => request(`/api/records/${id}`, { method: "DELETE" }),

    getSettings: () => request("/api/settings"),
    putSettings: (settings) =>
      request("/api/settings", { method: "PUT", body: JSON.stringify(settings) }),

    processText: (transcript, visitType) =>
      request("/api/process-text", {
        method: "POST",
        body: JSON.stringify({ transcript, visit_type: visitType || "auto" }),
      }),

    processAudio: (audioBlob, metadata, opts) => {
      const fd = new FormData();
      fd.append("audio", audioBlob, "recording.webm");
      fd.append("visit_type", (metadata && metadata.visit_type) || "auto");
      const lang = (opts && opts.language) || (metadata && metadata.language) || localStorage.getItem("sukanya_speech_lang") || "auto";
      if (lang) fd.append("language", lang);
      if (metadata) {
        [
          "patient_name",
          "patient_age",
          "age_unit",
          "patient_sex",
          "patient_mobile",
          "asha_id",
          "visit_date",
        ].forEach((k) => {
          if (metadata[k] != null && metadata[k] !== "") fd.append(k, metadata[k]);
        });
      }
      return request("/api/process-audio", { method: "POST", body: fd });
    },

    transcribeAudio: (audioBlob, opts) => {
      const fd = new FormData();
      const filename = (audioBlob && audioBlob.name) || "audio.webm";
      fd.append("audio", audioBlob, filename);
      fd.append("language", (opts && opts.language) || "auto");
      fd.append("diarize", opts && opts.diarize !== undefined ? String(opts.diarize) : "true");
      if (opts && opts.backend) fd.append("backend", opts.backend);
      return request("/api/transcribe", { method: "POST", body: fd });
    },

    translate: (text, targetLanguage = "en", sourceLanguage = "auto") =>
      request("/api/translate", {
        method: "POST",
        body: JSON.stringify({
          text,
          target_language: targetLanguage,
          source_language: sourceLanguage,
        }),
      }),

    audioExamples: () => request("/api/audio-examples"),
    examples: () => request("/api/examples"),

    predictTriage: (vitals) =>
      request("/api/predict/triage", { method: "POST", body: JSON.stringify(vitals) }),
    predictMaternalRisk: (vitals) =>
      request("/api/predict/maternal-risk", { method: "POST", body: JSON.stringify(vitals) }),
    predictCondition: (vitals) =>
      request("/api/predict/condition", { method: "POST", body: JSON.stringify(vitals) }),
    assessPatient: (data) =>
      request("/api/assess-patient", { method: "POST", body: JSON.stringify(data) }),

    // Alerts — backend-generated risk/anomaly flags (see backend/alerts.py)
    listAlerts: (status) =>
      request("/api/alerts" + (status ? "?status=" + encodeURIComponent(status) : "")),
    updateAlertStatus: (id, status) =>
      request(`/api/alerts/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),

    // Emergency escalation (ASHA-triggered)
    triggerEmergency: (body) =>
      request("/api/emergency", { method: "POST", body: JSON.stringify(body) }),

    // Notifications outbox (WhatsApp/SMS-style proactive updates)
    listNotifications: (to) =>
      request("/api/notifications" + (to ? "?to=" + encodeURIComponent(to) : "")),

    // ASHA-side help-request inbox (requests raised by beneficiaries)
    listHelpRequests: (status) =>
      request("/api/help-requests" + (status ? "?status=" + encodeURIComponent(status) : "")),
    updateHelpRequestStatus: (id, status) =>
      request(`/api/help-requests/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),

    // Multilingual catalogs
    i18nCatalog: (lang) => request(`/api/i18n/${lang}`),
    i18nLanguages: () => request("/api/i18n"),

    // Semantic search over saved records (local vector store)
    search: (q) => request("/api/search?q=" + encodeURIComponent(q)),

    // Grounded Q&A over a visit transcript (see backend/rag.py)
    askAboutTranscript: (transcript, question) =>
      request("/api/transcript/ask", { method: "POST", body: JSON.stringify({ transcript, question }) }),
    askAboutRecord: (recordId, question) =>
      request(`/api/records/${recordId}/ask`, { method: "POST", body: JSON.stringify({ question }) }),

    // AI visit summary + identified symptoms (see backend/visit_summary.py)
    summarizeTranscript: (transcript) =>
      request("/api/transcript/summarize", { method: "POST", body: JSON.stringify({ transcript }) }),
    summarizeRecord: (recordId) =>
      request(`/api/records/${recordId}/summarize`, { method: "POST" }),
  };

  // ── Beneficiary client — separate token/identity namespace from the ASHA
  // worker client above, so a shared workstation can have an ASHA session
  // and a beneficiary session without either logging the other out.
  const BEN_TOKEN_KEY = "sukanya_beneficiary_token";
  const BEN_KEY = "sukanya_beneficiary";

  function benGetToken() {
    return localStorage.getItem(BEN_TOKEN_KEY);
  }
  function benSetToken(token) {
    if (token) localStorage.setItem(BEN_TOKEN_KEY, token);
    else localStorage.removeItem(BEN_TOKEN_KEY);
  }
  function benGetBeneficiary() {
    try {
      return JSON.parse(localStorage.getItem(BEN_KEY) || "null");
    } catch (e) {
      return null;
    }
  }
  function benSetBeneficiary(b) {
    if (b) localStorage.setItem(BEN_KEY, JSON.stringify(b));
    else localStorage.removeItem(BEN_KEY);
  }
  function benIsLoggedIn() {
    return !!benGetToken();
  }
  function benLogout() {
    benSetToken(null);
    benSetBeneficiary(null);
  }

  async function benRequest(path, opts) {
    opts = opts || {};
    const headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    const token = benGetToken();
    if (token) headers["Authorization"] = "Bearer " + token;
    let res;
    try {
      res = await fetch(path, Object.assign({}, opts, { headers }));
    } catch (networkErr) {
      throw new Error("Could not reach the Sukanya backend. Is it running? (" + networkErr.message + ")");
    }
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const body = await res.json();
        detail = body.detail || JSON.stringify(body);
      } catch (e) {}
      if (res.status === 401) benLogout();
      const err = new Error(`${res.status} ${detail}`);
      err.status = res.status;
      throw err;
    }
    const ct = res.headers.get("content-type") || "";
    return ct.includes("application/json") ? res.json() : res.text();
  }

  const SukanyaBeneficiaryAPI = {
    getToken: benGetToken,
    isLoggedIn: benIsLoggedIn,
    logout: benLogout,
    getBeneficiary: benGetBeneficiary,

    requestPin: (mobile, name) =>
      benRequest("/api/beneficiary/auth/request-pin", { method: "POST", body: JSON.stringify({ mobile, name }) }),
    verifyPin: async (mobile, pin) => {
      const result = await benRequest("/api/beneficiary/auth/verify-pin", {
        method: "POST", body: JSON.stringify({ mobile, pin }),
      });
      benSetToken(result.token);
      benSetBeneficiary(result.beneficiary);
      return result;
    },
    me: () => benRequest("/api/beneficiary/me"),
    listVisits: () => benRequest("/api/beneficiary/visits"),
    listRecords: () => benRequest("/api/beneficiary/records"),
    createHelpRequest: (message, urgency) =>
      benRequest("/api/beneficiary/help-requests", { method: "POST", body: JSON.stringify({ message, urgency }) }),
  };

  global.SukanyaAPI = SukanyaAPI;
  global.SakhiAPI = SukanyaAPI;
  global.SukanyaBeneficiaryAPI = SukanyaBeneficiaryAPI;
})(window);
