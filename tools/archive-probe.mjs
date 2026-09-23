#!/usr/bin/env node
/**
 * ARCHIVE-PROBE — was gibt das Internet Archive her, und in welcher Form?
 *
 * ══ WOZU ═══════════════════════════════════════════════════════════════════
 * Vor `plugins/mixpi-archive` muss dreierlei feststehen, und zwar GEMESSEN:
 *
 *   1. Wie sucht man, ohne Anmeldung? (advancedsearch.php, JSON)
 *   2. Was steht in den Metadaten eines Werks, und welche Dateien sind
 *      wirklich Ton? Ein Werk enthaelt oft dreissig Dateien, von denen die
 *      Haelfte Bilder, Pruefsummen und XML sind.
 *   3. Reicht das, um eine geordnete Folgenliste zu bauen (inhalt(), E78)?
 *
 * DIE FALLE, DIE ES ZU MESSEN GILT: das Archiv fuehrt fast jedes Stueck
 * MEHRFACH — dieselbe Aufnahme als MP3, als FLAC, als Ogg. Wer die Dateiliste
 * ungefiltert nimmt, baut ein Hoerspiel mit jeder Folge dreimal.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *     node tools/archive-probe.mjs                      # Suche + ein Werk
 *     node tools/archive-probe.mjs --suche "hoerspiel"  # eigene Suche
 *     node tools/archive-probe.mjs --werk <identifier>  # ein Werk auseinandernehmen
 *
 * Es AENDERT NICHTS und braucht keinen Schluessel.
 */

const SUCHE = 'https://archive.org/advancedsearch.php'
const METADATEN = 'https://archive.org/metadata'
const FRIST_MS = 20000

async function holen(adresse) {
  const ab = new AbortController()
  const uhr = setTimeout(() => ab.abort(), FRIST_MS)
  const start = Date.now()
  try {
    const antwort = await fetch(adresse, { signal: ab.signal, headers: { accept: 'application/json' } })
    if (!antwort.ok) throw new Error(`HTTP ${antwort.status}`)
    return { daten: await antwort.json(), ms: Date.now() - start }
  } finally {
    clearTimeout(uhr)
  }
}

function sucheAdresse(begriff, anzahl = 5) {
  const felder = ['identifier', 'title', 'creator', 'year', 'mediatype', 'downloads', 'language']
  const p = new URLSearchParams()
  // `mediatype:audio` ist der halbe Filter — ohne ihn kommen Buecher und Filme.
  p.set('q', `${begriff} AND mediatype:audio`)
  for (const f of felder) p.append('fl[]', f)
  p.set('rows', String(anzahl))
  p.set('page', '1')
  p.set('output', 'json')
  p.set('sort[]', 'downloads desc')
  return `${SUCHE}?${p}`
}

async function suchen(begriff, anzahl) {
  const { daten, ms } = await holen(sucheAdresse(begriff, anzahl))
  const treffer = daten?.response?.docs ?? []
  console.log(`Suche "${begriff}": ${daten?.response?.numFound ?? 0} Treffer, ${treffer.length} gezeigt (${ms} ms)\n`)
  for (const t of treffer) {
    console.log(`  ${t.identifier}`)
    console.log(`     ${t.title}`)
    console.log(`     ${[t.creator, t.year, t.language].filter(Boolean).join(' · ')} — ${t.downloads ?? 0} Abrufe`)
  }
  console.log()
  return treffer
}

async function werkZerlegen(kennung) {
  const { daten, ms } = await holen(`${METADATEN}/${encodeURIComponent(kennung)}`)
  const dateien = daten?.files ?? []
  const meta = daten?.metadata ?? {}
  console.log(`${'─'.repeat(70)}\nWerk ${kennung} (${ms} ms)`)
  console.log(`  Titel : ${meta.title}`)
  console.log(`  Wer   : ${meta.creator ?? '—'}`)
  console.log(`  Lizenz: ${meta.licenseurl ?? meta.rights ?? '—'}`)
  console.log(`  Server: ${daten.server} · Verzeichnis ${daten.dir}`)
  console.log(`  Dateien insgesamt: ${dateien.length}`)

  // Welche Formate liegen ueberhaupt herum?
  const nachFormat = new Map()
  for (const d of dateien) {
    const f = String(d.format ?? '?')
    nachFormat.set(f, (nachFormat.get(f) ?? 0) + 1)
  }
  console.log('  Formate:')
  for (const [f, n] of [...nachFormat].sort((a, b) => b[1] - a[1])) console.log(`     ${String(n).padStart(3)}x ${f}`)

  // DIE DUBLETTENFRAGE: wie viele EIGENSTAENDIGE Stuecke sind es wirklich?
  const toene = dateien.filter((d) => /^(VBR MP3|128Kbps MP3|64Kbps MP3|MP3)$/i.test(String(d.format ?? '')))
  const originale = new Set(toene.map((d) => String(d.original ?? d.name)))
  console.log(`\n  MP3-Dateien: ${toene.length}, davon eigenstaendige Stuecke: ${originale.size}`)
  console.log('  (weichen die Zahlen ab, fuehrt das Archiv dieselbe Aufnahme mehrfach)')
  console.log('\n  Die ersten fuenf MP3-Dateien:')
  for (const d of toene.slice(0, 5)) {
    const laenge = d.length ? `${Math.round(Number(d.length))} s` : '—'
    console.log(`     ${d.name}`)
    console.log(`        Titel "${d.title ?? '—'}"  Spur ${d.track ?? '—'}  Dauer ${laenge}  Format ${d.format}`)
  }
  console.log(`\n  Abspieladresse waere: https://archive.org/download/${kennung}/<name>`)
}

async function main() {
  const argumente = process.argv.slice(2)
  const suchIndex = argumente.indexOf('--suche')
  const werkIndex = argumente.indexOf('--werk')
  console.log(`Archive-Probe\n${'═'.repeat(70)}\n`)

  if (werkIndex >= 0) {
    await werkZerlegen(argumente[werkIndex + 1])
    return
  }
  const begriff = suchIndex >= 0 ? argumente[suchIndex + 1] : 'hörspiel'
  const treffer = await suchen(begriff, 5)
  if (treffer.length) await werkZerlegen(treffer[0].identifier)
}

main().catch((f) => {
  console.error(`\nFEHLGESCHLAGEN: ${f.message}`)
  process.exit(1)
})
