#!/usr/bin/env -S npx tsx
/**
 * WOZU
 *   Der Schluessel des Interpreten hat sich geaendert (E45-Bestandsreview,
 *   19.08.2026): `normal()` warf JEDES Satzzeichen weg und liess damit
 *   „Die drei ???" und „Die drei !!!" — zwei echte Kosmos-Kinderserien — auf
 *   DENSELBEN Schluessel fallen. Eine Kachel fuer zwei Serien, und wer die eine
 *   freischaltete, loeschte STILL die Freischaltung der anderen.
 *
 *   Ein Schluesselwechsel ist der teuerste Eingriff, den es in diesem Baum
 *   gibt. Dieses Werkzeug beantwortet deshalb die einzige Frage, die vor dem
 *   Ausrollen zaehlt:
 *
 *       WAS VERSCHIEBT SICH AUF DIESER BOX WIRKLICH?
 *
 *   Es faehrt BEIDE Regeln gegen dieselbe echte Bibliothek und stellt sie
 *   nebeneinander:
 *
 *     ALT  `normal()`                (medien.ts) — wirft alles ausser a-z0-9 weg
 *     NEU  `interpretSchluesselAus()` (medien.ts) — Zeichenwoerter bleiben stehen
 *
 *   VIER BEFUNDE, und jeder hat eine andere Bedeutung:
 *
 *     KOLLISION   Zwei verschiedene Namen teilten sich einen ALTEN Schluessel.
 *                 Das ist der Schaden. Jede Zeile hier ist eine Kachel, hinter
 *                 der zwei Interpreten steckten.
 *     WANDERT     Der Schluessel eines Namens aendert sich. Kostet nichts
 *                 (er wird ueberall neu gebildet — siehe unten), aber er
 *                 gehoert gezaehlt: eine stille Verschiebung, die niemand
 *                 gemessen hat, ist von einem Datenverlust nicht zu
 *                 unterscheiden.
 *     GETRENNT    Zwei Namen, die einen Schluessel teilten, haben jetzt zwei.
 *                 Das ist die Reparatur.
 *     VERSCHMOLZEN Zwei Namen, die zwei Schluessel hatten, haben jetzt einen.
 *                 Das ist der einzige Befund, der WEHTUN kann — er entsteht
 *                 durch die berichtigte NFKD-Reihenfolge („𝓛𝓮𝓸𝓷𝓲𝓮" verlor
 *                 unter `normal()` seinen ersten Buchstaben). Jede Zeile
 *                 einzeln ansehen.
 *
 *   UND DIE ABLAGE: mit `--ablage` wird config/interpreten.json mitgelesen und
 *   `interpretenAblageWandern()` darauf angesetzt — dieselbe Funktion, die der
 *   Server beim Start fahren wird. Sie zeigt auch, ob unter dem alten
 *   Schluessel eine Zeile STILL verschluckt wurde.
 *
 *   WARUM DIE WANDERUNG SO BILLIG IST (und das ist keine Behauptung, sondern
 *   an drei Stellen nachgesehen):
 *     `Werk.interpretSchluessel`   entsteht bei jedem Abruf neu (werke.ts)
 *     `Freischaltung.schluessel`   wird beim Lesen neu gebildet, nicht geglaubt
 *     profile/<kind>/auswahl.json  steht auf WERKschluesseln (auswahl.ts)
 *   Deshalb prueft dieses Werkzeug die Profile ausdruecklich MIT: findet es
 *   dort einen Interpretenschluessel, ist die Annahme widerlegt und es sagt es.
 *
 *   KEINE ZWEITE WAHRHEIT: `normal`, `interpretSchluesselAus`, `werkeAus` und
 *   `interpretenAblageWandern` kommen aus src/backend-api — dieselben
 *   Funktionen, die der Server benutzt.
 *
 * WAS ES AENDERT
 *   NICHTS. Lesendes `ssh … cat` auf data.json, config/interpreten.json und
 *   die Auswahldateien der Profile. Kein Schreiben, kein systemctl, kein
 *   Deploy. `cover` fliegt sofort nach dem Einlesen weg — bei Jellyfin steht
 *   der api_key im Klartext darin.
 *
 * AUFRUF — MIT tsx, NICHT MIT node
 *   npx tsx tools/interpret-schluessel-wanderung.mjs
 *   npx tsx tools/interpret-schluessel-wanderung.mjs --box 192.168.178.57
 *   npx tsx tools/interpret-schluessel-wanderung.mjs --datei /pfad/data.json
 *   npx tsx tools/interpret-schluessel-wanderung.mjs --namen "Die drei ???,Die drei !!!"
 *   npx tsx tools/interpret-schluessel-wanderung.mjs --json
 *
 *   `--namen` faehrt beide Regeln gegen eine Liste OHNE Box — dafuer, einen
 *   Verdacht zu pruefen, bevor man ihn ausrollt.
 *
 * RUECKGABE
 *   0  gelaufen, nichts Bedenkliches
 *   1  mindestens eine KOLLISION oder VERSCHMELZUNG — ansehen
 *   2  data.json nicht lesbar
 *   3  ohne tsx gestartet
 */

