/**
 * WER DARF DAS, UND WAS STEHT DRIN? — der Angriffsring gegen /api/sicherung*.
 *
 * `tools/sicherung-ohne-ssh-ring.ts` misst, ob der Rueckweg FUNKTIONIERT.
 * Dieses Werkzeug stellt die andere Frage: was geht dabei HINAUS, und wer
 * kann es holen. Es baut denselben Sandkasten (eigener Port 9875, Patchkopie
 * des echten Pythons, eigene Verzeichnisse) und faehrt sieben Ringe:
 *
 *   1  WAS STEHT IM STAND — eine Konfiguration mit gezeichneten Geheimnissen
 *      (jedes ist eine eindeutige Marke), ein Stand OHNE `--mit-zugangsdaten`,
 *      und dann die rohen Bytes des Archivs nach jeder Marke durchsucht.
 *      Verglichen wird gegen `ohneGeheimnisse()` aus konfiguration.ts — die
 *      Liste, die dieselbe Box am Weg /api/config anlegt. Was DORT gestrichen
 *      wird und HIER mitgeht, ist ein Befund, kein Geschmack.
 *   2  DER WEG OHNE ALLES — POST /api/sicherung/anlegen ohne Koerper, ohne
 *      Inhaltstyp, ohne Passwort, mit fremder Herkunft. Genau die Anfrage, die
 *      eine fremde Webseite ohne Vorabfrage stellen kann.
 *   3  DAS PASSWORT — steht es in argv, in der Umgebung, in einer Antwort,
 *      in einer Kopfzeile? Gemessen an einem untergeschobenen Python, das
 *      argv, Umgebung und stdin auf die Platte schreibt.
 *   4  DER AUSBRUCH — Archive mit `..`, absolutem Pfad und Verknuepfung.
 *      Danach wird nachgezaehlt, ob AUSSERHALB der beiden Baeume etwas
 *      entstanden ist.
 *   5  DIE BOMBE — 8 MB Archiv, das sich beim Entpacken vertausendfacht.
 *      Gemessen wird der Speicher des Servers, nicht die Absicht.
 *   6  DER EINGANG — wie viele unbestaetigte Vorschauen liegen bleiben duerfen
 *      und wie viele Bytes das je Anfrage sind.
 *   7  DER BEHAELTER — ein Stand MIT Zugangsdaten durch beide Wege, und jede
 *      Antwort (Koerper UND Kopfzeilen) roh nach jedem Wert durchsucht. Dazu
 *      die Gegenprobe: die Werte kommen auf der Box wirklich an.
 *
 * NIE GEGEN DIE BOX. Alle Pfade zeigen in einen Sandkasten unter /tmp; die
 * Patchkopie wird gezaehlt (ein Muster, das ins Leere greift, waere der
 * schlimmste Fall — der Lauf liefe dann gegen das echte /etc/mupibox).
 *
 *   npx tsx tools/sicherung-was-geht-hinaus.ts
 */
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { ohneGeheimnisse } from '../src/backend-api/src/konfiguration'

const WURZEL = dirname(dirname(fileURLToPath(import.meta.url)))
const ECHTES_SKRIPT = join(WURZEL, 'scripts/mupibox/mupibox-sicherung.py')
const PORT = 9875
// Ring 3 braucht einen EIGENEN Port: nach server.close() liegen im globalen
// fetch-Pool noch Keep-Alive-Verbindungen zum alten Server. Auf demselben
// Port griffe undici zu einer davon — «other side closed» statt Messung.
// Ein frischer Port ist ein frischer Pool. (9876 gehoert Karma.)
const RING3_PORT = 9877

let rot = 0
let gruen = 0
const offen: string[] = []

function chk(name: string, gut: boolean, dazu = ''): void {
  if (gut) {
    gruen++
    console.log(`  \x1b[32m✓\x1b[0m ${name}${dazu ? `  — ${dazu}` : ''}`)
  } else {
    rot++
    console.log(`  \x1b[31m✗ ${name}\x1b[0m${dazu ? `  — ${dazu}` : ''}`)
    offen.push(name)
  }
}

function ring(name: string): void {
  console.log(`\n── ${name} ${'─'.repeat(Math.max(0, 66 - name.length))}`)
}

