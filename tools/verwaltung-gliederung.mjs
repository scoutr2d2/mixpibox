/**
 * DIE GLIEDERUNG DER VERWALTUNG AUFNEHMEN — Seiten, Reiter, Unterseiten und
 * jeder Einstellungspunkt mit DATEI UND ZEILE.
 *
 * WOZU: Vor jedem Umsortieren („was gehoert in welchen Reiter?") braucht man
 * zuerst den Bestand. Ihn von Hand zusammenzusuchen dauert eine Stunde und ist
 * beim naechsten Mal wieder falsch. Dieses Werkzeug liest ihn aus denselben
 * Quellen, aus denen die Oberflaeche ihn hat:
 *
 *   app.routes.ts   welche Seiten es GIBT (Weg, Titel, Datei)
 *   rahmen.ts       welche davon in der KOPFLEISTE stehen (= Reiter)
 *   die Seiten      Abschnitte (h1/h2/h3), Reiter INNERHALB einer Seite,
 *                   und die Bedienelemente (input/select/textarea)
 *   konfiguration.ts  die Felder, die KEINE Vorlage hat: sie werden aus
 *                   FELDER erzeugt und nach `bereich` auf drei Seiten verteilt
 *
 * WARUM DIE KONFIGURATIONSFELDER EXTRA KOMMEN: Auf /konfiguration, /darstellung
 * und /streaming steht in der Vorlage nur eine Schleife. Wer nur die Vorlagen
 * liest, findet dort NULL Einstellungen und haelt die Seiten fuer leer — genau
 * die Taeuschung durch Weglassen, gegen die es die Werkzeuge gibt.
 *
 * WAS ES NICHT KANN (und das ist kein Fehler, sondern die Grenze):
 *   * Es sagt nicht, ob ein Punkt RICHTIG sitzt. Das ist eine Frage an den
 *     Menschen; das Werkzeug legt nur die Karte hin.
 *   * Text, der erst zur Laufzeit entsteht ({{ ... }}), steht als «…» da.
 *     Wieviele das sind, sagt tools/vorlagen-interpolationen.mjs.
 *
 * AUFRUF
 *     node tools/verwaltung-gliederung.mjs            # Uebersicht
 *     node tools/verwaltung-gliederung.mjs --alle     # jeder Punkt einzeln
 *     node tools/verwaltung-gliederung.mjs --json
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { kopfleiseLesen, sichtbar, unterseitenLesen, wegeLesen } from './verwaltung-suchbestand.mjs'

const HIER = dirname(fileURLToPath(import.meta.url))
const WURZEL = join(HIER, '..')
const SEITEN = join(WURZEL, 'src/frontend-admin/src/app/seiten')
const KONFIG_TS = join(WURZEL, 'src/backend-api/src/konfiguration.ts')

/** Zeile (1-basiert) zu einer Zeichenstelle. */
function zeileVon(quelle, stelle) {
  let n = 1
  for (let i = 0; i < stelle && i < quelle.length; i++) if (quelle[i] === '\n') n++
  return n
}

/**
 * Kommentare durch GLEICH LANGE Leerzeichen ersetzen.
 *
 * Nicht loeschen: die Stellen muessen erhalten bleiben, sonst zeigt jede
 * Zeilenangabe hinter dem ersten Kommentar daneben. Genau daran scheitert der
 * naive Weg (erst `ohneKommentare`, dann Zeilen zaehlen).
 */
function kommentareMaskieren(html) {
  return html.replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length))
}

/** Die Vorlage MIT ihrer Stelle in der Datei. */
function vorlageMitStelle(quelle) {
  const anfang = quelle.indexOf('template: `')
  if (anfang < 0) return null
  const von = anfang + 'template: `'.length
  const bis = quelle.indexOf('`', von)
  if (bis < 0) return null
  return { von, text: quelle.slice(von, bis) }
}

