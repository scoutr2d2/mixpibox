/**
 * Abgleich — WELCHE Werke sind dasselbe? Und wo darf man es nicht behaupten?
 *
 * DIE ZWEITE HAELFTE VON verschmelzung.ts. Dort steht die AUFLOESUNG („welche
 * Quelle spielt"), sie verbraucht eine gegebene Zuordnung. Hier entsteht die
 * Zuordnung. Beides in einer Datei waere die teure, fehleranfaellige Erkennung
 * mit der billigen, immer gleichen Aufloesung vermengt — die Begruendung steht
 * ausfuehrlich im Kopf von verschmelzung.ts und wird hier nur eingeloest.
 *
 * REIN: kein Netz, kein Dateisystem, kein express, keine Uhr. Der Server
 * reicht die Werke herein und legt das Ergebnis ab.
 *
 * == KEINE ZWEITE ERKENNUNG ==
 * Verglichen wird mit `gruppiereTreffer()` aus medien.ts — derselben Regel,
 * die die Verwaltung schon benutzt, wenn sie Suchtreffer verschiedener Dienste
 * zusammenfasst, und die dort seit Wochen laeuft und geprueft ist
 * (medien.spec.ts). Sie IST Stufe 1 („locker") des Wissenspakets
 * [quellen-verschmelzen]: normalisierter Titel, lose passender Interpret,
 * niemals zwei Treffer DESSELBEN Dienstes. Eine zweite Fassung derselben Regel
 * zeigte irgendwann etwas anderes als die Suche — und man glaubte ihr.
 *
 * == WARUM NUR AUF KNOPFDRUCK, UND NICHT VON SELBST ==
 * Stufe 1 kann irren, und sie irrt genau dort, wo es weh tut: Deluxe, Remaster
 * und Live tragen denselben Interpreten und denselben Titel. Der Schutz davor
 * ist im Wissenspaket die TITELANZAHL — die kennt ein `Werk` heute aber nicht
 * (sie kostet je Eintrag einen Abruf beim Dienst). `titelAnzahl` steht deshalb
 * unten als Beigabe in den Optionen: wer sie hat, bekommt den Schutz sofort;
 * ab Stufe 2 (Fingerabdruck) fuellt sie sich von selbst.
 *
 * Solange sie fehlt, ist eine Zusammenlegung eine BEHAUPTUNG. Etwas, das ein
 * Kind sieht, still zusammenzulegen, weil ein Namensvergleich es fuer dasselbe
 * haelt, waere eine Aenderung an seiner Mediathek ohne Rueckfrage. Der Server
 * ruft diese Funktion deshalb nur, wenn jemand in der Verwaltung „abgleichen"
 * drueckt — und alles, was dabei entsteht, ist umkehrbar: die Eintraege in
 * data.json bleiben unangetastet, es entsteht bloss eine Liste daneben.
 *
 * == DIE MEHRDEUTIGEN SCHLUESSEL ZUERST ==
 * `verschmelzeWerke()` weist JEDE Zuordnung ab, die einen Schluessel nennt,
 * den es zweimal gibt (Fall 3 dort). Das ist richtig — aber es geschieht
 * STILL. Eine eingeschaltete Verschmelzung, die bei genau diesem Eintrag nichts
 * tut und sich nicht beschwert, ist die schlimmste Sorte Fehler: eingebaut,
 * gruen, wirkungslos. Deshalb meldet der Abgleich mehrdeutige Schluessel
 * ausdruecklich mit, und die Verwaltung zeigt sie an.
 *
 * AUF DER BOX GEMESSEN (2026-08-03, tools/quellen-ueberschneidung.mjs, nur
 * lesend): 26 Eintraege — 24 spotify, 2 jellyfin. Zwei Ueberschneidungen
 * („Kapelle Petra — HAMM", „Das Lumpenpack — Die Zukunft wird groß") und EIN
 * mehrdeutiger Schluessel (spotify:2QqQ…, dieselbe Playlist einmal als `music`
 * und einmal als `audiobook`). Am 2026-08-02 war die Ueberschneidung noch
 * null; deswegen war verschmelzung.ts absichtlich ein Nichtstuer.
 */
import { type AbgleichRegeln, gruppiereTreffer, REGELN_NORMAL, type TrefferArtig } from './medien'
import { istStufe, type Zuordnung } from './verschmelzung'
import type { Werk } from './werke'

