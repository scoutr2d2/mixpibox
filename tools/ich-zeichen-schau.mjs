#!/usr/bin/env node
/**
 * DAS ZEICHEN „WER HOERT" — steht es, wo es soll, und haelt es, was es soll?
 *
 * ══ WOZU ═══════════════════════════════════════════════════════════════════
 * Der Betreiber wuenscht (05.08.2026, woertlich): „mir fehlt noch ein kleines
 * benutzr icon oben links um per klick den beutzer zu wechslen" und „ich habe
 * vor von den mixpis unterschiedliche zu generieren mit brille maedchen
 * jungen.... das sich das kind einen persoenlichen auswaehlen kann."
 *
 * Daran haengen sechs Aussagen, die ALLE still danebengehen koennen — jede
 * sieht am Bildschirm genau so aus wie ihr Gegenteil:
 *
 *   1. DAS ZEICHEN STEHT STILL. `#zurueck` wanderte bis zum 05.08. mit der
 *      Leiste, und der Betreiber meldete: „es ist nervig wenn man draufklicken
 *      will und genau dann faehrt das menue zurueck und man verfehlt den
 *      button." Ein zweites wanderndes Ziel in derselben Ecke waere derselbe
 *      Fehler noch einmal. GEMESSEN WIRD IN BEIDEN LAGEN.
 *   2. ES VERDECKT NICHTS UND WIRD SELBST VERDECKT. Es liegt bei z-index 5 und
 *      MUSS unter dem grossen Player und der grossen Albumansicht
 *      verschwinden — dort laege es sonst auf dem Cover (dieselbe Fehlersorte
 *      wie [[rueckweg-verdeckt-die-ueberschrift]]).
 *      DER DRITTE FALL HAT SICH AM 06.08.2026 GEDREHT, und das steht hier,
 *      weil eine ueberholte Aussage berichtigt und nicht geloescht gehoert:
 *      Der ELTERN-BEREICH deckte es zu, solange er ein Deckel war
 *      (`inset: 0`). Seit er eine SEITE ist (`left: 88px`, Betreiber: „ich
 *      finde den entwurf gut wo nicht alles zu gedeckt ist"), steht das
 *      Zeichen bei x 8..74 NEBEN ihm und ist erreichbar. Die Absicherung ist
 *      seither eine Regel statt einer Geometrie: `eltern.auf()` legt den Knopf
 *      SICHTBAR still (`disabled` + gedaempft). Beides wird gemessen — dass er
 *      nicht mehr verdeckt ist UND dass er stillgelegt wird.
 *   3. DER ABSTAND ZUM RUECKWEG. ISO 9241-411 verlangt 2 mm. Der engste
 *      Abstand der ganzen Oberflaeche lag am 05.08. bei 0,14 mm — EIN
 *      Bildpunkt. Ein neues Ziel in dieselbe Ecke ohne diese Zahl waere
 *      derselbe Fehler mit einem Nachbarn, den ein Kind viel oefter trifft.
 *   4. EIN FEHLENDES BILD ZERBRICHT NICHTS. Ein leeres Feld oder ein
 *      zerbrochenes Bildzeichen faellt in keiner Groessenmessung auf.
 *      SEIT DEM 05.08.2026 ABENDS IST DAS DER NOTFALL UND NICHT MEHR DER
 *      NORMALFALL (siehe 7) — und genau deshalb wird es weiter gemessen: Die
 *      neue Vorgabe darf den Rueckfall nicht aufgefressen haben.
 *   7. „KEIN BILD GEWAEHLT" HEISST NICHT „KEIN BILD ZEIGEN". Der Betreiber
 *      hat berichtigt (05.08.2026): „ich wollte niemals die mixpi figur
 *      unten links, ich wollte sie oben links, schon vorbereitend fuer den
 *      platz des bildes. damals ging was schief :)" — diese Ecke IST der
 *      Platz des Bildes. Der Server sagt bei leerer Wahl LEER, und was dann
 *      zu sehen ist, entscheidet allein die Oberflaeche. Bleibt dort die
 *      Silhouette, sieht das aus wie eine Absicht UND wie „das Bild laedt
 *      nicht" — zwei Lagen, ein Bild, kein Alarm.
 *   5. MIT EINEM PROFIL IST DIE AUSWAHL KEIN LEERES FENSTER. Auf der Box steht
 *      heute nur `gast`. Eine Profilreihe mit einer Kachel, die nichts tut,
 *      waere ein Bedienelement, das Tippen abtrainiert.
 *   6. DIE FIGUR WIRD WIRKLICH GEMERKT. Ein Tipp, der nur die Anzeige aendert,
 *      sieht bis zum naechsten Neuladen richtig aus.
 *
 * ══ WARUM GETASTET UND NICHT GERECHNET ═════════════════════════════════════
 * Dieselbe Begruendung wie in tools/beruehrziele-neu.mjs und
 * tools/ecke-oben-links-messen.mjs: `getBoundingClientRect` kennt weder
 * `overflow: hidden` eines Vorfahren noch eine Ebene darueber. Ein Element
 * meldet seine vollen 66x66 px und ist an der Stelle trotzdem nicht zu
 * treffen. Gemessen wird deshalb ueber `document.elementFromPoint`.
 *
 * ══ WAS ES AENDERT ═════════════════════════════════════════════════════════
 * Nichts an der Quelle. Eigener headless-Browser gegen eine
 * `tools/neu-vorschau.mjs`; laeuft auf dem Zielport schon eine, wird sie
 * BENUTZT und ihre Lage hinterher WIEDER HINGELEGT (die Regel, die am
 * 04.08.2026 in neunzehn Werkzeugen fehlte) — beides ueber tools/leihgabe.mjs.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *     node tools/ich-zeichen-schau.mjs
 *     node tools/ich-zeichen-schau.mjs --bild /tmp/ich
 *     node tools/ich-zeichen-schau.mjs http://127.0.0.1:8391/neu/
 *
 * ENDE 0, wenn jede der sechs Aussagen haelt.
 */
