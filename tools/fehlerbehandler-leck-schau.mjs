#!/usr/bin/env node
/**
 * LECKT DER FEHLERBEHANDLER NOCH? — die boesartige Gegenprobe.
 *
 * `tools/fehlerbehandler-probe.mjs` hat den Riegel gebaut und drei Wege mit
 * kaputtem JSON beschossen. Dieses Werkzeug fragt die naechste Stufe:
 *
 *   1. NICHT NUR kaputtes JSON — falscher Content-Type, zu grosser Rumpf,
 *      abgebrochener Rumpf, gzip-Muell, unbekannter Zeichensatz, kaputte
 *      Prozentzeichen im Weg, ein Weg, den es nicht gibt.
 *   2. NICHT NUR drei Wege — ALLE 163 Wege aus server.ts, jeder mit kaputtem
 *      Rumpf. Der Rumpf scheitert in `express.json()`, also laeuft KEIN
 *      Handler an: das ist der einzige Beschuss, der auf einem Entwickler-
 *      rechner gefahrlos ist (`/api/shutdown` bleibt ein Weg wie jeder andere).
 *   3. DIE REIHENFOLGE — ein Weg, der NACH dem Fehlerbehandler angemeldet
 *      wird, wird eingebaut und beschossen. Gemessen, nicht behauptet.
 *   4. `headersSent` — ein Weg, der erst schreibt und dann wirft.
 *   5. `err.message` mit einem Dateipfad darin, ueber `next(err)` und mit
 *      `expose: true`. Genau der Fall, den ein http-errors-Paket erzeugt.
 *   6. DER PREIS: geht dem Protokoll etwas verloren? Fuer jeden Fall wird
 *      geprueft, ob Methode, Weg und Stapelabzug in der Ausgabe des Servers
 *      stehen — sonst waere der Fehler nur verschwunden statt versteckt.
 *
 * Gemessen an einem ECHTEN Serverprozess, NODE_ENV GELOESCHT, gebuendelt wie
 * auf der Box (esbuild/CJS — unter tsx stirbt der Produktivzweig an
 * `__dirname`).
 *
 *   node tools/fehlerbehandler-leck-schau.mjs [--port 9973] [--mit-sweep]
 *
 * NUR AUF DIESEM RECHNER. Die Box wird nicht angefasst: eigener Prozess,
 * eigenes Arbeitsverzeichnis, eigener Port, MUPIBOX_CONFIG zeigt in den
 * Wegwerfordner.
 *
 * Rueckgabewert: 0 = kein Leck gefunden, sonst die Zahl der Fehlschlaege.
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import net from 'node:net'

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BACKEND = join(WURZEL, 'src', 'backend-api')
const QUELLE = join(BACKEND, 'src', 'server.ts')

const arg = (name, vorgabe) => {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : vorgabe
}
const PORT = Number(arg('--port', '9973'))
const MIT_SWEEP = process.argv.includes('--mit-sweep') || !process.argv.includes('--ohne-sweep')

let fehler = 0
const offen = []
const aufraeumen = []
const pruefe = (satz, ok, dazu = '') => {
  console.log(`  ${ok ? 'ok  ' : 'LECK'} ${satz}${dazu ? ` — ${dazu}` : ''}`)
  if (!ok) fehler++
}
const notiz = (satz) => {
  console.log(`  ??   ${satz}`)
  offen.push(satz)
}

// ── WAS ALS LECK GILT ────────────────────────────────────────────────────────
// Ein Dateipfad, ein Modulname, eine Zeilennummer, das Wort node_modules.
// Bewusst breit: lieber ein Fehlalarm, den man wegerklaert, als ein Pfad, den
// niemand gesucht hat.
const VERRAETERISCH = [
  [/\bat\s+\S*\s*\(?\/[^\s)]+:\d+:\d+/, 'eine Stapelabzugszeile mit Pfad und Zeilennummer'],
  [/node_modules/, 'das Wort node_modules'],
  [/(^|[\s"'(:=])\/(home|usr|opt|etc|var|tmp|root|proc|sys)\//, 'ein absoluter Pfad aus dem Dateisystem'],
  [/\.(ts|js|mjs|cjs):\d+/, 'eine Datei mit Zeilennummer'],
  [/<pre>|<html|<!DOCTYPE html/i, 'HTML statt JSON'],
  [/\b(ENOENT|EACCES|EPERM|EISDIR|ENOTDIR|EEXIST)\b/, 'ein roher Systemfehlercode'],
  [/\b(SyntaxError|TypeError|ReferenceError|RangeError|AssertionError)\b/, 'der Name einer JS-Fehlerklasse'],
  [/\bexpress\b|\bbody-parser\b|\bzlib\b|raw-body/, 'der Name eines Moduls'],
]

/** Gibt die Liste der Treffer zurueck (leer = sauber). */
const lecks = (text) => VERRAETERISCH.filter(([m]) => m.test(String(text ?? ''))).map(([, w]) => w)

