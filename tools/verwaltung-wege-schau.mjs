/**
 * DIE WEGE DER VERWALTUNG: fuehrt jeder irgendwohin, und kommt man zurueck?
 *
 * WOZU — und warum das erst am 03.08.2026 noetig wurde: Bis dahin galt „jede
 * Seite steht in der Kopfleiste". Dann wurden „Doppelte" und „Interpreten"
 * UNTERSEITEN von „Medien", und damit gibt es zum ersten Mal Seiten, auf denen
 * KEIN Leisteneintrag leuchtet. Wer ueber ein Lesezeichen oder die Suche
 * hereinkommt, steht auf einer Seite, deren Name in der Leiste nicht vorkommt.
 * Der Weg HIN war gebaut; der Weg ZURUECK fehlte auf beiden Seiten, und
 * gemerkt hat es niemand — kein Test, kein Uebersetzer, kein Bau.
 *
 * Dieselbe Bewegung liess einen zweiten Befund zurueck: „Doppelte
 * zusammenfassen" und „Ganze Diskografie" zogen von der Darstellung auf die
 * Medienseite, aber beide Unterseiten verwiesen weiter mit
 * „in der Darstellung umstellen" auf /darstellung. Der Verweis war nicht tot
 * — die Seite gibt es ja — er zeigte nur auf eine Seite, auf der der genannte
 * Schalter nicht mehr steht. Das findet dieses Werkzeug NICHT (es kann nicht
 * wissen, was ein Verweis verspricht); dagegen hilft nur, dass beim Umzug
 * eines Schalters seine Verweise mitwandern. Was es findet, ist die Klasse
 * darunter: ein Weg, den es gar nicht gibt, und eine Seite ohne Rueckweg.
 *
 * WAS ES PRUEFT (alles am Quelltext, kein Browser, keine Box, Millisekunden):
 *   1. TOTER WEG        ein routerLink auf einen Pfad, den app.routes.ts nicht
 *                       kennt. Angular schickt still auf '' um (der
 *                       **-Zweig) — man landet auf der Uebersicht und haelt
 *                       es fuer einen Fehlklick.
 *   2. OHNE RUECKWEG    eine Unterseite (nicht in der Kopfleiste, von genau
 *                       einer Seite dort verlinkt), die NICHT auf ihre
 *                       Elternseite zurueckverweist.
 *   3. VERWAIST         eine Seite, zu der weder die Kopfleiste noch
 *                       irgendeine andere Seite einen Weg hat. Sie existiert
 *                       dann nur noch fuer den, der die Adresse auswendig
 *                       kennt.
 *   4. NICHT GELESEN    ein anklickbarer Eintrag der Kopfleiste, den
 *                       kopfleiseLesen() NICHT sieht. Seit dem 05.08.2026,
 *                       und er hat sich sofort gelohnt: dessen Ausdruck
 *                       verlangt routerLink als ERSTES Attribut. Ein
 *                       vorangestelltes class= nimmt den Eintrag lautlos aus
 *                       der Leiste UND aus dem Suchbestand — beim Umbau der
 *                       Gliederung fiel die „Uebersicht" so heraus, 14 Reiter
 *                       wurden 13, 191 Sucheintraege 190, und alles blieb
 *                       gruen. Hier faellt es auf, weil wegeInDatei() die
 *                       Attributreihenfolge NICHT kennt: zwei Leser derselben
 *                       Stelle mit verschiedener Strenge sind der Befund.
 *   5. OHNE GRUPPE      ein Leisteneintrag, der in keiner Gruppe steht.
 *                       Seit dem 05.08.2026 ist die Kopfleiste in vier
 *                       Gruppen geteilt; ein neuer Reiter, der neben ihnen
 *                       liegt, sieht aus wie ein Versehen und ist meistens
 *                       auch eins. Ausgenommen ist genau die „Uebersicht"
 *                       (OHNE_GRUPPE) — sie ist der Weg an den Anfang und
 *                       kein Thema neben den anderen.
 *   6. ZWEI SCHREIBER   ein Element, das dieselbe Klasse von ZWEI Stellen
 *                       bekommt: `routerLinkActive="hier"` und daneben
 *                       `[class.hier]="…"`. Beide schreiben, die Bindung
 *                       gewinnt — sie ENTFERNT, was die Direktive gerade
 *                       gesetzt hat. Nachgestellt am 05.08.2026 in einer
 *                       Wegwerf-Arbeitskopie: mit beidem am „Medien"-Eintrag
 *                       leuchtet auf /verschmelzung und /interpreten GAR
 *                       NICHTS mehr — und alles bleibt gruen. Kopfleiste 14,
 *                       Suchbestand 195, ELTERN UNEINIG leer, `tsc` und
 *                       `biome` zufrieden. Genau da hing der Umbau, der das
 *                       Leuchten reparieren sollte, schon einmal fest.
 *
 * WER DIE ELTERN SIND, WIRD NICHT ZWEIMAL ENTSCHIEDEN: die Aufteilung in
 * Kopfleiste, Wege und Unterseiten kommt aus tools/verwaltung-suchbestand.mjs.
 * Eine zweite Meinung darueber waere genau der Fehler, den beide Werkzeuge
 * verhindern sollen.
 *
 * VERWEISE IN KOMMENTAREN ZAEHLEN NICHT. Die Vorlagen dieser Seiten stehen
 * voller Begruendung, und in mehreren davon werden alte Wege beim Namen
 * genannt („stand bis zum 03.08.2026 hier"). Ein Weg, den niemand anklicken
 * kann, ist keiner.
 *
 * GENAU DARIN LIEGT DER NUTZEN NEBEN DEM SUCHBESTAND: dessen
 * `unterseitenLesen()` sucht `routerLink="<weg>"` im GANZEN Quelltext, also
 * auch in Kommentaren. Loescht jemand die Kachel von der Medienseite und
 * laesst die Begruendung stehen, haelt der Suchbestand „Medien" weiter fuer
 * das Elternteil und meldet nichts — hier faellt die Seite dann als VERWAIST
 * heraus, weil kein anklickbarer Weg mehr auf sie zeigt.
 *
 * WAS ES AENDERT: nichts. Es liest.
 *
 * AUFRUF
 *     node tools/verwaltung-wege-schau.mjs            # Gliederung zeigen
 *     node tools/verwaltung-wege-schau.mjs --pruefen  # Exitcode 1 bei Befund
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { kopfleiseLesen, OHNE_KOPFLEISTE, unterseitenLesen, wegeLesen } from './verwaltung-suchbestand.mjs'

const HIER = dirname(fileURLToPath(import.meta.url))
const APP = join(HIER, '../src/frontend-admin/src/app')
const SEITEN = join(APP, 'seiten')

/** Die Vorlage einer Komponente — ohne sie ist jeder Verweis nur Text. */
export function vorlageVon(quelle) {
  const anfang = quelle.indexOf('template: `')
  if (anfang < 0) return ''
  const von = anfang + 'template: `'.length
  const bis = quelle.indexOf('`', von)
  return bis < 0 ? '' : quelle.slice(von, bis)
}

