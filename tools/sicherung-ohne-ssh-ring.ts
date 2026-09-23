/**
 * DER GANZE RING, GEGEN EINEN EIGENEN SERVER IM SANDKASTEN.
 *
 * DIE FRAGE, DIE HIER BEANTWORTET WIRD, ist nicht „antwortet die Route mit
 * 200" und auch nicht „parst das noch". Sie ist:
 *
 *     Ein Elternteil sichert am Bildschirm. Danach geht etwas kaputt. Es
 *     spielt zurueck — ohne SSH, ohne zweites Geraet, ohne Anleitung.
 *     IST DANACH JEDE EINZELNE DATEI WIEDER DIE ALTE?
 *
 * Und das wird DATEI FUER DATEI nachgezaehlt: vor dem Sichern wird von jeder
 * die sha256 genommen, nach dem Zurueckspielen wird jede einzeln dagegen
 * gehalten. „Es parst noch" ist keine Antwort — eine leere data.json parst
 * auch ([[sicherung-leere-datei-besteht-jede-pruefung]]).
 *
 * IN DREI STUFEN, und die dritte hat dieser Lauf selbst hervorgebracht:
 * `mupiboxconfig.json` kommt NICHT byteweise gleich zurueck, obwohl jeder
 * Wert stimmt — ein Schluessel, der fuer das Archiv herausgeschnitten und
 * beim Zurueckspielen wieder eingesetzt wird, steht danach hinten im Objekt.
 * Fuer diese Dateien (und NUR fuer sie) lautet die Frage deshalb „steht jeder
 * Schluessel mit jedem Wert wieder da?"; fuer alle anderen bleibt es bei
 * „Byte fuer Byte". Die Herleitung steht ausfuehrlich an `vergleich`, und
 * eine eigene Zeile prueft, dass die dritte Stufe GENAU die Dateien mit
 * ausgelassenen Schluesseln trifft und keine weitere.
 *
 * NIEMALS GEGEN DIE ECHTE BOX. Dieser Lauf baut sich einen vollstaendigen
 * Sandkasten in einem Wegwerfverzeichnis: eigenes /etc/mupibox, eigenes
 * server/config, eigenes Verzeichnis fuer die Staende, eine PATCHKOPIE von
 * mupibox-sicherung.py, deren drei Pfadkonstanten in den Sandkasten zeigen,
 * und einen EIGENEN Server auf einem EIGENEN Port (9851 aufwaerts). Die echte
 * Box wird nicht angefasst und auch nicht gefragt.
 *
 * DIE PATCHKOPIE IST DER EINE HAKEN, und er steht hier statt in einer
 * Fussnote: mupibox-sicherung.py traegt BOX, STAENDE, KARTE und den
 * /etc-Zweig von BAEUME als Konstanten. Sie umzubiegen ist der einzige Weg,
 * das ECHTE Werkzeug gegen ein Testverzeichnis zu fahren, ohne es zu aendern
 * (es ist fremdes Gebiet). `--patch-zeigen` legt die geaenderten Zeilen
 * offen; wer die Konstanten dort umbenennt, sieht es hier sofort als roten
 * Schritt „die Patchkopie greift" statt als stillen Fehlschlag.
 *
 * WAS GEFAHREN WIRD — neun Ringe, jeder mit einer eigenen Frage:
 *
 *   1  ohne Zugangsdaten   sichern, drei Sorten Schaden anrichten (Inhalt
 *                          ersetzt, Datei geloescht, Einstellung verstellt),
 *                          zurueckspielen, jede Datei nachzaehlen.
 *   2  die Zahlen VORHER   sagt die Vorschau die Wahrheit? Was sie als
 *                          „aendert sich" nennt, muss sich danach geaendert
 *                          haben; was sie als „steht schon so da" nennt, darf
 *                          sich NICHT geaendert haben.
 *   3  mit Zugangsdaten    die Geheimnisse stehen NIRGENDS im Klartext im
 *                          Archiv (im entpackten Strom gesucht!), kommen aber
 *                          mit dem Passwort vollstaendig zurueck.
 *   4  falsches Passwort   scheitert LAUT — und hinterlaesst KEINE einzige
 *                          geaenderte Datei.
 *   5  beschaedigte Datei  ein umgedrehtes Byte in der Mitte wird abgelehnt,
 *                          nichts geschrieben.
 *   6  fremde Datei        ein Urlaubsfoto ergibt einen Satz, keinen
 *                          Stapelabzug — und legt nichts ab.
 *   7  andere Box          wird gewarnt, aber nicht verboten (wer die Karte
 *                          tauscht, setzt neu auf und heisst dann anders).
 *   8  das Passwort        taucht in KEINER Antwort, in KEINEM Archiv und in
 *                          KEINER Zeile auf, die der Server ausgibt.
 *
 * Dazu ein neunter, der nicht ueber HTTP geht: die OBERFLAECHE wird im
 * Quelltext danach abgesucht, ob sie das Passwort irgendwo ablegen koennte
 * (Speicher, Adresse, DOM-Attribut, Konsole). Das gehoert hierher, weil es
 * dieselbe Zusage ist — sie faellt sonst zwischen Backend und Browser
 * hindurch.
 *
 * FAHREN
 *   npx tsx tools/sicherung-ohne-ssh-ring.ts
 *   npx tsx tools/sicherung-ohne-ssh-ring.ts --port 9860
 *   npx tsx tools/sicherung-ohne-ssh-ring.ts --behalten   # Sandkasten stehen lassen
 *   npx tsx tools/sicherung-ohne-ssh-ring.ts --patch-zeigen
 *
 * ENDE 0, wenn jeder Ring haelt. ENDE 1 mit dem Wortlaut, was nicht hielt.
 */
import { createHash, randomBytes } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import express from 'express'
import { sicherungWegeBauen, tarEintragLesen } from '../src/backend-api/src/sicherung'

const HIER = dirname(fileURLToPath(import.meta.url))
const WURZEL = dirname(HIER)
const ECHTES_SKRIPT = join(WURZEL, 'scripts/mupibox/mupibox-sicherung.py')
const OBERFLAECHE = join(WURZEL, 'src/frontend-admin/src/app/seiten/sicherung.ts')

/* ── Buchfuehrung ──────────────────────────────────────────────────────── */

let gut = 0
const schlecht: string[] = []
let ring = ''

function chk(satz: string, bedingung: boolean, mehr = ''): void {
  if (bedingung) {
    gut++
    console.log(`  ok    ${satz}`)
  } else {
    schlecht.push(`${ring}: ${satz}${mehr ? ` — ${mehr}` : ''}`)
    console.log(`  ROT   ${satz}${mehr ? `\n        ${mehr}` : ''}`)
  }
}

