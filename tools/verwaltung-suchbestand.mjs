/**
 * Den Suchbestand der Verwaltung AUS DEN SEITEN SELBST erheben.
 *
 * WOZU: Die Verwaltung bekommt eine Suche ueber alle Einstellungen. Die
 * heikle Frage dabei ist nicht die Oberflaeche, sondern woher die Eintraege
 * kommen. Eine von Hand gepflegte Liste laeuft auseinander, sobald jemand
 * einen Schalter hinzufuegt — und niemand merkt es, weil die Suche ihn dann
 * einfach nicht findet. Ein Schalter, den die Suche nicht kennt, ist nach dem
 * naechsten Umbau der Reiter unauffindbar.
 *
 * WARUM NICHT ZUR LAUFZEIT AUS DEM BAUM: Die Seiten sind einzeln nachgeladene
 * Routen (loadComponent in app.routes.ts). Im Baum steht immer nur die EINE
 * offene Seite; die anderen sind nicht einmal geladen. Wer alle durchsuchen
 * will, muesste sie alle bauen — samt ihrer Abrufe an die Box. Deshalb wird
 * der Bestand aus der QUELLE erhoben und als Datei mitgeliefert.
 *
 * WARUM DAS TROTZDEM NICHT AUSEINANDERLAEUFT: Es gibt eine Pruefung, die
 * genau dann anschlaegt, wenn ein Knopf fehlt —
 * tools/verwaltung-suche-vollstaendig.test.mjs erhebt den Bestand neu und
 * vergleicht ihn Zeichen fuer Zeichen mit der abgelegten Datei.
 *
 * WAS ES AENDERT: mit --schreiben genau EINE Datei,
 * src/frontend-admin/src/app/such-bestand.ts. Ohne den Schalter schreibt es
 * nichts, sondern gibt den Bestand aus.
 *
 * WAS ES NICHT KANN — und das steht hier, damit es niemand fuer einen Fehler
 * haelt:
 *   * Text, der erst zur Laufzeit entsteht ({{ ... }}), kennt es nicht. Die
 *     Konfigurationsseite besteht fast nur aus solchen Feldern: ihre Titel
 *     kommen aus /api/konfiguration. Die holt die Suche deshalb SELBST bei der
 *     Box — dieselbe Quelle, aus der die Seite sie hat. Auseinanderlaufen
 *     koennen die beiden damit gar nicht.
 *   * Es versteht kein HTML im Allgemeinen, sondern die Bauart DIESER Seiten:
 *     Knopf, Beschriftung, Auswahleintrag, Ueberschrift, die was-Spalte der
 *     Stufen und die fett gesetzten Kartentitel.
 *
 * AUFRUF
 *     node tools/verwaltung-suchbestand.mjs              # nur zeigen
 *     node tools/verwaltung-suchbestand.mjs --schreiben  # Datei erneuern
 *     node --test tools/verwaltung-suche-vollstaendig.test.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HIER = dirname(fileURLToPath(import.meta.url))
const WURZEL = join(HIER, '..')
const APP = join(WURZEL, 'src/frontend-admin/src/app')
export const SEITEN = join(APP, 'seiten')

/** Wohin die erzeugte Datei gehoert. */
export const ZIELDATEI = join(APP, 'such-bestand.ts')

/**
 * Seiten OHNE Eintrag in der Kopfleiste, die trotzdem in Ordnung sind.
 *
 * Die Anmeldung ist die einzige: sie liegt VOR dem Tor, hat keinen Rahmen und
 * damit auch keine Kopfleiste, in der man suchen koennte.
 *
 * UNTERSEITEN GEHOEREN NICHT HIERHER. Seit dem 03.08.2026 haengen „Doppelte"
 * und „Interpreten" unter „Medien" — sie stehen nicht in der Kopfleiste, sind
 * aber trotzdem voll im Bestand. Wer ihr Elternteil ist, wird nicht
 * aufgezaehlt, sondern GELESEN (unterseitenLesen). Eine Seite, die weder in
 * der Kopfleiste steht noch von einer Seite dort verlinkt ist, ist dagegen ein
 * Versehen — die Pruefung sagt es dann.
 */
