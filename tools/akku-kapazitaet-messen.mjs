#!/usr/bin/env node
/**
 * WELCHEN ABSCHNITT NIMMT DIE BOX, UM DIE KAPAZITAET ZU LERNEN?
 *
 * ══ WARUM ES DIESES WERKZEUG GIBT ══════════════════════════════════════════
 *
 * Der Betreiber am 08.08.2026: „die berechnung fuer den akku scheint mir nicht
 * korrekt ich habe dort 4859 mAh fuer einen neuen 10000 mAh stehen … unter die
 * haelfte waere ja schon krass".
 *
 * Er hatte recht, und das Tueckische daran war: DIE RECHNUNG WAR RICHTIG.
 *
 *     Kapazitaet = gezaehlte Ladung (mAh) / Hub im Ladestand (%) * 100
 *
 * Falsch war, WELCHEN Abschnitt sie bekam. `laengsterHub` suchte in BEIDE
 * Richtungen den laengsten und griff sich einen LADEABSCHNITT. Eine
 * Kapazitaetszahl sieht immer aus wie eine Messung — man sieht ihr nicht an,
 * ob sie aus einer Entladung oder aus einer Ladung stammt. Genau deshalb ist
 * der Fehler zwei Tage lang niemandem aufgefallen, und genau deshalb wird die
 * AUSWAHL hier gemessen und nicht nur das Ergebnis.
 *
 * ══ WAS EINE KAPAZITAETSMESSUNG WERTLOS MACHT ══════════════════════════════
 * Je ein Fall:
 *
 *   1. SIE MISST EINE LADUNG. Der Ladestand kommt aus der SPANNUNG; beim Laden
 *      drueckt der Ladestrom sie ueber die Ruhespannung (122 mOhm x 1,7 A =
 *      0,21 V), dazu das Ladeplateau. Die Prozentzahl eilt der Ladung voraus,
 *      der Hub ist zu gross, die Kapazitaet faellt zu klein aus — und zwar um
 *      so mehr, je SCHNELLER geladen wird. Faelle 1 und 2.
 *
 *   2. SIE MISST UEBER EINE LUECKE. War die Box aus, ueberspringt die
 *      Ladungszaehlung die Zeit (zu Recht — niemand weiss, was floss), der
 *      Prozentunterschied ueber dieselbe Luecke zaehlt aber VOLL. Zaehler zu
 *      klein, Nenner ganz. Fall 4.
 *
 *   3. SIE MISST ZU WENIG. Fuenf Prozentpunkte in zehn Minuten sind Rauschen,
 *      keine Messung. Faelle 5 und 6.
 *
 *   4. SIE SAGT GAR NICHTS UND VERSCHWEIGT, DASS SIE RAET. Eine frische Box
 *      hat noch keine Entladung gesehen; sie zeigt dann den Aufdruck, und das
 *      GEHOERT ANGESCHRIEBEN. Fall 7.
 *
 *   5. SIE HAELT ALTERUNG FUER EINEN MESSFEHLER. Ein drei Jahre alter
 *      10-Ah-Pack hat echte 6 Ah — die Zahl, um derentwillen ueberhaupt
 *      gemessen wird. Sie darf die Plausibilitaetspruefung nicht ausschliessen.
 *      Faelle 8 und 9.
 *
 * ══ UND DIE ECHTEN DATEN ═══════════════════════════════════════════════════
 * Mit `--reihe <akkuverlauf.json>` laeuft dieselbe Rechnung ueber die
 * Aufzeichnung einer echten Box und schreibt JEDEN gefundenen Abschnitt
 * einzeln hin — Laden wie Entladen. Das ist der Beweis, der die Vermutung
 * ersetzt: die Entladungen des Betreibers liegen 1,5 % auseinander, seine
 * Ladungen streuen um mehr als das Doppelte.
 *
 * Die Datei holt man sich LESEND von der Box:
 *   scp dietpi@…:/home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config/akkuverlauf.json /tmp/
 *
 * ══ WAS ES AENDERT ═════════════════════════════════════════════════════════
 * Nichts. Kein Netz, keine Datei, keine Box.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *   node tools/akku-kapazitaet-messen.mjs
 *   node tools/akku-kapazitaet-messen.mjs --reihe /tmp/akkuverlauf.json
 * ENDE 0, wenn jede Aussage haelt.
 */
import fs from 'node:fs'
import { entladungen, kapazitaet, kapazitaetEinzeln, ladungMah, lernen } from '../src/backend-api/src/akkulernen.ts'