/** Ein Schluessel, den es im Katalog mehr als einmal gibt. */
export interface Mehrdeutig {
  schluessel: string
  /** Wie oft. Zwei ist der gemessene Fall, mehr waere ebenso moeglich. */
  anzahl: number
  /** Zur Anzeige — der Mensch soll sehen, WORUEBER die beiden kollidieren. */
  titel: string
  interpret?: string
  /** Die Kategorien der beteiligten Eintraege, in Fundreihenfolge. */
  kategorien: string[]
}

/** Eine Gruppe, die Stufe 1 gefunden hat, die aber NICHT vorgeschlagen wird. */
export interface Uebergangen {
  /**
   * `mehrdeutig` — mindestens ein Schluessel der Gruppe steht doppelt im
   *   Katalog. Eine Zuordnung darauf wuerde `verschmelzeWerke()` ohnehin
   *   abweisen; sie anzubieten hiesse, einen Knopf anzubieten, der nichts tut.
   * `getrennt` — ein Mensch hat gesagt „das ist NICHT dasselbe". Diese
   *   Entscheidung ueberlebt jeden weiteren Abgleich (Stufe „hand").
   * `kategorie` — die Werke stehen in VERSCHIEDENEN Abschnitten der
   *   Startseite. Siehe `KATEGORIE_TRENNT`.
   * `interpretFehlt` — mindestens eines nennt keinen Interpreten, es bliebe
   *   der Titel allein. Siehe `INTERPRET_NOETIG`.
   */
  grund: 'mehrdeutig' | 'getrennt' | 'kategorie' | 'interpretFehlt'
  schluessel: string[]
  titel: string
  interpret?: string
}

/**
 * ZWEI ZUSAETZLICHE BEDINGUNGEN, DIE NUR BEIM VERSCHMELZEN GELTEN — und die
 * `gruppiereTreffer()` deshalb ausdruecklich NICHT kennt.
 *
 * `gruppiereTreffer` ist fuer die SUCHE gebaut, und dort sind beide Regeln
 * falsch: wer „HAMM" sucht, will beide Treffer nebeneinander sehen, egal in
 * welchem Abschnitt sie stehen und ob einer den Interpreten verschweigt. Sie
 * dort einzubauen hiesse, die Suche fuer die Verschmelzung zu verbiegen. Sie
 * stehen deshalb HIER, wo die Zusammenlegung entsteht.
 *
 * @returns der Grund, warum diese Gruppe nicht zusammengehoert — oder null.
 */
export function warumNicht(gruppe: readonly AbgleichTreffer[]): 'kategorie' | 'interpretFehlt' | null {
  // 1. VERSCHIEDENE ABSCHNITTE DER STARTSEITE.
  //
  // GEMESSEN AM 2026-08-03 mit tools/verschmelzung-grenzfaelle.mjs: zwei Werke
  // „Der kleine Drache Kokosnuss — Ingo Siegner", eines als `music`, eines als
  // `audiobook`, wurden EINE Kachel — und die trug die Kategorie des
  // FUEHRENDEN (`verschmelzeWerke` nimmt `basis`). Die neue Oberflaeche siebt
  // danach (app.js: `liste.filter(w => w.kategorie === werke.kategorie)`).
  // Fuer ein Kind heisst das: die Kachel ist aus dem Abschnitt „Hoerbuch"
  // VERSCHWUNDEN, ohne dass irgendwo etwas geloescht wurde. Es sucht sie dort,
  // wo sie immer war, und findet sie nicht.
  //
  // DIESELBE ZURUECKHALTUNG UEBT DER SERVER SCHON EINMAL: beim doppelten
  // Schluessel (/api/medien/doppelte/entfernen) fuehrt er die beiden Zeilen
  // ausdruecklich NICHT zusammen, weil `category` entscheidet, in welchem
  // Abschnitt die Kachel steht — eine ELTERNENTSCHEIDUNG. Die Maschine legt es
  // nicht zusammen, sie meldet es; der Mensch raeumt entweder die Kategorie
  // auf oder traegt die Zuordnung von Hand ein (Stufe „hand" —
  // verschmelzung.json ist genau dafuer von Hand korrigierbar).
  const erste = gruppe[0]
  if (gruppe.some((t) => t.kategorie !== erste.kategorie)) return 'kategorie'

  // 2. EIN INTERPRET FEHLT — dann bliebe der TITEL ALLEIN als Beweis.
  //
  // `interpretenPassen()` (medien.ts) gibt `true` zurueck, sobald eine Seite
  // nichts sagt: „einer sagt nichts, dann trennt es auch nicht". Beim
  // Verschmelzen verbietet das Wissenspaket [quellen-verschmelzen] genau das —
  // „NIE allein auf Name+Interpret verschmelzen", auf den Namen allein erst
  // recht nicht.
  //
  // GEMESSEN AM 2026-08-03: ein Spotify-Album „Weihnachtslieder — Rolf
  // Zuckowski" und eine schlecht getaggte Jellyfin-Datei „Weihnachtslieder"
  // ohne Interpret wurden EINE Kachel. Und das ist kein ausgedachter Fall:
  // gerade den schlampig getaggten Dateien fehlt der Interpret, und gerade bei
  // ihnen sind Titel wie „Weihnachtslieder", „Kinderlieder", „Folge 1" oder
  // „Best Of" die Regel.
  //
  // Der Preis ist klein und sichtbar: zwei Kacheln statt einer, gemeldet als
  // `uebergangen`. Wer den Interpreten nachtraegt, bekommt die Zusammenlegung
  // beim naechsten „abgleichen".
  if (gruppe.some((t) => !String(t.artist ?? '').trim())) return 'interpretFehlt'

  return null
}

