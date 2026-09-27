#!/usr/bin/env node

/**
 * DIE THEMEN-WERKSTATT — ein Thema bauen und dabei SEHEN, was es tut.
 *
 * ══ WOFUER ═════════════════════════════════════════════════════════════════
 *
 * Ein Thema ist in diesem Baum eine Datei `themes/<name>.css`, und sie traegt
 * ZWEI Haelften:
 *
 *   * vorn `--ion-*` und Ionic-Regeln — sie faerben die KLASSISCHE Oberflaeche
 *   * hinten ein erzeugter Block mit `--bg`/`--surface`/… zwischen zwei Marken
 *     — er faerbt die NEUE (`src/backend-api/src/farbthema.ts`)
 *
 * Wer eines bauen wollte, hatte bis zum 06.08.2026 die Wahl zwischen einem
 * Texteditor und der Verwaltungsseite, die fuenf der vierzehn Farben anbot.
 * Und in beiden Faellen sah man das Ergebnis erst auf dem Geraet.
 *
 * GEMESSEN, WARUM MAN ES NICHT SEHEN KONNTE: `tools/neu-vorschau.mjs` bedient
 * `/active_theme.css` GAR NICHT. `/neu/index.html` bindet das Blatt in Zeile 66
 * ein, die Vorschau antwortet mit 404, und die Seite zeigt die eingebauten
 * Farben aus `app.css`. In der Vorschau sah bisher also JEDES Thema gleich aus.
 *
 * Diese Werkstatt schliesst genau diese Luecke: Sie REICHT die Vorschau DURCH
 * und beantwortet aus dem ganzen Verkehr nur `/active_theme.css` selbst — aus
 * dem Entwurf, an dem gerade gearbeitet wird. Dadurch steht die echte
 * Oberflaeche im Fenster, mit den Farben von jetzt, ohne Speichern und ohne
 * Geraet.
 *
 * ══ WAS SIE NICHT TUT ══════════════════════════════════════════════════════
 *
 *   * Sie redet mit KEINER Box. Alles laeuft gegen die Attrappe.
 *   * Sie schreibt erst, wenn jemand „Sichern" drueckt — und dann in
 *     `themes/<name>.css`, sonst nirgendwohin.
 *   * Sie ersetzt keine Pruefung am Geraet. Ob eine Farbe auf 800x480 hinter
 *     Chromium taugt, sagt nur die Box.
 *
 * ══ WOHER DIE FACHLOGIK KOMMT: NICHT VON HIER ══════════════════════════════
 *
 * Diese Datei ist eine SCHALE. Sie kann HTTP und Dateien, sonst nichts. Jede
 * Entscheidung darueber, was ein Thema ist, liegt in Modulen, die es schon gab:
 *
 *   farbthema.ts (backend-api)   blockLesen/blockErsetzen — der erzeugte Block
 *   themen.ts    (backend-api)   die mitgelieferten Layout-Themen
 *   farben.ts    (frontend-admin) app.css lesen, Kontrast rechnen
 *   thema-felder.ts (frontend-admin) WELCHE Farben einstellbar sind
 *
 * Das ist der Grund, warum die Werkstatt und die Verwaltungsseite nicht
 * auseinanderlaufen koennen: Es gibt nichts, worin sie sich unterscheiden
 * koennten ([[drei-orte-eine-anzeige]]). Und es ist der Weg, auf dem die
 * Einzelteile spaeter in den Tab „Darstellung" wandern — die Logik ist schon
 * dort, nur die Bedienoberflaeche ist hier.
 *
 * ══ WARUM `npx tsx` UND NICHT `node` ═══════════════════════════════════════
 *
 * Die vier Module oben sind TypeScript. `tsx` laedt sie unverwandelt.
 *
 * ALLE VIER WERDEN MIT `await import()` GEHOLT, nicht mit einem statischen
 * `import` — GEMESSEN am 06.08.2026: `src/backend-api/package.json` traegt
 * `"type": "module"`, `src/frontend-admin/package.json` nicht. tsx macht aus
 * dem einen ESM und aus dem anderen CJS, und bei CJS scheitert JEDER statische
 * Namensimport („does not provide an export named 'kontrast'"), waehrend
 * `await import()` ueber die Bruecke sauber durchkommt. Ein statischer Import
 * saehe hier richtiger aus und liefe nicht.
 *
 * AUFRUF
 *     npx tsx tools/thema-werkstatt.mjs              # http://localhost:8310/
 *     npx tsx tools/thema-werkstatt.mjs --port 9000
 *     npx tsx tools/thema-werkstatt.mjs --pruefen    # nur nachsehen, nichts oeffnen
 *
 * `--pruefen` beantwortet EINE Frage und beendet sich: Passt die Feldliste in
 * `thema-felder.ts` noch zu `NewDesign/app.css`? Sie steht hier und nicht im
 * Spec daneben, weil die Specs von `frontend-admin` ueber `ng test` IM BROWSER
 * laufen — dort gibt es kein `node:fs` und damit keine echte app.css. Und ein
 * ausgedachter CSS-Ausschnitt kann diese Frage nicht beantworten: Er ist immer
 * einig mit sich selbst.
 */