const T0 = 1_800_000_000_000
const min = (n) => T0 + n * 60_000

let heil = 0
let kaputt = 0
const sagt = (satz, wahr, dazu = '') => {
  if (wahr) {
    heil++
    console.log(`  ok    ${satz}`)
  } else {
    kaputt++
    console.log(`  FALSCH ${satz}${dazu ? ' — ' + dazu : ''}`)
  }
}

/**
 * Eine Reihe mit BEKANNTER Kapazitaet bauen — der Ladestand folgt aus der
 * geflossenen Ladung, nicht umgekehrt.
 *
 * `richtung` +1 laedt, -1 entlaedt. `eile` bildet den Fehler des Ladens nach:
 * beim Laden eilt der aus der Spannung abgeleitete Ladestand der wirklichen
 * Ladung voraus. `eile: 1.7` heisst „die Prozentzahl steigt um 70 % zu
 * schnell" — der Betrag, den die Daten des Betreibers zeigen.
 */
function reihe({ mAh, mA, vonP, bisP, richtung = -1, eile = 1, abMinute = 0 }) {
  const raus = []
  let geflossen = 0
  for (let k = 0; k < 100_000; k++) {
    const p = vonP + richtung * (geflossen / mAh) * 100 * eile
    if (richtung < 0 ? p < bisP : p > bisP) break
    raus.push({
      t: min(abMinute + k),
      v: Math.round(6000 + (p / 100) * 2000 + (richtung > 0 ? 210 : -80)),
      i: richtung * mA,
      p: Math.round(p),
    })
    geflossen += mA / 60
  }
  return raus
}

const kap = (punkte, nenn = 10000) => kapazitaet(punkte, nenn)

/**
 * ZWISCHEN ZWEI ENTLADUNGEN LIEGT EINE LADUNG — sonst sind es keine zwei.
 *
 * Beim ersten Anlauf standen hier drei Entladungen einfach hintereinander,
 * durch eine Zeitluecke getrennt. Das war eine Lage, die es nicht gibt: ein
 * Pack, der zweimal von 95 auf 50 faellt, ohne dazwischen geladen zu werden,
 * ist ein Rechenfehler und keine Box. Genau deshalb steht diese Hilfe hier —
 * eine Attrappe, die Unmoegliches stellt, prueft nichts.
 */
function zyklus({ mAh, vonP, bisP, abMinute, mA = 700 }) {
  const entladen = reihe({ mAh, mA, vonP, bisP, abMinute })
  const geladen = reihe({
    mAh,
    mA: 1700,
    vonP: bisP,
    bisP: vonP,
    richtung: 1,
    eile: 1.7,
    abMinute: abMinute + entladen.length + 5,
  })
  return [...entladen, ...geladen]
}

console.log('══ 1. EIN LADEABSCHNITT WIRD NICHT MEHR GEWAEHLT ══════════════════════')
{
  // Genau die Lage vom 08.08.2026: eine kurze, schnelle Ladung und eine
  // laengere Entladung in derselben Reihe. Die Ladung ist die LAENGERE im
  // Ladestand — die alte Auswahl haette sie genommen.
  const entladen = reihe({ mAh: 8400, mA: 700, vonP: 92, bisP: 55 })
  const laden = reihe({
    mAh: 8400,
    mA: 1700,
    vonP: 26,
    bisP: 73,
    richtung: 1,
    eile: 1.7,
    abMinute: 5000,
  })
  const alles = [...entladen, ...laden]
  const e = entladungen(alles)
  sagt(`nur EIN Abschnitt gefunden, und der ist die Entladung (${e.length})`, e.length === 1)
  sagt('er endet vor der Ladung', e[0] && alles[e[0].bis].t < laden[0].t)
  const k = kap(alles)
  sagt(`Kapazitaet ${k.mAh} liegt bei 8400`, k.mAh !== null && Math.abs(k.mAh - 8400) < 300, String(k.mAh))
  // Und der Gegenbeweis: dieselbe Rechnung ueber die Ladung ergaebe Unsinn.
  // Sie wird hier von Hand gestellt (mit gedrehtem Strom und gedrehtem Stand),
  // denn `kapazitaetEinzeln` nimmt eine Ladung von sich aus gar nicht mehr an.
  const alsEntladung = laden.map((p) => ({ ...p, i: -p.i, p: 100 - p.p }))
  const nurLaden = kapazitaetEinzeln(alsEntladung, null)
  sagt(
    `dieselbe Ladung so gerechnet ergaebe ${nurLaden.mAh} — darum wird sie nicht genommen`,
    nurLaden.mAh !== null && nurLaden.mAh < 6000,
    String(nurLaden.mAh),
  )
}

