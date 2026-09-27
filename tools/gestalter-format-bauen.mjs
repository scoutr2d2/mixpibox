#!/usr/bin/env node
/**
 * GESTALTER-FORMAT-BAUEN — mixpi-thema.ts als Browser-Modul abschreiben.
 *
 * ══ WARUM (BACKLOG E144, 27.09.2026) ═══════════════════════════════════════
 * Der Gestalter (`NewDesign/gestalter/`) prueft jede Eingabe, uebersetzt
 * Bloecke in flache Felder fuer die Live-Vorschau und liest eine Themendatei
 * ein — alles OHNE Box, denn er soll auch als Desktop-App laufen
 * (`desktop/gestalter/`). Dafuer braucht er die Regeln des Formats im Browser.
 *
 * Sie von Hand ein zweites Mal zu schreiben hiesse zwei Wahrheiten, die beim
 * ersten neuen Feld auseinanderlaufen — genau das, wogegen mixpi-thema.ts
 * gebaut ist. Also wird die EINE Datei abgeschrieben: TypeScript entfernt
 * nur die Typen (`transpileModule`, kein Buendeln, keine Umbenennung), der
 * Rest ist Zeichen fuer Zeichen derselbe Code.
 *
 * Die Abschrift liegt EINGECHECKT unter `NewDesign/gestalter/format.mjs`:
 * NewDesign hat keinen Bauschritt, und der Kopierweg auf die Box
 * (tools/newdesign-kopieren.py) nimmt sie so mit, wie sie ist.
 *
 * AUFRUF
 *     node tools/gestalter-format-bauen.mjs            # neu schreiben
 *     node tools/gestalter-format-bauen.mjs --pruefen  # Wache: passt die Abschrift noch?
 *
 * Rueckgabe: 0 = geschrieben bzw. passt; 1 = veraltet (--pruefen) oder Fehler.
 * Gerufen von tools/pruefen.sh (Schritt „Gestalter: Format-Abschrift").
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..')
const QUELLE = join(WURZEL, 'src/backend-api/src/mixpi-thema.ts')
const ZIEL = join(WURZEL, 'NewDesign/gestalter/format.mjs')

const KOPF = `/* ═══════════════════════════════════════════════════════════════════════════
 * ERZEUGT — NICHT VON HAND AENDERN.
 *
 * Abschrift von src/backend-api/src/mixpi-thema.ts (nur die Typen entfernt).
 * Neu bauen:   node tools/gestalter-format-bauen.mjs
 * Wache:       node tools/gestalter-format-bauen.mjs --pruefen  (tools/pruefen.sh)
 * Warum es sie gibt, steht im Kopf des Werkzeugs.
 * ═══════════════════════════════════════════════════════════════════════════ */
`

function bauen() {
  // typescript liegt im Wurzel-node_modules (Arbeitsbereiche); ueber require
  // aus der Backend-Mappe gesucht, damit es auch dort gefunden wird, wo nur
  // der Bereich installiert ist.
  const require = createRequire(join(WURZEL, 'src/backend-api/package.json'))
  const ts = require('typescript')
  const quelltext = readFileSync(QUELLE, 'utf8')
  const aus = ts.transpileModule(quelltext, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
      removeComments: false,
    },
    fileName: 'mixpi-thema.ts',
  })
  return KOPF + aus.outputText
}

const soll = bauen()

if (process.argv.includes('--pruefen')) {
  let ist = ''
  try {
    ist = readFileSync(ZIEL, 'utf8')
  } catch {
    /* fehlt ganz */
  }
  if (ist !== soll) {
    console.log('VERALTET: NewDesign/gestalter/format.mjs passt nicht mehr zu mixpi-thema.ts.')
    console.log('  Neu bauen: node tools/gestalter-format-bauen.mjs')
    process.exit(1)
  }
  console.log('Gestalter-Format: Abschrift passt zu mixpi-thema.ts.')
  process.exit(0)
}

writeFileSync(ZIEL, soll)
console.log(`geschrieben: ${ZIEL.slice(WURZEL.length + 1)} (${soll.length} Zeichen)`)
