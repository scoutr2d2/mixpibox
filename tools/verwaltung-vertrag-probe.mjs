#!/usr/bin/env node
/**
 * VERWALTUNG-VERTRAG-PROBE — schickt die Verwaltung, was der Server annimmt?
 *
 * ══ DIE LUECKE, DIE ES SCHLIESST (23.08.2026) ═══════════════════════════════
 * Der ARD-Aufnehmen-Knopf schickte seinen Eintrag in `{ eintrag: {...} }`
 * verpackt. `POST /api/medien` liest `req.body` DIREKT — also HTTP 400, und
 * der Knopf hat NIE einen Eintrag angelegt.
 *
 * WARUM KEIN ZEUGE DAS SAH: die Verwaltung prueft ihre Aufrufe gegen eine
 * ATTRAPPE (HttpTestingController). Eine Attrappe nimmt jede Form an — sie
 * kann gar nicht merken, dass die Form falsch ist. Der Fehler fiel erst am
 * GERAET auf, und erst, nachdem er in zwei neue Knoepfe kopiert war.
 *
 * ══ WAS DIESES WERKZEUG TUT ═════════════════════════════════════════════════
 * Es liest die Quelltexte der Verwaltung, sucht jeden Aufruf an eine Route
 * mit bekanntem Vertrag und beurteilt die FORM des Rumpfes — statisch, ohne
 * Netz, ohne Box.
 *
 *   FLACH        Objektliteral mit den Feldern, die die Route liest      ok
 *   VERPACKT     ein Literal, das den Eintrag in EIN Feld steckt        FEHL
 *   WEITERGABE   eine Variable (`s.vorschlag`) — statisch nicht         Hinweis
 *                entscheidbar; der ERZEUGER gehoert geprueft
 *
 * ES RAET NICHT. Was es nicht entscheiden kann, meldet es als Hinweis und
 * nennt die Stelle — ein Pruefer, der bei Unklarheit Alarm schlaegt, wird
 * ignoriert (dieselbe Lehre wie bei tools/plugin-kette-probe.mts).
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *     node tools/verwaltung-vertrag-probe.mjs
 *     node tools/verwaltung-vertrag-probe.mjs --leise   # nur Fehler
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const WURZEL = path.resolve(HIER, '..')

/**
 * DIE VERTRAEGE, die dieses Werkzeug kennt.
 *
 * Sie stehen hier ABGESCHRIEBEN und nicht abgeleitet, und das ist Absicht:
 * abgeleitet waeren sie dieselbe Annahme zweimal. Wer eine Route aendert,
 * aendert auch diese Zeile — und der Zeuge in
 * `medien-vertrag.integration.spec.ts` haelt die Route dagegen fest.
 */
const VERTRAEGE = [
  {
    route: '/api/medien',
    methode: 'post',
    /** Felder, die im Rumpf GANZ OBEN stehen muessen. */
    pflicht: ['type', 'title'],
    quelle: 'server.ts: neuerEintrag(req.body) — der Eintrag steht FLACH im Rumpf',
  },
]

function dateien(ordner) {
  const raus = []
  for (const e of fs.readdirSync(ordner, { withFileTypes: true })) {
    const p = path.join(ordner, e.name)
    if (e.isDirectory()) raus.push(...dateien(p))
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) raus.push(p)
  }
  return raus
}

/** Den Rumpf eines Aufrufs ab der oeffnenden Klammer klammerweise abgreifen. */
function rumpfAb(text, start) {
  let tiefe = 0
  for (let i = start; i < text.length && i < start + 4000; i++) {
    const z = text[i]
    if (z === '(' || z === '{' || z === '[') tiefe++
    else if (z === ')' || z === '}' || z === ']') {
      tiefe--
      if (tiefe === 0) return text.slice(start, i + 1)
    }
  }
  return text.slice(start, start + 400)
}


/**
 * Die Schluessel der OBERSTEN Ebene eines Objektliterals.
 *
 * Klammerweise gezaehlt, nicht per Regex — der Unterschied zwischen
 * `{ type: … }` und `{ eintrag: { type: … } }` liegt genau in der TIEFE, und
 * eine Regex sieht die nicht. Zeichenketten werden uebersprungen, damit ein
 * Doppelpunkt in einem Text (`'http://…'`) keinen Schluessel erfindet.
 */