export interface AbgleichErgebnis {
  /** Fertige Zuordnungen der Stufe „locker" — noch nichts abgelegt. */
  vorschlaege: Zuordnung[]
  mehrdeutig: Mehrdeutig[]
  uebergangen: Uebergangen[]
}

export interface AbgleichOptionen {
  /**
   * Wie streng verglichen wird (E86). Fehlt sie, gilt `REGELN_NORMAL`.
   *
   * SIE GEHOERT HIERHER UND NICHT IN DIE ABLAGE. Die Stufe ist eine
   * EINSTELLUNG des Betreibers, kein Bestandteil dessen, was einmal
   * entschieden wurde: `verschmelzung.json` haelt fest, WAS zusammengehoert
   * („zuordnungen") und was ausdruecklich nicht („getrennt"). Beides bleibt
   * gueltig, wenn jemand morgen strenger vergleichen will — nur die
   * VORSCHLAEGE des naechsten Laufs fallen dann anders aus. Die Stufe in die
   * Ablage zu schreiben hiesse, eine Einstellung als Befund auszugeben.
   */
  regeln?: AbgleichRegeln
  /**
   * Paare, die ausdruecklich NICHT dasselbe sind — je zwei Schluessel.
   *
   * DAS GEGENSTUECK ZUM KNOPF „trennen". Ohne diese Liste waere das Trennen
   * folgenlos: der naechste Abgleich fuende dasselbe Paar wieder und legte es
   * erneut zusammen. Das Wissenspaket sieht dafuer ausdruecklich die Stufe
   * „hand" vor („das ist NICHT dasselbe" muss speicherbar sein).
   */
  getrennt?: string[][]
  /**
   * Titelanzahl je Schluessel, wo bekannt.
   *
   * DER SCHUTZ GEGEN DELUXE UND REMASTER. `gruppiereTreffer` trennt zwei
   * Werke, sobald BEIDE eine Titelanzahl tragen und sie verschieden ist. Heute
   * fuellt niemand diese Karte — ein `Werk` fuehrt nur Quellen, keine Titel.
   * Sie steht trotzdem hier, weil Stufe 2 (Fingerabdruck, Titelmengen) genau
   * hier andockt und dafuer keine Zeile dieser Datei geaendert werden muss.
   */
  titelAnzahl?: Record<string, number>
}

/**
 * Ein Paar zweier Schluessel, unabhaengig von der Reihenfolge.
 *
 * NUL als Trenner und nicht etwa `|`: ein Schluessel kann fast alles
 * enthalten — der eines Radiosenders IST eine Adresse
 * (`radio:http://…/stream.mp3`). Mit einem druckbaren Trenner liessen sich
 * zwei verschiedene Paare auf dieselbe Zeichenkette abbilden.
 */
export function paarSchluessel(a: string, b: string): string {
  const x = String(a ?? '')
  const y = String(b ?? '')
  return x < y ? `${x}\u0000${y}` : `${y}\u0000${x}`
}

