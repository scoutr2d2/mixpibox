#!/usr/bin/env node
/**
 * ALLE ZEICHEN AUF EINEM BOGEN — in der Groesse, in der sie an der Box stehen.
 *
 * ══ WOZU ═══════════════════════════════════════════════════════════════════
 * Seit dem 07.08.2026 zeichnet die Oberflaeche ihre Zeichen selbst (Karte
 * `ZEICHEN` in NewDesign/app.js), weil die Box nur DejaVu kennt und jedes Emoji
 * als leeres Rechteck stand.
 *
 * OB EIN GEZEICHNETES ZEICHEN ETWAS TAUGT, SAGT KEIN ZAHLENWERT. Man muss es
 * ansehen — und zwar in der Groesse, in der es dasteht (22 px in einer 40-px-
 * Scheibe), nicht als Vorlage auf 200 px. Genau dort entscheidet sich, ob aus
 * drei Strichen ein Lautsprecher wird oder ein Fleck.
 *
 * DEN FEHLER, DEN DIESER BOGEN FINDET, findet kein anderes Werkzeug: ZWEI
 * ZEICHEN, DIE GLEICH AUSSEHEN. Jedes fuer sich ist tadellos, und in der Liste
 * der Namen faellt nichts auf. Nebeneinander sieht man es sofort. Beim ersten
 * Lauf hier standen Zahnrad und Sonne als dasselbe Sternchen da.
 *
 * ══ WAS ES TUT ═════════════════════════════════════════════════════════════
 * Es liest die Karte aus app.js — kein zweiter Vorrat, der veralten koennte —
 * und schreibt eine HTML-Datei: jedes Zeichen in seiner Scheibe, hell und
 * dunkel nebeneinander, dazu eine Reihe in der Zeile, in der es wirklich sitzt.
 *
 * ES AENDERT NICHTS und ruft die Box nicht an. Es liest eine Datei und schreibt
 * eine, deren Pfad man selbst angibt.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *     node tools/zeichen-musterbogen.mjs --aus /tmp/zeichen.html
 *     dann die Datei im Browser oeffnen (file://…)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HIER = dirname(fileURLToPath(import.meta.url))
const APP = join(HIER, '..', 'NewDesign', 'app.js')

const opt = (name, vorgabe) => {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : vorgabe
}

/**
 * DIE KARTE AUS app.js HOLEN, OHNE app.js AUSZUFUEHREN.
 *
 * app.js ist eine Oberflaeche und kein Modul; sie im Knoten laufen zu lassen
 * hiesse, ein halbes DOM nachzubauen. Der Abschnitt ist aber ein schlichtes
 * Objektliteral mit einer Zeile je Eintrag (mehrzeilige Werte mit `+`
 * verbunden) — das laesst sich lesen.
 *
 * WIRFT, WENN NICHTS HERAUSKOMMT. Ein Bogen mit null Zeichen saehe aus wie
 * „alles in Ordnung, es gibt nur nichts zu sehen".
 */
/**
 * Die Symbole der Kategorienleiste — `ZEICHEN` holt zwei davon per
 * `katSymbol('…')`, statt sie abzumalen. Wer sie hier nicht aufloest, malte
 * auf den Bogen den Namen der Kategorie statt ihres Bildes.
 */
function kategorienLesen(quelle) {
  const karte = new Map()
  const muster = /id:\s*'([a-z]+)',[\s\S]{0,200}?symbol:\s*'([^']*)'/g
  let t
  while ((t = muster.exec(quelle)) !== null) karte.set(t[1], t[2])
  return karte
}