/* ── Der Sandkasten ────────────────────────────────────────────────────── */

/** Die Konstanten des echten Pythons in den Sandkasten biegen — und ZAEHLEN. */
function patchen(quelle: string, k: Record<'box' | 'staende' | 'karte' | 'etc' | 'sperre', string>) {
  let text = readFileSync(quelle, 'utf8')
  const ersatz: [RegExp, string][] = [
    [/^BOX = "[^"]*"$/m, `BOX = ${JSON.stringify(k.box)}`],
    [/^STAENDE = "[^"]*"$/m, `STAENDE = ${JSON.stringify(k.staende)}`],
    [/^KARTE = "[^"]*"/m, `KARTE = ${JSON.stringify(k.karte)}`],
    [/^SPERRE = "[^"]*"/m, `SPERRE = ${JSON.stringify(k.sperre)}`],
    [/^ {4}"etc\/mupibox": "\/etc\/mupibox",$/m, `    "etc/mupibox": ${JSON.stringify(k.etc)},`],
  ]
  let treffer = 0
  for (const [muster, neu] of ersatz) {
    const vorher = text
    text = text.replace(muster, neu)
    if (text !== vorher) treffer++
  }
  return { text, treffer, erwartet: ersatz.length }
}

/** Jedes Geheimnis traegt eine eindeutige Marke — damit ein Fund im rohen
 *  Archiv keine Auslegungssache ist. */
const MARKE = (was: string) => `ZEICHEN-${was}-${randomBytes(6).toString('hex')}`

const G = {
  pin: MARKE('EINSTELLUNGSPIN'),
  adminPw: MARKE('VERWALTUNGSPASSWORT'),
  clientSecret: MARKE('SPOTIFY-CLIENTSECRET'),
  accessToken: MARKE('SPOTIFY-ACCESSTOKEN'),
  refreshToken: MARKE('SPOTIFY-REFRESHTOKEN'),
  spotifyUser: MARKE('SPOTIFY-BENUTZER'),
  spotifyPw: MARKE('SPOTIFY-PASSWORT'),
  jellyfin: MARKE('JELLYFIN-APIKEY'),
  // Die Soloist-Schluessel (spak_) — flach in der Gruppe UND je Strom in der
  // Liste. Bis 22.08.2026 prueften wir am Leck vorbei: beide fehlten hier
  // und lagen im Klartext in jeder Sicherung.
  soloistKey: MARKE('SOLOIST-APIKEY'),
  soloistKeyMitschnitt: MARKE('SOLOIST-APIKEY-MITSCHNITT'),
  stromKey: MARKE('STROM-SCHLUESSEL'),
  telegram: MARKE('TELEGRAM-TOKEN'),
  mqttPw: MARKE('MQTT-PASSWORT'),
  wlanPw: MARKE('WLAN-PASSWORT'),
  cfgSecret: MARKE('CONFIG-CLIENTSECRET'),
  cfgRefresh: MARKE('CONFIG-REFRESHTOKEN'),
}

function konfigVorgabe(): Record<string, unknown> {
  return {
    mupibox: {
      audioDevice: 'MuPiHAT',
      startVolume: 25,
      maxVolume: 75,
      // Ohne ihn haelt `konfig_pruefen` den Stand zu Recht fuer unbrauchbar —
      // change_checker.sh setzte sonst `sleep null` ein.
      mediaCheckTimer: 300,
      einstellungssperre: true,
      // Der Riegel vor den Einstellungen der Box. `ohneGeheimnisse` streicht
      // ihn ausdruecklich — vier Ziffern sind aus einem bcrypt-Hash in
      // Sekunden zurueckgerechnet.
      einstellungsPin: G.pin,
    },
    interfacelogin: { state: false, username: 'admin', password: G.adminPw },
    spotify: {
      clientId: 'oeffentliche-kennung',
      clientSecret: G.clientSecret,
      accessToken: G.accessToken,
      refreshToken: G.refreshToken,
      username: G.spotifyUser,
      password: G.spotifyPw,
      soloistApiKey: G.soloistKey,
      soloistApiKeyMitschnitt: G.soloistKeyMitschnitt,
      // Die Strom-Liste (E72): der Schluessel liegt NICHT flach in der
      // Gruppe, sondern je Eintrag — genau die Form, die die flache
      // Streich-Schleife von ohneGeheimnisse frueher verfehlte.
      stroeme: [{ nr: 1, zweck: 'wiedergabe', maschine: 'soloist', schluessel: G.stromKey, senke: '' }],
    },
    jellyfin: { url: 'http://jelly', apiKey: G.jellyfin },
    telegram: { token: G.telegram },
    mqtt: { username: 'mupi', password: G.mqttPw },
  }
}

