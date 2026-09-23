#!/usr/bin/env node
/**
 * WIEVIELE TORE STEHEN AUF DEM WEG EINES ELTERNTEILS?
 *
 * ══ DIE MELDUNG ════════════════════════════════════════════════════════════
 * „beim eingeben kömmt 2 mal die aufgabe" (Betreiber, 06.08.2026, am Geraet).
 *
 * ══ WARUM DAS AUS DEM QUELLTEXT NICHT ZU BEANTWORTEN IST ═══════════════════
 * Der zweite Waechter liegt in einer ANDEREN Oberflaeche und hinter einem
 * VOLLEN Seitenwechsel. Ob er fragt, haengt an `entsperrtStand` — einem
 * `signal(false)` im Arbeitsspeicher der Angular-App. Ob ein Seitenwechsel
 * diesen Speicher wirklich leert, ist genau die Frage; sie laesst sich nur
 * durch das Gehen des Weges beantworten.
 *
 * ══ WAS ES MISST ═══════════════════════════════════════════════════════════
 * Jeder Fall geht den ECHTEN Weg: das Tor der NEUEN Oberflaeche loesen, und
 * danach zaehlen, wie oft noch gefragt wird.
 *
 *   1  Zahnrad -> Tor -> Eltern-Bereich
 *   1a          -> Fach „System"  -> /settings      — KEIN zweites Tor
 *   1b          -> innerhalb von Angular weiter     — KEIN drittes
 *   1c          -> /wifi NEU LADEN                  — KEIN zweites
 *   1d          -> zurueck auf /home                — die Freigabe FAELLT
 *   2-4 die Faecher System / WLAN / Anzeige         — je EIN Tor
 *   5   das Bluetooth-Zeichen der Kopfzeile         — EIN Tor
 *   6   /settings DIREKT aufgerufen                 — es WIRD gefragt
 *   7   der Rueckweg: danach steht das Tor WIEDER
 *
 * ══ DIE ERWARTUNG HAT SICH AM 06.08.2026 UMGEDREHT ═════════════════════════
 * Dieses Werkzeug ist entstanden, um den Fehler zu ZEIGEN: 23 Aussagen,
 * 0 Abweichungen, und auf jedem der fuenf Wege standen ZWEI Tore. Seit die
 * gemeinsame Freigabe gebaut ist (NewDesign/freigabe.json,
 * src/frontend-box/src/app/einstellungssperre/freigabe.ts) misst es das
 * Gegenteil — und die Faelle 1d und 6 sind dabei die WICHTIGEREN: eine
 * Freigabe, die nicht faellt, ist keine Sperre mehr.
 *
 * ══ WAS ES AENDERT ═════════════════════════════════════════════════════════
 * Nichts. Keine Datei des Baums, und an der Box wird gar nicht gemessen.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *     node tools/beide-oberflaechen-vorschau.mjs --port 8802 --www <bau>
 *     node tools/zwei-tore-messen.mjs http://127.0.0.1:8802
 *
 * Es verlangt die KOMBINIERTE Vorschau: beide Oberflaechen auf EINEM Ursprung,
 * sonst ist der Seitenwechsel keiner und der `sessionStorage` nicht derselbe.
 * `<bau>` ist ein frischer Angular-Bau:
 *     cd src/frontend-box && npx ng build --configuration production \
 *        --output-path=<bau>
 * DER BAU MUSS FRISCH SEIN. Er enthaelt die Freigabe als eingebackene Zahl
 * (der Verweis auf NewDesign/freigabe.json wird beim Bauen aufgeloest); ein
 * alter Bau misst eine Fassung, die es nicht mehr gibt.
 */
import WebSocket from 'ws'
import { browserSuchen, eigenerBrowser } from './leihgabe.mjs'
import { WAPPEN_HALTEN_MS } from './admin-weg.mjs'

const ZIEL = process.argv.slice(2).find((a) => a.startsWith('http')) || 'http://127.0.0.1:8802'
const warte = (ms) => new Promise((r) => setTimeout(r, ms))

