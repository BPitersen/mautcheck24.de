const VALHALLA = "https://valhalla1.openstreetmap.de";
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const PHOTON = "https://photon.komoot.io/api/";
const B_REF = /^B\s?\d+/;

// ---------- Karte ----------
const map = L.map("map").setView([51.16, 10.45], 6);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);
let routeLayer = L.layerGroup().addTo(map);
let selectionLayer = L.layerGroup().addTo(map);
let constrLayer = L.layerGroup().addTo(map);
const constrIcon = L.divIcon({ className: "constr-icon", html: "🚧", iconSize: [22, 22], iconAnchor: [11, 11] });

// Kartengröße nach Fenster-/Orientierungswechsel neu berechnen (verhindert graue Kacheln)
window.addEventListener("resize", () => map.invalidateSize());

// ---------- Fahrzeug-Dropdown ----------
const vehicleSel = document.getElementById("vehicle");
for (const [key, v] of Object.entries(VEHICLES)) {
  vehicleSel.add(new Option(v.label, key));
}
vehicleSel.value = "a5";

// ---------- Adresssuche (explizit, Nominatim-konform) ----------
const geocodeCache = new Map();
const autocompleteCache = new Map();
let geocodeQueue = Promise.resolve();
let lastGeocodeAt = 0;
let autocompleteQueue = Promise.resolve();
let lastAutocompleteAt = 0;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function searchAddress(q, limit = 5) {
  const key = q.trim().toLocaleLowerCase("de-DE");
  if (geocodeCache.has(key)) return Promise.resolve(geocodeCache.get(key).slice(0, limit));

  const run = async () => {
    const pause = Math.max(0, 1000 - (Date.now() - lastGeocodeAt));
    if (pause) await wait(pause);
    lastGeocodeAt = Date.now();
    const url = `${NOMINATIM}?format=jsonv2&addressdetails=1&countrycodes=de&limit=${limit}&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { "Accept-Language": "de" } });
    if (!res.ok) throw new Error(`Adresssuche: HTTP ${res.status}`);
    const hits = await res.json();
    geocodeCache.set(key, hits);
    return hits;
  };
  geocodeQueue = geocodeQueue.then(run, run);
  return geocodeQueue;
}

function autocompleteAddress(q) {
  const key = q.trim().toLocaleLowerCase("de-DE");
  if (autocompleteCache.has(key)) return Promise.resolve(autocompleteCache.get(key));

  const run = async () => {
    const pause = Math.max(0, 750 - (Date.now() - lastAutocompleteAt));
    if (pause) await wait(pause);
    lastAutocompleteAt = Date.now();
    const url = `${PHOTON}?q=${encodeURIComponent(q)}&lang=de&limit=5&countrycode=DE`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Autocomplete: HTTP ${res.status}`);
    const data = await res.json();
    const hits = (data.features || []).map((feature) => {
      const p = feature.properties || {};
      const [lon, lat] = feature.geometry?.coordinates || [];
      const locality = p.city || p.locality || p.district || (p.type === "city" ? p.name : "") || p.county || "";
      return {
        lat, lon,
        name: p.name,
        display_name: [p.name, p.street, p.housenumber, p.postcode, locality, p.state, p.country]
          .filter(Boolean).join(", "),
        address: {
          road: p.street || (p.type === "street" ? p.name : ""),
          house_number: p.housenumber,
          postcode: p.postcode,
          city: locality || (p.type === "city" ? p.name : ""),
          state: p.state,
        },
      };
    }).filter((hit) => Number.isFinite(hit.lat) && Number.isFinite(hit.lon));
    autocompleteCache.set(key, hits);
    return hits;
  };
  autocompleteQueue = autocompleteQueue.then(run, run);
  return autocompleteQueue;
}

function addressParts(hit) {
  const a = hit.address || {};
  const locality = a.city || a.town || a.village || a.municipality || a.hamlet || "";
  const street = [a.road || a.pedestrian, a.house_number].filter(Boolean).join(" ");
  const primary = street || locality || hit.name || hit.display_name.split(",")[0];
  const secondary = [...new Set([a.postcode, locality !== primary ? locality : "", a.state].filter(Boolean))].join(" · ");
  const locationLine = [a.postcode, locality].filter(Boolean).join(" ");
  const value = street
    ? [primary, locationLine].filter(Boolean).join(", ")
    : [primary, a.postcode].filter(Boolean).join(", ");
  return { primary, secondary, value };
}

