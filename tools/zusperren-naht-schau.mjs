#!/usr/bin/env node
/**
 * Die Naht am ZUSPERREN des Eltern-Bereichs — haelt sie noch?
 *
 * WOZU: `eltern.raeumen()` ist keine Kosmetik. Es leert zwanzig Zeilen lang
 * genau das, was hinter der Sperre lag — die Nachbarschaft mit NAMEN, die
 * gespeicherten Netze (deren Passwort die Box kennt), die Tunnelgegenstelle,
 * die halbe Bibliothek des Kindes. Die Regel dahinter steht woertlich im
 * Quelltext: „Was hinter einer Sperre liegt, wird beim Zusperren WEGGERAEUMT,
 * nicht zugedeckt."
 *
 * Diese Regel hat zwei Feinde, und beide sind DIESELBE Sorte Fehler:
 *
 *   1. EIN TAKT, DER WEITERLAEUFT. Er schlaegt nach dem Zusperren, holt und
 *      schreibt die eben geleerte Auskunft ZURUECK in den Zustand. Am
 *      Bildschirm sieht man nichts (die Malfunktionen steigen selbst aus) —
 *      im Speicher steht es wieder. Gefunden am 19.09.2026 am WPS-Takt: er
 *      lag als einziger in einer ORTSVARIABLEN (`const takt = setInterval`)
 *      und war damit fuer `raeumen()` unerreichbar; sein Endzweig rief
 *      `wlanHolen`.
 *   2. EINE ANTWORT, DIE DAS ZUSPERREN UEBERLEBT. Zwischen `await` und der
 *      Zeile danach kann der Bereich zugegangen sein. Ohne die
 *      Lebenszeichen-Wache `if (!this.offen || !this.frei) return` schreibt
 *      die spaete Antwort in einen geraeumten Zustand. Gefunden am
 *      14.09.2026 (vpnHolen, wlanHolen) und am 19.09.2026 erneut, einen Ruf
 *      weiter: `medienLoeschen` war der einzige Loescher ohne sie, waehrend
 *      sein Zwilling `kindLoeschen` sie woertlich trug.
 *
 * Beide Male war die Lage: 41 Stellen machen es richtig, EINE nicht — und die
 * Abweichung ist der Fehler ([[vierzehn-kopien-und-die-abweichung-ist-der-
 * fehler]]). Genau das kann eine Wache zaehlen, und genau deshalb steht sie
 * hier: gefunden wurde beides von Menschen, die die Datei gelesen haben, und
 * eine Datei mit 33.600 Zeilen wird nicht jeden Monat zweimal gelesen.
 *
 * ══ WAS GEPRUEFT WIRD ═══════════════════════════════════════════════════════
 *
 * A  JEDER `setInterval` HAENGT AN EINER `this.<X>Uhr`. Ausnahmen sind
 *    NAMENTLICH aufgefuehrt (unten `TAKT_AUSSERHALB`) — es sind die Takte
 *    ausserhalb des Eltern-Zustands, die `raeumen()` nichts angehen. Ein Takt
 *    ohne Ziel (`setInterval(f, 1000)` ohne Zuweisung) ist immer rot: was
 *    niemand festhaelt, kann niemand abstellen.
 *
 * B  JEDER `this.<X>Uhr`-TAKT STELLT SICH SELBST AB, wenn der Bereich zu ist.
 *    Die Lebenszeichen-Zeile steht OBEN im Rumpf (die ersten Zeilen) und
 *    nennt `!this.offen` samt `this.<X>Takt(false)`. Das ist die Form aller
 *    acht Takte dieses Bereichs.
 *
 * C  WER HINTER DER SPERRE LIEGT, WIRD IN `raeumen()` ABGESTELLT. Ein Takt,
 *    dessen eigene Wache `!this.frei` nennt, gehoert hinter die Sperre — dann
 *    genuegt die Selbstabschaltung NICHT: sie kommt erst einen Schlag spaeter,
 *    und dieser eine Schlag ist der, der die geraeumte Liste zurueckschreibt.
 *
 * D  JEDER LOESCHER TRAEGT DIE LEBENSZEICHEN-WACHE nach dem `await`.
 *    Als Loescher gilt eine Methode, die etwas WEGNIMMT — am Namen
 *    (`…Loeschen`, `…Vergessen…`) oder am `method: 'DELETE'` in ihrem Ruf.
 *    Die eine bekannte Altlast steht als Ratsche unten und kann nicht
 *    wachsen.
 *
 * E  AENDERNDE RUFE HABEN EINE FRIST (Ratsche). Ein POST/PUT/PATCH/DELETE
 *    ohne `AbortSignal.timeout` laesst bei haengendem Gegenueber
 *    `beschaeftigt` fuer immer stehen — jeder Knopf des Fachs grau, der
 *    Rueckweg gesperrt, nur ein Neuladen hilft. tools/fetch-frist-schau.mjs
 *    zaehlt dieselbe Sorte, sieht aber NUR in den Server auf; diese Datei
 *    stand in keiner Wache. Die Zahl unten ist der gemessene Stand vom
 *    19.09.2026 und steht seit dem `sendeJson`-Umbau desselben Tages auf NULL;
 *    wer eine Stelle mit Frist versieht, setzt sie HERUNTER — eine Ratsche
 *    ueber dem Bestand faengt nichts.
 *
 * ══ WARUM NICHT MIT EINEM ZEILENFENSTER GESUCHT WIRD ════════════════════════
 * fetch-frist-schau.mjs nimmt „der Aufruf plus 12 Zeilen" und uebersieht
 * damit jede Frist, hinter der eine lange Begruendung steht — beim Bau dieser
 * Wache selbst passiert: das frisch gesetzte `signal:` lag 15 Zeilen unter dem
 * `fetch(`, und die Zaehlung meldete die Stelle weiter als offen. Hier wird
 * deshalb der ganze Aufruf gelesen, von der Klammer bis zu ihrer
 * Gegenklammer, mit Kenntnis von Zeichenketten, Vorlagen und Kommentaren.
 *
 * AUFRUF
 *   node tools/zusperren-naht-schau.mjs             zeigt jede Aussage
 *   node tools/zusperren-naht-schau.mjs --pruefen   still; Ende 1 bei Bruch
 *
 * GEGENPROBE (Hausregel „Gruen glauben ist kein Beweis"): jede der fuenf
 * Regeln einzeln im Quelltext brechen und nachsehen, dass GENAU sie rot wird.
 * Am 19.09.2026 so gemacht — fuenf Sabotagen, fuenf rote Laeufe, jede per
 * gezieltem Edit zurueckgenommen.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = dirname(dirname(fileURLToPath(import.meta.url)))
const ZIEL = 'NewDesign/app.js'

// ── A: die Takte, die NICHT am Eltern-Zustand haengen ───────────────────────
// Sie stehen ausserhalb des Eltern-Bereichs und haben mit dem Zusperren
// nichts zu tun. Namentlich, nicht nach Zeilennummer: Zeilen wandern, Namen
// bleiben. Wer hier etwas eintraegt, schreibt den Grund dazu.
const TAKT_AUSSERHALB = {
  'wellen.laufUhr': 'Das Foerderband der Pegelkurve — Modul-Zustand, stoppt sich nach 1,5 s Stille selbst.',
  id: 'sichtbarerTakt(): der Helfer, der JEDEN Takt an die Sichtbarkeit der Seite haengt. Sein `id` ist seine Ortsvariable, und `aus()` ist ihr Abstellhahn.',
  'spiel.takt': 'Das kleine Spiel im Eltern-Tor — sein Zustand liegt im Spielobjekt, `spielEnde` raeumt ihn.',
  anweisungTakt: 'Die Sprechanweisung der Einrichtung — Modul-Zustand, oben in derselben Funktion abgeraeumt.',
}

// ── D: bekannte Altlast unter den Loeschern (Ratsche) ───────────────────────
// KEINE ABSOLUTION, SONDERN EINE DECKELUNG: die Stelle ist gemeldet und
// gehoert zur offenen Naht des 14.09. (R1: die Antwort ueberlebt das
// Zusperren). Sie darf nicht Gesellschaft bekommen.
const LOESCHER_SCHULD = {
  wlanVergessenTun:
    'Offen seit 14.09.2026 (R1-Naht, nicht Teil von Rang 5): schreibt nach dem await `gespeicherte` und `meldung`, ohne zu fragen, ob der Bereich noch offen ist.',
}

// ── E: aendernde Rufe ohne Frist (Ratsche) ─────────────────────────────────
// EINGEFROREN AM 19.09.2026 GEGEN HEAD b6fe1f5b — gegen den Stand von
// `NewDesign/app.js` an diesem Tag, nicht gegen eine Absicht. Nachgemessen mit
// DIESEM Leser UND gegengezaehlt von einem eigenen Zaehler, der andersherum
// sucht (von der `method:`-Zeile aus in beide Richtungen, statt vom `fetch(`
// vorwaerts): beide sagen NULL.
//
// DIE GESCHICHTE DER ZAHL: 28 → 26 (Audit Rang 5c: die beiden
// WLAN-Verbinden-Rufe bekamen ihre Frist) → 0. Die Null kommt NICHT daher,
// dass 26 Stellen einzeln nachgezogen wurden, sondern vom `sendeJson`-Umbau
// desselben Tages (app.js:1088): der Helfer setzt die Frist selbst, und kein
// Aufrufer kann sie weglassen — nur verlaengern. Damit stand die Ratsche 26
// Stellen UEBER dem Bestand und haette keine einzige neue fristlose Stelle
// mehr gefangen; sie war nach [[dauerrote-wache-ist-keine]] die stille
// Variante desselben Fehlers — ein Deckel, unter dem noch 26 Mal Platz war.
//
// DIE 0 IST KEIN VERBOT, SONDERN DER BESTAND. Wer eine Stelle bewusst ohne
// Frist braucht, schreibt „KEINE FRIST" mit Grund darueber — begruendete
// Absicht zaehlt diese Wache gar nicht erst mit, und die Ratsche bleibt
// deshalb auf dem Bestand stehen, statt zum Verbot zu werden.
const FRIST_ERLAUBT = 0

const still = process.argv.includes('--pruefen')
const quelle = readFileSync(join(WURZEL, ZIEL), 'utf8')
const zeilen = quelle.split('\n')

let gebrochen = 0
let geprueft = 0

function ja(bedingung, aussage, dazu = '') {
  geprueft += 1
  if (bedingung) {
    if (!still) console.log(`  ok   ${aussage}`)
    return true
  }
  gebrochen += 1
  console.log(`  ROT  ${aussage}${dazu ? ' — ' + dazu : ''}`)
  return false
}

const istKommentar = (z) => /^\s*(\/\/|\*|\/\*)/.test(z)

/**
 * KOMMENTARE WEG, BEVOR GESUCHT WIRD — und das ist keine Schoenheitsfrage.
 *
 * Eine `in`-Suche ueberlebt einen auskommentierten Aufruf (Hausregel
 * „Gegenprobe statt Gruen glauben"): Wer die Lebenszeichen-Wache mit zwei
 * Schraegstrichen stilllegt, liesse eine Wache, die am ROHEN Text sucht,
 * zufrieden zurueck — die gefaehrlichste Sorte Gruen. Beim Bau dieser Datei
 * am 19.09.2026 genau so nachgestellt: erst nach diesem Filter wurde die
 * auskommentierte Zeile in `medienLoeschen` rot.
 */
