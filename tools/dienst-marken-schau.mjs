#!/usr/bin/env node
/**
 * WOZU
 *   Die Dienst-Zeichen der neuen Oberflaeche (Spotify, Jellyfin, lokal, Radio,
 *   Podcast) gross und nebeneinander ansehen — hell wie dunkel, und auf
 *   Untergruenden, die ihnen wehtun. Auf einer 150-px-Kachel ist die Plakette
 *   29 px gross; ob die Figur darin noch etwas AUSSAGT, sieht man dort nicht.
 *
 *   Der zweite Zweck ist eine Pruefung, die kein Test findet: Zeichen (app.js)
 *   und Farbe (app.css) stehen an ZWEI Stellen. Kommt ein Dienst nur an einer
 *   davon an, faellt er still durch — die Plakette bleibt dann farblos oder
 *   leer, und auf einem Cover faellt das niemandem auf. Das Werkzeug meldet
 *   genau diesen Fall.
 *
 * WAS ES AENDERT
 *   Nichts am Bestand. Es LIEST NewDesign/app.js und NewDesign/app.css und
 *   schreibt eine einzelne HTML-Datei. Bewusst KEINE zweite Kopie der Zeichen:
 *   eine Schau, die ihre eigenen Pfade mitbraechte, zeigte irgendwann etwas
 *   anderes als die Oberflaeche — und man glaubte ihr.
 *
 * AUFRUF
 *   node tools/dienst-marken-schau.mjs                  # schreibt nach /tmp und nennt den Pfad
 *   node tools/dienst-marken-schau.mjs --ziel /tmp/x.html
 *   node tools/dienst-marken-schau.mjs --pruefen        # nur die Pruefung, kein HTML (Rueckgabe 1 bei Befund)
 */

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const HIER = fileURLToPath(new URL('.', import.meta.url))
const JS = join(HIER, '..', 'NewDesign', 'app.js')
const CSS = join(HIER, '..', 'NewDesign', 'app.css')

/**
 * Das Objektliteral `DIENST_MARKEN` aus app.js holen.
 *
 * NICHT PER ZEILENREGEL, SONDERN PER KLAMMERZAEHLUNG: die Pfade enthalten
 * geschweifte Klammern nicht, wohl aber Kommentare und Zeichenketten mit
 * allerlei Zeichen. Gezaehlt wird ab der oeffnenden Klammer, und Zeichenketten
 * werden dabei uebersprungen — sonst beendet ein `}` in einem Pfad die Suche zu
 * frueh und die Schau zeigte die halbe Wahrheit.
 *
 * KOMMENTARE WERDEN EBENFALLS UEBERSPRUNGEN, und das ist am 02.08.2026
 * teuer nachgeholt worden. Vorher zaehlten sie mit — und im Bestand steht
 * mitten im Objekt der Kommentar
 *
 *     // DIESELBE FIGUR WIE DER KATEGORIE-KNOPF „Radio" (KATEGORIEN, …)
 *
 * mit einem GERADEN Anfuehrungszeichen als Schluss der deutschen Klammer. Der
 * Zaehler hielt es fuer den Anfang einer Zeichenkette und las von dort an alles
 * als Text, bis irgendwo weiter unten in app.js zufaellig wieder ein `"` kam.
 * Dass es trotzdem lief, war Glueck: das schliessende `}` fiel zufaellig
 * ausserhalb. Ein paar Zeilen neuer Kommentar an ganz anderer Stelle kippten
 * das Glueck, und die Schau starb mit `SyntaxError: Unexpected token '}'` —
 * einer Meldung, die auf app.js zeigt, waehrend der Fehler hier liegt.
 */
function markenAus(quelle) {
  const anfang = quelle.indexOf('const DIENST_MARKEN = {')
  if (anfang === -1) throw new Error('DIENST_MARKEN nicht gefunden — hat app.js den Namen geaendert?')
  let i = quelle.indexOf('{', anfang)
  const start = i
  let tiefe = 0
  let inZk = null
  for (; i < quelle.length; i++) {
    const c = quelle[i]
    if (inZk) {
      if (c === '\\') i++
      else if (c === inZk) inZk = null
      continue
    }
    // Zeilenkommentar: bis zum Zeilenende, ohne ein Zeichen davon zu deuten.
    if (c === '/' && quelle[i + 1] === '/') {
      const ende = quelle.indexOf('\n', i)
      i = ende === -1 ? quelle.length : ende
      continue
    }
    // Blockkommentar: bis zum abschliessenden Stern-Schraegstrich.
    if (c === '/' && quelle[i + 1] === '*') {
      const ende = quelle.indexOf('*/', i + 2)
      i = ende === -1 ? quelle.length : ende + 1
      continue
    }
    if (c === "'" || c === '"' || c === '`') inZk = c
    else if (c === '{') tiefe++
    else if (c === '}') {
      tiefe--
      if (tiefe === 0) break
    }
  }
  const text = quelle.slice(start, i + 1)
  // Der Text stammt aus dem eigenen Arbeitsverzeichnis, nicht aus dem Netz.
  return new Function(`return ${text}`)()
}

