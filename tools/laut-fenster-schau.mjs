#!/usr/bin/env node
/**
 * STEHT DAS LAUTSTAERKE-FENSTER GANZ AUF DEM SCHIRM — IN JEDEM ZUSTAND?
 *
 * WOFUER: Am 03.08.2026 war das laute Ende des Reglers am Geraet nicht mehr
 * zu treffen. Gemeldet als „leiser geht, lauter nicht". Gemessen: das Fenster
 * lag bei x 273..977 auf einem 800-px-Schirm, die rechten 177 px also
 * ausserhalb.
 *
 * DIE URSACHE WAR NICHT AM FENSTER: Es haengt als `position: absolute` am
 * Kissen (`.mp` ist `position: relative`) und sass mit `left: 50%` auf dessen
 * MITTE. Solange das Kissen mittig stand, war dessen Mitte auch die Mitte des
 * Schirms. Seit b24cb1c1 („der eingeklappte miniplayer soll sich ganz rechts
 * einordnen") faehrt das Kissen rechts ein — 326 px breit, rechte Kante bei
 * 788, Mitte also bei 625 statt 400. Das 704 px breite Fenster nahm die
 * Verschiebung von 225 px eins zu eins mit.
 *
 * WARUM EIN EIGENES WERKZEUG: tools/leiste-platz-schau.mjs misst das Fenster
 * NUR im eingefahrenen Zustand. Genau darum konnte die Regression entstehen,
 * ohne dass etwas rot wurde — der ausgefahrene Zustand war nie eine Frage.
 * Hier sind BEIDE Zustaende eine Frage, dazu die Verwaltungsregler, die die
 * Kissenbreite veraendern, und die Bewegung dazwischen.
 *
 * DIE SORTEN, DIE ES GIBT (llmwiki attrappe-gruen-geraet-rot-loser-titel — die
 * Frage ist nicht „stelle ich den Fall?", sondern „welche SORTEN gibt es?"):
 *   1. ausgefahren, Standardbreite      Kissen 688 px, mittig-artig
 *   2. eingefahren, Standardbreite      Kissen 326 px, rechts   <- war rot
 *   3. ausgefahren, Kissen schmaler     `--mupi-mp-b` 0.5, rechts
 *   4. Knoepfe groesser                 `--mupi-btn` 1.3, eingefahren breiter
 *   5. WAEHREND der 220-ms-Bewegung     darf nicht wandern
 *
 * PUNKT 5 IST DER, DEN MAN VERGISST: Ein Fenster, das an der MITTE des
 * Kissens haengt, wandert waehrend des Einfahrens ueber 112 px mit, weil die
 * Mitte wandert. Steht es an der RECHTEN Kante, steht es still — die rechte
 * Kante des Kissens liegt in beiden Zustaenden bei Schirmbreite minus 12 px,
 * denn eingefahren wird links (die Kategorienleiste), nicht rechts.
 *
 * WAS ES AENDERT: nichts. Eigener Browser gegen tools/neu-vorschau.mjs, nur
 * gelesen und getippt. Weder die Box noch Dateien werden angefasst.
 *
 * AUFRUF
 *     node tools/laut-fenster-schau.mjs             # Tabelle
 *     node tools/laut-fenster-schau.mjs --pruefen   # Ende 1 bei Abweichung
 *     node tools/laut-fenster-schau.mjs http://…    # andere Vorschau
 */
import WebSocket from 'ws'
import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'

const ZIEL = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8299/neu/'
const PRUEFEN = process.argv.includes('--pruefen')