export const OHNE_KOPFLEISTE = [
  'anmeldung',
  // Die Plugin-Detailseite haengt an /plugins/:kennung — der Weg dorthin ist
  // ein routerLink mit LAUFZEIT-Kennung (['/plugins', p.kennung]), und einen
  // solchen kann dieser Leser nicht als Verweis erkennen. Sie ist trotzdem
  // keine Waise: die Plugins-Seite verlinkt jede Zeile, und die Seite selbst
  // traegt den Rueckweg. Stuende sie nicht hier, meldete die Pruefung sie
  // als „ohne Kopfleiste" — dauerhaft und folgenlos.
  'plugin-eine',
]

/**
 * Seiten OHNE eine einzige Einstellung, die trotzdem in Ordnung sind.
 *
 * Die Uebersicht ist die einzige: sie besteht aus Kacheln, die auf die anderen
 * Seiten zeigen, und traegt selbst nichts, was man einstellen koennte. Eine
 * neue Seite, aus der nichts herausfaellt, ist dagegen fast immer ein
 * Erhebungsfehler — die Pruefung sagt es dann.
 */
export const OHNE_EINSTELLUNGEN = ['uebersicht']

/** Kuerzer als das ist kein Name, sondern ein Zeichen („an", „aus", „✕"). */
const MINDESTLAENGE = 4

/**
 * Ein oeffnendes Tag — und zwar so, dass ein > IM Attributwert es nicht
 * beendet. Das ist keine Feinheit: [class.an]="w().miniPlayer > 0" steht
 * genau so in darstellung.ts, und mit dem einfachen [^>]* kam als Name des
 * Knopfes der halbe Aufruf heraus.
 */
function oeffnend(name) {
  return `<${name}\\b(?:"[^"]*"|'[^']*'|[^>"'])*>`
}

/**
 * Was als sichtbarer Text zaehlt.
 *
 * Die Reihenfolge ist die Rangfolge bei Gleichstand: ein Knopf ist ein
 * besserer Treffer als ein Auswahleintrag mit demselben Wortlaut.
 */
export const QUELLEN = [
  { art: 'knopf', muster: new RegExp(`${oeffnend('button')}([\\s\\S]*?)</button>`, 'g') },
  { art: 'beschriftung', muster: new RegExp(`${oeffnend('label')}([\\s\\S]*?)</label>`, 'g') },
  { art: 'ueberschrift', muster: /<(?:h2|h3)\b[^>]*>([\s\S]*?)<\/h[23]>/g },
  { art: 'stufe', muster: /<span\s+class="was"[^>]*>([\s\S]*?)<\/span>/g },
  { art: 'kartentitel', muster: new RegExp(`${oeffnend('b')}([\\s\\S]*?)</b>`, 'g'), nurBlock: true },
  /**
   * DER NAME EINER TAT-KARTE. Dieselbe Rolle wie der fett gesetzte
   * Kartentitel, nur die andere Hausform: <div class="titel">…</div> ueber
   * einem Hinweis und einem Knopf.
   *
   * WOZU ES DAZUKAM (03.08.2026): „Oberflaeche neu laden" auf der Systemseite
   * fehlte im Bestand. Der Knopf darunter traegt seine Beschriftung in einer
   * Interpolation ({{ laeuft() ? 'Angefordert…' : 'Oberflaeche neu laden' }}),
   * und die faellt heraus — der feste Name steht NUR in diesem div. Es ist
   * die einzige Aktion der Verwaltung, die nicht in AKTIONEN (Backend) steht;
   * die vier dortigen holt die Suche selbst bei /api/system.
   *
   * ES BLEIBT BEI EINEM EINTRAG, und das ist kein Zufall: die uebrigen
   * <div class="titel"> tragen {{ s.titel }} bzw. {{ a.titel }} und werden
   * hier wie ueberall verworfen. Die Regel ist trotzdem allgemein — der
   * naechste fest beschriftete Tat-Titel kommt von selbst mit.
   */
  { art: 'tattitel', muster: /<div\s+class="titel"[^>]*>([\s\S]*?)<\/div>/g },
  { art: 'auswahl', muster: new RegExp(`${oeffnend('option')}([\\s\\S]*?)</option>`, 'g') },
  { art: 'feld', muster: /\splaceholder="([^"]*)"/g },
]

