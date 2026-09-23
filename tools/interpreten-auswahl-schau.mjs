/**
 * WEN ZEIGT DIE RUNDE INTERPRETEN-REIHE IN WELCHEM ZUSTAND?
 *
 * WOFUER: Der Wunsch lautet „in hoerbuechern nur die interpreten von
 * hoerbuechern nicht die gesamte liste wie in der alles uebersicht" — also
 * dieselbe Regel, die „Weiterhoeren" seit dem 02.08.2026 befolgt
 * (llmwiki [weiterhoeren-folgt-der-auswahl]). NUR: eine Weiterhoeren-Zeile
 * gehoert zu EINEM Werk, ein Interpret zu MEHREREN. Damit gibt es eine Frage,
 * die es dort nicht gab — gilt er als „dabei", wenn EINES seiner Werke in der
 * Auswahl steht, oder erst wenn alle? Am Quelltext ist das nicht abzulesen,
 * und an einer Attrappe, in der jeder Interpret in genau einer Kategorie
 * liegt, ist es NICHT MESSBAR: dort sehen „eines genuegt" und „alle muessen"
 * gleich aus. Deshalb wird hier getippt und abgelesen.
 *
 * WAS ES AENDERT: nichts. Es startet einen eigenen Browser gegen die VORSCHAU
 * (tools/neu-vorschau.mjs) und liest das DOM. Weder die Box noch Dateien
 * werden angefasst. Die Schalter der Vorschau (`frei-an`, `kaputt`) werden am
 * Ende zurueckgestellt — sonst faende der naechste Messlauf eine Vorschau
 * vor, die jemand anders eingestellt hat.
 *
 * AUFRUF
 *     node tools/interpreten-auswahl-schau.mjs            # Tabelle je Zustand
 *     node tools/interpreten-auswahl-schau.mjs --pruefen  # Ende 1 bei Abweichung
 *
 * DIE ERWARTUNG WIRD NICHT AUS app.js ABGELESEN, sondern aus den Antworten
 * der Attrappe zweitgerechnet: `/api/werke` sagt, welches Werk zu welchem
 * Interpreten und in welche Kategorie gehoert, `/api/interpreten` sagt,
 * welche runden Kacheln es ueberhaupt gibt. Wer die Erwartung aus der
 * Oberflaeche nimmt, prueft seine eigene Vermutung.
 *
 * DIE FALLE, die diese Messung ueberhaupt erst moeglich gemacht hat: Bis zum
 * 03.08.2026 waren ALLE vier erkannten Interpreten der Vorschau (WDR,
 * Kiddinx, Europa, Hörspiel) reine `audiobook`-Interpreten. Unter „Hörbuch"
 * standen damit alle, unter „Musik" keiner — und jede noch so grobe Regel sah
 * dabei richtig aus ([attrappe-luegt-durch-weglassen]). Seit „Kiddinx
 * Kinderlieder" in WERKE steht, traegt Kiddinx Werke in ZWEI Kategorien und
 * ist die Zeile, an der diese Messung wirklich haengt.
 */
import WebSocket from 'ws'
import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'

const ZIEL = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8299/neu/'
const PRUEFEN = process.argv.includes('--pruefen')

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
const melde = (zeile) => {
  fehler++
  console.error(`  FEHLER  ${zeile}`)
}

/** Die Vorschau in den Auslieferungszustand zuruecksetzen. */
const zuruecksetzen = async () => {
  for (const s of ['frei-aus', 'nein-aus', 'voll']) {
    try {
      await (await fetch(new URL(`/vorschau/${s}`, ZIEL))).text()
    } catch {
      /* die Vorschau ist schon weg — dann gibt es auch nichts zurueckzustellen */
    }
  }
}

