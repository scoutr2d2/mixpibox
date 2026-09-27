# MixPiBox Theme-Gestalter — Desktop-App (Windows, Linux, macOS)

Stand: 27.09.2026 · BACKLOG **E144**

Die Desktop-App ist eine **Schale** um den Theme-Gestalter, den die Box
selbst unter `/neu/gestalter/` ausliefert (Quelle: `NewDesign/gestalter/`).
Es gibt **einen** Gestalter — im Browser, in der Verwaltung und hier. Die App
fügt nur zwei Dinge hinzu: echte Datei-Dialoge und das Arbeiten **ohne Box**.

## Zwei Lagen

| Lage | Woher kommt die Seite | Was geht |
|---|---|---|
| **Ohne Box** | mitgelieferte Dateien (`app/neu`, Schema `mixpi://app/neu/…`) | gestalten, Datei öffnen/speichern (`.mixpi-thema.json`), Bilder reisen in der Datei mit |
| **Mit Box** (Menü *Box → Verbinden …*, `Strg+K`) | von der Box: `http://<box>:8200/neu/gestalter/` | zusätzlich: Themen der Box laden, *Auf der Box anwenden*, *Als Thema ablegen*, Bilder hochladen |

Mit Box meldet man sich im Fenster an wie in der Verwaltung (bei aktivierter
Anmeldung). Die gemerkte Adresse liegt in `einstellungen.json` im
Benutzerordner der App.

## Entwickeln und bauen

Voraussetzungen: Node.js 22, **Python 3** (für den Kopierschritt).

```bash
cd desktop/gestalter
npm install
npm start               # kopiert NewDesign/ nach app/neu und startet Electron
npm run bauen:linux     # AppImage + deb   -> dist/
npm run bauen:win       # NSIS-Installer + portable
npm run bauen:mac       # dmg (nur auf macOS sinnvoll: Signatur)
```

`npm run vorbereiten` ruft **denselben** Kopierschritt wie die Auslieferung
auf die Box (`tools/newdesign-kopieren.py`, eine Ausschlussliste). Das Paket
liegt absichtlich **nicht** in den npm-Arbeitsbereichen der Wurzel: Electron
zieht rund 100 MB je Plattform, und weder die Box noch die CI brauchen es.

## Was geprüft ist — und was nicht (Stand 27.09.2026)

- **Gemessen:** Linux, Electron 44 unter Xvfb, beide Lagen (ohne Box; mit
  gemerkter Box gegen die Attrappe `tools/neu-vorschau.mjs`). Die Seite selbst
  prüft `node tools/gestalter-schau.mjs` bei jedem Lauf von `tools/pruefen.sh`.
- **Nicht gemessen:** Windows, macOS, das Paketieren mit electron-builder,
  eine echte Box.

## Sicherheit

`contextIsolation`, `sandbox`, kein `nodeIntegration`. Die Brücke
(`preload.cjs`) gibt der Seite genau drei Aufrufe: *Datei öffnen*, *Datei
speichern* (jeweils mit Dialog) und — nur für den Verbinden-Dialog — die
Box-Adresse setzen. Fremde Adressen öffnen im Systembrowser.

## Dateien

| Datei | Zweck |
|---|---|
| `main.cjs` | Fenster, Menü, Schema `mixpi://`, Dialoge |
| `preload.cjs` | die Brücke `window.mixpiDesktop` |
| `verbinden.html` | der kleine Dialog „Mit einer Box verbinden" |
| `vorbereiten.mjs` | `NewDesign/` → `app/neu/` über `tools/newdesign-kopieren.py` |
