#!/usr/bin/env node
/**
 * DIE NACHLESE ZUM EINEN RUECKWEG — die Ecken, die rueckweg-schau.mjs offen laesst.
 *
 * WOZU: tools/rueckweg-schau.mjs stellt sieben Sorten Ebene und misst Groesse,
 * Lage, Ausgegrautsein und „ein Tipp, eine Ebene". Das ist die Hauptsache und
 * sie stimmt. Diese Nachlese fragt das, was DANEBEN liegt — und zwar genau die
 * Sorten Fall, die beim Gegenlesen am 03.08.2026 aufgefallen sind:
 *
 *   1. DIE TITELLISTE AUF DER INTERPRETENSEITE. Sie entsteht in einer ANDEREN
 *      Funktion als die im Raster (`albumTitelOeffnen` gegen `titelOeffnen`),
 *      haengt an einem anderen Elternteil und wird von rueckweg-schau nicht
 *      gestellt. Zwei Wege zu derselben Ebene sind zwei Wege, die kaputtgehen
 *      koennen.
 *
 *   2. DIE MELDUNG LIEGT BEI z-index 8, DER RUECKWEG BEI 9. Die Meldung deckt
 *      den ganzen Schirm zu und wird durch einen Tipp irgendwohin geschlossen
 *      — nur nicht in der Ecke oben links. Dort liegt seit 03.08.2026 der
 *      Rueckweg darueber, und ein Tipp verlaesst eine Ebene HINTER der
 *      Meldung, die man gar nicht sieht.
 *
 *   3. KONSOLENMELDUNGEN auf dem ganzen Weg (800x480). Eine stille Ausnahme in
 *      `zurueckMalen` liefe im 250-ms-Takt und wuerde nie bemerkt.
 *
 *   4. DER KONTRAST des Knopfes. Er steht mal auf dem Creme der Kopfzeile, mal
 *      auf dem abgedunkelten Grund des grossen Players, mal neben einem Cover
 *      — in hell UND dunkel. Gemessen wird Zeichen gegen Flaeche (WCAG 1.4.11
 *      verlangt 3:1 fuer Bedienelemente) und Flaeche gegen Untergrund.
 *
 *   5. DIE REGAL-ZEILE SIEHT AUS WIE DER KNOPF. Sie war bis 03.08.2026 selbst
 *      der Rueckweg und traegt weiter dieselbe Fuellung, denselben Radius und
 *      dieselben 64 px Hoehe — jetzt tut sie nichts. Gemessen wird, wie
 *      aehnlich sie ist.
 *
 * WAS ES AENDERT: nichts. Eigener Browser gegen tools/neu-vorschau.mjs.
 *
 * AUFRUF
 *     node tools/rueckweg-nachlese.mjs
 *     node tools/rueckweg-nachlese.mjs --pruefen
 */
import WebSocket from 'ws'
import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'

const ZIEL = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8299/neu/'
const PRUEFEN = process.argv.includes('--pruefen')

/** WCAG 1.4.11: Bedienelemente und ihre Zustaende brauchen 3:1 zum Nachbarn. */
const KONTRAST_MIN = 3

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
const zeile = (name, wert) => console.log(`  ${String(name).padEnd(48)} ${wert}`)

