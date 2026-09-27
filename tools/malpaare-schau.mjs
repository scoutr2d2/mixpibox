#!/usr/bin/env node
/**
 * HOLT DIE EINE SEITE UND ZEICHNET DIE ANDERE? — der Fehler, den nichts faengt.
 *
 * ══ DER FALL, WEGEN DEM ES DAS GIBT ═══════════════════════════════════════
 * Betreiber, 21.08.2026: „schau dir mal system/leistung an das klappt nicht
 * so". Die Seite blieb auf „Wird geholt …" stehen — fuer immer.
 *
 * Die Ursache war EINE Zeile am Ende von `leistungHolen()`:
 *
 *     if (this.fach !== 'leistung') return   // wacht auf „leistung"
 *     ...
 *     this.boxMalen()                        // zeichnet aber „info"
 *
 * und `boxMalen` beginnt mit `if (this.fach !== 'info') return`. Die Daten
 * kamen die ganze Zeit an (200, volle Antwort, am Geraet nachgemessen), der
 * Zustand wurde gesetzt — nur zeichnete nie jemand.
 *
 * ══ WARUM KEIN TEST DAS FINDET ════════════════════════════════════════════
 * Der Aufruf ist syntaktisch fehlerlos, `boxMalen` gibt es wirklich, und sie
 * tut brav nichts. Es gibt keine Ausnahme, keine Warnung, keinen roten Test —
 * nur eine Seite, die leer bleibt. Ein Abschreibfehler dieser Art wandert beim
 * Kopieren einer Nachbarfunktion unbemerkt mit; `boxHolen` und `sysHolen`
 * daneben enden voellig zu Recht auf `boxMalen`.
 *
 * ══ WAS DIESES WERKZEUG PRUEFT ════════════════════════════════════════════
 * Fuer jede `async …Holen()`-Funktion: auf welches Fach sie WACHT
 * (`this.fach !== 'x'`) und welches `…Malen()` sie am Ende RUFT. Passt der
 * Name des gerufenen Malers nicht zum bewachten Fach, ist das ein Verdacht.
 *
 * ES IST EINE HEURISTIK UND GIBT SICH AUCH SO. Erlaubt sind ausdruecklich:
 *   * `fachMalen()` — der Verteiler, der ohnehin zum richtigen Zweig geht.
 *   * Paare, die bewusst quer liegen (`tonHolen` zeichnet die Bluetooth-
 *     Seite, denn dort steht die Tonausgabe). Sie stehen unten in AUSNAHMEN,
 *     mit Begruendung — eine Ausnahme ohne Grund ist ein zweiter Fehler.
 *
 * ══ AUFRUF ════════════════════════════════════════════════════════════════
 *     node tools/malpaare-schau.mjs
 *     node tools/malpaare-schau.mjs --datei NewDesign/app.js
 *
 * Rueckgabe 0 = alle Paare stimmen, 1 = mindestens ein Verdacht.
 */

import { readFileSync } from 'node:fs'

/**
 * Paare, die ABSICHTLICH quer liegen — je mit Grund.
 *
 * Wer hier etwas eintraegt, ohne den Grund zu nennen, macht aus einem Fund
 * eine Fussnote. Der Grund ist der Zweck dieser Liste.
 */
const AUSNAHMEN = {
  tonHolen: {
    malt: 'btMalen',
    grund: 'Die Tonausgabe steht auf der Bluetooth-Seite; ein eigenes Fach hat sie nicht.',
  },
  helligkeitHolen: {
    malt: 'anzeigeMalen',
    grund: '`anzeigeMalen` ist der Sammelmaler der Darstellungs-Faecher, `farbe` ist eines davon.',
  },
  darstHolen: {
    malt: 'anzeigeMalen',
    grund: 'Dasselbe wie bei helligkeitHolen — es bewacht kein einzelnes Fach.',
  },
  kindMedienHolen: { malt: 'kinderMalen', grund: 'Unterschirm der Kinder-Seite.' },
  kindVorbilderHolen: { malt: 'kinderMalen', grund: 'Unterschirm der Kinder-Seite.' },
  qrNetzHolen: { malt: 'diensteMalen', grund: 'Der QR-Schirm ist ein Blatt der Dienste-Seite.' },
  dienstKonfigHolen: { malt: 'diensteMalen', grund: 'Blatt der Dienste-Seite.' },
  jfLageHolen: { malt: 'diensteMalen', grund: 'Blatt der Dienste-Seite.' },
  tonCodeHolen: { malt: 'diensteMalen', grund: 'Blatt der Dienste-Seite.' },
  btHolen: { malt: 'btMalen', grund: 'Passt (bewacht kein Fach, zeichnet sein eigenes).' },
  medienHolen: { malt: 'medienMalen', grund: 'Passt.' },
}

