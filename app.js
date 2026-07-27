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
const dimensionInputs = {
  weight: document.getElementById("truck-weight"),
  height: document.getElementById("truck-height"),
  width: document.getElementById("truck-width"),
  length: document.getElementById("truck-length"),
};

function syncVehicleDimensions() {
  const vehicle = VEHICLES[vehicleSel.value];
  dimensionInputs.weight.value = vehicle.weight;
  dimensionInputs.height.value = vehicle.height;
  dimensionInputs.width.value = 2.55;
  dimensionInputs.length.value = vehicle.length;
}

function selectedVehicleProfile() {
  const preset = VEHICLES[vehicleSel.value];
  const number = (input, fallback) => input.checkValidity() && input.value !== ""
    ? Number(input.value) : fallback;
  return {
    ...preset,
    weight: number(dimensionInputs.weight, preset.weight),
    height: number(dimensionInputs.height, preset.height),
    width: number(dimensionInputs.width, 2.55),
    length: number(dimensionInputs.length, preset.length),
  };
}

vehicleSel.addEventListener("change", syncVehicleDimensions);
syncVehicleDimensions();

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
    ...waypointEntries.map((entry, index) => ({
      state: entry.state, label: String(index + 1), kind: "stop", name: `Zwischenstopp ${index + 1}`,
    })),
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
    help.textContent = "";
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
const $ = (id) => document.getElementById(id);
const startState = setupAddressSearch("start", "start-sug", "start-search", "start-help");
const destState = setupAddressSearch("dest", "dest-sug", "dest-search", "dest-help");
const waypointEntries = [];
const MAX_WAYPOINTS = 3;
let waypointSequence = 0;

function addWaypoint(value = "") {
  if (waypointEntries.length >= MAX_WAYPOINTS) return;
  const id = `waypoint-${++waypointSequence}`;
  const wrapper = document.createElement("div");
  wrapper.className = "field autocomplete waypoint-field";
  wrapper.innerHTML = `
    <label for="${id}">Zwischenstopp ${waypointEntries.length + 1}</label>
    <div class="address-input">
      <input id="${id}" type="text" placeholder="Adresse oder Ort" autocomplete="off"
             aria-describedby="${id}-help" aria-expanded="false" aria-controls="${id}-sug">
      <button type="button" class="address-search" id="${id}-search"
              aria-label="Zwischenstopp suchen" title="Zwischenstopp suchen">⌕</button>
    </div>
    <p class="address-help" id="${id}-help"></p>
    <div class="suggestions" id="${id}-sug" role="listbox" aria-label="Zwischenstopps"></div>
    <button type="button" class="waypoint-remove" aria-label="Zwischenstopp entfernen"
            title="Zwischenstopp entfernen">×</button>`;
  document.getElementById("waypoints").appendChild(wrapper);
  const state = setupAddressSearch(id, `${id}-sug`, `${id}-search`, `${id}-help`);
  const entry = { wrapper, input: wrapper.querySelector("input"), state };
  waypointEntries.push(entry);
  entry.input.value = value.slice(0, 200);
  wrapper.querySelector(".waypoint-remove").addEventListener("click", () => {
    const index = waypointEntries.indexOf(entry);
    if (index >= 0) waypointEntries.splice(index, 1);
    wrapper.remove();
    refreshWaypointLabels();
    showSelectedLocations();
  });
  refreshWaypointLabels();
  if (!value) entry.input.focus();
  return entry;
}

function refreshWaypointLabels() {
  waypointEntries.forEach((entry, index) => {
    entry.wrapper.querySelector("label").textContent = `Zwischenstopp ${index + 1}`;
  });
  document.getElementById("add-waypoint").hidden = waypointEntries.length >= MAX_WAYPOINTS;
}

document.getElementById("add-waypoint").addEventListener("click", () => addWaypoint());

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
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.error || `Routing-Server: HTTP ${res.status}`);
  }
  return res.json();
}

