#!/usr/bin/env node
/**
 * GEHT DIE MARKE „SPIELT GERADE" BEIM TITELWECHSEL MIT — JE DIENST?
 *
 * ══ WOZU DIESES WERKZEUG NEBEN tools/lane-marke-wandert.mjs ════════════════
 *
 * `lane-marke-wandert.mjs` beantwortet dieselbe Frage, aber NUR fuer Spotify:
 * Es stellt den Titelwechsel ueber `/vorschau/spotify-weiter` und liest
 * `item.uri` aus `/player/state`. Das ist der einzige Dienst, bei dem es eine
 * Kennung des laufenden STUECKS gibt.
 *
 * Genau darin liegt aber die gemeldete Beobachtung (BACKLOG F2, „beim wechsel
 * des titels geht die marke spielt gerade nicht mit"): Die Box spielt auch
 * ueber mpv — Jellyfin, ARD Audiothek, lokale Dateien. Ein Werkzeug, das nur
 * den Spotify-Weg stellt, meldet gruen und hat den halben Alltag der Box nie
 * angesehen. Das ist dieselbe Sorte Luege durch Weglassen wie in
 * [attrappe-luegt-durch-weglassen], nur eine Ebene hoeher: nicht die Attrappe
 * laesst etwas weg, sondern die MESSUNG.
 *
 * WARNUNG AN DEN NAECHSTEN, weil sie hier schon Zeit gekostet hat:
 * `tools/raster-marke-schau.mjs` prueft, ob die Marke sich BEWEGT (die
 * tanzenden Balken), NICHT ob sie beim Titelwechsel MITGEHT. Zwei Fragen, zwei
 * aehnliche Namen. Gruen dort beweist hier nichts.
 *
 * ══ WAS ES AENDERT ════════════════════════════════════════════════════════
 *
 * Nichts an der Box. Eigener headless-Browser gegen die Vorschau; die
 * geliehene Lage wird im `finally` zurueckgelegt (tools/leihgabe.mjs).
 *
 * ══ DIE FUENF FAELLE, UND WARUM ES FUENF SIND ═════════════════════════════
 *
 *   1. spotify-album-in-playlist   Das Album INNERHALB einer Playlist —
 *      die einzige Stelle, an der es ueberhaupt Titelkacheln mit Kennung gibt.
 *      Titelwechsel ueber /vorschau/spotify-weiter.
 *   2. spotify-album-als-werk      Ein Werk der Art `album` mit Dienst
 *      spotify („Die drei ???"). Hier wird NICHT getippt (siehe dort) — die
 *      Marke muss ohne Sitzungsgedaechtnis auf der RASTER-Kachel sitzen.
 *   3. jellyfin-album              Dasselbe, aber ueber mpv. Titelwechsel
 *      ueber /vorschau/mpv-weiter (`currentTracknr`).
 *
 * SEIT E112 (31.08.2026) KLAPPT EINE ALBUM-KACHEL AUF. Hier stand an zwei
 * Stellen als Praemisse „ein Album klappt im Raster NICHT auf" — das galt bis
 * dahin und gilt nicht mehr: `albumTitelLaneOeffnen` zeigt jetzt die Titel,
 * und der Start wohnt im `.tipp-spiel` auf dem Cover. Fall 3 startet deshalb
 * ausdruecklich UEBER DEN KNOPF. Was diese Datei NICHT misst und was in
 * BACKLOG.md unter E112 offen steht: ob die Marke in DIESER neuen Lane
 * mitwandert — ihre Kacheln tragen (noch) kein `data-spielt`.
 *   4. ard-sendung                 Die einzige mpv-Quelle MIT aufklappbarer
 *      Titel-Lane (app.js `folgenOeffnen`, seit 05.08.2026).
 *   5. die GEGENPROBE              Traeger da (Spotify-Lane offen, zehn
 *      Kacheln mit Kennung), aber mpv uebernimmt den Ton (Lage `nachlauf`).
 *      Ohne diesen Fall bliebe offen, ob die fehlende Marke bei 3 und 4 nur
 *      am fehlenden Merkmal haengt oder auch am Vergleich.
 *
 * ACHTUNG, KLEBRIGE LAGE: Fall 2 stellt `kontext-…`, und das setzt sich von
 * selbst NICHT zurueck. Jeder Fall danach stellt deshalb ausdruecklich
 * `kontext-standard` — sonst misst er gegen einen Zusammenhang, den ein
 * frueherer Fall hinterlassen hat. Genau das ist hier am 05.08.2026 einmal
 * passiert: Fall 5 meldete „vorher keine Marke", und das sah aus wie ein
 * Befund, war aber der Nachhall von Fall 2.
 *
 * ══ WAS GEMESSEN WIRD, UND IN WELCHER REIHENFOLGE ═════════════════════════
 *
 *   a) TRAEGT die Titelkachel ueberhaupt `data-spielt`? Ohne das Merkmal
 *      kann `spieltMarkieren()` sie gar nicht treffen — dann ist „die Marke
 *      geht nicht mit" kein Vergleichsfehler, sondern ein fehlender Traeger.
 *      Diese Frage MUSS vor der zweiten kommen, sonst liest man ein „keine
 *      Marke" als falschen Vergleich.
 *   b) Welche Kacheln sind VOR dem Titelwechsel markiert?
 *   c) Hat sich der laufende Titel wirklich geaendert? (item.uri bei Spotify,
 *      currentTracknr bei mpv — sonst prueft der Schritt nichts.)
 *   d) Welche Kacheln sind DANACH markiert?
 *
 * ══ WAS DIESE VORSCHAU NICHT KANN, UND WAS DARAUS FOLGT ═══════════════════
 *
 * `/player/local` der Attrappe meldet IMMER denselben Namen („Folge 3 — Die
 * Maus", mit `mpv-fremd`: „Kiddinx — Lied 2"). Einen Jellyfin-Titel bei Namen
 * kann sie nicht melden. Die Oberflaeche prueft aber mit `passtZuLaufendem`,
 * ob das gestartete Werk zum Gehoerten passt — Titel ODER Interpret muessen
 * im gemeldeten Namen vorkommen. Deshalb:
 *
 *   Jellyfin „Benjamin Bluemchen" (Interpret Kiddinx) -> `mpv-fremd`
 *            meldet Album „Kiddinx", der Interpret trifft.
 *   ARD „MausHörspiel kurz" (Interpret Die Maus)      -> die Vorgabe meldet
 *            Album „Die Maus", der Interpret trifft.
 *
 * Das ist KEIN Kunstgriff, der das Ergebnis schoenfaerbt: Es stellt genau den
 * Fall her, in dem die Marke ueberhaupt eine Chance hat. Faellt sie AUCH dann
 * aus, liegt es nicht am Waechter.
 *
 * AUFRUF
 *     node tools/marke-titelwechsel-je-dienst.mjs
 *     node tools/marke-titelwechsel-je-dienst.mjs http://127.0.0.1:8371/neu/
 *     node tools/marke-titelwechsel-je-dienst.mjs --pruefen   # Ende 1 bei Abweichung
 */