console.log('══ 2. EINE REINE LADUNG ERGIBT GAR NICHTS ═════════════════════════════')
{
  const laden = reihe({ mAh: 8400, mA: 1700, vonP: 26, bisP: 73, richtung: 1, eile: 1.7 })
  sagt('keine Entladung gefunden', entladungen(laden).length === 0)
  const k = kap(laden)
  sagt('keine Kapazitaet — lieber nichts als eine falsche Zahl', k.mAh === null, String(k.mAh))
  sagt('und die Quelle heisst "aufkleber"', lernen(laden, 10000).kapazitaetQuelle === 'aufkleber')
}

console.log('══ 3. RUHE BEENDET EINE ENTLADUNG NICHT ═══════════════════════════════')
{
  // Ein Kind macht mittags Pause: der Strom geht auf 8 mA zurueck. Entladen
  // wird trotzdem weiter, und die halbe Stunde gehoert dazu.
  const a = reihe({ mAh: 8400, mA: 700, vonP: 95, bisP: 75 })
  const pause = Array.from({ length: 30 }, (_, k) => ({
    t: a[a.length - 1].t + (k + 1) * 60_000,
    v: 7400,
    i: -8,
    p: 75,
  }))
  const b = reihe({ mAh: 8400, mA: 700, vonP: 75, bisP: 55, abMinute: a.length + 31 })
  const alles = [...a, ...pause, ...b]
  const e = entladungen(alles)
  sagt(`ein einziger Abschnitt ueber die Pause hinweg (${e.length})`, e.length === 1)
  const k = kap(alles)
  sagt(`Kapazitaet ${k.mAh} liegt bei 8400`, k.mAh !== null && Math.abs(k.mAh - 8400) < 300, String(k.mAh))
}

console.log('══ 4. EINE KLEINE LUECKE WIRD ERTRAGEN, EINE GROSSE NICHT ═════════════')
{
  // `ladungMah` ueberspringt die Zeit ohne Messwerte (zu Recht — niemand weiss,
  // was floss), der Prozentunterschied ueber dieselbe Luecke zaehlt aber voll.
  // Die Kapazitaet faellt dadurch zu klein aus.
  //
  // KLEIN: die Box war eine Stunde aus, dabei sind 4 von 47 Prozentpunkten
  // weggefallen — 9 %. Der Abschnitt bleibt gueltig, das Ergebnis ist ein
  // bisschen zu klein, und der Median ueber mehrere Entladungen faengt das.
  const a = reihe({ mAh: 8400, mA: 700, vonP: 95, bisP: 72 })
  const b = reihe({ mAh: 8400, mA: 700, vonP: 68, bisP: 48, abMinute: a.length + 60 })
  const klein = kapazitaetEinzeln([...a, ...b], null)
  sagt(`9 % ueber die Luecke: ${klein.mAh} steht noch da`, klein.mAh !== null, String(klein.mAh))
  sagt(`der Anteil wird benannt (${(klein.luecke * 100).toFixed(0)} %)`, Math.abs(klein.luecke - 4 / 47) < 0.02)
  sagt('und er drueckt das Ergebnis nach unten', klein.mAh !== null && klein.mAh < 8400)

  // GROSS: die Box war die halbe Nacht aus und ist mit 30 Punkten weniger
  // wieder aufgewacht. Zwei Drittel der Antwort waeren geraten.
  const c = reihe({ mAh: 8400, mA: 700, vonP: 95, bisP: 85 })
  const d = reihe({ mAh: 8400, mA: 700, vonP: 55, bisP: 45, abMinute: c.length + 600 })
  const gross = kapazitaetEinzeln([...c, ...d], null)
  sagt(`60 % ueber die Luecke: verworfen (${(gross.luecke * 100).toFixed(0)} %)`, gross.mAh === null)
}

console.log('══ 5. ZU KLEINER HUB ═══════════════════════════════════════════════════')
{
  const r = reihe({ mAh: 8400, mA: 700, vonP: 60, bisP: 48 })
  sagt('der Abschnitt wird gefunden', entladungen(r).length === 1)
  sagt('aber 12 Prozentpunkte ergeben keine Aussage', kap(r).mAh === null)
}

