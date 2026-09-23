#!/usr/bin/env node
/**
 * DIE KETTE VOM SCHLUESSEL BIS ZUM SCHIRM — faellt das Tor, oder haelt es?
 *
 * ══ STAND 06.08.2026: DIESES WERKZEUG HAT SEINE FRAGE BEANTWORTET ══════════
 * Es ist die UNTERSUCHUNG, die zur Aenderung gefuehrt hat, und es misst den
 * Stand VON VORHER: `sperrModus()` gab damals bei fehlendem Schluessel „aus"
 * zurueck, und die Tabelle unten zeigt, dass das Tor in drei von fuenf Lagen
 * fiel. Seither ist die Vorgabe `rechnen`, und die Antwort auf dieselben
 * Lagen ist eine andere.
 *
 * FUER DEN LAUFENDEN BETRIEB IST JETZT `tools/eltern-tor-schau.mjs` der
 * richtige Ort: es ist ein PRUEFSCHRITT (Ende 1, wenn eine Aussage faellt),
 * es kennt alle sieben Lagen samt der neuen Sorte „geste", und es braucht
 * keine Gegenstelle mehr — `tools/neu-vorschau.mjs` kann seit dem 06.08.2026
 * `/vorschau/sperre-fehlt` und `-leer` selbst stellen.
 *
 * Dieses Werkzeug bleibt stehen, weil seine Gegenstellen-Bauart etwas kann,
 * was die Vorschau nicht kann: eine BELIEBIGE Antwort auf `/api/config`
 * herstellen, ohne die Vorschau anzufassen. Wer den naechsten Fall dieser Art
 * untersucht, faengt hier an — nicht bei einer neuen Datei.
 *
 * ══ WOZU ═══════════════════════════════════════════════════════════════════
 * `mupibox.einstellungssperre` steuert das Tor vor dem Eltern-Bereich. In
 * konfiguration.ts traegt das Feld ein `standard: 'aus'`. Die naheliegende
 * Reparatur — den `standard` auf `rechnen` stellen — kann NICHTS bewirken,
 * wenn der Wert auf dem Weg zum Schirm gar nicht durch diesen `standard`
 * laeuft. Genau das ist zu MESSEN und nicht aus dem Quelltext zu schliessen:
 * an dieser Box hat der Quelltext schon mehrfach etwas anderes gesagt als der
 * laufende Dienst, und `HTTP 200` beweist hier ohnehin nichts (Server und
 * Abspieldienst antworten auf JEDEN Pfad mit 200).
 *
 * Gemessen werden fuenf Lagen der Konfiguration — die entscheidende ist die
 * erste, denn genau so sieht die Datei auf der Box .169 heute aus:
 *
 *   fehlt        der Schluessel `einstellungssperre` steht NICHT in der Datei
 *   leer         er steht da, ist aber ''
 *   unbekannt    er steht da mit einem Wort, das niemand kennt
 *   rechnen      er steht auf `rechnen`
 *   pin-ohne-pin er steht auf `pin`, aber es ist KEINE PIN hinterlegt
 *                (das Backend antwortet dann auf jede Eingabe mit nein —
 *                nachgestellt, wie es server.ts mit leerem Hash tut)
 *
 * ══ WIE ════════════════════════════════════════════════════════════════════
 * KEIN EINGRIFF IN DIE QUELLE. Dieses Werkzeug legt sich als GEGENSTELLE vor
 * eine laufende `tools/neu-vorschau.mjs` und reicht alles unveraendert durch —
 * ausser `/api/config`, wo es die gemessene Lage herstellt. Nur so laesst sich
 * der Fall „Schluessel FEHLT" ueberhaupt erzeugen: die Vorschau kennt
 * `/vorschau/sperre-aus|pin|rechnen|kaputt`, aber keine Lage OHNE den
 * Schluessel — und „aus" und „Schluessel fehlt" sind zwei verschiedene
 * Aussagen, auch wenn die Oberflaeche sie vielleicht gleich behandelt.
 *
 * Der Weg hinein wird ECHT gegangen: die Maustaste auf `#wappen` gehalten,
 * bis die Frist voll ist (bis 06.08.2026: 800 ms auf dem Zahnrad
 * `#einst-knopf`), ueber CDP-Eingaben, nicht ueber einen
 * Aufruf von `eltern.auf()`. Was gemessen wird, ist der Schirm danach:
 * steht das Tor (`#eltern-tor` sichtbar) oder liegt die Flaeche mit den
 * Faechern offen (`#eltern-flaeche` sichtbar)?
 *
 * ══ EIGENE PORTS ═══════════════════════════════════════════════════════════
 * Vorschau und Gegenstelle sind waehlbar. Der Browser kommt aus
 * tools/leihgabe.mjs — freier Debug-Port, eigenes Profil. Ein Werkzeug mit
 * fest verdrahtetem Debug-Port hat am 05.08.2026 still ein FREMDES
 * Browserfenster ferngesteuert und dessen Lage als Messung gemeldet.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *     node tools/tor-kette-messen.mjs --port 8608 --vorschau 8607
 *     node tools/tor-kette-messen.mjs --bild /tmp/tor
 *
 * ENDE 0, wenn jede Lage das ergibt, was sie ergeben soll — wobei „soll" hier
 * BESCHREIBEND gemeint ist: gemessen wird der IST-Stand, und der Bericht sagt,
 * welche Lage durchlaesst und welche haelt.
 */
import { writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import WebSocket from 'ws'
import { adminAufHalten } from './admin-weg.mjs'
import { eigenerBrowser } from './leihgabe.mjs'

const argv = process.argv.slice(2)
const opt = (n, v = null) => {
  const i = argv.indexOf(`--${n}`)
  if (i < 0) return v
  const w = argv[i + 1]
  return w && !w.startsWith('--') ? w : true
}

const PORT = Number(opt('port', 8608))
const VORSCHAU = Number(opt('vorschau', 8607))
const BILD = typeof opt('bild', null) === 'string' ? opt('bild', null) : null
const OBEN = `http://127.0.0.1:${VORSCHAU}`
const ZIEL = `http://127.0.0.1:${PORT}/neu/`

const warte = (ms) => new Promise((r) => setTimeout(r, ms))
const befunde = []
const sag = (gut, wort, dazu = '') => {
  befunde.push({ gut, wort, dazu })
  console.log(`${gut ? 'ok  ' : 'NEIN'}  ${wort}${dazu ? `  — ${dazu}` : ''}`)
}

/** Welche Lage die Gegenstelle gerade herstellt. Wird je Messung gesetzt. */
let lage = 'fehlt'

/**
 * DIE GEGENSTELLE.
 *
 * Alles geht unveraendert nach oben durch. Nur zwei Wege werden angefasst,
 * und beide nur deshalb, weil die Vorschau die zu messende Lage nicht kennt:
 *
 *   /api/config                    — der Schluessel wird gesetzt ODER ENTFERNT
 *   /api/einstellungen/pin-pruefen — bei `pin-ohne-pin` immer nein, so wie
 *                                    server.ts es mit leerem Hash tut
 */
const gegenstelle = createServer(async (req, res) => {
  const p = req.url.split('?')[0]
  try {
    if (p === '/api/config') {
      const oben = await fetch(`${OBEN}/api/config`)
      const d = await oben.json()
      d.mupibox = d.mupibox || {}
      if (lage === 'fehlt') delete d.mupibox.einstellungssperre
      else if (lage === 'leer') d.mupibox.einstellungssperre = ''
      else if (lage === 'unbekannt') d.mupibox.einstellungssperre = 'quatsch'
      else if (lage === 'pin-ohne-pin') d.mupibox.einstellungssperre = 'pin'
      else d.mupibox.einstellungssperre = lage
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(d))
      return
    }
    if (p === '/api/einstellungen/pin-pruefen' && lage === 'pin-ohne-pin') {
      for await (const _ of req) {
        /* Rumpf lesen und wegwerfen — die Antwort ist ohnehin nein */
      }
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ ok: false }))
      return
    }
    const stuecke = []
    for await (const s of req) stuecke.push(s)
    const oben = await fetch(OBEN + req.url, {
      method: req.method,
      headers: { 'content-type': req.headers['content-type'] || 'application/json' },
      body: stuecke.length ? Buffer.concat(stuecke) : undefined,
    })
    res.statusCode = oben.status
    const typ = oben.headers.get('content-type')
    if (typ) res.setHeader('content-type', typ)
    res.end(Buffer.from(await oben.arrayBuffer()))
  } catch (e) {
    res.statusCode = 502
    res.end(String(e))
  }
})

// ── Die Vorschau: eine laufende wird BENUTZT, sonst eine eigene ────────────
let vorschau = null
try {
  await fetch(`${OBEN}/api/werke`, { signal: AbortSignal.timeout(1200) })
  console.log(`Vorschau auf ${VORSCHAU} laeuft schon — sie wird benutzt.`)
} catch {
  vorschau = spawn(process.execPath, ['tools/neu-vorschau.mjs', '--port', String(VORSCHAU)], {
    stdio: 'ignore',
  })
  for (let i = 0; i < 30; i++) {
    await warte(300)
    try {
      await fetch(`${OBEN}/api/werke`, { signal: AbortSignal.timeout(1000) })
      break
    } catch {
      /* noch nicht da */
    }
  }
}
await new Promise((r) => gegenstelle.listen(PORT, '127.0.0.1', r))
console.log(`Gegenstelle auf ${PORT} vor der Vorschau ${VORSCHAU}.`)

