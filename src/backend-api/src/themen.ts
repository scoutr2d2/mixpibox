/**
 * Die vier MITGELIEFERTEN Themen.
 *
 * WOFUER: sie sollen immer da sein. Bisher waren Themen reine Daten in
 * `darstellung.json` - wer die Datei loeschte oder sie beim Speichern
 * ueberschrieb, war sie los. Diese vier stehen deshalb im CODE und werden bei
 * jedem Lesen ergaenzt und bei jedem Schreiben wieder eingesetzt.
 *
 * AENDERBAR, ABER NICHT LOESCHBAR: wer eines anpasst und speichert, behaelt
 * seine Fassung (sie steht dann in der Datei und gewinnt). Erst wenn es ganz
 * fehlt, kommt die mitgelieferte zurueck. So kann man alles umstellen, aber
 * nichts unwiederbringlich verlieren.
 *
 * REIN: nur Daten und zwei Funktionen darauf, kein Dateizugriff.
 */

import { vonBloecken } from './mixpi-thema'

/** Die Namen - auch die Oberflaeche braucht sie, um kein Loeschen anzubieten. */
export const MITGELIEFERT = ['MuPiBox Classic', 'New MuPiBox', 'Tiger Mupi', 'MuPi-Brücke'] as const

/**
 * Die Mitgelieferten stehen SEIT E119 IN BLOECKEN (mixpi-thema/1) — das ist
 * die lesbare Wahrheit; die flache Fassung darunter wird daraus UEBERSETZT.
 *
 * Bewusst KEINE vollstaendige Darstellung: die Oberflaeche kennt ihre eigenen
 * Vorgaben und ergaenzt alles Uebrige. Wer hier jedes Feld auffuehrte, muesste
 * diese Liste bei jeder neuen Einstellung nachziehen - und vergaesse es.
 *
 * WAS BEI DER UMSTELLUNG FIEL (E119, 05.09.2026): rund zwei Dutzend Felder,
 * die NUR die geloeschte Angular-Oberflaeche las (aussehen, beimVerlassen,
 * flipKarte, kopfIcons, kopfOrdnung, plaetze, favKnopf, resumeKnopf,
 * kategorien, startAufbau, zeigeXxx, kopfLeiste ...). Vom Classic-Thema
 * wirkten im NewDesign nur DREI von 17 Feldern — die Neufassung traegt nur
 * noch Wirkendes; die Uebernahmen aus dem Alten (E121) und die
 * Classic-Neufassung mit Farben (E120) kommen als eigene Schritte.
 */
export const THEMEN_BLOECKE: Record<string, Record<string, unknown>> = {
  // Der Ursprungs-LOOK, abgelesen am letzten Stand vor den eigenen Commits
  // (3b1a49c7): runde Cover mit hellem Ring, grosse Kacheln, Namen darunter,
  // kein Mini-Player. (Das alte VERHALTEN — Stopp beim Verlassen — kommt
  // bewusst nicht mit; Betreiber-Entscheidung vom 05.09.2026: Look +
  // Kern-Verhalten, die Neufassung mit Farben ist E120.)
  'MuPiBox Classic': {
    // Seit E120 mit den Ur-FARBEN: der Festwert-Satz 'classic' (elfter in
    // app.css, Flaeche #121212 / Leiste #1F1F1F / fast-weisse Schrift) und
    // dunkel als Licht — zusammen mit dem Ring IST das der alte Look.
    farben: { satz: 'classic' },
    licht: 'dunkel',
    kacheln: {
      form: 'rund',
      randAn: true,
      randFarbe: '#FFFFFF',
      randBreite: 6,
      groesse: 1.8,
      namen: true,
    },
    kissen: { stufe: 'aus', streifen: false },
  },

  // Der Stand der Erprobungszeit: Kachelreihe, Mini-Player voll, Streifen.
  'New MuPiBox': {
    kacheln: { form: 'abgerundet', randAn: false, groesse: 1, namen: true },
    kissen: { stufe: 'voll', groesse: 1, streifen: true },
  },

  // Reihen ohne Namen unter den Kacheln — die Cover sprechen selbst; die
  // Uhr sitzt im Kopf. (Der alte Listen-Aufbau samt frei geschobenen
  // Anzeigen war ein Angular-Feature und fiel mit E118.)
  'Tiger Mupi': {
    kacheln: { form: 'abgerundet', randAn: false, groesse: 1, namen: false },
    kissen: { stufe: 'voll', groesse: 1, streifen: true },
    kopf: { uhr: true },
  },

  // E44, die Bruecke zur alten Bedienung. Betreiber: "musik --> interpret
  // --> alben, beim anklicken der alben spielte es ohne titel wahl ... ich
  // will ein bisschen dort hin kommen um eine bruecke zu schlagen".
  // Der Tipp aufs Album spielt sofort, die Reihen wachsen Richtung der
  // alten ~170 px (118 * 1.45), der Name steht unterm Cover.
  'MuPi-Brücke': {
    reihen: { albumTipp: 'spielt', groesse: 1.45 },
    kacheln: { namen: true },
  },
}

/**
 * Die FLACHE Fassung — uebersetzt aus den Bloecken, beim Modul-Laden einmal.
 *
 * Der Server-Vertrag (GET/PUT /api/darstellung, ergaenzen(), auslieferung())
 * arbeitet unveraendert flach; die Bloecke sind die Aussenhaut fuer Menschen
 * und den Tausch (E120). Zwei Wahrheiten entstehen dabei nicht: diese
 * Konstante IST die Uebersetzung, und die Wache (mixpi-thema.spec.ts)
 * prueft den Roundtrip.
 */
