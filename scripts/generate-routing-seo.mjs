import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = "/Users/nika/shopifyDB/lkw-mautrechner";
const site = "https://mautcheck24.de";
const data = JSON.parse(await readFile(resolve(root, "data/route-data.json"), "utf8"));
const cities = {
  hamburg: "Hamburg", muenchen: "München", berlin: "Berlin", koeln: "Köln",
  frankfurt: "Frankfurt am Main", stuttgart: "Stuttgart", duesseldorf: "Düsseldorf",
  leipzig: "Leipzig", dortmund: "Dortmund", bremen: "Bremen", hannover: "Hannover",
  nuernberg: "Nürnberg", dresden: "Dresden", erfurt: "Erfurt", rostock: "Rostock",
};
const roadPages = {
  A1: { slug: "autobahn-a1", cities: "Lübeck, Hamburg, Bremen, Dortmund und Köln", states: "Schleswig-Holstein, Hamburg, Niedersachsen, Bremen, Nordrhein-Westfalen, Rheinland-Pfalz und Saarland" },
  A3: { slug: "autobahn-a3", cities: "Oberhausen, Köln, Frankfurt am Main, Würzburg und Nürnberg", states: "Nordrhein-Westfalen, Rheinland-Pfalz, Hessen, Baden-Württemberg und Bayern" },
  A7: { slug: "autobahn-a7", cities: "Flensburg, Hamburg, Hannover, Kassel, Würzburg und Ulm", states: "Schleswig-Holstein, Hamburg, Niedersachsen, Hessen, Bayern und Baden-Württemberg" },
  A9: { slug: "autobahn-a9", cities: "Berlin, Leipzig, Nürnberg und München", states: "Brandenburg, Sachsen-Anhalt, Sachsen, Thüringen und Bayern" },
};
const esc = (value) => String(value).replace(/[&<>"]/g, (character) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
const number = (value) => value.toLocaleString("de-DE", { maximumFractionDigits: 1 });
const money = (value) => value.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const duration = (minutes) => `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
const header = `<header class="topbar"><a class="brand" href="/"><img class="brand-mark" src="/favicon.svg" alt=""><span class="brand-name">mautcheck<span class="brand-24">24</span></span></a><nav class="topnav"><a href="/">Rechner</a><a href="/mautsaetze/">Mautsätze</a><a href="/fahrzeugklassen/">Fahrzeuge</a><a href="/maut/">Routen</a><a href="/handwerkerausnahme-maut/">Handwerk</a></nav></header>`;
const footer = `<footer class="site-footer">© 2026 mautcheck24 · <a href="/">Rechner</a> · <a href="/maut/">Routen</a> · <a href="/lkw-routenplanung/">Lkw-Routenplanung</a> · <a href="/fahrzeugklassen/">Fahrzeuge</a> · <a href="/methodik/">Methodik</a> · <a href="/redaktion/">Redaktion</a> · <a href="/datenschutz/">Datenschutz</a> · <a href="/impressum/">Impressum</a></footer>`;

function page(slug, title, description, lead, content) {
  const url = `${site}/${slug}/`;
  const schemas = [
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Startseite", item: `${site}/` },
      { "@type": "ListItem", position: 2, name: title, item: url },
    ] },
    { "@context": "https://schema.org", "@type": "Article", headline: title, description,
      inLanguage: "de-DE", mainEntityOfPage: url, dateModified: data.generatedAt.slice(0, 10),
      author: { "@type": "Organization", name: "Redaktion mautcheck24", url: `${site}/redaktion/` } },
  ].map((schema) => `<script type="application/ld+json">${JSON.stringify(schema)}</script>`).join("");
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} | mautcheck24</title><meta name="description" content="${esc(description)}"><meta name="robots" content="index, follow, max-image-preview:large"><link rel="canonical" href="${url}"><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/style.css?v=20260725-2"><meta property="og:type" content="article"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${url}"><meta property="og:image" content="${site}/assets/og-image.png">${schemas}</head><body>${header}<main><article class="content subpage"><p class="crumbs"><a href="/">Start</a> › ${esc(title)}</p><h1>${esc(title)}</h1><p class="lead">${lead}</p>${content}${footer}</article></main></body></html>`;
}

async function save(slug, html) {
  const directory = resolve(root, slug);
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, "index.html"), html);
}