/** Was der Server ablegt: die Behauptungen UND die Widersprueche dazu. */
export interface Ablage {
  zuordnungen: Zuordnung[]
  /** Je zwei Schluessel, die nicht zusammengelegt werden duerfen. */
  getrennt: string[][]
}

export const ABLAGE_LEER: Ablage = { zuordnungen: [], getrennt: [] }

/**
 * Eine gelesene verschmelzung.json in Form bringen.
 *
 * WIRFT NIE, UND WIRFT WEG STATT ZU RATEN. Die Datei soll von Hand
 * korrigierbar sein (das verlangt das Wissenspaket fuer Stufe „hand"), also
 * wird sie irgendwann von Hand krumm sein. Eine einzelne kaputte Zeile darf
 * nicht die ganze Verschmelzung kosten — und eine halb verstandene Zeile darf
 * erst recht nicht zu einer geratenen Zusammenlegung fuehren.
 *
 * Eine Zuordnung ohne gueltige `stufe` faellt HERAUS und wird nicht auf „hand"
 * gebogen — dieselbe Zurueckhaltung wie in `verschmelzeWerke()`: die Stufe ist
 * das, woran der Mensch ablesen soll, wem er die Zusammenfassung verdankt.
 */
export function ablageAus(roh: unknown): Ablage {
  const o = (roh ?? {}) as { zuordnungen?: unknown; getrennt?: unknown }
  const zuordnungen: Zuordnung[] = []
  for (const z of Array.isArray(o.zuordnungen) ? o.zuordnungen : []) {
    const e = (z ?? {}) as { schluessel?: unknown; auch?: unknown; stufe?: unknown }
    const fuehrend = String(e.schluessel ?? '').trim()
    if (!fuehrend || !istStufe(e.stufe)) continue
    const auch = (Array.isArray(e.auch) ? e.auch : [])
      .map((s) => String(s ?? '').trim())
      .filter((s, i, a) => s && s !== fuehrend && a.indexOf(s) === i)
    if (!auch.length) continue
    zuordnungen.push({ schluessel: fuehrend, auch, stufe: e.stufe })
  }
  const gesehen = new Set<string>()
  const getrennt: string[][] = []
  for (const p of Array.isArray(o.getrennt) ? o.getrennt : []) {
    if (!Array.isArray(p) || p.length !== 2) continue
    const a = String(p[0] ?? '').trim()
    const b = String(p[1] ?? '').trim()
    if (!a || !b || a === b) continue
    const s = paarSchluessel(a, b)
    if (gesehen.has(s)) continue
    gesehen.add(s)
    // Sortiert ablegen: dieselbe Trennung soll in der Datei immer gleich
    // aussehen, sonst sieht ein `git diff` Aenderungen, wo keine sind.
    getrennt.push(a < b ? [a, b] : [b, a])
  }
  return { zuordnungen, getrennt }
}

/**
 * Was der Abgleich gefunden hat in die Ablage uebernehmen.
 *
 * WAS VON HAND KAM, BLEIBT. Nur die maschinell gefundenen Zuordnungen werden
 * ersetzt — sonst raeumte ein Abgleich die Handentscheidungen weg, und der
 * Mensch muesste sie nach jedem Knopfdruck erneut treffen. Umgekehrt darf ein
 * Vorschlag keinen Schluessel anfassen, der schon in einer Handentscheidung
 * steckt: dort hat jemand ausdruecklich etwas anderes gewollt.
 */
export function uebernehmen(ablage: Ablage, vorschlaege: Zuordnung[]): Ablage {
  const hand = (ablage?.zuordnungen ?? []).filter((z) => z.stufe === 'hand')
  const belegt = new Set<string>()
  for (const z of hand) {
    belegt.add(z.schluessel)
    for (const s of z.auch) belegt.add(s)
  }
  const neu: Zuordnung[] = [...hand]
  for (const v of Array.isArray(vorschlaege) ? vorschlaege : []) {
    if (belegt.has(v.schluessel) || v.auch.some((s) => belegt.has(s))) continue
    belegt.add(v.schluessel)
    for (const s of v.auch) belegt.add(s)
    neu.push(v)
  }
  return { zuordnungen: neu, getrennt: ablage?.getrennt ?? [] }
}