const ohneKommentare = (text) =>
  text
    .split('\n')
    .filter((z) => !istKommentar(z))
    .join('\n')

/**
 * Den ganzen Aufruf lesen: von der oeffnenden Klammer bis zu ihrer
 * Gegenklammer. Kennt Zeichenketten ('…', "…"), Vorlagen (`…` samt `${}`),
 * Zeilen- und Blockkommentare — sonst zaehlt ein `(` in einem Text mit und
 * der Aufruf endet irgendwo im Nirgendwo.
 */
function aufrufText(text, ab) {
  const auf = text.indexOf('(', ab)
  if (auf < 0) return ''
  let tiefe = 0
  let i = auf
  while (i < text.length) {
    const c = text[i]
    const zwei = text.slice(i, i + 2)
    if (zwei === '//') {
      const ende = text.indexOf('\n', i)
      i = ende < 0 ? text.length : ende
      continue
    }
    if (zwei === '/*') {
      const ende = text.indexOf('*/', i + 2)
      i = ende < 0 ? text.length : ende + 2
      continue
    }
    if (c === "'" || c === '"') {
      i += 1
      while (i < text.length && text[i] !== c) i += text[i] === '\\' ? 2 : 1
      i += 1
      continue
    }
    if (c === '`') {
      i += 1
      while (i < text.length) {
        if (text[i] === '\\') {
          i += 2
          continue
        }
        if (text[i] === '`') break
        // `${…}` darf Klammern enthalten — der Rumpf ist wieder Code.
        if (text.slice(i, i + 2) === '${') {
          i += 2
          let t = 1
          while (i < text.length && t > 0) {
            if (text[i] === '{') t += 1
            else if (text[i] === '}') t -= 1
            i += 1
          }
          continue
        }
        i += 1
      }
      i += 1
      continue
    }
    if (c === '(') tiefe += 1
    else if (c === ')') {
      tiefe -= 1
      if (tiefe === 0) return text.slice(auf, i + 1)
    }
    i += 1
  }
  return text.slice(auf)
}

