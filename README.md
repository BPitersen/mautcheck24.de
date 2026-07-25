# Lkw-Maut-Rechner (mautcheck24.de)

Kostenloser, statischer Lkw-Maut-Rechner für Deutschland. Adresse eingeben →
LKW-Route auf der Karte + Maut nach BFStrMG 2026 inkl. Lenk- und Ruhezeiten.

- **Routing/Geocoding:** OpenStreetMap (Nominatim) + FOSSGIS-Valhalla (Truck-Profil)
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
