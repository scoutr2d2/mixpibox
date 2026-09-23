#!/usr/bin/env node
/**
 * DER FARBWAEHLER IN DER VERWALTUNG — vom Klick bis in die Themendatei.
 *
 * ══ WOZU ═══════════════════════════════════════════════════════════════════
 * Drei Stuecke wurden einzeln geprueft und beweisen zusammen noch nichts:
 *
 *   farbthema.spec.ts               die Regeln (Block bauen, lesen, ersetzen)
 *   farbthema.integration.spec.ts   die Route (Name, Datei, Sicherung, `..`)
 *   farbwaehler-wirkung.mjs         die Wirkung am Geraet (faerbt es wirklich?)
 *
 * Was fehlt, ist das Stueck dazwischen: OB DIE SEITE DEN WERT ABSCHICKT. Ein
 * Farbfeld, das nichts sendet, sieht auf jedem Bildschirmfoto richtig aus.
 * Deshalb wird hier ein ECHTER Server gestartet, die GEBAUTE Verwaltung darin
 * ausgeliefert und mit einem headless-Browser bedient — danach steht die Frage
 * an die DATEI, nicht an die Seite.
 *
 * ══ WARUM NICHT GEGEN DIE BOX ══════════════════════════════════════════════
 * Weil es dann nichts pruefte, was noch nicht ausgeliefert ist. Der Server
 * laeuft hier aus `src/deploy/server.js`, also aus genau dem Buendel, das
 * ausgeliefert WUERDE, aber gegen ein eigenes Verzeichnis: eigene Themenablage,
 * eigene Konfiguration, eigener Port. Es wird KEINE Datei der Box angefasst.
 *
 * Die `app.css` ist eine Kopie von `NewDesign/app.css` — dieselbe Datei, die
 * der Bauschritt nach `www/neu/` legt.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *     npm run build:backend-api && npm run build:frontend-admin
 *     node tools/farbwaehler-verwaltung-probe.mjs
 *     node tools/farbwaehler-verwaltung-probe.mjs --port 8455 --behalten
 *
 * Rueckgabe 0, wenn jeder Punkt sitzt; sonst 1 mit Bericht.
 */
import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { eigenerBrowser } from './leihgabe.mjs'

const argv = process.argv.slice(2)
const opt = (n, v = null) => {
  const i = argv.indexOf(`--${n}`)
  if (i < 0) return v
  const w = argv[i + 1]
  return w && !w.startsWith('--') ? w : true
}
const BEHALTEN = argv.includes('--behalten')
const PORT = Number(opt('port', 8455))
const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Eine Farbe, die in KEINER ausgelieferten Datei vorkommt. */
const PROBE = '#123456'

const punkte = []
const punkt = (name, ok, was = '') => {
  punkte.push({ name, ok, was })
  console.log(`  ${ok ? 'ok  ' : 'NEIN'} ${name.padEnd(52)} ${was}`)
}

/**
 * Ein Ausliefer-Verzeichnis nachbauen.
 *
 * `server.js` sucht `www` und `www-admin` NEBEN sich (`__dirname`). Deshalb
 * wird kopiert statt verwiesen — ein Verweis auf `src/deploy` haette den
 * echten Baum als Arbeitsverzeichnis, und ein Fehlgriff schriebe hinein.
 */