/** Die Hintergrundfarben `.marke-<dienst>` aus app.css. */
function farbenAus(css) {
  const raus = {}
  const regel = /\.marke-([a-z]+)\s*\{[^}]*background:\s*([^;}]+)/g
  let t
  while ((t = regel.exec(css))) raus[t[1]] = t[2].trim()
  return raus
}

const marken = markenAus(await readFile(JS, 'utf8'))
const farben = farbenAus(await readFile(CSS, 'utf8'))

// ── Die Pruefung: haben alle Zeichen eine Farbe und alle Farben ein Zeichen?
const ohneFarbe = Object.keys(marken).filter((d) => !farben[d])
const ohneZeichen = Object.keys(farben).filter((d) => !marken[d])
for (const d of ohneFarbe) console.error(`FEHLT: '${d}' hat ein Zeichen in app.js, aber keine Farbe in app.css`)
for (const d of ohneZeichen) console.error(`FEHLT: '${d}' hat eine Farbe in app.css, aber kein Zeichen in app.js`)
const befund = ohneFarbe.length + ohneZeichen.length
if (!befund) console.error(`geprueft: ${Object.keys(marken).length} Dienste, Zeichen und Farbe passen zusammen`)

if (process.argv.includes('--pruefen')) process.exit(befund ? 1 : 0)

/** Eine Plakette so, wie app.css sie baut. */
function plakette(d, px) {
  const m = marken[d]
  return `<span class="marke" style="--px:${px}px;background:${farben[d] || '#888'}"><svg viewBox="${m.feld}">${m.pfad}</svg></span>`
}

// Die drei Groessen der clamp()-Spanne aus app.css: 22 px (kleinste Kachel),
// 29 px (der Entwurfspunkt 150 px * 0,19) und 34 px (Deckel). Dazu 4-fach, um
// die FIGUR zu beurteilen statt den Fleck.
const GROESSEN = [22, 29, 34, 116]

const namen = Object.keys(marken)
const zeilen = namen
  .map(
    (d) => `<tr>
      <th>${d}<br><small>${marken[d].name}</small><br><small>${farben[d] || '—'}</small></th>
      ${GROESSEN.map((g) => `<td><div class="feld">${plakette(d, g)}</div><small>${g} px</small></td>`).join('')}
      <td class="cover cover-gruen">${plakette(d, 29)}</td>
      <td class="cover cover-weiss">${plakette(d, 29)}</td>
      <td class="cover cover-schwarz">${plakette(d, 29)}</td>
    </tr>`,
  )
  .join('\n')

const seite = `<!doctype html><meta charset="utf-8"><title>Dienst-Zeichen</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 24px; background: #FFF7EC; color: #2E2A3B; }
  body.dunkel { background: #1A1726; color: #F2EDE4; }
  table { border-collapse: collapse; }
  th, td { padding: 8px 12px; text-align: center; vertical-align: middle; }
  th { text-align: left; font-weight: 700; }
  small { opacity: .6; font-weight: 400; }
  .feld { display: grid; place-items: center; min-height: 120px; }
  /* GENAU WIE app.css: Ring und Schatten gehoeren zur Erkennbarkeit, ohne sie
     beurteilt man ein anderes Zeichen als das, das auf der Box steht. */
  .marke {
    width: var(--px); height: var(--px); border-radius: 50%;
    display: grid; place-items: center;
    border: 1.5px solid rgba(255,255,255,.9);
    box-shadow: 0 1px 4px rgba(0,0,0,.55);
  }
  body.dunkel .marke { border-color: rgba(255,255,255,.55); box-shadow: 0 1px 5px rgba(0,0,0,.7); }
  .marke svg { width: 66%; height: 66%; display: block; }
  .cover { width: 90px; }
  .cover-gruen  { background: #1db954; }
  .cover-weiss  { background: #fff; }
  .cover-schwarz{ background: #111; }
  button { font: inherit; margin-bottom: 16px; padding: 6px 14px; border-radius: 10px; cursor: pointer; }
</style>
<button onclick="document.body.classList.toggle('dunkel')">hell / dunkel</button>
<p>Gelesen aus NewDesign/app.js (Zeichen) und NewDesign/app.css (Farbe) — keine zweite Kopie.<br>
Die drei rechten Spalten sind ABSICHTLICH gemeine Untergruende: Spotify-Gruen (verschluckt die gruene Plakette),
Weiss (verschluckt den Ring) und Schwarz (verschluckt den Schatten).</p>
<table>
  <tr><th></th>${GROESSEN.map((g) => `<th>${g} px</th>`).join('')}<th>auf gruen</th><th>auf weiss</th><th>auf schwarz</th></tr>
  ${zeilen}
</table>`

const ziel = process.argv.includes('--ziel')
  ? process.argv[process.argv.indexOf('--ziel') + 1]
  : join(tmpdir(), 'dienst-marken.html')
await writeFile(ziel, seite)
console.log(ziel)