/** Die Arten von Bedienelement, die in diesen Seiten vorkommen. */
const ARTEN = [
  { art: 'schalter', muster: /<input\b[^>]*type="checkbox"[^>]*>/g },
  { art: 'schalter', muster: /<input\b[^>]*type="radio"[^>]*>/g },
  { art: 'zahl', muster: /<input\b[^>]*type="(?:number|range)"[^>]*>/g },
  { art: 'zeit', muster: /<input\b[^>]*type="time"[^>]*>/g },
  { art: 'text', muster: /<input\b[^>]*type="(?:text|search|password|url)"[^>]*>/g },
  { art: 'auswahl', muster: /<select\b(?:"[^"]*"|'[^']*'|[^>"'])*>/g },
]

/**
 * Wie heisst das Element, das hier steht?
 *
 * Erst die umschliessende Beschriftung (<label>), dann der Kartentitel davor.
 * Findet sich nichts Festes, steht «…» da — das ist eine ehrliche Auskunft und
 * keine Luecke: der Name entsteht dann erst zur Laufzeit.
 */
function nameFuer(html, stelle, tag = '') {
  // Was IM Tag steht, ist die genaueste Auskunft: sie gehoert diesem einen
  // Element und nicht der Umgebung.
  const eigen =
    /\splaceholder="([^"{][^"]*)"/.exec(tag)?.[1] ??
    /\saria-label="([^"]*)"/.exec(tag)?.[1] ??
    /\stitle="([^"{][^"]*)"/.exec(tag)?.[1]
  if (eigen) return eigen
  for (const t of html.matchAll(/<label\b(?:"[^"]*"|'[^']*'|[^>"'])*>([\s\S]*?)<\/label>/g)) {
    if (t.index < stelle && stelle < t.index + t[0].length) {
      const s = sichtbar(t[1])
      if (s) return s
    }
  }
  const davor = html.slice(Math.max(0, stelle - 600), stelle)
  const kandidaten = [
    ...davor.matchAll(/<div\s+class="titel"[^>]*>([\s\S]*?)<\/div>/g),
    ...davor.matchAll(/<b\b[^>]*>([\s\S]*?)<\/b>/g),
    ...davor.matchAll(/<span\s+class="was"[^>]*>([\s\S]*?)<\/span>/g),
  ].sort((a, b) => a.index - b.index)
  const letzter = kandidaten.pop()
  const s = letzter ? sichtbar(letzter[1]) : ''
  return s || '«…»'
}

/** Reiter INNERHALB einer Seite: Knoepfe in einem <div class="reiter">. */
function innereReiter(html) {
  const raus = []
  for (const block of html.matchAll(/<div\s+class="reiter"[^>]*>([\s\S]*?)<\/div>/g)) {
    for (const b of block[1].matchAll(/<button\b[\s\S]*?<\/button>/g)) {
      raus.push({ stelle: block.index + b.index, text: sichtbar(b[0]) })
    }
  }
  // Wenn die Knoepfe aus einer @for-Schleife kommen, steht dort nur ein
  // einziger mit {{ g.name }}. Die NAMEN der Gruppen stehen dann im
  // TypeScript, nicht in der Vorlage — sie werden getrennt gesucht.
  return raus
}

/** Gruppenlisten im TypeScript einer Seite (z. B. die Reitergruppen). */
function gruppenListen(quelle) {
  const raus = []
  for (const t of quelle.matchAll(/(?:readonly\s+)?(\w*[Gg]ruppen\w*)\s*(?::[^=]*)?=\s*\[([\s\S]*?)\n\s*\]/g)) {
    const namen = [...t[2].matchAll(/name:\s*'([^']*)'/g)].map((x) => x[1])
    if (namen.length) raus.push({ feld: t[1], stelle: t.index, namen })
  }
  return raus
}

/**
 * DAS TOKEN-INVENTAR EINER SEITE (E7b/L2).
 *
 * Gezaehlt wird im `styles:`-Block: welche CSS-Variablen aus styles.css die
 * Seite benutzt — und was DANEBEN hart hineingeschrieben ist. Eine harte Farbe
 * ist kein Fehler an sich; sie ist die Stelle, an der ein Themenwechsel oder
 * eine Angleichung still danebenliegt. Deshalb steht sie hier mit ZEILE.
 */
function tokenInventar(quelle) {
  // ZWEI SCHREIBWEISEN, und das ist selbst schon ein Befund (E7b/L3):
  // dreizehn Seiten schreiben `styles: \``, mupihat.ts schreibt `styles: [\``.
  // Wer nur die erste kennt, meldet diese Seite als „0 harte Farben" — eine
  // Taeuschung durch Weglassen, und ausgerechnet bei der Seite mit den
  // meisten eigenen Farben.
  const t = /styles:\s*\[?\s*`/.exec(quelle)
  if (!t) return { genutzt: [], hart: [], form: 'keine' }
  const form = t[0].includes('[') ? 'Feld' : 'Zeichenkette'
  const von = t.index + t[0].length
  const bis = quelle.indexOf('`', von)
  if (bis < 0) return { genutzt: [], hart: [], form }
  const css = quelle.slice(von, bis)
  const genutzt = [...new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((t) => t[1]))].sort()
  const hart = []
  // Hexfarben und rgb()/rgba() — die Sorte, die ein Thema nicht mitnimmt.
  // #fff auf einem Knopf ist die haeufigste und harmloseste; sie steht
  // trotzdem mit da, sonst waere die Zahl eine Meinung.
  for (const t of css.matchAll(/#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)/g)) {
    hart.push({ wert: t[0], zeile: zeileVon(quelle, von + t.index) })
  }
  return { genutzt, hart, form }
}

/**
 * DAS INTERAKTIONSMUSTER EINER SEITE (E7b/L3, erstmals gemessen 05.08.2026).
 *
 * L3 stand seit dem 31.07. als „Formularaufbau, Knopf-Position,
 * Speichern-Verhalten (sofort? Knopf?), Fehler-Rueckmeldung, Ladezustaende" im
 * Backlog und war nie gezaehlt worden. Ohne Zahlen ist L5 („Referenz-Seite
 * kueren") aber eine Geschmacksfrage, und L6 („angleichen") hat kein Maszstab.
 *
 * WAS HIER GEMESSEN WIRD, und jedes Merkmal hat einen Anlass:
 *
 *   speichern   'fussleiste'  eine klebende Leiste mit Speichern/Verwerfen;
 *                             Aenderungen sammeln sich, bis man drueckt.
 *               'sofort'      jeder Klick schreibt.
 *               'keins'       die Seite stellt nichts ein (Uebersicht).
 *               Das ist der EINSCHNEIDENDSTE Unterschied: wer von einer
 *               Sammel-Seite auf eine Sofort-Seite wechselt, drueckt aus
 *               Gewohnheit einen Schalter „zum Ausprobieren" — und hat ihn
 *               gestellt. Zwei Verhalten in einer Verwaltung sind vertretbar,
 *               ZWEI OHNE ERKENNBAREN UNTERSCHIED AM BILD sind es nicht.
 *   karte        wie oft der .karte-Kasten vorkommt. NUR dieser eine Name —
 *                die Seiten ohne ihn haben sehr wohl Kaesten, sie nennen sie
 *                anders. Genau das ist der Befund, siehe unten.
 *   wahlknopf    gedrueckt = an (button.wahl) — das Umschaltmuster.
 *   rueckmeldung MIT WELCHEM WORT die Seite dem Benutzer antwortet. Vier
 *                Schreibweisen sind in Gebrauch (fehler, meldung, warn,
 *                stand); die LEERE Liste ist der Befund, nicht das Wort.
 *   ladezustand  ruft das Bild ein laeuft()/laedt() ab, oder steht die Seite
 *                waehrend des Wartens stumm leer?
 *
 * DREI FEHLMESSUNGEN AUS DEN ERSTEN ANLAEUFEN, alle beim Gegenpruefen
 * gefunden, alle dieselbe Bauart — der Ausdruck traf die Schreibweise, die
 * ich erwartet hatte, und meldete alles andere als „nicht vorhanden"
 * ([[admin-abgleich-grep-luegt]]):
 *
 *   1. `\bfehler\b` meldete Kinderzeit als EINZIGE Seite ohne Fehlerort. Sie
 *      hat einen: er heiszt `regelnFehler`, und zwischen „n" und „F" steht
 *      keine Wortgrenze.
 *   2. Gezaehlt wurde `class="karte` — acht Seiten kamen mit 0 heraus. Sie
 *      haben Kaesten, sie nennen sie `abschnitt`, `schild`, `kachel`,
 *      `gruppe`, `kopf`, `diagnose`. Die 0 las sich wie „ohne Struktur" und
 *      hiesz „anderes Wort".
 *   3. Der Versuch, das zu retten, indem die Klasse UM die h2 gelesen wird,
 *      war noch schlechter: die Konfigurationsseite bekam „keine h2", obwohl
 *      sie vier hat — sie stehen dort lose in einem @for, ohne Kasten
 *      darum. Wieder eine Null, die etwas anderes bedeutet als sie sagt.
 *      Deshalb steht jetzt eine schlichte ZAHL da, deren Bedeutung im
 *      Spaltentitel steht, und daneben die WORTLISTE.
 *
 * GEMESSEN WIRD AM QUELLTEXT, nicht am Bild. Das ist die Grenze dieser Zahl:
 * sie sagt, WELCHE Bauteile eine Seite benutzt, nicht ob sie gut aussehen.
 * Fuer „sieht gleich aus" braucht es einen Menschen vor dem Browser.
 */
export const RUECKMELDE_WOERTER = ['fehler', 'meldung', 'warn', 'stand']

export function interaktionsmuster(_quelle, html) {
  const hatFussleiste = /class="fuss(leiste)?"|<footer/.test(html)
  const stelltEin = /<(input|select)\b|<button\b/.test(html)
  return {
    speichern: hatFussleiste ? 'fussleiste' : stelltEin ? 'sofort' : 'keins',
    karte: (html.match(/class="karte/g) ?? []).length,
    wahlknopf: (html.match(/class="wahl/g) ?? []).length,
    rueckmeldung: RUECKMELDE_WOERTER.filter((w) => new RegExp(w, 'i').test(html)),
    ladezustand: /\w*(?:laedt|laeuft)\w*\(/i.test(html),
  }
}

/** Eine Seite aufnehmen. */
export function seiteAufnehmen(datei) {
  const pfad = join(SEITEN, `${datei}.ts`)
  const quelle = readFileSync(pfad, 'utf8')
  const v = vorlageMitStelle(quelle)
  if (!v) return null
  const html = kommentareMaskieren(v.text)
  const zeile = (stelle) => zeileVon(quelle, v.von + stelle)

  const abschnitte = []
  for (const t of html.matchAll(/<(h1|h2|h3)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
    abschnitte.push({ stufe: t[1], name: sichtbar(t[2]) || '«…»', zeile: zeile(t.index) })
  }

  const punkte = []
  for (const a of ARTEN) {
    for (const t of html.matchAll(a.muster)) {
      const abschnitt = abschnitte.filter((x) => x.zeile <= zeile(t.index) && x.stufe !== 'h1').pop()
      punkte.push({
        art: a.art,
        name: nameFuer(html, t.index, t[0]),
        zeile: zeile(t.index),
        abschnitt: abschnitt?.name ?? '',
      })
    }
  }
  punkte.sort((x, y) => x.zeile - y.zeile)

  const reiter = innereReiter(html).map((r) => ({
    text: r.text || '«…»',
    zeile: zeile(r.stelle),
  }))

  return {
    datei: `src/frontend-admin/src/app/seiten/${datei}.ts`,
    zeilen: quelle.split('\n').length,
    token: tokenInventar(quelle),
    muster: interaktionsmuster(quelle, html),
    abschnitte,
    punkte,
    reiter,
    gruppen: gruppenListen(quelle).map((g) => ({ ...g, zeile: zeileVon(quelle, g.stelle) })),
    /** Verweise auf andere Seiten — der Stoff, aus dem Umzugsfehler sind. */
    verweise: [...html.matchAll(/routerLink="([^"]+)"/g)].map((t) => ({
      weg: t[1],
      zeile: zeile(t.index),
    })),
  }
}

/**
 * Die Konfigurationsfelder — sie stehen in KEINER Vorlage.
 *
 * Gelesen wird der Block `export const FELDER`. Jeder Eintrag nennt `id`,
 * `bereich` und `titel`; die Zuordnung Bereich -> SEITE steht in BEREICHE.
 */
export function konfigFelderLesen() {
  const quelle = readFileSync(KONFIG_TS, 'utf8')

  const bereiche = new Map()
  const bAnfang = quelle.indexOf('export const BEREICHE')
  const bEnde = quelle.indexOf('\n]', bAnfang)
  for (const t of quelle.slice(bAnfang, bEnde).matchAll(/\{([\s\S]*?)\}/g)) {
    const id = /id:\s*'([^']*)'/.exec(t[1])?.[1]
    const titel = /titel:\s*'([^']*)'/.exec(t[1])?.[1]
    const seite = /seite:\s*'([^']*)'/.exec(t[1])?.[1]
    if (id) bereiche.set(id, { titel, seite, zeile: zeileVon(quelle, bAnfang + t.index) })
  }

  const felder = []
  const fAnfang = quelle.indexOf('export const FELDER')
  const rest = quelle.slice(fAnfang)
  // Jeder Feldeintrag beginnt mit `  {` am Zeilenanfang und endet mit `  },`.
  for (const t of rest.matchAll(/\n {2}\{\n([\s\S]*?)\n {2}\},/g)) {
    const id = /\bid:\s*'([^']*)'/.exec(t[1])?.[1]
    if (!id) continue
    const bereich = /\bbereich:\s*'([^']*)'/.exec(t[1])?.[1] ?? ''
    const art = /\bart:\s*'([^']*)'/.exec(t[1])?.[1] ?? ''
    // DIE AUSWAHLLISTE ZUERST WEG. Ihre Eintraege tragen selbst `titel:`, und
    // sie stehen VOR dem Titel des Feldes — ohne diesen Schnitt hiesse das
    // Feld „Wiedergabe-Maschine" in der Aufnahme „mplayer (bewährt)".
    const ohneAuswahl = t[1].replace(/festeAuswahl:\s*\[[\s\S]*?\n\s*\],/g, '')
    const titel = /\btitel:\s*'((?:[^'\\]|\\.)*)'/.exec(ohneAuswahl)?.[1] ?? ''
    const pfad = /\bpfad:\s*\[([^\]]*)\]/.exec(t[1])?.[1]?.replace(/['\s]/g, '') ?? ''
    felder.push({
      id,
      bereich,
      seite: bereiche.get(bereich)?.seite ?? '(unbekannt)',
      bereichTitel: bereiche.get(bereich)?.titel ?? '',
      art,
      titel,
      pfad,
      zeile: zeileVon(quelle, fAnfang + t.index + 1),
    })
  }
  return { datei: 'src/backend-api/src/konfiguration.ts', bereiche, felder }
}

