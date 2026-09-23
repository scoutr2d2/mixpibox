#!/usr/bin/env node
/**
 * KLEMMT DIE EINFAHRENDE LEISTE — und gibt das eingefahrene Kissen HOEHE frei?
 *
 * WOFUER: Gemeldet wurde dreierlei, und alle drei sind Zeitfragen, die man am
 * Quelltext nicht ablesen kann:
 *
 *   „wenn ich bis titel ausgewaehlt habe wird die leiste nie wieder
 *    eingeblendet"                                   -> KLEMMT VERSTECKT
 *   „es gibt auch den fall das es nicht ausgeblendet wird selbst wenn ich
 *    scolle und alles ausgeklappt ist"               -> KLEMMT SICHTBAR
 *   „wenn der mini player verkleinert bleiben die seiten schwarz dann
 *    muesste man ja nicht verkleinern"               -> KEIN HOEHENGEWINN
 *
 * Gemessen wird die WIRKUNG, nicht das Feld: `platzBeimBlaettern` liegt in
 * einer IIFE und ist von aussen nicht lesbar. Ablesbar ist einzig
 * `document.body.classList.contains('platz-machen')` — und genau der Zustand
 * ist es, um den es geht. (Dieselbe Regel wie in
 * tools/weiter-auswahl-schau.mjs.)
 *
 * WAS ES AENDERT: nichts. Eigener Browser gegen tools/neu-vorschau.mjs, nur
 * gelesen und getippt. Weder die Box noch Dateien werden angefasst.
 *
 * AUFRUF
 *     node tools/leiste-platz-schau.mjs             # Tabelle
 *     node tools/leiste-platz-schau.mjs --pruefen   # Ende 1 bei Abweichung
 *     node tools/leiste-platz-schau.mjs --bild x.png
 *
 * DIE GEGENPROBE IST PFLICHT (llmwiki attrappe-luegt-durch-weglassen): Bevor
 * ein „bleibt eingefahren" etwas wert ist, muss dieselbe Messung zeigen, dass
 * ein gewoehnliches Rollen ueberhaupt EINFAEHRT. Sonst prueft die ruhige
 * Messung das Nichts — die Vorschau hatte `platzBeimBlaettern` schon einmal
 * gar nicht eingeschaltet, und die Probe meldete „ruhig".
 */
import { writeFile } from 'node:fs/promises'
import WebSocket from 'ws'
import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'

const ZIEL = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8299/neu/'
const PRUEFEN = process.argv.includes('--pruefen')
const BILD = (() => {
  const i = process.argv.indexOf('--bild')
  return i >= 0 ? process.argv[i + 1] || 'leiste-platz.png' : null
})()

/** Beruehrziel-Untergrenze: 800x480 sind 0,14 mm/px, 64 px sind 9 mm (ISO 9241-411). */
const ZIEL_PX = 64

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

let fehler = 0
const melde = (z) => {
  fehler++
  console.error(`  FEHLER  ${z}`)
}
const zeile = (name, wert) => console.log(`  ${String(name).padEnd(46)} ${wert}`)

/** Die Playlist, die in der Vorschau eine Lane aufmacht. */
const PLAYLIST = 'Bibi Blocksberg'