function kopf(name: string): void {
  ring = name
  console.log(`\n── ${name} ${'─'.repeat(Math.max(0, 66 - name.length))}`)
}

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex')

/* ── Der Sandkasten ────────────────────────────────────────────────────── */

/**
 * Die Konstanten von mupibox-sicherung.py in den Sandkasten biegen.
 *
 * ES WIRD GEZAEHLT, WIE VIELE ZEILEN GETROFFEN WURDEN. Ein Muster, das ins
 * Leere greift, waere der schlimmste Fall: der Lauf liefe dann gegen die
 * ECHTEN Pfade — also gegen /etc/mupibox dieses Rechners. Deshalb ist jede
 * Ersetzung eine Zusicherung und keine Bequemlichkeit.
 */
function patchen(quelle: string, k: { box: string; staende: string; karte: string; etc: string; sperre: string }) {
  let text = readFileSync(quelle, 'utf8')
  const treffer: string[] = []
  const ersatz: [RegExp, string][] = [
    [/^BOX = "[^"]*"$/m, `BOX = ${JSON.stringify(k.box)}`],
    [/^STAENDE = "[^"]*"$/m, `STAENDE = ${JSON.stringify(k.staende)}`],
    [/^KARTE = "[^"]*"/m, `KARTE = ${JSON.stringify(k.karte)}`],
    [/^SPERRE = "[^"]*"/m, `SPERRE = ${JSON.stringify(k.sperre)}`],
    [/^ {4}"etc\/mupibox": "\/etc\/mupibox",$/m, `    "etc/mupibox": ${JSON.stringify(k.etc)},`],
  ]
  for (const [muster, neu] of ersatz) {
    const vorher = text
    text = text.replace(muster, neu)
    if (text !== vorher) treffer.push(neu.split('\n')[0] as string)
  }
  return { text, treffer, erwartet: ersatz.length }
}

interface Kasten {
  wurzel: string
  etc: string
  config: string
  staende: string
  skript: string
}

/** Die Ausgangslage: eine Box, wie sie nach der Einrichtung aussieht. */
const GEHEIMNISSE = {
  refresh: `AQC${randomBytes(24).toString('base64url')}`,
  clientSecret: randomBytes(16).toString('hex'),
  wlanPw: `Hausschluessel-${randomBytes(4).toString('hex')}`,
  telegram: `${randomBytes(4).toString('hex')}:AA${randomBytes(16).toString('base64url')}`,
}

function konfigVorgabe(): Record<string, unknown> {
  return {
    mupibox: {
      audioDevice: 'MuPiHAT',
      startVolume: 25,
      maxVolume: 75,
      mediaCheckTimer: 300,
      einstellungssperre: 'aus',
    },
    interfacelogin: { state: false, password: '' },
    spotify: {
      clientId: 'eine-kennung-die-kein-schluessel-ist',
      clientSecret: GEHEIMNISSE.clientSecret,
      refreshToken: GEHEIMNISSE.refresh,
      accessToken: '',
    },
    telegram: { token: GEHEIMNISSE.telegram },
    mqtt: { password: '' },
    jellyfin: { apikey: '' },
  }
}

function sandkastenBauen(): Kasten {
  const wurzel = mkdtempSync(join(tmpdir(), 'mupi-ring-'))
  const box = join(wurzel, 'box')
  const etc = join(wurzel, 'etc-mupibox')
  const config = join(box, 'server/config')
  const staende = join(wurzel, 'sicherungen')
  for (const d of [etc, config, staende, join(config, 'profile/gast'), join(config, 'profile/liam')]) {
    mkdirSync(d, { recursive: true })
  }

  const schreib = (p: string, o: unknown) => writeFileSync(p, `${JSON.stringify(o, null, 4)}\n`)

  schreib(join(etc, 'mupiboxconfig.json'), konfigVorgabe())
  writeFileSync(join(etc, 'bt-adapter'), 'AA:BB:CC:DD:EE:FF\n')

  // Die Bibliothek — das IST die Box. Absichtlich gross genug, dass ein
  // Byte-Vergleich etwas bedeutet.
  schreib(
    join(config, 'data.json'),
    Array.from({ length: 120 }, (_, i) => ({
      id: `spotify:album:${i.toString(36).padStart(6, '0')}`,
      title: `Hoerspiel Nummer ${i}`,
      artist: `Erzaehler ${i % 7}`,
      type: 'spotify',
      category: i % 3 === 0 ? 'audiobook' : 'music',
    })),
  )
  // resume.json am alten Ort ist auf einer heutigen Box KEINE Datei mehr,
  // sondern die BRUECKE (E18 Stufe 3) — siehe weiter unten, wo sie gelegt
  // wird. Hier stand eine leere Datei; damit hat dieser Lauf einen Zustand
  // gemessen, den es an der Box seit dem 05.08.2026 nicht mehr gibt.
  schreib(join(config, 'darstellung.json'), { thema: 'nacht', kacheln: 'gross' })
  schreib(join(config, 'kinderzeit.json'), { aktiv: true, nachsichtMin: 5 })
  schreib(join(config, 'verschmelzung.json'), { paare: [] })
  schreib(join(config, 'monitor.json'), { helligkeit: 60 })
  schreib(join(config, 'network.json'), { hostname: 'mupibox' })
  schreib(join(config, 'verfuegbarkeit.json'), {})
  schreib(join(config, 'vorlesen.json'), { stimme: 'de_DE-thorsten' })
  schreib(join(config, 'wlan.json'), [{ ssid: 'Zuhause', pw: GEHEIMNISSE.wlanPw }])
  schreib(join(config, 'config.json'), {
    spotify: { clientSecret: GEHEIMNISSE.clientSecret, refreshToken: GEHEIMNISSE.refresh },
  })
  schreib(join(config, 'akkuverlauf.json'), { punkte: [] })
  for (const kind of ['gast', 'liam']) {
    const b = join(config, 'profile', kind)
    schreib(join(b, 'gespielt.json'), [{ key: `spotify:album:${kind}`, anzahl: 4 }])
    schreib(join(b, 'kinderzeit-verbrauch.json'), { '2026-08-07': 23 })
    schreib(join(b, 'listen.json'), [{ id: 'meine', name: `Liste von ${kind}`, titel: [] }])
    schreib(join(b, 'resume.json'), { 'spotify:album:1': { pos: 42 } })
    schreib(join(b, 'auswahl.json'), { erlaubt: [`spotify:album:${kind}`] })
  }
  // DAS VERZEICHNIS DER KINDER. Es fehlte hier bis zum 07.08.2026 — und
  // deshalb konnte dieser Lauf 61-mal gruen melden, waehrend die Sicherung
  // genau diese Datei ausliess. Ein Sandkasten, der eine Ablage nicht kennt,
  // kann ihren Verlust nicht sehen; die Ringe zaehlten Datei fuer Datei und
  // zaehlten dabei eine Datei, die es hier nie gab.
  schreib(join(config, 'profile.json'), {
    profile: [
      { kennung: 'gast', name: 'Gast', figur: '', angelegt: 0 },
      { kennung: 'liam', name: 'Liam', figur: 'baer', angelegt: 1786085015068 },
    ],
    aktiv: 'liam',
  })
  // UND DIE BRUECKE — ein VERWEIS am alten Ort von resume.json (E18 Stufe 3).
  // Aus demselben Grund: in keinem Sandkasten kam je ein Verweis vor, also
  // hat nie jemand gemessen, was beim Zurueckspielen mit ihm geschieht (bis
  // zum 07.08.2026: er wurde durch eine gewoehnliche Datei ERSETZT).
  symlinkSync('profile/liam/resume.json', join(config, 'resume.json'))

  const gepatcht = patchen(ECHTES_SKRIPT, {
    box,
    staende,
    karte: join(wurzel, 'karte'),
    etc,
    sperre: join(wurzel, 'sperre'),
  })
  const skript = join(wurzel, 'mupibox-sicherung.py')
  writeFileSync(skript, gepatcht.text)
  chmodSync(skript, 0o755)

  kopf('Der Sandkasten steht')
  chk(
    `die Patchkopie greift (${gepatcht.treffer.length}/${gepatcht.erwartet} Konstanten umgebogen)`,
    gepatcht.treffer.length === gepatcht.erwartet,
    gepatcht.treffer.length === gepatcht.erwartet
      ? ''
      : 'Achtung: ohne vollstaendigen Patch liefe dieser Lauf gegen die ECHTEN Pfade. Abbruch.',
  )
  if (gepatcht.treffer.length !== gepatcht.erwartet) {
    console.log('\nNICHT WEITER — der Lauf wuerde die echten Verzeichnisse anfassen.')
    process.exit(1)
  }
  if (process.argv.includes('--patch-zeigen')) {
    for (const t of gepatcht.treffer) console.log(`        ${t}`)
  }
  chk('es gibt gpg auf diesem Rechner (sonst ist Ring 3/4 blind)', existsSync('/usr/bin/gpg'))

  return { wurzel, etc, config, staende, skript }
}