const zeigLeck = (satz, text) => {
  const t = lecks(text)
  pruefe(satz, t.length === 0, t.length ? `${t.join(' + ')} :: ${String(text).slice(0, 200).replace(/\n/g, ' ')}` : '')
  return t.length === 0
}

// ── DER ARBEITSPLATZ ─────────────────────────────────────────────────────────
function arbeitsplatz() {
  const ordner = mkdtempSync(join(tmpdir(), 'mupi-leck-'))
  const konf = join(ordner, 'server', 'config')
  mkdirSync(konf, { recursive: true })
  const mit = join(WURZEL, 'config')
  if (existsSync(mit)) {
    for (const d of ['active_data.json', 'network_config.json', 'monitor.json', 'albumstop.json']) {
      if (existsSync(join(mit, d))) cpSync(join(mit, d), join(konf, d))
    }
  }
  writeFileSync(
    join(konf, 'mupiboxconfig.json'),
    JSON.stringify({
      mupibox: { host: 'MuPiBox', startVolume: '40', maxVolume: '100' },
      interfacelogin: { state: false, password: '' },
      timeout: { idlePiShutdown: '0', idleDisplayOff: '10', pressDelay: '2' },
    }),
  )
  // WIE AUF DER BOX: die gebaute Oberflaeche liegt da. Ohne sie faellt der
  // Rueckfall in einen Fehler, und die Probe misst dann etwas, das es auf der
  // Box nicht gibt (dort liefert der Rueckfall die Seite aus).
  const www = join(ordner, 'www')
  mkdirSync(www, { recursive: true })
  writeFileSync(join(www, 'index.html'), '<!DOCTYPE html><title>MuPiBox</title><p>Oberflaeche</p>')
  return ordner
}

/**
 * DER GEBUENDELTE SERVER — mit vier eingesetzten Proben-Wegen.
 *
 * Die vier Wege gibt es NUR in dieser Kopie. Sie aendern an den echten Wegen
 * nichts; sie sind Ausloeser fuer Faelle, die sich von aussen sonst nicht
 * herstellen lassen (ein Weg MUSS werfen, damit man sehen kann, was dabei
 * herauskommt). Drei stehen VOR dem Fehlerbehandler, einer bewusst DAHINTER —
 * das ist die Messung zur Reihenfolge.
 */
