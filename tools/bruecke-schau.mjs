#!/usr/bin/env node
/*
 * DIE MUPI-BRUECKE, NACHGEMESSEN — Album-Tipp und Cover-Reihen am echten UI.
 *
 *     node tools/bruecke-schau.mjs --ziel http://192.168.178.57:8200/neu/
 *
 * E44 (19.08.2026): Das Darstellungs-Feld `albumTippSpielt` soll auf der
 * Interpretenseite aus „Titel zeigen" ein „abspielen" machen, und
 * `reihenFaktor` soll die Lane-Kacheln von 118 px Richtung der alten
 * ~170 px heben. Beides je Profil, als Theme speicherbar.
 *
 * DIE MESSUNG IST EINE GEGENPROBE AN DERSELBEN KACHEL:
 *   1. AUS-Lauf: erste Album-Kachel der Interpretenseite „Die Maus" —
 *      aria endet auf „Titel zeigen", Breite 118 px. Ihr Albumname wird
 *      gemerkt.
 *   2. Felder setzen (PUT /api/darstellung, zusammenfuehrend).
 *   3. AN-Lauf, frische Seite: DIESELBE Kachel (am gemerkten Namen) traegt
 *      jetzt „abspielen" und ~171 px. Der Tipp darauf oeffnet KEINE
 *      Titelliste, und /api/spotify/laeuft meldet Wiedergabe auf der Box.
 *
 * ACHTUNG: Es spielt auf einer ECHTEN Box kurz Musik. Das finally stoppt
 * die Wiedergabe (/player/current/stop) und stellt BEIDE Felder auf ihren
 * vorherigen Stand zurueck — auch wenn die Messung mittendrin scheitert.
 */
import process from 'node:process'
import WebSocket from 'ws'

import { eigenerBrowser } from './leihgabe.mjs'

const opt = (name, vorgabe) => {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : vorgabe
}
const ZIEL = opt('--ziel', 'http://192.168.178.57:8200/neu/')
const WURZEL = new URL(ZIEL).origin
const INTERPRET = opt('--interpret', 'Die Maus')

let naechste = 1
function send(ws, methode, params = {}) {
  const id = naechste++
  return new Promise((fertig, kaputt) => {
    const horch = (roh) => {
      const d = JSON.parse(roh)
      if (d.id !== id) return
      ws.off('message', horch)
      d.error ? kaputt(new Error(`${methode}: ${d.error.message}`)) : fertig(d.result)
    }
    ws.on('message', horch)
    ws.send(JSON.stringify({ id, method: methode, params }))
  })
}

async function auswerten(ws, ausdruck) {
  const r = await send(ws, 'Runtime.evaluate', {
    expression: ausdruck,
    returnByValue: true,
    awaitPromise: true,
  })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'Auswertung gescheitert')
  return r.result?.value
}

async function bisWahr(ws, ausdruck, was, geduldMs = 20000) {
  const ende = Date.now() + geduldMs
  for (;;) {
    const w = await auswerten(ws, ausdruck)
    if (w) return w
    if (Date.now() > ende) throw new Error(`Zeit um: ${was}`)
    await new Promise((f) => setTimeout(f, 250))
  }
}

/* Der Weg zur Interpretenseite, in beiden Laeufen derselbe:
 * Startseite abwarten -> Rundkachel des Interpreten tippen -> Reihen abwarten.
 * element.click() genuegt: gemessen wird der INHALT der Seite, nicht die
 * Beruehrbarkeit (dafuer gibt es finger.mjs). */
async function zurInterpretenseite(ws) {
  await bisWahr(ws, `!!document.querySelector('.leute-kachel')`, 'Startseite mit Interpreten-Reihe')
  const getroffen = await auswerten(
    ws,
    `(() => {
      const alle = [...document.querySelectorAll('button.leute-kachel')]
      const k = alle.find((b) => (b.textContent || '').includes(${JSON.stringify(INTERPRET)}))
      if (!k) return null
      k.click()
      return (k.textContent || '').trim().slice(0, 40)
    })()`,
  )
  if (!getroffen) throw new Error(`Rundkachel "${INTERPRET}" nicht gefunden`)
  await bisWahr(
    ws,
    `(() => {
      const s = document.querySelector('#interpret')
      return !!s && !s.hidden && document.querySelectorAll('#interpret .lane-kachel').length > 3
    })()`,
    'Interpretenseite mit Reihen',
    30000,
  )
}