function lagerBauen(ohne = []) {
  const lager = mkdtempSync(join(tmpdir(), 'mupi-waehler-'))
  const noetig = [
    [join(WURZEL, 'src/deploy/server.js'), join(lager, 'server.js')],
    [join(WURZEL, 'src/deploy/www-admin'), join(lager, 'www-admin')],
    [join(WURZEL, 'NewDesign/app.css'), join(lager, 'www/neu/app.css')],
  ]
  for (const [von] of noetig) {
    if (!existsSync(von)) {
      console.log(`\n  Es fehlt: ${von}`)
      console.log('  Erst bauen: npm run build:backend-api && npm run build:frontend-admin\n')
      process.exit(1)
    }
  }
  mkdirSync(join(lager, 'www/neu'), { recursive: true })
  for (const [von, nach] of noetig) cpSync(von, nach, { recursive: true })

  // EINE VARIABLE AUS app.css NEHMEN — fuer die Frage, was passiert, wenn die
  // Oberflaeche eine der fuenf nicht (mehr) kennt. Genau das ist `--line`
  // schon einmal passiert; ein Feld ohne Vorgabe stand danach auf Schwarz und
  // behauptete daneben „wie ausgeliefert".
  if (ohne.length > 0) {
    const p = join(lager, 'www/neu/app.css')
    let css = readFileSync(p, 'utf8')
    for (const v of ohne) css = css.replace(new RegExp(`^\\s*${v}\\s*:[^;]*;\\s*$`, 'm'), '')
    writeFileSync(p, css)
  }

  // Eine eigene Themenablage mit einem Blatt, das aussieht wie ein
  // ausgeliefertes: nur `--ion-*`, kein Block.
  mkdirSync(join(lager, 'themen'))
  writeFileSync(join(lager, 'themen/ProbeThema.css'), 'body{\n\t--ion-color-light: #054b61 !important;\n}\n')
  mkdirSync(join(lager, 'konfig'))
  writeFileSync(join(lager, 'konfig/mupiboxconfig.json'), JSON.stringify({ mupibox: { theme: 'ProbeThema' } }))
  mkdirSync(join(lager, 'daten'))
  return lager
}

async function imBrowser(url, schritte) {
  // Der eigene Browser laeuft auf einem FREIEN Port mit eigenem Profil statt
  // auf einer festen Nummer, die ein Ueberlebender eines harten Abbruchs noch
  // halten koennte — /json/list liefert dann klaglos die Ziele des fremden.
  // Die Messungen dahinter: tools/leihgabe.mjs.
  const brw = await eigenerBrowser({ fenster: '1200,900' })
  if (!brw) throw new Error('kein Browser gefunden (playwright/chromium)')
  try {
    const ws = new WebSocket(await brw.seite())
    await new Promise((r, x) => {
      ws.on('open', r)
      ws.on('error', x)
    })
    let id = 0
    const offen = new Map()
    ws.on('message', (d) => {
      const n = JSON.parse(d)
      if (n.id && offen.has(n.id)) {
        offen.get(n.id)(n)
        offen.delete(n.id)
      }
    })
    const ruf = (method, params = {}) =>
      new Promise((r) => {
        const i = ++id
        offen.set(i, r)
        ws.send(JSON.stringify({ id: i, method, params }))
      })
    await ruf('Page.enable')
    await ruf('Runtime.enable')
    await ruf('Page.navigate', { url })
    await new Promise((r) => setTimeout(r, 3000))
    const raus = []
    for (const [js, warten] of schritte) {
      const a = await ruf('Runtime.evaluate', { expression: js, returnByValue: true, awaitPromise: true })
      raus.push(a.result?.result?.value)
      if (warten) await new Promise((r) => setTimeout(r, warten))
    }
    ws.close()
    return raus
  } finally {
    // Im finally, damit auch ein Fehlversuch keinen Browser stehen laesst.
    await brw.schliessen()
  }
}

/** Alles, was die Seite ueber ihren Farbabschnitt sagt. */
const ABLESEN = `(() => {
  const abschnitt = [...document.querySelectorAll('section')].find(
    (s) => s.querySelector('h2')?.textContent?.includes('Farben der neuen Oberfläche'),
  )
  if (!abschnitt) return { da: false }
  const felder = [...abschnitt.querySelectorAll("input[type='color']")].map((e) => ({
    name: e.getAttribute('aria-label'),
    wert: e.value,
  }))
  return {
    da: true,
    felder,
    text: abschnitt.textContent.replace(/\\s+/g, ' ').trim(),
  }
})()`