function bauen(ordner) {
  const quelle = readFileSync(QUELLE, 'utf8')
  // WO DIE PROBEN-WEGE HIN MUESSEN — und warum NICHT direkt vor den
  // Fehlerbehandler: dazwischen steht der Rueckfall `app.get(/.*/)` auf
  // index.html. Der frisst JEDE GET-Anfrage, die bis dorthin kommt. Beim
  // ersten Lauf standen die Proben-Wege dahinter und lieferten alle vier
  // 200 text/html — gemessen, nicht vermutet. Sie gehoeren also VOR den
  // Rueckfall, dorthin, wo auch die echten Wege stehen.
  // Seit E118/1d heisst der Rueckfall anders (Redirect auf /neu/ statt
  // Angular-index) — die Marke ist sein neuer Kommentar-Anfang.
  const marke = '// Catch-all: alles Unbekannte zur EINEN Oberflaeche'
  if (!quelle.includes(marke)) throw new Error('Der Catch-all-Rueckfall steht nicht mehr in server.ts')

  const davor = `
// ── NUR IN DER PROBE (tools/fehlerbehandler-leck-schau.mjs) ──────────────────
app.get('/__probe/wirft-sofort', (_req, _res) => {
  throw new Error('geplatzt beim Lesen von /etc/mupibox/geheim.conf')
})
app.get('/__probe/wirft-spaeter', async (_req, _res) => {
  await new Promise((f) => setTimeout(f, 5))
  throw new Error('geplatzt spaeter in /home/achim/geheim/pfad.ts:42')
})
app.get('/__probe/next-mit-pfad', (_req, _res, next) => {
  const e = new Error('ENOENT: no such file or directory, open \\'/etc/mupibox/mupiboxconfig.json\\'')
  ;(e as unknown as { status?: number; expose?: boolean }).status = 400
  ;(e as unknown as { status?: number; expose?: boolean }).expose = true
  next(e)
})
app.get('/__probe/halbe-antwort', (_req, res) => {
  res.status(200).type('application/json')
  res.write('{"teil":1')
  throw new Error('geplatzt NACH den Kopfzeilen, /home/achim/geheim/halb.ts:7')
})
`
  const dahinter = `
// ── NUR IN DER PROBE: ein Weg HINTER dem Fehlerbehandler ────────────────────
// EINMAL GET, EINMAL POST — und das ist kein Zierrat: der Rueckfall auf
// index.html ist ein \`app.get\`, er frisst also nur GET. Ein spaet
// angemeldeter GET wird deshalb gar nicht erst erreicht (gemessen: 200 mit der
// Oberflaeche). Erst der POST kommt wirklich bis zu dem Weg durch und wirft —
// und zeigt, was ohne den eigenen Behandler ueber die Leitung geht.
app.get('/__probe/zu-spaet-angemeldet', (_req, _res) => {
  throw new Error('zu spaet angemeldet, /home/achim/geheim/zuspaet.ts:1')
})
app.post('/__probe/zu-spaet-angemeldet', (_req, _res) => {
  throw new Error('zu spaet angemeldet, /home/achim/geheim/zuspaet.ts:9')
})
`
  let neu = quelle.replace(marke, `${davor}\n${marke}`)
  // Hinter den Fehlerbehandler-Block: die schliessende Zeile des app.use(...)
  const ende = neu.indexOf('res.status(status).json({ ok: false, error: fehlerSatz(err, status) })')
  if (ende < 0) throw new Error('Der Rumpf des Fehlerbehandlers sieht anders aus als erwartet')
  const nachBlock = neu.indexOf('\n})', ende) + 3
  neu = `${neu.slice(0, nachBlock)}\n${dahinter}${neu.slice(nachBlock)}`

  // DIE KOPIE MUSS NEBEN server.ts LIEGEN. Die Datei hat ein Dutzend relative
  // Nachbarn (`./lane-weiter.js`, `./playlist-alben.js`, …) — aus einem
  // Wegwerfordner findet esbuild keinen davon. Der Name faengt mit einem Punkt
  // an, damit kein `src/*.ts` und kein `src/*.spec.ts` ihn je einsammelt, und
  // er wird im `finally` wieder entfernt.
  // Der Name traegt die Prozessnummer: zwei Laeufe nebeneinander duerfen sich
  // nicht dieselbe Datei ueberschreiben.
  const kopie = join(BACKEND, 'src', `.server-leck-probe.${process.pid}.ts`)
  writeFileSync(kopie, neu)
  aufraeumen.push(kopie)

  const ESBUILD = [
    join(BACKEND, 'node_modules', '.bin', 'esbuild'),
    join(WURZEL, 'node_modules', '.bin', 'esbuild'),
  ].find((p) => existsSync(p))
  if (!ESBUILD) throw new Error('esbuild nicht gefunden — npm install fehlt.')

  const gebaut = join(ordner, 'server.js')
  const bau = spawnSync(
    ESBUILD,
    [kopie, '--bundle', '--platform=node', '--target=node26', `--outfile=${gebaut}`, '--loader:.ts=ts'],
    { encoding: 'utf8', cwd: BACKEND },
  )
  if (bau.status !== 0) throw new Error(`Buendeln fehlgeschlagen:\n${bau.stderr}`)
  return gebaut
}

async function warteAufServer(basis, kind) {
  for (let i = 0; i < 300; i++) {
    if (kind.exitCode !== null) throw new Error(`Server beendete sich mit ${kind.exitCode}`)
    try {
      const r = await fetch(`${basis}/api/auth/state`, { signal: AbortSignal.timeout(500) })
      if (r.ok) return
    } catch {
      /* noch nicht oben */
    }
    await new Promise((f) => setTimeout(f, 150))
  }
  throw new Error('Server kam nicht hoch')
}

