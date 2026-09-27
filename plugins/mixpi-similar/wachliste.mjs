/**
 * Die Wachliste — „zu dem, was die Box schon hat, gibt es etwas Neues".
 *
 * Diese Datei ist REIN: sie entscheidet, was neu ist, und fasst nichts an.
 * Netz, Zeitplan und Kanaele liegen im Wirt (`index.mjs`). Der Grund ist
 * derselbe wie bei `fusion.mjs`: die Entscheidung „ist das eine Neuigkeit?"
 * ist die einzige Stelle, an der ein Fehler jemanden nachts weckt oder eine
 * echte Folge verschluckt — sie gehoert dorthin, wo ein Zeuge sie ohne
 * Dienst, ohne Uhr und ohne Datei fahren kann.
 *
 * ══ DIE GRUNDLINIE IST DER GANZE TRICK ════════════════════════════════════
 *
 * Beim Eintragen wird der aktuelle Stand als BEKANNT vermerkt. Nur was
 * DANACH erscheint, ist eine Neuigkeit. Ohne diesen Schritt meldet der erste
 * Durchlauf einer Wachliste mit zwanzig Serien mehrere hundert
 * „Neuerscheinungen" — den gesamten Altbestand — und der Nutzer schaltet die
 * Benachrichtigung ab, bevor sie je etwas Nuetzliches gesagt hat.
 */

import { normalName } from './normalisieren.mjs'

/**
 * Der Schluessel, unter dem eine Veroeffentlichung wiedererkannt wird.
 *
 * DREI STUFEN, IN DIESER REIHENFOLGE — und die Reihenfolge ist der Punkt:
 *
 *   1. Die Release-Group-MBID. Sie ist der einzige Schluessel, der DIENSTE
 *      UEBERGREIFEND dasselbe Werk bezeichnet.
 *   2. Der UPC, wo einer vorliegt.
 *   3. Normalisierter Titel + Jahr.
 *
 * WARUM TITEL + JAHR UND NICHT NUR DER TITEL: eine Serie bringt „Folge 12"
 * als Hoerspiel und ein Jahr spaeter als Neuauflage heraus, und beides ist
 * eine eigene Meldung wert. Warum nicht Titel + volles Datum: dieselbe
 * Veroeffentlichung traegt bei MusicBrainz oft nur „2024" und bei Deezer
 * „2024-03-14" — auf das Datum verglichen waeren sie zwei, und der Nutzer
 * bekaeme dieselbe Folge zweimal gemeldet. Das JAHR ist der groesste
 * gemeinsame Nenner, den beide Quellen verlaesslich fuehren.
 */
export function veroeffentlichungsSchluessel(v) {
  if (v?.gruppeMbid) return `rg:${v.gruppeMbid}`
  if (v?.upc) return `upc:${v.upc}`
  const jahr = jahrVon(v?.erschienen)
  return `t:${normalName(v?.titel)}#${jahr ?? '?'}`
}

/**
 * Das Jahr aus einer Datumsangabe, die taggenau sein KANN, aber nicht muss.
 *
 * MusicBrainz fuehrt bei Hoerspielen ueberwiegend nur das Jahr (Bibi
 * Blocksberg: 8 taggenau gegen 15 nur Jahr, gemessen 06.09.2026), Deezer
 * immer taggenau. Beides muss durch dieselbe Funktion gehen.
 */
export function jahrVon(erschienen) {
  const treffer = /^(\d{4})/.exec(String(erschienen ?? ''))
  return treffer ? Number(treffer[1]) : null
}

/**
 * Ist diese Veroeffentlichung NACH der Grundlinie erschienen?
 *
 * NUR DAS JAHR ENTSCHEIDET, wenn mehr nicht dasteht — und im Zweifel gilt
 * „nicht neu". Ein grober Datumswert, der als „heute erschienen" durchgeht,
 * meldet den halben Altbestand; einer, der zu Unrecht durchfaellt, verzoegert
 * eine Meldung um eine Runde. Die beiden Fehler sind nicht gleich teuer.
 */
