#!/usr/bin/env node
/**
 * SPRICHT DIE NEUE OBERFLAECHE? — an der Attrappe, in einem echten Browser.
 *
 * WOZU: Am 03.08.2026 gemessen — `NewDesign/app.js` enthielt keinen einzigen
 * Sprech-Aufruf, waehrend die klassische Oberflaeche spricht. Wer das
 * Vorlesen eingeschaltet hatte und auf die neue Seite wechselte, bekam
 * Stille. Fuer ein Kind, das noch nicht liest, ist das der Unterschied
 * zwischen bedienbar und nicht bedienbar.
 *
 * SPRACHE IST DER EINZIGE AUSGANG DIESER BOX, DER KEIN PIXEL BEWEGT. Ein
 * Bildschirmfoto beweist hier gar nichts; ein Blick in den Quelltext beweist
 * nur, dass Code DASTEHT. Diese Pruefung tippt deshalb wirklich an und liest
 * am Server ab, WAS gesagt worden waere (/vorschau/gesprochen).
 *
 * WAS GEPRUEFT WIRD — sechs Fragen, und jede einzelne war schon einmal die
 * falsche Annahme:
 *   1. AUS ist wirklich aus. Kein Abruf, keine Verzoegerung. Eine Funktion,
 *      die auch ausgeschaltet Zeit kostet, ist ein Rueckschritt fuer alle,
 *      die sie nicht wollen.
 *   2. Ein Tipp spricht — und zwar EINMAL, nicht bei jedem Takt. Die Seite
 *      malt viermal je Sekunde; haenge das Sprechen am Zeichnen, redete die
 *      Box ununterbrochen.
 *   3. Gesagt wird, WAS DER TIPP TUT („öffnen" / „abspielen" /
 *      „weiterhören"), nicht nur der Kachelname. Ausdruecklicher Wunsch des
 *      Benutzers.
 *   4. Die Musik tritt zurueck — UND KOMMT WIEDER. Ein `an` ohne `aus` laesst
 *      die Box fuer immer leise und sieht aus wie ein Defekt. WER
 *      zuruecktreten laesst, ist seit E123 (04.09.2026) offen: entweder die
 *      Box (Ansage mit `abspielen=1`, Daempfung im Server) oder der Browser
 *      (dann `/api/ton/daempfen` an UND aus). Geprueft wird die Sorte, nicht
 *      der Weg — die feste Erwartung „die Seite schickt daempfen" stand hier
 *      bis zum 19.09.2026 und war sechs Wochen lang zwei falsche Rote.
 *   5. Der Lernmodus trennt seit dem 04.09.2026 nach ZONE statt nach Tipp-
 *      Nummer: der TEXT zeigt die Silben gross und spielt NICHTS, das BILD
 *      spielt sofort. Und die Einblendung laesst sich wieder wegtippen —
 *      sonst ist sie eine Sackgasse ueber dem ganzen Bild.
 *   6. Ohne Piper (`bereit: false`) bleibt es still, statt vier Sekunden zu
 *      warten.
 *
 * „SPIELT" HEISST SEIT E95/V STUFE 2 (31.08.2026) in 5. und 6.: Der Tipp
 * stellt EINEN Spielwunsch — `POST /api/spielen` mit dem Schluessel der
 * Kachel. Die Seite baut keine /player-Befehle mehr; welche Befehle aus dem
 * Wunsch werden, entscheidet der Server, und das prueft
 * src/backend-api/src/spielen.integration.spec.ts. Das Befehlsprotokoll der
 * Attrappe (/vorschau/befehle) bleibt hier als DOPPELWEG-Wache stehen: ein
 * /player-Befehl neben dem Wunsch waere ein Rueckfall in den alten Weg.
 *
 * WAS SIE NICHT BEWEIST: dass es GUT KLINGT, dass die Lautstaerke stimmt und
 * dass die Trennung richtig ist. Die Trennregeln gehoeren
 * src/backend-api/src/vorlesen.ts (45 Tests), die Lautstaerke und das Tempo
 * dem Geraet (tools/vorlesen-am-geraet.mjs). Ein Befund von hier ist ein
 * VERDACHT, einer vom Geraet ein BEWEIS.
 *
 * AUFRUF
 *   node tools/neu-sprechen-schau.mjs
 *   node tools/neu-sprechen-schau.mjs --pruefen     # Rueckgabewert 1 bei Abweichung
 */
