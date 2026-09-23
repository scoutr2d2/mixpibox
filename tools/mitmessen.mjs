#!/usr/bin/env node
/**
 * MITMESSEN: zusehen, was auf der Box passiert, waehrend jemand sie bedient.
 *
 * WOFUER: bei "der Player ist langsam" oder "der Flip geht nicht auf" fuehrt
 * Nachdenken ueber den Code schnell in die Irre - hier schon mehrfach. Wer
 * dagegen einfach klickt und dabei misst, hat den Befund in einer Minute.
 *
 * WAS ES ZEIGT: je Klick die Art des Elements, die sichtbare Reaktion und die
 * Zeit bis dahin. Am Ende (Strg-C) leitet es daraus REGELN ab - Median und
 * Band je Art, also "so ist es hier normal".
 *
 * WAS ES NICHT TUT: raten. Ein Klick ohne sichtbare Reaktion erscheint als
 * "keine Reaktion", nicht als schneller Wert. Und aus weniger als drei
 * Messungen wird keine Regel - ein Einzelwert sah hier schon einmal nach einem
 * Befund aus und war in Wahrheit der Anlauf.
 *
 * DER SCHALTER: der Messmodus ist normalerweise AUS - eine Kinderbox soll
 * nicht dauernd messen, was ein Kind antippt. `--an` schaltet ihn ein und
 * fordert zugleich ein Neuladen an, damit die Box ihn abholt (binnen einer
 * Minute). Er liegt auf dem SERVER, nicht im Browserspeicher: auf einem
 * Touch-Kiosk gibt es keine Konsole, in der man ihn setzen koennte.
 *
 * AUFRUF
 *   node tools/mitmessen.mjs                  gegen mupibox
 *   node tools/mitmessen.mjs 192.168.178.48   gegen eine Adresse
 *   node tools/mitmessen.mjs --an             Messmodus einschalten und zusehen
 *   node tools/mitmessen.mjs --aus            wieder ausschalten
 *   node tools/mitmessen.mjs --leeren         vorher alles Alte verwerfen
 */

const args = process.argv.slice(2)
const HOST = args.find((a) => !a.startsWith('--')) || process.env.MUPI_HOST || 'mupibox'
const LEEREN = args.includes('--leeren')
const AN = args.includes('--an')
const AUS = args.includes('--aus')
const API = `http://${HOST}:8200/api/messung`

const hole = async (pfad, opt) => {
  const a = await fetch(pfad, opt)
  if (!a.ok) throw new Error(`HTTP ${a.status}`)
  return a.json()
}

// Feste Breiten, damit die Spalten beim Mitlesen nicht wandern.
//
// MIT ABSTAND UND AUSLASSUNG: die erste Fassung schnitt einfach ab, und bei
// langen Beschriftungen stiess die Spalte direkt an die naechste
// ("Sonstiges (SoundtracTitelliste"). Das sah nicht nur schlecht aus - eine
// Auswertung, die diese Ausgabe zurueckliest, zog daraus falsche Zahlen.
const breit = (s, n) => {
  const t = String(s ?? '')
  return (t.length > n - 1 ? `${t.slice(0, n - 2)}…` : t).padEnd(n)
}
const zeit = (ms) => (ms === null ? '  keine Reaktion' : `${String(ms).padStart(6)} ms`)

// Den Schalter stellen. Er liegt auf dem SERVER, nicht im Browserspeicher:
// auf einem Touch-Kiosk gibt es keine Konsole, in der man ihn setzen koennte.
// Damit die Box ihn abholt, muss sie einmal neu laden - das ist derselbe Weg,
// den `tools/aufraeumen.sh` benutzt (sie fragt einmal je Minute nach ihrem
// Stand und laedt bei einer Aenderung neu).
if (AN || AUS) {
  try {
    await hole(`http://${HOST}:8200/api/messung/modus`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ an: AN }),
    })
    console.log(`\n  Messmodus ${AN ? 'EIN' : 'AUS'}geschaltet.`)
    await fetch(`http://${HOST}:8200/api/oberflaeche/neuladen`, { method: 'POST' })
    console.log('  Die Box laedt binnen einer Minute neu und holt ihn sich.')
    if (AUS) process.exit(0)
  } catch (e) {
    console.log(`\n  Schalter nicht erreichbar (${HOST}): ${e.message}`)
    process.exit(1)
  }
}

