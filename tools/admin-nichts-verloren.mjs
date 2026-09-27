#!/usr/bin/env node
/**
 * IST NACH DEM UMBAU NOCH ALLES DA — UND TUT ES NOCH DASSELBE?
 *
 * ══ WOFUER ═════════════════════════════════════════════════════════════════
 *
 * Am 06.08.2026 ist der Eltern-Bereich von FUENF FLACHEN FAECHERN auf VIER
 * GRUPPEN MIT ELF PUNKTEN umgebaut worden (`ebb16ecc`). Ein Umbau dieser Art
 * verliert Dinge STILL: eine Zeile, die niemand mehr malt, meldet sich nicht.
 * `tools/admin-menue-schau.mjs` misst die NEUE Gliederung — dass es vier
 * Gruppen gibt, dass jeder Punkt auf eine Seite fuehrt, dass kein Knopf
 * angeschnitten ist. Es fragt NICHT, ob die Bedienungen von VORHER noch
 * vorhanden sind und noch dasselbe tun.
 *
 * GENAU DAS FRAGT DIESES WERKZEUG, und zwar Bedienung fuer Bedienung:
 *
 *   WLAN      Netze finden · offenes Netz · gesichertes mit Tastatur ·
 *             Totmannschalter mit Countdown und „Nicht bestätigen!" ·
 *             WPS mit 120-s-Fenster, AUCH BEI LEERER NETZLISTE
 *   Bluetooth suchen · koppeln · verbinden · trennen · Fehlschlag sieht
 *             anders aus als Auskunft
 *   Medien    suchen · Blatt oeffnen · umbenennen · Kategorie · Loeschen
 *             MIT DEM NAMEN in der Frage
 *   Sperre    alle vier Arten · „erst PIN, dann Art" · die Rueckfrage bei
 *             „keine" benennt, was aufgeht
 *   Info      die Zahlen stimmen mit dem ueberein, was der Server sagt
 *   Rueckweg  ein Tipp verlaesst GENAU EINE Ebene — nicht zwei, nicht null
 *
 * ══ WARUM ES NICHT IN admin-menue-schau.mjs GEHOERT ═══════════════════════
 *
 * Die beiden fragen Verschiedenes und altern verschieden. `admin-menue-schau`
 * beschreibt die GLIEDERUNG von heute; aendert sie sich wieder, wird es
 * nachgezogen. Dieses hier beschreibt die BEDIENUNGEN, die es schon vor der
 * Gliederung gab — sie sollen jeden weiteren Umbau ueberleben, und die Datei
 * ist der Satz dazu. Wer eine Aussage hier rot werden laesst, hat etwas
 * WEGGENOMMEN und muss es begruenden, nicht nachziehen.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *
 *     node tools/admin-nichts-verloren.mjs                    # eigene Vorschau
 *     node tools/admin-nichts-verloren.mjs --ziel http://127.0.0.1:8981/neu/
 *     node tools/admin-nichts-verloren.mjs --bilder /tmp/bilder
 *
 * Ohne `--ziel` startet es SEINE EIGENE Vorschau auf einem freien Port. Der
 * Grund steht in tools/leihgabe.mjs: `--port` weglassen heisst, gegen die
 * Vorschau eines fremden Arbeitsbaums zu messen.
 */

import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { eigenerBrowser, freierPort } from './leihgabe.mjs'
import { adminAuf } from './admin-weg.mjs'

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const opt = (n, v = null) => {
  const i = argv.indexOf(`--${n}`)
  return i < 0 ? v : argv[i + 1]
}
const MITGEGEBEN = opt('ziel')
const BILDER = opt('bilder')
const warte = (ms) => new Promise((r) => setTimeout(r, ms))

let fehler = 0
const ja = (b, satz, wie = '') => {
  if (!b) fehler++
  console.log(`${b ? 'ok  ' : 'FEHL'}  ${satz}${wie ? '  — ' + wie : ''}`)
}
const teil = (s) => console.log(`\n── ${s} ${'─'.repeat(Math.max(0, 58 - s.length))}`)