function obersteSchluessel(text) {
  const raus = []
  let tiefe = 0
  let wort = ''
  for (let i = 0; i < text.length; i++) {
    const z = text[i]
    if (z === '\'' || z === '"' || z === '`') {
      const ende = text.indexOf(z, i + 1)
      i = ende < 0 ? text.length : ende
      wort = ''
      continue
    }
    if (z === '{' || z === '[' || z === '(') { tiefe++; wort = ''; continue }
    if (z === '}' || z === ']' || z === ')') { tiefe--; wort = ''; continue }
    if (tiefe !== 1) continue
    if (z === ':') { if (wort.trim()) raus.push(wort.trim()); wort = ''; continue }
    if (z === ',') { wort = ''; continue }
    wort += z
  }
  return raus
}

let fehler = 0
let hinweise = 0
const leise = process.argv.includes('--leise')

console.log(`Verwaltung gegen ${VERTRAEGE.length} bekannte Vertraege\n${'─'.repeat(70)}\n`)

for (const v of VERTRAEGE) {
  console.log(`${v.methode.toUpperCase()} ${v.route}`)
  console.log(`   Vertrag: ${v.pflicht.join(', ')} ganz oben im Rumpf`)
  console.log(`   Quelle : ${v.quelle}\n`)

  const muster = new RegExp(`\\.${v.methode}\\(\\s*['\`]${v.route.replace(/\//g, '\\/')}['\`]\\s*,`, 'g')
  let gefunden = 0

  for (const datei of dateien(path.join(WURZEL, 'src/frontend-admin/src/app'))) {
    const text = fs.readFileSync(datei, 'utf8')
    const kurz = path.relative(WURZEL, datei)
    let m = muster.exec(text)
    muster.lastIndex = 0
    while ((m = muster.exec(text)) !== null) {
      gefunden++
      const zeile = text.slice(0, m.index).split('\n').length
      // Ab dem Komma den zweiten Parameter suchen.
      const nach = text.slice(m.index + m[0].length)
      const ersteszeichen = nach.search(/\S/)
      const rest = nach.slice(ersteszeichen)
      const ort = `${kurz}:${zeile}`

      if (!rest.startsWith('{')) {
        // Eine Variable — statisch nicht entscheidbar.
        const name = rest.split(/[,)\s]/)[0]
        hinweises(ort, name)
        continue
      }
      const rumpf = rumpfAb(rest, 0)
      /* DIE OBERSTE EBENE, UND ZWAR WIRKLICH. Hier stand zuerst eine Regex
       * `[{,]\s*type\s*:` — und die war BLIND fuer genau den Fehler, gegen
       * den dieses Werkzeug gebaut ist: bei `{ eintrag: { type: … } }`
       * trifft sie das `type` im INNEREN Objekt und meldet „flach".
       *
       * Die Gegenprobe hat es gezeigt (23.08.2026): der wieder eingebaute
       * Altfehler kam mit Rueckgabewert 0 durch. Ein Werkzeug, das falsche
       * Sicherheit gibt, ist schlimmer als keins. */
      const flach = v.pflicht.every((f) => obersteSchluessel(rumpf).includes(f))
      if (flach) {
        if (!leise) console.log(`   ok   ${ort}  flach`)
      } else {
        fehler++
        const oben = obersteSchluessel(rumpf)
        const verpackt = oben.length === 1 ? oben[0] : null
        console.log(` FEHL   ${ort}`)
        console.log(
          verpackt
            ? `        der Eintrag steckt in "${verpackt}" — die Route liest den Rumpf DIREKT`
            : `        es fehlen: ${v.pflicht.filter((f) => !new RegExp(`[{,]\\s*${f}\\s*:`).test(rumpf)).join(', ')}`,
        )
        console.log(`        ${rumpf.replace(/\s+/g, ' ').slice(0, 110)}`)
      }
    }
  }
  if (!gefunden) console.log('   (kein Aufruf gefunden)')
  console.log()
}

function hinweises(ort, name) {
  hinweises.gesehen ??= []
  hinweises.gesehen.push([ort, name])
  hinweise++
}

if (hinweises.gesehen?.length) {
  console.log('WEITERGEREICHT — statisch nicht entscheidbar, der Erzeuger gehoert geprueft:')
  for (const [ort, name] of hinweises.gesehen) console.log(`   ${ort}  ${name}`)
  console.log('   (bei Plugin-Vorschlaegen prueft das tools/plugin-kette-probe.mts)')
  console.log()
}

console.log('─'.repeat(70))
if (fehler) {
  console.log(`${fehler} Aufruf(e) mit falscher Form. Der Knopf tut dort NICHTS — und meldet es nicht.`)
  process.exit(1)
}
console.log(`Alle geprueften Aufrufe haben die richtige Form.${hinweise ? ` ${hinweise} weitergereicht.` : ''}`)