/** Ueberschriften geben den Abschnitt, in dem ein Treffer liegt. */
const UEBERSCHRIFT = /<(h1|h2|h3)\b[^>]*>([\s\S]*?)<\/\1>/g

/**
 * Steht dieses Tag am Anfang eines Blocks — oder mitten im Fliesstext?
 *
 * Fett gesetzt wird beides: der Titel einer Karte (<div><b>Für heute etwas
 * dazugeben</b>) und eine Hervorhebung in einem Satz (<p>… lässt die Box sie
 * <b>nicht</b> zusammenfassen). Das erste ist eine Beschriftung, das zweite
 * nicht. Unterscheiden laesst sich das am Tag davor.
 */
const BLOCK_TAGS = ['div', 'label', 'li', 'section', 'td', 'form']

function stehtAmBlockanfang(html, stelle) {
  const davor = html.slice(0, stelle)
  const letztes = davor.lastIndexOf('<')
  if (letztes < 0) return false
  if (davor.slice(letztes).includes('>') === false) return false
  const zwischen = davor.slice(davor.indexOf('>', letztes) + 1)
  if (zwischen.trim() !== '') return false
  const name = /^<\/?([a-z0-9]+)/i.exec(davor.slice(letztes))?.[1]?.toLowerCase()
  return name !== undefined && BLOCK_TAGS.includes(name)
}

/**
 * Die Vorlage einer Seite herausschneiden.
 *
 * Das geht so einfach nur, weil in diesen Vorlagen KEINE Backticks vorkommen
 * duerfen — sie stehen in Template-Literalen, ein Backtick beendet sie mitten
 * im HTML (llmwiki: backticks-in-angular-vorlagen). Die Regel ist hier also
 * nicht nur Stil, sondern Voraussetzung.
 */
export function vorlageVon(quelle) {
  const anfang = quelle.indexOf('template: `')
  if (anfang < 0) return ''
  const von = anfang + 'template: `'.length
  const bis = quelle.indexOf('`', von)
  return bis < 0 ? '' : quelle.slice(von, bis)
}

/** HTML-Kommentare weg — sie sind nicht sichtbar und stehen voller Begruendung. */
export function ohneKommentare(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '')
}

const ENTITAETEN = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&hellip;': '…',
  '&minus;': '−',
}

/**
 * Bedingte Bloecke (@if/@else/@for/@switch) samt Inhalt entfernen.
 *
 * NUR INNERHALB eines Knopfes oder einer Beschriftung — niemals auf die ganze
 * Vorlage. Auf der Darstellungsseite liegt fast alles in einem @if, das den
 * Reiter abfragt; wer dort Bloecke wegwirft, wirft die Seite weg. Innerhalb
 * einer Beschriftung dagegen steht in einem @if kein fester Text, sondern
 * genau das, was der Knopf mal so und mal so sagt („aus" / „Aufnehmen").
 */