/**
 * Eine falsch erkannte Zusammenlegung aufloesen — EINZELN, ohne die ganze
 * Funktion abzuschalten.
 *
 * ZWEI SCHAERFEN, weil beide gebraucht werden:
 *   `auch` genannt  — nur dieses eine Mitglied faellt heraus. Bei einer Gruppe
 *                     aus drei Quellen bleibt der Rest zusammen.
 *   `auch` weggelassen — die ganze Zuordnung faellt.
 *
 * DIE TRENNUNG WIRD GEMERKT, nicht nur ausgefuehrt: jedes geloeste Paar landet
 * in `getrennt` und ueberlebt damit den naechsten Abgleich. Ohne das waere der
 * Knopf eine Beruhigung, die beim naechsten Druck auf „abgleichen" verfliegt.
 *
 * NICHTS GEHT VERLOREN. Beide Eintraege stehen unveraendert in data.json;
 * getrennt heisst „wieder zwei Kacheln", nicht „einer ist weg". Verlauf,
 * Weiterhoeren und Favoriten haengen am `schluessel`, und der aendert sich
 * dabei bei keinem der beiden.
 */
export function trennen(ablage: Ablage, fuehrend: string, auch?: string): Ablage {
  const f = String(fuehrend ?? '').trim()
  const einzeln = String(auch ?? '').trim()
  if (!f) return ablage
  const zuordnungen: Zuordnung[] = []
  const neuGetrennt: string[][] = []
  for (const z of ablage?.zuordnungen ?? []) {
    if (z.schluessel !== f) {
      zuordnungen.push(z)
      continue
    }
    if (einzeln) {
      if (!z.auch.includes(einzeln)) {
        zuordnungen.push(z)
        continue
      }
      neuGetrennt.push([f, einzeln])
      const rest = z.auch.filter((s) => s !== einzeln)
      // Bleibt nichts uebrig, faellt die Zuordnung ganz — eine Zuordnung mit
      // leerem `auch` ist keine Behauptung mehr, nur noch Ballast in der Datei.
      if (rest.length) zuordnungen.push({ ...z, auch: rest })
      continue
    }
    for (const s of z.auch) neuGetrennt.push([f, s])
  }
  return ablageAus({ zuordnungen, getrennt: [...(ablage?.getrennt ?? []), ...neuGetrennt] })
}

/**
 * Eine Trennung zuruecknehmen — der Rueckweg des Rueckwegs.
 *
 * Ohne sie waere „trennen" eine Einbahnstrasse: das Paar stuende fuer immer in
 * `getrennt`, und kein Abgleich fuende es je wieder. Ein Fehlgriff in der
 * Verwaltung waere damit teurer als der Fehler, gegen den der Knopf gebaut ist.
 */
export function verbinden(ablage: Ablage, a: string, b: string): Ablage {
  const s = paarSchluessel(a, b)
  return {
    zuordnungen: ablage?.zuordnungen ?? [],
    getrennt: (ablage?.getrennt ?? []).filter((p) => paarSchluessel(p[0], p[1]) !== s),
  }
}

/**
 * Eine Zuordnung von HAND FESTSCHREIBEN — fuer Aufrufer, die ihre Quelle
 * bereits KENNEN und sie nicht der Heuristik ueberlassen muessen.
 *
 * ══ WOFUER (29.08.2026) ═════════════════════════════════════════════════════
 * Der Mitschnitt (plugins/mixpi-mitschnitt) weiss beim Anlegen seiner Kachel
 * genau, aus welchem Spotify-Eintrag sie stammt (`context.uri` des laufenden
 * Stuecks) — er muss nicht warten, bis `meinenDasselbe()` Titel und Interpret
 * zufaellig fuer aehnlich genug haelt. Dieselbe Funktion traegt kuenftig auch
 * eine „von Hand verbinden"-Schaltflaeche der Verwaltung, sobald es sie gibt;
 * der Endpunkt in server.ts (`/api/verschmelzung/festschreiben`) reicht nur
 * durch.
 *
 * ══ GETRENNT GEWINNT ════════════════════════════════════════════════════════
 * Hat ein Mensch dieses Paar ausdruecklich AUSEINANDERGENOMMEN (`trennen`),
 * hebt diese Funktion das nicht still auf — eine automatische Festschreibung
 * darf eine bewusste Entscheidung nicht ueberschreiben. Die Ablage kommt dann
 * UNVERAENDERT zurueck.
 *
 * ══ IDEMPOTENT ══════════════════════════════════════════════════════════════
 * Steckt das Paar (in beliebiger Richtung) schon in einer Zuordnung, aendert
 * sich nichts — ein zweiter Aufruf mit denselben zwei Schluesseln darf die
 * Ablage nicht wachsen lassen (der Mitschnitt ruft bei jedem weiteren Stueck
 * desselben Albums erneut auf).
 *
 * ══ FUEHRT EINER DER BEIDEN SCHON EINE ZUORDNUNG ════════════════════════════
 * Dann wird SIE erweitert, statt eine zweite, konkurrierende anzulegen — Fall
 * 4 in `verschmelzeWerke()` (verschmelzung.ts) laesst von zwei Zuordnungen zum
 * selben Schluessel nur die ERSTE gelten, die zweite faellt GANZ weg. Ohne
 * diese Ruecksicht waere ein zweiter Aufruf ein stiller Fehlschlag: er schriebe
 * etwas in die Datei, das `verschmelzeWerke` nie ansieht.
 */
