/**
 * DER SPIELBEREICH — eine eigene Sache, kein Anhaengsel des Vorlesens.
 *
 * ══ WARUM ES DIESE DATEI GIBT (20.09.2026) ══════════════════════════════
 *
 * Der Schalter entstand einen Tag zuvor auf Wunsch des Betreibers, und zwar
 * auf der VORLESEN-Seite — auch das war sein Wunsch. Einen Tag spaeter:
 * „ich moechte den spiel bereich seperat einschalten koennen."
 *
 * Er hat recht, und die Begruendung stand schon im alten Kommentar: Der
 * Schalter hatte mit Sprache nie etwas zu tun. Er lag nur dort, weil es
 * bequem war. Dieselbe Bewegung wie beim TON am 15.08.2026 („ich wuerde den
 * ton jetzt gerne in einem eigenen tab haben") — was eine eigene Sache ist,
 * bekommt einen eigenen Ort.
 *
 * ══ WARUM AUCH DER SPEICHER UMZIEHT, NICHT NUR DIE SEITE ════════════════
 *
 * Die Seite allein zu verschieben waere die halbe Arbeit — und eine
 * gefaehrliche. Der Wert laege weiter in `vorlesen.json`, geschrieben ueber
 * `PUT /api/vorlesen`, das IMMER das ganze Objekt setzt. Zwei
 * Verwaltungsseiten schrieben dann dieselbe Datei: wer auf der Spiele-Seite
 * schaltet, waehrend die Vorlesen-Seite noch einen aelteren Stand im
 * Formular haelt, verliert eine der beiden Aenderungen. Ein stiller
 * Datenverlust, der nur auftritt, wenn jemand zwei Reiter offen hat — also
 * genau dann, wenn niemand danach sucht.
 *
 * ══ DER UMZUG NIMMT NICHTS WEG ══════════════════════════════════════════
 *
 * Auf jeder Box liegt der gestern geschriebene Wert in `vorlesen.json`.
 * `ausVorlesenUebernehmen` holt ihn EINMAL heraus, wenn es noch keine
 * `spiele.json` gibt. Ohne das haette ein Betreiber, der die Spiele gestern
 * abgeschaltet hat, sie heute wieder an — und keinen Grund, das zu
 * vermuten. Dieselbe Regel wie beim Einbau des Schalters selbst: „nicht
 * gesagt" heisst „wie bisher", nie „Werksvorgabe".
 */

/* ══════════════════════════════════════════════════════════════════════════
 * ZWEITER ZUG (20.09.2026): EINE STIMME UND EINZELNE SPIELE
 *
 * Betreiber: „in der spiele sektion will ich das vorlesen noch einschalten
 * koennen und auch verschiedene spiele ein und ausschalten koennen."
 *
 * Zwei Dinge, die nichts miteinander zu tun haben, und beide gehoeren
 * hierher statt auf die Vorlesen-Seite:
 *
 *   1. DIE STIMME IM SPIELBEREICH ist nicht das Vorlesen der Kacheln. Das
 *      dort eingestellte `modus` entscheidet, ob ein ANTIPPEN spricht —
 *      im Spielbereich wird nichts angetippt. Haenge man die Spielstimme
 *      daran, muesste ein Betreiber das Kachel-Vorlesen einschalten, um im
 *      Spiel eine Ansage zu bekommen: zwei Dinge an einem Schalter.
 *      Gesprochen wird trotzdem mit derselben Stimme (Piper, `/api/vorlesen/
 *      sprich`) — die Stimme ist Ausstattung der Box, nicht des Vorlesens.
 *
 *   2. EINZELNE SPIELE. Seit es mehr als eines gibt, ist „Spiele an" zu
 *      grob: Memory darf ein Vierjaehriger, Drei gewinnt langweilt ihn, und
 *      wer die Schlange nicht im Haus haben will, wollte deshalb bisher den
 *      ganzen Bereich abschalten.
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * Die Spiele, die es gibt — der Server ist die Liste, nicht die Oberflaeche.
 *
 * WARUM HIER UND NICHT IN app.js: Die Verwaltungsseite muss Schalter fuer
 * genau diese Spiele zeigen, und die Normalisierung muss unbekannte
 * Schluessel wegwerfen. Beides braucht die Liste. Stuende sie in der
 * Oberflaeche, gaebe es sie zweimal — und beim dritten Spiel faende es
 * niemand.
 *
 * DIE KENNUNG IST DER SPEICHERSCHLUESSEL und aendert sich nie; der Name
 * darf sich aendern.
 */
export interface SpielWerk {
  id: string
  name: string
  /** Ein Satz fuer die Verwaltungsseite — was ist das fuer ein Spiel? */
  was: string
}