/* Die Messkachel: eine SPOTIFY-Kachel der Reihe "In deiner Box".
 *
 * WARUM DIESE REIHE: die Diskografie-Reihen (Alben/Singles) gibt es nur mit
 * dem Schalter "Ganze Diskografie" - die Box-Reihe ist immer da und ist der
 * echte Kinderweg. Ihr Bauer ist derselbe (interpretKachelBauen, nicht-top),
 * also gilt dort dieselbe Umverdrahtung.
 * WELCHE KACHEL: die erste, der Dienst ist egal. Das Spielt-Orakel ist der
 * NETZ-MITSCHNITT der /player-Anfragen dieser Seite (CDP Network, dieselbe
 * Methode wie tools/mausweg-schau.mjs) - er sieht Spotify, ARD und Lokales
 * gleichermassen. Woerter im aria-label taugen nicht als Orakel: sie tragen
 * kein Verb (sprichDann spricht, es beschriftet nicht). */
async function albenKachelLesen(ws, aria) {
  return auswerten(
    ws,
    `(() => {
      const abschnitte = [...document.querySelectorAll('#interpret .int-reihe')]
      const reihe = abschnitte.find((a) => ((a.querySelector('.int-reihe-kopf') || {}).textContent || '').startsWith('In deiner Box'))
      if (!reihe) return null
      const kacheln = [...reihe.querySelectorAll('.lane-kachel')]
      const k = ${aria === null ? 'kacheln[0]' : `kacheln.find((b) => b.getAttribute('aria-label') === ${JSON.stringify(aria)})`}
      if (!k) return null
      const r = k.getBoundingClientRect()
      return {
        aria: k.getAttribute('aria-label'),
        breite: Math.round(r.width),
        bild: Math.round((k.querySelector('.lane-bild') || k).getBoundingClientRect().width),
        mitKnopf: !!k.querySelector('.tipp-spiel'),
      }
    })()`,
  )
}

/** Die gemerkte Alben-Kachel antippen. */
async function albenKachelTippen(ws, aria) {
  return auswerten(
    ws,
    `(() => {
      const abschnitte = [...document.querySelectorAll('#interpret .int-reihe')]
      const reihe = abschnitte.find((a) => ((a.querySelector('.int-reihe-kopf') || {}).textContent || '').startsWith('In deiner Box'))
      const k = reihe && [...reihe.querySelectorAll('.lane-kachel')].find((b) => b.getAttribute('aria-label') === ${JSON.stringify(aria)})
      if (!k) return false
      k.click()
      return true
    })()`,
  )
}

async function darstellungHolen() {
  const r = await fetch(`${WURZEL}/api/darstellung`, { cache: 'no-store' })
  return r.json()
}

async function felderSetzen(felder, themen) {
  const r = await fetch(`${WURZEL}/api/darstellung`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ aktuell: felder, themen: themen || {} }),
  })
  if (!r.ok) throw new Error(`PUT /api/darstellung: ${r.status}`)
  return r.json()
}

const s = (n) => new Promise((f) => setTimeout(f, n))

const lauf = await eigenerBrowser({ fenster: '800,480' })
if (!lauf) {
  console.error('Kein Browser gefunden.')
  process.exit(1)
}