function locationIcon(label, kind) {
  return L.divIcon({
    className: `location-pin ${kind}`,
    html: `<span><b>${label}</b></span>`,
    iconSize: [30, 38],
    iconAnchor: [15, 38],
    popupAnchor: [0, -34],
  });
}

function showSelectedLocations(focusState = null) {
  selectionLayer.clearLayers();
  const selected = [
    { state: startState, label: "A", kind: "start", name: "Start" },
    { state: destState, label: "B", kind: "dest", name: "Ziel" },
  ].filter((item) => item.state.coord);
  for (const item of selected) {
    L.marker([item.state.coord.lat, item.state.coord.lon], { icon: locationIcon(item.label, item.kind) })
      .addTo(selectionLayer).bindPopup(`<b>${item.name}</b><br>${item.state.label || ""}`);
  }
  if (selected.length === 2) {
    map.fitBounds(L.latLngBounds(selected.map((item) => [item.state.coord.lat, item.state.coord.lon])), {
      padding: [60, 60], maxZoom: 12,
    });
  } else if (focusState?.coord) {
    map.flyTo([focusState.coord.lat, focusState.coord.lon], 12, {
      animate: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    });
  }
}

function setupAddressSearch(inputId, sugId, searchId, helpId) {
  const input = document.getElementById(inputId);
  const sug = document.getElementById(sugId);
  const searchBtn = document.getElementById(searchId);
  const help = document.getElementById(helpId);
  const field = input.closest(".autocomplete");
  const state = { coord: null, label: "" };
  let activeIndex = -1;
  let resultButtons = [];
  let autocompleteTimer = null;
  let searchVersion = 0;

  input.addEventListener("input", () => {
    clearTimeout(autocompleteTimer);
    const version = ++searchVersion;
    state.coord = null;
    state.label = "";
    field.classList.remove("is-valid");
    const q = input.value.trim();
    help.textContent = q.length >= 3
      ? "Vorschläge werden geladen …"
      : "Mindestens 3 Zeichen eingeben";
    closeSuggestions();
    showSelectedLocations();
    if (q.length >= 3) {
      autocompleteTimer = setTimeout(async () => {
        try {
          const hits = await autocompleteAddress(q);
          if (version !== searchVersion || input.value.trim() !== q) return;
          renderHits(hits, false);
        } catch {
          if (version === searchVersion) help.textContent = "Keine Vorschläge · Enter für genaue Suche";
        }
      }, 350);
    }
  });

  function closeSuggestions() {
    sug.classList.remove("open");
    input.setAttribute("aria-expanded", "false");
    activeIndex = -1;
    resultButtons = [];
  }

  function setActive(index) {
    if (!resultButtons.length) return;
    activeIndex = (index + resultButtons.length) % resultButtons.length;
    resultButtons.forEach((button, i) => {
      button.classList.toggle("active", i === activeIndex);
      button.setAttribute("aria-selected", i === activeIndex ? "true" : "false");
    });
    resultButtons[activeIndex].scrollIntoView({ block: "nearest" });
  }

  function choose(hit) {
    clearTimeout(autocompleteTimer);
    searchVersion++;
    const parts = addressParts(hit);
    input.value = parts.value;
    state.coord = { lat: +hit.lat, lon: +hit.lon };
    state.label = [parts.primary, parts.secondary].filter(Boolean).join(", ");
    field.classList.add("is-valid");
    help.textContent = "Adresse erkannt und auf der Karte markiert";
    closeSuggestions();
    showSelectedLocations(state);
  }

  function renderHits(hits, chooseSingle) {
    sug.innerHTML = "";
    for (const hit of hits) {
      const parts = addressParts(hit);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "suggestion-option";
      button.setAttribute("role", "option");
      const primary = document.createElement("strong");
      primary.textContent = parts.primary;
      const secondary = document.createElement("span");
      secondary.textContent = parts.secondary || "Deutschland";
      button.append(primary, secondary);
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => choose(hit));
      sug.appendChild(button);
    }
    resultButtons = [...sug.querySelectorAll(".suggestion-option")];
    if (chooseSingle && resultButtons.length === 1) {
      choose(hits[0]);
    } else if (resultButtons.length) {
      sug.classList.add("open");
      input.setAttribute("aria-expanded", "true");
      help.textContent = `${resultButtons.length} passende Adressen gefunden`;
      setActive(0);
    } else {
      help.textContent = "Keine Adresse gefunden – ergänze Ort oder Postleitzahl";
    }
  }

  async function runSearch() {
    clearTimeout(autocompleteTimer);
    searchVersion++;
    const q = input.value.trim();
    if (q.length < 3) {
      help.textContent = "Bitte mindestens 3 Zeichen eingeben";
      input.focus();
      return;
    }
    searchBtn.disabled = true;
    field.classList.add("is-loading");
    help.textContent = "Adresse wird gesucht …";
    closeSuggestions();
    try {
      const hits = await searchAddress(q);
      renderHits(hits, true);
    } catch {
      help.textContent = "Adresssuche gerade nicht erreichbar – bitte erneut versuchen";
    } finally {
      searchBtn.disabled = false;
      field.classList.remove("is-loading");
    }
  }

  searchBtn.addEventListener("click", runSearch);
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" && resultButtons.length) {
      event.preventDefault(); setActive(activeIndex + 1);
    } else if (event.key === "ArrowUp" && resultButtons.length) {
      event.preventDefault(); setActive(activeIndex - 1);
    } else if (event.key === "Escape") {
      closeSuggestions();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (activeIndex >= 0 && resultButtons[activeIndex]) resultButtons[activeIndex].click();
      else runSearch();
    }
  });
  input.addEventListener("blur", () => setTimeout(closeSuggestions, 250));
  return state;
}
const startState = setupAddressSearch("start", "start-sug", "start-search", "start-help");
const destState = setupAddressSearch("dest", "dest-sug", "dest-search", "dest-help");

