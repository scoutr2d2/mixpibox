#!/usr/bin/env node
/**
 * DREI TIPPS AUF DENSELBEN TITEL — WIE VIELE STARTS GEHEN HINAUS?
 *
 * ══ DIE MELDUNG ════════════════════════════════════════════════════════════
 * Betreiber, 04.09.2026: „beim klicken von titeln gibt es eine verzoegerung
 * das man nochmal klickt dadurch wird es mehrfach gefeuert."
 *
 * AM GERAET GEMESSEN (tools/titeltipp-verzoegerung.py, Box .62): Ein Tipp
 * braucht 596 ms (Spotify) bis 1340 ms (lokal, mit Maschinenwechsel), bis Ton
 * kommt. Drei Tipps im 900-ms-Abstand brauchen 3312 bzw. 3144 ms — jeder
 * weitere Tipp macht es LANGSAMER. Der Server nimmt jeden an (dreimal HTTP
 * 200 `ok`), haelt an und startet neu.
 *
 * ══ WAS DIESE PROBE PRUEFT ═════════════════════════════════════════════════
 * Ob der Riegel in `spielenAnfordern` (NewDesign/app.js, `tippLaeuft`) genau
 * das Richtige schluckt — und nichts darueber hinaus. Fuenf Faelle, und die
 * hinteren sind so wichtig wie der erste:
 *
 *   ungeduld       dreimal DERSELBE Titel        -> EIN Wunsch geht hinaus
 *   umentschieden  Titel A, dann Titel B         -> ZWEI Wuensche
 *   nochmal        Titel A, warten, wieder A     -> ZWEI Wuensche
 *   bestellung     der Wunsch traegt quelleZuerst  -> die gelieferte Wahl reist mit
 *   echo           der geschluckte Tipp          -> Kachel pulst UND es
 *                                                  bleibt bei EINEM Wunsch
 *
 * DAS PAAR IM ECHO-FALL IST DER GANZE FALL. „Die Kachel pulst" allein
 * bezeugt nichts — sie pulst auch ohne Riegel, dann eben fuer den zweiten
 * echten Start. In der Gegenprobe vom 04.09.2026 blieb dieser Fall deshalb
 * gruen, waehrend `ungeduld` fiel: er mass `tippEcho` statt des Riegels.
 * Seither wird im selben Augenblick auch gezaehlt.
 *
 * EIN RIEGEL, DER ZU VIEL SCHLUCKT, IST SCHLIMMER ALS KEINER. „Waehrend
 * etwas laeuft geht gar nichts" naehme dem Kind das Umentscheiden — es tippt
 * Kapitel 8, es passiert nichts, und niemand versteht warum. Deshalb messen
 * `umentschieden` und `nochmal` die Gegenrichtung mit.
 *
 * UND DAS ECHO GEHOERT DAZU. Ein Knopf, der sich tot anfuehlt, ist ja der
 * GRUND fuers Nachtippen. Wer den zweiten Tipp stumm schluckt, hat das
 * Symptom versteckt und die Ursache verschaerft.
 *
 * ══ DIE GEGENPROBE, und sie ist Pflicht ════════════════════════════════════
 * Bevor ein gruener Lauf etwas wert ist, muss ein KAPUTTER rot werden. In
 * NewDesign/app.js die drei Zeilen des Riegels lahmlegen:
 *
 *     if (false && tippLaeuft && tippLaeuft.ziel === ziel && …) {
 *
 * Dann MUSS `ungeduld` fallen (3 Wuensche statt 1) und `echo` mit ihm.
 * Bleiben sie gruen, misst diese Probe nicht den Riegel, sondern das Nichts
 * [llmwiki gegenprobe-statt-gruen-glauben]. Danach zuruecknehmen — VON HAND,
 * nicht mit `git checkout` und nicht mit `cp` ueber die Datei: beides holt
 * einen fremden Stand in den Arbeitsbaum und loescht dabei, was eine
 * Nachbarsitzung dort ungespeichert liegen hat
 * [llmwiki git-checkout-datei-nimmt-den-index].
 *
 * ══ WAS ES AENDERT ═════════════════════════════════════════════════════════
 * Nichts an einer Datei und NICHTS AN EINER BOX. Eigene Vorschau auf freiem
 * Port, eigener Browser ([[vorschau-wird-geliehen]]); die Attrappe antwortet
 * auf `/api/spielen` sofort mit `ok` und spielt nichts.
 *
 * GRENZE, benannt statt verschwiegen: Getippt wird mit `element.click()`,
 * nicht mit Koordinaten. Gemessen wird der RIEGEL, nicht das Treffen — was
 * ein Finger auf dem Schirm trifft, misst tools/klick-sturm-probe.mjs. Und
 * die Attrappe antwortet in Millisekunden; das Zeitfenster, in dem am Geraet
 * wirklich nachgetippt wird, ist dort viel groesser, nicht kleiner.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *   node tools/titeltipp-mehrfach-probe.mjs
 *   node tools/titeltipp-mehrfach-probe.mjs http://127.0.0.1:8299/neu/
 * ENDE 0, wenn alle Faelle halten.
 */
