#!/usr/bin/env node
// EINE REGEL, EINE STELLE — vier Naehte in NewDesign/app.js bewachen.
//
// WOZU: Die Oberflaeche NewDesign/app.js ist 33 000 Zeilen gross und stand in
// KEINEM Pruefschritt. `tools/fetch-frist-schau.mjs` zaehlt nur die vier
// SERVER-Dateien (`DATEIEN` dort). Zwei Raenge des Audits vom 19.09.2026
// lagen beide hier, und beide sind dieselbe Sorte Fehler: eine Regel, die an
// mehreren Stellen steht, laeuft auseinander — und die Abweichung ist dann
// der Fehler, nicht das Vergessen.
//
// WARUM EIN ZWEITES WERKZEUG NEBEN `fetch-frist-schau.mjs`: Das Urteil ist
// ein anderes. Im Server ist jedes fristlose `fetch` eine Altlast auf einer
// Ratsche; hier gibt es seit 19.09.2026 EINEN erlaubten Weg fuer aendernde
// Anfragen (`sendeJson`), und ein handgeschriebenes `fetch` mit
// `method: POST|PUT|PATCH|DELETE` ist der Fehler — nicht seine Frist.
// Ausserdem urteilt das Werkzeug dort ueber ein FENSTER von 12 Zeilen und
// sieht eine Frist nicht, wenn eine Begruendung dazwischensteht; in der
// gefaehrlichen Richtung zaehlt dort das `signal:` eines TIEFER stehenden
// Aufrufs fuer den darueber. Dieses Werkzeug liest deshalb von der
// oeffnenden Klammer bis zur GEGENKLAMMER — mit einem Scanner, der
// Zeichenketten, Vorlagen-Literale und Kommentare ueberspringt.
//
// WAS ES PRUEFT (sieben Regeln, jede einzeln rot zu bekommen):
//
//   RANG 11 — die Frist fuer aendernde Anfragen
//   R1  Kein aenderndes `fetch(` ausserhalb von `sendeJson` ohne `signal:`.
//       GEMESSEN am 19.09.2026: 26 von 44 aendernden Rufen hatten keine.
//   R2  `sendeJson` selbst traegt `AbortSignal.timeout(`.
//   R3  `sendeJson` faengt ab (a), reicht die Frist als eigenen Ausgang
//       hinaus (b) und wirft selbst nicht (c) — das Muster von `funkTun`:
//       ein abgebrochener Ruf ist KEIN Fehlschlag.
//   R3d DIE NAHT WIRD GEFAHREN. Der Rumpf wird aus der Quelle geschnitten
//       und gegen eine Attrappe ausgefuehrt: Erfolg, 409, Frist, Netz weg.
//       R2/R3a-c lesen nur Text — und Text kann alles Verlangte enthalten
//       und trotzdem das Falsche tun (nachgestellt: `TimeoutErrorXX` liess
//       alle Textregeln gruen und machte aus jeder Frist einen Fehlschlag).
//
//   RANG 10 — dieselbe Regel an mehreren Stellen
//   R4  Die Helligkeit wird an EINER Stelle gestellt (`helligkeitStellen`).
//       Vorher stand `helligkeitSetzen` doppelt, mit vier Abweichungen.
//   R5  Die Dreizustands-Deutung von `/api/mupihat` steht an EINER Stelle
//       (`hatDeuten`). Vorher dreimal — das Audit sagte zweimal, und
//       verortete sie ausserdem im Server.
//   R6  Jeder „wie lange laeuft das"-Formatierer hat einen Waechter gegen
//       negative Werte. Ohne ihn stand „seit -5 s" am Schirm.
//
// AUFRUF
//   node tools/app-eine-stelle-schau.mjs            zeigt alle Stellen
//   node tools/app-eine-stelle-schau.mjs --alle     auch die von Hand, mit Frist
//   node tools/app-eine-stelle-schau.mjs --pruefen  still; Ende 1 bei Bruch
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = dirname(dirname(fileURLToPath(import.meta.url)))
const DATEI = 'NewDesign/app.js'
const AENDERND = /\bmethod\s*:\s*['"`](POST|PUT|PATCH|DELETE)['"`]/i

// Die Naht selbst: der eine erlaubte Weg. Wer sie umbenennt, aendert sie hier
// mit — der Name steht in der Wache, damit ein Umbenennen auffaellt und nicht
// still alle Regeln abschaltet.
const NAHT = 'sendeJson'

const quelle = readFileSync(join(WURZEL, DATEI), 'utf8')

/**
 * Kommentare und Zeichenketten durch Leerzeichen ersetzen, Zeilenumbrueche
 * behalten. Damit stimmen die Zeilennummern weiter, aber ein `fetch(` in
 * einem Kommentar oder in einem Vorlagen-Literal zaehlt nicht mehr mit
 * (Hausregel „kommentarbereinigt suchen").
 *
 * ZWEI AUSGABEN AUS EINEM LAUF, weil zwei verschiedene Fragen anliegen:
 *   `rein`  — alles ausgeloescht: die STRUKTUR (wo faengt ein Aufruf an, wo
 *             hoert er auf, was ist ueberhaupt Code).
 *   `ohneK` — nur die Kommentare ausgeloescht: der INHALT (`method: 'POST'`
 *             steht in Anfuehrungszeichen und waere in `rein` weg).
 * Beide sind zeichengleich lang wie die Quelle, die Offsets gelten in allen
 * dreien. Die Inhaltsfragen gegen `ohneK` und nicht gegen die Quelle zu
 * stellen ist der Punkt: sonst zaehlt ein zitierendes `signal:` in einem
 * Kommentar als Frist (Hausregel „Kommentar und Kompilat sind keine
 * Gegenstelle").
 *
 * KEIN REGEX-ZUSTAND: In diesem Baum steht kein `/…/`-Literal mit einer
 * unbalancierten Klammer oder einem Anfuehrungszeichen darin; der Aufwand
 * eines vollstaendigen Lexers lohnt hier nicht. Die Gegenprobe dazu ist
 * `node --check` auf der Datei plus der Vergleich der Roh-Zaehlung unten.
 */
function entkernen(text) {
  const aus = new Array(text.length)
  // Die Kommentar-Spannen werden nur GEMERKT und danach in einem Rutsch aus
  // `ohneK` ausgeloescht — sie inline in beiden Feldern zu fuehren waere
  // dieselbe Logik zweimal, also zwei Orte, an denen sie auseinanderlaufen.
  const kommentare = []
  // EIN STAPEL, KEIN EINZELZUSTAND. Ein Vorlagen-Literal kann in seinem
  // `${…}` wieder eines enthalten — und app.js tut das reichlich. Mit einem
  // einzelnen Zustand kehrte der Scanner nach dem inneren `}` nie in die
  // Vorlage zurueck und hielt den Rest der Datei fuer Code: die erste Fassung
  // dieses Werkzeugs fand so 19 statt 58 `fetch(`.
  const stapel = [{ art: 'code', klammern: 0 }]
  const oben = () => stapel[stapel.length - 1]
  let i = 0
  while (i < text.length) {
    const c = text[i]
    const n = text[i + 1]
    const lage = oben()
    if (lage.art === 'code') {
      if (c === '/' && n === '/') {
        const von = i
        while (i < text.length && text[i] !== '\n') {
          aus[i] = ' '
          i += 1
        }
        kommentare.push([von, i])
        continue
      }
      if (c === '/' && n === '*') {
        const von = i
        aus[i] = ' '
        aus[i + 1] = ' '
        i += 2
        while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
          aus[i] = text[i] === '\n' ? '\n' : ' '
          i += 1
        }
        aus[i] = ' '
        aus[i + 1] = ' '
        i += 2
        kommentare.push([von, i])
        continue
      }
      if (c === "'" || c === '"') {
        aus[i] = ' '
        i += 1
        while (i < text.length && text[i] !== c) {
          if (text[i] === '\\') {
            aus[i] = ' '
            aus[i + 1] = text[i + 1] === '\n' ? '\n' : ' '
            i += 2
            continue
          }
          aus[i] = text[i] === '\n' ? '\n' : ' '
          i += 1
        }
        aus[i] = ' '
        i += 1
        continue
      }
      if (c === '`') {
        aus[i] = ' '
        i += 1
        stapel.push({ art: 'vorlage' })
        continue
      }
      if (c === '{') lage.klammern += 1
      else if (c === '}') {
        // Die schliessende Klammer eines `${…}` beendet den Code-Rahmen und
        // gibt die Vorlage darunter frei.
        if (lage.klammern === 0 && stapel.length > 1) {
          aus[i] = '}'
          i += 1
          stapel.pop()
          continue
        }
        lage.klammern -= 1
      }
      aus[i] = c
      i += 1
      continue
    }
    // Vorlagen-Literal: `…${ code }…`
    if (c === '\\') {
      aus[i] = ' '
      aus[i + 1] = n === '\n' ? '\n' : ' '
      i += 2
      continue
    }
    if (c === '$' && n === '{') {
      aus[i] = ' '
      aus[i + 1] = '{'
      i += 2
      stapel.push({ art: 'code', klammern: 0 })
      continue
    }
    aus[i] = c === '\n' ? '\n' : ' '
    if (c === '`') stapel.pop()
    i += 1
  }
  const ohneK = text.split('')
  for (const [von, bis] of kommentare)
    for (let k = von; k < bis && k < ohneK.length; k += 1)
      if (ohneK[k] !== '\n') ohneK[k] = ' '
  return { rein: aus.join(''), ohneK: ohneK.join('') }
}