// ── Der Browser: GELIEHEN, nicht selbst gestartet ──────────────────────────
// `eigenerBrowser()` holt einen freien Port mit eigenem Profil und liefert
// den Eigentumsnachweis mit — kein fester Debug-Port, an dem ein Ueberlebender
// eines harten Abbruchs haengen koennte (tools/leihgabe.mjs, dort die
// Messungen dazu).
const brw = await eigenerBrowser()
if (!brw) {
  console.log('  kein Browser gefunden — uebersprungen')
  process.exit(0)
}

let lfd = 0
const send = (ws, m, p = {}) =>
  new Promise((ok, no) => {
    const i = ++lfd
    ws.send(JSON.stringify({ id: i, method: m, params: p }))
    const h = (r) => {
      const x = JSON.parse(r)
      if (x.id !== i) return
      ws.off('message', h)
      x.error ? no(new Error(x.error.message)) : ok(x.result)
    }
    ws.on('message', h)
  })

let schluss = 0
try {
  const ws = new WebSocket(await brw.seite(), { perMessageDeflate: false })
  await new Promise((r) => ws.once('open', r))
  await send(ws, 'Page.enable')
  await send(ws, 'Runtime.enable')
  await send(ws, 'Emulation.setDeviceMetricsOverride', {
    width: 800,
    height: 480,
    deviceScaleFactor: 1,
    mobile: false,
  })
  const ev = async (js) => {
    const r = await send(ws, 'Runtime.evaluate', {
      expression: js,
      returnByValue: true,
      awaitPromise: true,
    })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'Fehler in der Seite')
    return r.result.value
  }

  /**
   * DER ECHTE WEG HINEIN: den Schriftzug halten.
   *
   * Nicht `eltern.auf()` aufrufen — das misst den Aufruf, nicht die Bedienung.
   * `elternEinstieg` haengt an `pointerdown`/`pointerup`; eine CDP-Maustaste
   * erzeugt beides.
   *
   * BIS ZUM 06.08.2026 WAREN ES 800 ms AUF DEM ZAHNRAD `#einst-knopf`. Das
   * Zahnrad ist ersatzlos entfallen; der Knopf ist `#wappen`, die Frist
   * WAPPEN_HALTEN_MS = 1200 ms. Beide Zahlen stehen an EINER Stelle
   * (tools/admin-weg.mjs) — hier steht nur noch die Druckfunktion.
   */
  const druecken = async (x, y, ms) => {
    const gem = { x, y, button: 'left', clickCount: 1, pointerType: 'touch' }
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...gem })
    await warte(ms)
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...gem })
  }
  /**
   * `pruefen` steht hier auf `false`: dieses Werkzeug misst gerade die Lagen,
   * in denen das Tor steht — das Urteil darueber faellt `schirm()`.
   */
  const halten = async () => {
    await adminAufHalten(ev, druecken, { warteMs: 900 })
  }

  /** Was steht am Schirm? Sichtbarkeit ueber `offsetParent`, nicht ueber `hidden`. */
  const schirm = () =>
    ev(`(() => {
      const sicht = (id) => {
        const e = document.getElementById(id)
        if (!e) return { da: false }
        const s = getComputedStyle(e)
        const b = e.getBoundingClientRect()
        return { da: true, sichtbar: !e.hidden && s.display !== 'none' && s.visibility !== 'hidden' && b.width > 1 && b.height > 1,
                 b: Math.round(b.width), h: Math.round(b.height) }
      }
      const t = document.getElementById('eltern-unter')
      return {
        eltern: sicht('eltern'),
        tor: sicht('eltern-tor'),
        flaeche: sicht('eltern-flaeche'),
        unter: t ? t.textContent.trim() : null,
        faecher: [...document.querySelectorAll('#eltern-faecher .fach-knopf')].map((k) => k.textContent.trim()),
        ziffern: document.querySelectorAll('#eltern-tor .tor-taste').length,
        ort: location.pathname,
      } })()`)

  const bild = async (name) => {
    if (!BILD) return
    const s = await send(ws, 'Page.captureScreenshot', { format: 'png' })
    await writeFile(`${BILD}-${name}.png`, Buffer.from(s.data, 'base64'))
  }

  const messen = async (welche, erwartetOffen) => {
    lage = welche
    await send(ws, 'Page.navigate', { url: ZIEL })
    await warte(1800)
    // Nachsehen, was die Oberflaeche WIRKLICH bekommen hat — sonst misst man
    // die eigene Annahme ueber die Gegenstelle.
    const roh = await ev(
      `fetch('/api/config').then(r => r.json()).then(d => JSON.stringify(Object.prototype.hasOwnProperty.call(d.mupibox||{}, 'einstellungssperre') ? d.mupibox.einstellungssperre : '<<FEHLT>>'))`,
    )
    await halten()
    const s = await schirm()
    await bild(welche)
    const offen = s.flaeche.sichtbar && !s.tor.sichtbar
    console.log(
      `\n── Lage „${welche}" ────────────────────────────────────────────\n` +
        `   /api/config liefert: ${roh}\n` +
        `   #eltern ${s.eltern.sichtbar ? 'offen' : 'zu'}, Tor ${s.tor.sichtbar ? 'STEHT' : 'weg'}, ` +
        `Flaeche ${s.flaeche.sichtbar ? 'offen' : 'zu'}\n` +
        `   Untertitel: ${JSON.stringify(s.unter)}\n` +
        `   Faecher erreichbar: ${s.faecher.length ? s.faecher.join(', ') : '—'}   Ziffern im Tor: ${s.ziffern}`,
    )
    sag(
      offen === erwartetOffen,
      `„${welche}": ${offen ? 'DURCHGELASSEN, ohne zu fragen' : 'Tor haelt'}`,
      offen === erwartetOffen ? 'wie beschrieben' : `erwartet war ${erwartetOffen ? 'offen' : 'haelt'}`,
    )
    // Zumachen, damit die naechste Lage nicht auf einem offenen Bereich misst.
    await ev(`(() => { const e = document.getElementById('eltern'); if (e) e.hidden = true; return true })()`)
    return { welche, roh, offen, ...s }
  }

  console.log('\n═══ DIE KETTE VOM SCHLUESSEL BIS ZUM SCHIRM ═══════════════════')
  const alles = []
  alles.push(await messen('fehlt', true))
  alles.push(await messen('leer', true))
  alles.push(await messen('unbekannt', true))
  alles.push(await messen('rechnen', false))
  alles.push(await messen('pin-ohne-pin', false))

  /*
   * ── DER ZWEITE FALL: „pin" GESETZT, ABER KEINE PIN HINTERLEGT ───────────
   *
   * Dass das Tor STEHT, ist erst die halbe Antwort. Die andere Haelfte: laesst
   * es sich noch oeffnen? Das Backend vergleicht bei leerem Hash gegen nichts
   * und sagt zu JEDER Eingabe nein. Hier wird deshalb wirklich getippt — vier
   * Ziffern und „Weiter" — und danach nachgesehen, ob die Flaeche aufgeht und
   * ob ueberhaupt noch ein Weg HINAUS bleibt.
   */
  console.log('\n── Der Fall „pin ohne PIN": laesst sich das Tor noch oeffnen? ──')
  lage = 'pin-ohne-pin'
  await send(ws, 'Page.navigate', { url: ZIEL })
  await warte(1800)
  await halten()
  const tippen = async (folge) => {
    for (const t of folge) {
      await ev(
        `(() => { const k = document.querySelector('#tor-feld .tor-taste[data-taste=${JSON.stringify(String(t))}]')
          if (k) k.click(); return !!k })()`,
      )
      await warte(120)
    }
    await warte(1200)
  }
  const versuche = ['1234', '2468', '0000']
  for (const v of versuche) {
    await tippen([...v, 'weiter'])
    const s = await schirm()
    console.log(
      `   Versuch ${v}: Flaeche ${s.flaeche.sichtbar ? 'OFFEN' : 'zu'}, ` +
        `Meldung ${JSON.stringify(await ev(`(document.getElementById('tor-meldung')||{}).textContent || null`))}`,
    )
    sag(!s.flaeche.sichtbar, `„pin ohne PIN": ${v} oeffnet nicht`)
  }
  const hinaus = await ev(`(() => {
    const z = document.getElementById('zurueck')
    if (!z) return { da: false }
    const b = z.getBoundingClientRect()
    const t = document.elementFromPoint(Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2))
    return { da: true, erreichbar: !!t && (t === z || z.contains(t)), b: Math.round(b.width), h: Math.round(b.height) } })()`)
  sag(
    hinaus.da && hinaus.erreichbar,
    'ein Weg HINAUS bleibt (der eine Rueckweg liegt ueber dem Tor)',
    JSON.stringify(hinaus),
  )
  await bild('pin-ohne-pin-nach-versuchen')

  console.log('\n═══ BEFUND ════════════════════════════════════════════════════')
  for (const a of alles)
    console.log(
      `  ${a.welche.padEnd(13)} config=${String(a.roh).padEnd(12)} ` +
        `${a.offen ? 'OFFEN — keine Frage' : 'TOR HAELT'}`,
    )
  schluss = befunde.every((b) => b.gut) ? 0 : 1
} catch (e) {
  console.error('Messung abgebrochen:', e.message)
  schluss = 3
} finally {
  await brw.schliessen()
  gegenstelle.close()
  if (vorschau) vorschau.kill()
}
process.exit(schluss)