console.log('══ 6. ZU KURZE DAUER ═══════════════════════════════════════════════════')
{
  // Grosser Hub in fuenf Minuten kann nicht stimmen — da ist die Spannung
  // eingebrochen, nicht der Pack leer geworden.
  const r = [
    { t: min(0), v: 7900, i: -600, p: 90 },
    { t: min(2), v: 7500, i: -600, p: 60 },
    { t: min(5), v: 7100, i: -600, p: 40 },
  ]
  sagt('keine Kapazitaet aus fuenf Minuten', kap(r).mAh === null)
}

console.log('══ 7. KEINE BRAUCHBARE ENTLADUNG — DIE BOX SAGT, WOHER SIE RAET ═══════')
{
  const frisch = Array.from({ length: 8 }, (_, k) => ({ t: min(k), v: 7393 - k * 10, i: -630, p: 59 }))
  const g = lernen(frisch, 10000)
  sagt('kapazitaetMah bleibt null', g.kapazitaetMah === null)
  sagt('kapazitaetQuelle sagt "aufkleber"', g.kapazitaetQuelle === 'aufkleber', String(g.kapazitaetQuelle))
  sagt('kapazitaetEntladungen ist 0', g.kapazitaetEntladungen === 0)
  const ohne = lernen(frisch, null)
  sagt('ohne Aufkleber ist die Quelle null', ohne.kapazitaetQuelle === null, String(ohne.kapazitaetQuelle))
}

console.log('══ 8. EIN GEALTERTER PACK IST KEIN MESSFEHLER ══════════════════════════')
{
  // 6000 von 10000 — genau die Auskunft, um derentwillen gemessen wird.
  const r = reihe({ mAh: 6000, mA: 700, vonP: 92, bisP: 45 })
  const k = kap(r)
  sagt(`${k.mAh} wird NICHT verworfen`, k.mAh !== null && Math.abs(k.mAh - 6000) < 300, String(k.mAh))
  sagt('Quelle ist "gemessen"', lernen(r, 10000).kapazitaetQuelle === 'gemessen')
}

console.log('══ 9. UNTER DER HAELFTE WIRD VERWORFEN ═════════════════════════════════')
{
  // Die alte Schwelle lag bei 20 % und liess 4859 gegen 10000 durch.
  const r = reihe({ mAh: 4500, mA: 700, vonP: 92, bisP: 45 })
  sagt('gegen einen 10-Ah-Aufkleber verworfen', kap(r, 10000).mAh === null)
  sagt('ohne Aufkleber steht die Zahl trotzdem da', kap(r, null).mAh !== null)
  sagt('gegen einen 5-Ah-Aufkleber ebenfalls', kap(r, 5000).mAh !== null)
}

console.log('══ 10. MEHRERE ENTLADUNGEN — DER MEDIAN, NICHT DIE LETZTE ══════════════')
{
  const alles = [
    ...zyklus({ mAh: 8400, vonP: 95, bisP: 50, abMinute: 0 }),
    ...zyklus({ mAh: 8300, vonP: 95, bisP: 50, abMinute: 5000 }),
    // Die dritte ist der Ausreisser: ein Bluetooth-Lautsprecher, der zwanzig
    // Minuten lang gesucht hat, sieht wie ein zu kleiner Pack aus.
    ...zyklus({ mAh: 6800, vonP: 95, bisP: 50, abMinute: 10_000 }),
  ]
  const e = entladungen(alles)
  sagt(`drei Entladungen gefunden (${e.length})`, e.length === 3)
  const k = kap(alles)
  sagt(`drei gehen ein (${k.entladungen})`, k.entladungen === 3)
  sagt(
    `der Median ${k.mAh} folgt den beiden guten, nicht dem Ausreisser`,
    k.mAh !== null && Math.abs(k.mAh - 8300) < 300,
    String(k.mAh),
  )
  const letzte = e[e.length - 1]
  const nurLetzte = kapazitaetEinzeln(alles.slice(letzte.von, letzte.bis + 1), null)
  sagt(
    `die LETZTE allein ergaebe ${nurLetzte.mAh}`,
    nurLetzte.mAh !== null && nurLetzte.mAh < 7200,
    String(nurLetzte.mAh),
  )
}

