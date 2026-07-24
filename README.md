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
```

Der Generator aktualisiert auch `sitemap.xml`. Die erzeugten HTML-Dateien werden
mitcommittet, damit das statische Hosting keinen Build-Schritt benötigt.
