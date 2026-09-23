/**
 * WAS DIE BOX KANN — die eine Liste, auf die abgebildet wird.
 *
 * ══ WOZU (E134, Schritt 1) ═════════════════════════════════════════════════
 * Das Fernbedienungs-Konzept braucht eine Mapping-Schicht
 * `input-device → keycode → box-action`. Die Frage „wo sind die Box-Aktionen
 * zentral definiert?" stand im Konzept als offener Punkt — und die Antwort
 * war am 06.09.2026: NIRGENDS.
 *
 * Gesucht und nicht gefunden: `AKTIONEN` gibt es zweimal, aber für
 * Verwaltungszwecke (bluetooth.ts: koppeln/verbinden/…, dienste.ts:
 * start/stop/…). Die WIEDERGABE-Aktionen leben verstreut als HTTP-Pfade
 * (`/player/current/<befehl>`, ein Erbe der node-sonos-http-api), das Starten
 * eines Werks als `POST /api/spielen`, die Hardware-Taste (J1/MuPiHAT) ist
 * fest verdrahtet. Wer eine Taste auf „Play/Pause" abbilden will, bildet
 * heute auf eine Zeichenkette ab, die niemand pflegt — und der nächste Umbau
 * bricht sie still.
 *
 * ══ WARUM NUR EINE LISTE UND KEIN AUSFÜHRER ════════════════════════════════
 * Diese Datei WEISS nichts von HTTP, Tastencodes oder Bluetooth. Sie sagt
 * nur, WELCHE Aktionen es gibt und was sie bedeuten. Das ist Absicht: die
 * Liste soll von der Fernbedienung, den Hardware-Tastern, der Oberfläche und
 * später einem Controller gleichermaßen benutzt werden, und keine davon soll
 * die Eigenheiten der anderen erben. Der Ausführer gehört dorthin, wo schon
 * ein Weg zum Abspieldienst liegt (server.ts) — nicht hierher.
 *
 * ══ WAS NICHT DRIN STEHT, UND WARUM ════════════════════════════════════════
 * Kein „Lautstärke auf 37 %": Aktionen sind das, was eine TASTE auslöst, und
 * eine Taste trägt keinen Zahlenwert. `lauter`/`leiser` bewegen um eine
 * Stufe — dieselbe, die der Regler nimmt.
 *
 * Kein „Titel 4 abspielen": das braucht einen Werkschlüssel und ist damit
 * kein Tastendruck, sondern eine Auswahl.
 */

/** Wozu eine Aktion gehört — nur zur Gruppierung in der Verwaltung. */
export const AKTIONS_ARTEN = ['transport', 'lautstaerke', 'navigation', 'system'] as const
export type AktionsArt = (typeof AKTIONS_ARTEN)[number]

export interface BoxAktion {
  /** Stabile Kennung. Sie landet in gespeicherten Zuordnungen — sie darf sich
   *  NIE ändern, auch wenn der Anzeigename sich ändert. */
  id: string
  /** Was in der Verwaltung steht, wenn jemand eine Taste zuordnet. */
  name: string
  art: AktionsArt
  /** Ein Satz, der erklärt, was passiert — für den Zuordnungs-Bildschirm.
   *  Kein Marketing: er soll die Frage „und was macht das?" beantworten. */
  wirkung: string
  /** Darf diese Aktion auf einem LANGEN Druck liegen? Für alles, was etwas
   *  beendet oder abschaltet, ist der lange Druck die sichere Wahl — ein
   *  Kind trifft die Taste sonst versehentlich. */
  langerDruckEmpfohlen?: true
}

/**
 * DIE LISTE. Reihenfolge = Reihenfolge in der Verwaltung.
 *
 * Jeder Eintrag hier ist eine Zusage: er muss von der Mapping-Schicht
 * ausführbar sein. Wer eine Aktion hinzufügt, baut die Ausführung im selben
 * Zug — sonst steht in der Verwaltung eine Wahl, die nichts tut.
 */
