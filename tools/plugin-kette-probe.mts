/**
 * PLUGIN-KETTE-PROBE — geht ein Medien-Plugin den ganzen Weg?
 *
 * ══ WOZU ═══════════════════════════════════════════════════════════════════
 * Ein Medien-Plugin ist erst dann brauchbar, wenn SECHS Stellen zusammen
 * passen — und jede einzelne kann fuer sich gruen sein, waehrend die Kette
 * reisst. Genau das ist am 22.08.2026 zweimal passiert:
 *
 *   * `mixpi-archive` lieferte Folgen ohne `kennung`. Plugin gruen (22
 *     Zeugen), Kern haette jede Folge STILL uebergangen.
 *   * Der Vorschlag trug `type: 'mixpi-archive'`. `dienstVon()` machte daraus
 *     `anderes`, `artVon()` ebenso — eine Kachel, die nicht spielt.
 *
 * Beides haette dieses Werkzeug in einem Lauf gezeigt.
 *
 * ══ WAS ES PRUEFT ══════════════════════════════════════════════════════════
 *   1. `http/suche` antwortet und liefert Werke
 *   2. der Vorschlag hat die Form, die der Kern seit E87 versteht
 *   3. `dienstVon` erkennt ihn als `plugin`
 *   4. `medienSchluessel` baut eine aufloesbare Identitaet
 *   5. `artVon` gibt `show` und nicht `anderes`
 *   6. `inhalt()` liefert Folgen MIT Kennung und mit Tonadresse
 *
 * Es geht ins ECHTE Netz und aendert nichts.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *     npx tsx tools/plugin-kette-probe.mts mixpi-archive "rübezahl"
 *     npx tsx tools/plugin-kette-probe.mts mixpi-archive       # Vorgabe-Suche
 *
 * `.mts` UND NICHT `.ts`, und das ist kein Geschmack: dieses Verzeichnis hat
 * kein `"type": "module"`, esbuild uebersetzt `.ts` deshalb nach CJS — und
 * dort ist Top-Level-`await` ein Uebersetzungsfehler. Der Lauf bricht mit
 * „Top-level await is currently not supported" ab, bevor eine Zeile laeuft.
 * `tools/ard-modul-probe.ts` kommt ohne aus und darf `.ts` bleiben.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { dienstVon, medienSchluessel, pluginKennungAus } from '../src/backend-api/src/medien.ts'
import { kennungZerlegen } from '../src/backend-api/src/plugin-vertrag.ts'
import { werkAus } from '../src/backend-api/src/werke.ts'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const WURZEL = path.resolve(HIER, '..')

const kennung = process.argv[2]
const begriff = process.argv[3] ?? 'hörspiel'
if (!kennung) {
  console.error('Aufruf: npx tsx tools/plugin-kette-probe.ts <plugin-kennung> [suchbegriff]')
  process.exit(2)
}

let fehler = 0
const sagen = (frage: string, gut: boolean, befund = '') => {
  if (!gut) fehler++
  console.log(`${gut ? '  ok  ' : ' FEHL '} ${frage}`)
  if (befund) console.log(`         ${befund}`)
}

const plugin = (await import(path.join(WURZEL, 'plugins', kennung, 'index.mjs'))).default
const kontext = {
  protokoll: () => {},
  einstellungen: Object.freeze({ sprache: 'ger', treffer: 3 }),
  holen: (a: string, g: RequestInit) => fetch(a, g),
}

console.log(`Kette fuer ${kennung}, Suchbegriff "${begriff}"\n${'─'.repeat(66)}\n`)

// ── 1. Suchen ─────────────────────────────────────────────────────────────
if (typeof plugin.http !== 'function') {
  sagen('hat eine http()-Flaeche?', false, 'ohne sie gibt es nichts zum Aufnehmen')
  process.exit(1)
}
const s = await plugin.http({ methode: 'GET', pfad: 'suche', abfrage: { q: begriff }, rumpf: null }, kontext)

/* DER FELDNAME IST NICHT VERTRAGLICH, und das ist eine Beobachtung, keine
 * Beschwerde: `http()` ist eine FREIE Flaeche (E77) — was darunter steht,
 * entscheidet jedes Plugin selbst. `mixpi-archive` nennt seine Liste `werke`,
 * `mixpi-ardsounds` nennt sie `sendungen`.
 *
 * Dieses Werkzeug hiess beim ersten Lauf deshalb faelschlich „0 Treffer" fuer
 * ardsounds. Statt einen Namen zu erzwingen, sucht es die erste Liste, deren
 * Eintraege einen `vorschlag` tragen — DER ist die Form, auf die es hier
 * ankommt. Wer eine Liste ohne Vorschlaege liefert, hat nichts zum Aufnehmen,
 * und genau das soll herauskommen. */
const listen = Object.entries(s?.inhalt ?? {}).filter(
  ([, v]) => Array.isArray(v) && v.length > 0 && typeof (v[0] as { vorschlag?: unknown })?.vorschlag === 'object',
)
const [feldName, werke] = (listen[0] ?? ['—', []]) as [string, Record<string, unknown>[]]
sagen(
  'http/suche liefert Werke mit Vorschlag?',
  werke.length > 0,
  werke.length ? `${werke.length} unter "${feldName}"` : `keine Liste mit Vorschlaegen in: ${Object.keys(s?.inhalt ?? {}).join(', ') || 'nichts'}`,
)
if (!werke.length) process.exit(1)