const entries = Object.entries(data.routes);
for (const [slugPart, route] of entries) {
  const [originKey, destinationKey] = slugPart.split("-");
  const origin = cities[originKey], destination = cities[destinationKey];
  const roads = route.roads.length ? route.roads.join(", ") : "mehrere Bundesfernstraßen";
  const pauseText = route.restCount
    ? `${route.breakCount} Lenkpause(n) und ${route.restCount} Tagesruhe`
    : route.breakCount ? `${route.breakCount} Lenkpause(n)` : "keine gesetzliche Lenkpause innerhalb der berechneten Fahrzeit";
  const related = entries
    .filter(([candidate]) => candidate !== slugPart && candidate.split("-").some((key) => key === originKey || key === destinationKey))
    .slice(0, 5)
    .map(([candidate, value]) => {
      const [a, b] = candidate.split("-");
      return `<a href="/maut/${candidate}/"><strong>${esc(cities[a])}–${esc(cities[b])}</strong><span>${number(value.distanceKm)} km · ${duration(value.driveMinutes)}</span></a>`;
    }).join("");
  const costs = [["7,5-Tonner", .177], ["12-Tonner", .238], ["40-Tonner", .348]];
  const content = `
    <section class="quick-answer"><strong>Orientierung für einen 40-Tonner</strong><p>${number(route.distanceKm)} km Lkw-Route, davon rund ${number(route.tollKm)} km mautpflichtig. Modellkosten in CO₂-Klasse 1: <strong>${money(route.tollKm * .348)}</strong>.</p></section>
    <p class="cta-box"><a class="cta-button" href="/?start=${encodeURIComponent(origin)}&ziel=${encodeURIComponent(destination)}&fahrzeug=a5&co2=1">Route ${esc(origin)}–${esc(destination)} im Rechner öffnen</a></p>
    <h2>Strecke, Fahrzeit und Mautkilometer</h2>
    <div class="metric-grid route-metrics">
      <div><strong>${number(route.distanceKm)} km</strong><span>Lkw-Strecke gesamt</span></div>
      <div><strong>${number(route.tollKm)} km</strong><span>mautpflichtig</span></div>
      <div><strong>${duration(route.driveMinutes)}</strong><span>reine Lkw-Fahrzeit</span></div>
      <div><strong>${duration(route.totalMinutes)}</strong><span>inklusive Pflichtpausen</span></div>
    </div>
    <div class="table-wrap"><table class="rates"><thead><tr><th>Streckenart</th><th>Kilometer</th></tr></thead><tbody>
      <tr><td>Autobahn</td><td>${number(route.motorwayKm)} km</td></tr>
      <tr><td>Bundesstraße</td><td>${number(route.federalKm)} km</td></tr>
      <tr><td>mautfrei</td><td>${number(route.freeKm)} km</td></tr>
    </tbody></table></div>
    <p>Erkannte Hauptautobahnen: <strong>${esc(roads)}</strong>. Für die Zeitplanung ergibt die Modellrechnung ${pauseText}. Exakte Abfahrts- und Zieladressen können Route und Ergebnis verändern.</p>
    <h2>Beispielkosten nach Fahrzeugklasse</h2>
    <div class="table-wrap"><table class="rates"><thead><tr><th>Fahrzeug</th><th>Satz</th><th>auf ${number(route.tollKm)} km</th></tr></thead><tbody>
      ${costs.map(([label, rate]) => `<tr><td>${label}</td><td>${(rate * 100).toFixed(1).replace(".", ",")} ct/km</td><td><strong>${money(route.tollKm * rate)}</strong></td></tr>`).join("")}
    </tbody></table></div>
    <p class="small">Modellrechnung mit Euro VI und CO₂-Klasse 1. Die tatsächliche Maut wird amtlich je Mautabschnitt ermittelt und kann abweichen.</p>
    <h2>Lkw-Routenplanung für ${esc(origin)}–${esc(destination)}</h2>
    <p>Verwende im Rechner die konkreten Adressen und prüfe Fahrzeuggewicht, Höhe, Breite und Länge. Zwischenstopps lassen sich in der gewünschten Reihenfolge ergänzen. Temporäre Sperrungen, Live-Verkehr und alle Durchfahrtsbeschränkungen sind nicht garantiert vollständig.</p>
    ${related ? `<h2>Passende Lkw-Routen</h2><div class="landing-grid compact-routes">${related}</div>` : ""}
    <p class="topic-links"><a href="/lkw-routenplanung/">Lkw-Routenplanung erklärt</a><a href="/lenk-und-ruhezeiten/">Lenk- und Ruhezeiten</a><a href="/lkw-maut-40-tonner/">Maut für 40-Tonner</a>${route.roads.filter((road) => roadPages[road]).slice(0, 2).map((road) => `<a href="/maut/${roadPages[road].slug}/">Lkw-Maut ${road}</a>`).join("")}</p>
    <p class="editorial-note">Berechnet am ${new Date(data.generatedAt).toLocaleDateString("de-DE")} · Profil: ${esc(data.profile)} · <a href="/methodik/">Methodik und Quellen</a></p>`;
  await save(`maut/${slugPart}`, page(`maut/${slugPart}`, `Lkw-Route ${origin}–${destination}: Maut & Fahrzeit`,
    `Lkw-Route ${origin}–${destination}: ${number(route.distanceKm)} km, Fahrzeit, Mautkilometer und Kosten für verschiedene Fahrzeugklassen.`,
    `Plane die Lkw-Route von <strong>${esc(origin)}</strong> nach <strong>${esc(destination)}</strong> und kalkuliere Maut, Fahrzeit und Pausen.`, content));
}