export const BOX_AKTIONEN: readonly BoxAktion[] = [
  {
    id: 'abspielen-anhalten',
    name: 'Abspielen / Anhalten',
    art: 'transport',
    wirkung: 'Läuft etwas, hält es an. Ist es angehalten, spielt es weiter.',
  },
  {
    id: 'naechster-titel',
    name: 'Nächster Titel',
    art: 'transport',
    wirkung: 'Springt zum nächsten Titel des laufenden Werks.',
  },
  {
    id: 'voriger-titel',
    name: 'Voriger Titel',
    art: 'transport',
    wirkung: 'Springt an den Anfang des Titels — noch einmal gedrückt zum vorigen.',
  },
  {
    id: 'stoppen',
    name: 'Stoppen',
    art: 'transport',
    wirkung: 'Beendet die Wiedergabe. Die gemerkte Stelle bleibt erhalten.',
  },
  {
    id: 'lauter',
    name: 'Lauter',
    art: 'lautstaerke',
    wirkung: 'Eine Stufe lauter — dieselbe Stufe wie am Regler, und nie über die Obergrenze.',
  },
  {
    id: 'leiser',
    name: 'Leiser',
    art: 'lautstaerke',
    wirkung: 'Eine Stufe leiser.',
  },
  {
    id: 'hoch',
    name: 'Hoch',
    art: 'navigation',
    wirkung: 'Bewegt die Auswahl eine Reihe nach oben. Läuft gerade etwas, macht es stattdessen lauter.',
  },
  {
    id: 'runter',
    name: 'Runter',
    art: 'navigation',
    wirkung: 'Bewegt die Auswahl eine Reihe nach unten. Läuft gerade etwas, macht es stattdessen leiser.',
  },
  {
    id: 'links',
    name: 'Links',
    art: 'navigation',
    wirkung: 'Bewegt die Auswahl eine Kachel nach links.',
  },
  {
    id: 'rechts',
    name: 'Rechts',
    art: 'navigation',
    wirkung: 'Bewegt die Auswahl eine Kachel nach rechts.',
  },
  {
    id: 'auswaehlen',
    name: 'Auswählen',
    art: 'navigation',
    wirkung: 'Öffnet, was gerade ausgewählt ist — wie ein Fingertipp darauf.',
  },
  {
    id: 'startseite',
    name: 'Zur Startseite',
    art: 'navigation',
    wirkung: 'Zeigt wieder das Regal — wie der Druck auf das Haus-Zeichen.',
  },
  {
    id: 'zurueck',
    name: 'Zurück',
    art: 'navigation',
    wirkung: 'Eine Ebene zurück; auf der Startseite passiert nichts.',
  },
  {
    id: 'ausschalten',
    name: 'Ausschalten (mit Rückfrage)',
    art: 'system',
    wirkung: 'Öffnet die Abschaltfrage. Es schaltet NICHTS ohne die zweite Bestätigung ab.',
    langerDruckEmpfohlen: true,
  },
  {
    id: 'buehne-weiter',
    name: 'Bühne umschalten (Wellen / Songtext / Titel)',
    art: 'navigation',
    // SIE SCHALTET AUCH EIN. Betreiber, 06.09.2026: „nimm noch eine Taste auf
    // zum Umschalten in den Player" — und auf die Rückfrage: „und
    // einschalten". Die Reihenfolge schließt `aus` mit ein, sonst wäre die
    // Taste eine Einbahnstraße: wer durchschaltet, will auch wieder zu einem
    // ruhigen Player zurück, ohne in die Verwaltung zu gehen.
    wirkung:
      'Schaltet im Player die Bühne weiter: aus → Wellen → Songtext → Titel → aus. Gilt bis zum nächsten Start; die Einstellung der Verwaltung bleibt unberührt.',
  },
  {
    id: 'spielecke',
    name: 'Spielecke öffnen',
    art: 'navigation',
    // WARUM `navigation` UND NICHT `system`: Sie öffnet eine Ansicht in der
    // Oberfläche, mehr nicht. Die Musik läuft dabei weiter (Wunsch des
    // Betreibers, 06.09.2026: „Musik wäre gut, wenn man sie wahlweise auch
    // laufen lassen kann") — „wahlweise" braucht dafür keinen Schalter,
    // sondern nur den Anhalten-Knopf, den es ohnehin gibt.
    wirkung: 'Öffnet die Spielecke. Die Musik läuft weiter; „Zurück" schließt sie wieder.',
  },
] as const

/** Gibt es diese Kennung? Für gespeicherte Zuordnungen, die eine Aktion
 *  nennen, die es (nicht mehr) gibt — die Zuordnung wird dann still
 *  übergangen, statt einen Tastendruck ins Leere laufen zu lassen. */
export function istBoxAktion(x: unknown): x is string {
  return typeof x === 'string' && BOX_AKTIONEN.some((a) => a.id === x)
}

// `boxAktion(id)` — die ganze Aktion zu einer Kennung — ist am 19.09.2026
// gefallen (AUDIT-2026-09-19 Rang 7). Sie hatte ausser ihrer eigenen Spec
// keinen Leser: wer eine Zuordnung prueft, braucht nur die JA/NEIN-Antwort
// (`istBoxAktion`, darueber), und wer die Liste anzeigen will, bekommt sie
// als Ganzes ueber `BOX_AKTIONEN`. Eine dritte Form dazwischen war nie
// gefragt.
