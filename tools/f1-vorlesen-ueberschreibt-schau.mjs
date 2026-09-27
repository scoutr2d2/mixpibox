#!/usr/bin/env node
/*
 * SCHREIBT EINE ANSAGE DEN FOLGENNAMEN WEG? — die Gegenprobe zu F1.
 *
 * ══ DER VERDACHT ═══════════════════════════════════════════════════════════
 * F1 hat `media-title` in die beobachteten Eigenschaften aufgenommen und
 * schreibt den gemeldeten Wert nach `currentMeta.currentTrackname`, sobald
 * `currentType` 'jellyfin' oder 'ard' ist.
 *
 * Die Weiche steht auf dem TYP, nicht auf dem TON. Und `sprichText` (der
 * Zweig `say`) laedt eine ganz andere Datei in DASSELBE mpv — ohne
 * `force-media-title` und OHNE `currentType` anzufassen. mpv meldet dann den
 * Titel der Ansage; die Weiche steht weiter auf 'ard'; der Hoerer schreibt.
 *
 * VOR F1 KONNTE DAS NICHT PASSIEREN: `media-title` wurde nicht beobachtet,
 * und der `filename`-Hoerer schreibt nur, wenn noch GAR KEIN Name dasteht
 * (`if (!currentMeta.currentTrackname)`). Der neue Hoerer hat diese Schranke
 * nicht.
 *
 * ══ WAS GEMESSEN WIRD ══════════════════════════════════════════════════════
 *   1. Eine ARD- (oder Jellyfin-) Folge starten und den gemeldeten Namen lesen.
 *   2. `/player/<raum>/say/<Text>` schicken — genau so, wie es die klassische
 *      Oberflaeche als letzten Rueckfall tut (player.service.ts `say`).
 *   3. Denselben Namen noch einmal lesen.
 *
 * ROT heisst: der Name hat sich durch die ANSAGE geaendert. Was dann im
 * Player steht, ist nicht der Folgenname.
 *
 * ══ WAS ES AN DER BOX AENDERT ══════════════════════════════════════════════
 * Es startet eine Wiedergabe, laesst einen Satz sprechen und haelt am Ende mit
 * `stop` an. Keine Nutzerdatei wird geschrieben.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *   node tools/f1-vorlesen-ueberschreibt-schau.mjs
 *   node tools/f1-vorlesen-ueberschreibt-schau.mjs --jellyfin
 *   node tools/f1-vorlesen-ueberschreibt-schau.mjs --box 192.168.178.169
 */
const argv = process.argv.slice(2)
const opt = (n, v = null) => {
  const i = argv.indexOf(`--${n}`)
  if (i < 0) return v
  const w = argv[i + 1]
  return w && !w.startsWith('--') ? w : true
}
const BOX = String(opt('box', '192.168.178.169'))
const QUELLE = argv.includes('--jellyfin') ? 'jellyfin' : 'ard'
const API = `http://${BOX}:8200/api`
const SPIELER = `http://${BOX}:8200/player`
const RAUM = 'current'

const schlaf = (ms) => new Promise((r) => setTimeout(r, ms))

// HTTP 200 BEWEIST HIER NICHTS — Server und Abspieldienst antworten auf jeden
// Pfad mit 200. Geprueft wird nur der INHALT.
async function json(url) {
  const a = await fetch(url, { cache: 'no-store', headers: { accept: 'application/json' } })
  const t = await a.text()
  if (!(a.headers.get('content-type') || '').includes('json')) throw new Error(`${url}: kein JSON`)
  return JSON.parse(t)
}
const befehl = (p) => fetch(`${SPIELER}/${RAUM}/${p}`, { cache: 'no-store' }).catch(() => null)
const lokal = () => json(`${SPIELER}/local`).catch(() => null)

async function werkFinden() {
  const d = await json(`${API}/werke?verschmelzen=1`)
  for (const w of d?.werke || []) {
    let inhalt
    try {
      inhalt = await json(`${API}/werke/${encodeURIComponent(w.schluessel)}/inhalt?verschmelzen=1`)
    } catch {
      continue
    }
    if (inhalt?.dienst !== QUELLE) continue
    const titel = (inhalt.titel || []).filter((t) => t.befehl)
    if (titel.length >= 1) return { w, titel }
  }
  return null
}

const fund = await werkFinden()
if (!fund) {
  console.log(`Kein ${QUELLE}-Werk gefunden — nichts gemessen.`)
  process.exit(2)
}
console.log(`Ansage-Gegenprobe an ${BOX} — Quelle ${QUELLE}`)
console.log(`Werk: „${fund.w.titel}", erster Titel: „${fund.titel[0].titel}"\n`)

await befehl('stop')
await schlaf(1500)
await befehl(fund.titel[0].befehl)
await schlaf(5000)

const vorher = await lokal()
console.log(`  vor der Ansage :  currentType=${vorher?.currentType}  currentTrackname="${vorher?.currentTrackname}"`)

// GENAU DIE FORM DER KLASSISCHEN OBERFLAECHE: say/<Text>/<Lautstaerke>.
await befehl(`say/${encodeURIComponent('Bibi Blocksberg')}/40`)
await schlaf(6000)

const nachher = await lokal()
console.log(`  nach der Ansage:  currentType=${nachher?.currentType}  currentTrackname="${nachher?.currentTrackname}"`)

await befehl('stop')
console.log('\n(angehalten)')

const a = String(vorher?.currentTrackname ?? '')
const b = String(nachher?.currentTrackname ?? '')
console.log('\n── Urteil ─────────────────────────────────────────────────')
if (!a) {
  console.log('  UNENTSCHIEDEN: schon vor der Ansage stand kein Name da.')
  process.exit(2)
}
if (a === b) {
  console.log('  GRUEN: die Ansage hat den Folgennamen nicht angefasst.')
  process.exit(0)
}
console.log(`  ROT: die Ansage hat den Folgennamen ueberschrieben.`)
console.log(`       "${a}"`)
console.log(`    -> "${b}"`)
process.exit(1)
