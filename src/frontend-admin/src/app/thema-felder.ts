/**
 * WAS AN EINEM THEMA EINSTELLBAR IST — die eine Liste dieser Art.
 *
 * ══ WOFUER DIESE DATEI ═════════════════════════════════════════════════════
 *
 * Bisher stand die Auswahl der einstellbaren Farben als `FARBFELDER` MITTEN IN
 * der Verwaltungsseite (`seiten/darstellung.ts`). Solange es nur einen
 * Bediener gab, ging das. Ab dem 06.08.2026 gibt es zwei: die
 * Verwaltungsseite und `tools/thema-werkstatt.mjs`. Zwei Listen liefen
 * auseinander, sobald jemand eine Farbe ergaenzt — und dann faerbte die
 * Werkstatt etwas, das die Verwaltung nicht kennt, oder umgekehrt. Genau das
 * Muster aus [[drei-orte-eine-anzeige]].
 *
 * SIE LIEGT IN `frontend-admin`, UND DAS IST DIE ABSICHT: Von hier aus
 * erreichen sie BEIDE. Die Verwaltungsseite bindet sie als Nachbarmodul ein;
 * die Werkstatt laedt sie ueber `tsx`. Umgekehrt ginge es nicht — ein Modul in
 * `backend-api` kann die Angular-Anwendung nicht einbinden (eigenes Paket),
 * darum steht `themen-wahl.ts` dort auch als bewusste Kopie.
 *
 * ══ REIN, UND ZWAR NACHPRUEFBAR ════════════════════════════════════════════
 *
 * Keine DOM-, keine Netz-, keine Dateiberuehrung. Damit laesst sie sich mit
 * `vitest` pruefen, ohne ein Bauteil zu bauen — dieselbe Ueberlegung wie bei
 * `farben.ts` nebenan.
 *
 * ══ WAS HIER NICHT STEHT: DIE WERTE ════════════════════════════════════════
 *
 * Kein einziger Farbwert. Die Vorgaben stehen in `NewDesign/app.css`, und nur
 * dort. Eine zweite Werteliste hier liefe der Datei davon, aus der die Box
 * ihre Farben wirklich nimmt — und die Verwaltung zeigte Farben, die es auf
 * dem Geraet nicht gibt. Gelesen werden sie mit `wurzelFarben()` aus
 * `farben.ts`.
 */

/**
 * Die Gruppen, in denen die Farben angeboten werden.
 *
 * WARUM UEBERHAUPT GRUPPEN: Die Verwaltungsseite bot bis heute FUENF Farben an
 * und begruendete das damit, dass sechzehn Regler fuer eine Frage zu viel
 * seien. Das Argument ist richtig — aber die Antwort darauf ist eine
 * REIHENFOLGE, keine Weglassung. Wer nur fuenf anbietet, macht die uebrigen elf
 * unerreichbar; wer sie in „zuerst diese fuenf, dann die Feinheiten" ordnet,
 * beantwortet dieselbe Sorge, ohne jemandem etwas wegzunehmen.
 */
export const GRUPPEN = [
  {
    id: 'grund',
    name: 'Das Bild',
    wozu: 'Diese fünf ergeben zusammen den Gesamteindruck. Wer hier anfängt, ist meist schon fertig.',
  },
  {
    id: 'fein',
    name: 'Feinabstimmung',
    wozu: 'Abstufungen der fünf darüber. Erst sinnvoll, wenn die sitzen.',
  },
  {
    id: 'signal',
    name: 'Signalfarben',
    wozu: 'Farben, die etwas BEDEUTEN und nicht nur schmücken. Sie müssen sich voneinander abheben.',
  },
] as const

export type GruppenId = (typeof GRUPPEN)[number]['id']

/** Eine einstellbare Farbe der neuen Oberflaeche. */
export interface Farbfeld {
  /** Der Variablenname, genau wie in app.css. */
  v: string
  name: string
  wozu: string
  gruppe: GruppenId
}

/**
 * ALLE Farben, die `:root` in app.css als `#RRGGBB` fuehrt.
 *
 * VOLLSTAENDIG UND NICHT AUSGEWAEHLT: Die Werkstatt ist zum Themenbauen da, und
 * ein Thema, das elf der sechzehn Farben nicht anfassen kann, ist keines. Die
 * Sorge vor zu vielen Reglern loest `gruppe` (siehe GRUPPEN).
 *
 * NICHT DABEI, und das ist kein Versehen:
 *
 *   `--line` — GEMESSEN (05.08.2026, tools/farbwaehler-wirkung.mjs, am
 *   06.08.2026 nachgezaehlt): steht zweimal in app.css und wird NULL Mal mit
 *   `var()` gelesen. Ein Regler darauf saehe richtig aus und faerbte nichts.
 *   Die Linien haengen an `--line2`. Damit dieser Satz nicht altert, prueft
 *   `unbenutzte()` weiter unten ihn bei jedem Start nach, statt ihn zu
 *   glauben.
 *
 *   Die PLAKETTENFARBEN DER DIENSTE (rss, lokal, ard, spotify, radio,
 *   jellyfin) stehen nicht in `:root`, sondern fest in den Regeln `.marke-*`.
 *   Sie sind eine ABGEMESSENE Runde um den Farbkreis (339°, 211°, 175°, 141°,
 *   17°, 268°), damit sich auf 29 Bildpunkten aus zwei Metern kein Dienst mit
 *   einem anderen verwechseln laesst. Frei waehlbar koennte man zwei davon
 *   ununterscheidbar machen — und das Kind saehe nicht mehr, woher ein Album
 *   kommt. Ob sie trotzdem hineinsollen, gehoert dem Betreiber; hier wird es
 *   nicht vorweggenommen.
 */
