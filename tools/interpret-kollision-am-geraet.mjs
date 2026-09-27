#!/usr/bin/env -S npx tsx
/**
 * WOZU
 *   Der E45-Bestandsreview hat am 19.08.2026 gefunden, dass „Die drei ???" und
 *   „Die drei !!!" — zwei echte Kosmos-Kinderserien — unter `normal()` DENSELBEN
 *   Interpretenschluessel bekommen. Die Folgen wurden am Code nachgezogen; hier
 *   werden sie AM LAUFENDEN GERAET gemessen, weil ein Fund am Code eine
 *   Behauptung ueber die Box ist und keine Messung an ihr.
 *
 *   DREI FRAGEN, in dieser Reihenfolge:
 *
 *     1. ZWEI KACHELN?    /api/interpreten muss zwei Eintraege mit ZWEI
 *                         Schluesseln liefern, je einem Werk.
 *     2. ZWEI FREISCHALTUNGEN?  Erst die eine Serie freischalten, dann die
 *                         andere — und danach muessen BEIDE dastehen, jede mit
 *                         IHRER Kennung. Das ist der teuerste Teil des Fundes:
 *                         vorher loeschte die zweite Freischaltung die erste
 *                         STILL, und die ueberlebende Kachel fuehrte auf die
 *                         falsche Spotify-Seite.
 *     3. ZWEI SEITEN?     /api/interpret/-?name=… (der Weg ohne Spotify, E45)
 *                         muss unter „In deiner Box" NUR die Werke der
 *                         angetippten Serie zeigen.
 *
 *   GEGEN DIE ALTE FASSUNG GEFAHREN meldet dasselbe Werkzeug den Schaden: eine
 *   Kachel, eine ueberlebende Freischaltung, beide Werke auf einer Seite. Es
 *   ist damit die Gegenprobe zu sich selbst — ein Lauf VOR und einer NACH dem
 *   Ausliefern.
 *
 * WAS ES AENDERT — und wie es das zuruecknimmt
 *   Es legt ZWEI Medieneintraege an (POST /api/medien) und schaltet ZWEI
 *   Interpreten frei. Beides wird im `finally` wieder abgeraeumt:
 *     * die zwei Eintraege ueber DELETE /api/medien/<schluessel>
 *     * config/interpreten.json wird VOR dem Lauf woertlich gesichert und
 *       danach Byte fuer Byte zurueckgeschrieben (ueber ssh).
 *   Bricht der Lauf mitten drin ab, steht der Rueckweg trotzdem im Protokoll —
 *   und `--nur-aufraeumen` faehrt ihn allein.
 *
 *   Nichts wird abgespielt, keine fremde Datei angefasst, kein systemctl.
 *
 * AUFRUF
 *   npx tsx tools/interpret-kollision-am-geraet.mjs
 *   npx tsx tools/interpret-kollision-am-geraet.mjs --box 192.168.178.57
 *   npx tsx tools/interpret-kollision-am-geraet.mjs --nur-aufraeumen
 *
 * RUECKGABE
 *   0  alle drei Fragen mit JA beantwortet
 *   1  mindestens eine mit NEIN — die Kollision ist da (oder wieder da)
 *   2  die Box antwortet nicht
 */

import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const ausfuehren = promisify(execFile)

const BOX = '192.168.178.57'
const PORT = 8200
const BENUTZER = 'dietpi'
const ABLAGE = '/home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config/interpreten.json'

function argument(name, vorgabe) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : vorgabe
}

if (process.argv.includes('-h') || process.argv.includes('--help')) {
  const zeilen = (await readFile(fileURLToPath(import.meta.url), 'utf8')).split('\n')
  console.log(zeilen.slice(1, zeilen.indexOf(' */') + 1).join('\n'))
  process.exit(0)
}

const box = argument('box', BOX)
const API = `http://${box}:${PORT}/api`

