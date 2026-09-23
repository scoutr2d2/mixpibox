#!/usr/bin/env node
/**
 * WELCHEN BEFEHL SCHICKT EINE VERSCHMOLZENE KACHEL — und folgt er wirklich der
 * BEVORZUGUNG?
 *
 * WOFUER: Seit dem 03.08.2026 legt die Box dasselbe Album aus zwei Diensten zu
 * EINER Kachel zusammen (verschmelzung.ts, config/verschmelzung.json). Das Werk
 * traegt danach MEHRERE Quellen in einer geordneten Liste, und `quellen[0]` ist
 * die bevorzugte — lokal vor jellyfin vor spotify. Ob der Tipp auf die Kachel
 * dort auch WIRKLICH landet, steht in keiner Meldung und in keinem Protokoll:
 * nur auf der Leitung. Deshalb wird hier mitgelesen statt am Quelltext gedeutet
 * (dasselbe Vorgehen wie tools/interpretseite-befehle.mjs und
 * tools/lane-marken-schau.mjs).
 *
 * DER FALL, DER ALLES ENTSCHEIDET, ist der, in dem Identitaet und Bevorzugung
 * AUSEINANDERFALLEN: Auf der Box heisst er „Das Lumpenpack — Die Zukunft wird
 * groß" (Identitaet `spotify:0Pyu…`, gespielt ueber Jellyfin). In der Vorschau
 * heisst er „Die drei ???" und steht unter `/vorschau/verschmolzen-an`. Wer nur
 * den bequemen Fall misst („Kapelle Petra": beides Jellyfin), bekommt ein „geht"
 * geschenkt.
 *
 * DREI FRAGEN, alle vier aus dem Auftrag:
 *   1. EINE KACHEL, ZWEI ZEICHEN — traegt die verschmolzene Kachel die
 *      Plaketten BEIDER Dienste (DIENST_MARKEN/markenBauen)?
 *   2. DER TIPP — geht der Befehl an `quellen[0]`, also an die BEVORZUGTE
 *      Quelle, und nicht an die, von der der Schluessel stammt?
 *   3. WEITERHOEREN — ueberlebt eine gemerkte Stelle die Verschmelzung, und
 *      kommt sie in der EINHEIT an, die die spielende Maschine versteht?
 *      Spotify rechnet in Millisekunden, mpv in Prozent
 *      ([resume-lokal-ist-prozent-nicht-sekunden]).
 *
 * ── SEIT E95/V STUFE 2 (31.08.2026) MESSEN 2. UND 3. DIE NEUE LEITUNG ─────
 * Die Seite baut KEINE /player-Befehle mehr: jeder Abspielwunsch ist EIN
 * `POST /api/spielen` (app.js `spielenAnfordern`). Quellwahl (Bevorzugung,
 * Ausweichen), Plattform-Befehl und Einheiten (Millisekunden vs. Prozent,
 * tracknr/seekpos) entscheidet der SERVER mit spielfunktion.ts — dorthin
 * sind diese Wahrheiten gezogen, geprueft von
 * src/backend-api/src/spielen.integration.spec.ts (entsteht parallel).
 * HIER bleibt die Wahrheit der OBERFLAECHE: der Wunsch traegt den
 * Schluessel der Kachel, beim Weiterhoeren die unverschobenen Zahlen samt
 * `ausStelle` und `gemerktBei` (in WESSEN Nummernraum sie entstanden) —
 * und daneben geht KEIN selbstgebauter /player-Befehl mehr hinaus, das
 * waere ein Doppelweg.
 *
 * WAS ES AENDERT: nichts. Eigener Browser gegen tools/neu-vorschau.mjs, nur
 * gelesen und getippt. Weder die Box noch Dateien werden angefasst.
 *
 * AUFRUF
 *     node tools/verschmelzung-befehle.mjs             # Tabelle
 *     node tools/verschmelzung-befehle.mjs --pruefen   # Ende 1 bei Abweichung
 *
 * GEMESSEN AM 2026-08-03, VOR DER REPARATUR (und darum steht es hier):
 *     Die drei ???   Quellen jellyfin+spotify, bevorzugt jellyfin
 *                    Tipp        -> (keiner)   „Dieses Album hat keine
 *                                   abspielbaren Titel"
 *                    Weiterhoeren-> (keiner)   „Das kann die Box hier noch
 *                                   nicht abspielen"
 * Beide Wege endeten also im Nichts: `abspielBefehl` gab fuer ein
 * Jellyfin-ALBUM null (kein Ein-Befehl-Start — heute `startPlan` mit
 * `art: 'inhalt'`), `albumSpielen` holte daraufhin
 * `/api/werke/<schluessel>/inhalt` — und dieser Schluessel gehoert dem
 * SPOTIFY-Eintrag. Zurueck kommen Spotify-Titel ohne `befehl`.
 */