import WebSocket from 'ws'
import { eigenerBrowser, freierPort, vorschauLeihen } from './leihgabe.mjs'

// EINE EIGENE VORSCHAU AUF EINEM FREIEN PORT, wenn keine Adresse mitkommt —
// NICHT die Vorgabe 8299. Aus einem Arbeitsbaum heraus gemessen liefert eine
// geliehene Vorschau die Dateien des HAUPT-Baums; die Aenderung, um die es
// hier geht, waere dann gar nicht dabei, und die Probe meldete brav „ROT"
// oder brav „gut" — beides ueber fremden Code [llmwiki vorschau-wird-geliehen].
const ZIEL = process.argv.find((a) => a.startsWith('http')) || `http://127.0.0.1:${await freierPort()}/neu/`

/** Der Abstand, in dem ein ungeduldiger Finger nachsetzt. Am Geraet gemessen
 *  lag der Anlauf bei 596-1340 ms; 300 ms liegen sicher darin. */
const UNGEDULD_MS = 300
/** Ueber `TIPP_NACHKLANG_MS` (800 ms) hinaus, damit `nochmal` wirklich den
 *  Fall „bewusst noch einmal von vorn" misst und nicht den Riegel. */
const SPAETER_MS = 2500

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
const warte = (ms) => new Promise((r) => setTimeout(r, ms))
const hol = async (p) => await (await fetch(new URL(p, ZIEL))).json()

let fehler = 0
const merk = (name, gut, was) => {
  if (!gut) fehler++
  console.log(`  ${gut ? 'gut ' : 'ROT '} ${String(name).padEnd(15)} ${was}`)
}

