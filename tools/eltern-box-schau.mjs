#!/usr/bin/env node
/**
 * DIE DREI NEUEN SCHIRME DES ELTERN-BEREICHS — ANSEHEN UND NACHMESSEN.
 *
 * ══ WOZU ═══════════════════════════════════════════════════════════════════
 * Am 06.08.2026 sind drei Dinge dazugekommen, und alle drei teilen sich die
 * Faecherspalte:
 *   A) DIE SPERRART umstellen (Rechenaufgabe / PIN / Geste / keine) samt dem
 *      Setzen einer PIN an der Box.
 *   B) EIN INFO-FACH — Adresse, Netz, Temperatur, Auslastung, Dienste, Akku.
 *   C) DIE DARSTELLUNG nativ statt als Sprung nach /darstellung.
 *
 * Zwei davon sind billig zu pruefen, weil sie nichts tun. Die SPERRART ist es
 * nicht: ein Fehler dort macht etwas auf, das zubleiben sollte. Dieses
 * Werkzeug misst deshalb genau die Saetze, die im Auftrag als „nicht
 * verhandelbar" stehen:
 *
 *   1. „KEINE SPERRE" IST EINE ENTSCHEIDUNG. Der Weg dorthin fuehrt ueber
 *      eine Rueckfrage, die SAGT, was dann offensteht — und die gefaehrliche
 *      Zeile liegt nicht dort, wo im Schirm davor eine harmlose lag.
 *   2. NIEMAND SPERRT SICH AUS. Die Wahl „PIN" schreibt NIE die Sperrart,
 *      ohne vorher eine PIN gesetzt zu haben. Gemessen wird die REIHENFOLGE
 *      der Abrufe, nicht die Absicht.
 *   3. DIE PIN STEHT NIRGENDS. Nach dem Tippen wird der ganze Baum, jedes
 *      Attribut, die Adresse und der `sessionStorage` nach den Ziffern
 *      durchsucht. Am Schirm duerfen nur Punkte stehen.
 *
 * ══ ES MACHT AUCH BILDER ═══════════════════════════════════════════════════
 * `--bilder <ordner>` legt je Schirm ein PNG ab. Das ist keine Zierde: am
 * 06.08.2026 hat genau ein Bildschirmfoto einen Fehler gefunden, den 43
 * gruene Aussagen daneben nicht gesehen haben (eine Zeile hinter einem
 * `return`, im Leerfall weg). Wer hier etwas aendert, SIEHT SICH DIE BILDER AN.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *     node tools/eltern-box-schau.mjs                        # eigene Vorschau
 *     node tools/eltern-box-schau.mjs --ziel http://127.0.0.1:8951/neu/
 *     node tools/eltern-box-schau.mjs --bilder /tmp/box
 *
 * ES REDET MIT KEINER BOX und liefert nichts aus.
 */
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import WebSocket from 'ws'
import { eigenerBrowser, freierPort } from './leihgabe.mjs'
import { adminAuf } from './admin-weg.mjs'

const WURZEL = '/home/achim/Downloads/MuPiBox'
const argv = process.argv.slice(2)
const opt = (n, v = null) => {
  const i = argv.indexOf(`--${n}`)
  return i < 0 ? v : argv[i + 1]
}
const MITGEGEBEN = opt('ziel')
const BILDER = opt('bilder')
const warte = (ms) => new Promise((r) => setTimeout(r, ms))

/** Die PIN, die dieser Lauf tippt. Sie steht NUR hier und in keiner Ausgabe. */
const PIN = '739142'.slice(0, 6)

let fehler = 0
const ja = (b, satz, wie = '') => {
  if (!b) fehler++
  console.log(`${b ? 'ok  ' : 'FEHL'}  ${satz}${wie ? '  — ' + wie : ''}`)
}

// ── Vorschau: eigene oder mitgegebene ──────────────────────────────────────
//
// DIESELBEN DREI RIEGEL WIE IN eltern-tor-schau.mjs, und aus demselben
// gemessenen Grund: ein `spawn`-Kind haelt die Ereignisschleife von Node am
// Leben. Ohne `unref()` und den `exit`-Zuhoerer war ein Lauf schon einmal
// fertig und konnte trotzdem nicht enden — 26 Minuten ohne eine Zeile Ausgabe.
let vorschau = null
let ZIEL = MITGEGEBEN
process.on('exit', () => {
  try {
    vorschau?.kill()
  } catch {
    /* schon weg */
  }
})

if (!ZIEL) {
  const p = await freierPort()
  ZIEL = `http://127.0.0.1:${p}/neu/`
  vorschau = spawn(process.execPath, ['tools/neu-vorschau.mjs', '--port', String(p)], {
    cwd: WURZEL,
    stdio: 'ignore',
  })
  vorschau.unref()
  let gestorben = null
  vorschau.on('exit', (c) => {
    gestorben = c
  })
  const bis = Date.now() + 10000
  for (;;) {
    if (gestorben !== null)
      throw new Error(`tools/neu-vorschau.mjs endete sofort (${gestorben}) — Port ${p} war belegt`)
    try {
      await fetch(`http://127.0.0.1:${p}/api/werke`)
      break
    } catch {
      if (Date.now() > bis) throw new Error('tools/neu-vorschau.mjs kam nicht hoch')
      await warte(150)
    }
  }
}
console.log(`ZIEL: ${ZIEL}${vorschau ? '  (eigene Vorschau)' : '  (mitgegeben)'}`)

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

