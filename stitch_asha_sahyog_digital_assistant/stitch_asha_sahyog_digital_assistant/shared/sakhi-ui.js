/**
 * Small runtime-only UI helpers shared across pages: toast, alert banner,
 * and a lightweight modal. Everything here is injected into the DOM at
 * runtime — none of it lives in the page source, so it never touches the
 * static Stitch template markup. Uses only Tailwind utility classes /
 * color tokens that are already defined in every page's tailwind.config
 * (primary, secondary, error, error-container, accent-green, accent-saffron,
 * saffron, outline, surface-container-lowest, touch-target-min).
 */
(function (global) {
  "use strict";

  function el(tag, className, html) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function showToast(message, tone) {
    tone = tone || "info"; // info | success | error
    const toneClasses = {
      info: "bg-primary text-on-primary",
      success: "bg-secondary text-on-secondary",
      error: "bg-error text-on-error",
    };
    const toast = el(
      "div",
      `fixed bottom-24 md:bottom-6 left-1/2 -translate-x-1/2 z-[100] px-5 py-3 rounded-lg shadow-lg font-body-md text-body-md ${toneClasses[tone] || toneClasses.info}`,
      message
    );
    toast.style.transition = "opacity 0.3s ease";
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  /** Inserts a dismissible banner as the first child of `container`. Returns the banner element. */
  function showBanner(container, { title, body, tone }) {
    tone = tone || "warning"; // warning | danger | info
    const toneClasses = {
      danger: "bg-error-container text-on-error-container border-error",
      warning: "bg-accent-saffron text-on-tertiary-fixed-variant border-saffron",
      info: "bg-accent-green text-on-secondary-container border-secondary",
    };
    const banner = el(
      "div",
      `mb-4 border rounded-lg p-4 flex items-start gap-3 ${toneClasses[tone] || toneClasses.warning}`
    );
    banner.innerHTML = `
      <span class="material-symbols-outlined" style="font-variation-settings:'FILL' 1;">
        ${tone === "danger" ? "warning" : tone === "info" ? "check_circle" : "info"}
      </span>
      <div class="flex-1">
        <p class="font-label-lg text-label-lg m-0">${title}</p>
        ${body ? `<div class="font-body-sm text-body-sm mt-1">${body}</div>` : ""}
      </div>
      <button type="button" aria-label="Dismiss" class="opacity-70 hover:opacity-100">
        <span class="material-symbols-outlined text-[18px]">close</span>
      </button>
    `;
    banner.querySelector("button").addEventListener("click", () => banner.remove());
    container.insertBefore(banner, container.firstChild);
    return banner;
  }

  /** Minimal centered modal. onSubmit receives the form's FormData; return false to keep it open. */
  function openModal({ title, bodyHTML, submitLabel, onSubmit }) {
    const overlay = el(
      "div",
      "fixed inset-0 z-[110] bg-black/40 flex items-center justify-center p-4"
    );
    overlay.innerHTML = `
      <div class="bg-surface-container-lowest rounded-xl shadow-lg w-full max-w-sm p-6 max-h-[90vh] overflow-y-auto">
        <h3 class="font-headline-sm text-headline-sm text-primary mb-4">${title}</h3>
        <form class="flex flex-col gap-3">
          ${bodyHTML}
          <div class="flex gap-2 mt-2">
            <button type="button" data-role="cancel" class="flex-1 h-touch-target-min border border-outline rounded-lg font-label-md text-label-md">Cancel</button>
            <button type="submit" class="flex-1 h-touch-target-min bg-primary text-on-primary rounded-lg font-label-md text-label-md">${submitLabel || "Save"}</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);
    const form = overlay.querySelector("form");
    overlay.querySelector('[data-role="cancel"]').addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.remove();
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      // onSubmit may be async (every current caller's is) — await it so a
      // Promise object itself (always truthy) doesn't get compared against
      // `false` here instead of what it resolves to. Without this, "return
      // false to keep it open" never worked: the modal closed immediately
      // regardless of whether the submit handler failed.
      const result = await onSubmit(new FormData(form));
      if (result !== false) overlay.remove();
    });
    return overlay;
  }

  function requireAuthOrRedirect(loginUrl) {
    const api = global.SukanyaAPI || global.SakhiAPI;
    if (!api || !api.isLoggedIn()) {
      window.location.href = loginUrl;
      return false;
    }
    return true;
  }

  // Full-screen busy overlay for async work (transcription, translation,
  // extraction). sakhi-record.js calls showLoading/hideLoading around every
  // one of those — this was previously undefined here, so every call threw
  // immediately and silently killed the Translate/Autofill/Transcribe flows
  // right at the first line (a TypeError, not a network error, so nothing
  // ever reached the backend or showed a toast).
  let _loadingOverlay = null;

  function showLoading(message) {
    if (_loadingOverlay) {
      const msgEl = _loadingOverlay.querySelector("[data-loading-message]");
      if (msgEl) msgEl.textContent = message || "Loading...";
      return;
    }
    _loadingOverlay = el(
      "div",
      "fixed inset-0 z-[150] bg-black/50 flex items-center justify-center p-4"
    );
    _loadingOverlay.innerHTML = `
      <div class="bg-surface-container-lowest rounded-xl shadow-lg px-6 py-5 flex flex-col items-center gap-3 max-w-xs text-center">
        <span class="material-symbols-outlined text-primary text-3xl animate-spin">progress_activity</span>
        <p class="font-body-sm text-body-sm text-on-surface" data-loading-message>${message || "Loading..."}</p>
      </div>
    `;
    document.body.appendChild(_loadingOverlay);
  }

  function hideLoading() {
    if (_loadingOverlay) {
      _loadingOverlay.remove();
      _loadingOverlay = null;
    }
  }

  // ── Emergency SOS & Healthcare Contacts Manager ──
  const SOS_CONTACTS_KEY = "sukanya_emergency_contacts";
  const DEFAULT_SOS_CONTACTS = [
    { id: "c1", name: "Sunita Devi (ANM)", role: "Sector ANM Nurse", phone: "+91 98765 43210" },
    { id: "c2", name: "Ramesh Kumar", role: "Local Ambulance Driver", phone: "+91 98110 54321" },
    { id: "c3", name: "Rampur PHC Reception", role: "Hospital Desk", phone: "+91 94120 10801" }
  ];

  function getEmergencyContacts() {
    try {
      const raw = localStorage.getItem(SOS_CONTACTS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {}
    return [...DEFAULT_SOS_CONTACTS];
  }

  function saveEmergencyContacts(contacts) {
    try {
      localStorage.setItem(SOS_CONTACTS_KEY, JSON.stringify(contacts));
    } catch (e) {}
  }

  function openEmergencyHubModal() {
    let contacts = getEmergencyContacts();
    let detectedLocation = "Rampur Sector, Uttar Pradesh";
    let isDetectingGps = true;

    const overlay = el(
      "div",
      "fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
    );

    function renderModalContent() {
      overlay.innerHTML = `
        <div class="bg-surface-container-lowest rounded-2xl shadow-2xl w-full max-w-xl max-h-[92vh] flex flex-col border border-red-200 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
          
          <!-- Modal Header -->
          <div class="bg-gradient-to-r from-red-600 via-rose-600 to-red-700 text-white p-4 sm:p-5 flex items-center justify-between shadow-md shrink-0">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center backdrop-blur-xs shadow-inner">
                <span class="material-symbols-outlined text-2xl text-white">emergency</span>
              </div>
              <div>
                <h2 class="text-lg sm:text-xl font-black leading-tight flex items-center gap-2">
                  <span>Emergency SOS &amp; Healthcare Hub</span>
                  <span class="animate-ping inline-flex h-2 w-2 rounded-full bg-yellow-300 opacity-90"></span>
                </h2>
                <p class="text-xs text-red-100 font-medium">Immediate One-Click Dialing, Custom Contacts &amp; PHC Dispatch</p>
              </div>
            </div>
            <button type="button" data-action="close" class="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors" title="Close">
              <span class="material-symbols-outlined text-xl">close</span>
            </button>
          </div>

          <!-- Modal Body (Scrollable) -->
          <div class="p-4 sm:p-6 overflow-y-auto space-y-6 flex-1 text-on-surface text-xs md:text-sm">
            
            <!-- Section 1: Default Healthcare Emergency Helplines -->
            <div class="space-y-3">
              <div class="flex items-center justify-between">
                <h3 class="font-extrabold text-sm text-primary flex items-center gap-1.5">
                  <span class="material-symbols-outlined text-red-600 text-base">local_hospital</span>
                  <span>National &amp; District Healthcare Helplines</span>
                </h3>
                <span class="bg-red-50 text-error font-extrabold text-[10px] px-2 py-0.5 rounded-full border border-red-200">Toll-Free 24x7</span>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                
                <!-- 108 Ambulance -->
                <div class="p-3 bg-red-50/60 border border-red-200 rounded-xl flex items-center justify-between hover:bg-red-50 transition-colors shadow-2xs">
                  <div class="flex items-center gap-2.5 min-w-0">
                    <div class="w-9 h-9 rounded-lg bg-red-600 text-white flex items-center justify-center font-black text-sm shrink-0 shadow-sm">
                      108
                    </div>
                    <div class="min-w-0">
                      <p class="font-bold text-xs text-primary leading-tight">National Ambulance</p>
                      <p class="text-[10px] text-on-surface-variant truncate">Emergency Medical Service</p>
                    </div>
                  </div>
                  <a href="tel:108" class="h-8 px-3 bg-red-600 hover:bg-red-700 active:scale-95 text-white font-bold text-xs rounded-lg flex items-center gap-1 shadow-sm transition-all whitespace-nowrap">
                    <span class="material-symbols-outlined text-sm">call</span>
                    <span>Call 108</span>
                  </a>
                </div>

                <!-- 102 Pregnancy Transport -->
                <div class="p-3 bg-purple-50/60 border border-purple-200 rounded-xl flex items-center justify-between hover:bg-purple-50 transition-colors shadow-2xs">
                  <div class="flex items-center gap-2.5 min-w-0">
                    <div class="w-9 h-9 rounded-lg bg-purple-700 text-white flex items-center justify-center font-black text-sm shrink-0 shadow-sm">
                      102
                    </div>
                    <div class="min-w-0">
                      <p class="font-bold text-xs text-primary leading-tight">Janani Shishu (JSSK)</p>
                      <p class="text-[10px] text-on-surface-variant truncate">Free Maternal/Child Transport</p>
                    </div>
                  </div>
                  <a href="tel:102" class="h-8 px-3 bg-purple-700 hover:bg-purple-800 active:scale-95 text-white font-bold text-xs rounded-lg flex items-center gap-1 shadow-sm transition-all whitespace-nowrap">
                    <span class="material-symbols-outlined text-sm">call</span>
                    <span>Call 102</span>
                  </a>
                </div>

                <!-- PHC Rampur Medical Officer -->
                <div class="p-3 bg-emerald-50/60 border border-emerald-200 rounded-xl flex items-center justify-between hover:bg-emerald-50 transition-colors shadow-2xs">
                  <div class="flex items-center gap-2.5 min-w-0">
                    <div class="w-9 h-9 rounded-lg bg-secondary text-white flex items-center justify-center font-black text-sm shrink-0 shadow-sm">
                      <span class="material-symbols-outlined text-base">stethoscope</span>
                    </div>
                    <div class="min-w-0">
                      <p class="font-bold text-xs text-primary leading-tight truncate">PHC Rampur (MOIC)</p>
                      <p class="text-[10px] text-on-surface-variant truncate">+91 94120 10800</p>
                    </div>
                  </div>
                  <a href="tel:+919412010800" class="h-8 px-3 bg-secondary hover:bg-secondary-dark active:scale-95 text-white font-bold text-xs rounded-lg flex items-center gap-1 shadow-sm transition-all whitespace-nowrap">
                    <span class="material-symbols-outlined text-sm">call</span>
                    <span>Call MOIC</span>
                  </a>
                </div>

                <!-- 112 Unified Emergency -->
                <div class="p-3 bg-blue-50/60 border border-blue-200 rounded-xl flex items-center justify-between hover:bg-blue-50 transition-colors shadow-2xs">
                  <div class="flex items-center gap-2.5 min-w-0">
                    <div class="w-9 h-9 rounded-lg bg-blue-700 text-white flex items-center justify-center font-black text-sm shrink-0 shadow-sm">
                      112
                    </div>
                    <div class="min-w-0">
                      <p class="font-bold text-xs text-primary leading-tight">National Helpline</p>
                      <p class="text-[10px] text-on-surface-variant truncate">Unified Police / Fire / Med</p>
                    </div>
                  </div>
                  <a href="tel:112" class="h-8 px-3 bg-blue-700 hover:bg-blue-800 active:scale-95 text-white font-bold text-xs rounded-lg flex items-center gap-1 shadow-sm transition-all whitespace-nowrap">
                    <span class="material-symbols-outlined text-sm">call</span>
                    <span>Call 112</span>
                  </a>
                </div>

              </div>
            </div>

            <!-- Section 2: Custom Emergency Contacts Manager -->
            <div class="space-y-3 pt-2 border-t border-outline-variant">
              <div class="flex items-center justify-between">
                <div>
                  <h3 class="font-extrabold text-sm text-primary flex items-center gap-1.5">
                    <span class="material-symbols-outlined text-secondary text-base">contacts</span>
                    <span>Custom Emergency Contacts</span>
                  </h3>
                  <p class="text-[11px] text-on-surface-variant">Saved local ANMs, drivers, hospital desks, and community leaders.</p>
                </div>
                <button type="button" id="btn-toggle-add-contact" class="h-7 px-2.5 bg-primary/10 hover:bg-primary/20 text-primary font-bold text-xs rounded-lg flex items-center gap-1 transition-colors">
                  <span class="material-symbols-outlined text-sm">add</span>
                  <span>Add Contact</span>
                </button>
              </div>

              <!-- Add Contact Form (Toggleable) -->
              <div id="add-contact-form-container" class="hidden bg-surface-container-low p-3.5 rounded-xl border border-outline space-y-3">
                <h4 class="font-bold text-xs text-primary flex items-center gap-1">
                  <span class="material-symbols-outlined text-sm">person_add</span>
                  <span>Add New Emergency Contact</span>
                </h4>
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input type="text" id="new-contact-name" placeholder="Contact Name (e.g. Dr. Verma)" class="h-8 px-2.5 text-xs bg-surface-container-lowest border border-outline rounded-lg focus:ring-1 focus:ring-primary w-full" required />
                  <input type="text" id="new-contact-role" placeholder="Role (e.g. ANM / Driver / MO)" class="h-8 px-2.5 text-xs bg-surface-container-lowest border border-outline rounded-lg focus:ring-1 focus:ring-primary w-full" />
                  <input type="tel" id="new-contact-phone" placeholder="Phone (e.g. 9876543210)" class="h-8 px-2.5 text-xs bg-surface-container-lowest border border-outline rounded-lg focus:ring-1 focus:ring-primary w-full" required />
                </div>
                <div class="flex justify-end gap-2">
                  <button type="button" id="btn-cancel-add-contact" class="h-7 px-3 text-xs text-on-surface-variant hover:bg-surface-container font-medium rounded-lg">Cancel</button>
                  <button type="button" id="btn-save-new-contact" class="h-7 px-3 text-xs bg-secondary hover:bg-secondary-dark text-white font-bold rounded-lg shadow-xs flex items-center gap-1">
                    <span class="material-symbols-outlined text-sm">save</span>
                    <span>Save Contact</span>
                  </button>
                </div>
              </div>

              <!-- Contacts List -->
              <div id="sos-contacts-list" class="space-y-2 max-h-48 overflow-y-auto pr-1">
                ${contacts.map((c) => `
                  <div class="p-2.5 bg-surface-container-low hover:bg-surface-container rounded-xl border border-outline flex items-center justify-between gap-2 transition-colors">
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2">
                        <span class="font-bold text-xs text-primary truncate">${c.name}</span>
                        ${c.role ? `<span class="bg-surface-container-high text-on-surface-variant text-[10px] px-2 py-0.5 rounded-md font-medium truncate">${c.role}</span>` : ""}
                      </div>
                      <p class="text-[11px] text-on-surface-variant font-mono mt-0.5">${c.phone}</p>
                    </div>
                    <div class="flex items-center gap-1.5 shrink-0">
                      <a href="tel:${c.phone.replace(/\s+/g, '')}" class="h-7 px-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg flex items-center gap-1 shadow-2xs transition-transform active:scale-95" title="Call ${c.name}">
                        <span class="material-symbols-outlined text-sm">call</span>
                        <span class="hidden sm:inline">Call</span>
                      </a>
                      <a href="sms:${c.phone.replace(/\s+/g, '')}?body=EMERGENCY%20ASHA%20SOS:%20Urgent%20medical%20assistance%20needed%20at%20${encodeURIComponent(detectedLocation)}" class="h-7 px-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-lg flex items-center gap-1 shadow-2xs transition-transform active:scale-95" title="SMS ${c.name}">
                        <span class="material-symbols-outlined text-sm">sms</span>
                      </a>
                      <button type="button" data-delete-id="${c.id}" class="w-7 h-7 text-on-surface-variant hover:text-error hover:bg-red-50 rounded-lg flex items-center justify-center transition-colors" title="Delete Contact">
                        <span class="material-symbols-outlined text-sm">delete</span>
                      </button>
                    </div>
                  </div>
                `).join("")}
              </div>
            </div>

            <!-- Section 3: Digital SOS Dispatch & Location Broadcast -->
            <div class="space-y-3 pt-2 border-t border-outline-variant">
              <div class="flex items-center justify-between">
                <h3 class="font-extrabold text-sm text-primary flex items-center gap-1.5">
                  <span class="material-symbols-outlined text-red-600 text-base">radar</span>
                  <span>Transmit Digital SOS Alert to PHC</span>
                </h3>
                <div class="flex items-center gap-1 text-[11px] text-on-surface-variant" id="sos-live-location-badge">
                  <span class="material-symbols-outlined text-sm text-emerald-600 animate-pulse">location_on</span>
                  <span class="truncate max-w-[200px]" id="sos-location-text">${detectedLocation}</span>
                </div>
              </div>

              <div class="space-y-2">
                <label class="block text-xs font-bold text-primary">
                  Clinical Finding / Danger Signs
                  <textarea id="sos-emergency-reason" rows="2" class="w-full mt-1 p-2.5 text-xs bg-surface-container-lowest border border-outline rounded-xl focus:ring-2 focus:ring-error text-on-surface" placeholder="e.g. Postpartum hemorrhage, active maternal convulsions/eclampsia, newborn respiratory distress"></textarea>
                </label>
                
                <div class="flex flex-col sm:flex-row items-center gap-2 pt-1">
                  <button type="button" id="btn-transmit-sos-alert" class="w-full sm:flex-1 h-10 bg-error hover:bg-red-700 active:scale-98 text-white font-extrabold text-xs rounded-xl shadow-md flex items-center justify-center gap-2 transition-all">
                    <span class="material-symbols-outlined text-base">send</span>
                    <span>Transmit Immediate SOS to PHC</span>
                  </button>
                  <button type="button" id="btn-whatsapp-sos-share" class="w-full sm:w-auto h-10 px-4 bg-emerald-700 hover:bg-emerald-800 active:scale-98 text-white font-bold text-xs rounded-xl shadow-sm flex items-center justify-center gap-1.5 transition-all">
                    <span class="material-symbols-outlined text-base">share</span>
                    <span>WhatsApp SOS</span>
                  </button>
                </div>
              </div>
            </div>

          </div>
        </div>
      `;

      // Event handlers
      overlay.querySelector('[data-action="close"]').addEventListener("click", () => overlay.remove());
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) overlay.remove();
      });

      // Toggle add contact form
      const toggleBtn = overlay.querySelector("#btn-toggle-add-contact");
      const formContainer = overlay.querySelector("#add-contact-form-container");
      const cancelAddBtn = overlay.querySelector("#btn-cancel-add-contact");
      const saveContactBtn = overlay.querySelector("#btn-save-new-contact");

      if (toggleBtn && formContainer) {
        toggleBtn.addEventListener("click", () => formContainer.classList.toggle("hidden"));
      }
      if (cancelAddBtn && formContainer) {
        cancelAddBtn.addEventListener("click", () => formContainer.classList.add("hidden"));
      }
      if (saveContactBtn) {
        saveContactBtn.addEventListener("click", () => {
          const nameInput = overlay.querySelector("#new-contact-name");
          const roleInput = overlay.querySelector("#new-contact-role");
          const phoneInput = overlay.querySelector("#new-contact-phone");

          const name = nameInput.value.trim();
          const role = roleInput.value.trim() || "Emergency Contact";
          const phone = phoneInput.value.trim();

          if (!name || !phone) {
            showToast("Please enter contact name and phone number", "error");
            return;
          }

          const newContact = {
            id: "c_" + Date.now(),
            name,
            role,
            phone
          };

          contacts.push(newContact);
          saveEmergencyContacts(contacts);
          showToast(`Emergency contact "${name}" saved!`, "success");
          renderModalContent();
        });
      }

      // Delete contact handlers
      overlay.querySelectorAll("[data-delete-id]").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const id = btn.getAttribute("data-delete-id");
          if (confirm("Remove this emergency contact?")) {
            contacts = contacts.filter((c) => String(c.id) !== String(id));
            saveEmergencyContacts(contacts);
            showToast("Emergency contact removed", "info");
            renderModalContent();
          }
        });
      });

      // Transmit SOS Alert Handler
      const transmitBtn = overlay.querySelector("#btn-transmit-sos-alert");
      if (transmitBtn) {
        transmitBtn.addEventListener("click", async () => {
          const reasonInput = overlay.querySelector("#sos-emergency-reason");
          const reason = reasonInput ? reasonInput.value.trim() : "";
          if (!reason) {
            showToast("Please enter the emergency clinical finding / reason", "error");
            if (reasonInput) reasonInput.focus();
            return;
          }

          transmitBtn.disabled = true;
          transmitBtn.innerHTML = `
            <span class="material-symbols-outlined text-base animate-spin">progress_activity</span>
            <span>Transmitting Alert...</span>
          `;

          try {
            const api = global.SukanyaAPI || global.SakhiAPI;
            if (api && typeof api.triggerEmergency === "function") {
              await api.triggerEmergency({
                reason: reason,
                location: detectedLocation
              });
            }
            showToast("🚨 Emergency SOS dispatched to Medical Officer & High-Risk Queue!", "success");
            if (typeof global.refreshAlerts === "function") {
              global.refreshAlerts();
            }
            overlay.remove();
          } catch (err) {
            showToast(err.message || "Failed to transmit emergency alert", "error");
            transmitBtn.disabled = false;
            transmitBtn.innerHTML = `
              <span class="material-symbols-outlined text-base">send</span>
              <span>Transmit Immediate SOS to PHC</span>
            `;
          }
        });
      }

      // WhatsApp Share Handler
      const waBtn = overlay.querySelector("#btn-whatsapp-sos-share");
      if (waBtn) {
        waBtn.addEventListener("click", () => {
          const reasonInput = overlay.querySelector("#sos-emergency-reason");
          const reason = reasonInput ? reasonInput.value.trim() : "Urgent medical assistance requested";
          const msg = `🚨 *EMERGENCY ASHA HEALTH SOS*\n*Location:* ${detectedLocation}\n*Clinical Reason:* ${reason}\n*Source:* Sukanya ASHA Digital Assistant`;
          const url = `https://wa.me/?text=${encodeURIComponent(msg)}`;
          window.open(url, "_blank");
        });
      }
    }

    // Geolocation detection
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude.toFixed(4);
          const lng = pos.coords.longitude.toFixed(4);
          detectedLocation = `GPS: ${lat}° N, ${lng}° E • Rampur Sector`;
          const locEl = overlay.querySelector("#sos-location-text");
          if (locEl) locEl.textContent = detectedLocation;
        },
        () => {
          detectedLocation = "Rampur Sub-Center Catchment Area";
          const locEl = overlay.querySelector("#sos-location-text");
          if (locEl) locEl.textContent = detectedLocation;
        },
        { timeout: 5000 }
      );
    }

    renderModalContent();
    document.body.appendChild(overlay);
    return overlay;
  }

  const SukanyaUI = { showToast, showBanner, openModal, openEmergencyHubModal, getEmergencyContacts, saveEmergencyContacts, requireAuthOrRedirect, showLoading, hideLoading, el };
  global.SukanyaUI = SukanyaUI;
  global.SakhiUI = SukanyaUI;
})(window);
