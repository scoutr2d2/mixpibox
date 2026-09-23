#!/usr/bin/env node
/*
 * ZEIGT DIE KLASSISCHE OBERFLAECHE DEN RICHTIGEN FOLGENNAMEN? — am Geraet.
 *
 * ══ WOZU ═══════════════════════════════════════════════════════════════════
 * F1 wurde im ABSPIELDIENST gebaut und nicht in der Oberflaeche, und die
 * Begruendung dafuer steht in [[mpv-media-title-traegt-je-dienst-verschieden]]:
 * „der Abspieldienst waere der bessere Ort — dann waere die KLASSISCHE
 * Oberflaeche MITGEHEILT". Das ist der Sinn der ganzen Uebung; waere es nur um
 * die neue Oberflaeche gegangen, haette der Nachschlag in `folgenNameAn`
 * ([[titelname-wird-nachgeschlagen-wie-das-cover]]) genuegt.
 *
 * GEPRUEFT WAR DIESER SATZ NIE. tools/f1-titelname-geht-mit.mjs misst, was der
 * DIENST meldet (`/player/local`) — nicht, was die klassische Oberflaeche
 * daraus MACHT. Zwischen beidem liegen zwei Stellen, an denen es scheitern
 * kann, und eine davon tut es auch (siehe „DER BEFUND" unten).
 *
 * ══ WAS ES MISST — ZWEI FLAECHEN, NICHT EINE ═══════════════════════════════
 *   [leiste]  `.npb-title` der Mini-Leiste (now-playing-bar). Sie haengt an
 *             `toNowPlaying` und damit an `currentTrackname` — UNABHAENGIG vom
 *             Medientyp. Sie ist auf fast jeder Seite da.
 *   [player]  `.toolbar-tracktitle` der grossen Ansicht. Sie zeigt
 *             `currentTrackname` NUR, wenn `titelVomAbspieler` wahr ist, und
 *             das haengt am `media.type` DER SEITE, nicht am laufenden Ton.
 *
 * Der Massstab ist beide Male die Titelliste aus
 * `/api/werke/<schluessel>/inhalt` — dieselbe Quelle wie in
 * tools/f1-titelname-geht-mit.mjs, damit beide Werkzeuge dasselbe „richtig"
 * meinen.
 *
 * ══ DER NACHLAUF IST KEIN FEHLER ═══════════════════════════════════════════
 * `local$` ist ein Abruf im Sekundentakt (media.service.ts, `visibleInterval(1000)`).
 * Zwischen dem Uebergang und dem Neuzeichnen liegt also bis zu einer Sekunde,
 * und der Messtakt legt noch einmal einen drauf. Geurteilt wird deshalb ueber
 * den LETZTEN Stand je Stelle: was die Oberflaeche zeigt, waehrend Stelle n
 * laeuft, NACHDEM sie Zeit hatte. Wieviele Messungen sie hinterherhinkte,
 * steht daneben — als Zahl, nicht als Urteil.
 *
 * ══ WAS ES AN DER BOX AENDERT ══════════════════════════════════════════════
 *   Es startet eine Wiedergabe und haelt sie am Ende an (`stop`), wie
 *   tools/f1-titelname-geht-mit.mjs. ZUSAETZLICH laeuft hier aber eine ECHTE
 *   klassische Oberflaeche gegen die Box, und die fuehrt von sich aus Buch:
 *   sie schickt `POST /api/weiterhoeren` und schreibt damit Weiterhoeren-
 *   Marken (resume.json / offline_resume.json / gespielt.*.json). WER MISST,
 *   VERAENDERT HIER WEITERHOEREN-MARKEN — vorher sichern.
 *   Auf der Player-Seite wird EIN Tipp gemacht (die Mini-Leiste, um die grosse
 *   Ansicht zu oeffnen). Es wird nichts umgestellt, nichts gespeichert.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *   node tools/f1-klassische-oberflaeche-am-geraet.mjs --jellyfin
 *   node tools/f1-klassische-oberflaeche-am-geraet.mjs --ard --ab-ende 25
 *
 *   --jellyfin | --ard   welche Quelle (Vorgabe: jellyfin)
 *   --ab-ende <s>        kurz vor das Titelende setzen, damit der Uebergang
 *                        VON SELBST in die Messung faellt (Vorgabe 25)
 *   --sekunden <s>       Messdauer je Flaeche (Vorgabe 60)
 *   --takt <ms>          Abstand der Messungen (Vorgabe 1500)
 *   --box <ip>           Vorgabe 192.168.178.169
 *   --nur-leiste         die grosse Ansicht auslassen
 */