/* ── Der Bestand: jede Datei mit ihrer Pruefsumme ──────────────────────── */

/**
 * Alle Ablagen unter beiden Wurzeln — rekursiv, mit sha256, Groesse, Inhalt
 * UND ART.
 *
 * DIE ART STEHT SEIT DEM 07.08.2026 DABEI, und zwar aus einem gemessenen
 * Grund: hier stand `statSync`, und `statSync` FOLGT einem Verweis. Ein
 * Verweis, der beim Zurueckspielen durch eine gewoehnliche Datei ersetzt
 * wurde, saehe damit vorher wie nachher gleich aus — dieselbe Groesse,
 * dieselbe Pruefsumme, kein Befund. Genau so ist es passiert (`resume.json`,
 * die Bruecke auf `profile/<aktiv>/resume.json`). Gezaehlt wird deshalb mit
 * `lstat`, und der Verweis traegt sein ZIEL als Inhalt.
 */
function bestand(k: Kasten): Map<string, { sha: string; bytes: number; roh: Buffer; art: string }> {
  const raus = new Map<string, { sha: string; bytes: number; roh: Buffer; art: string }>()
  const gehen = (verz: string, marke: string) => {
    if (!existsSync(verz)) return
    for (const n of readdirSync(verz).sort()) {
      const p = join(verz, n)
      const l = lstatSync(p)
      if (l.isSymbolicLink()) {
        const ziel = readlinkSync(p)
        raus.set(`${marke}/${n}`, {
          sha: sha(`verweis:${ziel}`),
          bytes: ziel.length,
          roh: Buffer.from(ziel),
          art: 'verweis',
        })
        continue
      }
      if (l.isDirectory()) {
        gehen(p, `${marke}/${n}`)
        continue
      }
      const roh = readFileSync(p)
      raus.set(`${marke}/${n}`, { sha: sha(roh), bytes: roh.length, roh, art: 'datei' })
    }
  }
  gehen(k.etc, 'etc/mupibox')
  gehen(k.config, 'server/config')
  return raus
}

/**
 * Zwei Bestaende vergleichen — und zwar in DREI Stufen, nicht in zwei.
 *
 * DIE DRITTE STUFE HAT DIESER LAUF SELBST GEFUNDEN (07.08.2026, erster
 * gruener Ring bis auf eine Zeile): `etc/mupibox/mupiboxconfig.json` kam
 * NICHT byteweise gleich zurueck, obwohl jeder Wert stimmte. Der Grund ist
 * kein Fehler, sondern eine Folge des Entwurfs, und er gehoert deshalb
 * aufgeschrieben statt weggedrueckt:
 *
 *   `entgeheimen` SCHNEIDET die Geheimnisse aus der Datei heraus, bevor sie
 *   ins Archiv geht. Beim Zurueckspielen setzt `zeiger_uebernehmen` sie aus
 *   dem laufenden Bestand wieder ein — und ein Schluessel, der aus einem
 *   JSON-Objekt entfernt und wieder hineingelegt wird, steht danach HINTEN.
 *   Aus {clientSecret, refreshToken, accessToken} wird
 *   {clientSecret, accessToken, refreshToken}. Jeder Wert ist da, jeder
 *   Schluessel ist da, nur die Reihenfolge im Text ist eine andere.
 *
 * DIE FOLGERUNG IST NICHT „dann eben nicht so genau messen". Sie ist: fuer
 * die Dateien, aus denen etwas herausgeschnitten wurde, ist die richtige
 * Frage „steht jeder Schluessel mit jedem Wert wieder da?" — und fuer ALLE
 * ANDEREN bleibt es bei „Byte fuer Byte". Wer das zu einem allgemeinen
 * „JSON-Vergleich genuegt" verwaesserte, koennte eine data.json nicht mehr
 * von ihrer neu formatierten Kopie unterscheiden.
 *
 * WORAUF ES DABEI ANKOMMT: die dritte Stufe muss GENAU die Dateien treffen,
 * die im Stand unter `ausgelassen` stehen. Jede andere waere ein Befund.
 */