async function geocodeFallback(q) {
  const hits = await searchAddress(q, 1);
  if (!hits.length) throw new Error(`Adresse nicht gefunden: „${q}“`);
  return { lat: +hits[0].lat, lon: +hits[0].lon };
}

// ---------- Polyline6-Decoder ----------
function decodeShape(str) {
  const coords = []; let i = 0, lat = 0, lon = 0;
  while (i < str.length) {
    for (const which of [0, 1]) {
      let shift = 0, result = 0, b;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += d; else lon += d;
    }
    coords.push([lat / 1e6, lon / 1e6]);
  }
  return coords;
}

async function valhalla(path, payload) {
  const res = await fetch(VALHALLA + path, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Routing-Server: HTTP ${res.status}`);
  return res.json();
}

const havKm = ([la1, lo1], [la2, lo2]) => {
  const r = Math.PI / 180, dla = (la2 - la1) * r, dlo = (lo2 - lo1) * r;
  const h = Math.sin(dla / 2) ** 2 +
    Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dlo / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

function fetchRoute(a, b, veh) {
  return valhalla("/route", {
    locations: [{ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon }],
    costing: "truck",
    costing_options: { truck: {
      weight: veh.weight, axle_count: veh.axles,
      height: veh.height, width: 2.55, length: veh.length,
      // Feldwege (highway=track), Wohnstraßen-Durchfahrten und Erschließungswege meiden.
      use_tracks: 0, use_living_streets: 0, service_penalty: 100, service_factor: 1.5,
    } },
    units: "kilometers",
    alternates: 2,
  });
}

// Route analysieren: Kanten klassifizieren (Autobahn / Bundesstraße / mautfrei)
// + Lkw-Fahrzeit: max. 90 km/h auf Autobahn, sonst max. 60 km/h (>7,5t außerorts)
async function analyzeTrip(trip) {
  const shape = trip.legs.flatMap((l) => decodeShape(l.shape));

  // trace_attributes erlaubt max. 1000 km Pfadlänge und max. 16000 Shape-Punkte
  // -> Route in Stücke von ~900 km / 15000 Punkten teilen
  const chunks = [];
  let cur = [shape[0]], curKm = 0;
  for (let i = 1; i < shape.length; i++) {
    curKm += havKm(shape[i - 1], shape[i]);
    cur.push(shape[i]);
    if (curKm > 900 || cur.length >= 15000) { chunks.push(cur); cur = [shape[i]]; curKm = 0; }
  }
  if (cur.length > 1) chunks.push(cur);

  let kmAb = 0, kmBs = 0, kmFree = 0, driveH = 0, minorKm = 0;
  let cumKm = 0, throughMinorKm = 0;
  const throughMinor = [];
  const totalKm = trip.summary.length;
  const MINOR = ["unclassified", "residential", "service", "track", "living_street"];
  const segments = { ab: [], bs: [], free: [] };
  for (const chunk of chunks) {
    const ta = await valhalla("/trace_attributes", {
      shape: chunk.map(([lat, lon]) => ({ lat, lon })),
      costing: "truck", shape_match: "edge_walk",
      filters: { attributes: ["edge.length", "edge.road_class", "edge.names", "edge.speed",
        "edge.begin_shape_index", "edge.end_shape_index", "shape"], action: "include" },
    });
    const taShape = decodeShape(ta.shape);
    for (const e of ta.edges) {
      const names = e.names || [];
      const isAb = e.road_class === "motorway";
      const isBs = !isAb && names.some((n) => B_REF.test(n));
      const kind = isAb ? "ab" : isBs ? "bs" : "free";
      if (kind === "ab") kmAb += e.length;
      else if (kind === "bs") kmBs += e.length;
      else kmFree += e.length;
      const isMinor = MINOR.includes(e.road_class);
      if (isMinor) minorKm += e.length;
      const truckSpeed = Math.min(e.speed || 50, isAb ? 90 : 60);
      driveH += e.length / truckSpeed;
      const pts = taShape.slice(e.begin_shape_index, e.end_shape_index + 1);
      if (pts.length > 1) segments[kind].push(pts);
      // durchgehende Nebenstraßen (ohne erste/letzte Meile) für die Umleitung merken
      const midCum = cumKm + e.length / 2;
      cumKm += e.length;
      if (isMinor && pts.length && midCum > 1.5 && midCum < totalKm - 1.5) {
        throughMinorKm += e.length;
        throughMinor.push(pts[Math.floor(pts.length / 2)]);
      }
    }
  }
  return { shape, kmAb, kmBs, kmFree, driveH, minorKm, throughMinorKm, throughMinor,
    segments, km: trip.summary.length };
}

// Baustellen/Sperrungen (highway=construction) im Kartenausschnitt via Overpass anzeigen.
// Läuft asynchron nach der Routenanzeige und blockiert die Berechnung nicht.
async function showConstruction(routeShape, routeKm) {
  constrLayer.clearLayers();
  if (routeKm > 120) return; // bei langen Routen unpraktisch (riesiger Ausschnitt / Overpass-Last)
  let s = 90, w = 180, n = -90, e = -180;
  for (const [la, lo] of routeShape) {
    s = Math.min(s, la); n = Math.max(n, la); w = Math.min(w, lo); e = Math.max(e, lo);
  }
  const pad = 0.02; // ~2 km Puffer
  const q = `[out:json][timeout:25];way["highway"="construction"]` +
    `(${s - pad},${w - pad},${n + pad},${e + pad});out geom;`;
  const res = await fetch("https://overpass-api.de/api/interpreter",
    { method: "POST", body: "data=" + encodeURIComponent(q) });
  if (!res.ok) return;
  const data = await res.json();
  const showAll = routeKm < 60; // kurze Route: alles im Ausschnitt; sonst nur nahe der Route
  const sample = showAll ? [] : routeShape.filter((_, i) => i % 8 === 0); // Filter beschleunigen
  let count = 0;
  const seen = new Set();
  for (const el of data.elements || []) {
    const g = el.geometry;
    if (!g || !g.length) continue;
    if (!showAll) {
      let near = false;
      outer: for (const p of g) {
        for (const [la, lo] of sample) {
          if (havKm([p.lat, p.lon], [la, lo]) < 2) { near = true; break outer; }
        }
      }
      if (!near) continue;
    }
    const name = (el.tags && el.tags.name) || "Straße";
    if (seen.has(name) && name !== "Straße") continue; // je Straßenname nur ein Marker
    seen.add(name);
    const mid = g[Math.floor(g.length / 2)];
    L.marker([mid.lat, mid.lon], { icon: constrIcon }).addTo(constrLayer)
      .bindPopup(`🚧 <b>${name}</b><br>Baustelle / gesperrt (OSM)`);
    if (++count >= 40) break;
  }
}

// ---------- Hauptlogik ----------
const $ = (id) => document.getElementById(id);
const fmtKm = (km) => km.toLocaleString("de-DE", { maximumFractionDigits: 1 }) + " km";
const fmtEur = (v) => v.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const fmtH = (x) => { const hh = Math.floor(x), mm = Math.round((x - hh) * 60);
  return hh ? `${hh} h ${mm} min` : `${mm} min`; };

$("go").addEventListener("click", calc);
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.target.closest(".autocomplete")) calc();
});
$("share-print").addEventListener("click", () => window.print());
$("edit-inputs").addEventListener("click", () => {
  $("panel").scrollTo({
    top: 0,
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
  });
  $("start").focus({ preventScroll: true });
});
$("share-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(buildShareUrl());
    $("share-status").textContent = "Link wurde kopiert.";
  } catch {
    $("share-status").textContent = "Link konnte nicht kopiert werden.";
  }
});

// Start und Ziel tauschen (Werte + hinterlegte Koordinaten); bei sichtbarer Route neu rechnen
$("swap").addEventListener("click", () => {
  const si = $("start"), di = $("dest");
  [si.value, di.value] = [di.value, si.value];
  [startState.coord, destState.coord] = [destState.coord, startState.coord];
  [startState.label, destState.label] = [destState.label, startState.label];
  si.closest(".autocomplete").classList.toggle("is-valid", !!startState.coord);
  di.closest(".autocomplete").classList.toggle("is-valid", !!destState.coord);
  $("start-help").textContent = startState.coord ? "Adresse erkannt und auf der Karte markiert" : "Tippen für Vorschläge · Enter für genaue Suche";
  $("dest-help").textContent = destState.coord ? "Adresse erkannt und auf der Karte markiert" : "Tippen für Vorschläge · Enter für genaue Suche";
  showSelectedLocations();
  if (!$("result").hidden) calc();
});

async function calc() {
  const status = $("status");
  const btn = $("go");
  const startQ = $("start").value.trim();
  const destQ = $("dest").value.trim();
  if (!startQ || !destQ) { status.textContent = "Bitte Start und Ziel eingeben."; return; }

  btn.disabled = true;
  status.className = "working";
  document.querySelectorAll(".suggestions").forEach((s) => s.classList.remove("open"));
  $("result").hidden = true;

  try {
    status.textContent = "Suche Adressen …";
    const a = startState.coord || (await geocodeFallback(startQ));
    const b = destState.coord || (await geocodeFallback(destQ));
    startState.coord = a; startState.label ||= startQ;
    destState.coord = b; destState.label ||= destQ;
    $("start").closest(".autocomplete").classList.add("is-valid");
    $("dest").closest(".autocomplete").classList.add("is-valid");
    showSelectedLocations();

    const veh = VEHICLES[vehicleSel.value];
    status.textContent = "Berechne Lkw-Route …";

    const mainRes = await fetchRoute(a, b, veh);
    const co2Class = $("co2").value;
    const rate = tollRate(vehicleSel.value, co2Class);

    status.textContent = "Analysiere Route …";
    let main = await analyzeTrip(mainRes.trip);

    // Läuft die schnellste Route als Durchfahrt über enge Nebenstraßen? Dann unter Valhallas
    // eigenen Alternativen die mit den wenigsten durchgehenden Nebenstraßen wählen (sichere,
    // vorhersehbare Auswahl – keine künstlichen Umleitungen).
    if (main.throughMinorKm > 0.8 && (mainRes.alternates || []).length) {
      status.textContent = "Prüfe besser ausgebaute Alternativen …";
      const cands = [main];
      for (const alt of mainRes.alternates) cands.push(await analyzeTrip(alt.trip));
      const minTime = Math.min(...cands.map((c) => c.driveH));
      main = cands
        .filter((c) => c.driveH <= minTime * 1.3)
        .reduce((best, c) =>
          c.throughMinorKm < best.throughMinorKm - 0.3 ? c
            : best.throughMinorKm < c.throughMinorKm - 0.3 ? best
            : c.driveH < best.driveH ? c : best);
    }
    main.toll = (main.kmAb + main.kmBs) * rate;

    // Lenk- und Ruhezeiten nach EU-VO 561/2006:
    // 45 min Pause je volle 4,5 h Lenkzeit (teilbar in 15 + 30 min),
    // 9 h Tageslenkzeit, 2x/Woche auf 10 h verlängerbar, dann 11 h Tagesruhe
    let remaining = main.driveH, days = 0, breaks45 = 0, extDays = 0, rests = 0;
    while (remaining > 0.005) {
      days++;
      const cap = remaining > 9 && extDays < 2 ? 10 : 9;
      const d = Math.min(remaining, cap);
      if (d > 9) extDays++;
      breaks45 += Math.floor((d - 0.01) / 4.5);
      remaining -= d;
      if (remaining > 0.005) rests++;
    }
    const totalH = main.driveH + breaks45 * 0.75 + rests * 11;

    // Karte zeichnen
    routeLayer.clearLayers();
    L.polyline(main.shape, { color: "#2f6fe4", weight: 5, opacity: 0.85 }).addTo(routeLayer);
    for (const pts of main.segments.ab)
      L.polyline(pts, { color: "#e8641b", weight: 5, opacity: 0.95 }).addTo(routeLayer);
    for (const pts of main.segments.bs)
      L.polyline(pts, { color: "#e8a51b", weight: 5, opacity: 0.95 }).addTo(routeLayer);
    map.fitBounds(L.latLngBounds(main.shape), { padding: [40, 40] });

    // Baustellen im Ausschnitt nachladen (nicht-blockierend)
    showConstruction(main.shape, main.km).catch(() => {});

    // Ergebnis anzeigen
    const parts = [];
    if (breaks45 > 0) parts.push(`${breaks45} × 45 min Pause (teilbar 15 + 30 min)`);
    if (rests > 0) parts.push(`${rests} × 11 h Tagesruhe`);
    if (extDays > 0) parts.push(`${extDays} × 10-h-Tag genutzt (max. 2/Woche)`);
    if (days > 1) parts.push(`${days} Fahrtage`);
    $("r-breaks").textContent = parts.length
      ? `inkl. Lenk- & Ruhezeiten: ca. ${fmtH(totalH)} (${parts.join(", ")})`
      : "keine Pause nötig (unter 4,5 h Lenkzeit)";

    $("r-toll").textContent = fmtEur(main.toll);
    $("r-rate").textContent = `${(rate * 100).toFixed(1).replace(".", ",")} ct/km auf ${fmtKm(main.kmAb + main.kmBs)}`;
    $("r-dist").textContent = fmtKm(main.km);
    $("r-time").textContent = fmtH(main.driveH);
    $("r-tollkm").textContent = fmtKm(main.kmAb + main.kmBs);
    $("r-ab").textContent = fmtKm(main.kmAb);
    $("r-bs").textContent = fmtKm(main.kmBs);
    $("r-free").textContent = fmtKm(main.kmFree);

    $("result").hidden = false;
    updateShareLinks();
    history.replaceState(null, "", buildShareUrl());
    status.textContent = "";

    // Ergebnisdetails im eigenen Panel sichtbar machen. Die Karte und die Seite
    // behalten ihre Position; bei reduzierter Bewegung wird nicht animiert.
    requestAnimationFrame(() => {
      const panel = $("panel");
      const result = $("result");
      const panelRect = panel.getBoundingClientRect();
      const resultRect = result.getBoundingClientRect();
      panel.scrollTo({
        top: Math.max(0, panel.scrollTop + resultRect.top - panelRect.top - 18),
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    });
  } catch (err) {
    status.className = "";
    status.textContent = err.message || "Fehler bei der Berechnung.";
  } finally {
    btn.disabled = false;
  }
}

function buildShareUrl() {
  const url = new URL(location.origin + location.pathname);
  url.searchParams.set("start", $("start").value.trim());
  url.searchParams.set("ziel", $("dest").value.trim());
  url.searchParams.set("fahrzeug", vehicleSel.value);
  url.searchParams.set("co2", $("co2").value);
  return url.toString();
}

function updateShareLinks() {
  const url = buildShareUrl();
  const text = `Meine Lkw-Mautberechnung: ${$("r-toll").textContent} für ${$("start").value.trim()} – ${$("dest").value.trim()}`;
  $("share-whatsapp").href = `https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`;
  $("share-email").href = `mailto:?subject=${encodeURIComponent("Lkw-Mautberechnung")}&body=${encodeURIComponent(`${text}\n\n${url}`)}`;
  $("share-status").textContent = "";
}

// Vorbelegung für Landingpages und teilbare Links. Nur bekannte Presets übernehmen.
const initialParams = new URLSearchParams(location.search);
if (initialParams.has("start")) $("start").value = initialParams.get("start").slice(0, 200);
if (initialParams.has("ziel")) $("dest").value = initialParams.get("ziel").slice(0, 200);
if (VEHICLES[initialParams.get("fahrzeug")]) vehicleSel.value = initialParams.get("fahrzeug");
if (["1", "2", "3", "4", "5"].includes(initialParams.get("co2"))) $("co2").value = initialParams.get("co2");
if ($("start").value && $("dest").value) calc();