interface Kasten {
  wurzel: string
  etc: string
  config: string
  staende: string
  skript: string
}

// Fuer die Bilanz auf dem Absturzweg: dort laeuft das finally in lauf() nie.
let kastenWurzel: string | undefined

function kastenBauen(): Kasten {
  const wurzel = mkdtempSync(join(tmpdir(), 'mupi-hinaus-'))
  kastenWurzel = wurzel
  const etc = join(wurzel, 'etc')
  const box = join(wurzel, 'box')
  const config = join(box, 'server', 'config')
  const staende = join(wurzel, 'staende')
  for (const d of [etc, config, staende, join(wurzel, 'karte')]) mkdirSync(d, { recursive: true })

  writeFileSync(join(etc, 'mupiboxconfig.json'), JSON.stringify(konfigVorgabe(), null, 4))
  writeFileSync(
    join(config, 'data.json'),
    JSON.stringify([{ id: '1', type: 'library', category: 'audiobook', artist: 'Bibi', title: 'Folge 1' }], null, 2),
  )
  writeFileSync(join(config, 'wlan.json'), JSON.stringify([{ ssid: 'Heimnetz', pw: G.wlanPw }], null, 2))
  writeFileSync(
    join(config, 'config.json'),
    JSON.stringify({ spotify: { clientSecret: G.cfgSecret, refreshToken: G.cfgRefresh } }, null, 2),
  )

  const skript = join(wurzel, 'sicherung.py')
  const p = patchen(ECHTES_SKRIPT, {
    box,
    staende,
    karte: join(wurzel, 'karte'),
    etc,
    sperre: join(wurzel, 'laeuft'),
  })
  if (p.treffer !== p.erwartet) {
    console.error(`ABBRUCH: nur ${p.treffer}/${p.erwartet} Konstanten umgebogen — der Lauf traefe echte Pfade.`)
    process.exit(2)
  }
  writeFileSync(skript, p.text)
  return { wurzel, etc, config, staende, skript }
}

/* ── Der Server ────────────────────────────────────────────────────────── */

async function serverStarten(k: Kasten, stubSkript?: string, port = PORT) {
  const { default: express } = await import('express')
  const { default: cors } = await import('cors')
  const { sicherungWegeBauen } = await import('../src/backend-api/src/sicherung')
  const app = express()
  // GENAU WIE IN server.ts, ZEILE 638: jede Herkunft ist erlaubt.
  app.use(cors())
  app.use(
    sicherungWegeBauen({
      skript: stubSkript ?? k.skript,
      staende: k.staende,
      vorspann: [],
      host: () => 'sandkasten',
      anmeldungOffen: () => true,
      fristMs: 20_000,
    }),
  )
  const server = app.listen(port)
  await new Promise<void>((f) => server.once('listening', () => f()))
  return server
}

const url = (w: string, port = PORT) => `http://127.0.0.1:${port}${w}`

/* ══ Ring 1 — was steht im Stand ═══════════════════════════════════════ */