import WebSocket from 'ws'
import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'

const ZIEL = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8299/neu/'
const PRUEFEN = process.argv.includes('--pruefen')

const warte = (ms) => new Promise((r) => setTimeout(r, ms))
const stellen = (was) => fetch(new URL(`/vorschau/${was}`, ZIEL)).then((r) => r.json())

let fehler = 0
const melde = (z) => {
  fehler++
  console.error(`  FEHLER  ${z}`)
}
const zeile = (n, w) => console.log(`  ${String(n).padEnd(40)} ${w}`)

/**
 * WAS DIE OBERFLAECHE GERADE MARKIERT — an ALLEN drei Orten zugleich.
 *
 * `hatMerkmal` wird getrennt von `kennung` gefuehrt: Eine Kachel OHNE
 * `data-spielt` und eine Kachel MIT leerer Kennung sehen im Ergebnis gleich
 * aus, sind aber zwei verschiedene Befunde. `spieltMarkieren()` sieht nur
 * Elemente mit dem Merkmal ueberhaupt an (`querySelectorAll('[data-spielt]')`).
 *
 * GELESEN WERDEN KLASSE UND PUNKT: `spielt` und der eingehaengte
 * `.spielt-marke` werden getrennt gesetzt; nur eines zu lesen uebersaehe den
 * Fall, in dem sie auseinanderlaufen.
 *
 * KEINE BACKTICKS IN DIESEM BLOCK — er steht selbst in einem Schablonenliteral.
 */