/** Ein Farbfeld setzen — wie ein Finger es tut. */
const setzen = (feld, wert) => `(() => {
  const abschnitt = [...document.querySelectorAll('section')].find(
    (s) => s.querySelector('h2')?.textContent?.includes('Farben der neuen Oberfläche'),
  )
  const e = [...abschnitt.querySelectorAll("input[type='color']")].find(
    (x) => x.getAttribute('aria-label') === ${JSON.stringify(feld)},
  )
  if (!e) return '(kein Feld ' + ${JSON.stringify(feld)} + ')'
  e.value = ${JSON.stringify(wert)}
  e.dispatchEvent(new Event('input', { bubbles: true }))
  return e.getAttribute('aria-label')
})()`
const SETZEN = setzen('Hintergrund', PROBE)
/**
 * Die FLAECHE auf die Schriftfarbe ziehen — der Fall, den die erste Fassung
 * der Kontrastanzeige nicht sah.
 *
 * Am Geraet gemessen (tools/farbwaehler-gegenlesen.mjs, 6b): danach steht
 * `.tor-taste` auf Flaeche rgb(46,42,59) mit Ziffer rgb(46,42,59) — die
 * PIN-Eingabe ist eine leere Flaeche. Die Zahl daneben meldete unbeirrt
 * 13,09 : 1.
 */
const SETZEN_FLAECHE = setzen('Flächen', '#2e2a3b')