function ring1(k: Kasten): Buffer {
  ring('1  WAS STEHT IM STAND (ohne --mit-zugangsdaten)')
  execFileSync('python3', [k.skript, '--anlegen', '--grund', 'probe'], { stdio: 'pipe' })
  const namen = readdirSync(k.staende).filter((n) => n.endsWith('.tar.gz'))
  chk('ein Stand ist entstanden', namen.length === 1, namen.join(', '))
  const archiv = readFileSync(join(k.staende, namen[0] as string))
  const roh = execFileSync('gzip', ['-dc'], { input: archiv, maxBuffer: 64 * 1024 * 1024 })

  // Die Gegenliste: was streicht derselbe Server am Weg /api/config?
  const gestrichen = ohneGeheimnisse(konfigVorgabe()) as Record<string, Record<string, unknown>>
  const wirdGestrichen = (marke: string) => !JSON.stringify(gestrichen).includes(marke)

  const marken: [string, string][] = Object.entries(G)
  for (const [name, marke] of marken) {
    const drin = roh.includes(marke)
    const solltGestrichen = wirdGestrichen(marke)
    if (!drin) {
      chk(`${name}: nicht im Archiv`, true)
      continue
    }
    // Drin. Ist das in Ordnung? Nur, wenn /api/config es auch herausgibt.
    chk(
      `${name}: steht IM KLARTEXT im Archiv, obwohl ohneGeheimnisse() es streicht`,
      !solltGestrichen,
      solltGestrichen ? 'derselbe Wert wird an /api/config ausdruecklich geleert' : 'geht auch sonst hinaus',
    )
  }
  return archiv
}

/* ══ Ring 2 — der Weg ohne alles ═══════════════════════════════════════ */

async function ring2(): Promise<void> {
  ring('2  DER WEG OHNE ALLES (fremde Herkunft, kein Koerper, kein Passwort)')
  // GENAU DIE ANFRAGE, DIE EINE FREMDE SEITE STELLEN KANN: POST, kein
  // Inhaltstyp, kein Koerper — und deshalb ohne Vorabfrage. Die Kopfzeilen
  // sind die, die der Browser dabei selbst setzt.
  const fremd = await fetch(url('/api/sicherung/anlegen'), {
    method: 'POST',
    headers: { Origin: 'https://boese.example', 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'cors' },
  })
  chk('eine fremde Webseite wird abgewiesen', fremd.status === 403, `Status ${fremd.status}`)
  chk(
    '… und bekommt kein Archiv, sondern einen Satz',
    !String(fremd.headers.get('content-type') ?? '').includes('gzip'),
    `Content-Type: ${fremd.headers.get('content-type')}`,
  )
  const acaoF = fremd.headers.get('access-control-allow-origin')
  chk(
    '… und kein «Access-Control-Allow-Origin: *» (sonst liest sie die Antwort mit)',
    acaoF !== '*',
    `Access-Control-Allow-Origin: ${acaoF}`,
  )

  // DIE GEGENPROBE — sie ist die wichtigere Haelfte: der Riegel darf dem
  // Elternteil den Rueckweg NICHT nehmen.
  const eigen = await fetch(url('/api/sicherung/anlegen'), {
    method: 'POST',
    headers: {
      Origin: `http://127.0.0.1:${PORT}`,
      'Sec-Fetch-Site': 'same-origin',
      'Content-Type': 'application/json',
    },
    body: '{}',
  })
  chk('die eigene Verwaltung kommt weiterhin durch', eigen.status === 200, `Status ${eigen.status}`)
  const ohne = await fetch(url('/api/sicherung'))
  chk('ein Aufruf ganz ohne Sec-Fetch-Kopfzeilen (curl, alter Browser) auch', ohne.status === 200)
  const acao = eigen.headers.get('access-control-allow-origin')
  chk('auch der eigenen Seite wird kein «*» mitgegeben', acao !== '*', `Access-Control-Allow-Origin: ${acao}`)

  const bytes = Buffer.from(await eigen.arrayBuffer())
  const roh = execFileSync('gzip', ['-dc'], { input: bytes, maxBuffer: 64 * 1024 * 1024 })
  chk('der Download enthaelt die PIN nicht', !roh.includes(G.pin), roh.includes(G.pin) ? 'sie ist drin' : '')
  chk(
    'der Download enthaelt das Spotify-Passwort nicht',
    !roh.includes(G.spotifyPw),
    roh.includes(G.spotifyPw) ? 'es ist drin' : '',
  )

  const lage = await fetch(url('/api/sicherung'))
  const j = (await lage.json()) as Record<string, unknown>
  chk('GET /api/sicherung antwortet', lage.status === 200 && j['ok'] === true)
}

/* ══ Ring 3 — das Passwort ═════════════════════════════════════════════ */

