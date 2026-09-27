#!/usr/bin/env node
/**
 * DER EINE RUECKWEG UND DAS WAPPEN — gemessen, nicht behauptet.
 *
 * WOFUER, woertlich weitergegeben (03.08.2026): „das mixpi bild soll nicht mehr
 * wechseln beim spielen sondern statisch beim standart bleiben und gans links
 * in die ecke rutschen. MixPiBox soll geteilt werden zu MixPi und Box und
 * untereinander stehen links unten und ganz unten eine laufende versionsnr
 * klein" — und: „an die freie stelle soll ein systemweiter zurueck button hin".
 *
 * ── UND DIE BERICHTIGUNG (Betreiber, 05.08.2026) ────────────────────────
 *
 * „ich wollte niemals die mixpi figur unten links, ich wollte sie oben links,
 * schon vorbereitend fuer den platz des bildes. damals ging was schief :)"
 *
 * DER SATZ VON OBEN NANNTE ZWEI ZIELORTE: das BILD sollte „gans links in die
 * ecke", der NAME „links unten". Gelesen wurde er als EIN Zielort, und das
 * Bild wanderte mit dem Namen nach unten ins Wappen. Seit dem 05.08.2026
 * steht es oben links im Zeichen „wer hoert" (`#ich-bild`); unten blieben
 * Name und laufende Fassung, beides ausdruecklich gewuenscht.
 *
 * DIESES WERKZEUG MISST DESHALB BEIDE ORTE: dass unten KEIN Bild mehr steht
 * (sonst waeren es zwei), und dass oben eines steht, seine Groesse haelt und
 * beim Spielen nicht wechselt. Der letzte Punkt war der urspruengliche
 * Wunsch, und er gilt unveraendert weiter — nur eben an der anderen Stelle.
 *
 * ── WAS HIER GEMESSEN WIRD, UND WARUM ES NICHT AM QUELLTEXT GEHT ─────────
 *
 * „Systemweit" ist eine Aussage ueber ALLE Ebenen, nicht ueber eine. Der
 * teure Fehler ist nicht der Knopf, der fehlt — es ist der Knopf, der auf
 * FUENF Ebenen richtig sitzt und auf der sechsten unter einer Vollbild-Ansicht
 * liegt. Am Quelltext sieht man das nicht; am Bildschirm sieht man es nur,
 * wenn man genau diese Ebene aufsucht.
 *
 * DESHALB WIRD JEDE SORTE VON EBENE GESTELLT, nicht eine Auswahl:
 *   Startseite · Regal · Lane · Titelliste · Interpretenseite ·
 *   grosser Player · grosse Albumansicht
 * Das ist die Lehre aus [attrappe-gruen-geraet-rot-loser-titel]: Die Frage ist
 * nicht „stelle ich den Fall?", sondern „welche Sorten gibt es, und stelle ich
 * von jeder eine?".
 *
 * Und dazu die drei Sorten BOXNAME, denn die Teilung „MixPi"/„Box" gilt nur
 * fuer eine davon:
 *   mit „Box" am Ende · ohne · ein Name, der in 88 px umbrechen muss
 *
 * JE EBENE WIRD GEPRUEFT:
 *   * ist der Knopf da, 64 x 64 px gross (9 mm, ISO 9241-411) und WIRD ER
 *     GETROFFEN (elementFromPoint — ein Knopf unter einer Vollbild-Ansicht
 *     besteht jede andere Pruefung und ist trotzdem tot)?
 *   * ist er auf der Startseite ausgegraut und sonst bedienbar?
 *   * verlaesst EIN Tipp genau EINE Ebene — nicht zwei, nicht null?
 *   * gibt es sonst noch einen Ausgang? („ersetzen, nicht ergaenzen")
 *
 * WAS ES AENDERT: nichts. Eigener Browser gegen tools/neu-vorschau.mjs. Der
 * Boxname wird ueber /vorschau/name-… umgestellt und am Ende zurueckgelegt —
 * sonst faende der naechste Schritt eine Lage vor, die niemand bestellt hat.
 *
 * AUFRUF
 *     node tools/rueckweg-schau.mjs
 *     node tools/rueckweg-schau.mjs --pruefen
 *     node tools/rueckweg-schau.mjs --bild rueckweg.png
 */
import { writeFile } from 'node:fs/promises'
import WebSocket from 'ws'
import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'

const ZIEL = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8299/neu/'
const PRUEFEN = process.argv.includes('--pruefen')
const BILD = (() => {
  const i = process.argv.indexOf('--bild')
  return i >= 0 ? process.argv[i + 1] || 'rueckweg.png' : null
})()

/**
 * 800x480 sind 0,14 mm/px; 9 mm nach ISO 9241-411 sind 64,29 px.
 *
 * 66 SEIT DEM 05.08.2026 (BACKLOG E8/T2), vorher 64 — und die 64 waren
 * ABGERUNDET, nicht aufgerundet. Die Zahl steht als `--griff` im Stilblatt und
 * wird beim Messen VON DER SEITE GEHOLT (siehe `griffLesen()` weiter unten);
 * hier steht nur der Rueckfall fuer den Fall, dass sie dort nicht zu finden
 * ist. Zwei Fassungen derselben Zahl liefen sonst auseinander, sobald jemand
 * die eine anfasst — genau das ist beim Einzug der Eltern-Kopfzeile passiert,
 * wo die 64 als nackte Zahl in einer `calc()`-Rechnung stand.
 */
const ZIEL_PX_RUECKFALL = 66

/**
 * DIE AUSGAENGE, DIE ES NICHT MEHR GEBEN DARF.
 *
 * Der Wunsch war ausdruecklich „ein systemweiter Knopf", und ein siebter
 * Ausgang neben sechs abgeschafften waere das Gegenteil davon. Diese Liste ist
 * der Waechter: Wer einen der alten Knoepfe wieder einbaut, faellt hier auf,
 * und nicht erst der Nutzerin.
 */