import WebSocket from 'ws'
import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'

const ZIEL = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8299/neu/'
const PRUEFEN = process.argv.includes('--pruefen')

const warte = (ms) => new Promise((r) => setTimeout(r, ms))

// EINE SCHON LAUFENDE VORSCHAU WIRD GELIEHEN — UND ZURUECKGELEGT.
//
// Wer eine Lage stellt (/vorschau/…), muss sie am Ende wieder hinlegen,
// wenn ihm die Vorschau nicht gehoert: sonst misst der naechste Lauf gegen
// eine Vorschau, die jemand anders verstellt hat. Und der eigene Browser
// laeuft auf einem FREIEN Port mit eigenem Profil statt auf einer festen
// Nummer, die ein Ueberlebender eines harten Abbruchs noch halten koennte —
// `/json/list` liefert dann klaglos die Ziele des fremden.
// Beides samt der Messungen dahinter: tools/leihgabe.mjs.
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

let id = 0
const send = (ws, m, p = {}) =>
  new Promise((ok, no) => {
    const i = ++id
    ws.send(JSON.stringify({ id: i, method: m, params: p }))
    const h = (r) => {
      const x = JSON.parse(r)
      if (x.id !== i) return
      ws.off('message', h)
      x.error ? no(new Error(x.error.message)) : ok(x.result)
    }
    ws.on('message', h)
  })

const lage = (was) => fetch(new URL(`/vorschau/${was}`, ZIEL)).then((r) => r.json())
const gesprochen = () => fetch(new URL('/vorschau/gesprochen', ZIEL)).then((r) => r.json())

let fehler = 0
const sagen = (gut, text) => {
  console.log(`  ${gut ? 'OK  ' : 'FEHL'}  ${text}`)
  if (!gut) fehler++
}