import { writeFile } from 'node:fs/promises'
import WebSocket from 'ws'
import { adminAuf } from './admin-weg.mjs'
import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'

const argv = process.argv.slice(2)
const opt = (n, v = null) => {
  const i = argv.indexOf(`--${n}`)
  if (i < 0) return v
  const w = argv[i + 1]
  return w && !w.startsWith('--') ? w : true
}
const ZIEL = argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8378/neu/'
const BILD = typeof opt('bild', null) === 'string' ? opt('bild', null) : null

/** 800x480 auf 5" Waveshare — dieselbe Zahl wie in beruehrziele-neu.mjs. */
const MM_JE_PIXEL = 0.14
/** 2 mm nach ISO 9241-411 (Abstand zwischen zwei Zielen). */
const ABSTAND_MM = 2
/** 9 mm nach ISO 9241-411 (Groesse eines Ziels). */
const MARKE_MM = 9

const mm = (px) => px * MM_JE_PIXEL
const mmS = (px) => mm(px).toFixed(2)
const warte = (ms) => new Promise((r) => setTimeout(r, ms))

const befunde = []
const ja = (gut, wort, dazu = '') => {
  befunde.push({ gut, wort, dazu })
  console.log(`${gut ? 'ok  ' : 'NEIN'}  ${wort}${dazu ? `  — ${dazu}` : ''}`)
}

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

/**
 * WO LIEGT EIN ELEMENT WIRKLICH — getastet, nicht gerechnet.
 *
 * Ausgangspunkt ist `getBoundingClientRect`; das Ergebnis ist aber, was
 * `elementFromPoint` an diesen Stellen zurueckgibt. Ein Treffer zaehlt, wenn
 * der getroffene Knoten das Element selbst ist oder in ihm liegt (ein Tipp auf
 * das Bild IM Knopf loest den Knopf aus). Liefert kein Punkt einen Treffer,
 * ist das Element VERDECKT oder ABGESCHNITTEN — und beides ist eine Aussage,
 * kein Messfehler.
 */
const TASTEN_JS = String.raw`
(sel) => {
  const e = document.querySelector(sel)
  if (!e) return { da: false }
  const r = e.getBoundingClientRect()
  if (r.width < 1 || r.height < 1) return { da: true, sichtbar: false, grund: 'ohne Flaeche' }
  const trifft = (x, y) => {
    const t = document.elementFromPoint(x, y)
    return !!t && (t === e || e.contains(t))
  }
  let l = null, o = null, re = null, u = null
  for (let x = Math.max(0, Math.floor(r.left)); x <= Math.min(innerWidth - 1, Math.ceil(r.right)); x++) {
    for (let y = Math.max(0, Math.floor(r.top)); y <= Math.min(innerHeight - 1, Math.ceil(r.bottom)); y++) {
      if (!trifft(x, y)) continue
      if (l === null || x < l) l = x
      if (re === null || x > re) re = x
      if (o === null || y < o) o = y
      if (u === null || y > u) u = y
    }
  }
  if (l === null) return { da: true, sichtbar: false, grund: 'verdeckt oder abgeschnitten' }
  return { da: true, sichtbar: true, x: l, y: o, b: re - l + 1, h: u - o + 1,
           rechnung: { x: Math.round(r.left), y: Math.round(r.top), b: Math.round(r.width), h: Math.round(r.height) } }
}`