/** Anklickbare Wege einer Datei: aus der Vorlage, ohne Kommentare. */
export function wegeInDatei(pfad) {
  const vorlage = vorlageVon(readFileSync(pfad, 'utf8')).replace(/<!--[\s\S]*?-->/g, '')
  return [...vorlage.matchAll(/routerLink="([^"]+)"/g)].map((t) => t[1])
}

/**
 * Leisteneintraege, die absichtlich in KEINER Gruppe stehen.
 *
 * Genau einer: die Uebersicht. Sie ist der Weg zurueck an den Anfang und
 * gehoert deshalb neben die Gruppen, nicht in eine — sonst muesste man eine
 * fuenfte Ueberschrift erfinden, unter der ein einziger Eintrag steht.
 */
export const OHNE_GRUPPE = ['/']

/**
 * DIE GRUPPEN DER KOPFLEISTE, gelesen statt gepflegt.
 *
 * Eine Gruppe ist ein <section class="gruppe"> mit einer Ueberschrift
 * (<span class="gruppentitel">) und den Eintraegen darin. Sie sind mit Absicht
 * NICHT verschachtelt: eine flache Form laesst sich mit einem Ausdruck lesen,
 * eine geschachtelte nicht — und eine Zugehoerigkeit, die man von Hand
 * pflegen muesste, stuende beim ersten Umbau falsch da.
 */