/*
 * ZWEI ECHTE SERIEN, VIER ERFUNDENE KENNUNGEN.
 *
 * ALLE VIER SIND 22 ZEICHEN LANG, und das ist keine Kosmetik: `interpretTaugt`
 * (werke.ts) vergibt einem Spotify-Eintrag mit kuerzerer Kennung GAR KEINEN
 * `interpretSchluessel` — die Kachel entstuende nicht, und die Messung
 * meldete „keine Kollision", weil es gar keinen Interpreten gab. Ein Werkzeug,
 * das aus dem falschen Grund gruen wird, ist schlimmer als keines.
 * `/api/interpreten/frei` verlangt dieselbe Laenge.
 *
 * Ob Spotify diese Kennungen kennt, ist fuer die drei Fragen ohne Belang:
 * gemessen wird die ZUORDNUNG in der Box, nicht die Auskunft eines Dienstes.
 */
const SERIEN = [
  {
    name: 'Die drei ???',
    werkId: 'ZZtestdreiFragezeic012',
    interpretId: 'ZZfragezeichenInterp01',
    titel: 'PROBE Folge Fragezeichen',
  },
  {
    name: 'Die drei !!!',
    werkId: 'ZZtestdreiAusrufeze012',
    interpretId: 'ZZausrufezeichInterp01',
    titel: 'PROBE Folge Ausrufezeichen',
  },
]
for (const s of SERIEN) {
  if (!/^[A-Za-z0-9]{22}$/.test(s.werkId) || !/^[A-Za-z0-9]{22}$/.test(s.interpretId)) {
    console.error(`Kennung ist nicht 22 Zeichen: ${s.name}`)
    process.exit(2)
  }
}

async function json(weg, opt = {}) {
  const antwort = await fetch(`${API}${weg}`, {
    ...opt,
    headers: opt.body ? { 'content-type': 'application/json' } : undefined,
    signal: AbortSignal.timeout(20000),
  })
  const text = await antwort.text()
  let d = null
  try {
    d = JSON.parse(text)
  } catch {
    // Kein JSON: der Text wandert unveraendert in die Meldung.
  }
  return { status: antwort.status, d, text }
}

async function amGeraet(befehl) {
  const { stdout } = await ausfuehren('ssh', [
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=8',
    `${BENUTZER}@${box}`,
    befehl,
  ])
  return stdout
}

/**
 * WELCHES PROFIL GERADE GILT — und ob es die Probe ueberhaupt sehen darf.
 *
 * DIESE STELLE HAT DEN ERSTEN LAUF VERFAELSCHT (19.08.2026): `/api/interpreten`
 * filtert nach der MEDIENAUSWAHL des aktiven Profils (E18), und ein frisch
 * angelegter Eintrag steht dort natuerlich nicht. Der Lauf meldete deshalb
 * „keine Kachel" — und das sah aus wie ein Befund ueber den Schluessel, war
 * aber einer ueber das Profil. Dieselbe Falle beschreibt llmwiki
 * [dienst-steckt-im-schluessel]: „ein Profil ohne Auswahl sieht alles, eines
 * mit Auswahl nur ihre Schluessel".
 *
 * Deshalb wandern die Probeschluessel in die Auswahl — ueber den vorhandenen
 * Endpunkt, nicht an der Datei vorbei — und danach wieder heraus.
 */
async function auswahlSetzen(an) {
  const profile = await json('/profile')
  const aktiv = profile.d?.aktiv
  if (!aktiv || aktiv === 'gast') return { profil: aktiv ?? '(keins)', beruehrt: false }
  let beruehrt = false
  for (const s of SERIEN) {
    const { status, d } = await json('/profil/auswahl/werk', {
      method: 'POST',
      body: JSON.stringify({ profil: aktiv, schluessel: `spotify:${s.werkId}`, an }),
    })
    // `unveraendert` heisst: das Profil hat gar keine Auswahl und sieht alles.
    // Dann ist nichts zu tun und auch nichts zurueckzunehmen.
    if (status === 200 && !d?.unveraendert) beruehrt = true
  }
  return { profil: aktiv, beruehrt }
}