/** Der Rumpf einer Methode des Eltern-Bereichs: `    name(…) {` bis `    },`. */
function methodenRumpf(name) {
  const start = zeilen.findIndex((z) => new RegExp('^ {4}(async )?' + name + '\\s*\\(').test(z))
  if (start < 0) return null
  for (let i = start + 1; i < zeilen.length; i += 1) {
    if (/^ {4}\},?$/.test(zeilen[i])) return { von: start + 1, bis: i + 1, text: zeilen.slice(start, i + 1).join('\n') }
  }
  return null
}

/** Alle Methoden des Eltern-Bereichs mit Namen und Rumpf. */
function alleMethoden() {
  const raus = []
  for (let i = 0; i < zeilen.length; i += 1) {
    const m = /^ {4}(async )?([A-Za-z][A-Za-z0-9]*)\s*\(/.exec(zeilen[i])
    if (!m) continue
    for (let j = i + 1; j < zeilen.length; j += 1) {
      if (/^ {4}\},?$/.test(zeilen[j])) {
        raus.push({ name: m[2], async: !!m[1], von: i + 1, bis: j + 1, text: zeilen.slice(i, j + 1).join('\n') })
        i = j
        break
      }
    }
  }
  return raus
}

const raeumen = methodenRumpf('raeumen')