import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { basename, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { vorschauLeihen } from './leihgabe.mjs'

const HIER = fileURLToPath(new URL('.', import.meta.url))
const WURZEL = join(HIER, '..')
const OBERFLAECHE = join(HIER, 'thema-werkstatt')
const THEMEN_ORDNER = join(WURZEL, 'themes')
const APP_CSS = join(WURZEL, 'NewDesign', 'app.css')

const wert = (name, vorgabe) => {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : vorgabe
}
/**
 * 8310 UND NICHT 8300: Auf dem Entwicklungsrechner hielt 8300 am 06.08.2026
 * bereits ein fremder Dienst (auf `0.0.0.0`, also nicht einmal einer aus
 * diesem Baum). Die Nummer ist frei waehlbar — worauf es ankommt, steht
 * weiter unten beim `error`-Zweig: Ein belegter Port muss eine SATZ-lange
 * Auskunft geben und keinen Stapelauszug.
 */
const PORT = Number(wert('--port', '8310'))
/** Die Vorschau, durch die durchgereicht wird. */
const VORSCHAU = wert('--vorschau', 'http://127.0.0.1:8299/neu/')

// ── Die geliehene Fachlogik ────────────────────────────────────────────────
const farbthema = await import(join(WURZEL, 'src/backend-api/src/farbthema.ts'))
const themen = await import(join(WURZEL, 'src/backend-api/src/themen.ts'))
const farben = await import(join(WURZEL, 'src/frontend-admin/src/app/farben.ts'))
const felder = await import(join(WURZEL, 'src/frontend-admin/src/app/thema-felder.ts'))

/**
 * DIE VORGABEN KOMMEN AUS app.css, JEDES MAL NEU GELESEN.
 *
 * Nicht einmal beim Start in eine Konstante: Wer an app.css arbeitet, waehrend
 * die Werkstatt laeuft, soll seine Aenderung sehen und nicht den Stand von vor
 * einer Stunde. Die Datei ist 60 kB — das kostet nichts.
 */
const vorgaben = () => farben.wurzelFarben(readFileSync(APP_CSS, 'utf8'))

/** Welches Thema die Box gerade traegt (`mupibox.theme` aus der Konfiguration). */
function aktivesAusKonfig() {
  for (const p of ['config/mupiboxconfig.json', 'config/templates/mupiboxconfig.json']) {
    const datei = join(WURZEL, p)
    if (!existsSync(datei)) continue
    try {
      const roh = JSON.parse(readFileSync(datei, 'utf8'))
      const n = String(roh?.mupibox?.theme ?? '').trim()
      if (n) return n
    } catch {
      /* kaputte Konfiguration ist kein Grund, die Werkstatt nicht zu oeffnen */
    }
  }
  return null
}

/** Alle Themendateien, ohne `.css`. */
const themenListe = () =>
  readdirSync(THEMEN_ORDNER)
    .filter((n) => n.endsWith('.css'))
    .map((n) => n.slice(0, -4))
    .sort()

/**
 * Der Pfad einer Themendatei — MIT PRUEFUNG DES NAMENS.
 *
 * `basename` allein genuegt nicht: Ein Name wie `..` kaeme dort heil heraus.
 * Geprueft wird gegen die Liste der WIRKLICH vorhandenen Dateien, damit dieser
 * Server unter keinen Umstaenden ausserhalb von `themes/` schreibt.
 */
function themenDatei(name, auchNeu = false) {
  const n = basename(String(name || ''))
  if (!n || n !== String(name) || n.includes('/') || n.includes('\\')) return null
  if (!auchNeu && !themenListe().includes(n)) return null
  if (!/^[A-Za-z0-9._-]+$/.test(n)) return null
  return join(THEMEN_ORDNER, `${n}.css`)
}

// ══ NUR NACHSEHEN (`--pruefen`) ═══════════════════════════════════════════
//
// STEHT VOR DEM SERVER, damit diese Betriebsart weder einen Port belegt noch
// eine Vorschau leiht. Ein Pruefschritt, der nebenbei etwas startet, ist im
// Gesamtlauf die Sorte Werkzeug, die anderen die Messung verdirbt.
if (process.argv.includes('--pruefen')) {
  const appCss = readFileSync(APP_CSS, 'utf8')
  const ohne = felder.unbenutzte(appCss)
  const unbek = felder.unbekannte(farben.wurzelFarben(appCss))
  let fehler = 0
  const melde = (z) => {
    fehler++
    console.error(`  FEHLER  ${z}`)
  }
  console.log(`\nTHEMENFELDER GEGEN app.css\n`)
  console.log(
    `  angeboten                            ${felder.FARBFELDER.length} Farben in ${felder.GRUPPEN.length} Gruppen`,
  )
  console.log(`  in app.css vorhanden                 ${felder.FARBFELDER.length - unbek.length}`)
  for (const v of unbek)
    melde(`\`${v}\` wird angeboten, steht aber nicht in :root von app.css — der Regler schriebe ins Leere`)
  for (const v of ohne)
    melde(`\`${v}\` wird angeboten, aber app.css liest es NIE mit var() — der Regler faerbte nichts`)
  console.log(fehler ? `\n  ${fehler} Abweichung(en).\n` : '\n  keine Abweichung.\n')
  process.exit(fehler ? 1 : 0)
}

/** Der Entwurf, an dem gerade gearbeitet wird. Nur im Arbeitsspeicher. */
const entwurf = {
  thema: null,
  /** Nur die Farben, die WIRKLICH gesetzt sind — nicht die Vorgaben. */
  farben: {},
}

/**
 * Das Blatt, das die Vorschau als `/active_theme.css` bekommt.
 *
 * ES IST DERSELBE BLOCK, DEN AUCH GESICHERT WIRD (`blockBauen`), und das ist
 * der ganze Punkt: Was im Fenster steht, ist nicht eine Nachbildung der
 * Wirkung, sondern die Wirkung. Waere es hier ein zweiter, „aehnlicher" Block,
 * koennte die Vorschau gruen und das Geraet rot sein.
 */
const blattFuerVorschau = () => (Object.keys(entwurf.farben).length ? farbthema.blockBauen(entwurf.farben) : '')

const TYPEN = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
}