/** Eine Anfrage, roh ueber den Socket — fuer alles, was fetch nicht schicken darf. */
function rohAnfrage(zeilen, rumpf, { abbrechenNach = null, wartenMs = 1200 } = {}) {
  return new Promise((fertig) => {
    const s = net.connect(PORT, '127.0.0.1')
    let antwort = ''
    let zu = false
    const schluss = () => {
      if (zu) return
      zu = true
      try {
        s.destroy()
      } catch {
        /* egal */
      }
      fertig(antwort)
    }
    s.on('data', (d) => {
      antwort += String(d)
    })
    s.on('error', () => schluss())
    s.on('close', () => schluss())
    s.on('connect', () => {
      s.write(zeilen.join('\r\n') + '\r\n\r\n')
      if (rumpf != null) {
        if (abbrechenNach != null) {
          s.write(rumpf.slice(0, abbrechenNach))
          setTimeout(() => {
            try {
              s.destroy()
            } catch {
              /* egal */
            }
          }, 80)
        } else {
          s.write(rumpf)
        }
      }
      setTimeout(schluss, wartenMs)
    })
  })
}

/** Alle Wege aus server.ts — Methode und Weg, Parameter durch etwas Boesartiges ersetzt. */
function wegeAusQuelle() {
  const quelle = readFileSync(QUELLE, 'utf8')
  const treffer = [...quelle.matchAll(/^app\.(get|post|put|delete|patch)\(\s*'([^']+)'/gm)]
  const gesehen = new Set()
  const wege = []
  for (const t of treffer) {
    const methode = t[1].toUpperCase()
    // Parameter durch etwas ersetzen, das jemand wirklich schicken wuerde.
    const weg = t[2].replace(/:[A-Za-z0-9_]+/g, '..%2f..%2fetc%2fpasswd')
    const schluessel = `${methode} ${weg}`
    if (gesehen.has(schluessel)) continue
    gesehen.add(schluessel)
    wege.push({ methode, weg })
  }
  return wege
}

async function hole(basis, weg, opts = {}) {
  const r = await fetch(`${basis}${weg}`, { signal: AbortSignal.timeout(6000), ...opts })
  return {
    status: r.status,
    typ: r.headers.get('content-type') || '',
    kopf: { location: r.headers.get('location') || '' },
    text: await r.text(),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
/** Kurz warten, bevor das Protokoll gelesen wird: stdout kommt asynchron an. */
const setzen = () => new Promise((f) => setTimeout(f, 250))

async function proben(basis, protokollLesen) {
  // ── 1. DIE VIER EINGESETZTEN WEGE ────────────────────────────────────────
  console.log('\n── ein Weg, der wirft (synchron) ──')
  {
    const a = await hole(basis, '/__probe/wirft-sofort')
    console.log(`  GET /__probe/wirft-sofort -> ${a.status} ${a.typ.split(';')[0]} :: ${a.text.slice(0, 160)}`)
    pruefe('antwortet mit 500', a.status === 500, `war ${a.status}`)
    zeigLeck('die Antwort verraet nichts', a.text)
    await setzen()
    const log = protokollLesen()
    pruefe('das Protokoll nennt Methode und Weg', /GET \/__probe\/wirft-sofort/.test(log))
    pruefe('das Protokoll hat den Stapelabzug', /wirft-sofort[\s\S]{0,4000}?\n\s+at /.test(log))
  }

  console.log('\n── ein Weg, der spaeter wirft (async, Express 5) ──')
  {
    const a = await hole(basis, '/__probe/wirft-spaeter')
    console.log(`  GET /__probe/wirft-spaeter -> ${a.status} ${a.typ.split(';')[0]} :: ${a.text.slice(0, 160)}`)
    pruefe('ein abgelehntes Versprechen landet im Behandler (nicht im Nirgendwo)', a.status === 500, `war ${a.status}`)
    zeigLeck('die Antwort verraet nichts', a.text)
    await setzen()
    pruefe('das Protokoll nennt den Weg', /GET \/__probe\/wirft-spaeter/.test(protokollLesen()))
  }

  console.log('\n── next(err) mit expose:true und einem Pfad in der Meldung ──')
  {
    const a = await hole(basis, '/__probe/next-mit-pfad')
    console.log(`  GET /__probe/next-mit-pfad -> ${a.status} ${a.typ.split(';')[0]} :: ${a.text.slice(0, 200)}`)
    pruefe('behaelt den mitgebrachten Status 400', a.status === 400, `war ${a.status}`)
    zeigLeck('expose:true reicht die Meldung TROTZDEM nicht durch', a.text)
    await setzen()
    pruefe('aber das Protokoll hat sie', /geheim|ENOENT|mupiboxconfig/.test(protokollLesen()))
  }

  console.log('\n── ein Weg, der NACH den Kopfzeilen wirft (headersSent) ──')
  {
    // ROH UEBER DEN SOCKET, nicht mit fetch. Express bricht die Verbindung an
    // dieser Stelle ab; fetch wirft dann seinerseits einen TypeError, und man
    // wuerde die eigene Fehlermeldung pruefen statt der Bytes auf der Leitung.
    const roh = await rohAnfrage(
      ['GET /__probe/halbe-antwort HTTP/1.1', `Host: 127.0.0.1:${PORT}`, 'Connection: close'],
      null,
    )
    console.log(`  GET /__probe/halbe-antwort (roh) -> ${JSON.stringify(roh.slice(0, 300))}`)
    zeigLeck('was schon draussen war, wird nicht mit einem Stapelabzug ergaenzt', roh)
    pruefe('der angefangene Rumpf bleibt angefangen (keine zweite Antwort angehaengt)', !/"ok":false/.test(roh))
    await setzen()
    pruefe('das Protokoll hat den Fall trotzdem', /halbe-antwort/.test(protokollLesen()))
    pruefe('und der Stapelabzug dazu', /halbe-antwort[\s\S]{0,4000}?\n\s+at /.test(protokollLesen()))
  }

  console.log('\n── DIE REIHENFOLGE: ein Weg, der HINTER dem Behandler angemeldet wurde ──')
  {
    const g = await hole(basis, '/__probe/zu-spaet-angemeldet', { redirect: 'manual' })
    // Seit E118/1d ist der Rueckfall ein REDIRECT auf /neu/ (vorher: die
    // Angular-index mit <title>MuPiBox</title>). Verdeckt heisst jetzt:
    // 3xx mit Ziel /neu/ — der Probe-Wurf laeuft dann gar nicht erst an.
    const maskiert = g.status >= 300 && g.status < 400 && String(g.kopf?.location || '').startsWith('/neu/')
    console.log(`  GET  -> ${g.status} ${g.typ.split(';')[0]}${maskiert ? '  (der Rueckfall /neu/ war vorher dran)' : ''}`)
    pruefe('ein spaet angemeldeter GET wird vom Rueckfall verdeckt — er laeuft gar nicht an', maskiert, g.text.slice(0, 120))

    const a = await hole(basis, '/__probe/zu-spaet-angemeldet', { method: 'POST' })
    console.log(`  POST -> ${a.status} ${a.typ.split(';')[0]}`)
    console.log(`     ${a.text.slice(0, 300).replace(/\n/g, ' ')}`)
    // Der eigene Behandler kann ihn NICHT fangen — das ist Express, nicht ein
    // Fehler. Die Frage ist, ob Riegel 1 (app.set('env')) dann traegt. Die
    // Antwort kommt vom Vorgabebehandler und ist HTML — das ist erwartet und
    // wird deshalb nicht als Leck gezaehlt; gezaehlt wird, was DARIN steht.
    const gefangen = /"ok":false/.test(a.text)
    console.log(`     vom eigenen Behandler gefangen: ${gefangen ? 'ja' : 'NEIN (Express: nur was VOR ihm steht)'}`)
    pruefe('bestaetigt: der eigene Behandler sieht ihn nicht', !gefangen)
    const ohneHtml = VERRAETERISCH.filter(([, w]) => w !== 'HTML statt JSON')
    const t = ohneHtml.filter(([m]) => m.test(a.text)).map(([, w]) => w)
    pruefe(
      'RIEGEL 1 HAELT, was Riegel 2 nicht mehr sieht: kein Pfad, kein Modul, keine Zeilennummer',
      t.length === 0,
      t.join(' + ') || '',
    )
  }

  // ── 2. DIE TRANSPORTFAELLE ───────────────────────────────────────────────
  console.log('\n── kaputter Rumpf, falscher Typ, zu gross, Muell ──')
  const faelle = [
    ['kaputtes JSON', { headers: { 'Content-Type': 'application/json' }, body: '{kaputt' }],
    ['leerer Rumpf mit JSON-Typ', { headers: { 'Content-Type': 'application/json' }, body: '' }],
    ['JSON-Typ, aber Text drin', { headers: { 'Content-Type': 'application/json' }, body: 'einfach nur text' }],
    ['text/plain statt JSON', { headers: { 'Content-Type': 'text/plain' }, body: '{kaputt' }],
    ['gar kein Content-Type', { headers: {}, body: '{kaputt' }],
    ['unbekannter Zeichensatz', { headers: { 'Content-Type': 'application/json; charset=utf-99' }, body: '{}' }],
    [
      'gzip angekuendigt, Muell geschickt',
      { headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }, body: 'kein gzip, nur text' },
    ],
    [
      'unbekannte Kodierung',
      { headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'quatsch' }, body: '{}' },
    ],
    [
      'zu grosser Rumpf (2 MB)',
      { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ f: 'x'.repeat(2_000_000) }) },
    ],
    [
      'tief verschachteltes JSON',
      { headers: { 'Content-Type': 'application/json' }, body: `${'['.repeat(600)}1${']'.repeat(600)}` },
    ],
    [
      'urlencoded mit __proto__',
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: '__proto__[verseucht]=ja&constructor[prototype][x]=1',
      },
    ],
  ]
  for (const [name, opt] of faelle) {
    let a
    try {
      a = await hole(basis, '/api/schirm/helligkeit', { method: 'PUT', ...opt })
    } catch (e) {
      notiz(`${name}: die Verbindung brach ab (${e instanceof Error ? e.message : e}) — nicht gemessen`)
      continue
    }
    console.log(`  ${name.padEnd(34)} -> ${a.status} ${a.typ.split(';')[0].padEnd(18)} ${a.text.slice(0, 90)}`)
    zeigLeck(`${name}: verraet nichts`, a.text)
  }

  // ── 3. WEGE, DIE ES NICHT GIBT, UND KAPUTTE WEGE ─────────────────────────
  console.log('\n── kaputte und nicht vorhandene Wege ──')
  const wege = [
    '/gibtesnicht',
    '/api/gibtesnicht',
    '/api/%',
    '/api/%zz',
    '/api/spotify/album/%E0%A4%A',
    '/../../../etc/passwd',
    '/admin/../../../../etc/passwd',
    '/admin/%2e%2e%2f%2e%2e%2fetc%2fpasswd',
    `/api/${'a'.repeat(6000)}`,
    '/api/schirm/helligkeit/../../../etc/shadow',
  ]
  for (const w of wege) {
    let a
    try {
      a = await hole(basis, w)
    } catch (e) {
      notiz(`GET ${w}: Verbindung brach ab (${e instanceof Error ? e.message : e}) — nicht gemessen`)
      continue
    }
    console.log(`  GET ${w.slice(0, 46).padEnd(48)} -> ${a.status} ${a.typ.split(';')[0]}`)
    // Der Rueckfall auf index.html ist HTML und soll HTML sein — der wird nicht
    // als Leck gezaehlt, aber sein Inhalt schon.
    const istOberflaeche = /<title>MuPiBox<\/title>/.test(a.text)
    if (istOberflaeche) {
      pruefe(`GET ${w}: liefert die Oberflaeche (kein Fehlerweg)`, true)
      continue
    }
    zeigLeck(`GET ${w}: verraet nichts`, a.text)
  }

  // ── 4. ABGEBROCHENER RUMPF UND ROHE UNSINNSANFRAGEN ──────────────────────
  console.log('\n── abgebrochener Rumpf und rohe Unsinnsanfragen ──')
  {
    const a = await rohAnfrage(
      [
        'PUT /api/schirm/helligkeit HTTP/1.1',
        `Host: 127.0.0.1:${PORT}`,
        'Content-Type: application/json',
        'Content-Length: 5000',
        'Connection: close',
      ],
      '{"prozent":',
      { abbrechenNach: 11 },
    )
    console.log(`  abgebrochener Rumpf -> ${a.split('\r\n')[0] || '(keine Antwort, Verbindung war weg)'}`)
    zeigLeck('abgebrochener Rumpf: verraet nichts', a)
  }
  {
    const a = await rohAnfrage(
      [
        'PUT /api/schirm/helligkeit HTTP/1.1',
        `Host: 127.0.0.1:${PORT}`,
        'Content-Type: application/json',
        'Content-Length: 3',
        'Connection: close',
      ],
      '{"prozent":50}',
    )
    console.log(`  Laenge stimmt nicht -> ${a.split('\r\n')[0] || '(keine Antwort)'}`)
    zeigLeck('falsche Content-Length: verraet nichts', a)
  }
  {
    const a = await rohAnfrage(
      [
        'POST /api/konfiguration HTTP/1.1',
        `Host: 127.0.0.1:${PORT}`,
        'Content-Type: application/json',
        'Transfer-Encoding: chunked',
        'Connection: close',
      ],
      'ZZZ\r\nmuell\r\n0\r\n\r\n',
    )
    console.log(`  kaputtes chunked -> ${a.split('\r\n')[0] || '(keine Antwort)'}`)
    zeigLeck('kaputtes chunked: verraet nichts', a)
  }

  // ── 5. __proto__ IM JSON ─────────────────────────────────────────────────
  console.log('\n── __proto__ im JSON ──')
  {
    const a = await hole(basis, '/api/schirm/helligkeit', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ __proto__: { verseucht: 'ja' }, prozent: 60 }),
    })
    console.log(`  PUT mit __proto__ -> ${a.status} :: ${a.text.slice(0, 160)}`)
    zeigLeck('__proto__: die Antwort verraet nichts', a.text)
    // Ist danach etwas kaputt? Ein verseuchtes Object.prototype faellt hier auf:
    const b = await hole(basis, '/api/auth/state')
    pruefe('der Server lebt und antwortet danach normal', b.status === 200, `war ${b.status}`)
    pruefe('keine fremde Eigenschaft in einer normalen Antwort', !/verseucht/.test(b.text), b.text.slice(0, 120))
  }

  // ── 6. ALLE WEGE MIT KAPUTTEM RUMPF ──────────────────────────────────────
  if (MIT_SWEEP) {
    const alle = wegeAusQuelle()
    const mitRumpf = alle.filter((w) => w.methode !== 'GET')
    console.log(`\n── ALLE ${mitRumpf.length} schreibenden Wege mit kaputtem Rumpf ──`)
    console.log('   (der Rumpf scheitert in express.json() — KEIN Handler laeuft an, nichts wird geschaltet)')
    const auffaellig = []
    for (const { methode, weg } of mitRumpf) {
      let a
      try {
        a = await hole(basis, weg, {
          method: methode,
          headers: { 'Content-Type': 'application/json' },
          body: '{kaputt',
        })
      } catch (e) {
        notiz(`${methode} ${weg}: keine Antwort (${e instanceof Error ? e.message : e})`)
        continue
      }
      const t = lecks(a.text)
      if (t.length || a.status !== 400) {
        auffaellig.push({ methode, weg, status: a.status, typ: a.typ, t, text: a.text.slice(0, 160) })
      }
    }
    if (auffaellig.length === 0) {
      pruefe(`alle ${mitRumpf.length} schreibenden Wege antworten 400 und verraten nichts`, true)
    } else {
      for (const x of auffaellig) {
        console.log(`  ${x.methode} ${x.weg} -> ${x.status} ${x.typ.split(';')[0]} :: ${x.text}`)
        pruefe(`${x.methode} ${x.weg}: sauber`, x.t.length === 0, x.t.join(' + '))
        if (x.t.length === 0) notiz(`${x.methode} ${x.weg} antwortet ${x.status} statt 400 (kein Leck, aber anders)`)
      }
    }
  }

  // ── 6b. WEGE, DIE IHREN FEHLER SELBST BEANTWORTEN ────────────────────────
  //
  // DIE GRENZE DES BEHANDLERS: er sieht nur, was bis zu ihm kommt. Ein Weg mit
  // eigenem `try/catch`, der `err.message` in die Antwort schreibt, geht an ihm
  // VORBEI — und `err.message` eines Dateizugriffs IST der Pfad. In server.ts
  // gibt es zwoelf solche Stellen (`grund:`, `fehler:`, `detail:`,
  // `error: String((e as Error)?.message …)`). Hier werden die gemessen, die
  // sich von aussen gefahrlos ausloesen lassen: nur GET, nur lesend.
  console.log('\n── Wege mit eigenem catch, die err.message weiterreichen ──')
  {
    const eigene = [
      ['/api/protokolle/datei/idle-shutdown', 'server.ts:3203 grund:'],
      ['/api/protokolle/datei/shutdown-control', 'server.ts:3203 grund:'],
      ['/api/vorlesen/sprich?text=hallo', 'server.ts:8115 detail:'],
      ['/api/dienste', 'server.ts:1757 fehler:'],
      ['/api/konfiguration', 'server.ts:3436 grund:'],
      ['/api/streaming', 'server.ts:3471 grund:'],
    ]
    for (const [weg, wo] of eigene) {
      let a
      try {
        a = await hole(basis, weg)
      } catch (e) {
        notiz(`GET ${weg} (${wo}): keine Antwort (${e instanceof Error ? e.message : e}) — nicht gemessen`)
        continue
      }
      console.log(`  GET ${weg.padEnd(40)} -> ${a.status} :: ${a.text.slice(0, 150).replace(/\n/g, ' ')}`)
      zeigLeck(`${weg} (${wo}): verraet nichts`, a.text)
    }
    // UND DER PREIS: was aus der Antwort verschwunden ist, muss im Protokoll
    // stehen. Sonst ist der Pfad nicht versteckt, sondern weg — und der
    // Betreiber, der auf der Box journalctl liest, steht schlechter da als
    // vorher.
    await setzen()
    const log = protokollLesen()
    pruefe(
      'der Pfad, der nicht mehr ueber das Netz geht, steht im Protokoll',
      // AUF DEN DATEINAMEN, NICHT AUFS VERZEICHNIS (30.08.2026): der
      // Doku-Lauf 09:00 (21965e85) zog die Quelle von /var/log/mupibox/
      // nach /tmp/ um, und diese Wache blieb auf dem alten Ort stehen -
      // dauerrot, obwohl der Beleg (Dateiname im Protokoll) weiter da war.
      // Eine Wache, die einen Umzug nicht ueberlebt, prueft den Ort statt
      // der Sache.
      /Protokoll idle-shutdown nicht lesbar[\s\S]{0,600}?idle_shutdown\.log/.test(log),
    )
    pruefe(
      'auch beim Vorlesen bleibt der Grund vollstaendig im Protokoll',
      /Vorlesen fehlgeschlagen[\s\S]{0,600}?(EACCES|ENOENT|Error)/.test(log),
    )
  }

  // ── 7. DER PREIS FUER DAS PROTOKOLL ──────────────────────────────────────
  console.log('\n── was das Protokoll noch hat ──')
  {
    const log = protokollLesen()
    const zeilen = log.split('\n')
    const stapel = zeilen.filter((z) => /^\s+at .+:\d+:\d+/.test(z)).length
    const gemeldet = zeilen.filter((z) => /\[MuPiBox-Server\] \d{3} bei /.test(z)).length
    console.log(`  ${gemeldet} gemeldete Fehler, ${stapel} Stapelabzugszeilen im Protokoll`)
    pruefe('der Behandler meldet mit Status, Methode und Weg', gemeldet > 0, `${gemeldet}`)
    pruefe('die Stapelabzuege sind noch da (nur die ANTWORT ist knapp)', stapel > 5, `${stapel} Zeilen`)
    const betriebsart = /Express-Betriebsart: (\S+)/.exec(log)
    console.log(`  gemeldete Betriebsart: ${betriebsart?.[1] ?? '(keine Meldung)'}`)
    pruefe('ohne NODE_ENV laeuft Express als production', betriebsart?.[1] === 'production')
    // Der kaputte Rumpf ist ein 4xx — der darf nicht als error schreien, aber
    // er muss ueberhaupt auftauchen.
    pruefe('auch die 400er stehen im Protokoll', /\[MuPiBox-Server\] 400 bei /.test(log))
  }
}