export function handVerbinden(ablage: Ablage, a: string, b: string): Ablage {
  const x = String(a ?? '').trim()
  const y = String(b ?? '').trim()
  const leer: Ablage = { zuordnungen: [], getrennt: [] }
  const jetzt = ablage ?? leer
  if (!x || !y || x === y) return jetzt
  const paar = paarSchluessel(x, y)
  const schonGetrennt = (jetzt.getrennt ?? []).some(
    (p) => Array.isArray(p) && p.length === 2 && paarSchluessel(p[0], p[1]) === paar,
  )
  if (schonGetrennt) return jetzt

  const zuordnungen = jetzt.zuordnungen ?? []
  const gehoertZu = (z: Zuordnung, s: string) => z.schluessel === s || z.auch.includes(s)
  if (zuordnungen.some((z) => gehoertZu(z, x) && gehoertZu(z, y))) return jetzt // schon verbunden

  const i = zuordnungen.findIndex((z) => gehoertZu(z, x))
  if (i >= 0) {
    const neu = [...zuordnungen]
    neu[i] = { ...neu[i], auch: [...neu[i].auch, y] }
    return { zuordnungen: neu, getrennt: jetzt.getrennt ?? [] }
  }
  const j = zuordnungen.findIndex((z) => gehoertZu(z, y))
  if (j >= 0) {
    const neu = [...zuordnungen]
    neu[j] = { ...neu[j], auch: [...neu[j].auch, x] }
    return { zuordnungen: neu, getrennt: jetzt.getrennt ?? [] }
  }
  return { zuordnungen: [...zuordnungen, { schluessel: x, auch: [y], stufe: 'hand' }], getrennt: jetzt.getrennt ?? [] }
}

/**
 * Eine Profil-Medienauswahl um die PARTNER ihrer Zuordnungen erweitern.
 *
 * ══ WOFUER (30.08.2026, „Guten Morgen / Good Morning") ══════════════════════
 * Gefiltert wird VOR der Verschmelzung (auswahl.ts erklaert, warum diese
 * Reihenfolge richtig ist) — aber die Auswahl eines Profils kennt nur die
 * Schluessel, die beim Anhaken existierten. Der Mitschnitt legt spaeter eine
 * Kachel unter EIGENEM Schluessel an und bindet sie per Hand-Zuordnung an
 * den gewaehlten Spotify-Eintrag. Ohne diese Erweiterung fiel die
 * Mitschnitt-Kachel aus der gefilterten Liste, die Zuordnung fand ihr
 * Mitglied nicht („Ein Schluessel, den es in dieser Liste nicht gibt, wird
 * uebergangen", verschmelzung.ts), nichts verschmolz — und der Tipp auf die
 * Kachel spielte mit den Metadaten der falschen Quelle am falschen Ort.
 *
 * DIE REGEL: Wer EIN Mitglied einer Zuordnung gewaehlt hat, hat sie ganz
 * gewaehlt — in beide Richtungen (auch das gewaehlte Mitglied zieht den
 * Fuehrenden). Das gilt AUCH bei ausgeschalteter Verschmelzung: die
 * Zuordnung sagt „dasselbe Werk", und die aufgenommene Fassung eines
 * gewaehlten Albums ist kein neuer Inhalt, sondern derselbe.
 *
 * Ohne Auswahl (alles sichtbar) und ohne Treffer kommt die Eingabe
 * UNVERAENDERT zurueck — dasselbe Objekt, wie bei `auswahlFiltern`.
 */
