/**
 * KENNT DIE SUCHE JEDE AKTION, DIE DIE BOX WIRKLICH MELDET?
 *
 * WOZU: Die Titel der Systemaktionen („Box neu starten", „Medien neu
 * einlesen", …) stehen in AKTIONEN (src/backend-api/src/system.ts) und kommen
 * ueber GET /api/system. In den Vorlagen steht nur {{ a.titel }}, und
 * Interpolationen wirft tools/verwaltung-suchbestand.mjs weg — deshalb holt
 * die Suche diese Liste SELBST (aktionenHolen in suche.ts). Damit kann kein
 * Titel mehr fehlen.
 *
 * WAS TROTZDEM STILL SCHIEFGEHEN KANN, und nur dafuer gibt es dieses Werkzeug:
 * Der Server sagt zu jeder Aktion einen BEREICH ('medien' | 'box'). Daraus
 * macht AKTION_ORT in suche.ts die Seite, auf die der Treffer zeigt. Traegt
 * jemand im Backend einen DRITTEN Bereich ein, kennt die Verwaltung ihn nicht
 * und faellt auf „System" zurueck — der Treffer fuehrt dann auf eine Seite,
 * auf der der Knopf gar nicht steht. Und das ist der teure Fall: man sucht
 * dort weiter (llmwiki: verwaltung-suche-bestand-aus-den-seiten).
 *
 * Kein Test faengt das, weil beide Seiten fuer sich richtig sind. Es faellt
 * nur auf, wenn man eine ECHTE Box fragt.
 *
 * WAS ES AENDERT: nichts. Ein einziger lesender GET.
 *
 * AUFRUF
 *     node tools/verwaltung-suche-aktionen.mjs                # 192.168.178.169:8200
 *     node tools/verwaltung-suche-aktionen.mjs --box 10.0.0.5:8200
 *     node tools/verwaltung-suche-aktionen.mjs --pruefen      # fuer pruefen.sh
 *
 * MIT --pruefen ENDET ES STILL MIT 0, WENN KEINE BOX ANTWORTET. Ein
 * Arbeitsplatz ohne Box soll die Gesamtpruefung nicht rot machen — dieselbe
 * Regel wie bei tools/marke-am-geraet.mjs.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HIER = dirname(fileURLToPath(import.meta.url))
const WURZEL = join(HIER, '..')
const SUCHE = join(WURZEL, 'src/frontend-admin/src/app/suche.ts')

function arg(name, standard) {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : standard
}

const BOX = arg('--box', '192.168.178.169:8200')
const PRUEFEN = process.argv.includes('--pruefen')

/**
 * Welche Bereiche die Verwaltung kennt — GELESEN, nicht aufgezaehlt.
 *
 * Eine Liste hier waere eine dritte Wahrheit ueber dieselbe Sache. Gelesen
 * wird der Kopf von AKTION_ORT in suche.ts.
 *
 * FINDET DER AUSDRUCK NICHTS, IST DAS EIN FEHLER UND KEIN „nichts gefunden":
 * ein Werkzeug, das bei kaputtem Ausdruck still gruen wird, ist schlimmer als
 * keines — es behauptet, geprueft zu haben.
 */
export function bereicheDerVerwaltung(quelle = readFileSync(SUCHE, 'utf8')) {
  const anfang = quelle.indexOf('export const AKTION_ORT')
  if (anfang < 0) throw new Error('AKTION_ORT steht nicht mehr in suche.ts')
  const auf = quelle.indexOf('= {', anfang)
  const zu = quelle.indexOf('\n}', auf)
  if (auf < 0 || zu < 0) throw new Error('AKTION_ORT laesst sich nicht abgrenzen')
  const block = quelle.slice(auf, zu)
  const raus = new Map()
  for (const t of block.matchAll(
    /^\s{2}(\w+):\s*\{\s*name:\s*'([^']*)',\s*weg:\s*'([^']*)',\s*abschnitt:\s*'([^']*)'/gm,
  )) {
    raus.set(t[1], { name: t[2], weg: t[3], abschnitt: t[4] })
  }
  if (raus.size === 0) throw new Error('AKTION_ORT: kein einziger Bereich gelesen — der Ausdruck passt nicht mehr')
  return raus
}

/** Die Aktionen, die eine laufende Box meldet. */
export async function aktionenDerBox(box = BOX) {
  const antwort = await fetch(`http://${box}/api/system`, { signal: AbortSignal.timeout(8000) })
  if (!antwort.ok) throw new Error(`GET /api/system: ${antwort.status}`)
  const lage = await antwort.json()
  return Array.isArray(lage?.aktionen) ? lage.aktionen : []
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const bereiche = bereicheDerVerwaltung()
  let aktionen
  try {
    aktionen = await aktionenDerBox()
  } catch (e) {
    console.log(`keine Box unter ${BOX} (${e.message})`)
    process.exit(PRUEFEN ? 0 : 1)
  }

  const fremd = []
  let ohneAngabe = 0
  for (const a of aktionen) {
    const ort = a.bereich === undefined ? undefined : bereiche.get(a.bereich)
    if (ort) {
      console.log(`  ${a.titel}\n      → ${ort.name} › ${ort.abschnitt}   (${a.bereich})`)
    } else if (a.bereich === undefined) {
      // ALTER SERVERSTAND, kein Fehler. Der Rueckfall in suche.ts geht dann
      // nach `einschneidend` — und der ist nachgesehen, nicht geraten: die
      // Systemseite zeichnet ALLE einschneidenden Aktionen ohne nach `bereich`
      // zu fragen, die Medienseite zeichnet nur die mit bereich 'medien'.
      ohneAngabe++
      console.log(
        `  ${a.titel}\n      → ${a.einschneidend ? `${bereiche.get('box')?.name} (Rueckfall ueber einschneidend)` : 'GAR NICHT — auf diesem Serverstand hat die Aktion keinen Knopf'}`,
      )
    } else {
      fremd.push(a)
      console.log(`  ${a.titel}\n      → UNBEKANNTER BEREICH "${a.bereich}" — die Suche kennt ihn nicht`)
    }
  }
  console.log(`\n${aktionen.length} Aktionen von ${BOX}, ${bereiche.size} Bereiche in suche.ts bekannt.`)
  if (ohneAngabe > 0) {
    console.log(
      `HINWEIS: ${ohneAngabe} Aktion(en) ohne Bereichsangabe — der Serverstand auf dieser Box ist\n` +
        'aelter als der 03.08.2026. Kein Fehler; nach dem Ausrollen kommt das Feld mit.',
    )
  }
  if (fremd.length) {
    console.log(
      `\nFEHLER: ${fremd.length} Aktion(en) mit einem Bereich, den die Verwaltung nicht kennt.\n` +
        'Nachtragen in AKTION_ORT (src/frontend-admin/src/app/suche.ts) — samt der\n' +
        'Ueberschrift, unter der die Knoepfe auf der Seite stehen.',
    )
    process.exit(1)
  }
}