const havKm = ([la1, lo1], [la2, lo2]) => {
  const r = Math.PI / 180, dla = (la2 - la1) * r, dlo = (lo2 - lo1) * r;
  const h = Math.sin(dla / 2) ** 2 +
    Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dlo / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

function fetchRoute(points, veh, avoidLocations = []) {
  const request = {
    locations: points.map(({ lat, lon }) => ({ lat, lon })),
    costing: "truck",
    costing_options: { truck: {
      weight: veh.weight, axle_count: veh.axles,
      height: veh.height, width: veh.width, length: veh.length,
      // Hauptstraßen bevorzugen; Zufahrten zu Start, Ziel und Stopps bleiben erreichbar.
      use_highways: 1, use_tolls: 1, use_tracks: 0, use_living_streets: 0,
      exclude_unpaved: true, shortest: false, maneuver_penalty: 30,
      service_penalty: 7200, service_factor: 50,
      private_access_penalty: 7200, gate_penalty: 7200,
    } },
    units: "kilometers",
  };
  if (avoidLocations.length) {
    request.avoid_locations = avoidLocations.map(([lat, lon]) => ({ lat, lon }));
  }
  // Valhalla unterstützt Alternativrouten nur bei einer direkten A–B-Route.
  if (points.length === 2) request.alternates = 2;
  return valhalla("/route", request);
}

// Route analysieren: Kanten klassifizieren (Autobahn / Bundesstraße / mautfrei)
// + Lkw-Fahrzeit: max. 90 km/h auf Autobahn, sonst max. 60 km/h (>7,5t außerorts)
async function analyzeTrip(trip) {
  const shape = trip.legs.flatMap((leg, index) => {
    const points = decodeShape(leg.shape);
    return index ? points.slice(1) : points;
  });

  // Die öffentliche Instanz begrenzt trace_attributes auf rund 200 km.
  // -> Route in Stücke von ~180 km / 15000 Punkten teilen
  const chunks = [];
  let cur = [shape[0]], curKm = 0;
  for (let i = 1; i < shape.length; i++) {
    curKm += havKm(shape[i - 1], shape[i]);
    cur.push(shape[i]);
    if (curKm > 180 || cur.length >= 15000) { chunks.push(cur); cur = [shape[i]]; curKm = 0; }
  }
  if (cur.length > 1) chunks.push(cur);

  let kmAb = 0, kmBs = 0, kmFree = 0, driveH = 0, minorKm = 0;
  let cumKm = 0, throughMinorKm = 0;
  const throughMinor = [];
  const totalKm = trip.summary.length;
  const MAIN_ROADS = new Set(["motorway", "trunk", "primary", "secondary", "tertiary"]);
  const breakKm = [0];
  for (const leg of trip.legs) breakKm.push(breakKm.at(-1) + leg.summary.length);
  const ACCESS_ZONE_KM = 2;
  const segments = { ab: [], bs: [], free: [] };
  for (const chunk of chunks) {
    const ta = await valhalla("/trace_attributes", {
      shape: chunk.map(([lat, lon]) => ({ lat, lon })),
      costing: "truck", shape_match: trip.legs.length > 1 ? "walk_or_snap" : "edge_walk",
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
      const isMinor = Boolean(e.road_class) && !MAIN_ROADS.has(e.road_class);
      if (isMinor) minorKm += e.length;
      const truckSpeed = Math.min(e.speed || 50, isAb ? 90 : 60);
      driveH += e.length / truckSpeed;
      const pts = taShape.slice(e.begin_shape_index, e.end_shape_index + 1);
      if (pts.length > 1) segments[kind].push(pts);
      // Nebenstraßen nur außerhalb der notwendigen Zufahrt zu jedem Stopp beanstanden.
      const midCum = cumKm + e.length / 2;
      cumKm += e.length;
      const nearRoutePoint = breakKm.some((routePointKm) =>
        Math.abs(midCum - routePointKm) <= ACCESS_ZONE_KM);
      if (isMinor && pts.length && !nearRoutePoint && midCum < totalKm) {
        throughMinorKm += e.length;
        throughMinor.push(pts[Math.floor(pts.length / 2)]);
      }
    }
  }
  return { shape, kmAb, kmBs, kmFree, driveH, minorKm, throughMinorKm, throughMinor,
    segments, km: trip.summary.length };
}

async function selectMainRoadRoute(routeResponse) {
  const candidates = [await analyzeTrip(routeResponse.trip)];
  for (const alternative of routeResponse.alternates || []) {
    candidates.push(await analyzeTrip(alternative.trip));
  }
  const fastest = Math.min(...candidates.map((candidate) => candidate.driveH));
  const reasonable = candidates.filter((candidate) => candidate.driveH <= fastest * 1.45);

  // Zuerst echte Nebenstraßen auf dem Hauptweg vermeiden. Kleine Unterschiede
  // innerhalb der notwendigen Zufahrt zu Start/Ziel/Stopps gelten als gleichwertig.
  const leastThroughMinor = Math.min(...reasonable.map((candidate) => candidate.throughMinorKm));
  const mainRoadRoutes = reasonable.filter(
    (candidate) => candidate.throughMinorKm <= leastThroughMinor + 0.15);
  const leastMinor = Math.min(...mainRoadRoutes.map((candidate) => candidate.minorKm));
  const comparableRoads = mainRoadRoutes.filter(
    (candidate) => candidate.minorKm <= leastMinor + 0.3);

  // Bei praktisch gleicher Fahrzeit ist eine deutlich kürzere Route sinnvoller:
  // Sie verbraucht weniger Kraftstoff und ist häufig auch weniger mautpflichtig.
  // Erst ab mehr als fünf Minuten Zeitvorteil gewinnt wieder die schnellere Route.
  const fastestComparable = Math.min(...comparableRoads.map((candidate) => candidate.driveH));
  const nearEqualTime = comparableRoads.filter(
    (candidate) => candidate.driveH <= fastestComparable + 5 / 60);
  return nearEqualTime.reduce((best, candidate) => {
    if (candidate.km < best.km - 0.5) return candidate;
    if (best.km < candidate.km - 0.5) return best;
    return candidate.driveH < best.driveH ? candidate : best;
  });
}

function spacedAvoidLocations(points, limit = 12) {
  const selected = [];
  for (const point of points) {
    if (selected.every((existing) => havKm(existing, point) > 0.35)) selected.push(point);
    if (selected.length >= limit) break;
  }
  return selected;
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
  $("start-help").textContent = "";
  $("dest-help").textContent = "";
  showSelectedLocations();
  if (!$("result").hidden) calc();
});

async function calc() {
  const status = $("status");
  const btn = $("go");
  const startQ = $("start").value.trim();
  const destQ = $("dest").value.trim();
  if (!startQ || !destQ) { status.textContent = "Bitte Start und Ziel eingeben."; return; }
  if (waypointEntries.some((entry) => !entry.input.value.trim())) {
    status.textContent = "Bitte den Zwischenstopp eingeben oder entfernen.";
    return;
  }

  btn.disabled = true;
  status.className = "working";
  document.querySelectorAll(".suggestions").forEach((s) => s.classList.remove("open"));
  $("result").hidden = true;

  try {
    status.textContent = "Suche Adressen …";
    const a = startState.coord || (await geocodeFallback(startQ));
    const b = destState.coord || (await geocodeFallback(destQ));
    const stops = [];
    for (const entry of waypointEntries) {
      const query = entry.input.value.trim();
      const coord = entry.state.coord || (await geocodeFallback(query));
      entry.state.coord = coord;
      entry.state.label ||= query;
      stops.push(coord);
    }
    startState.coord = a; startState.label ||= startQ;
    destState.coord = b; destState.label ||= destQ;
    showSelectedLocations();

    const veh = selectedVehicleProfile();
    status.textContent = "Berechne Lkw-Route …";

    const routePoints = [a, ...stops, b];
    const mainRes = await fetchRoute(routePoints, veh);
    const co2Class = $("co2").value;
    const rate = tollRate(vehicleSel.value, co2Class);

    status.textContent = "Analysiere Route …";
    let main = await selectMainRoadRoute(mainRes);

    // Problematische Nebenstraßen außerhalb der Adresszufahrten gezielt ausschließen.
    // Zwei begrenzte Durchläufe verhindern Endlosschleifen und extreme Umwege.
    let avoidLocations = [];
    for (let attempt = 0; attempt < 2 && main.throughMinorKm > 0.35; attempt++) {
      avoidLocations = spacedAvoidLocations([...avoidLocations, ...main.throughMinor], 18);
      if (!avoidLocations.length) break;
      status.textContent = "Suche Route über besser ausgebaute Straßen …";
      try {
        const rerouted = await selectMainRoadRoute(
          await fetchRoute(routePoints, veh, avoidLocations));
        if (rerouted.throughMinorKm < main.throughMinorKm - 0.1 &&
            rerouted.driveH <= main.driveH * 1.5) {
          main = rerouted;
        } else {
          break;
        }
      } catch {
        break; // Zufahrten müssen erreichbar bleiben; ursprüngliche Route beibehalten.
      }
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
  waypointEntries.forEach((entry) => url.searchParams.append("stopp", entry.input.value.trim()));
  url.searchParams.set("fahrzeug", vehicleSel.value);
  url.searchParams.set("co2", $("co2").value);
  url.searchParams.set("gewicht", dimensionInputs.weight.value);
  url.searchParams.set("hoehe", dimensionInputs.height.value);
  url.searchParams.set("breite", dimensionInputs.width.value);
  url.searchParams.set("laenge", dimensionInputs.length.value);
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
for (const stop of initialParams.getAll("stopp").slice(0, MAX_WAYPOINTS)) addWaypoint(stop);
if (VEHICLES[initialParams.get("fahrzeug")]) vehicleSel.value = initialParams.get("fahrzeug");
syncVehicleDimensions();
if (["1", "2", "3", "4", "5"].includes(initialParams.get("co2"))) $("co2").value = initialParams.get("co2");
for (const [param, input] of [["gewicht", dimensionInputs.weight], ["hoehe", dimensionInputs.height],
  ["breite", dimensionInputs.width], ["laenge", dimensionInputs.length]]) {
  if (initialParams.has(param)) {
    input.value = initialParams.get(param);
    if (!input.checkValidity()) syncVehicleDimensions();
  }
}
if ($("start").value && $("dest").value) calc();
