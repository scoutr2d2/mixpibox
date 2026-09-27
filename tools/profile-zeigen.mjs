#!/usr/bin/env node
/**
 * WOZU
 *   Sagt, WEM auf einer Box was gehoert. Seit der Mehrbenutzer-Vorbereitung
 *   (02.08.2026) haengen Verlauf und Kinderzeitverbrauch an einer Kennung;
 *   ohne Auswahl heisst sie `gast`. Von aussen sieht man davon NICHTS — die
 *   Oberflaeche verhaelt sich genau wie vorher, und das ist Absicht. Genau
 *   deshalb braucht es ein Werkzeug: Sonst faellt ein falsch zugeordneter
 *   Topf erst auf, wenn jemand nach Wochen bemerkt, dass „oft gehoert" leer
 *   ist.
 *
 *   Es meldet vier Dinge:
 *     1. welche Profile es gibt und wer gerade dran ist
 *     2. je Profil die Groesse des Verlaufs und den obersten Eintrag
 *     3. je Profil den Kinderzeitstand (verbraucht, Rest, Grund)
 *     4. WAS NICHT GETRENNT IST — damit niemand mehr Trennung annimmt, als
 *        gebaut wurde: resume.json (Weiterhoeren), darstellung.json, die
 *        Lautstaerkegrenzen und die Bibliothek sind weiter box-weit.
 *
 *   KEINE ZWEITE WAHRHEIT: es fragt die Box ueber ihre eigenen Endpunkte und
 *   rechnet nichts nach. Ein Werkzeug, das die Dateinamen selbst
 *   zusammensetzte, zeigte irgendwann etwas anderes als der Server — und man
 *   glaubte ihm.
 *
 *   DIE ATTRAPPE LUEGT DURCH WEGLASSEN: `tools/neu-vorschau.mjs` beantwortet
 *   /api/profile und /api/gespielt, aber KEINE Kinderzeit. Fehlt ein
 *   Endpunkt, steht hier ausdruecklich „nicht beantwortet" statt einer Null.
 *   Eine Null saehe aus wie „nichts verbraucht" und waere die dritte
 *   Wiederholung derselben Falle.
 *
 * WAS ES AENDERT
 *   NICHTS. Nur GET-Abrufe. Kein POST, kein PUT, kein Schreiben auf der Box.
 *
 * AUFRUF
 *   node tools/profile-zeigen.mjs                       # Box 192.168.178.169:8200
 *   node tools/profile-zeigen.mjs --box 192.168.2.5
 *   node tools/profile-zeigen.mjs --url http://localhost:8477   # Vorschau
 *   node tools/profile-zeigen.mjs --json                # zum Weiterverarbeiten
 */

const args = process.argv.slice(2)
function opt(name, vorgabe) {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : vorgabe
}
const nurJson = args.includes('--json')
const basis = opt('--url', `http://${opt('--box', '192.168.178.169')}:8200`).replace(/\/+$/, '')

/**
 * Ein GET — und zwar so, dass ein FEHLENDER Endpunkt sich von einer leeren
 * Antwort unterscheidet. Das ist der ganze Punkt: `null` heisst „nicht
 * beantwortet", nicht „nichts da".
 */
async function hole(pfad) {
  try {
    const r = await fetch(`${basis}${pfad}`, { signal: AbortSignal.timeout(8000) })
    if (!r.ok) return { fehler: `HTTP ${r.status}` }
    return { wert: await r.json() }
  } catch (e) {
    return { fehler: String(e?.message || e) }
  }
}

function zeit(ms) {
  if (!ms) return '—'
  return new Date(ms).toLocaleString('de-DE')
}

const profile = await hole('/api/profile')
if (profile.fehler) {
  console.error(`Kein /api/profile von ${basis}: ${profile.fehler}`)
  console.error('Auf einer Box ohne diese Aenderung ist das der erwartete Befund.')
  process.exit(2)
}

const stand = profile.wert
const bericht = { basis, aktiv: stand.aktiv, profile: [] }

for (const p of stand.profile || []) {
  const verlauf = await hole(`/api/gespielt?max=50&profil=${encodeURIComponent(p.kennung)}`)
  const kz = await hole(`/api/kinderzeit/stand?profil=${encodeURIComponent(p.kennung)}`)
  const zuletzt = verlauf.wert?.zuletzt || []
  bericht.profile.push({
    ...p,
    dran: p.kennung === stand.aktiv,
    verlauf: verlauf.fehler ? null : { eintraege: zuletzt.length, oben: zuletzt[0] || null },
    verlaufFehler: verlauf.fehler || null,
    kinderzeit: kz.fehler ? null : kz.wert,
    kinderzeitFehler: kz.fehler || null,
  })
}

if (nurJson) {
  console.log(JSON.stringify(bericht, null, 2))
  process.exit(0)
}

console.log(`\nBox: ${basis}`)
console.log(`Profile: ${bericht.profile.length}    dran: ${bericht.aktiv}\n`)

for (const p of bericht.profile) {
  console.log(`${p.dran ? '▸' : ' '} ${p.kennung.padEnd(12)} ${p.name}   [${p.figur}]`)
  if (p.verlaufFehler) {
    console.log(`    Verlauf     nicht beantwortet (${p.verlaufFehler})`)
  } else {
    const o = p.verlauf.oben
    console.log(`    Verlauf     ${String(p.verlauf.eintraege).padStart(3)} Eintraege` + (o ? `, oben: ${o.title || o.key} (${o.anzahl}x, ${zeit(o.zuletzt)})` : ''))
  }
  if (p.kinderzeitFehler) {
    console.log(`    Kinderzeit  nicht beantwortet (${p.kinderzeitFehler})`)
  } else {
    const k = p.kinderzeit
    const rest = k.restMin === null ? 'unbegrenzt' : `${k.restMin} min Rest`
    console.log(`    Kinderzeit  ${k.aktiv ? 'an' : 'aus'}, ${k.verbrauchtMin} min verbraucht, ${rest}, ${k.erlaubt ? 'erlaubt' : `gesperrt (${k.grund})`}`)
  }
  console.log('')
}

// STEHT HIER, WEIL ES SONST NIEMAND FRAGT: Wer eine Liste getrennter Toepfe
// sieht, nimmt an, alles sei getrennt. Ist es nicht.
console.log('Weiter BOX-WEIT, nicht je Profil:')
console.log('  resume.json / active_resume.json   Weiterhoeren (BACKLOG E18, Stufe 2)')
console.log('  darstellung.json                   Aussehen der Oberflaeche')
console.log('  mupibox.maxVolume/startVolume      Lautstaerkegrenzen (scripts/mupi-lautstaerke.sh)')
console.log('  data.json                          die Bibliothek — bewusst gemeinsam')
console.log('  mupibox_neu_licht_v1               hell/dunkel: gehoert dem Raum, nicht dem Kind')
console.log('')