/**
 * DER MITSCHREIBER FUER `fetch` — die REIHENFOLGE ist der Beweis, nicht die
 * Absicht.
 *
 * Punkt 2 der nicht verhandelbaren Liste heisst „erst die PIN, dann die Art".
 * Das laesst sich am Schirm nicht ansehen: beide Abrufe gehen in Millisekunden
 * hinaus, und am Ende steht in beiden Faellen „gespeichert". Nur die
 * Reihenfolge der Anrufe unterscheidet den sicheren Weg vom gefaehrlichen.
 *
 * ER SCHREIBT DEN KOERPER NICHT MIT, sondern nur seine LAENGE und ob das Wort
 * „pin" als Schluessel darin vorkommt. Ein Mitschreiber, der die PIN in eine
 * Variable legt, waere genau das Leck, gegen das Punkt 3 steht — und dieses
 * Werkzeug durchsucht hinterher den ganzen Seitenzustand danach.
 */
const MITSCHREIBER = `(() => {
  if (window.__rufe) return true
  window.__rufe = []
  const echt = window.fetch
  window.fetch = function (u, o) {
    try {
      const pfad = String(typeof u === 'string' ? u : (u && u.url) || '')
      const art = (o && o.method) || 'GET'
      const k = (o && typeof o.body === 'string') ? JSON.parse(o.body) : null
      window.__rufe.push({
        pfad,
        art,
        felder: k ? Object.keys(k).sort().join(',') : '',
        sperrart: (k && k.aenderungen && k.aenderungen.einstellungssperre) || '',
        pinLaenge: k && typeof k.pin === 'string' ? k.pin.length : -1,
      })
    } catch { /* ein Abruf, den wir nicht lesen koennen, wird nicht gezaehlt */ }
    return echt.apply(this, arguments)
  }
  return true
})()`

/** Alles, was am Schirm und im Speicher steht — fuer die Suche nach der PIN. */
const ALLES_JS = `(() => JSON.stringify({
  html: document.documentElement.outerHTML,
  adresse: location.href,
  sitzung: JSON.stringify(Object.entries(sessionStorage)),
  dauerhaft: JSON.stringify(Object.entries(localStorage)),
}))()`