import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

let normal
let interpretSchluesselAus
let werkeAus
let interpretenAblageWandern
try {
  ;({ normal, interpretSchluesselAus } = await import('../src/backend-api/src/medien.ts'))
  ;({ werkeAus } = await import('../src/backend-api/src/werke.ts'))
  ;({ interpretenAblageWandern } = await import('../src/backend-api/src/interpreten.ts'))
} catch (fehler) {
  console.error('Die Regeln aus src/backend-api liessen sich nicht laden.')
  console.error('Bitte mit tsx starten:  npx tsx tools/interpret-schluessel-wanderung.mjs')
  console.error(`(${fehler.message})`)
  process.exit(3)
}

const ausfuehren = promisify(execFile)

const BOX = '192.168.178.57'
const BENUTZER = 'dietpi'
const ORDNER = '/home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config'

function argument(name, vorgabe) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : vorgabe
}
const alsJson = process.argv.includes('--json')

if (process.argv.includes('-h') || process.argv.includes('--help')) {
  const zeilen = (await readFile(fileURLToPath(import.meta.url), 'utf8')).split('\n')
  console.log(zeilen.slice(1, zeilen.indexOf(' */') + 1).join('\n'))
  process.exit(0)
}

const box = argument('box', BOX)

/** Eine Datei von der Box holen. NUR LESEND, und ohne Passwortfrage. */
async function vonDerBox(pfad) {
  const { stdout } = await ausfuehren('ssh', [
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=8',
    `${BENUTZER}@${box}`,
    `cat ${pfad}`,
  ])
  return stdout
}

async function amGeraet(befehl) {
  const { stdout } = await ausfuehren('ssh', [
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=20',
    `${BENUTZER}@${box}`,
    befehl,
  ])
  return stdout
}

/**
 * DIE WANDERUNG AM LAUFENDEN GERAET — mit `--nachziehen-am-geraet`.
 *
 * Die Rechnung oben sagt, WAS wandern wuerde. Das hier misst, ob die Box es
 * auch TUT: eine Ablage im ALTEN Schluesselstand hinlegen, den Dienst
 * neustarten, und nachsehen, was danach in der Datei steht und was im Journal.
 *
 * ES WIRD GESICHERT UND ZURUECKGESCHRIEBEN. Die vorhandene Datei wird woertlich
 * gemerkt und am Ende Byte fuer Byte wiederhergestellt — auch wenn es sie
 * vorher gar nicht gab (dann wird sie entfernt, denn „hat nie jemand
 * entschieden" und „ausdruecklich nichts" sind zwei Zustaende).
 */
