#!/usr/bin/env node
/**
 * SPERRT DIE SPERRE WIRKLICH? — und passt der Eltern-Bereich auf 800x480?
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WOZU DIESES WERKZEUG UEBERHAUPT EXISTIERT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Der Eltern-Bereich der Box liegt hinter einer Kindersicherung. In der
 * Angular-App ist das eine `CanActivateFn` an fuenf Routen. Die neue,
 * rahmenwerkfreie Oberflaeche hat KEINEN Router — ihre Bildschirme sind
 * Zustand, keine Adresse. Ein Bereich, der dort entsteht, hat also gar kein
 * `canActivate`; die Sperre muss neu gebaut werden.
 *
 * UND IHR AUSFALL IST STILL UND NICHT UNTERSCHEIDBAR. Die Vorgabe der Sperre
 * ist „aus". Eine Sperre, die nicht mehr sperrt, sieht am Bildschirm EXAKT so
 * aus wie eine, die niemand eingeschaltet hat. Nichts wird rot, niemand meldet
 * etwas. Dass drei Seiten der Box heute ungesperrt sind (`/favorites`,
 * `/jellyfin`, `/spotify` — letztere beide mit Serveradresse, Benutzer und
 * Schluessel dahinter) und es niemandem aufgefallen ist, bis ein Werkzeug
 * danach gesucht hat, ist der Beleg dafuer, wie leise diese Fehlerklasse ist.
 *
 * Was hinter der Sperre liegt, ist kein Aussehen: die rohe Mediendatenbank mit
 * ihren Loeschknoepfen, die WLAN-Verbindung — und `POST /api/shutdown`, das
 * von der Box aus IMMER ohne Anmeldung erreichbar ist (das Anmeldetor laesst
 * alles von 127.0.0.1 durch). Die PIN im Browser ist die einzige Huerde, die
 * es gibt.
 *
 * DESHALB MISST DIESES WERKZEUG DIE WIRKUNG UND NICHT DAS VORHANDENSEIN.
 * Nicht „gibt es ein Tor?", sondern: „Mit Sperre AN und ohne PIN — stehen die
 * Bluetooth-Zeilen im Baum?" Ein Tor, das da ist und nichts zurueckhaelt,
 * besteht jede Pruefung, die nur nach ihm sucht.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WAS ES PRUEFT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   1. WIRKUNG DER SPERRE, vier Lagen (die Attrappe kennt alle vier):
 *        aus       geht ohne Frage auf                   -> Zeilen DA
 *        pin       ohne PIN                              -> Zeilen WEG
 *                  mit FALSCHER PIN                      -> Zeilen WEG
 *                  mit richtiger PIN                     -> Zeilen DA
 *        rechnen   ohne Antwort / mit falscher Antwort   -> Zeilen WEG
 *                  mit richtiger Antwort                 -> Zeilen DA
 *        kaputt    /api/config antwortet 500             -> Zeilen DA
 *                  (der VERTRAG: eine Box, die ihre Konfiguration nicht lesen
 *                   kann, darf sich nicht selbst aussperren)
 *   2. WIEDER ZU BEIM VERLASSEN. Wer einmal die PIN eingegeben hat, darf nicht
 *      bis zum Neustart der Box offen bleiben. Der Rueckweg schliesst — und
 *      beim naechsten Aufmachen steht das Tor wieder da.
 *   3. KEIN WEG MEHR NACH /settings. Erst fuehrte das Zahnrad hin (kurzer
 *      Tipp), dann die Zeile „Weitere Einstellungen ↗" im Admin-Menue; seit
 *      dem 14.08.2026 ist der Sprung ausgebaut (Wunsch des Betreibers).
 *      Gemessen wird, dass er ausgebaut BLEIBT — und dass die Gruppe
 *      „System" dabei nicht leer geworden ist.
 *   4. TREFFERFLAECHEN. Jedes Bedienelement mindestens 64 px (9 mm bei
 *      0,14 mm/px, ISO 9241-411) — und es wird auch wirklich getroffen
 *      (elementFromPoint), nicht nur gross gezeichnet.
 *   5. PASST ES IN 800x480? Nichts darf ueber den Rand hinausragen, und der
 *      eine Rueckweg oben links darf nicht verdeckt sein.
 *   6. HELL UND DUNKEL, beide Male.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WAS ES NICHT TUT
 * ═══════════════════════════════════════════════════════════════════════════
 *   * Es aendert nichts. Eigener Browser gegen tools/neu-vorschau.mjs, keine
 *     Box im Spiel.
 *   * Es prueft KEINE echte PIN. Die Box vergleicht gegen einen bcrypt-Hash
 *     und bremst nach Fehlversuchen; die Attrappe antwortet nur ja oder nein.
 *     Geprueft wird, was die OBERFLAECHE aus dem Nein macht.
 *   * Es ersetzt keine Pruefung auf dem Geraet. Ob es auf 800x480 hinter
 *     Chromium taugt, sagt nur die Box.
 *
 * AUFRUF
 *     node tools/eltern-muster-schau.mjs
 *     node tools/eltern-muster-schau.mjs --pruefen          # Ende 1 bei Fehler
 *     node tools/eltern-muster-schau.mjs --bild eltern.png  # -hell/-dunkel
 *
 * OHNE BROWSER wird uebersprungen statt zu scheitern.
 */
import { writeFile } from 'node:fs/promises'
import WebSocket from 'ws'
import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'
import { adminAuf } from './admin-weg.mjs'

