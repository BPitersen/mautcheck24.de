// Mautteilsätze in €/km nach BFStrMG Anlage 1 (Stand: Juli 2026, Euro VI)
// Quelle: https://www.gesetze-im-internet.de/bfstrmg/anlage_1.html
// Schlüssel: w7 = >3,5–7,49t | w12 = 7,5–11,99t | w18 = 12–18t
//            a3 = >18t bis 3 Achsen | a4 = >18t 4 Achsen | a5 = >18t 5+ Achsen
const RATES = {
  infra: { w7: 0.052, w12: 0.066, w18: 0.107, a3: 0.141, a4: 0.155, a5: 0.155 },
  air:   { w7: 0.011, w12: 0.015, w18: 0.015, a3: 0.022, a4: 0.023, a5: 0.023 },
  noise: { w7: 0.014, w12: 0.016, w18: 0.016, a3: 0.016, a4: 0.012, a5: 0.012 },
  co2: {
    1: { w7: 0.074, w12: 0.080, w18: 0.100, a3: 0.124, a4: 0.134, a5: 0.158 },
    2: { w7: 0.070, w12: 0.076, w18: 0.096, a3: 0.118, a4: 0.128, a5: 0.150 },
    3: { w7: 0.067, w12: 0.072, w18: 0.090, a3: 0.111, a4: 0.120, a5: 0.142 },
    4: { w7: 0.037, w12: 0.040, w18: 0.050, a3: 0.063, a4: 0.068, a5: 0.079 },
    5: { w7: 0,     w12: 0,     w18: 0,     a3: 0,     a4: 0,     a5: 0     },
  },
};

// Fahrzeug-Presets: Gewichtsklasse + Valhalla-Truck-Parameter
const VEHICLES = {
  w7:  { label: "Lkw 7,5 t (2 Achsen)",        weight: 7.4,  axles: 2, height: 3.2, length: 8.0 },
  w12: { label: "Lkw 12 t (2 Achsen)",          weight: 11.9, axles: 2, height: 3.5, length: 9.0 },
  w18: { label: "Lkw 18 t (2–3 Achsen)",        weight: 18,   axles: 3, height: 4.0, length: 10.0 },
  a3:  { label: "Lkw 26 t (3 Achsen)",          weight: 26,   axles: 3, height: 4.0, length: 12.0 },
  a4:  { label: "Lkw/Hängerzug 32 t (4 Achsen)", weight: 32,  axles: 4, height: 4.0, length: 18.75 },
  a5:  { label: "Sattelzug 40 t (5 Achsen)",     weight: 40,  axles: 5, height: 4.0, length: 16.5 },
};

function tollRate(vehicleKey, co2Class) {
  return RATES.infra[vehicleKey] + RATES.air[vehicleKey] +
         RATES.noise[vehicleKey] + RATES.co2[co2Class][vehicleKey];
}
