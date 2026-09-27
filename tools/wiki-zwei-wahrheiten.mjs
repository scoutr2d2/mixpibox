#!/usr/bin/env node
/**
 * Zwei Wahrheiten über dieselbe Sache — Wiki-Einträge, die sich nicht kennen.
 *
 * WAS tools/doku-luecken-probe.sh NICHT SIEHT: die zählt. Endpunkte, Seiten,
 * Konfigurationsfelder, Plugins — kommt der Name irgendwo vor, ist die Lücke zu.
 * Eine Zeile, die eine ANDERE Zeile widerlegt, ist für sie unsichtbar; beide
 * Namen kommen ja vor. Genau das ist der teuerste Doku-Schaden: der Leser
 * findet eine Antwort, und es ist die alte.
 *
 * DIE HEURISTIK: zwei Einträge, deren `match:`-Muster sich in mindestens
 * ZWEI aussagekräftigen Wörtern überschneiden, reden über dieselbe Sache.
 * Stehen sie dann NICHT in `related:` des jeweils anderen, hat niemand
 * entschieden, welcher gilt. Das ist kein Beweis für einen Widerspruch —
 * es ist die Liste der Stellen, an denen einer stehen KANN.
 *
 * WARUM `match:` UND NICHT DER RUMPF: `match:` ist die Frage, auf die der
 * Eintrag antworten will. Zwei Einträge mit ähnlichem Rumpf können
 * verschiedene Fragen beantworten (Ursache hier, Werkzeug dort); zwei mit
 * ähnlichem `match:` werden demselben Sucher vorgelegt — und der liest den
 * ersten.
 *
 * REIHENFOLGE IST ALTER: pack.yaml waechst hinten. Der spaetere Eintrag ist
 * der juengere und muss den aelteren nennen, nicht umgekehrt — deshalb steht
 * in der Ausgabe der juengere zuerst.
 *
 * Aufruf:
 *   node tools/wiki-zwei-wahrheiten.mjs [--wiki llmwiki/pack.yaml] [--min 2]
 *        [--nur-entscheidung]   nur kind: entscheidung gegen entscheidung
 * Rueckgabe: 0 = nichts gefunden, 1 = Paare gefunden (nicht als Fehler
 * gedacht — als Leseliste).
 */

import { readFileSync } from 'node:fs'

const arg = (name, vorgabe) => {
  const i = process.argv.indexOf(name)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : vorgabe
}
const WIKI = arg('--wiki', 'llmwiki/pack.yaml')
const MIN = Number(arg('--min', '2'))
const NUR_ENTSCHEIDUNG = process.argv.includes('--nur-entscheidung')

/**
 * Woerter, die ueberall vorkommen und deshalb nichts verbinden. Ohne diese
 * Liste haengt jeder Eintrag an jedem: „nicht", „box", „fehler" stehen in
 * dreihundert Mustern.
 */
const LEER = new Set([
  'nicht', 'kein', 'keine', 'und', 'oder', 'der', 'die', 'das', 'den', 'dem',
  'ein', 'eine', 'einen', 'einem', 'ist', 'sind', 'wird', 'werden', 'wurde',
  'box', 'mupibox', 'mixpibox', 'fehler', 'error', 'failed', 'warum', 'wie',
  'was', 'wer', 'wo', 'mit', 'ohne', 'auf', 'aus', 'von', 'zum', 'zur', 'fuer',
  'sich', 'nur', 'noch', 'schon', 'mehr', 'alle', 'beim', 'bei', 'vor', 'nach',
])

/**
 * Der Parser liest ZEILENWEISE und nur die Felder, auf die es ankommt.
 * Ein echter YAML-Parser waere hier die schlechtere Wahl: pack.yaml ist
 * 2,5 MB, und jeder Rumpf ist Freitext mit Zeichen, an denen strenge Parser
 * stolpern (das Pack wird ausdruecklich als Textanhang gepflegt, nie per
 * safe_dump neu geschrieben).
 */
function einträgeLesen(pfad) {
  const zeilen = readFileSync(pfad, 'utf8').split('\n')
  const liste = []
  let jetzt = null
  for (let n = 0; n < zeilen.length; n++) {
    const z = zeilen[n]
    const idNeu = z.match(/^ {2}- (?:id: (\S+)|kind: (\S+))/)
    if (idNeu) {
      if (jetzt) liste.push(jetzt)
      jetzt = { id: idNeu[1] ?? '', kind: idNeu[2] ?? '', title: '', match: '', related: '', zeile: n + 1 }
      continue
    }
    if (!jetzt) continue
    const feld = z.match(/^ {4}(id|kind|title|match|related): (.*)$/)
    if (feld) jetzt[feld[1]] = feld[2].trim()
  }
  if (jetzt) liste.push(jetzt)
  return liste.filter((e) => e.id)
}

/** Die aussagekraeftigen Woerter eines `match:`-Musters. */
function woerter(muster) {
  return new Set(
    muster
      .replace(/^["']|["']$/g, '')
      .toLowerCase()
      .split(/[^a-z0-9äöüß_/-]+/)
      .filter((w) => w.length >= 4 && !LEER.has(w)),
  )
}

const einträge = einträgeLesen(WIKI)
const mitMuster = einträge.filter((e) => e.match)
const paare = []

for (let i = 0; i < mitMuster.length; i++) {
  for (let j = i + 1; j < mitMuster.length; j++) {
    const a = mitMuster[i]
    const b = mitMuster[j]
    if (NUR_ENTSCHEIDUNG && !(a.kind === 'entscheidung' && b.kind === 'entscheidung')) continue
    // Kennen sie einander schon, hat jemand entschieden — dann ist nichts offen.
    if (a.related.includes(b.id) || b.related.includes(a.id)) continue
    const wa = woerter(a.match)
    const wb = woerter(b.match)
    const gemein = [...wa].filter((w) => wb.has(w))
    if (gemein.length >= MIN) paare.push({ jung: b, alt: a, gemein })
  }
}

// Der juengste Eintrag zuerst: was gerade dazukam, ist das, was jemand
// vergessen haben kann zu verknuepfen.
paare.sort((x, y) => y.jung.zeile - x.jung.zeile)

console.log(`── ${einträge.length} Eintraege, ${mitMuster.length} mit match:, ${paare.length} Paare ohne Verknuepfung ──\n`)
for (const p of paare) {
  console.log(`  gemeinsam: ${p.gemein.join(', ')}`)
  console.log(`    JUENGER  ${p.jung.id}  (Zeile ${p.jung.zeile}, ${p.jung.kind})`)
  console.log(`             ${p.jung.title}`)
  console.log(`    aelter   ${p.alt.id}  (Zeile ${p.alt.zeile}, ${p.alt.kind})`)
  console.log(`             ${p.alt.title}\n`)
}

if (paare.length === 0) console.log('  nichts offen.')
process.exit(paare.length ? 1 : 0)
