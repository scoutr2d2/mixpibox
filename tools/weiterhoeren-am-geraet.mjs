#!/usr/bin/env node
/*
 * WOZU
 *   Den Weiterhoeren-Tipp AM GERAET nachfahren und dabei mitschreiben, was
 *   die Oberflaeche in genau diesem Augenblick ANZEIGEN wuerde.
 *
 *   Gemeldeter Fehler (03.08.2026, woertlich): „manchmal kann man ein eintrag
 *   anwaehlen es spielt aber zeigt keinen fortschritt der player steht noch
 *   auf play". Also: Ton ja, Anzeige nein. Ein „manchmal" ist ein Wettlauf,
 *   und einen Wettlauf sieht man nur zwischen ZWEI Ablesungen — nicht in
 *   einer. Deshalb liest dieses Werkzeug /player/local und /player/state im
 *   250-ms-Takt und rechnet jede Ablesung durch DIESELBEN Regeln, die
 *   NewDesign/app.js benutzt (`jetztLaeuft`, `fortschritt`, `spieltAnzeige`).
 *
 *   Die Regeln sind hier NACHGEBAUT, nicht importiert: app.js ist eine
 *   Browser-Datei ohne Ausfuhr. Wer sie dort aendert, aendert sie hier mit —
 *   sonst misst dieses Werkzeug ab morgen etwas anderes als die Box zeigt.
 *
 * AUFRUF
 *   node tools/weiterhoeren-am-geraet.mjs --box 192.168.178.169 --liste
 *       zeigt, welche Weiterhoeren-Zeilen die Box gerade fuehrt (NUR LESEN)
 *
 *   node tools/weiterhoeren-am-geraet.mjs --box 192.168.178.169 --nr 1
 *       faehrt den Tipp auf Zeile 1 nach und schreibt die Zeitleiste mit
 *
 *   --sekunden 25     wie lange nach dem Start noch abgelesen wird
 *   --vorspiel        VOR dem Weiterhoeren-Tipp erst etwas anderes starten
 *                     und wieder anhalten. Damit wird der Verdacht „ein
 *                     ALTER Zustand steht noch in /player/local" gestellt.
 *   --kein-stopp      den `stop` vor dem Start weglassen (Gegenprobe)
 *   --ton             ueber SSH den Spitzenpegel am Mithoerausgang messen.
 *                     OHNE DAS IST DIE MESSUNG NICHT ENTSCHEIDBAR: „es
 *                     spielt, zeigt aber nichts" und „es spielt gar nicht"
 *                     sehen an den beiden Schnittstellen GLEICH aus.
 *                     Mindestens 3 s messen — parec puffert 64 kB, bevor es
 *                     das erste Byte schreibt (mupi-check.py `pegel`).
 *
 * WAS ES AN DER BOX AENDERT
 *   Es startet und haelt an — mehr nicht. Am Ende steht IMMER ein `stop`
 *   (finally), damit morgens nichts laeuft. Es schreibt NICHTS in
 *   resume.json: `POST /api/weiterhoeren` wird bewusst nicht geschickt.
 *   Der echte Tipp taete das (`stelleMerken`); fuer die Frage „was zeigt die
 *   Anzeige" ist es ohne Belang, und eine verstellte resume.json waere ein
 *   Schaden am Geraet.
 */

const args = process.argv.slice(2)
const opt = (name, standard = null) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : standard
}
const flag = (name) => args.includes(name)

const BOX = opt('--box', '192.168.178.169')
const BASIS = `http://${BOX}:8200`
const RAUM = 'current'
const TAKT_MS = 250

const schlaf = (ms) => new Promise((f) => setTimeout(f, ms))

async function holen(pfad) {
  const a = await fetch(`${BASIS}${pfad}`, { cache: 'no-store', headers: { accept: 'application/json' } })
  if (!a.ok) throw new Error(`HTTP ${a.status} bei ${pfad}`)
  return a.json()
}