function ohneBloecke(s) {
  const anfang = /@(?:if|else if|else|for|switch|case|default|empty|placeholder|loading|defer)\b[^{]*\{/
  let t = s
  for (;;) {
    const t1 = anfang.exec(t)
    if (!t1) return t
    let tiefe = 1
    let i = t1.index + t1[0].length
    while (i < t.length && tiefe > 0) {
      if (t[i] === '{') tiefe++
      else if (t[i] === '}') tiefe--
      i++
    }
    t = `${t.slice(0, t1.index)} ${t.slice(i)}`
  }
}

/**
 * Aus Auszeichnung wird der Text, den ein Mensch sieht.
 *
 * {{ ... }} faellt heraus, nicht weil es unwichtig waere, sondern weil dort
 * ein Wert steht, den erst die Box kennt. Was danach uebrig bleibt, ist der
 * feste Teil der Beschriftung — und genau der steht auf dem Knopf, egal was
 * die Box gerade sagt.
 */
export function sichtbar(roh) {
  // Eine Beschriftung umschliesst oft die Auswahl, zu der sie gehoert. Deren
  // Eintraege sind eigene Treffer und nicht Teil der Beschriftung — sonst
  // hiesse das Feld „Mein Platinenstand: — nicht eingetragen —".
  let t = ohneBloecke(roh).replace(/<select\b[\s\S]*?<\/select>/g, ' ')
  t = t.replace(/\{\{[\s\S]*?\}\}/g, ' ')
  t = t.replace(/<[^>]*>/g, ' ')
  for (const [e, z] of Object.entries(ENTITAETEN)) t = t.split(e).join(z)
  // Leere Klammern sind der Rest einer Anzahl: „Von Hand getrennt ( )".
  t = t.replace(/\(\s*\)/g, ' ')
  t = t.replace(/\s+/g, ' ').trim()
  // Vorzeichen und Doppelpunkte am Rand gehoeren zum Wert, nicht zum Namen.
  return t.replace(/^[+\-−–—:•*\s]+/, '').replace(/[−–—:•*\s]+$/, '')
}

/**
 * Taugt der Text als Eintrag?
 *
 * Ein Satz ist keine Beschriftung. „Die Sprachausgabe ist auf dieser Box nicht
 * eingerichtet." steht fett auf der Vorlesen-Seite und ist eine Auskunft —
 * niemand tippt sie in ein Suchfeld. Der Punkt am Ende unterscheidet sie
 * zuverlaessiger als jede Laengengrenze.
 */
export function taugt(text) {
  if (text.length < MINDESTLAENGE) return false
  if (text.endsWith('.')) return false
  return /\p{L}/u.test(text)
}

/** Die Kopfleiste ist die Liste der Seitennamen, wie der Benutzer sie liest. */
export function kopfleiseLesen() {
  const quelle = readFileSync(join(APP, 'rahmen.ts'), 'utf8')
  const raus = []
  for (const t of quelle.matchAll(/<a\s+routerLink="([^"]+)"[\s\S]*?>([\s\S]*?)<\/a>/g)) {
    const name = sichtbar(t[2])
    if (name) raus.push({ weg: t[1], name })
  }
  return raus
}

/**
 * Welche Datei liegt auf welchem Weg?
 *
 * Gesucht wird zum Nachladen die zugehoerige Wegangabe DAVOR — nicht
 * umgekehrt. Die Routen sind verschachtelt (der Rahmen ist selbst eine Route
 * mit Kindern); vom Nachladen aus rueckwaerts zu lesen kommt ohne Annahme
 * ueber diese Verschachtelung aus.
 */
export function wegeLesen() {
  const quelle = readFileSync(join(APP, 'app.routes.ts'), 'utf8')
  const wege = [...quelle.matchAll(/path:\s*'([^']*)'/g)].map((t) => ({
    stelle: t.index,
    pfad: t[1],
  }))
  // Der Titel steht ZWISCHEN Weg und Nachladen: `title: 'Doppelte – MixPiBox'`.
  // Er ist der amtliche Name der Seite (er steht so im Reiter des Browsers) und
  // damit der richtige Name fuer eine Seite, die in keiner Kopfleiste steht.
  const titel = [...quelle.matchAll(/title:\s*'([^']*)'/g)].map((t) => ({
    stelle: t.index,
    name: t[1].split(' – ')[0].trim(),
  }))
  const raus = []
  for (const t of quelle.matchAll(/import\('\.\/seiten\/([\w-]+)'\)/g)) {
    const davor = wege.filter((w) => w.stelle < t.index).pop()
    if (!davor) continue
    const name = titel.filter((x) => x.stelle > davor.stelle && x.stelle < t.index).pop()
    raus.push({
      datei: t[1],
      weg: davor.pfad === '' ? '/' : `/${davor.pfad}`,
      name: name?.name ?? '',
    })
  }
  return raus
}

