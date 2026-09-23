#!/usr/bin/env node
/**
 * WER LIEST WELCHES DARSTELLUNGS-FELD?
 *
 * Seit dem 05.09.2026 gilt auf dieser Seite: NUR NOCH WIRKSAME FELDER
 * (Betreiber: „da kein altes Theme-System mehr da, gibt es nur noch
 * wirksame"). Es gibt EINE Oberflaeche (NewDesign, /neu) — die
 * Zwei-Schirm-Messung dieses Werkzeugs (neu/klassisch/beide) ist mit den
 * NUR_NEU/NUR_KLASSISCH-Listen der Seite gefallen.
 *
 * Was bleibt, ist die schaerfere Frage in ZWEI Richtungen:
 *
 *   1. Steht im `interface Darstellung` der Verwaltung ein Feld, das
 *      NewDesign/app.js nicht liest? Dann bietet die Seite einen Schalter
 *      an, der nichts tut — die Sorte Fehler, gegen die sie gebaut ist.
 *   2. Kennt das Themenformat (mixpi-thema.ts, flach:-Anker) ein Feld, das
 *      die Verwaltung nicht anbietet? Dann laesst sich ein Thema nur per
 *      Datei-Import setzen, aber nicht in der Verwaltung bauen — und
 *      „Themen bauen in der Verwaltung" war die Betreiber-Entscheidung
 *      (E120).
 *
 * WARUM NICHT EINFACH `grep -c`: Dieser Baum ist dicht kommentiert. Ein
 * `grep -c platzBeimBlaettern NewDesign/app.js` meldet 28 Treffer, von denen
 * die Mehrzahl in Fliesstext-Kommentaren steht. Kommentare werden hier also
 * ENTFERNT, bevor gezaehlt wird — sonst zaehlt man Prosa.
 *
 * Ebenso zaehlt eine ERKLAERUNG nicht als Benutzung: die Interface-Zeile und
 * die Vorbelegung nennen jedes Feld, auch eines, das niemand mehr liest.
 * Gezaehlt wird nur der echte Zugriff (`w.feld`, `this.stand().feld`).
 *
 *   node tools/darstellung-felder-wer.mjs             Tabelle
 *   node tools/darstellung-felder-wer.mjs --json      fuer andere Werkzeuge
 *   node tools/darstellung-felder-wer.mjs --pruefen   Wache (rot bei 1./2.)
 *
 * Verwandt: tools/wischrand-schau.mjs (haelt die Wisch-Werksbelegung in
 * Verwaltung und NewDesign gleich).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..')

const ADMIN = join(WURZEL, 'src/frontend-admin/src/app/seiten/darstellung.ts')
const NEU = join(WURZEL, 'NewDesign/app.js')
const FORMAT = join(WURZEL, 'src/backend-api/src/mixpi-thema.ts')

/**
 * Flach-Anker des Formats, die BEWUSST keinen Regler auf der
 * Darstellungs-Seite haben — jede Ausnahme mit Grund, sonst waere die Liste
 * das Loch, durch das die naechste Luecke schluepft.
 */
const OHNE_REGLER = {
  farbe: 'haengt am Profil (/api/profil/aussehen) und am Farbsatz-Waehler, nicht an dieser Seite',
  licht: 'haengt am Profil (/api/profil/aussehen) — hell/dunkel stellt der Licht-Schalter der Box',
}

/**
 * Kommentare entfernen — Zeilen-, Block- und HTML-Kommentare.
 *
 * KEIN ECHTER PARSER, und das reicht: gesucht werden Feldnamen, und ein
 * Feldname in einer Zeichenkette („mupibox_darstellung_v1") ist kein Leser.
 * Die Laenge bleibt erhalten (Ersatz durch Leerzeichen), damit gemeldete
 * Zeilennummern stimmen.
 */
function ohneKommentar(text) {
  const leer = (m) => m.replace(/[^\n]/g, ' ')
  return text
    .replace(/\/\*[\s\S]*?\*\//g, leer)
    .replace(/<!--[\s\S]*?-->/g, leer)
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, v) => v + leer(m.slice(v.length)))
}