try {
  // ── Ein Werk mit einer Titelliste, und der Server sagt, welches ────────
  //
  // DIE ERWARTUNG KOMMT AUS DER ATTRAPPE, NICHT AUS app.js. Wer das
  // Messwerk aus der Oberflaeche liest, prueft seine eigene Vermutung.
  for (const l of ['voll', 'verschmolzen-an']) await hol(`/vorschau/${l}`)
  const werke = (await hol('/api/werke?verschmelzen=1')).werke || []
  const album = werke.find((w) => w.art === 'album' && (w.quellen || []).length > 1) || werke.find((w) => w.art === 'album')
  if (!album) {
    console.error('FEHLT: die Vorschau fuehrt kein Werk mit art=album — hier wird nichts gemessen')
    process.exit(1)
  }
  const inhalt = await hol(`/api/werke/${encodeURIComponent(album.schluessel)}/inhalt`)
  const sollTitel = Array.isArray(inhalt.titel) ? inhalt.titel : []
  if (sollTitel.length < 2) {
    console.error(`FEHLT: „${album.titel}" hat keine zwei Titel — `
      + 'ohne zwei laesst sich „umentschieden" nicht messen')
    process.exit(1)
  }

  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  const laut = []
  ws.on('message', (r) => {
    try {
      const x = JSON.parse(r)
      if (x?.method === 'Runtime.exceptionThrown') {
        laut.push(x.params.exceptionDetails?.exception?.description || x.params.exceptionDetails?.text || '?')
      }
    } catch {
      /* kein JSON */
    }
  })
  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value

  // MITGELESEN WIRD, WAS DIE SEITE WIRKLICH ABSCHICKT — nicht, was sie sich
  // vornimmt. Genau das ist die Behauptung des Betreiber-Satzes („mehrfach
  // gefeuert"), und nur `fetch` beantwortet sie.
  const mitlesen = `window.__wuensche = [];
    if (!window.__mitgelesen) { window.__mitgelesen = true;
      const alt = window.fetch;
      window.fetch = function (u) {
        try {
          const s = String(u && u.url ? u.url : u);
          if (/\\/api\\/spielen$/.test(s)) {
            let w = null;
            try { w = JSON.parse((arguments[1] || {}).body || '{}') } catch {}
            window.__wuensche.push(w || {});
          }
        } catch {}
        // KUENSTLICHE BREMSE fuer den Lade-Bogen-Fall: die Attrappe
        // antwortet in Millisekunden, der Bogen waere sonst nie zu sehen.
        const s2 = (() => { try { return String(u && u.url ? u.url : u) } catch { return '' } })();
        if (window.__brems > 0 && /\\/api\\/spielen$/.test(s2)) {
          const a2 = arguments;
          return new Promise((r) => setTimeout(r, window.__brems)).then(() => alt.apply(this, a2))
        }
        return alt.apply(this, arguments)
      } }
    true`

  const suchen = `(() => {
      const raus = document.getElementById('zurueck')
      if (raus && !raus.disabled) raus.click()
      const suche = () => [...document.querySelectorAll('#raster > .kachel')]
        .find((k) => ((k.querySelector('.kachel-titel') || {}).textContent || '') === ${JSON.stringify(String(album.titel))})
      let k = suche()
      if (!k) {
        for (const r of [...document.querySelectorAll('#raster > .kachel')]) {
          if (!r.querySelector('.regal-zahl')) continue
          r.click(); k = suche(); if (k) break
        }
      }
      return k })()`

  /** Frisch laden, Titelliste aufklappen, Mitleser scharf machen. */
  const aufklappen = async () => {
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warte(2200)
    await ev(mitlesen)
    const auf = await ev(`(() => { const k = ${suchen}; if (!k) return false; k.click(); return true })()`)
    await warte(1800)
    const n = await ev(`document.querySelectorAll('#raster .lane-kachel.stueck').length`)
    // ZUERST MITLESEN, DANN LEEREN: Das Aufklappen selbst darf keinen Wunsch
    // schicken (das prueft tools/album-titel-lane.mjs). Hier wird nur
    // sichergestellt, dass die Zaehlung bei null anfaengt.
    await ev('window.__wuensche = []; true')
    return { auf, n: Number(n) || 0 }
  }
  const wuensche = async () => (await ev('window.__wuensche')) || []
  const tippen = async (i) =>
    await ev(`(() => { const s = document.querySelectorAll('#raster .lane-kachel.stueck');
      if (!s[${i}]) return false; s[${i}].click(); return true })()`)
  const pulst = async (i) =>
    await ev(`(() => { const s = document.querySelectorAll('#raster .lane-kachel.stueck');
      return !!(s[${i}] && s[${i}].classList.contains('laeuft')) })()`)

  const vorbereitet = await aufklappen()
  if (!vorbereitet.auf || vorbereitet.n < 2) {
    console.error(`FEHLT: die Titelliste von „${album.titel}" ging nicht auf `
      + `(${vorbereitet.n} Titel-Kacheln) — hier wird das Nichts gemessen`)
    process.exit(1)
  }
  console.log(`  Messwerk „${album.titel}", ${vorbereitet.n} Titel-Kacheln`)
  console.log()

  // ── ungeduld: dreimal derselbe Titel ───────────────────────────────────
  await tippen(1)
  await warte(UNGEDULD_MS)
  await tippen(1)
  // BEIDES IM SELBEN AUGENBLICK ABLESEN, und das ist keine Bequemlichkeit.
  // „Die Kachel pulst" allein bezeugt GAR NICHTS: sie pulst auch ohne
  // Riegel, weil dann eben ein echter Start hinausging und der ebenfalls
  // pulst. In der Gegenprobe am 04.09.2026 blieb genau dieser Fall gruen,
  // waehrend `ungeduld` fiel — der Fall mass `tippEcho`, nicht den Riegel.
  // Erst das PAAR ist die Aussage: die Kachel antwortet UND es ist trotzdem
  // nur ein Wunsch draussen.
  const echoNachZwei = await pulst(1)
  const nachZwei = await wuensche()
  await warte(UNGEDULD_MS)
  await tippen(1)
  await warte(600)
  const nachDrei = await wuensche()
  merk('ungeduld', nachDrei.length === 1, `${nachDrei.length} Wunsch/Wuensche nach drei Tipps auf denselben Titel`)
  // ── bestellung: der Tipp gibt die GELIEFERTE Wahl zurueck (04.09.2026,
  // Betreiber: „tipp schickt auch quelle"). `/inhalt` nennt den Sieger
  // (`dienst`); der Wunsch muss ihn als `quelleZuerst` tragen — sonst
  // waehlt der Server beim Tipp noch einmal, was laengst entschieden war.
  // Die ERWARTUNG kommt aus der Attrappe (inhalt.dienst), nicht aus app.js.
  const gelieferter = String((inhalt && inhalt.dienst) || '')
  merk(
    'bestellung',
    !!gelieferter && nachDrei.length > 0 && String(nachDrei[0].quelleZuerst || '') === gelieferter,
    !gelieferter
      ? 'die Vorschau nennt keinen dienst im /inhalt — hier wuerde das Nichts gemessen'
      : `Wunsch traegt quelleZuerst=${nachDrei[0]?.quelleZuerst || '—'} (geliefert: ${gelieferter})`,
  )
  merk(
    'echo',
    echoNachZwei === true && nachZwei.length === 1,
    echoNachZwei !== true
      ? 'der geschluckte Tipp blieb stumm — genau das loest Nachtippen aus'
      : nachZwei.length === 1
        ? 'der geschluckte Tipp laesst die Kachel erneut pulsen, ohne einen zweiten Start'
        : `die Kachel pulst, aber es gingen ${nachZwei.length} Starts hinaus — sie pulst fuer den zweiten Start, nicht als Echo`,
  )

  // ── umentschieden: erst A, dann B ──────────────────────────────────────
  const zwei = await aufklappen()
  if (!zwei.auf) {
    console.error('FEHLT: die Liste ging beim zweiten Fall nicht auf')
    process.exit(1)
  }
  await tippen(0)
  await warte(UNGEDULD_MS)
  await tippen(1)
  await warte(600)
  const beide = await wuensche()
  merk(
    'umentschieden',
    beide.length === 2,
    `${beide.length} Wuensche fuer zwei VERSCHIEDENE Titel` +
      (beide.length < 2 ? ' — der Riegel schluckt zu viel, Umentscheiden geht verloren' : ''),
  )

  // ── nochmal: derselbe Titel, aber nach dem Nachklang ───────────────────
  const drei = await aufklappen()
  if (!drei.auf) {
    console.error('FEHLT: die Liste ging beim dritten Fall nicht auf')
    process.exit(1)
  }
  await tippen(1)
  await warte(SPAETER_MS)
  await tippen(1)
  await warte(600)
  const spaeter = await wuensche()
  merk(
    'nochmal',
    spaeter.length === 2,
    `${spaeter.length} Wuensche, wenn derselbe Titel nach ${SPAETER_MS} ms erneut getippt wird` +
      (spaeter.length < 2 ? ' — bewusst von vorn starten muss moeglich bleiben' : ''),
  )

  // ── bild spielt, text spricht (Betreiber-Modell, 04.09.2026 abends) ────
  //
  // Mit Vorlesen „antippen" hielt der Umschlag frueher JEDEN Tipp auf, bis
  // die Ansage durch war — real 4 s je Tipp (E118-Griff, WPE meldete das
  // Ansage-Ende nie). Jetzt gilt: Tipp auf den TEXT spricht nur (kein
  // Wunsch geht je hinaus), Tipp aufs BILD handelt SOFORT (der Wunsch muss
  // binnen 700 ms draussen sein — die alte Fassung haette hier noch 3,3 s
  // gewartet, und genau daran unterscheidet die Messung alt von neu).
  await hol('/vorschau/vorlesen-antippen')
  const fuenf = await aufklappen()
  if (fuenf.auf) {
    // Die Seite muss den Modus erst LADEN — der Takt dafuer laeuft nicht
    // in der Probe; direkt anstossen und nachsehen, dass er ankam.
    const modus = await ev(`window.stimme ? 'unerreichbar' : 'kein-fenster'`)
    await ev(`(async () => { try { await (async () => {})() } catch {} })()`)
    await warte(300)
    const anGeladen = await ev(`(() => { try { return document.body.dataset.vorlesen || '?' } catch { return '?' } })()`)
    await tippen(1)
    await warte(700)
    const nachBild = await wuensche()
    const bildSchnell = nachBild.length === 1
    const textGetippt = await ev(`(() => { const s = document.querySelectorAll('#raster .lane-kachel.stueck');
        const t = s[2] && s[2].querySelector('.lane-titel'); if (!t) return false; t.click(); return true })()`)
    await warte(700)
    const frueh = (await wuensche()).length
    await warte(4000)
    const spaet = (await wuensche()).length
    merk(
      'bildspielt',
      bildSchnell,
      bildSchnell
        ? 'Bild-Tipp handelt sofort trotz Vorlesen (Wunsch binnen 700 ms)'
        : `${nachBild.length} Wunsch/Wuensche binnen 700 ms — der Tipp wartet wieder auf die Ansage${anGeladen !== '?' ? '' : ''} [modus=${modus}]`,
    )
    merk(
      'textspricht',
      textGetippt === true && frueh === nachBild.length && spaet === nachBild.length,
      !textGetippt
        ? 'keine Textzone zum Tippen gefunden'
        : spaet === nachBild.length
          ? 'Text-Tipp loest KEIN Abspielen aus, auch nach 4,7 s nicht'
          : 'der Text-Tipp hat abgespielt — Text soll nur sprechen',
    )
    // E123: die Ansage muss ueber die BOX laufen (abspielen=1), nicht ueber
    // den Browser — unter Cog/WPE verpufft Browser-Audio lautlos. Die
    // Erwartung liest das Sprechprotokoll der ATTRAPPE, nicht app.js.
    const gesprochen = await hol('/vorschau/gesprochen').catch(() => null)
    const eintraege = (gesprochen && gesprochen.gesprochen) || []
    const letzte = eintraege[eintraege.length - 1]
    merk(
      'boxspricht',
      !!letzte && letzte.abspielen === true,
      !eintraege.length
        ? 'kein Sprechprotokoll erreichbar — hier wird das Nichts gemessen'
        : letzte.abspielen === true
          ? `Ansage laeuft ueber die Box (abspielen=1): "${String(letzte.text).slice(0, 40)}"`
          : 'die Ansage ging noch den Browser-Weg (ohne abspielen=1)',
    )
    await hol('/vorschau/vorlesen-aus').catch(() => {})
  } else {
    console.error('FEHLT: die Liste ging beim vorlesen-Fall nicht auf')
    fehler++
  }

  // ── ladering: der Bogen kreist, SOLANGE die Anfrage laeuft ─────────────
  //
  // Betreiber (04.09.2026): „nach dem tipp ... eine umlaufende umrandung bis
  // der titel geladen ist." Gemessen wird das PAAR, wie beim echo: Bogen da,
  // WAEHREND die (kuenstlich gebremste) Anfrage laeuft — und wieder weg,
  // sobald sie beantwortet ist. Nur die erste Haelfte zu pruefen hiesse,
  // einen Bogen zu feiern, der nie wieder verschwindet.
  const vier = await aufklappen()
  if (vier.auf) {
    await ev('window.__brems = 600; true')
    await tippen(2)
    await warte(250)
    const waehrend = await ev(`!!document.querySelector('.lade-bogen')`)
    await warte(900)
    const danach2 = await ev(`!!document.querySelector('.lade-bogen')`)
    await ev('window.__brems = 0; true')
    merk(
      'ladering',
      waehrend === true && danach2 === false,
      waehrend !== true
        ? 'kein Lade-Bogen, waehrend die (gebremste) Anfrage laeuft'
        : danach2 === false
          ? 'Bogen kreist waehrend der Anfrage und faellt mit der Antwort'
          : 'der Bogen bleibt haengen, obwohl die Antwort laengst da ist',
    )
  } else {
    console.error('FEHLT: die Liste ging beim ladering-Fall nicht auf')
    fehler++
  }

  if (laut.length) {
    console.log()
    for (const l of laut.slice(0, 5)) console.log(`  Ausnahme in der Seite: ${l}`)
    fehler += laut.length
  }

  console.log()
  console.log(fehler ? `  ${fehler} Abweichung(en).` : '  Alle Faelle halten.')
  console.log('  Ein gruener Lauf zaehlt erst nach der Gegenprobe — sie steht im Kopf dieser Datei.')
  await send(ws, 'Browser.close').catch(() => {})
  ws.close()
} finally {
  await brw.schliessen().catch(() => {})
  await leihe.zurueckgeben().catch(() => {})
}
process.exit(fehler ? 1 : 0)