let zurueckstellen = null
let angespielt = false
try {
  // ── Stand sichern, Theme-Ankunft pruefen ─────────────────────────────────
  const vorher = await darstellungHolen()
  const a = vorher?.aktuell || {}
  zurueckstellen = {
    albumTippSpielt: a.albumTippSpielt === true,
    reihenFaktor: Number.isFinite(Number(a.reihenFaktor)) ? Number(a.reihenFaktor) : 1,
  }
  const themenNamen = Object.keys(vorher?.themen || {})
  console.log(`Profil aktiv:      ${vorher?.profil || '?'} (eigen: ${vorher?.eigen})`)
  console.log(`Vorher:            albumTippSpielt=${a.albumTippSpielt ?? '(fehlt)'} reihenFaktor=${a.reihenFaktor ?? '(fehlt)'}`)
  console.log(`Theme mitgeliefert: ${themenNamen.includes('MuPi-Brücke') ? 'MuPi-Brücke ist da' : `FEHLT! (${themenNamen.join(', ')})`}`)

  // ── AUS-Lauf ─────────────────────────────────────────────────────────────
  const seite = new WebSocket(await lauf.seite())
  await new Promise((f, k) => (seite.on('open', f), seite.on('error', k)))
  await send(seite, 'Page.enable')
  // Der Netz-Mitschnitt ist das Spielt-Orakel: jede /player-Anfrage DIESER
  // Seite landet hier. Der Kiosk der Box ist ein anderer Browser und bleibt
  // unsichtbar - der Mitschnitt kann also nur von unseren Tipps stammen.
  await send(seite, 'Network.enable')
  const spielerAnfragen = []
  seite.on('message', (roh) => {
    try {
      const d = JSON.parse(roh)
      // NUR BEFEHLE, KEINE ABFRAGEN: /player/state und /player/local sind
      // der Lese-Takt der Seite und laufen auch ohne jeden Tipp. Befehle
      // gehen ueber /player/current/... (ardqueue, play, stop, seek ...).
      if (d.method === 'Network.requestWillBeSent' && String(d.params?.request?.url || '').includes('/player/current/')) {
        spielerAnfragen.push(d.params.request.url)
      }
    } catch {
      /* fremde Nachricht */
    }
  })
  await send(seite, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
  await zurInterpretenseite(seite)
  // Die Alben-Reihe kommt NACH den "Beliebtesten Titeln" — auf ihren KOPF
  // warten, nicht auf irgendwelche Kacheln (die Top-Reihe erfuellt das schon).
  await bisWahr(
    seite,
    `[...document.querySelectorAll('#interpret .int-reihe-kopf')].some((k) => (k.textContent || '').startsWith('In deiner Box'))`,
    'Box-Reihe',
    30000,
  ).catch(async () => {
    const koepfe = await auswerten(
      seite,
      `[...document.querySelectorAll('#interpret .int-reihe-kopf')].map((k) => k.textContent)`,
    )
    throw new Error(`AUS-Lauf: keine Box-Reihe. Reihen da: ${JSON.stringify(koepfe)}`)
  })
  const aus = await albenKachelLesen(seite, null)
  if (!aus) {
    const inhalt = await auswerten(
      seite,
      `(() => {
        const abschnitte = [...document.querySelectorAll('#interpret .int-reihe')]
        const reihe = abschnitte.find((a) => ((a.querySelector('.int-reihe-kopf') || {}).textContent || '').startsWith('In deiner Box'))
        return reihe
          ? [...reihe.querySelectorAll('.lane-kachel')].slice(0, 8).map((b) => ({
              aria: b.getAttribute('aria-label'),
              src: ((b.querySelector('img') || {}).src || '').slice(0, 90),
              klassen: b.className,
            }))
          : 'Reihe fehlt'
      })()`,
    )
    throw new Error(`AUS-Lauf: Box-Reihe ohne Spotify-Kachel. Inhalt: ${JSON.stringify(inhalt, null, 1)}`)
  }
  const albumAria = String(aus.aria)
  console.log(`\n── AUS (heutiges Verhalten) ──`)
  console.log(`Kachel:  ${aus.aria} (Spielknopf: ${aus.mitKnopf ? 'ja' : 'NEIN?'})`)
  console.log(`Breite:  ${aus.breite}px (Bild ${aus.bild}px) — erwartet 118`)
  // DIE TAT IST DIE MESSGROESSE: im heutigen Verhalten oeffnet der Tipp die
  // Titelliste (.lane-tief) — genau das muss im AN-Lauf verschwinden.
  const vorTipp = spielerAnfragen.length
  await albenKachelTippen(seite, albumAria)
  await s(2500)
  const tiefAus = await auswerten(seite, `!!document.querySelector('#interpret .lane-tief')`)
  const ausGespielt = spielerAnfragen.length > vorTipp
  console.log(`Tipp:    Titelliste aufgegangen: ${tiefAus ? 'ja (heutiges Verhalten belegt)' : 'NEIN — unerwartet!'}`)
  console.log(`         /player-Befehle dabei: ${ausGespielt ? spielerAnfragen.slice(vorTipp).join(' ') : 'keine (richtig)'}`)

  // ── Felder setzen ────────────────────────────────────────────────────────
  await felderSetzen({ albumTippSpielt: true, reihenFaktor: 1.45 }, vorher?.themen)
  console.log(`\nGesetzt: albumTippSpielt=true reihenFaktor=1.45`)

  // ── AN-Lauf, frische Seite ───────────────────────────────────────────────
  await send(seite, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now() + 1}` })
  // Erst wenn die Seite den neuen Stand traegt, lohnt der Weg: die
  // CSS-Variable ist das billigste Zeichen dafuer.
  await bisWahr(
    seite,
    `getComputedStyle(document.documentElement).getPropertyValue('--mupi-reihe-f').trim() === '1.45'`,
    'Seite uebernimmt reihenFaktor',
  )
  await zurInterpretenseite(seite)
  await bisWahr(
    seite,
    `[...document.querySelectorAll('#interpret .int-reihe-kopf')].some((k) => (k.textContent || '').startsWith('In deiner Box'))`,
    'Box-Reihe (AN-Lauf)',
    30000,
  )
  const an = await albenKachelLesen(seite, albumAria)
  if (!an) throw new Error(`AN-Lauf: Kachel "${albumAria}" nicht wiedergefunden`)
  console.log(`\n── AN (MuPi-Bruecke) ──`)
  console.log(`Kachel:  ${an.aria}`)
  console.log(`Breite:  ${an.breite}px (Bild ${an.bild}px) — erwartet ~171`)

  // ── Der Tipp: spielt er, statt zu zeigen? ────────────────────────────────
  // NICHT, wenn gerade jemand ECHT hoert: der Test wuerde die Wiedergabe des
  // Kindes kapern und danach STOPPEN. Dann lieber ohne Klick-Urteil — und
  // KEIN process.exit(): das uebersprange das finally samt Zuruecksetzen.
  const breiteRichtig = an.breite >= 168 && an.breite <= 174 && aus.breite === 118
  const schonAktiv = await fetch(`${WURZEL}/api/spotify/laeuft`).then((x) => x.json()).catch(() => null)
  if (schonAktiv?.aktiv) {
    console.log(`\n── Der Tipp ── UEBERSPRUNGEN: es spielt gerade jemand (aufDieserBox=${schonAktiv.aufDieserBox}).`)
    console.log(`\nURTEIL (ohne Klick): ${breiteRichtig && tiefAus ? 'Breite TRAEGT, AUS-Verhalten belegt' : 'ABWEICHUNG'}`)
    process.exitCode = breiteRichtig && tiefAus ? 0 : 1
  } else {
    angespielt = true
    const vorAnTipp = spielerAnfragen.length
    await albenKachelTippen(seite, albumAria)
    let spielt = null
    const ende = Date.now() + 12000
    while (Date.now() < ende) {
      if (spielerAnfragen.length > vorAnTipp) {
        spielt = spielerAnfragen[spielerAnfragen.length - 1]
        break
      }
      await s(500)
    }
    const titelliste = await auswerten(seite, `!!document.querySelector('#interpret .lane-tief')`)
    console.log(`\n── Der Tipp ──`)
    console.log(`Titelliste aufgegangen: ${titelliste ? 'JA (FALSCH!)' : 'nein (richtig)'}`)
    console.log(`Abspielbefehl ging raus: ${spielt ? `JA (richtig): ${String(spielt).slice(0, 100)}` : 'NEIN (falsch)'}`)

    // Fuenf Zeugen: AUS oeffnete die Liste und spielte NICHT, AN oeffnet
    // sie nicht und spielte, und die Breite wuchs von 118 auf ~171.
    const urteil = tiefAus && !ausGespielt && breiteRichtig && !titelliste && !!spielt
    console.log(`\nURTEIL: ${urteil ? 'BRUECKE TRAEGT' : 'ABWEICHUNG — siehe oben'}`)
    process.exitCode = urteil ? 0 : 1
  }
} finally {
  // Erst die Musik aus, dann die Felder zurueck — in DIESER Reihenfolge:
  // ein Fehler beim Zuruecksetzen darf kein spielendes Geraet hinterlassen.
  if (angespielt) {
    await fetch(`${WURZEL}/player/current/stop`).catch(() => {})
    console.log('Wiedergabe gestoppt.')
  }
  if (zurueckstellen) {
    const jetzt = await darstellungHolen().catch(() => null)
    await felderSetzen(zurueckstellen, jetzt?.themen).catch((f) => console.error(`Zuruecksetzen scheiterte: ${f.message}`))
    console.log(`Zurueckgestellt: albumTippSpielt=${zurueckstellen.albumTippSpielt} reihenFaktor=${zurueckstellen.reihenFaktor}`)
  }
  await lauf.schliessen?.()
}