async function ring3(k: Kasten): Promise<void> {
  ring('3  DAS PASSWORT — argv, Umgebung, Antwort, Kopfzeilen')
  const spur = join(k.wurzel, 'spur.json')
  const stub = join(k.wurzel, 'stub.py')
  writeFileSync(
    stub,
    [
      'import json, os, sys',
      'e = sys.stdin.read()',
      `open(${JSON.stringify(spur)}, "w").write(json.dumps(`,
      '  {"argv": sys.argv, "env": dict(os.environ), "stdin": e}))',
      'print("Stand vom 2026-01-01  (Grund: probe)")',
      'sys.exit(3)',
    ].join('\n'),
  )
  const server = await serverStarten(k, stub, RING3_PORT)
  try {
    const pw = `Geheim-${randomBytes(8).toString('hex')}`
    const a = await fetch(url('/api/sicherung/anlegen', RING3_PORT), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mitZugangsdaten: true, passwort: pw }),
    })
    const text = await a.text()
    const s = JSON.parse(readFileSync(spur, 'utf8')) as { argv: string[]; env: Record<string, string>; stdin: string }
    chk('das Passwort steht in KEINEM Argument', !s.argv.some((x) => x.includes(pw)))
    chk('das Passwort steht in KEINER Umgebungsvariablen', !Object.values(s.env).some((x) => x.includes(pw)))
    chk('MUPIBOX_SICHERUNG_PW ist aus der Umgebung des Kindes entfernt', !('MUPIBOX_SICHERUNG_PW' in s.env))
    chk('das Passwort kommt ueber stdin an', s.stdin.trim() === pw)
    chk('das Passwort steht in KEINER Antwort', !text.includes(pw))
    chk('das Passwort steht in KEINER Kopfzeile', ![...a.headers.entries()].some(([, v]) => v.includes(pw)))
  } catch (fehler) {
    chk('die Messanfrage kommt durch und laesst sich auswerten', false, fehlerText(fehler))
  } finally {
    server.close()
  }
}

/* ══ Ring 4 — der Ausbruch ═════════════════════════════════════════════ */

/** Ein tar-Kopf von Hand — nur so lassen sich unmoegliche Namen bauen. */
function tarEintrag(name: string, daten: Buffer, typ = '0'): Buffer {
  const kopf = Buffer.alloc(512)
  kopf.write(name.slice(0, 100), 0, 'utf8')
  kopf.write('0000644\0', 100)
  kopf.write('0000000\0', 108)
  kopf.write('0000000\0', 116)
  kopf.write(`${daten.length.toString(8).padStart(11, '0')}\0`, 124)
  kopf.write(
    `${Math.floor(Date.now() / 1000)
      .toString(8)
      .padStart(11, '0')}\0`,
    136,
  )
  kopf.write('        ', 148)
  kopf.write(typ, 156)
  let summe = 0
  for (const b of kopf) summe += b
  kopf.write(`${summe.toString(8).padStart(6, '0')}\0 `, 148)
  const fuellung = Buffer.alloc((512 - (daten.length % 512)) % 512)
  return Buffer.concat([kopf, daten, fuellung])
}

function archivBauen(dateien: [string, Buffer][], stand: object): Buffer {
  const teile: Buffer[] = []
  teile.push(tarEintrag('stand.json', Buffer.from(JSON.stringify(stand))))
  for (const [n, d] of dateien) teile.push(tarEintrag(n, d))
  teile.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(teile))
}

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

async function ring4(k: Kasten): Promise<void> {
  ring('4  DER AUSBRUCH — .., absoluter Pfad, Verknuepfung')
  const draussen = join(k.wurzel, 'draussen')
  mkdirSync(draussen, { recursive: true })
  const boese = Buffer.from('{"eingedrungen": true}\n')

  const faelle: [string, string][] = [
    ['..-Schritt', 'server/config/../../../../draussen/eingedrungen.json'],
    ['absoluter Pfad', `${draussen}/absolut.json`],
    ['Rueckstrich', 'server/config/..\\..\\draussen\\rueck.json'],
  ]
  for (const [name, pfad] of faelle) {
    const archiv = archivBauen([[pfad, boese]], {
      format: 1,
      erzeugt: '2026-01-01T00:00:00',
      grund: 'angriff',
      host: 'sandkasten',
      dateien: [{ pfad, bytes: boese.length, sha256: sha(boese) }],
      ausgelassen: [],
      verweise: {},
    })
    const a = await fetch(url('/api/sicherung/pruefen'), { method: 'POST', body: new Uint8Array(archiv) })
    const j = (await a.json()) as Record<string, unknown>
    if (j['ok'] === true) {
      const b = await fetch(url('/api/sicherung/zurueckspielen'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kennung: j['kennung'] }),
      })
      await b.text()
    }
    chk(
      `${name}: nichts ausserhalb der Baeume entstanden`,
      readdirSync(draussen).length === 0,
      readdirSync(draussen).join(', '),
    )
  }
}