export function istNachGrundlinie(v, grundlinieIso) {
  const erschienen = String(v?.erschienen ?? '')
  if (!erschienen) return false
  const grundlinie = new Date(grundlinieIso)
  if (Number.isNaN(grundlinie.getTime())) return false

  // Taggenau: direkt vergleichen.
  if (/^\d{4}-\d{2}-\d{2}/.test(erschienen)) {
    const d = new Date(erschienen)
    return !Number.isNaN(d.getTime()) && d > grundlinie
  }

  // Nur ein Jahr: es zaehlt als neu, wenn es ECHT NACH dem Jahr der
  // Grundlinie liegt. Im selben Jahr waere es geraten — und geraten heisst
  // hier „meldet den Altbestand".
  const jahr = jahrVon(erschienen)
  return jahr !== null && jahr > grundlinie.getFullYear()
}

/**
 * Mehrere Quellen zusammenlegen und die echten Neuigkeiten herausziehen.
 *
 * Zurueck kommt `{ neu, bekannt }` — `bekannt` ist der neue Stand der
 * bekannten Schluessel und wird vom Aufrufer weggeschrieben.
 *
 * EIN WERK, DAS ZWEI QUELLEN LIEFERN, WIRD EINMAL GEMELDET. Das ist
 * Abnahmekriterium 7 des Entwurfs und der Grund fuer den Schluessel oben.
 * Zusammengelegt wird dabei auf die Fassung mit der GENAUEREN Datumsangabe:
 * beide beschreiben dasselbe Werk, und die taggenaue Angabe ist die
 * brauchbarere fuer den, der die Meldung liest.
 */
export function neuigkeitenFinden(veroeffentlichungen, bekannteSchluessel, grundlinieIso) {
  const bekannt = new Set(bekannteSchluessel ?? [])
  const gesehen = new Map()

  for (const v of veroeffentlichungen ?? []) {
    if (!v?.titel) continue
    const schluessel = veroeffentlichungsSchluessel(v)
    const vorher = gesehen.get(schluessel)
    if (!vorher) {
      gesehen.set(schluessel, v)
      continue
    }
    // Die genauere Datumsangabe gewinnt — siehe oben.
    const vorherGenau = /^\d{4}-\d{2}-\d{2}/.test(String(vorher.erschienen ?? ''))
    const jetztGenau = /^\d{4}-\d{2}-\d{2}/.test(String(v.erschienen ?? ''))
    if (jetztGenau && !vorherGenau) gesehen.set(schluessel, v)
  }

  const neu = []
  for (const [schluessel, v] of gesehen) {
    if (bekannt.has(schluessel)) continue
    // BEKANNT WIRD ES IN BEIDEN FAELLEN. Auch eine Veroeffentlichung, die vor
    // der Grundlinie liegt, kommt in die Liste der bekannten Schluessel —
    // sonst wuerde sie bei jedem Durchlauf erneut geprueft, und ein
    // Datumsformat, das sich beim Dienst einmal aendert, liesse den ganzen
    // Altbestand auf einen Schlag als „neu" durchgehen.
    bekannt.add(schluessel)
    if (istNachGrundlinie(v, grundlinieIso)) neu.push({ ...v, schluessel })
  }

  neu.sort((a, b) => String(b.erschienen).localeCompare(String(a.erschienen)))
  return { neu, bekannt: [...bekannt] }
}

/**
 * Die Grundlinie beim Eintragen: alles, was es JETZT gibt, gilt als bekannt.
 */
export function grundlinieBauen(veroeffentlichungen) {
  return (veroeffentlichungen ?? []).filter((v) => v?.titel).map((v) => veroeffentlichungsSchluessel(v))
}

