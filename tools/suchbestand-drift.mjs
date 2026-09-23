/**
 * WAS DIE SUCHE DER VERWALTUNG NICHT KENNT — ALS LISTE, NICHT ALS DIFF.
 *
 * WOZU: `such-bestand.ts` ist eine ERZEUGTE Datei (aus
 * tools/verwaltung-suchbestand.mjs). Ob sie noch die ist, die aus den Seiten
 * herauskommt, prueft tools/verwaltung-suche-vollstaendig.test.mjs — aber
 * Zeichen fuer Zeichen ueber 20 000 Zeichen. Schlaegt sie an, sieht man einen
 * Textberg und nicht, WELCHE Schalter fehlen.
 *
 * Dieses Werkzeug beantwortet genau das: welche Eintraege wuerde die Erhebung
 * heute liefern, die in der abgelegten Datei fehlen (= von der Suche NICHT
 * gefunden), und welche stehen dort, die die Erhebung nicht mehr liefert
 * (= von Hand nachgetragen, und beim naechsten `--schreiben` weg).
 *
 * WAS ES AENDERT: nichts. Es liest nur. Zum Erneuern gibt es
 *     node tools/verwaltung-suchbestand.mjs --schreiben
 * — ABER: das wirft die von Hand nachgetragenen Zeilen mit weg. Die Spalte
 * „nur in der Datei" ist deshalb keine Nebensache, sondern die Verlustliste.
 *
 * AUFRUF
 *     node tools/suchbestand-drift.mjs           # Zusammenfassung + Listen
 *     node tools/suchbestand-drift.mjs --streng  # Rueckgabewert 1 bei Drift
 */
import { readFileSync } from 'node:fs'
import { bestandErheben, ZIELDATEI } from './verwaltung-suchbestand.mjs'

const streng = process.argv.includes('--streng')

/**
 * Die abgelegte Datei zurueck in Eintraege lesen. Bewusst mit einem Ausdruck
 * auf die erzeugte Zeilenform und NICHT mit einem TS-Parser: die Datei ist
 * erzeugt, ihre Form steht fest, und ein Parser waere hier eine Abhaengigkeit
 * fuer nichts. Zeilen, die nicht passen (Kopf, Import, Klammern, von Hand
 * eingefuegte Kommentare), fallen absichtlich durch.
 */
function abgelegteLesen() {
  const zeile = /\{ text: '(.*?)', seite: '(.*?)', weg: '(.*?)', bereich: '(.*?)'/
  const eintraege = []
  for (const z of readFileSync(ZIELDATEI, 'utf8').split('\n')) {
    const t = zeile.exec(z)
    if (t) eintraege.push({ text: t[1], seite: t[2], weg: t[3], bereich: t[4] })
  }
  return eintraege
}

const schluessel = (e) => JSON.stringify([e.weg, e.bereich, e.text])

const ausSeiten = bestandErheben().eintraege
const inDatei = abgelegteLesen()

const seitenSatz = new Set(ausSeiten.map(schluessel))
const dateiSatz = new Set(inDatei.map(schluessel))

const fehlen = ausSeiten.filter((e) => !dateiSatz.has(schluessel(e)))
const ueberzaehlig = inDatei.filter((e) => !seitenSatz.has(schluessel(e)))

const zeigen = (titel, liste, nachsatz) => {
  console.log(`\n${titel} (${liste.length})`)
  if (liste.length === 0) {
    console.log('  —')
    return
  }
  console.log(`  ${nachsatz}`)
  const jeSeite = new Map()
  for (const e of liste) jeSeite.set(e.seite, [...(jeSeite.get(e.seite) ?? []), e])
  for (const [seite, es] of [...jeSeite].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${seite} (${es.length}): ${es.map((e) => e.text).join(' · ')}`)
  }
}

console.log(`Aus den Seiten erhoben : ${ausSeiten.length}`)
console.log(`In ${ZIELDATEI.replace(/.*\/src\//, 'src/')} : ${inDatei.length}`)

zeigen(
  'NUR IN DEN SEITEN — die Suche findet sie nicht',
  fehlen,
  'gebaut, ausgeliefert, unauffindbar. Behebung: verwaltung-suchbestand.mjs --schreiben',
)
zeigen(
  'NUR IN DER DATEI — von Hand nachgetragen',
  ueberzaehlig,
  'beim naechsten --schreiben weg. Vorher in die Seite selbst bringen.',
)

if (streng && (fehlen.length || ueberzaehlig.length)) process.exit(1)
