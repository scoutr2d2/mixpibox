#!/usr/bin/env node
/**
 * Haelt den Plugin-VERTRAG gegen die ANLEITUNG — und wird rot, wenn einer fehlt.
 *
 * ══ WARUM ES DIESES WERKZEUG GIBT ═══════════════════════════════════════════
 *
 * Zweimal hintereinander wuchs `plugin-vertrag.ts`, ohne dass
 * `plugins/README.md` mitwuchs: E77/E78 (`inhalt()`, Sektionen, Aktionen) und
 * dann gleich wieder E80 (`konfig`). Beim zweiten Mal stand die Regel „im
 * selben Commit beides anfassen" schon im Wiki
 * (llmwiki `anleitung-hinkt-dem-vertrag-hinterher`) — sie half nichts, weil
 * der, der baute, den Eintrag nicht offen hatte.
 *
 * Eine Regel, die niemand liest, ist keine Naht. Dieses Werkzeug ist die Naht:
 * es liest die Namen, die ein FREMDENTWICKLER hinschreiben muss (Manifest-
 * Felder, Kontext-Felder, die geschlossenen Vokabulare, die Vertrags-
 * Methoden), und sucht sie in der Anleitung.
 *
 * ══ WAS ES NICHT KANN ═══════════════════════════════════════════════════════
 *
 * Ein Treffer heisst „das Wort kommt vor", nicht „es ist erklaert" — genau der
 * Fall, an dem E80 vorbeiging: `konfig` stand EINMAL in der Anleitung, im
 * falschen Zusammenhang. Deshalb meldet das Werkzeug die TREFFERZAHL mit und
 * warnt bei genau einem Treffer, statt ihn als „dokumentiert" durchzuwinken.
 * Das Urteil bleibt bei einem Menschen; das Werkzeug nimmt ihm nur das
 * Uebersehen ab.
 *
 * Aufruf:
 *   node tools/mixpi-vertrag-doku-abgleich.mjs           # Bericht, Code 0/1
 *   node tools/mixpi-vertrag-doku-abgleich.mjs --leise   # nur Fehlendes
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..')
const VERTRAG = join(WURZEL, 'src/backend-api/src/plugin-vertrag.ts')
const LAUFWERK = join(WURZEL, 'src/backend-api/src/plugin-laufwerk.ts')
const ANLEITUNG = join(WURZEL, 'plugins/README.md')

const leise = process.argv.includes('--leise')

/**
 * Namen, die der Anleitung NICHT fehlen duerfen — und warum sie nicht fehlen
 * duerfen: es sind die, die ein Fremdentwickler selbst hinschreibt.
 *
 * Was hier bewusst NICHT steht: interne Pruefnamen (`manifestPruefen`,
 * `fundPruefen`, …). Die ruft niemand von aussen; sie in die Anleitung zu
 * zwingen hiesse, das Werkzeug laut zu machen, wo nichts kaputt ist.
 */
const NICHT_VERLANGT = new Set([
  'manifestPruefen',
  'fundPruefen',
  'inhaltPruefen',
  'einstellungenNormalisieren',
  'einstellungenMaskieren',
  'einstellungenZusammenfuehren',
  'ereignisAusBefehl',
  'praefix',
  // Typnamen: sie beschreiben die FORM, die in der Anleitung als JSON-Beispiel
  // steht — der Fremdentwickler tippt nie das Wort "ManifestUrteil".
  'ManifestUrteil',
  'FundUrteil',
  'InhaltUrteil',
  'Recht',
  'Ereignisname',
  'Feldart',
  'Sektion',
  'KonfigGruppe',
  'RECHTE',
  'EREIGNISSE',
  'FELDARTEN',
  'SEKTIONEN',
  'KONFIG_GRUPPEN',
])

const vertrag = readFileSync(VERTRAG, 'utf8')
const laufwerk = readFileSync(LAUFWERK, 'utf8')
const anleitung = readFileSync(ANLEITUNG, 'utf8')

/** Die Felder EINES Interface — der Block zwischen `interface X {` und der Klammer. */
function felderVonInterface(quelle, name) {
  const anfang = quelle.indexOf(`export interface ${name} {`)
  if (anfang < 0) return []
  const ende = quelle.indexOf('\n}', anfang)
  const block = quelle.slice(anfang, ende)
  return [...block.matchAll(/^\s{2}([a-zA-Z][a-zA-Z0-9]*)\??:/gm)].map((m) => m[1])
}

/** Die Werte eines geschlossenen Vokabulars: `export const X = ['a','b'] as const`. */
function vokabular(quelle, name) {
  const treffer = quelle.match(new RegExp(`export const ${name} = \\[([^\\]]*)\\]`, 's'))
  if (!treffer) return []
  return [...treffer[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
}

const gesucht = new Map() // name -> woher

const merken = (name, woher) => {
  if (NICHT_VERLANGT.has(name)) return
  if (!gesucht.has(name)) gesucht.set(name, woher)
}

for (const f of felderVonInterface(vertrag, 'Manifest')) merken(f, 'Manifest-Feld')
for (const f of felderVonInterface(vertrag, 'Feld')) merken(f, 'Feld-Feld')
for (const f of felderVonInterface(vertrag, 'Aktion')) merken(f, 'Aktion-Feld')
for (const f of felderVonInterface(vertrag, 'Quelle')) merken(f, 'Quelle-Feld')
for (const f of felderVonInterface(vertrag, 'Folge')) merken(f, 'Folge-Feld')
for (const f of felderVonInterface(vertrag, 'Inhalt')) merken(f, 'Inhalt-Feld')
for (const v of vokabular(vertrag, 'RECHTE')) merken(v, 'Recht')
for (const v of vokabular(vertrag, 'EREIGNISSE')) merken(v, 'Ereignis')
for (const v of vokabular(vertrag, 'FELDARTEN')) merken(v, 'Feldart')
for (const v of vokabular(vertrag, 'KONFIG_GRUPPEN')) merken(v, 'Konfig-Gruppe')

/**
 * Die Kontextfelder stehen im LAUFWERK, nicht im Vertrag — dort wird der
 * Kontext gebaut, den das Plugin in die Hand bekommt. Genau dieses Feld
 * (`konfig`) fehlte der Anleitung bei E80.
 */
for (const f of felderVonInterface(laufwerk, 'Kontext')) merken(f, 'Kontext-Feld')

const bericht = []
for (const [name, woher] of [...gesucht].sort()) {
  const treffer = anleitung.split(new RegExp(`\\b${name}\\b`)).length - 1
  bericht.push({ name, woher, treffer })
}

const fehlend = bericht.filter((z) => z.treffer === 0)
const duenn = bericht.filter((z) => z.treffer === 1)

if (!leise) {
  console.log(`Vertrag → Anleitung: ${bericht.length} Namen geprüft`)
  console.log(`  ${VERTRAG.replace(WURZEL + '/', '')}`)
  console.log(`  ${ANLEITUNG.replace(WURZEL + '/', '')}\n`)
}

if (fehlend.length) {
  console.log('FEHLT in der Anleitung:')
  for (const z of fehlend) console.log(`  ${z.name.padEnd(20)} (${z.woher})`)
  console.log('')
}

if (duenn.length && !leise) {
  console.log('NUR EIN TREFFER — nachsehen, ob das der richtige Zusammenhang ist:')
  for (const z of duenn) console.log(`  ${z.name.padEnd(20)} (${z.woher})`)
  console.log('')
}

if (!fehlend.length && !leise) console.log('Nichts fehlt.')

process.exit(fehlend.length ? 1 : 0)