function vergleich(
  vorher: Map<string, { sha: string; bytes: number; roh: Buffer; art: string }>,
  nachher: Map<string, { sha: string; bytes: number; roh: Buffer; art: string }>,
): {
  gleich: string[]
  nurReihenfolge: string[]
  anders: string[]
  fehlt: string[]
  neu: string[]
  artGewechselt: string[]
} {
  const gleich: string[] = []
  const nurReihenfolge: string[] = []
  const anders: string[] = []
  const fehlt: string[] = []
  const neu: string[] = []
  // AUS EINEM VERWEIS EINE DATEI ZU MACHEN IST KEIN INHALTSUNTERSCHIED,
  // sondern ein eigener Befund: die Bytes koennen dabei sogar dieselben sein.
  // Deshalb eine eigene Spalte statt eines Eintrags unter `anders`.
  const artGewechselt: string[] = []
  for (const [n, v] of vorher) {
    const b = nachher.get(n)
    if (!b) {
      fehlt.push(n)
      continue
    }
    if (b.art !== v.art) {
      artGewechselt.push(`${n}: ${v.art} -> ${b.art}`)
      continue
    }
    if (b.sha === v.sha) {
      gleich.push(n)
      continue
    }
    if (wertgleich(v.roh, b.roh)) nurReihenfolge.push(n)
    else anders.push(n)
  }
  for (const n of nachher.keys()) if (!vorher.has(n)) neu.push(n)
  return { gleich, nurReihenfolge, anders, fehlt, neu, artGewechselt }
}

/** Dasselbe JSON, nur anders sortiert? Nur DAS — nicht „aehnlich". */
function wertgleich(a: Buffer, b: Buffer): boolean {
  try {
    return sortiert(JSON.parse(a.toString('utf8'))) === sortiert(JSON.parse(b.toString('utf8')))
  } catch {
    return false
  }
}