async function befehl(pfad) {
  const t0 = Date.now()
  try {
    const a = await fetch(`${BASIS}/player/${RAUM}/${pfad}`, { cache: 'no-store', headers: { accept: 'application/json' } })
    return { ok: a.ok, status: a.status, ms: Date.now() - t0 }
  } catch (e) {
    return { ok: false, status: 0, fehler: String(e), ms: Date.now() - t0 }
  }
}

// ── Die Regeln der Oberflaeche, Zeichen fuer Zeichen aus NewDesign/app.js ──

/** app.js `brauchbareDauer` */
function brauchbareDauer(sek) {
  return sek > 0 && sek < 86400 ? sek : 0
}

/** app.js `sauberterTitel` */
function sauberterTitel(roh) {
  const s = String(roh || '')
  const schnitt = s.indexOf(' - ')
  const rest = schnitt > 0 ? s.slice(schnitt + 3) : s
  return rest.replace(/_(?=\s)/g, ':').trim() || s
}

/** app.js `jetztLaeuft` — LOKAL GEWINNT, und genau das ist hier der Verdacht. */
function jetztLaeuft(sp, lo) {
  if (lo && lo.currentPlayer === 'mplayer' && (lo.playing || lo.currentTrackname)) {
    return {
      titel: sauberterTitel(lo.currentTrackname || lo.album || ''),
      unter: lo.album || '',
      laeuft: !!lo.playing,
      bisher: Math.max(0, Number(lo.timePos) || 0),
      dauer: brauchbareDauer(Number(lo.duration) || 0),
      art: 'lokal',
      zweig: 'lokal',
    }
  }
  if (sp && sp.item && sp.item.name) {
    const ms = Number(sp.item.duration_ms) || 0
    return {
      titel: String(sp.item.name),
      unter: (sp.item.artists && sp.item.artists[0] && sp.item.artists[0].name) || (sp.item.album && sp.item.album.name) || '',
      laeuft: !!sp.is_playing,
      bisher: (Number(sp.progress_ms) || 0) / 1000,
      dauer: brauchbareDauer(ms / 1000),
      art: 'spotify',
      zweig: 'spotify',
    }
  }
  return null
}

/** `startPlan` (spielfunktion.ts), nur der Spotify-Zweig (mehr braucht der Fall nicht) */
function spotifyBefehl(typ, id, nr, ms) {
  return `spotify/now/spotify:${typ}:${encodeURIComponent(id)}:${Math.max(0, Math.round(nr))}:${Math.max(0, Math.round(ms))}`
}

// ── Kommt wirklich Ton heraus? ────────────────────────────────────────────
//
// DIE GROSSE MESSFALLE steht in llmwiki `dienste-umschalten`: eine offene
// PipeWire-Quelle beweist GAR NICHTS — librespot haelt seine Quelle immer
// offen, auch pausiert, und `pactl` meldet sie sogar als nicht stillgelegt.
// Gemessen wird deshalb der SPITZENPEGEL am Mithoerausgang der Standardsenke,
// genau wie in tools/mupi-check.py.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const ausfuehren = promisify(execFile)

async function tonPegel(sekunden = 4) {
  const s = Math.max(3, sekunden)
  const fern = [
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=8',
    `dietpi@${BOX}`,
    // Der Sechzehn-Bit-Rohstrom wird gleich auf der Box zum Spitzenwert
    // eingedampft — 4 s bei 22 kHz sind sonst 176 kB durch die Leitung.
    `SENKE=$(XDG_RUNTIME_DIR=/run/user/1000 pactl get-default-sink 2>/dev/null); ` +
      `XDG_RUNTIME_DIR=/run/user/1000 timeout ${s}s parec --device=$SENKE.monitor ` +
      `--format=s16le --rate=22050 --channels=1 --raw 2>/dev/null > /tmp/mupi-mithoer.raw; ` +
      `python3 -c "import array,sys;d=open('/tmp/mupi-mithoer.raw','rb').read();` +
      `print('KURZ') if len(d)<2000 else (lambda w:print('%.4f'%(max(abs(x) for x in w)/32768.0)))(` +
      `array.array('h',d[:len(d)//2*2]))"`,
  ]
  try {
    const { stdout } = await ausfuehren('ssh', fern, { timeout: (s + 15) * 1000 })
    const t = String(stdout).trim().split('\n').pop().trim()
    if (t === 'KURZ') return { pegel: null, text: 'STILL (Senke schlief, keine Daten)' }
    const p = Number(t)
    if (!Number.isFinite(p)) return { pegel: null, text: `unlesbar: ${t}` }
    // 0,01 ist die Grenze aus mupi-check: darunter ist es Rauschen, kein Stueck.
    return { pegel: p, text: p >= 0.01 ? `TON LAEUFT (Spitze ${p.toFixed(4)})` : `STILL (Spitze ${p.toFixed(4)})` }
  } catch (e) {
    return { pegel: null, text: `Messung misslang: ${String(e.message || e).slice(0, 120)}` }
  }
}