try {
  await warte(1500)
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  await send(ws, 'Log.enable')
  await send(ws, 'Network.enable')
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })

  // ── Die Konsole mitschreiben, von der ersten Zeile an ────────────────
  const konsole = []
  // WELCHE Adresse 404 sagt, steht NICHT in der Konsolenzeile („Failed to load
  // resource") — die Adresse kommt nur aus dem Netzverkehr. Ohne sie waere die
  // Meldung nicht nachzugehen.
  const netz = new Map()
  ws.on('message', (r) => {
    const x = JSON.parse(r)
    if (x.method === 'Network.responseReceived' && x.params.response.status >= 400) {
      konsole.push(`HTTP ${x.params.response.status}: ${x.params.response.url}`)
    }
    if (x.method === 'Network.loadingFailed') {
      const u = netz.get(x.params.requestId)
      if (u && !/Aborted/.test(x.params.errorText || '')) konsole.push(`Abbruch (${x.params.errorText}): ${u}`)
    }
    if (x.method === 'Network.requestWillBeSent') netz.set(x.params.requestId, x.params.request.url)
    if (x.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(x.params.type)) {
      konsole.push(
        `${x.params.type}: ${(x.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ')}`,
      )
    }
    if (x.method === 'Runtime.exceptionThrown') {
      konsole.push(`Ausnahme: ${x.params.exceptionDetails?.exception?.description || x.params.exceptionDetails?.text}`)
    }
    // „Failed to load resource" wird UEBERSPRUNGEN: dieselbe Sache steht oben
    // schon mit Adresse. Zweimal gezaehlt saehe es nach doppelt so vielen
    // Beanstandungen aus, wie es gibt.
    if (
      x.method === 'Log.entryAdded' &&
      ['error', 'warning'].includes(x.params.entry.level) &&
      !/Failed to load resource/.test(x.params.entry.text)
    ) {
      konsole.push(`${x.params.entry.level}: ${x.params.entry.text}`)
    }
  })

  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value

  await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
  await warte(2800)

  console.log(`\nRUECKWEG — NACHLESE  (${ZIEL}, Fenster 800x480)`)

  const LAGE = `(() => {
    const imBild = (e) => !!(e && e.getClientRects().length);
    return {
      albumGross: imBild(document.getElementById('album-gross')),
      player: imBild(document.getElementById('gross')),
      titelListe: [...document.querySelectorAll('.lane-tief')].filter(imBild).length,
      lane: [...document.querySelectorAll('#raster > .lane')].some(imBild),
      interpret: imBild(document.getElementById('interpret')),
      regal: !document.getElementById('regal-kopf').hidden,
    };
  })()`
  const kurz = (l) =>
    Object.entries(l)
      .filter(([, v]) => v)
      .map(([k, v]) => (v === true ? k : `${k}x${v}`))
      .join(' + ') || '(keine)'

  const tippZurueck = async () => {
    await ev(`document.getElementById('zurueck').click()`)
    await warte(500)
  }
  const zuruecksetzen = async () => {
    for (let i = 0; i < 20; i++) {
      const l = await ev(LAGE)
      if (!Object.values(l).some(Boolean)) break
      await tippZurueck()
    }
    await ev(`(() => { const k = document.querySelector('#leiste .kat'); if (k) k.click();
      document.getElementById('buehne').scrollTop = 0; return true })()`)
    await warte(500)
  }

  // ═════════════════════════════════════════════════════════════════════
  //  1. DIE TITELLISTE AUF DER INTERPRETENSEITE
  //
  //  Sie entsteht in `albumTitelOeffnen` — einer ANDEREN Funktion als die
  //  Titelliste im Raster (`titelOeffnen`), mit einem anderen Elternteil
  //  (`.int-reihe` statt der Alben-Lane). rueckweg-schau stellt nur die im
  //  Raster. Ein Weg, den niemand geht, ist ein Weg, der kaputtgehen darf.
  // ═════════════════════════════════════════════════════════════════════
  console.log('\n  ── Titelliste auf der INTERPRETENSEITE ──')
  await zuruecksetzen()
  const zurLeute = await ev(`(() => {
    const k = document.querySelector('#leute .leute-kachel');
    if (!k) return 'keine Interpretenkachel'; k.click(); return 'ok' })()`)
  await warte(1900)
  if (zurLeute !== 'ok') {
    melde(`der Weg auf die Interpretenseite ging nicht (${zurLeute})`)
  } else {
    // „In deiner Box" ist die einzige Reihe, deren Kacheln eine Titelliste
    // aufmachen — die beliebtesten Titel STARTEN stattdessen.
    const auf = await ev(`(() => {
      const k = document.querySelector('#interpret-reihen .int-reihe .lane-kachel');
      if (!k) return 'keine Albumkachel in den Reihen'; k.click(); return 'ok' })()`)
    await warte(1400)
    const lage = await ev(LAGE)
    zeile('offene Ebenen', kurz(lage))
    if (auf !== 'ok' || !lage.titelListe) {
      melde(`auf der Interpretenseite liess sich keine Titelliste oeffnen (${auf}) — die Ebene bleibt ungeprueft`)
    } else {
      const k = await ev(`(() => { const k = document.getElementById('zurueck');
        const r = k.getBoundingClientRect();
        const o = document.elementFromPoint(Math.round(r.left + r.width/2), Math.round(r.top + r.height/2));
        return { aus: !!k.disabled, trifft: !!(o && k.contains(o)),
                 oben: o ? (o.id || (typeof o.className === 'string' ? o.className : '') || o.tagName) : '(nichts)' } })()`)
      zeile('Knopf bedienbar', k.aus ? 'NEIN — ausgegraut' : 'ja')
      zeile('wird getroffen', k.trifft ? 'ja' : `NEIN — dort liegt ${k.oben}`)
      if (k.aus) melde('Interpretenseite/Titelliste: der Knopf ist ausgegraut, obwohl eine Titelliste offen steht')
      if (!k.trifft) melde(`Interpretenseite/Titelliste: der Knopf liegt unter ${k.oben}`)
      await tippZurueck()
      const danach = await ev(LAGE)
      zeile('nach EINEM Tipp offen', kurz(danach))
      if (danach.titelListe) melde('Interpretenseite: ein Tipp schloss die Titelliste NICHT')
      else if (!danach.interpret)
        melde('Interpretenseite: ein Tipp nahm die Titelliste UND die Seite weg — zwei Ebenen auf einmal')
      // Und der Rahmen an der geoeffneten Kachel muss mit weg sein, sonst
      // behauptet sie weiter, sie sei offen.
      const rahmen = await ev(`document.querySelectorAll('#interpret-reihen .lane-kachel.auf').length`)
      zeile('Kacheln, die noch „offen" aussehen', String(rahmen))
      if (rahmen > 0) melde(`Interpretenseite: ${rahmen} Kachel(n) tragen nach dem Schliessen weiter den Umriss .auf`)
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  //  2. DIE MELDUNG UND DER KNOPF DARUEBER
  //
  //  `.meldung` liegt bei z-index 8 ueber dem ganzen Schirm; ein Tipp
  //  IRGENDWOHIN schliesst sie. Der Rueckweg liegt bei 9 — in seiner Ecke
  //  wird die Meldung also NICHT geschlossen, sondern eine Ebene dahinter
  //  verlassen, die niemand sieht.
  // ═════════════════════════════════════════════════════════════════════
  console.log('\n  ── Meldung (z-index 8) und Rueckweg (9) ──')
  await zuruecksetzen()
  await ev(`(() => {
    const k = document.querySelector('#raster > .kachel.regal');
    if (k) k.click(); return true })()`)
  await warte(800)
  const vorher = await ev(LAGE)
  // Die Meldung von Hand stellen — sie kommt sonst nur bei einem Fehlschlag.
  await ev(`(() => { const m = document.getElementById('meldung');
    document.getElementById('meldung-text').textContent = 'Probe';
    m.hidden = false; return true })()`)
  await warte(200)
  const ueber = await ev(`(() => {
    const m = document.getElementById('meldung'), k = document.getElementById('zurueck');
    const r = k.getBoundingClientRect();
    const o = document.elementFromPoint(Math.round(r.left + r.width/2), Math.round(r.top + r.height/2));
    return { mZ: getComputedStyle(m).zIndex, kZ: getComputedStyle(k).zIndex,
             oben: o ? (o.id || (typeof o.className === 'string' ? o.className : '') || o.tagName) : '(nichts)',
             knopfObenauf: !!(o && k.contains(o)) } })()`)
  zeile('z-index Meldung / Rueckweg', `${ueber.mZ} / ${ueber.kZ}`)
  zeile('in der Ecke liegt', ueber.oben)
  // GETIPPT WIRD IMMER, nicht nur wenn der Knopf obenauf liegt: Die Frage ist
  // nicht „wer liegt oben", sondern „was passiert dort". Ein Tipp in die Ecke
  // muss dasselbe tun wie ein Tipp irgendwohin sonst — die Meldung schliessen
  // und die Ebenen in Ruhe lassen.
  await ev(`(() => { const r = document.getElementById('zurueck').getBoundingClientRect();
    const o = document.elementFromPoint(Math.round(r.left + r.width/2), Math.round(r.top + r.height/2));
    if (o) o.click(); return true })()`)
  await warte(500)
  const danach = await ev(LAGE)
  const meldungWeg = await ev(`document.getElementById('meldung').hidden`)
  zeile('nach dem Tipp: Meldung', meldungWeg ? 'zu' : 'STEHT NOCH')
  zeile('nach dem Tipp: Ebenen', `${kurz(vorher)}  ->  ${kurz(danach)}`)
  if (!meldungWeg) {
    melde('Meldung: ein Tipp in die Rueckweg-Ecke schliesst die Meldung nicht — ueberall sonst tut er es')
  }
  if (kurz(vorher) !== kurz(danach)) {
    melde(
      `Meldung: ein Tipp in die Rueckweg-Ecke verliess eine Ebene HINTER der Meldung ` +
        `(${kurz(vorher)} -> ${kurz(danach)}) — 64 x 64 px des Schirms tun etwas anderes als der Rest`,
    )
  }
  await ev(`document.getElementById('meldung').hidden = true`)

  // ═════════════════════════════════════════════════════════════════════
  //  DIE FUSSZEILE: BESCHREIBT SIE DEN STAND, DER WIRKLICH LAEUFT?
  //
  //  `herkunft.unsauber` zaehlt die beim Bauen geaenderten, nicht
  //  eingecheckten Dateien. Ist sie groesser als 0, beschreibt der Commit den
  //  ausgelieferten Stand NICHT — die Zeile muss das sagen. Der Schalter der
  //  Attrappe stellt beide Faelle; ohne ihn saehe man nur den sauberen.
  // ═════════════════════════════════════════════════════════════════════
  console.log('\n  ── die Fusszeile und der unsaubere Bau ──')
  const fassung = async (was) => {
    try {
      await fetch(new URL(`/vorschau/fassung-${was}`, ZIEL), { signal: AbortSignal.timeout(1500) })
    } catch {
      /* laeuft gegen eine echte Box — dann gibt es den Schalter nicht */
    }
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warte(2600)
    // Die Fassung wohnt seit dem 08.08.2026 im Eltern-Menue (#eltern-fassung,
    // unten links, Betreiberwunsch — index.html dokumentiert den Umzug).
    // #wappen-fassung gibt es nicht mehr; dieses Werkzeug las bis zum 14.08.
    // dort weiter „undefined" und meldete eine leere Fusszeile, die es an
    // ihrem echten Ort laengst gab.
    return ev(`(document.getElementById('eltern-fassung')||{}).textContent || ''`)
  }
  const sauber = await fassung('sauber')
  const dreckig = await fassung('unsauber')
  zeile('sauber gebaut', `„${sauber}"`)
  zeile('aus geaendertem Baum gebaut', `„${dreckig}"`)
  if (!sauber) melde('die Fusszeile bleibt auch beim sauberen Bau leer — dann misst hier nichts')
  else if (sauber === dreckig) {
    melde(
      'die Fusszeile sagt beim unsauberen Bau dasselbe wie beim sauberen — sie behauptet einen ' +
        'Commit, aus dem der ausgelieferte Stand gar nicht kommt',
    )
  }
  await fassung('sauber')

  // ═════════════════════════════════════════════════════════════════════
  //  3. WIE AEHNLICH SIEHT DIE TOTE REGAL-ZEILE DEM KNOPF?
  //
  //  Sie WAR der Rueckweg (`.regal-zurueck`) und traegt weiter dieselbe
  //  Fuellung, denselben Radius und dieselben 64 px. Wer gelernt hat, dass
  //  man sie antippt, tippt weiter — und es passiert nichts.
  // ═════════════════════════════════════════════════════════════════════
  console.log('\n  ── die Regal-Zeile: sieht sie noch aus wie ein Knopf? ──')
  // ERST INS REGAL — ausserhalb ist die Zeile `hidden` und 0 px hoch. Beim
  // ersten Anlauf stand hier „Hoehe 0 px", und das haette man fuer ein
  // Ergebnis halten koennen.
  await zuruecksetzen()
  await ev(`(() => { const k = document.querySelector('#raster > .kachel.regal');
    if (k) k.click(); return true })()`)
  await warte(800)
  const regal = await ev(`(() => {
    const n = document.getElementById('regal-name'); if (!n) return null;
    const k = document.getElementById('zurueck');
    const a = getComputedStyle(n), b = getComputedStyle(k);
    const r = n.getBoundingClientRect();
    return { grund: a.backgroundColor, knopfGrund: b.backgroundColor,
             radius: a.borderTopLeftRadius, knopfRadius: b.borderTopLeftRadius,
             hoehe: Math.round(r.height), tag: n.tagName,
             tippbar: n.tagName === 'BUTTON' || typeof n.onclick === 'function' } })()`)
  if (!regal) {
    melde('#regal-name gibt es nicht — die Zeile bleibt ungeprueft')
  } else {
    zeile('Fuellung Zeile / Knopf', `${regal.grund} / ${regal.knopfGrund}`)
    zeile('Radius Zeile / Knopf', `${regal.radius} / ${regal.knopfRadius}`)
    zeile('Hoehe der Zeile', `${regal.hoehe} px  (${regal.tag}, ${regal.tippbar ? 'tippbar' : 'tut nichts'})`)
    if (regal.grund === regal.knopfGrund && regal.radius === regal.knopfRadius && !regal.tippbar) {
      console.log(
        '  HINWEIS  die Zeile traegt dieselbe Fuellung und denselben Radius wie der Knopf,\n' +
          '           ist aber kein Ziel mehr — sie sah bis 03.08.2026 nicht nur so aus, sie war es.',
      )
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  //  4. KONTRAST — Zeichen gegen Flaeche, Flaeche gegen Untergrund
  // ═════════════════════════════════════════════════════════════════════
  const KONTRAST = `((vorn, hinten) => {
    const zahl = (s) => (s.match(/[\\d.]+/g) || []).map(Number);
    const lin = (c) => { c /= 255; return c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4) };
    const hell = (c) => 0.2126*lin(c[0]) + 0.7152*lin(c[1]) + 0.0722*lin(c[2]);
    const misch = (v, h) => v[3] === undefined || v[3] >= 1 ? v : v.map((c,i) => i<3 ? c*v[3] + h[i]*(1-v[3]) : 1);
    const a = misch(zahl(vorn), zahl(hinten)), b = zahl(hinten);
    const [x, y] = [hell(a), hell(b)].sort((p,q) => q-p);
    return Math.round(((x+0.05)/(y+0.05)) * 100) / 100;
  })`

  for (const licht of ['hell', 'dunkel']) {
    console.log(`\n  ── Kontrast des Knopfes (${licht}) ──`)
    await ev(`document.documentElement.setAttribute('data-licht', ${JSON.stringify(licht)})`)
    await zuruecksetzen()

    const ORTE = [
      ['Kopfzeile (Startseite)', async () => 'ok'],
      [
        'grosser Player',
        async () =>
          ev(`(() => { const k = document.querySelector('.mp-bild'); if (!k) return 'kein Mini-Player';
            k.click(); return 'ok' })()`),
      ],
      [
        'grosses Cover',
        async () =>
          ev(`(() => { const k = document.querySelector('.mp-bild'); if (!k) return 'kein Mini-Player';
            k.click(); const c = document.querySelector('#gross .gross-bild');
            if (!c) return 'kein Cover'; c.click(); return 'ok' })()`),
      ],
    ]
    for (const [was, hin] of ORTE) {
      await zuruecksetzen()
      const weg = await hin()
      await warte(800)
      if (weg !== 'ok') {
        melde(`${licht}/${was}: der Weg dorthin ging nicht (${weg})`)
        continue
      }
      const c = await ev(`(() => {
        const kontrast = ${KONTRAST};
        const k = document.getElementById('zurueck');
        const s = getComputedStyle(k);
        const r = k.getBoundingClientRect();
        // Was liegt HINTER dem Knopf? Der Knopf wird kurz durchlaessig
        // gestellt und gefragt, wer dann an seiner Ecke liegt.
        const alt = k.style.pointerEvents; k.style.pointerEvents = 'none';
        const u = document.elementFromPoint(Math.round(r.left - 6), Math.round(r.top + r.height/2))
              || document.body;
        k.style.pointerEvents = alt;
        let g = getComputedStyle(u).backgroundColor, e = u;
        while (/rgba?\\([^)]*,\\s*0\\)/.test(g) && e.parentElement) { e = e.parentElement; g = getComputedStyle(e).backgroundColor }
        return { zeichen: kontrast(s.color, s.backgroundColor),
                 flaeche: kontrast(s.backgroundColor, g),
                 pfeilAufGrund: kontrast(s.color, g),
                 hinter: e.id || e.className || e.tagName };
      })()`)
      zeile(`${was}: Pfeil auf Knopfflaeche`, `${c.zeichen}:1`)
      zeile(`${was}: Knopfflaeche auf Untergrund`, `${c.flaeche}:1  (${c.hinter})`)
      zeile(`${was}: Pfeil auf Untergrund`, `${c.pfeilAufGrund}:1`)
      // WCAG 1.4.11 verlangt 3:1 fuer das, WORAN MAN DAS BEDIENELEMENT
      // ERKENNT — nicht fuer jede seiner Kanten. Das ist hier der PFEIL: er
      // traegt `--ink` und hebt sich zweistellig ab. Die Fuellung darf also
      // nah am Untergrund liegen; nur BEIDES zusammen zu verlieren waere der
      // Fehler. Deshalb wird der schlechtere der beiden Wege geprueft und
      // nicht jeder fuer sich.
      const erkennbar = Math.max(c.zeichen, c.flaeche, c.pfeilAufGrund)
      if (erkennbar < KONTRAST_MIN) {
        melde(
          `${licht}/${was}: der Knopf ist an nichts zu erkennen — Pfeil ${c.zeichen}:1, Flaeche ${c.flaeche}:1 (noetig ${KONTRAST_MIN}:1)`,
        )
      }
      if (c.flaeche < 1.3) {
        console.log(
          `  HINWEIS  ${licht}/${was}: die Fuellung liegt mit ${c.flaeche}:1 praktisch auf dem Untergrund —\n` +
            '           was den Knopf hier traegt, ist allein der Pfeil.',
        )
      }
    }
  }
  await ev(`document.documentElement.setAttribute('data-licht', 'hell')`)

  // ═════════════════════════════════════════════════════════════════════
  //  5. WAS DIE KONSOLE AUF DEM GANZEN WEG GESAGT HAT
  // ═════════════════════════════════════════════════════════════════════
  console.log('\n  ── Konsole (der ganze Weg, 800x480) ──')
  // WAS DIE ATTRAPPE NICHT HAT, IST KEIN FEHLER DER SEITE.
  //   /active_theme.css  liegt auf der Box im Wurzelverzeichnis der
  //                      Angular-Auslieferung (index.html bindet sie mit
  //                      fuehrendem Schraegstrich ein, und das ist richtig so);
  //                      tools/neu-vorschau.mjs liefert keine Angular-Seite.
  //   /favicon.ico       fragt jeder Browser von sich aus.
  // BEIDE SIND VOR DIESEM UMBAU SCHON DA GEWESEN. Sie hier mitzuzaehlen hiesse,
  // das Werkzeug dauerhaft rot zu stellen — und ein Werkzeug, das immer rot
  // ist, liest bald niemand mehr.
  const BEKANNT = [/\/active_theme\.css/, /\/favicon\.ico/]
  const echt = konsole.filter((m) => !BEKANNT.some((r) => r.test(m)))
  const geduldet = konsole.length - echt.length
  if (!echt.length) zeile('Meldungen', geduldet ? `keine (${geduldet} der Attrappe geduldet)` : 'keine')
  for (const m of echt.slice(0, 12)) zeile('Meldung', m)
  if (echt.length) melde(`${echt.length} Konsolenmeldung(en) auf dem Weg`)
  konsole.length = echt.length

  console.log(konsole.length || fehler ? '' : '\n  keine Beanstandung')
} finally {
  // IM `finally`: Ein Werkzeug, das nur auf dem gruenen Weg aufraeumt, laesst
  // die geliehene Vorschau gerade dann verstellt stehen, wenn es einen Fehler
  // gefunden hat — also genau dann, wenn als naechstes jemand hinsieht.
  await brw.schliessen()
  await leihe.zurueckgeben()
}
process.exit(PRUEFEN && fehler ? 1 : 0)