console.log(`\n  Mitmessen an ${HOST} — bedienen Sie die Box ganz normal.`)
console.log('  Strg-C beendet und leitet die Regeln ab.\n')

let letzte = 0
const gesammelt = []

if (LEEREN) {
  try {
    await hole(API, { method: 'DELETE' })
    console.log('  (Alte Messungen verworfen)\n')
  } catch {
    /* nicht schlimm - dann stehen eben noch aeltere im Puffer */
  }
}

// Beim Start NICHT bei 0 anfangen: sonst rauscht der ganze alte Puffer durch,
// bevor der erste echte Klick kommt.
try {
  const a = await hole(`${API}?ab=0`)
  letzte = a.bis ?? 0
} catch (e) {
  console.log(`  Box nicht erreichbar (${HOST}): ${e.message}`)
  console.log('  Laeuft der Server? Ist der Messmodus in der Oberflaeche an?\n')
  process.exit(1)
}

console.log(`  ${breit('Zeit', 9)}${breit('Angetippt', 20)}${breit('Reaktion', 16)}Dauer`)
console.log(`  ${'─'.repeat(58)}`)

let stiller = 0
const takt = setInterval(async () => {
  try {
    const a = await hole(`${API}?ab=${letzte}`)
    const neu = a.messungen || []
    if (!neu.length) {
      // Nach einer Weile ohne Klicks daran erinnern, woran es liegen koennte.
      if (++stiller === 30) {
        console.log('\n  (noch nichts angekommen — ist der Messmodus in der Oberflaeche an?)\n')
      }
      return
    }
    stiller = 0
    for (const m of neu) {
      letzte = Math.max(letzte, m.nr ?? 0)
      gesammelt.push(m)
      const uhr = new Date(m.zeit || Date.now()).toLocaleTimeString()
      const wo = m.text ? `${m.art} (${m.text.slice(0, 12)})` : m.art
      console.log(`  ${breit(uhr, 9)}${breit(wo, 22)}${breit(m.reaktion || '—', 16)}${zeit(m.ms)}`)
      // Bei Unerkanntem die echten Klassennamen zeigen - genau die fehlen der
      // Erkennungstabelle, und nur so kommen sie hinein, ohne zu raten.
      if (m.klassen?.length) console.log(`  ${' '.repeat(9)}└─ Klassen: ${m.klassen.join(' ')}`)
    }
  } catch {
    /* Aussetzer: beim naechsten Takt weiter, nicht abbrechen */
  }
}, 700)

const abschluss = () => {
  clearInterval(takt)
  console.log(`\n  ${'─'.repeat(58)}`)
  if (!gesammelt.length) {
    console.log('  Nichts gemessen.\n')
    process.exit(0)
  }

  // Je Art eine Regel. Median statt Durchschnitt, damit ein einzelner
  // Ausreisser (ein gerade erst geladener Titel) sie nicht wegzieht.
  const nachArt = new Map()
  for (const m of gesammelt) {
    if (!nachArt.has(m.art)) nachArt.set(m.art, [])
    nachArt.get(m.art).push(m.ms)
  }

  console.log(`\n  Abgeleitete Regeln aus ${gesammelt.length} Klicks:\n`)
  for (const [art, werte] of [...nachArt.entries()].sort()) {
    const z = werte.filter((w) => typeof w === 'number').sort((a, b) => a - b)
    const ohne = werte.length - z.length
    if (z.length < 3) {
      console.log(`  ${breit(art, 20)}${z.length} Messung(en) — zu wenig fuer eine Regel`)
    } else {
      const mitte = Math.floor(z.length / 2)
      const median = z.length % 2 ? z[mitte] : Math.round((z[mitte - 1] + z[mitte]) / 2)
      const rand = Math.floor(z.length * 0.1)
      console.log(
        `  ${breit(art, 20)}${String(median).padStart(5)} ms  (${z[rand]}–${z[z.length - 1 - rand]} ms, ${z.length} Klicks)`,
      )
    }
    if (ohne) console.log(`  ${' '.repeat(20)}${ohne}× OHNE sichtbare Reaktion`)
  }
  console.log()
  process.exit(0)
}

process.on('SIGINT', abschluss)
process.on('SIGTERM', abschluss)
