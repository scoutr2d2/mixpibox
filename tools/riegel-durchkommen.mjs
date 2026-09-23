#!/usr/bin/env node
/**
 * KOMMT MAN AM HERKUNFTSRIEGEL TROTZDEM DURCH?
 *
 * ══ WOZU, WENN ES DOCH SCHON tools/herkunftsriegel-probe.mjs GIBT ══════════
 * Jene Probe misst, ob der Riegel das TUT, WAS ER SOLL: die Tafel aus
 * Weg-Arten und Herkuenften, die Verwaltung, die Gegenprobe. Sie fragt aber
 * ueberall dort, wo der Riegel HINSIEHT.
 *
 * DIESE hier fragt an den Stellen, an denen er WEGSIEHT. Sie ist absichtlich
 * unfreundlich gebaut und stellt genau vier Fragen:
 *
 *   1. HERKUNFT FAELSCHEN — gross/klein, Punkt am Ende, Praefix der erlaubten
 *      Herkunft, zwei Origin-Kopfzeilen, Benutzername vor dem Rechnernamen,
 *      und vor allem: DIE HOST-KOPFZEILE SELBST. Der Riegel vergleicht
 *      `Origin` gegen `Host` DERSELBEN Anfrage — wer beide setzt, ist per
 *      Definition „eigene Herkunft".
 *   2. WEGE VOR DEM RIEGEL — `app.use('/api', …)` haengt an einem PFAD. Jede
 *      Schreibweise desselben Weges, die der Riegel nicht als `/api` liest,
 *      der Router dahinter aber schon, ist ein Loch. `//api/x`, `/./api/x`,
 *      `/API/x`, `/%61pi/x`, absolute Form in der Anfragezeile, …
 *   3. DER FORMULAR-POST an einem Weg, der etwas SICHTBARES tut (die
 *      Lautstaerke beim Einschalten). Nachgesehen wird in der DATEI.
 *   4. DAS GET MIT WIRKUNG hinter der Ausnahme fuer die Navigation der
 *      obersten Ebene.
 *
 * ══ WARUM MIT ROHEN SOCKETS UND NICHT MIT fetch/http.request ═══════════════
 * `fetch` laesst `Host` nicht setzen, `http.request` faltet zwei gleiche
 * Kopfzeilen zusammen und weigert sich, eine Anfragezeile ohne `Host` oder mit
 * absoluter Form zu schicken. Genau das sind aber die Faelle. Also wird die
 * Anfrage Byte fuer Byte selbst geschrieben.
 *
 * ══ AUFRUF ════════════════════════════════════════════════════════════════
 *     node tools/riegel-durchkommen.mjs [--port 9625] [--behalten]
 *
 * NUR AUF DIESEM RECHNER. Es wird nichts ausgeliefert, nichts an der Box
 * angefasst. Der Serverprozess laeuft ueber einem Wegwerf-Verzeichnis.
 * Rueckgabewert: 0, wenn keine Zeile rot ist.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { gzipSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BACKEND = join(WURZEL, 'src', 'backend-api')

const argv = process.argv.slice(2)
const opt = (n, v) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : v
}
const BEHALTEN = argv.includes('--behalten')

/**
 * EIN PORT, DER NACHGEWIESEN FREI IST.
 *
 * Dieselbe Narbe wie in tools/herkunftsriegel-probe.mjs: liegt auf dem Port
 * schon ein Server einer anderen Sitzung, misst diese Probe still den
 * FALSCHEN und liefert eine vollstaendige Tafel ueber fremde Software.
 * Deshalb wird gebunden, und weiter unten wird zusaetzlich geprueft, ob die
 * Antwort ueberhaupt von diesem Backend kommt.
 */
async function portFrei(p) {
  return await new Promise((fertig) => {
    const s = net.createServer()
    s.once('error', () => fertig(false))
    s.once('listening', () => s.close(() => fertig(true)))
    s.listen(p, '127.0.0.1')
  })
}
async function portSuchen(von, bis) {
  // VIER Ports: p und p+1 sind die beiden Server (der zweite traegt den
  // geflickten Bau aus Ring 4b), p+2 und p+3 ihre TLS-Seiten.
  //
  // DIE TLS-PORTS SIND EINE NARBE. `MUPIBOX_HTTPS_PORT: '0'` sah nach
  // „abgeschaltet" aus — server.ts liest `Number(…) || 8443`, und aus der
  // Null wurde damit 8443. Dieses Werkzeug hat also den TLS-Port DIESES
  // RECHNERS belegt, an dem andere Sitzungen ihre Vorschau haben. Jeder
  // Port, den dieses Werkzeug braucht, wird deshalb vorher wirklich gebunden.
  for (let p = von; p <= bis; p++) {
    const alle = await Promise.all([portFrei(p), portFrei(p + 1), portFrei(p + 2), portFrei(p + 3)])
    if (alle.every(Boolean)) return p
  }
  throw new Error(`kein freier Portblock zwischen ${von} und ${bis}`)
}

const GEWUENSCHT = Number(opt('port', '9625'))
const PORT = await portSuchen(GEWUENSCHT, GEWUENSCHT + 60)
const PORT_GEFLICKT = PORT + 1
if (PORT !== GEWUENSCHT) console.log(`(Port ${GEWUENSCHT} war belegt — diese Probe laeuft auf ${PORT})`)

let fehler = 0
let offen = 0
const pruefe = (satz, ok, dazu = '') => {
  console.log(`  ${ok ? 'ok  ' : 'NEIN'} ${satz}${dazu ? `  — ${dazu}` : ''}`)
  if (!ok) fehler++
}
/** Ein Befund, der KEIN Fehler dieses Laufs ist, aber gesagt gehoert. */
const befund = (satz) => {
  console.log(`  !!    ${satz}`)
  offen++
}

/* ══ 1. EIN ARBEITSPLATZ, DER AUSSIEHT WIE DIE BOX ════════════════════════ */