/** Der ganze Bestand. */
export function gliederungAufnehmen() {
  const kopfleiste = kopfleiseLesen()
  const wege = wegeLesen()
  const unterseiten = unterseitenLesen(kopfleiste, wege)
  const rahmen = readFileSync(join(WURZEL, 'src/frontend-admin/src/app/rahmen.ts'), 'utf8')
  const routen = readFileSync(join(WURZEL, 'src/frontend-admin/src/app/app.routes.ts'), 'utf8')

  const seiten = wege.map((w) => {
    const inLeiste = kopfleiste.findIndex((k) => k.weg === w.weg)
    const u = unterseiten.find((x) => x.datei === w.datei)
    const nav = inLeiste >= 0 ? zeileVon(rahmen, rahmen.indexOf(`routerLink="${w.weg}"`)) : null
    const routeStelle = routen.indexOf(`./seiten/${w.datei}'`)
    return {
      ...w,
      leiste: inLeiste >= 0 ? inLeiste + 1 : null,
      navZeile: nav,
      routeZeile: routeStelle >= 0 ? zeileVon(routen, routeStelle) : null,
      eltern: u?.eltern ?? [],
      inhalt: seiteAufnehmen(w.datei),
    }
  })

  return { kopfleiste, seiten, unterseiten, konfig: konfigFelderLesen() }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const g = gliederungAufnehmen()
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(g, (_k, v) => (v instanceof Map ? [...v] : v), 2))
    process.exit(0)
  }
  const alle = process.argv.includes('--alle')

  console.log(`KOPFLEISTE (${g.kopfleiste.length} Reiter, rahmen.ts):`)
  for (const [i, k] of g.kopfleiste.entries()) {
    const s = g.seiten.find((x) => x.weg === k.weg)
    console.log(
      `  ${String(i + 1).padStart(2)}. ${k.name.padEnd(20)} ${k.weg.padEnd(16)} rahmen.ts:${s?.navZeile ?? '?'}`,
    )
  }

  console.log('\nSEITEN:')
  for (const s of g.seiten) {
    const wo = s.leiste
      ? `Leiste #${s.leiste}`
      : s.eltern.length
        ? `Unterseite von ${s.eltern.join('+')}`
        : 'KEIN LEISTENEINTRAG'
    const p = s.inhalt
    console.log(
      `  ${s.name.padEnd(20)} ${s.weg.padEnd(16)} ${wo.padEnd(26)} ${p ? `${p.punkte.length} Bedienelemente, ${p.abschnitte.filter((a) => a.stufe !== 'h1').length} Abschnitte, ${p.zeilen} Zeilen` : '(keine Vorlage)'}`,
    )
  }

  console.log('\nKONFIGURATIONSFELDER (src/backend-api/src/konfiguration.ts) je ZIELSEITE:')
  const jeSeite = new Map()
  for (const f of g.konfig.felder) {
    if (!jeSeite.has(f.seite)) jeSeite.set(f.seite, [])
    jeSeite.get(f.seite).push(f)
  }
  for (const [seite, fs] of jeSeite) {
    console.log(`  /${seite}  (${fs.length})`)
    for (const f of fs)
      console.log(`      ${String(f.zeile).padStart(4)}  ${f.bereich.padEnd(12)} ${f.art.padEnd(9)} ${f.titel}`)
  }

  console.log('\nTOKEN-INVENTAR (E7b/L2) — genutzte CSS-Variablen und HARTE Farben daneben:')
  for (const s of g.seiten) {
    if (!s.inhalt) continue
    const t = s.inhalt.token
    const orte = t.hart.map((h) => `${h.wert}@${h.zeile}`).join(' ')
    console.log(
      `  ${s.name.padEnd(20)} ${t.form.padEnd(13)} ${String(t.genutzt.length).padStart(2)} Variablen, ${String(t.hart.length).padStart(3)} harte Farben  ${orte}`,
    )
  }

  console.log('\nINTERAKTIONSMUSTER (E7b/L3) — womit eine Seite bedient wird:')
  console.log(`  ${'Seite'.padEnd(20)} ${'Speichern'.padEnd(11)} .karte  Wahl  ${'Rückmeldung heißt'.padEnd(26)} Laden`)
  for (const s of g.seiten) {
    if (!s.inhalt) continue
    const m = s.inhalt.muster
    const r = m.rueckmeldung.length ? m.rueckmeldung.join(', ') : 'GAR NICHTS'
    console.log(
      `  ${s.name.padEnd(20)} ${m.speichern.padEnd(11)} ${String(m.karte).padStart(6)}  ${String(m.wahlknopf).padStart(4)}  ${r.padEnd(26)} ${(m.ladezustand ? 'ja' : 'NEIN').padStart(5)}`,
    )
  }
  const zaehle = (f) => g.seiten.filter((s) => s.inhalt && f(s.inhalt.muster)).length
  const mit = g.seiten.filter((s) => s.inhalt).length
  console.log(
    `  ── von ${mit} Seiten: ${zaehle((m) => m.speichern === 'fussleiste')} mit Fußleiste, ` +
      `${zaehle((m) => m.speichern === 'sofort')} schreiben SOFORT · ` +
      `${zaehle((m) => m.karte > 0)} nutzen .karte · ` +
      `${zaehle((m) => m.rueckmeldung.length === 0)} sagen gar nichts · ` +
      `${zaehle((m) => m.ladezustand)} zeigen einen Ladezustand`,
  )

  if (alle) {
    console.log('\nBEDIENELEMENTE JE SEITE:')
    for (const s of g.seiten) {
      if (!s.inhalt) continue
      console.log(`\n  ── ${s.name}  (${s.inhalt.datei})`)
      for (const r of s.inhalt.reiter) console.log(`      REITER  ${String(r.zeile).padStart(4)}  ${r.text}`)
      for (const gr of s.inhalt.gruppen)
        console.log(`      GRUPPEN ${String(gr.zeile).padStart(4)}  ${gr.feld}: ${gr.namen.join(' | ')}`)
      let letzter = null
      for (const p of s.inhalt.punkte) {
        if (p.abschnitt !== letzter) {
          console.log(`      · ${p.abschnitt || '(ohne Abschnitt)'}`)
          letzter = p.abschnitt
        }
        console.log(`        ${String(p.zeile).padStart(4)}  ${p.art.padEnd(9)} ${p.name}`)
      }
    }
  }
}