const w = werke[0]
console.log(`\n  Werk: ${w.titel} — ${w.urheber ?? w.herausgeber ?? '?'}\n`)

// ── 2..5. Der Vorschlag durch die Kernfunktionen ──────────────────────────
const v = w.vorschlag
sagen('der Vorschlag ist da?', Boolean(v), JSON.stringify(v))
if (!v) process.exit(1)

/* ZWEI WEGE SIND RICHTIG, und ein Pruefer, der den einen als Fehler meldet,
 * wird zu Recht ignoriert.
 *
 *   GENERISCH  `type: 'plugin'` — der Weg seit E87, den jedes NEUE
 *              Medien-Plugin nimmt.
 *   KERN       `type: 'ard' | 'spotify' | 'jellyfin' | 'radio' | 'rss' |
 *              'library'` — Dienste, die im Kern eigene Wege haben.
 *              `mixpi-ardsounds` liefert `type: 'ard'`, und das ist KORREKT:
 *              die Box hat fuer ARD eigene Dienste, die mehr koennen als der
 *              generische Weg (Reihenfolge, Vorspann, gemerkte Folge).
 *
 * Falsch ist nur das DRITTE: ein `type`, den `dienstVon()` nicht kennt. Der
 * wird zu `anderes`, und die Kachel spielt nicht. Genau das war der Zustand
 * von `mixpi-archive` vor E88. */
const KERN_DIENSTE = ['ard', 'spotify', 'jellyfin', 'radio', 'rss', 'lokal']
const dienst = dienstVon(v)
const generisch = dienst === 'plugin'
const ueberKern = KERN_DIENSTE.includes(dienst)

sagen(
  'kennt der Kern den type?',
  generisch || ueberKern,
  generisch
    ? `type=${v.type} — der generische Plugin-Weg (E87)`
    : ueberKern
      ? `type=${v.type} — geht ueber den KERN-Weg von "${dienst}", nicht ueber den generischen. Auch richtig.`
      : `type=${v.type} -> dienst "${dienst}" — die Kachel spielt NICHT`,
)

const schluessel = medienSchluessel(v)
sagen('medienSchluessel ist aufloesbar?', Boolean(schluessel) && !schluessel.startsWith('anderes:'), schluessel)

const art = werkAus(v).art
sagen('artVon gibt eine oeffenbare Art?', art !== 'anderes', `art -> ${art}`)

if (!generisch) {
  console.log(`\n  Dieses Plugin geht ueber den KERN-Weg von "${dienst}" —`)
  console.log('  die restlichen Fragen gelten nur fuer den generischen Weg.\n')
  console.log('─'.repeat(66))
  console.log(fehler === 0 ? 'Die Kette traegt (ueber den Kern-Weg).' : `${fehler} Stelle(n) reissen.`)
  process.exit(fehler === 0 ? 0 : 1)
}

const mk = pluginKennungAus(v)
const z = mk ? kennungZerlegen(mk) : null
sagen('die Kennung zerlegt sich?', Boolean(z), z ? `${z.kennung} + ${z.rest}` : 'kennungZerlegen sagt null')
if (!z) process.exit(1)
sagen('und zeigt auf DIESES Plugin?', z.kennung === kennung, `${z.kennung} gegen ${kennung}`)

// ── 6. Die Folgenliste ────────────────────────────────────────────────────
if (typeof plugin.inhalt !== 'function') {
  sagen('hat eine inhalt()-Methode?', false, 'ohne sie zeigt die Kachel nichts')
  process.exit(1)
}
const inhalt = await plugin.inhalt(z.rest, kontext)
const folgen = inhalt?.folgen ?? []
sagen('inhalt() liefert Folgen?', folgen.length > 0, `${folgen.length} Folgen — "${inhalt?.titel}"`)

/* DER FUND VOM 22.08.2026, und deshalb steht er hier als eigene Frage:
 * `inhaltPruefen` uebergeht eine Folge OHNE Kennung STILL. Ein Plugin, dessen
 * Folgen keine tragen, ist gruen und liefert dem Kern eine leere Liste. */
const ohneKennung = folgen.filter((f: { kennung?: string }) => !String(f?.kennung ?? '').trim())
sagen(
  'JEDE Folge traegt eine Kennung?',
  ohneKennung.length === 0,
  ohneKennung.length ? `${ohneKennung.length} ohne — der Kern uebergeht sie STILL` : `z. B. "${folgen[0]?.kennung}"`,
)

const kennungen = folgen.map((f: { kennung?: string }) => f?.kennung)
sagen('sind sie eindeutig?', new Set(kennungen).size === kennungen.length, `${new Set(kennungen).size} von ${kennungen.length}`)

const ohneTon = folgen.filter((f: { quelle?: { adresse?: string } }) => !String(f?.quelle?.adresse ?? '').trim())
sagen('JEDE Folge hat eine Tonadresse?', ohneTon.length === 0, folgen[0]?.quelle?.adresse?.slice(0, 60) ?? '')

console.log(`\n${'─'.repeat(66)}`)
console.log(fehler === 0 ? 'Die Kette traegt.' : `${fehler} Stelle(n) reissen.`)
process.exit(fehler === 0 ? 0 : 1)