try {
  await zuruecksetzen()
  await warte(1500)
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value

  // Was die Seite dabei auf die Konsole schreibt. Auf der Box gibt es keine
  // Konsole; ein `TypeError` in `interpretenZeichnen` sieht am Bildschirm
  // genauso aus wie „es gibt hier eben keine Interpreten" — die Reihe ist weg.
  // Genau diese beiden Zustaende sind von aussen nicht zu unterscheiden.
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
      /* kein JSON — nichts, was diese Messung anginge */
    }
  })

  // ── Die zweite Meinung: wer SOLL in welcher Auswahl stehen? ─────────────
  const holen = async () => {
    const w = (await (await fetch(new URL('/api/werke', ZIEL))).json()).werke
    const r = (await (await fetch(new URL('/api/interpreten', ZIEL))).json()).reihe
    return { werke: w, reihe: r }
  }
  let { werke, reihe } = await holen()

  /**
   * Die erwarteten Namen. `null` = keine Auswahl (alles).
   *
   * EIN WERK GENUEGT — das ist die Regel, die hier geprueft wird, und sie steht
   * absichtlich AUSGESCHRIEBEN da (`some`) statt „die Kategorie des Interpreten"
   * zu erfinden. Ein Interpret HAT keine Kategorie; seine Werke haben eine.
   */
  const erwartet = (pruefung) =>
    reihe
      .filter((p) => !pruefung || werke.some((w) => w.interpretSchluessel === p.schluessel && pruefung(w)))
      .map((p) => p.name)

  await send(ws, 'Page.navigate', { url: ZIEL })
  await warte(2500)

  /** Was steht gerade da? */
  const ablesen = () =>
    ev(`(() => {
      const k = document.getElementById('leute')
      const kachel = document.querySelector('#leute-reihe .leute-kachel')
      const r = kachel ? kachel.getBoundingClientRect() : null
      // NUR WAS SICHTBAR IST ZAEHLT. Die Reihe wird ueber das hidden-Attribut
      // ausgeblendet, ohne ihre Kacheln wegzuraeumen — wer sie trotzdem
      // aufzaehlt, misst Leichen und meldet einen Fehler, wo keiner ist.
      // (KEINE Rueckstriche in diesem Kommentar: er steht in einem
      //  Vorlagenliteral, ein Rueckstrich beendete es mitten im Satz.)
      return {
        versteckt: !!k.hidden,
        namen: k.hidden
          ? []
          : [...document.querySelectorAll('#leute-reihe .leute-kachel .leute-name')].map((e) => e.textContent.trim()),
        breite: r ? Math.round(r.width) : 0,
        hoehe: r ? Math.round(r.height) : 0,
        rollt: (() => {
          const reihe = document.getElementById('leute-reihe')
          return reihe.scrollWidth > reihe.clientWidth + 1
        })(),
        interpret: !document.getElementById('interpret').hidden,
        regal: !document.getElementById('regal-kopf').hidden,
      }
    })()`)

  /** Warten, bis die Reihe ueberhaupt einmal gefuellt war (sie kommt aus dem Netz). */
  const aufDieReihe = async () => {
    for (let i = 0; i < 40; i++) {
      if (await ev(`document.querySelectorAll('#leute-reihe .leute-kachel').length > 0`)) return true
      await warte(250)
    }
    return false
  }

  /** Zurueck auf die Uebersicht: Kategorie „Alles". */
  const uebersicht = async () => {
    await ev(`document.querySelectorAll('#leiste .kat')[0].click(), true`)
    await warte(400)
  }

  const kategorie = async (i) => {
    await ev(`document.querySelectorAll('#leiste .kat')[${i}].click(), true`)
    await warte(400)
  }

  const zeigen = (name, s, soll) => {
    const ist = [...s.namen].sort()
    const erw = [...soll].sort()
    const gleich = JSON.stringify(ist) === JSON.stringify(erw)
    const wie = s.versteckt ? '(Reihe ausgeblendet)' : s.namen.length ? s.namen.join(', ') : '(leer)'
    console.log(`  ${name.padEnd(28)} ${wie}`)
    if (!gleich) {
      console.log(`  ${''.padEnd(28)} erwartet: ${erw.length ? erw.join(', ') : '(nichts)'}`)
    }
    return gleich
  }

  console.log(`\nINTERPRETEN je Zustand  (${ZIEL})\n`)

  if (!(await aufDieReihe())) melde('die runde Reihe wurde nie gefuellt — /api/interpreten der Vorschau kaputt?')

  // 0. DIE VORAUSSETZUNG DER MESSUNG SELBST.
  //
  // Ohne einen Interpreten in ZWEI Kategorien sind „eines genuegt" und „alle
  // muessen" nicht zu unterscheiden, und diese ganze Datei behauptete etwas,
  // das sie nicht geprueft hat. Deshalb steht die Bedingung als FEHLER da und
  // nicht als Bemerkung — eine Attrappe, die diesen Fall verliert, muss die
  // Messung umbringen, nicht still gruen faerben.
  const kategorienJe = new Map()
  for (const w of werke) {
    if (!w.interpretSchluessel) continue
    if (!kategorienJe.has(w.interpretSchluessel)) kategorienJe.set(w.interpretSchluessel, new Set())
    kategorienJe.get(w.interpretSchluessel).add(w.kategorie)
  }
  const mehrfach = reihe.filter((p) => (kategorienJe.get(p.schluessel)?.size || 0) > 1)
  console.log(
    `  ${'Interpret in mehreren Kat.'.padEnd(28)} ${
      mehrfach.length
        ? mehrfach.map((p) => `${p.name} (${[...kategorienJe.get(p.schluessel)].join('+')})`).join(', ')
        : '(keiner)'
    }`,
  )
  if (!mehrfach.length) {
    melde('kein Interpret liegt in mehr als einer Kategorie — diese Messung kann „eines genuegt" nicht pruefen')
  }

  // 1. UEBERSICHT — nichts eingeschraenkt, alle duerfen stehen.
  await uebersicht()
  let s = await ablesen()
  if (!zeigen('Uebersicht (Alles)', s, erwartet(null))) melde('Uebersicht zeigt nicht alle Interpreten')
  if (s.versteckt) melde('Uebersicht: die Reihe ist ausgeblendet, obwohl es Interpreten gibt')
  if (s.namen.length && (s.breite < ZIEL_PX || s.hoehe < ZIEL_PX)) {
    melde(`runde Kachel ${s.breite}x${s.hoehe} px — unter ${ZIEL_PX} px (ISO 9241-411)`)
  } else if (s.namen.length) {
    console.log(`  ${'Beruehrziel Kachel'.padEnd(28)} ${s.breite}x${s.hoehe} px`)
  }

  // 2. DIE KATEGORIEN — die Reihenfolge steht in app.js (KATEGORIEN).
  const KAT = [
    { i: 1, id: 'music', name: 'Kategorie Musik' },
    { i: 2, id: 'audiobook', name: 'Kategorie Hoerbuch' },
    { i: 3, id: 'other', name: 'Kategorie Radio' },
  ]
  for (const k of KAT) {
    await kategorie(k.i)
    s = await ablesen()
    const soll = erwartet((w) => w.kategorie === k.id)
    if (!zeigen(k.name, s, soll)) melde(`${k.name}: die Reihe passt nicht zur Auswahl`)
    if (!soll.length && !s.versteckt) melde(`${k.name}: leere Reihe steht da, statt wegzufallen`)
  }

  // 2b. DIE EIGENTLICHE ENTSCHEIDUNG: EIN WERK GENUEGT.
  //
  // Der Interpret aus Schritt 0 muss in JEDER seiner Kategorien dastehen —
  // auch in der, in der nur eines seiner Werke liegt. Waere die Regel „alle
  // Werke muessen in der Auswahl sein", verschwaende er in BEIDEN.
  for (const p of mehrfach) {
    for (const kat of kategorienJe.get(p.schluessel)) {
      const k = KAT.find((x) => x.id === kat)
      if (!k) continue
      await kategorie(k.i)
      s = await ablesen()
      const da = s.namen.includes(p.name)
      console.log(`  ${`„${p.name}" in ${k.id}`.padEnd(28)} ${da ? 'steht da' : 'FEHLT'}`)
      if (!da) melde(`„${p.name}" fehlt unter ${k.id}, obwohl dort ein Werk von ihm liegt (eines genuegt)`)
    }
  }

  // 3. WIRKT DER WECHSEL SOFORT? OHNE JEDE WARTEZEIT GEMESSEN.
  //
  // WOFUER: Die Reihe wird alle 15 s neu geholt (`TAKT_WERKE`). Zoege sie erst
  // dort nach, zeigte sie bis zu 15 Sekunden lang die Auswahl von VORHER — ein
  // Kind tippt links auf „Musik" und sieht oben weiter dieselben Gesichter.
  // Tipp und Ablesen stehen deshalb in EINEM Ausdruck: was danach dasteht, ist
  // synchron entstanden (der Klick ruft `zeichnen()` -> `interpretenZeichnen()`).
  await uebersicht()
  const sofort = await ev(`(() => {
    document.querySelectorAll('#leiste .kat')[1].click()
    const k = document.getElementById('leute')
    return k.hidden
      ? []
      : [...document.querySelectorAll('#leute-reihe .leute-kachel .leute-name')].map((e) => e.textContent.trim())
  })()`)
  const sollSofort = erwartet((w) => w.kategorie === 'music')
  console.log(`  ${'Wechsel ohne Wartezeit'.padEnd(28)} ${sofort.length ? sofort.join(', ') : '(leer)'}`)
  if (JSON.stringify([...sofort].sort()) !== JSON.stringify([...sollSofort].sort())) {
    melde(`Kategoriewechsel wirkt nicht sofort — erst spaeter: ${sollSofort.join(', ')}`)
  }

  // 4. DAS REGAL — die Reihe gehoert dort WEG, und das ist aelter als diese
  //    Aenderung: im Regal ist der Interpret bereits gewaehlt, und eine Reihe
  //    aller anderen daneben waere die Einladung, sich zu verlaufen
  //    (`zeichnen()`). Hier steht sie als Gegenprobe: der neue Filter darf
  //    diese Regel nicht aufweichen.
  await uebersicht()
  const traf = await ev(`(() => {
    const k = [...document.querySelectorAll('#raster > .kachel.regal')]
      .find((e) => (e.querySelector('.kachel-titel')||{}).textContent === 'Kiddinx')
    if (k) k.click()
    return !!k
  })()`)
  await warte(600)
  s = await ablesen()
  if (!traf || !s.regal) melde('Regal „Kiddinx" liess sich nicht oeffnen — Vorschau geaendert?')
  console.log(`  ${'Regal Kiddinx'.padEnd(28)} ${s.versteckt ? '(Reihe ausgeblendet)' : s.namen.join(', ')}`)
  if (!s.versteckt) melde('Regal: die runde Reihe steht da, obwohl der Interpret schon gewaehlt ist')

  // 5. DIE INTERPRETENSEITE — sie ERSETZT die Startseite.
  await uebersicht()
  await aufDieReihe()
  await ev(`document.querySelector('#leute-reihe .leute-kachel').click(), true`)
  await warte(1500)
  s = await ablesen()
  if (!s.interpret) melde('die Interpretenseite ging nicht auf — Vorschau geaendert?')
  console.log(`  ${'Interpretenseite'.padEnd(28)} ${s.versteckt ? '(Reihe ausgeblendet)' : s.namen.join(', ')}`)
  if (!s.versteckt) melde('Interpretenseite: die Reihe steht da, obwohl die Seite die Startseite ersetzt')

  // 6. DER FREIGESCHALTETE OHNE EIGENE WERKE.
  //
  // Er steht in config/interpreten.json, aber in KEINER Zeile von data.json —
  // also in keiner Kategorie. ENTSCHIEDEN (03.08.2026): in der Uebersicht
  // steht er, in jeder gewaehlten Kategorie faellt er heraus. Ihn unter
  // „Hörbuch" zu zeigen hiesse zu behaupten, hier gebe es Hoerbuecher von ihm;
  // die Seite dahinter besteht aber nur aus der Diskografie.
  //
  // NEU GELADEN STATT GEWARTET: die Reihe kommt im 15-Sekunden-Takt, und 15
  // Sekunden blind zu warten macht jede Messung langsam und wackelig.
  await (await fetch(new URL('/vorschau/frei-an', ZIEL))).text()
  await send(ws, 'Page.navigate', { url: ZIEL })
  await warte(2500)
  await aufDieReihe()
  ;({ werke, reihe } = await holen())
  const ohneWerke = reihe.filter((p) => !werke.some((w) => w.interpretSchluessel === p.schluessel))
  if (!ohneWerke.length) melde('/vorschau/frei-an lieferte keinen Interpreten ohne eigene Werke — Vorschau geaendert?')
  await uebersicht()
  s = await ablesen()
  if (!zeigen('Freigeschalteter: Uebersicht', s, erwartet(null))) {
    melde('in der Uebersicht fehlt der Freigeschaltete ohne eigene Werke')
  }
  await kategorie(2)
  s = await ablesen()
  if (
    !zeigen(
      'Freigeschalteter: Hoerbuch',
      s,
      erwartet((w) => w.kategorie === 'audiobook'),
    )
  ) {
    melde('unter „Hörbuch" stimmt die Reihe nicht — steht der Freigeschaltete ohne Werke noch da?')
  }
  for (const p of ohneWerke) {
    if (s.namen.includes(p.name)) melde(`„${p.name}" hat kein Werk in dieser Box und steht trotzdem unter „Hörbuch"`)
  }
  await (await fetch(new URL('/vorschau/frei-aus', ZIEL))).text()

  // 7. OHNE MEDIENLISTE — der Fall, fuer den der Rueckfall gebaut ist.
  //
  // /api/werke antwortet mit 500. Dann gibt es keine Auswahl, gegen die sich
  // vergleichen liesse. Die Reihe kommt aus einer ANDEREN Datei
  // (/api/interpreten, gespeist aus config/interpreten.json und der Karte im
  // Server) und muss trotzdem dastehen: sonst nimmt eine haengende Medienliste
  // dem Kind ausgerechnet den Weg zur ganzen Diskografie.
  await (await fetch(new URL('/vorschau/kaputt', ZIEL))).text()
  await send(ws, 'Page.navigate', { url: ZIEL })
  await warte(2500)
  await aufDieReihe()
  // NUR DIE REIHE NACHFRAGEN, NICHT `holen()`: /api/werke antwortet hier mit
  // 500 und dem Text „kaputt". `holen()` wollte das als JSON lesen und riss
  // die ganze Messung mit einem „Unexpected token 'k'" ab — eine Meldung, die
  // nach einem Fehler der OBERFLAECHE aussieht und in Wahrheit diesem
  // Werkzeug gehoerte (03.08.2026, beim ersten Lauf).
  reihe = (await (await fetch(new URL('/api/interpreten', ZIEL))).json()).reihe
  s = await ablesen()
  if (
    !zeigen(
      'Medienliste kaputt (500)',
      s,
      reihe.map((p) => p.name),
    )
  ) {
    melde('ohne Medienliste faellt die Reihe weg, statt alle zu zeigen')
  }
  await (await fetch(new URL('/vorschau/voll', ZIEL))).text()

  // 8. WAS DIE SEITE DABEI GESAGT HAT. Auf 800x480 gibt es keine Konsole;
  //    eine Warnung, die hier durchgeht, sieht dort niemand mehr.
  console.log(`  ${'Konsole (Warnung/Fehler)'.padEnd(28)} ${laut.length ? laut.join(' | ') : '(nichts)'}`)
  for (const z of laut) melde(`Konsolenmeldung: ${z}`)

  ws.close()
} catch (e) {
  console.error(`  ABBRUCH ${e.message}`)
  fehler++
} finally {
  // HIER STAND `zuruecksetzen()`, und das war die halbe Antwort: Es legte die
  // VORGABE hin (`frei-aus`, `nein-aus`, `voll`), nicht das, was vorher
  // dastand. Gehoerte die Vorschau jemandem, der sich `frei-an` selbst
  // gestellt hatte, raeumte dieses Werkzeug ihm seine Lage ab. Und drei Felder
  // sind nicht alle — wer ein viertes umstellt, muesste daran denken.
  // `leihe.zurueckgeben()` legt den Schnappschuss von VORHER hin und nimmt
  // jedes klebrige Feld mit (tools/leihgabe.mjs).
  //
  // OBEN BLEIBT `zuruecksetzen()` STEHEN, und zwar mit Absicht: dort stellt es
  // den AUSGANGSPUNKT der Messung her, damit sie nicht von der Lage abhaengt,
  // in der sie die Vorschau vorfindet. Das ist die umgekehrte Frage.
  //
  // IM `finally`: Ein Werkzeug, das nur auf dem gruenen Weg aufraeumt, laesst
  // die geliehene Vorschau gerade dann verstellt stehen, wenn es einen Fehler
  // gefunden hat — also genau dann, wenn als naechstes jemand hinsieht.
  await brw.schliessen()
  await leihe.zurueckgeben()
}

console.log(fehler ? `\n${fehler} Abweichung(en).` : '\nDie Interpreten-Reihe folgt ueberall der Auswahl.')
process.exit(PRUEFEN && fehler ? 1 : 0)
