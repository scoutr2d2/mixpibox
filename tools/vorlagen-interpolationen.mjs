/**
 * WIE VIELE BESCHRIFTUNGEN DER VERWALTUNG ENTSTEHEN ERST ZUR LAUFZEIT —
 * und fallen deshalb aus dem Suchbestand heraus?
 *
 * WOZU: tools/verwaltung-suchbestand.mjs erhebt den SICHTBAREN Text aus den
 * Vorlagen. Was in {{ ... }} steht, kennt es nicht — dort steht ein Wert, den
 * erst die Box liefert. Das ist keine Nachlaessigkeit, sondern die einzige
 * ehrliche Wahl (siehe Kopfkommentar dort). Es hat aber eine Folge, die man
 * NICHT einzeln nachruestet, ohne zu wissen, wie oft sie vorkommt:
 *
 *     Steht in einem Knopf NUR eine Interpolation, kennt die Suche diesen
 *     Knopf gar nicht. Er ist da, er ist beschriftet, und er ist unauffindbar.
 *
 * Genau das war der Befund vom 03.08.2026 bei den Systemaktionen („Box neu
 * starten" & Co. stehen in AKTIONEN, src/backend-api/src/system.ts, und kommen
 * ueber GET /api/system). Die Frage, die dieses Werkzeug beantwortet, ist die
 * dahinter: WIE VIELE solcher Stellen gibt es noch?
 *
 * DREI SORTEN werden unterschieden — die Unterscheidung ist der ganze Wert:
 *
 *   VERLOREN   Der Treffer traegt KEINEN festen Text. Nach dem Wegwerfen der
 *              Interpolation bleibt nichts uebrig, was als Eintrag taugt.
 *              DAS ist die Luecke in der Suche.
 *   GEKUERZT   Fester Text UND Interpolation. Der feste Teil steht im Bestand;
 *              verloren geht nur der Wert („Lautstärke {{ w() }} %"). Das ist
 *              in Ordnung — man sucht „Lautstärke", nicht „73".
 *   AUSSERHALB Eine Interpolation, die in keiner Beschriftungsquelle steht
 *              (Fliesstext, Meldungen, Zahlen). Sie war nie ein Sucheintrag.
 *
 * DIE VERLORENEN WERDEN NOCH EINMAL GETEILT, und erst diese zweite Teilung
 * macht aus der Zahl eine Arbeitsliste — sie unterscheidet, WO die Behebung
 * ueberhaupt liegen kann:
 *
 *   im-text   Im Ausdruck steht eine Zeichenkette: {{ laeuft() ? 'Läuft…' :
 *             'Suchen' }}. Der feste Name IST in der Vorlage, nur eingewickelt.
 *             Behebbar, ohne irgendwen zu fragen — meistens traegt aber
 *             ohnehin eine Ueberschrift oder Beschriftung daneben den Namen,
 *             und dann waere der Eintrag bloss ein zweiter fuer dieselbe Sache.
 *   von-aussen Im Ausdruck steht nur ein Wert: {{ a.titel }}, {{ g.name }}.
 *             Der Text kommt aus dem Backend oder von der Box; die Vorlage
 *             kennt ihn nicht und kann ihn nicht kennen. NUR HIER hilft ein
 *             zweiter Weg — so wie ihn die Suche fuer /api/konfiguration und
 *             seit dem 03.08.2026 fuer /api/system geht.
 *
 * UND DIE GRENZE DIESES WERKZEUGS, damit die Zahl niemanden in die Irre
 * fuehrt: „von-aussen" trennt NICHT zwischen einer festen Tabelle im Backend
 * (AKTIONEN, FELDER — die gehoeren in die Suche) und den Daten der Box selbst
 * ({{ album.titel }}, {{ geraet.name }} — die gehoeren NICHT hinein, sie
 * wechseln stuendlich). Das ist eine Frage an den Menschen, keine ans Muster.
 *
 * WAS ES AENDERT: nichts. Es liest.
 *
 * AUFRUF
 *     node tools/vorlagen-interpolationen.mjs             # Zusammenfassung
 *     node tools/vorlagen-interpolationen.mjs --verloren  # jede Luecke einzeln
 *     node tools/vorlagen-interpolationen.mjs --alle      # auch die gekuerzten
 *
 * WER DIE VORLAGEN AUFTEILT, ENTSCHEIDET NICHT DIESES WERKZEUG: Quellen,
 * Sichtbarmachung und die Frage „taugt das als Eintrag?" kommen aus
 * verwaltung-suchbestand.mjs. Eine zweite Meinung darueber waere genau der
 * Fehler, gegen den es beide Werkzeuge gibt — die Zahl hier waere dann eine
 * Zahl ueber ein anderes Programm.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ohneKommentare, QUELLEN, SEITEN, sichtbar, taugt, vorlageVon, wegeLesen } from './verwaltung-suchbestand.mjs'

const INTERPOLATION = /\{\{[\s\S]*?\}\}/g

/**
 * Steht im Ausdruck selbst eine Zeichenkette?
 *
 * Dann ist der feste Name in der Vorlage vorhanden — nur eingewickelt. Steht
 * dort keine, kommt der Text von aussen und die Vorlage kann ihn gar nicht
 * kennen. Genau an dieser Linie entscheidet sich, ob eine Luecke ueberhaupt
 * ohne zweite Quelle zu schliessen waere.
 */