import WebSocket from 'ws'
import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'

const ZIEL = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8299/neu/'
const PRUEFEN = process.argv.includes('--pruefen')

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

// DIE LAGE UMLEGEN, BEVOR DER BROWSER LAEDT. Ohne `verschmolzen-an` gibt es in
// der Vorschau gar keine zweite Ausgabe, und die Messung pruefte das Nichts.
//
// UND NACHSEHEN, OB SIE UEBERHAUPT UMGELEGT WURDE. Die Vorschau nimmt jeden
// unbekannten `/vorschau/<x>`-Pfad an und legt ihn still auf `lage.spielt`
// (der `else`-Zweig am Ende ihrer Kette) — sie antwortet also auch dann mit
// 200 und `{lage}`, wenn sie das Wort „verschmolzen" gar nicht kennt.
//
// GENAU SO PASSIERT AM 03.08.2026: Auf diesem Rechner lief seit dem Vorabend
// eine Vorschau von VOR der Verschmelzung weiter. Dieses Werkzeug fasst eine
// laufende nicht an (sie koennte jemandem gehoeren, der gerade misst), legte
// die Lage also gegen einen Server um, der sie nicht kennt, fand
// folgerichtig keine verschmolzene Kachel — und meldete „die verschmolzene
// Kachel spielt nicht". Ein ROT, das keines war. Seit dieses Werkzeug in
// tools/pruefen.sh haengt, waere das ein Fehlalarm im Gesamtlauf.
const lage = await (await fetch(new URL('/vorschau/verschmolzen-an', ZIEL))).json().catch(() => ({}))
if (lage?.lage?.verschmolzen !== 'an') {
  console.log('  Die laufende Vorschau kennt „verschmolzen-an" nicht — sie ist aelter als die Verschmelzung.')
  console.log('  Sie wird hier NICHT angefasst (sie koennte jemandem gehoeren). Zum Messen beenden:')
  console.log('      pkill -f "neu""-vors""chau"     # aus Stuecken, sonst trifft das Muster die eigene Zeile')
  process.exit(PRUEFEN ? 1 : 0)
}