export const THEMEN: Record<string, Record<string, unknown>> = Object.fromEntries(
  Object.entries(THEMEN_BLOECKE).map(([name, bloecke]) => [name, vonBloecken(bloecke)]),
)

/** Ist das eines der mitgelieferten Themen? */
export function istMitgeliefert(name: unknown): boolean {
  return MITGELIEFERT.includes(String(name) as (typeof MITGELIEFERT)[number])
}

/**
 * Die mitgelieferten Themen ergaenzen.
 *
 * Vorhandene bleiben UNANGETASTET - wer eines angepasst hat, behaelt seine
 * Fassung. Ergaenzt wird nur, was fehlt.
 */
export function ergaenzen(
  themen: Readonly<Record<string, unknown>> | null | undefined,
  gespeichert?: Readonly<Record<string, unknown>> | null,
): Record<string, unknown> {
  const raus: Record<string, unknown> = { ...(themen || {}) }
  for (const name of MITGELIEFERT) {
    if (raus[name]) continue
    // ERST die GESPEICHERTE Fassung, dann die mitgelieferte.
    //
    // Ohne diese Reihenfolge ging eine Anpassung verloren: eine Oberflaeche,
    // die die Themen beim Speichern nicht mitschickt, liess sie hier fehlen -
    // und die mitgelieferte Fassung ueberschrieb die eigene. Am Geraet genau
    // so passiert: eine von Hand skalierte Kachelgroesse (Faktor 1,8) stand
    // danach wieder auf 1.
    const alt = gespeichert?.[name]
    raus[name] = alt ? alt : { ...THEMEN[name] }
  }
  return raus
}

/**
 * Der AUSLIEFERUNGSSTAND eines mitgelieferten Themas.
 *
 * WOFUER: „Aendern, aber nicht verlieren" hiess bisher nur, dass ein
 * geloeschtes Thema zurueckkommt. Wer eines UEBERSCHRIEBEN hatte, kam nicht
 * mehr an das Original - es stand zwar im Code, aber kein Weg fuehrte hin.
 * Damit war „bearbeitbar" in der Praxis eine Einbahnstrasse.
 *
 * Gibt eine KOPIE zurueck, damit ein Aufrufer die Vorlage nicht verbiegt.
 */
export function auslieferung(name: unknown): Record<string, unknown> | null {
  const n = String(name)
  return istMitgeliefert(n) ? { ...THEMEN[n] } : null
}

/** Alle Auslieferungsstaende - fuer die Oberflaeche, die sie anbieten will. */
export function auslieferungAlle(): Record<string, Record<string, unknown>> {
  const raus: Record<string, Record<string, unknown>> = {}
  for (const n of MITGELIEFERT) raus[n] = { ...THEMEN[n] }
  return raus
}

/**
 * Welche Felder eines Themas weichen vom aktuellen Stand ab?
 *
 * Verglichen wird NUR, was das Thema selbst nennt - ein Thema ist bewusst
 * keine vollstaendige Darstellung (siehe THEMEN), alles Uebrige geht es
 * nichts an. Wer ueber alle Felder vergliche, faende immer Unterschiede.
 *
 * Der Vergleich laeuft ueber JSON, damit auch `kopfIcons` (ein Objekt) und
 * `kopfOrdnung` (eine Liste) richtig behandelt werden. Ein Feld, das der
 * Stand gar nicht kennt, zaehlt als Abweichung: es ist eben nicht gleich.
 */
export function abweichungen(
  thema: Readonly<Record<string, unknown>> | null | undefined,
  stand: Readonly<Record<string, unknown>> | null | undefined,
): string[] {
  if (!thema) return []
  const s = stand || {}
  const raus: string[] = []
  for (const k of Object.keys(thema)) {
    if (JSON.stringify(thema[k]) !== JSON.stringify(s[k])) raus.push(k)
  }
  return raus.sort()
}

/** Passt der aktuelle Stand vollstaendig zu diesem Thema? */
export function passt(
  thema: Readonly<Record<string, unknown>> | null | undefined,
  stand: Readonly<Record<string, unknown>> | null | undefined,
): boolean {
  return !!thema && abweichungen(thema, stand).length === 0
}

/**
 * Welches abgelegte Thema laeuft gerade?
 *
 * WOFUER: es gab KEINE Anzeige, welches Thema aktiv ist - man sah es nur an
 * den Einstellungen. Das war die haeufigste Verwirrungsquelle am Waehler.
 *
 * Bei mehreren Treffern gewinnt das Thema, das MEHR Felder festlegt: es sagt
 * mehr aus. Ein Thema mit zwei Feldern passt schnell zufaellig; eines mit
 * fuenfzehn beschreibt den Stand wirklich. Bei Gleichstand entscheidet der
 * Name, damit die Antwort nicht von der Reihenfolge im Objekt abhaengt.
 *
 * Kein Treffer heisst `null` - und das ist ein ehrliches Ergebnis, kein
 * Fehler: sobald jemand eine Einstellung von Hand aendert, laeuft eben kein
 * abgelegtes Thema mehr, sondern etwas Eigenes.
 */
export function aktivesThema(
  themen: Readonly<Record<string, unknown>> | null | undefined,
  stand: Readonly<Record<string, unknown>> | null | undefined,
): string | null {
  let besterName: string | null = null
  let besteZahl = -1
  for (const [name, thema] of Object.entries(themen || {})) {
    const t = thema as Record<string, unknown> | null
    if (!t || typeof t !== 'object') continue
    if (!passt(t, stand)) continue
    const zahl = Object.keys(t).length
    if (zahl > besteZahl || (zahl === besteZahl && besterName !== null && name < besterName)) {
      besteZahl = zahl
      besterName = name
    }
  }
  return besterName
}