export function auswahlUmZuordnungenErweitern<A extends { werke: string[] } | null | undefined>(
  auswahl: A,
  zuordnungen: readonly Zuordnung[] | null | undefined,
): A {
  if (!auswahl?.werke?.length) return auswahl
  const menge = new Set(auswahl.werke)
  let dazu = false
  for (const z of Array.isArray(zuordnungen) ? zuordnungen : []) {
    const glieder = [z?.schluessel, ...(Array.isArray(z?.auch) ? z.auch : [])]
      .map((s) => String(s ?? '').trim())
      .filter(Boolean)
    if (glieder.length < 2 || !glieder.some((s) => menge.has(s))) continue
    for (const s of glieder) {
      if (!menge.has(s)) {
        menge.add(s)
        dazu = true
      }
    }
  }
  // Die Nullbarkeit des EINGANGS wird gespiegelt, nie hinzugefuegt — der
  // Aufrufer mit einer echten Auswahl bekommt typsicher eine echte zurueck.
  return dazu ? ({ ...auswahl, werke: [...menge] } as A) : auswahl
}

/**
 * Ein Werk so, wie `gruppiereTreffer` es lesen kann.
 *
 * ERWEITERT `TrefferArtig`, statt dessen Felder abzuschreiben: `gruppiereTreffer`
 * ist auf genau diese Form geprueft (medien.spec.ts), und eine zweite Fassung
 * hier waere die Stelle, an der die beiden spaeter auseinanderlaufen.
 */
export interface AbgleichTreffer extends TrefferArtig {
  nr: number
  schluessel: string
  dienst: string
  art: string
  title: string
  artist: string
  kategorie: string
  titelAnzahl?: number
}

/**
 * Der Abgleich selbst: was ist dasselbe?
 *
 * DIE REIHENFOLGE DER LISTE ENTSCHEIDET, WER FUEHRT — und das ist keine
 * Beliebigkeit, sondern die vorsichtigste Wahl. Der `schluessel` des
 * fuehrenden Werks ist IDENTITAET: daran haengen Verlauf (gespielt.json),
 * Weiterhoeren (resume.json), Favoriten und die Bildadresse. Die Bibliothek
 * waechst hinten (`[...liste, e]` in /api/medien), der ERSTE Treffer einer
 * Gruppe ist also der aeltere Eintrag — und damit der, an dem am ehesten schon
 * ein Verlauf haengt. Ihn fuehren zu lassen nimmt dem Kind am wenigsten.
 *
 * (Und selbst das ist umkehrbar: der zweite Schluessel verschwindet nicht, er
 * steht als `auchSchluessel` am verschmolzenen Werk und unveraendert in
 * data.json. Wer trennt, bekommt beide Verlaeufe zurueck.)
 */