console.log(`\nDIE NAHT AM ZUSPERREN — ${ZIEL}\n`)

// ═══════════════════════════════════════════════════════════════════════════
//  A + B + C — die Takte
// ═══════════════════════════════════════════════════════════════════════════
console.log('A/B/C  Die Takte')

ja(
  !!raeumen,
  'raeumen() ist gefunden (ohne sie sagt diese Wache nichts)',
  'Methodenform `    raeumen() {` … `    },` geaendert?',
)

const takte = []
zeilen.forEach((z, i) => {
  if (istKommentar(z)) return
  if (!/\bsetInterval\s*\(/.test(z)) return
  const ziel = /([A-Za-z_$][\w.$]*)\s*=\s*setInterval\s*\(/.exec(z)
  takte.push({ nr: i + 1, ziel: ziel ? ziel[1] : null, kopf: z.trim().slice(0, 60) })
})

ja(
  takte.length > 0,
  `setInterval-Stellen gefunden (${takte.length})`,
  'kein einziger Takt gefunden — Suchmuster kaputt?',
)

for (const t of takte) {
  const wo = `${ZIEL}:${t.nr}`
  if (!t.ziel) {
    ja(false, `A  ${wo} haelt seinen Takt fest`, `\`${t.kopf}\` — ohne Zuweisung kann ihn niemand abstellen`)
    continue
  }
  const anThis = /^this\.[A-Za-z][A-Za-z0-9]*Uhr$/.test(t.ziel)
  if (!anThis) {
    const grund = TAKT_AUSSERHALB[t.ziel]
    ja(
      !!grund,
      `A  ${wo} haengt an \`${t.ziel}\` — ausserhalb des Eltern-Zustands, mit Grund`,
      `${t.ziel} haengt nicht an this.<X>Uhr und steht nicht in TAKT_AUSSERHALB. Entweder an this haengen (dann raeumt raeumen() ihn) oder dort mit Grund eintragen.`,
    )
    continue
  }
  const kurz = t.ziel.replace(/^this\./, '').replace(/Uhr$/, '')
  // Der Kopf des Rumpfes: die Lebenszeichen-Zeile gehoert nach OBEN, sonst
  // arbeitet der Takt erst und fragt dann.
  // Die ersten FUENF CODE-Zeilen des Rumpfes (Kommentare zaehlen nicht mit,
  // sonst schiebt eine Erklaerung die Wache aus dem Fenster). Fuenf, weil die
  // Zeile bei `tonTakt` und `jfTakt` ueber drei Zeilen geht.
  const kopf = ohneKommentare(zeilen.slice(t.nr, t.nr + 14).join('\n'))
    .split('\n')
    .slice(0, 5)
    .join('\n')
  const selbstAb = /!this\.offen/.test(kopf) && new RegExp(`this\\.${kurz}Takt\\(false\\)`).test(kopf)
  ja(
    selbstAb,
    `B  ${kurz}Takt stellt sich selbst ab, sobald der Bereich zu ist`,
    `im Kopf von ${wo} fehlt \`!this.offen\` und/oder \`this.${kurz}Takt(false)\``,
  )
  // Hinter der Sperre? Dann reicht der eine Schlag Verzoegerung nicht.
  const hinterDerSperre = /!this\.frei/.test(kopf)
  if (hinterDerSperre && raeumen) {
    // OHNE KOMMENTARE: raeumen() ist zu zwei Dritteln Begruendung, und diese
    // Begruendungen NENNEN die Nachbar-Takte beim Namen. Ein Kommentar ist
    // keine Gegenstelle ([[kommentar-und-kompilat-sind-keine-gegenstelle]]).
    const rumpf = ohneKommentare(raeumen.text)
    const geparkt =
      new RegExp(`this\\.${kurz}Takt\\(false\\)`).test(rumpf) ||
      new RegExp(`clearInterval\\(this\\.${kurz}Uhr\\)`).test(rumpf)
    ja(
      geparkt,
      `C  ${kurz}Takt wird in raeumen() abgestellt (er liegt hinter der Sperre)`,
      `raeumen() (${ZIEL}:${raeumen.von}-${raeumen.bis}) nennt weder \`this.${kurz}Takt(false)\` noch \`clearInterval(this.${kurz}Uhr)\``,
    )
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  D — die Loescher und ihre Lebenszeichen-Wache
// ═══════════════════════════════════════════════════════════════════════════
console.log('\nD  Die Loescher')

const methoden = alleMethoden()
const loescher = methoden.filter((m) => {
  if (!m.async || !/\bawait\b/.test(m.text)) return false
  const nimmtWeg = /Loeschen$|Vergessen/.test(m.name) || /method:\s*['"]DELETE['"]/.test(m.text)
  if (!nimmtWeg) return false
  // Nur Methoden des Eltern-Bereichs: sie schreiben nach dem await in `this.`
  // und haben damit ueberhaupt etwas, das das Zusperren ueberleben koennte.
  const nachAwait = m.text.slice(m.text.indexOf('await'))
  return /this\.\w+\s*=/.test(nachAwait)
})

ja(
  loescher.length >= 2,
  `Loescher gefunden (${loescher.length}: ${loescher.map((l) => l.name).join(', ')})`,
  'weniger als zwei — Suchmuster kaputt?',
)

for (const l of loescher) {
  // OHNE KOMMENTARE, aus demselben Grund wie bei C: eine ausgeschaltete Wache
  // steht als Kommentarzeile immer noch da und liest sich wie eine Wache.
  const nachAwait = ohneKommentare(l.text).slice(ohneKommentare(l.text).indexOf('await'))
  const wache = /if \(!this\.offen \|\| !this\.frei\) return/.test(nachAwait)
  const schuld = LOESCHER_SCHULD[l.name]
  if (schuld && !wache) {
    if (!still) console.log(`  alt  ${l.name} (${ZIEL}:${l.von}) ohne Wache — bekannte Altlast: ${schuld}`)
    geprueft += 1
    continue
  }
  if (schuld && wache) {
    console.log(`  HIN  ${l.name} traegt die Wache jetzt — den Eintrag aus LOESCHER_SCHULD entfernen,`)
    console.log('       sonst deckelt die Ratsche mehr, als noetig ist.')
    geprueft += 1
    continue
  }
  ja(
    wache,
    `D  ${l.name} (${ZIEL}:${l.von}) fragt nach dem await, ob der Bereich noch offen ist`,
    'die Zeile `if (!this.offen || !this.frei) return` fehlt — der Zwilling kindLoeschen traegt sie woertlich',
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  E — aendernde Rufe mit Frist (Ratsche)
// ═══════════════════════════════════════════════════════════════════════════
console.log('\nE  Frist bei aendernden Rufen')

const ohneFrist = []
zeilen.forEach((z, i) => {
  if (istKommentar(z)) return
  const ab = z.indexOf('fetch')
  if (ab < 0 || !/\bfetch\s*\(/.test(z)) return
  const absolut = zeilen.slice(0, i).join('\n').length + (i > 0 ? 1 : 0) + ab
  const ruf = aufrufText(quelle, absolut)
  // ERST DIE ABSICHT LESEN (die steht IM Kommentar), dann die Kommentare
  // wegwerfen und nach der Frist suchen — ein auskommentiertes `signal:`
  // ist keine Frist.
  const davor = zeilen.slice(Math.max(0, i - 5), i).join('\n')
  const absicht = /KEINE FRIST/.test(davor) || /KEINE FRIST/.test(ruf)
  const code = ohneKommentare(ruf)
  if (!/method:\s*['"](POST|PUT|PATCH|DELETE)['"]/.test(code)) return
  if (/\bsignal\s*:/.test(code)) return
  if (absicht) return
  ohneFrist.push(i + 1)
})

if (ohneFrist.length > FRIST_ERLAUBT) {
  gebrochen += 1
  geprueft += 1
  console.log(`  ROT  ${ohneFrist.length} aendernde fetch ohne Frist — erlaubt sind ${FRIST_ERLAUBT}.`)
  console.log(`       Zeilen: ${ohneFrist.join(', ')}`)
  console.log('       Entweder `signal: AbortSignal.timeout(8000)` ergaenzen oder die Absicht')
  console.log('       als „KEINE FRIST"-Kommentar darueber begruenden.')
} else if (ohneFrist.length < FRIST_ERLAUBT) {
  geprueft += 1
  console.log(`  HIN  nur noch ${ohneFrist.length} von ${FRIST_ERLAUBT} erlaubten Stellen —`)
  console.log('       FRIST_ERLAUBT in tools/zusperren-naht-schau.mjs herabsetzen, sonst')
  console.log('       schuetzt die Ratsche weniger, als sie koennte.')
} else {
  geprueft += 1
  if (!still)
    console.log(
      ohneFrist.length
        ? `  ok   ${ohneFrist.length} bekannte Altlast(en) ohne Frist, keine neue (Zeilen ${ohneFrist.join(', ')})`
        : '  ok   kein aendernder Ruf ohne Frist — jede neue Stelle faellt ab jetzt auf',
    )
}

// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n${geprueft} AUSSAGE(N), ${gebrochen} GEFALLEN.\n`)
process.exit(gebrochen ? 1 : 0)