let id = 0
const send = (ws, m, p = {}) =>
  new Promise((ok, no) => {
    const i = ++id
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

// HIER STAND `dienstAusBefehl()` — die Wiedererkennung der Plattform-Befehle
// (jellyfin/, jfqueue/, spotify/now/…, musicsearch/…). Sie ist mit E95/V
// Stufe 2 (31.08.2026) mitsamt ihrer Frage in den Server gezogen: WELCHER
// Dienst einen Wunsch bekommt, steht nicht mehr auf dieser Leitung, sondern
// in spielfunktion.ts — geprueft von
// src/backend-api/src/spielen.integration.spec.ts.

let fehler = 0
const melden = (gut, was, ist, soll) => {
  if (!gut) fehler++
  console.log(
    `    ${gut ? 'ok  ' : 'FALSCH'} ${String(was).padEnd(34)} ${ist}` + (gut ? '' : `\n           erwartet: ${soll}`),
  )
}

try {
  await warte(1500)
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.navigate', { url: ZIEL })
  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value
  await warte(2500)

  // MITLESEN STATT QUITTUNG GLAUBEN. Die Attrappe antwortet auf jeden Wunsch
  // mit einem Echo — sie kann gar nicht wissen, ob er von der richtigen
  // Kachel kam. Nur der Wortlaut auf der Leitung sagt es. Mitgelesen wird
  // ausserdem die MELDUNG an das Kind: ein leerer Wunsch allein liesse offen,
  // ob die Kachel schwieg oder sich entschuldigte.
  //
  // ZWEI LEITUNGEN, EIN HAKEN (E95/V Stufe 2, 31.08.2026; Vorbild
  // tools/kachel-spielt-je-dienst.mjs): `__wuensche` traegt jeden
  // POST /api/spielen SAMT RUMPF (die Attrappe protokolliert ihn nirgends
  // abrufbar), `__befehle` weiter jede /player-Adresse — als Wache gegen den
  // Doppelweg, denn ein selbstgebauter Befehl waere jetzt ein Rueckfall.
  await ev(`window.__befehle = []; window.__wuensche = [];
    if (!window.__mitgelesen) { window.__mitgelesen = true;
      const alt = window.fetch;
      window.fetch = function (u, o) {
        try {
          const s = String(u && u.url ? u.url : u);
          if (s.includes('/player/')) window.__befehle.push(s);
          if (/\\/api\\/spielen$/.test(s)) {
            let rumpf = {};
            try { rumpf = JSON.parse((o || {}).body || '{}') } catch {}
            window.__wuensche.push(rumpf);
          }
        } catch {}
        return alt.apply(this, arguments)
      } }
    true`)

  const vorher = await (await fetch(new URL('/api/werke?verschmelzen=0', ZIEL))).json()
  const nachher = await (await fetch(new URL('/api/werke?verschmelzen=1', ZIEL))).json()
  const merged = (nachher.werke || []).filter((w) => Array.isArray(w.auchSchluessel) && w.auchSchluessel.length)
  console.log(`\n  Kacheln: ${vorher.werke.length} -> ${nachher.werke.length}   verschmolzen: ${merged.length}`)
  if (!merged.length) throw new Error('keine verschmolzene Kachel — lief /vorschau/verschmolzen-an?')

  /**
   * Auf die Kachel eines Werks tippen und die Befehle mitlesen.
   *
   * UEBER DEN TITEL GESUCHT, nicht ueber einen Index: Die Startseite sortiert
   * und faltet Regale, ein Index waere ab dem ersten Regal daneben. Steckt die
   * Kachel in einem Regal, wird das Regal vorher geoeffnet.
   */
  const suchen = (titel) =>
    `(() => {
        // DER EINE RUECKWEG, seit 03.08.2026. Er ist ausgegraut, wenn es
        // nichts zu verlassen gibt — ein Tipp darauf ist dann folgenlos, und
        // genau das ist hier gewollt.
        const raus = document.getElementById('zurueck')
        if (raus && !raus.disabled) raus.click()
        const suche = () => [...document.querySelectorAll('#raster .kachel')]
          .find((k) => (k.querySelector('.kachel-titel') || {}).textContent === ${JSON.stringify(titel)})
        let k = suche()
        if (!k) {
          for (const r of [...document.querySelectorAll('#raster .kachel')]) {
            if (!r.querySelector('.regal-zahl')) continue
            r.click(); k = suche(); if (k) break
          }
        }
        return k })()`

  /** Die Seite von vorn laden und warten, bis der Schalter „Doppelte
   *  zusammenfassen" WIRKLICH durch ist. Ohne dieses Warten misst man den
   *  Zustand von VOR dem ersten `/api/darstellung` — dort steht jedes Album
   *  noch zweimal, und jedes zweite steckt in einem Regal. */
  const frisch = async (soll) => {
    await send(ws, 'Page.navigate', { url: ZIEL })
    await warte(1200)
    // Derselbe Doppel-Haken wie oben — nach jedem Neuladen neu, denn das
    // frische Dokument kennt ihn nicht mehr.
    await ev(`window.__befehle = []; window.__wuensche = [];
      if (!window.__mitgelesen) { window.__mitgelesen = true;
        const alt = window.fetch;
        window.fetch = function (u, o) {
          try {
            const s = String(u && u.url ? u.url : u);
            if (s.includes('/player/')) window.__befehle.push(s);
            if (/\\/api\\/spielen$/.test(s)) {
              let rumpf = {};
              try { rumpf = JSON.parse((o || {}).body || '{}') } catch {}
              window.__wuensche.push(rumpf);
            }
          } catch {}
          return alt.apply(this, arguments)
        } }
      true`)
    for (let i = 0; i < 40; i++) {
      const n = await ev(`document.querySelectorAll('#raster .kachel').length`)
      if (n && n === soll) return true
      await warte(250)
    }
    return false
  }

  /**
   * Beide Leitungen ablesen: die Spielwuensche (Rumpf) und die
   * /player-BEFEHLE. Ein Befehl ist nur, was ZWEI Glieder hinter /player/
   * traegt — die Abfragen /player/local und /player/state pollt die Seite
   * weiterhin, und sie sind kein Rueckfall (dieselbe Unterscheidung wie in
   * tools/kachel-spielt-je-dienst.mjs).
   */
  const ablesen = async () => {
    const wuensche = (await ev('window.__wuensche')) || []
    const spielerBefehle = ((await ev('window.__befehle')) || [])
      .map((b) => (/\/player\/([^/?#]+)\/(.+)$/.exec(String(b)) || [])[2])
      .filter(Boolean)
    const meldung = await ev(`((document.querySelector('#meldung, .meldung') || {}).textContent || '').trim() || null`)
    return { wuensche, spielerBefehle, meldung }
  }

  /**
   * DEN START AUSLOESEN — ueber den PLAY-KNOPF, wo es einen gibt.
   *
   * ══ NACHGEZOGEN AM 31.08.2026 (E112) ══════════════════════════════════════
   * Hier stand `k.click()` auf die KACHEL, und das war bis E112 dasselbe: Eine
   * Album-Kachel im Raster startete beim Tippen. Seit E112 klappt sie ihre
   * TITEL auf (`albumTitelLaneOeffnen`) und traegt dafuer einen eigenen
   * Play-Knopf — wie eine Playlist- und eine ARD-Kachel schon vorher. Beide
   * verschmolzenen Werke dieser Vorschau sind Alben; dieses Werkzeug meldete
   * danach an VIER Stellen „(kein Wunsch)" und beschrieb damit voellig
   * richtig eine Absicht als Fehler.
   *
   * ES WIRD NICHT „DIE KACHEL ODER IRGENDWAS" GEDRUECKT: Gesucht wird genau
   * `.tipp-spiel` — der eine Knopf, der „spielen" bedeutet. Gibt es ihn nicht
   * (Radio, lokale Einzelwerke: dort startet die Kachel weiterhin selbst),
   * bleibt es beim Tipp auf die Kachel. Damit misst dieses Werkzeug weiter
   * genau das, was es messen will — den WEG ZUM TON —, statt einen Weg zur
   * Titelliste.
   */
  const tippen = async (titel, ms = 2500) => {
    await ev(`window.__befehle = []; window.__wuensche = []; true`)
    const gefunden = await ev(`(() => { const k = ${suchen(titel)}; if (!k) return null
       const knopf = k.querySelector('.tipp-spiel')
       ;(knopf || k).click()
       return knopf ? 'knopf' : 'kachel' })()`)
    if (!gefunden) return { wuensche: [], spielerBefehle: [], meldung: '(keine Kachel)' }
    await warte(ms)
    return { ...(await ablesen()), ueber: gefunden }
  }

  // WIE VIELE KACHELN AM ENDE DASTEHEN — die Zahl, an der `frisch()` erkennt,
  // dass der Schalter durch ist. Regale falten mehrere Werke zu EINER Kachel,
  // also ist es nicht einfach die Laenge der Liste.
  const regale = new Map()
  for (const w of nachher.werke || []) {
    if (!w.interpretSchluessel) continue
    regale.set(w.interpretSchluessel, (regale.get(w.interpretSchluessel) || 0) + 1)
  }
  const sichtbar =
    (nachher.werke || []).filter((w) => !w.interpretSchluessel || (regale.get(w.interpretSchluessel) || 0) < 2).length +
    [...regale.values()].filter((n) => n >= 2).length

  for (const w of merged) {
    const dienste = (w.quellen || []).map((q) => q.dienst)
    const bevorzugt = dienste[0]
    console.log(
      `\n  „${w.titel}"  Quellen ${dienste.join(' + ')}  ->  bevorzugt ${bevorzugt}  (Schluessel ${w.schluessel})`,
    )

    // ── 1. Die Zeichen auf der Kachel ────────────────────────────────────
    await frisch(sichtbar)
    const marken = await ev(
      `(() => { const k = ${suchen(w.titel)}
        if (!k) return null
        return { anzahl: k.querySelectorAll('.kachel-marken .marke').length,
                 klassen: [...k.querySelectorAll('.kachel-marken .marke')].map((m) => m.className),
                 label: k.getAttribute('aria-label') } })()`,
    )
    if (marken) {
      melden(
        marken.anzahl === dienste.length,
        `Plaketten auf der Kachel`,
        `${marken.anzahl} (${marken.klassen.join(', ')})`,
        `${dienste.length} — je eine je Quelle`,
      )
      melden(
        dienste.every((d) =>
          String(marken.label)
            .toLowerCase()
            .includes(d === 'lokal' ? 'box' : d),
        ),
        `Vorlesetext nennt beide Dienste`,
        `„${marken.label}"`,
        dienste.join(' und '),
      )
    } else {
      melden(false, 'Kachel gefunden', 'keine', 'eine Kachel mit diesem Titel')
    }

    // ZWEI PLAKETTEN BRAUCHEN MEHR PLATZ ALS EINE — und rechts unten liegen
    // `.tipp-spiel` und `.regal-zahl`. In der klassischen Oberflaeche ist genau
    // dieser Zusammenstoss schon passiert (swiper.component.scss, Kommentar bei
    // `.cover-play`: der Knopf verschwand unter den Quellen-Plaketten). Bei
    // EINER Marke faellt das nie auf; gemessen wird deshalb der Fall mit ZWEI.
    const platz = await ev(
      `(() => { const k = ${suchen(w.titel)}
        if (!k) return null
        const kasten = k.querySelector('.kachel-marken'); if (!kasten) return null
        const r = (e) => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom] }
        const m = r(kasten), bild = r(k.querySelector('.kachel-bild'))
        const rechts = k.querySelector('.tipp-spiel, .regal-zahl')
        return { m, bild, rechts: rechts ? r(rechts) : null,
                 hoch: Math.round(kasten.getBoundingClientRect().height) } })()`,
    )
    if (platz) {
      const drin =
        platz.m[0] >= platz.bild[0] - 0.5 && platz.m[2] <= platz.bild[2] + 0.5 && platz.m[3] <= platz.bild[3] + 0.5
      melden(
        drin,
        `Plaketten bleiben im Cover`,
        `${Math.round(platz.m[2] - platz.m[0])}x${platz.hoch} px, Cover ${Math.round(platz.bild[2] - platz.bild[0])} px breit`,
        'ganz innerhalb des Coverkastens',
      )
      if (platz.rechts) {
        const abstand = Math.round(platz.rechts[0] - platz.m[2])
        melden(abstand > 0, `Abstand zum Knopf rechts unten`, `${abstand} px`, 'mehr als 0 px — keine Ueberlappung')
      }
    }

    // ── 2. Der Tipp ──────────────────────────────────────────────────────
    // OB der Wunsch bei `quellen[0]` landet (die BEVORZUGUNG) und welcher
    // Plattform-Befehl daraus wird, entscheidet seit E95/V der Server —
    // geprueft in src/backend-api/src/spielen.integration.spec.ts. Auf der
    // Leitung der Seite ist die Wahrheit: EIN Wunsch mit dem Schluessel der
    // verschmolzenen Kachel, kein Befehl daneben.
    const t = await tippen(w.titel)
    melden(
      t.wuensche.length === 1 && (t.wuensche[0] || {}).schluessel === w.schluessel,
      // SEIT E112 SAGT DIE ZEILE, WORAUF GETIPPT WURDE: Bei einem Album ist
      // es der Play-Knopf, bei allem anderen die Kachel. Ohne diese Auskunft
      // liest sich ein Rot als „der Tipp geht ins Leere", waehrend in
      // Wahrheit der WEG ein anderer ist (siehe `tippen`).
      `Start (${t.ueber === 'knopf' ? 'Play-Knopf' : 'Kachel'})`,
      `${t.wuensche.map((x) => JSON.stringify(x)).join('  ') || '(kein Wunsch)'}${t.meldung ? `   Meldung: „${t.meldung}"` : ''}`,
      `genau EIN POST /api/spielen mit schluessel ${w.schluessel}`,
    )
    melden(
      t.spielerBefehle.length === 0,
      `kein /player-Befehl aus der Seite`,
      t.spielerBefehle.join('  ') || '(keiner)',
      'keiner — ein selbstgebauter Befehl waere ein Doppelweg (E95/V)',
    )

    // ── 3. Weiterhoeren ──────────────────────────────────────────────────
    // MIT `verschmelzen=1`, WIE DIE SEITE SELBST (`weiterHolen`): der Server
    // reicht den fuehrenden Schluessel weiter und stellt die Stelle in die
    // Einheit der Quelle, die spielen wird (fortsetzenMit). Gegen DIESE
    // Zeile wird der Wunsch verglichen — die Erwartung kommt aus derselben
    // Antwort, die auch die Seite bekam, nicht aus abgeschriebenen Zahlen.
    const zeilen = await (await fetch(new URL('/api/weiterhoeren?max=20&verschmelzen=1', ZIEL))).json()
    const z = (zeilen.weiter || []).find(
      (x) => x.schluessel === w.schluessel || (w.auchSchluessel || []).includes(x.schluessel),
    )
    if (!z) {
      console.log('    ---- keine gemerkte Stelle zu diesem Werk')
      continue
    }
    console.log(
      `    gemerkt: Titel ${z.titelNr}, ` +
        `${z.positionMs !== null ? `${z.positionMs} ms` : `${z.positionProzent} %`}` +
        `, Anteil ${z.anteil}, gemerkt bei ${z.typ}`,
    )
    // FRISCH LADEN: der Tipp oben hat gerade etwas gestartet, und `spielen()`
    // merkt sich das Werk. Ein Weiterhoeren-Tipp danach maesse eine Seite, die
    // schon mitten in einer Wiedergabe steht.
    await frisch(sichtbar)
    const geklickt = await ev(
      `(() => { const k = [...document.querySelectorAll('#weiter-reihe .weiter-kachel')]
          .find((k) => (k.textContent || '').includes(${JSON.stringify(w.titel)}))
        if (!k) return null; k.click(); return true })()`,
    )
    if (!geklickt) {
      melden(false, 'Weiterhoeren-Kachel', 'keine Kachel in der Reihe', 'eine Kachel, die zum Werk fuehrt')
      continue
    }
    // Der Wunsch geht im Augenblick des Tipps hinaus; gewartet wird trotzdem,
    // denn ein Doppelweg-Befehl kaeme, wenn ueberhaupt, in diesen Sekunden.
    await warte(2500)
    const nach = await ablesen()
    const wu = nach.wuensche[0] || {}
    melden(
      nach.wuensche.length === 1 && wu.schluessel === w.schluessel && wu.ausStelle === true,
      `Weiterhoeren stellt EINEN Wunsch`,
      `${nach.wuensche.map((x) => JSON.stringify(x)).join('  ') || '(keiner)'}${nach.meldung ? `   Meldung: „${nach.meldung}"` : ''}`,
      `ein POST /api/spielen mit schluessel ${w.schluessel} und ausStelle`,
    )
    melden(
      nach.spielerBefehle.length === 0,
      `kein /player-Befehl aus der Seite`,
      nach.spielerBefehle.join('  ') || '(keiner)',
      'keiner — tracknr:/seekpos: und den Startbefehl baut jetzt der Server',
    )
    // DIE ZAHLEN REISEN UNVERSCHOBEN, UND IHR NUMMERNRAUM REIST MIT:
    // `gemerktBei` sagt dem Server, in WESSEN Liste titelNr entstand (hier
    // beim geschluckten Spotify-Eintrag). Ob daraus `tracknr:`/`seekpos:` in
    // der richtigen EINHEIT werden (Millisekunden vs. Prozent — die alte
    // Frage 3 dieses Werkzeugs), prueft seit E95/V
    // src/backend-api/src/spielen.integration.spec.ts am Server.
    melden(
      wu.titelNr === z.titelNr,
      `Titelnummer im Wunsch`,
      String(wu.titelNr),
      `${z.titelNr} — unverschoben aus der gemerkten Stelle`,
    )
    melden(
      wu.positionMs === (z.positionMs ?? 0) && wu.positionProzent === (z.positionProzent ?? 0),
      `Stelle im Wunsch (ms/prozent)`,
      `${wu.positionMs} ms / ${wu.positionProzent} %`,
      `${z.positionMs ?? 0} ms / ${z.positionProzent ?? 0} % — wie die Zeile sie nennt`,
    )
    melden(
      wu.gemerktBei === z.typ,
      `gemerktBei nennt den Nummernraum`,
      String(wu.gemerktBei),
      String(z.typ),
    )
  }

  // ══ 4. DAS AUSWEICHEN — was, wenn die bevorzugte Quelle nicht kann? ══════
  //
  // `/vorschau/inhalt-kaputt` laesst `/api/werke/<s>/inhalt` mit 502 antworten
  // — genau das, was ein abgeschalteter Jellyfin-Server verursacht.
  //
  // SEIT E95/V IST DAS AUSWEICHEN SERVER-SACHE (`versuchsQuellen` in
  // spielfunktion.ts) — dass bei kaputter bevorzugter Quelle die ZWEITE
  // spielt, prueft src/backend-api/src/spielen.integration.spec.ts. Die
  // Wahrheit der SEITE ist hier die Gegenprobe: sie darf von der Stoerung
  // NICHTS mitbekommen — derselbe EINE Wunsch, kein eigenes Herumprobieren,
  // kein Rueckfall auf selbstgebaute Befehle. (Der Wechsel MITTEN in der
  // Wiedergabe ist weiterhin nicht gebaut; nur der START weicht aus.)
  console.log('\n  Ausweichen ist Server-Sache — der Wunsch bleibt derselbe (/vorschau/inhalt-kaputt):')
  await fetch(new URL('/vorschau/inhalt-kaputt', ZIEL))
  for (const w of merged) {
    const dienste = (w.quellen || []).map((q) => q.dienst)
    if (dienste.length < 2) continue
    await frisch(sichtbar)
    const t = await tippen(w.titel, 3500)
    melden(
      t.wuensche.length === 1 && (t.wuensche[0] || {}).schluessel === w.schluessel && t.spielerBefehle.length === 0,
      `„${w.titel}" mit kaputter Quelle`,
      `${t.wuensche.map((x) => JSON.stringify(x)).join('  ') || '(kein Wunsch)'}   /player: ${t.spielerBefehle.join(' ') || 'keiner'}`,
      `derselbe EINE POST mit schluessel ${w.schluessel}, kein Selbst-Ausweichen`,
    )
  }
  await fetch(new URL('/vorschau/inhalt-voll', ZIEL))

  console.log(`\n  ${fehler ? `${fehler} Abweichung(en)` : 'alles wie erwartet'}`)
  ws.close()
} finally {
  // DIE LAGE ZURUECKLEGEN. Eine laufende Vorschau gehoert allen Werkzeugen;
  // wer sie umgestellt liegen laesst, stellt dem naechsten eine Falle. Genau
  // das ist am 03.08.2026 passiert: tools/interpretseite-befehle.mjs meldete
  // danach „Die drei ??? schickt jellyfin statt spotify:album:" — richtig
  // gemessen, aber gegen eine Vorschau, die niemand so bestellt hatte.
  //
  // HIER STANDEN BIS ZUM 04.08.2026 ZWEI FESTE WERTE (`verschmolzen-aus`,
  // `inhalt-voll`), und das war schon die halbe Wahrheit: Zurueckgelegt wurde
  // die VORGABE, nicht das, was vorher dastand. Gehoerte die Vorschau jemandem,
  // der sie sich selbst auf `verschmolzen-an` gestellt hatte, raeumte dieses
  // Werkzeug ihm seine Lage ab — derselbe Schaden, nur andersherum.
  // `leihe.zurueckgeben()` legt den Schnappschuss von VORHER hin
  // (tools/leihgabe.mjs) und deckt damit auch alles ab, was hier nie
  // aufgezaehlt war.
  await brw.schliessen()
  await leihe.zurueckgeben()
}

process.exit(PRUEFEN && fehler ? 1 : 0)