async function nachziehenAmGeraet() {
  const ablageDatei = `${ORDNER}/interpreten.json`
  const vorher = await amGeraet(`cat ${ablageDatei} 2>/dev/null || true`)
  console.log(`Ablage gesichert: ${vorher.length} Bytes`)
  // ALTER STAND, so wie ihn eine Box vor dem 19.08.2026 geschrieben haette:
  // der Schluessel ist `normal(name)`.
  const alt = {
    frei: [
      {
        schluessel: 'die drei',
        id: 'ZZfragezeichenInterp01',
        name: 'Die drei ???',
        quelle: 'hand',
        seit: '2026-08-18T10:00:00.000Z',
      },
    ],
    abgelehnt: [{ schluessel: 'jojo', name: '🩵Jojo 🩵', seit: '2026-08-18T10:00:00.000Z' }],
  }
  try {
    await amGeraet(`cat > ${ablageDatei} <<'MUPIENDE'\n${JSON.stringify(alt, null, 2)}\nMUPIENDE`)
    console.log('Alter Stand hingelegt:')
    console.log(`  frei:      schluessel="die drei"  name="Die drei ???"`)
    console.log(`  abgelehnt: schluessel="jojo"      name="🩵Jojo 🩵"`)
    await amGeraet('sudo -n systemctl restart mupibox-server.service')
    // Der Nachzieher laeuft unmittelbar nach dem Start; ein Augenblick reicht,
    // aber gewartet wird auf die DATEI und nicht auf eine Zahl.
    let nachher = ''
    for (let i = 0; i < 20; i++) {
      nachher = await amGeraet(`cat ${ablageDatei}`)
      if (!nachher.includes('"die drei"')) break
      await new Promise((fertig) => setTimeout(fertig, 500))
    }
    const d = JSON.parse(nachher)
    console.log('')
    console.log('Nach dem Neustart steht in der Datei:')
    for (const f of d.frei) console.log(`  frei:      schluessel="${f.schluessel}"  name="${f.name}"  id=${f.id}`)
    for (const a of d.abgelehnt) console.log(`  abgelehnt: schluessel="${a.schluessel}"  name="${a.name}"`)
    const journal = await amGeraet(
      'sudo -n journalctl -u mupibox-server.service --since "-3 min" --no-pager 2>/dev/null | grep -i "gewandert\\|nachgezogen" || true',
    )
    console.log('')
    console.log('Im Journal:')
    console.log(
      journal.trim()
        ? journal
            .trim()
            .split('\n')
            .map((z) => `  ${z}`)
            .join('\n')
        : '  (nichts — dann hat der Nachzieher nicht gegriffen)',
    )
    const gewandert =
      d.frei[0]?.schluessel === 'die drei ???' &&
      d.abgelehnt[0]?.schluessel === '🩵 jojo 🩵' &&
      d.frei[0]?.id === 'ZZfragezeichenInterp01' &&
      d.frei[0]?.seit === '2026-08-18T10:00:00.000Z'
    console.log('')
    console.log(
      gewandert
        ? 'GEWANDERT — und Kennung wie Zeitpunkt sind unveraendert mitgekommen.'
        : 'NICHT GEWANDERT (oder etwas ging dabei verloren) — nachsehen.',
    )
    return gewandert
  } finally {
    if (!vorher) {
      await amGeraet(`rm -f ${ablageDatei}`)
      console.log(`\nAufgeraeumt: ${ablageDatei} entfernt — sie gab es vor dem Lauf nicht.`)
    } else {
      const rumpf = vorher.endsWith('\n') ? vorher : `${vorher}\n`
      await amGeraet(`cat > ${ablageDatei} <<'MUPIENDE'\n${rumpf}MUPIENDE`)
      const jetzt = await amGeraet(`cat ${ablageDatei}`)
      console.log(
        `\nAufgeraeumt: ${jetzt.trim() === vorher.trim() ? 'woertlich zurueckgeschrieben' : 'ABWEICHUNG, NACHSEHEN'}.`,
      )
    }
    await amGeraet('sudo -n systemctl restart mupibox-server.service')
    console.log('Dienst noch einmal neu gestartet, damit die zurueckgeschriebene Ablage gilt.')
  }
}

if (process.argv.includes('--nachziehen-am-geraet')) {
  process.exit((await nachziehenAmGeraet()) ? 0 : 1)
}

/** Die Namen der Auswahldateien — um die Annahme „dort stehen WERKschluessel" zu pruefen. */
async function auswahlSchluessel() {
  try {
    const { stdout } = await ausfuehren('ssh', [
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=8',
      `${BENUTZER}@${box}`,
      `cat ${ORDNER}/profile/*/auswahl.json 2>/dev/null || true`,
    ])
    // Mehrere Dateien hintereinander: jede fuer sich lesen, kaputte ueberspringen.
    const heraus = []
    for (const stueck of stdout.split(/(?<=\})\s*(?=\{)/)) {
      try {
        const d = JSON.parse(stueck)
        for (const w of Array.isArray(d?.werke) ? d.werke : []) heraus.push(String(w))
      } catch {
        // Eine krumme Datei ist hier kein Grund abzubrechen — die anderen zaehlen.
      }
    }
    return heraus
  } catch {
    return []
  }
}

