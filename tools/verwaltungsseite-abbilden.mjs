#!/usr/bin/env node
/**
 * EINE SEITE DER VERWALTUNG ABBILDEN — hell und dunkel, mit Nachmessen.
 *
 * ══ WOZU, NEBEN `admin-schirmfolge.mjs` ════════════════════════════════════
 *
 * Die Schirmfolge bildet ALLE Seiten ab und geht dafuer durch das Tor der Box
 * (Wappen → Gruppe → Fach). Das ist richtig, wenn man den ganzen Bereich
 * pruefen will — und im Weg, wenn man an EINER Seite baut und alle zwei
 * Minuten sehen moechte, ob der neue Abschnitt sitzt. Am 21.08.2026 ist sie
 * genau daran gescheitert: `#wappen` steht auf `/admin/` gar nicht im Baum,
 * weil das Tor zur Spieler-Oberflaeche gehoert, nicht zur Verwaltung.
 *
 * Die Wege der Verwaltung sind einzeln erreichbar (`/admin/streaming` liefert
 * 200). Dieses Werkzeug faehrt sie direkt an.
 *
 * ══ WAS ES MISST, NEBEN DEN BILDERN ════════════════════════════════════════
 *   LEER       Kam ueberhaupt etwas an? Eine Angular-Seite, die beim Bauen
 *              durchgeht und zur Laufzeit wirft, ist WEISS — und ein weisses
 *              Bild sieht aus wie ein Ladefehler, nicht wie ein Absturz.
 *   FEHLER     Was die Seite in die Konsole geschrieben hat. Ohne diese Zeile
 *              bleibt ein stiller Laufzeitfehler unsichtbar.
 *   QUER       Rollt der Rumpf waagerecht? Ein zu breites Feld faellt auf dem
 *              Rechner nicht auf und schneidet auf dem Tablet ab.
 *   SUCHEN     Steht ein erwarteter Text wirklich da (`--suchen`)? „Gebaut"
 *              und „am Schirm" sind zwei verschiedene Aussagen.
 *
 * ══ WAS ES NICHT AENDERT ═══════════════════════════════════════════════════
 * Nichts. Es liest, es klickt nichts, es bestaetigt nichts. Es leiht sich
 * KEINE laufende Vorschau ([[vorschau-wird-geliehen]]) — die Adresse wird
 * immer mitgegeben.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *   node tools/verwaltungsseite-abbilden.mjs http://BOX:8200/admin/streaming \
 *        --bilder /tmp/x --suchen "Die Ströme" --suchen "Stream 2"
 * ENDE 0, wenn die Seite trug und jeder gesuchte Text stand.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { eigenerBrowser } from './leihgabe.mjs'

const argv = process.argv.slice(2)
const ZIEL = argv.find((a) => a.startsWith('http'))
const wert = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : null
}
const alle = (name) => argv.map((a, i) => (a === name ? argv[i + 1] : null)).filter(Boolean)

if (!ZIEL) {
  console.error('Aufruf: node tools/verwaltungsseite-abbilden.mjs <url> [--bilder ORDNER] [--suchen TEXT]…')
  process.exit(2)
}
const BILDER = wert('--bilder')
const GESUCHT = alle('--suchen')
const BREITE = Number(wert('--breite') || 1000)
const HOEHE = Number(wert('--hoehe') || 900)

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
const w = (ms) => new Promise((r) => setTimeout(r, ms))

const brw = await eigenerBrowser({ fenster: `${BREITE},${HOEHE}` })
if (!brw) {
  console.error('Kein Browser gefunden — ohne den geht hier nichts.')
  process.exit(2)
}

let schlecht = 0
try {
  await w(1200)
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  await send(ws, 'Log.enable').catch(() => {})

  // DIE KONSOLE WIRD MITGESCHRIEBEN, BEVOR NAVIGIERT WIRD. Wer den Horcher
  // erst danach anhaengt, verpasst genau die Fehler des ersten Aufbaus.
  const konsole = []
  ws.on('message', (r) => {
    const x = JSON.parse(r)
    if (x.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(x.params?.type))
      konsole.push((x.params.args || []).map((a) => a.value ?? a.description ?? '').join(' '))
    if (x.method === 'Runtime.exceptionThrown')
      konsole.push('AUSNAHME: ' + (x.params?.exceptionDetails?.exception?.description || '').split('\n')[0])
  })

  await send(ws, 'Emulation.setDeviceMetricsOverride', {
    width: BREITE,
    height: HOEHE,
    deviceScaleFactor: 1,
    mobile: false,
  })
  const ev = async (e) =>
    (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }))?.result?.value

  console.log(`ZIEL: ${ZIEL}`)
  console.log(`FENSTER: ${BREITE}x${HOEHE}`)

  if (BILDER) await mkdir(BILDER, { recursive: true })

  // WELCHE LAGEN ES WIRKLICH GIBT, wird gemessen und nicht angenommen.
  //
  // Der erste Entwurf lief stur ueber ['hell','dunkel'] und setzte
  // `data-licht` am Wurzelelement. Das ist der Umschalter der SPIELER-
  // Oberflaeche; die Verwaltung kennt ihn nicht. Ergebnis am 21.08.2026: zwei
  // identische dunkle Bilder, benannt „hell" und „dunkel" — eine Pruefung, die
  // nichts geprueft hat und trotzdem zwei Haken meldete
  // ([[halbe-pruefung-meldet-wie-eine-ganze]]).
  //
  // Jetzt wird die Hintergrundfarbe VERGLICHEN. Aendert der Umschalter nichts,
  // sagt das Werkzeug das — und macht nur EIN Bild.
  const lagen = []
  let vorigeFarbe = null
  for (const licht of ['hell', 'dunkel']) {
    await send(ws, 'Page.navigate', { url: ZIEL + (ZIEL.includes('?') ? '&' : '?') + 'f=' + lfd + licht })
    await w(2600)
    await ev(`document.documentElement.setAttribute('data-licht', '${licht}')`)
    await w(500)

    const farbe = await ev(`getComputedStyle(document.body).backgroundColor`)
    if (vorigeFarbe !== null && farbe === vorigeFarbe) {
      console.log(`\n══ ${licht.toUpperCase()} ═══════════════════════════════════`)
      console.log(`  UEBERSPRUNGEN — data-licht bewirkt hier nichts (Grund bleibt ${farbe}).`)
      console.log('  Diese Oberflaeche hat nur EINE Lage; das ist kein Fehler, nur keine zweite Messung.')
      break
    }
    vorigeFarbe = farbe
    lagen.push(licht)

    const lage = JSON.parse(
      await ev(`(() => JSON.stringify({
        titel: document.title,
        text: (document.body.innerText || '').trim().length,
        quer: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        breite: document.documentElement.scrollWidth,
        sicht: document.documentElement.clientWidth
      }))()`),
    )

    console.log(`\n══ ${licht.toUpperCase()} ═══════════════════════════════════`)
    console.log(`  Grund:   ${farbe}`)
    console.log(`  Titel:   ${lage.titel}`)
    console.log(`  Inhalt:  ${lage.text} Zeichen`)
    if (lage.text < 50) {
      console.log('  X LEER — die Seite hat nichts aufgebaut.')
      schlecht++
    }
    if (lage.quer) {
      console.log(`  X QUER — Rumpf ${lage.breite} px breit, Sicht ${lage.sicht} px.`)
      schlecht++
    } else {
      console.log('  Quer:    rollt nicht')
    }

    // GESUCHT WIRD IN BEIDEN TEXTEN, und das ist kein Gürtel-und-Hosenträger.
    //
    // `innerText` ist der GERENDERTE Text — `text-transform: uppercase` schlägt
    // darauf durch. Am 21.08.2026 meldete dieses Werkzeug „bisheriger Weg
    // FEHLT", während das Wort genau so im Baum stand und nur als
    // „BISHERIGER WEG" gemalt wurde. Ein Suchwerkzeug, das an einer
    // Stilangabe scheitert, meldet Fehler, die es nicht gibt — und wer dem
    // zweimal nachgeht, glaubt ihm beim dritten Mal nicht mehr.
    //
    // `textContent` sieht den Text ungemalt, dafür auch versteckten. Beide
    // zusammen: gefunden heißt gefunden, und WO steht daneben.
    for (const t of GESUCHT) {
      const wo = JSON.parse(
        await ev(`(() => {
          const n = ${JSON.stringify(t)}
          return JSON.stringify({
            gemalt: (document.body.innerText || '').includes(n),
            baum: (document.body.textContent || '').includes(n),
          })
        })()`),
      )
      const da = wo.gemalt || wo.baum
      const wie = wo.gemalt && wo.baum ? '' : wo.baum ? ' (im Baum, anders gemalt)' : ' (gemalt, nicht im Baum)'
      console.log(`  ${da ? '·' : 'X'} "${t}" ${da ? 'steht da' + wie : 'FEHLT'}`)
      if (!da) schlecht++
    }

    // WAS DIE SEITE SELBST SAGT (`--lies`). Ein Bild zeigt, was gemalt wurde;
    // fuer „welchen Wert traegt dieses Auswahlfeld wirklich" braucht es den
    // Baum. Genau daran ist am 21.08.2026 ein Auswahlfeld aufgefallen, das den
    // richtigen Eintrag hatte und den falschen anzeigte.
    for (const a of alle('--lies')) {
      // ERST AUFLOESEN, DANN IN WORTE: `String(zusage)` ergibt wortwoertlich
      // „[object Promise]" — am 22.08.2026 passiert, als ein --lies-Ausdruck
      // zum ersten Mal async war. `awaitPromise` im Runtime.evaluate wickelt
      // nur die AEUSSERE Zusage ab; das String() muss danach kommen.
      const wert = await ev(
        `(async () => { try { return String(await (${a})) } catch (f) { return 'FEHLER: ' + f.message } })()`,
      )
      console.log(`  lies:    ${a}\n           -> ${wert}`)
    }

    if (BILDER) {
      // ZWEI ARTEN VON BILD, und der Unterschied ist keine Kleinigkeit.
      //
      // Das GANZSEITENBILD (captureBeyondViewport) zeigt alles auf einmal —
      // und malt KLEBENDE Leisten (position: sticky) an ihre Sichtposition
      // mitten ins Dokument. Am 21.08.2026 lag die Speichern-Leiste dadurch
      // quer ueber zwei Kartenkoepfen, die in Wahrheit frei stehen. Wer so
      // ein Bild fuer bare Muenze nimmt, behebt eine Ueberdeckung, die es
      // nicht gibt.
      //
      // Mit `--zu <wahl>` wird stattdessen dorthin gerollt und NUR die Sicht
      // abgebildet — so, wie ein Mensch die Stelle wirklich sieht.
      const ziel = wert('--zu')
      if (ziel) {
        const da = await ev(`(() => {
          const e = document.querySelector(${JSON.stringify(ziel)})
          if (!e) return false
          e.scrollIntoView({ block: 'center' })
          return true
        })()`)
        if (!da) {
          console.log(`  X --zu "${ziel}" findet nichts.`)
          schlecht++
        }
        await w(600)
      }
      const d = (await send(ws, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: !ziel })).data
      const p = join(BILDER, `${licht}.png`)
      await writeFile(p, Buffer.from(d, 'base64'))
      console.log(`  Bild:    ${p}${ziel ? '  (Sicht bei ' + ziel + ')' : '  (ganze Seite)'}`)
    }
  }

  if (konsole.length) {
    console.log('\n══ KONSOLE ══════════════════════════════════')
    for (const z of [...new Set(konsole)].slice(0, 10)) console.log('  ! ' + z)
    // FEHLER DER SEITE ZAEHLEN. Eine Ausnahme beim Aufbau macht die Karte
    // stumm, obwohl der Rest der Seite steht — das Bild sieht dann in Ordnung
    // aus und ist es nicht.
    if (konsole.some((z) => z.startsWith('AUSNAHME'))) schlecht++
  }
} finally {
  await brw.schliessen()
}

console.log(schlecht === 0 ? '\nHAELT.' : `\nNICHT IN ORDNUNG: ${schlecht} Befund(e).`)
process.exit(schlecht === 0 ? 0 : 1)