try {
  await warte(1500)
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  const ev = async (e) =>
    (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }))?.result?.value

  /** Lage einstellen, Seite frisch laden, Mitleser einhaengen, Protokolle leeren. */
  async function neu(modus) {
    await lage(`vorlesen-${modus}`)
    await send(ws, 'Page.navigate', { url: `${ZIEL}?t=${Date.now()}` })
    // Die Seite holt die Werke, malt und fragt /api/vorlesen. Grosszuegig:
    // gemessen wird hier nichts Zeitliches.
    await warte(3000)
    // DEN WUNSCH-MITLESER EINHAENGEN (E95/V Stufe 2, 31.08.2026; Vorbild
    // tools/kachel-spielt-je-dienst.mjs): Die Attrappe beantwortet
    // POST /api/spielen nur mit einem Echo und protokolliert ihn nirgends
    // abrufbar — mitgelesen wird deshalb im Browser, samt Rumpf.
    await ev(`window.__wuensche = [];
      if (!window.__mitgelesen) { window.__mitgelesen = true;
        const alt = window.fetch;
        window.fetch = function (u) {
          try {
            const s = String(u && u.url ? u.url : u);
            if (/\\/api\\/spielen$/.test(s)) {
              let rumpf = {};
              try { rumpf = JSON.parse((arguments[1] || {}).body || '{}') } catch {}
              window.__wuensche.push(rumpf);
            }
          } catch {}
          return alt.apply(this, arguments)
        } }
      true`)
    // BEIDE PROTOKOLLE, und ERST JETZT. Das Befehlsprotokoll ueberlebt das
    // Neuladen der Seite — beim ersten Anlauf zaehlten im Lernmodus noch die
    // vier Befehle des vorigen Durchgangs mit, und die Pruefung meldete „der
    // erste Tipp spielt doch". Das sah aus wie ein Fehler in der Oberflaeche
    // und war einer in dieser Datei.
    await lage('gesprochen-leeren')
    await lage('befehle-leeren')
  }

  /* ══ WELCHE KACHEL GETIPPT WIRD — UND WARUM NICHT EINFACH DIE ERSTE ══════
   *
   * Hier stand `#raster .kachel[data-sprich]`, also „die erste beste". Das
   * war richtig, solange fast jede Kachel auf einen Tipp SPIELTE. Seit E112
   * (31.08.2026) klappt eine ALBUM-Kachel ihre Titel auf und traegt den Start
   * in einem eigenen `.tipp-spiel` — und die erste Kachel dieser Vorschau ist
   * ein Album („Die Maus"). Zwei Messungen dieser Datei brauchen aber eine
   * Kachel, die WIRKLICH Musik anwirft: der zweite Tipp im Lernmodus und der
   * Fall „Piper fehlt, die Musik laeuft trotzdem". Sie meldeten danach
   * „gezaehlt: 0" und beschrieben damit eine Absicht als Fehler.
   *
   * GESUCHT WIRD UEBER DEN SATZ, DEN DIE KACHEL SELBST SAGT („…, abspielen"),
   * und nicht ueber eine Liste von Arten oder Titeln. Das ist kein Zirkel:
   * Der Satz WAEHLT hier nur aus, geprueft wird danach etwas anderes (dass
   * genau er gesprochen wird, dass gedaempft wird, dass ein Wunsch hinausgeht).
   * Und es ist die Bauart, die den naechsten Umbau ueberlebt — wenn eines
   * Tages auch das Radio aufklappt, sucht diese Zeile von selbst weiter.
   */
  const SPIEL_KACHEL = `[...document.querySelectorAll('#raster > .kachel[data-sprich]')]
      .find((k) => (k.dataset.sprich || '').endsWith('abspielen'))`

  /** Eine SPIELENDE Raster-Kachel antippen und ihren `data-sprich`-Satz melden. */
  const kachelTippen = () =>
    ev(`(() => { const k = ${SPIEL_KACHEL};
                 if (!k) return null; const s = k.dataset.sprich; k.click(); return s })()`)

  /**
   * Der Schluessel des Werks, das `kachelTippen` treffen wird — ueber den
   * TITEL aus /api/werke aufgeloest, denn die Kachel traegt ihren Schluessel
   * nicht im Baum. Gebraucht wird er fuer die Wunsch-Pruefung: der POST muss
   * GENAU DIESE Kachel meinen.
   */
  async function ersteKachelSchluessel() {
    const titel = await ev(`(() => { const k = ${SPIEL_KACHEL}
      return k ? ((k.querySelector('.kachel-titel') || {}).textContent || '').trim() : null })()`)
    const werke = (await (await fetch(new URL('/api/werke', ZIEL))).json()).werke || []
    return (werke.find((w) => String(w.titel || '').trim() === titel) || {}).schluessel || null
  }

  // ══ 1. AUS IST WIRKLICH AUS ═══════════════════════════════════════════
  console.log('\nModus „aus" — die Box schweigt (Vorgabe):')
  await neu('aus')
  const satzAus = await kachelTippen()
  await warte(1200)
  const g0 = await gesprochen()
  sagen(!!satzAus, `eine Kachel traegt einen Sprechsatz: „${satzAus}"`)
  sagen(g0.gesprochen.length === 0, 'ausgeschaltet wird NICHTS abgerufen (kein /api/vorlesen/sprich)')
  sagen(g0.daempfung.length === 0, 'ausgeschaltet wird die Musik NICHT gedaempft')

  // ══ 2./3./4. ANTIPPEN ═════════════════════════════════════════════════
  console.log('\nModus „antippen" — ein Tipp spricht, dann folgt die Musik:')
  await neu('antippen')
  const satz = await kachelTippen()
  await warte(2500)
  const g1 = await gesprochen()
  console.log(`  gesagt: ${g1.gesprochen.map((x) => `„${x.text}"`).join(', ') || '(nichts)'}`)
  const letzterSatz = g1.gesprochen[g1.gesprochen.length - 1]
  const ueberDieBox = !!letzterSatz && letzterSatz.abspielen === true
  console.log(`  Ansageweg: ${ueberDieBox ? 'die BOX spricht (abspielen=1)' : 'der Browser spielt die WAV'}`)
  console.log(`  Daempfung durch die Seite: ${g1.daempfung.map((x) => (x.an ? 'an' : 'aus')).join(' -> ') || '(keine)'}`)
  sagen(g1.gesprochen.length === 1, `genau EIN Satz je Tipp (gezaehlt: ${g1.gesprochen.length})`)
  sagen(g1.gesprochen[0] && g1.gesprochen[0].text === satz, 'gesprochen wird genau das, was an der Kachel steht')
  sagen(
    // DAS VERB STEHT AM ENDE, IMMER. Auch der Hinweis „nicht mehr da" schiebt
    // sich davor und nicht dahinter — sonst waere er ein Anhaengsel, das ein
    // zuhoerendes Kind nach dem Verb gar nicht mehr aufnimmt.
    /,\s(abspielen|öffnen|weiterhören|Titel zeigen)$/.test(String(satz)),
    `der Satz sagt, WAS DER TIPP TUT — nicht nur den Namen: „${satz}"`,
  )
  /* ══ DIE MUSIK TRITT ZURUECK — WER SIE ZURUECKTRETEN LAESST, IST EGAL ════
   *
   * HIER STANDEN ZWEI ZEILEN, DIE `POST /api/ton/daempfen` ZAEHLTEN. Sie
   * waren seit E123 (04.09.2026) nicht mehr zu erfuellen, und zwar aus einem
   * GUTEN Grund: Seitdem spricht die BOX selbst — `/api/vorlesen/sprich?
   * abspielen=1` —, weil `new Audio()` unter Cog/WPE lautlos verpufft
   * ([[cog-kiosk-hat-keine-tonbruecke]]). Mit der Ansage ist die Daempfung in
   * den Server gewandert: `ansageAbspielen()` (server.ts) setzt
   * `tonDaempfenSetzen(true)`, loest sie beim Prozessende wieder und hat
   * dafuer sogar einen Notloeser (Dauer + 3 s). Die Oberflaeche schickt also
   * MIT ABSICHT kein `/api/ton/daempfen` mehr. Die Wache mass einen Weg, den
   * es nicht mehr gibt, und meldete die richtige Bauart als Fehler — sechs
   * Wochen lang zwei feste Rote im Haupt-Laeufer (AUDIT-2026-09-19 Rang 2).
   *
   * GEPRUEFT WIRD DESHALB DIE SORTE: Die Musik MUSS zuruecktreten, und es
   * gibt genau zwei Bauarten, die das koennen —
   *
   *   die BOX      die Ansage geht mit `abspielen=1` hinaus; dann liegen
   *                Daempfen und Anheben in EINER Funktion im Server, und die
   *                Seite hat hier nichts zu schicken;
   *   der BROWSER  dann muss die Seite selbst daempfen UND wieder anheben.
   *
   * WAS NICHT ZUGELASSEN IST, und nur darum geht es: eine Ansage, die WEDER
   * den einen noch den anderen Weg nimmt. Dann laeuft die Musik ungedaempft
   * weiter, und das Kind hoert beides zugleich.
   */
  sagen(
    ueberDieBox || g1.daempfung.some((x) => x.an),
    'die Musik tritt zurueck, solange gesprochen wird (Box-Weg oder eigene Daempfung)',
  )
  // EIN `an` OHNE `aus` LIESSE DIE BOX FUER IMMER LEISE — die Haelfte, die man
  // vergisst. Auf dem Box-Weg schickt die Seite gar nichts; dann darf auch
  // nichts Haengendes dastehen.
  const haengendesAn = g1.daempfung.length > 0 && g1.daempfung[g1.daempfung.length - 1].an === true
  sagen(
    !haengendesAn && (ueberDieBox || g1.daempfung.some((x) => x.an === false)),
    'und danach WIEDER ANGEHOBEN (ein `an` ohne `aus` liesse die Box fuer immer leise)',
  )

  // Die Gegenprobe zu „nicht bei jedem Takt": nach dem Tipp eine Weile
  // nichts tun. Die Seite malt in dieser Zeit rund zwanzigmal.
  await lage('gesprochen-leeren')
  await warte(5000)
  const ruhe = await gesprochen()
  sagen(ruhe.gesprochen.length === 0, 'ohne Tipp bleibt sie still — das Zeichnen loest nichts aus')

  // ══ 4b. OEFFNEN WARTET NICHT ══════════════════════════════════════════
  //
  // Beim ABSPIELEN wird erst gesprochen, dann gestartet — sonst geht die
  // Ansage in der anlaufenden Musik unter. Beim OEFFNEN gibt es nichts, worin
  // etwas untergehen koennte, dafuer aber einen Bildschirm, der reagieren
  // muss. Wartete eine Lane bis zu vier Sekunden auf das Satzende, tippte ein
  // Kind laengst ein zweites Mal.
  //
  // DAS IST NICHT NUR EINE FRAGE DES GEFUEHLS: Genau daran ist am 04.08.2026
  // der Gesamtlauf gescheitert — `weiter-auswahl-schau.mjs` tippt eine
  // Playlist an und sieht 1200 ms spaeter nach der Lane. Sprach die Box
  // vorher, war sie noch zu, und der Fehler stand scheinbar in einer Datei,
  // die niemand angefasst hatte.
  console.log('\nOeffnen wartet NICHT auf das Satzende:')
  await neu('antippen')
  // DIE PLAYLIST-KACHEL, NICHT „irgendeine, die oeffnet". Beim ersten Anlauf
  // stand hier `/öffnen$/` — getroffen wurde die REGAL-Kachel („Kiddinx,
  // 3 Einträge, öffnen"), und die oeffnet kein `.lane`, sondern die
  // Regal-Ansicht. Die Pruefung meldete „die Lane steht nicht offen" und
  // beschrieb damit ihre eigene Auswahl, nicht die Oberflaeche.
  // Denselben Titel benutzt tools/weiter-auswahl-schau.mjs, aus demselben
  // Grund: er ist die einzige Spotify-Playlist der Attrappe.
  const lane = await ev(`(() => {
    const k = [...document.querySelectorAll('#raster > .kachel[data-sprich-gleich]')]
      .find((e) => (e.querySelector('.kachel-titel') || {}).textContent === 'Das Pummeleinhorn')
    if (!k) return null
    k.click()
    return k.dataset.sprich })()`)
  await warte(900)
  const laneOffen = await ev(`!!document.querySelector('#raster > .lane')`)
  const g1b = await gesprochen()
  console.log(`  angetippt: ${lane ? `„${lane}"` : '(keine Kachel, die oeffnet)'}`)
  sagen(!!lane, 'es gibt eine Kachel, die oeffnet statt zu spielen')
  sagen(laneOffen === true, 'die Lane steht nach 900 ms offen — sie wartet nicht auf die Stimme')
  sagen(g1b.gesprochen.length >= 1, 'und gesprochen wird trotzdem (daneben, nicht davor)')

  /* ══ 5. LERNMODUS — SEIT DEM 04.09.2026: BILD SPIELT, TEXT SPRICHT ══════
   *
   * HIER STAND DER ZWEI-STUFEN-TIPP: erster Tipp auf die Kachel haelt auf und
   * zeigt die Silben, zweiter Tipp spielt. Den gibt es nicht mehr, und das ist
   * eine ENTSCHEIDUNG, kein Verfall — Betreiber am 04.09.2026 woertlich: „nur
   * vorlesen wenn man auf den text klickt nicht auf das album — so koennte man
   * sagen text nicht abspielen nur vorlesen und album spielen."
   *
   * ZWEI GRUENDE STEHEN DAHINTER, beide gemessen:
   *   * Der Umschlag hielt JEDEN Tipp bis zum Ansage-Ende auf, und das meldet
   *     WPE nie — jede Wartezeit lief auf den vollen 4-s-Deckel
   *     ([[der-griff-stempel-fand-die-vier-sekunden-im-vorlesen]]).
   *   * Die Vollbild-Einblendung schluckte den versprochenen zweiten Tipp;
   *     im Lernmodus konnte KEINE benannte Kachel je oeffnen
   *     ([[klick-sturm-laedt-nichts-mehr]], Weg 2).
   *
   * DIESE DATEI HAT DEN WECHSEL NICHT MITBEKOMMEN (zuletzt am 31.08.2026
   * angefasst) und meldete seitdem vier feste Rote, die alle dasselbe sagten:
   * „die Kachel haelt nicht auf". Sie tippte dabei die ganze Kachel an, also
   * das BILD — und das SOLL spielen. Was geprueft gehoert, ist jetzt die
   * TRENNUNG: der Text spricht und spielt NICHT, das Bild spielt.
   */
  console.log('\nModus „lernen" — der Text zeigt die Silben, das Bild spielt:')
  await neu('lernen')
  // DIE TEXTZONE DER KACHEL, nicht die Kachel. `SPRICH_TEXTZONEN` in app.js
  // fuehrt sie auf (`.kachel-wort` und Geschwister); getroffen wird ueber
  // `ev.target.closest(...)`, ein Klick auf die Kachel selbst faellt also
  // ausdruecklich NICHT darunter.
  const satzL = await ev(`(() => { const k = ${SPIEL_KACHEL}
    if (!k) return null
    const w = k.querySelector('.kachel-wort')
    if (!w) return null
    w.click()
    return k.dataset.sprich || '' })()`)
  await warte(2500)
  const g2 = await gesprochen()
  const sichtbar = await ev(`(() => { const k = document.getElementById('lern');
    return k && !k.hidden ? (document.getElementById('lern-text').textContent || '') : null })()`)
  console.log(`  Kachel war: „${satzL === null ? '(keine Textzone gefunden)' : satzL}"`)
  console.log(`  Einblendung: ${sichtbar === null ? '(keine)' : `„${sichtbar}"`}`)
  sagen(satzL !== null, 'die Kachel hat eine Textzone, auf die ein Finger zielen kann')
  sagen(sichtbar !== null && sichtbar.length > 0, 'der Name steht GROSS auf dem Schirm')
  sagen(
    g2.gesprochen.some((x) => x.silben === true),
    'gesprochen wird mit `silben=1` (Silbe fuer Silbe)',
  )

  // UND DER TEXT SPIELT NICHT. Das ist die eigentliche Frage des neuen
  // Modells — eine Textzone, hinter der die Musik anlaeuft, waere genau der
  // Fall, den der Betreiber abgeschafft haben wollte. „Spielt" wird auf
  // BEIDEN Leitungen nachgesehen (Kopf, 31.08.2026): dem Spielwunsch und dem
  // alten Befehlsprotokoll.
  const befehleNachWort = await fetch(new URL('/vorschau/befehle', ZIEL)).then((r) => r.json())
  const wuenscheNachWort = (await ev('window.__wuensche')) || []
  sagen(
    wuenscheNachWort.length === 0 && befehleNachWort.befehle.length === 0,
    `der Tipp auf den TEXT spielt nichts (Spielwuensche: ${wuenscheNachWort.length}, Spielerbefehle: ${befehleNachWort.befehle.length})`,
  )

  // Die Sackgasse: die Einblendung liegt ueber allem. Ein Kind, das die Regel
  // nicht kennt, sitzt fest, wenn sie sich nicht wegtippen laesst — und die
  // Messung muss sie auf demselben Weg abraeumen wie ein Finger, statt die
  // Kachel darunter per `click()` am Hit-Test vorbei zu treffen.
  await ev(`document.getElementById('lern').click()`)
  await warte(300)
  sagen(
    (await ev(`document.getElementById('lern').hidden`)) === true,
    'ein Tipp AUF die Einblendung raeumt sie ab (keine Sackgasse)',
  )

  // UND JETZT DAS BILD — es spielt, auch im Lernmodus, und zwar SOFORT.
  await ev(`(() => { const k = ${SPIEL_KACHEL}; if (k) k.click() })()`)
  await warte(2500)
  const wuenscheNachBild = (await ev('window.__wuensche')) || []
  const befehleNachBild = await fetch(new URL('/vorschau/befehle', ZIEL)).then((r) => r.json())
  /* GEZAEHLT WIRD DER ZUWACHS, NICHT DER STAND (19.09.2026, von der eigenen
   * Gegenprobe gefunden). `window.__wuensche` sammelt ueber den ganzen
   * Durchgang. Hier stand `=== 1`, und damit war die Zeile gruen, sobald
   * IRGENDWO EINER hinausgegangen war: In der Gegenprobe „Bild und Text
   * vertauscht" spielte der TEXT-Tipp (1 Wunsch), der Bild-Tipp gar nichts —
   * und die Zeile meldete trotzdem „genau EIN POST". Genau der Fall aus
   * [[die-rueckmeldung-allein-bezeugt-den-riegel-nicht]]: derselbe Messwert
   * mit und ohne Fehler. Der Zuwachs kann das nicht. */
  sagen(
    wuenscheNachBild.length - wuenscheNachWort.length === 1,
    `der Tipp auf das BILD spielt: genau EIN POST /api/spielen ` +
      `(vor dem Bild-Tipp: ${wuenscheNachWort.length}, danach: ${wuenscheNachBild.length})`,
  )
  sagen(
    befehleNachBild.befehle.length === 0,
    'und die Seite baut dazu selbst keinen /player-Befehl (das waere ein Doppelweg)',
  )
  sagen(
    (await ev(`(() => { const k = document.getElementById('lern'); return !k || k.hidden })()`)) === true,
    'und die Einblendung steht dem Bild nicht im Weg',
  )

  // ══ 6. OHNE PIPER ═════════════════════════════════════════════════════
  console.log('\nEingeschaltet, aber Piper fehlt (`bereit: false`):')
  await neu('ohne-piper')
  const schluesselOhne = await ersteKachelSchluessel()
  await kachelTippen()
  await warte(1500)
  const g3 = await gesprochen()
  sagen(g3.gesprochen.length === 0, 'es wird nichts abgerufen — statt vier Sekunden auf nichts zu warten')
  // „DIE MUSIK LAEUFT TROTZDEM" heisst seit E95/V (Kopf, 31.08.2026): der
  // Tipp stellt EINEN Spielwunsch mit dem Schluessel GENAU DIESER Kachel.
  // Was daraus an den Tonmaschinen wird, prueft
  // src/backend-api/src/spielen.integration.spec.ts.
  const wuenscheOhne = (await ev('window.__wuensche')) || []
  sagen(
    wuenscheOhne.length === 1 && (wuenscheOhne[0] || {}).schluessel === schluesselOhne,
    `und die Musik laeuft trotzdem: EIN POST /api/spielen mit dem Schluessel der Kachel ` +
      `(geschickt: ${JSON.stringify(wuenscheOhne[0] || null)}, Kachel: ${schluesselOhne}) — stumm ist besser als tot`,
  )
  const befehleOhne = await fetch(new URL('/vorschau/befehle', ZIEL)).then((r) => r.json())
  sagen(befehleOhne.befehle.length === 0, 'und KEIN selbstgebauter /player-Befehl daneben (Doppelweg-Wache)')

  // ══ 7. DER VORLAUF ════════════════════════════════════════════════════
  //
  // Er ist die Antwort auf die am Geraet gemessenen 5,1 s je neuem Satz
  // (tools/vorlesen-am-geraet.mjs). Er darf aber NUR im Leerlauf laufen —
  // sonst rechnet Piper neben einem Hoerspiel, und dafuer ist auf einem Pi
  // kein Platz. Beide Haelften gehoeren zusammen; die zweite ist die, die
  // ohne Gegenprobe niemand bemerkt.
  console.log('\nVorlauf — die Saetze werden im Leerlauf vorproduziert:')
  await lage('still')
  await neu('antippen')
  // `sichtbarerTakt` arbeitet sofort, danach alle 15 s. Der erste Durchlauf
  // faellt in die 3 s von `neu()` — dort weiss die Seite den Spielzustand aber
  // noch nicht und haelt sich absichtlich zurueck. Der zweite Takt zaehlt.
  await warte(17000)
  const vor = await gesprochen()
  console.log(`  vorproduziert: ${vor.gesprochen.length} Saetze`)
  sagen(vor.gesprochen.length > 1, 'im Leerlauf werden die Saetze der sichtbaren Kacheln vorproduziert')
  sagen(vor.daempfung.length === 0, 'dabei wird NICHT gedaempft und nichts abgespielt (es ist ein Abruf, kein Ton)')

  console.log('\nGegenprobe — laeuft Musik, wird NICHT vorproduziert:')
  await lage('spielt')
  await neu('antippen')
  await warte(17000)
  const waehrend = await gesprochen()
  console.log(`  abgerufen: ${waehrend.gesprochen.length} Saetze`)
  sagen(
    waehrend.gesprochen.length === 0,
    'waehrend der Wiedergabe rechnet Piper nichts vor (sonst stockt das Hoerspiel)',
  )

  console.log(`\n${fehler ? `${fehler} Abweichung(en)` : 'keine Abweichung'}`)
} catch (e) {
  console.error('FEHLER:', e.message)
  fehler++
} finally {
  // ZURUECKSTELLEN, WAS UMGESTELLT WURDE — und zwar HIER, nicht am Ende des
  // Erfolgswegs.
  //
  // GEFUNDEN AM 04.08.2026 IM GESAMTLAUF, und der Befund lag zwei Schritte
  // weiter: „Weiterhoeren folgt der Auswahl" meldete „die Lane ging nicht auf
  // — Vorschau geaendert?". Sie war geaendert, und zwar von HIER. Eine schon
  // laufende Vorschau wird absichtlich nicht neu gestartet
  // ([laufende-vorschau-teilt-zustand]); dieses Werkzeug liess sie dann mit
  // `vorlesen-antippen` zurueck. Das naechste Werkzeug tippte eine Kachel an,
  // die Seite sprach erst — und `sprichDann` oeffnet die Lane ERST DANACH.
  // Nach 1200 ms Wartezeit war sie noch zu. Der Fehler stand also in einer
  // Datei, die niemand angefasst hatte.
  //
  // HIER STANDEN ZWEI FESTE WERTE (`vorlesen-aus`, `spielt`), und sie waren
  // nur die halbe Antwort — an zwei Stellen:
  //
  //   * ZWEI FELDER SIND NICHT ALLE. Wer ein drittes umstellt, muss daran
  //     denken, es hier nachzutragen. Genau so ist der Fehler oben ja
  //     entstanden: `vorlesen-antippen` blieb stehen, weil niemand daran
  //     dachte.
  //   * ZURUECKGELEGT WURDE DIE VORGABE, nicht das, was VORHER dastand.
  //     Gehoerte die Vorschau jemandem, der sich `vorlesen-lernen` selbst
  //     gestellt hatte, raeumte dieses Werkzeug ihm seine Lage ab — derselbe
  //     Schaden, nur andersherum.
  //
  // `leihe.zurueckgeben()` legt den Schnappschuss von VORHER hin und nimmt
  // dabei jedes klebrige Feld mit (tools/leihgabe.mjs). IM `finally`, denn ein
  // Werkzeug, das nur auf dem gruenen Weg aufraeumt, laesst die Vorschau
  // gerade dann verstellt stehen, wenn es einen Fehler gefunden hat — also
  // genau dann, wenn als naechstes jemand hinsieht.
  await brw.schliessen()
  await leihe.zurueckgeben()
}

process.exit(PRUEFEN && fehler ? 1 : 0)