export function gruppenLesen(pfad) {
  const vorlage = vorlageVon(readFileSync(pfad, 'utf8')).replace(/<!--[\s\S]*?-->/g, '')
  const raus = []
  for (const t of vorlage.matchAll(/<section class="gruppe">([\s\S]*?)<\/section>/g)) {
    const titel = t[1].match(/<span class="gruppentitel">([\s\S]*?)<\/span>/)?.[1].trim() ?? ''
    const wege = [...t[1].matchAll(/routerLink="([^"]+)"/g)].map((x) => x[1])
    raus.push({ titel, wege })
  }
  return raus
}

/**
 * ELEMENTE, DIE DIESELBE KLASSE VON ZWEI STELLEN BEKOMMEN.
 *
 * `routerLinkActive="hier"` und `[class.hier]="…"` am selben Element sind
 * beide fuer sich richtig und zusammen ein Loeschbefehl: Angular wertet die
 * Bindung aus, nachdem die Direktive gesetzt hat, und eine Bindung auf `false`
 * NIMMT die Klasse weg. Der Eintrag bleibt danach dunkel — auf genau den
 * Seiten, fuer die man ihn gerechnet hat.
 *
 * WARUM DAS EINE EIGENE PRUEFUNG BRAUCHT und nicht unter „ELTERN UNEINIG"
 * mitfaellt: dort wird die LISTE geprueft, hier die SCHREIBWEISE. Am
 * 05.08.2026 in einer Wegwerf-Arbeitskopie nachgestellt — mit beidem am
 * „Medien"-Eintrag meldete kein einziges Werkzeug etwas, und im Browser
 * leuchtete auf beiden Unterseiten nichts.
 *
 * ES WIRD NICHT DIE DIREKTIVE VERBOTEN. Verboten ist nur das NEBENEINANDER:
 * dreizehn Eintraege der Leiste tragen `routerLinkActive` und sollen es
 * behalten. Wer eine Elternschaft rechnen will, nimmt die Direktive an DIESEM
 * einen Element weg — das ist der ganze Unterschied.
 *
 * Gelesen wird die reine Auszeichnung; `zweiSchreiberIn` nimmt deshalb eine
 * Zeichenkette und keine Datei, damit die Pruefung erfundene Faelle
 * durchschicken kann.
 */
export function zweiSchreiberIn(html) {
  const raus = []
  for (const t of html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<([a-zA-Z][\w-]*)\s([^>]*)>/g)) {
    const attribute = t[2]
    // routerLinkActive darf MEHRERE Klassen nennen ("hier aktiv") — jede
    // einzelne kann die Kollision sein.
    const direktive = attribute.match(/routerLinkActive="([^"]*)"/)?.[1] ?? ''
    const gesetzt = direktive.trim() ? direktive.trim().split(/\s+/) : []
    if (gesetzt.length === 0) continue
    const gebunden = [...attribute.matchAll(/\[class\.([\w-]+)\]/g)].map((x) => x[1])
    const weg = attribute.match(/routerLink="([^"]*)"/)?.[1] ?? ''
    for (const k of gesetzt) {
      if (gebunden.includes(k)) raus.push({ tag: t[1], klasse: k, weg })
    }
  }
  return raus
}