/** Den gebauten Server ueber einem Lager starten und warten, bis er antwortet. */
async function serverStarten(lager, port) {
  const server = spawn('node', [join(lager, 'server.js')], {
    env: {
      ...process.env,
      MUPIBOX_HTTP_PORT: String(port),
      MUPIBOX_THEMES_DIR: join(lager, 'themen'),
      MUPIBOX_CONFIG: join(lager, 'konfig/mupiboxconfig.json'),
      MUPIBOX_CONFIG_DIR: join(lager, 'daten'),
      MUPIBOX_NO_AUTO_TLS: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  server.stdout.on('data', (d) => {
    log += d
  })
  server.stderr.on('data', (d) => {
    log += d
  })
  let oben = false
  for (let i = 0; i < 40 && !oben; i++) {
    await new Promise((r) => setTimeout(r, 300))
    try {
      oben = (await fetch(`http://127.0.0.1:${port}/api/farbthema`)).ok
    } catch {
      /* noch nicht da */
    }
  }
  return { server, oben, log: () => log }
}

/**
 * ZWEITER DURCHGANG: eine app.css, die `--line2` nicht mehr kennt.
 *
 * Die Frage, die dahintersteht, ist keine erfundene: `--line` stand zweimal in
 * app.css und wurde nie gelesen — Variablen dieser Oberflaeche kommen und
 * gehen. Fehlt eine, die im Waehler steht, darf dort KEIN Feld erscheinen. Die
 * erste Fassung zeigte eines, auf `#000000`, mit „wie ausgeliefert" daneben —
 * und der erste Griff hinein haette dieses Schwarz in die Box geschrieben.
 */
async function ohneVorgabe(port) {
  const lager = lagerBauen(['--line2'])
  const { server, oben, log } = await serverStarten(lager, port)
  try {
    punkt('Zweiter Server kommt hoch (app.css ohne --line2)', oben, `Port ${port}`)
    if (!oben) {
      console.log(log().slice(-1200))
      return
    }
    const [gesehen] = await imBrowser(`http://127.0.0.1:${port}/admin/darstellung`, [[ABLESEN, 0]])
    const namen = (gesehen?.felder || []).map((f) => f.name)
    punkt('Nur die vier Felder mit bekannter Vorgabe', namen.length === 4, namen.join(', '))
    punkt('„Linien" ist NICHT dabei', !namen.includes('Linien'))
    punkt(
      'Kein Feld steht auf Schwarz',
      (gesehen?.felder || []).every((f) => f.wert?.toUpperCase() !== '#000000'),
      (gesehen?.felder || []).map((f) => f.wert).join(' '),
    )
    punkt('Die anderen vier stehen weiter zur Wahl', namen.includes('Hintergrund') && namen.includes('Akzent'))
  } finally {
    server.kill('SIGKILL')
    if (BEHALTEN) console.log(`  Zweites Lager behalten: ${lager}`)
    else rmSync(lager, { recursive: true, force: true })
  }
}

async function main() {
  console.log('\n  FARBWAEHLER IN DER VERWALTUNG — Klick bis Datei\n')
  // Der kurze Durchgang zuerst: er braucht seinen eigenen Server und ist in
  // ein paar Sekunden durch. Danach hat der lange die Bahn fuer sich.
  await ohneVorgabe(PORT + 1)
  const lager = lagerBauen()
  const { server, oben, log } = await serverStarten(lager, PORT)

  try {
    punkt('Server kommt hoch', oben, `Port ${PORT}`)
    if (!oben) {
      console.log(log().slice(-1200))
      return 1
    }

    // Die app.css muss ueber HTTP als Stilblatt ankommen — sonst hat die Seite
    // keine Vorgaben und macht den Abschnitt zu Recht zu.
    const css = await fetch(`http://127.0.0.1:${PORT}/neu/app.css`)
    punkt(
      'app.css kommt als Stilblatt',
      (css.headers.get('content-type') || '').includes('css'),
      css.headers.get('content-type') || '',
    )

    const [vorher, gesetzt, nachher, gesetztFlaeche, nachFlaeche] = await imBrowser(
      `http://127.0.0.1:${PORT}/admin/darstellung`,
      [
        [ABLESEN, 0],
        // REICHLICH WARTEN, und das ist kein Herumraten: 400 ms Ruhepause in der
        // Seite, dann ein PUT, in dem der Server `setting_update.sh` versucht
        // (hier gibt es das Skript nicht — der Fehlversuch kostet trotzdem
        // Sekunden), dann ein POST fuer das Neuladen. Mit 2500 ms stand hier
        // noch „Wird gespeichert …", und der Bericht meldete faelschlich, die
        // Seite sage nichts von Gespeichert.
        [SETZEN, 8000],
        [ABLESEN, 0],
        [SETZEN_FLAECHE, 1200],
        [ABLESEN, 0],
      ],
    )

    punkt('Der Abschnitt ist da', Boolean(vorher?.da))
    if (!vorher?.da) return 1
    // Steht der Abschnitt LEER da, sagt er selbst warum — das ist die
    // nuetzlichste Zeile im ganzen Bericht, also wird sie gezeigt.
    if (vorher.felder.length === 0) console.log(`       Der Abschnitt sagt: ${vorher.text}`)
    punkt('Fuenf Farbfelder', vorher.felder.length === 5, vorher.felder.map((f) => f.name).join(', '))
    // Die Vorgaben muessen die AUSGELIEFERTEN sein, nicht Schwarz: dann haette
    // die Seite app.css nicht gelesen und schriebe beim ersten Klick Schwarz.
    const hg = vorher.felder.find((f) => f.name === 'Hintergrund')
    punkt('Hintergrund steht auf dem Wert aus app.css', hg?.wert?.toUpperCase() === '#FFF7EC', hg?.wert || '(keiner)')
    // DIE ZAHL NENNT JETZT AUCH IHRE STELLE. Sie deckt zwei Paarungen
    // (`--ink` auf `--bg` UND auf `--surface`) und meldet die schlechtere —
    // eine gute Zahl neben einer schlechten waere eine falsche Auskunft.
    punkt(
      'Der Kontrast steht daneben',
      /Schlechtester Kontrast der Schrift: 13,09 : 1 \(reichlich\) — auf dem Grund/.test(vorher.text || ''),
      (vorher.text || '').match(/Schlechtester Kontrast[^.]*/)?.[0] || '?',
    )
    punkt('Der dunkle Stand ist erwaehnt', /dunkle behält seine eigenen Farben/.test(vorher.text || ''))
    punkt('Das Farbthema ist benannt', /ProbeThema/.test(vorher.text || ''))

    punkt('Ein Farbfeld liess sich bedienen', gesetzt === 'Hintergrund', String(gesetzt))

    // DIE EIGENTLICHE FRAGE: steht es in der DATEI?
    const inhalt = readFileSync(join(lager, 'themen/ProbeThema.css'), 'utf8')
    punkt('Der Wert steht in der Themendatei', inhalt.includes(`--bg: ${PROBE.toUpperCase()} !important;`), PROBE)
    punkt('Mit dem Selektor, der den dunklen Stand schont', inhalt.includes(":root:not([data-licht='dunkel'])"))
    punkt('Der ausgelieferte Teil steht noch da', inhalt.includes('--ion-color-light: #054b61 !important;'))
    punkt('Eine Sicherung liegt daneben', existsSync(join(lager, 'themen/ProbeThema.css.vor-farben')))
    punkt(
      'Die Seite meldet den neuen Wert zurueck',
      nachher?.felder?.[0]?.wert?.toUpperCase() === PROBE.toUpperCase(),
      nachher?.felder?.[0]?.wert || '?',
    )
    punkt('Und meldet gespeichert', /Gespeichert/.test(nachher?.text || ''))
    // In diesem Lager gibt es kein `www/active_theme.css`. Dann liest die Box
    // das Blatt gar nicht — alles richtig geschrieben und trotzdem nichts zu
    // sehen. Genau das muss dastehen, sonst sucht man den Fehler beim Waehler.
    punkt('Sagt, dass der Verweis fehlt', /active_theme\.css fehlt/.test(nachher?.text || ''))
    // Nach dem Setzen ist der Kontrast ein ANDERER — die Zahl muss mitgehen,
    // sonst zeigt sie den Auslieferungszustand und nicht den eingestellten.
    punkt(
      'Der Kontrast geht mit',
      !/13,09/.test(nachher?.text || ''),
      (nachher?.text || '').match(/Kontrast[^.]*/)?.[0] || '?',
    )

    // DER FALL, DEN DIE ERSTE FASSUNG NICHT SAH. Nur die Flaeche verstellen,
    // Grund und Schrift lassen: die alte Anzeige rechnete allein `--ink` auf
    // `--bg` und meldete unbeirrt „reichlich", waehrend Seitenleiste, Karten
    // und PIN-Tasten unlesbar wurden.
    punkt('Das Feld „Flächen" liess sich bedienen', gesetztFlaeche === 'Flächen', String(gesetztFlaeche))
    const satz = (nachFlaeche?.text || '').match(/Schlechtester Kontrast[^.]*/)?.[0] || '?'
    punkt('Der Kontrast meldet jetzt die FLAECHE als schlechteste Stelle', /auf den Flächen/.test(satz), satz)
    punkt('Und warnt', /zu wenig/.test(satz) && /schwer zu lesen/.test(nachFlaeche?.text || ''))
  } finally {
    server.kill('SIGKILL')
    if (BEHALTEN) console.log(`\n  Lager behalten: ${lager}`)
    else rmSync(lager, { recursive: true, force: true })
  }

  const schlecht = punkte.filter((p) => !p.ok).length
  console.log(`\n  ${punkte.length - schlecht} von ${punkte.length} in Ordnung.\n`)
  return schlecht ? 1 : 0
}

main()
  .then((rc) => process.exit(rc))
  .catch((e) => {
    console.error(`\n  Fehlgeschlagen: ${e.message}\n`)
    process.exit(1)
  })