/**
 * Liegt `jetzt` im erlaubten Zeitfenster?
 *
 * UEBER MITTERNACHT MUSS GEHEN, und das ist der einzige Grund, warum diese
 * Funktion nicht zwei Zeilen lang ist: das uebliche Fenster ist „nachts",
 * also etwa 02:00 bis 05:00 — aber „22:00 bis 06:00" ist genauso plausibel,
 * und dort ist `von` groesser als `bis`. Ein naiver Vergleich
 * (`von <= jetzt && jetzt <= bis`) liefert dann IMMER falsch, und die
 * Wachliste liefe nie. Der Fehler waere still: kein Fehler im Journal, nur
 * ein Zeitplan, der nichts tut.
 */
export function imFenster(jetzt, von, bis) {
  const minuten = (t) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(t ?? '').trim())
    if (!m) return null
    const h = Number(m[1])
    const min = Number(m[2])
    if (h > 23 || min > 59) return null
    return h * 60 + min
  }
  const a = minuten(von)
  const b = minuten(bis)
  // OHNE GUELTIGES FENSTER IST IMMER ERLAUBT. Ein krummer Wert im
  // Einstellungsfeld darf die Wachliste nicht stilllegen — er soll sie
  // hoechstens ungebremst laufen lassen, und das ist der harmlosere Fehler.
  if (a === null || b === null) return true
  if (a === b) return true

  const jetztMin = jetzt.getHours() * 60 + jetzt.getMinutes()
  return a < b ? jetztMin >= a && jetztMin < b : jetztMin >= a || jetztMin < b
}

/**
 * Welcher Eintrag ist als naechster dran?
 *
 * DER AM LAENGSTEN NICHT GEPRUEFTE, und noch nie geprueft schlaegt alles.
 * Das ist die Voraussetzung dafuer, dass ein Durchlauf ABBRECHEN darf: ein
 * Lauf, der immer vorn anfaengt, prueft bei knapper Zeit ewig dieselben
 * ersten Eintraege und erreicht die hinteren nie.
 */
export function naechsterDran(eintraege) {
  const offen = (eintraege ?? []).filter((e) => e?.name)
  if (offen.length === 0) return null
  return offen.sort((a, b) => Number(a.zuletztGeprueft ?? 0) - Number(b.zuletztGeprueft ?? 0))[0]
}

/**
 * Interpreten aus dem Bestand der Box in Wachlisten-Namen umwandeln.
 *
 * DAS `artist`-FELD IST NICHT EIN INTERPRET — dieselbe Falle wie bei der
 * Themenkarte, hier mit denselben Zahlen: im Bestand von .62 (66 Eintraege)
 * tragen 9 Eintraege „Ruby van der Bogen, 101 fabelhafte Freunde" und weitere
 * je zwei „Team Karacho, ANOTHER NGUYEN". Wer das Feld als einen Namen in die
 * Wachliste legt, beobachtet einen Interpreten, den kein Dienst kennt, und
 * bekommt nie eine Meldung.
 */
export function namenAusBestand(eintraege) {
  const namen = new Map()
  for (const e of eintraege ?? []) {
    const roh = String(e?.artist ?? '').trim()
    if (!roh) continue
    for (const teil of roh.split(/\s*[,;/&]\s*|\s+feat\.?\s+/iu)) {
      const name = teil.trim()
      if (name.length < 4) continue
      const schluessel = normalName(name)
      if (!schluessel) continue
      // Die ERSTE Schreibweise gewinnt und wird gezaehlt — so steht in der
      // Wachliste ein Name, den ein Mensch wiedererkennt, statt der
      // normalisierten Form.
      const vorher = namen.get(schluessel)
      if (vorher) vorher.anzahl++
      else namen.set(schluessel, { name, anzahl: 1 })
    }
  }
  return [...namen.values()].sort((a, b) => b.anzahl - a.anzahl || a.name.localeCompare(b.name, 'de'))
}