/**
 * DIE BEHAUPTETE ELTERNSCHAFT aus rahmen.ts (`UNTERSEITE_VON`).
 *
 * Der Rahmen braucht sie, damit „Medien" mitleuchtet, solange man auf
 * /verschmelzung oder /interpreten steht — routerLinkActive kann das nicht,
 * es vergleicht Pfade, und /verschmelzung faengt nicht mit /medien an. Zur
 * Laufzeit ist die Elternschaft nicht ablesbar: die Unterseiten sind im Router
 * GESCHWISTER, damit ihre Adressen unveraendert bleiben.
 *
 * Also steht dort eine Liste — und Listen laufen auseinander. Deshalb wird sie
 * hier GELESEN und gegen die erhobene Elternschaft gehalten. Dasselbe Mittel
 * wie bei AKTION_ORT in suche.ts: behaupten darf man, unnachgeprueft nicht.
 */
export function elternBehauptungLesen(pfad) {
  const quelle = readFileSync(pfad, 'utf8')
  const anfang = quelle.indexOf('UNTERSEITE_VON')
  if (anfang < 0) return null
  const von = quelle.indexOf('{', anfang)
  const bis = quelle.indexOf('}', von)
  if (von < 0 || bis < 0) return null
  const raus = {}
  for (const t of quelle.slice(von, bis).matchAll(/'([^']+)'\s*:\s*'([^']+)'/g)) raus[t[1]] = t[2]
  return raus
}

/**
 * Die REINE Rechnung, ohne Dateien.
 *
 * Getrennt, damit die Pruefung eine erfundene Gliederung durchschicken kann.
 * Sonst pruefte sie nur, dass HEUTE alles stimmt — und nicht, dass der Befund
 * auch wirklich anschlaegt, wenn morgen ein Rueckweg fehlt. Genau daran ist
 * hier schon einmal etwas vorbeigerutscht: die Regel gegen Backticks stand
 * jahrelang im Wiki und hatte keine Pruefung.
 *
 * `wegeJeDatei` ist eine Abbildung Datei -> anklickbare Wege ('rahmen' fuer
 * die Kopfleiste).
 */