// ── Die Messung ───────────────────────────────────────────────────────────

/** Eine Ablesung: beide Kanaele, so dicht beieinander wie moeglich. */
async function ablesen() {
  const [lo, sp] = await Promise.all([
    holen('/player/local').catch(() => null),
    holen('/player/state').catch(() => null),
  ])
  return { t: Date.now(), lo, sp, np: jetztLaeuft(sp, lo) }
}

function zeile(t0, a, marke = '') {
  const ms = String(a.t - t0).padStart(6)
  const np = a.np
  const lo = a.lo || {}
  const sp = a.sp || {}
  const rohLokal = `cp=${JSON.stringify(lo.currentPlayer ?? null)} playing=${lo.playing} tn=${JSON.stringify(lo.currentTrackname ?? null)} timePos=${lo.timePos} dur=${lo.duration}`
  const rohSp = `name=${JSON.stringify((sp.item && sp.item.name) ?? null)} is_playing=${sp.is_playing} progress=${sp.progress_ms}`
  const anzeige = np
    ? `ZEIGT ${np.laeuft ? 'PAUSE-Symbol (laeuft)' : 'PLAY-Symbol (steht!)'} zweig=${np.zweig} bisher=${np.bisher.toFixed(1)}s dauer=${np.dauer.toFixed(1)}s titel=${JSON.stringify(np.titel)}`
    : 'ZEIGT NICHTS (Leiste versteckt)'
  return `${ms} ms | ${anzeige}\n         local: ${rohLokal}\n         state: ${rohSp}${marke ? `\n         >>> ${marke}` : ''}`
}