export const FARBFELDER: readonly Farbfeld[] = [
  { v: '--bg', name: 'Hintergrund', wozu: 'der Grund hinter allem', gruppe: 'grund' },
  { v: '--surface', name: 'Flächen', wozu: 'Seitenleiste, Fenster, Karten', gruppe: 'grund' },
  { v: '--ink', name: 'Schrift', wozu: 'jeder Text', gruppe: 'grund' },
  { v: '--line2', name: 'Linien', wozu: 'Ränder, Balken, leere Cover', gruppe: 'grund' },
  { v: '--accent', name: 'Akzent', wozu: 'Ring um das laufende Album, Fortschritt', gruppe: 'grund' },

  { v: '--rowBg', name: 'Reihengrund', wozu: 'der Grund unter einer Regalreihe', gruppe: 'fein' },
  { v: '--muted', name: 'Nebentext', wozu: 'Untertitel, Hinweise — alles Zweitrangige', gruppe: 'fein' },
  { v: '--accentDark', name: 'Akzent dunkel', wozu: 'der dunklere Zwilling des Akzents', gruppe: 'fein' },
  { v: '--accentInk', name: 'Schrift auf Akzent', wozu: 'Text, der auf der Akzentfarbe steht', gruppe: 'fein' },
  { v: '--hl', name: 'Hervorhebung', wozu: 'der hinterlegte Streifen unter einer Auswahl', gruppe: 'fein' },

  { v: '--pill', name: 'Mini-Player', wozu: 'der Balken unten, der die Wiedergabe trägt', gruppe: 'signal' },
  { v: '--pillInk', name: 'Schrift im Mini-Player', wozu: 'Titel und Interpret darauf', gruppe: 'signal' },
  { v: '--mp-akzent', name: 'Mini-Player-Akzent', wozu: 'der Fortschritt im Mini-Player', gruppe: 'signal' },
  { v: '--weiter-blau', name: 'Weiterhören', wozu: 'der blaue Knopf „an der Stelle weiter"', gruppe: 'signal' },
] as const

/**
 * WIE OFT WIRD JEDE FARBE WIRKLICH GELESEN? — gezaehlt, nicht geglaubt.
 *
 * Ein Regler auf einer Variablen, die niemand mit `var()` liest, ist ein
 * Bedienelement, das luegt: Man dreht daran und nichts geschieht. Genau so
 * stand `--line` jahrelang in app.css.
 *
 * DIE ZAHL WIRD BEI JEDEM START NEU ERMITTELT und nicht hier aufgeschrieben.
 * Eine Zahl in einem Kommentar altert lautlos — diese hier kann es nicht.
 */
export function verwendungen(appCss: string, felder: readonly Farbfeld[] = FARBFELDER): Record<string, number> {
  const raus: Record<string, number> = {}
  for (const f of felder) {
    // `var(--name)` und `var(--name, rueckfall)` — beide zaehlen.
    const muster = new RegExp(`var\\(\\s*${f.v.replace(/[-\\^$*+?.()|[\]{}]/g, '\\$&')}\\s*[,)]`, 'g')
    raus[f.v] = (appCss.match(muster) || []).length
  }
  return raus
}

/**
 * Welche angebotenen Farben faerben in Wahrheit nichts?
 *
 * Erwartet wird eine LEERE Liste. Ist sie es nicht, gehoert entweder das Feld
 * hier heraus oder app.css die fehlende `var()`-Verwendung hinein — und die
 * Werkstatt sagt es, statt einen wirkungslosen Regler anzubieten.
 */
export function unbenutzte(appCss: string, felder: readonly Farbfeld[] = FARBFELDER): string[] {
  const z = verwendungen(appCss, felder)
  return felder.filter((f) => !z[f.v]).map((f) => f.v)
}

/**
 * Farbfelder, deren Variable es in app.css gar nicht (mehr) gibt.
 *
 * DER ANDERE HALBE FEHLER zu `unbenutzte()`: Dort geht es um eine Variable,
 * die dasteht und niemanden interessiert; hier um eine, die diese Liste
 * anbietet und die es nicht gibt. Wer eine Farbe aus app.css entfernt, soll es
 * beim naechsten Start der Werkstatt erfahren und nicht an einem Regler
 * merken, der ins Leere schreibt.
 */
export function unbekannte(
  vorhanden: Readonly<Record<string, string>>,
  felder: readonly Farbfeld[] = FARBFELDER,
): string[] {
  return felder.filter((f) => !vorhanden[f.v]).map((f) => f.v)
}

/** Die Felder einer Gruppe, in der Reihenfolge dieser Liste. */
export function derGruppe(gruppe: GruppenId, felder: readonly Farbfeld[] = FARBFELDER): Farbfeld[] {
  return felder.filter((f) => f.gruppe === gruppe)
}