export function befundeAus({
  kopfleiste,
  wege,
  unterseiten,
  wegeJeDatei,
  ohneKopfleiste = OHNE_KOPFLEISTE,
  // `null` heisst NICHT GEMESSEN und wird nicht beurteilt — nicht „keine
  // Gruppen, also nichts zu melden". Der Unterschied ist der ganze Punkt:
  // eine Pruefung, die bei fehlender Angabe gruen meldet, ist keine.
  gruppen = null,
  ohneGruppe = OHNE_GRUPPE,
  // Wie oben: `null` heisst NICHT GEMESSEN, nicht „keine Behauptung".
  elternBehauptung = null,
  // Und noch einmal: `null` heisst NICHT GEMESSEN. Eine leere Liste ist die
  // Aussage „nachgesehen, nichts gefunden" — die beiden zu verwechseln macht
  // aus einer nicht gelaufenen Pruefung eine bestandene.
  zweiSchreiber = null,
}) {
  const bekannt = new Set(wege.map((w) => w.weg))
  const tote = []
  const verwiesen = new Set()

  for (const [datei, ziele] of Object.entries(wegeJeDatei)) {
    for (const z of ziele) {
      verwiesen.add(z)
      if (!bekannt.has(z)) tote.push({ von: `${datei}.ts`, nach: z })
    }
  }

  // Unterseiten mit genau einem Elternteil sind die, die eine Gliederung
  // haben. Alles andere ist ein Befund fuer verwaltung-suchbestand.mjs und
  // nicht fuer dieses Werkzeug.
  const ohneRueckweg = []
  for (const u of unterseiten.filter((x) => x.eltern.length === 1)) {
    const elternWeg = kopfleiste.find((k) => k.name === u.eltern[0])?.weg
    if (elternWeg === undefined) continue
    if (!(wegeJeDatei[u.datei] ?? []).includes(elternWeg)) {
      ohneRueckweg.push({ datei: u.datei, name: u.name, weg: u.weg, eltern: u.eltern[0], elternWeg })
    }
  }

  const verwaist = wege
    .filter((w) => !verwiesen.has(w.weg) && !ohneKopfleiste.includes(w.datei))
    .map((w) => ({ datei: w.datei, weg: w.weg }))

  // ZWEI LESER DERSELBEN STELLE, absichtlich verschieden streng: was in der
  // Vorlage des Rahmens anklickbar ist, MUSS auch in der Kopfleiste stehen.
  // Steht es dort nicht, hat kopfleiseLesen() es uebersehen — und dann fehlt
  // der Eintrag zugleich im Suchbestand, ohne dass irgendetwas rot wird.
  const leiste = wegeJeDatei.rahmen ?? []
  const nichtGelesen = leiste.filter((z) => !kopfleiste.some((k) => k.weg === z)).map((z) => ({ weg: z }))

  // Ein Leisteneintrag ausserhalb jeder Gruppe. Gemessen wird gegen die
  // GELESENE Gruppierung, nicht gegen eine Liste hier.
  const ungruppiert =
    gruppen === null
      ? []
      : kopfleiste
          .filter((k) => !ohneGruppe.includes(k.weg))
          .filter((k) => !gruppen.some((g) => g.wege.includes(k.weg)))
          .map((k) => ({ name: k.name, weg: k.weg }))

  // DIE BEHAUPTETE gegen die ERHOBENE Elternschaft, in BEIDE Richtungen.
  // Nur eine Richtung zu pruefen liesse jeweils die haelfte durch: eine
  // Unterseite, die in der Liste fehlt, leuchtet nirgends; ein Eintrag, den es
  // nicht mehr gibt, laesst einen fremden Reiter leuchten.
  const elternUneinig = []
  if (elternBehauptung !== null) {
    const echt = new Map()
    for (const u of unterseiten.filter((x) => x.eltern.length === 1)) {
      const elternWeg = kopfleiste.find((k) => k.name === u.eltern[0])?.weg
      if (elternWeg !== undefined) echt.set(u.weg, elternWeg)
    }
    for (const [weg, elternWeg] of echt) {
      if (elternBehauptung[weg] === undefined) {
        elternUneinig.push({ weg, gemessen: elternWeg, behauptet: null })
      } else if (elternBehauptung[weg] !== elternWeg) {
        elternUneinig.push({ weg, gemessen: elternWeg, behauptet: elternBehauptung[weg] })
      }
    }
    for (const [weg, behauptet] of Object.entries(elternBehauptung)) {
      if (!echt.has(weg)) elternUneinig.push({ weg, gemessen: null, behauptet })
    }
  }

  return {
    tote,
    ohneRueckweg,
    verwaist,
    nichtGelesen,
    ungruppiert,
    elternUneinig,
    zweiSchreiber: zweiSchreiber ?? [],
  }
}