export const SPIELE_WERKE: readonly SpielWerk[] = [
  {
    id: 'schlange',
    name: 'Schlange',
    was: 'Der Klassiker: mit dem Steuerkreuz lenken, Futter fressen, nicht anstossen. Ab etwa fünf Jahren.',
  },
  {
    id: 'memory',
    name: 'Paare',
    was: 'Zwölf Karten, sechs Paare. Aufdecken und merken — geht auch ohne lesen zu können, und mit Stimme sagt die Box jedes Bild an.',
  },
  {
    id: 'dreigewinnt',
    name: 'Drei gewinnt',
    was: 'Drei in einer Reihe gegen die Box. Kurz, ruhig, ohne Zeitdruck.',
  },
  {
    id: 'farben',
    name: 'Farben merken',
    was: 'Die Box zeigt eine Folge, das Kind tippt sie nach — jede Runde eine Farbe länger.',
  },
] as const

/** Alle Kennungen, die es gibt. */
export const SPIEL_IDS: readonly string[] = SPIELE_WERKE.map((w) => w.id)

/* ══════════════════════════════════════════════════════════════════════════
 * UND DIE SCHUBLADE, die schon laenger da war und NIRGENDS abschaltbar
 * (20.09.2026, beim Bauen der Einzelschalter gefunden).
 *
 * Die Box hat ZWEI Spielorte, und das ist Absicht, kein Wildwuchs:
 *
 *   SPIELECKE    Fernbedienung/Controller, Vollbild, vier Richtungen und
 *                ein Knopf. Fuer das Kind auf dem Sofa.
 *   SCHUBLADE    Tipp-Apps neben den Kategorien (NewDesign/apps.js, seit
 *                03.09.2026). Fuer den Finger am Schirm.
 *
 * Fuer einen Betreiber ist das trotzdem EINE Frage: „was darf mein Kind
 * hier spielen?" Sie an zwei Orten zu stellen, waere die Trennung des
 * Programmierers, nicht die des Elternteils — deshalb stehen beide auf der
 * Spiele-Seite, in zwei Karten.
 *
 * DIE APPS SELBST BLEIBEN IN apps.js. Hier steht nur, was der Betreiber
 * abschalten darf — Kennung und Name, damit die Verwaltung Schalter zeigen
 * kann, ohne apps.js zu kennen.
 * ═════════════════════════════════════════════════════════════════════════ */

export const APP_WERKE: readonly SpielWerk[] = [
  {
    id: 'memory',
    name: 'Memory',
    was: 'Kartenpaare mit den Bildern der eigenen Bibliothek — und mitgelieferten Sätzen, wenn keine da sind.',
  },
  { id: 'puzzle', name: 'Puzzle', was: 'Ein Bild in Teilen, die geschoben werden. Braucht Bilder in der Bibliothek.' },
  { id: 'rechnen', name: 'Rechnen', was: 'Plus und Minus. Läuft auf jeder Box, auch ohne einen einzigen Titel.' },
  { id: 'uhr', name: 'Uhr', was: 'Die Zeiger stellen und ablesen lernen.' },
  {
    id: 'lesen',
    name: 'Lesen',
    was: 'Wörter zum Mitlesen — braucht Titel in der Bibliothek UND eingeschaltetes Vorlesen.',
  },
  { id: 'malen', name: 'Malen', was: 'Eine leere Fläche und ein Stift. Braucht nichts.' },
] as const

export const APP_IDS: readonly string[] = APP_WERKE.map((w) => w.id)

export interface SpielEinstellungen {
  /** Darf der Spielbereich geoeffnet werden? */
  an: boolean
  /**
   * Spricht der Spielbereich? Ansage des Spielnamens, der aufgedeckten
   * Karte, des Ausgangs. UNABHAENGIG vom Kachel-Vorlesen (`vorlesen.json`,
   * `modus`) — Begruendung im Kopf dieser Datei.
   */
  vorlesen: boolean
  /**
   * Je Spiel: darf es gewaehlt werden? Schluessel sind die Kennungen aus
   * `SPIELE_WERKE`, fehlende gelten als an.
   */
  spiele: Record<string, boolean>
  /** Dasselbe fuer die Tipp-Apps der Schublade (`APP_WERKE`). */
  apps: Record<string, boolean>
}

/**
 * AN, denn so war es immer. Die Spielecke gibt es seit dem 06.09.2026 und
 * sie lief von Anfang an; ein Ort fuer den Schalter ist kein Grund, die
 * Funktion abzuschalten.
 */