function sortiert(w: unknown): string {
  if (Array.isArray(w)) return `[${w.map(sortiert).join(',')}]`
  if (w && typeof w === 'object') {
    const o = w as Record<string, unknown>
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${sortiert(o[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(w)
}

/** Aus welchen Dateien hat der Stand Schluessel HERAUSGESCHNITTEN? */
function ausgelassenIm(archiv: Buffer): string[] {
  const roh = tarEintragLesen(archiv, 'stand.json')
  if (!roh) return []
  const s = JSON.parse(roh.toString('utf8')) as { ausgelassen?: { datei?: string }[] }
  return [...new Set((s.ausgelassen ?? []).map((a) => String(a.datei ?? '')).filter(Boolean))]
}

/* ── Der eigene Server ─────────────────────────────────────────────────── */

/** Alles, was der Server ausgibt — fuer Ring 8 („steht das Passwort da?"). */
const gesagt: string[] = []

function serverStarten(k: Kasten, port: number) {
  const app = express()
  app.use(
    sicherungWegeBauen({
      skript: k.skript,
      staende: k.staende,
      // KEIN sudo im Sandkasten: alles gehoert dem laufenden Benutzer, und
      // ein `sudo -n` wuerde hier nur eine Passwortfrage erzwingen, die
      // niemand beantworten kann.
      vorspann: [],
      host: () => 'ring-box',
      anmeldungOffen: () => true,
    }),
  )
  return new Promise<{ schliessen: () => void; basis: string }>((fertig, scheitern) => {
    const s = app.listen(port, '127.0.0.1')
    s.on('listening', () => fertig({ schliessen: () => s.close(), basis: `http://127.0.0.1:${port}` }))
    s.on('error', scheitern)
  })
}

async function holen(
  basis: string,
  weg: string,
  o: { art?: string; json?: unknown; roh?: Buffer } = {},
): Promise<{ status: number; text: string; json: unknown; bytes: Buffer }> {
  const kopfzeilen: Record<string, string> = {}
  let koerper: BodyInit | undefined
  if (o.json !== undefined) {
    kopfzeilen['Content-Type'] = 'application/json'
    koerper = JSON.stringify(o.json)
  } else if (o.roh) {
    kopfzeilen['Content-Type'] = 'application/gzip'
    koerper = new Uint8Array(o.roh)
  }
  const a = await fetch(`${basis}${weg}`, { method: o.art ?? 'GET', headers: kopfzeilen, body: koerper })
  const bytes = Buffer.from(await a.arrayBuffer())
  const ist = a.headers.get('content-type') ?? ''
  const text = ist.includes('gzip') ? '' : bytes.toString('utf8')
  if (text) gesagt.push(text)
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { status: a.status, text, json, bytes }
}

/* ── Die Schaeden, die ein Elternteil wirklich anrichtet ───────────────── */

function schadenAnrichten(k: Kasten): string[] {
  const was: string[] = []
  // 1. Inhalt ersetzt — die Bibliothek ist auf einen Eintrag geschrumpft.
  //    Das ist der Fall „ich habe beim Aufraeumen zu viel geloescht".
  writeFileSync(join(k.config, 'data.json'), `${JSON.stringify([{ id: 'nur-noch-das' }], null, 4)}\n`)
  was.push('server/config/data.json auf einen Eintrag geschrumpft')
  // 2. Datei WEG — der Fall „das Kind hat die Kinderzeit geloescht".
  rmSync(join(k.config, 'kinderzeit.json'))
  was.push('server/config/kinderzeit.json geloescht')
  // 3. Einstellung verstellt — der haeufigste Fall ueberhaupt.
  const kk = JSON.parse(readFileSync(join(k.etc, 'mupiboxconfig.json'), 'utf8'))
  kk.mupibox.startVolume = 5
  kk.mupibox.audioDevice = 'irgendwas-anderes'
  writeFileSync(join(k.etc, 'mupiboxconfig.json'), `${JSON.stringify(kk, null, 4)}\n`)
  was.push('etc/mupibox/mupiboxconfig.json verstellt (Lautstaerke und Tonausgang)')
  // 4. Ein Bereich eines Kindes weg — der stillste Schaden von allen: das
  //    Kind sieht danach die ganze Box statt seiner sechs Titel.
  rmSync(join(k.config, 'profile/liam/auswahl.json'))
  was.push('server/config/profile/liam/auswahl.json geloescht')
  // 5. DAS VERZEICHNIS DER KINDER WEG — und das ist kein ausgedachter Schaden:
  //    genau so sieht eine Box nach einem Kartentausch aus, und genau so sieht
  //    sie aus, wenn ein Elternteil in der Verwaltung ein Kind loescht, das es
  //    nicht loeschen wollte. Ohne diese Zeile war die Aussage „das Verzeichnis
  //    ist wieder da" wertlos: die Datei stand unveraendert da, also stimmte
  //    ihre Pruefsumme auch dann, wenn die Sicherung sie NIE angefasst hat.
  //    Nachgemessen: mit dieser Zeile faellt der Ring gegen die Fassung von
  //    vorher durch, ohne sie nicht.
  rmSync(join(k.config, 'profile.json'))
  was.push('server/config/profile.json geloescht (die Kinder sind weg)')
  return was
}

/* ── Der Lauf ──────────────────────────────────────────────────────────── */

const PASSWORT = 'ein-langes-passwort-fuer-den-ring-42'

async function main(): Promise<number> {
  const i = process.argv.indexOf('--port')
  const port = i > 0 ? Number(process.argv[i + 1]) : 9851
  const k = sandkastenBauen()
  const { schliessen, basis } = await serverStarten(k, port)
  console.log(`        eigener Server auf ${basis}, Sandkasten ${k.wurzel}`)

  try {
    /* ══ Ring 1 — sichern, kaputtmachen, zurueckspielen ══════════════════ */
    kopf('Ring 1 — ohne Zugangsdaten: kommt jede Datei zurueck?')
    const vorher = bestand(k)
    chk(`der Bestand steht (${vorher.size} Dateien unter beiden Wurzeln)`, vorher.size >= 20)

    const lage = await holen(basis, '/api/sicherung')
    chk('GET /api/sicherung antwortet', lage.status === 200)
    chk(
      'die Antwort sagt, wovor die Ablage NICHT schuetzt',
      Array.isArray((lage.json as { ablageHinweise?: unknown[] })?.ablageHinweise) &&
        (lage.json as { ablageHinweise: string[] }).ablageHinweise.join(' ').includes('Download-Ordner'),
    )

    const gesichert = await holen(basis, '/api/sicherung/anlegen', { art: 'POST', json: {} })
    chk('POST /api/sicherung/anlegen liefert ein Archiv', gesichert.status === 200 && gesichert.bytes.length > 500)
    const archiv = gesichert.bytes
    chk('das Archiv ist gzip (die Bytes, nicht eine Beschreibung)', archiv[0] === 0x1f && archiv[1] === 0x8b)

    const schaeden = schadenAnrichten(k)
    for (const s of schaeden) console.log(`        Schaden: ${s}`)
    const kaputt = bestand(k)
    chk(
      'der Schaden ist wirklich angerichtet',
      vergleich(vorher, kaputt).anders.length + vergleich(vorher, kaputt).fehlt.length === schaeden.length,
    )

    const vorschau = await holen(basis, '/api/sicherung/pruefen', { art: 'POST', roh: archiv })
    chk('POST /api/sicherung/pruefen antwortet mit einem Plan', vorschau.status === 200)
    const v = vorschau.json as {
      kennung: string
      satz: string
      plan: { aendert: { ziel: string }[]; unveraendert: { ziel: string }[]; vonHand: string[] }
    }
    chk('die Vorschau nennt ZAHLEN, nicht «Daten werden ersetzt»', /\d+ Datei/.test(v?.satz ?? ''))
    chk(
      'die Vorschau hat NICHTS geschrieben',
      vergleich(kaputt, bestand(k)).anders.length === 0 && vergleich(kaputt, bestand(k)).fehlt.length === 0,
    )

    /* ══ Ring 2 — sagt die Vorschau die Wahrheit? ════════════════════════ */
    kopf('Ring 2 — stimmen die Zahlen der Vorschau mit dem Ergebnis ueberein?')
    const angekuendigtAendert = new Set(v.plan.aendert.map((a) => a.ziel))
    const angekuendigtGleich = new Set(v.plan.unveraendert.map((a) => a.ziel))
    const vorDemSpielen = bestand(k)

    const zurueck = await holen(basis, '/api/sicherung/zurueckspielen', {
      art: 'POST',
      json: { kennung: v.kennung },
    })
    chk('POST /api/sicherung/zurueckspielen laeuft durch', zurueck.status === 200, zurueck.text.slice(0, 400))
    const z = zurueck.json as { vorherStand: string | null; plan: { aendert: { ziel: string }[] } }
    chk('es wurde vorher ein Stand «vorher» angelegt — der Rueckweg aus dem Rueckweg', Boolean(z?.vorherStand))

    // JETZT DIE EINE FRAGE, DIE ZAEHLT: Datei fuer Datei.
    const nachher = bestand(k)
    const g = vergleich(vorher, nachher)
    chk(
      `keine der ${vorher.size} Dateien fehlt und keine hat einen anderen INHALT (${g.gleich.length} byteweise gleich, ${g.nurReihenfolge.length} wertgleich, ${g.anders.length} anders, ${g.fehlt.length} fehlen)`,
      g.anders.length === 0 && g.fehlt.length === 0,
      g.anders.length || g.fehlt.length
        ? `anders: ${g.anders.join(', ') || '—'} | fehlt: ${g.fehlt.join(', ') || '—'}`
        : '',
    )
    // UND DIE DRITTE STUFE MUSS GENAU DIE DATEIEN TREFFEN, aus denen etwas
    // herausgeschnitten wurde. Jede andere waere ein Befund: dann formatierte
    // irgendetwas eine Datei um, die es gar nicht anfassen sollte.
    const mitAuslassung = new Set(ausgelassenIm(archiv))
    const unerklaert = g.nurReihenfolge.filter((n) => !mitAuslassung.has(n))
    chk(
      `wertgleich-aber-anders-sortiert sind AUSSCHLIESSLICH die Dateien mit ausgelassenen Schluesseln (${g.nurReihenfolge.join(', ') || 'keine'})`,
      unerklaert.length === 0,
      unerklaert.length
        ? `unerklaert: ${unerklaert.join(', ')} — hier formatiert etwas eine Datei um, die es nicht anfassen sollte`
        : '',
    )
    chk(
      'die geloeschte Kinderzeit ist wieder da und hat ihren Inhalt',
      nachher.get('server/config/kinderzeit.json')?.sha === vorher.get('server/config/kinderzeit.json')?.sha,
    )
    chk(
      'die Medienauswahl des Kindes ist wieder da (sonst saehe es still die ganze Box)',
      nachher.get('server/config/profile/liam/auswahl.json')?.sha ===
        vorher.get('server/config/profile/liam/auswahl.json')?.sha,
    )
    // DAS KIND SELBST. Der Bestand oben ist wertlos, solange niemand mehr
    // weiss, dass es Liam gibt: server.ts liest profile.json, findet nichts
    // und nimmt den Gast — allein. `profile/liam/` liegt dann vollstaendig da
    // und ist von der Oberflaeche aus nicht erreichbar. Bis zum 07.08.2026
    // war genau das der Fall, und dieser Lauf hat es nicht gesehen, weil sein
    // Sandkasten die Datei nicht kannte.
    chk(
      'das Verzeichnis der Kinder ist wieder da — sonst gibt es den Bestand oben, aber kein Kind dazu',
      nachher.get('server/config/profile.json')?.sha === vorher.get('server/config/profile.json')?.sha,
      `vorher: ${vorher.get('server/config/profile.json')?.bytes ?? 'fehlt'} B, nachher: ${nachher.get('server/config/profile.json')?.bytes ?? 'FEHLT'}`,
    )
    // UND KEINE ABLAGE HAT IHRE ART GEWECHSELT. Ein Verweis, der als Datei
    // zurueckkommt, hat dieselben Bytes und faellt bei jedem Inhaltsvergleich
    // durch das Raster.
    chk(
      'keine Ablage hat die Art gewechselt (aus einem Verweis wurde keine Datei)',
      g.artGewechselt.length === 0,
      g.artGewechselt.join(', '),
    )
    chk(
      'die Bruecke am alten Ort von resume.json ist noch ein Verweis',
      nachher.get('server/config/resume.json')?.art === 'verweis',
    )
    chk(
      'die Bibliothek ist NICHT leer — «es parst noch» ist keine Antwort',
      (nachher.get('server/config/data.json')?.bytes ?? 0) > 5000,
    )

    // Was die Vorschau angekuendigt hat, ist auch eingetreten.
    const wirklichGeaendert = new Set(
      vergleich(vorDemSpielen, nachher)
        .anders.concat(vergleich(vorDemSpielen, nachher).neu)
        .map((n) => n.replace(/^etc\/mupibox/, k.etc).replace(/^server\/config/, k.config)),
    )
    const versprochenAberNicht = [...angekuendigtAendert].filter((n) => !wirklichGeaendert.has(n))
    chk(
      `alles, was die Vorschau als «wird ueberschrieben» nannte (${angekuendigtAendert.size}), hat sich wirklich geaendert`,
      versprochenAberNicht.length === 0,
      versprochenAberNicht.join(', '),
    )
    const stillGeaendert = [...wirklichGeaendert].filter((n) => angekuendigtAendert.has(n) === false)
    chk(
      'es hat sich NICHTS geaendert, was die Vorschau nicht genannt hatte',
      stillGeaendert.length === 0,
      stillGeaendert.join(', '),
    )
    const gelogenGleich = [...angekuendigtGleich].filter((n) => wirklichGeaendert.has(n))
    chk(
      `was die Vorschau als «steht schon so da» nannte (${angekuendigtGleich.size}), blieb unangetastet`,
      gelogenGleich.length === 0,
      gelogenGleich.join(', '),
    )

    /* ══ Ring 3 — die Zugangsdaten ═══════════════════════════════════════ */
    kopf('Ring 3 — mit Zugangsdaten: verschluesselt hinein, vollstaendig zurueck')
    const mitGeheim = await holen(basis, '/api/sicherung/anlegen', {
      art: 'POST',
      json: { mitZugangsdaten: true, passwort: PASSWORT },
    })
    chk('das Anlegen mit Passwort geht durch', mitGeheim.status === 200, mitGeheim.text.slice(0, 400))
    const geheimArchiv = mitGeheim.bytes
    if (mitGeheim.status === 200) {
      // DER ENTPACKTE STROM wird durchsucht, nicht das gzip. Ein Geheimnis
      // faende man im komprimierten Strom naemlich auch dann nicht, wenn es
      // drin STEHT — und dann meldete diese Zeile gruen und waere blind.
      const roh = gunzipSync(geheimArchiv).toString('latin1')
      for (const [name, wert] of Object.entries(GEHEIMNISSE)) {
        chk(`«${name}» steht NIRGENDS im Klartext im Archiv`, roh.includes(wert) === false)
      }
      chk('der Behaelter liegt im Archiv', roh.includes('zugangsdaten.gpg'))
      chk('der Netzname geht bewusst MIT (sonst weiss niemand, welches Netz fehlt)', roh.includes('Zuhause'))

      // Jetzt die Geheimnisse auf der Box loeschen und zurueckholen.
      const ohne = konfigVorgabe()
      ;(ohne['spotify'] as Record<string, unknown>)['refreshToken'] = ''
      ;(ohne['spotify'] as Record<string, unknown>)['clientSecret'] = ''
      ;(ohne['telegram'] as Record<string, unknown>)['token'] = ''
      writeFileSync(join(k.etc, 'mupiboxconfig.json'), `${JSON.stringify(ohne, null, 4)}\n`)
      writeFileSync(join(k.config, 'wlan.json'), `${JSON.stringify([{ ssid: 'Zuhause', pw: '' }], null, 4)}\n`)

      const v3 = await holen(basis, '/api/sicherung/pruefen', { art: 'POST', roh: geheimArchiv })
      chk('die Vorschau nennt die verschluesselten Felder', v3.status === 200)
      const zug = (v3.json as { stand?: { zugangsdaten?: unknown[] } })?.stand?.zugangsdaten ?? []
      chk(`die Vorschau sagt, WIE VIELE Zugangsdaten darin liegen (${zug.length})`, zug.length >= 3)

      const z3 = await holen(basis, '/api/sicherung/zurueckspielen', {
        art: 'POST',
        json: { kennung: (v3.json as { kennung: string }).kennung, mitZugangsdaten: true, passwort: PASSWORT },
      })
      chk('das Zurueckspielen mit Passwort geht durch', z3.status === 200, z3.text.slice(0, 500))
      const jetzt = JSON.parse(readFileSync(join(k.etc, 'mupiboxconfig.json'), 'utf8'))
      chk(
        'der Spotify-Dauerzugang ist wieder da (der eigentliche Schluessel)',
        jetzt.spotify.refreshToken === GEHEIMNISSE.refresh,
      )
      chk('das Spotify-Geheimnis ist wieder da', jetzt.spotify.clientSecret === GEHEIMNISSE.clientSecret)
      chk('der Telegram-Schluessel ist wieder da', jetzt.telegram.token === GEHEIMNISSE.telegram)
      const wlan = JSON.parse(readFileSync(join(k.config, 'wlan.json'), 'utf8'))
      chk('das WLAN-Passwort ist wieder da (der Hausschluessel)', wlan[0]?.pw === GEHEIMNISSE.wlanPw)

      /* ══ Ring 4 — falsches Passwort ═══════════════════════════════════ */
      kopf('Ring 4 — falsches Passwort: laut scheitern, NICHTS anfassen')
      const vor4 = bestand(k)
      const v4 = await holen(basis, '/api/sicherung/pruefen', { art: 'POST', roh: geheimArchiv })
      const z4 = await holen(basis, '/api/sicherung/zurueckspielen', {
        art: 'POST',
        json: {
          kennung: (v4.json as { kennung: string }).kennung,
          mitZugangsdaten: true,
          passwort: 'das-ist-das-falsche-passwort',
        },
      })
      chk('es scheitert (und zwar mit einer Absage, nicht mit 200)', z4.status >= 400)
      chk(
        'die Absage sagt, dass es am Passwort lag',
        /[Pp]asswort|passphrase|gpg/.test(String((z4.json as { fehler?: string })?.fehler ?? '')),
        String((z4.json as { fehler?: string })?.fehler ?? '').slice(0, 300),
      )
      const n4 = vergleich(vor4, bestand(k))
      chk(
        `KEINE einzige Datei wurde angefasst (${n4.anders.length} anders, ${n4.fehlt.length} fehlen)`,
        n4.anders.length === 0 && n4.fehlt.length === 0,
        n4.anders.join(', '),
      )
    }

    /* ══ Ring 5 — beschaedigte Datei ═════════════════════════════════════ */
    kopf('Ring 5 — ein umgedrehtes Byte in der Mitte')
    const vor5 = bestand(k)
    const dreher = Buffer.from(archiv)
    const mitte = Math.floor(dreher.length / 2)
    dreher[mitte] = (dreher[mitte] as number) ^ 0xff
    const v5 = await holen(basis, '/api/sicherung/pruefen', { art: 'POST', roh: dreher })
    chk('die beschaedigte Datei wird abgelehnt', v5.status >= 400, v5.text.slice(0, 300))
    const n5 = vergleich(vor5, bestand(k))
    chk('nichts geschrieben', n5.anders.length === 0 && n5.fehlt.length === 0)

    /* ══ Ring 6 — gar keine Sicherung ════════════════════════════════════ */
    kopf('Ring 6 — ein Urlaubsfoto statt einer Sicherung')
    const v6 = await holen(basis, '/api/sicherung/pruefen', {
      art: 'POST',
      roh: Buffer.from('\x89PNG\r\n\x1a\n das ist ein Bild und keine Sicherung'),
    })
    chk('wird abgelehnt', v6.status >= 400)
    const satz6 = String((v6.json as { fehler?: string })?.fehler ?? '')
    chk('mit einem ganzen Satz, den man einem Elternteil zeigen kann', /keine MuPiBox-Sicherung/.test(satz6), satz6)
    chk(
      'ohne Stapelabzug in der Antwort',
      /Traceback|SyntaxError|at Object\./.test(satz6) === false,
      satz6.slice(0, 200),
    )
    chk(
      'und ohne dass etwas im Verzeichnis der Staende liegen bleibt',
      readdirSync(k.staende).some((n) => n.includes('0eingang')) === false,
    )

    /* ══ Ring 7 — eine andere Box ════════════════════════════════════════ */
    kopf('Ring 7 — ein Stand von einer ANDEREN Box')
    // Der Server nennt sich hier «ring-box», das Archiv traegt den Namen
    // dieses Rechners — der Fall ist damit schon in Ring 1 gefahren worden.
    // Hier wird nachgesehen, dass die WARNUNG auch wirklich dasteht.
    const v7 = await holen(basis, '/api/sicherung/pruefen', { art: 'POST', roh: archiv })
    const w7 = ((v7.json as { warnungen?: string[] })?.warnungen ?? []).join(' ')
    chk('es wird gewarnt', /ANDEREN Box/.test(w7), w7)
    chk('aber nicht verboten — wer die Karte tauscht, setzt neu auf', v7.status === 200)

    /* ══ Ring 8 — das Passwort hinterlaesst keine Spur ═══════════════════ */
    kopf('Ring 8 — steht das Passwort irgendwo?')
    chk('in KEINER Antwort des Servers', gesagt.join('\n').includes(PASSWORT) === false)
    chk(
      'in KEINEM Archiv',
      gunzipSync(geheimArchiv).toString('latin1').includes(PASSWORT) === false || mitGeheim.status !== 200,
    )
    chk(
      'in KEINEM Stand, der auf der Box liegen geblieben ist',
      readdirSync(k.staende).every(
        (n) => readFileSync(join(k.staende, n)).toString('latin1').includes(PASSWORT) === false,
      ),
    )

    /* ══ Ring 9 — die Oberflaeche ════════════════════════════════════════ */
    kopf('Ring 9 — kann die Oberflaeche das Passwort ablegen?')
    if (!existsSync(OBERFLAECHE)) {
      chk('es gibt eine Seite fuer die Sicherung', false, `${OBERFLAECHE} fehlt`)
    } else {
      const q = readFileSync(OBERFLAECHE, 'utf8')
      // ZEILENWEISE und OHNE Kommentare: ein Kommentar, der erklaert, warum
      // hier kein localStorage steht, darf nicht als Fund gelten.
      const code = q
        .split('\n')
        .filter((z) => !/^\s*(\/\/|\/?\*)/.test(z))
        .join('\n')
      const verboten: [string, RegExp][] = [
        ['localStorage', /\blocalStorage\b/],
        ['sessionStorage', /\bsessionStorage\b/],
        ['indexedDB', /\bindexedDB\b/],
        ['document.cookie', /document\.cookie/],
        ['console.log/…', /\bconsole\.(log|info|debug|warn|error)\b/],
        ['das Passwort in einer Adresse', /[?&](passwort|password|pw)=/],
        ['ein [value]-Binding auf das Passwortfeld', /\[value\]="[^"]*(passwort|password)/i],
        ['ein ngModel auf das Passwort (schreibt in ein Signal, das gerendert wird)', /ngModel[^\n]*passwort/i],
      ]
      for (const [name, muster] of verboten) {
        chk(`kein ${name}`, muster.test(code) === false)
      }
      chk('das Passwortfeld ist type="password"', /type="password"/.test(q))
      chk(
        'es wird nach Gebrauch geloescht (ein Feld, das leer geraeumt wird)',
        /(\.value\s*=\s*''|passwortLeeren|leeren\(\))/.test(code),
      )
      chk('das Passwort geht im KOERPER hinaus, nicht in der Adresse', /body:\s*JSON\.stringify/.test(code))
      chk(
        'die Seite schreibt hin, wovor die Ablage NICHT schuetzt (aus der API, nicht abgeschrieben)',
        /ablageHinweise/.test(code),
      )
    }

    /* ══ Ring 10 — ein Stand aus der Zeit VOR der Bruecke ════════════════ */
    //
    // DER FALL IST NICHT AUSGEDACHT, ER IST DER REGELFALL EINER ALTEN
    // SICHERUNG. Bis E18 Stufe 3 (05.08.2026) war `server/config/resume.json`
    // eine gewoehnliche Datei mit den gemerkten Stellen der ganzen Box. Seit
    // dem Umzug ist sie ein VERWEIS auf `profile/<aktiv>/resume.json`. Ein
    // Stand von vorher traegt sie also als INHALT — und `fremdheitPruefen`
    // nimmt eine aeltere Fassung ausdruecklich an (ein Verbot waere hier die
    // naechste Sackgasse).
    //
    // WAS BIS ZUM 07.08.2026 PASSIERTE: `atomar_schreiben` legte daneben und
    // benannte um; `os.replace` ersetzte den Verweis durch eine Datei. Danach
    // fand server.ts am alten Ort eine echte Datei, hielt sie fuer die
    // juengere Wahrheit und schob sie per link+rename IN den Bereich des
    // aktiven Kindes — ueber dessen gerade zurueckgespielte Stellen hinweg,
    // und ohne den Abzug `resume.json.vorher` (der greift nur bei einer
    // leeren Liste).
    //
    // DER RING BAUT DEN STAND MIT DEM ECHTEN WEG, nicht von Hand: erst die
    // Datei an den alten Ort legen, DANN sichern (jetzt traegt das Archiv sie
    // als Inhalt), dann die Bruecke legen wie beim Umzug — und zurueckspielen.
    kopf('Ring 10 — ein Stand aus der Zeit VOR der Bruecke')
    const bruecke = join(k.config, 'resume.json')
    const bereichResume = join(k.config, 'profile/liam/resume.json')
    rmSync(bruecke)
    writeFileSync(bruecke, `${JSON.stringify([{ id: 'box-weit-von-frueher' }], null, 4)}\n`)
    const altArchiv = await holen(basis, '/api/sicherung/anlegen', { art: 'POST', json: {} })
    chk('der alte Stand entsteht (mit resume.json als DATEI)', altArchiv.status === 200)
    // Der Umzug: aus der Datei wird die Bruecke, der Bestand zieht in den
    // Bereich. Genau das tut `resumeBrueckeRichten` beim ersten Start danach.
    rmSync(bruecke)
    writeFileSync(bereichResume, `${JSON.stringify({ 'spotify:album:liam': { pos: 42 } }, null, 4)}\n`)
    symlinkSync('profile/liam/resume.json', bruecke)
    const vorRing10 = bestand(k)
    const p10 = await holen(basis, '/api/sicherung/pruefen', { art: 'POST', roh: altArchiv.bytes })
    chk('der alte Stand laesst sich pruefen (eine aeltere Fassung wird angenommen)', p10.status === 200)
    const v10 = p10.json as { kennung: string; satz: string; plan: { verweisZiele: string[] } }
    chk(
      'die Vorschau sagt VORHER, dass dort ein Verweis liegt und nichts geschrieben wird',
      (v10?.plan?.verweisZiele ?? []).some((z) => z.includes('resume.json')),
      JSON.stringify(v10?.plan?.verweisZiele ?? []),
    )
    chk('… und der Satz ueber dem roten Knopf nennt es', /bleib(t|en) stehen/.test(v10?.satz ?? ''), v10?.satz)
    const z10 = await holen(basis, '/api/sicherung/zurueckspielen', {
      art: 'POST',
      json: { kennung: v10.kennung },
    })
    chk('das Zurueckspielen laeuft durch', z10.status === 200, z10.text.slice(0, 300))
    const nachRing10 = bestand(k)
    chk(
      'die Bruecke ist danach IMMER NOCH ein Verweis (und keine Datei)',
      nachRing10.get('server/config/resume.json')?.art === 'verweis',
      `art: ${nachRing10.get('server/config/resume.json')?.art}`,
    )
    // NICHT „unveraendert" — der Bereich des Kindes steht im Stand und wird
    // zu Recht zurueckgespielt. Die Frage ist eine andere: steht danach der
    // BOX-WEITE Inhalt vom alten Ort im Bereich des Kindes? Genau das waere
    // der Schaden, und er entsteht nicht beim Zurueckspielen selbst, sondern
    // beim naechsten Lesen durch server.ts.
    chk(
      'im Bereich des Kindes steht NICHT der box-weite Inhalt vom alten Ort',
      nachRing10
        .get('server/config/profile/liam/resume.json')
        ?.roh.toString('utf8')
        .includes('box-weit-von-frueher') === false,
      nachRing10.get('server/config/profile/liam/resume.json')?.roh.toString('utf8').slice(0, 120),
    )
    chk(
      '… und der box-weite Inhalt liegt auch sonst nirgends im Bereich',
      [...nachRing10].every(
        ([n, w]) => !n.startsWith('server/config/profile/') || !w.roh.toString('utf8').includes('box-weit-von-frueher'),
      ),
    )
    chk(
      'keine Ablage hat dabei die Art gewechselt',
      vergleich(vorRing10, nachRing10).artGewechselt.length === 0,
      vergleich(vorRing10, nachRing10).artGewechselt.join(', '),
    )
  } finally {
    schliessen()
    if (process.argv.includes('--behalten')) {
      console.log(`\nSandkasten bleibt stehen: ${k.wurzel}`)
    } else {
      rmSync(k.wurzel, { recursive: true, force: true })
    }
  }

  console.log(`\n${'═'.repeat(70)}`)
  if (schlecht.length === 0) {
    console.log(`ALLE ${gut} AUSSAGEN HALTEN. Der Ring ohne SSH ist geschlossen.`)
    return 0
  }
  console.log(`${gut} gehalten, ${schlecht.length} NICHT:`)
  for (const s of schlecht) console.log(`  - ${s}`)
  return 1
}

main().then(
  (c) => process.exit(c),
  (e) => {
    console.error(e)
    process.exit(1)
  },
)
