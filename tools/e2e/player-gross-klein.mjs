/**
 * Der Wechsel klein -> gross -> klein, im ECHTEN Browser gegen die ECHTE Box.
 *
 * WOFUER (Wunsch des Nutzers, 2026-07-28): "auch den gross/klein Test
 * automatisch fahren". Die reinen Tests pruefen die REGEL, welches Bild
 * gewaehlt wird - aber nicht, ob am Ende wirklich eines auf dem Bildschirm
 * steht. Genau dazwischen lag der gemeldete Fehler: unten ein Bild, oben ein
 * Symbol.
 *
 * KEIN neues Paket: gesteuert wird ueber das Chrome DevTools Protocol, mit dem
 * Chromium, der auf dem Rechner ohnehin liegt (Playwright-Zwischenspeicher,
 * sonst /usr/bin/chromium oder Vivaldi). Ein eigenes Testwerkzeug samt
 * Abhaengigkeiten waere fuer diesen einen Weg zu viel.
 *
 * AUFRUF:  node tools/e2e/player-gross-klein.mjs [https://mupibox:8443]
 */
import { eigenerBrowser } from '../leihgabe.mjs'

const ZIEL = process.argv[2] || 'https://192.168.178.48:8443'
const FRIST_MS = 45_000

/** Eine Antwort des Browsers abwarten, ohne ein Paket dafuer zu brauchen. */
async function cdp(ws, methode, params = {}) {
  const id = ++cdp._id
  ws.send(JSON.stringify({ id, method: methode, params }))
  return new Promise((fertig, fehler) => {
    const zaun = setTimeout(() => fehler(new Error(`${methode}: keine Antwort`)), 15_000)
    const hoerer = (roh) => {
      const m = JSON.parse(roh.toString())
      if (m.id !== id) return
      clearTimeout(zaun)
      ws.off('message', hoerer)
      m.error ? fehler(new Error(`${methode}: ${m.error.message}`)) : fertig(m.result)
    }
    ws.on('message', hoerer)
  })
}
cdp._id = 0

const auswerten = (r) => r?.result?.value