export const SPIELE_VORGABE: SpielEinstellungen = {
  an: true,
  // AUS, denn so war es immer. Die Spielecke hat nie gesprochen; ein neuer
  // Schalter, der eine Box ungefragt zum Reden bringt, ist eine Aenderung
  // und keine Einstellung. Dieselbe Regel wie oben, nur andersherum
  // angewandt: „nicht gesagt" heisst „wie bisher".
  vorlesen: false,
  // ALLE AN. Fuer die Schlange, weil sie lief; fuer die drei neuen, weil ein
  // Spiel, das man erst suchen und einschalten muss, niemandem auffaellt.
  spiele: Object.fromEntries(SPIEL_IDS.map((id) => [id, true])),
  // Und die Schublade unveraendert an: Sie lief seit dem 03.09.2026, der
  // Schalter kommt heute dazu. Ein neuer Schalter nimmt nichts weg.
  apps: Object.fromEntries(APP_IDS.map((id) => [id, true])),
}

/**
 * `!== false` UND NICHT `=== true` — der Unterschied ist der Umstieg.
 * Eine Datei, die den Schluessel nicht kennt (oder ein verunglueckter Wert
 * aus einem Formular), bedeutet weiter „an". Nur ein ausdrueckliches
 * Boolesches Nein schaltet ab.
 */
export function spieleNormalisieren(roh: unknown): SpielEinstellungen {
  const r = (roh ?? {}) as Record<string, unknown>
  return {
    an: r.an !== false,
    // `=== true` UND NICHT `!== false` — umgekehrt zu `an`, und das ist der
    // ganze Unterschied zwischen „vorhandene Funktion nicht wegnehmen" und
    // „neue Funktion nicht aufdraengen". Jede heute gespeicherte spiele.json
    // kennt den Schluessel nicht; mit `!== false` faenge jede Box im Haus
    // beim naechsten Start an zu sprechen.
    vorlesen: r.vorlesen === true,
    spiele: wahlNormalisieren(r.spiele, SPIEL_IDS),
    apps: wahlNormalisieren(r.apps, APP_IDS),
  }
}

/**
 * Die Einzelschalter: NUR BEKANNTE KENNUNGEN, und fehlende heissen an.
 *
 * NUR BEKANNTE: was hier hereinkommt, stand einmal in einem Formular. Ein
 * Schluessel aus einer aelteren Fassung (oder ein Tippfehler) darf nicht in
 * der Datei versteinern und beim naechsten Leser wie ein Spiel aussehen,
 * das es gibt.
 *
 * FEHLENDE HEISSEN AN: dieselbe Richtung des Zweifels wie bei `an`. Wer
 * heute eine spiele.json ohne den Abschnitt hat, hat nichts abgeschaltet.
 * Und ein Spiel, das erst morgen dazukommt, ist morgen da — nicht
 * stillschweigend aus, weil die Datei von gestern es nicht kannte.
 */
function wahlNormalisieren(roh: unknown, ids: readonly string[]): Record<string, boolean> {
  const r = (roh ?? {}) as Record<string, unknown>
  const raus: Record<string, boolean> = {}
  for (const id of ids) raus[id] = r[id] !== false
  return raus
}

/**
 * Ist ueberhaupt etwas zu spielen?
 *
 * Wer den Bereich anlaesst und jedes einzelne Spiel abschaltet, hat ihn
 * abgeschaltet — nur umstaendlicher. Die Tuer fragt deshalb BEIDES, und die
 * Verwaltungsseite sagt es dazu. Ohne diese Zeile stuende ein Kind vor einer
 * leeren Auswahl und haette keinen Grund, das fuer Absicht zu halten.
 */
export function darfGespieltWerden(e: SpielEinstellungen): boolean {
  return e.an && SPIEL_IDS.some((id) => e.spiele[id] !== false)
}

/**
 * Was aus der alten Fassung zu retten ist.
 *
 * `vorlesen.json` trug den Schalter vom 19.09. bis zum 20.09.2026 unter dem
 * Namen `spiele`. Liegt dort ein ausdrueckliches `false`, gilt es weiter.
 * Alles andere — Schluessel fehlt, Datei fehlt, Datei kaputt — heisst „an",
 * denn das war der Zustand jeder Box davor.
 *
 * ABSICHTLICH OHNE DATEIZUGRIFF: Diese Entscheidung ist eine REGEL und
 * gehoert getestet, ohne dass ein Dateisystem dafuer hergerichtet werden
 * muss. Wer die Datei liest, steht im Server.
 */
export function ausVorlesenUebernehmen(vorleseRoh: unknown): SpielEinstellungen {
  const v = (vorleseRoh ?? {}) as Record<string, unknown>
  // Die alte Fassung kannte NUR den einen Schalter. Alles andere kommt aus
  // der Vorgabe — und ausdruecklich NICHT aus `modus` der Vorlesen-Datei:
  // wer Kacheln vorlesen laesst, hat damit nicht bestellt, dass ein Spiel
  // spricht.
  return {
    ...SPIELE_VORGABE,
    spiele: { ...SPIELE_VORGABE.spiele },
    apps: { ...SPIELE_VORGABE.apps },
    an: v.spiele !== false,
  }
}