try {
  const ws = new WebSocket(await brw.seite(), { perMessageDeflate: false })
  await new Promise((r) => ws.once('open', r))
  await send(ws, 'Page.enable')
  await send(ws, 'Runtime.enable')
  await send(ws, 'Emulation.setDeviceMetricsOverride', {
    width: 800,
    height: 480,
    deviceScaleFactor: 1,
    mobile: false,
  })

  const ev = async (js) => {
    const r = await send(ws, 'Runtime.evaluate', { expression: js, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'Fehler in der Seite')
    return r.result.value
  }
  /**
   * DER GRIFF, den auch tools/ecke-oben-links-messen.mjs braucht:
   * `* { pointer-events: auto }` fuer die Dauer der Messung.
   *
   * OHNE IHN FAELLT `#zurueck` AUF DER STARTSEITE DURCH. Er steht dort
   * `disabled` mit `pointer-events: none` (ausgegraut statt weg) und ist fuer
   * `elementFromPoint` LUFT — waehrend er gut sichtbar 66x66 px belegt. Genau
   * die Sorte Platz, die man zweimal vergibt. Er veraendert die Messung, nicht
   * die Seite, und wird danach zurueckgenommen.
   */
  const durchlassAn = () =>
    ev(`(() => { const d = document.createElement('style'); d.id = 'mess-durchlass'
      d.textContent = '*{pointer-events:auto !important}'; document.head.appendChild(d); return true })()`)
  const durchlassAus = () =>
    ev(`(() => { const d = document.getElementById('mess-durchlass'); if (d) d.remove(); return true })()`)
  const tasten = (sel) => ev(`(${TASTEN_JS})(${JSON.stringify(sel)})`)
  const stand = async (w) => {
    await fetch(new URL(`/vorschau/${w}`, ZIEL))
  }
  const neuLaden = async () => {
    await send(ws, 'Page.navigate', { url: ZIEL })
    await warte(1500)
  }
  const bild = async (name) => {
    if (!BILD) return
    const s = await send(ws, 'Page.captureScreenshot', { format: 'png' })
    await writeFile(`${BILD}-${name}.png`, Buffer.from(s.data, 'base64'))
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 1. DAS ZEICHEN STEHT — UND ZWAR STILL
  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n── 1. Das Zeichen steht still ──────────────────────────────')
  await stand('voll')
  await stand('profil-allein')
  await stand('figuren-keine')
  await neuLaden()

  await durchlassAn()
  const aus = await tasten('#ich')
  ja(aus.da, '#ich ist im Baum')
  ja(aus.sichtbar, 'Leiste AUSGEFAHREN: getastet erreichbar', aus.sichtbar ? `x ${aus.x}..${aus.x + aus.b} y ${aus.y}..${aus.y + aus.h}` : aus.grund)
  if (aus.sichtbar) {
    ja(
      Math.min(aus.b, aus.h) * MM_JE_PIXEL >= MARKE_MM,
      `Groesse ueber der 9-mm-Marke`,
      `${aus.b}x${aus.h} px = ${mmS(Math.min(aus.b, aus.h))} mm`,
    )
  }
  await bild('start')

  // EINGEFAHREN DURCH ECHTES ROLLEN, nicht durch Setzen der Klasse: `.leiste`
  // faehrt ueber `body.platz-machen` ein, und wer die Klasse selbst setzt,
  // misst nicht die Oberflaeche, sondern seine eigene Annahme. Der Weg ist
  // derselbe wie in `rollenZu` (tools/beruehrziele-neu.mjs): rollen, dann das
  // Ereignis anstossen, auf das app.js wirklich hoert.
  await ev(`(() => {
    const e = document.querySelector('#raster .kachel')
    if (e) e.scrollIntoView({ block: 'center', behavior: 'auto' })
    const b = document.getElementById('buehne')
    if (b) b.dispatchEvent(new Event('scroll'))
    return true })()`)
  await warte(800)
  const eingefahren = await ev(`document.body.classList.contains('platz-machen')`)
  ja(eingefahren, 'die Leiste ist wirklich eingefahren (platz-machen)')
  const ein = await tasten('#ich')
  ja(ein.sichtbar, 'Leiste EINGEFAHREN: getastet erreichbar', ein.sichtbar ? `x ${ein.x}..${ein.x + ein.b}` : ein.grund)
  if (aus.sichtbar && ein.sichtbar) {
    ja(
      aus.x === ein.x && aus.y === ein.y,
      'ES WANDERT NICHT — dieselbe Stelle in beiden Lagen',
      `aus: x ${aus.x} / ein: x ${ein.x}`,
    )
  }
  await bild('eingefahren')

  // ═════════════════════════════════════════════════════════════════════════
  // 2. DER ABSTAND ZUM RUECKWEG
  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n── 2. Der Abstand zum Rueckweg ─────────────────────────────')
  const zur = await tasten('#zurueck')
  if (aus.sichtbar && zur.sichtbar) {
    const luecke = zur.x - (aus.x + aus.b)
    ja(
      mm(luecke) >= ABSTAND_MM,
      'mindestens 2 mm zwischen #ich und #zurueck',
      `${luecke} px = ${mmS(luecke)} mm`,
    )
    ja(luecke > 0, 'sie ueberlappen nicht', `#ich endet bei x ${aus.x + aus.b}, #zurueck beginnt bei x ${zur.x}`)
  } else {
    ja(false, 'der Abstand zum Rueckweg liess sich messen', `#zurueck: ${zur.grund || 'nicht da'}`)
  }
  await durchlassAus()

  // ═════════════════════════════════════════════════════════════════════════
  // 3. ES WIRD VERDECKT, WO ES VERDECKT WERDEN MUSS
  // ═════════════════════════════════════════════════════════════════════════
  //
  // NICHT „ES IST WEG", sondern „es ist nicht zu treffen". Das ist der
  // Unterschied, den `elementFromPoint` misst und `hidden` nicht: Ein Zeichen,
  // das unter einer deckenden Ebene liegt, meldet weiter seine 66x66 px.
  console.log('\n── 3. Verdeckt, wo es verdeckt gehoert ─────────────────────')
  await neuLaden()
  await ev(`document.getElementById('gross').hidden = false`)
  await warte(300)
  const imPlayer = await tasten('#ich')
  ja(!imPlayer.sichtbar, 'grosser Player (z 6) deckt es zu', imPlayer.sichtbar ? `NOCH ERREICHBAR bei x ${imPlayer.x}` : imPlayer.grund)

  await neuLaden()
  await ev(`document.getElementById('album-gross').hidden = false`)
  await warte(300)
  const imCover = await tasten('#ich')
  ja(!imCover.sichtbar, 'grosse Albumansicht (z 8) deckt es zu', imCover.sichtbar ? 'NOCH ERREICHBAR' : imCover.grund)

  // ── DER ELTERN-BEREICH: DIE AUSSAGE IST BERICHTIGT, NICHT GELOESCHT ─────
  //
  // HIER STAND BIS ZUM 06.08.2026: `ja(!beiEltern.sichtbar, 'Eltern-Bereich
  // (z 8) deckt es zu')`. DAS GALT, solange dieser Bereich ein DECKEL war
  // (`position: fixed; inset: 0`) — dann lag das Zeichen darunter und war
  // nicht zu treffen. Genau darauf berief sich die Begruendung fuer seinen
  // z-index 5 in app.css: „mit 5 verdecken die Ebenen es von allein".
  //
  // SEIT DEM 06.08.2026 IST DER BEREICH EINE SEITE (`left: 88px`, Betreiber:
  // „ich finde den entwurf gut wo nicht alles zu gedeckt ist"). Das Zeichen
  // steht bei x 8..74 und damit VOLLSTAENDIG NEBEN ihm — die Geometrie
  // verdeckt es nicht mehr, und der alte Satz waere ab hier eine Zusicherung,
  // die niemand mehr einloest.
  //
  // WAS IHN ERSETZT, sind ZWEI Aussagen statt einer, und die Trennung ist der
  // Punkt: die erste haelt fest, DASS die alte Absicherung gefallen ist (ein
  // stiller Wechsel waere das Schlimmste); die zweite prueft die neue, und die
  // ist eine Zeile JavaScript — `eltern.auf()` setzt `#ich` auf `disabled`.
  // WARUM ES SIE BRAUCHT, gemessen: sonst geht das Fenster „wer hoert" HINTER
  // dem Bereich auf (beide z-index 8, `#eltern` steht spaeter im Baum), ist
  // unbedienbar, und der eine Rueckweg raeumt es beim ERSTEN Tipp unsichtbar
  // weg. Und ein Profilwechsel ruft `location.reload()`, was die Bremse des
  // Tors aus dem Seitenspeicher loescht.
  await neuLaden()
  await ev(`document.getElementById('eltern').hidden = false`)
  await warte(300)
  const beiEltern = await tasten('#ich')
  ja(
    beiEltern.sichtbar,
    'Eltern-Bereich: er deckt es NICHT mehr zu (er ist eine Seite ab x 88, das Zeichen steht bei x 8..74)',
    beiEltern.sichtbar ? `erreichbar bei x ${beiEltern.x}..${beiEltern.x + beiEltern.b}` : `verdeckt — ${beiEltern.grund}`,
  )
  // UND JETZT DER ECHTE WEG, nicht das gesetzte `hidden`: `eltern.auf()` ist
  // die Stelle, an der stillgelegt wird. Wer nur die Huelle aufdeckt, misst
  // die Geometrie und nicht die Regel.
  await neuLaden()
  // HIER STAND EIN GRIFF ANS ZAHNRAD `#einst-knopf`. Es ist am 06.08.2026
  // ersatzlos entfallen; hinein fuehrt der Schriftzug `#wappen`. Dieser Weg
  // ist der TASTATURWEG und prueft das Halten NICHT — tools/admin-weg.mjs.
  await adminAuf(ev, { warteMs: 1200 })
  const wirklichAuf = await ev(`!document.getElementById('eltern').hidden`)
  ja(wirklichAuf, 'der Eltern-Bereich geht ueber das Zahnrad wirklich auf (sonst prueft das Naechste nichts)')
  const gesperrt = await ev(`document.getElementById('ich').disabled === true`)
  ja(gesperrt, 'IM OFFENEN ELTERN-BEREICH IST ES STILLGELEGT (disabled) — die Absicherung ist jetzt eine Regel, kein Zufall der Geometrie')
  const gedaempft = await ev(`Number(getComputedStyle(document.getElementById('ich')).opacity)`)
  ja(gedaempft < 0.6, 'und man SIEHT, dass es stilliegt — sonst waere es eine Attrappe', `opacity ${gedaempft}`)
  const beiOffen = await tasten('#ich')
  ja(!beiOffen.sichtbar, 'ein Finger auf ihm trifft es nicht', beiOffen.grund || '')
  await ev(`document.getElementById('ich').click()`)
  await warte(400)
  const fensterAuf = await ev(`!document.getElementById('ich-fenster').hidden`)
  ja(!fensterAuf, 'und ein Klick oeffnet KEIN Fenster hinter dem Bereich')

  // ═════════════════════════════════════════════════════════════════════════
  // 4. EIN FEHLENDES BILD ZERBRICHT NICHTS
  // ═════════════════════════════════════════════════════════════════════════
  //
  // DER NOTFALL, und seit dem 05.08.2026 abends NUR NOCH der Notfall: Bei
  // leerer Wahl steht oben links das MixPi (siehe Abteilung 7), nicht mehr
  // die Silhouette. Hierher kommt nur, wessen GEWAEHLTES Bild nicht laedt.
  //
  // DIE LAGE MUSS ES AN DER BOX GEBEN KOENNEN, sonst prueft diese Abteilung
  // eine Erfindung. Bis zum 06.08.2026 trug Liam in der Attrappe
  // `mixpi-winkt.png` — einen Namen, den KEIN Ordner nennt. Genau den
  // filtert `GET /api/profile` an der Box weg (server.ts, „Eine Figur, die es
  // nicht gibt, wird nicht genannt"); er kaeme nie bis zur Oberflaeche.
  // `figuren-fehlt` stellt die Lage, die es wirklich gibt: Der Ordner NENNT
  // die Namen, aber die Dateien liegen nicht darin — ein Bild, das zwischen
  // Auskunft und Laden verschwindet, oder eine Auslieferung ohne `bilder/`.
  // DASS ES DIESE ABTEILUNG WEITER GIBT, IST DER PUNKT: Der Rueckfall darf
  // nicht durch die neue Vorgabe ersetzt worden sein. Sonst saehe ein
  // verschwundenes Bild aus wie „nichts ausgesucht".
  console.log('\n── 4. Ein fehlendes Bild zerbricht nichts ──────────────────')
  await stand('profil-liam')
  await stand('figuren-fehlt')
  await neuLaden()
  await warte(800)
  const fehlend = await ev(`(() => {
    const i = document.getElementById('ich-bild')
    const s = document.querySelector('#ich .ich-schatten')
    if (!i || !s) return { fehler: 'Zeichen fehlt' }
    const sr = s.getBoundingClientRect()
    return { bildVersteckt: i.hidden, naturBreite: i.naturalWidth, silhouette: sr.width > 0 && sr.height > 0 }
  })()`)
  ja(fehlend.bildVersteckt === true, 'das fehlende <img> bleibt versteckt', `naturalWidth ${fehlend.naturBreite}`)
  ja(fehlend.silhouette === true, 'die gezeichnete Silhouette steht trotzdem da')
  const zeichenDa = await tasten('#ich')
  ja(zeichenDa.sichtbar, 'und das Zeichen ist weiter voll zu treffen', `${zeichenDa.b}x${zeichenDa.h} px`)
  await bild('bild-fehlt')

  // ═════════════════════════════════════════════════════════════════════════
  // 5. DIE AUSWAHL — mit EINEM Profil und mit dreien
  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n── 5. Die Auswahl ──────────────────────────────────────────')
  await stand('profil-allein')
  await stand('figuren-keine')
  await neuLaden()
  await ev(`document.getElementById('ich').click()`)
  await warte(700)
  const allein = await ev(`(() => {
    const f = document.getElementById('ich-fenster')
    return {
      offen: !f.hidden,
      werReihe: !document.getElementById('ich-teil-wer').hidden,
      bilder: document.querySelectorAll('#ich-bilder .ich-kachel').length,
      ueber: document.getElementById('ich-ueber-bild').textContent,
    }
  })()`)
  ja(allein.offen, 'ein Tipp auf das Zeichen oeffnet die Auswahl')
  ja(!allein.werReihe, 'MIT EINEM PROFIL steht keine Profilreihe da', 'sie waere eine Kachel, die nichts tut')
  ja(allein.bilder >= 1, 'die Bildauswahl ist NIE leer', `${allein.bilder} Kachel(n): die Vorgabe steht immer vorn`)
  ja(allein.ueber === 'Dein Bild', 'und sie heisst „Dein Bild"', allein.ueber)
  await bild('auswahl-allein')

  // DER RUECKWEG SCHLIESST SIE — kein eigenes Kreuz.
  await ev(`document.getElementById('zurueck').click()`)
  await warte(400)
  const zu = await ev(`document.getElementById('ich-fenster').hidden`)
  ja(zu === true, 'der EINE Rueckweg schliesst die Auswahl')
  const geraeumt = await ev(`document.querySelectorAll('#ich-bilder .ich-kachel').length`)
  ja(geraeumt === 0, 'und raeumt den Inhalt weg, statt ihn nur zu verstecken')

  await stand('profil-liam')
  await stand('figuren-da')
  await neuLaden()
  await ev(`document.getElementById('ich').click()`)
  await warte(900)
  const mehrere = await ev(`(() => ({
    werReihe: !document.getElementById('ich-teil-wer').hidden,
    leute: document.querySelectorAll('#ich-leute .ich-kachel').length,
    gewaehlt: [...document.querySelectorAll('#ich-leute .ich-kachel')]
      .filter((k) => k.getAttribute('aria-pressed') === 'true').length,
    bilder: document.querySelectorAll('#ich-bilder .ich-kachel').length,
  }))()`)
  ja(mehrere.werReihe, 'MIT MEHREREN PROFILEN steht die Profilreihe da')
  ja(mehrere.leute === 3, 'alle drei Profile stehen darin', `${mehrere.leute}`)
  ja(mehrere.gewaehlt === 1, 'genau eines ist als „dran" gekennzeichnet', `aria-pressed: ${mehrere.gewaehlt}`)
  ja(mehrere.bilder === 11, 'zehn Figuren plus die Vorgabe „MixPi"', `${mehrere.bilder}`)
  await bild('auswahl-mehrere')

  // ═════════════════════════════════════════════════════════════════════════
  // 6. DIE FIGUR WIRD WIRKLICH GEMERKT
  // ═════════════════════════════════════════════════════════════════════════
  //
  // NICHT „das Bild im Kopf hat sich geaendert" — das taete es auch, wenn die
  // Oberflaeche den Wert nur bei sich hinschriebe. Gemessen wird, was der
  // SERVER danach sagt, und dass es ein NEULADEN ueberlebt.
  console.log('\n── 6. Die Figur wird wirklich gemerkt ──────────────────────')
  const gewaehlt = await ev(`(() => {
    const k = [...document.querySelectorAll('#ich-bilder .ich-kachel')]
      .find((x) => x.querySelector('.ich-kachel-wort').textContent === 'Spielt')
    if (!k) return null
    k.click(); return 'Spielt'
  })()`)
  ja(gewaehlt === 'Spielt', 'eine Figur laesst sich antippen')
  await warte(900)
  const nachher = await ev(`(() => {
    const i = document.getElementById('ich-bild')
    return { quelle: i.getAttribute('src'), versteckt: i.hidden }
  })()`)
  ja(
    /mixpi-spielt\.png$/.test(nachher.quelle || ''),
    'das Zeichen zeigt danach die gewaehlte Figur',
    String(nachher.quelle),
  )
  ja(nachher.versteckt === false, 'und das Bild ist wirklich geladen (nicht nur gesetzt)')

  const vomServer = await (await fetch(new URL('/api/profile', ZIEL))).json()
  const liam = (vomServer.profile || []).find((p) => p.kennung === 'liam')
  ja(liam && liam.figur === 'mixpi-spielt.png', 'DER SERVER hat es gemerkt', liam ? liam.figur : 'kein Liam')

  await neuLaden()
  await warte(900)
  const ueberlebt = await ev(`document.getElementById('ich-bild').getAttribute('src')`)
  ja(/mixpi-spielt\.png$/.test(ueberlebt || ''), 'und es ueberlebt ein Neuladen', String(ueberlebt))
  await bild('gewaehlt')

  // ═════════════════════════════════════════════════════════════════════════
  // 7. „KEIN BILD GEWAEHLT" HEISST NICHT „KEIN BILD ZEIGEN"
  // ═════════════════════════════════════════════════════════════════════════
  //
  // DER BERICHTIGTE WUNSCH (Betreiber, 05.08.2026): „ich wollte niemals die
  // mixpi figur unten links, ich wollte sie oben links, schon vorbereitend
  // fuer den platz des bildes. damals ging was schief :)"
  //
  // WARUM DAS EINE EIGENE ABTEILUNG BRAUCHT: Der Leerfall ist die stillste
  // Lage dieser ganzen Oberflaeche. Der Server sagt bei einem Kind ohne
  // eigenes Bild LEER (`OHNE_FIGUR`) — was dann zu sehen ist, entscheidet
  // allein die Oberflaeche. Steht dort eine Silhouette statt des MixPi,
  // sieht das aus wie eine Absicht; und es sieht ausserdem GENAU SO AUS wie
  // „das Bild laedt gerade nicht". Zwei verschiedene Lagen, ein Bild —
  // niemandem faellt etwas auf, und in einer Groessenmessung schon gar
  // nicht.
  console.log('\n── 7. Kein Bild gewaehlt heisst nicht kein Bild zeigen ─────')
  // DIE WAHL AUS ABTEILUNG 6 WIRD AUSDRUECKLICH ZURUECKGENOMMEN. `/vorschau/
  // profil-gast` stellt nur um, WER dran ist — die eben getroffene Bildwahl
  // bleibt in der Attrappe stehen und wandert auf den Gast mit. Wer das
  // erbt, misst hier eine gewaehlte Figur und nennt sie „die Vorgabe": die
  // Aussage saehe gruen aus, ohne den Leerfall je gesehen zu haben (llmwiki
  // attrappe-luegt-durch-weglassen). Der Endpunkt setzt sie zurueck.
  await fetch(new URL('/api/profil/aktiv', ZIEL), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kennung: 'gast' }),
  })
  await stand('profil-gast')
  await stand('figuren-keine')
  await neuLaden()
  await warte(900)
  const leer = await ev(`(() => {
    const i = document.getElementById('ich-bild')
    const w = document.querySelector('.wappen-bild')
    const name = document.getElementById('wappen-oben')
    const fassung = document.getElementById('wappen-fassung')
    if (!i) return { fehler: 'kein #ich-bild' }
    const r = i.getBoundingClientRect()
    return {
      quelle: i.getAttribute('src') || '',
      versteckt: i.hidden,
      geladen: i.naturalWidth > 0,
      b: Math.round(r.width),
      h: Math.round(r.height),
      wappenBild: !!w,
      wappenName: (name || {}).textContent || '',
      wappenFassung: ((fassung || {}).textContent || '').length > 0,
    }
  })()`)
  ja(
    /(^|\/)bilder\/mixpi-hoert\.png$/.test(leer.quelle),
    'ohne gewaehltes Bild steht oben links DAS MixPi',
    String(leer.quelle),
  )
  ja(leer.geladen === true && leer.versteckt === false, 'und es ist wirklich geladen, nicht nur gesetzt')
  // DER PFAD IST DIE ZWEITE HAELFTE DERSELBEN AUSSAGE. `bilder/figuren/
  // mixpi-hoert.png` gaebe es nicht — eine 404, die am Schirm wieder wie die
  // Silhouette aussieht (llmwiki vorgabewert-ueberlebt-den-umzug-seines-
  // ordners). Deshalb wird der Ordner ausdruecklich AUSGESCHLOSSEN.
  ja(!leer.quelle.includes('/figuren/'), 'die Vorgabe geht NICHT durch den Figurenordner', leer.quelle)
  // DIE GROESSE, an derselben Stelle wie frueher im Wappen: Eine
  // Klassenkollision hat dasselbe Bild dort einmal auf 27 px gequetscht,
  // ohne Fehlermeldung (llmwiki wappen-hiess-marke-und-kollidierte).
  ja(leer.b >= 40 && leer.h >= 40, 'und es ist nicht gequetscht', `${leer.b}x${leer.h} px`)

  // UND ES STEHT NUR NOCH AN EINER STELLE. Zwei MixPis auf einem Schirm
  // waren der Zustand vor der Berichtigung; wer das Wappenbild in gutem
  // Glauben wieder einsetzt („da fehlt doch was"), stellt ihn wieder her.
  ja(leer.wappenBild === false, 'unten links steht KEIN zweites MixPi mehr')
  // WAS UNTEN BLEIBT, BLEIBT AUCH WIRKLICH. Der Wunsch vom 03.08.2026 nannte
  // zwei Zielorte; nur das BILD ist gewandert. Faellt hier Name oder Fassung
  // mit heraus, ist die halbe Aufgabe rueckgaengig gemacht.
  ja(leer.wappenName.length > 0, 'aber der Boxname steht weiter da', leer.wappenName)
  ja(leer.wappenFassung === true, 'und die laufende Fassung auch')
  await bild('vorgabe-mixpi')

  // DIE KACHEL SAGT, WAS SIE TUT. Sie hiess „Kein Bild" und zeigte die
  // Silhouette — seit oben links das MixPi steht, waehlt man mit ihr nicht
  // „kein Bild", sondern das MixPi.
  await ev(`document.getElementById('ich').click()`)
  await warte(700)
  const erste = await ev(`(() => {
    const k = document.querySelector('#ich-bilder .ich-kachel')
    if (!k) return { fehler: 'keine Kachel' }
    const i = k.querySelector('img')
    return {
      wort: k.querySelector('.ich-kachel-wort').textContent,
      quelle: i ? i.getAttribute('src') || '' : '',
      gewaehlt: k.getAttribute('aria-pressed'),
    }
  })()`)
  ja(erste.wort === 'MixPi', 'die erste Kachel heisst nach dem, was sie bewirkt', String(erste.wort))
  ja(
    erste.quelle.endsWith('mixpi-hoert.png'),
    'und sie zeigt dasselbe Bild, das dann oben links steht',
    String(erste.quelle),
  )
  ja(erste.gewaehlt === 'true', 'sie ist als „dran" gekennzeichnet, solange nichts gewaehlt ist')

  // DIE PROFILREIHE IM SELBEN FENSTER MUSS DASSELBE SAGEN.
  //
  // WARUM DAS EINE EIGENE AUSSAGE IST: Die Vorgabe „bei leerer Wahl das
  // MixPi" wurde am 05.08.2026 an ZWEI von DREI Stellen eingebaut — oben
  // links und in der Bildkachel —, aber nicht in der Reihe „Wer hoert?".
  // Dort blieb `figurPfad`, also der leere Pfad, also die Silhouette. Das
  // Fenster deckt den Schirm nur mit 42 % ab: Fuer ein und dasselbe Kind
  // standen damit ZWEI VERSCHIEDENE Bilder gleichzeitig auf dem Schirm,
  // 200 px voneinander entfernt. Keine Groessenmessung sieht das, und der
  // Leerfall ist der stillste Zustand dieser Oberflaeche.
  //
  // ES BRACH AUSSERDEM DIE UNTERSCHEIDUNG AUS
  // [[leerer-wert-heisst-nicht-leere-anzeige]]: In dieser Reihe sah „hat sich
  // nichts ausgesucht" genau so aus wie „das gewaehlte Bild ist weg".
  await stand('profil-liam')
  await stand('figuren-da')
  await neuLaden()
  await warte(900)
  await ev(`document.getElementById('ich').click()`)
  await warte(700)
  const reihe = await ev(`(() => {
    const raus = []
    for (const k of document.querySelectorAll('#ich-leute .ich-kachel')) {
      const i = k.querySelector('img')
      raus.push({
        wort: (k.querySelector('.ich-kachel-wort') || {}).textContent || '',
        quelle: i ? i.getAttribute('src') || '' : '',
        gezeichnet: !i || i.hidden,
      })
    }
    return raus
  })()`)
  const reiheGast = reihe.find((r) => r.wort === 'Gast')
  const reiheLiam = reihe.find((r) => r.wort === 'Liam')
  ja(reihe.length >= 2, 'die Profilreihe steht (drei Profile in der Vorschau)', `${reihe.length} Kacheln`)
  ja(
    !!reiheGast && reiheGast.quelle.endsWith('mixpi-hoert.png'),
    'ein Profil OHNE eigenes Bild zeigt in der Reihe DASSELBE wie oben links',
    reiheGast ? String(reiheGast.quelle) : 'keine Kachel „Gast"',
  )
  ja(
    !!reiheGast && !reiheGast.quelle.includes('/figuren/'),
    'und auch hier geht die Vorgabe NICHT durch den Figurenordner',
    reiheGast ? String(reiheGast.quelle) : '—',
  )
  // WELCHE FIGUR LIAM TRAEGT, WIRD GEFRAGT UND NICHT GEWUSST. Der Name stand
  // hier zuerst fest (`mixpi-winkt.png`) — und wurde am selben Abend in der
  // Attrappe ausgetauscht, weil die Box Namen ohne Datei wegfiltert. Ein
  // Pruefwerkzeug, das den Wert der Attrappe abschreibt, misst dann eine
  // Zahl, die es selbst mitgebracht hat.
  let liamFigur = ''
  try {
    const p = await (await fetch(new URL('/api/profile', ZIEL))).json()
    liamFigur = ((p.profile || []).find((x) => x.kennung === 'liam') || {}).figur || ''
  } catch {
    /* dann bleibt die Aussage unten stehen und faellt auf */
  }
  ja(
    !!reiheLiam && !!liamFigur && reiheLiam.quelle.endsWith(liamFigur),
    'ein Profil MIT eigenem Bild zeigt weiter seines',
    `${reiheLiam ? reiheLiam.quelle : 'keine Kachel „Liam"'} — /api/profile sagt „${liamFigur}"`,
  )
  ja(
    !!reiheGast && !!reiheLiam && reiheGast.quelle !== reiheLiam.quelle,
    'ein Kind mit eigenem Bild sieht in der Reihe ANDERS aus als eines ohne',
    reiheGast && reiheLiam ? `${reiheGast.quelle} gegen ${reiheLiam.quelle}` : '—',
  )
  await bild('profilreihe')

  // DER UNTERSCHIED, DER NICHT EINGEEBNET WERDEN DARF: Eine GEWAEHLTE Figur,
  // die nicht laedt, faellt NICHT auf die Vorgabe zurueck — sonst saehe „das
  // Bild dieses Kindes ist verschwunden" aus wie „es hat sich nichts
  // ausgesucht", und niemand suchte je nach der fehlenden Datei.
  await stand('profil-liam')
  await stand('figuren-fehlt')
  await neuLaden()
  await warte(900)
  const kaputt = await ev(`(() => {
    const i = document.getElementById('ich-bild')
    return { quelle: i.getAttribute('src') || '', versteckt: i.hidden }
  })()`)
  ja(
    kaputt.quelle.includes('/figuren/') && !kaputt.quelle.endsWith('mixpi-hoert.png'),
    'eine gewaehlte Figur wird NICHT durch die Vorgabe ersetzt',
    String(kaputt.quelle),
  )
  ja(kaputt.versteckt === true, 'laedt sie nicht, bleibt die Silhouette — der NOTFALL, nicht der Normalfall')

  ws.close()
} finally {
  // IM `finally`: Ein Werkzeug, das nur auf dem gruenen Weg aufraeumt, laesst
  // die geliehene Vorschau gerade dann verstellt stehen, wenn es einen Fehler
  // gefunden hat — also genau dann, wenn als naechstes jemand hinsieht.
  await brw.schliessen()
  await leihe.zurueckgeben()
}

const schlecht = befunde.filter((b) => !b.gut)
console.log('')
if (schlecht.length) {
  console.log(`${schlecht.length} von ${befunde.length} Aussagen halten NICHT:`)
  for (const b of schlecht) console.log(`  - ${b.wort}${b.dazu ? `  (${b.dazu})` : ''}`)
  process.exit(1)
}
console.log(`Alle ${befunde.length} Aussagen halten.`)
