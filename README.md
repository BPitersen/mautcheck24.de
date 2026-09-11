# Lkw-Maut-Rechner (mautcheck24.de)

Kostenloser, statischer Lkw-Maut-Rechner für Deutschland. Adresse eingeben →
LKW-Route auf der Karte + Maut nach BFStrMG 2026 inkl. Lenk- und Ruhezeiten.

- **Routing/Geocoding:** OpenStreetMap (Photon/Nominatim) + FOSSGIS-Valhalla (Truck-Profil)
- **Straßenwahl:** Motorway/Trunk/Primary/Secondary/Tertiary werden bevorzugt;
  notwendige Zufahrten an Start, Ziel und Zwischenstopps bleiben möglich.
- **Mautsätze:** Anlage 1 BFStrMG, gepflegt in `rates.js`
- Kein Backend, keine Build-Tools – reines HTML/CSS/JS.

## SEO-Seiten erzeugen

Fahrzeug-, Routen-, Autobahn- und Handwerkerseiten werden zentral durch
`scripts/generate-seo-pages.mjs` gepflegt. Nach Änderungen:

```bash
node scripts/generate-seo-pages.mjs
node scripts/enhance-seo.mjs
node scripts/generate-co2-page.mjs
node scripts/fetch-route-data.mjs
node scripts/generate-routing-seo.mjs
```

Der Generator aktualisiert auch `sitemap.xml`. Die erzeugten HTML-Dateien werden
mitcommittet, damit das statische Hosting keinen Build-Schritt benötigt.

`scripts/fetch-route-data.mjs` aktualisiert die gespeicherten Routingwerte über
Valhalla. Neben Entfernung und Fahrzeit werden Autobahn-, Bundesstraßen- und
mautfreie Kilometer sowie Pausen und Beispielmaut berechnet. Das Skript benötigt
Netzwerkzugriff und sollte nur ausgeführt werden, wenn die Orientierungswerte neu
berechnet werden sollen. `generate-routing-seo.mjs` muss anschließend zuletzt
laufen, weil es die detaillierten Routen-, Autobahn- und Übersichtsseiten erzeugt.
# PostHog Analytics

PostHog ist einwilligungsbasiert und mit der EU-Cloud vorbereitet. Vor einer Zustimmung
wird das PostHog-Skript nicht geladen. Session Replay startet nur nach Zustimmung.
Alle Eingabefelder und Adressvorschläge werden maskiert, die Karte wird vollständig
aus der Aufnahme ausgeschlossen und Query-Parameter werden aus URLs entfernt.

1. In PostHog ein Projekt in der Region **EU (Frankfurt)** anlegen.
2. Den öffentlichen `phc_...` Project API Key in `posthog-config.js` eintragen.
3. Änderungen veröffentlichen und im privaten Browserfenster testen.
4. In PostHog unter **Activity** die Ereignisse `$pageview`,
   `route_calculation_started`, `route_calculation_completed`,
   `route_calculation_failed`, `waypoint_added` und `result_shared` prüfen.

Die Einwilligung kann auf `/datenschutz/` über „Analyse-Einstellungen öffnen“ geändert
werden. Der Project API Key ist für die Verwendung im Browser vorgesehen und kein
geheimer Personal API Key.