const ZEICHENKETTE_IM_AUSDRUCK = /'[^']*'|"[^"]*"/

export function textStecktImAusdruck(inneres) {
  return (inneres.match(INTERPOLATION) ?? []).some((i) => ZEICHENKETTE_IM_AUSDRUCK.test(i))
}

/**
 * Eine Vorlage durchsehen.
 *
 * Rueckgabe: { verloren[], gekuerzt[], gesamt } — `gesamt` ist die Zahl ALLER
 * Interpolationen der Vorlage, auch der ausserhalb jeder Beschriftung. Sie
 * steht daneben, damit die anderen beiden Zahlen ein Verhaeltnis haben: 4 von
 * 6 ist etwas anderes als 4 von 90.
 */
export function vorlageDurchsehen(rohe) {
  const html = ohneKommentare(rohe)
  const verloren = []
  const gekuerzt = []
  for (const q of QUELLEN) {
    // `placeholder="…"` ist ein Attributwert; dort steht eine Interpolation
    // nie als {{ }}, sondern als eigene Bindung. Fuer diese Zaehlung waere sie
    // ein falscher Treffer.
    if (q.art === 'feld') continue
    for (const t of html.matchAll(new RegExp(q.muster.source, 'g'))) {
      const inneres = t[1]
      const wieviele = (inneres.match(INTERPOLATION) ?? []).length
      if (wieviele === 0) continue
      const text = sichtbar(inneres)
      const fund = {
        art: q.art,
        stelle: t.index,
        interpolationen: wieviele,
        woher: textStecktImAusdruck(inneres) ? 'im-text' : 'von-aussen',
        // Der Rohtext, auf eine Zeile gebracht — man will sehen, WAS dort
        // steht, sonst ist der Befund eine Zahl ohne Griff.
        roh: inneres.replace(/\s+/g, ' ').trim().slice(0, 90),
        text,
      }
      if (taugt(text)) gekuerzt.push(fund)
      else verloren.push(fund)
    }
  }
  return { verloren, gekuerzt, gesamt: (html.match(INTERPOLATION) ?? []).length }
}

/** Alle Seiten der Verwaltung, in der Reihenfolge der Routen. */
export function alleSeitenDurchsehen() {
  const raus = []
  for (const w of wegeLesen()) {
    const quelle = readFileSync(join(SEITEN, `${w.datei}.ts`), 'utf8')
    const befund = vorlageDurchsehen(vorlageVon(quelle))
    raus.push({ datei: w.datei, name: w.name || w.datei, weg: w.weg, ...befund })
  }
  return raus
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const seiten = alleSeitenDurchsehen()
  const zeigeVerloren = process.argv.includes('--verloren') || process.argv.includes('--alle')
  const zeigeGekuerzt = process.argv.includes('--alle')

  let imTextSumme = 0
  let vonAussenSumme = 0
  let gSumme = 0
  let iSumme = 0
  console.log(' aussen  text   gek  alle   Seite')
  for (const s of seiten) {
    const imText = s.verloren.filter((f) => f.woher === 'im-text')
    const vonAussen = s.verloren.filter((f) => f.woher === 'von-aussen')
    imTextSumme += imText.length
    vonAussenSumme += vonAussen.length
    gSumme += s.gekuerzt.length
    iSumme += s.gesamt
    console.log(
      `${String(vonAussen.length).padStart(7)}${String(imText.length).padStart(6)}${String(s.gekuerzt.length).padStart(6)}${String(s.gesamt).padStart(6)}   ${s.name}`,
    )
    if (zeigeVerloren) {
      for (const f of vonAussen) console.log(`           VON AUSSEN ${f.art}: ${f.roh}`)
      for (const f of imText) console.log(`           im Text    ${f.art}: ${f.roh}`)
    }
    if (zeigeGekuerzt) for (const f of s.gekuerzt) console.log(`           gekuerzt   ${f.art}: ${f.text}  ←  ${f.roh}`)
  }
  console.log('────────────────────────────────')
  console.log(
    `${String(vonAussenSumme).padStart(7)}${String(imTextSumme).padStart(6)}${String(gSumme).padStart(6)}${String(iSumme).padStart(6)}   zusammen`,
  )
  console.log()
  console.log(`VON AUSSEN = ${vonAussenSumme} Beschriftungen, deren Text die Vorlage nicht kennt.`)
  console.log('             Nur hier hilft ein zweiter Weg (so wie /api/konfiguration und')
  console.log('             /api/system). Wieviele davon eine feste Tabelle im Backend sind')
  console.log('             und wieviele blosse Daten der Box, entscheidet kein Muster.')
  console.log(`im Text    = ${imTextSumme} Beschriftungen, deren fester Name IM Ausdruck steht`)
  console.log("             ({{ laeuft() ? 'Läuft…' : 'Suchen' }}) — behebbar ohne zweite Quelle.")
  console.log(`gekuerzt   = ${gSumme} mit festem Text daneben; nur der Wert faellt weg (in Ordnung).`)
  console.log(`alle       = ${iSumme} Interpolationen ueberhaupt in den Vorlagen.`)
}