try {
  await warte(1500)
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  // 800x480 GENAU — und nicht „ungefaehr". `--window-size` liess dem
  // Sichtfenster im headless-Chromium nur 337 px Hoehe; die Buehne war damit
  // 189 statt 344 px hoch, und jede Aussage ueber Kachelreihen oder
  // Hoehengewinn waere fuer einen Schirm gewesen, den es nicht gibt.
  await send(ws, 'Emulation.setDeviceMetricsOverride', {
    width: 800,
    height: 480,
    deviceScaleFactor: 1,
    mobile: false,
  })
  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value

  const laut = []
  ws.on('message', (r) => {
    try {
      const x = JSON.parse(r)
      const t = x?.params?.type
      if (x?.method === 'Runtime.consoleAPICalled' && (t === 'error' || t === 'warning')) {
        laut.push(`${t}: ${(x.params.args || []).map((a) => a?.value ?? a?.description ?? '?').join(' ')}`)
      }
      if (x?.method === 'Runtime.exceptionThrown') {
        const d = x.params?.exceptionDetails
        laut.push(`Ausnahme: ${d?.exception?.description || d?.text || '?'}`)
      }
    } catch {
      /* kein JSON */
    }
  })

  await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
  await warte(2500)

  // ── Bausteine ───────────────────────────────────────────────────────────

  /** Ist gerade eingefahren? */
  const ein = () => ev(`document.body.classList.contains('platz-machen')`)

  /** Ein Rollereignis in der Buehne — wie ein Fingerzug, nur reproduzierbar. */
  const rollen = (top = 220) =>
    ev(
      `(() => { const b = document.getElementById('buehne'); b.scrollTop = ${top};
                b.dispatchEvent(new Event('scroll')); return b.scrollTop })()`,
    )

  /**
   * Alles auf Anfang: erste Kategorie, Lane zu, oben, ausgefahren.
   *
   * UEBER DIE KATEGORIE, nicht ueber ein zweites Antippen der Kachel: Ein
   * Kategoriewechsel ruft `laneSchliessen()` UND baut das Raster neu — damit
   * steht die Seite danach sicher so da wie nach dem Laden, egal in welchem
   * Zustand die vorige Messung sie hinterlassen hat.
   */
  const zuruecksetzen = async () => {
    await ev(`(() => {
      const k = document.querySelector('#leiste .kat'); if (k) k.click();
      const b = document.getElementById('buehne'); b.scrollTop = 0;
      for (const r of document.querySelectorAll('.lane-reihe')) r.scrollLeft = 0;
      return true })()`)
    // DAS ROLLEN GEHOERT DAZU, und das ist keine Kosmetik: Beim Ist-Stand
    // bleibt die Leiste nach dem Schliessen einer Lane eingefahren stehen (die
    // Uhr wurde beim Sperren geloescht und nie neu gestellt). Ohne ein
    // Rollereignis, das sie wieder stellt, faengt die naechste Messung im
    // Klemmzustand an — und misst dann ihn statt der Sache, um die es geht.
    // Genau das ist im ersten Lauf passiert: „vor dem Rollen eingefahren: ja".
    await warte(120)
    await rollen(0)
    // Laenger als die laengste Ruhezeit, damit die Uhr sicher abgelaufen ist.
    await warte(5600)
  }

  /**
   * Ausgefahren, OHNE die Lane zu schliessen.
   *
   * WOZU: Das Aufklappen einer Lane rollt selbst (`laneInsBild` holt sie ins
   * Bild) — im headless-Browser dauert dieses weiche Rollen laenger als die
   * 900 ms „das war ich", und die Leiste faehrt dabei ein. Eine Messung
   * „faehrt Rollen mit offener Lane ein?" begaenne dann schon eingefahren und
   * saehe wie ein Erfolg aus, ohne einer zu sein.
   *
   * DER WEG IST EIN ECHTER BEDIENSCHRITT, kein Eingriff: Der grosse Player
   * faehrt beim Oeffnen alles aus (app.js, `[data-auf]`), und der eine
   * Rueckweg schliesst ihn wieder. Die Lane bleibt dabei stehen.
   *
   * SEIT 03.08.2026 IST DAS `#zurueck` UND NICHT MEHR `#gross-zu`: Das Kreuz
   * im Blatt ist entfallen, es gibt einen Ausgang fuer alle Ebenen.
   */
  const ausfahrenErzwingen = async () => {
    await ev(`(document.querySelector('.mp-bild') || { click() {} }).click()`)
    await warte(200)
    await ev(`(document.getElementById('zurueck') || { click() {} }).click()`)
    await warte(300)
  }

  const tippen = () =>
    ev(`(() => {
      const k = [...document.querySelectorAll('#raster > .kachel:not(.regal)')]
        .find((x) => (x.querySelector('.kachel-titel')||{}).textContent === ${JSON.stringify(PLAYLIST)});
      if (!k) return 'keine Kachel'; k.click(); return 'ok' })()`)

  /**
   * Die Playlist-Kachel antippen (klappt die Alben auf).
   *
   * SIE STEHT IN EINEM REGAL, und das war der Grund, warum der erste Lauf
   * „Lane steht: NEIN" meldete und drei Messungen still ins Leere gingen:
   * „Bibi Blocksberg" hat denselben Interpreten wie ein zweites Werk, und ab
   * REGAL_AB fasst `anordnen()` solche Werke zu einer REGAL-Kachel zusammen.
   * Im Raster steht dann nicht die Playlist, sondern „Kiddinx, 2 Eintraege".
   * Wer nur nach dem Titel sucht, findet nichts — und misst anschliessend
   * einen Ablauf, den es nie gab.
   */
  const laneAuf = async () => {
    if ((await tippen()) === 'ok') return 'ok'
    const regale = await ev(`document.querySelectorAll('#raster > .kachel.regal').length`)
    for (let i = 0; i < regale; i++) {
      await ev(`(document.querySelectorAll('#raster > .kachel.regal')[${i}] || {click(){}}).click()`)
      await warte(500)
      if ((await tippen()) === 'ok') return 'ok'
      // `#zurueck` statt `#regal-zurueck`: seit 03.08.2026 gibt es EINEN Ausgang.
      await ev(`(document.getElementById('zurueck') || { click() {} }).click()`)
      await warte(400)
    }
    return 'keine Kachel'
  }

  /**
   * Wie lange dauert es, bis die Leiste zurueckkommt?
   *
   * `seit` ist der Zeitpunkt des AUSLOESENDEN Rollens, nicht der des
   * Messbeginns — sonst fehlt die Wartezeit davor in der Zahl, und 1400 ms
   * lesen sich als 1200. Schrittweite 100 ms, Deckel bei 9 s: eine Zahl
   * hundert Millisekunden daneben ist besser als ein haengender Lauf.
   */
  const bisZurueck = async (seit) => {
    for (let i = 0; i < 90; i++) {
      if (!(await ein())) return Date.now() - seit
      await warte(100)
    }
    return null
  }

  // ── 0. GEGENPROBE: faehrt ein gewoehnliches Rollen ueberhaupt ein? ───────
  console.log('\n  ── Gegenprobe (ohne die geht keine der Messungen unten) ──')
  await zuruecksetzen()
  const vorher = await ein()
  const tRoll0 = Date.now()
  await rollen(220)
  await warte(250)
  const nachRollen = await ein()
  zeile('vor dem Rollen eingefahren', vorher ? 'JA (unerwartet)' : 'nein')
  zeile('nach dem Rollen eingefahren', nachRollen ? 'ja' : 'NEIN')
  if (vorher || !nachRollen) {
    melde('das Einfahren schlaegt gar nicht an — alle folgenden Zahlen waeren wertlos')
  }

  // ── 1. RUHEZEIT OHNE LANE ───────────────────────────────────────────────
  const ruheOhne = await bisZurueck(tRoll0)
  zeile('Ruhezeit ohne Lane bis zurueck', ruheOhne === null ? 'kam NICHT zurueck' : `${ruheOhne} ms`)
  if (ruheOhne === null) melde('die Leiste kam ohne Lane gar nicht zurueck')

  // ── 2. KLEMMT VERSTECKT ─────────────────────────────────────────────────
  //
  // Der gemeldete Ablauf: Es ist eingefahren (weil gerollt wurde), und WAEHREND
  // die Uhr laeuft klappt das Kind eine Playlist auf. Danach kommt die Leiste
  // nie wieder — bis jemand neu laedt.
  console.log('\n  ── Klemmt versteckt: Lane oeffnen, WAEHREND die Uhr laeuft ──')
  await zuruecksetzen()
  await rollen(220)
  await warte(300)
  const einVorLane = await ein()
  await laneAuf()
  await warte(1200)
  const tLane = Date.now()
  const laneDa = await ev(`!!document.querySelector('#raster .lane')`)
  zeile('eingefahren, als die Lane aufging', einVorLane ? 'ja' : 'NEIN (Messung wertlos)')
  zeile('Lane steht', laneDa ? 'ja' : 'NEIN (Messung wertlos)')
  if (!einVorLane || !laneDa) melde('der Ablauf kam nicht zustande — Vorschau geaendert?')
  const zurueckMitLane = await bisZurueck(tLane)
  zeile(
    'Leiste kommt nach dem Aufklappen zurueck nach',
    zurueckMitLane === null ? 'NIE (bis 9 s gewartet) — KLEMMT' : `${zurueckMitLane} ms`,
  )
  if (zurueckMitLane === null) melde('KLEMMT VERSTECKT: die Leiste kommt mit offener Lane nicht zurueck')

  // ── 3. KLEMMT SICHTBAR ──────────────────────────────────────────────────
  //
  // Umgekehrter Fall: Die Lane ist offen und ruhig, dann rollt jemand. Heute
  // faehrt gar nichts mehr ein, solange eine Lane steht.
  console.log('\n  ── Klemmt sichtbar: mit offener Lane rollen ──')
  await zuruecksetzen()
  await laneAuf()
  await warte(1500)
  const laneDa2 = await ev(`!!document.querySelector('#raster .lane')`)
  await ausfahrenErzwingen()
  const einVorRollen = await ein()
  const tRoll1 = Date.now()
  await rollen(260)
  await warte(300)
  const einNachRollen = await ein()
  zeile('Lane steht', laneDa2 ? 'ja' : 'NEIN (Messung wertlos)')
  zeile('vor dem Rollen eingefahren', einVorRollen ? 'JA (Messung wertlos)' : 'nein')
  zeile('mit offener Lane: faehrt Rollen ein', einNachRollen ? 'ja' : 'NEIN')
  if (einVorRollen) melde('vor dem Rollen war schon eingefahren — die Seite steckt im Klemmzustand')
  if (!einNachRollen) melde('KLEMMT SICHTBAR: mit offener Lane faehrt das Rollen nichts mehr ein')

  // ── 4. RUHEZEIT MIT OFFENER LANE ────────────────────────────────────────
  const ruheMitLane = einNachRollen && !einVorRollen ? await bisZurueck(tRoll1) : null
  zeile('Ruhezeit MIT Lane bis zurueck', ruheMitLane === null ? '— (kam nicht dazu)' : `${ruheMitLane} ms`)

  // ── 4b. WIE LANGE BRAUCHT EINE LANE, BIS SIE STEHT? ─────────────────────
  //
  // WOZU DIESE ZAHL: Sie ist die UNTERGRENZE fuer die Ruhezeit bei offener
  // Lane. Kommt die Leiste zurueck, bevor die Lane ueberhaupt steht, schiebt
  // sie den Inhalt ein zweites Mal — waehrend das Kind noch darauf wartet,
  // dass sich etwas beruhigt. Gemessen wird bis zum LETZTEN Rollereignis der
  // Buehne (das weiche Hereinholen aus `laneInsBild` zaehlt dazu) und bis zum
  // letzten geladenen Bild der Lane.
  //
  // ACHTUNG BEI DER DEUTUNG: Das hier ist die VORSCHAU auf einem Arbeitsplatz-
  // rechner. Auf der Box kommt der Abruf `/api/werke/<s>/alben` dazu (er holt
  // seitenweise bis 1000 Titel) und beim ERSTEN Mal die Cover aus dem Netz
  // (llmwiki cover-nach-neustart-langsam: 11 Werke kalt 1,69 s). Die Zahl hier
  // ist also ein unterer Rand, keine Obergrenze.
  console.log('\n  ── Wie lange braucht eine Lane, bis sie steht? ──')
  await zuruecksetzen()
  await ev(`(() => { window.__roll = []; const b = document.getElementById('buehne');
    window.__rollAn = () => window.__roll.push(Math.round(performance.now()));
    b.addEventListener('scroll', window.__rollAn, { capture: true, passive: true });
    window.__t0 = Math.round(performance.now()); return true })()`)
  await laneAuf()
  await warte(3000)
  const stehzeit = await ev(`(() => {
    const b = document.getElementById('buehne');
    b.removeEventListener('scroll', window.__rollAn, { capture: true });
    const l = document.querySelector('#raster .lane');
    const bilder = l ? [...l.querySelectorAll('img')] : [];
    return {
      letztesRollen: window.__roll.length ? window.__roll[window.__roll.length - 1] - window.__t0 : null,
      rollereignisse: window.__roll.length,
      bilder: bilder.length,
      offen: bilder.filter((b) => !b.complete).length,
    } })()`)
  zeile('Rollereignisse beim Aufklappen', String(stehzeit.rollereignisse))
  zeile('letztes davon nach', stehzeit.letztesRollen === null ? '—' : `${stehzeit.letztesRollen} ms`)
  zeile('Bilder in der Lane / noch offen', `${stehzeit.bilder} / ${stehzeit.offen}`)

  // ── 5. WISCHGESTE VOM LINKEN RAND ───────────────────────────────────────
  //
  // Sie muss zwei Dinge zugleich koennen: die Leiste holen, UND sich vom
  // gewoehnlichen Zurueckblaettern in einer waagerechten Reihe unterscheiden.
  console.log('\n  ── Wischgeste vom linken Rand ──')

  /** Ein Zug mit dem Finger. Echte Zeigerereignisse, keine erfundenen —
   *  ein `new PointerEvent(...)` traegt kein `isTrusted` und laeuft an
   *  Browsersperren vorbei, die es am Geraet gibt. */
  const wisch = async (x0, y0, x1, y1, schritte = 10) => {
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', clickCount: 1 })
    for (let i = 1; i <= schritte; i++) {
      await send(ws, 'Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: Math.round(x0 + ((x1 - x0) * i) / schritte),
        y: Math.round(y0 + ((y1 - y0) * i) / schritte),
        button: 'left',
        buttons: 1,
      })
      await warte(16)
    }
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', clickCount: 1 })
  }

  await zuruecksetzen()
  await rollen(220)
  await warte(250)
  const einVorWisch = await ein()
  await wisch(14, 240, 150, 244)
  await warte(300)
  const einNachWisch = await ein()
  zeile('vor dem Wisch eingefahren', einVorWisch ? 'ja' : 'NEIN (Messung wertlos)')
  zeile('Wisch vom Rand holt die Leiste', einNachWisch ? 'NEIN' : 'ja')
  if (einNachWisch) melde('die Wischgeste vom linken Rand holt die Leiste nicht zurueck')

  // Die Gegenrichtung: ein Wisch, der NICHT am Rand beginnt, darf nichts tun —
  // sonst holt jedes Zurueckblaettern in einer Reihe die Leiste.
  await zuruecksetzen()
  await rollen(220)
  await warte(250)
  await wisch(400, 240, 540, 244)
  await warte(300)
  const einNachMitte = await ein()
  zeile('Wisch aus der MITTE laesst sie weg', einNachMitte ? 'ja' : 'NEIN')
  if (!einNachMitte) melde('ein Wisch aus der Mitte holt die Leiste — die Geste ist nicht unterscheidbar')

  // Und der harte Fall: eine waagerechte Reihe, die schon gerollt IST. Wer dort
  // vom Rand nach rechts wischt, will zurueckblaettern, nicht die Leiste.
  await zuruecksetzen()
  await laneAuf()
  await warte(1500)
  const reihe = await ev(`(() => {
    const r = document.querySelector('#raster .lane .lane-reihe');
    if (!r) return null;
    r.scrollLeft = 200;
    const k = r.getBoundingClientRect();
    return { scrollLeft: r.scrollLeft, links: Math.round(k.left), oben: Math.round(k.top + k.height / 2) } })()`)
  let einNachReihenwisch = null
  let reiheBereit = false
  if (reihe && reihe.scrollLeft > 0) {
    await ausfahrenErzwingen()
    await rollen(300)
    await warte(300)
    reiheBereit = await ein()
    if (reiheBereit) {
      await wisch(reihe.links + 8, reihe.oben, reihe.links + 150, reihe.oben + 2)
      await warte(300)
      einNachReihenwisch = await ein()
    }
  }
  zeile(
    'gerollte Reihe: Wisch am Rand laesst sie weg',
    !reihe || reihe.scrollLeft === 0
      ? '— (Reihe rollt hier nicht)'
      : !reiheBereit
        ? '— (war nicht eingefahren)'
        : einNachReihenwisch
          ? 'ja'
          : 'NEIN',
  )
  if (reiheBereit && einNachReihenwisch === false) {
    melde('der Wisch in einer schon gerollten Reihe holt die Leiste — Zurueckblaettern und Geste sind eins')
  }

  // ── 6. WAS DAS EINFAHREN AN PLATZ BRINGT ────────────────────────────────
  console.log('\n  ── Platzgewinn (800x480) ──')
  const platz = async () =>
    ev(`(() => {
      const b = document.getElementById('buehne');
      const mp = document.getElementById('mp');
      const br = b.getBoundingClientRect();
      const mr = mp.getBoundingClientRect();
      const knoepfe = [...mp.querySelectorAll('.mp-knopf')].filter((k) => getComputedStyle(k).display !== 'none');
      // WIRD DER KNOPF AUCH GETROFFEN? Eine Trefferflaeche, ueber der etwas
      // anderes liegt, ist keine. elementFromPoint sagt, wer den Tipp bekaeme.
      const treffer = knoepfe.map((k) => {
        const r = k.getBoundingClientRect();
        const o = document.elementFromPoint(Math.round(r.left + r.width/2), Math.round(r.top + r.height/2));
        return { id: k.id, b: Math.round(r.width), h: Math.round(r.height), trifft: !!(o && k.contains(o)) };
      });
      // WIE VIELE KACHELREIHEN PASSEN IN DIE BUEHNE?
      //
      // NICHT „wie viele sind gerade ganz zu sehen": Das haengt am Rollstand,
      // und in der Vorschau steht das Raster hinter „Weiterhoeren" und der
      // Interpreten-Reihe — beim ersten Lauf kam deshalb 0 heraus, obwohl
      // eine Reihe bequem hineinpasst. Gerechnet wird aus dem SCHRITTMASS
      // (Abstand zweier Reihenoberkanten), das ist vom Rollen unabhaengig.
      const kacheln = [...document.querySelectorAll('#raster > .kachel')];
      const oben = [...new Set(kacheln.map((k) => Math.round(k.offsetTop)))].sort((a, c) => a - c);
      const hoehe = kacheln.length ? Math.round(kacheln[0].getBoundingClientRect().height) : 0;
      const schritt = oben.length > 1 ? oben[1] - oben[0] : hoehe;
      const luecke = schritt - hoehe;
      const ganz = schritt > 0 ? Math.floor((br.height + luecke) / schritt) : 0;
      return {
        buehneB: Math.round(br.width), buehneH: Math.round(br.height),
        rollHoehe: Math.round(b.scrollHeight),
        mpB: Math.round(mr.width), mpH: Math.round(mr.height),
        mpOben: Math.round(mr.top), mpUnten: Math.round(mr.bottom),
        knoepfe: treffer,
        ring: !!getComputedStyle(document.getElementById('mp-spiel'), '::after').content.replace(/none/, ''),
        reihenGanz: ganz,
        kachel: hoehe,
        schritt,
      } })()`)

  await zuruecksetzen()
  const aus = await platz()
  await rollen(220)
  await warte(500)
  const drin = await platz()

  zeile('Buehne  ausgefahren -> eingefahren (Breite)', `${aus.buehneB} -> ${drin.buehneB} px`)
  zeile('Buehne  ausgefahren -> eingefahren (Hoehe)', `${aus.buehneH} -> ${drin.buehneH} px`)
  zeile('Kissen  ausgefahren -> eingefahren (Breite)', `${aus.mpB} -> ${drin.mpB} px`)
  zeile('Kissen  Oberkante', `${aus.mpOben} -> ${drin.mpOben} px`)
  zeile('Kachel (Hoehe / Schrittmass)', `${aus.kachel} / ${aus.schritt} px  ->  ${drin.kachel} / ${drin.schritt} px`)
  zeile('Kachelreihen, die in die Buehne passen', `${aus.reihenGanz} -> ${drin.reihenGanz}`)
  // WAS MAN WIRKLICH GEWINNT, wenn keine ganze Reihe dazukommt: Von der
  // naechsten Reihe wird mehr sichtbar — und genau die angeschnittene Reihe
  // ist das Zeichen, DASS es weitergeht (siehe Kopf von app.css).
  zeile(
    'von der naechsten Reihe sichtbar',
    `${Math.max(0, aus.buehneH - aus.schritt)} -> ${Math.max(0, drin.buehneH - drin.schritt)} px`,
  )
  zeile('Fortschrittsring am Spiel-Knopf', drin.ring ? 'ja' : 'NEIN')
  for (const k of drin.knoepfe) {
    zeile(`  Knopf ${k.id}`, `${k.b} x ${k.h} px${k.trifft ? '' : '  — WIRD NICHT GETROFFEN'}`)
  }
  zeile('Knoepfe im eingefahrenen Kissen', String(drin.knoepfe.length))
  if (drin.buehneH <= aus.buehneH) {
    melde(`das Einfahren gibt KEINE Hoehe frei (${aus.buehneH} -> ${drin.buehneH} px)`)
  }
  if (!drin.ring) melde('der Fortschrittsring am Spiel-Knopf fehlt im eingefahrenen Zustand')
  for (const k of drin.knoepfe) {
    if (k.b < ZIEL_PX || k.h < ZIEL_PX) melde(`Knopf ${k.id} ist ${k.b}x${k.h} px, unter den geforderten ${ZIEL_PX}`)
    if (!k.trifft) melde(`Knopf ${k.id} wird von etwas anderem verdeckt`)
  }
  if (!drin.knoepfe.some((k) => k.id === 'mp-laut')) {
    melde('im eingefahrenen Kissen fehlt der Lautstaerke-Knopf')
  }

  // ── 6a. UND TAUGT DER KNOPF DORT AUCH ETWAS? ────────────────────────────
  //
  // Ein Knopf, der dasteht, ist noch keine Bedienung. Das Fenster ist 704 px
  // lang und haengt an der MITTE des Kissens (`left: 50%`); das Kissen ist
  // eingefahren aber nur noch 326 px breit. Ob das Fenster damit noch ganz auf
  // den Schirm passt, ist eine Frage an den Browser, keine an den Quelltext —
  // und wenn es links hinausragt, sind es genau die leisen Werte, die
  // unerreichbar werden.
  //
  // Gedrueckt wird ueber `click()`, nicht ueber ein nachgemachtes Antippen:
  // Gemessen werden soll das Fenster, nicht die Beruehrungsbehandlung.
  const lautFenster = await ev(`(() => {
    const k = document.getElementById('mp-laut'); if (!k) return null;
    k.click();
    const f = document.getElementById('mp-laut-fenster');
    if (!f || f.hidden) return { auf: false };
    const r = f.getBoundingClientRect();
    const reg = document.getElementById('mp-laut-regler').getBoundingClientRect();
    // Wird der Regler an BEIDEN Enden getroffen? Ein Fenster, das halb aus dem
    // Schirm ragt, faellt hier auf — und nur hier.
    const treffer = (x) => {
      const o = document.elementFromPoint(Math.round(x), Math.round(reg.top + reg.height / 2));
      return !!(o && o.id === 'mp-laut-regler');
    };
    return { auf: true, links: Math.round(r.left), rechts: Math.round(r.right),
             breit: Math.round(r.width), oben: Math.round(r.top),
             leise: treffer(reg.left + 8), laut: treffer(reg.right - 8),
             schirm: window.innerWidth };
  })()`)
  if (lautFenster && lautFenster.auf) {
    zeile(
      'Lautstaerke-Fenster eingefahren',
      `${lautFenster.breit} px, x ${lautFenster.links}..${lautFenster.rechts} (Schirm ${lautFenster.schirm})`,
    )
    zeile(
      '  Regler an beiden Enden treffbar',
      `${lautFenster.leise ? 'leise ja' : 'leise NEIN'}, ${lautFenster.laut ? 'laut ja' : 'laut NEIN'}`,
    )
    if (lautFenster.links < 0 || lautFenster.rechts > lautFenster.schirm) {
      melde(`das Lautstaerke-Fenster ragt aus dem Schirm (x ${lautFenster.links}..${lautFenster.rechts})`)
    }
    if (!lautFenster.leise || !lautFenster.laut) melde('der Lautstaerke-Regler ist nicht an beiden Enden treffbar')
  } else {
    zeile('Lautstaerke-Fenster eingefahren', 'GEHT NICHT AUF')
    melde('der Lautstaerke-Knopf im eingefahrenen Kissen oeffnet kein Fenster')
  }

  // ── 6b. FAEHRT ES, ODER SPRINGT ES? ─────────────────────────────────────
  //
  // Die Hoehe wird ueber einen negativen oberen Aussenabstand freigegeben.
  // Aussenabstaende sind Laengen und lassen sich ueberblenden — anders als
  // `width: auto`, `align-self` und `justify-content`, an denen ein frueherer
  // Anlauf gescheitert ist (llmwiki platz-beim-blaettern-schaukelt-sich-auf,
  // gemeldet als „der Player zappelt"). Behauptet ist das schnell; hier wird
  // WAEHREND der Bewegung abgetastet: Kommen Zwischenwerte, faehrt es.
  console.log('\n  ── Faehrt das Kissen, oder springt es? ──')
  await zuruecksetzen()
  await ev(`(() => { window.__mt = []; const mp = document.getElementById('mp');
    window.__uhr = setInterval(() => window.__mt.push(Math.round(parseFloat(getComputedStyle(mp).marginTop))), 20);
    return true })()`)
  await rollen(220)
  await warte(400)
  const stufen = await ev(`(clearInterval(window.__uhr), [...new Set(window.__mt)])`)
  zeile('Aussenabstand oben, abgetastet', stufen.join(' '))
  zeile('verschiedene Zwischenwerte', String(stufen.length))
  if (stufen.length < 3) {
    melde(`das Kissen springt statt zu fahren (nur ${stufen.length} verschiedene Werte gesehen)`)
  }

  // ── 6c. VERDECKT DAS SCHWEBENDE KISSEN DIE LETZTE REIHE? ────────────────
  //
  // Der Preis des Hoehengewinns: Eingefahren liegt das Kissen UEBER dem
  // Inhalt. Wer ganz nach unten rollt, koennte die letzte Kachelreihe darunter
  // haben. Gemessen wird, wie viel der untersten Reihe wirklich verdeckt ist.
  await zuruecksetzen()
  await rollen(220)
  await warte(500)
  const verdeckt = await ev(`(() => {
    const b = document.getElementById('buehne');
    b.scrollTop = b.scrollHeight; b.dispatchEvent(new Event('scroll'));
    const mp = document.getElementById('mp').getBoundingClientRect();
    const k = [...document.querySelectorAll('#raster > .kachel')];
    if (!k.length) return null;
    const unten = Math.max(...k.map((x) => Math.round(x.offsetTop)));
    const letzte = k.filter((x) => Math.round(x.offsetTop) === unten);
    let hoch = 0, breit = 0;
    for (const x of letzte) {
      const r = x.getBoundingClientRect();
      const h = Math.max(0, Math.min(r.bottom, mp.bottom) - Math.max(r.top, mp.top));
      const w = Math.max(0, Math.min(r.right, mp.right) - Math.max(r.left, mp.left));
      if (h > hoch) hoch = Math.round(h);
      if (w > 0) breit += Math.round(w);
    }
    return { kacheln: letzte.length, hoch, breit } })()`)
  zeile(
    'letzte Reihe unter dem Kissen',
    !verdeckt
      ? '—'
      : verdeckt.hoch === 0
        ? 'nichts verdeckt'
        : `${verdeckt.hoch} px hoch ueber ${verdeckt.breit} px Breite (${verdeckt.kacheln} Kacheln in der Reihe)`,
  )
  if (verdeckt && verdeckt.hoch > 0) {
    melde(`das schwebende Kissen verdeckt die letzte Kachelreihe ${verdeckt.hoch} px hoch`)
  }

  // ── 7. SCHAUKELT ES? ────────────────────────────────────────────────────
  //
  // Die alte Falle (llmwiki platz-beim-blaettern-schaukelt-sich-auf): Die
  // eigene Aenderung erzeugt Rollereignisse, die als Finger gedeutet werden.
  // Seit das Einfahren auch die HOEHE aendert, ist der Anlass groesser
  // geworden — gezaehlt wird deshalb, wie oft die Klasse in 6 s umspringt.
  console.log('\n  ── Schaukelt es? (Wechsel in 6 s nach EINEM Rollen) ──')
  await zuruecksetzen()
  await ev(`(() => { window.__wechsel = []; const b = document.body;
    window.__beob = new MutationObserver(() => {
      const e = b.classList.contains('platz-machen');
      const l = window.__wechsel[window.__wechsel.length - 1];
      if (!l || l.ein !== e) window.__wechsel.push({ ein: e, t: Math.round(performance.now()) });
    });
    window.__beob.observe(b, { attributes: true, attributeFilter: ['class'] }); return true })()`)
  await rollen(220)
  await warte(6000)
  const wechsel = await ev(`(window.__beob.disconnect(), window.__wechsel)`)
  zeile('Wechsel EIN/AUS', wechsel.map((w) => `${w.ein ? 'EIN' : 'AUS'}@${w.t}`).join('  ') || '(keiner)')
  if (wechsel.length > 2) {
    melde(`es schaukelt: ${wechsel.length} Wechsel statt hoechstens zwei (ein EIN, ein AUS)`)
  }

  if (laut.length) {
    console.log('\n  ── Konsole ──')
    for (const l of laut.slice(0, 8)) zeile('', l)
    melde(`die Seite hat ${laut.length} Meldung(en) auf die Konsole geschrieben`)
  }

  if (BILD) {
    await zuruecksetzen()
    await rollen(220)
    await warte(500)
    const s = await send(ws, 'Page.captureScreenshot', { format: 'png' })
    await writeFile(BILD, Buffer.from(s.data, 'base64'))
    console.log(`\n  Bild: ${BILD}`)
  }

  console.log(fehler ? `\n  ${fehler} Abweichung(en)` : '\n  ohne Abweichung')
} finally {
  // IM `finally`: Ein Werkzeug, das nur auf dem gruenen Weg aufraeumt, laesst
  // die geliehene Vorschau gerade dann verstellt stehen, wenn es einen Fehler
  // gefunden hat — also genau dann, wenn als naechstes jemand hinsieht.
  await brw.schliessen()
  await leihe.zurueckgeben()
}

process.exit(PRUEFEN && fehler ? 1 : 0)