import WebSocket from 'ws'
import { eigenerBrowser } from './leihgabe.mjs'

const argv = process.argv.slice(2)
const opt = (name, vorgabe = null) => {
  const i = argv.indexOf(`--${name}`)
  if (i < 0) return vorgabe
  const w = argv[i + 1]
  return w && !w.startsWith('--') ? w : true
}
const hat = (name) => argv.includes(`--${name}`)

const BOX = String(opt('box', '192.168.178.169'))
const API = `http://${BOX}:8200/api`
const SPIELER = `http://${BOX}:8200/player`
const ZIEL = `http://${BOX}:8200/`
const RAUM = 'current'
const QUELLE = hat('ard') ? 'ard' : 'jellyfin'
const SEKUNDEN = Number(opt('sekunden', 60)) || 60
const TAKT = Number(opt('takt', 1500)) || 1500
const AB_ENDE = Number(opt('ab-ende', 25)) || 25
const NUR_LEISTE = hat('nur-leiste')

const warte = (ms) => new Promise((r) => setTimeout(r, ms))

async function json(url) {
  const a = await fetch(url, { cache: 'no-store', headers: { accept: 'application/json' } })
  const text = await a.text()
  const typ = a.headers.get('content-type') || ''
  // HTTP 200 beweist hier nichts — Server und Abspieldienst antworten auf
  // JEDEN Pfad mit 200 ([[server-antwortet-200-auf-alles]]).
  if (!typ.includes('json')) throw new Error(`${url} -> ${a.status} ${typ} (${text.length} B) — kein JSON`)
  return JSON.parse(text)
}
const befehl = (pfad) =>
  fetch(`${SPIELER}/${RAUM}/${pfad}`, { cache: 'no-store', headers: { accept: 'application/json' } }).catch(() => null)
const lokal = () => json(`${SPIELER}/local`).catch(() => null)

// ── CDP, so schlicht wie moeglich ──────────────────────────────────────────
let nr = 0
function send(ws, method, params = {}) {
  const id = ++nr
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`${method}: keine Antwort`)), 20000)
    const h = (d) => {
      const m = JSON.parse(d)
      if (m.id !== id) return
      clearTimeout(t)
      ws.off('message', h)
      m.error ? rej(new Error(m.error.message)) : res(m.result)
    }
    ws.on('message', h)
    ws.send(JSON.stringify({ id, method, params }))
  })
}

/** Was auf dem Schirm STEHT — beide Flaechen in EINEM Zugriff. */
const LESEN = `(() => {
  const t = (s) => { const e = document.querySelector(s); return e ? (e.textContent || '').trim() : null }
  return {
    pfad: location.pathname,
    leiste: t('.npb-title'),
    leisteDa: !!document.querySelector('.npb'),
    player: t('.toolbar-tracktitle'),
    playerDa: !!document.querySelector('.toolbar-tracktitle'),
  }
})()`

async function werkFinden() {
  const d = await json(`${API}/werke?verschmelzen=1`)
  for (const w of Array.isArray(d?.werke) ? d.werke : []) {
    let inhalt
    try {
      inhalt = await json(`${API}/werke/${encodeURIComponent(w.schluessel)}/inhalt?verschmelzen=1`)
    } catch {
      continue
    }
    if (inhalt?.dienst !== QUELLE) continue
    const titel = (inhalt.titel || []).filter((t) => t.befehl && t.anhaengen)
    if (titel.length >= 3) return { w, titel }
  }
  return null
}

/** Kurz vor das Ende setzen — IN PROZENT. `seekpos:` nimmt bei mpv PROZENT. */
async function kurzVorSchluss(abEndeSek) {
  const lo = await lokal()
  const dauer = Number(lo?.duration) || 0
  if (!(dauer > abEndeSek + 10)) {
    console.log(`  KEIN SPRUNG ans Ende: gemeldete Dauer ${dauer} s reicht fuer --ab-ende ${abEndeSek} nicht`)
    return false
  }
  const prozent = Math.max(0, Math.min(99, ((dauer - abEndeSek) / dauer) * 100))
  await befehl(`seekpos:${prozent.toFixed(2)}`)
  console.log(`  auf ${prozent.toFixed(1)} % von ${dauer.toFixed(1)} s — der Uebergang VON SELBST faellt in die Messung`)
  return true
}

