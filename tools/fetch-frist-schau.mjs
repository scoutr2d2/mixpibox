#!/usr/bin/env node
// Wie viele Backend-`fetch(` laufen OHNE Frist — und werden es mehr?
//
// WOZU: Ein fetch ohne AbortSignal haelt bei einem haengenden Gegenueber die
// Verbindung offen, bis undici bei ~300 s aufgibt (die eigene Messung vom
// 05.08.2026 nennt 134,8 s je Haenger im Spotify-Block). Die Klasse waechst
// seit zwei Audits nach: 03.08. zwoelf Stellen, 05.08. zehn (davon vier NEUE),
// 13.08. vierzehn. Jedes Audit fand dieselbe Sorte an neuen Stellen — weil
// kein Pruefschritt sie zaehlt. Genau der fehlende Schritt ist dieses
// Werkzeug (Audit 2026-08-13, Rangliste Punkt 9).
//
// WIE ES URTEILT — EINE RATSCHE, KEIN VERBOT: Die heutigen Altlasten sind
// bekannt und unten je Datei beziffert. Der Schritt bricht, wenn es MEHR
// werden (neue Stelle ohne Frist), und meldet sich, wenn es WENIGER werden
// (dann gehoert die Zahl hier runtergesetzt, sonst schuetzt die Ratsche
// weniger, als sie koennte).
//
// WAS ALS ABSICHT GILT: ein Kommentar mit "KEINE FRIST" in den fuenf Zeilen
// UEBER dem Aufruf — so steht es am Jellyfin-Audiostrom (server.ts, "ein
// Album dauert eine Stunde"). Absicht wird nicht gezaehlt, sie ist begruendet.
//
// GEGENPROBE (Hausregel "in-Suchen ueberleben auskommentierte Aufrufe"):
// gezaehlt wird am Quelltext; ein auskommentiertes fetch( zaehlt mit, wenn
// die Zeile mit // beginnt — deshalb werden reine Kommentarzeilen verworfen.
//
// AUFRUF
//   node tools/fetch-frist-schau.mjs             zeigt alle Stellen
//   node tools/fetch-frist-schau.mjs --pruefen   still; Ende 1 bei Zuwachs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = dirname(dirname(fileURLToPath(import.meta.url)))

// DIE RATSCHE: EINGEFROREN AM 19.09.2026 GEGEN HEAD b6fe1f5b — gegen den
// gemessenen Bestand dieses Tages, nicht gegen eine Absicht. Nachgezaehlt mit
// diesem Werkzeug UND mit einem eigenen Zaehler daneben (25-Zeilen-Fenster
// statt 13, um eine Frist hinter langer Begruendung nicht zu verlieren);
// beide kommen auf dieselben Zeilen. Wer eine Stelle mit Frist versieht,
// setzt die Zahl HERUNTER.
const ERLAUBT = {
  // 13 → 4. Die neun, die weg sind, waren Jellyfin-Rufe: seit der Helfer
  // `jfHolen` (server.ts:6591) `signal: AbortSignal.timeout(8000)` selbst
  // setzt, kommt kein Jellyfin-Weg mehr fristlos hinaus. Die Ratsche stand
  // damit NEUN Stellen ueber dem Bestand — Platz, in den neun neue fristlose
  // Rufe gepasst haetten, ohne dass diese Wache einen Ton sagt.
  //
  // DIE VIER, DIE BLEIBEN, sind alle im Spotify-Suchblock (Web-API, ~Z.
  // 10236/10251/10299/10363: Interpretensuche, Alben je Kuenstler, freie
  // Suche, Titel je Liste). Sie sind gemeldeter Bestand, keine Absolution —
  // genau wegen dieser Sorte gibt es das Werkzeug (die Messung vom 05.08.2026
  // nennt 134,8 s je Haenger IM SPOTIFY-BLOCK).
  'src/backend-api/src/server.ts': 4,
  // Unveraendert 1 (Z. 697): der Bestand ist hier genau der Deckel.
  'src/backend-player/src/spotify-control.ts': 1,
}

const DATEIEN = [
  'src/backend-api/src/server.ts',
  'src/backend-api/src/vorlesen.ts',
  'src/backend-api/src/jellyfin-durchreiche.ts',
  'src/backend-player/src/spotify-control.ts',
]

const still = process.argv.includes('--pruefen')
let bruch = false

for (const rel of DATEIEN) {
  let text
  try {
    text = readFileSync(join(WURZEL, rel), 'utf8')
  } catch {
    continue
  }
  const zeilen = text.split('\n')
  const offen = []
  zeilen.forEach((z, i) => {
    // Nur echte Aufrufe: keine Kommentarzeilen, keine Definitionen.
    if (/^\s*(\/\/|\*)/.test(z)) return
    if (!/\bfetch\s*\(/.test(z)) return
    // Das Optionen-Objekt kann ueber mehrere Zeilen gehen: das Fenster ist
    // der Aufruf plus die naechsten 12 Zeilen — laenger ist keins im Baum.
    const fenster = zeilen.slice(i, i + 13).join('\n')
    if (/\bsignal\s*[:,]/.test(fenster)) return
    // Begruendete Absicht: "KEINE FRIST" in den fuenf Zeilen darueber ODER im
    // Aufruf-Fenster selbst — am Jellyfin-Audiostrom steht der Satz IM
    // Optionsblock ("ein Album dauert eine Stunde"), nicht davor.
    const davor = zeilen.slice(Math.max(0, i - 5), i).join('\n')
    if (/KEINE FRIST/.test(davor) || /KEINE FRIST/.test(fenster)) return
    offen.push(i + 1)
  })
  const deckel = ERLAUBT[rel] ?? 0
  if (offen.length > deckel) {
    console.log(`${rel}: ${offen.length} fetch ohne Frist — erlaubt sind ${deckel}.`)
    console.log(`  Zeilen: ${offen.join(', ')}`)
    console.log('  Entweder AbortSignal.timeout ergaenzen oder die Absicht als')
    console.log('  "KEINE FRIST"-Kommentar direkt darueber begruenden.')
    bruch = true
  } else if (offen.length < deckel) {
    console.log(`${rel}: nur noch ${offen.length} von ${deckel} erlaubten Stellen —`)
    console.log('  die Ratsche in tools/fetch-frist-schau.mjs herabsetzen, sonst schuetzt sie weniger als moeglich.')
  } else if (!still && offen.length) {
    console.log(`${rel}: ${offen.length} bekannte Altlast(en) ohne Frist (Zeilen ${offen.join(', ')})`)
  }
}

process.exit(bruch ? 1 : 0)