function karteLesen(quelle) {
  const kategorien = kategorienLesen(quelle)
  const von = quelle.indexOf('const ZEICHEN = {')
  if (von < 0) throw new Error('In app.js steht kein `const ZEICHEN = {` — wurde die Karte umbenannt?')
  const bis = quelle.indexOf('\n  }\n', von)
  if (bis < 0) throw new Error('Das Ende der Karte war nicht zu finden.')
  const block = quelle.slice(von + 'const ZEICHEN = {'.length, bis)

  const karte = new Map()
  // Eintrag = Name, Doppelpunkt, dann eine oder mehrere mit + verbundene
  // Zeichenketten bis zum Komma am Zeilenende.
  const muster = /^\s{4}'?([a-z][a-z0-9-]*)'?:\s*([\s\S]*?),\s*$/gm
  let t
  while ((t = muster.exec(block)) !== null) {
    const geholt = /^katSymbol\('([a-z]+)'\)$/.exec(t[2].trim())
    if (geholt) {
      const s = kategorien.get(geholt[1])
      if (!s) throw new Error(`ZEICHEN.${t[1]} holt die Kategorie „${geholt[1]}" — die gibt es in app.js nicht.`)
      karte.set(t[1], s)
      continue
    }
    const stuecke = [...t[2].matchAll(/'([^']*)'/g)].map((m) => m[1])
    if (stuecke.length) karte.set(t[1], stuecke.join(''))
  }
  if (!karte.size) throw new Error('Die Karte wurde gefunden, aber kein einziger Eintrag daraus gelesen.')
  return karte
}

const karte = karteLesen(readFileSync(APP, 'utf8'))

// KEIN GEGENHAKEN IN DIESEM BLOCK: er wird zu einer HTML-Datei zusammengesetzt.
const huelle = (koerper) =>
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  koerper +
  '</svg>'

const scheiben = [...karte]
  .map(([name, koerper]) => '<figure><div class="scheibe">' + huelle(koerper) + '</div><figcaption>' + name + '</figcaption></figure>')
  .join('\n')

const zeilen = [...karte]
  .map(
    ([name, koerper]) =>
      '<div class="zeile"><div class="scheibe">' +
      huelle(koerper) +
      '</div><div><b>' +
      name +
      '</b><small>So sitzt es in der Zeile — 40-px-Scheibe, 22-px-Zeichen.</small></div></div>',
  )
  .join('\n')

const html = [
  '<!doctype html><meta charset="utf-8"><title>Zeichen-Musterbogen</title>',
  '<style>',
  'body{font:14px/1.4 system-ui,sans-serif;margin:0;padding:24px;background:#FBF7F0;color:#241C33}',
  'h2{margin:28px 0 10px;font-size:15px}',
  '.bogen{display:flex;flex-wrap:wrap;gap:14px}',
  'figure{margin:0;width:76px;text-align:center}',
  'figcaption{font-size:10px;margin-top:5px;word-break:break-word;opacity:.75}',
  '.scheibe{width:40px;height:40px;display:grid;place-items:center;border-radius:13px;',
  'background:#EDE6DC;margin:0 auto}',
  '.scheibe svg{width:22px;height:22px;display:block}',
  '.dunkel{background:#151020;color:#F2EDFA;margin:0 -24px;padding:24px}',
  '.dunkel .scheibe{background:#2B2440}',
  '.an .scheibe{background:#d9f2e4;color:#1b6b43}',
  '.dunkel .an .scheibe{background:#1b3a2a;color:#4fd07f}',
  '.zeilen{max-width:560px}',
  '.zeile{display:flex;align-items:center;gap:12px;padding:6px 12px;border-radius:16px;background:#F3EDE4;margin-bottom:6px}',
  'small{display:block;font-size:11px;opacity:.7}',
  '</style>',
  '<h2>' + karte.size + ' Zeichen — hell</h2><div class="bogen">' + scheiben + '</div>',
  '<h2>dieselben im Zustand „an"</h2><div class="an"><div class="bogen">' + scheiben + '</div></div>',
  '<div class="dunkel">',
  '<h2>dunkel</h2><div class="bogen">' + scheiben + '</div>',
  '<h2>dunkel, Zustand „an"</h2><div class="an"><div class="bogen">' + scheiben + '</div></div>',
  '</div>',
  '<h2>in der Zeile</h2><div class="zeilen">' + zeilen + '</div>',
].join('\n')

const aus = opt('aus', '/tmp/zeichen-musterbogen.html')
writeFileSync(aus, html)
console.log(`${karte.size} Zeichen geschrieben nach ${aus}`)