/* ══ Ring 5 — die Bombe ════════════════════════════════════════════════ */

async function ring5(): Promise<void> {
  ring('5  DIE BOMBE — ein Archiv, das sich beim Entpacken vertausendfacht')
  // 8 MB ist die Grenze in sicherung.ts (MAX_ARCHIV_BYTES). Hier wird eine
  // KLEINE Bombe geschossen (0,4 MB -> 400 MB), damit dieser Rechner nicht
  // stirbt; der Faktor wird gemessen und hochgerechnet.
  const gross = Buffer.alloc(400 * 1024 * 1024, 0)
  const bombe = gzipSync(gross, { level: 9 })
  const faktor = gross.length / bombe.length
  console.log(`     Faktor ${faktor.toFixed(0)}:1 — 8 MB werden zu ${((8 * faktor) / 1024).toFixed(1)} GB`)

  const vorher = await speicher()
  const a = await fetch(url('/api/sicherung/pruefen'), { method: 'POST', body: new Uint8Array(bombe) })
  const antwort = (await a.json()) as Record<string, unknown>
  const nachher = await speicher()
  const zuwachs = nachher - vorher
  console.log(`     Speicher des Servers: ${vorher} MB -> ${nachher} MB`)
  chk(
    'das Entpacken ist gedeckelt (der Speicher waechst nicht mit der entpackten Groesse)',
    zuwachs < 100,
    `+${zuwachs} MB bei 400 MB entpackt; ohne Deckel waeren es bei 8 MB Eingabe ${((8 * faktor) / 1024).toFixed(1)} GB`,
  )
  chk('die Bombe wird abgewiesen', a.status === 400, `Status ${a.status}`)
  chk(
    '… mit einem Satz, der die Ursache benennt',
    String(antwort['fehler'] ?? '').includes('blaeht'),
    String(antwort['fehler'] ?? ''),
  )
}

async function speicher(): Promise<number> {
  // Der Server laeuft in DIESEM Vorgang — sein Speicher ist unserer.
  global.gc?.()
  await new Promise((f) => setTimeout(f, 200))
  return Math.round(process.memoryUsage().rss / 1024 / 1024)
}

/* ══ Ring 6 — der Eingang ══════════════════════════════════════════════ */

async function ring6(k: Kasten): Promise<void> {
  ring('6  DER EINGANG — was eine unbestaetigte Vorschau liegen laesst')
  const vorher = readdirSync(k.staende).length
  // ZUFALLSBYTES, nicht Nullen: der Eingang liegt in der Form auf der Karte,
  // in der er hereinkam. Mit pressbarer Fuellung waere die gemessene Groesse
  // eine Luege.
  const gross = randomBytes(2 * 1024 * 1024)
  for (let n = 0; n < 5; n++) {
    const inhalt = Buffer.from(`{"n": ${n}}`)
    const archiv = archivBauen(
      [
        ['server/config/data.json', inhalt],
        ['fuellung.bin', Buffer.concat([gross, Buffer.from(String(n))])],
      ],
      {
        format: 1,
        erzeugt: '2026-01-01T00:00:00',
        grund: 'fuellen',
        host: 'sandkasten',
        dateien: [{ pfad: 'server/config/data.json', bytes: inhalt.length, sha256: sha(inhalt) }],
        ausgelassen: [],
        verweise: {},
      },
    )
    const a = await fetch(url('/api/sicherung/pruefen'), { method: 'POST', body: new Uint8Array(archiv) })
    await a.text()
  }
  const eingaenge = readdirSync(k.staende).filter((n) => n.includes('0eingang'))
  const bytes = eingaenge.reduce((s, n) => s + readFileSync(join(k.staende, n)).length, 0)
  console.log(
    `     ${eingaenge.length} Eingaenge, zusammen ${(bytes / 1024 / 1024).toFixed(1)} MB (vorher ${vorher} Dateien)`,
  )
  chk(
    'unbestaetigte Vorschauen sind in der ANZAHL gedeckelt',
    eingaenge.length <= 3,
    `${eingaenge.length} liegen gleichzeitig da; jede darf bis 8 MB gross sein und faellt sonst erst nach 30 min`,
  )
}