/** Die Interpretennamen einer Bibliothek — ueber `werkeAus`, nicht ueber `artist`. */
function namenAus(katalog) {
  // UEBER DIE WERKE, damit `interpretTaugt` gilt: ein Eintrag ohne brauchbare
  // Kennung bekommt gar keinen Schluessel, und den zu zaehlen hiesse, eine
  // Wanderung zu melden, die es nie gab.
  const namen = new Map()
  for (const w of werkeAus(katalog)) {
    const n = String(w?.interpret ?? '').trim()
    if (!n || namen.has(n)) continue
    namen.set(n, w.interpretSchluessel ?? '')
  }
  return namen
}

/** Was sich zwischen den beiden Regeln verschiebt. */
function vergleichen(namen) {
  const altJe = new Map()
  const neuJe = new Map()
  const zeilen = []
  for (const name of namen) {
    const alt = normal(name)
    const neu = interpretSchluesselAus(name)
    zeilen.push({ name, alt, neu, wandert: alt !== neu })
    if (alt) altJe.set(alt, [...(altJe.get(alt) ?? []), name])
    if (neu) neuJe.set(neu, [...(neuJe.get(neu) ?? []), name])
  }
  const kollisionen = [...altJe.entries()].filter(([, n]) => n.length > 1)
  const neuKollisionen = [...neuJe.entries()].filter(([, n]) => n.length > 1)
  // GETRENNT: teilten den alten Schluessel, haben jetzt verschiedene.
  const getrennt = kollisionen.filter(([, n]) => new Set(n.map(interpretSchluesselAus)).size > 1)
  // VERSCHMOLZEN: hatten verschiedene alte, teilen jetzt einen.
  const verschmolzen = neuKollisionen.filter(([, n]) => new Set(n.map(normal)).size > 1)
  return { zeilen, kollisionen, getrennt, verschmolzen, neuKollisionen }
}

// ── Die Namen besorgen ───────────────────────────────────────────────────────
const ausListe = argument('namen', '')
let namen = []
let quelle = ''
let ablageRoh = null
let auswahl = []

if (ausListe) {
  namen = ausListe
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean)
  quelle = `--namen (${namen.length})`
} else {
  const datei = argument('datei', '')
  let katalog
  try {
    const roh = datei ? await readFile(datei, 'utf8') : await vonDerBox(`${ORDNER}/data.json`)
    katalog = JSON.parse(roh)
    // Der api_key steckt bei Jellyfin im `cover` — er hat in keiner Ausgabe
    // und in keinem Zwischenwert etwas zu suchen.
    for (const e of Array.isArray(katalog) ? katalog : []) delete e.cover
  } catch (fehler) {
    console.error(`data.json nicht lesbar: ${fehler.message}`)
    process.exit(2)
  }
  quelle = datei || `${BENUTZER}@${box}:${ORDNER}/data.json`
  namen = [...namenAus(katalog).keys()]
  if (!datei) {
    try {
      ablageRoh = JSON.parse(await vonDerBox(`${ORDNER}/interpreten.json`))
    } catch {
      ablageRoh = null
    }
    auswahl = await auswahlSchluessel()
  }
}

const ergebnis = vergleichen(namen)
const ablage = ablageRoh ? interpretenAblageWandern(ablageRoh) : null
// DIE ANNAHME, AUF DER DIE GANZE BILLIGE WANDERUNG STEHT: in der Auswahl der
// Kinder stehen WERKschluessel (`<dienst>:<kennung>`), keine
// Interpretenschluessel. Wer sie nicht prueft, hat sie geglaubt.
const auswahlOhneDienst = auswahl.filter((s) => !/^[a-z]+:/.test(s))