/** Die Feldnamen aus dem `interface Darstellung` der Verwaltungsseite. */
function felderLesen() {
  const quelle = ohneKommentar(readFileSync(ADMIN, 'utf8'))
  const block = quelle.match(/interface Darstellung \{([\s\S]*?)\n\}/)
  if (!block) throw new Error('interface Darstellung nicht gefunden — ist die Seite umgebaut?')
  return [...block[1].matchAll(/^\s{2}([a-zA-Z][a-zA-Z0-9]*)\??:/gm)].map((m) => m[1])
}

/** Die flach:-Anker des Themenformats — was ein Thema setzen kann. */
function ankerLesen() {
  const quelle = ohneKommentar(readFileSync(FORMAT, 'utf8'))
  return [...quelle.matchAll(/flach: '([A-Za-z]+)'/g)].map((m) => m[1])
}

/**
 * Zeilen, an denen ein Feld in einer Datei GELESEN wird.
 *
 * Ausgenommen ist `roh.feld` (die feldweise Pruefung, die aus der Datei
 * einliest — keine Nutzung). Uebrig bleibt der echte Zugriff — `w.feld`,
 * `this.stand().feld`, `werte().feld`.
 */
function leserZeilen(datei, feld) {
  let quelle
  try {
    quelle = ohneKommentar(readFileSync(datei, 'utf8'))
  } catch {
    return []
  }
  const treffer = []
  quelle.split('\n').forEach((zeile, i) => {
    const ohnePruefung = zeile.replace(new RegExp(`\\broh\\.${feld}\\b`, 'g'), '')
    // Ein Zugriff hat immer einen Punkt davor: `x.feld`. Eine Deklaration
    // (`feld: boolean`) und eine Vorbelegung (`feld: false,`) haben keinen.
    if (new RegExp(`\\.${feld}\\b`).test(ohnePruefung)) treffer.push(i + 1)
  })
  return treffer
}

export function messen() {
  return felderLesen().map((feld) => ({ feld, neu: leserZeilen(NEU, feld).length }))
}

const zeilen = messen()

if (process.argv.includes('--pruefen')) {
  let schief = 0

  // Richtung 1: jedes Interface-Feld hat einen Leser in app.js.
  for (const z of zeilen) {
    if (z.neu > 0) continue
    schief++
    console.error(
      `„${z.feld}" steht im interface Darstellung, aber NewDesign/app.js liest es nicht.\n` +
        `  Ein Schalter ohne Wirkung — Feld entfernen oder den Leser bauen.`,
    )
  }

  // Richtung 2: jeder Format-Anker ist in der Verwaltung stellbar (oder
  // steht mit Grund in OHNE_REGLER).
  const imInterface = new Set(zeilen.map((z) => z.feld))
  for (const anker of ankerLesen()) {
    if (imInterface.has(anker) || anker in OHNE_REGLER) continue
    schief++
    console.error(
      `Das Themenformat kennt „${anker}", die Darstellungs-Seite bietet es nicht an.\n` +
        `  Themen bauen in der Verwaltung (E120) braucht den Regler — oder eine\n` +
        `  benannte Ausnahme in OHNE_REGLER dieses Werkzeugs.`,
    )
  }

  if (schief) {
    console.error(`\n${schief} Abweichung(en). Interface: ${ADMIN.replace(`${WURZEL}/`, '')}.`)
    process.exit(1)
  }
  console.log(
    `Alle ${zeilen.length} Interface-Felder haben Leser in app.js; ` +
      `alle Format-Anker sind stellbar (${Object.keys(OHNE_REGLER).length} benannte Ausnahmen).`,
  )
} else if (process.argv.includes('--json')) {
  console.log(JSON.stringify(zeilen, null, 2))
} else {
  const ohne = zeilen.filter((z) => z.neu === 0)
  console.log(`${zeilen.length} Felder in interface Darstellung (Verwaltung)\n`)
  for (const z of zeilen) console.log(`   ${z.feld.padEnd(22)} Leser in app.js:${String(z.neu).padStart(3)}`)
  if (ohne.length) {
    console.log(`\n${ohne.length} Feld(er) OHNE Leser — nachsehen, bevor etwas entfernt wird:`)
    for (const z of ohne) console.log(`   ${z.feld}`)
  }
}
