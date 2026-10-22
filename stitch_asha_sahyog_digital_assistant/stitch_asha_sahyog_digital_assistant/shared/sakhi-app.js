/**
 * Per-page glue. Dispatches on `data-sakhi-page` set on <body> so every page
 * only needs one <script src="../shared/..."> include plus that one data
 * attribute — no inline per-page script blocks. All pages live one level
 * below the frontend root, so relative links between them are constant
 * regardless of which page is currently running this file.
 */
(function () {
  "use strict";

  const LINKS = {
    splash: "../splash_screen_updated/code.html",
    login: "../secure_login_smart_layout/code.html",
    register: "../worker_registration_smart_layout/code.html",
    home: "../home_layout/code.html",
    calendar: "../calendar_scheduler_smart_layout/code.html",
    formSmart: "../health_record_form_part_1/code.html",
    formExpanded: "../health_record_form_part_2/code.html",
    settings: "../settings_layout/code.html",
    beneficiaryLogin: "../beneficiary_login/code.html",
    beneficiaryHome: "../beneficiary_home/code.html",
  };

  const LANGUAGE_LABELS = { en: "English", hi: "Hindi", bn: "Bengali", ta: "Tamil", mr: "Marathi" };
  const LANGUAGE_CODES = Object.keys(LANGUAGE_LABELS);

  const PENDING_MOBILE_KEY = "sukanya_pending_mobile";

  /** Format any timestamp or time string into clean, valid 24-Hour format (HH:MM) */
  function format24HourTime(val) {
    if (!val) return "10:00";
    if (typeof val === "number") {
      return new Date(val * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
    }
    if (typeof val === "string") {
      let str = val.trim();
      
      // If time range like "09:30 - 10:15 AM"
      if (str.includes("-")) {
        const parts = str.split("-").map((p) => format24HourTime(p.trim()));
        return parts.join(" - ");
      }

      const m = str.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?/i);
      if (m) {
        let h = parseInt(m[1], 10);
        let min = parseInt(m[2], 10);
        const ampm = m[3] ? m[3].toUpperCase() : null;

        // Normalise any legacy corrupted hours
        if (h >= 24) {
          h = 8 + (h % 10);
        }

        if (ampm === "PM" && h < 12) h += 12;
        if (ampm === "AM" && h === 12) h = 0;

        h = Math.max(0, Math.min(23, h));
        min = Math.max(0, Math.min(59, min));

        return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
      }

      const mSimple = str.match(/(\d{1,2})\s*(AM|PM)/i);
      if (mSimple) {
        let h = parseInt(mSimple[1], 10);
        const ampm = mSimple[2].toUpperCase();
        if (ampm === "PM" && h < 12) h += 12;
        if (ampm === "AM" && h === 12) h = 0;
        h = Math.max(0, Math.min(23, h));
        return `${String(h).padStart(2, "0")}:00`;
      }

      const d = new Date(str);
      if (!isNaN(d.getTime()) && str.includes("T")) {
        return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
      }
      return str.replace(/\s*(AM|PM)/gi, "");
    }
    return "10:00";
  }

  /** Sort visits chronologically in ascending order (Date -> Time -> Timestamp) */
  function sortVisitsAscending(visits) {
    if (!Array.isArray(visits)) return [];
    return [...visits].sort((a, b) => {
      const dateA = a.scheduled_date || (a.scheduled_at ? new Date(a.scheduled_at * 1000).toISOString().split("T")[0] : "");
      const dateB = b.scheduled_date || (b.scheduled_at ? new Date(b.scheduled_at * 1000).toISOString().split("T")[0] : "");
      if (dateA && dateB && dateA !== dateB) {
        return dateA.localeCompare(dateB);
      }

      const timeA = format24HourTime(a.time_slot || a.scheduled_at);
      const timeB = format24HourTime(b.time_slot || b.scheduled_at);
      if (timeA && timeB && timeA !== timeB) {
        return timeA.localeCompare(timeB);
      }

      const tsA = typeof a.scheduled_at === "number" ? a.scheduled_at : (a.created_at || 0);
      const tsB = typeof b.scheduled_at === "number" ? b.scheduled_at : (b.created_at || 0);
      return tsA - tsB;
    });
  }

  // ── Splash ──
  function initSplash() {
    const status = document.getElementById("splash-status");
    const setStatus = (text) => {
      if (status) status.textContent = text;
    };

    const api = window.SukanyaAPI || window.SakhiAPI;
    const redirect = () => {
      window.location.href = (api && api.isLoggedIn()) ? LINKS.home : LINKS.login;
    };

    setStatus("Connecting to Sukanya backend...");
    const timeout = setTimeout(redirect, 4000); // never strand the user on splash
    (api ? api.health() : Promise.reject())
      .then((h) => {
        setStatus(h.mock ? "Ready (demo mode)" : "Ready");
      })
      .catch(() => {
        setStatus("Backend unreachable — continuing offline");
      })
      .finally(() => {
        clearTimeout(timeout);
        setTimeout(redirect, 600);
      });
  }

  // ── Login ──
  function initLogin() {
    const form = document.getElementById("login-form");
    const mobileInput = document.getElementById("mobile");
    const pinInput = document.getElementById("pin");
    const resendLink = document.getElementById("resend-pin-link");
    const demoBtn = document.getElementById("demo-login-btn");

    const pending = localStorage.getItem(PENDING_MOBILE_KEY);
    if (pending && mobileInput && !mobileInput.value) mobileInput.value = pending;
    else if (mobileInput && !mobileInput.value) mobileInput.value = "9876543210";

    async function performAutoLogin(mobile = "9876543210") {
      try {
        SakhiUI.showToast("Logging in as ASHA worker...", "info");
        const { dev_pin } = await SakhiAPI.requestPin(mobile);
        if (pinInput) pinInput.value = dev_pin;
        if (mobileInput) mobileInput.value = mobile;
        const { token, worker } = await SakhiAPI.verifyPin(mobile, dev_pin);
        SakhiAPI.setToken(token);
        SakhiAPI.setWorker(worker);
        localStorage.removeItem(PENDING_MOBILE_KEY);
        SakhiUI.showToast("Login successful! Redirecting to dashboard...", "success");
        setTimeout(() => {
          window.location.href = LINKS.home;
        }, 600);
      } catch (err) {
        SakhiUI.showToast(err.message || "Auto-login failed", "error");
      }
    }

    if (demoBtn) {
      demoBtn.addEventListener("click", (e) => {
        e.preventDefault();
        const mobile = (mobileInput.value || "9876543210").trim();
        performAutoLogin(mobile);
      });
    }

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("autologin") === "1" || urlParams.get("login") === "1") {
      performAutoLogin();
    }

    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const mobile = (mobileInput.value || "").trim();
        const pin = (pinInput.value || "").trim();
        if (!mobile || !pin) {
          SakhiUI.showToast("Enter mobile number and PIN", "error");
          return;
        }
        try {
          const { token, worker } = await SakhiAPI.verifyPin(mobile, pin);
          SakhiAPI.setToken(token);
          SakhiAPI.setWorker(worker);
          localStorage.removeItem(PENDING_MOBILE_KEY);
          window.location.href = LINKS.home;
        } catch (err) {
          SakhiUI.showToast(err.message || "Login failed", "error");
        }
      });
    }

    if (resendLink) {
      resendLink.addEventListener("click", async (e) => {
        e.preventDefault();
        const mobile = (mobileInput.value || "").trim();
        if (!mobile) {
          SakhiUI.showToast("Enter your mobile number first", "error");
          return;
        }
        try {
          const { dev_pin } = await SakhiAPI.requestPin(mobile);
          if (pinInput) pinInput.value = dev_pin;
          SakhiUI.showToast(`Demo mode — PIN is ${dev_pin} (auto-filled)`, "info");
        } catch (err) {
          SakhiUI.showToast(err.message || "Could not send PIN", "error");
        }
      });
    }

    const micBtn = document.querySelector('button[aria-label*="voice" i], .mic-btn');
    if (micBtn && mobileInput) {
      micBtn.addEventListener("click", () => {
        if (window.SukanyaForm && window.SukanyaForm.startFieldDictation) {
          window.SukanyaForm.startFieldDictation(mobileInput);
        }
      });
    }
  }

  // ── Worker registration ──
  function initRegister() {
    const form = document.getElementById("register-form");
    const mobileInput = document.getElementById("mobile_number");
    const loading = document.getElementById("loading");

    const micBtn = document.querySelector('button[aria-label*="voice" i], .mic-btn');
    if (micBtn && mobileInput) {
      micBtn.addEventListener("click", () => {
        if (window.SukanyaForm && window.SukanyaForm.startFieldDictation) {
          window.SukanyaForm.startFieldDictation(mobileInput);
        }
      });
    }

    if (!form) return;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const mobile = (mobileInput.value || "").trim();
      if (!mobile) {
        SakhiUI.showToast("Enter a mobile number", "error");
        return;
      }
      if (loading) loading.classList.remove("hidden");
      try {
        const { dev_pin } = await SakhiAPI.requestPin(mobile);
        localStorage.setItem(PENDING_MOBILE_KEY, mobile);
        SakhiUI.showToast(`Demo mode — no SMS gateway. Your PIN is ${dev_pin}`, "info");
        setTimeout(() => (window.location.href = LINKS.login), 1800);
      } catch (err) {
        SakhiUI.showToast(err.message || "Could not request PIN", "error");
        if (loading) loading.classList.add("hidden");
      }
    });
  }

  // ── Home Dashboard ──
  function alertCardHTML(a) {
    const isUrgent = a.severity === "urgent";
    const badgeClass = isUrgent ? "bg-red-100 text-error border border-red-200" : "bg-saffron-light text-saffron border border-saffron-border";
    const icon = isUrgent ? "emergency" : "warning";
    const time = format24HourTime(a.created_at);
    return `
      <div class="bg-surface-container-lowest border-l-4 ${isUrgent ? "border-l-error" : "border-l-saffron"} border border-outline-variant rounded-xl p-3.5 shadow-sm space-y-2 hover:shadow-md transition-shadow" data-alert-id="${a.id}">
        <div class="flex justify-between items-center">
          <span class="${badgeClass} font-extrabold text-[10px] px-2 py-0.5 rounded-md flex items-center gap-1 uppercase tracking-wider">
            <span class="material-symbols-outlined text-xs">${icon}</span> ${a.severity.toUpperCase()}
          </span>
          <span class="text-[11px] text-on-surface-variant font-medium">${time}</span>
        </div>
        <div>
          <p class="font-bold text-primary text-xs">${a.title}</p>
          <p class="text-[11px] text-on-surface-variant mt-0.5 leading-relaxed">${a.detail}</p>
        </div>
        <div class="flex items-center justify-between pt-1 border-t border-outline-variant/60">
          <a href="../health_record_form_part_1/code.html" class="text-[11px] font-bold text-primary hover:underline flex items-center gap-0.5">
            <span>View Record</span>
            <span class="material-symbols-outlined text-xs">arrow_forward</span>
          </a>
          <button type="button" class="btn-resolve-alert text-[11px] font-bold text-secondary hover:underline px-2 py-1 rounded hover:bg-accent-green" data-alert-id="${a.id}">
            ✓ Mark Resolved
          </button>
        </div>
      </div>`;
  }

  async function refreshAlerts() {
    const list = document.getElementById("alerts-list");
    const countBadge = document.getElementById("alerts-count-badge");
    const kpiHighRisk = document.getElementById("kpi-high-risk");
    if (!list) return;
    try {
      const alerts = await SakhiAPI.listAlerts("open");
      if (countBadge) countBadge.textContent = `${alerts.length} Open`;
      if (kpiHighRisk) kpiHighRisk.textContent = String(alerts.length);
      
      if (alerts.length === 0) {
        list.innerHTML = `
          <div class="p-6 text-center text-xs text-secondary font-semibold bg-accent-green rounded-xl border border-emerald-200 flex flex-col items-center gap-1">
            <span class="material-symbols-outlined text-2xl text-emerald-600">check_circle</span>
            <span>All Clear! No active high-risk alerts.</span>
          </div>`;
      } else {
        list.innerHTML = alerts.map(alertCardHTML).join("");
        list.querySelectorAll(".btn-resolve-alert").forEach((btn) => {
          btn.addEventListener("click", async () => {
            await SakhiAPI.updateAlertStatus(btn.getAttribute("data-alert-id"), "resolved");
            refreshAlerts();
          });
        });
      }
    } catch (err) {
      list.innerHTML = `<div class="p-4 text-center text-xs text-on-surface-variant">Could not load alerts.</div>`;
    }
  }

  function homeVisitCardHTML(v) {
    const isPriority = v.priority === "priority" || v.priority === "urgent" || v.priority === "high";
    const time = format24HourTime(v.time_slot || v.scheduled_at);
    const typeLabel = (v.visit_type || "anc_visit").replace(/_/g, " ").toUpperCase();
    const isDone = v.status === "completed";

    return `
      <div class="bg-surface-container-lowest border-l-4 ${isPriority ? "border-l-error border-error/30" : "border-l-secondary border-outline-variant"} border-y border-r rounded-2xl p-4 shadow-sm hover:shadow-md transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3.5" data-visit-id="${v.id}" data-type="${v.visit_type || ''}" data-priority="${isPriority ? 'priority' : 'routine'}">
        <div class="flex items-start gap-3">
          <div class="w-10 h-10 rounded-xl ${isPriority ? "bg-red-50 text-error border border-red-200" : "bg-emerald-50 text-secondary"} flex items-center justify-center font-bold text-sm shrink-0">
            <span class="material-symbols-outlined text-xl">${v.visit_type === "child_health" ? "child_care" : "pregnant_woman"}</span>
          </div>
          <div>
            <div class="flex items-center gap-2 flex-wrap">
              <h4 class="font-extrabold text-primary text-sm">${v.patient_name || "Beneficiary"}</h4>
              <button type="button" class="btn-home-toggle-priority font-extrabold text-[10px] px-2 py-0.5 rounded-md uppercase tracking-wider flex items-center gap-1 cursor-pointer transition-all active:scale-95 ${isPriority ? 'bg-red-100 text-error border border-red-200 hover:bg-red-200' : 'bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100'}" data-visit-id="${v.id}" data-current-priority="${isPriority ? 'priority' : 'routine'}" title="Click to toggle Priority">
                <span>${isPriority ? '🚨 Urgent' : '📋 Routine'}</span>
              </button>
              <span class="text-xs font-semibold text-on-surface-variant bg-surface-container-low px-2 py-0.5 rounded-md">⏰ ${time}</span>
            </div>
            <p class="text-xs text-on-surface-variant mt-0.5">${typeLabel} • ${v.notes || "Standard maternal/child clinical checkup"}</p>
          </div>
        </div>

        <div class="flex items-center gap-2 shrink-0 self-end sm:self-center">
          <button type="button" class="btn-visit-voice h-9 px-3 bg-secondary hover:bg-secondary-dark text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-sm active:scale-95 transition-transform" data-visit-id="${v.id}" data-patient="${v.patient_name || ''}" data-type="${v.visit_type || 'anc_visit'}">
            <span class="material-symbols-outlined text-base">mic</span>
            <span>Checkup</span>
          </button>
          <a href="../smart_health_record_form/code.html?visit_id=${v.id}&patient_name=${encodeURIComponent(v.patient_name || '')}&visit_type=${v.visit_type || 'anc_visit'}" class="h-9 px-3 bg-surface-container-low hover:bg-surface-container-highest text-primary text-xs font-bold rounded-xl border border-outline-variant flex items-center gap-1 transition-colors">
            <span class="material-symbols-outlined text-base">edit_note</span>
            <span class="hidden sm:inline">Form</span>
          </a>
          ${v.patient_mobile ? `
            <a href="tel:${v.patient_mobile}" class="w-9 h-9 bg-accent-green text-secondary hover:bg-emerald-200 rounded-xl flex items-center justify-center transition-colors" title="Call Beneficiary">
              <span class="material-symbols-outlined text-base">call</span>
            </a>` : ""}
          <button type="button" class="btn-home-delete-visit w-9 h-9 text-on-surface-variant hover:text-error hover:bg-red-50 rounded-xl flex items-center justify-center transition-colors" data-visit-id="${v.id}" title="Delete Visit">
            <span class="material-symbols-outlined text-base">delete</span>
          </button>
        </div>
      </div>`;
  }

  let currentHomeFilter = "all";

  async function loadHomeVisits() {
    const listEl = document.getElementById("home-visits-list");
    const kpiToday = document.getElementById("kpi-today-visits");
    if (!listEl) return;

    try {
      let rawVisits = await SakhiAPI.listVisits({ status: "pending" });
      
      // If visits are completely empty on first launch, auto-seed demo visits
      if (!rawVisits || rawVisits.length === 0) {
        try {
          await SakhiAPI.seedDemoVisits();
          rawVisits = await SakhiAPI.listVisits({ status: "pending" });
          refreshAlerts();
        } catch (_) {}
      }

      const visits = sortVisitsAscending(rawVisits || []);
      if (kpiToday) kpiToday.textContent = String(visits.length || 0);

      if (!visits || visits.length === 0) {
        listEl.innerHTML = `
          <div class="p-8 text-center text-on-surface-variant text-sm bg-surface-container-low rounded-2xl border border-dashed border-outline flex flex-col items-center justify-center gap-3">
            <span class="material-symbols-outlined text-4xl text-primary/70">event_available</span>
            <div>
              <p class="font-extrabold text-primary text-base">No pending visits for today</p>
              <p class="text-xs text-on-surface-variant mt-0.5">Use the AI Schedule Assistant or populate your catchment roster.</p>
            </div>
            <div class="flex items-center gap-2 flex-wrap justify-center pt-1">
              <button type="button" id="btn-home-seed-roster" class="px-4 py-2 bg-secondary hover:bg-secondary-dark text-white rounded-xl font-bold text-xs flex items-center gap-1.5 shadow-sm active:scale-95 transition-transform cursor-pointer">
                <span class="material-symbols-outlined text-base">auto_awesome</span>
                <span>Load Catchment Schedule</span>
              </button>
              <a href="../calendar_scheduler_smart_layout/code.html" class="px-3.5 py-2 bg-surface-container-highest text-primary hover:bg-outline/20 rounded-xl font-bold text-xs flex items-center gap-1 transition-colors">
                <span>Schedule Planner</span>
                <span class="material-symbols-outlined text-sm">arrow_forward</span>
              </a>
            </div>
          </div>`;

        const seedBtn = document.getElementById("btn-home-seed-roster");
        if (seedBtn) {
          seedBtn.addEventListener("click", async () => {
            try {
              seedBtn.disabled = true;
              seedBtn.innerHTML = `<span class="material-symbols-outlined text-base animate-spin">progress_activity</span> Loading...`;
              await SakhiAPI.seedDemoVisits();
              SakhiUI.showToast("Catchment schedule loaded successfully!", "success");
              await loadHomeVisits();
              await refreshAlerts();
            } catch (err) {
              seedBtn.disabled = false;
              seedBtn.innerHTML = `<span class="material-symbols-outlined text-base">auto_awesome</span> Load Catchment Schedule`;
              SakhiUI.showToast(err.message || "Could not load schedule", "error");
            }
          });
        }
        return;
      }

      listEl.innerHTML = visits.map(homeVisitCardHTML).join("") + `
        <div id="home-filter-empty" class="hidden p-6 text-center text-xs text-on-surface-variant bg-surface-container-low rounded-xl border border-outline/30 flex-col items-center justify-center gap-1.5">
          <p class="font-bold text-primary text-sm">No matching visits</p>
          <p class="text-xs">No active visits found for the selected filter category.</p>
          <button type="button" class="mt-1.5 px-3 py-1 bg-surface-container-highest text-secondary font-bold rounded-lg hover:bg-outline/20 transition-colors text-xs" id="btn-reset-home-filter">
            View All Visits
          </button>
        </div>
      `;

      // Bind Voice Checkup buttons on visit cards
      listEl.querySelectorAll(".btn-visit-voice").forEach((btn) => {
        btn.addEventListener("click", () => {
          const patient = btn.getAttribute("data-patient");
          const vType = btn.getAttribute("data-type");
          const vId = btn.getAttribute("data-visit-id");
          if (window.SukanyaForm && window.SukanyaForm.openVoiceStudioModal) {
            window.SukanyaForm.openVoiceStudioModal({
              visitType: vType,
              getMetadata: () => ({ patient_name: patient, visit_type: vType, visit_id: vId }),
              onResult: (res) => {
                window.__sakhiLastResult = res;
                window.location.href = `../smart_health_record_form/code.html?visit_id=${vId}&patient_name=${encodeURIComponent(patient)}`;
              }
            });
          }
        });
      });

      // Bind Priority Toggle buttons on home visit cards
      listEl.querySelectorAll(".btn-home-toggle-priority").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const vId = btn.getAttribute("data-visit-id");
          const curP = btn.getAttribute("data-current-priority");
          const nextP = (curP === "priority" || curP === "urgent" || curP === "high") ? "routine" : "priority";
          try {
            btn.disabled = true;
            await SakhiAPI.updateVisitPriority(vId, nextP);
            SakhiUI.showToast(`Visit priority changed to ${nextP === "priority" ? "🚨 High Priority" : "📋 Routine"}`, "success");
            await loadHomeVisits();
          } catch (err) {
            btn.disabled = false;
            SakhiUI.showToast(err.message || "Could not update priority", "error");
          }
        });
      });

      // Bind Delete buttons on home visit cards
      listEl.querySelectorAll(".btn-home-delete-visit").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const vId = btn.getAttribute("data-visit-id");
          if (confirm("Delete this scheduled visit?")) {
            try {
              btn.disabled = true;
              btn.style.opacity = "0.5";
              await SakhiAPI.deleteVisit(vId);
              SakhiUI.showToast("Visit deleted successfully", "info");
              await loadHomeVisits();
            } catch (err) {
              btn.disabled = false;
              btn.style.opacity = "1";
              SakhiUI.showToast(err.message || "Error deleting visit", "error");
            }
          }
        });
      });

      function applyFilter(filter) {
        currentHomeFilter = filter;
        let visibleCount = 0;
        listEl.querySelectorAll("[data-visit-id]").forEach((card) => {
          const vType = card.getAttribute("data-type") || "";
          const vPri = card.getAttribute("data-priority") || "";
          let show = true;
          if (filter === "priority") show = (vPri === "priority" || vPri === "urgent" || vPri === "high");
          else if (filter === "anc") show = vType.includes("anc") || vType.includes("maternal");
          else if (filter === "child") show = vType.includes("child") || vType.includes("immunization");
          card.classList.toggle("hidden", !show);
          if (show) visibleCount++;
        });

        const filterEmptyEl = document.getElementById("home-filter-empty");
        if (filterEmptyEl) {
          if (visibleCount === 0) {
            filterEmptyEl.classList.remove("hidden");
            filterEmptyEl.classList.add("flex");
          } else {
            filterEmptyEl.classList.add("hidden");
            filterEmptyEl.classList.remove("flex");
          }
        }
      }

      // Filter button handlers
      document.querySelectorAll(".visit-filter-btn").forEach((fBtn) => {
        fBtn.onclick = () => {
          document.querySelectorAll(".visit-filter-btn").forEach(b => {
            b.classList.remove("active", "bg-primary", "text-white");
            b.classList.add("bg-surface-container-low", "text-on-surface-variant");
          });
          fBtn.classList.add("active", "bg-primary", "text-white");
          fBtn.classList.remove("bg-surface-container-low", "text-on-surface-variant");

          const filter = fBtn.getAttribute("data-filter");
          applyFilter(filter);
        };
      });

      const resetFilterBtn = document.getElementById("btn-reset-home-filter");
      if (resetFilterBtn) {
        resetFilterBtn.onclick = () => {
          const allBtn = document.querySelector(".visit-filter-btn[data-filter='all']");
          if (allBtn) allBtn.click();
        };
      }

      // Re-apply existing filter if any
      if (currentHomeFilter && currentHomeFilter !== "all") {
        applyFilter(currentHomeFilter);
      }

    } catch (err) {
      listEl.innerHTML = `<div class="p-4 text-center text-xs text-error">Failed to load visits: ${err.message}</div>`;
    }
  }

  function initEmergencyButton() {
    const buttons = [
      document.getElementById("btn-emergency"),
      document.getElementById("btn-emergency-mobile"),
      ...document.querySelectorAll(".btn-trigger-emergency")
    ];
    buttons.forEach((btn) => {
      if (!btn) return;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        if (SakhiUI.openEmergencyHubModal) {
          SakhiUI.openEmergencyHubModal();
        }
      });
    });
  }

  async function initHome() {
    if (!SakhiUI.requireAuthOrRedirect(LINKS.login)) return;
    
    // Live date string
    const dateEl = document.getElementById("dashboard-live-date");
    if (dateEl) {
      const now = new Date();
      dateEl.textContent = now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    }

    // Bind Quick Voice Studio triggers on Home Page
    const voiceButtons = [
      document.getElementById("btn-hero-voice-studio"),
      document.getElementById("btn-home-start-mic"),
      document.getElementById("btn-quick-voice-mobile")
    ];
    voiceButtons.forEach((btn) => {
      if (!btn) return;
      btn.addEventListener("click", () => {
        if (window.SukanyaForm && window.SukanyaForm.openVoiceStudioModal) {
          window.SukanyaForm.openVoiceStudioModal({
            visitType: "auto",
            getMetadata: () => ({ visit_type: "anc_visit" }),
            onResult: (res) => {
              window.__sakhiLastResult = res;
              try { sessionStorage.setItem("sukanya_last_extract", JSON.stringify(res)); } catch (_) {}
              window.location.href = "../smart_health_record_form/code.html";
            }
          });
        } else {
          window.location.href = "../smart_health_record_form/code.html";
        }
      });
    });

    // Fetch Summary KPI metrics
    try {
      const s = await SakhiAPI.summary();
      const kpiToday = document.getElementById("kpi-today-visits");
      const kpiHighRisk = document.getElementById("kpi-high-risk");
      const kpiImm = document.getElementById("kpi-immunization");
      const kpiRecords = document.getElementById("kpi-total-records");
      const welcomeH = document.getElementById("worker-welcome-heading");
      const sidebarName = document.getElementById("worker-sidebar-name");

      if (kpiToday) kpiToday.textContent = String(s.today_visits ?? s.pending_visits ?? 4);
      if (kpiHighRisk) kpiHighRisk.textContent = String(s.open_alerts ?? s.high_priority_visits ?? 2);
      if (kpiImm) kpiImm.textContent = String(s.immunizations_due ?? 3);
      if (kpiRecords) kpiRecords.textContent = String(s.total_records ?? 12);
      if (welcomeH && s.worker && s.worker.name) welcomeH.textContent = `Welcome, ${s.worker.name}`;
      if (sidebarName && s.worker && s.worker.name) sidebarName.textContent = `${s.worker.name} (ASHA)`;
    } catch (err) {
      console.warn("Could not load summary metrics, populating local state:", err);
      const kpiToday = document.getElementById("kpi-today-visits");
      const kpiHighRisk = document.getElementById("kpi-high-risk");
      const kpiImm = document.getElementById("kpi-immunization");
      const kpiRecords = document.getElementById("kpi-total-records");
      if (kpiToday && (kpiToday.textContent === "--" || !kpiToday.textContent)) kpiToday.textContent = "4";
      if (kpiHighRisk && (kpiHighRisk.textContent === "--" || !kpiHighRisk.textContent)) kpiHighRisk.textContent = "2";
      if (kpiImm && (kpiImm.textContent === "--" || !kpiImm.textContent)) kpiImm.textContent = "3";
      if (kpiRecords && (kpiRecords.textContent === "--" || !kpiRecords.textContent)) kpiRecords.textContent = "12";
    }

    loadHomeVisits();
    refreshAlerts();
  }

  // ── Calendar / AI Scheduler (Gemma 4 12B) ──
  function openVisitDetailsModal(v, onUpdate) {
    const isPriority = v.priority === "priority" || v.priority === "urgent" || v.priority === "high";
    const time = format24HourTime(v.time_slot || v.scheduled_at);
    const isDone = v.status === "completed";
    const typeLabel = (v.visit_type || "anc_visit").replace(/_/g, " ").toUpperCase();

    const prior = document.getElementById("visit-details-modal-overlay");
    if (prior) prior.remove();

    const overlay = SakhiUI.el("div", "fixed inset-0 bg-black/60 backdrop-blur-xs z-[120] flex items-center justify-center p-4");
    overlay.id = "visit-details-modal-overlay";

    overlay.innerHTML = `
      <div class="bg-surface-container-lowest border border-outline rounded-3xl p-6 max-w-lg w-full shadow-2xl space-y-5" role="dialog">
        <!-- Header -->
        <div class="flex items-start justify-between border-b border-outline-variant pb-3">
          <div class="flex items-center gap-3">
            <div class="w-12 h-12 rounded-2xl ${isPriority ? "bg-red-50 text-error" : "bg-emerald-50 text-secondary"} flex items-center justify-center font-bold text-lg">
              <span class="material-symbols-outlined text-2xl">${v.visit_type === "child_health" ? "child_care" : "pregnant_woman"}</span>
            </div>
            <div>
              <div class="flex items-center gap-2 flex-wrap">
                <h3 class="text-lg font-extrabold text-primary">${v.patient_name || "Beneficiary Visit"}</h3>
                <button type="button" id="btn-modal-toggle-priority" class="font-extrabold text-[10px] px-2.5 py-1 rounded-lg uppercase tracking-wider flex items-center gap-1 cursor-pointer transition-all active:scale-95 ${isPriority ? 'bg-red-100 text-error border border-red-200 hover:bg-red-200' : 'bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100'}" title="Click to toggle priority">
                  <span class="material-symbols-outlined text-xs">${isPriority ? 'emergency' : 'flag'}</span>
                  <span>${isPriority ? '🚨 High Priority' : '📋 Routine'}</span>
                  <span class="text-[9px] opacity-75 underline ml-0.5">Switch</span>
                </button>
                ${isDone ? `<span class="bg-emerald-100 text-emerald-800 text-[10px] font-extrabold px-2 py-0.5 rounded-md uppercase">✓ Done</span>` : ""}
              </div>
              <p class="text-xs text-on-surface-variant mt-0.5">${typeLabel} • ${v.scheduled_date || "Today"} (${time})</p>
            </div>
          </div>
          <button type="button" class="btn-close-modal w-8 h-8 rounded-full bg-surface-container hover:bg-surface-container-high text-on-surface-variant flex items-center justify-center">
            <span class="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        <!-- Details Grid -->
        <div class="space-y-3 text-xs">
          <div class="grid grid-cols-2 gap-2 bg-surface-container-low p-3.5 rounded-2xl">
            <div>
              <p class="text-[10px] font-bold text-on-surface-variant uppercase">Beneficiary</p>
              <p class="font-bold text-on-surface text-sm mt-0.5">${v.patient_name || "N/A"}</p>
            </div>
            <div>
              <p class="text-[10px] font-bold text-on-surface-variant uppercase">Contact</p>
              <div class="flex items-center gap-2 mt-0.5">
                <span class="font-bold text-on-surface">${v.patient_mobile ? `+91 ${v.patient_mobile}` : "No phone"}</span>
                ${v.patient_mobile ? `<a href="tel:${v.patient_mobile}" class="text-secondary font-bold hover:underline flex items-center gap-0.5"><span class="material-symbols-outlined text-sm">call</span> Call</a>` : ""}
              </div>
            </div>
          </div>

          <div class="bg-surface-container-low p-3.5 rounded-2xl space-y-1">
            <p class="text-[10px] font-bold text-on-surface-variant uppercase">Clinical Prep Notes &amp; Guidance</p>
            <p class="text-on-surface text-xs leading-relaxed">${v.notes || (isPriority ? "Priority Case: Check blood pressure, temperature, fetal movements, and maternal danger signs." : "Routine home health visit. Check vitals and counsel on nutrition and IFA supplements.")}</p>
          </div>

          <!-- AI Next Visit Date Recommendation & Follow-up Manager -->
          <div class="bg-gradient-to-br from-primary-container/10 via-surface-container-low to-secondary-container/15 border border-primary/20 p-3.5 rounded-2xl space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-[11px] font-extrabold text-primary flex items-center gap-1.5">
                <span class="material-symbols-outlined text-secondary text-base">auto_awesome</span>
                AI Next Visit Date Manager
              </span>
              <button type="button" id="btn-modal-ai-suggest-next" class="text-[11px] font-bold text-secondary hover:underline flex items-center gap-0.5">
                <span class="material-symbols-outlined text-sm">psychology</span> Predict Follow-up
              </button>
            </div>
            <div id="ai-next-visit-box" class="text-xs text-on-surface-variant space-y-2">
              <p class="text-[11px]">Model automatically calculates next visit date according to vitals, danger signs &amp; NHM trimester guidelines.</p>
            </div>
          </div>
        </div>

        <!-- Modal Actions -->
        <div class="flex flex-col gap-2 pt-2 border-t border-outline-variant">
          <div class="grid grid-cols-2 gap-2">
            <button type="button" id="btn-modal-voice-visit" class="h-11 bg-secondary hover:bg-secondary-dark text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-sm active:scale-95 transition-transform">
              <span class="material-symbols-outlined text-lg">mic</span>
              <span>Start Voice Visit</span>
            </button>
            <a href="../smart_health_record_form/code.html?visit_id=${v.id}&patient_name=${encodeURIComponent(v.patient_name || '')}&visit_type=${v.visit_type || 'anc_visit'}" class="h-11 bg-surface-container hover:bg-surface-container-high text-primary font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 border border-outline-variant transition-colors">
              <span class="material-symbols-outlined text-lg">edit_note</span>
              <span>Open Smart Form</span>
            </a>
          </div>

          <div class="flex items-center justify-between gap-2 mt-1">
            ${!isDone ? `
              <button type="button" id="btn-modal-complete-visit" class="text-xs font-bold text-secondary hover:bg-emerald-50 px-3 py-2 rounded-xl flex items-center gap-1">
                <span class="material-symbols-outlined text-base">check_circle</span>
                <span>Mark Completed</span>
              </button>` : `<div></div>`
            }
            <button type="button" id="btn-modal-delete-visit" class="text-xs font-bold text-error hover:bg-red-50 px-3 py-2 rounded-xl flex items-center gap-1">
              <span class="material-symbols-outlined text-base">delete</span>
              <span>Cancel Visit</span>
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const closeModal = () => overlay.remove();
    overlay.querySelector(".btn-close-modal").addEventListener("click", closeModal);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });

    // AI Next Visit Date Suggestion handler
    const suggestBtn = overlay.querySelector("#btn-modal-ai-suggest-next");
    const nextVisitBox = overlay.querySelector("#ai-next-visit-box");
    
    const triggerNextVisitPrediction = async () => {
      if (!nextVisitBox) return;
      nextVisitBox.innerHTML = `
        <div class="flex items-center gap-2 py-2 text-xs text-primary font-semibold">
          <span class="material-symbols-outlined text-sm animate-spin">sync</span>
          <span>Gemma 4 12B analyzing clinical data &amp; calculating next visit date…</span>
        </div>`;
      try {
        const res = await SakhiAPI.suggestNextVisit({
          patient_name: v.patient_name || "Beneficiary",
          visit_type: v.visit_type || "anc_visit",
          form_data: { notes: v.notes },
        });
        if (res && res.recommended_date) {
          const isHigh = res.priority === "priority";
          nextVisitBox.innerHTML = `
            <div class="bg-surface-container-lowest p-3 rounded-xl border border-outline-variant space-y-2 animate-fade-in">
              <div class="flex items-center justify-between flex-wrap gap-1">
                <span class="font-extrabold text-primary text-xs flex items-center gap-1">
                  📅 Recommended Date: <span class="text-secondary underline">${res.recommended_date}</span> (${format24HourTime(res.recommended_time || "10:00")})
                </span>
                <span class="text-[10px] font-bold px-2 py-0.5 rounded-md ${isHigh ? 'bg-red-100 text-error' : 'bg-emerald-100 text-secondary'}">
                  ${isHigh ? '🚨 High Priority' : 'Routine'}
                </span>
              </div>
              <p class="text-[11px] text-on-surface leading-tight"><strong>Rationale:</strong> ${res.reason || "Clinical follow-up indicated."}</p>
              ${res.suggested_actions && res.suggested_actions.length ? `
                <p class="text-[10px] text-on-surface-variant"><strong>Checklist:</strong> ${res.suggested_actions.join(", ")}</p>
              ` : ''}
              <button type="button" id="btn-confirm-auto-schedule" class="w-full mt-1 bg-primary hover:bg-primary-container text-on-primary font-bold text-xs py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 shadow-sm active:scale-95 transition-all">
                <span class="material-symbols-outlined text-sm">event_available</span>
                <span>Confirm &amp; Add Follow-up Visit to Calendar</span>
              </button>
            </div>
          `;

          const confirmBtn = nextVisitBox.querySelector("#btn-confirm-auto-schedule");
          if (confirmBtn) {
            confirmBtn.addEventListener("click", async () => {
              try {
                confirmBtn.disabled = true;
                confirmBtn.innerHTML = `<span class="material-symbols-outlined text-sm animate-spin">refresh</span> Scheduling...`;
                await SakhiAPI.createVisit({
                  patient_name: v.patient_name,
                  patient_mobile: v.patient_mobile,
                  visit_type: v.visit_type || "anc_visit",
                  scheduled_date: res.recommended_date,
                  time_slot: format24HourTime(res.recommended_time || "10:00"),
                  priority: res.priority || "routine",
                  notes: `AI Follow-up: ${res.reason || "Scheduled follow-up"}`,
                  status: "scheduled",
                });
                SakhiUI.showToast(`Follow-up visit scheduled for ${res.recommended_date}!`, "success");
                closeModal();
                if (onUpdate) await onUpdate();
              } catch (err) {
                SakhiUI.showToast(err.message || "Could not schedule visit", "error");
                confirmBtn.disabled = false;
                confirmBtn.innerHTML = `Confirm &amp; Add Follow-up Visit to Calendar`;
              }
            });
          }
        }
      } catch (err) {
        nextVisitBox.innerHTML = `<p class="text-xs text-error">Could not calculate next date: ${err.message}</p>`;
      }
    };

    if (suggestBtn) {
      suggestBtn.addEventListener("click", triggerNextVisitPrediction);
    }
    // Auto-predict on modal open
    setTimeout(triggerNextVisitPrediction, 100);

    // Priority Switcher toggle button inside Modal
    const togglePriorityBtn = overlay.querySelector("#btn-modal-toggle-priority");
    if (togglePriorityBtn) {
      togglePriorityBtn.addEventListener("click", async () => {
        const nextPriority = isPriority ? "routine" : "priority";
        try {
          togglePriorityBtn.disabled = true;
          togglePriorityBtn.innerHTML = `<span class="material-symbols-outlined text-xs animate-spin">sync</span> Updating...`;
          await SakhiAPI.updateVisitPriority(v.id, nextPriority);
          SakhiUI.showToast(`Visit priority changed to ${nextPriority === "priority" ? "🚨 High Priority" : "📋 Routine"}!`, "success");
          closeModal();
          if (onUpdate) await onUpdate();
        } catch (err) {
          SakhiUI.showToast(err.message || "Could not update priority", "error");
          togglePriorityBtn.disabled = false;
        }
      });
    }

    // Voice studio in-place on calendar page
    overlay.querySelector("#btn-modal-voice-visit").addEventListener("click", () => {
      closeModal();
      if (window.SukanyaForm && window.SukanyaForm.openVoiceStudioModal) {
        window.SukanyaForm.openVoiceStudioModal({
          visitType: v.visit_type || "anc_visit",
          getMetadata: () => ({ patient_name: v.patient_name, visit_type: v.visit_type || "anc_visit", visit_id: v.id }),
          onResult: async (res) => {
            SakhiUI.showToast("Voice visit completed & clinical data extracted!", "success");
            try {
              await SakhiAPI.updateVisitStatus(v.id, "completed");
            } catch (_) {}
            if (onUpdate) await onUpdate();
          }
        });
      } else {
        window.location.href = `../smart_health_record_form/code.html?visit_id=${v.id}&patient_name=${encodeURIComponent(v.patient_name || '')}&visit_type=${v.visit_type || 'anc_visit'}`;
      }
    });

    const completeBtn = overlay.querySelector("#btn-modal-complete-visit");
    if (completeBtn) {
      completeBtn.addEventListener("click", async () => {
        try {
          await SakhiAPI.updateVisitStatus(v.id, "completed");
          SakhiUI.showToast("Visit marked as completed", "success");
          closeModal();
          if (onUpdate) await onUpdate();
        } catch (e) {
          SakhiUI.showToast(e.message || "Error updating visit", "error");
        }
      });
    }

    const deleteBtn = overlay.querySelector("#btn-modal-delete-visit");
    if (deleteBtn) {
      deleteBtn.addEventListener("click", async () => {
        const vid = v.id || v._id;
        if (confirm("Cancel and delete this scheduled visit?")) {
          try {
            deleteBtn.disabled = true;
            deleteBtn.innerHTML = `<span class="material-symbols-outlined text-sm animate-spin">refresh</span> Deleting...`;
            await SakhiAPI.deleteVisit(vid);
            SakhiUI.showToast("Visit deleted successfully", "info");
            closeModal();
            if (onUpdate) await onUpdate();
          } catch (e) {
            deleteBtn.disabled = false;
            deleteBtn.innerHTML = `<span class="material-symbols-outlined text-base">delete</span><span>Cancel Visit</span>`;
            SakhiUI.showToast(e.message || "Error deleting visit", "error");
          }
        }
      });
    }
  }

  function openRoutePlanModal(plan) {
    const prior = document.getElementById("route-plan-modal-overlay");
    if (prior) prior.remove();

    const overlay = SakhiUI.el("div", "fixed inset-0 bg-black/65 backdrop-blur-xs z-[125] flex items-center justify-center p-4");
    overlay.id = "route-plan-modal-overlay";

    const sched = plan.allocated_schedule || [];
    const checklist = plan.kit_checklist || [];

    const stopsHtml = sched.map((s, idx) => {
      const isP = s.priority === "priority" || s.priority === "high" || s.priority === "urgent";
      const time = format24HourTime(s.time_slot);
      return `
        <div class="flex items-start gap-3 p-3 bg-surface-container-low rounded-xl border ${isP ? 'border-red-200 bg-red-50/40' : 'border-outline-variant'}">
          <div class="w-7 h-7 rounded-lg ${isP ? 'bg-error text-white' : 'bg-primary text-white'} flex items-center justify-center font-bold text-xs shrink-0 mt-0.5 shadow-xs">
            ${idx + 1}
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <h5 class="font-extrabold text-sm text-primary">${s.patient_name}</h5>
              <div class="flex items-center gap-1.5">
                <span class="text-xs font-bold bg-white text-primary px-2 py-0.5 rounded border border-outline-variant">⏰ ${time}</span>
                ${isP ? `<span class="bg-red-100 text-error border border-red-200 text-[10px] font-extrabold px-1.5 py-0.5 rounded uppercase">🚨 High Priority</span>` : '<span class="bg-blue-50 text-blue-700 text-[10px] font-bold px-1.5 py-0.5 rounded uppercase">📋 Routine</span>'}
              </div>
            </div>
            <p class="text-xs text-on-surface-variant mt-0.5">${(s.visit_type || 'anc_visit').replace(/_/g, ' ').toUpperCase()}</p>
            ${s.clinical_prep ? `<p class="text-[11px] ${isP ? 'text-error font-semibold' : 'text-on-surface-variant'} mt-1 flex items-start gap-1"><span class="material-symbols-outlined text-xs mt-0.5 ${isP ? 'text-error' : 'text-secondary'}">${isP ? 'warning' : 'backpack'}</span> <span>${s.clinical_prep}</span></p>` : ''}
          </div>
        </div>
      `;
    }).join("");

    const checklistHtml = checklist.map((item) => `
      <li class="flex items-center gap-1.5 text-xs text-primary font-medium">
        <span class="material-symbols-outlined text-sm text-secondary">check_circle</span>
        <span>${item}</span>
      </li>
    `).join("");

    overlay.innerHTML = `
      <div class="bg-surface-container-lowest border border-outline rounded-3xl p-6 max-w-lg w-full shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto" role="dialog">
        <!-- Modal Header -->
        <div class="flex items-start justify-between border-b border-outline-variant pb-3">
          <div class="flex items-center gap-3">
            <div class="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary to-secondary text-white flex items-center justify-center font-bold text-lg shadow-sm">
              <span class="material-symbols-outlined text-2xl">route</span>
            </div>
            <div>
              <h3 class="text-lg font-extrabold text-primary flex items-center gap-1.5">
                <span>AI Optimised Route Plan</span>
                <span class="text-[10px] bg-primary/10 text-primary font-bold px-2 py-0.5 rounded-full">Gemma 4 12B</span>
              </h3>
              <p class="text-xs text-on-surface-variant">${sched.length} Sequential Stops • ${plan.estimated_field_hours || 2.5} hrs field duration</p>
            </div>
          </div>
          <button type="button" class="btn-close-route-modal w-8 h-8 rounded-full bg-surface-container hover:bg-surface-container-high text-on-surface-variant flex items-center justify-center">
            <span class="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        <!-- Route Summary Banner -->
        <div class="bg-gradient-to-r from-emerald-50 to-blue-50 border border-emerald-200/80 p-3.5 rounded-2xl">
          <p class="text-xs font-semibold text-emerald-950 leading-relaxed">${plan.summary}</p>
        </div>

        <!-- Sequential Stops Timeline -->
        <div class="space-y-2">
          <h4 class="text-xs font-bold text-primary uppercase tracking-wider flex items-center gap-1">
            <span class="material-symbols-outlined text-sm text-secondary">timeline</span>
            <span>Optimized Sequence of Visits</span>
          </h4>
          <div class="space-y-2 max-h-[220px] overflow-y-auto pr-1">
            ${stopsHtml || '<p class="text-xs text-on-surface-variant">No visits scheduled for this date.</p>'}
          </div>
        </div>

        <!-- Equipment & Kit Checklist -->
        ${checklist.length ? `
          <div class="bg-surface-container-low p-3.5 rounded-2xl space-y-2 border border-outline-variant">
            <h4 class="text-xs font-bold text-primary uppercase tracking-wider flex items-center gap-1">
              <span class="material-symbols-outlined text-sm text-secondary">medical_services</span>
              <span>Recommended Equipment &amp; Medicine Kit</span>
            </h4>
            <ul class="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              ${checklistHtml}
            </ul>
          </div>
        ` : ''}

        <!-- Actions -->
        <div class="pt-2 border-t border-outline-variant flex items-center justify-end gap-2">
          <button type="button" class="btn-close-route-modal px-4 py-2.5 bg-primary hover:bg-primary-container text-on-primary font-bold text-xs rounded-xl shadow-sm transition-transform active:scale-95 flex items-center gap-1.5">
            <span class="material-symbols-outlined text-base">check</span>
            <span>Apply &amp; View Schedule</span>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    const closeModal = () => overlay.remove();
    overlay.querySelectorAll(".btn-close-route-modal").forEach((btn) => btn.addEventListener("click", closeModal));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
  }

  function visitCardHTML(v) {
    const isPriority = v.priority === "priority" || v.priority === "high" || v.priority === "urgent";
    const time = format24HourTime(v.time_slot || v.scheduled_at);
    const borderClass = isPriority ? "border-l-error border-l-4 border-error/30" : "border-l-secondary border-l-4 border-secondary/30";
    const badgeClass = isPriority
      ? "bg-red-100 text-error border border-red-200"
      : "bg-blue-50 text-blue-700 border border-blue-200";
    const badgeLabel = isPriority ? "🚨 High Priority" : "📋 Routine";
    const done = v.status === "completed";
    const prepNote = v.notes || (isPriority ? "Priority case: Carry Sphygmomanometer (BP cuff), thermometer, & PHC referral slips." : "");

    return `
      <article class="bg-surface-container-lowest ${borderClass} border-y border-r border-outline rounded-2xl p-4 flex flex-col gap-2.5 shadow-sm hover:shadow-md transition-all cursor-pointer visit-card-item" data-visit-id="${v.id}" data-priority="${isPriority ? 'priority' : 'routine'}">
        <div class="flex justify-between items-start">
          <div class="flex items-center gap-2 flex-wrap">
            <button type="button" class="btn-card-action btn-toggle-priority ${badgeClass} font-label-md px-2.5 py-0.5 rounded-md font-bold uppercase text-[10px] flex items-center gap-1 hover:opacity-80 transition-opacity active:scale-95" data-action="toggle-priority" data-visit-id="${v.id}" data-current-priority="${isPriority ? 'priority' : 'routine'}" title="Click to toggle Priority">
              <span>${badgeLabel}</span>
              <span class="material-symbols-outlined text-[12px]">swap_vert</span>
            </button>
            <span class="text-primary font-bold bg-surface-container-low px-2 py-0.5 rounded-md text-xs">⏰ ${time}</span>
            ${done ? `<span class="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-md">✓ Done</span>` : ""}
          </div>
          <button type="button" class="btn-card-action text-on-surface-variant hover:text-error text-xs p-1" data-action="delete" data-visit-id="${v.id}" title="Cancel visit">
            <span class="material-symbols-outlined text-[18px]">delete</span>
          </button>
        </div>
        
        <div>
          <h4 class="font-extrabold text-primary text-sm">${v.patient_name || "Beneficiary"}</h4>
          <p class="text-xs text-on-surface-variant flex items-center gap-1.5 mt-0.5">
            <span class="font-semibold text-secondary">${(v.visit_type || "anc_visit").replace(/_/g, " ").toUpperCase()}</span>
            ${v.patient_mobile ? `<span>• +91 ${v.patient_mobile}</span>` : ""}
          </p>
          ${prepNote ? `<p class="text-xs ${isPriority ? 'text-error bg-red-50/70 border border-red-100' : 'text-on-surface-variant bg-surface-container-low'} mt-1.5 p-2 rounded-lg flex items-start gap-1"><span class="material-symbols-outlined text-xs mt-0.5 ${isPriority ? 'text-error' : 'text-secondary'}">${isPriority ? 'warning' : 'info'}</span> <span>${prepNote}</span></p>` : ""}
        </div>

        <div class="flex items-center gap-2 mt-1 pt-2.5 border-t border-outline-variant">
          <button type="button" class="btn-card-action flex-1 bg-secondary hover:bg-secondary-dark text-white text-xs py-2 px-3 rounded-xl font-bold flex items-center justify-center gap-1.5 shadow-sm active:scale-95 transition-transform" data-action="voice" data-visit-id="${v.id}">
            <span class="material-symbols-outlined text-base">mic</span>
            <span>Voice Checkup</span>
          </button>
          <a href="../smart_health_record_form/code.html?visit_id=${v.id}&patient_name=${encodeURIComponent(v.patient_name || '')}&visit_type=${v.visit_type || 'anc_visit'}" class="btn-card-action bg-surface-container-low hover:bg-surface-container-highest text-primary text-xs py-2 px-3 rounded-xl font-bold border border-outline-variant flex items-center gap-1 transition-colors" data-action="form">
            <span class="material-symbols-outlined text-base">edit_note</span>
            <span>Form</span>
          </a>
          ${!done ? `
            <button type="button" class="btn-card-action border border-outline text-on-surface-variant hover:bg-emerald-50 hover:text-secondary text-xs px-3 py-2 rounded-xl font-bold flex items-center gap-1 transition-colors" data-action="complete" data-visit-id="${v.id}" title="Mark completed">
              <span class="material-symbols-outlined text-base">check</span>
            </button>` : ""
          }
        </div>
      </article>`;
  }

  async function initCalendar() {
    if (!SakhiUI.requireAuthOrRedirect(LINKS.login)) return;

    // Check AI Engine Status
    const engineBadgeEl = document.getElementById("ai-engine-name");
    try {
      const status = await SakhiAPI.getSchedulerStatus();
      if (engineBadgeEl) {
        if (status.model && status.model.includes("gemma")) {
          engineBadgeEl.textContent = `Gemma 4 12B Active`;
        } else if (status.provider === "local_openai") {
          engineBadgeEl.textContent = `Local LLM: ${status.model}`;
        } else if (status.provider === "ollama") {
          engineBadgeEl.textContent = `Ollama: ${status.model}`;
        } else {
          engineBadgeEl.textContent = `Clinical AI Scheduler`;
        }
      }
    } catch (e) {
      if (engineBadgeEl) engineBadgeEl.textContent = "AI Scheduler Active";
    }

    let currentDate = new Date();
    let selectedDateStr = currentDate.toISOString().split("T")[0];
    let allVisits = [];
    let currentPriorityFilter = "all";

    const calendarGrid = document.getElementById("calendarGrid");
    const currentMonthYearHeader = document.getElementById("currentMonthYear");
    const prevMonthBtn = document.getElementById("prevMonth");
    const nextMonthBtn = document.getElementById("nextMonth");
    const scheduleHeader = document.getElementById("scheduleHeader");
    const scheduleList = document.getElementById("scheduleList");
    const emptyState = document.getElementById("emptyState");
    const btnAllocate = document.getElementById("btn-ai-allocate");
    const formNL = document.getElementById("form-nl-schedule");
    const inputNL = document.getElementById("input-nl-schedule");

    // Wire Priority Filter Tabs
    const filterBtns = document.querySelectorAll(".btn-priority-filter");
    filterBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        currentPriorityFilter = btn.getAttribute("data-filter") || "all";
        filterBtns.forEach((b) => {
          b.classList.remove("bg-primary", "text-white", "shadow-xs");
          b.classList.add("bg-surface-container", "text-on-surface");
        });
        btn.classList.remove("bg-surface-container", "text-on-surface");
        btn.classList.add("bg-primary", "text-white", "shadow-xs");
        renderScheduleView();
      });
    });

    async function loadAllVisits() {
      try {
        const raw = await SakhiAPI.listVisits();
        allVisits = sortVisitsAscending(raw);
      } catch (err) {
        allVisits = [];
      }
    }

    function renderCalendar() {
      if (!calendarGrid || !currentMonthYearHeader) return;
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth();

      const monthNames = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
      ];
      currentMonthYearHeader.textContent = `${monthNames[month]} ${year}`;

      const firstDay = new Date(year, month, 1).getDay();
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const daysInPrevMonth = new Date(year, month, 0).getDate();

      calendarGrid.innerHTML = "";

      // Previous month's padding
      for (let i = firstDay - 1; i >= 0; i--) {
        const day = daysInPrevMonth - i;
        const cell = document.createElement("div");
        cell.className = "h-[44px] w-[38px] flex flex-col items-center justify-center text-outline-variant select-none mx-auto text-sm";
        cell.textContent = day;
        calendarGrid.appendChild(cell);
      }

      // Current month's days
      for (let i = 1; i <= daysInMonth; i++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(i).padStart(2, "0")}`;
        const isSelected = dateStr === selectedDateStr;
        const visitsOnDay = allVisits.filter(
          (v) => (v.scheduled_date && v.scheduled_date.startsWith(dateStr)) ||
                 (v.scheduled_at && new Date(v.scheduled_at * 1000).toISOString().startsWith(dateStr))
        );

        const cell = document.createElement("div");
        cell.className = `h-[44px] w-[38px] flex flex-col items-center justify-center relative cursor-pointer select-none transition-all rounded-full mx-auto text-sm font-semibold ${
          isSelected
            ? "bg-primary text-on-primary font-bold shadow-md scale-105"
            : "hover:bg-surface-variant text-on-surface"
        }`;
        cell.textContent = i;

        if (visitsOnDay.length > 0) {
          const dotContainer = document.createElement("div");
          dotContainer.className = "flex gap-0.5 absolute bottom-1";
          const hasPriority = visitsOnDay.some((v) => v.priority === "priority" || v.priority === "high");

          const dot = document.createElement("div");
          dot.className = `w-1.5 h-1.5 rounded-full ${
            isSelected
              ? "bg-white"
              : hasPriority
              ? "bg-saffron"
              : "bg-secondary"
          }`;
          dotContainer.appendChild(dot);
          cell.appendChild(dotContainer);
        }

        cell.addEventListener("click", () => {
          selectedDateStr = dateStr;
          renderCalendar();
          renderScheduleView();
        });

        calendarGrid.appendChild(cell);
      }

      // Next month padding
      const totalCells = firstDay + daysInMonth;
      const nextDays = totalCells <= 35 ? 35 - totalCells : 42 - totalCells;
      for (let i = 1; i <= nextDays; i++) {
        const cell = document.createElement("div");
        cell.className = "h-[44px] w-[38px] flex flex-col items-center justify-center text-outline-variant select-none mx-auto text-sm";
        cell.textContent = i;
        calendarGrid.appendChild(cell);
      }
    }

    async function renderScheduleView() {
      if (!scheduleList || !scheduleHeader) return;

      const d = new Date(selectedDateStr + "T00:00:00");
      const options = { weekday: "short", month: "short", day: "numeric", year: "numeric" };
      const displayDate = d.toLocaleDateString("en-US", options);
      const todayStr = new Date().toISOString().split("T")[0];

      scheduleHeader.textContent = selectedDateStr === todayStr ? "Schedule for Today" : `Schedule for ${displayDate}`;

      // Filter visits for the selected day and sort ascending chronologically
      const allDayVisits = sortVisitsAscending(allVisits.filter(
        (v) => (v.scheduled_date && v.scheduled_date.startsWith(selectedDateStr)) ||
               (v.scheduled_at && new Date(v.scheduled_at * 1000).toISOString().startsWith(selectedDateStr))
      ));

      const urgentCount = allDayVisits.filter((v) => v.priority === "priority" || v.priority === "urgent" || v.priority === "high").length;
      const routineCount = allDayVisits.filter((v) => v.priority !== "priority" && v.priority !== "urgent" && v.priority !== "high").length;

      const countAllEl = document.getElementById("count-filter-all");
      const countUrgentEl = document.getElementById("count-filter-priority");
      const countRoutineEl = document.getElementById("count-filter-routine");
      if (countAllEl) countAllEl.textContent = String(allDayVisits.length);
      if (countUrgentEl) countUrgentEl.textContent = String(urgentCount);
      if (countRoutineEl) countRoutineEl.textContent = String(routineCount);

      let dayVisits = allDayVisits;
      if (currentPriorityFilter === "priority") {
        dayVisits = allDayVisits.filter((v) => v.priority === "priority" || v.priority === "urgent" || v.priority === "high");
      } else if (currentPriorityFilter === "routine") {
        dayVisits = allDayVisits.filter((v) => v.priority !== "priority" && v.priority !== "urgent" && v.priority !== "high");
      }

      // If no visits on this specific date, show clean empty state
      const existingArticles = scheduleList.querySelectorAll("article");
      existingArticles.forEach((a) => a.remove());

      if (dayVisits.length === 0) {
        if (emptyState) {
          emptyState.classList.remove("hidden");
          emptyState.classList.add("flex");
        }
      } else {
        if (emptyState) {
          emptyState.classList.add("hidden");
          emptyState.classList.remove("flex");
        }

        dayVisits.forEach((v) => {
          const wrapper = document.createElement("div");
          wrapper.innerHTML = visitCardHTML(v);
          const cardEl = wrapper.firstElementChild;
          
          // Card click -> open visit details modal
          cardEl.addEventListener("click", (e) => {
            if (e.target.closest(".btn-card-action") || e.target.closest("a") || e.target.closest("button")) return;
            openVisitDetailsModal(v, async () => {
              await loadAllVisits();
              renderCalendar();
              renderScheduleView();
            });
          });

          // Wire Priority Toggle button on visit card
          const priorityBtn = cardEl.querySelector('[data-action="toggle-priority"]');
          if (priorityBtn) {
            priorityBtn.addEventListener("click", async (e) => {
              e.stopPropagation();
              const curP = priorityBtn.getAttribute("data-current-priority");
              const nextP = (curP === "priority" || curP === "urgent" || curP === "high") ? "routine" : "priority";
              try {
                priorityBtn.disabled = true;
                await SakhiAPI.updateVisitPriority(v.id, nextP);
                SakhiUI.showToast(`Priority changed to ${nextP === "priority" ? "🚨 High Priority" : "📋 Routine"}!`, "success");
                await loadAllVisits();
                renderCalendar();
                renderScheduleView();
              } catch (err) {
                priorityBtn.disabled = false;
                SakhiUI.showToast(err.message || "Could not update priority", "error");
              }
            });
          }

          // Wire Voice Checkup button
          const voiceBtn = cardEl.querySelector('[data-action="voice"]');
          if (voiceBtn) {
            voiceBtn.addEventListener("click", (e) => {
              e.stopPropagation();
              if (window.SukanyaForm && window.SukanyaForm.openVoiceStudioModal) {
                window.SukanyaForm.openVoiceStudioModal({
                  visitType: v.visit_type || "anc_visit",
                  getMetadata: () => ({ patient_name: v.patient_name, visit_type: v.visit_type || "anc_visit", visit_id: v.id }),
                  onResult: async (res) => {
                    try {
                      sessionStorage.setItem("sukanya_last_extract", JSON.stringify(res));
                    } catch (_) {}
                    SakhiUI.showToast(`✨ Voice extraction complete for ${v.patient_name}! Opening form...`, "success");
                    try {
                      await SakhiAPI.updateVisitStatus(v.id, "completed");
                    } catch (_) {}
                    setTimeout(() => {
                      window.location.href = `../smart_health_record_form/code.html?visit_id=${v.id}&patient_name=${encodeURIComponent(v.patient_name || '')}&visit_type=${v.visit_type || 'anc_visit'}`;
                    }, 400);
                  }
                });
              } else {
                window.location.href = `../smart_health_record_form/code.html?visit_id=${v.id}&patient_name=${encodeURIComponent(v.patient_name || '')}&visit_type=${v.visit_type || 'anc_visit'}`;
              }
            });
          }

          // Wire Complete button
          const completeBtn = cardEl.querySelector('[data-action="complete"]');
          if (completeBtn) {
            completeBtn.addEventListener("click", async (e) => {
              e.stopPropagation();
              try {
                await SakhiAPI.updateVisitStatus(v.id, "completed");
                SakhiUI.showToast("Visit marked as completed", "success");
                await loadAllVisits();
                renderCalendar();
                renderScheduleView();
              } catch (err) {
                SakhiUI.showToast(err.message || "Error updating visit", "error");
              }
            });
          }

          // Wire Delete button
          const deleteBtn = cardEl.querySelector('[data-action="delete"]');
          if (deleteBtn) {
            deleteBtn.addEventListener("click", async (e) => {
              e.stopPropagation();
              const vid = v.id || v._id;
              if (confirm("Cancel and delete this scheduled visit?")) {
                try {
                  deleteBtn.disabled = true;
                  deleteBtn.style.opacity = "0.5";
                  await SakhiAPI.deleteVisit(vid);
                  SakhiUI.showToast("Visit deleted successfully", "info");
                  await loadAllVisits();
                  renderCalendar();
                  renderScheduleView();
                } catch (err) {
                  deleteBtn.disabled = false;
                  deleteBtn.style.opacity = "1";
                  SakhiUI.showToast(err.message || "Error deleting visit", "error");
                }
              }
            });
          }

          scheduleList.insertBefore(cardEl, emptyState);
        });
      }
    }

    // Previous & Next Month controls
    if (prevMonthBtn) {
      prevMonthBtn.addEventListener("click", () => {
        currentDate.setMonth(currentDate.getMonth() - 1);
        renderCalendar();
      });
    }
    if (nextMonthBtn) {
      nextMonthBtn.addEventListener("click", () => {
        currentDate.setMonth(currentDate.getMonth() + 1);
        renderCalendar();
      });
    }

    // AI Auto-Allocate Day
    if (btnAllocate) {
      btnAllocate.addEventListener("click", async () => {
        try {
          btnAllocate.disabled = true;
          btnAllocate.innerHTML = `<span class="material-symbols-outlined text-sm animate-spin">refresh</span> Optimizing Route...`;
          const res = await SakhiAPI.allocateTasks(selectedDateStr);
          SakhiUI.showToast("✨ AI Clinical Route Optimized!", "success");
          await loadAllVisits();
          renderCalendar();
          renderScheduleView();
          if (res && res.allocated_schedule && res.allocated_schedule.length > 0) {
            openRoutePlanModal(res);
          }
        } catch (err) {
          SakhiUI.showToast(err.message || "Could not optimize schedule", "error");
        } finally {
          btnAllocate.disabled = false;
          btnAllocate.innerHTML = `<span class="material-symbols-outlined text-sm">magic_button</span> AI Optimize Day`;
        }
      });
    }

    // AI Natural Language Quick Schedule with Voice & Presets
    const micBtn = document.getElementById("btn-nl-mic");
    let isRecordingNL = false;
    let recognitionNL = null;

    if (micBtn && ("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) {
      const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognitionNL = new SpeechRec();
      recognitionNL.continuous = false;
      recognitionNL.interimResults = false;
      // Use Marathi/Hindi/English locale based on user preference
      recognitionNL.lang = localStorage.getItem("sukanya_speech_lang") || "hi-IN";

      recognitionNL.onstart = () => {
        isRecordingNL = true;
        micBtn.classList.add("bg-red-500", "text-white", "animate-pulse");
        micBtn.innerHTML = `<span class="material-symbols-outlined text-lg">mic</span>`;
        SakhiUI.showToast("🎙️ Listening... Speak your visit schedule command (Hindi/Marathi/English)", "info");
      };

      recognitionNL.onresult = (event) => {
        const spoken = event.results[0][0].transcript;
        if (inputNL) {
          inputNL.value = spoken;
          if (formNL) formNL.dispatchEvent(new Event("submit"));
        }
      };

      recognitionNL.onerror = (e) => {
        isRecordingNL = false;
        micBtn.classList.remove("bg-red-500", "text-white", "animate-pulse");
        micBtn.innerHTML = `<span class="material-symbols-outlined text-lg">mic</span>`;
        SakhiUI.showToast(`Voice input error: ${e.error}`, "error");
      };

      recognitionNL.onend = () => {
        isRecordingNL = false;
        micBtn.classList.remove("bg-red-500", "text-white", "animate-pulse");
        micBtn.innerHTML = `<span class="material-symbols-outlined text-lg">mic</span>`;
      };

      micBtn.addEventListener("click", () => {
        if (!isRecordingNL) {
          try {
            recognitionNL.start();
          } catch (e) {
            recognitionNL.stop();
          }
        } else {
          recognitionNL.stop();
        }
      });
    }

    // Wire Quick Preset Chips
    document.querySelectorAll(".btn-nl-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        const prompt = chip.getAttribute("data-prompt");
        if (inputNL && prompt) {
          inputNL.value = prompt;
          inputNL.focus();
          if (formNL) formNL.dispatchEvent(new Event("submit"));
        }
      });
    });

    if (formNL && inputNL) {
      formNL.addEventListener("submit", async (e) => {
        e.preventDefault();
        const prompt = inputNL.value.trim();
        if (!prompt) return;

        const btnSubmit = document.getElementById("btn-nl-submit");
        try {
          if (btnSubmit) {
            btnSubmit.disabled = true;
            btnSubmit.innerHTML = `<span class="material-symbols-outlined text-sm animate-spin">refresh</span> Scheduling...`;
          }
          const res = await SakhiAPI.nlSchedule(prompt);
          inputNL.value = "";
          const v = res.visit || {};
          const isP = v.priority === "priority" || v.priority === "high" || v.priority === "urgent";
          const formattedTime = format24HourTime(v.time_slot || "10:00");
          
          SakhiUI.showToast(`✨ ${isP ? '🚨 High-Priority' : '📋'} Visit scheduled for ${v.patient_name} (${v.scheduled_date} at ${formattedTime})!`, "success");
          
          if (v.scheduled_date) {
            selectedDateStr = v.scheduled_date;
            currentDate = new Date(selectedDateStr + "T00:00:00");
          }
          await loadAllVisits();
          renderCalendar();
          renderScheduleView();
        } catch (err) {
          SakhiUI.showToast(err.message || "Could not parse schedule command", "error");
        } finally {
          if (btnSubmit) {
            btnSubmit.disabled = false;
            btnSubmit.innerHTML = `<span class="material-symbols-outlined text-base">add_task</span><span>Quick Schedule</span>`;
          }
        }
      });
    }

    // Add New Visit Modal
    const newVisitBtn = document.getElementById("btn-new-visit");
    if (newVisitBtn) {
      newVisitBtn.addEventListener("click", () => {
        SakhiUI.openModal({
          title: "Schedule New Visit",
          submitLabel: "Add Visit",
          bodyHTML: `
            <label class="font-label-md text-label-md text-primary">Patient name
              <input name="patient_name" required class="w-full h-touch-target-min mt-1 px-3 border border-outline rounded-lg" placeholder="e.g. Sushma Devi" />
            </label>
            <label class="font-label-md text-label-md text-primary mt-2">Mobile Number (optional)
              <input name="patient_mobile" class="w-full h-touch-target-min mt-1 px-3 border border-outline rounded-lg" placeholder="e.g. 9876543210" />
            </label>
            <label class="font-label-md text-label-md text-primary mt-2">Visit type
              <select name="visit_type" class="w-full h-touch-target-min mt-1 px-3 border border-outline rounded-lg">
                <option value="anc_visit">ANC Visit</option>
                <option value="pnc_visit">PNC Visit</option>
                <option value="delivery">Delivery</option>
                <option value="child_health">Child Health</option>
              </select>
            </label>
            <div class="grid grid-cols-2 gap-2 mt-2">
              <label class="font-label-md text-label-md text-primary">Date
                <input name="scheduled_date" type="date" value="${selectedDateStr}" class="w-full h-touch-target-min mt-1 px-2 border border-outline rounded-lg" />
              </label>
              <label class="font-label-md text-label-md text-primary">Time Slot (24h)
                <select name="time_slot" class="w-full h-touch-target-min mt-1 px-2 border border-outline rounded-lg font-semibold text-xs">
                  <option value="09:00">09:00</option>
                  <option value="10:00" selected>10:00</option>
                  <option value="11:30">11:30</option>
                  <option value="13:30">13:30</option>
                  <option value="15:00">15:00</option>
                  <option value="16:30">16:30</option>
                  <option value="18:00">18:00</option>
                </select>
              </label>
            </div>
            <label class="font-label-md text-label-md text-primary mt-2">Priority
              <select name="priority" class="w-full h-touch-target-min mt-1 px-3 border border-outline rounded-lg">
                <option value="routine">Routine</option>
                <option value="priority">High Priority</option>
              </select>
            </label>`,
          onSubmit: async (fd) => {
            try {
              const targetDate = fd.get("scheduled_date") || selectedDateStr;
              await SakhiAPI.createVisit({
                patient_name: fd.get("patient_name"),
                patient_mobile: fd.get("patient_mobile") || null,
                visit_type: fd.get("visit_type"),
                priority: fd.get("priority"),
                scheduled_date: targetDate,
                time_slot: fd.get("time_slot") || "10:00",
                source: "manual",
              });
              SakhiUI.showToast("Visit scheduled", "success");
              selectedDateStr = targetDate;
              currentDate = new Date(selectedDateStr + "T00:00:00");
              await loadAllVisits();
              renderCalendar();
              renderScheduleView();
            } catch (err) {
              SakhiUI.showToast(err.message || "Could not create visit", "error");
              return false;
            }
          },
        });
      });
    }

    // Initial Load & Render
    await loadAllVisits();
    renderCalendar();
    renderScheduleView();
  }

  // ── Settings ──
  async function initSettings() {
    if (!SakhiUI.requireAuthOrRedirect(LINKS.login)) return;
    const langSel = document.getElementById("setting-language");
    const offlineChk = document.getElementById("setting-offline");
    const notifChk = document.getElementById("setting-notifications");
    const logoutBtn = document.getElementById("btn-logout");

    // Populate the language dropdown from the 5 supported codes rather than
    // relying on whatever <option> tags the Stitch export happened to ship
    // with — keeps this in sync with backend/locales/*.json automatically.
    if (langSel && langSel.options.length !== LANGUAGE_CODES.length) {
      langSel.innerHTML = LANGUAGE_CODES.map((c) => `<option value="${c}">${LANGUAGE_LABELS[c]}</option>`).join("");
    }

    try {
      const s = await SakhiAPI.getSettings();
      if (langSel) langSel.value = s.language || "en";
      if (offlineChk) offlineChk.checked = s.offline_mode;
      if (notifChk) notifChk.checked = s.notifications;
    } catch (err) {
      SakhiUI.showToast("Could not load settings", "error");
    }

    async function persist() {
      const lang = langSel ? langSel.value : "en";
      try {
        await SakhiAPI.putSettings({
          language: lang,
          offline_mode: offlineChk ? offlineChk.checked : true,
          notifications: notifChk ? notifChk.checked : true,
        });
        if (window.SukanyaI18n) window.SukanyaI18n.setLanguage(lang);
        SakhiUI.showToast("Settings saved", "success");
      } catch (err) {
        SakhiUI.showToast(err.message || "Could not save settings", "error");
      }
    }
    [langSel, offlineChk, notifChk].forEach((elm) => elm && elm.addEventListener("change", persist));

    if (logoutBtn) logoutBtn.addEventListener("click", () => SakhiAPI.logout());
  }

  function helpRequestCardHTML(r) {
    const isUrgent = r.urgency === "urgent";
    const time = new Date(r.created_at * 1000).toLocaleString([], { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" });
    const urgencyLabel = window.SukanyaI18n ? window.SukanyaI18n.t(isUrgent ? "URGENT" : "ROUTINE") : r.urgency.toUpperCase();
    const resolveLabel = window.SukanyaI18n ? window.SukanyaI18n.t("Resolve") : "Resolve";
    const fromLabel = window.SukanyaI18n ? window.SukanyaI18n.t("From:") : "From:";
    return `
      <div class="border border-outline-variant rounded-lg p-3 flex flex-col gap-1" data-request-id="${r.id}">
        <div class="flex justify-between items-center">
          <span class="text-xs font-bold px-2 py-0.5 rounded-full ${isUrgent ? "bg-red-100 text-red-700" : "bg-surface-container-highest text-on-surface-variant"}">${urgencyLabel}</span>
          <span class="text-xs text-on-surface-variant">${time}</span>
        </div>
        <p class="text-sm text-on-surface">${r.message}</p>
        <div class="flex justify-between items-center text-xs text-on-surface-variant mt-1">
          <span>${fromLabel} ${r.mobile || "Beneficiary"}</span>
          <button class="px-2 py-1 bg-surface-container-high hover:bg-surface-container-highest rounded text-xs font-bold btn-resolve-help" data-request-id="${r.id}">${resolveLabel}</button>
        </div>
      </div>
    `;
  }

  async function refreshHelpRequests() {
    const list = document.getElementById("help-requests-list");
    if (!list) return;
    try {
      const requests = await SakhiAPI.listHelpRequests("open");
      list.innerHTML = requests.length
        ? requests.map(helpRequestCardHTML).join("")
        : `<p class="text-sm text-on-surface-variant">No open help requests.</p>`;
      list.querySelectorAll(".btn-resolve-help").forEach((btn) => {
        btn.addEventListener("click", async () => {
          await SakhiAPI.updateHelpRequestStatus(btn.getAttribute("data-request-id"), "resolved");
          refreshHelpRequests();
        });
      });
    } catch (err) {
      list.innerHTML = `<p class="text-sm text-error">${err.message}</p>`;
    }
  }

  // ── Beneficiary portal (two-sided platform) ──
  function initBeneficiaryLogin() {
    const form = document.getElementById("beneficiary-login-form");
    const mobileInput = document.getElementById("ben-mobile");
    const nameInput = document.getElementById("ben-name");
    const pinInput = document.getElementById("ben-pin");
    const demoBtn = document.getElementById("ben-demo-login-btn");
    const requestPinBtn = document.getElementById("ben-request-pin-btn");

    async function requestPin() {
      const mobile = (mobileInput.value || "").trim();
      if (!mobile) {
        SakhiUI.showToast("Enter your mobile number", "error");
        return;
      }
      try {
        const { dev_pin } = await SukanyaBeneficiaryAPI.requestPin(mobile, (nameInput && nameInput.value) || null);
        if (pinInput) pinInput.value = dev_pin;
        SakhiUI.showToast(`Demo mode — no SMS gateway. Your PIN is ${dev_pin}`, "info");
      } catch (err) {
        SakhiUI.showToast(err.message || "Could not request PIN", "error");
      }
    }

    if (requestPinBtn) requestPinBtn.addEventListener("click", requestPin);

    if (demoBtn) {
      demoBtn.addEventListener("click", async () => {
        const mobile = (mobileInput.value || "9998887770").trim();
        mobileInput.value = mobile;
        try {
          const { dev_pin } = await SukanyaBeneficiaryAPI.requestPin(mobile, "Demo Beneficiary");
          await SukanyaBeneficiaryAPI.verifyPin(mobile, dev_pin);
          window.location.href = LINKS.beneficiaryHome;
        } catch (err) {
          SakhiUI.showToast(err.message || "Demo login failed", "error");
        }
      });
    }

    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const mobile = (mobileInput.value || "").trim();
        const pin = (pinInput.value || "").trim();
        if (!mobile || !pin) {
          SakhiUI.showToast("Enter mobile number and PIN", "error");
          return;
        }
        try {
          await SukanyaBeneficiaryAPI.verifyPin(mobile, pin);
          window.location.href = LINKS.beneficiaryHome;
        } catch (err) {
          SakhiUI.showToast(err.message || "Login failed", "error");
        }
      });
    }
  }

  function beneficiaryRecordCardHTML(r) {
    const vitals = r.vitals || {};
    const parts = [];
    if (vitals.bp_systolic && vitals.bp_diastolic) parts.push(`BP ${vitals.bp_systolic}/${vitals.bp_diastolic}`);
    if (vitals.weight_kg) parts.push(`Weight ${vitals.weight_kg}kg`);
    if (vitals.temperature_celsius) parts.push(`Temp ${vitals.temperature_celsius}°C`);
    const date = new Date(r.created_at * 1000).toLocaleDateString();
    return `
      <div class="bg-surface-container-lowest rounded-xl border border-outline p-4">
        <div class="flex justify-between items-center mb-1">
          <span class="font-bold text-primary">${r.visit_type.replace("_", " ").toUpperCase()}</span>
          <span class="text-xs text-on-surface-variant">${date}</span>
        </div>
        ${parts.length ? `<p class="text-sm text-on-surface-variant">${parts.join(" · ")}</p>` : ""}
        ${(r.counseling_provided || []).length ? `<p class="text-xs text-secondary mt-1">Advice: ${r.counseling_provided.join(", ")}</p>` : ""}
        ${r.next_visit_date ? `<p class="text-xs text-primary mt-1">Next visit: ${r.next_visit_date}</p>` : ""}
      </div>`;
  }

  function beneficiaryVisitCardHTML(v) {
    const time = new Date(v.scheduled_at * 1000).toLocaleString([], { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" });
    return `
      <div class="bg-surface-container-lowest rounded-xl border border-outline p-4 flex justify-between items-center">
        <div>
          <p class="font-bold text-primary">${v.visit_type.replace("_", " ").toUpperCase()}</p>
          <p class="text-sm text-on-surface-variant">${time}</p>
        </div>
        <span class="text-xs px-2 py-1 rounded-full ${v.status === "completed" ? "bg-secondary-container text-on-secondary-container" : "bg-accent-saffron text-tertiary-container"}">${v.status}</span>
      </div>`;
  }

  async function initBeneficiaryHome() {
    if (!SukanyaBeneficiaryAPI.isLoggedIn()) {
      window.location.href = LINKS.beneficiaryLogin;
      return;
    }
    const nameEl = document.getElementById("ben-name-display");
    const beneficiary = SukanyaBeneficiaryAPI.getBeneficiary();
    if (nameEl) nameEl.textContent = (beneficiary && beneficiary.name) || "Beneficiary";

    const visitsList = document.getElementById("ben-visits-list");
    const recordsList = document.getElementById("ben-records-list");
    try {
      const visits = await SukanyaBeneficiaryAPI.listVisits();
      if (visitsList) {
        visitsList.innerHTML = visits.length
          ? visits.map(beneficiaryVisitCardHTML).join("")
          : `<p class="text-sm text-on-surface-variant">No appointments on record yet.</p>`;
      }
    } catch (err) {
      if (visitsList) visitsList.innerHTML = `<p class="text-sm text-error">${err.message}</p>`;
    }
    try {
      const records = await SukanyaBeneficiaryAPI.listRecords();
      if (recordsList) {
        recordsList.innerHTML = records.length
          ? records.map(beneficiaryRecordCardHTML).join("")
          : `<p class="text-sm text-on-surface-variant">No health records yet.</p>`;
      }
    } catch (err) {
      if (recordsList) recordsList.innerHTML = `<p class="text-sm text-error">${err.message}</p>`;
    }

    const helpBtn = document.getElementById("btn-request-help");
    if (helpBtn) {
      helpBtn.addEventListener("click", () => {
        SakhiUI.openModal({
          title: "Request Help",
          submitLabel: "Send Request",
          bodyHTML: `
            <label class="font-label-md text-label-md text-primary">What do you need help with?
              <textarea name="message" required rows="3" class="w-full mt-1 px-3 py-2 border border-outline rounded-lg" placeholder="Describe your concern..."></textarea>
            </label>
            <label class="font-label-md text-label-md text-primary">Urgency
              <select name="urgency" class="w-full h-touch-target-min mt-1 px-3 border border-outline rounded-lg">
                <option value="routine">Routine — can wait</option>
                <option value="urgent">Urgent — needs attention soon</option>
              </select>
            </label>`,
          onSubmit: async (fd) => {
            try {
              await SukanyaBeneficiaryAPI.createHelpRequest(fd.get("message"), fd.get("urgency"));
              SakhiUI.showToast("Your request has been sent to your ASHA worker", "success");
            } catch (err) {
              SakhiUI.showToast(err.message || "Could not send request", "error");
              return false;
            }
          },
        });
      });
    }

    const logoutBtn = document.getElementById("ben-logout-btn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", () => {
        SukanyaBeneficiaryAPI.logout();
        window.location.href = LINKS.beneficiaryLogin;
      });
    }
  }

  const PAGES = {
    splash: initSplash,
    login: initLogin,
    register: initRegister,
    home: initHome,
    calendar: initCalendar,
    settings: initSettings,
    "beneficiary-login": initBeneficiaryLogin,
    "beneficiary-home": initBeneficiaryHome,
    "form-part1": () => window.SukanyaForm && window.SukanyaForm.init(),
    "form-part2": () => window.SukanyaForm && window.SukanyaForm.init(),
    "form-smart": () => window.SukanyaForm && window.SukanyaForm.init(),
    "smart-form": () => window.SukanyaForm && window.SukanyaForm.init(),
  };

  document.addEventListener("DOMContentLoaded", () => {
    initEmergencyButton();
    const page = document.body.getAttribute("data-sukanya-page") || document.body.getAttribute("data-sakhi-page");
    if (page && PAGES[page]) {
      PAGES[page]();
    } else if (page && page.startsWith("form-") && window.SukanyaForm) {
      window.SukanyaForm.init();
    }
  });

  window.SukanyaApp = { LINKS };
  window.SakhiApp = window.SukanyaApp;
})();