const LESEN = `(() => {
  const nimm = (k) => ({
    titel: ((k.querySelector('.lane-titel') || k.querySelector('.kachel-titel')) || {}).textContent || '',
    kennung: k.dataset.spielt || '',
    hatMerkmal: 'spielt' in k.dataset,
    spielt: k.classList.contains('spielt'),
    punkt: !!k.querySelector('.spielt-marke'),
  })
  const lane = [...document.querySelectorAll('.lane-kachel')]
  return {
    raster: [...document.querySelectorAll('#raster > .kachel')].map(nimm),
    stuecke: lane.filter((k) => k.classList.contains('stueck')).map(nimm),
    alben: lane.filter((k) => !k.classList.contains('stueck')).map(nimm),
  }
})()`

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

const leihe = await vorschauLeihen(ZIEL)
const brw = await eigenerBrowser({ fenster: '800,480' }).catch(async (e) => {
  await leihe.zurueckgeben()
  console.error(`  Browser kam nicht hoch — Messung nicht moeglich: ${e.message}`)
  process.exit(2)
})
if (!brw) {
  await leihe.zurueckgeben()
  console.log('  kein Browser gefunden — uebersprungen')
  process.exit(0)
}

try {
  await warte(1200)
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value

  /** Eine Raster-Kachel bei ihrem Namen antippen. */
  /**
   * Eine Raster-Kachel antippen.
   *
   * @param ueberKnopf SEIT E112 (31.08.2026) MUSS DER AUFRUFER SAGEN, WAS ER
   *   WILL. Bis dahin war „Kachel antippen" bei einem ALBUM dasselbe wie
   *   „starten"; seither klappt eine Album-Kachel ihre TITEL auf und traegt
   *   den Start in einem eigenen `.tipp-spiel` (wie Playlist und ARD schon
   *   vorher). Fall 3 will STARTEN und nimmt deshalb `true`; Fall 4 will
   *   OEFFNEN und laesst es weg. Ein pauschaler Vorrang fuer den Knopf waere
   *   der stille Fehler: Fall 4 haette dann die ARD-Sendung gestartet statt
   *   ihre Folgen-Lane aufzuklappen, und die Messung haette an einer Lane
   *   gewartet, die es nicht gibt.
   */
  const tippeRaster = (titel, ueberKnopf = false) =>
    ev(`(() => {
      const k = [...document.querySelectorAll('#raster > .kachel')]
        .find((e) => ((e.querySelector('.kachel-titel') || {}).textContent || '') === ${JSON.stringify(titel)})
      if (!k) return false
      const knopf = ${ueberKnopf ? "k.querySelector('.tipp-spiel')" : 'null'}
      ;(knopf || k).click()
      return true
    })()`)

  /**
   * Zu einem Werk hinfinden — notfalls durch ein Regal hindurch.
   *
   * WARUM DAS NOETIG IST: Ein Interpret mit mehr als einem Werk steht im
   * Raster als REGAL, nicht mit seinen Werken einzeln. „Benjamin Bluemchen"
   * und „Bibi Blocksberg" gehoeren beide zu „Kiddinx" und sind deshalb erst
   * hinter einem Tipp zu sehen. Wer das uebersieht, bekommt „keine Kachel
   * gefunden" und haelt die Vorschau fuer kaputt.
   */
  const hinfinden = async (titel, regal, ueberKnopf = false) => {
    if (await tippeRaster(titel, ueberKnopf)) return true
    // DAS REGAL WIRD IMMER UEBER DIE KACHEL GEOEFFNET: Es traegt gar keinen
    // `.tipp-spiel`, sondern eine `.regal-zahl` (app.css, „unten rechts").
    if (regal && (await tippeRaster(regal))) {
      await warte(900)
      if (await tippeRaster(titel, ueberKnopf)) return true
    }
    return false
  }

  const zurueckAufsRaster = async () => {
    await ev(`(() => {
      const z = document.getElementById('regal-zu') || document.getElementById('zurueck')
      if (z) z.click()
      return true
    })()`)
    await warte(600)
  }

  /** Der laufende Titel, aus der Attrappe gelesen — NICHT aus app.js. */
  const laeuftGerade = async () => {
    const st = await (await fetch(new URL('/player/state', ZIEL))).json().catch(() => null)
    const lo = await (await fetch(new URL('/player/local', ZIEL))).json().catch(() => null)
    return {
      spotifyUri: String(st?.item?.uri || ''),
      kontext: String(st?.context?.uri || ''),
      mpvNr: lo && lo.currentPlayer === 'mplayer' ? (lo.currentTracknr ?? null) : null,
      mpvName: String(lo?.currentTrackname || ''),
      mpvAlbum: String(lo?.album || ''),
    }
  }

  /**
   * WAS DIE SEITE WIRKLICH AN DEN SPIELER GESCHICKT HAT.
   *
   * WARUM DAS NICHT WEGGELASSEN WERDEN DARF: Die Raster-Marke allein beweist
   * KEINE Wiedergabe. `albumSpielen` setzt `zuletztGestartet = w` schon,
   * sobald die Titelliste da und nicht leer ist (NewDesign/app.js:4189) — also
   * VOR dem ersten Befehl. Eine Messung, die daraus „es laeuft" liest, koennte
   * einen misslungenen Start fuer einen gelungenen halten und danach ueber
   * eine Marke urteilen, die zu gar keinem Ton gehoert.
   *
   * Die Attrappe schreibt jeden Spielerbefehl mit (`/vorschau/befehle`).
   * Gezaehlt werden nur die STARTENDEN und die springenden — ein `stop` oder
   * ein `volume` beweist nichts.
   */
  const gesendet = async () => {
    const d = await (await fetch(new URL('/vorschau/befehle', ZIEL))).json().catch(() => ({ befehle: [] }))
    // `pfad` UND NICHT `befehl`: Das Protokoll fuehrt unter `befehl` nur das
    // LETZTE Glied des Weges („Folge 1:title:artist:Pruefung"), unter `pfad`
    // den ganzen („/player/current/jellyfin/<strom>/Folge 1:…"). Wer nach
    // „jellyfin" im letzten Glied sucht, findet nie etwas und meldet „es ging
    // kein Befehl hinaus", obwohl dreizehn hinausgingen. Hier am 05.08.2026
    // prompt passiert — und es sah aus wie ein Befund ueber die Oberflaeche.
    const alle = (d.befehle || []).map((b) => String(b.pfad || b.befehl || b))
    return alle.filter((b) => /\/(spotify|jellyfin|jfqueue|ard|ardqueue)\/|\/(tracknr|seekpos):/.test(b))
  }

  const markiert = (liste) => liste.filter((k) => k.spielt || k.punkt)
  const namen = (liste) => markiert(liste).map((k) => `„${k.titel.trim()}"`).join(', ') || '— KEINE —'

  const messe = async (wann) => {
    const l = await laeuftGerade()
    const d = await ev(LESEN)
    const mitMerkmal = d.stuecke.filter((s) => s.hatMerkmal).length
    zeile(
      `${wann}: was laeuft (Attrappe)`,
      l.spotifyUri ? `spotify ${l.spotifyUri}` : `mpv Nr. ${l.mpvNr} — „${l.mpvName}" / „${l.mpvAlbum}"`,
    )
    zeile(`${wann}: Titelkacheln in der Lane`, `${d.stuecke.length} — davon ${mitMerkmal} mit data-spielt`)
    zeile(`${wann}: markierte Titelkacheln`, namen(d.stuecke))
    zeile(`${wann}: markierte Albumkacheln`, namen(d.alben))
    zeile(`${wann}: markierte Raster-Kacheln`, namen(d.raster))
    for (const m of [...markiert(d.stuecke), ...markiert(d.alben), ...markiert(d.raster)]) {
      if (m.spielt !== m.punkt) melde(`${wann}: „${m.titel.trim()}" hat Klasse=${m.spielt} aber Punkt=${m.punkt}`)
    }
    return { ...d, laeuft: l, mitMerkmal }
  }

  // ══ DIE VIER FAELLE ══════════════════════════════════════════════════════
  //
  // JEDER BEGINNT MIT EINEM FRISCHEN SEITENAUFBAU. `zuletztGestartet` und
  // `laufendeFolgen` in app.js sind Sitzungsgedaechtnis; ohne Neuladen truege
  // der zweite Fall das Gedaechtnis des ersten mit sich, und die Marke stuende
  // dann womoeglich aus dem falschen Grund richtig.
  const faelle = [
    {
      name: '1. SPOTIFY — Album INNERHALB einer Playlist (die einzige Lane mit Kennungen)',
      lagen: ['voll', 'alben-voll', 'mpv-eigen', 'kontext-standard', 'spotify'],
      oeffnen: async () => {
        if (!(await hinfinden('Bibi Blocksberg', 'Kiddinx'))) return 'weder Werk noch Regal im Raster'
        await warte(1500)
        const auf = await ev(`(() => {
          const k = document.querySelector('#raster > .lane > .lane-reihe > .lane-kachel')
          if (k) k.click()
          return !!k
        })()`)
        if (!auf) return 'die Album-Lane ist nicht aufgegangen'
        await warte(1500)
        return null
      },
      weiter: 'spotify-weiter',
      schritte: ['im selben Album', 'ueber die Albumgrenze'],
    },
    {
      name: '2. SPOTIFY — ein Werk der Art `album` („Die drei ???")',
      // `kontext-…` stellt `context.uri` auf die Kennung DIESES Werks. Damit
      // erkennt `laufendesWerkMitBeweis` (Stufe 1) es ohne jeden Tipp — der
      // Fall „jemand hat vom Telefon gestartet", und zugleich der einzige, in
      // dem die Marke ohne Sitzungsgedaechtnis sitzt.
      lagen: ['voll', 'mpv-eigen', 'spotify'],
      vorher: async () => {
        const w = (await (await fetch(new URL('/api/werke', ZIEL))).json()).werke.find((x) => x.titel === 'Die drei ???')
        if (!w) return 'kein Werk „Die drei ???" in /api/werke'
        const k = String((w.quellen || [])[0]?.kennung || '')
        await stellen(`kontext-spotify:album:${k}`)
        return null
      },
      oeffnen: async () => {
        // NICHT ANTIPPEN: Diese Kachel klappt nicht auf, sie SPIELT. Ein Tipp
        // wuerde `zuletztGestartet` setzen und damit die Frage verwischen, ob
        // die Marke auch ohne Sitzungsgedaechtnis sitzt.
        return null
      },
      weiter: 'spotify-weiter',
      schritte: ['naechster Titel'],
    },
    {
      name: '3. JELLYFIN — Album „Benjamin Bluemchen" (laeuft ueber mpv)',
      mussStarten: true,
      // `mpv-fremd` meldet Album „Kiddinx" — der Interpret dieses Werks.
      // Ohne das sagt `passtZuLaufendem` nein und es gaebe ueberhaupt keine
      // Marke; dann waere nicht zu unterscheiden, ob der Waechter oder der
      // Vergleich der Grund ist.
      lagen: ['voll', 'spielt', 'mpv-fremd', 'kontext-standard', 'mpv-erste'],
      oeffnen: async () => {
        if (!(await hinfinden('Benjamin Bluemchen', 'Kiddinx', true))) return 'weder Werk noch Regal im Raster'
        // GESTARTET WIRD UEBER DEN PLAY-KNOPF (`true` oben), seit E112
        // (31.08.2026): Ein Tipp auf die KACHEL klappt bei einem Album jetzt
        // die Titel auf, statt zu starten — hier stand deshalb bis dahin „Ein
        // Tipp auf diese Kachel STARTET". Danach steht `zuletztGestartet`.
        await warte(2500)
        return null
      },
      weiter: 'mpv-weiter',
      schritte: ['mpv rueckt eine Folge vor'],
    },
    {
      name: '4. ARD — Sendung „MausHörspiel kurz" (Folgen-Lane, laeuft ueber mpv)',
      mussStarten: true,
      lagen: ['voll', 'spielt', 'mpv-eigen', 'kontext-standard', 'mpv-erste'],
      oeffnen: async () => {
        if (!(await hinfinden('MausHörspiel kurz', 'Die Maus'))) return 'die Sendung steht nicht im Raster'
        await warte(2000)
        const auf = await ev(`document.querySelectorAll('#raster > .lane .lane-kachel.stueck').length`)
        if (!auf) return 'die Folgen-Lane ist nicht aufgegangen'
        // DIE ERSTE FOLGE ANTIPPEN — der Weg, den ein Kind geht: Sendung
        // oeffnen, Folge waehlen. Danach steht `zuletztGestartet` und
        // `laufendeFolgen`.
        await ev(`document.querySelector('#raster > .lane .lane-kachel.stueck').click()`)
        await warte(3000)
        return null
      },
      weiter: 'mpv-weiter',
      schritte: ['mpv rueckt eine Folge vor'],
    },
    {
      // ══ DIE GEGENPROBE ZUR ZWEITEN SPERRE ═══════════════════════════════
      //
      // Faelle 3 und 4 zeigen, dass an mpv-Kacheln GAR KEIN `data-spielt`
      // haengt. Damit ist noch nicht bewiesen, dass die Stueck-Marke bei mpv
      // auch dann ausbliebe, wenn der Traeger da waere — und genau das
      // behauptet `laufendeKennungen()` in app.js: Die Stueck-Kennung entsteht
      // nur, wenn `jetztLaeuft()` „spotify" sagt.
      //
      // HIER IST DER TRAEGER DA: Die Spotify-Lane steht offen und alle zehn
      // Titelkacheln tragen ihre Kennung. `nachlauf` laesst mpv spielen,
      // WAEHREND `/player/state` seinen Zusammenhang und sein `item` noch eine
      // Weile weitertraegt ([spotify-nachlauf-muster]). Verschwindet die Marke
      // dabei, obwohl `item.uri` unveraendert dasteht, dann liegt es an der
      // Herkunft des Tons — und nicht am fehlenden Merkmal.
      name: '5. GEGENPROBE — Traeger da, aber mpv spielt (Lage `nachlauf`)',
      lagen: ['voll', 'alben-voll', 'mpv-eigen', 'kontext-standard', 'spotify'],
      oeffnen: async () => {
        if (!(await hinfinden('Bibi Blocksberg', 'Kiddinx'))) return 'weder Werk noch Regal im Raster'
        await warte(1500)
        const auf = await ev(`(() => {
          const k = document.querySelector('#raster > .lane > .lane-reihe > .lane-kachel')
          if (k) k.click()
          return !!k
        })()`)
        if (!auf) return 'die Album-Lane ist nicht aufgegangen'
        await warte(1500)
        return null
      },
      weiter: 'nachlauf',
      schritte: ['mpv uebernimmt, item.uri bleibt stehen'],
    },
  ]

  for (const f of faelle) {
    console.log(`\n\n══ ${f.name}`)
    for (const l of f.lagen) await stellen(l)
    if (f.vorher) {
      const g = await f.vorher()
      if (g) {
        melde(`${f.name}: ${g}`)
        continue
      }
    }
    // FRISCHES PROTOKOLL JE FALL, sonst zaehlte der zweite die Befehle des
    // ersten mit — und „es wurde gestartet" waere wieder nur wahrscheinlich.
    await stellen('befehle-leeren')
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warte(2800)
    const grund = await f.oeffnen()
    if (grund) {
      melde(`${f.name}: ${grund}`)
      continue
    }
    const befehle = await gesendet()
    zeile(
      'an den Spieler geschickt',
      befehle.length ? `${befehle.length} Befehle, erster: ${befehle[0].slice(0, 60)}` : '— KEINE —',
    )
    // Faelle 3 und 4 leben davon, dass wirklich etwas gestartet wurde. Faelle
    // 1, 2 und 5 starten ABSICHTLICH nichts (dort meldet die Attrappe die
    // Wiedergabe von sich aus) — dort waere ein Befehl der Fehler.
    if (f.mussStarten && !befehle.length) {
      melde(`${f.name}: es ging KEIN Startbefehl hinaus — die Marke haette gar nichts zu zeigen`)
    }

    console.log('  ── vor dem Titelwechsel ────────────────────────────────')
    let vorher = await messe('vorher')

    for (const schritt of f.schritte) {
      await stellen(f.weiter)
      // Der Takt ist 2 s; Zugabe, damit ein langsamerer Weg nicht als Fehler
      // gemeldet wird.
      await warte(4000)
      console.log(`\n  ── nach dem Wechsel (${schritt}) ──────────────────────`)
      const nachher = await messe('nachher')

      const gewechselt =
        vorher.laeuft.spotifyUri !== nachher.laeuft.spotifyUri || vorher.laeuft.mpvNr !== nachher.laeuft.mpvNr
      if (!gewechselt) {
        melde(`${f.name}: die Vorschau hat den Titel gar nicht gewechselt — dieser Schritt prueft nichts`)
        vorher = nachher
        continue
      }

      // DAS URTEIL — in dieser Reihenfolge, weil die erste Frage die zweite
      // beantwortet: Ohne Traeger gibt es nichts zu vergleichen.
      if (nachher.stuecke.length && !nachher.mitMerkmal) {
        zeile(
          '  BEFUND',
          `${nachher.stuecke.length} Titelkacheln, KEINE traegt data-spielt — ` +
            'die Marke kann auf dieser Ebene gar nicht sitzen',
        )
      } else if (!nachher.stuecke.length) {
        zeile('  BEFUND', 'es gibt hier ueberhaupt keine Titelkacheln (die Kachel klappt nicht auf)')
      } else {
        const v = markiert(vorher.stuecke).map((k) => k.titel.trim()).join(', ')
        const n = markiert(nachher.stuecke).map((k) => k.titel.trim()).join(', ')
        if (n && n !== v) zeile('  BEFUND', `die Marke ist gewandert: „${v}" -> „${n}"`)
        else if (!n && !v) zeile('  BEFUND', 'weder vorher noch nachher eine Titelmarke')
        else if (n === v) zeile('  BEFUND', `die Marke steht STILL auf „${v}" — der Titel hat gewechselt`)
        else zeile('  BEFUND', `die Marke ist VERSCHWUNDEN (vorher „${v}")`)
      }
      const rv = markiert(vorher.raster).map((k) => k.titel.trim()).join(', ')
      const rn = markiert(nachher.raster).map((k) => k.titel.trim()).join(', ')
      zeile('  Raster-Marke', rv === rn ? `unveraendert: ${rn || '— keine —'}` : `${rv || '—'} -> ${rn || '—'}`)
      vorher = nachher
    }
    await zurueckAufsRaster()
  }
} finally {
  // IM `finally`: Ein Werkzeug, das nur auf dem gruenen Weg aufraeumt, laesst
  // die geliehene Vorschau gerade dann verstellt stehen, wenn es einen Fehler
  // gefunden hat — also genau dann, wenn als naechstes jemand hinsieht.
  // `mpv-fremd` und `kontext-` sind KLEBRIGE Felder (siehe leihgabe.mjs).
  await brw.schliessen()
  await leihe.zurueckgeben()
}

console.log('')
process.exit(PRUEFEN && fehler ? 1 : 0)