/** Die Probeeintraege wegnehmen und die Ablage zurueckschreiben. */
async function aufraeumen(ablageVorher) {
  const aus = await auswahlSetzen(false)
  console.log(`  aufgeraeumt: Auswahl von „${aus.profil}" ${aus.beruehrt ? 'zurueckgenommen' : '(war nicht beruehrt)'}`)
  for (const s of SERIEN) {
    const { status } = await json(`/medien/${encodeURIComponent(`spotify:${s.werkId}`)}`, { method: 'DELETE' })
    console.log(`  aufgeraeumt: spotify:${s.werkId} -> ${status}`)
  }
  if (ablageVorher === null) return
  if (!ablageVorher) {
    // ES GAB SIE VORHER NICHT. Eine leere Datei zu hinterlassen waere KEIN
    // Rueckweg: „hier hat noch nie jemand entschieden" und „ausdruecklich
    // nichts" sind zwei Zustaende (server.ts, /api/interpreten/zuruecksetzen).
    await amGeraet(`rm -f ${ABLAGE}`)
    console.log(`  aufgeraeumt: ${ABLAGE} entfernt — sie gab es vor dem Lauf nicht`)
    return
  }
  // Woertlich zurueck, nicht „leer": eine Box, auf der jemand Interpreten
  // freigeschaltet hat, darf durch eine Messung nichts davon verlieren. Der
  // Abschluss braucht einen Zeilenanfang, sonst frisst die Shell ihn mit.
  const rumpf = ablageVorher.endsWith('\n') ? ablageVorher : `${ablageVorher}\n`
  await amGeraet(`cat > ${ABLAGE} <<'MUPIENDE'\n${rumpf}MUPIENDE`)
  const jetzt = await amGeraet(`cat ${ABLAGE}`)
  // GEGENGELESEN. Ein Rueckweg, der nur abgeschickt wurde, ist keiner.
  console.log(
    `  aufgeraeumt: ${ABLAGE} zurueckgeschrieben — ${jetzt.trim() === ablageVorher.trim() ? 'woertlich gleich' : 'ABWEICHUNG, NACHSEHEN'}`,
  )
}

// ── Nur aufraeumen ───────────────────────────────────────────────────────────
if (process.argv.includes('--nur-aufraeumen')) {
  await aufraeumen(null)
  console.log('Fertig. (Die Ablage wurde NICHT angefasst — dafuer braucht es die Sicherung aus dem Lauf.)')
  process.exit(0)
}

// ── Sichern ──────────────────────────────────────────────────────────────────
let ablageVorher = null
try {
  ablageVorher = await amGeraet(`cat ${ABLAGE} 2>/dev/null || true`)
} catch (fehler) {
  console.error(`Die Box antwortet nicht auf ssh: ${fehler.message}`)
  process.exit(2)
}
console.log(`Box: ${box}`)
console.log(`Ablage gesichert: ${ablageVorher.length} Bytes`)
console.log('')

