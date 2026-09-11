(function () {
  "use strict";

  const CONSENT_KEY = "mautcheck24_analytics_consent";
  const config = window.MAUTCHCHECK_ANALYTICS || {};
  const configured = /^phc_[A-Za-z0-9_-]+$/.test(config.apiKey || "");
  const pendingEvents = [];
  let loading = false;

  function cleanUrl(value) {
    try {
      const url = new URL(value, location.origin);
      return url.origin + url.pathname;
    } catch {
      return undefined;
    }
  }

  function loadPostHog() {
    if (!configured || loading || window.posthog?.__loaded) return;
    loading = true;
    const posthog = window.posthog = window.posthog || [];
    if (!posthog.__SV) {
      posthog._i = [];
      posthog.init = function (key, options, name) {
        const script = document.createElement("script");
        script.crossOrigin = "anonymous";
        script.async = true;
        script.src = options.api_host.replace(".i.posthog.com", "-assets.i.posthog.com") +
          "/static/array.js";
        document.head.appendChild(script);

        const instance = name ? (posthog[name] = []) : posthog;
        instance.people = instance.people || [];
        const methods = "init capture reset opt_in_capturing opt_out_capturing " +
          "has_opted_in_capturing has_opted_out_capturing set_config";
        methods.split(" ").forEach(function (method) {
          instance[method] = function () {
            instance.push([method].concat(Array.prototype.slice.call(arguments)));
          };
        });
        posthog._i.push([key, options, name]);
      };
      posthog.__SV = 1;
    }

    posthog.init(config.apiKey, {
      api_host: config.apiHost,
      ui_host: "https://eu.posthog.com",
      defaults: "2026-05-30",
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: true,
      disable_session_recording: false,
      session_recording: {
        // Formulareingaben verlassen den Browser nur vollständig maskiert.
        maskAllInputs: true,
        // Adressvorschläge und Rückmeldungen können Ortsangaben enthalten.
        maskTextSelector: ".suggestions, .address-help",
        // Die Kartenansicht kann eine Route räumlich erkennen lassen.
        blockSelector: "#map",
        // Geteilte Ergebnislinks enthalten Orte in der Query-String.
        maskCapturedNetworkRequestFn: function (request) {
          if (request?.name) request.name = request.name.split("?")[0];
          return request;
        },
      },
      person_profiles: "identified_only",
      persistence: "localStorage",
      respect_dnt: true,
      before_send: function (event) {
        if (!event?.properties) return event;
        event.properties.$current_url = cleanUrl(event.properties.$current_url);
        event.properties.$referrer = cleanUrl(event.properties.$referrer);
        delete event.properties.$initial_current_url;
        delete event.properties.$initial_referrer;
        return event;
      },
      loaded: function (loadedPostHog) {
        loadedPostHog.capture("$pageview", {
          $current_url: location.origin + location.pathname,
          page_path: location.pathname,
        });
        pendingEvents.splice(0).forEach(function (item) {
          loadedPostHog.capture(item.event, item.properties);
        });
      },
    });
  }

  function removeDialog() {
    document.getElementById("analytics-consent")?.remove();
  }

  function saveConsent(accepted) {
    localStorage.setItem(CONSENT_KEY, accepted ? "yes" : "no");
    removeDialog();
    if (accepted) loadPostHog();
    else if (window.posthog?.__loaded) {
      window.posthog.stopSessionRecording?.();
      window.posthog.opt_out_capturing();
      window.posthog.reset();
    }
  }

  function showDialog(settingsMode) {
    if (!configured) return;
    removeDialog();
    const dialog = document.createElement("section");
    dialog.id = "analytics-consent";
    dialog.className = "analytics-consent";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-label", "Analyse-Einstellungen");
    dialog.innerHTML = `
      <div>
        <strong>${settingsMode ? "Analyse-Einstellungen" : "Hilf uns, mautcheck24 zu verbessern"}</strong>
        <p>Mit deiner Zustimmung erfassen wir pseudonymisiert die Nutzung und eine maskierte Sitzungswiedergabe. Eingaben, Adressvorschläge und die Karte werden verborgen. <a href="/datenschutz/">Mehr erfahren</a></p>
      </div>
      <div class="analytics-consent-actions">
        <button type="button" data-consent="no">Nur erforderlich</button>
        <button type="button" class="primary" data-consent="yes">Analyse erlauben</button>
      </div>`;
    dialog.addEventListener("click", function (event) {
      const choice = event.target.closest("[data-consent]")?.dataset.consent;
      if (choice) saveConsent(choice === "yes");
    });
    document.body.appendChild(dialog);
  }

  window.mautcheckAnalytics = {
    capture: function (event, properties) {
      if (localStorage.getItem(CONSENT_KEY) !== "yes") return;
      if (!window.posthog?.__loaded) {
        pendingEvents.push({ event: event, properties: properties || {} });
        loadPostHog();
        return;
      }
      window.posthog.capture(event, properties || {});
    },
    openSettings: function () { showDialog(true); },
  };

  document.addEventListener("DOMContentLoaded", function () {
    document.addEventListener("click", function (event) {
      if (event.target.closest("[data-analytics-settings]")) showDialog(true);
    });
    const consent = localStorage.getItem(CONSENT_KEY);
    if (consent === "yes") loadPostHog();
    else if (consent !== "no") showDialog(false);
  });
})();