async function main() {
  const d = await holen('/api/weiterhoeren?max=20')
  const zeilen = (d && d.weiter) || []

  if (flag('--liste') || !flag('--nr')) {
    console.log(`Weiterhoeren-Zeilen der Box ${BOX}:`)
    zeilen.forEach((e, i) => {
      console.log(
        `  ${i + 1}. [${e.typ}] ${e.interpret} — ${String(e.titel).slice(0, 50)}\n       titelNr=${e.titelNr} positionMs=${e.positionMs} positionProzent=${e.positionProzent} schluessel=${e.schluessel || '(fehlt)'}`,
      )
    })
    if (!flag('--nr')) {
      console.log('\nZum Nachfahren:  --nr <n>   (1-basiert)')
      return
    }
  }

  const nr = Number(opt('--nr', '1'))
  const e = zeilen[nr - 1]
  if (!e) throw new Error(`Zeile ${nr} gibt es nicht (${zeilen.length} vorhanden)`)
  if (e.typ !== 'spotify') throw new Error(`Zeile ${nr} ist ${e.typ} — dieses Werkzeug faehrt bisher nur den Spotify-Weg nach`)

  const werke = await holen('/api/werke')
  const liste = (werke && werke.werke) || werke || []
  const w = liste.find((x) => x.schluessel === e.schluessel)
  if (!w) throw new Error(`Das Werk zu ${e.schluessel} steht nicht in /api/werke — die Kachel meldete „gibt es nicht mehr"`)

  const typ = { album: 'album', playlist: 'playlist', show: 'show' }[w.art]
  if (!typ) throw new Error(`w.art=${w.art} hat keinen Ein-Befehl-Start`)
  const id = String(e.schluessel).replace(/^spotify:/, '')
  const cmd = spotifyBefehl(typ, id, e.titelNr, e.positionMs || 0)

  const dauerS = Number(opt('--sekunden', '25'))
  const t0 = Date.now()
  const spur = []

  console.log(`\n══ Weiterhoeren am Geraet: „${e.titel}" (${e.interpret})`)
  console.log(`   art=${w.art} titelNr=${e.titelNr} positionMs=${e.positionMs}`)
  console.log(`   Befehl: ${cmd}\n`)

  try {
    const vor = await ablesen()
    console.log(zeile(t0, vor, 'VORHER'))

    // ── DER FALL, DEN DAS KIND HERSTELLT ────────────────────────────────
    // Es hoert etwas, und WAEHREND ES LAEUFT tippt es eine andere
    // Weiterhoeren-Kachel. Genau dann schickt `weiterSpielen` `stop` (=
    // spotifyApi.pause) und unmittelbar danach den Startbefehl. Aus einer
    // RUHENDEN Box heraus ist der Fall gar nicht zu stellen — dort ist das
    // `stop` folgenlos. Deshalb diese Option: erst etwas anderes wirklich
    // laufen lassen, NICHT anhalten, und dann tippen.
    const vorlaufS = Number(opt('--vorlauf', '0'))
    if (vorlaufS > 0) {
      console.log(`\n--- Vorlauf: etwas anderes starten und ${vorlaufS} s LAUFEN LASSEN ---`)
      const v = zeilen.find((x) => x.typ === 'spotify' && x.schluessel && x.schluessel !== e.schluessel)
      const vw = v && liste.find((x) => x.schluessel === v.schluessel)
      const vtyp = vw && { album: 'album', playlist: 'playlist', show: 'show' }[vw.art]
      if (!vtyp) throw new Error('Kein zweites Spotify-Werk fuer den Vorlauf gefunden')
      await befehl('stop')
      await schlaf(1500)
      await befehl(spotifyBefehl(vtyp, String(v.schluessel).replace(/^spotify:/, ''), v.titelNr, v.positionMs || 0))
      await schlaf(vorlaufS * 1000)
      console.log(zeile(t0, await ablesen(), 'Vorlauf LAEUFT — jetzt kommt der Tipp'))
      console.log('--- Vorlauf Ende ---\n')
    }

    if (flag('--vorspiel')) {
      // DEN VERDACHT STELLEN: erst etwas LOKALES/anderes laufen lassen und
      // anhalten. Bleibt danach ein alter Stand in /player/local stehen,
      // gewinnt in `jetztLaeuft` der lokale Zweig — und die Anzeige zeigt
      // „steht", waehrend Spotify spielt.
      console.log('\n--- Vorspiel: etwas starten und wieder anhalten ---')
      const v = zeilen.find((x) => x.typ === 'spotify' && x.schluessel && x.schluessel !== e.schluessel)
      if (v) {
        const vw = liste.find((x) => x.schluessel === v.schluessel)
        const vtyp = vw && { album: 'album', playlist: 'playlist', show: 'show' }[vw.art]
        if (vtyp) {
          await befehl(spotifyBefehl(vtyp, String(v.schluessel).replace(/^spotify:/, ''), v.titelNr, v.positionMs || 0))
          await schlaf(6000)
          console.log(zeile(t0, await ablesen(), 'Vorspiel laeuft'))
          await befehl('pause')
          await schlaf(2000)
          console.log(zeile(t0, await ablesen(), 'Vorspiel angehalten'))
        }
      }
      console.log('--- Vorspiel Ende ---\n')
    }

    if (!flag('--kein-stopp')) {
      const s = await befehl('stop')
      console.log(`\n>>> stop geschickt (HTTP ${s.status}, ${s.ms} ms)`)
      // DIE INTERESSANTE STELLE: direkt nach dem stop ablesen. Der echte Tipp
      // ruft hier `lokalHolen()`/`dienstHolen()` (aus `starte`) — was die Box
      // JETZT meldet, landet also wirklich in der Anzeige.
      console.log(zeile(t0, await ablesen(), 'unmittelbar nach stop'))
    }

    // DIE ATEMPAUSE, um die es geht. `stop()` im Abspieldienst ruft
    // `spotifyApi.pause()` und wartet das Versprechen NICHT ab — es antwortet
    // sofort 200. Der Startbefehl loest also einen ZWEITEN Netzaufruf an
    // Spotify aus, waehrend der erste noch unterwegs ist. Mit --warten laesst
    // sich messen, ob ein Abstand den Wettlauf aufloest.
    const wartenMs = Number(opt('--warten', '0'))
    if (wartenMs > 0) {
      console.log(`>>> ${wartenMs} ms Atempause zwischen stop und Start`)
      await schlaf(wartenMs)
      console.log(zeile(t0, await ablesen(), 'nach der Atempause'))
    }

    const r = await befehl(cmd)
    console.log(`\n>>> Start geschickt (HTTP ${r.status}, ${r.ms} ms)\n`)
    console.log(`    (erwartete Stelle: ${e.positionMs} ms — trifft der Start sie?)\n`)

    // Die Tonmessung laeuft NEBENHER: sie braucht mindestens 3 s, und in
    // dieser Zeit soll weiter abgelesen werden. Erst nach der Schleife wird
    // sie eingesammelt.
    const tonSpaeter = flag('--ton') ? (async () => (await schlaf(6000), tonPegel(4)))() : null

    const bis = Date.now() + dauerS * 1000
    while (Date.now() < bis) {
      const a = await ablesen()
      spur.push(a)
      console.log(zeile(t0, a))
      await schlaf(TAKT_MS)
    }

    const ton = tonSpaeter ? await tonSpaeter : null
    if (ton) console.log(`\n>>> TON am Lautsprecher (6 bis 10 s nach dem Start): ${ton.text}`)

    // ── Urteil ──────────────────────────────────────────────────────────
    console.log('\n══ URTEIL ══')
    const spielt = spur.filter((a) => a.np && a.np.laeuft)
    const stehtAberTitel = spur.filter((a) => a.np && !a.np.laeuft)
    const nichts = spur.filter((a) => !a.np)
    console.log(`  Ablesungen gesamt:            ${spur.length}`)
    console.log(`  „laeuft" (Pause-Symbol):      ${spielt.length}`)
    console.log(`  Titel da, aber „steht":       ${stehtAberTitel.length}   <- DAS ist der gemeldete Fehler`)
    console.log(`  gar nichts (Leiste weg):      ${nichts.length}`)
    const zweige = new Set(spur.filter((a) => a.np).map((a) => a.np.zweig))
    console.log(`  benutzte Zweige:              ${[...zweige].join(', ') || '(keiner)'}`)
    const ersteLaeuft = spur.findIndex((a) => a.np && a.np.laeuft)
    if (ersteLaeuft >= 0) console.log(`  erste „laeuft"-Ablesung nach: ${spur[ersteLaeuft].t - t0} ms`)
    else console.log('  NIE „laeuft" gemeldet — der Fehler steht.')
    const ohneDauer = spur.filter((a) => a.np && !(a.np.dauer > 0))
    console.log(`  ohne brauchbare Dauer:        ${ohneDauer.length}   (dann ist der Balken zwingend 0 %)`)
    if (ton) {
      console.log(`  Ton am Lautsprecher:          ${ton.text}`)
      if (ton.pegel !== null && ton.pegel >= 0.01 && stehtAberTitel.length > 0) {
        console.log('  ==> TON JA, ANZEIGE NEIN — der gemeldete Fehler, am GERAET belegt.')
      } else if ((ton.pegel === null || ton.pegel < 0.01) && stehtAberTitel.length > 0) {
        console.log('  ==> Es spielt gar NICHT. Dann ist die Anzeige ehrlich und der Fehler liegt im START.')
      }
    }
  } finally {
    // ZURUECKSTELLEN — der Benutzer schlaeft, morgens darf nichts laufen.
    const s = await befehl('stop')
    console.log(`\n>>> zurueckgestellt: stop (HTTP ${s.status})`)
  }
}

main().catch((e) => {
  console.error('FEHLER:', e.message)
  process.exit(1)
})