const ABGESCHAFFT = [
  ['.lane-zurueck', 'der Pfeil in der Lane-Kopfzeile'],
  ['#ag-zurueck', 'der Rueckweg der grossen Albumansicht'],
  ['#gross-zu', 'das Kreuz des grossen Players'],
  ['#interpret-zurueck', 'der Rueckweg der Interpretenseite'],
  ['#regal-zurueck', 'die Rueckweg-Zeile des Regals'],
]

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

const schalten = async (was) => {
  try {
    await fetch(new URL(`/vorschau/${was}`, ZIEL), { signal: AbortSignal.timeout(1500) })
  } catch {
    /* laeuft gegen eine echte Box — dann gibt es den Schalter nicht */
  }
}

try {
  await warte(1500)
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  // Ohne das misst man einen Schirm, den es nicht gibt: `--window-size` liess
  // dem Sichtfenster nur 337 statt 480 px Hoehe.
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })
  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value

  const laden = async () => {
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warte(2600)
  }
  await laden()

  /**
   * DIE GEFORDERTE GROESSE KOMMT AUS DEM STILBLATT, nicht aus diesem Werkzeug.
   *
   * `--griff` ist die EINE Stelle, an der die kleinste Trefferflaeche steht
   * (NewDesign/app.css). Stuende die Zahl hier noch einmal, waere sie eine
   * zweite Fassung — und die faellt genau dann auseinander, wenn jemand die
   * erste anhebt. Am 05.08.2026 ist das passiert: `--griff` ging von 64 auf 66
   * (E8/T2, 74 Ziele lagen um drei Zehntel eines Bildpunktes unter der Marke),
   * und dieses Werkzeug meldete daraufhin die KOPFZEILE als zu hoch — sie ist
   * genau so hoch wie der Knopf darin, und das soll sie sein.
   */
  const ZIEL_PX = await (async () => {
    const roh = await ev(
      `parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--griff')) || 0`,
    )
    return Number(roh) > 0 ? Math.round(Number(roh)) : ZIEL_PX_RUECKFALL
  })()

  console.log(`\nRUECKWEG UND WAPPEN  (${ZIEL}, Fenster 800x480, --griff ${ZIEL_PX} px)`)

  // ═════════════════════════════════════════════════════════════════════
  //  0. GEGENPROBE: gibt es den Knopf ueberhaupt?
  //
  //  Ohne sie waere jede Zahl unten wertlos — ein fehlendes Element meldet
  //  „keine Ueberlappung" und „nicht ausgegraut" genauso brav wie ein
  //  richtiges (llmwiki attrappe-luegt-durch-weglassen).
  // ═════════════════════════════════════════════════════════════════════
  const gibtEs = await ev(`!!document.getElementById('zurueck')`)
  zeile('der Knopf steht im Baum', gibtEs ? 'ja' : 'NEIN')
  if (!gibtEs) {
    melde('#zurueck fehlt — alles Weitere waere wertlos')
    throw new Error('kein Rueckweg')
  }

  // ── Das Mess-Stueck, in jeder Lage dasselbe ──────────────────────────
  const KNOPF = `(() => {
    const k = document.getElementById('zurueck');
    const r = k.getBoundingClientRect();
    const mx = Math.round(r.left + r.width / 2), my = Math.round(r.top + r.height / 2);
    const o = document.elementFromPoint(mx, my);
    return {
      l: Math.round(r.left), t: Math.round(r.top),
      b: Math.round(r.width), h: Math.round(r.height),
      aus: !!k.disabled,
      // TRIFFT heisst: an der Mitte des Knopfes liegt der Knopf. Unter einer
      // Vollbild-Ansicht liegt dort die Ansicht, und der Knopf ist tot.
      // (KEINE Rueckstriche in diesem Kommentar — er steht in einem
      //  Vorlagenliteral und beendete es sonst mitten im Satz.)
      trifft: !!(o && k.contains(o)),
      // Ausgegraut faengt keine Tipps mehr ab — dann liegt dort etwas anderes,
      // und das ist RICHTIG so. Deshalb wird das Treffen nur verlangt, wenn
      // der Knopf bedienbar ist.
      oben: o ? (o.id || o.className || o.tagName) : '(nichts)',
    };
  })()`

  /** Welche Ebenen stehen gerade offen? Aus dem Baum gelesen, wie in app.js. */
  const LAGE = `(() => {
    const imBild = (e) => !!(e && e.getClientRects().length);
    return {
      albumGross: imBild(document.getElementById('album-gross')),
      player: imBild(document.getElementById('gross')),
      titelListe: [...document.querySelectorAll('.lane-tief')].some(imBild),
      lane: [...document.querySelectorAll('#raster > .lane')].some(imBild),
      interpret: imBild(document.getElementById('interpret')),
      regal: !document.getElementById('regal-kopf').hidden,
    };
  })()`

  /**
   * DIE RANGFOLGE, in der die Ebenen uebereinanderliegen — dieselbe wie in
   * `naechsterRueckweg` (app.js). Sie steht hier ein zweites Mal, und das ist
   * Absicht: Waere sie aus der Oberflaeche abgeleitet, prueften wir die Regel
   * an sich selbst. Die reine Regel wird getrennt geprueft
   * (node tools/pruef-neu-regeln.js); HIER wird geprueft, dass sich die
   * Oberflaeche daran haelt.
   */
  const RANG = ['albumGross', 'player', 'titelListe', 'lane', 'interpret', 'regal']

  const offeneEbenen = async () => {
    const l = await ev(LAGE)
    return RANG.filter((k) => l[k])
  }

  const tippZurueck = async () => {
    await ev(`document.getElementById('zurueck').click()`)
    await warte(500)
  }

  /** Alles auf Anfang. */
  const zuruecksetzen = async () => {
    // ZWANZIG statt „bis nichts mehr offen ist": eine Schleife, die auf ein
    // Ergebnis wartet, das ausbleiben kann, wartet ewig.
    for (let i = 0; i < 20; i++) {
      if ((await offeneEbenen()).length === 0) break
      await tippZurueck()
    }
    await ev(`(() => {
      const k = document.querySelector('#leiste .kat'); if (k) k.click();
      const b = document.getElementById('buehne'); b.scrollTop = 0;
      return true })()`)
    await warte(400)
  }

  // ── Die Wege zu den Ebenen ───────────────────────────────────────────
  const rasterTipp = () =>
    ev(`(() => {
      const k = [...document.querySelectorAll('#raster > .kachel:not(.regal)')]
        .find((x) => (x.querySelector('.kachel-titel')||{}).textContent === ${JSON.stringify(PLAYLIST)});
      if (!k) return 'keine Kachel'; k.click(); return 'ok' })()`)

  const regalAuf = () =>
    ev(`(() => {
      const k = document.querySelector('#raster > .kachel.regal');
      if (!k) return 'kein Regal'; k.click(); return 'ok' })()`)

  /** Die Playlist antippen — sie steckt womoeglich in einem Regal. */
  const laneAuf = async () => {
    if ((await rasterTipp()) === 'ok') return 'ok'
    const regale = await ev(`document.querySelectorAll('#raster > .kachel.regal').length`)
    for (let i = 0; i < regale; i++) {
      await ev(`(document.querySelectorAll('#raster > .kachel.regal')[${i}] || {click(){}}).click()`)
      await warte(500)
      if ((await rasterTipp()) === 'ok') return 'ok'
      await tippZurueck()
    }
    return 'keine Kachel'
  }

  const EBENEN = [
    {
      name: 'Startseite',
      hin: async () => 'ok',
      ziel: null,
    },
    {
      name: 'Regal eines Interpreten',
      hin: async () => {
        const a = await regalAuf()
        await warte(700)
        return a
      },
      ziel: 'regal',
    },
    {
      name: 'Lane (Alben einer Playlist)',
      hin: async () => {
        const a = await laneAuf()
        await warte(1600)
        return a
      },
      ziel: 'lane',
    },
    {
      name: 'Titelliste in der Lane',
      hin: async () => {
        const a = await laneAuf()
        await warte(1600)
        if (a !== 'ok') return a
        const b = await ev(`(() => {
          const k = document.querySelector('#raster > .lane .lane-kachel');
          if (!k) return 'keine Albumkachel'; k.click(); return 'ok' })()`)
        await warte(1200)
        return b
      },
      ziel: 'titelListe',
    },
    {
      name: 'Interpretenseite',
      hin: async () => {
        const a = await ev(`(() => {
          const k = document.querySelector('#leute .leute-kachel');
          if (!k) return 'keine Interpretenkachel'; k.click(); return 'ok' })()`)
        await warte(1800)
        return a
      },
      ziel: 'interpret',
    },
    {
      name: 'grosser Player',
      hin: async () => {
        const a = await ev(`(() => {
          const k = document.querySelector('.mp-bild'); if (!k) return 'kein Mini-Player';
          k.click(); return 'ok' })()`)
        await warte(600)
        return a
      },
      ziel: 'player',
    },
    {
      name: 'grosses Cover',
      hin: async () => {
        const a = await ev(`(() => {
          const k = document.querySelector('.mp-bild'); if (!k) return 'kein Mini-Player';
          k.click();
          const c = document.querySelector('#gross .gross-bild'); if (!c) return 'kein Cover im Player';
          c.click(); return 'ok' })()`)
        await warte(700)
        return a
      },
      ziel: 'albumGross',
    },
  ]

  for (const licht of ['hell', 'dunkel']) {
    await ev(`document.documentElement.setAttribute('data-licht', ${JSON.stringify(licht)})`)
    console.log(`\n  ══ ${licht} ══════════════════════════════════════════════`)

    for (const e of EBENEN) {
      await zuruecksetzen()
      const weg = await e.hin()
      if (weg !== 'ok') {
        melde(`${licht}/${e.name}: der Weg dorthin ging nicht (${weg}) — die Ebene bleibt ungeprueft`)
        continue
      }
      const offen = await offeneEbenen()
      const k = await ev(KNOPF)
      const sollAus = offen.length === 0
      console.log(`\n  ── ${e.name} ──`)
      zeile('offene Ebenen', offen.join(' + ') || '(keine)')
      zeile('Knopf', `${k.b} x ${k.h} px bei x ${k.l}, y ${k.t}${k.aus ? '  (ausgegraut)' : ''}`)

      // ES WIRD NICHT VERLANGT, DASS NUR DIE ZIELEBENE OFFEN IST — in der
      // Vorschau steckt die Playlist in einem Regal, eine Lane bringt also
      // immer ein Regal mit. Verlangt wird, dass die gemeinte Ebene wirklich
      // offen ist; alles andere waere eine Messung an der falschen Stelle.
      if (e.ziel && !offen.includes(e.ziel)) {
        melde(
          `${licht}/${e.name}: „${e.ziel}" ist gar nicht offen (offen: [${offen.join(', ')}]) — die Ebene bleibt ungeprueft`,
        )
        continue
      }
      if (!e.ziel && offen.length) {
        melde(`${licht}/${e.name}: es steht noch etwas offen ([${offen.join(', ')}]) — das Zuruecksetzen greift nicht`)
      }
      // DAS BILD GEHOERT HIERHIN UND NICHT ANS ENDE DER SCHLEIFE: unten ist die
      // Ebene bereits verlassen, und das Bild zeigte die naechsttiefere. Beim
      // ersten Anlauf hiess eine Datei „grosses-cover" und zeigte den Player.
      if (BILD && licht === 'hell') {
        const s = await send(ws, 'Page.captureScreenshot', { format: 'png' })
        const datei = BILD.replace(/(\.png)?$/, `-${e.name.replace(/[^a-zA-Z]+/g, '-').toLowerCase()}.png`)
        await writeFile(datei, Buffer.from(s.data, 'base64'))
        console.log(`  Bild: ${datei}`)
      }

      if (k.b < ZIEL_PX || k.h < ZIEL_PX) {
        melde(`${licht}/${e.name}: der Knopf ist ${k.b}x${k.h} px, unter den geforderten ${ZIEL_PX}`)
      }
      if (k.aus !== sollAus) {
        melde(
          sollAus
            ? `${licht}/${e.name}: der Knopf ist bedienbar, obwohl es nichts gibt, wohin`
            : `${licht}/${e.name}: der Knopf ist ausgegraut, obwohl eine Ebene offen steht`,
        )
      }
      if (!sollAus) {
        zeile('wird getroffen', k.trifft ? 'ja' : `NEIN — dort liegt ${k.oben}`)
        if (!k.trifft) melde(`${licht}/${e.name}: der Knopf liegt unter ${k.oben} und ist nicht zu treffen`)

        // EIN TIPP, EINE EBENE. Der teure Fehler ist nicht der Knopf, der
        // nichts tut — es ist der, der zwei Ebenen auf einmal wegnimmt. Weg
        // muss die OBERSTE sein, und nur sie; alles darunter bleibt stehen.
        const oberste = offen[0]
        const soll = offen.filter((x) => x !== oberste)
        await tippZurueck()
        const danach = await offeneEbenen()
        zeile('nach EINEM Tipp offen', danach.join(' + ') || '(keine)')
        if (danach.join(',') !== soll.join(',')) {
          melde(
            `${licht}/${e.name}: ein Tipp auf „${oberste}" fuehrte nach [${danach.join(', ')}], erwartet war [${soll.join(', ') || 'keine'}]`,
          )
        }
      }
    }
  }
  await ev(`document.documentElement.setAttribute('data-licht', 'hell')`)
  await zuruecksetzen()

  // ═════════════════════════════════════════════════════════════════════
  //  ERSETZT, NICHT ERGAENZT
  // ═════════════════════════════════════════════════════════════════════
  console.log('\n  ── kein zweiter Ausgang ──')
  for (const [wahl, was] of ABGESCHAFFT) {
    const n = await ev(`document.querySelectorAll(${JSON.stringify(wahl)}).length`)
    zeile(`${wahl}`, n === 0 ? 'weg' : `${n} STUECK — ${was}`)
    if (n > 0) melde(`${was} ist wieder da (${wahl}, ${n} Stueck) — es soll EINEN Ausgang geben`)
  }
  // Und die Gegenprobe auf tieferen Ebenen: eine offene Lane baut ihre
  // Kopfzeile erst beim Aufklappen, ein Waechter auf der Startseite saehe sie
  // also nie.
  await laneAuf()
  await warte(1600)
  const inDerLane = await ev(`document.querySelectorAll('.lane-zurueck').length`)
  zeile('.lane-zurueck bei OFFENER Lane', inDerLane === 0 ? 'weg' : `${inDerLane} STUECK`)
  if (inDerLane > 0) melde(`die Lane baut wieder einen eigenen Pfeil (${inDerLane} Stueck)`)
  await zuruecksetzen()

  // ═════════════════════════════════════════════════════════════════════
  //  DIE KOPFZEILE IST KNAPP — sprengt sie etwas?
  // ═════════════════════════════════════════════════════════════════════
  console.log('\n  ── Kopfzeile ──')
  const kopf = await ev(`(() => {
    const r = (s) => { const e = document.querySelector(s); if (!e) return null;
      const b = e.getBoundingClientRect();
      return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top),
               u: Math.round(b.bottom), b: Math.round(b.width), h: Math.round(b.height) } };
    const schnitt = (a, b) => (!a || !b) ? 0 :
      Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) *
      Math.max(0, Math.min(a.u, b.u) - Math.max(a.t, b.t));
    const k = r('.kopf'), z = r('.zurueck'), u = r('#kopf-unter'), s = r('.kopf-status');
    const knoepfe = [...document.querySelectorAll('.kopf-knopf')].filter((e) => !e.hidden).map((e) => {
      const b = e.getBoundingClientRect();
      return { id: e.id, b: Math.round(b.width), h: Math.round(b.height) } });
    return { k, z, u, s, knoepfe,
             zUeberText: schnitt(z, u), zUeberStatus: schnitt(z, s), textUeberStatus: schnitt(u, s) };
  })()`)
  zeile('Kopfzeile hoch', `${kopf.k.h} px`)
  zeile('Rueckweg', `x ${kopf.z.l}..${kopf.z.r}, y ${kopf.z.t}..${kopf.z.u}`)
  zeile('Eintragszahl', kopf.u ? `x ${kopf.u.l}..${kopf.u.r}` : '(fehlt)')
  zeile('Statusanzeigen', kopf.s ? `x ${kopf.s.l}..${kopf.s.r}` : '(fehlt)')
  zeile('Rueckweg auf der Eintragszahl', kopf.zUeberText === 0 ? 'nichts' : `${kopf.zUeberText} px²`)
  zeile('Rueckweg auf den Statusanzeigen', kopf.zUeberStatus === 0 ? 'nichts' : `${kopf.zUeberStatus} px²`)
  zeile('Zahl auf den Statusanzeigen', kopf.textUeberStatus === 0 ? 'nichts' : `${kopf.textUeberStatus} px²`)
  if (kopf.zUeberText > 0) melde(`der Rueckweg liegt ${kopf.zUeberText} px² auf der Eintragszahl`)
  if (kopf.zUeberStatus > 0) melde(`der Rueckweg liegt ${kopf.zUeberStatus} px² auf den Statusanzeigen`)
  if (kopf.textUeberStatus > 0) melde(`die Eintragszahl liegt ${kopf.textUeberStatus} px² auf den Statusanzeigen`)
  // SO HOCH WIE DER KNOPF DARIN, NICHT HOEHER. Die Grenze ist `--griff` und
  // keine feste Zahl: Die Kopfzeile traegt drei Knoepfe dieser Groesse, sie
  // KANN gar nicht niedriger sein — und jeder Bildpunkt darueber hinaus geht
  // der Buehne verloren. Bis zum 05.08.2026 stand hier die nackte 64; als
  // `--griff` auf 66 stieg, meldete diese Zeile einen Fehler ueber eine
  // Kopfzeile, die genau richtig war.
  if (kopf.k.h > ZIEL_PX) melde(`die Kopfzeile ist ${kopf.k.h} px hoch statt ${ZIEL_PX} — sie nimmt der Buehne Platz weg`)
  for (const kn of kopf.knoepfe) {
    if (kn.b < ZIEL_PX || kn.h < ZIEL_PX) melde(`${kn.id} ist ${kn.b}x${kn.h} px, unter den geforderten ${ZIEL_PX}`)
  }

  // ── UND DIE ANDERE LAGE DER SEITENLEISTE ──────────────────────────────
  //
  // Faehrt sie beim Blaettern ein, beginnt die Kopfzeile bei x 0 statt bei 88,
  // und der Knopf muss mitwandern. Tut er es nicht, liegt er auf dem Text.
  const eingefahren = await ev(`(() => {
    document.body.classList.add('platz-machen');
    return true })()`)
  await warte(400)
  const kopf2 = await ev(`(() => {
    const r = (s) => { const e = document.querySelector(s); if (!e) return null;
      const b = e.getBoundingClientRect();
      return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), u: Math.round(b.bottom) } };
    const schnitt = (a, b) => (!a || !b) ? 0 :
      Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) *
      Math.max(0, Math.min(a.u, b.u) - Math.max(a.t, b.t));
    const z = r('.zurueck'), u = r('#kopf-unter');
    return { z, u, ueber: schnitt(z, u) };
  })()`)
  zeile('bei eingefahrener Leiste: Rueckweg', `x ${kopf2.z.l}..${kopf2.z.r}`)
  zeile('… auf der Eintragszahl', kopf2.ueber === 0 ? 'nichts' : `${kopf2.ueber} px²`)
  if (!eingefahren || kopf2.ueber > 0) {
    melde(`bei eingefahrener Leiste liegt der Rueckweg ${kopf2.ueber} px² auf der Eintragszahl`)
  }
  await ev(`document.body.classList.remove('platz-machen'); true`)
  await warte(400)

  // ═════════════════════════════════════════════════════════════════════
  //  DAS WAPPEN — drei Sorten Boxname
  // ═════════════════════════════════════════════════════════════════════
  const WAPPEN = `(() => {
    const r = (s) => { const e = document.querySelector(s); if (!e) return null;
      const b = e.getBoundingClientRect();
      return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top),
               u: Math.round(b.bottom), b: Math.round(b.width), h: Math.round(b.height) } };
    // DAS BILD WIRD OBEN GEMESSEN, NICHT MEHR UNTEN. Die Klasse wappen-bild
    // gibt es seit dem 05.08.2026 nicht mehr (Berichtigung des Betreibers,
    // siehe Kopf dieser Datei) — waere sie wieder da, stuenden zwei MixPis
    // auf einem Schirm. (KEINE BACKTICKS IN DIESEM BLOCK: er steht selbst in
    // einem Template-Literal und endet sonst mitten im Kommentar.)
    // DIE FASSUNG WOHNT SEIT DEM 08.08.2026 IM ELTERN-MENUE (unten links,
    // Wunsch des Betreibers — index.html dokumentiert den Umzug am alten
    // Ort). Gemessen wird sie deshalb dort; .wappen-fassung gibt es nicht
    // mehr, und stuende sie wieder in der Leiste, waere DAS der Befund.
    const leiste = r('.leiste'), w = r('.wappen'), bild = r('#ich-bild'),
          altesBild = r('.wappen-bild'),
          name = r('.wappen-name'), fassung = r('#eltern-fassung'),
          alteFassung = r('.wappen-fassung'),
          kat = r('.kat-liste');
    // WAS DIE KATEGORIEN BRAUCHEN, WIRD GEMESSEN UND NICHT ABGESCHRIEBEN.
    // (KEINE RUECKWAERTS-HOCHKOMMAS: dieser Block steht in einem
    // Vorlagenliteral, siehe die Warnung ein paar Zeilen weiter oben.)
    // Hier stand unten die nackte 282 (4 x 66 + 3 x 6). Am 06.08.2026 ging der
    // gap der .kat-liste von 6 auf 15 px (2 mm statt 0,84 — der Eltern-Bereich
    // ist eine Seite und diese Leiste dort bedienbar). Gebraucht werden
    // seither 309, die Wache liess aber weiter bis 282 durch: 27 px, in denen
    // die Kategorien still schrumpfen duerfen, ohne dass hier etwas rot wird.
    // Genau die Sorte Zahl, die eine Wache in eine Attrappe verwandelt.
    const katBrauchen = (() => {
      const l = document.querySelector('.kat-liste'); if (!l) return 0;
      // AN DIE LISTE GEBUNDEN, nicht ans ganze Blatt (gerichtet 19.09.2026):
      // hier stand eine ungebundene Abfrage ueber das ganze Dokument. Die
      // zaehlt auch die App-Knoepfe in sch-apps mit (Memory, Puzzle, Rechnen,
      // Uhr, Malen) - fuenf Stueck, 0 x 0 px gross, die keinen Platz
      // brauchen. Gemessen am 800x480-Blatt: die Liste hat 4 Knoepfe a 66 px,
      // clientHeight 316 = scrollHeight 316, es rollt also nichts. Die Wache
      // rechnete aber mit 9 Knoepfen: 9*66 + 8*15 = 714 px - genau die Zahl,
      // die sie meldete. Die Variable l IST die Liste und liegt schon vor;
      // ueber sie zu fragen kann nicht an einer id vorbeilaufen. app.js macht
      // es seit je richtig (Zeile 2148, gebunden an kat-liste).
      //
      // KEINE BACKTICKS IN DIESEM KOMMENTAR: er steht INNERHALB eines
      // Template-Literals, das an den Browser geht - ein Backtick hier
      // beendet die Vorlage und reisst die Datei ab. Genau das ist beim
      // Schreiben dieser Zeilen einmal passiert.
      const kk = [...l.querySelectorAll('.kat')]; if (!kk.length) return 0;
      const g = parseFloat(getComputedStyle(l).rowGap || getComputedStyle(l).gap) || 0;
      // DIE HOEHE KOMMT AUS --griff UND NICHT AUS DEM GEMESSENEN KNOPF: der
      // ist beim Fehler selbst schon geschrumpft, und die Wache verglaeje
      // dann den Schaden mit sich selbst.
      const griff = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--griff')) || 0;
      return +(kk.length * griff + (kk.length - 1) * g).toFixed(1);
    })();
    // ZWEI ZAHLEN, NICHT EINE: was der Name BRAUCHT und was zu SEHEN ist. Der
    // Deckel (-webkit-line-clamp) macht aus beidem Verschiedenes, und nur die
    // zweite Zahl sagt etwas ueber die Hoehe der Leiste.
    const zeilen = (() => {
      const e = document.querySelector('.wappen-name'); if (!e) return { noetig: 0, gezeigt: 0, deckel: 0 };
      const s = getComputedStyle(e);
      const zh = parseFloat(s.lineHeight) || 17;
      return {
        noetig: Math.max(1, Math.round(e.scrollHeight / zh)),
        gezeigt: Math.max(1, Math.round(e.clientHeight / zh)),
        deckel: parseInt(s.webkitLineClamp, 10) || 0,
      };
    })();
    // OHNE ELEMENT KEIN LEERER WERT, SONDERN EIN WORT. Ein Oder-Leerstring
    // machte aus „das Element fehlt" und „das Attribut ist leer" dasselbe —
    // und ein Werkzeug, das ein fehlendes Element als leeren Wert
    // weiterreicht, meldet still gruen (llmwiki
    // attrappe-luegt-durch-weglassen).
    const ichImg = document.getElementById('ich-bild');
    return {
      leiste, w, bild, altesBild, alteFassung, name, fassung, kat, katBrauchen, zeilen,
      oben: (document.getElementById('wappen-oben')||{}).textContent || '',
      unten: (document.getElementById('wappen-unten')||{}).textContent || '',
      text: (document.getElementById('eltern-fassung')||{}).textContent || '',
      titel: document.title,
      quelle: ichImg ? (ichImg.getAttribute('src') || '(ohne src)') : '(#ich-bild FEHLT)',
      // GELADEN ODER NUR GESETZT? naturalWidth 0 heisst: der Pfad steht da,
      // das Bild kam nicht. Am Schirm ist das die Silhouette — und die sieht
      // aus wie eine Entscheidung.
      geladen: ichImg ? ichImg.naturalWidth > 0 : false,
      versteckt: ichImg ? ichImg.hidden : true,
    };
  })()`

  // DER LEERFALL WIRD AUSDRUECKLICH GESTELLT, nicht geerbt. Die Vorschau
  // steht von Haus aus auf `profil-liam`, und Liam hat in der Attrappe
  // `mixpi-winkt.png` gewaehlt — einen Namen ohne Datei. Wer das erbt, misst
  // die Silhouette und haelt sie fuer den Normalfall.
  // `profil-gast` IST DER FALL, UM DEN ES HIER GEHT: niemand hat etwas
  // gewaehlt, der Server sagt LEER — und oben links MUSS trotzdem das
  // Standardbild stehen (app.js, `ichBildPfad`). Zurueckgelegt wird am Ende.
  await schalten('profil-gast')

  for (const [was, erwartet] of [
    ['name-mitbox', 'zwei Zeilen'],
    ['name-ohnebox', 'eine Zeile'],
    ['name-lang', 'umbrechend'],
  ]) {
    await schalten(was)
    await laden()
    const m = await ev(WAPPEN)
    console.log(`\n  ── Wappen: /vorschau/${was} (${erwartet}) ──`)
    zeile('Name', `„${m.oben}"${m.unten ? ` / „${m.unten}"` : ' (einzeilig)'}`)
    zeile('Reiter-Titel', `„${m.titel}"`)
    zeile('Fassung', m.text ? `„${m.text}"` : '(leer)')
    zeile('Wappen-Bild', m.altesBild ? `DA (${m.altesBild.b}x${m.altesBild.h}) — es soll KEINES geben` : 'keines (richtig)')
    zeile(
      'Bild oben links',
      m.bild
        ? `${m.bild.b} x ${m.bild.h} px — ${m.quelle}${m.geladen ? '' : ' (NICHT GELADEN)'}`
        : '(#ich-bild fehlt)',
    )
    zeile(
      'Namensspalte',
      `${m.name.b} px breit, ${m.zeilen.gezeigt} von ${m.zeilen.noetig} Zeile(n) sichtbar (Deckel ${m.zeilen.deckel})`,
    )
    if (m.zeilen.deckel && m.zeilen.gezeigt > m.zeilen.deckel) {
      melde(`${was}: der Name zeigt ${m.zeilen.gezeigt} Zeilen, obwohl der Deckel bei ${m.zeilen.deckel} liegt`)
    }
    zeile('Wappen unterste Kante', `y ${m.w.u} (Leiste endet bei ${m.leiste.u})`)

    // NICHTS DARF UNTEN HERAUSRAGEN. Die Leiste ist `overflow: hidden` — was
    // darunter liegt, ist unsichtbar und faellt sonst niemandem auf.
    if (m.w.u > m.leiste.u) melde(`${was}: das Wappen ragt ${m.w.u - m.leiste.u} px unter die Leiste`)
    if (m.w.t < m.kat.t) melde(`${was}: das Wappen liegt ueber der Kategorienliste`)
    // DIE VIER KATEGORIEN SIND BEDIENUNG UND GEHEN VOR. Bleibt weniger als sie
    // brauchen, ROLLT DIE LISTE NICHT — sie SCHRUMPFT: `.kat` traegt `height`
    // statt `min-height`, `flex-shrink` steht auf 1, und die Knoepfe geben
    // still ein paar Pixel her. Genau deshalb steht diese Wache hier: Eine
    // rollende Liste saehe man, ein um 4,2 px kleineres Ziel sieht niemand.
    //
    // DIE ZAHL WIRD GEMESSEN, NICHT GESCHRIEBEN — und das ist die Berichtigung
    // vom 06.08.2026. Hier stand zweimal die nackte 282 (4 x 66 + 3 x 6). Sie
    // war schon einmal veraltet (274 = 4 x 64 + 18, aus der Zeit vor
    // `--griff: 66px`), und sie ist es ein zweites Mal geworden, als
    // `.kat-liste{gap}` auf 15 px ging: gebraucht werden 309, durchgelassen
    // wurde bis 282. Bei dreizeiligem Boxnamen stehen 311 px zur Verfuegung —
    // die Wache haette also erst bei 29 px Schaden angeschlagen, wo 2 px
    // Reserve sind. Eine dritte Fassung derselben Zahl gibt es deshalb nicht
    // mehr; sie kommt aus `--griff` und dem gemessenen `gap` (siehe
    // `katBrauchen` in MESS_FN).
    zeile('Platz fuer die Kategorien', `${m.kat.h} px (gebraucht: ${m.katBrauchen})`)
    if (m.katBrauchen > 0 && m.kat.h < m.katBrauchen)
      melde(
        `${was}: den Kategorien bleiben nur ${m.kat.h} px von ${m.katBrauchen} — sie schrumpfen still`,
      )
    if (m.name.l < m.leiste.l || m.name.r > m.leiste.r) {
      melde(
        `${was}: der Name laeuft seitlich aus der Leiste (x ${m.name.l}..${m.name.r} von ${m.leiste.l}..${m.leiste.r})`,
      )
    }
    // UNTEN STEHT KEIN BILD MEHR. Das ist der Kern der Berichtigung vom
    // 05.08.2026, und es ist die Sorte Aenderung, die jemand in gutem Glauben
    // zurueckdreht („da fehlt doch was"). Steht wieder eines da, sind es zwei
    // MixPis auf einem Schirm — und das faellt beim Bauen nicht auf.
    if (m.altesBild) {
      melde(`${was}: im Wappen steht wieder ein Bild (${m.altesBild.b}x${m.altesBild.h} px) — es gehoert oben links`)
    }
    // DIE 44-px-WACHE IST MIT DEM BILD GEWANDERT. Sie ist die Lehre aus einer
    // stillen Klassenkollision: `.marke` (die Dienst-Plakette der Kacheln)
    // traf einmal dasselbe Element und quetschte es mit
    // `width: clamp(22px, …, 34px)` auf 27 px — ohne Fehlermeldung, nur
    // falsch aussehend (llmwiki wappen-hiess-marke-und-kollidierte). Ohne
    // diese Zeilen an der NEUEN Stelle faellt die Wache ersatzlos weg.
    if (!m.bild) {
      melde(`${was}: es gibt gar kein #ich-bild — das Zeichen oben links kann nichts zeigen`)
    } else {
      if (m.bild.b < 40 || m.bild.h < 40) {
        melde(`${was}: das Bild oben links ist auf ${m.bild.b}x${m.bild.h} px gequetscht`)
      }
      // NICHT NUR „ein src steht da". GEMESSEN WIRD, OB ES ANKAM: Ein Pfad
      // auf eine 404 sieht am Schirm aus wie „kein Bild gewaehlt", also wie
      // die Silhouette — und die ist seit dem 05.08.2026 der NOTFALL und
      // nicht mehr der Normalfall. Genau diese Verwechslung hat schon einmal
      // einen toten Vorgabewert monatelang getragen (llmwiki
      // vorgabewert-ueberlebt-den-umzug-seines-ordners).
      if (!m.quelle.endsWith('mixpi-hoert.png')) {
        melde(`${was}: oben links steht ${m.quelle} statt des Standardbildes`)
      }
      if (!m.geladen) melde(`${was}: ${m.quelle} ist gesetzt, aber nicht geladen — zu sehen ist die Silhouette`)
      if (m.versteckt) melde(`${was}: das Bild oben links ist versteckt — zu sehen ist die Silhouette`)
    }
    // Seit dem 08.08.2026 steht die Fassung im Eltern-Menue (#eltern-fassung)
    // — leer heisst weiter: /api/aktualisierung kam nicht an oder
    // fassungHolen ist gebrochen. Und stuende sie WIEDER in der Leiste,
    // waere das ein eigener Befund (zwei Orte, eine Zahl).
    if (!m.text) melde(`${was}: die Fassung (im Eltern-Menue) ist leer — kam /api/aktualisierung nicht an?`)
    if (m.alteFassung) melde(`${was}: .wappen-fassung ist zurueck in der Leiste — die Fassung wohnt seit 08.08. im Eltern-Menue`)
    // Die Teilung selbst: mit „Box" am Ende MUSS es zwei Zeilen geben, ohne
    // darf es keine zweite geben. Sonst prueft dieser Lauf nur, dass etwas
    // dasteht.
    if (was === 'name-mitbox' && (!m.unten || m.unten.toLowerCase() !== 'box')) {
      melde(`${was}: die zweite Zeile ist „${m.unten}" statt „Box" — die Teilung greift nicht`)
    }
    if (was === 'name-ohnebox' && m.unten) {
      melde(`${was}: „${m.oben}" wurde geteilt, obwohl der Name nicht auf Box endet (zweite Zeile „${m.unten}")`)
    }

    if (BILD) {
      const s = await send(ws, 'Page.captureScreenshot', { format: 'png' })
      const datei = BILD.replace(/(\.png)?$/, `-${was}.png`)
      await writeFile(datei, Buffer.from(s.data, 'base64'))
      console.log(`  Bild: ${datei}`)
    }
  }

  // ZURUECKLEGEN. Sonst faende der naechste Schritt in pruefen.sh eine Lage
  // vor, die niemand bestellt hat — am 03.08.2026 genau so passiert
  // — es stellt die Vorschau um und legt sie danach zurueck.
  await schalten('name-mitbox')

  // ── UND DASS DAS BILD WIRKLICH STEHENBLEIBT ──────────────────────────
  //
  // Der Wunsch war „nicht mehr wechseln beim spielen". Ein Blick auf die
  // ruhende Seite beweist das NICHT — gemessen wird ueber den Wechsel hinweg:
  // still, dann spielend, dann wieder still.
  console.log('\n  ── bleibt das Bild beim Spielen stehen? ──')
  await laden()
  // GEMESSEN WIRD JETZT `#ich-bild`. Hier stand `wappen-bild`, und ein
  // `getElementById(…).getAttribute` auf ein Element, das es nicht mehr gibt,
  // WIRFT IN DER SEITE: Die Auswertung liefert dann viermal `undefined`,
  // `verschieden.size` ist 1 — und diese Pruefung meldete GRUEN, ohne
  // irgendetwas gemessen zu haben. Deshalb steht das `||` hier und nicht
  // ein stiller Rueckfall: fehlt das Element, kommt ein Wort heraus, das
  // unten auffaellt.
  const quelleVon = () =>
    ev(`(() => {
      const i = document.getElementById('ich-bild');
      return i ? (i.getAttribute('src') || '(ohne src)') : '(#ich-bild FEHLT)';
    })()`)
  const zustaende = []
  for (const lage of ['still', 'spielt', 'pause', 'still']) {
    await schalten(lage)
    // Der Maler laeuft im Sekundentakt; zwei Takte abwarten.
    await warte(2400)
    zustaende.push([lage, await quelleVon()])
  }
  for (const [lage, q] of zustaende) zeile(`bei „${lage}"`, q)
  const verschieden = new Set(zustaende.map(([, q]) => q))
  if (verschieden.size !== 1) melde(`das Bild oben links wechselt weiterhin (${[...verschieden].join(' / ')})`)
  // UND ES MUSS AUCH WIRKLICH EINES GEWESEN SEIN. Ohne diese Zeile bestuende
  // die Pruefung oben auch dann, wenn viermal dasselbe NICHTS gemessen wurde
  // — vier gleiche Fehlermeldungen sind ebenfalls „ein einziger Wert".
  const einzig = [...verschieden][0] || ''
  if (!einzig.endsWith('mixpi-hoert.png')) {
    melde(`beim Spielen stand oben links „${einzig}" statt des Standardbildes`)
  }

  // UND DIE GEGENPROBE: EIN KIND MIT EIGENEM BILD BEKOMMT SEINES.
  //
  // OHNE SIE BEWIESE ALLES OBEN NUR, DASS IRGENDWO EIN MixPi HAENGT. Eine
  // Fassung, die stur das Standardbild setzt und die Wahl des Kindes
  // wegwirft, bestuende jede einzelne Zeile darueber — und am Schirm saehe
  // sie aus wie „das Kind hat sich halt nichts ausgesucht".
  // DER NAME WIRD BEIM SERVER ERFRAGT, NICHT HINGESCHRIEBEN.
  //
  // HIER STAND `mixpi-winkt.png` — fest. Zwei Dinge waren daran falsch, und
  // beide sahen gruen aus:
  //   1. Die Datei GAB ES NIRGENDS. `getAttribute('src')` endete auf den
  //      Namen, das Bild war eine 404, am Schirm stand die Silhouette. Die
  //      Gegenprobe „ein Kind mit eigenem Bild bekommt seines" bestand also
  //      genau in dem Fall, den sie ausschliessen soll.
  //   2. Die Lage GAB ES AN DER BOX NICHT. `GET /api/profile` nennt dort nur
  //      Figuren, zu denen eine Datei existiert — ein Name ohne Datei kaeme
  //      nie bis hierher. Gemessen wurde eine Erfindung der Attrappe.
  // Deshalb: erst fragen, was der Server fuer dieses Kind NENNT, dann pruefen,
  // dass genau das oben links steht UND WIRKLICH GELADEN IST.
  await schalten('profil-liam')
  await schalten('figuren-da')
  await laden()
  await warte(600)
  const stand = await (await fetch(new URL('/api/profile', ZIEL))).json()
  const seine = (stand.profile || []).find((p) => p.kennung === 'liam')
  const eigenes = await quelleVon()
  zeile('mit eigenem Bild', eigenes)
  if (!seine || !seine.figur) {
    melde(`die Attrappe nennt fuer Liam gar keine Figur — die Gegenprobe misst nichts`)
  } else if (!eigenes.endsWith(seine.figur)) {
    melde(`ein Kind mit eigenem Bild sieht „${eigenes}" statt seiner Figur „${seine.figur}"`)
  }
  // UND ES MUSS ANGEKOMMEN SEIN. Ein `src`, der auf den richtigen Namen endet,
  // beweist nur, dass die Oberflaeche RECHNEN kann; die Silhouette darunter
  // saehe genauso aus wie „nichts ausgesucht".
  const eigenesGeladen = await ev(
    `(() => { const i = document.getElementById('ich-bild'); return !!i && i.naturalWidth > 0 && !i.hidden })()`,
  )
  if (eigenesGeladen !== true) {
    melde(`das eigene Bild steht im src, ist aber nicht geladen — am Schirm die Silhouette`)
  }
  // ZURUECKLEGEN, was dieser Lauf umgestellt hat — die Vorschau steht von
  // Haus aus auf `figuren-keine`.
  await schalten('figuren-keine')
  await schalten('spielt')
} catch (f) {
  melde(`Messung abgebrochen: ${f && f.message}`)
} finally {
  // IM `finally`: Ein Werkzeug, das nur auf dem gruenen Weg aufraeumt, laesst
  // die geliehene Vorschau gerade dann verstellt stehen, wenn es einen Fehler
  // gefunden hat — also genau dann, wenn als naechstes jemand hinsieht.
  await brw.schliessen()
  await leihe.zurueckgeben()
}

console.log(fehler ? `\n  ${fehler} Beanstandung(en)` : '\n  keine Beanstandung')
if (PRUEFEN) process.exitCode = fehler ? 1 : 0
process.exit(PRUEFEN && fehler ? 1 : 0)