/**
 * UNTERSEITEN: eigener Weg, aber kein Eintrag in der Kopfleiste.
 *
 * WOZU DAS UEBERHAUPT NOETIG WURDE: Bis zum 03.08.2026 galt „jede Seite steht
 * in der Kopfleiste" — der Bestand lief einfach ueber sie. Dann wanderten
 * „Doppelte" und „Interpreten" unter „Medien" und verschwanden aus der Leiste.
 * Ohne das hier waeren ihre rund dreissig Eintraege LAUTLOS aus der Suche
 * gefallen: nichts waere kaputtgegangen, man haette sie nur nicht mehr
 * gefunden — genau der Fehler, gegen den es diesen Bestand gibt.
 *
 * WER DAS ELTERNTEIL IST, WIRD NICHT AUFGEZAEHLT, SONDERN GELESEN: es ist die
 * Kopfleisten-Seite, deren Vorlage `routerLink="<weg>"` enthaelt. Eine
 * Pflegeliste waere hier besonders tueckisch — sie stuende richtig da, waehrend
 * der Weg auf der Seite laengst weg ist.
 *
 * GELESEN WERDEN ALLE Seiten ohne Leisteneintrag, auch die Anmeldung. Sie
 * bekommt dabei null Elternteile und faellt damit in denselben Topf wie eine
 * vergessene Seite — aufgeloest wird das an EINER Stelle (OHNE_KOPFLEISTE, in
 * der Pruefung) und nicht an zweien.
 *
 * Rueckgabe je Seite: { datei, weg, name, eltern[] }. Null oder mehr als ein
 * Elternteil ist ein Befund und keine Entscheidung dieses Werkzeugs; die
 * Pruefung schlaegt darauf an.
 */
export function unterseitenLesen(kopfleiste = kopfleiseLesen(), wege = wegeLesen()) {
  const raus = []
  for (const w of wege) {
    if (kopfleiste.some((k) => k.weg === w.weg)) continue
    const eltern = []
    for (const k of kopfleiste) {
      const datei = wege.find((x) => x.weg === k.weg)?.datei
      if (!datei || datei === w.datei) continue
      const quelle = readFileSync(join(SEITEN, `${datei}.ts`), 'utf8')
      if (quelle.includes(`routerLink="${w.weg}"`)) eltern.push(k.name)
    }
    raus.push({ datei: w.datei, weg: w.weg, name: w.name, eltern })
  }
  return raus
}

/** Alle Eintraege EINER Seite, in der Reihenfolge, in der sie dort stehen. */
export function seiteErheben(datei, seite, weg) {
  const quelle = readFileSync(join(SEITEN, `${datei}.ts`), 'utf8')
  return vorlageErheben(vorlageVon(quelle), seite, weg)
}

/**
 * Dasselbe aus einer Vorlage im Speicher.
 *
 * Getrennt, damit die Pruefung eine erfundene Seite durchschicken kann: nur so
 * laesst sich zeigen, dass ein NEU hinzugefuegter Schalter auch wirklich
 * gefunden wird — und nicht bloss die 182, die heute zufaellig da sind.
 */