for (const [road, config] of Object.entries(roadPages)) {
  const matching = entries.filter(([, route]) => route.roads.includes(road)).slice(0, 8);
  const cards = matching.map(([slugPart, route]) => {
    const [a, b] = slugPart.split("-");
    return `<a href="/maut/${slugPart}/"><strong>${esc(cities[a])}–${esc(cities[b])}</strong><span>${number(route.distanceKm)} km · ${money(route.tollKm * .348)} für 40 t*</span></a>`;
  }).join("");
  const content = `
    <section class="quick-answer"><strong>Verlauf</strong><p>Die ${road} verbindet unter anderem ${config.cities}. Sie verläuft durch ${config.states}.</p></section>
    <h2>${road} in der Lkw-Routenplanung</h2><p>Die ${road} ist eine wichtige Fernverkehrsachse. Für die Maut zählen die tatsächlich befahrenen Mautabschnitte zwischen Ein- und Ausfahrt sowie Gewicht, Achszahl, Schadstoff- und CO₂-Klasse des Fahrzeugs.</p>
    <p class="cta-box"><a class="cta-button" href="/">Konkrete Lkw-Route und Maut berechnen</a></p>
    <h2>Beispielrouten über die ${road}</h2><div class="landing-grid compact-routes">${cards}</div>
    <p class="small">*Orientierung mit Euro VI, CO₂-Klasse 1 und den für die jeweilige Gesamtroute erkannten Mautkilometern. Nicht ausschließlich Kosten auf der ${road}.</p>
    <h2>Vor der Fahrt beachten</h2><ul class="check-list"><li>konkrete Ein- und Ausfahrt beziehungsweise vollständige Adressen</li><li>Fahrzeuggewicht, Achsen und CO₂-Klasse</li><li>Höhe, Breite und Länge für das Lkw-Routing</li><li>aktuelle Baustellen, Sperrungen und Verkehrsbedingungen</li></ul>
    <p class="topic-links"><a href="/maut/">Alle Lkw-Routen</a><a href="/lkw-routenplanung/">Lkw-Routenplanung erklärt</a><a href="/mautsaetze/">Aktuelle Mautsätze</a></p>`;
  await save(`maut/${config.slug}`, page(`maut/${config.slug}`, `Lkw-Maut und Routenplanung auf der ${road}`,
    `${road}: Verlauf, wichtige Städte, passende Lkw-Routen und Mautkosten mit dem Lkw-Routenplaner berechnen.`,
    `Plane eine Lkw-Fahrt über die <strong>${road}</strong> und berechne die Maut passend zu Strecke und Fahrzeug.`, content));
}

const groups = new Map();
for (const [slugPart, route] of entries) {
  const [origin] = slugPart.split("-");
  if (!groups.has(origin)) groups.set(origin, []);
  groups.get(origin).push([slugPart, route]);
}
const groupedRoutes = [...groups].map(([origin, routes]) => `<section class="route-group"><h2>Routen ab ${esc(cities[origin])}</h2><div class="landing-grid compact-routes">
    ${routes.map(([slugPart, route]) => {
      const [, destination] = slugPart.split("-");
      return `<a href="/maut/${slugPart}/"><strong>${esc(cities[origin])}–${esc(cities[destination])}</strong><span>${number(route.distanceKm)} km · ${duration(route.driveMinutes)} · ${number(route.tollKm)} Maut-km</span></a>`;
    }).join("")}
  </div></section>`).join("");
const roadCards = Object.entries(roadPages).map(([road, config]) =>
  `<a href="/maut/${config.slug}/"><strong>${road}</strong><span>Verlauf, Beispielrouten und Maut</span></a>`).join("");