const browser = await eigenerBrowser({ fenster: '800,480' })
if (!browser) {
  console.log('  kein Browser gefunden — uebersprungen')
  process.exit(0)
}
let ws = null
try {
  if (BILDER) await mkdir(BILDER, { recursive: true })
  ws = new WebSocket(await browser.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  await send(ws, 'Emulation.setDeviceMetricsOverride', {
    width: 800,
    height: 480,
    deviceScaleFactor: 1,
    mobile: false,
  })

  const ev = async (e) =>
    (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value
  const stand = async (w) => {
    await fetch(new URL(`/vorschau/${w}`, ZIEL)).catch(() => null)
    await warte(120)
  }
  const laden = async () => {
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warte(2200)
    await ev(MITSCHREIBER)
  }
  const bild = async (name) => {
    if (!BILDER) return
    const s = await send(ws, 'Page.captureScreenshot', { format: 'png' })
    await writeFile(join(BILDER, `${name}.png`), Buffer.from(s.data, 'base64'))
    console.log(`      Bild: ${join(BILDER, `${name}.png`)}`)
  }
  const hinein = async () => {
    // HIER STAND EIN GRIFF ANS ZAHNRAD `#einst-knopf`. Es ist am 06.08.2026
    // ersatzlos entfallen; hinein fuehrt der Schriftzug `#wappen`. Dieser Weg
    // ist der TASTATURWEG und prueft das Halten NICHT — tools/admin-weg.mjs.
    await adminAuf(ev, { warteMs: 900 })
  }
  /**
   * DIE RECHENAUFGABE LOESEN — sie steht am Schirm, also wird sie GELESEN.
   *
   * Nicht aus dem Zustand der Seite abgegriffen: dass die Zahl dasteht, ist
   * ein Teil der Sperre („die Rechenaufgabe MUSS man sehen"). Wer sie aus
   * `eltern.aufgabe` naehme, misse eine Aufgabe, die auch unsichtbar sein
   * duerfte.
   */
  const rechnen = async () => {
    const f = await ev(`(document.getElementById('tor-frage')||{}).textContent || ''`)
    const m = String(f).match(/(\d+)\s*×\s*(\d+)/)
    if (!m) return false
    for (const z of String(Number(m[1]) * Number(m[2])))
      await ev(`document.querySelector('#tor-feld [data-taste="${z}"]').click()`)
    await ev(`document.querySelector('#tor-feld .tor-weiter').click()`)
    await warte(800)
    return true
  }

  /** Eine GRUPPE in der Spalte antippen — ueber ihr `data-fach`, nicht ueber Text. */
  const gruppe = async (id) => {
    await ev(`document.querySelector('#eltern-faecher [data-fach="${id}"]').click()`)
    await warte(800)
  }
  /**
   * EINE ZEILE ANTIPPEN — und seit dem 06.08.2026 gibt es ZWEI Sorten.
   *
   * In einer Unterseite liegt der Knopf IN der Zeile (`.zeile-tat`); in einer
   * Uebersicht IST die Zeile der Knopf (`.fach-sprung`, weil ein Knopf darin
   * am Kartenrand halb abgeschnitten wurde). Wer nur `.zeile-tat` sucht, haelt
   * jede Uebersicht fuer unbedienbar und meldet Fehler, die keine sind.
   */
  const zeile = async (name) => {
    const ok = await ev(`(() => {
      for (const z of document.querySelectorAll('#fach-zeilen .fach-zeile')) {
        const n = z.querySelector('.zeile-name')
        if (!n || !n.textContent.trim().startsWith(${JSON.stringify(name)})) continue
        const k = z.querySelector('.zeile-tat')
        if (k) { k.click(); return true }
        if (z.tagName === 'BUTTON') { z.click(); return true }
      }
      return false })()`)
    await warte(800)
    return ok
  }
  /**
   * DEN BEREICH WIRKLICH VERLASSEN — so oft tippen, wie es Ebenen gibt.
   *
   * Der EINE Rueckweg raeumt seit dem 06.08.2026 eine Ebene je Tipp ab. Wer
   * einmal tippt und „zu" annimmt, misst danach einen Bereich, der offensteht
   * — und bekommt rote Aussagen, die nichts mit ihrem Gegenstand zu tun haben.
   * SECHS VERSUCHE sind mehr als die tiefste Schachtelung (Rueckfrage ->
   * Unterseite -> Uebersicht -> zu) und schuetzen zugleich davor, hier ewig zu
   * kreisen, falls der Rueckweg eines Tages haengenbleibt.
   */
  const hinaus = async () => {
    for (let i = 0; i < 6; i++) {
      if ((await ev(`document.getElementById('eltern').hidden`)) === true) return true
      await ev(`document.getElementById('zurueck').click()`)
      await warte(500)
    }
    return (await ev(`document.getElementById('eltern').hidden`)) === true
  }

  /**
   * ZWEI TIPPS STATT EINEM — die Gruppe, dann der Punkt.
   *
   * Bis zum 06.08.2026 war „Box" ein Fach in der Spalte und mit EINEM Tipp
   * erreicht. Seine drei Inhalte (die Zahlen, die Sperrart, der Sprung nach
   * /settings) sind jetzt drei PUNKTE der Gruppe „System". Der Weg ist damit
   * laenger und die Aussagen darueber sind dieselben geblieben.
   */
  const punkt = async (g, name) => {
    await gruppe(g)
    return await zeile(name)
  }
  /** Was gerade im Fach steht — Zeilen, Gitter, Kopf. */
  const schirm = async () =>
    JSON.parse(
      await ev(`(() => {
      const r = (e) => { const b = e.getBoundingClientRect(); return { l: Math.round(b.left), o: Math.round(b.top), b: Math.round(b.width), h: Math.round(b.height) } }
      const zeilen = [...document.querySelectorAll('#fach-zeilen .fach-zeile')].map((z) => ({
        name: (z.querySelector('.zeile-name') || {}).textContent || '',
        unter: (z.querySelector('.zeile-unter') || {}).textContent || '',
        wort: (z.querySelector('.zeile-tat') || {}).textContent || '',
        gefahr: !!z.querySelector('.zeile-tat.gefahr'),
        an: z.classList.contains('an'),
        r: r(z),
      }))
      const gitter = [...document.querySelectorAll('#fach-zeilen .info-feld')].map((f) => ({
        wort: (f.querySelector('.info-wort') || {}).textContent || '',
        zahl: (f.querySelector('.info-zahl') || {}).textContent || '',
        warnt: f.classList.contains('warnt'),
        h: Math.round(f.getBoundingClientRect().height),
      }))
      const zl = document.getElementById('fach-zeilen')
      // ── ANGESCHNITTEN ODER GANZ DA? ────────────────────────────────
      // DAS WAR DIE LUECKE: 26 Aussagen waren gruen, waehrend die Karte
      // mitten im Knopf „Ändern" endete. Ein halber Knopf ist ein Ziel, das
      // in keiner Groessenmessung auffaellt (er ist gebaut 118x66) und im
      // Gebrauch die Haelfte seiner Flaeche verliert.
      const sicht = zl ? zl.getBoundingClientRect() : null
      for (const z of zeilen) {
        const k = [...document.querySelectorAll('#fach-zeilen .fach-zeile')].find(
          (e) => ((e.querySelector('.zeile-name') || {}).textContent || '') === z.name,
        )
        const b = k ? k.querySelector('.zeile-tat') : null
        if (!b || !sicht) { z.knopfGanz = null; continue }
        const r2 = b.getBoundingClientRect()
        z.knopfGanz = r2.top >= sicht.top - 0.5 && r2.bottom <= sicht.bottom + 0.5
      }
      for (const z of zeilen) {
        if (!sicht) { z.sichtbar = null; continue }
        z.sichtbar = Math.round(
          Math.max(0, Math.min(z.r.o + z.r.h, sicht.bottom) - Math.max(z.r.o, sicht.top)),
        )
      }
      return JSON.stringify({
        kopf: (document.getElementById('fach-name') || {}).textContent || '',
        tat: document.getElementById('fach-tat') ? !document.getElementById('fach-tat').hidden : false,
        unter: (document.getElementById('eltern-unter') || {}).textContent || '',
        hinweis: document.getElementById('fach-hinweis') && !document.getElementById('fach-hinweis').hidden
          ? document.getElementById('fach-hinweis').textContent : '',
        zeilen, gitter,
        faecher: [...document.querySelectorAll('#eltern-faecher .fach-knopf')].map((k) => k.textContent.replace('↗','').trim()),
        pinSchirm: document.getElementById('eltern-pin') ? !document.getElementById('eltern-pin').hidden : false,
        flaeche: document.getElementById('eltern-flaeche') ? !document.getElementById('eltern-flaeche').hidden : false,
        pinAnzeige: (document.getElementById('pin-anzeige') || {}).textContent || '',
        pinFrage: (document.getElementById('pin-frage') || {}).textContent || '',
        pinMeldung: (document.getElementById('pin-meldung') || {}).textContent || '',
        rollt: zl ? { sicht: Math.round(zl.clientHeight), inhalt: Math.round(zl.scrollHeight) } : null,
      }) })()`),
    )
  /**
   * DIE MARKE AUF DEM SCHIRM, DER GERADE DASTEHT — 9 mm gross, 2 mm Abstand.
   *
   * WARUM HIER UND NICHT IN tools/beruehrziele-neu.mjs: Jenes Werkzeug kennt
   * eine feste Liste von SCHIRMEN, und die drei neuen sind keiner davon —
   * „eltern-flaeche" oeffnet dort das Fach WLAN. Die Ziele des Fachs „Box",
   * der Sperr-Wahl und des PIN-Schirms waeren also nie gemessen worden, und
   * das haette wie ein Ergebnis ausgesehen („0 unter 9 mm").
   *
   * ES WIRD NUR GEMESSEN, WAS IM BILD STEHT. Ein angeschnittenes Ziel ist
   * eine Rollposition und keine Gestaltung — es zaehlt getrennt, genau wie
   * drueben.
   */
  const marke = async (wo) => {
    const d = JSON.parse(
      await ev(`(() => {
        const px = (mm) => (mm / 0.14)
        const sicht = { l: 0, o: 0, r: 800, u: 480 }
        const ziele = [...document.querySelectorAll(
          '#eltern button:not([hidden]):not([disabled]), #eltern-pin button:not([disabled])')]
          .map((e) => { const b = e.getBoundingClientRect(); return {
            n: (e.id ? '#' + e.id : e.className.split(' ')[0]) + ' „' + e.textContent.trim().slice(0, 24) + '"',
            l: b.left, o: b.top, r: b.right, u: b.bottom, b: Math.round(b.width), h: Math.round(b.height) } })
          .filter((z) => z.b > 0 && z.h > 0)
        const ganz = ziele.filter((z) => z.l >= sicht.l - 0.5 && z.o >= sicht.o - 0.5 && z.r <= sicht.r + 0.5 && z.u <= sicht.u + 0.5)
        const klein = ganz.filter((z) => Math.min(z.b, z.h) < px(9))
        let eng = null
        for (let i = 0; i < ganz.length; i++) for (let j = i + 1; j < ganz.length; j++) {
          const a = ganz[i], b = ganz[j]
          const dx = Math.max(0, Math.max(a.l - b.r, b.l - a.r))
          const dy = Math.max(0, Math.max(a.o - b.u, b.o - a.u))
          if (dx === 0 && dy === 0) continue
          const d2 = Math.hypot(dx, dy)
          if (!eng || d2 < eng.d) eng = { d: d2, a: a.n, b: b.n }
        }
        return JSON.stringify({ n: ganz.length, klein: klein.map((z) => z.n + ' ' + z.b + 'x' + z.h), eng })
      })()`),
    )
    ja(d.klein.length === 0, `${wo}: KEIN ZIEL UNTER 9 mm (${d.n} ganz im Bild)`, d.klein.join(', '))
    ja(
      !d.eng || d.eng.d >= 14.3,
      `${wo}: KEIN PAAR UNTER 2 mm`,
      d.eng ? `engstes ${(d.eng.d * 0.14).toFixed(2)} mm — ${d.eng.a} / ${d.eng.b}` : 'nur ein Ziel',
    )
  }

  const rufe = async () => JSON.parse(await ev(`JSON.stringify(window.__rufe || [])`))
  const rufeLeeren = async () => void (await ev(`window.__rufe = []`))

  // ══ 1. DIE UNTERSEITE „INFO" — DIE SECHS ZAHLEN ═══════════════════════
  //
  // SIE HIESS „BOX" UND WAR EIN FACH. Seit dem 06.08.2026 ist sie die erste
  // Unterseite der Gruppe „System"; die Sperrart und der Sprung nach
  // /settings sind daneben eigene Punkte geworden. Was dieses Werkzeug
  // PRUEFT, ist dasselbe geblieben — nur der Weg dorthin ist zwei Tipps lang.
  console.log('\n══ 1. DIE UNTERSEITE „INFO" ════════════════════════════════')
  await stand('sperre-aus')
  await stand('dienste-laufen')
  await laden()
  await hinein()
  await punkt('system', 'Info')
  let d = await schirm()
  await bild('1-box')

  /* ══ VIER GRUPPEN, UND „BOX" IST KEINE MEHR ═══════════════════════════
   * HIER STAND „FUENF FAECHER, und „System" ist keines mehr" mit der Liste
   * WLAN · Bluetooth · Medien · Anzeige · Box. DER SATZ WAR RICHTIG, solange
   * die Spalte flach war; er ist es nicht mehr, seit sie vier GRUPPEN traegt
   * und die elf Punkte in der Karte liegen. Die Zahl bleibt eine Zahl und
   * wird nicht zu „mehr als null" — wer eine Gruppe dazustellt, soll hier
   * stolpern (die Spalte traegt hoechstens fuenf, gemessen in
   * tools/eltern-masse-messen.mjs). */
  ja(
    d.faecher.join(' · ') === 'Verbindung · Medien · Darstellung · System',
    'VIER GRUPPEN, und „Box" ist keine mehr',
    d.faecher.join(' · '),
  )
  ja(d.gitter.length === 6, 'SECHS KAESTCHEN, IMMER', `${d.gitter.length}`)
  ja(
    d.gitter.every((f) => f.zahl.trim() !== ''),
    'UND KEINES IST LEER — „—" ist eine Auskunft, eine leere Zeile ist keine',
    d.gitter.map((f) => `${f.wort}=${f.zahl}`).join(' | '),
  )
  ja(
    d.gitter.some((f) => /^\d+\.\d+\.\d+\.\d+$/.test(f.zahl)),
    'DIE ADRESSE STEHT DA — und zwar die v4, nicht die 39 Zeichen lange v6',
    (d.gitter.find((f) => f.wort === 'Adresse') || {}).zahl,
  )
  ja(!d.tat, 'DER FACHKOPF HAT KEINEN KNOPF — es ist Auskunft, nichts wird geholt')

  /* ══ SIE IST JETZT DIE EINZIGE SEITE OHNE JEDES ZIEL ═══════════════════
   *
   * HIER STANDEN DREI AUSSAGEN, und alle drei waren richtig und sind es nicht
   * mehr. Sie lauteten:
   *   * „ZWEI ZEILEN, und die Sperre steht UNTER den Zahlen, nicht darueber"
   *   * „DER SPRUNG IN DIE ALTE OBERFLAECHE TRAEGT SEINEN PFEIL"
   *   * „UND DER KNOPF „ÄNDERN" IST GANZ ZU SEHEN, nicht angeschnitten"
   * Sie galten dem Fach „Box", das die Zahlen UND die Sperr-Zeile UND den
   * Sprung nach /settings zusammen trug — 301 px Inhalt in 235 px Sicht, es
   * rollte, und genau deshalb musste jede der drei Aussagen gestellt werden.
   *
   * WAS SICH GEAENDERT HAT: Die Sperre und der Sprung sind eigene PUNKTE der
   * Gruppe „System" geworden. Auf dieser Seite stehen nur noch die sechs
   * Kaestchen — 144 px in 264 —, sie rollt nicht mehr, und es gibt kein
   * Bedienelement, das angeschnitten werden koennte.
   *
   * DIE DREI FRAGEN SIND NICHT WEGGEFALLEN, sie sind UMGEZOGEN und werden in
   * tools/admin-menue-schau.mjs gestellt, wo die Zeilen jetzt stehen:
   *   * die Reihenfolge der Punkte je Gruppe (Info vor Sperre vor Strom vor ↗)
   *   * dass der Sprung-Punkt seinen Pfeil traegt
   *   * dass KEIN Knopf am Kartenrand angeschnitten wird — dort als Regel
   *     „ganz oder Schnipsel", auf JEDER Seite mit fester Zeilenzahl, nicht
   *     nur auf dieser einen.
   * Eine Aussage abzuschaffen, weil sie rot wird, waere falsch; sie dorthin
   * zu stellen, wo ihr Gegenstand hingezogen ist, ist es nicht.
   */
  ja(
    d.zeilen.length === 0,
    'KEINE ZEILE — die Info ist die einzige Seite des Bereichs ohne ein Ziel',
    d.zeilen.map((z) => z.name).join(' | ') || 'keine',
  )
  ja(
    d.rollt && d.rollt.inhalt <= d.rollt.sicht + 1,
    'UND SIE ROLLT NICHT MEHR — die Zahl, die man sucht, steht ohne Wischen da',
    d.rollt ? `Sicht ${d.rollt.sicht} px, Inhalt ${d.rollt.inhalt} px` : '—',
  )
  await marke('Fach „Box"')

  // ── DER AKKU, WENN ES KEINEN HAT GIBT ────────────────────────────────
  await stand('hat-weg')
  await warte(5600) // ein voller Takt
  d = await schirm()
  ja(
    /kein mupihat/i.test((d.gitter.find((f) => f.wort === 'Akku') || {}).zahl || ''),
    'OHNE MUPIHAT STEHT EIN SATZ DA, keine leere Zeile',
    (d.gitter.find((f) => f.wort === 'Akku') || {}).zahl,
  )
  await bild('2-box-ohne-hat')
  await stand('hat-akku')

  // ── EIN DIENST STEHT: das Kaestchen warnt UND benennt ihn ────────────
  await stand('dienste-steht')
  await warte(5600)
  d = await schirm()
  const dz = d.gitter.find((f) => f.wort === 'Dienste') || {}
  ja(
    dz.warnt === true && /Gestört: /.test(dz.zahl || ''),
    'EIN GESTOERTER DIENST WIRD BENANNT, nicht nur gezaehlt',
    dz.zahl,
  )
  await stand('dienste-laufen')
  await warte(5600)
  const dz2 = (await schirm()).gitter.find((f) => f.wort === 'Dienste') || {}
  // ── UND ABGESCHALTETE DIENSTE WARNEN NICHT ──────────────────────────
  // Drei der zehn Dienste in der Vorschau sind absichtlich aus, einer ist
  // eingeschaltet und durchgelaufen — so wie an der Box .169, wo 20 von 33
  // abgeschaltet sind. Wer „nicht aktiv" als Stoerung liest, faerbt dieses
  // Kaestchen auf einer heilen Box dauerhaft rot.
  ja(
    dz2.warnt === false && /keiner gestört/.test(dz2.zahl || ''),
    'ABGESCHALTETE UND DURCHGELAUFENE DIENSTE WARNEN NICHT',
    dz2.zahl,
  )

  // ══ 2. DIE SPERRART ═══════════════════════════════════════════════════
  console.log('\n══ 2. DIE SPERRART ═════════════════════════════════════════')
  // ── DIE LAGE MUSS EINE ANDERE SEIN ALS DAS ZIEL ──────────────────────
  // Beim ersten Anlauf stand die Vorschau schon auf „aus" — und die Zeile
  // „Keine Sperre" traegt dann GAR KEINEN Knopf (die gewaehlte Art hat
  // keinen, sonst waere er ein Ziel, das nichts tut). Der Tipp ging ins
  // Leere, und drei Aussagen darunter waren rot, ohne dass etwas kaputt war.
  // Gemessen wird deshalb der WEG von „rechnen" nach „aus".
  await stand('sperre-rechnen')
  await laden()
  await hinein()
  await rechnen()
  // DER GESCHRIEBENE STAND STEHT JETZT IN DER UEBERSICHT von „System" und
  // nicht mehr in einer Zeile des Fachs „Box" — dieselbe Auskunft, eine Ebene
  // hoeher. Sie ist damit sogar frueher zu sehen als vorher: man muss die
  // Sperr-Seite gar nicht mehr aufschlagen, um zu wissen, was gilt.
  await gruppe('system')
  d = await schirm()
  const sperrZeile = d.zeilen.find((z) => z.name.startsWith('Sperre')) || {}
  ja(
    /Rechenaufgabe/.test(sperrZeile.unter || ''),
    'DIE UNTERZEILE NENNT DEN STAND, den GESCHRIEBENEN und nicht den angenommenen',
    sperrZeile.unter || '—',
  )
  await zeile('Sperre vor diesem Bereich')
  d = await schirm()
  await bild('3-sperre-wahl')

  ja(d.zeilen.length === 4, 'VIER ARTEN, nicht drei — die Geste ist gebaut und steht da', `${d.zeilen.length}`)
  ja(
    d.zeilen[d.zeilen.length - 1].name === 'Keine Sperre',
    '„KEINE SPERRE" STEHT GANZ UNTEN — nicht dort, wo man beim Rollen landet',
    d.zeilen.map((z) => z.name).join(' | '),
  )
  ja(
    d.zeilen[d.zeilen.length - 1].gefahr,
    'UND SIE SIEHT ANDERS AUS ALS DIE HARMLOSEN (`.zeile-tat.gefahr`)',
  )
  await marke('Sperr-Wahl')

  // ── DER WEG ZU „KEINE SPERRE" ─────────────────────────────────────────
  const abschaltenY = d.zeilen[d.zeilen.length - 1].r.o
  await zeile('Keine Sperre')
  d = await schirm()
  await bild('4-sperre-aus-frage')
  ja(
    d.zeilen.length === 2 && /Abbrechen/.test(d.zeilen[0].wort),
    'DIE RUECKFRAGE STEHT, und „Abbrechen" ist die ERSTE Zeile',
    d.zeilen.map((z) => `${z.name} [${z.wort}]`).join(' | '),
  )
  ja(
    /WLAN/.test(d.zeilen[0].unter) &&
      /Lösch/.test(d.zeilen[0].unter) &&
      /Ausschalten|ausschalten/.test(d.zeilen[0].unter),
    'SIE SAGT, WAS DANN OFFENSTEHT — WLAN, Löschknöpfe, Ausschalten. Nicht „Sicher?"',
    d.zeilen[0].unter,
  )
  const jaY = d.zeilen[1].r.o
  ja(
    Math.abs(jaY - abschaltenY) > 60,
    'DER GEFAEHRLICHE KNOPF STEHT NICHT, WO DER HARMLOSE STAND',
    `„Abschalten" lag bei y ${abschaltenY}, „Ja, abschalten" steht bei y ${jaY}`,
  )

  await rufeLeeren()
  await zeile('Ja, Sperre abschalten')
  let r = await rufe()
  d = await schirm()
  ja(
    r.some((x) => x.art === 'POST' && x.pfad.endsWith('/konfiguration') && x.sperrart === 'aus'),
    'ERST DER TIPP AUF „JA" SCHREIBT — und er schreibt „aus"',
    r.map((x) => `${x.art} ${x.pfad}${x.sperrart ? ' =' + x.sperrart : ''}`).join(' | ') || 'kein Abruf',
  )
  ja(d.hinweis.startsWith('Gespeichert'), 'UND DER SCHIRM SAGT ES', d.hinweis)
  await bild('5-sperre-aus-gespeichert')

  // ══ 3. DIE PIN — DER TEUERSTE WEG ═════════════════════════════════════
  console.log('\n══ 3. DIE PIN ══════════════════════════════════════════════')
  await rufeLeeren()
  await zeile('PIN')
  d = await schirm()
  await bild('6-pin-neu')
  ja(d.pinSchirm && !d.flaeche, 'DIE WAHL „PIN" FUEHRT ZUERST AUF DEN PIN-SCHIRM', `pin ${d.pinSchirm}, flaeche ${d.flaeche}`)
  r = await rufe()
  ja(
    !r.some((x) => x.art === 'POST' && x.sperrart === 'pin'),
    'NICHTS IST GESCHRIEBEN, solange keine PIN dasteht — Punkt 2 der Liste',
    r.map((x) => `${x.art} ${x.pfad}`).join(' | ') || 'kein Abruf',
  )

  const tippen = async (ziffern) => {
    for (const z of ziffern)
      await ev(`document.querySelector('#pin-feld [data-taste="${z}"]').click()`)
    await warte(200)
  }
  const weiter = async () => {
    await ev(`document.querySelector('#pin-feld .tor-weiter').click()`)
    await warte(900)
  }

  // ── ZU KURZ HEISST: „WEITER" LEUCHTET NICHT ──────────────────────────
  await tippen('123')
  ja(
    await ev(`document.querySelector('#pin-feld .tor-weiter').disabled`),
    'BEI DREI ZIFFERN IST „WEITER" AUS — dieselbe Grenze wie im Backend (4 bis 8)',
  )
  await ev(`for (let i=0;i<3;i++) document.querySelector('#pin-feld [data-taste="weg"]').click()`)

  // ── ZWEI VERSCHIEDENE HEISST: VON VORN ───────────────────────────────
  await tippen(PIN)
  d = await schirm()
  ja(
    d.pinAnzeige === '•'.repeat(PIN.length),
    'AM SCHIRM STEHEN NUR PUNKTE, keine Ziffern',
    JSON.stringify(d.pinAnzeige),
  )
  await bild('7-pin-getippt')
  await marke('PIN-Schirm')
  await weiter()
  d = await schirm()
  ja(/wiederholen/i.test(d.pinFrage), 'ZWEITER SCHRITT: dieselbe PIN wiederholen', d.pinFrage)
  await bild('8-pin-wiederholen')
  await tippen('987654')
  await weiter()
  d = await schirm()
  ja(
    /nicht überein/.test(d.pinMeldung) && /Vier bis acht|Ziffern/.test(d.pinFrage) === false
      ? true
      : /nicht überein/.test(d.pinMeldung),
    'ZWEI VERSCHIEDENE PINS FANGEN VON VORN AN',
    d.pinMeldung,
  )
  ja(d.pinAnzeige === '– – – –', 'UND BEIDE FELDER SIND LEER', JSON.stringify(d.pinAnzeige))
  await bild('9-pin-ungleich')

  // ── DER RICHTIGE WEG ─────────────────────────────────────────────────
  await rufeLeeren()
  await tippen(PIN)
  await weiter()
  await tippen(PIN)
  await weiter()
  await warte(600)
  r = await rufe()
  d = await schirm()
  await bild('10-pin-gesetzt')

  const iPin = r.findIndex((x) => x.art === 'POST' && x.pfad.endsWith('/einstellungs-pin'))
  const iArt = r.findIndex((x) => x.art === 'POST' && x.sperrart === 'pin')
  ja(iPin >= 0, 'DIE PIN WIRD GESETZT (POST /api/konfiguration/einstellungs-pin)')
  ja(iArt >= 0, 'UND DIE SPERRART DANACH GESCHRIEBEN')
  ja(
    iPin >= 0 && iArt >= 0 && iPin < iArt,
    'ERST DIE PIN, DANN DIE ART — die Reihenfolge, nicht die Absicht',
    r.filter((x) => x.art === 'POST').map((x) => x.pfad).join('  ->  '),
  )
  ja(
    r[iPin] && r[iPin].pinLaenge === PIN.length,
    'DIE PIN GEHT VOLLSTAENDIG HINAUS (nur die Laenge wird hier gemessen)',
    `${r[iPin] ? r[iPin].pinLaenge : '—'} Ziffern`,
  )
  ja(d.hinweis.startsWith('Gespeichert'), 'UND DER SCHIRM SAGT ES', d.hinweis)

  // ── PUNKT 3: DIE PIN STEHT NIRGENDS ──────────────────────────────────
  const alles = JSON.parse(await ev(ALLES_JS))
  const wo = []
  for (const [name, text] of Object.entries(alles)) if (String(text).includes(PIN)) wo.push(name)
  ja(wo.length === 0, 'DIE PIN STEHT IN KEINEM BAUM, KEINER ADRESSE, KEINEM SPEICHER', wo.join(', '))

  /* ── UND SIE GILT: das Tor nimmt sie an ───────────────────────────────
   * HIER STAND EIN EINZELNER TIPP AUF DEN RUECKWEG, und das genuegte, solange
   * der Bereich flach war: ein Tipp, und er war zu. Seit dem 06.08.2026 raeumt
   * derselbe Knopf EINE Ebene ab (Rueckfrage, dann Unterseite, dann
   * Uebersicht, dann der Bereich) — nach einem Tipp stand hier also noch die
   * Uebersicht von „System", `hinein()` fand den Bereich offen vor, und das
   * Tor konnte gar nicht wieder stehen. Die Aussage war rot, ohne dass an der
   * Sperre etwas falsch gewesen waere.
   * ES WIRD DESHALB GETIPPT, BIS ER ZU IST, und nicht einmal. */
  await hinaus()
  await hinein()
  d = await schirm()
  ja(!d.flaeche, 'NACH DEM UMSTELLEN STEHT DAS TOR WIEDER', `flaeche offen: ${d.flaeche}`)
  await bild('11-tor-mit-neuer-pin')
  for (const z of PIN) await ev(`document.querySelector('#tor-feld [data-taste="${z}"]').click()`)
  await ev(`document.querySelector('#tor-feld .tor-weiter').click()`)
  await warte(1400)
  d = await schirm()
  ja(d.flaeche, 'UND DIE EBEN GESETZTE PIN MACHT ES AUF', `flaeche offen: ${d.flaeche}`)

  /* ══ 4. DIE GRUPPE „DARSTELLUNG" ═══════════════════════════════════════
   *
   * HIER STAND „DIE SCHALTER STEHEN DA — mindestens 8 Zeilen", und das war
   * richtig, solange „Anzeige" EIN Fach mit allen Schaltern untereinander war:
   * neun Zeilen zu 78 px sind 766, die Karte traegt 264 — knapp drei
   * Kartenlaengen Rollweg.
   *
   * SEIT DEM 06.08.2026 sind es DREI Unterseiten nach der Gliederung des
   * Betreibers (Indikatoren | Farbe | Verhalten) mit je drei Schaltern; keine
   * von ihnen rollt noch. DIE ZAHL 8 GILT WEITER, nur verteilt: sie wird hier
   * ueber alle drei Seiten ZUSAMMENGEZAEHLT, damit ein Schalter, der beim
   * Sortieren verlorengeht, auffaellt. Ein „mindestens eine Seite hat
   * Schalter" waere die Abschwaechung, die genau das durchgehen liesse.
   */
  console.log('\n══ 4. DIE GRUPPE „DARSTELLUNG" ═════════════════════════════')
  let alleSchalter = 0
  for (const seite of ['Indikatoren', 'Farbe und Form', 'Verhalten']) {
    await gruppe('anzeige')
    await zeile(seite)
    const t = await schirm()
    alleSchalter += t.zeilen.length
    await marke(`Darstellung / ${seite}`)
    if (seite === 'Farbe und Form') {
      await bild('12-anzeige')
      ja(
        t.zeilen[0].name === 'Hell oder dunkel' &&
          /nicht in der Box/.test(t.zeilen[0].unter) &&
          /Kopfzeile/.test(t.zeilen[0].unter),
        'HELL/DUNKEL STEHT ZUERST AUF „FARBE UND FORM" UND SAGT, DASS ES NICHT AN DER BOX HAENGT',
        t.zeilen[0].unter,
      )
    }
  }
  ja(alleSchalter >= 9, 'DIE SCHALTER STEHEN DA — ueber die drei Seiten zusammen', `${alleSchalter} Zeilen`)
  // Und der letzte Abschnitt misst weiter auf „Indikatoren", wo
  // „Namen unter den Kacheln" liegt.
  await gruppe('anzeige')
  await zeile('Indikatoren')
  d = await schirm()

  // ── EIN SCHALTER SCHREIBT DEN GANZEN STAND, nicht nur sein Feld ──────
  await rufeLeeren()
  // ── DER STAND VORHER WIRD GELESEN, NICHT ANGENOMMEN ─────────────────
  // Beim ersten Anlauf stand hier „muss danach `Anzeigen` sagen". Das war
  // nur beim ERSTEN Lauf richtig: die Vorschau merkt sich, was geschrieben
  // wurde (so wie die Box), und beim zweiten Lauf begann der Schalter auf der
  // anderen Seite. Gemessen wird deshalb, dass er UMSPRINGT — nicht, worauf.
  const vorher = (await schirm()).zeilen.find((z) => z.name === 'Namen unter den Kacheln').wort
  await zeile('Namen unter den Kacheln')
  r = await rufe()
  d = await schirm()
  const put = r.find((x) => x.art === 'PUT' && x.pfad.endsWith('/darstellung'))
  ja(!!put, 'EIN UMLEGEN SCHREIBT (PUT /api/darstellung)')
  ja(
    put && put.felder === 'aktuell,themen',
    'UND ES SCHICKT `aktuell` UND `themen` — sonst loeschte es die Themen der Verwaltung',
    put ? put.felder : '—',
  )
  const bez = d.zeilen.find((z) => z.name === 'Namen unter den Kacheln')
  ja(
    bez && bez.wort !== vorher,
    'DER SCHALTER STEHT DANACH AUF DEM NEUEN STAND',
    `${vorher} -> ${bez ? bez.wort : '—'}`,
  )
  await bild('13-anzeige-umgelegt')
  // UND ER SPRINGT NICHT ZURUECK. Der Abgleich im Takt holt alle paar Sekunden
  // `/api/darstellung` — ohne `zuletztGeschrieben` haette er den alten Stand
  // zurueckgeschrieben, und das saehe aus wie „der Schalter tut nichts".
  await warte(2600)
  d = await schirm()
  const bez2 = d.zeilen.find((z) => z.name === 'Namen unter den Kacheln')
  ja(
    bez2 && bez2.wort === (bez ? bez.wort : ''),
    'UND ER SPRINGT NACH DEM NAECHSTEN ABGLEICH NICHT ZURUECK',
    bez2 ? bez2.wort : '—',
  )

  // ══ 5. WAS BEIM ZUSPERREN WEGGERAEUMT WIRD ════════════════════════════
  console.log('\n══ 5. NACH DEM VERLASSEN ═══════════════════════════════════')
  await punkt('system', 'Info')
  await warte(500)
  await hinaus()
  const rest = JSON.parse(
    await ev(`(() => JSON.stringify({
      gitter: document.querySelectorAll('.info-feld').length,
      zeilen: document.querySelectorAll('#fach-zeilen .fach-zeile').length,
      faecher: document.querySelectorAll('#eltern-faecher .fach-knopf').length,
      pinOffen: document.getElementById('eltern-pin') ? !document.getElementById('eltern-pin').hidden : false,
    }))()`),
  )
  ja(
    rest.gitter === 0 && rest.zeilen === 0 && rest.faecher === 0,
    'DIE ZAHLEN DER BOX SIND AUS DEM BAUM VERSCHWUNDEN, nicht nur zugedeckt',
    JSON.stringify(rest),
  )
  ja(!rest.pinOffen, 'UND DER PIN-SCHIRM STEHT NICHT MEHR OFFEN')
  // DER TAKT MUSS AUFGEHOERT HABEN. Gemessen wird er an dem, was er tut:
  // nach dem Verlassen darf kein `/api/system` mehr hinausgehen.
  await rufeLeeren()
  await warte(6000)
  r = await rufe()
  ja(
    !r.some((x) => x.pfad.includes('/api/system') || x.pfad.includes('/api/dienste')),
    'UND DER TAKT HAT AUFGEHOERT — kein /api/system, kein /api/dienste mehr',
    r.map((x) => x.pfad).join(' | ') || 'kein Abruf',
  )

  console.log(
    `\n${fehler === 0 ? 'alle Aussagen stimmen' : `${fehler} Aussage(n) stimmen NICHT`}`,
  )
} finally {
  try {
    ws?.close()
  } catch {
    /* egal */
  }
  await browser.schliessen()
}
process.exit(fehler === 0 ? 0 : 1)