const ZIEL = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8299/neu/'
const PRUEFEN = process.argv.includes('--pruefen')
const BILD = (() => {
  const i = process.argv.indexOf('--bild')
  return i >= 0 ? process.argv[i + 1] || 'eltern-muster.png' : null
})()

/** 800x480 sind 0,14 mm/px; 64 px sind 9 mm (ISO 9241-411). */
const ZIEL_PX = 64
/** Die PIN der Attrappe — die des Entwurfs, damit sie niemand fuer eine echte haelt. */
const PIN_RICHTIG = '2468'

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

/** Ein Befund mit Erwartung — das Herz dieses Werkzeugs. */
const soll = (was, ist, erwartet) => {
  const ok = JSON.stringify(ist) === JSON.stringify(erwartet)
  console.log(`  ${ok ? 'ok  ' : 'FEHL'} ${String(was).padEnd(42)} ${JSON.stringify(ist)}`)
  if (!ok) {
    fehler++
    console.error(`          erwartet: ${JSON.stringify(erwartet)}`)
  }
}

/**
 * Liegt der eine Rueckweg auf der Ueberschrift?
 *
 * DIESER SCHRITT KAM NACHTRAEGLICH DAZU, und zwar weil er gefehlt hat: Am
 * 04.08.2026 stand der Knopf mitten auf dem Wort „Eltern-Bereich", und jede
 * Zahl dieses Werkzeugs war gruen. Gemessen wurden Bedienelemente
 * gegeneinander — eine Ueberschrift ist keines und darf deshalb beliebig
 * verdeckt werden, ohne dass eine Trefferflaeche schrumpft. Gefunden hat es
 * das BILD.
 *
 * DIE LEHRE, die ueber diesen Bereich hinausgeht: Ein Werkzeug, das nur
 * Knoepfe kennt, sieht die halbe Seite nicht. Der eine Rueckweg liegt mit
 * z-index 9 ueber allem (llmwiki rueckweg-lag-ueber-der-meldung) — wer unter
 * ihm etwas hinschreibt, merkt es sonst erst am Geraet.
 *
 * 12 px Luft, nicht 0: Zwei Flaechen, die sich exakt beruehren, sehen aus wie
 * ein Fehler, und die naechste Schriftgroesse macht daraus eine Ueberdeckung.
 */
const kopfPruefen = (wo, m) => {
  zeile(
    '  Kopfzeile: Rueckweg gegen Titel',
    m.kopfVerdeckt
      ? `${m.kopfVerdeckt} px VERDECKT`
      : m.kopfLuft === null
        ? 'eigene Zeile — kein Naeheproblem moeglich'
        : `frei, ${m.kopfLuft} px Luft${m.kopfLuft < 12 ? '  — ZU KNAPP' : ''}`,
  )
  if (m.kopfVerdeckt) melde(`${wo}: der Rueckweg verdeckt ${m.kopfVerdeckt} px der Ueberschrift`)
  else if (m.kopfLuft !== null && m.kopfLuft < 12) melde(`${wo}: nur ${m.kopfLuft} px zwischen Rueckweg und Ueberschrift`)
}

/**
 * Was gerade auf dem Schirm steht — als Daten.
 *
 * `zeilen` IST DIE ENTSCHEIDENDE ZAHL: Sie sagt, ob hinter dem Tor etwas
 * steht. Nicht `hidden` abzufragen, sondern die Zeilen zu ZAEHLEN, ist Absicht
 * — ein `display: none` waere eine Sichtbarkeitsfrage, hier geht es darum, ob
 * die Auskunft ueberhaupt im Baum liegt.
 */
const LAGE_FN = `(() => {
  const e = document.getElementById('eltern');
  const t = document.getElementById('eltern-tor');
  const f = document.getElementById('eltern-flaeche');
  return {
    offen: !e.hidden,
    tor: !t.hidden,
    flaeche: !f.hidden,
    zeilen: document.querySelectorAll('#fach-zeilen .fach-zeile').length,
    faecher: [...document.querySelectorAll('.fach-knopf > span:first-child')].map((s) => s.textContent),
    fort: [...document.querySelectorAll('.fach-knopf')].filter((k) => k.querySelector('.fach-fort')).length,
    unter: document.getElementById('eltern-unter').textContent,
    frage: document.getElementById('tor-frage').textContent,
    meldung: document.getElementById('tor-meldung').textContent,
    anzeige: document.getElementById('tor-anzeige').textContent,
    weiterFrei: !document.querySelector('.tor-weiter').disabled,
  };
})()`