const gleich = (a, b) => String(a ?? '').trim() === String(b ?? '').trim()

/**
 * Eine Messreihe: je Takt der Stand des Dienstes UND der Stand des Schirms.
 * Gibt die Rohzeilen zurueck — geurteilt wird ausserhalb.
 */
async function messreihe(ev, sekunden, waehrenddessen) {
  const zeilen = []
  const bis = Date.now() + sekunden * 1000
  const nebenher = waehrenddessen ? waehrenddessen() : null
  while (Date.now() < bis) {
    const [lo, schirm] = await Promise.all([lokal(), ev(LESEN)])
    zeilen.push({ t: Date.now(), lo, schirm })
    await warte(TAKT)
  }
  await nebenher
  return zeilen
}

/** Urteil je Stelle: was stand da, NACHDEM die Oberflaeche Zeit hatte? */
function auswerten(zeilen, namen, feld) {
  const jeStelle = new Map()
  let ohneFlaeche = 0
  for (const z of zeilen) {
    const nr = Number(z.lo?.currentTracknr) || 0
    const dienst = String(z.lo?.currentTrackname ?? '')
    const schirm = z.schirm?.[feld]
    if (schirm === null || schirm === undefined) {
      ohneFlaeche++
      continue
    }
    // Der Anlauf ist keine Messung: solange WEDER Dienst noch Schirm einen
    // Namen tragen, ist nichts geladen. Sobald einer etwas sagt, wird gewertet.
    if (!nr || (!dienst && !schirm)) continue
    if (!jeStelle.has(nr)) jeStelle.set(nr, { nr, proben: [], dienst })
    jeStelle.get(nr).proben.push({ dienst, schirm })
  }
  const urteile = []
  for (const e of [...jeStelle.values()].sort((a, b) => a.nr - b.nr)) {
    const soll = namen[e.nr - 1] ?? '(keine Zeile)'
    const letzte = e.proben[e.proben.length - 1]
    const nachlauf = e.proben.filter((p) => !gleich(p.schirm, soll)).length
    urteile.push({
      nr: e.nr,
      soll,
      zuletzt: letzte.schirm,
      dienstZuletzt: letzte.dienst,
      gut: gleich(letzte.schirm, soll),
      proben: e.proben.length,
      nachlauf,
    })
  }
  return { urteile, ohneFlaeche }
}

function berichten(ueberschrift, erg) {
  console.log(`\n── ${ueberschrift} ────────────────────────────────`)
  if (!erg.urteile.length) {
    console.log(`  NICHTS GEMESSEN — die Flaeche war in ${erg.ohneFlaeche} Messungen nicht da.`)
    return { stellen: 0, schlecht: 1 }
  }
  console.log('  nr  auf dem Schirm                  Dienst meldet                  liste[nr]')
  for (const u of erg.urteile) {
    console.log(
      `  ${String(u.nr).padEnd(3)} ${(u.gut ? '✔ ' : '✘ ') + String(u.zuletzt).slice(0, 28).padEnd(28)} ${String(u.dienstZuletzt).slice(0, 28).padEnd(28)} ${u.soll.slice(0, 28)}` +
        (u.nachlauf ? `   (${u.nachlauf}/${u.proben} Messungen hinterher)` : ''),
    )
  }
  if (erg.ohneFlaeche) console.log(`  (${erg.ohneFlaeche} Messungen ohne diese Flaeche auf dem Schirm)`)
  return { stellen: erg.urteile.length, schlecht: erg.urteile.filter((u) => !u.gut).length }
}