export function vorlageErheben(rohe, seite, weg) {
  const html = ohneKommentare(rohe)

  // Die Ueberschriften mit ihrer Stelle: der Abschnitt eines Treffers ist die
  // letzte Ueberschrift davor. Die h1 ist der Seitentitel und damit KEIN
  // Abschnitt — sonst stuende an jedem Treffer „Medien — Medien".
  const abschnitte = []
  for (const t of html.matchAll(UEBERSCHRIFT)) {
    if (t[1] === 'h1') continue
    const name = sichtbar(t[2])
    if (name) abschnitte.push({ stelle: t.index, name })
  }

  const gefunden = []
  for (const q of QUELLEN) {
    for (const t of html.matchAll(q.muster)) {
      if (q.nurBlock && !stehtAmBlockanfang(html, t.index)) continue
      const text = sichtbar(t[1])
      if (!taugt(text)) continue
      // Eine Ueberschrift IST der Abschnitt; ihr die vorige zuzuschreiben
      // ergaebe „Doppelte › Der Schalter › Abgleichen" — beides Ueberschriften,
      // die nichts miteinander zu tun haben.
      const davor = q.art === 'ueberschrift' ? null : abschnitte.filter((a) => a.stelle < t.index).pop()
      gefunden.push({ stelle: t.index, art: q.art, text, seite, weg, bereich: davor?.name ?? '' })
    }
  }

  gefunden.sort(
    (a, b) =>
      a.stelle - b.stelle || QUELLEN.findIndex((q) => q.art === a.art) - QUELLEN.findIndex((q) => q.art === b.art),
  )

  // Derselbe Wortlaut zweimal auf einer Seite ist EIN Eintrag. Behalten wird
  // der erste — meist der Knopf, nicht der Auswahleintrag.
  const gesehen = new Set()
  const raus = []
  for (const e of gefunden) {
    const schluessel = e.text.toLowerCase()
    if (gesehen.has(schluessel)) continue
    gesehen.add(schluessel)
    raus.push({ text: e.text, seite: e.seite, weg: e.weg, bereich: e.bereich })
  }
  return raus
}

/**
 * Der ganze Bestand: erst die Seiten selbst, dann was auf ihnen steht.
 *
 * Die Seiten kommen mit hinein, weil „wo finde ich Bluetooth" eine der
 * haeufigsten Fragen ist und die Antwort dann nicht an einem Knopf haengt.
 */
export function bestandErheben() {
  const kopfleiste = kopfleiseLesen()
  const wege = wegeLesen()
  const unterseiten = unterseitenLesen(kopfleiste, wege)
  const raus = []
  const ohneEintraege = []

  // Ein Seitenname, der irgendwo als Ueberschrift oder Kachel auftaucht, ist
  // kein eigener Treffer: „Konfiguration" steht auch auf der Uebersicht, aber
  // gemeint ist immer die Seite. Sonst zeigten zwei Zeilen auf dieselbe Sache
  // und eine davon auf den falschen Ort. Unterseiten zaehlen mit — sie sind
  // Seiten, sie stehen nur nicht in der Leiste.
  const seitennamen = new Set(
    [...kopfleiste.map((k) => k.name), ...unterseiten.map((u) => u.name)].map((n) => n.toLowerCase()),
  )

  /** Eine Seite einsammeln — der Ablauf ist fuer Leiste und Unterseite derselbe. */
  function seiteDazu(datei, name, weg, eltern) {
    raus.push({ text: name, seite: name, weg, bereich: 'Seite', ...(eltern ? { eltern } : {}) })
    const eintraege = seiteErheben(datei, name, weg)
      .filter((e) => !seitennamen.has(e.text.toLowerCase()))
      .map((e) => (eltern ? { ...e, eltern } : e))
    if (eintraege.length === 0) ohneEintraege.push(datei)
    raus.push(...eintraege)
  }

  for (const k of kopfleiste) {
    const datei = wege.find((w) => w.weg === k.weg)?.datei
    if (!datei) continue
    seiteDazu(datei, k.name, k.weg, '')
    // Die Unterseiten stehen DIREKT hinter ihrer Elternseite. Der Bestand ist
    // eine Datei, die man liest; „Doppelte" mitten unter „Netzwerk" zu finden
    // waere richtig und trotzdem unlesbar.
    for (const u of unterseiten.filter((x) => x.eltern.length === 1 && x.eltern[0] === k.name)) {
      seiteDazu(u.datei, u.name, u.weg, k.name)
    }
  }

  // Weder in der Leiste noch von genau einer Seite dort verlinkt: das ist der
  // Befund, den die Pruefung sehen muss. Bei ZWEI Elternteilen waere der Ort
  // eines Treffers eine Behauptung — welcher der beiden Wege ist gemeint?
  const ohneNavigation = unterseiten.filter((u) => u.eltern.length !== 1).map((u) => u.datei)

  return { eintraege: raus, ohneNavigation, ohneEintraege, unterseiten }
}

