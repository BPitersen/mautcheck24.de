# Lkw-Maut-Rechner (mautcheck24.de)

Kostenloser, statischer Lkw-Maut-Rechner für Deutschland. Adresse eingeben →
LKW-Route auf der Karte + Maut nach BFStrMG 2026 inkl. Lenk- und Ruhezeiten.

- **Routing/Geocoding:** OpenStreetMap (Nominatim) + FOSSGIS-Valhalla (Truck-Profil)
- **Mautsätze:** Anlage 1 BFStrMG, gepflegt in `rates.js`
- Kein Backend, keine Build-Tools – reines HTML/CSS/JS.

## Lokal testen

```bash
python3 -m http.server 8613
# → http://localhost:8613
```

## Deployment via GitHub Pages

1. Dieses Repo als **öffentliches** Repo zu GitHub pushen (siehe unten).
2. Repo → **Settings → Pages** → Source: **Deploy from a branch**,
   Branch **main** / **/(root)** → Save.
3. Unter **Settings → Pages → Custom domain** `mautcheck24.de` eintragen
   (die `CNAME`-Datei im Repo setzt das ebenfalls). **Enforce HTTPS** aktivieren,
   sobald das Zertifikat bereitsteht (kann ein paar Minuten dauern).

### DNS-Einträge beim Domain-Anbieter (Apex-Domain)

| Typ | Name | Wert |
|-----|------|------|
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |
| CNAME | www | `<GITHUB-NUTZER>.github.io.` |

(Optional AAAA für IPv6: `2606:50c0:8000::153` … `8003::153`.)

## Erstmaliger Push

```bash
git remote add origin https://github.com/<GITHUB-NUTZER>/mautcheck24.git
git push -u origin main
```