async function main() {
  console.log(`Klassische Oberflaeche an ${BOX} — Quelle ${QUELLE}\n`)
  const fund = await werkFinden()
  if (!fund) {
    console.log(`Kein ${QUELLE}-Werk mit mindestens 3 Titeln gefunden — nichts gemessen.`)
    process.exitCode = 2
    return
  }
  const { w, titel } = fund
  const namen = titel.map((t) => String(t.titel ?? ''))
  console.log(`Werk: „${w.titel}" — ${titel.length} Titel`)
  namen.slice(0, 4).forEach((t, i) => console.log(`   ${i + 1}. ${t}`))

  const brw = await eigenerBrowser({ fenster: '800,480' })
  if (!brw) {
    console.log('KEIN BROWSER gefunden — nichts gemessen (das ist kein gruenes Ergebnis).')
    process.exitCode = 2
    return
  }
  let gesamtSchlecht = 0
  let gesamtStellen = 0
  try {
    const ws = new WebSocket(await brw.seite())
    await new Promise((r) => ws.on('open', r))
    await send(ws, 'Runtime.enable')
    await send(ws, 'Page.enable')
    const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value

    await befehl('stop')
    await warte(1200)
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warte(6000)
    console.log(`\nOberflaeche geladen: ${await ev('location.pathname')}`)

    console.log('\n── Start: erster Titel, Rest angehaengt ────────────────────')
    await befehl(titel[0].befehl)
    await warte(2500)
    for (const t of titel.slice(1, 5)) {
      await befehl(t.anhaengen)
      await warte(300)
    }
    await warte(3000)

    const vor = await ev(LESEN)
    if (!vor?.leisteDa) {
      console.log('  ACHTUNG: die Mini-Leiste ist nicht auf dem Schirm. Sie laesst sich in')
      console.log('  Einstellungen -> Darstellung abschalten; dann misst dieser Teil nichts.')
    }

    // ── FLAECHE 1: die Mini-Leiste ────────────────────────────────────────
    console.log('\n── Mini-Leiste, Uebergang VON SELBST ──────────────────────')
    const zeilen1 = await messreihe(ev, SEKUNDEN, async () => {
      await warte(2000)
      await kurzVorSchluss(AB_ENDE)
    })
    const b1 = berichten('Mini-Leiste (.npb-title)', auswerten(zeilen1, namen, 'leiste'))
    gesamtStellen += b1.stellen
    gesamtSchlecht += b1.schlecht

    if (!NUR_LEISTE) {
      // ── FLAECHE 2: die grosse Ansicht ───────────────────────────────────
      // Geoeffnet wird sie ueber die Mini-Leiste — das ist der Weg, den auch
      // ein Mensch nimmt, wenn die Wiedergabe schon laeuft. Die Seite haengt
      // sich dann an den laufenden Ton (`handleExternalPlayback`).
      console.log('\n── Grosse Ansicht: Mini-Leiste antippen ───────────────────')
      const getippt = await ev(`(() => { const e = document.querySelector('.npb'); if (!e) return false; e.click(); return true })()`)
      await warte(3000)
      const wo = await ev(LESEN)
      console.log(`  Seite: ${wo?.pfad}   Titelzeile da: ${wo?.playerDa}   (getippt: ${getippt})`)
      if (!getippt || !wo?.playerDa) {
        console.log('  DIE GROSSE ANSICHT WURDE NICHT ERREICHT — dieser Teil ist NICHT gemessen.')
        gesamtSchlecht += 1
      } else {
        const zeilen2 = await messreihe(ev, SEKUNDEN, async () => {
          await warte(2000)
          await kurzVorSchluss(AB_ENDE)
        })
        const b2 = berichten('Grosse Ansicht (.toolbar-tracktitle)', auswerten(zeilen2, namen, 'player'))
        gesamtStellen += b2.stellen
        gesamtSchlecht += b2.schlecht
      }
    }
  } finally {
    await befehl('stop')
    await brw?.schliessen()
  }

  console.log('\n── Urteil ─────────────────────────────────────────────────')
  if (gesamtStellen < 2) {
    console.log('  UNENTSCHIEDEN: es wurde weniger als ein Uebergang gemessen. KEIN gruenes Ergebnis.')
    process.exitCode = 2
    return
  }
  if (gesamtSchlecht) {
    console.log(`  ROT: an ${gesamtSchlecht} Stellen stand der falsche (oder gar kein) Name auf dem Schirm.`)
    process.exitCode = 1
    return
  }
  console.log(`  GRUEN: an ${gesamtStellen} Stellen stand der Name, den die Liste vorgibt.`)
}

main().catch((e) => {
  console.error(`FEHLGESCHLAGEN: ${e.message}`)
  process.exitCode = 1
})