/** Eine Zeichenkette so, wie der Bestand sie schreibt: einfache Anfuehrung. */
function zeichenkette(s) {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

/** Der Inhalt der erzeugten Datei — als Text, damit die Pruefung vergleichen kann. */
export function dateiInhalt(eintraege) {
  // `eltern` steht nur dort, wo es etwas sagt (bei Unterseiten). Es an jede
  // Zeile zu schreiben blaehte die Diff bei jedem Umbau auf 200 Zeilen auf,
  // und genau die Diff ist das Werkzeug, mit dem man einen ungewollten Umzug
  // erkennt ([[neue-ueberschrift-erbt-fremde-sucheintraege]]).
  const zeilen = eintraege.map((e) => {
    const dazu = e.eltern ? `, eltern: ${zeichenkette(e.eltern)}` : ''
    return `  { text: ${zeichenkette(e.text)}, seite: ${zeichenkette(e.seite)}, weg: ${zeichenkette(e.weg)}, bereich: ${zeichenkette(e.bereich)}${dazu} },`
  })
  return `/**
 * ERZEUGT von tools/verwaltung-suchbestand.mjs — NICHT von Hand aendern.
 *
 * Was die Suche der Verwaltung kennt: der sichtbare Text jedes Knopfes, jeder
 * Beschriftung und jeder Ueberschrift, samt der Seite, auf der er liegt.
 * Erhoben wird er aus den Seiten selbst, damit er nicht auseinanderlaeuft;
 * dass er es nicht tut, prueft tools/verwaltung-suche-vollstaendig.test.mjs.
 *
 * Erneuern:  node tools/verwaltung-suchbestand.mjs --schreiben
 */
import type { SuchEintrag } from './suche.filter'

export const SUCH_BESTAND: SuchEintrag[] = [
${zeilen.join('\n')}
]
`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { eintraege, ohneNavigation, ohneEintraege, unterseiten } = bestandErheben()
  const unerwartet = ohneNavigation.filter((d) => !OHNE_KOPFLEISTE.includes(d))
  if (process.argv.includes('--schreiben')) {
    writeFileSync(ZIELDATEI, dateiInhalt(eintraege), 'utf8')
    console.log(`${eintraege.length} Eintraege geschrieben nach ${ZIELDATEI}`)
  } else {
    const jeSeite = new Map()
    for (const e of eintraege) jeSeite.set(e.seite, (jeSeite.get(e.seite) ?? 0) + 1)
    for (const [seite, anzahl] of jeSeite) console.log(`${String(anzahl).padStart(4)}  ${seite}`)
    console.log(`----\n${eintraege.length} Eintraege gesamt`)
    if (process.argv.includes('--alle'))
      for (const e of eintraege) console.log(`  ${e.seite} › ${e.bereich || '—'} › ${e.text}`)
  }
  // Die Gliederung mit ausgeben: eine Seite, die man in der Kopfleiste sucht
  // und nicht findet, ist der haeufigste Grund, dieses Werkzeug aufzurufen.
  for (const u of unterseiten.filter((x) => x.eltern.length === 1)) {
    console.log(`UNTERSEITE: ${u.eltern[0]} › ${u.name}  (${u.weg})`)
  }
  if (ohneEintraege.length) console.log(`OHNE EINTRAEGE: ${ohneEintraege.join(', ')}`)
  if (unerwartet.length) console.log(`OHNE KOPFLEISTE: ${unerwartet.join(', ')}`)
  // Ohne Alle-Ausgabe bleibt die Datei fuer sich; ein Fehlschlag gehoert in die Pruefung.
}