/* ══ Ring 7 — der Behaelter: kommt ein Wert in eine ANTWORT? ═══════════ */

/**
 * Ein Stand MIT Zugangsdaten durch beide Wege schicken und JEDE Antwort roh
 * nach jeder Marke durchsuchen: Koerper UND Kopfzeilen.
 *
 * DIE FRAGE, DIE HIER GESTELLT WIRD: die Vorschau gibt den Bericht des
 * Pythons Zeile fuer Zeile weiter (`zeilen`), dazu die Felderliste des
 * Behaelters und im Fehlerfall die letzten Zeilen von stdout/stderr
 * (`ausgabe`). Jede dieser drei Stellen ist ein Weg, auf dem ein WERT statt
 * eines NAMENS hinausgehen koennte — und die letzte laeuft auch dann, wenn
 * gpg etwas anderes sagt, als wir erwarten.
 */
async function ring7(k: Kasten): Promise<void> {
  ring('7  DER BEHAELTER — steht ein Wert in einer ANTWORT?')
  const gpgDa = (() => {
    try {
      execFileSync('gpg', ['--version'], { stdio: 'pipe' })
      return true
    } catch {
      return false
    }
  })()
  if (!gpgDa) {
    console.log('  ---   gpg fehlt: NICHT geprueft (das ist ein Befund, kein bestandener Test)')
    return
  }
  const pw = 'Sehr-Langes-Passwort-42'
  execFileSync('python3', [k.skript, '--anlegen', '--grund', 'mit-zug', '--mit-zugangsdaten'], {
    input: `${pw}\n${pw}\n`,
    stdio: 'pipe',
    env: { ...process.env, MUPIBOX_SICHERUNG_PW: '' },
  })
  const mit = readdirSync(k.staende)
    .filter((n) => n.includes('mit-zug'))
    .sort()
    .reverse()[0]
  chk('ein Stand mit Zugangsdaten ist entstanden', Boolean(mit), String(mit))
  if (!mit) return
  const archiv = readFileSync(join(k.staende, mit))
  const roh = execFileSync('gzip', ['-dc'], { input: archiv, maxBuffer: 64 * 1024 * 1024 })
  const marken = Object.entries(G)
  chk(
    'im Archiv selbst steht KEIN Wert im Klartext (nur im Behaelter)',
    !marken.some(([, m]) => roh.includes(m)),
    marken
      .filter(([, m]) => roh.includes(m))
      .map(([n]) => n)
      .join(', '),
  )

  // Die Vorschau — ohne Passwort. Sie darf die NAMEN nennen, nie die Werte.
  const v = await fetch(url('/api/sicherung/pruefen'), { method: 'POST', body: new Uint8Array(archiv) })
  const vText = await v.text()
  const vKopf = [...v.headers.entries()].map(([a, b]) => `${a}: ${b}`).join('\n')
  chk(
    'die Vorschau antwortet',
    v.status === 200,
    `Status ${v.status}${v.status === 200 ? '' : ` ${vText.slice(0, 300)}`}`,
  )
  chk(
    'in der Vorschau steht KEIN Wert',
    !marken.some(([, m]) => vText.includes(m)),
    marken
      .filter(([, m]) => vText.includes(m))
      .map(([n]) => n)
      .join(', '),
  )
  chk('… auch in keiner Kopfzeile', !marken.some(([, m]) => vKopf.includes(m)))
  chk(
    '… und die Felder werden trotzdem BENANNT (sonst weiss niemand, was fehlt)',
    vText.includes('refreshToken') && vText.includes('einstellungsPin'),
  )

  // ERST ETWAS KAPUTTMACHEN. Sonst misst die Gegenprobe unten nur, dass sich
  // nichts geaendert hat — und das waere kein Beleg.
  const vorherKonf = JSON.parse(readFileSync(join(k.etc, 'mupiboxconfig.json'), 'utf8')) as Record<
    string,
    Record<string, unknown>
  >
  vorherKonf['spotify'] = { ...(vorherKonf['spotify'] ?? {}), refreshToken: '' }
  vorherKonf['mupibox'] = { ...(vorherKonf['mupibox'] ?? {}), einstellungsPin: '' }
  writeFileSync(join(k.etc, 'mupiboxconfig.json'), JSON.stringify(vorherKonf, null, 4))

  // Und das Zurueckspielen MIT Passwort: der Wert wird geschrieben, aber nicht
  // erzaehlt.
  const kennung = (JSON.parse(vText) as Record<string, unknown>)['kennung']
  const z = await fetch(url('/api/sicherung/zurueckspielen'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kennung, mitZugangsdaten: true, passwort: pw }),
  })
  const zText = await z.text()
  chk('das Zurueckspielen laeuft durch', z.status === 200, `Status ${z.status}`)
  chk(
    'in seiner Antwort steht KEIN Wert',
    !marken.some(([, m]) => zText.includes(m)),
    marken
      .filter(([, m]) => zText.includes(m))
      .map(([n]) => n)
      .join(', '),
  )
  chk('… und auch nicht das Passwort', !zText.includes(pw))
  // Die Gegenprobe: die Werte sind wirklich angekommen — sonst misst das
  // Obige nur, dass nichts passiert ist.
  const konf = JSON.parse(readFileSync(join(k.etc, 'mupiboxconfig.json'), 'utf8')) as Record<
    string,
    Record<string, unknown>
  >
  chk('Gegenprobe: der Dauerzugang ist auf der Box wieder da', konf['spotify']?.['refreshToken'] === G.refreshToken)
  chk('Gegenprobe: die PIN ist auf der Box wieder da', konf['mupibox']?.['einstellungsPin'] === G.pin)
}