function arbeitsplatz() {
  const ordner = mkdtempSync(join(tmpdir(), 'mupi-durchkommen-'))
  const konf = join(ordner, 'server', 'config')
  mkdirSync(konf, { recursive: true })
  writeFileSync(
    join(konf, 'mupiboxconfig.json'),
    JSON.stringify(
      {
        // `audioDevice` MUSS stehen: sonst lehnt `pruefeKonfig` JEDES Schreiben
        // ab, und die Schreibprobe misst dann nicht den Riegel, sondern eine
        // luecken­hafte Vorlage.
        mupibox: { host: 'MuPiBox', startVolume: '40', maxVolume: '100', audioDevice: 'default' },
        // WIE AUSGELIEFERT: keine Anmeldung. Genau deshalb ist die Herkunft
        // das Einzige, was zwischen einer fremden Seite und den Daten steht.
        interfacelogin: { state: false, password: '' },
        timeout: { idlePiShutdown: '0', idleDisplayOff: '10', pressDelay: '2' },
      },
      null,
      2,
    ),
  )
  mkdirSync(join(ordner, 'tls'), { recursive: true })

  /**
   * RING 6 BRAUCHT EIN SICHERUNGSWERKZEUG, DAS SICH BENIMMT WIE VERLANGT.
   *
   * Das echte `mupibox-sicherung.py` liegt auf der Box; hier wird nachgebaut,
   * WAS DER SERVER DAVON SIEHT: eine Zeile auf stdout. Der Modus steht in
   * einer Datei daneben, damit sich der Fall zwischen zwei Anfragen aendern
   * laesst, ohne den Server neu zu starten.
   */
  const staende = join(ordner, 'staende')
  mkdirSync(staende, { recursive: true })
  const skript = join(ordner, 'sicherung-nachbau.py')
  writeFileSync(join(ordner, 'modus.txt'), 'gut\n')
  writeFileSync(
    skript,
    [
      'import sys, os',
      "d = os.path.dirname(os.path.abspath(__file__))",
      "modus = open(os.path.join(d, 'modus.txt')).read().strip()",
      "if modus == 'muell':",
      "    sys.stdout.write('Traceback (most recent call last):\\n  File \"/usr/local/bin\", line 1\\nRuntimeError: kaputt\\n')",
      "elif modus == 'lang':",
      // 5 MB — mehr als der Deckel von 4 MB in pythonLaufen (`maxBuffer`).
      "    sys.stdout.write('x' * (5 * 1024 * 1024))",
      'else:',
      "    sys.stdout.write('[]')",
      'sys.exit(0)',
      '',
    ].join('\n'),
  )
  return { ordner, konfigDatei: join(konf, 'mupiboxconfig.json'), staende, skript, modusDatei: join(ordner, 'modus.txt') }
}

/**
 * Ein tar.gz mit einer einzigen Datei — ohne Fremdpaket.
 *
 * Genau so eng wie `tarEintragLesen` in sicherung.ts es liest: ein einfacher
 * Dateieintrag, ustar, Name unter 100 Zeichen. Mehr braucht ein Stand nicht,
 * dessen einzige Aufgabe es ist, `stand.json` zu tragen.
 */