// ── Vorschau: eigene oder mitgegebene ──────────────────────────────────────
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
    if (gestorben !== null) throw new Error(`tools/neu-vorschau.mjs endete sofort (${gestorben}) — Port ${p} war belegt`)
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
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })

  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value
  const stand = async (w) => {
    await fetch(new URL(`/vorschau/${w}`, ZIEL)).catch(() => null)
    await warte(120)
  }
  const laden = async () => {
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warte(2200)
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
    await adminAuf(ev, { warteMs: 1100 })
  }
  const rechnen = async () => {
    const f = await ev(`(document.getElementById('tor-frage')||{}).textContent || ''`)
    const m = String(f).match(/(\d+)\s*×\s*(\d+)/)
    if (!m) return false
    for (const z of String(Number(m[1]) * Number(m[2]))) await ev(`document.querySelector('#tor-feld [data-taste="${z}"]').click()`)
    await ev(`document.querySelector('#tor-feld .tor-weiter').click()`)
    await warte(900)
    return true
  }
  /** Gruppe in der linken Spalte antippen. */
  const gruppe = async (id) => {
    await ev(`document.querySelector('#eltern-faecher [data-fach="${id}"]').click()`)
    await warte(800)
  }
  /**
   * EINE ZEILE ANTIPPEN — ueber ihren NAMEN, wie ein Mensch.
   *
   * Zwei Sorten Zeile, und beide werden getroffen: in einer Unterseite ist der
   * Knopf IN der Zeile (`.zeile-tat`), in der Uebersicht IST die Zeile der
   * Knopf (`.fach-sprung`). Wer nur eine Sorte sucht, misst die andere als
   * „nicht bedienbar" — und der Bericht loege.
   */
  const zeile = async (name, ms = 800) => {
    // WAS NICHT GETROFFEN WURDE, WIRD GESAGT. Ein `zeile()`, das ins Leere
    // greift, sah bis hierher aus wie eine Bedienung, die nichts tut — und
    // die naechste Aussage meldete dann den Fehler an der falschen Stelle.
    const ok = await ev(`(() => {
      for (const z of document.querySelectorAll('#fach-zeilen .fach-zeile')) {
        const n = z.querySelector('.zeile-name')
        if (!n || !n.textContent.includes(${JSON.stringify(name)})) continue
        const k = z.querySelector('.zeile-tat')
        if (k && !k.disabled) { k.click(); return 'tat' }
        if (z.classList.contains('fach-sprung') && !z.disabled) { z.click(); return 'sprung' }
        return 'gesperrt'
      }
      return 'fehlt'
    })()`)
    if (ok === 'fehlt' || ok === 'gesperrt') console.log(`      (die Zeile „${name}" war ${ok})`)
    await warte(ms)
    return ok
  }
  /** Was auf dem Schirm steht — Kopf, Zeilen, Hinweis. */
  const seite = async () =>
    await ev(`(() => {
      const z = [...document.querySelectorAll('#fach-zeilen .fach-zeile')].map((e) => ({
        name: (e.querySelector('.zeile-name') || {}).textContent || '',
        unter: (e.querySelector('.zeile-unter') || {}).textContent || '',
        wort: (e.querySelector('.zeile-tat') || {}).textContent || '',
        // warnt IST EINE KLASSE AN DER ZEILE, gefahr EINE AM KNOPF. Die erste
        // Fassung fragte nur nach gefahr und meldete die Warnung des
        // Totmannschalters als „warnt nicht" — dabei stand „ACHTUNG: … Nicht
        // bestätigen!" gross auf dem Schirm. Beide werden jetzt gelesen.
        // (Keine schraegen Anfuehrungszeichen hier: dieser Block steht in
        //  einem Template-Literal, und ein Gegenstrich-Zeichen beendete es.)
        warnt: e.className.includes('warnt'),
        gefahr: !!e.querySelector('.zeile-tat.gefahr, .zeile-tat.jetzt') || e.className.includes('gefahr'),
      }))
      const h = document.getElementById('fach-hinweis')
      return {
        kopf: (document.getElementById('fach-name') || {}).textContent || '',
        tat: (document.getElementById('fach-tat') || {}).textContent || '',
        unter: (document.getElementById('eltern-unter') || {}).textContent || '',
        leer: (document.querySelector('#fach-zeilen .fach-leer') || {}).textContent || '',
        hinweis: h && !h.hidden ? h.textContent : '',
        falsch: h ? h.classList.contains('falsch') : false,
        zeilen: z,
      }
    })()`)
  /* ══ WORAN MAN DIE UEBERSICHT EINER GRUPPE ERKENNT ══════════════════════
   *
   * HIER STAND `seite().kopf === 'System'`. Die Uebersicht hat seit dem Abend
   * des 06.08.2026 GAR KEINE Ueberschrift mehr — sie stand dreimal auf
   * demselben Schirm (als gewaehlter Knopf in der Spalte, als Unterzeile,
   * und noch einmal als Ueberschrift der Karte), und der Betreiber hat die
   * dritte streichen lassen. `#fach-name` ist dort seither leer, und diese
   * drei Aussagen ueber den RUECKWEG fielen mit einer Aenderung an der
   * GESTALTUNG. Genau derselbe Fehlgriff steht in admin-menue-schau.mjs
   * schon beschrieben: ein Nebenprodukt der Gestaltung als Beweis fuer den
   * Zustand zu nehmen.
   *
   * GEMESSEN WIRD JETZT DIE UNTERZEILE. Sie ist der WEG — „System" auf der
   * Uebersicht, „System · Info" darunter — und damit die einzige Angabe, die
   * es gibt, WEIL sie etwas sagt. Dazu der leere Kopf: zusammen sagen beide
   * „Uebersicht" und nicht „irgendeine Seite dieser Gruppe".
   */
  const aufUebersicht = async (wort) => {
    const s = await seite()
    return s.unter === wort && s.kopf === ''
  }
  /** Fuer die Fehlermeldung: wo wir wirklich stehen. */
  const wo = async () => {
    const s = await seite()
    return `Unterzeile „${s.unter}", Kopf „${s.kopf}"`
  }
  /** Der EINE Rueckweg oben links. */
  const zurueck = async (ms = 700) => {
    await ev(`document.getElementById('zurueck').click()`)
    await warte(ms)
  }
  /** Wo stehen wir? Gruppe, Unterseite, Blatt, Rueckfrage, Tor. */
  const lage = async () =>
    await ev(`(() => {
      const e = document.getElementById('eltern')
      return {
        offen: !!e && !e.hidden,
        tor: !!document.getElementById('eltern-tor') && !document.getElementById('eltern-tor').hidden,
      }
    })()`)

  // ════════════════════════════════════════════════════════════════════════
  teil('1  WLAN — Netze, Tastatur, Totmannschalter, WPS')
  // ════════════════════════════════════════════════════════════════════════
  await stand('sperre-rechnen')
  await stand('wlan-normal')
  await laden()
  await hinein()
  await rechnen()
  await gruppe('verbindung')
  let s = await seite()
  ja(s.zeilen.some((z) => z.name.includes('WLAN')), 'Uebersicht „Verbindung" nennt WLAN')
  ja(s.zeilen.some((z) => z.name.includes('Bluetooth')), 'Uebersicht „Verbindung" nennt Bluetooth')
  await zeile('WLAN', 1400)
  s = await seite()
  ja(s.kopf === 'WLAN', 'die WLAN-Seite traegt ihren Namen', s.kopf)
  ja(s.tat === 'Suchen' || s.tat === 'Sucht …', 'der Kopfknopf sucht Netze', s.tat)
  const netze = s.zeilen.filter((z) => !z.name.includes('WPS'))
  ja(netze.length >= 3, `Netze werden gefunden und gelistet (${netze.length})`)
  ja(
    s.zeilen.some((z) => z.name.includes('WPS') && /Ohne Passwort/.test(z.unter)),
    'die WPS-Zeile steht da',
  )
  const offen = s.zeilen.find((z) => /offen/.test(z.unter) && z.wort === 'Verbinden')
  ja(!!offen, 'ein OFFENES Netz steht in der Liste und traegt „Verbinden"', offen ? offen.name : '—')
  const ges = s.zeilen.find((z) => /wpa|WPA|gesichert/.test(z.unter) && z.wort === 'Verbinden')
  ja(!!ges, 'ein GESICHERTES Netz steht in der Liste', ges ? ges.name : '—')
  await bild('1-wlan')

  // ── gesichertes Netz: die EINE Tastatur geht auf ──────────────────────
  await zeile(ges.name, 900)
  const tast = await ev(`(() => {
    const t = document.getElementById('tastatur')
    if (!t || t.hidden) return null
    return {
      frage: (document.getElementById('tast-frage')||{}).textContent||'',
      geheim: !document.getElementById('tast-auge').hidden,
      tasten: [...document.querySelectorAll('#tast-feld [data-taste]')].filter((k) => !k.hidden).length,
    }
  })()`)
  ja(!!tast, 'ein gesichertes Netz oeffnet die Tastatur')
  ja(!!tast && /Passwort/i.test(tast.frage), 'sie fragt nach dem Passwort', tast ? tast.frage : '—')
  ja(!!tast && tast.geheim, 'das Passwort ist verdeckt und hat ein Auge')
  // 31 UND NICHT 32: das Feld hat 8x4 = 32 Plaetze, die Ebene `klein` belegt
  // 26 Buchstaben + Umschalt + Ebene + Leer + Loeschen + Fertig = 31. Der
  // 32. Platz ist `hidden` und kein toter Knopf (`tastenMalen`).
  ja(!!tast && tast.tasten === 31, `die EINE Tastatur, 8x4 (${tast ? tast.tasten : 0} belegte Plaetze von 32)`)
  await bild('1-wlan-tastatur')

  // ── Passwort eingeben, verbinden: der Totmannschalter ─────────────────
  const acht = await ev(`(() => {
    for (const c of 'geheimes') document.querySelector('#tast-feld [data-taste="'+c+'"]')?.click()
    const f = document.querySelector('#tast-feld [data-taste="fertig"]')
    if (f.disabled) return 'fertig gesperrt'
    f.click(); return 'ab' })()`)
  await warte(1500)
  // EIN WLAN-PASSWORT UNTER 8 ZEICHEN LAESST „Fertig" GESPERRT — dieselbe
  // Regel wie am Server (`pruefePsk`). Dass sie gilt, ist eine eigene Aussage.
  ja(acht === 'ab', 'ein 8 Zeichen langes Passwort schaltet „Fertig" frei', String(acht))
  s = await seite()
  const tot = s.zeilen.find((z) => /Verbunden mit/.test(z.name))
  ja(!!tot, 'nach dem Verbinden steht die Rueckfrage des Totmannschalters ganz oben', tot ? tot.name : '—')
  ja(!!tot && /\d+\s*s\b/.test(tot.unter), 'sie zaehlt herunter (Sekunden im Satz)', tot ? tot.unter.slice(-60) : '—')
  ja(!!tot && tot.wort === 'Bestätigen', 'und traegt „Bestätigen"', tot ? tot.wort : '—')
  await bild('1-wlan-totmann')
  const rest1 = Number(((tot || { unter: '' }).unter.match(/(\d+)\s*s\b/) || [0, 0])[1])
  await warte(2600)
  s = await seite()
  const tot2 = s.zeilen.find((z) => /Verbunden mit/.test(z.name))
  const rest2 = Number(((tot2 || { unter: '' }).unter.match(/(\d+)\s*s\b/) || [0, 999])[1])
  ja(rest2 < rest1, `der Countdown laeuft wirklich (${rest1} s → ${rest2} s)`)

  // ── „Nicht bestätigen!" — der Fall, in dem die Box NICHT dranhaengt ───
  //
  // ERST DEN LAUFENDEN WECHSEL ABRAEUMEN. Der Wecker des Servers laeuft 150 s
  // und ueberlebt jedes Neuladen; solange er scharf ist, sind ALLE
  // Netz-Knoepfe gesperrt (`aus: … || !!this.wlanWechsel`) — zu Recht, aber
  // dann faengt der naechste Fall gar nicht erst an und die Messung liest die
  // Zeile des VORIGEN Wechsels.
  await fetch(new URL('/api/netzwerk/bestaetigen', ZIEL), { method: 'POST' }).catch(() => null)
  await stand('wlan-kommtnicht')
  await laden()
  await hinein()
  await rechnen()
  await gruppe('verbindung')
  await zeile('WLAN', 1400)
  s = await seite()
  const ges2 = s.zeilen.find((z) => z.wort === 'Verbinden' && /offen/.test(z.unter))
  ja(!!ges2, 'ein offenes Netz ist bedienbar (kein Passwort, kein Umweg)', ges2 ? ges2.name : '—')
  const g2 = await zeile(ges2.name, 1800)
  ja(g2 === 'tat', 'und ein Tipp darauf verbindet ohne Tastatur', String(g2))
  s = await seite()
  const gleich = s.zeilen.find((z) => /Verbunden mit/.test(z.name))
  // ── ZUERST SAGT SIE „ICH WEISS ES NOCH NICHT", UND DAS IST RICHTIG SO ──
  // `wlanVerbinden` setzt `netzStand` mit Absicht auf null: die alte Auskunft
  // nennt noch das vorige Netz, und daraus „die Box haengt NICHT an diesem
  // Netz" zu machen, waere eine Warnung ueber eine Anmeldung, die gerade erst
  // laeuft. Der Zehnsekundentakt fuellt sie auf — deshalb wird hier gewartet
  // und nicht sofort gemessen.
  ja(
    !!gleich && /nicht zu erfahren/.test(gleich.unter),
    'in den ersten Sekunden sagt sie „noch nicht zu erfahren" statt zu warnen',
    gleich ? gleich.unter.slice(0, 60) : '—',
  )
  await warte(12000)
  s = await seite()
  const warn = s.zeilen.find((z) => /Verbunden mit/.test(z.name))
  ja(!!warn && /Nicht bestätigen/.test(warn.unter), 'haengt die Box NICHT am neuen Netz, steht „Nicht bestätigen!" da', warn ? warn.unter.slice(0, 90) : '—')
  ja(!!warn && warn.warnt, 'und die Zeile warnt sichtbar (`.warnt` an der Zeile)')
  await bild('1-wlan-nicht-bestaetigen')

  // ── DEN SERVER-WECHSEL ABRAEUMEN ─────────────────────────────────────
  //
  // GEMESSEN UND NICHT VERMUTET: `POST /api/netzwerk/verbinden` stellt am
  // Server einen Wecker auf 150 s. Der ueberlebt jedes Neuladen der Seite —
  // die naechste Seite liest ihn aus `/api/netzwerk/watchdog` und sperrt
  // daraufhin die WPS-Zeile (`aus: … || !!this.wlanWechsel`), voellig zu
  // Recht: waehrend ein Wechsel auf Bestaetigung wartet, darf kein zweiter
  // anfangen. Ohne dieses Abraeumen misst der naechste Abschnitt also eine
  // Sperre, die er selbst gestellt hat.
  await fetch(new URL('/api/netzwerk/bestaetigen', ZIEL), { method: 'POST' }).catch(() => null)

  // ── WPS, und zwar AUCH BEI LEERER LISTE ──────────────────────────────
  await stand('wlan-weg')
  await laden()
  await hinein()
  await rechnen()
  await gruppe('verbindung')
  await zeile('WLAN', 1600)
  s = await seite()
  ja(s.leer !== '', 'bei ausgefallenem Suchlauf steht ein Satz statt einer Liste', s.leer.slice(0, 50))
  ja(
    s.zeilen.some((z) => z.name.includes('WPS')),
    'DIE WPS-ZEILE STEHT AUCH BEI LEERER NETZLISTE DA (sie lag schon einmal hinter dem `return`)',
  )
  await bild('1-wlan-leer')
  const wps = await zeile('WPS', 1400)
  ja(wps === 'tat', 'WPS laesst sich starten', String(wps))
  s = await seite()
  const wz = s.zeilen.find((z) => z.name.includes('WPS'))
  ja(!!wz && /\d+\s*s/.test(wz.unter), 'und das 120-s-Fenster steht als Zahl da', wz ? wz.unter : '—')
  ja(!!wz && Number((wz.unter.match(/(\d+)\s*s/) || [0, 0])[1]) <= 120, 'die Zahl ist das Fenster des Servers (120 s) und nicht groesser', wz ? wz.unter : '—')

  // ════════════════════════════════════════════════════════════════════════
  teil('2  Bluetooth — suchen, koppeln, verbinden, trennen')
  // ════════════════════════════════════════════════════════════════════════
  await stand('bt-zurueck')
  await laden()
  await hinein()
  await rechnen()
  await gruppe('verbindung')
  await zeile('Bluetooth', 1400)
  s = await seite()
  ja(s.kopf === 'Bluetooth', 'die Bluetooth-Seite traegt ihren Namen', s.kopf)
  ja(s.tat === 'Suchen' || s.tat === 'Sucht …', 'der Kopfknopf sucht', s.tat)
  const koppeln = s.zeilen.find((z) => z.wort === 'Koppeln')
  const verbinden = s.zeilen.find((z) => z.wort === 'Verbinden')
  ja(!!koppeln || !!verbinden, 'es stehen Geraete da', s.zeilen.map((z) => z.name + '/' + z.wort).join(' · '))
  await bild('2-bluetooth')
  // suchen
  await ev(`document.getElementById('fach-tat').click()`)
  await warte(1800)
  s = await seite()
  ja(s.zeilen.length > 0, `nach dem Suchen stehen Geraete da (${s.zeilen.length})`)
  // verbinden
  if (verbinden) {
    const r = await zeile(verbinden.name, 1600)
    ja(r === 'tat', `„${verbinden.name}" laesst sich verbinden`)
    s = await seite()
    const jetzt = s.zeilen.find((z) => z.name === verbinden.name)
    ja(!!jetzt && jetzt.wort === 'Trennen', 'und traegt danach „Trennen"', jetzt ? jetzt.wort : '—')
    // trennen
    await zeile(verbinden.name, 1600)
    s = await seite()
    const wieder = s.zeilen.find((z) => z.name === verbinden.name)
    ja(!!wieder && wieder.wort === 'Verbinden', 'und laesst sich wieder trennen', wieder ? wieder.wort : '—')
  }
  // koppeln
  // ── ERST DIE KOPPLUNGEN LOESEN ────────────────────────────────────────
  // Ein „koppeln" ist in der Attrappe endgueltig (BT_ANGENOMMEN); ohne dieses
  // Zuruecksetzen findet der zweite Lauf kein ungekoppeltes Geraet mehr und
  // meldet einen Mangel der Oberflaeche, den die Messung selbst gemacht hat.
  await stand('bt-zurueck')
  await laden()
  await hinein()
  await rechnen()
  await gruppe('verbindung')
  await zeile('Bluetooth', 1400)
  // ERST SUCHEN. Ein Geraet, das noch nie gekoppelt war, kennt die Box gar
  // nicht — es kommt erst durch den Suchlauf in die Liste. Genau das ist die
  // Reihenfolge, die ein Mensch geht, und die Attrappe bildet sie nach
  // (`BT_GEFUNDEN` in tools/neu-vorschau.mjs).
  await ev(`document.getElementById('fach-tat').click()`)
  await warte(1800)
  s = await seite()
  const k2 = s.zeilen.find((z) => z.wort === 'Koppeln')
  if (k2) {
    await zeile(k2.name, 1800)
    s = await seite()
    const nach = s.zeilen.find((z) => z.name === k2.name)
    ja(!!nach && nach.wort !== 'Koppeln', `„${k2.name}" laesst sich koppeln`, nach ? nach.wort : '—')
  } else ja(false, 'ein noch nicht gekoppeltes Geraet steht in der Liste')
  // Fehlschlag sieht anders aus als Auskunft
  await stand('bt-tat-kaputt')
  await laden()
  await hinein()
  await rechnen()
  await gruppe('verbindung')
  await zeile('Bluetooth', 1400)
  s = await seite()
  const irgend = s.zeilen.find((z) => z.wort === 'Verbinden' || z.wort === 'Koppeln')
  await zeile(irgend.name, 1800)
  s = await seite()
  ja(s.hinweis !== '', 'ein Fehlschlag beim Koppeln/Verbinden wird gemeldet', s.hinweis)
  ja(s.falsch, 'UND ER SIEHT ANDERS AUS ALS EINE AUSKUNFT (rot, `.falsch`)')
  await bild('2-bluetooth-fehl')
  await stand('bt-suche-kaputt')
  await laden()
  await hinein()
  await rechnen()
  await gruppe('verbindung')
  await zeile('Bluetooth', 1400)
  await ev(`document.getElementById('fach-tat').click()`)
  await warte(1800)
  s = await seite()
  ja(s.hinweis !== '' && s.falsch, 'eine misslungene Suche meldet sich ebenfalls rot', s.hinweis)
  await stand('bt-zurueck')

  // ════════════════════════════════════════════════════════════════════════
  teil('3  Medien — suchen, Blatt, umbenennen, Kategorie, Loeschen')
  // ════════════════════════════════════════════════════════════════════════
  await stand('medien-normal')
  await laden()
  await hinein()
  await rechnen()
  await gruppe('medien')
  s = await seite()
  ja(s.zeilen.some((z) => z.name.includes('Suchen und verwalten')), 'Uebersicht „Medien" nennt „Suchen und verwalten"')
  ja(s.zeilen.some((z) => z.name.includes('Dienste')), 'Uebersicht „Medien" nennt „Dienste"')
  await zeile('Suchen und verwalten', 1600)
  s = await seite()
  ja(s.kopf === 'Suchen und verwalten', 'die Seite traegt den Namen ihres Punktes und nicht den der Gruppe', s.kopf)
  ja(s.zeilen.length > 0, `Eintraege stehen da (${s.zeilen.length})`)
  await bild('3-medien')
  // suchen
  await ev(`document.getElementById('fach-tat').click()`)
  await warte(700)
  const suchTast = await ev(`!document.getElementById('tastatur').hidden`)
  ja(suchTast, 'der Kopfknopf „Suchen" oeffnet die Tastatur')
  const vorher = (await seite()).zeilen.length
  await ev(`(() => {
    for (const c of 'kir') document.querySelector('#tast-feld [data-taste="'+c+'"]')?.click()
    document.querySelector('#tast-feld [data-taste="fertig"]').click(); return true })()`)
  await warte(1600)
  s = await seite()
  // DIE ERSTE ZEILE IST DIE SUCHE SELBST und kein Treffer — sie sagt, wonach
  // gesucht wurde, und ihr Knopf nimmt die Suche zurueck. Wer sie mitzaehlt,
  // misst einen Treffer zu viel; wer sie antippt, loescht die Suche und
  // wundert sich, dass „das Blatt nicht aufgeht". Beides ist hier passiert.
  const suchzeile = s.zeilen.find((z) => /^Suche:/.test(z.name))
  ja(!!suchzeile, 'die Suche sagt in einer eigenen Zeile, wonach sie gesucht hat', suchzeile ? suchzeile.name : '—')
  ja(!!suchzeile && suchzeile.wort !== '', 'und laesst sich mit einem Knopf zuruecknehmen', suchzeile ? suchzeile.wort : '—')
  const treffer = s.zeilen.filter((z) => !/^Suche:/.test(z.name))
  ja(treffer.length > 0, `die Suche findet etwas (${treffer.length} von ${vorher})`)
  ja(treffer.length < vorher, 'und sie GRENZT WIRKLICH EIN — sie zeigt nicht einfach alles weiter')
  ja(treffer.every((z) => /kir/i.test(z.name)), 'jeder Treffer traegt den gesuchten Wortteil', treffer.map((z) => z.name).join(' · '))
  // Blatt oeffnen — ueber den PLATZ des ersten TREFFERS.
  const eintrag = treffer[0]
  const auf = await ev(`(() => {
    for (const z of document.querySelectorAll('#fach-zeilen .fach-zeile')) {
      if (/^Suche:/.test(z.querySelector('.zeile-name').textContent)) continue
      const k = z.querySelector('.zeile-tat'); if (!k || k.disabled) return 'gesperrt'
      k.click(); return 'auf'
    }
    return 'fehlt' })()`)
  ja(auf === 'auf', 'die erste Trefferzeile laesst sich oeffnen', String(auf))
  await warte(1300)
  s = await seite()
  ja(s.kopf === eintrag.name, 'ein Tipp oeffnet das Blatt DIESES Eintrags — der Kopf traegt seinen Namen', s.kopf)
  ja(s.tat === 'Abspielen', 'und der Kopfknopf spielt ab', s.tat)
  ja(s.zeilen.some((z) => z.name === 'Name'), 'das Blatt kann UMBENENNEN')
  ja(s.zeilen.some((z) => z.name === 'Kategorie'), 'das Blatt kann die KATEGORIE aendern')
  ja(s.zeilen.some((z) => z.name === 'Löschen'), 'das Blatt kann LOESCHEN')
  await bild('3-medien-blatt')
  const titel = s.kopf
  // umbenennen
  await zeile('Name', 800)
  const umb = await ev(`(() => { const t = document.getElementById('tastatur')
    return t && !t.hidden ? (document.getElementById('tast-frage')||{}).textContent + ' | ' + (document.getElementById('tast-anzeige')||{}).textContent : null })()`)
  ja(!!umb && /Name/i.test(umb), 'Umbenennen oeffnet die Tastatur mit dem alten Namen darin', String(umb))
  await ev(`document.getElementById('tast-weg').click()`)
  await warte(500)
  // Kategorie
  s = await seite()
  const kat = s.zeilen.find((z) => z.name === 'Kategorie')
  ja(!!kat && kat.wort !== '', 'die Kategorie schaltet mit EINEM Knopf weiter', kat ? kat.unter + ' → ' + kat.wort : '—')
  // Loeschen: die Frage NENNT DEN NAMEN
  await zeile('Löschen', 900)
  s = await seite()
  const frage = s.zeilen.find((z) => /löschen\?/i.test(z.name))
  ja(!!frage, 'vor dem Loeschen wird gefragt')
  ja(!!frage && frage.name.includes(titel.slice(0, 8)), 'UND DIE FRAGE NENNT DEN NAMEN', frage ? frage.name : '—')
  ja(s.zeilen[0] && /Abbrechen/.test(s.zeilen[0].wort), '„Abbrechen" steht in der ERSTEN Zeile', s.zeilen[0] ? s.zeilen[0].wort : '—')
  ja(s.zeilen[1] && /Ja, löschen/.test(s.zeilen[1].name), '„Ja, löschen" in der zweiten — nicht dort, wo eben „Löschen" stand')
  await bild('3-medien-loeschen')

  // ════════════════════════════════════════════════════════════════════════
  teil('4  Sperrart — alle vier, „erst PIN dann Art", die Rueckfrage bei „keine"')
  // ════════════════════════════════════════════════════════════════════════
  await stand('sperre-rechnen')
  await laden()
  await hinein()
  await rechnen()
  await gruppe('system')
  s = await seite()
  ja(s.zeilen.some((z) => z.name.includes('Sperre')), 'Uebersicht „System" nennt die Sperre')
  await zeile('Sperre', 1200)
  s = await seite()
  ja(s.kopf === 'Sperre', 'die Sperr-Seite traegt ihren Namen', s.kopf)
  const arten = ['Keine Sperre', 'Rechenaufgabe', 'PIN', 'Geste']
  for (const a of arten) ja(s.zeilen.some((z) => z.name.includes(a)), `die Art „${a}" steht zur Wahl`)
  await bild('4-sperre')
  // ── PIN: erst die PIN, dann die Art ──────────────────────────────────
  await zeile('PIN', 1000)
  const pinAuf = await ev(`(() => { const p = document.getElementById('eltern-pin'); return !!p && !p.hidden })()`)
  ja(pinAuf, 'ein Tipp auf „PIN" verlangt ZUERST eine PIN — die Art wird noch nicht gesetzt')
  await bild('4-sperre-pin')
  // PIN eingeben und bestaetigen
  await ev(`(() => { for (const z of '2468') document.querySelector('#pin-feld [data-taste="'+z+'"]')?.click(); return true })()`)
  await warte(300)
  await ev(`document.querySelector('#pin-feld [data-taste="weiter"]').click()`)
  await warte(600)
  const zweiterSchritt = await ev(`(document.getElementById('pin-ueber')||{}).textContent + ' — ' + (document.getElementById('pin-frage')||{}).textContent`)
  ja(/noch einmal|wiederhol/i.test(String(zweiterSchritt)), 'die PIN wird ein zweites Mal verlangt (Wiederholung)', String(zweiterSchritt))
  await ev(`(() => { for (const z of '2468') document.querySelector('#pin-feld [data-taste="'+z+'"]')?.click(); return true })()`)
  await ev(`document.querySelector('#pin-feld [data-taste="weiter"]').click()`)
  await warte(1600)
  s = await seite()
  ja(s.kopf === 'Sperre', 'nach dem Setzen steht wieder die Wahl da', s.kopf)
  const pinZeile = s.zeilen.find((z) => z.name.includes('PIN'))
  ja(!!pinZeile && /ändern/i.test(pinZeile.wort), 'und „PIN" ist jetzt die gewaehlte Art — ihr Knopf heisst „PIN ändern"', pinZeile ? '„' + pinZeile.wort + '"' : '—')
  ja(s.hinweis !== '' && !s.falsch, 'das Setzen wird bestaetigt, und zwar als Auskunft und nicht als Fehler', s.hinweis)
  // ── „Keine Sperre" fragt nach und BENENNT, was aufgeht ───────────────
  await zeile('Keine Sperre', 1000)
  s = await seite()
  ja(/abschalten\?/i.test(s.kopf), 'ein Tipp auf „Keine Sperre" fragt nach', s.kopf)
  const was = s.zeilen.map((z) => z.unter).join(' ')
  ja(/WLAN|Bluetooth|Einstellung|Ausschalten|Netz/i.test(was), 'UND DIE FRAGE BENENNT, WAS DANN OFFENSTEHT', was.slice(0, 120))
  ja(s.zeilen[0] && /Abbrechen/.test(s.zeilen[0].wort), '„Abbrechen" steht zuerst', s.zeilen[0] ? s.zeilen[0].wort : '—')
  await bild('4-sperre-aus')

  // ════════════════════════════════════════════════════════════════════════
  teil('5  Info — die Zahlen stimmen mit dem ueberein, was der Server sagt')
  // ════════════════════════════════════════════════════════════════════════
  // DIE SPERRE ZURUECKSTELLEN. Abschnitt 4 hat eine PIN gesetzt — das ist
  // sein Sinn. Wer danach `rechnen()` ruft, findet keine Rechenaufgabe, das
  // Tor bleibt zu, und JEDE Aussage dahinter ist rot aus dem falschen Grund.
  await stand('sperre-rechnen')
  // UND DAS NETZ WIEDER ANSCHLIESSEN. Abschnitt 1 hat einen Wechsel geprobt
  // und die Box damit von ihrem Netz genommen; ohne dieses Zuruecksetzen
  // vergliche die Aussage „die Adresse stimmt" eine leere Anzeige mit einer
  // leeren Antwort und ginge gruen durch, ohne etwas gemessen zu haben.
  await stand('wlan-zurueck')
  await stand('hat-akku')
  await laden()
  await hinein()
  await rechnen()
  await gruppe('system')
  await zeile('Info', 1600)
  s = await seite()
  ja(s.kopf === 'Info', 'die Info-Seite traegt ihren Namen', s.kopf)
  const gitter = await ev(`(() => {
    const g = document.querySelector('#fach-zeilen .info-gitter')
    if (!g) return null
    return [...g.children].map((e) => e.textContent.replace(/\\s+/g, ' ').trim())
  })()`)
  ja(Array.isArray(gitter) && gitter.length >= 5, `das Info-Gitter steht da (${gitter ? gitter.length : 0} Felder)`)
  await bild('5-info')
  const sys = await (await fetch(new URL('/api/system', ZIEL))).json()
  const netz = await (await fetch(new URL('/api/netzwerk', ZIEL))).json()
  const dienste = await (await fetch(new URL('/api/dienste', ZIEL))).json()
  const hat = await (await fetch(new URL('/api/mupihat', ZIEL))).json().catch(() => null)
  const alles = (gitter || []).join(' | ')
  ja(alles.includes(String(Math.round(Number(sys.temperatur)))), `die Temperatur stimmt (${sys.temperatur} °C)`, alles.slice(0, 70))
  // DIE ADRESSE LIEGT IN `schnittstellen[].adressen[].adresse` — verschachtelt,
  // und ein `.map(x => x.adresse)` daneben lieferte `undefined`, was die
  // Aussage in ein „kein Wert, also stimmt es" fallen liess.
  const ip = (netz.schnittstellen || [])
    .flatMap((x) => x.adressen || [])
    .map((a) => a.adresse)
    .find(Boolean) || ''
  ja(ip !== '', 'die Box meldet ueberhaupt eine Adresse — sonst misst das Folgende nichts', ip)
  ja(ip !== '' && alles.includes(ip), `die Adresse im Gitter ist die des Servers (${ip})`)
  const kaputt = (dienste.dienste || dienste || []).filter((d) => d && d.zustand === 'failed').length
  ja(
    kaputt === 0 ? /keine|kein/i.test(alles) : new RegExp(String(kaputt)).test(alles),
    `die Dienste stimmen (${kaputt} mit Zustand failed)`,
    (alles.match(/[^|]*[Gg]estört[^|]*|[^|]*laufen[^|]*/) || ['—'])[0].trim(),
  )
  // DER AKKU HEISST AM SERVER `Bat_SOC_fein` UND NICHT `akku.ladung`. Die
  // erste Fassung dieser Aussage suchte den falschen Namen, fand nichts und
  // meldete „kein MuPiHAT gemeldet — nichts zu pruefen". Sie war gruen und
  // hat nie etwas angesehen: der MuPiHAT war da, die Zahl stand am Schirm.
  const proz = hat && Number(hat.BatteryConnected) ? Math.round(Number(hat.Bat_SOC_fein)) : -1
  if (proz >= 0) ja(alles.includes(String(proz)), `der Akku stimmt (${proz} %)`)
  else ja(false, 'der MuPiHAT meldet einen Akku — sonst misst diese Aussage nichts', JSON.stringify(hat))
  if (proz >= 0) {
    const akkuFeld = (gitter || []).find((t) => /^Akku/i.test(t))
    ja(!!akkuFeld && akkuFeld.includes(String(proz)), 'und zwar im Feld „Akku" und nicht irgendwo im Gitter', String(akkuFeld))
  }
  // NUR `failed` gilt als gestoert
  const akt = (dienste.dienste || dienste || []).filter((d) => d && d.zustand === 'activating').length
  if (akt > 0) ja(!/gestört/i.test(alles) || kaputt > 0, `ein Dienst im Zustand „activating" gilt NICHT als gestoert (${akt})`)

  // ════════════════════════════════════════════════════════════════════════
  teil('6  Der EINE Rueckweg — ein Tipp verlaesst GENAU EINE Ebene')
  // ════════════════════════════════════════════════════════════════════════
  await stand('sperre-rechnen')
  await laden()
  await hinein()
  await rechnen()
  // Uebersicht -> Unterseite -> zurueck -> Uebersicht -> zurueck -> Bereich zu
  await gruppe('system')
  await zeile('Info', 1400)
  ja((await seite()).kopf === 'Info', 'zwei Tipps fuehren auf eine Unterseite')
  await zurueck()
  ja(await aufUebersicht('System'), 'ein Rueckweg fuehrt auf die Uebersicht — nicht weiter', await wo())
  ja((await lage()).offen, 'und der Bereich ist noch offen')
  await zurueck()
  ja(!(await lage()).offen, 'erst der naechste Rueckweg schliesst den Bereich')

  // ── Rueckfrage -> Unterseite (Sperre) ────────────────────────────────
  //
  // NEU AUFSCHLIESSEN UND NICHT AUF DIE FREIGABE HOFFEN. Sie gilt zwei
  // Minuten; ein Messlauf, der laenger dauert, stuende sonst mitten in der
  // Messung wieder vor dem Tor — und jede Aussage danach waere gruen oder
  // rot aus dem falschen Grund.
  await hinein()
  await rechnen()
  await warte(400)
  await gruppe('system')
  await zeile('Sperre', 1200)
  await zeile('Keine Sperre', 1000)
  ja(/abschalten\?/i.test((await seite()).kopf), 'die Rueckfrage der Sperre steht da')
  await zurueck()
  ja((await seite()).kopf === 'Sperre', 'ein Rueckweg raeumt NUR die Rueckfrage ab', (await seite()).kopf)
  await zurueck()
  ja(await aufUebersicht('System'), 'der naechste NUR die Unterseite', await wo())

  // ── Rueckfrage -> Unterseite (Strom) ─────────────────────────────────
  await zeile('Neu laden und neu starten', 1200)
  s = await seite()
  ja(s.kopf === 'Neu laden und neu starten', 'die Strom-Seite steht da', s.kopf)
  ja(s.zeilen.some((z) => z.name === 'Oberfläche neu laden'), 'sie kann die Oberflaeche neu laden')
  ja(s.zeilen.some((z) => z.name === 'Box neu starten'), 'sie kann neu starten')
  ja(s.zeilen.some((z) => z.name === 'Box ausschalten'), 'sie kann ausschalten')
  await bild('6-strom')
  await zeile('Box ausschalten', 1000)
  s = await seite()
  ja(/ausschalten\?/i.test(s.kopf), 'Ausschalten fragt nach', s.kopf)
  ja(/läuft|angehalten|nichts/i.test(s.zeilen.map((z) => z.unter).join(' ')), 'und die Frage sagt, was gerade passiert', s.zeilen[0] ? s.zeilen[0].unter.slice(0, 80) : '—')
  await zurueck()
  ja((await seite()).kopf === 'Neu laden und neu starten', 'ein Rueckweg raeumt NUR die Rueckfrage ab', (await seite()).kopf)

  // ── Medien-Blatt und Loeschfrage: DIE ZWEI EBENEN, DIE DARUNTER LIEGEN ──
  //
  // DIESE VIER AUSSAGEN SIND DER GRUND FUER DAS WERKZEUG. Die Medien haben
  // drei Ebenen unter der Uebersicht (Liste, Blatt, Loeschfrage), und die
  // Regel „ein Tipp verlaesst genau EINE Ebene" gilt fuer sie genauso wie fuer
  // die Sperre und den Strom.
  await zurueck()
  await gruppe('medien')
  await zeile('Suchen und verwalten', 1600)
  s = await seite()
  const e0 = s.zeilen[0]
  await zeile(e0.name, 1200)
  ja((await seite()).tat === 'Abspielen', 'das Medien-Blatt steht da')
  await zeile('Löschen', 900)
  ja(/löschen\?/i.test((await seite()).zeilen[0].name) || (await seite()).zeilen.some((z) => /löschen\?/i.test(z.name)), 'die Loeschfrage steht da')
  await zurueck()
  s = await seite()
  ja(s.tat === 'Abspielen', 'ein Rueckweg aus der LOESCHFRAGE fuehrt auf das Blatt zurueck — nicht zwei Ebenen auf einmal', 'Kopf: ' + s.kopf + ', Knopf: „' + s.tat + '"')
  await zurueck()
  s = await seite()
  ja(s.kopf === 'Suchen und verwalten', 'der naechste fuehrt auf die Liste', s.kopf)
  await zurueck()
  ja(await aufUebersicht('Medien'), 'und der naechste auf die Uebersicht', await wo())

  // ════════════════════════════════════════════════════════════════════════
  teil('7  Nichts davon ohne das Tor')
  // ════════════════════════════════════════════════════════════════════════
  await stand('sperre-rechnen')
  await laden()
  await hinein()
  const vorTor = await ev(`(() => {
    const t = document.getElementById('eltern-tor')
    return {
      tor: !!t && !t.hidden,
      faecher: document.querySelectorAll('#eltern-faecher [data-fach]').length,
      zeilen: document.querySelectorAll('#fach-zeilen .fach-zeile').length,
    }
  })()`)
  ja(vorTor.tor, 'vor dem geloesten Tor steht das Tor')
  ja(vorTor.faecher === 0, `und KEINE Gruppe im Baum (${vorTor.faecher})`)
  ja(vorTor.zeilen === 0, `und KEINE Zeile im Baum (${vorTor.zeilen})`)
  await bild('7-tor')

  console.log(`\n${fehler ? `${fehler} FEHLER` : 'alles da, alles tut noch dasselbe'}`)
} finally {
  try {
    ws?.close()
  } catch {
    /* egal */
  }
  await browser.schliessen()
}
process.exit(fehler ? 1 : 0)