/* ══ Lauf ══════════════════════════════════════════════════════════════ */

/** `fetch failed` allein sagt nichts — die Ursache steckt in `cause`. */
function fehlerText(f: unknown): string {
  if (!(f instanceof Error)) return String(f)
  return f.cause ? `${f.message} — Ursache: ${String(f.cause)}` : f.message
}

function bilanz(): never {
  if (kastenWurzel) rmSync(kastenWurzel, { recursive: true, force: true })
  console.log(`\n${'═'.repeat(70)}`)
  console.log(`${gruen} gruen, ${rot} rot`)
  for (const o of offen) console.log(`  offen: ${o}`)
  process.exit(rot === 0 ? 0 : 1)
}

async function lauf(): Promise<void> {
  if (!existsSync(ECHTES_SKRIPT)) {
    console.error(`Es fehlt ${ECHTES_SKRIPT}`)
    process.exit(2)
  }
  const k = kastenBauen()
  console.log(`Sandkasten: ${k.wurzel}   Port: ${PORT}`)
  try {
    ring1(k)
    const server = await serverStarten(k)
    try {
      await ring2()
      await ring4(k)
      await ring5()
      await ring6(k)
      await ring7(k)
    } finally {
      server.close()
    }
    await ring3(k)
  } finally {
    rmSync(k.wurzel, { recursive: true, force: true })
  }
  bilanz()
}

// Ein Absturz ist ein BEFUND, kein Prozessende ohne Bilanz: was hier noch
// ankommt, wird rot gezaehlt und der Lauf ordentlich beendet.
process.on('unhandledRejection', (grund) => {
  chk('keine unbehandelte Promise-Ablehnung im Lauf', false, fehlerText(grund))
  bilanz()
})
process.on('uncaughtException', (fehler) => {
  chk('keine unbehandelte Ausnahme im Lauf', false, fehlerText(fehler))
  bilanz()
})
lauf().catch((fehler) => {
  chk('der Lauf kommt bis zur Bilanz', false, fehlerText(fehler))
  bilanz()
})