const { rein, ohneK } = entkernen(quelle)

/**
 * Von der oeffnenden Klammer bis zur GEGENKLAMMER — der ganze Aufruf.
 *
 * DAS IST DER UNTERSCHIED ZU `tools/fetch-frist-schau.mjs`: dort ist das
 * Urteilsfenster feste 12 Zeilen. Steht im Aufruf eine laengere Begruendung,
 * faellt die Frist hinten heraus (falsch rot) — und schlimmer, bei zwei nah
 * beieinander liegenden Aufrufen zaehlt das `signal:` des TIEFEREN fuer den
 * darueber (falsch gruen, die gefaehrliche Richtung).
 */
function gegenklammer(text, klammerAuf) {
  let tief = 0
  for (let i = klammerAuf; i < text.length; i += 1) {
    const c = text[i]
    if (c === '(') tief += 1
    else if (c === ')') {
      tief -= 1
      if (tief === 0) return i + 1
    }
  }
  return text.length
}

const zeileVon = (pos) => quelle.slice(0, pos).split('\n').length

const rufe = []
const muster = /\bfetch\s*\(/g
let t
while ((t = muster.exec(rein)) !== null) {
  const auf = rein.indexOf('(', t.index)
  const zu = gegenklammer(rein, auf)
  // STRUKTUR aus `rein`, INHALT aus `ohneK`: dieselben Offsets, zwei Fragen.
  rufe.push({ zeile: zeileVon(t.index), text: ohneK.slice(auf, zu), pos: t.index })
}

// In welcher Funktion steht der Ruf? Die naechste Methode oder Funktion
// oberhalb. NUR ZUR BESCHRIFTUNG der Fundstellen — das Urteil selbst haengt
// bei R1 daran, ob der Traeger die Naht ist; Schluesselwoerter muessen
// deshalb heraus, sonst hiesse der Traeger „if" und die Naht waere nie
// erkannt.
const SCHLUESSEL = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'do', 'else', 'typeof', 'await', 'new',
])
const funktionsMuster = /\n *(?:async )?(?:function )?([A-Za-z_$][\w$]*)\s*\(/g
const naehte = []
let f
while ((f = funktionsMuster.exec(quelle)) !== null) {
  if (SCHLUESSEL.has(f[1])) continue
  naehte.push({ pos: f.index, name: f[1] })
}
function traegerVon(pos) {
  let name = '(oben)'
  for (const n of naehte) {
    if (n.pos > pos) break
    name = n.name
  }
  return name
}

const still = process.argv.includes('--pruefen')
let bruch = false
const sag = (...a) => console.log(...a)

// ══ R1 ════════════════════════════════════════════════════════════════════
const aendernd = rufe.filter((r) => AENDERND.test(r.text))
const ohneFrist = aendernd.filter((r) => !/\bsignal\s*:/.test(r.text))
const fremd = ohneFrist.filter((r) => traegerVon(r.pos) !== NAHT)

if (!still) {
  sag(`${DATEI}: ${rufe.length} fetch( insgesamt, davon ${aendernd.length} aendernd.`)
  sag(`  mit Frist: ${aendernd.length - ohneFrist.length}, ohne: ${ohneFrist.length}`)
}
// `--alle` zeigt AUCH die aendernden Rufe, die eine Frist haben und trotzdem
// von Hand geschrieben sind. Sie sind kein Bruch (R1 urteilt nur ueber die
// fristlosen), aber sie sind die Liste, aus der die naechsten Brueche kommen:
// wer hier etwas anfasst, vergisst die Frist irgendwann.
if (process.argv.includes('--alle')) {
  const mitFrist = aendernd.filter((r) => /\bsignal\s*:/.test(r.text) && traegerVon(r.pos) !== NAHT)
  sag(`  von Hand, aber MIT Frist (${mitFrist.length}):`)
  for (const r of mitFrist) sag(`    Zeile ${r.zeile} in \`${traegerVon(r.pos)}\``)
}
if (fremd.length) {
  sag(`R1 VERLETZT — ${fremd.length} aendernde fetch ohne Frist ausserhalb von \`${NAHT}\`:`)
  for (const r of fremd) sag(`  Zeile ${r.zeile} in \`${traegerVon(r.pos)}\``)
  sag(`  Aendernde Anfragen laufen ueber \`${NAHT}\` — ein Weg, eine Frist.`)
  bruch = true
}

// ══ R2 / R3 ═══════════════════════════════════════════════════════════════
// Den Rumpf der Naht lesen: von der Definition bis zur Gegenklammer des
// Rumpfes. Fehlt die Naht ganz, ist das der erste Bruch — und dann ist R1
// ohnehin schon rot, weil es keinen Traeger namens NAHT mehr gibt.
//
// DIE DEFINITION WIRD IN `rein` GESUCHT, nicht in der Quelle: sonst faende
// ein Kommentar, der die Naht ZITIERT, sie als Definition (Hausregel
// „Kommentar und Kompilat sind keine Gegenstelle").
const nahtAuf = rein.search(new RegExp(`\\n *async function ${NAHT}\\s*\\(`))
if (nahtAuf < 0) {
  sag(`R2/R3 VERLETZT — \`async function ${NAHT}(\` steht nicht in ${DATEI}.`)
  bruch = true
} else {
  const geschweift = rein.indexOf('{', rein.indexOf(')', rein.indexOf('(', nahtAuf)))
  let tief = 0
  let ende = rein.length
  for (let i = geschweift; i < rein.length; i += 1) {
    if (rein[i] === '{') tief += 1
    else if (rein[i] === '}') {
      tief -= 1
      if (tief === 0) {
        ende = i + 1
        break
      }
    }
  }
  // INHALT AUS `ohneK`: die Zeichenketten muessen lesbar bleiben
  // (`e.name === 'TimeoutError'`), die Kommentare nicht — sonst bestuende
  // die Regel schon, weil sie im Kommentar darueber beschrieben ist.
  const rumpf = ohneK.slice(nahtAuf, ende)

  if (!/AbortSignal\.timeout\s*\(/.test(rumpf)) {
    sag(`R2 VERLETZT — \`${NAHT}\` setzt keine \`AbortSignal.timeout(\`.`)
    bruch = true
  }
  // R3a: die Frist darf keine unbehandelte Ausnahme werden — sonst laeuft der
  // Code hinter dem Aufruf nicht mehr und `beschaeftigt` bleibt stehen.
  //
  // `}\s*catch` UND NICHT `\bcatch\b`: Die erste Fassung suchte nur das Wort
  // und blieb bei der Gegenprobe GRUEN — im Rumpf stehen `.catch(() => null)`
  // und `.catch(() => '')` an den beiden `a.json()`/`a.text()`-Aufrufen, und
  // die erfuellten den Test, waehrend der echte `catch`-Zweig durch ein
  // `finally` ersetzt war. Gesucht ist der ZWEIG, nicht das Wort.
  if (!/\}\s*catch\s*[({]/.test(rumpf)) {
    sag(`R3a VERLETZT — \`${NAHT}\` faengt nichts ab; eine Frist waere eine`)
    sag('  unbehandelte Ausnahme und `beschaeftigt` bliebe stehen.')
    bruch = true
  }
  // R3b: die Frist ist ein EIGENER Ausgang, kein Fehlschlag. Beides wird
  // verlangt — die Erkennung (`TimeoutError`) UND der Weg nach draussen
  // (`zuLang`). Nur eines von beiden hiesse: erkannt und dann doch
  // weggeworfen.
  if (!/TimeoutError/.test(rumpf) || !/\bzuLang\b/.test(rumpf)) {
    sag(`R3b VERLETZT — \`${NAHT}\` reicht die Frist nicht als eigenen Ausgang`)
    sag('  hinaus (`TimeoutError` erkennen UND als `zuLang` zurueckgeben).')
    sag('  Nach einer Frist waere „ging nicht" eine ungeprueffte Behauptung')
    sag('  (Muster `funkTun`: ein abgebrochener Ruf ist KEIN Fehlschlag).')
    bruch = true
  }
  // R3c: und der Helfer darf selbst nicht werfen — sonst ist R3a umsonst.
  if (/\bthrow\b/.test(rumpf)) {
    sag(`R3c VERLETZT — \`${NAHT}\` wirft; dann braucht jeder Aufrufer wieder`)
    sag('  sein eigenes `catch`, und genau das war der Zustand vorher.')
    bruch = true
  }
  if (!still) {
    sag(`  \`${NAHT}\` ab Zeile ${zeileVon(nahtAuf) + 1}: R2/R3 gedeckt.`)
  }

  // ── R3d: DIE NAHT WIRD GEFAHREN, NICHT NUR ANGESEHEN ────────────────────
  // R2/R3a-c lesen Text. Text kann alles Verlangte enthalten und trotzdem das
  // Falsche tun — ein `catch`, das den Fehler weiterwirft, ein `zuLang`, das
  // immer false ist. Deshalb wird der Rumpf hier HERAUSGESCHNITTEN und gegen
  // eine Attrappe ausgefuehrt. Vier Lagen, und die erste ist die, um die es
  // ueberhaupt geht: eine Frist darf keine Ausnahme werden.
  //
  // DER RUMPF WIRD AUS DER QUELLE GENOMMEN und nicht nachgebaut — ein Nachbau
  // waere eine zweite Fassung derselben Regel, also genau der Fehler, gegen
  // den diese Datei antritt.
  const quellRumpf = quelle.slice(nahtAuf, ende)
  const lagen = [
    { name: 'Erfolg', wirft: null, status: 200, rumpf: { ok: true, wert: 7 }, erwartet: { ok: true, zuLang: false, status: 200 } },
    { name: 'Absage 409', wirft: null, status: 409, rumpf: { error: 'gesperrt' }, erwartet: { ok: false, zuLang: false, status: 409 } },
    { name: 'Frist', wirft: 'TimeoutError', erwartet: { ok: false, zuLang: true, status: 0 } },
    { name: 'Netz weg', wirft: 'TypeError', erwartet: { ok: false, zuLang: false, status: 0 } },
  ]
  let gefahren = 0
  for (const lage of lagen) {
    const attrappe = async () => {
      if (lage.wirft) {
        const f = new Error('Attrappe')
        f.name = lage.wirft
        throw f
      }
      return {
        ok: lage.status < 400,
        status: lage.status,
        json: async () => lage.rumpf,
        text: async () => JSON.stringify(lage.rumpf),
      }
    }
    let ergebnis
    try {
      // eslint-disable-next-line no-new-func
      const bauen = new Function(
        'fetch',
        'AbortSignal',
        'SENDE_FRIST_MS',
        `${quellRumpf}\nreturn ${NAHT}`,
      )
      const naht = bauen(attrappe, { timeout: () => ({}) }, 8000)
      ergebnis = await naht('/attrappe', 'POST', { a: 1 })
    } catch (e) {
      sag(`R3d VERLETZT — \`${NAHT}\` warf bei „${lage.name}": ${e && e.name}: ${e && e.message}`)
      sag('  Eine Ausnahme hier heisst: der Code HINTER dem Aufruf laeuft nicht,')
      sag('  und `beschaeftigt` bleibt stehen — jeder Knopf des Fachs grau.')
      bruch = true
      continue
    }
    const schlecht = Object.entries(lage.erwartet).filter(([k, v]) => ergebnis[k] !== v)
    if (schlecht.length) {
      sag(`R3d VERLETZT — bei „${lage.name}" kam ${JSON.stringify(ergebnis)};`)
      sag(`  erwartet war ${schlecht.map(([k, v]) => `${k}=${v}`).join(', ')}.`)
      bruch = true
    } else {
      gefahren += 1
    }
  }
  if (!still) sag(`  \`${NAHT}\` gefahren: ${gefahren}/${lagen.length} Lagen — R3d gedeckt.`)
}

// ══════════════════════════════════════════════════════════════════════════
//  RANG 10 — dieselbe Regel an mehreren Stellen
// ══════════════════════════════════════════════════════════════════════════

/** Alle Zeilennummern, auf die ein Muster im KOMMENTARFREIEN Text passt. */
function trefferZeilen(muster) {
  const raus = []
  const m = new RegExp(muster.source, muster.flags.includes('g') ? muster.flags : muster.flags + 'g')
  let x
  while ((x = m.exec(ohneK)) !== null) raus.push(zeileVon(x.index))
  return raus
}

// ── R4: die Helligkeit wird an EINER Stelle gestellt ───────────────────────
// DIE PROBE IST DER PFAD, NICHT DER FUNKTIONSNAME: Wer `helligkeitStellen`
// umbenennt, aendert nichts an der Gefahr; wer ein zweites PUT auf
// `/schirm/helligkeit` schreibt, stellt die naechste Abweichung hin. Gemessen
// wird deshalb das Merkmal, das mit dem Fehler zurueckkaeme (Hausregel
// „Wache auf Sorte, nicht auf Pfad").
const helligkeitStellen = trefferZeilen(/\/schirm\/helligkeit['"`]\s*,\s*'PUT'|\/schirm\/helligkeit['"`]\s*,\s*\{[^}]*?method/)
if (helligkeitStellen.length !== 1) {
  sag(`R4 VERLETZT — ${helligkeitStellen.length} Stellen stellen die Helligkeit`)
  sag(`  (Zeilen ${helligkeitStellen.join(', ') || '—'}); es darf genau EINE sein.`)
  sag('  `eltern` und `schnell` deuteten dieselbe Antwort vorher verschieden:')
  sag('  anderer 401-Satz, andere Reihenfolge, fehlender Zweig, eigener Nachabruf.')
  bruch = true
} else if (!still) {
  sag(`  Helligkeit: eine Stelle (Zeile ${helligkeitStellen[0]}) — R4 gedeckt.`)
}
// UND BEIDE SCHIRME MUESSEN SIE AUCH BENUTZEN. Ohne diese Haelfte bliebe die
// Wache gruen, wenn jemand den zweiten Weg loescht statt ihn anzuschliessen —
// die Zahl waere dann auch 1 (Hausregel „Gruene Gegenprobe ist der Fund").
//
// DIE DEFINITION ZAEHLT NICHT ALS RUF. Ohne diesen Abzug blieb die Wache bei
// der Gegenprobe GRUEN: `async function helligkeitStellen(` ist selbst ein
// Treffer auf `helligkeitStellen(`, also war die Zahl um eins zu hoch, und
// ein geloeschter Ruf fiel nicht auf.
const helligkeitRufer =
  trefferZeilen(/\bhelligkeitStellen\s*\(/).length - trefferZeilen(/function\s+helligkeitStellen\s*\(/).length
const helligkeitSetzer = trefferZeilen(/\basync helligkeitSetzen\s*\(/).length
if (helligkeitSetzer < 2 || helligkeitRufer < helligkeitSetzer) {
  sag(`R4 VERLETZT — ${helligkeitSetzer} \`helligkeitSetzen\`, aber nur ${helligkeitRufer}`)
  sag('  Rufe von `helligkeitStellen`. Beide Schirme (Eltern-Bereich und')
  sag('  Schnellfenster) gehen ueber dieselbe Naht, oder es ist wieder zwei.')
  bruch = true
}

// ── R5: die /mupihat-Dreizustands-Deutung steht an EINER Stelle ────────────
// DAS MERKMAL IST DIE FORMEL, nicht der Name: `!Array.isArray(x) && typeof x
// === 'object'` ist die Uebersetzung „leere Liste heisst KEIN HAT". Sie darf
// genau einmal dastehen — in `hatDeuten`.
const hatFormel = trefferZeilen(/!Array\.isArray\([^)]*\)\s*&&\s*typeof\s+[^=]*===\s*'object'/)
if (hatFormel.length !== 1) {
  sag(`R5 VERLETZT — die /mupihat-Deutung steht ${hatFormel.length}-mal`)
  sag(`  (Zeilen ${hatFormel.join(', ') || '—'}); sie gehoert in \`hatDeuten\` und nur dorthin.`)
  bruch = true
} else if (!still) {
  sag(`  /mupihat-Deutung: eine Stelle (Zeile ${hatFormel[0]}) — R5 gedeckt.`)
}
// Und jede ZUWEISUNG an `this.hat` geht ueber sie. `=(?!=)` ist der Punkt:
// ohne das waere jedes `typeof this.hat === 'object'` ein Treffer, und die
// Wache meldete neun Verstoesse, von denen keiner einer ist.
// `null`/`false` bleiben erlaubt — das sind die Anfangswerte des Feldes, und
// sie sind zwei der drei Zustaende, die `hatDeuten` selbst liefert.
// DER LEERRAUM GEHOERT IN DIE VORSCHAU, nicht davor: mit `\s*(?!hatDeuten)`
// laesst der Ruecksetzer `\s*` einfach null Zeichen zu, die Vorschau sieht
// das Leerzeichen und ist zufrieden — die Wache meldete so jeden richtigen
// Aufruf als Verstoss.
const hatRoh = trefferZeilen(/this\.hat\s*=(?!=)(?!\s*(?:hatDeuten\b|null\b|false\b))/)
if (hatRoh.length) {
  sag(`R5 VERLETZT — ${hatRoh.length} Zuweisung(en) an \`this.hat\` gehen nicht`)
  sag(`  ueber \`hatDeuten\` (Zeilen ${hatRoh.join(', ')}).`)
  bruch = true
}

// ── R6: jeder Laufzeit-Formatierer hat einen Waechter gegen Negatives ──────
// SO WIRD ER ERKANNT: die Leiter `< 90` … `86400` ist die Formel, mit der in
// dieser Datei aus Sekunden eine Auskunft wird. Wer eine zweite schreibt,
// schreibt dieselbe Leiter — und genau dann muss sie denselben Waechter
// haben. „0 s" oder „-5 s" sind beide falsch: das eine behauptet einen
// Neustart, das andere eine Zukunft.
const leitern = []
{
  const m = /<\s*90\b/g
  let x
  while ((x = m.exec(ohneK)) !== null) {
    // DAS FENSTER FAENGT AM PFEIL AN, NICHT DAVOR. Die erste Fassung nahm
    // 400 Zeichen VOR dem `=>` dazu, um den Waechter sicher zu erwischen —
    // und schleppte damit die VORHERIGE Funktion mit herein. Die
    // Positivprobe (eine zweite, ungewachte Leiter direkt darunter) blieb
    // GRUEN, weil das `Number.isFinite` der Nachbarin im Fenster lag.
    // Der Waechter steht im selben Rumpf, also reicht der Rumpf.
    const pfeil = ohneK.lastIndexOf('=>', x.index)
    const wort = ohneK.lastIndexOf('function', x.index)
    const von = Math.max(0, pfeil, wort)
    const bis = ohneK.indexOf('86400', x.index)
    if (bis < 0 || bis - x.index > 400) continue
    leitern.push({ zeile: zeileVon(x.index), text: ohneK.slice(von, bis + 20) })
  }
}
for (const l of leitern) {
  const bewacht = /<\s*0\b/.test(l.text) || /Math\.max\(\s*0/.test(l.text) || /Number\.isFinite/.test(l.text)
  if (!bewacht) {
    sag(`R6 VERLETZT — der Laufzeit-Formatierer bei Zeile ${l.zeile} hat keinen`)
    sag('  Waechter gegen negative Werte (`< 0`, `Math.max(0` oder `Number.isFinite`).')
    sag('  Ohne ihn steht „seit -5 s" am Schirm, sobald die Uhr der Box zurueckspringt.')
    bruch = true
  }
}
// UND MINDESTENS EINER MUSS DA SEIN. Ohne diese Zeile ginge die Regel leer
// durch, sobald jemand die Leiter umschreibt — „0 gefunden, alle bewacht"
// ist keine Deckung, sondern eine Wache, die nichts mehr sieht.
if (!leitern.length) {
  sag('R6 VERLETZT — kein Laufzeit-Formatierer gefunden. Entweder ist die')
  sag('  Leiter (`< 90` … `86400`) umgeschrieben, dann gehoert die Erkennung')
  sag('  hier nachgezogen — oder die Regel bewacht gerade nichts.')
  bruch = true
} else if (!still) {
  sag(`  Laufzeit-Formatierer: ${leitern.length} gefunden, alle bewacht — R6 gedeckt.`)
}

process.exit(bruch ? 1 : 0)
