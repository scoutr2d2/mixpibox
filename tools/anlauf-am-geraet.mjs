#!/usr/bin/env node
// Sieht am ECHTEN GERAET nach, welche Zustandsfelder nach einem Start wirklich
// kommen — und wann.
//
// WOZU: Die Reparatur in NewDesign/app.js (`titelUndStelle`) wartet nicht mehr
// nach der Uhr, sondern bis der gewaehlte Titel offen ist. Als Beleg dafuer
// dient `duration` aus /player/local. Ob dieses Feld ueberhaupt zuverlaessig
// kommt, war die offene Frage: am 04.08.2026 stand es bei laufender ARD-Folge
// auf `null`, obwohl `playing: true` gemeldet wurde. Ein Beleg, den es nicht
// gibt, waere schlimmer als keiner — die Oberflaeche wuerde dann bis zur Frist
// warten und den Sprung erst danach schicken.
//
// GEMESSEN WIRD AM LAUFENDEN GERAET, nicht an einer Attrappe. Eine Attrappe
// koennte `duration` liefern und damit genau die Frage wegdefinieren, um die
// es geht [llmwiki attrappe-luegt-durch-weglassen].
//
// WAS ES TUT: startet eine Wiedergabe, tastet /local im 100-ms-Takt ab, haelt
// fuer jedes Feld den ersten brauchbaren Wert samt Zeitpunkt fest — und HAELT
// DANACH WIEDER AN. Es macht also fuer ein paar Sekunden Ton auf der Box.
//
// AUFRUF
//     node tools/anlauf-am-geraet.mjs --befehl '<abspielbefehl>'
//     node tools/anlauf-am-geraet.mjs --befehl 'jellyfin:...' --dauer 12
//     node tools/anlauf-am-geraet.mjs --nur-zusehen      (nichts starten)
//
// Rueckgabe: 0 = gemessen, 2 = Messung nicht moeglich.
const BOX = process.env.MUPI_BOX || '192.168.178.169'
const SPIELER = `http://${BOX}:5005`

const arg = (name, vorgabe = null) => {
  const i = process.argv.indexOf(name)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : vorgabe
}
const BEFEHL = arg('--befehl')
const DAUER_S = Number(arg('--dauer', '10'))
const NUR_ZUSEHEN = process.argv.includes('--nur-zusehen')

if (!BEFEHL && !NUR_ZUSEHEN) {
  console.error('  --befehl fehlt (oder --nur-zusehen). Beispiel:')
  console.error("  node tools/anlauf-am-geraet.mjs --befehl 'index:0'")
  process.exit(2)
}

const warte = (ms) => new Promise((f) => setTimeout(f, ms))

async function stand() {
  try {
    const a = await fetch(`${SPIELER}/local`, { signal: AbortSignal.timeout(1200) })
    return await a.json()
  } catch {
    return null
  }
}

/**
 * ES WIRD NICHT GEMELDET, OB DER BEFEHL „ANGENOMMEN" WURDE — weil das nicht
 * feststellbar ist. Am 04.08.2026 gemessen: der Abspieldienst antwortet auch
 * auf `/gibtesnichtxyz` mit 200 und `application/json`. Ein Auffangbereich
 * nimmt jeden Pfad. Damit beweist weder der Code noch der Content-Type, dass
 * ein Befehl seinen Zweig erreicht hat — dieselbe Falle wie beim Server, nur
 * eine Tuer weiter [llmwiki server-antwortet-200-auf-alles].
 *
 * Die erste Fassung dieses Werkzeugs meldete „angenommen" und stuetzte darauf
 * einen Befund. Der Befund war deshalb keiner.
 *
 * WAS ZAEHLT, IST DIE WIRKUNG: die Felder aus /local danach. Nur sie.
 */
async function befehl(text) {
  try {
    await fetch(`${SPIELER}/${encodeURI(text)}`, { signal: AbortSignal.timeout(4000) })
    return true // erreicht, nicht: ausgefuehrt
  } catch {
    return false // gar nicht angekommen — das ist die einzige Aussage
  }
}

// BRAUCHBAR heisst NICHT „vorhanden". Genau daran haengt die Reparatur: ein
// Feld, das als leerer Text oder als null ankommt, ist kein Beleg.
const BRAUCHBAR = {
  currentPlayer: (v) => String(v || '') !== '',
  currentType: (v) => String(v || '') !== '',
  playing: (v) => v === true,
  currentTracknr: (v) => Number.isFinite(Number(v)) && Number(v) > 0,
  totalTracks: (v) => Number.isFinite(Number(v)) && Number(v) > 0,
  duration: (v) => Number.isFinite(Number(v)) && Number(v) > 0,
  timePos: (v) => Number.isFinite(Number(v)) && Number(v) >= 0 && v !== null,
  currentTrackname: (v) => String(v || '') !== '',
}

const vor = await stand()
if (!vor) {
  console.error(`  ${SPIELER}/local antwortet nicht — Messung nicht moeglich.`)
  process.exit(2)
}
console.log(`  Box ${BOX}, Abspieldienst erreichbar.`)
console.log(`  VORHER: ${Object.keys(BRAUCHBAR).filter((k) => BRAUCHBAR[k](vor[k])).join(', ') || '(kein Feld brauchbar)'}`)

if (!NUR_ZUSEHEN) {
  // Erst anhalten: sonst misst man die Felder der VORIGEN Wiedergabe und haelt
  // sie fuer die neuen. Genau die Verwechslung, gegen die `currentPlayer` in
  // der Reparatur als Frischemerkmal mitgeprueft wird.
  await befehl('stop')
  await warte(600)
}

const beginn = Date.now()
const zuerst = {}
if (!NUR_ZUSEHEN) {
  const ok = await befehl(BEFEHL)
  console.log(`  Start geschickt: ${BEFEHL.slice(0, 90)}…`)
  console.log(`  (erreicht: ${ok ? 'ja' : 'NEIN'} — ob er WIRKTE, sagen unten allein die Felder)`)
  if (!ok) process.exit(2)
}

while (Date.now() - beginn < DAUER_S * 1000) {
  const s = await stand()
  if (s) {
    for (const [feld, gut] of Object.entries(BRAUCHBAR)) {
      if (zuerst[feld] === undefined && gut(s[feld])) {
        zuerst[feld] = { ms: Date.now() - beginn, wert: s[feld] }
      }
    }
  }
  await warte(100)
}

console.log('\n  ERSTER BRAUCHBARER WERT je Feld:')
for (const feld of Object.keys(BRAUCHBAR)) {
  const z = zuerst[feld]
  console.log(
    z
      ? `    ${feld.padEnd(18)} nach ${String(z.ms).padStart(5)} ms   = ${String(z.wert).slice(0, 40)}`
      : `    ${feld.padEnd(18)} KAM NICHT in ${DAUER_S} s`,
  )
}

const d = zuerst.duration
console.log(
  `\n  BEFUND: ${
    d
      ? `\`duration\` taugt als Beleg — steht nach ${d.ms} ms.`
      : '`duration` KAM NICHT. Der Beleg traegt hier nicht; `titelUndStelle` faellt auf den einen blinden Sprung zurueck (so gebaut).'
  }`,
)

if (!NUR_ZUSEHEN) {
  await befehl('stop')
  console.log('  Wieder angehalten.')
}
process.exit(0)