const befunde = []
try {
  // ── Anlegen ────────────────────────────────────────────────────────────────
  for (const s of SERIEN) {
    const { status, d } = await json('/medien', {
      method: 'POST',
      body: JSON.stringify({
        type: 'spotify',
        category: 'audiobook',
        title: s.titel,
        artist: s.name,
        id: s.werkId,
      }),
    })
    console.log(`angelegt: „${s.name}" -> ${status} ${d?.schluessel ?? d?.error ?? ''}`)
    if (status !== 200 && d?.error !== 'schonVorhanden') throw new Error(`Anlegen fehlgeschlagen: ${status}`)
  }
  const ein = await auswahlSetzen(true)
  console.log(`sichtbar gemacht: Auswahl von „${ein.profil}" ${ein.beruehrt ? 'ergaenzt' : '(sieht ohnehin alles)'}`)
  console.log('')

  // ── Frage 1: zwei Kacheln? ────────────────────────────────────────────────
  const reihe1 = await json('/interpreten')
  const unsere = (reihe1.d?.reihe ?? []).filter((p) => SERIEN.some((s) => s.name === p.name))
  console.log('FRAGE 1 — zwei Rundkacheln mit zwei Schluesseln?')
  for (const p of unsere) console.log(`  „${p.name}"  schluessel="${p.schluessel}"  anzahl=${p.anzahl}`)
  const schluesselJe = new Set(unsere.map((p) => p.schluessel))
  const frage1 = unsere.length === 2 && schluesselJe.size === 2 && unsere.every((p) => p.anzahl === 1)
  befunde.push(['zwei Kacheln, zwei Schluessel, je ein Werk', frage1])
  console.log(`  -> ${frage1 ? 'JA' : 'NEIN'}`)
  console.log('')

  // ── Frage 2: zwei Freischaltungen? ────────────────────────────────────────
  console.log('FRAGE 2 — ueberlebt die erste Freischaltung die zweite?')
  for (const s of SERIEN) {
    const { status } = await json('/interpreten/frei', {
      method: 'POST',
      body: JSON.stringify({ id: s.interpretId, name: s.name, quelle: 'hand' }),
    })
    console.log(`  freigeschaltet „${s.name}" (${s.interpretId}) -> ${status}`)
  }
  const inDatei = JSON.parse(await amGeraet(`cat ${ABLAGE}`))
  for (const f of inDatei.frei) console.log(`  in der Datei: schluessel="${f.schluessel}" id=${f.id} name="${f.name}"`)
  const reihe2 = await json('/interpreten')
  const nachher = (reihe2.d?.reihe ?? []).filter((p) => SERIEN.some((s) => s.name === p.name))
  for (const p of nachher) console.log(`  Kachel „${p.name}" fuehrt auf id=${p.id}`)
  const frage2 =
    inDatei.frei.length === 2 && SERIEN.every((s) => nachher.find((p) => p.name === s.name)?.id === s.interpretId)
  befunde.push(['beide Freischaltungen stehen, jede mit IHRER Kennung', frage2])
  console.log(`  -> ${frage2 ? 'JA' : 'NEIN'}`)
  console.log('')

  // ── Frage 3: zwei Seiten? ─────────────────────────────────────────────────
  // UEBER `-` UND NICHT UEBER DIE KENNUNG: der Weg, den E45 gebaut hat, baut
  // die Seite allein aus dem Bestand der Box — ohne Spotify, also auch ohne
  // die Frage, ob dieser Rechner gerade Netz hat.
  console.log('FRAGE 3 — steht auf jeder Seite nur das eigene Werk?')
  let frage3 = true
  for (const s of SERIEN) {
    const seite = await json(`/interpret/-?name=${encodeURIComponent(s.name)}`)
    const boxReihe = (seite.d?.reihen ?? []).find((r) => r.id === 'box')
    const titel = (boxReihe?.eintraege ?? []).map((e) => e.titel)
    console.log(`  „${s.name}" -> In deiner Box: ${titel.length ? titel.map((t) => `„${t}"`).join(', ') : '(leer)'}`)
    if (titel.length !== 1 || titel[0] !== s.titel) frage3 = false
  }
  befunde.push(['jede Seite zeigt NUR ihr eigenes Werk', frage3])
  console.log(`  -> ${frage3 ? 'JA' : 'NEIN'}`)
} finally {
  console.log('')
  console.log('Aufraeumen:')
  try {
    await aufraeumen(ablageVorher)
  } catch (fehler) {
    console.error(`  AUFRAEUMEN FEHLGESCHLAGEN: ${fehler.message}`)
    console.error(`  Von Hand: npx tsx tools/interpret-kollision-am-geraet.mjs --nur-aufraeumen --box ${box}`)
    console.error(`  und ${ABLAGE} auf ${ablageVorher?.length ?? 0} Bytes zuruecksetzen.`)
  }
}

console.log('')
console.log('BEFUND')
for (const [was, ok] of befunde) console.log(`  ${ok ? 'JA  ' : 'NEIN'}  ${was}`)
const alle = befunde.length === 3 && befunde.every(([, ok]) => ok)
console.log('')
console.log(alle ? 'Die Kollision ist weg.' : 'DIE KOLLISION IST DA — siehe die NEIN-Zeilen.')
process.exit(alle ? 0 : 1)