/** `fachMalen` ist der Verteiler — er landet immer beim richtigen Zweig. */
const VERTEILER = 'fachMalen'

/**
 * Faecher, deren Maler ANDERS heisst als sie selbst.
 *
 * Das Fach „info" wird von `boxMalen` gezeichnet — historisch, weil die Seite
 * „Die Box" heisst. Die Namensregel greift dort nicht, und ohne diese
 * Zuordnung meldete das Werkzeug zwei gesunde Paare als Verdacht. Ein Pruefer,
 * der bei gesundem Code Alarm schlaegt, wird abgeschaltet.
 */
const MALER_ZU_FACH = {
  info: 'boxMalen',
}

/**
 * Kommentare weg, bevor gesucht wird.
 *
 * SONST ZAEHLT EIN AUFRUF, DEN JEMAND NUR BESCHREIBT. Genau hier passiert:
 * die Berichtigung von `leistungHolen` erklaert im Kommentar, dass dort
 * frueher `this.boxMalen()` stand — und das Werkzeug las es als zweiten
 * Maler und gab Entwarnung. Ein Pruefer, den ein Kommentar beruhigt, prueft
 * nichts.
 */
function ohneKommentare(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
}

function paareLesen(quelle) {
  const raus = []
  const re = /async (\w+Holen)\(\)\s*\{([\s\S]*?)\n    \},/g
  let m
  while ((m = re.exec(quelle)) !== null) {
    const name = m[1]
    const koerper = ohneKommentare(m[2])
    const faecher = [...koerper.matchAll(/this\.fach !== '(\w+)'/g)].map((x) => x[1])
    const maler = [...koerper.matchAll(/this\.(\w+Malen)\(\)/g)].map((x) => x[1])
    if (maler.length === 0) continue
    raus.push({ name, faecher: [...new Set(faecher)], maler: [...new Set(maler)] })
  }
  return raus
}

/**
 * Passt der Maler zum bewachten Fach?
 *
 * Die Regel ist bewusst grob: `leistung` -> `leistungMalen`. Sie trifft die
 * Namensgebung dieses Hauses, und wo sie danebenliegt, steht eine Ausnahme.
 */
function stimmt(paar) {
  if (paar.faecher.length === 0) return true
  if (paar.maler.includes(VERTEILER)) return true
  const a = AUSNAHMEN[paar.name]
  if (a && paar.maler.includes(a.malt)) return true
  return paar.faecher.some((f) => {
    const erwartet = MALER_ZU_FACH[f]
    if (erwartet && paar.maler.includes(erwartet)) return true
    return paar.maler.some((m) => m.toLowerCase().startsWith(f.toLowerCase()))
  })
}

const datei = process.argv.includes('--datei')
  ? process.argv[process.argv.indexOf('--datei') + 1]
  : 'NewDesign/app.js'

let quelle
try {
  quelle = readFileSync(datei, 'utf8')
} catch (e) {
  console.error(`${datei} nicht lesbar: ${e.message}`)
  process.exit(2)
}

const paare = paareLesen(quelle)
if (paare.length === 0) {
  console.error(`In ${datei} wurde keine einzige "async …Holen()" gefunden — passt das Muster noch?`)
  process.exit(2)
}

const verdacht = paare.filter((p) => !stimmt(p))

console.log(`${datei}: ${paare.length} Holen-Funktionen geprueft.`)
for (const p of paare) {
  const zeichen = stimmt(p) ? 'ok  ' : 'X   '
  const wo = p.faecher.length ? p.faecher.join('/') : '(kein Fach)'
  console.log(`  ${zeichen}${p.name.padEnd(22)} wacht auf ${wo.padEnd(12)} malt ${p.maler.join(', ')}`)
}

if (verdacht.length === 0) {
  console.log('\nAlle Paare stimmen.')
  process.exit(0)
}

console.log(`\n${verdacht.length} Verdacht/Verdachtsfaelle:`)
for (const p of verdacht) {
  console.log(
    `  ${p.name} bewacht "${p.faecher.join('/')}" und ruft ${p.maler.join(', ')}.\n` +
      `    Beginnt der gerufene Maler mit "if (this.fach !== '…') return" auf ein ANDERES Fach,\n` +
      '    zeichnet er nie — die Seite bleibt auf ihrem Ladezustand stehen.\n' +
      `    Ist es Absicht, gehoert ${p.name} mit Grund in AUSNAHMEN.`,
  )
}
process.exit(1)
