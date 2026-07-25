import { writeFile } from "node:fs/promises";

const root = "/Users/nika/shopifyDB/lkw-mautrechner";
const endpoint = "https://valhalla1.openstreetmap.de";
const cities = {
  hamburg: [53.5511, 9.9937], muenchen: [48.1351, 11.582], berlin: [52.52, 13.405],
  koeln: [50.9375, 6.9603], frankfurt: [50.1109, 8.6821], stuttgart: [48.7758, 9.1829],
  duesseldorf: [51.2277, 6.7735], leipzig: [51.3397, 12.3731], dortmund: [51.5136, 7.4653],
  bremen: [53.0793, 8.8017], hannover: [52.3759, 9.732], nuernberg: [49.4521, 11.0767],
  // Dresden: Lkw-tauglicher Startpunkt nahe der A4 statt restriktivem Altstadtzentrum.
  dresden: [51.063, 13.684], erfurt: [50.9848, 11.0299], rostock: [54.0924, 12.0991],
};
const pairs = "hamburg-muenchen berlin-koeln frankfurt-hamburg hamburg-berlin berlin-muenchen koeln-muenchen frankfurt-muenchen stuttgart-hamburg duesseldorf-berlin leipzig-koeln dortmund-muenchen bremen-stuttgart hannover-frankfurt nuernberg-hamburg dresden-koeln erfurt-hamburg rostock-muenchen hamburg-koeln berlin-frankfurt koeln-stuttgart muenchen-leipzig frankfurt-berlin bremen-muenchen hannover-muenchen dresden-hamburg dortmund-berlin stuttgart-berlin nuernberg-koeln rostock-berlin leipzig-hamburg".split(" ");
const bRef = /^B\s?\d+/;

function decodeShape(encoded) {
  const points = [];
  let index = 0, lat = 0, lon = 0;
  while (index < encoded.length) {
    for (const coordinate of [0, 1]) {
      let shift = 0, result = 0, byte;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (coordinate === 0) lat += delta;
      else lon += delta;
    }
    points.push([lat / 1e6, lon / 1e6]);
  }
  return points;
}

function distanceKm([lat1, lon1], [lat2, lon2]) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const value = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(value));
}

async function request(path, payload) {
  const response = await fetch(endpoint + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.error || `${path}: HTTP ${response.status}`);
  }
  return response.json();
}

function splitShape(shape) {
  const chunks = [];
  let current = [shape[0]], length = 0;
  for (let index = 1; index < shape.length; index++) {
    length += distanceKm(shape[index - 1], shape[index]);
    current.push(shape[index]);
    if (length > 180 || current.length >= 15000) {
      chunks.push(current);
      current = [shape[index]];
      length = 0;
    }
  }
  if (current.length > 1) chunks.push(current);
  return chunks;
}

function schedule(driveMinutes) {
  let remaining = driveMinutes / 60, days = 0, breaks = 0, extendedDays = 0, rests = 0;
  while (remaining > 0.005) {
    days++;
    const limit = remaining > 9 && extendedDays < 2 ? 10 : 9;
    const driven = Math.min(remaining, limit);
    if (driven > 9) extendedDays++;
    breaks += Math.floor((driven - 0.01) / 4.5);
    remaining -= driven;
    if (remaining > 0.005) rests++;
  }
  return {
    breakCount: breaks,
    restCount: rests,
    totalMinutes: Math.round(driveMinutes + breaks * 45 + rests * 660),
  };
}

async function analyze(trip) {
  const shape = trip.legs.flatMap((leg, index) => {
    const points = decodeShape(leg.shape);
    return index ? points.slice(1) : points;
  });
  let motorwayKm = 0, federalKm = 0, freeKm = 0, driveHours = 0;
  for (const chunk of splitShape(shape)) {
    const payload = {
      shape: chunk.map(([lat, lon]) => ({ lat, lon })),
      costing: "truck",
      shape_match: "edge_walk",
      filters: {
        attributes: ["edge.length", "edge.road_class", "edge.names", "edge.speed",
          "edge.begin_shape_index", "edge.end_shape_index", "shape"],
        action: "include",
      },
    };
    let traced;
    try {
      traced = await request("/trace_attributes", payload);
    } catch {
      payload.shape_match = "walk_or_snap";
      traced = await request("/trace_attributes", payload);
    }
    for (const edge of traced.edges || []) {
      const names = edge.names || [];
      const motorway = edge.road_class === "motorway";
      const federal = !motorway && names.some((name) => bRef.test(name));
      if (motorway) motorwayKm += edge.length;
      else if (federal) federalKm += edge.length;
      else freeKm += edge.length;
      driveHours += edge.length / Math.min(edge.speed || 50, motorway ? 90 : 60);
    }
  }
  const driveMinutes = Math.round(driveHours * 60);
  return { motorwayKm, federalKm, freeKm, driveMinutes, ...schedule(driveMinutes) };
}

const output = { generatedAt: new Date().toISOString(), profile: "40 t · 5 Achsen · 4,0 m Höhe · Euro VI · CO₂-Klasse 1", routes: {} };
for (let index = 0; index < pairs.length; index++) {
  const pair = pairs[index];
  const [origin, destination] = pair.split("-");
  const [originLat, originLon] = cities[origin];
  const [destinationLat, destinationLon] = cities[destination];
  const routePayload = {
    locations: [
      { lat: originLat, lon: originLon, search_cutoff: 20000, minimum_reachability: 50 },
      { lat: destinationLat, lon: destinationLon, search_cutoff: 20000, minimum_reachability: 50 },
    ],
    costing: "truck",
    costing_options: { truck: {
      weight: 40, axle_count: 5, height: 4, width: 2.55, length: 16.5,
      use_tracks: 0, use_living_streets: 0, service_penalty: 100, service_factor: 1.5,
    } },
    units: "kilometers",
  };
  let tripResponse;
  try {
    tripResponse = await request("/route", routePayload);
  } catch {
    // Einzelne Stadtmittelpunkte liegen direkt an restriktiv kartierten Straßen.
    // In diesem Fall das Truck-Profil ohne zusätzliche Nebenstraßen-Strafen erneut versuchen.
    routePayload.costing_options.truck = {
      weight: 40, axle_count: 5, height: 4, width: 2.55, length: 16.5,
    };
    tripResponse = await request("/route", routePayload);
  }
  const trip = tripResponse.trip;
  const analysis = await analyze(trip);
  const roads = new Set();
  for (const leg of trip.legs) {
    for (const maneuver of leg.maneuvers || []) {
      for (const name of maneuver.street_names || []) {
        const match = name.match(/\bA\s?(\d{1,3})\b/i);
        if (match) roads.add(`A${match[1]}`);
      }
    }
  }
  const tollKm = Number((analysis.motorwayKm + analysis.federalKm).toFixed(1));
  output.routes[pair] = {
    distanceKm: Number(trip.summary.length.toFixed(1)),
    driveMinutes: analysis.driveMinutes,
    totalMinutes: analysis.totalMinutes,
    breakCount: analysis.breakCount,
    restCount: analysis.restCount,
    motorwayKm: Number(analysis.motorwayKm.toFixed(1)),
    federalKm: Number(analysis.federalKm.toFixed(1)),
    freeKm: Number(analysis.freeKm.toFixed(1)),
    tollKm,
    toll40: Number((tollKm * 0.348).toFixed(2)),
    roads: [...roads].slice(0, 8),
  };
  console.log(`${index + 1}/${pairs.length} ${pair}: ${output.routes[pair].distanceKm} km`);
}

await writeFile(`${root}/data/route-data.json`, `${JSON.stringify(output, null, 2)}\n`);