const jsonAus = (res, wert, stand = 200) => {
  res.statusCode = stand
  res.setHeader('content-type', TYPEN['.json'])
  res.end(JSON.stringify(wert))
}

async function koerper(req) {
  let roh = ''
  for await (const stueck of req) roh += stueck
  return roh ? JSON.parse(roh) : {}
}

// ── Die Vorschau leihen ────────────────────────────────────────────────────
//
// DIESELBE REGEL WIE IN DEN MESSWERKZEUGEN (tools/leihgabe.mjs): Laeuft schon
// eine, wird sie geliehen und ihre Lage am Ende zurueckgelegt; laeuft keine,
// startet die Werkstatt eine eigene und beendet sie beim Schliessen.
const leihe = await vorschauLeihen(VORSCHAU)

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  const p = url.pathname

  // ══ 1. DAS THEMENBLATT — der eine Weg, den die Werkstatt selbst beantwortet
  //
  // ER MUSS VOR DEM DURCHREICHEN STEHEN. Genau diesen Weg beantwortet die
  // Vorschau mit 404, und genau deshalb sah in ihr bisher jedes Thema gleich
  // aus.
  if (p === '/active_theme.css') {
    res.setHeader('content-type', TYPEN['.css'])
    // NICHT ZWISCHENSPEICHERN: Das Blatt aendert sich bei jedem Reglerzug.
    res.setHeader('cache-control', 'no-store')
    res.end(blattFuerVorschau())
    return
  }

  // ══ 2. Die eigene Schnittstelle ══════════════════════════════════════════
  if (p === '/api/felder') {
    const v = vorgaben()
    const appCss = readFileSync(APP_CSS, 'utf8')
    return jsonAus(res, {
      gruppen: felder.GRUPPEN,
      felder: felder.FARBFELDER,
      vorgaben: v,
      verwendungen: felder.verwendungen(appCss),
      // EHRLICHE SELBSTAUSKUNFT: Stimmt die Liste nicht mehr mit app.css
      // ueberein, sagt es die Werkstatt beim Oeffnen — statt einen Regler
      // anzubieten, der nichts faerbt oder ins Leere schreibt.
      unbenutzte: felder.unbenutzte(appCss),
      unbekannte: felder.unbekannte(v),
      schriftpaare: farben.SCHRIFTPAARE,
    })
  }

  if (p === '/api/themen') {
    return jsonAus(res, {
      themen: themenListe(),
      aktiv: aktivesAusKonfig(),
      offen: entwurf.thema,
      // Die Layout-Themen sind ein ANDERES Ding mit demselben Wort — sie
      // stehen hier nur, damit die Oberflaeche sie benennen kann.
      mitgeliefert: [...themen.MITGELIEFERT],
    })
  }

  if (p.startsWith('/api/thema/')) {
    const name = decodeURIComponent(p.slice('/api/thema/'.length))
    const datei = themenDatei(name)
    if (!datei) return jsonAus(res, { ok: false, fehler: `kein Thema „${name}"` }, 404)

    if (req.method === 'GET') {
      const css = readFileSync(datei, 'utf8')
      const gesetzt = farbthema.blockLesen(css)
      entwurf.thema = name
      entwurf.farben = { ...gesetzt }
      return jsonAus(res, {
        name,
        // WAS DAS THEMA SELBST SAGT — leer heisst „sagt nichts", nicht „schwarz".
        gesetzt,
        // Was dabei herauskommt: Vorgabe, vom Thema ueberschrieben.
        wirkung: { ...vorgaben(), ...gesetzt },
        // Die klassische Haelfte wird NICHT angetastet, nur gezaehlt — damit
        // sichtbar ist, dass sie da ist und erhalten bleibt.
        ionZeilen: farbthema
          .ohneBlock(css)
          .split('\n')
          .filter((z) => z.includes('--ion-')).length,
      })
    }

    if (req.method === 'POST') {
      const b = await koerper(req)
      // GEPRUEFT WIRD MIT DEM MODUL, das auch der Server der Box benutzt —
      // nicht mit einer eigenen zweiten Meinung darueber, was eine Farbe ist.
      const sauber = farbthema.farbenPruefen(b?.farben)
      const css = readFileSync(datei, 'utf8')
      const neu = farbthema.blockErsetzen(css, sauber)
      // DANEBEN SCHREIBEN, DANN UMBENENNEN — wie der Server es mit
      // darstellung.json haelt. Ein Absturz mitten im Schreiben darf kein
      // halbes Themenblatt hinterlassen; die Box laedt es beim naechsten Start.
      const daneben = `${datei}.neu`
      writeFileSync(daneben, neu)
      renameSync(daneben, datei)
      entwurf.thema = name
      entwurf.farben = { ...sauber }
      return jsonAus(res, { ok: true, name, gesichert: Object.keys(sauber).length })
    }
  }

  // Den Entwurf stellen, ohne zu sichern — das ist der Reglerzug.
  if (p === '/api/entwurf' && req.method === 'POST') {
    const b = await koerper(req)
    entwurf.farben = farbthema.farbenPruefen(b?.farben)
    return jsonAus(res, { ok: true, farben: entwurf.farben })
  }

  // ══ 3. Die eigene Oberflaeche ════════════════════════════════════════════
  if (p === '/' || p.startsWith('/werkstatt')) {
    const rest = p === '/' ? '/index.html' : p.slice('/werkstatt'.length) || '/index.html'
    const ziel = join(OBERFLAECHE, normalize(rest).replace(/^(\.\.[/\\])+/, ''))
    if (!ziel.startsWith(OBERFLAECHE) || !existsSync(ziel)) {
      res.statusCode = 404
      return res.end('nicht da')
    }
    res.setHeader('content-type', TYPEN[extname(ziel)] || 'application/octet-stream')
    return res.end(readFileSync(ziel))
  }

  // ══ 4. ALLES UEBRIGE GEHT AN DIE VORSCHAU ════════════════════════════════
  //
  // DURCHGEREICHT UND NICHT NACHGEBAUT. Die Attrappe kann sechzig Endpunkte,
  // fuenf Dienste und ein Dutzend Lagen; sie hier ein zweites Mal zu bauen
  // waere die teuerste Art, sie veralten zu lassen. Und weil alles durch
  // DIESEN Server laeuft, ist der Rahmen im Fenster gleichen Ursprungs — nur
  // deshalb kann die Oberflaeche die Farben ohne Neuladen wechseln.
  try {
    const hin = new URL(p + url.search, VORSCHAU)
    const antwort = await fetch(hin, {
      method: req.method,
      headers: { ...req.headers, host: hin.host },
      body: ['GET', 'HEAD'].includes(req.method)
        ? undefined
        : await koerper(req)
            .then((b) => JSON.stringify(b))
            .catch(() => undefined),
      redirect: 'manual',
    })
    res.statusCode = antwort.status
    for (const [k, v] of antwort.headers) {
      if (['content-encoding', 'content-length', 'transfer-encoding'].includes(k)) continue
      res.setHeader(k, v)
    }
    res.end(Buffer.from(await antwort.arrayBuffer()))
  } catch (e) {
    res.statusCode = 502
    res.end(`Vorschau nicht erreichbar (${VORSCHAU}): ${e.message}`)
  }
})

