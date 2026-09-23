#!/usr/bin/env node
/*
 * WELCHER MESSTAKT GEHT NOCH — durchgerechnet, bevor eine Zeile fällt.
 *
 *     node tools/verlauf-takt-rechnen.mjs
 *     node tools/verlauf-takt-rechnen.mjs --takt 20 --tage 3
 *
 * ══ WOZU ═══════════════════════════════════════════════════════════════════
 * Betreiber, 20.08.2026: „koennen wir cpu speicher oefter aktualisieren?"
 *
 * Der erste Versuch stellte den Takt einfach von 60 s auf 20 s — und riss
 * dabei zwei Grenzen, die das Projekt aus gutem Grund prueft. Das kostete
 * acht Runden Herumprobieren, weil VIER Zahlen sich gegenseitig bedingen:
 *
 *     MESS_MS      wie oft gemessen wird
 *     MAX_PUNKTE   wie lang die Historie ist (Ring)
 *     SCHREIB_JE   wie viele Punkte gesammelt werden, bevor geschrieben wird
 *     UEBERHANG    wie weit die Datei ueber den Ring wachsen darf, bevor
 *                  sie GANZ neu geschrieben wird (Verdichten)
 *
 * Wer eine davon anfasst, verschiebt drei andere. Dieses Werkzeug rechnet die
 * Kombinationen VORHER durch, mit demselben Kostenmodell, das auch die Tests
 * benutzen (`aufwandAnhaengen` aus systemverlauf.ts).
 *
 * ══ DIE DREI GRENZEN, und warum es sie gibt ════════════════════════════════
 *   SD-KARTE   unter 1 GB im Jahr. Karten haben endliche Schreibzyklen; eine
 *              Kurve ist es nicht wert, sie zu verbrauchen.
 *   DATEI      unter 1 MB. Der Server liest sie beim Start Zeile fuer Zeile —
 *              und der Kiosk-Start ist am selben Tag um fuenf Sekunden
 *              schneller geworden. Die holt man sich nicht zurueck, indem man
 *              eine Telemetriedatei aufblaeht.
 *   VERFAHREN  Anhaengen muss mindestens 20-mal billiger bleiben als die
 *              Datei jedes Mal neu zu schreiben. Sinkt der Faktor darunter,
 *              hat das Verdichten die Ersparnis aufgefressen und man koennte
 *              gleich das einfache Verfahren nehmen.
 */
import process from 'node:process'

import { aufwandAnhaengen, aufwandNeuschreiben, BYTES_JE_PUNKT } from '../src/backend-api/src/systemverlauf.ts'

const opt = (name, vorgabe) => {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : vorgabe
}

const GRENZE_KARTE = 1_000_000_000
const GRENZE_DATEI = 1_000_000
const GRENZE_FAKTOR = 20

/**
 * Eine Kombination durchrechnen.
 *
 * `schreibMin` und `verdichtTage` sind die eigentlichen Stellschrauben, und
 * sie stehen hier in ZEIT und nicht in Punkten: „alle zehn Minuten schreiben"
 * bleibt verstaendlich, wenn der Takt sich aendert — „alle 10 Punkte" nicht.
 */
function rechnen({ taktS, tage, schreibMin, verdichtTage }) {
  const messMs = taktS * 1000
  const punkteJeStunde = 3_600_000 / messMs
  const ringPunkte = Math.round((tage * 24 * 3600 * 1000) / messMs)
  const punkteJeSchreiben = Math.round((schreibMin * 60_000) / messMs)
  const ueberhang = Math.round((verdichtTage * 86_400_000) / messMs)

  const w = { punkteJeStunde, ringPunkte, punkteJeSchreiben, ueberhang }
  const an = aufwandAnhaengen(w)
  const neu = aufwandNeuschreiben(w)
  const faktor = neu.karteJeJahr / an.karteJeJahr

  return {
    taktS,
    tage,
    schreibMin,
    verdichtTage,
    ringPunkte,
    punkteJeSchreiben,
    ueberhang,
    karteJeJahr: an.karteJeJahr,
    dateiGroesse: an.dateiGroesse,
    faktor,
    // ALLE DREI MUESSEN STIMMEN. Eine Kombination, die zwei haelt und eine
    // reisst, ist keine halbe Loesung — sie ist keine.
    geht:
      an.karteJeJahr < GRENZE_KARTE && an.dateiGroesse < GRENZE_DATEI && faktor > GRENZE_FAKTOR,
  }
}

const mb = (b) => (b / 1_048_576).toFixed(2)
const gb = (b) => (b / 1_000_000_000).toFixed(2)

function zeile(r) {
  const marke = r.geht ? ' ok ' : 'NEIN'
  console.log(
    `  ${marke} ${String(r.taktS).padStart(3)} s  ${String(r.tage).padStart(2)} T  ` +
      `schreibt alle ${String(r.schreibMin).padStart(2)} min  verdichtet alle ${r.verdichtTage} T  |  ` +
      `Karte ${gb(r.karteJeJahr).padStart(5)} GB/Jahr  Datei ${mb(r.dateiGroesse).padStart(5)} MB  ` +
      `Faktor ${r.faktor.toFixed(0).padStart(3)}`,
  )
}

const einTakt = process.argv.includes('--takt')
if (einTakt) {
  const r = rechnen({
    taktS: opt('--takt', 20),
    tage: opt('--tage', 3),
    schreibMin: opt('--schreib', 10),
    verdichtTage: opt('--verdicht', 1),
  })
  zeile(r)
  console.log(`\n  Ring ${r.ringPunkte} Punkte, Schreibbündel ${r.punkteJeSchreiben}, Überhang ${r.ueberhang}`)
  console.log(`  Bytes je Punkt: ${BYTES_JE_PUNKT}`)
  process.exit(r.geht ? 0 : 1)
}

console.log('  ══ WAS HEUTE GILT ══')
zeile(rechnen({ taktS: 60, tage: 7, schreibMin: 10, verdichtTage: 1 }))

console.log('\n  ══ KOMBINATIONEN ══')
const treffer = []
for (const taktS of [30, 20, 15, 10, 5]) {
  for (const tage of [7, 5, 3, 2]) {
    for (const schreibMin of [10, 20, 30]) {
      for (const verdichtTage of [1, 2, 3]) {
        const r = rechnen({ taktS, tage, schreibMin, verdichtTage })
        if (r.geht) treffer.push(r)
      }
    }
  }
}

// DER FEINSTE TAKT GEWINNT, bei gleichem Takt die laengste Historie, dann das
// seltenere Schreiben (jeder Schreibvorgang ist ein Stromausfall-Risiko fuer
// die letzten Punkte).
treffer.sort((a, b) => a.taktS - b.taktS || b.tage - a.tage || a.schreibMin - b.schreibMin)
for (const r of treffer.slice(0, 12)) zeile(r)

if (!treffer.length) {
  console.log('  keine Kombination haelt alle drei Grenzen')
  process.exit(1)
}
const b = treffer[0]
console.log(
  `\n  FEINSTER MOEGLICHER TAKT: ${b.taktS} s bei ${b.tage} Tagen Historie` +
    `\n  (schreibt alle ${b.schreibMin} min, verdichtet alle ${b.verdichtTage} T)`,
)
console.log(
  `\n  Zum Vergleich, was heute gilt: 60 s bei 7 Tagen.` +
    `\n  Der Gewinn ist ${(60 / b.taktS).toFixed(0)}-mal feiner, der Preis ${7 - b.tage} Tage Historie.`,
)
