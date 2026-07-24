const VALHALLA = "https://valhalla1.openstreetmap.de";
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const B_REF = /^B\s?\d+/;

// ---------- Karte ----------
const map = L.map("map").setView([51.16, 10.45], 6);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);
let routeLayer = L.layerGroup().addTo(map);

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
    costing_options: { truck: { weight: veh.weight, axle_count: veh.axles,
      height: veh.height, width: 2.55, length: veh.length } },
    units: "kilometers",
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

  let kmAb = 0, kmBs = 0, kmFree = 0, driveH = 0;
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
      const truckSpeed = Math.min(e.speed || 50, isAb ? 90 : 60);
      driveH += e.length / truckSpeed;
      const pts = taShape.slice(e.begin_shape_index, e.end_shape_index + 1);
      if (pts.length > 1) segments[kind].push(pts);
    }
  }
  return { shape, kmAb, kmBs, kmFree, driveH, segments, km: trip.summary.length };
}

// ---------- Hauptlogik ----------
const $ = (id) => document.getElementById(id);
const fmtKm = (km) => km.toLocaleString("de-DE", { maximumFractionDigits: 1 }) + " km";
const fmtEur = (v) => v.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const fmtH = (x) => { const hh = Math.floor(x), mm = Math.round((x - hh) * 60);
  return hh ? `${hh} h ${mm} min` : `${mm} min`; };

$("go").addEventListener("click", calc);
document.addEventListener("keydown", (e) => { if (e.key === "Enter") calc(); });

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

    status.textContent = "Analysiere mautpflichtige Abschnitte …";
    const main = await analyzeTrip(mainRes.trip);
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