/**
 * EIN BELEGTER PORT IST KEIN ABSTURZ, SONDERN EINE AUSKUNFT.
 *
 * Ohne diesen Zweig wirft node einen zwoelfzeiligen Stapelauszug ueber ein
 * `Unhandled 'error' event`, in dem der eigentliche Satz („8300 ist belegt")
 * in der vierten Zeile steht. Genau so ist der erste Start hier ausgegangen.
 */
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} ist belegt. Ein anderer nehmen:`)
    console.error(`      npx tsx tools/thema-werkstatt.mjs --port ${PORT + 1}\n`)
    console.error(`  Wer den Port haelt, sagt:  ss -ltnp | grep ${PORT}\n`)
    // AUCH AUF DIESEM WEG HINAUS GEHT DIE LEIHE ZURUECK. Vorher stand hier ein
    // nacktes exit(2) — hatte die Werkstatt die Vorschau selbst gestartet,
    // blieb die als Waise stehen und hielt 8299 fuer alle Folgenden besetzt.
    leihe.zurueckgeben().finally(() => process.exit(2))
    return
  }
  throw e
})

server.listen(PORT, '127.0.0.1', () => {
  const start = aktivesAusKonfig()
  console.log(`\n  THEMEN-WERKSTATT   http://localhost:${PORT}/`)
  console.log(`  Vorschau           ${VORSCHAU}  (${leihe.eigene ? 'selbst gestartet' : 'geliehen'})`)
  console.log(`  Themen             ${themenListe().length} in themes/`)
  console.log(`  aktiv laut Konfig  ${start || '— keines —'}\n`)
})

// ── Leben bis zum Signal — und die Leihe auf JEDEM Weg zurueck ─────────────
//
// Das Warten steht in einem try/finally und nicht in einem blossen
// Signal-Hoerer: So wird die geliehene (oder selbst gestartete) Vorschau auch
// dann zurueckgelegt, wenn beim Warten selbst etwas schiefgeht — genau die
// Sorte Ausgang, auf der ein Aufraeumen sonst stumm entfaellt
// (tools/leihgabe.mjs, "DAS finally IST DER GANZE PUNKT").
try {
  await new Promise((r) => {
    process.once('SIGINT', r)
    process.once('SIGTERM', r)
  })
} finally {
  await leihe.zurueckgeben()
}
process.exit(0)