/** Der Schirm der Box. 800x480 sind 0,14 mm/px. */
const SCHIRM_B = 800
const SCHIRM_H = 480

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
const brw = await eigenerBrowser({ fenster: `${SCHIRM_B},${SCHIRM_H}` }).catch(async (e) => {
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

try {
  await warte(1500)
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  // 800x480 GENAU — `--window-size` allein laesst dem Sichtfenster im
  // headless-Chromium weniger Hoehe (siehe tools/leiste-platz-schau.mjs).
  await send(ws, 'Emulation.setDeviceMetricsOverride', {
    width: SCHIRM_B,
    height: SCHIRM_H,
    deviceScaleFactor: 1,
    mobile: false,
  })
  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value

  await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
  await warte(2500)

  // ── Bausteine ───────────────────────────────────────────────────────────

  /** Das Fenster aufmachen, falls es zu ist — ueber den Knopf, nicht ueber
   *  `hidden`: sonst laeuft die Logik in app.js nicht mit und wir messen ein
   *  Fenster, das es so am Geraet nie gibt. */
  const fensterAuf = () =>
    ev(`(() => {
      const f = document.getElementById('mp-laut-fenster');
      if (f && f.hidden) document.getElementById('mp-laut').click();
      return !!f && !f.hidden })()`)

  /**
   * Die Geometrie in einem Rutsch: Fenster, Kissen, Schirm — und ob der
   * Regler an BEIDEN Enden wirklich getroffen wird.
   *
   * GEMESSEN WIRD MIT `elementFromPoint`, NICHT MIT DEM RECHTECK: Ein
   * Rechteck, das auf dem Schirm liegt, sagt noch nicht, dass dort auch der
   * Regler antwortet — darueber koennte etwas anderes liegen. Und ein
   * Rechteck, das aus dem Schirm ragt, liefert trotzdem Zahlen.
   */
  const messen = () =>
    ev(`(() => {
      const f = document.getElementById('mp-laut-fenster');
      const mp = document.getElementById('mp');
      if (!f || f.hidden) return null;
      const r = f.getBoundingClientRect(), m = mp.getBoundingClientRect();
      const reg = document.getElementById('mp-laut-regler').getBoundingClientRect();
      const treffer = (x) => {
        const o = document.elementFromPoint(x, Math.round(reg.top + reg.height / 2));
        return !!(o && o.id === 'mp-laut-regler');
      };
      return {
        links: Math.round(r.left), rechts: Math.round(r.right), breit: Math.round(r.width),
        kissenL: Math.round(m.left), kissenR: Math.round(m.right), kissenB: Math.round(m.width),
        schirm: window.innerWidth,
        // 8 px hinein, nicht auf den Punkt: der Griff ist rund, die letzte
        // Spalte gehoert zur Bahn und ist empfindlich.
        leise: treffer(reg.left + 8), laut: treffer(reg.right - 8),
        oben: Math.round(r.top), reglerB: Math.round(reg.width),
      } })()`)

  /** Ein Rollereignis in der Buehne — wie ein Fingerzug, nur reproduzierbar. */
  const rollen = (top = 220) =>
    ev(
      `(() => { const b = document.getElementById('buehne'); b.scrollTop = ${top};
                b.dispatchEvent(new Event('scroll')); return b.scrollTop })()`,
    )

  /** Einfahren erzwingen und warten, bis die 220 ms durch sind. */
  const einfahren = async () => {
    await rollen(220)
    await warte(500)
    return ev(`document.body.classList.contains('platz-machen')`)
  }

  /** Ausfahren: die Klasse wird von der Ruhezeit zurueckgenommen. */
  const ausfahren = async () => {
    await rollen(0)
    await warte(5600)
    return !(await ev(`document.body.classList.contains('platz-machen')`))
  }

  /** Eine Wischgeste als echte Zeigereignisse — uebernommen aus
   *  tools/leiste-platz-schau.mjs, wo sie die Leiste zurueckholt. */
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

  /** Einen Verwaltungsregler setzen — genau so, wie app.js es tut (`s.setProperty`). */
  const stellen = (name, wert) =>
    ev(`(() => { document.documentElement.style.setProperty('${name}', '${wert}'); return true })()`)

  /** Der Pruefsatz fuer EINE Lage. Er ist ueberall derselbe, damit keine Sorte
   *  versehentlich milder geprueft wird als eine andere. */
  const beurteilen = (was, g) => {
    if (!g) {
      zeile(was, 'FENSTER GEHT NICHT AUF')
      melde(`${was}: der Lautstaerke-Knopf oeffnet kein Fenster`)
      return
    }
    zeile(was, `${g.breit} px, x ${g.links}..${g.rechts} (Kissen x ${g.kissenL}..${g.kissenR}, Schirm ${g.schirm})`)
    zeile(
      '  Regler an beiden Enden treffbar',
      `${g.leise ? 'leise ja' : 'leise NEIN'}, ${g.laut ? 'laut ja' : 'laut NEIN'}`,
    )
    if (g.links < 0 || g.rechts > g.schirm) melde(`${was}: das Fenster ragt aus dem Schirm (x ${g.links}..${g.rechts})`)
    if (!g.leise || !g.laut) melde(`${was}: der Regler ist nicht an beiden Enden treffbar`)
    if (g.oben < 0) melde(`${was}: das Fenster ragt oben aus dem Schirm (y ${g.oben})`)
  }

  // ── Sorte 1 und 2: ausgefahren und eingefahren, Standardbreite ──────────
  console.log('\n  ── Standardbreite ──')
  await ausfahren()
  await fensterAuf()
  const aus1 = await messen()
  beurteilen('ausgefahren', aus1)

  await einfahren()
  await fensterAuf()
  const ein1 = await messen()
  beurteilen('eingefahren', ein1)

  // DIE EIGENTLICHE FRAGE DIESES WERKZEUGS: Beide Zustaende muessen dieselbe
  // Lage ergeben. Wandert das Fenster beim Einfahren, haengt es am Kissen
  // statt am Schirm — und dann ist es nur eine Frage der Kissenbreite, wann es
  // wieder herausragt.
  if (aus1 && ein1) {
    const wandert = Math.abs(aus1.links - ein1.links)
    zeile('Verschiebung aus- -> eingefahren', `${wandert} px`)
    if (wandert > 2) melde(`das Fenster wandert beim Einfahren um ${wandert} px — es haengt am Kissen statt am Schirm`)
  }

  // ── Sorte 5: waehrend der Bewegung ──────────────────────────────────────
  //
  // Nicht „nachher steht es richtig", sondern „es steht die ganze Zeit". Wer
  // gerade am Regler zieht, waehrend das Kissen faehrt, darf ihn nicht unter
  // dem Finger wegwandern sehen.
  //
  // GEMESSEN WIRD DIE AUSFAHRT, NICHT DIE EINFAHRT — und das ist kein
  // Ausweichen vor dem schwereren Fall: Beim EINfahren macht `geruehrt()` das
  // Fenster absichtlich zu (app.js, „das Fenster ist 704 px breit und liegt
  // ueber genau dem, was gerade durchgeblaettert wird"). Dort gibt es also
  // nichts zu beobachten. Beim AUSfahren bleibt es offen: Das Kissen waechst
  // in 220 ms von 326 auf 688 px, und genau dann zeigt sich, ob das Fenster an
  // ihm haengt. Der erste Anlauf dieses Werkzeugs tastete die falsche Richtung
  // ab und bekam eine LEERE Reihe zurueck — eine Messung, die nichts misst und
  // dabei gruen aussieht.
  console.log('\n  ── Waehrend der 220-ms-Bewegung (Ausfahrt) ──')
  await einfahren()
  await fensterAuf()
  // Der Wisch vom linken Rand holt die Leiste SOFORT zurueck — ohne ihn muesste
  // man die Ruhezeit abwarten, und die ist laenger als die 4 s, nach denen sich
  // das Fenster von selbst schliesst (LAUT_FENSTER_MS).
  const bahn = []
  const mitmessen = (async () => {
    for (let i = 0; i < 16; i++) {
      const g = await messen()
      bahn.push(g ? g.links : 'zu')
      await warte(20)
    }
  })()
  await wisch(14, 240, 150, 244)
  await mitmessen
  const zahlen = bahn.filter((b) => typeof b === 'number')
  const spanne = zahlen.length ? Math.max(...zahlen) - Math.min(...zahlen) : -1
  zeile('linke Kante, abgetastet', bahn.join(' '))
  zeile('groesste Abweichung waehrend der Fahrt', `${spanne} px`)
  if (!zahlen.length) melde('waehrend der Ausfahrt war kein Fenster offen — die Messung hat nichts gemessen')
  else if (spanne > 2) melde(`das Fenster wandert waehrend der Bewegung um ${spanne} px`)

  // ── Sorte 3: das Kissen schmaler gestellt ───────────────────────────────
  //
  // „Breite" in der Verwaltung macht das Kissen kuerzer, und seit b24cb1c1
  // sitzt es dabei rechts. Wer das Fenster an der Kissenmitte aufhaengt,
  // schiebt es mit jedem Schritt dieses Reglers weiter nach rechts.
  console.log('\n  ── Verwaltung: Kissen schmaler (--mupi-mp-b 0.5) ──')
  await ausfahren()
  await stellen('--mupi-mp-b', '0.5')
  await warte(400)
  await fensterAuf()
  beurteilen('ausgefahren, halbe Breite', await messen())
  await stellen('--mupi-mp-b', '1')
  await warte(400)

  // ── Sorte 4: groessere Knoepfe ──────────────────────────────────────────
  //
  // `--mupi-btn` geht in die Breite des EINGEFAHRENEN Kissens ein
  // (4 Knoepfe + 5 Abstaende). Ein groesseres Kissen heisst eine andere Mitte.
  console.log('\n  ── Verwaltung: Tasten groesser (--mupi-btn 1.3) ──')
  await stellen('--mupi-btn', '1.3')
  await warte(400)
  await einfahren()
  await fensterAuf()
  beurteilen('eingefahren, grosse Tasten', await messen())
  await stellen('--mupi-btn', '1')

  console.log(fehler ? `\n  ${fehler} Abweichung(en)\n` : '\n  ohne Abweichung\n')
} catch (e) {
  console.error(`  FEHLER  ${e.message}`)
  fehler++
} finally {
  // IM `finally`: Ein Werkzeug, das nur auf dem gruenen Weg aufraeumt, laesst
  // die geliehene Vorschau gerade dann verstellt stehen, wenn es einen Fehler
  // gefunden hat — also genau dann, wenn als naechstes jemand hinsieht.
  await brw.schliessen()
  await leihe.zurueckgeben()
}

process.exit(PRUEFEN && fehler ? 1 : 0)