export function schau() {
  const kopfleiste = kopfleiseLesen()
  const wege = wegeLesen()
  const unterseiten = unterseitenLesen(kopfleiste, wege)

  // Die Kopfleiste zaehlt mit: sie ist der Weg zu den meisten Seiten.
  const wegeJeDatei = { rahmen: wegeInDatei(join(APP, 'rahmen.ts')) }
  for (const w of wege) wegeJeDatei[w.datei] = wegeInDatei(join(SEITEN, `${w.datei}.ts`))
  const gruppen = gruppenLesen(join(APP, 'rahmen.ts'))
  const elternBehauptung = elternBehauptungLesen(join(APP, 'rahmen.ts'))
  // Ueber die GANZE Datei, nicht nur ueber die Vorlage des Rahmens: die Falle
  // steht in jeder Angular-Vorlage offen, und die Unterseiten haben eigene.
  const zweiSchreiber = [
    ...zweiSchreiberIn(vorlageVon(readFileSync(join(APP, 'rahmen.ts'), 'utf8'))),
    ...wege.flatMap((w) => zweiSchreiberIn(vorlageVon(readFileSync(join(SEITEN, `${w.datei}.ts`), 'utf8')))),
  ]

  return {
    kopfleiste,
    unterseiten,
    gruppen,
    elternBehauptung,
    ...befundeAus({ kopfleiste, wege, unterseiten, wegeJeDatei, gruppen, elternBehauptung, zweiSchreiber }),
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const {
    kopfleiste,
    unterseiten,
    gruppen,
    tote,
    ohneRueckweg,
    verwaist,
    nichtGelesen,
    ungruppiert,
    elternUneinig,
    zweiSchreiber,
  } = schau()
  console.log(`Kopfleiste: ${kopfleiste.length} Eintraege in ${gruppen.length} Gruppen`)
  for (const g of gruppen) {
    const namen = g.wege.map((z) => kopfleiste.find((k) => k.weg === z)?.name ?? z)
    console.log(`  ${g.titel}: ${namen.join(' · ')}`)
  }
  for (const k of kopfleiste.filter((x) => OHNE_GRUPPE.includes(x.weg))) {
    console.log(`  (ohne Gruppe, so gewollt): ${k.name}`)
  }
  for (const u of unterseiten.filter((x) => x.eltern.length === 1)) {
    console.log(`UNTERSEITE: ${u.eltern[0]} › ${u.name}  (${u.weg})`)
  }
  let befunde = 0
  for (const t of tote) {
    console.log(`TOTER WEG: ${t.von} verweist auf ${t.nach} — diesen Pfad kennt app.routes.ts nicht`)
    befunde++
  }
  for (const o of ohneRueckweg) {
    console.log(
      `OHNE RUECKWEG: ${o.name} (${o.weg}) haengt unter „${o.eltern}", verweist aber nicht auf ${o.elternWeg} — ` +
        'dort leuchtet kein Leisteneintrag, und der Weg zurueck steht nirgends',
    )
    befunde++
  }
  for (const v of verwaist) {
    console.log(`VERWAIST: ${v.weg} (${v.datei}) — kein Weg dorthin, weder Leiste noch Seite`)
    befunde++
  }
  for (const n of nichtGelesen) {
    console.log(
      `NICHT GELESEN: ${n.weg} steht anklickbar in der Kopfleiste, aber kopfleiseLesen() sieht ihn nicht — ` +
        'meist steht ein anderes Attribut vor routerLink; der Eintrag fehlt dann auch im Suchbestand',
    )
    befunde++
  }
  for (const u of ungruppiert) {
    console.log(
      `OHNE GRUPPE: „${u.name}" (${u.weg}) steht in keiner Gruppe der Kopfleiste — ` +
        'entweder gehoert er in eine, oder er gehoert wie die Uebersicht in OHNE_GRUPPE',
    )
    befunde++
  }
  for (const e of elternUneinig) {
    console.log(
      `ELTERN UNEINIG: ${e.weg} — gemessen ${e.gemessen ?? 'gar keine Unterseite'}, ` +
        `in UNTERSEITE_VON (rahmen.ts) ${e.behauptet ?? 'nicht eingetragen'}. ` +
        'Solange das nicht stimmt, leuchtet auf dieser Unterseite der falsche oder gar kein Leisteneintrag',
    )
    befunde++
  }
  for (const z of zweiSchreiber) {
    console.log(
      `ZWEI SCHREIBER: <${z.tag}${z.weg ? ` routerLink="${z.weg}"` : ''}> traegt routerLinkActive="${z.klasse}" ` +
        `UND [class.${z.klasse}] — beide schreiben dieselbe Klasse, die Bindung loescht, was die Direktive setzt. ` +
        'Dieses Element bleibt dunkel; entweder die Direktive weg oder die Bindung',
    )
    befunde++
  }
  if (process.argv.includes('--pruefen')) {
    if (befunde === 0) console.log('Alle Wege fuehren irgendwohin, und jede Unterseite hat einen Rueckweg.')
    process.exit(befunde === 0 ? 0 : 1)
  }
}