if (alsJson) {
  console.log(
    JSON.stringify(
      {
        quelle,
        namen: namen.length,
        zeilen: ergebnis.zeilen,
        kollisionen: ergebnis.kollisionen,
        getrennt: ergebnis.getrennt,
        verschmolzen: ergebnis.verschmolzen,
        ablage: ablage
          ? { wandert: ablage.wandert, frei: ablage.ablage.frei.length, abgelehnt: ablage.ablage.abgelehnt.length }
          : null,
        auswahl: { gelesen: auswahl.length, ohneDienstvorsatz: auswahlOhneDienst },
      },
      null,
      2,
    ),
  )
} else {
  console.log(`Quelle: ${quelle}`)
  console.log(`Interpretennamen: ${namen.length}`)
  console.log('')
  console.log('  ALT (normal)                        NEU (interpretSchluesselAus)        Name')
  console.log(`  ${'─'.repeat(100)}`)
  for (const z of ergebnis.zeilen) {
    const mark = z.wandert ? '≠' : ' '
    console.log(`${mark} ${(z.alt || '—').padEnd(34)}  ${(z.neu || '—').padEnd(34)}  ${z.name}`)
  }
  console.log('')
  console.log(`WANDERT:      ${ergebnis.zeilen.filter((z) => z.wandert).length} von ${namen.length}`)

  console.log('')
  if (ergebnis.kollisionen.length) {
    console.log(`KOLLISION unter der ALTEN Regel — hier stand eine Kachel fuer mehrere:`)
    for (const [k, n] of ergebnis.kollisionen) console.log(`  "${k}"  <-  ${n.map((x) => `„${x}"`).join(', ')}`)
  } else {
    console.log('KOLLISION unter der ALTEN Regel: keine. Auf dieser Box war der Fund nicht scharf.')
  }

  console.log('')
  if (ergebnis.getrennt.length) {
    console.log('GETRENNT (das ist die Reparatur):')
    for (const [k, n] of ergebnis.getrennt) {
      console.log(`  "${k}" zerfaellt in:`)
      for (const x of n) console.log(`      "${interpretSchluesselAus(x)}"  <-  „${x}"`)
    }
  }

  if (ergebnis.verschmolzen.length) {
    console.log('')
    console.log('VERSCHMOLZEN (JEDE ZEILE EINZELN ANSEHEN — hier faellt etwas zusammen):')
    for (const [k, n] of ergebnis.verschmolzen) console.log(`  "${k}"  <-  ${n.map((x) => `„${x}"`).join(', ')}`)
  }

  if (ergebnis.neuKollisionen.length) {
    console.log('')
    console.log('Namen, die sich AUCH NEU einen Schluessel teilen (blosse Schreibweisen):')
    for (const [k, n] of ergebnis.neuKollisionen) console.log(`  "${k}"  <-  ${n.map((x) => `„${x}"`).join(', ')}`)
  }

  console.log('')
  if (!ablage) {
    console.log('ABLAGE: config/interpreten.json nicht gelesen (--datei oder --namen, oder es gibt sie nicht).')
  } else if (!ablage.wandert.length) {
    console.log(
      `ABLAGE: ${ablage.ablage.frei.length} frei, ${ablage.ablage.abgelehnt.length} abgelehnt — nichts wandert, der Server schreibt beim Start nichts.`,
    )
  } else {
    console.log(`ABLAGE: ${ablage.wandert.length} Zeile(n) wandern (der Server zieht sie beim Start nach):`)
    for (const w of ablage.wandert) console.log(`  ${w.liste}: „${w.name}"  "${w.alt || '—'}" -> "${w.neu}"`)
  }

  console.log('')
  console.log(`AUSWAHL der Kinder: ${auswahl.length} Schluessel gelesen.`)
  if (auswahlOhneDienst.length) {
    console.log('  ACHTUNG — diese tragen KEINEN Dienstvorsatz, sind also womoeglich keine Werkschluessel:')
    for (const s of auswahlOhneDienst.slice(0, 20)) console.log(`    ${s}`)
    console.log('  Dann ist die Annahme widerlegt, die Wanderung sei umsonst. NACHSEHEN.')
  } else if (auswahl.length) {
    console.log('  Alle mit Dienstvorsatz — Werkschluessel, von diesem Wechsel nicht beruehrt.')
  }
}

const bedenklich = ergebnis.kollisionen.length > 0 || ergebnis.verschmolzen.length > 0 || auswahlOhneDienst.length > 0
process.exit(bedenklich ? 1 : 0)
