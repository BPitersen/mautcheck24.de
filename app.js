const VALHALLA = "https://valhalla1.openstreetmap.de";
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const B_REF = /^B\s?\d+/;

// ---------- Karte ----------
const map = L.map("map").setView([51.16, 10.45], 6);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);
let routeLayer = L.layerGroup().addTo(map);
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

// ---------- Adress-Autocomplete (Nominatim) ----------
function setupAutocomplete(inputId, sugId) {
  const input = document.getElementById(inputId);
  const sug = document.getElementById(sugId);
  const state = { coord: null };
  let timer = null;

  input.addEventListener("input", () => {
    state.coord = null;
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 3) { sug.classList.remove("open"); return; }
    timer = setTimeout(async () => {
      try {
        const url = `${NOMINATIM}?format=jsonv2&countrycodes=de&limit=5&q=${encodeURIComponent(q)}`;
        const res = await fetch(url, { headers: { "Accept-Language": "de" } });
        const hits = await res.json();
        sug.innerHTML = "";
        for (const h of hits) {
          const d = document.createElement("div");
          d.textContent = h.display_name;
          d.onclick = () => {
            input.value = h.display_name.split(",").slice(0, 3).join(",");
            state.coord = { lat: +h.lat, lon: +h.lon };
            sug.classList.remove("open");
          };
          sug.appendChild(d);
        }
        sug.classList.toggle("open", hits.length > 0);
      } catch { sug.classList.remove("open"); }
    }, 350);
  });
  input.addEventListener("blur", () => setTimeout(() => sug.classList.remove("open"), 250));
  return state;
}
const startState = setupAutocomplete("start", "start-sug");
const destState = setupAutocomplete("dest", "dest-sug");

async function geocodeFallback(q) {
  const url = `${NOMINATIM}?format=jsonv2&countrycodes=de&limit=1&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { "Accept-Language": "de" } });
  const hits = await res.json();
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
document.addEventListener("keydown", (e) => { if (e.key === "Enter") calc(); });

// Start und Ziel tauschen (Werte + hinterlegte Koordinaten); bei sichtbarer Route neu rechnen
$("swap").addEventListener("click", () => {
  const si = $("start"), di = $("dest");
  [si.value, di.value] = [di.value, si.value];
  [startState.coord, destState.coord] = [destState.coord, startState.coord];
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
    L.marker([a.lat, a.lon]).addTo(routeLayer).bindPopup("Start");
    L.marker([b.lat, b.lon]).addTo(routeLayer).bindPopup("Ziel");
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
    status.textContent = "";
  } catch (err) {
    status.className = "";
    status.textContent = err.message || "Fehler bei der Berechnung.";
  } finally {
    btn.disabled = false;
  }
}