// ═══════════════════════════════════════════════════════════════════════════
const ordner = arbeitsplatz()
const basis = `http://127.0.0.1:${PORT}`
let kind = null
const protokoll = []
try {
  const gebaut = bauen(ordner)
  const umgebung = { ...process.env }
  delete umgebung.NODE_ENV // DER GANZE PUNKT.
  Object.assign(umgebung, {
    MUPIBOX_HTTP_PORT: String(PORT),
    MUPIBOX_HTTPS_PORT: String(PORT + 1),
    MUPIBOX_NO_AUTO_TLS: '1',
    MUPIBOX_LOCK_DIR: ordner,
    MUPIBOX_CONFIG: join(ordner, 'server', 'config', 'mupiboxconfig.json'),
  })
  kind = spawn(process.execPath, [gebaut], { cwd: ordner, env: umgebung, stdio: ['ignore', 'pipe', 'pipe'] })
  kind.stdout.on('data', (d) => protokoll.push(String(d)))
  kind.stderr.on('data', (d) => protokoll.push(String(d)))
  await warteAufServer(basis, kind)
  console.log(`Server laeuft auf ${basis}, NODE_ENV ist NICHT gesetzt, gebuendelt wie auf der Box.`)
  await proben(basis, () => protokoll.join(''))
} catch (err) {
  console.error('ABBRUCH:', err instanceof Error ? (err.stack ?? err.message) : err)
  console.error(protokoll.join('').slice(-3000))
  fehler++
} finally {
  if (kind) kind.kill('SIGKILL')
  rmSync(ordner, { recursive: true, force: true })
  for (const d of aufraeumen) rmSync(d, { force: true })
}

if (offen.length) {
  console.log('\n── NICHT GEMESSEN / auffaellig, aber kein Leck ──')
  for (const o of offen) console.log(`  ${o}`)
}
console.log(`\n${fehler === 0 ? 'KEIN LECK GEFUNDEN' : `${fehler} LECKS/FEHLSCHLAEGE`}`)
process.exit(fehler === 0 ? 0 : 1)