export function zuordnungenVorschlagen(werke: Werk[], opt: AbgleichOptionen = {}): AbgleichErgebnis {
  const liste = (Array.isArray(werke) ? werke : []).filter((w) => w && typeof w === 'object')

  // 1. MEHRDEUTIGE SCHLUESSEL — vor allem anderen, denn sie entwerten jede
  //    Zuordnung, die sie nennt (verschmelzung.ts, Fall 3).
  const jeSchluessel = new Map<string, Werk[]>()
  for (const w of liste) {
    const bisher = jeSchluessel.get(w.schluessel)
    if (bisher) bisher.push(w)
    else jeSchluessel.set(w.schluessel, [w])
  }
  const mehrdeutig: Mehrdeutig[] = []
  const doppelt = new Set<string>()
  for (const [schluessel, gruppe] of jeSchluessel) {
    if (gruppe.length < 2) continue
    doppelt.add(schluessel)
    mehrdeutig.push({
      schluessel,
      anzahl: gruppe.length,
      titel: gruppe[0].titel,
      interpret: gruppe[0].interpret,
      kategorien: gruppe.map((w) => w.kategorie),
    })
  }

  const gesperrt = new Set<string>()
  for (const p of Array.isArray(opt.getrennt) ? opt.getrennt : []) {
    if (Array.isArray(p) && p.length === 2 && p[0] && p[1]) gesperrt.add(paarSchluessel(String(p[0]), String(p[1])))
  }

  // 2. GRUPPIEREN MIT DER VORHANDENEN REGEL. `quellen[0]` ist hier immer die
  //    einzige Quelle: verschmolzen wird ja erst danach.
  const treffer: AbgleichTreffer[] = liste.map((w, nr) => ({
    nr,
    schluessel: w.schluessel,
    dienst: w.quellen?.[0]?.dienst ?? 'anderes',
    art: w.art,
    title: w.titel,
    artist: w.interpret ?? '',
    kategorie: w.kategorie,
    titelAnzahl: opt.titelAnzahl?.[w.schluessel],
  }))

  const gruppen = new Map<number, AbgleichTreffer[]>()
  for (const t of gruppiereTreffer(treffer, opt.regeln ?? REGELN_NORMAL)) {
    const bisher = gruppen.get(t.gruppe)
    if (bisher) bisher.push(t)
    else gruppen.set(t.gruppe, [t])
  }

  const vorschlaege: Zuordnung[] = []
  const uebergangen: Uebergangen[] = []
  for (const gruppe of gruppen.values()) {
    if (gruppe.length < 2) continue
    const schluessel = gruppe.map((t) => t.schluessel)
    if (schluessel.some((s) => doppelt.has(s))) {
      uebergangen.push({
        grund: 'mehrdeutig',
        schluessel,
        titel: gruppe[0].title,
        interpret: gruppe[0].artist || undefined,
      })
      continue
    }
    // WAS NUR BEIM VERSCHMELZEN GILT — siehe `warumNicht`. Es steht NACH der
    // Mehrdeutigkeit und VOR der Trennung: ein mehrdeutiger Schluessel macht
    // jede weitere Frage gegenstandslos, eine Handentscheidung dagegen soll
    // sichtbar bleiben, auch wenn ohnehin nicht verschmolzen wuerde.
    const dagegen = warumNicht(gruppe)
    if (dagegen) {
      uebergangen.push({
        grund: dagegen,
        schluessel,
        titel: gruppe[0].title,
        interpret: gruppe[0].artist || undefined,
      })
      continue
    }
    const fuehrend = gruppe[0]
    const mit: AbgleichTreffer[] = []
    const ohne: AbgleichTreffer[] = []
    for (const t of gruppe.slice(1)) {
      if (gesperrt.has(paarSchluessel(fuehrend.schluessel, t.schluessel))) ohne.push(t)
      else mit.push(t)
    }
    if (ohne.length) {
      uebergangen.push({
        grund: 'getrennt',
        schluessel: [fuehrend.schluessel, ...ohne.map((t) => t.schluessel)],
        titel: fuehrend.title,
        interpret: fuehrend.artist || undefined,
      })
    }
    if (!mit.length) continue
    vorschlaege.push({
      schluessel: fuehrend.schluessel,
      auch: mit.map((t) => t.schluessel),
      // `locker` IST die Stufe, die `gruppiereTreffer` verkoerpert. Sie
      // mitzuschreiben ist Pflicht und keine Verzierung: die Verwaltung soll
      // „verbunden per Namensvergleich" sagen koennen statt eines Orakels.
      stufe: 'locker',
    })
  }

  return { vorschlaege, mehrdeutig, uebergangen }
}

/**
 * Was ist gegenueber der Ablage NEU?
 *
 * WOFUER: die Bibliothek waechst. Legt jemand ein Album zusaetzlich in
 * Jellyfin ab, entsteht eine neue Ueberschneidung — und ohne diesen Vergleich
 * merkte es niemand, weil der Abgleich nur auf Knopfdruck laeuft. Die
 * Verwaltung kann damit „2 neue Vorschlaege" anzeigen, statt den Menschen
 * blind auf „abgleichen" druecken zu lassen.
 */
export function neueVorschlaege(ablage: Ablage, vorschlaege: Zuordnung[]): Zuordnung[] {
  const bekannt = new Set<string>()
  for (const z of ablage?.zuordnungen ?? []) {
    bekannt.add(z.schluessel)
    for (const s of z.auch) bekannt.add(s)
  }
  return (Array.isArray(vorschlaege) ? vorschlaege : []).filter(
    (v) => !bekannt.has(v.schluessel) && !v.auch.some((s) => bekannt.has(s)),
  )
}