console.log('══ 11. HOECHSTENS FUENF, UND ZWAR DIE JUENGSTEN ════════════════════════')
{
  // Sieben Zyklen: die ersten beiden von einem noch frischen Pack, die
  // letzten fuenf von demselben, nachdem er gealtert ist. Zaehlen soll das
  // Heute — sonst zieht ein Jahr alter Messwert die Restzeit nach oben.
  const stuecke = []
  for (let n = 0; n < 7; n++) {
    stuecke.push(...zyklus({ mAh: n < 2 ? 9800 : 7000, vonP: 95, bisP: 50, abMinute: n * 5000 }))
  }
  sagt(`sieben Entladungen liegen vor (${entladungen(stuecke).length})`, entladungen(stuecke).length === 7)
  const k = kap(stuecke)
  sagt(`nur fuenf gehen ein (${k.entladungen})`, k.entladungen === 5)
  sagt(`der Median ${k.mAh} folgt den juengeren`, k.mAh !== null && Math.abs(k.mAh - 7000) < 300, String(k.mAh))
}

// ── DIE ECHTEN DATEN ────────────────────────────────────────────────────────
const i = process.argv.indexOf('--reihe')
if (i > 0 && process.argv[i + 1]) {
  const pfad = process.argv[i + 1]
  console.log(`\n══ DIE ECHTE AUFZEICHNUNG: ${pfad} ═══════════════════════════════`)
  const alle = JSON.parse(fs.readFileSync(pfad, 'utf8')).filter(
    (p) => Number.isFinite(p?.t) && Number.isFinite(p?.p) && Number.isFinite(p?.i),
  )
  const uhr = (t) =>
    new Date(t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  console.log(`  ${alle.length} Punkte, ${uhr(alle[0].t)} bis ${uhr(alle[alle.length - 1].t)}`)

  // JEDER Abschnitt einzeln — auch die Ladungen, denn genau ihre Streuung ist
  // der Beweis. Die Ladungen findet dieselbe Funktion mit gedrehtem Strom.
  const gedreht = alle.map((p) => ({ ...p, i: -p.i, p: 100 - p.p }))
  const zeig = (art, abschnitte, quelle) => {
    for (const a of abschnitte) {
      const teil = quelle.slice(a.von, a.bis + 1)
      const hub = Math.abs(teil[teil.length - 1].p - teil[0].p)
      const dauer = (teil[teil.length - 1].t - teil[0].t) / 3_600_000
      if (hub < 10) continue
      const mah = ladungMah(teil)
      console.log(
        `  ${art.padEnd(9)}${uhr(teil[0].t)} - ${uhr(teil[teil.length - 1].t)}  ${dauer.toFixed(1)} h  `
          + `${teil[0].p} % -> ${teil[teil.length - 1].p} %  ${Math.round(mah)} mAh  => `
          + `${Math.round((mah / hub) * 100)} mAh`,
      )
    }
  }
  zeig('entladen', entladungen(alle), alle)
  zeig('laden', entladungen(gedreht), alle)

  const g = lernen(alle, 10000)
  console.log(
    `\n  GELERNT: ${g.kapazitaetMah} mAh aus ${g.kapazitaetEntladungen} Entladung(en), `
      + `Hub ${g.kapazitaetHub} %, Quelle ${g.kapazitaetQuelle}, Stand ${g.stand}`,
  )
  sagt(
    `die Kapazitaet liegt bei 8400 und nicht bei 4859`,
    g.kapazitaetMah !== null && Math.abs(g.kapazitaetMah - 8400) < 500,
    String(g.kapazitaetMah),
  )
  sagt('sie ist gemessen und nicht vom Aufkleber', g.kapazitaetQuelle === 'gemessen')

  // DIE RESTZEIT HAENGT AN DERSELBEN ZAHL. Mit 4859 sagte sie gut die Haelfte
  // der Wahrheit; das gehoert hier nachgerechnet und nicht gehofft.
  const letzter = alle[alle.length - 1]
  const stunden = (k) => ((k * (letzter.i < 0 ? letzter.p : 100 - letzter.p)) / 100 / Math.abs(letzter.i)).toFixed(1)
  console.log(
    `  RESTZEIT bei ${letzter.p} % und ${letzter.i} mA: mit 4859 waeren es ${stunden(4859)} h, `
      + `mit ${g.kapazitaetMah} sind es ${stunden(g.kapazitaetMah)} h`,
  )
}

console.log(`\n${heil} Aussagen halten, ${kaputt} nicht.`)
process.exit(kaputt ? 1 : 0)