await save("maut", page("maut", "Lkw-Routenplaner: beliebte Strecken und Mautkosten",
  "30 beliebte Lkw-Routen mit Entfernung, Fahrzeit, Mautkilometern und Kosten sowie Informationen zu A1, A3, A7 und A9.",
  "Wähle eine häufig gefahrene Strecke oder öffne den Rechner für eine individuelle Lkw-Route.", `
    <section class="quick-answer"><strong>Individuelle Tour?</strong><p>Im Rechner kannst du genaue Adressen, bis zu drei Zwischenstopps, Fahrzeugmaße und CO₂-Klasse angeben.</p></section>
    <p class="cta-box"><a class="cta-button" href="/">Eigene Lkw-Route planen</a></p>
    ${groupedRoutes}
    <h2>Wichtige Autobahnen</h2><div class="landing-grid">${roadCards}</div>
    <p class="topic-links"><a href="/lkw-routenplanung/">Was ein Lkw-Routenplaner berücksichtigt</a><a href="/lenk-und-ruhezeiten/">Fahrzeit und Pausen</a><a href="/mautsaetze/">Lkw-Mautsätze</a></p>`));

await save("lkw-routenplanung", page("lkw-routenplanung", "Lkw-Routenplanung: Maße, Maut und Fahrzeit berücksichtigen",
  "Lkw-Routen richtig planen: Gewicht, Höhe, Breite, Länge, Maut, Zwischenstopps sowie Lenk- und Ruhezeiten verständlich erklärt.",
  "Eine Lkw-Route benötigt mehr Informationen als eine normale Pkw-Strecke. Fahrzeugmaße, Gewicht, Mautabschnitte und gesetzliche Pausen beeinflussen die Planung.", `
    <section class="quick-answer"><strong>Kurz erklärt</strong><p>Ein Lkw-Routenplaner verwendet ein Truck-Profil und versucht bekannte Beschränkungen aus den Kartendaten zu berücksichtigen. Die Daten ersetzen weder Verkehrszeichen noch eine professionelle Navigation.</p></section>
    <h2>Diese Fahrzeugdaten beeinflussen die Route</h2><div class="feature-grid"><div><strong>Gewicht und Achsen</strong><span>relevant für Beschränkungen, Fahrzeugklasse und Mautsatz</span></div><div><strong>Höhe und Breite</strong><span>wichtig bei Brücken, Tunneln und engen Durchfahrten</span></div><div><strong>Fahrzeuglänge</strong><span>kann Wendungen und geeignete Zufahrten beeinflussen</span></div></div>
    <h2>Maut und Route gemeinsam kalkulieren</h2><p>mautcheck24 klassifiziert die berechnete Route in Autobahn-, Bundesstraßen- und mautfreie Kilometer. Aus den mautpflichtigen Kilometern und dem gewählten Fahrzeugprofil entsteht eine unverbindliche Kostenkalkulation.</p>
    <h2>Zwischenstopps und Tourenplanung</h2><p>Zwischenstopps werden in der eingegebenen Reihenfolge angefahren. Eine automatische Optimierung der Reihenfolge findet derzeit nicht statt. Für Angebote und Disposition solltest du außerdem Be- und Entladezeiten einplanen.</p>
    <h2>Lenk- und Ruhezeiten</h2><p>Die reine Routing-Fahrzeit ist nicht die gesamte Tourdauer. Der Rechner ergänzt notwendige Lenkpausen und – bei längeren Fahrten – Tagesruhezeiten als Orientierung.</p>
    <div class="info-warning"><strong>Grenzen der kostenlosen Planung</strong><p>Live-Verkehr, alle kurzfristigen Sperrungen, Baustellen und jede lokale Höhen- oder Gewichtsbeschränkung sind nicht garantiert vollständig. Prüfe die Strecke vor der Fahrt mit aktuellen betrieblichen und behördlichen Informationen.</p></div>
    <p class="cta-box"><a class="cta-button" href="/">Lkw-Route und Maut berechnen</a></p>
    <p class="topic-links"><a href="/maut/">Beliebte Lkw-Routen</a><a href="/lenk-und-ruhezeiten/">Lenk- und Ruhezeiten</a><a href="/methodik/">Berechnungsmethodik</a></p>`));

let sitemap = await readFile(resolve(root, "sitemap.xml"), "utf8");
if (!sitemap.includes("/lkw-routenplanung/")) {
  sitemap = sitemap.replace("</urlset>", `  <url><loc>${site}/lkw-routenplanung/</loc><changefreq>monthly</changefreq><priority>0.8</priority></url>\n</urlset>`);
  await writeFile(resolve(root, "sitemap.xml"), sitemap);
}
console.log(`Generated ${entries.length} route pages, ${Object.keys(roadPages).length} motorway pages, route hub and routing guide`);