const befunde = []
const ja = (gut, wort, dazu = '') => {
  befunde.push({ gut, wort, dazu })
  console.log(`${gut ? 'ok  ' : 'NEIN'}  ${wort}${dazu ? `  — ${dazu}` : ''}`)
}

if (!browserSuchen()) {
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

const chrome = await eigenerBrowser({ fenster: '800,480' })
let ws = null
try {
  ws = new WebSocket(await chrome.seite())
  await new Promise((r) => ws.once('open', r))
  await send(ws, 'Page.enable')
  await send(ws, 'Runtime.enable')
  // DER SCHIRM DER BOX, UND ZWAR ALS SICHTFELD. `--window-size=800,480` ist
  // das FENSTER; headless liess davon 800x337 Sichtfeld uebrig. GEMESSEN, und
  // es hat diese Messung schon einmal verdorben: bei 337 Bildpunkten Hoehe
  // liegt der Mini-Player ueber der untersten Tastenreihe des Tors, „0" und
  // „Weiter" bekamen die Tipps also gar nicht. Das Ergebnis war „die Aufgabe
  // wurde nie geloest" — und sah aus wie ein Befund ueber die Sperre.
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })

  const werten = async (ausdruck) => {
    const r = await send(ws, 'Runtime.evaluate', {
      expression: ausdruck,
      returnByValue: true,
      awaitPromise: true,
    })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + ausdruck)
    return r.result.value
  }

  const gehe = async (u) => {
    await send(ws, 'Page.navigate', { url: u })
    for (const frist = Date.now() + 15000; Date.now() < frist; ) {
      try {
        if (await werten('document.readyState === "complete"')) return
      } catch {
        /* mitten im Wechsel */
      }
      await warte(120)
    }
    throw new Error('Seite kam nicht fertig: ' + u)
  }

  const lage = async (was) => {
    await fetch(`${ZIEL}/vorschau/${was}`)
  }

  /** Ein echter Tipp: Maus nieder und wieder hoch, mit Dauer. */
  const tippen = async (wahl, halten = 60) => {
    // DER ERSTE TREFFER IST NICHT IMMER DER SICHTBARE. Ionic laesst beim
    // Aufziehen eines Modals zwei Abbilder desselben Inhalts im Baum stehen;
    // das erste hat die Groesse 0x0 und liegt bei 0,0 — ein Tipp dorthin
    // trifft das `ion-router-outlet` darunter.
    const box = await werten(`(() => {
      for (const e of document.querySelectorAll(${JSON.stringify(wahl)})) {
        const r = e.getBoundingClientRect()
        if (r.width > 0 && r.height > 0) return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
      }
      return null
    })()`)
    if (!box) throw new Error('nicht da: ' + wahl)
    // WER LIEGT AUF DEM ZIEL? Ein Tipp, den ein anderes Element abfaengt, sieht
    // in der Messung aus wie ein Tipp, auf den die Oberflaeche nicht reagiert.
    const getroffen = await werten(`(() => {
      const soll = document.querySelector(${JSON.stringify(wahl)})
      const ist = document.elementFromPoint(${box.x}, ${box.y})
      return !!ist && (ist === soll || soll.contains(ist))
    })()`)
    if (!getroffen) {
      const wer = await werten(
        `(() => { const e = document.elementFromPoint(${box.x}, ${box.y}); return e ? e.tagName + (e.id ? '#' + e.id : '') : 'nichts' })()`,
      )
      throw new Error(`${wahl} liegt bei ${box.x},${box.y} UNTER ${wer} — der Tipp kaeme nie an`)
    }
    const g = { x: box.x, y: box.y, button: 'left', clickCount: 1, buttons: 1 }
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...g })
    await warte(halten)
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...g, buttons: 0 })
  }

  /**
   * DEN EINSTIEG HALTEN, bis er aufgeht.
   *
   * Bis zum 06.08.2026 war das ein 60-ms-Tipp aufs Zahnrad `#einst-knopf`.
   * Es ist ersatzlos entfallen; `#wappen` traegt genau EINE Geste, und die
   * dauert WAPPEN_HALTEN_MS. Der Zuschlag deckt den Abstand zwischen dem
   * letzten Bildschritt und der Frist.
   */
  const halteEinstieg = () => tippen('#wappen', WAPPEN_HALTEN_MS + 300)

  const warteBis = async (ausdruck, ms = 8000) => {
    for (const frist = Date.now() + ms; Date.now() < frist; ) {
      try {
        if (await werten(ausdruck)) return true
      } catch {
        /* Wechsel laeuft */
      }
      await warte(100)
    }
    return false
  }

  /** Das Tor der NEUEN Oberflaeche loesen (Sorte „rechnen"). */
  const neuesTorLoesen = async () => {
    // AUF DIE FRAGE WARTEN, NICHT AUF DIE FLAECHE.
    //
    // `eltern.auf()` zeigt das Tor SOFORT und schreibt erst danach die Frage
    // hinein — die strengere Annahme steht, bevor die Konfiguration da ist.
    // Wer nur auf `!hidden` wartet, liest den Platzhalter aus index.html
    // („PIN eingeben") und meldet dann „die Aufgabe wurde nie geloest". Genau
    // darauf ist dieser Lauf am 06.08.2026 hereingefallen.
    const da = await warteBis(
      `(() => { const t = document.getElementById('eltern-tor'); if (!t || t.hidden) return false
                const f = document.getElementById('tor-frage'); return !!f && /\\d+\\s*[×x*]\\s*\\d+/.test(f.textContent) })()`,
    )
    if (!da) return { gestellt: !(await werten('document.getElementById("eltern-tor").hidden')) }
    const frage = await werten('document.getElementById("tor-frage").textContent')
    const m = /(\d+)\s*×\s*(\d+)/.exec(frage)
    if (!m) return { gestellt: true, frage, geloest: false }
    const antwort = String(Number(m[1]) * Number(m[2]))
    for (const z of antwort) await tippen(`#tor-feld [data-taste="${z}"]`)
    await tippen('#tor-feld [data-taste="weiter"]')
    return { gestellt: true, frage, geloest: true }
  }

  /**
   * Steht der Dialog der KLASSISCHEN Oberflaeche — und ist er WIRKLICH da?
   *
   * Auf das blosse Vorhandensein zu warten genuegt nicht: Ionic haengt das
   * Modal in den Baum, bevor es es aufzieht. In diesem Fenster hat jedes
   * Element die Groesse 0x0, und ein Tipp darauf landet im
   * `ion-router-outlet` darunter.
   */
  const angularTor = async (ms = 8000) =>
    await warteBis(
      `(() => { const e = document.querySelector("mupi-sperre-dialog .sp-frage"); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 })()`,
      ms,
    )

  /** Das Tor der KLASSISCHEN Oberflaeche loesen (Sorte „rechnen"). */
  const angularTorLoesen = async () => {
    const frage = await werten('document.querySelector("mupi-sperre-dialog .sp-frage").textContent')
    const m = /(\d+)\s*[×x*]\s*(\d+)/.exec(frage)
    if (!m) return { frage, geloest: false }
    const antwort = String(Number(m[1]) * Number(m[2]))
    for (const z of antwort) await tippen(`mupi-sperre-dialog .sp-taste[aria-label="${z}"]`)
    await tippen('mupi-sperre-dialog .sp-ok')
    const weg = await warteBis('!document.querySelector("mupi-sperre-dialog")', 6000)
    return { frage, geloest: weg }
  }

  const pfad = async () => await werten('location.pathname')

  // ═══════════════════════════════════════════════════════════════════════
  //  Die Lage der Box .169: der Schluessel fehlt in der Konfiguration.
  // ═══════════════════════════════════════════════════════════════════════
  //
  // ES IST DIE LAGE DES BETREIBERS, nicht die schoenste zum Messen: `sperre-
  // fehlt` laesst `mupibox.einstellungssperre` GANZ weg. Beide Oberflaechen
  // lesen daraus seit dem 06.08.2026 „rechnen".
  await lage('sperre-fehlt')

  /** Fragt die KLASSISCHE Oberflaeche NOCH EINMAL? Das ist die ganze Frage. */
  const zweitesTorSteht = async (ms = 4000) => await angularTor(ms)

  // ── FALL 1: der Einstieg — der Weg, den der Betreiber gegangen ist ─────
  //
  // BIS ZUM MORGEN DES 06.08.2026 TRUG DAS ZAHNRAD `#einst-knopf` zwei
  // Gesten, deren Grenze bei 700 ms lag und unsichtbar war; das war die eine
  // Haelfte der Meldung („es öffnet einfach den alten bereich"). Danach
  // oeffnete es immer den Eltern-Bereich. AM ABEND DESSELBEN TAGES IST ES
  // ERSATZLOS ENTFALLEN: hinein fuehrt der Schriftzug `#wappen`, gehalten.
  // Der Weg wird ECHT gegangen (gedrueckte Maustaste ueber die volle Frist),
  // nicht ueber einen Aufruf von `eltern.auf()`.
  await gehe(`${ZIEL}/neu/`)
  await warteBis('!!document.getElementById("wappen")')
  await halteEinstieg()
  const t1 = await neuesTorLoesen()
  ja(t1.gestellt, 'Fall 1 — das NEUE Tor steht nach dem Tipp aufs Zahnrad', t1.frage || '')
  ja(t1.geloest, 'Fall 1 — die Aufgabe wurde geloest')
  const bereichAuf = await warteBis('!document.getElementById("eltern-flaeche").hidden')
  ja(bereichAuf, 'Fall 1 — der Eltern-Bereich steht offen (und NICHT /settings)', await pfad())

  // ── FALL 1a: von dort ins Fach „System" — der alte Weg, jetzt sichtbar ──
  const losGegangen = Date.now()
  await tippen('#eltern-faecher [data-fach="system"]')
  const kam = await warteBis('location.pathname === "/settings"', 10000)
  ja(kam, 'Fall 1a — das Fach „System" fuehrt nach /settings', await pfad())
  // DIE ZAHL, DIE DIE DAUER DER FREIGABE TRAGEN MUSS: wie lange dauert die
  // UEBERGABE selbst — vom Tipp bis zur fertigen Angular-Seite? Alles, was
  // kuerzer waere als das, ergaebe eine Freigabe, die auf halbem Weg
  // verfaellt. Auf einem Pi 5 hinter Chromium ist es MEHR als hier; diese
  // Zahl ist die UNTERGRENZE, nicht die Erwartung.
  const uebergabe = Date.now() - losGegangen
  console.log(`      Uebergabe gemessen: ${uebergabe} ms (Vorschau auf x86, KEIN Pi)`)
  const zweites = await zweitesTorSteht()
  ja(
    !zweites,
    'Fall 1a — ES WIRD NICHT NOCH EINMAL GEFRAGT (die gemeinsame Freigabe traegt)',
    zweites ? 'der Angular-Dialog steht TROTZDEM' : 'kein zweiter Dialog',
  )

  // ── FALL 1b: INNERHALB von Angular weitergehen ──────────────────────────
  await werten(`(() => { history.pushState(null, '', '/wifi'); dispatchEvent(new PopStateEvent('popstate', { state: null })); return true })()`)
  // AM BAUM GEMESSEN, NICHT AN DER ADRESSE: `app.component.ts` schickt die Box
  // bei laufender Wiedergabe von sich aus nach `/player`.
  const inWifi = await warteBis('!!document.querySelector("app-wifi")', 6000)
  if (inWifi) {
    ja(!(await zweitesTorSteht(2500)), 'Fall 1b — INNERHALB von Angular wird nicht erneut gefragt')
  } else {
    // NICHT GEMESSEN — UND DESHALB AUCH NICHT BEHAUPTET. Der Anstoss ueber
    // `popstate` kommt in dieser Vorschau nicht bis zur WLAN-Seite; die
    // Kacheln der Einstellungen bleiben leer, weil ihre Daten aus Endpunkten
    // kommen, die die Attrappe nicht kennt.
    console.log(`?     Fall 1b — Wechsel INNERHALB von Angular hier nicht herstellbar (Adresse: ${await pfad()})`)
  }

  // ── FALL 1c: DER KERN DER SACHE — dieselbe Adresse NEU LADEN ────────────
  //
  // `entsperrtStand` ist ein `signal(false)` im Arbeitsspeicher; ein
  // Seitenaufbau loescht es. GENAU HIER wurde vor dem 06.08.2026 ein zweites
  // Mal gefragt. Die Freigabe liegt im `sessionStorage` und ueberlebt.
  await gehe(`${ZIEL}/wifi`)
  ja(
    !(await zweitesTorSteht()),
    'Fall 1c — auch nach einem NEULADEN von /wifi wird nicht gefragt',
    'die Freigabe ueberlebt den Seitenaufbau',
  )

  // ── FALL 1d: UND SIE FAELLT BEIM VERLASSEN ──────────────────────────────
  //
  // DAS IST DIE GEGENPROBE UND SIE IST WICHTIGER ALS ALLES DAVOR. Eine
  // Freigabe, die nicht faellt, ist keine Sperre mehr, sondern eine Tuer, die
  // zwei Minuten offensteht — unabhaengig davon, wer dann vor der Box steht.
  // Der Rueckweg auf den Kinderschirm ist das einzige Zeichen, das die Box
  // bekommt, dass das Elternteil fertig ist.
  await gehe(`${ZIEL}/home`)
  await warte(600)
  const nochDa = await werten(
    `(() => { try { return sessionStorage.getItem('mupibox_eltern_freigabe') } catch { return 'FEHLER' } })()`,
  )
  ja(nochDa === null, 'Fall 1d — das Verlassen des Bereichs LOESCHT die Freigabe', String(nochDa))
  await gehe(`${ZIEL}/wifi`)
  ja(await zweitesTorSteht(), 'Fall 1d — und danach wird wieder gefragt', 'die Sperre ist zurueck')

  // ── FALL 2..4: die drei Faecher, die in Angular springen ────────────────
  for (const [fach, ziel] of [
    ['system', '/settings'],
    ['wlan', '/wifi'],
    ['anzeige', '/darstellung'],
  ]) {
    await gehe(`${ZIEL}/neu/`)
    await werten('try { sessionStorage.clear() } catch {}')
    await gehe(`${ZIEL}/neu/`)
    await warteBis('!!document.getElementById("wappen")')
    await halteEinstieg()
    const t = await neuesTorLoesen()
    const flaeche = await warteBis('!document.getElementById("eltern-flaeche").hidden')
    ja(t.gestellt && t.geloest && flaeche, `Fach ${fach} — Tor 1 geloest, der Bereich steht offen`)
    await tippen(`#eltern-faecher [data-fach="${fach}"]`)
    const dort = await warteBis(`location.pathname === ${JSON.stringify(ziel)}`, 10000)
    ja(dort, `Fach ${fach} — der Weg fuehrt nach ${ziel}`, await pfad())
    ja(!(await zweitesTorSteht()), `Fach ${fach} — und es wird NICHT ein zweites Mal gefragt`)
  }

  // ── FALL 5: das Bluetooth-Zeichen der Kopfzeile ─────────────────────────
  //
  // Es traegt genau EINE Geste und geht weiterhin unmittelbar nach
  // /bluetooth — durch das Tor, aber ohne Umweg ueber den Bereich.
  await gehe(`${ZIEL}/neu/`)
  await werten('try { sessionStorage.clear() } catch {}')
  await gehe(`${ZIEL}/neu/`)
  await warteBis('!!document.getElementById("bt-knopf")')
  await tippen('#bt-knopf', 60)
  const t5 = await neuesTorLoesen()
  ja(t5.gestellt && t5.geloest, 'Fall 5 — Bluetooth-Zeichen: Tor 1 steht und faellt')
  const bt = await warteBis('location.pathname === "/bluetooth"', 10000)
  ja(bt, 'Fall 5 — der Weg fuehrt nach /bluetooth', await pfad())
  ja(!(await zweitesTorSteht()), 'Fall 5 — und es wird NICHT ein zweites Mal gefragt')

  // ── FALL 6: WER DIREKT AUFRUFT, WIRD GEFRAGT ───────────────────────────
  //
  // DIE FREIGABE ERSETZT DIE SPERRE NICHT. Wer `/settings` in die Adresszeile
  // schreibt, ohne vorher ein Tor geloest zu haben, hat keinen gueltigen
  // Eintrag. Das ist die Luecke, die in der Nacht zum 06.08.2026 geschlossen
  // wurde, und sie muss geschlossen bleiben.
  await gehe(`${ZIEL}/neu/`)
  await werten('try { sessionStorage.clear() } catch {}')
  await gehe(`${ZIEL}/settings`)
  ja(await zweitesTorSteht(), 'Fall 6 — der DIREKTE Aufruf von /settings wird gefragt')
  const g6 = await angularTorLoesen()
  ja(g6.geloest, 'Fall 6 — und das Tor der klassischen Oberflaeche faellt', g6.frage)
  const g6frei = await werten(
    `(() => { try { return sessionStorage.getItem('mupibox_eltern_freigabe') } catch { return 'FEHLER' } })()`,
  )
  ja(
    /^[0-9]+$/.test(String(g6frei)),
    'Fall 6 — auch DIESES Tor schreibt die gemeinsame Freigabe (beide Richtungen)',
    String(g6frei),
  )

  // ── FALL 7: DER RUECKWEG — und danach steht das Tor WIEDER ─────────────
  await gehe(`${ZIEL}/neu/`)
  await werten('try { sessionStorage.clear() } catch {}')
  await gehe(`${ZIEL}/neu/`)
  await warteBis('!!document.getElementById("wappen")')
  await halteEinstieg()
  await neuesTorLoesen()
  await warteBis('!document.getElementById("eltern-flaeche").hidden')
  await tippen('#zurueck')
  await warte(600)
  await halteEinstieg()
  const t7 = await neuesTorLoesen()
  ja(t7.gestellt, 'Fall 7 — nach dem Verlassen steht das NEUE Tor WIEDER', t7.frage || '')

  // ── GEGENPROBE: ist der Speicher wirklich derselbe? ─────────────────────
  const ursprung = await werten('location.origin')
  const speicher = await werten(`(() => {
    try { sessionStorage.setItem('mupi_probe', 'x'); return sessionStorage.getItem('mupi_probe') === 'x' }
    catch { return false }
  })()`)
  ja(speicher, 'sessionStorage ist in der neuen Oberflaeche beschreibbar', ursprung)
  await gehe(`${ZIEL}/settings`)
  const drueben = await werten(`(() => { try { return sessionStorage.getItem('mupi_probe') } catch { return null } })()`)
  ja(drueben === 'x', 'sessionStorage UEBERLEBT den Seitenwechsel nach /settings', String(drueben))
  const ursprung2 = await werten('location.origin')
  ja(ursprung === ursprung2, 'beide Oberflaechen haben denselben Ursprung', `${ursprung} / ${ursprung2}`)
} finally {
  try {
    ws?.close()
  } catch {
    /* zu */
  }
  await chrome.schliessen()
}

const schlecht = befunde.filter((b) => !b.gut).length
console.log(`\n${befunde.length} Aussagen, ${schlecht} nicht wie erwartet.`)