function tarGz(name, inhalt) {
  const daten = Buffer.from(inhalt)
  const kopf = Buffer.alloc(512)
  kopf.write(name, 0, 100, 'utf8')
  kopf.write('0000644\0', 100, 8, 'ascii')
  kopf.write('0000000\0', 108, 8, 'ascii')
  kopf.write('0000000\0', 116, 8, 'ascii')
  kopf.write(`${daten.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii')
  kopf.write('00000000000\0', 136, 12, 'ascii')
  kopf.write('        ', 148, 8, 'ascii')
  kopf.write('0', 156, 1, 'ascii')
  kopf.write('ustar\0', 257, 6, 'ascii')
  kopf.write('00', 263, 2, 'ascii')
  let summe = 0
  for (const b of kopf) summe += b
  kopf.write(`${summe.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii')
  const fuell = Buffer.alloc((512 - (daten.length % 512)) % 512)
  return gzipSync(Buffer.concat([kopf, daten, fuell, Buffer.alloc(1024)]))
}

function buendeln(ordner) {
  const esbuild = [join(BACKEND, 'node_modules', '.bin', 'esbuild'), join(WURZEL, 'node_modules', '.bin', 'esbuild')].find(
    existsSync,
  )
  if (!esbuild) {
    console.error('esbuild nicht gefunden — npm install fehlt.')
    process.exit(2)
  }
  const ziel = join(ordner, 'server.js')
  const bau = spawnSync(
    esbuild,
    [join(BACKEND, 'src', 'server.ts'), '--bundle', '--platform=node', '--target=node26', `--outfile=${ziel}`],
    { encoding: 'utf8' },
  )
  if (bau.status !== 0) {
    console.error('Buendeln fehlgeschlagen:\n', bau.stderr)
    process.exit(2)
  }
  return ziel
}

async function serverStarten(platz, gebaut, port = PORT) {
  const umgebung = { ...process.env }
  // Auf der Box ist NODE_ENV NICHT gesetzt — der Server soll in genau dem
  // Zweig laufen, in dem er dort laeuft.
  delete umgebung.NODE_ENV
  delete umgebung.MUPIBOX_HERKUNFT_AUS
  delete umgebung.MUPIBOX_HERKUNFT_ZUSATZ
  Object.assign(umgebung, {
    MUPIBOX_HTTP_PORT: String(port),
    // EIGENER TLS-PORT, auch wenn hier nichts ueber TLS gemessen wird: der
    // Server bringt seine HTTPS-Seite ungefragt mit und faellt ohne Angabe auf
    // 8443 zurueck — den Port dieses RECHNERS. Siehe portSuchen.
    MUPIBOX_HTTPS_PORT: String(port + 2),
    MUPIBOX_TLS_DIR: join(platz.ordner, 'tls'),
    MUPIBOX_CONFIG: platz.konfigDatei,
    MUPIBOX_LOCK_DIR: platz.ordner,
    MUPIBOX_ADMIN_DIR: join(platz.ordner, 'www-admin'),
    // Ring 6: ein NACHGEBAUTES Sicherungswerkzeug und ein eigenes
    // Standeverzeichnis. Nichts davon zeigt auf die Box oder auf src/deploy.
    MUPIBOX_SICHERUNG_SKRIPT: platz.skript,
    MUPIBOX_SICHERUNG_STAENDE: platz.staende,
  })
  const kind = spawn(process.execPath, [gebaut], {
    cwd: platz.ordner,
    env: umgebung,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  kind.stdout.on('data', (d) => {
    log += d
  })
  kind.stderr.on('data', (d) => {
    log += d
  })
  let oben = false
  for (let i = 0; i < 200 && !oben; i++) {
    if (kind.exitCode !== null) throw new Error(`Server beendete sich mit ${kind.exitCode}:\n${log}`)
    try {
      const a = await anfrage({ weg: '/api/auth/state', port })
      oben = a.status === 200 && typeof JSON.parse(a.rumpf)?.anmeldungNoetig === 'boolean'
    } catch {
      /* noch nicht oben */
    }
    if (!oben) await new Promise((r) => setTimeout(r, 150))
  }
  if (!oben) {
    kind.kill('SIGKILL')
    throw new Error(`auf ${port} antwortet nicht dieses Backend:\n${log}`)
  }
  return { kind, log: () => log }
}

/* ══ 2. EINE ANFRAGE, BYTE FUER BYTE SELBST GESCHRIEBEN ═══════════════════ */

/**
 * @param zeile   die komplette Anfragezeile, z.B. `GET /api/x HTTP/1.1`
 * @param koepfe  Paare [name, wert] — DOPPELTE NAMEN SIND ERLAUBT, das ist
 *                der Punkt. `Host` wird NICHT automatisch ergaenzt; wer ihn
 *                weglaesst, misst genau diesen Fall.
 */
function rohAnfrage({ zeile, koepfe = [], rumpf = '', port = PORT }) {
  return new Promise((fertig, schief) => {
    const s = net.connect(port, '127.0.0.1')
    let text = ''
    const alle = [...koepfe]
    if (rumpf) alle.push(['Content-Length', String(Buffer.byteLength(rumpf))])
    alle.push(['Connection', 'close'])
    s.setTimeout(8000)
    s.on('connect', () => {
      s.write(`${zeile}\r\n${alle.map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n${rumpf}`)
    })
    s.on('data', (d) => {
      text += d
    })
    s.on('timeout', () => {
      s.destroy()
      schief(new Error('Zeit abgelaufen'))
    })
    s.on('error', schief)
    s.on('close', () => {
      const trenn = text.indexOf('\r\n\r\n')
      const kopfteil = trenn < 0 ? text : text.slice(0, trenn)
      const rest = trenn < 0 ? '' : text.slice(trenn + 4)
      const zeilen = kopfteil.split('\r\n')
      const status = Number(zeilen[0]?.split(' ')[1] ?? 0)
      const kopf = {}
      for (const z of zeilen.slice(1)) {
        const i = z.indexOf(':')
        if (i > 0) kopf[z.slice(0, i).trim().toLowerCase()] = z.slice(i + 1).trim()
      }
      fertig({ status, kopf, rumpf: entstueckeln(rest, kopf), roh: text })
    })
  })
}

/** `Transfer-Encoding: chunked` von Hand aufloesen — der Socket kennt es nicht. */
function entstueckeln(rest, kopf) {
  if ((kopf['transfer-encoding'] ?? '') !== 'chunked') return rest
  let p = 0
  let aus = ''
  while (p < rest.length) {
    const e = rest.indexOf('\r\n', p)
    if (e < 0) break
    const n = Number.parseInt(rest.slice(p, e).split(';')[0], 16)
    if (!Number.isFinite(n) || n === 0) break
    aus += rest.slice(e + 2, e + 2 + n)
    p = e + 2 + n + 2
  }
  return aus
}

/** Der bequeme Fall: Weg + Kopfzeilen, `Host` wird gesetzt. */
function anfrage({ weg, methode = 'GET', koepfe = [], rumpf = '', host, port = PORT }) {
  return rohAnfrage({
    zeile: `${methode} ${weg} HTTP/1.1`,
    koepfe: [['Host', host ?? `127.0.0.1:${port}`], ...koepfe],
    rumpf,
    port,
  })
}

/**
 * WER HAT ABGEWIESEN? Es gibt auf diesem Server ZWEI Riegel, und sie zu
 * verwechseln macht jede Aussage wertlos.
 *   'riegel'    — herkunft.ts, antwortet mit einem Feld `grund`.
 *   'sicherung' — der Riegel aus sicherung.ts. Er haengt in server.ts OHNE
 *                 Pfad und gilt deshalb fuer JEDE Anfrage; er weist alles mit
 *                 `Sec-Fetch-Site: cross-site` ab (Feld `fehler`, kein `grund`).
 *   ''          — niemand, die Antwort kommt vom Weg dahinter.
 */
const werWies = (a) => {
  if (a.status !== 403) return ''
  try {
    const k = JSON.parse(a.rumpf)
    if (typeof k?.grund === 'string') return 'riegel'
    if (typeof k?.fehler === 'string') return 'sicherung'
  } catch {
    /* kein JSON */
  }
  return ''
}

/** Kam die ECHTE Auskunft heraus? Nicht „Status 200", sondern der Inhalt. */
const echteAuskunft = (a) => {
  if (a.status !== 200) return false
  try {
    const k = JSON.parse(a.rumpf)
    return Array.isArray(k?.bereiche) || Array.isArray(k?.felder) || typeof k?.werte === 'object'
  } catch {
    return false
  }
}

const platz = arbeitsplatz()
const lautstaerke = () => {
  try {
    return String(JSON.parse(readFileSync(platz.konfigDatei, 'utf8'))?.mupibox?.startVolume ?? '')
  } catch {
    return '?'
  }
}

console.log('Buendeln …')
const gebaut = buendeln(platz.ordner)
console.log(`Server auf 127.0.0.1:${PORT} (Wegwerf-Verzeichnis ${platz.ordner})\n`)
const server = await serverStarten(platz, gebaut)

try {
  /* ══ RING 1: DIE HERKUNFT FAELSCHEN ════════════════════════════════════ */
  console.log('══ RING 1 — dieselbe Anfrage, nur die Herkunft gebogen ══════════════════\n')
  {
    const gruss = await anfrage({ weg: '/api/konfiguration' })
    pruefe(
      `Grundlage: OHNE Herkunft kommt die echte Auskunft heraus (Status ${gruss.status})`,
      echteAuskunft(gruss),
      'ohne diese Zeile misst alles darunter nichts',
    )
  }

  const EIGEN = `http://127.0.0.1:${PORT}`
  /**
   * `soll: 'ab'` heisst: MUSS am Herkunftsriegel enden. `durch` heisst: darf
   * nicht an ihm enden (sonst waere die eigene Oberflaeche gesperrt).
   */
  const HERKUENFTE = [
    { name: 'die eigene Herkunft', origin: EIGEN, soll: 'durch' },
    { name: 'die eigene Herkunft, GROSS geschrieben', origin: `HTTP://127.0.0.1:${PORT}`, soll: 'durch' },
    { name: 'die eigene Herkunft mit Schraegstrich am Ende', origin: `${EIGEN}/`, soll: 'durch' },
    { name: 'die eigene Herkunft mit Leerzeichen davor', origin: `  ${EIGEN}`, soll: 'durch' },
    {
      // KEIN LOCH, und der Grund gehoert dazu: `new URL` normiert den Punkt
      // hinter einer IPv4-ADRESSE weg (nachgemessen: '127.0.0.1.' → '127.0.0.1'),
      // und zwar auf BEIDEN Seiten des Vergleichs. Bei einem NAMEN bleibt er
      // stehen ('mupibox.local.' bleibt), dann aber ebenfalls auf beiden Seiten,
      // denn ein Browser schickt in `Host` und `Origin` denselben Text.
      name: 'PUNKT AM ENDE (127.0.0.1. ist dieselbe Adresse)',
      origin: `http://127.0.0.1.:${PORT}`,
      soll: 'durch',
    },
    { name: 'PRAEFIX der erlaubten Herkunft', origin: `http://evil-127.0.0.1:${PORT}`, soll: 'ab' },
    { name: 'die erlaubte Herkunft als Anfang eines fremden Namens', origin: `http://127.0.0.1.boese.example`, soll: 'ab' },
    { name: 'die erlaubte Herkunft als BENUTZERNAME davor', origin: `http://127.0.0.1:${PORT}@boese.example`, soll: 'ab' },
    { name: 'anderes Schema, gleicher Rechner und Port', origin: `https://127.0.0.1:${PORT}`, soll: 'durch' },
    { name: 'anderer Port', origin: 'http://127.0.0.1:1', soll: 'ab' },
    { name: 'gar kein Port (also 80)', origin: 'http://127.0.0.1', soll: 'ab' },
    { name: 'anderer Name derselben Maschine', origin: `http://localhost:${PORT}`, soll: 'ab' },
    { name: 'Origin: null', origin: 'null', soll: 'ab' },
    { name: 'Origin: NULL (gross)', origin: 'NULL', soll: 'ab' },
    { name: 'Origin: file://', origin: 'file://', soll: 'ab' },
    { name: 'Origin: leer', origin: '', soll: 'durch' },
    { name: 'Origin ist Muell', origin: 'schrott', soll: 'ab' },
    { name: 'Origin mit Zeilenumbruch darin (Kopfzeilen-Einschleusung)', origin: `${EIGEN}%0d%0aX-Rein: 1`, soll: 'ab' },
  ]
  console.log('\n  ── eine Kopfzeile Origin ──')
  for (const h of HERKUENFTE) {
    const a = await anfrage({ weg: '/api/konfiguration', koepfe: [['Origin', h.origin]] })
    const wer = werWies(a)
    const zeile = `${String(h.name).padEnd(56)} ${String(a.status).padEnd(3)} ${(wer || '—').padEnd(9)}`
    if (h.soll === 'ab') pruefe(zeile, wer === 'riegel' && !echteAuskunft(a))
    else pruefe(zeile, wer !== 'riegel')
  }

  console.log('\n  ── ZWEI Kopfzeilen Origin (was faltet node zusammen?) ──')
  for (const [a1, a2] of [
    ['https://boese.example', EIGEN],
    [EIGEN, 'https://boese.example'],
    [EIGEN, EIGEN],
  ]) {
    const a = await anfrage({
      weg: '/api/konfiguration',
      koepfe: [
        ['Origin', a1],
        ['Origin', a2],
      ],
    })
    const wer = werWies(a)
    const fremd = a1.includes('boese') || a2.includes('boese')
    pruefe(
      `Origin: ${a1}  +  Origin: ${a2}`.padEnd(56) + ` ${String(a.status).padEnd(3)} ${(wer || '—').padEnd(9)}`,
      fremd ? wer === 'riegel' && !echteAuskunft(a) : true,
      fremd ? '' : 'nur zur Anschauung',
    )
  }

  /* ── DIE HOST-KOPFZEILE — die andere Haelfte des Vergleichs ──────────── */
  console.log('\n  ── die andere Haelfte: HOST ──')
  {
    const faelle = [
      {
        name: 'Host UND Origin auf denselben fremden Namen',
        host: 'boese.example',
        koepfe: [['Origin', 'http://boese.example']],
      },
      { name: 'Host leer, Origin fremd', host: '', koepfe: [['Origin', 'https://boese.example']] },
      { name: 'Host mit Leerzeichen, Origin fremd', host: ' ', koepfe: [['Origin', 'https://boese.example']] },
      { name: 'Host ist Muell, Origin fremd', host: '§§§', koepfe: [['Origin', 'https://boese.example']] },
    ]
    for (const f of faelle) {
      const a = await anfrage({ weg: '/api/konfiguration', host: f.host, koepfe: f.koepfe })
      const wer = werWies(a)
      const durch = echteAuskunft(a)
      console.log(
        `  ····  ${f.name.padEnd(56)} ${String(a.status).padEnd(3)} ${(wer || '—').padEnd(9)} ${durch ? 'AUSKUNFT KAM HERAUS' : ''}`,
      )
      if (durch) befund(`RING 1: „${f.name}" kommt durch — der Riegel vergleicht Origin gegen Host DERSELBEN Anfrage.`)
    }
    // GANZ OHNE Host: HTTP/1.0, das darf das.
    const a = await rohAnfrage({
      zeile: 'GET /api/konfiguration HTTP/1.0',
      koepfe: [['Origin', 'https://boese.example']],
    })
    const durch = echteAuskunft(a)
    console.log(
      `  ····  ${'GAR KEIN Host (HTTP/1.0), Origin fremd'.padEnd(56)} ${String(a.status).padEnd(3)} ${(werWies(a) || '—').padEnd(9)} ${durch ? 'AUSKUNFT KAM HERAUS' : ''}`,
    )
    if (durch) befund('RING 1: ohne Host-Kopfzeile laesst der Riegel jede Herkunft durch (herkunft.ts, `if (!wir) return erlaubt`).')
  }

  /* ══ RING 2: WEGE VOR DEM RIEGEL ═══════════════════════════════════════ */
  console.log('\n══ RING 2 — derselbe Weg, anders geschrieben ════════════════════════════\n')
  console.log('  Der Riegel haengt an app.use("/api", …). Gesucht wird eine Schreibweise,')
  console.log('  die der Riegel NICHT als /api liest, der Weg dahinter aber schon.\n')
  {
    const SCHREIBWEISEN = [
      '/api/konfiguration',
      '//api/konfiguration',
      '///api/konfiguration',
      '/./api/konfiguration',
      '/api/./konfiguration',
      '/nichts/../api/konfiguration',
      '/API/konfiguration',
      '/Api/Konfiguration',
      '/%61pi/konfiguration',
      '/api%2fkonfiguration',
      '/%2fapi/konfiguration',
      '/api/konfiguration/',
      '/api/konfiguration/.',
      '/api/konfiguration?x=1',
      '/api/konfiguration;x=1',
      '/api/konfiguration#x',
      '/api//konfiguration',
      '/\\api/konfiguration',
      '/api/konfiguration%20',
      '/ api/konfiguration',
    ]
    for (const weg of SCHREIBWEISEN) {
      let a
      try {
        a = await anfrage({ weg, koepfe: [['Origin', 'https://boese.example']] })
      } catch (e) {
        console.log(`  ····  ${weg.padEnd(34)} — Verbindung: ${e.message}`)
        continue
      }
      const wer = werWies(a)
      const durch = echteAuskunft(a)
      pruefe(
        `${weg.padEnd(34)} ${String(a.status).padEnd(3)} ${(wer || '—').padEnd(9)}${durch ? '  AUSKUNFT KAM HERAUS' : ''}`,
        !durch,
        durch ? 'FREMDE HERKUNFT BEKAM DIE ECHTE AUSKUNFT' : '',
      )
    }
    // Die absolute Form der Anfragezeile — Node nimmt sie an, express zerlegt sie.
    const a = await rohAnfrage({
      zeile: `GET http://127.0.0.1:${PORT}/api/konfiguration HTTP/1.1`,
      koepfe: [
        ['Host', `127.0.0.1:${PORT}`],
        ['Origin', 'https://boese.example'],
      ],
    })
    pruefe(
      `${'absolute Form in der Anfragezeile'.padEnd(34)} ${String(a.status).padEnd(3)} ${(werWies(a) || '—').padEnd(9)}${echteAuskunft(a) ? '  AUSKUNFT KAM HERAUS' : ''}`,
      !echteAuskunft(a),
    )
    const b = await rohAnfrage({
      zeile: `GET http://boese.example/api/konfiguration HTTP/1.1`,
      koepfe: [
        ['Host', `127.0.0.1:${PORT}`],
        ['Origin', 'http://boese.example'],
      ],
    })
    pruefe(
      `${'absolute Form MIT fremdem Rechner'.padEnd(34)} ${String(b.status).padEnd(3)} ${(werWies(b) || '—').padEnd(9)}${echteAuskunft(b) ? '  AUSKUNFT KAM HERAUS' : ''}`,
      !echteAuskunft(b),
      'in der absoluten Form steht der Rechner in der ANFRAGEZEILE, nicht in Host',
    )
  }

  /* ══ RING 3: DER FORMULAR-POST, DER ETWAS SICHTBARES TUT ═══════════════ */
  console.log('\n══ RING 3 — schreiben ohne Vorabfrage ═══════════════════════════════════\n')
  console.log('  Ein <form> auf einer fremden Seite braucht KEINE Vorabfrage. Gemessen')
  console.log('  wird an der Lautstaerke beim Einschalten — in der DATEI, nicht in der')
  console.log('  Antwort.\n')
  {
    const SCHREIBFAELLE = [
      {
        name: 'JSON von der eigenen Herkunft (muss WIRKEN)',
        wert: 41,
        koepfe: [
          ['Content-Type', 'application/json'],
          ['Origin', EIGEN],
          ['Sec-Fetch-Site', 'same-origin'],
        ],
        soll: 'wirkt',
      },
      {
        name: 'Formular-POST, fremde Herkunft, urlencoded',
        wert: 51,
        alsFormular: true,
        koepfe: [
          ['Content-Type', 'application/x-www-form-urlencoded'],
          ['Origin', 'https://boese.example'],
          ['Sec-Fetch-Site', 'cross-site'],
          ['Sec-Fetch-Mode', 'navigate'],
          ['Sec-Fetch-Dest', 'document'],
        ],
        soll: 'nichts',
      },
      {
        name: 'Formular-POST, fremde Herkunft, text/plain',
        wert: 52,
        koepfe: [
          ['Content-Type', 'text/plain'],
          ['Origin', 'https://boese.example'],
          ['Sec-Fetch-Site', 'cross-site'],
        ],
        soll: 'nichts',
      },
      {
        name: 'Formular-POST, fremde Herkunft, multipart',
        wert: 53,
        koepfe: [
          ['Content-Type', 'multipart/form-data; boundary=x'],
          ['Origin', 'https://boese.example'],
        ],
        soll: 'nichts',
      },
      {
        name: 'Formular-POST OHNE Origin (alter Browser), cross-site',
        wert: 54,
        koepfe: [
          ['Content-Type', 'text/plain'],
          ['Sec-Fetch-Site', 'cross-site'],
        ],
        soll: 'nichts',
      },
      {
        name: 'Formular-POST OHNE Origin UND OHNE Sec-Fetch',
        wert: 55,
        koepfe: [['Content-Type', 'text/plain']],
        soll: 'wirkt-absichtlich',
      },
      {
        name: 'Formular-POST, Host+Origin beide auf boese.example',
        wert: 56,
        host: 'boese.example',
        koepfe: [
          ['Content-Type', 'text/plain'],
          ['Origin', 'http://boese.example'],
        ],
        soll: 'nichts',
      },
      {
        // DER FALL, DER DEN NAMENSTAUSCH (DNS-Rebinding) ZU ENDE DENKT.
        // Zeigt der Name der fremden Seite nach dem ersten Laden auf die Box,
        // ist die Anfrage fuer den Browser GLEICHHERKUENFTIG: er schickt
        // `Host: boese.example` UND `Origin: http://boese.example`, dazu
        // `Sec-Fetch-Site: same-origin`. Beide Riegel sehen dann nichts
        // Fremdes — und weil es fuer den Browser dieselbe Herkunft ist, darf
        // die Seite auch schreiben, mit `application/json` und allem.
        name: 'NAMENSTAUSCH: Host+Origin fremd, aber JSON (schreibt es?)',
        wert: 57,
        soll: 'namenstausch',
        host: 'boese.example',
        koepfe: [
          ['Content-Type', 'application/json'],
          ['Origin', 'http://boese.example'],
          ['Sec-Fetch-Site', 'same-origin'],
        ],
      },
    ]
    for (const f of SCHREIBFAELLE) {
      const vorher = lautstaerke()
      const nutzlast = JSON.stringify({ aenderungen: { startLautstaerke: f.wert } })
      // Ein echtes Formular schickt `feld=wert`; express.json liest das nicht.
      // Der interessante Fall ist trotzdem der mit JSON im Rumpf und einem
      // Formular-Content-Type — genau so schmuggelt eine fremde Seite JSON
      // an einer Vorabfrage vorbei, WENN der Server den Typ nicht prueft.
      const rumpf = f.alsFormular ? `${nutzlast}=` : nutzlast
      const a = await anfrage({
        weg: '/api/konfiguration',
        methode: 'POST',
        host: f.host,
        koepfe: f.koepfe,
        rumpf,
      })
      const nachher = lautstaerke()
      const geschrieben = nachher !== vorher
      const wer = werWies(a)
      const zeile = `${f.name.padEnd(52)} ${String(a.status).padEnd(3)} ${(wer || '—').padEnd(9)} Datei: ${vorher}→${nachher}`
      if (f.soll === 'namenstausch') {
        // KEINE ROTE ZEILE, und das ist eine Entscheidung: hier ist nichts
        // kaputtgegangen, hier ist eine GRENZE des Riegels sichtbar. Ein
        // Werkzeug, das jedes Mal rot laeuft, wird nach dreimal ueberblaettert
        // — und dann sieht auch niemand mehr die Zeilen, die wirklich rot sind.
        console.log(`  ····  ${zeile}`)
        if (geschrieben) {
          befund(
            'RING 3: NAMENSTAUSCH — zeigt der Name einer fremden Seite nach dem Laden auf die Box, ist die Anfrage fuer den Browser GLEICHHERKUENFTIG (Host und Origin tragen denselben fremden Namen). Der Riegel vergleicht Origin gegen Host DERSELBEN Anfrage und sieht deshalb nichts Fremdes: die Seite darf lesen UND schreiben. Dagegen hilft nur eine Aussage darueber, unter welchen Namen die Box antwortet — genau die Liste, die herkunft.ts bewusst nicht fuehrt (sie waere die naechste Sackgasse). Gehoert dem Betreiber vorgelegt, nicht im Vorbeigehen entschieden.',
          )
        } else {
          console.log('  ····  (es schreibt NICHT mehr — dann steht inzwischen ein Riegel auf der Host-Kopfzeile, und dieser Fall gehoert neu bewertet)')
        }
      } else if (f.soll === 'nichts') {
        pruefe(zeile, !geschrieben, geschrieben ? 'GESCHRIEBEN — eine fremde Seite hat die Box verstellt' : '')
      } else if (f.soll === 'wirkt') {
        pruefe(zeile, geschrieben, geschrieben ? '' : 'die eigene Oberflaeche kann nicht mehr schreiben')
      } else {
        console.log(`  ····  ${zeile}   (ohne Herkunft durchzulassen ist die Entscheidung, kein Versehen)`)
      }
    }
  }

  /* ══ RING 4: DAS GET MIT WIRKUNG HINTER DER AUSNAHME ═══════════════════ */
  console.log('\n══ RING 4 — die Ausnahme fuer die Navigation der obersten Ebene ═════════\n')
  console.log('  herkunft.ts laesst `Sec-Fetch-Mode: navigate` + `Dest: document` OHNE')
  console.log('  Origin durch — das ist ein Klick auf einen Link einer fremden Seite oder')
  console.log('  ein window.open. Unter /api liegt aber KEINE Seite, sondern lauter Wege,')
  console.log('  und einige sind GETs MIT WIRKUNG. Dort ist die Ausnahme deshalb AUS.\n')
  {
    const nav = [
      ['Sec-Fetch-Site', 'cross-site'],
      ['Sec-Fetch-Mode', 'navigate'],
      ['Sec-Fetch-Dest', 'document'],
    ]
    const WEGE_MIT_WIRKUNG = [
      { name: 'GET /api/vorlesen/sprich?text=… (die Box REDET)', weg: '/api/vorlesen/sprich?text=hallo' },
      { name: 'GET /api/netzwerk/scan (Funk-Suche)', weg: '/api/netzwerk/scan' },
      { name: 'GET /api/konfiguration (nur lesen)', weg: '/api/konfiguration' },
      { name: 'GET /api/sicherung (die ganze Lage)', weg: '/api/sicherung' },
    ]
    for (const w of WEGE_MIT_WIRKUNG) {
      const a = await anfrage({ weg: w.weg, koepfe: nav })
      const wer = werWies(a)
      let grund = ''
      try {
        grund = JSON.parse(a.rumpf)?.grund ?? ''
      } catch {
        /* kein JSON */
      }
      pruefe(
        `${w.name.padEnd(52)} ${String(a.status).padEnd(3)} ${(wer || '—').padEnd(9)} ${grund}`,
        a.status === 403,
        a.status === 403 ? '' : 'EINE FREMDE SEITE HAT DIESEN WEG AUSGELOEST',
      )
      if (a.status === 403 && wer === 'sicherung') {
        befund(
          `RING 4: „${w.name}" haelt heute nur der Riegel aus sicherung.ts. Haengt der an seinem Pfad, entscheidet allein herkunft.ts.`,
        )
      }
    }
    // Und die Gegenprobe: derselbe Weg als RAHMEN, das muss ab.
    const r = await anfrage({
      weg: '/api/vorlesen/sprich?text=hallo',
      koepfe: [
        ['Sec-Fetch-Site', 'cross-site'],
        ['Sec-Fetch-Mode', 'navigate'],
        ['Sec-Fetch-Dest', 'iframe'],
      ],
    })
    pruefe(`derselbe Weg in einem unsichtbaren RAHMEN  ${String(r.status).padEnd(3)} ${werWies(r) || '—'}`, r.status === 403)

    // DIE ANDERE SEITE DERSELBEN MUENZE: unter /player liegen SEITEN. Wer von
    // aussen dorthin verlinkt, muss sie sehen duerfen — sonst ist der Riegel
    // die naechste Sackgasse, und die meldet niemand.
    const p = await anfrage({ weg: '/player/', koepfe: [...nav, ['Accept', 'text/html']] })
    pruefe(
      `/player/ als Navigation von aussen bleibt offen (dort liegt eine Seite)  ${String(p.status).padEnd(3)} ${werWies(p) || '—'}`,
      werWies(p) !== 'riegel',
    )
    // Ein Befehl an den Abspieler ist keine Navigation und kommt nicht durch.
    const s2 = await anfrage({
      weg: '/player/api/play',
      koepfe: [
        ['Sec-Fetch-Site', 'cross-site'],
        ['Sec-Fetch-Mode', 'cors'],
        ['Sec-Fetch-Dest', 'empty'],
      ],
    })
    pruefe(
      `ein Befehl an /player von fremder Seite  ${String(s2.status).padEnd(3)} ${werWies(s2) || '—'}`,
      werWies(s2) === 'riegel',
    )
  }

  /* ══ RING 5: WAS AUSSERHALB VON /api LIEGT ════════════════════════════ */
  console.log('\n══ RING 5 — /api und /player sind nicht alles ═══════════════════════════\n')
  {
    for (const weg of ['/', '/spotify', '/admin/', '/neu/']) {
      const a = await anfrage({ weg, koepfe: [['Origin', 'https://boese.example']] })
      console.log(`  ····  ${weg.padEnd(20)} Origin fremd  ${String(a.status).padEnd(3)} ${werWies(a) || '—'}`)
    }
    const s = await anfrage({
      weg: '/spotify',
      koepfe: [
        ['Sec-Fetch-Site', 'cross-site'],
        ['Sec-Fetch-Mode', 'navigate'],
        ['Sec-Fetch-Dest', 'document'],
      ],
    })
    console.log(`  ····  ${'/spotify'.padEnd(20)} Rueckweg      ${String(s.status).padEnd(3)} ${werWies(s) || '—'}`)
    if (werWies(s) === 'sicherung') {
      befund(
        'RING 5: der Rueckweg von Spotify endet an dem Riegel aus sicherung.ts, der OHNE Pfad eingehaengt ist (server.ts, app.use(sicherungWegeBauen(…))).',
      )
    }
  }

  /* ══ RING 6: LAESST SICH DIE WARNUNG UNTERDRUECKEN? ═══════════════════ */
  console.log('\n══ RING 6 — der Kanal fuer „nicht eingeordnet" ══════════════════════════\n')
  console.log('  Die Warnung steht auf `GET /api/sicherung`. Sie kommt aus dem LETZTEN')
  console.log('  Stand auf der Platte, nicht aus dem Python. Was macht sie mit einem')
  console.log('  Python, das Muell redet — und was mit einem kaputten Stand?\n')
  {
    const standJson = (unbekannt) =>
      JSON.stringify({
        format: 1,
        erzeugt: '2026-08-07T10:00:00',
        grund: 'probe',
        host: 'MuPiBox',
        dateien: [],
        ausgelassen: [],
        verweise: {},
        unbekannt,
      })
    const standSchreiben = (name, inhalt) => writeFileSync(join(platz.staende, name), inhalt)
    const modus = (m) => writeFileSync(platz.modusDatei, `${m}\n`)
    const lage = async () => {
      const a = await anfrage({ weg: '/api/sicherung' })
      try {
        return { status: a.status, k: JSON.parse(a.rumpf) }
      } catch {
        return { status: a.status, k: null }
      }
    }

    standSchreiben(
      'mupibox-sicherung-20260807-100000.tar.gz',
      tarGz('stand.json', standJson([{ pfad: 'server/config/neuartige-ablage.json', bytes: 12, warum: 'unbekannt' }])),
    )
    modus('gut')
    let l = await lage()
    pruefe(
      `Grundlage: die Warnung steht in der Antwort  (${l.status})`,
      Boolean(l.k?.nichtEingeordnet?.pfade?.includes('server/config/neuartige-ablage.json')),
      'ohne diese Zeile misst der ganze Ring nichts',
    )

    modus('muell')
    l = await lage()
    pruefe(
      `das Python redet Muell statt JSON → die Liste faellt aus (lesbar=${l.k?.lesbar})`,
      l.k?.lesbar === false,
    )
    pruefe(
      '… und die WARNUNG steht trotzdem noch da (sie kommt aus der Datei, nicht aus stdout)',
      Boolean(l.k?.nichtEingeordnet?.pfade?.length),
    )

    modus('lang')
    l = await lage()
    pruefe(`5 MB auf stdout (Deckel: 4 MB) → der Server antwortet weiter (${l.status})`, l.status === 200)
    pruefe('… und die Warnung ueberlebt auch das', Boolean(l.k?.nichtEingeordnet?.pfade?.length))
    // Die Antwort darf die 5 MB nicht weiterreichen.
    pruefe(
      'die Ausgabe des Pythons landet NICHT in der Antwort',
      JSON.stringify(l.k ?? {}).length < 100_000,
      `Antwort ist ${JSON.stringify(l.k ?? {}).length} Zeichen`,
    )
    modus('gut')

    // ── UNTERDRUECKEN ──────────────────────────────────────────────────
    // `letzteNichtEingeordnet` sieht NUR in den neuesten Stand. Alles, was
    // diesen einen unlesbar macht, loescht die Warnung — ohne ein Wort.
    standSchreiben('mupibox-sicherung-20260807-110000.tar.gz', Buffer.from('das ist kein gzip'))
    l = await lage()
    const weg = !l.k?.nichtEingeordnet
    console.log(
      `  ····  ein KAPUTTER neuerer Stand liegt daneben → Warnung ${weg ? 'WEG' : 'noch da'} (Antwort ${l.status})`,
    )
    if (weg) {
      befund(
        'RING 6: eine unlesbare neueste Standdatei loescht die Warnung STILL (sicherung.ts, letzteNichtEingeordnet: try/catch → null). Kein Wort darueber in der Antwort.',
      )
    }
    unlinkSync(join(platz.staende, 'mupibox-sicherung-20260807-110000.tar.gz'))

    // Ein neuerer Stand OHNE `unbekannt` — das ist der gewollte Fall („behoben").
    standSchreiben('mupibox-sicherung-20260807-120000.tar.gz', tarGz('stand.json', standJson([])))
    l = await lage()
    pruefe(
      'ein neuerer Stand OHNE Fund laesst die Warnung verschwinden (so gewollt)',
      !l.k?.nichtEingeordnet,
    )
    unlinkSync(join(platz.staende, 'mupibox-sicherung-20260807-120000.tar.gz'))

    // ── FAELSCHEN ──────────────────────────────────────────────────────
    // Was in `unbekannt` steht, bestimmt die DATEI. Ein Stand, der 400
    // Ablagen behauptet, macht daraus 400 Zeilen auf dem Bildschirm.
    standSchreiben(
      'mupibox-sicherung-20260807-130000.tar.gz',
      tarGz(
        'stand.json',
        standJson(Array.from({ length: 400 }, (_, i) => ({ pfad: `erfunden/${i}/${'a'.repeat(200)}`, bytes: 1, warum: 'x' }))),
      ),
    )
    l = await lage()
    const anzahl = l.k?.nichtEingeordnet?.pfade?.length ?? 0
    console.log(`  ····  ein Stand behauptet 400 Ablagen → die Antwort traegt ${anzahl} Pfade, ${JSON.stringify(l.k?.nichtEingeordnet ?? {}).length} Zeichen`)
    if (anzahl >= 400) {
      befund(
        'RING 6: die Zahl der gemeldeten Pfade ist ungedeckelt — wer eine Standdatei ablegen kann, bestimmt, wie lang die Seite wird (sicherung.ts, nichtEingeordnetDeuten).',
      )
    }
    unlinkSync(join(platz.staende, 'mupibox-sicherung-20260807-130000.tar.gz'))
  }

  /* ══ RING 4b: DIE GEGENPROBE ZUR AUSNAHME ════════════════════════════ */
  console.log('\n══ RING 4b — die Gegenprobe: dieselbe Messung mit der Ausnahme AN ═══════\n')
  console.log('  Ring 4 zeigt geschlossene Wege. Das ist nur dann eine Aussage, wenn')
  console.log('  dieselbe Messung mit der alten Regel ROT wird. Dafuer wird eine KOPIE')
  console.log('  des Buendels geflickt (`seitenwechselErlaubt: false` → `true`) und ein')
  console.log('  zweiter Server damit gestartet — die Quelle wird nie angefasst.\n')
  {
    const roh = readFileSync(gebaut, 'utf8')
    const suche = 'seitenwechselErlaubt: false'
    const treffer = roh.split(suche).length - 1
    if (treffer !== 1) {
      pruefe(`der Flicken findet seine Stelle genau einmal (gefunden: ${treffer})`, false, 'Ring 4b faellt aus')
    } else {
      const geflickt = join(platz.ordner, 'server-geflickt.js')
      writeFileSync(geflickt, roh.replace(suche, 'seitenwechselErlaubt: true'))
      const zwei = await serverStarten(platz, geflickt, PORT_GEFLICKT)
      try {
        let durchgekommen = 0
        for (const w of [
          { name: 'GET /api/vorlesen/sprich?text=… (die Box REDET)', weg: '/api/vorlesen/sprich?text=hallo' },
          { name: 'GET /api/netzwerk/scan (Funk-Suche)', weg: '/api/netzwerk/scan' },
          { name: 'GET /api/konfiguration', weg: '/api/konfiguration' },
        ]) {
          const a = await anfrage({
            weg: w.weg,
            port: PORT_GEFLICKT,
            koepfe: [
              ['Sec-Fetch-Site', 'cross-site'],
              ['Sec-Fetch-Mode', 'navigate'],
              ['Sec-Fetch-Dest', 'document'],
            ],
          })
          const wer = werWies(a)
          if (wer !== 'riegel') durchgekommen++
          console.log(`  ····  mit alter Regel: ${w.name.padEnd(52)} ${String(a.status).padEnd(3)} ${(wer || '—').padEnd(9)}`)
        }
        pruefe(
          `GEGENPROBE: mit der alten Regel kommen ${durchgekommen} von 3 Wegen durch`,
          durchgekommen === 3,
          durchgekommen === 3 ? 'die Luecke war echt, und Ring 4 misst sie' : 'dann misst Ring 4 etwas anderes als geglaubt',
        )
        // Und was der Flicken NICHT anfasst: mit Origin ist weiter Schluss.
        const g = await anfrage({
          weg: '/api/konfiguration',
          port: PORT_GEFLICKT,
          koepfe: [['Origin', 'https://boese.example']],
        })
        pruefe(`im geflickten Server haelt der Rest des Riegels weiter (${g.status} ${werWies(g)})`, werWies(g) === 'riegel')
      } finally {
        zwei.kind.kill('SIGTERM')
        await new Promise((r) => setTimeout(r, 250))
        zwei.kind.kill('SIGKILL')
      }
    }
  }
} finally {
  server.kind.kill('SIGTERM')
  await new Promise((r) => setTimeout(r, 300))
  server.kind.kill('SIGKILL')
  if (!BEHALTEN) rmSync(platz.ordner, { recursive: true, force: true })
  else console.log(`\n(Wegwerf-Verzeichnis behalten: ${platz.ordner})`)
}

console.log(`\n${fehler === 0 ? 'Alle Zeilen halten.' : `${fehler} Zeile(n) ROT.`}`)
if (offen) console.log(`${offen} Befund(e) zum Weiterreichen (siehe !!).`)
process.exit(fehler === 0 ? 0 : 1)