try {
  await warte(1500)
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  // Ohne das misst man einen Schirm, den es nicht gibt: `--window-size` liess
  // dem Sichtfenster nur 337 statt 480 px Hoehe.
  await send(ws, 'Emulation.setDeviceMetricsOverride', {
    width: 800,
    height: 480,
    deviceScaleFactor: 1,
    mobile: false,
  })
  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value

  const schalten = async (was) => {
    await fetch(new URL(`/vorschau/${was}`, ZIEL))
  }
  const laden = async () => {
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warte(2200)
  }

  /**
   * DER WEG HINEIN IST EIN ECHTER — nicht `hidden = false` von aussen.
   *
   * Ein `hidden = false` zeigte den Bereich auch dann, wenn er ueber die
   * Oberflaeche gar nicht erreichbar waere, und genau das ist die Frage.
   *
   * BIS ZUM 06.08.2026 WAR ES EIN LANGES HALTEN AUFS ZAHNRAD `#einst-knopf`.
   * Das Zahnrad ist ersatzlos entfallen; hinein fuehrt der Schriftzug
   * `#wappen`. Hier wird der TASTATURWEG genommen — er prueft das Halten
   * NICHT (tools/admin-weg.mjs); gemessen wird in dieser Datei, WAS HINTER
   * dem Tor steht, und dafuer ist er der richtige.
   *
   * `pruefen: false`: die halbe Datei misst Lagen, in denen das Tor steht
   * oder der Bereich absichtlich zubleibt — das Urteil darueber faellt
   * `LAGE_FN` weiter unten und nicht der Weg hinein.
   */
  const langHalten = async () => {
    await adminAuf(ev, { warteMs: 600, pruefen: false })
  }

  const tippen = async (ziffern) => {
    for (const z of String(ziffern)) {
      await ev(`document.querySelector('.tor-taste[data-taste="${z}"]').click()`)
      await warte(40)
    }
  }
  const weiter = async () => {
    await ev(`document.querySelector('.tor-weiter').click()`)
    await warte(500)
  }
  const zurueck = async () => {
    await ev(`document.getElementById('zurueck').click()`)
    await warte(250)
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  1. DIE WIRKUNG DER SPERRE
  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n── Wirkung der Sperre (nicht ihr Vorhandensein) ────────────')

  // ── aus: die Vorgabe. Kein Tor, keine Verzoegerung, kein Unterschied.
  await schalten('sperre-aus')
  await laden()
  await langHalten()
  let l = await ev(LAGE_FN)
  soll('Sperre aus: Bereich offen', l.offen, true)
  soll('Sperre aus: kein Tor', l.tor, false)
  soll('Sperre aus: Zeilen da', l.zeilen > 0, true)
  zeile('Faecher', l.faecher.join(' · ') + `  (${l.fort} davon fuehren in die alte Oberflaeche)`)
  /* Die Spalte traegt genau das, was es auf der Box GIBT. „Ton & Zeit" und
   * „Kinder" zeichnet der Entwurf, aber dahinter liegt nichts (E23/P2) — ein
   * leerer Reiter waere eine Attrappe im ausgelieferten Erzeugnis. Dasselbe
   * gilt seit dem 06.08.2026 fuer VPN, Hotspot, Account und QR-Einrichtung
   * aus der Gliederung des Betreibers: kein Server-Endpunkt, kein Reiter.
   *
   * HIER STAND ['WLAN','Bluetooth','Anzeige','System'] — die vier Faecher des
   * Musters vom 04.08.2026. In der Spalte stehen seit dem 06.08.2026 VIER
   * GRUPPEN; die elf Punkte liegen eine Ebene tiefer in der Karte. */
  soll('Gruppen: genau die vier vorhandenen', l.faecher, ['Verbindung', 'Medien', 'Darstellung', 'System'])
  /* KEINE GRUPPE TRAEGT MEHR EINEN PFEIL, und das ist eine Aussage und kein
   * fehlender Test. Am 04.08.2026 fuehrten drei der vier Faecher in die
   * Angular-App (`pfad`), und der Pfeil ↗ war die Warnung davor. Seither sind
   * WLAN, Medien und Anzeige nacheinander native Faecher geworden; seit dem
   * 06.08.2026 gibt es in der SPALTE gar keinen `pfad` mehr. Der letzte
   * Sprung war eine ZEILE in der Uebersicht von „System" („Weitere
   * Einstellungen ↗"); seit dem 14.08.2026 ist auch sie ausgebaut — kein
   * Punkt traegt mehr einen `pfad`. Abschnitt 3 unten misst genau das.
   * EIN PFEIL AN EINER GRUPPE WAERE JETZT FALSCH: eine Warnung vor etwas, das
   * beim Antippen nicht passiert. Deshalb 0 und nicht „egal". */
  soll('und KEINE davon mit Pfeil — keine verlaesst diese Oberflaeche', l.fort, 0)

  // ── pin: DER FALL, UM DEN ES GEHT.
  await schalten('sperre-pin')
  await laden()
  await langHalten()
  l = await ev(LAGE_FN)
  soll('Sperre pin: Tor steht', l.tor, true)
  soll('Sperre pin OHNE PIN: keine Zeilen', l.zeilen, 0)
  soll('Sperre pin: „Weiter" noch gesperrt', l.weiterFrei, false)
  zeile('Frage', `„${l.frage}"`)

  // Drei Ziffern: das Backend nimmt vier bis acht. Ein Knopf, der schon hier
  // leuchtet, verspricht eine Pruefung, die immer nein sagt.
  await tippen('123')
  l = await ev(LAGE_FN)
  soll('drei Ziffern: „Weiter" bleibt gesperrt', l.weiterFrei, false)
  soll('drei Ziffern: verdeckt angezeigt', l.anzeige, '•••')

  await tippen('9')
  l = await ev(LAGE_FN)
  soll('vier Ziffern: „Weiter" frei', l.weiterFrei, true)
  await weiter()
  l = await ev(LAGE_FN)
  soll('FALSCHE PIN: keine Zeilen', l.zeilen, 0)
  soll('FALSCHE PIN: Tor steht weiter', l.tor, true)
  soll('FALSCHE PIN: Eingabe geleert', l.anzeige, '– – – –')
  zeile('Meldung', `„${l.meldung}"`)
  if (!/[Ff]alsch/.test(l.meldung)) melde('nach einer falschen PIN steht kein Wort da, das das sagt')

  await tippen(PIN_RICHTIG)
  await weiter()
  l = await ev(LAGE_FN)
  soll('RICHTIGE PIN: Tor weg', l.tor, false)
  soll('RICHTIGE PIN: Zeilen da', l.zeilen > 0, true)
  zeile('Zeilen', `${l.zeilen}  (Kopfzeile: „${l.unter}")`)

  // ── 2. WIEDER ZU BEIM VERLASSEN ────────────────────────────────────────
  //
  // OHNE DIESE EINE ZEILE IM CODE waere die Sperre eine Frage, die genau
  // einmal gestellt wird: wer sie einmal beantwortet hat, kaeme bis zum
  // naechsten Neustart der Box ohne PIN hinein. Am Bildschirm sieht das
  // vollkommen normal aus.
  await zurueck()
  l = await ev(LAGE_FN)
  soll('Rueckweg schliesst den Bereich', l.offen, false)
  await langHalten()
  l = await ev(LAGE_FN)
  soll('WIEDER GESPERRT nach dem Verlassen', l.tor, true)
  soll('wieder gesperrt: keine Zeilen', l.zeilen, 0)

  // ── rechnen: die dritte Sorte, die gern durchfaellt ─────────────────────
  //
  // `sperrlogik.ts` kennt DREI Modi. Wer nur die PIN baut, laesst „rechnen"
  // still durchfallen — der Bereich stuende dann offen, und niemand saehe es.
  await schalten('sperre-rechnen')
  await laden()
  await langHalten()
  l = await ev(LAGE_FN)
  soll('Sperre rechnen: Tor steht', l.tor, true)
  soll('Sperre rechnen: keine Zeilen', l.zeilen, 0)
  const aufgabe = await ev(`(() => {
    const m = document.getElementById('tor-frage').textContent.match(/(\\d+)\\s*×\\s*(\\d+)/);
    return m ? { a: +m[1], b: +m[2] } : null })()`)
  if (!aufgabe) melde('die Rechenaufgabe steht nicht in der Frage')
  else {
    zeile('Aufgabe', `${aufgabe.a} × ${aufgabe.b} = ${aufgabe.a * aufgabe.b}`)
    if (aufgabe.a < 3 || aufgabe.a > 9 || aufgabe.b < 3 || aufgabe.b > 9)
      melde(`die Faktoren liegen ausserhalb von 3..9 (${aufgabe.a}, ${aufgabe.b})`)
    // Erst eine falsche Antwort — sie muss zurueckweisen UND eine NEUE Aufgabe
    // stellen. Sonst probiert man dieselbe Aufgabe durch.
    const falsch = String(aufgabe.a * aufgabe.b === 12 ? 13 : 12)
    await tippen(falsch)
    await weiter()
    l = await ev(LAGE_FN)
    soll('falsche Antwort: keine Zeilen', l.zeilen, 0)
    const zweite = await ev(`document.getElementById('tor-frage').textContent`)
    zeile('nach dem Fehlversuch', `„${zweite}"`)

    /*
     * ── DIE BREMSE ABWARTEN, UND SIE DABEI NACHWEISEN ────────────────────
     *
     * Seit dem 06.08.2026 wartet das Tor nach dem ersten Fehlversuch fuenf
     * Sekunden (`TOR_WARTEN_S` in app.js) — ohne sie ist die Rechenaufgabe
     * durchprobierbar. Dieses Werkzeug wusste davon nichts: es tippte die
     * richtige Antwort sofort, `torPruefen` wies sie wegen `rest > 0` ab, und
     * der Lauf meldete „richtige Antwort: Zeilen da — erwartet true, ist
     * false". EIN ROTER BEFUND UEBER EINE OBERFLAECHE, DIE RICHTIG ARBEITET,
     * ist teurer als gar keiner: Er steht in einem Werkzeug, das genau diesen
     * Bereich bewacht, und gewoehnt seinem Leser das Hinsehen ab.
     *
     * ES WIRD NICHT BLIND GESCHLAFEN. Ein `await warte(6000)` waere hier die
     * bequeme Zeile und die falsche: Sie ginge auch dann durch, wenn die
     * Bremse GAR NICHT mehr da waere — und dann faehrt dieses Werkzeug wieder
     * gruen ueber eine Sperre, die sich in Sekunden durchprobieren laesst.
     * Gemessen wird deshalb, DASS die Bremse steht, und danach wird auf ihr
     * Ende gewartet.
     */
    const bremse = await ev(`document.getElementById('tor-meldung').textContent`)
    // DER WORTLAUT WIRD NICHT ABGESCHRIEBEN, sondern an seiner FORM erkannt:
    // „Noch <n> Sekunde(n)". Der Satz davor hiess am 06.08.2026 vormittags
    // noch „Zu viele Fehlversuche" und heisst jetzt „Das stimmt nicht" — ein
    // Werkzeug, das den ganzen Satz vergleicht, faellt bei jeder Umformulierung
    // um und behauptet dabei, die Bremse sei weg.
    soll('nach dem Fehlversuch bremst das Tor', /Noch \d+ Sekunde/.test(String(bremse)), true)
    zeile('die Bremse sagt', `„${bremse}"`)
    const bis = Date.now() + 90000
    for (;;) {
      const m = await ev(`document.getElementById('tor-meldung').textContent`)
      if (!/Noch \d+ Sekunde/.test(String(m))) break
      if (Date.now() > bis) {
        melde('die Bremse loeste sich in 90 s nicht')
        break
      }
      await warte(500)
    }

    // DIE AUFGABE NOCH EINMAL LESEN. Waehrend der Bremse laeuft ein
    // Sekundentakt (`bremsTakt`), und `torMalen` kann in der Zwischenzeit eine
    // neue Aufgabe gestellt haben. Die alte zu verwenden hiesse, den zweiten
    // Fehlversuch zu messen und ihn fuer einen Treffer zu halten.
    const dritte = await ev(`document.getElementById('tor-frage').textContent`)
    const a2 = String(dritte).match(/(\d+)\s*×\s*(\d+)/)
    if (!a2) melde(`nach der Bremse steht keine Aufgabe mehr da: „${dritte}"`)
    else {
      await tippen(String(Number(a2[1]) * Number(a2[2])))
      await weiter()
      l = await ev(LAGE_FN)
      soll('richtige Antwort: Zeilen da', l.zeilen > 0, true)
    }
  }

  // ── kaputt: /api/config antwortet gar nicht ─────────────────────────────
  //
  // DER VERTRAG, und er ist wichtiger als er aussieht: Eine Box, die ihre
  // Konfiguration nicht lesen kann, darf sich NICHT selbst aussperren — sonst
  // kaeme man an der Box selbst nicht mehr ins WLAN, um sie zu erreichen. Das
  // ist dieselbe Entscheidung, die `alsModus` in der Angular-App trifft.
  await schalten('sperre-kaputt')
  await laden()
  await langHalten()
  l = await ev(LAGE_FN)
  soll('Konfiguration unlesbar: laesst durch (Vertrag)', l.zeilen > 0, true)
  soll('Konfiguration unlesbar: kein Tor', l.tor, false)

  // ═════════════════════════════════════════════════════════════════════════
  //  3. KEIN WEG MEHR NACH /settings — DER SPRUNG IST AUSGEBAUT
  // ═════════════════════════════════════════════════════════════════════════
  //
  // DIESER ABSCHNITT HAT SEINE AUSSAGE UMGEDREHT, und zwar zum zweiten Mal:
  //   * BIS 06.08.2026 galt „kurzer Tipp aufs Zahnrad fuehrt nach /settings".
  //     Das Zahnrad fiel weg; der Weg wanderte ins Admin-Menue (Gruppe
  //     „System", Zeile „Weitere Einstellungen ↗").
  //   * BIS 14.08.2026 stand hier deshalb: „/settings ist ueber das
  //     Admin-Menue erreichbar". Diese Zeile ist seither AUSGEBAUT — auf
  //     Wunsch des Betreibers (ELTERN_PUNKTE in NewDesign/app.js, dort die
  //     ganze Begruendung): sie fuehrte NICHT in die alte PHP-Verwaltung,
  //     sondern ueber die Auffangroute der Angular-Verwaltung nur auf deren
  //     Uebersicht. An ihrer Stelle steht jetzt „Plugins"; die Verwaltung
  //     selbst liegt unveraendert unter https://<box>:8443/admin.
  //
  // DIESES WERKZEUG HAT DEN UMBAU VERPASST (Befund 15.08.2026): Der Commit
  // vom 14.08. stellte tools/admin-menue-schau.mjs um, diesen Abschnitt aber
  // nicht — drei rote Schritte ueber eine Oberflaeche, die genau das tat, was
  // bestellt war. Der Verdacht fiel zuerst auf den Einstieg (langHalten, der
  // Profilwechsel am Benutzerbild), aber der war es nicht: die
  // Sperr-Abschnitte oeffnen den Bereich auf demselben Weg und blieben gruen.
  //
  // WARUM HIER TROTZDEM GEMESSEN WIRD, statt den Abschnitt zu streichen: Ein
  // ausgebauter Weg, der wiederauftaucht, waere ein unbeschlossener Umbau.
  // Und eine reine Nein-Pruefung ginge auch dann durch, wenn die Gruppe
  // „System" GAR NICHTS mehr malte — deshalb erst die positiven Aussagen
  // (Zeilen da, der Tauschpartner steht), dann die negativen (keine
  // Sprungzeile, kein ↗, kein Seitenwechsel, keine Rueckweg-Marke). Die
  // VOLLSTAENDIGE Zeilenliste prueft tools/admin-menue-schau.mjs — sie steht
  // absichtlich nur dort.
  console.log('\n── Kein Weg mehr nach /settings (ausgebaut am 14.08.2026) ──')
  await schalten('sperre-aus')
  await laden()
  await langHalten()
  const gruppeAuf = await ev(`(() => { const k = document.querySelector('.fach-knopf[data-fach="system"]')
    if (k) k.click(); return !!k })()`)
  soll('die Gruppe „System" laesst sich oeffnen', gruppeAuf, true)
  await warte(400)
  const zeilenText = await ev(`[...document.querySelectorAll('#fach-zeilen button')]
    .map((k) => k.textContent || '')`)
  soll('die Uebersicht traegt Zeilen (keine leere Gruppe)', zeilenText.length > 0, true)
  soll('der Tauschpartner „Plugins" steht an ihrer Stelle', zeilenText.some((t) => t.includes('Plugins')), true)
  soll('„Weitere Einstellungen" steht NICHT mehr da', zeilenText.some((t) => t.includes('Weitere Einstellungen')), false)
  soll('keine Zeile traegt mehr den Sprungpfeil ↗', zeilenText.filter((t) => t.includes('↗')).length, 0)
  const wohin = await ev(`location.pathname`)
  soll('die Seite bleibt auf /neu/', wohin, '/neu/')
  const marke = await ev(`sessionStorage.getItem('mupibox_neu_rueckweg')`)
  soll('keine Rueckweg-Marke gelegt (niemand springt)', marke, null)

  // ═════════════════════════════════════════════════════════════════════════
  //  4.-6. MASSE, TREFFER, RAND — hell und dunkel
  // ═════════════════════════════════════════════════════════════════════════
  const MESS_FN = `(() => {
    const raus = [];
    const stuecke = [...document.querySelectorAll('#eltern button'), document.getElementById('zurueck')];
    for (const k of stuecke) {
      const r = k.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
      const o = document.elementFromPoint(x, y);
      raus.push({
        was: (k.id || k.className.split(' ')[0]) + (k.dataset.taste ? ':' + k.dataset.taste : '')
             + (k.textContent && k.textContent.trim().length < 14 ? ' „' + k.textContent.trim() + '“' : ''),
        b: Math.round(r.width), h: Math.round(r.height),
        // EIN GESPERRTER KNOPF WIRD NICHT GETROFFEN, und das ist richtig so:
        // pointer-events none gibt den Punkt an das Element darunter. Wer das
        // als Fehler meldete, erzeugte bei jedem Lauf eine Warnung, die
        // niemand mehr liest — und darin ginge die echte unter. Gemessen wird
        // er trotzdem: die GROESSE gilt auch gesperrt.
        // (KEINE RUECKWAERTS-HOCHKOMMAS IN DIESEM KOMMENTAR: er steht in einem
        //  Vorlagenliteral, und das erste beendete es mitten im Satz. Genau
        //  hier zugeschlagen, 04.08.2026 — llmwiki backticks-in-angular-
        //  vorlagen, dieselbe Falle ausserhalb von Angular.)
        gesperrt: !!k.disabled,
        trifft: !!(o && (k === o || k.contains(o))),
        // WER LIEGT STATT DESSEN DORT? Ohne diese Zeile stand in der Meldung
        // „wird von etwas anderem verdeckt" — und wer das las, musste selbst
        // nachsehen, WAS. Seit der Eltern-Bereich eine Seite ist, gibt es
        // dafuer zwei sehr verschiedene Antworten (siehe das Feld gerollt).
        // (WIEDER KEINE RUECKWAERTS-HOCHKOMMAS: dieser Kommentar steht in
        //  einem Vorlagenliteral. Die Warnung ein paar Zeilen tiefer stand da
        //  schon — und ist trotzdem ein zweites Mal zugeschlagen, 06.08.2026.)
        statt: o ? (o.tagName.toLowerCase() + (o.id ? '#' + o.id : '') + (o.className && typeof o.className === 'string' ? '.' + o.className.split(' ')[0] : '')) : 'nichts',
        // ── AUS DEM BILD GEROLLT IST NICHT VERDECKT ────────────────────────
        //
        // Die Zeilenliste (#fach-zeilen) ist eine rollende Liste; das war sie
        // immer. Seit dem 06.08.2026 haelt die Karte unten 84 px fuer das
        // eingefahrene Kissen frei, und damit sind statt drei nur noch zwei
        // Zeilen ganz zu sehen. DAS IST KEIN FEHLER, sondern der Preis dafuer,
        // dass anhalten und lauter im Eltern-Bereich bedienbar sind — aber es
        // sieht in der Zeile „WIRD NICHT GETROFFEN" genauso aus wie ein
        // Knopf, der unter einer Ebene begraben liegt. Die beiden Faelle
        // auseinanderzuhalten ist der ganze Zweck dieses Feldes: ein Knopf,
        // der durch Rollen zu erreichen ist, kostet eine Fingerbewegung; einer,
        // der unter dem Kissen liegt, ist weg.
        gerollt: (() => {
          for (let e = k.parentElement; e && e !== document.body; e = e.parentElement) {
            if (e.scrollHeight <= e.clientHeight + 1) continue
            const b = e.getBoundingClientRect()
            if (r.top + r.height / 2 > b.bottom - 0.5 || r.top + r.height / 2 < b.top + 0.5) return true
          }
          return false
        })(),
        // RAGT ES UEBER DEN SCHIRM? 800x480 ist kein Vorschlag: was darueber
        // hinausliegt, ist auf der Box nicht erreichbar — genau wie heute
        // „Reboot / Shutdown", das zu 86 % ausserhalb des Bildes steht.
        raus: r.right > 800.5 || r.bottom > 480.5 || r.left < -0.5 || r.top < -0.5,
      });
    }
    const e = document.getElementById('eltern').getBoundingClientRect();
    const z = document.getElementById('fach-zeilen');
    // LIEGT DER RUECKWEG AUF DER UEBERSCHRIFT?
    //
    // DIESER BEFUND KAM VOM BILD, NICHT VON DIESEM WERKZEUG (04.08.2026): Der
    // Knopf stand mitten auf dem Wort „Eltern-Bereich" — und JEDE Zahl oben
    // war gruen. Der Grund ist lehrreich: gemessen wurden Bedienelemente
    // gegeneinander, und eine Ueberschrift ist keines. Sie kann also beliebig
    // verdeckt werden, ohne dass eine Trefferflaeche kleiner wird.
    //
    // Dieselbe Fehlerklasse wie [rueckweg-lag-ueber-der-meldung]: der eine
    // Rueckweg liegt mit z-index 9 ueber ALLEM und nimmt sich seinen Platz,
    // ohne zu fragen. Wer unter ihm etwas hinschreibt, merkt es nur am Bild.
    // Deshalb steht die Frage ab jetzt hier — als Zahl, nicht als Blick.
    const t = document.getElementById('zurueck').getBoundingClientRect();
    const deckt = (n) => {
      const r = n.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return 0;
      const b = Math.min(r.right, t.right) - Math.max(r.left, t.left);
      const h = Math.min(r.bottom, t.bottom) - Math.max(r.top, t.top);
      return b > 0.5 && h > 0.5 ? Math.round(b) : 0;
    };
    return {
      knoepfe: raus,
      // Wie viele Punkte des Wortes der Rueckweg verschluckt. 0 ist die
      // einzige richtige Antwort.
      kopfVerdeckt: Math.max(
        deckt(document.querySelector('.eltern-titel')),
        deckt(document.querySelector('.eltern-unter')),
      ),
      // NUR IN DERSELBEN ZEILE ist ein horizontaler Abstand eine Aussage.
      // Seit dem Vollbild-Umbau wohnt die Ueberschrift unten links und der
      // Rueckweg oben — ihr x-Abstand war dann eine Zahl ohne Bedeutung
      // (gemessen: -146, waehrend kopfVerdeckt zu Recht 0 sagte, und dieser
      // Waechter meldete eine Naehe, die es am Schirm nicht gibt). null
      // heisst: eigene Zeile, die Frage stellt sich nicht.
      kopfLuft: (() => {
        const k = document.querySelector('.eltern-titel').getBoundingClientRect();
        const gleicheZeile = Math.min(k.bottom, t.bottom) - Math.max(k.top, t.top) > 0.5;
        return gleicheZeile ? Math.round(k.left - t.right) : null;
      })(),
      // Die Soll-Lage kommt AUS DER SEITE (--eltern-links), nicht als
      // abgeschriebene Zahl: am 06.08. vormittags galt x 88 (Seite neben der
      // Leiste), abends entschied der Betreiber Vollbild (x 0) - und dieser
      // Waechter trug noch die Vormittagszahl.
      elternLinks: Math.round(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--eltern-links')) || 0),
      bereich: { l: Math.round(e.left), b: Math.round(e.width), h: Math.round(e.height) },
      // Rollt die Liste? Das ist erlaubt — aber man soll es WISSEN.
      rollt: z ? z.scrollHeight > z.clientHeight + 1 : false,
      sichtbareZeilen: z ? [...z.children].filter((c) => c.getBoundingClientRect().bottom <= z.getBoundingClientRect().bottom + 1).length : 0,
      zeilenGesamt: z ? z.children.length : 0,
    };
  })()`

  for (const licht of ['hell', 'dunkel']) {
    console.log(`\n── Masse und Treffer (${licht}) ────────────────────────────`)
    await ev(`localStorage.setItem('mupibox_neu_licht_v1', ${JSON.stringify(licht)})`)
    await schalten('sperre-pin')
    await laden()
    await langHalten()

    // ERST DAS TOR MESSEN, dann die Flaeche — beide sind Bedienflaechen, und
    // das Tor ist die, die ein Elternteil im Halbdunkel trifft oder eben nicht.
    let m = await ev(MESS_FN)
    for (const k of m.knoepfe) {
      const zu_klein = k.b < ZIEL_PX || k.h < ZIEL_PX
      zeile(
        `  Tor: ${k.was}`,
        `${k.b} x ${k.h} px${zu_klein ? '  — ZU KLEIN' : ''}${k.trifft ? '' : '  — WIRD NICHT GETROFFEN'}${k.raus ? '  — AUSSERHALB' : ''}`,
      )
      if (zu_klein) melde(`${licht}: ${k.was} ist ${k.b}x${k.h} px, unter den geforderten ${ZIEL_PX}`)
      if (!k.trifft && !k.gesperrt && !k.gerollt)
        melde(`${licht}: ${k.was} wird von ${k.statt} verdeckt`)
      // AUS DEM BILD GEROLLT — kein Fehler, aber es gehoert GESAGT. Begruendung
      // am Feld `gerollt` in MESS_FN.
      if (!k.trifft && !k.gesperrt && k.gerollt)
        zeile(`  (${k.was})`, `nur durch Rollen erreichbar — die Liste rollt, das Ziel ist nicht verdeckt`)
      if (k.raus) melde(`${licht}: ${k.was} ragt ueber den 800x480-Schirm hinaus`)
    }
    kopfPruefen(`${licht}/Tor`, m)
    if (BILD) {
      const s = await send(ws, 'Page.captureScreenshot', { format: 'png' })
      await writeFile(BILD.replace(/(\.png)?$/, `-tor-${licht}.png`), Buffer.from(s.data, 'base64'))
      console.log(`  Bild: ${BILD.replace(/(\.png)?$/, `-tor-${licht}.png`)}`)
    }

    // DER FREIGEGEBENE „WEITER" MUSS EIGENS GEMESSEN WERDEN. Gesperrt wird er
    // ohnehin nicht getroffen (`pointer-events: none`) — die Frage ist, ob er
    // getroffen wird, wenn es darauf ankommt. Ohne diese vier Zeilen bliebe
    // genau der eine Knopf ungeprueft, der die Tuer aufmacht.
    await tippen(PIN_RICHTIG)
    const w = await ev(`(() => {
      const k = document.querySelector('.tor-weiter'); const r = k.getBoundingClientRect();
      const o = document.elementFromPoint(Math.round(r.left + r.width/2), Math.round(r.top + r.height/2));
      return { b: Math.round(r.width), h: Math.round(r.height), gesperrt: !!k.disabled,
               trifft: !!(o && (k === o || k.contains(o))) } })()`)
    zeile(
      '  Tor: „Weiter" freigegeben',
      `${w.b} x ${w.h} px${w.gesperrt ? '  — IMMER NOCH GESPERRT' : ''}${w.trifft ? '' : '  — WIRD NICHT GETROFFEN'}`,
    )
    if (w.gesperrt) melde(`${licht}: „Weiter" bleibt auch mit vollstaendiger PIN gesperrt`)
    if (!w.trifft) melde(`${licht}: der freigegebene „Weiter" wird von etwas anderem verdeckt`)
    await weiter()
    // Suchen antippen, damit auch die Zeilen mit „Koppeln" dastehen — sonst
    // misst man nur den Knopf, den es ohnehin gibt.
    await ev(`document.getElementById('fach-tat').click()`)
    await warte(700)
    m = await ev(MESS_FN)
    for (const k of m.knoepfe) {
      const zu_klein = k.b < ZIEL_PX || k.h < ZIEL_PX
      zeile(
        `  Bereich: ${k.was}`,
        `${k.b} x ${k.h} px${zu_klein ? '  — ZU KLEIN' : ''}${k.trifft ? '' : '  — WIRD NICHT GETROFFEN'}${k.raus ? '  — AUSSERHALB' : ''}`,
      )
      if (zu_klein) melde(`${licht}: ${k.was} ist ${k.b}x${k.h} px, unter den geforderten ${ZIEL_PX}`)
      if (!k.trifft && !k.gesperrt && !k.gerollt)
        melde(`${licht}: ${k.was} wird von ${k.statt} verdeckt`)
      // AUS DEM BILD GEROLLT — kein Fehler, aber es gehoert GESAGT. Begruendung
      // am Feld `gerollt` in MESS_FN.
      if (!k.trifft && !k.gesperrt && k.gerollt)
        zeile(`  (${k.was})`, `nur durch Rollen erreichbar — die Liste rollt, das Ziel ist nicht verdeckt`)
      if (k.raus) melde(`${licht}: ${k.was} ragt ueber den 800x480-Schirm hinaus`)
    }
    kopfPruefen(`${licht}/Bereich`, m)
    zeile('Flaeche', `${m.bereich.b} x ${m.bereich.h} px, linke Kante x ${m.bereich.l}`)
    // ── WO DER BEREICH ANFAENGT, SAGT DIE SEITE (--eltern-links) ──────────
    //
    // HIER STAND erst `!== 800` (inset: 0), dann die abgeschriebene 88 (Seite
    // neben der Leiste, Betreiber am 06.08. VORMITTAGS) — und dann entschied
    // der Betreiber am 06.08. ABENDS Vollbild („screen fuellend", app.css
    // --eltern-links: 0px, dort die ganze Geschichte). Der Waechter trug
    // weiter die 88 und meldete eine Woche lang eine Lage rot, die genau die
    // bestellte war. Deshalb wird die Soll-Zahl jetzt AUS DER SEITE gelesen:
    // aendert der Betreiber sie wieder, prueft dieser Lauf automatisch die
    // neue Entscheidung — und weiterhin dasselbe: volle Hoehe, rechts am
    // Schirmrand, links genau an der einen vereinbarten Kante.
    const sollBreite = 800 - m.elternLinks
    if (m.bereich.l !== m.elternLinks || m.bereich.b !== sollBreite || m.bereich.h !== 480)
      melde(`${licht}: der Bereich ist ${m.bereich.b}x${m.bereich.h} bei x ${m.bereich.l} statt ${sollBreite}x480 bei x ${m.elternLinks}`)
    zeile('Zeilen', `${m.sichtbareZeilen} von ${m.zeilenGesamt} ganz sichtbar${m.rollt ? ' (die Liste rollt)' : ''}`)

    if (BILD) {
      const s = await send(ws, 'Page.captureScreenshot', { format: 'png' })
      await writeFile(BILD.replace(/(\.png)?$/, `-fach-${licht}.png`), Buffer.from(s.data, 'base64'))
      console.log(`  Bild: ${BILD.replace(/(\.png)?$/, `-fach-${licht}.png`)}`)
    }
  }

  ws.close()
} catch (e) {
  melde(`Messung abgebrochen: ${e.message}`)
} finally {
  // IM `finally`: Ein Werkzeug, das nur auf dem gruenen Weg aufraeumt, laesst
  // die geliehene Vorschau gerade dann verstellt stehen, wenn es einen Fehler
  // gefunden hat — also genau dann, wenn als naechstes jemand hinsieht.
  await brw.schliessen()
  await leihe.zurueckgeben()
}

console.log(fehler ? `\n  ${fehler} FEHLER` : '\n  alles wie gefordert')
if (PRUEFEN && fehler) process.exitCode = 1