async function haupt() {
  // DER DEBUG-PORT WIRD ERFRAGT, NICHT GEWAEHLT.
  //
  // Hier stand bis zum 04.08.2026 eine feste Nummer — und sie war nicht einmal
  // eindeutig: dieselbe 9351 trug tools/marke-tanzt.mjs, dieselbe 9353
  // tools/marke-am-geraet.mjs. Ein fester Port ist doppelt gefaehrlich: Ein
  // Browser, der einen harten Abbruch ueberlebt hat, HAELT ihn; der eigene
  // bindet ihn dann NICHT und sagt darueber nichts; und `/json/list` liefert
  // klaglos die Ziele des FREMDEN. Gemessen wird danach eine Seite, die dieses
  // Werkzeug nie geoeffnet hat. `eigenerBrowser()` (tools/leihgabe.mjs) holt
  // einen freien Port, gibt dem Browser ein eigenes Profil — und weist nach,
  // dass der Browser hinter dem Port der eigene ist.
  const brw = await eigenerBrowser({
    zusatz: ['--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'],
  }).catch((e) => {
    console.log(`  Browser kam nicht hoch - uebersprungen: ${e.message}`)
    process.exit(0)
  })
  if (!brw) {
    console.log('  kein Browser gefunden - uebersprungen')
    process.exit(0)
  }

  let ws
  try {
    const { default: WebSocket } = await import('ws').catch(() => ({ default: null }))
    if (!WebSocket) {
      console.log('  Paket "ws" fehlt - uebersprungen (npm i -D ws)')
      await brw.schliessen()

      // AUFRAEUMEN: dieser Test laesst die Box tief in der Bibliothek stehen. Der
      // Weg ist derselbe, den die Box ohnehin geht (sie fragt einmal je Minute nach
      // ihrem Stand und laedt bei einer Aenderung neu) - kein F5 von aussen, kein
      // Kiosk-Neustart. Schlaegt es fehl, ist das kein Testfehler: gemessen wurde
      // trotzdem richtig.
      try {
        // ADRESSE BEWUSST NEU BAUEN: die Oberflaeche laeuft ueber https auf 8443,
        // die API ueber PLAIN http auf 8200. Ein blosses Ersetzen des Ports ergab
        // 'https://box:8200' - das warf, der catch schluckte es, und das Aufraeumen
        // blieb still aus. Ein stiller Fehlschlag ist schlimmer als gar keiner.
        const api = `http://${new URL(ZIEL).hostname}:8200/api/oberflaeche/neuladen`
        const a = await fetch(api, { method: 'POST' })
        console.log(
          a.ok
            ? '  Aufgeraeumt: die Box laedt ihre Oberflaeche neu'
            : `  Aufraeumen fehlgeschlagen (HTTP ${a.status}) - die Box bleibt stehen, wo sie ist`,
        )
      } catch (e) {
        // Kein Testfehler: gemessen wurde trotzdem richtig. Aber sichtbar.
        console.log(`  Aufraeumen nicht moeglich: ${e?.message || e}`)
      }

      process.exit(0)
    }
    // Auf den Browser warten muss hier niemand mehr: `eigenerBrowser()` kehrt
    // erst zurueck, wenn eine Seite da ist und der Port nachweislich dem
    // eigenen Browser gehoert.
    ws = new WebSocket(await brw.seite())
    await new Promise((r) => ws.on('open', r))
    await cdp(ws, 'Page.enable')
    await cdp(ws, 'Runtime.enable')
    await cdp(ws, 'Page.navigate', { url: ZIEL })

    const werte = async (ausdruck) =>
      auswerten(await cdp(ws, 'Runtime.evaluate', { expression: ausdruck, returnByValue: true }))

    const warteAuf = async (ausdruck, was) => {
      const bis = Date.now() + FRIST_MS
      while (Date.now() < bis) {
        if (await werte(ausdruck)) return true
        await new Promise((r) => setTimeout(r, 500))
      }
      throw new Error(`Zeit abgelaufen: ${was}`)
    }

    await warteAuf('!!document.querySelector("app-home, ion-app")', 'Startseite')
    console.log('  Startseite geladen')

    // Die kleine Leiste erscheint nur, wenn etwas laeuft - der Aufrufer sorgt
    // dafuer (mupi-check startet die Wiedergabe vorher).
    await warteAuf('!!document.querySelector("app-now-playing-bar .npb-cover")', 'Leiste')
    const kleinBild = await werte('!!document.querySelector("app-now-playing-bar .npb-cover img")')
    console.log(`  klein: ${kleinBild ? 'Bild' : 'nur Symbol'}`)

    // Vergroessern.
    await werte('document.querySelector("app-now-playing-bar .npb-cover").closest("[mupiAnfassbar],div").click()')
    await warteAuf('location.hash.includes("player") || !!document.querySelector("app-player")', 'Player-Seite')
    await new Promise((r) => setTimeout(r, 2500))
    const grossBild = await werte('!!document.querySelector("app-player img[src]:not([src*=\\"nocover\\"])")')
    console.log(`  gross: ${grossBild ? 'Bild' : 'nur Symbol'}`)

    // Wieder verkleinern.
    await werte('history.back()')
    await new Promise((r) => setTimeout(r, 2000))
    const kleinWieder = await werte('!!document.querySelector("app-now-playing-bar .npb-cover img")')
    console.log(`  klein wieder: ${kleinWieder ? 'Bild' : 'nur Symbol'}`)

    const ok = kleinBild && grossBild && kleinWieder
    console.log(
      ok
        ? '  ERGEBNIS: klein -> gross -> klein zeigt durchgehend ein Bild'
        : '  ERGEBNIS: FEHLER - irgendwo fehlt das Bild',
    )
    process.exitCode = ok ? 0 : 1
  } catch (e) {
    console.log(`  FEHLER: ${e.message}`)
    process.exitCode = 1
  } finally {
    try {
      ws?.close()
    } catch {
      /* egal */
    }
    await brw.schliessen()
  }
}

void haupt()
