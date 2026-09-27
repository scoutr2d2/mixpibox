# Sources

Font: Baloo 2 — https://github.com/EkType/Baloo2 (Copyright 2019 The Baloo 2
Project Authors), SIL Open Font License 1.1 — https://scripts.sil.org/OFL
Font: Nunito — https://github.com/googlefonts/nunito (Copyright 2014 The
Nunito Project Authors), SIL Open Font License 1.1 — https://scripts.sil.org/OFL

Die Angaben sind nicht abgeschrieben, sondern **aus den mitgelieferten
Dateien selbst gelesen** (`name`-Tabelle, Eintrag 0 und 14) — die Datei ist
damit ihr eigener Beleg, auch wenn eine Adresse im Netz einmal umzieht.

## Was hier liegt und warum

Vier `woff2`, zusammen rund 135 kB: je Familie ein Zeichenvorrat `latin` und
`latin-ext`. Beide sind **variable Schriften** (Baloo 2: `wght` 400–800,
Nunito: 200–1000) — darum eine Datei je Vorrat statt je Schnitt; der Browser
rechnet die Stärke selbst aus, statt sie aus einem Schnitt zu fälschen. Die
Begründung im Langen steht im Kopf von `NewDesign/app.css`, Abschnitt
„Schriften".

Sie liegen **bei**, statt von einer fremden Adresse geladen zu werden, weil
die Box offline hochkommen muss: ein Webfont von einem CDN wäre auf einer Box
ohne Netz eine leere Seite.

Eingebunden werden sie von `NewDesign/app.css` (`@font-face`) und in
`index.html` vorgeladen. Beim Ausliefern wandert der ganze Ordner nach
`www/browser/neu/schriften/`.

Gewacht von `python3 tools/schrift-herkunft-pruefen.py` (läuft in
`tools/doku-luecken-probe.sh`): es verlangt für **jede** Schriftdatei im Baum
eine `Font:`-Zeile mit Adresse — hier oder neben der Datei, so wie in
`themes/*/Readme.md`.
