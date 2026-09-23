/**
 * Was neben dem Helligkeitsregler steht, wenn der Schirm dunkler ist als er.
 *
 * WARUM DAS EINE EIGENE, REINE DATEI IST — dieselbe Begruendung wie bei
 * funk-text.ts nebenan: der Satz IST hier die Loesung. Der Mensch sitzt an
 * einem zweiten Rechner, sieht in der Verwaltung „20 %" und hat vor sich eine
 * Box mit schwarzem Bild. Der Satz muss ihm sagen, was WIRKLICH gilt und was
 * er DRUECKEN soll. So laesst er sich pruefen, ohne die Seite zu starten.
 *
 * DIE REGEL SELBST STEHT IM BACKEND (schirmhelligkeit.ts, /api/schirm/
 * helligkeit): `geklemmt` und `prozentEcht` kommen fertig herein. Hier wird
 * nichts nachgerechnet — sonst gaebe es zwei Untergrenzen, und die in der
 * Oberflaeche waere die, die man umgehen kann.
 */

/** Was die Antwort des Servers ueber die Klemmung sagt. */
export interface Klemmlage {
  /** Liegt der angezeigte Wert ueber dem, was das Geraet wirklich tut? */
  geklemmt: boolean
  /** Der ungeklemmte Wert in Prozent — 0 heisst: schwarz. */
  prozentEcht: number | null
  /** Die Untergrenze des Reglers, wie sie der Server nennt. */
  min: number
}

/** Was die Oberflaeche in dieser Lage zeigen darf. */
export interface Klemmhinweis {
  /** Steht ueberhaupt ein Hinweis da? */
  hinweis: boolean
  /** Der Satz — leer, wenn alles stimmt. */
  satz: string
  /**
   * Die Beschriftung des Knopfes, der die Box wieder sichtbar macht.
   *
   * ER IST DER EIGENTLICHE GRUND FUER DEN GANZEN HINWEIS. Der Regler steht in
   * dieser Lage bereits ganz links (er kann `min` nicht unterschreiten). Wer
   * ihn packt und auf `min` zieht, aendert seinen Wert NICHT — der Browser
   * loest dann gar kein `change`-Ereignis aus, und es wird nichts geschickt.
   * Der kuerzeste gedachte Weg zurueck beginnt also mit einem Griff, der
   * nichts tut. Ein Knopf tut etwas.
   */
  knopf: string
}

const OHNE: Klemmhinweis = { hinweis: false, satz: '', knopf: '' }

/**
 * Der Hinweis zur Klemmung — oder gar keiner.
 *
 * ZWEI GETRENNTE SAETZE FUER ZWEI LAGEN:
 *
 *   `prozentEcht === 0` — der Schirm gibt gar kein Licht mehr ab. Hier steht
 *      „schwarz" und nicht „dunkler", weil das der Zustand ist, in dem am
 *      Geraet niemand mehr etwas findet.
 *   0 < `prozentEcht` < `min` — noch Licht, aber weniger als dieser Regler je
 *      einstellen koennte. Die Zahl gehoert dazu, sonst klingt es nach
 *      Kleinigkeit.
 *
 * WOHER SO EIN ZUSTAND KOMMT, steht mit im Satz: die alte Oberflaeche bietet
 * weiterhin eine Stufe „0 %" an. Ohne diesen Halbsatz sucht der Betreiber den
 * Fehler in der neuen Verwaltung, die ihn gar nicht verursachen kann.
 */
export function klemmhinweis(lage: Klemmlage): Klemmhinweis {
  if (!lage?.geklemmt) return OHNE
  const echt = typeof lage.prozentEcht === 'number' ? lage.prozentEcht : null
  const min = typeof lage.min === 'number' ? lage.min : 20
  const woher =
    ' Ein so kleiner Wert kann nicht von hier stammen — die alte Verwaltungsseite bietet eine Stufe „0 %" an und schreibt sie direkt.'
  const zurueck =
    ' Der Regler steht schon ganz links und schickt nichts, wenn man ihn dorthin zieht: bitte den Knopf benutzen.'
  const satz =
    echt === 0
      ? `Der Bildschirm der Box ist gerade SCHWARZ — der Regler zeigt ${min} %, das Gerät steht aber auf 0 %.${woher}${zurueck}`
      : `Der Bildschirm ist dunkler, als der Regler zeigt: er steht auf ${echt ?? '?'} %, der Regler kann nicht unter ${min} %.${woher}${zurueck}`
  return { hinweis: true, satz, knopf: `Auf ${min} % stellen` }
}

/**
 * ══ DIE ZWEITE SORTE LUEGE: DIE ZAHL STIMMT, UND MAN SIEHT SIE TROTZDEM NICHT
 *
 * `klemmhinweis` oben faengt den Fall „die Anzeige liegt UEBER dem Geraet".
 * Es gibt zwei weitere Lagen, in denen die Zahl am Regler nichts darueber
 * sagt, was vor dem Kind steht — und in beiden ist die Zahl fuer sich genommen
 * richtig:
 *
 *   SCHIRM GANZ ABGESCHALTET (`bl_power` != 0). Das Hintergrundlicht steht
 *      auf 100 %, der Schirm ist schwarz. AM BILD GEMESSEN (08.08.2026,
 *      tools/schirm-regler-ansehen.mjs, Lage `d-schirm-aus`): der Regler stand
 *      ganz rechts, daneben „100 %", und darunter dieselbe graue Kleinschrift
 *      wie die immergleiche Beschreibung darueber. Wer die Seite ueberfliegt,
 *      sieht einen vollen Regler und liest den Satz nicht.
 *
 *   STAND UNBEKANNT (`prozent: null`). Der Server sagt ehrlich „ich konnte den
 *      Rohwert nicht lesen" — sysfs antwortet bei einem abgemeldeten Treiber
 *      mit EIO/ENODEV. GEMESSEN (Lage `f-unlesbar`): die Seite zeigte
 *      trotzdem „100 %" und einen vollen Regler. Diese 100 stand in keiner
 *      Antwort; sie ist die Vorbelegung des Signals, das mangels Zahl niemand
 *      ueberschrieben hat. Die Verwaltung erfand damit eine Auskunft, die das
 *      Backend ausdruecklich verweigert hatte.
 *
 * WARUM DAS HIER STEHT UND NICHT IN DER SEITE: derselbe Grund wie oben — so
 * ist der Satz ohne Angular pruefbar. Und warum es EINE Funktion ist, die eine
 * LISTE zurueckgibt: beide Lagen koennen zugleich gelten (Schirm aus UND
 * Rohwert unlesbar), und dann muessen beide Saetze dastehen. Eine Funktion mit
 * `else` haette den zweiten verschluckt.
 *
 * WAS HIER BEWUSST NICHT STEHT: EIN GRUND. Der Satz hiess frueher „…ganz
 * abgeschaltet (Zeitschaltung)". Die Seite WEISS das nicht: sie sieht nur
 * `bl_power` != 0, und dorthin kommt man ueber die Zeitschaltung, ueber
 * `mupi_check_monitor`, ueber ein fremdes Skript oder ueber den Treiber
 * selbst. (Ein eigener Server-Weg dafuer ist am 19.09.2026 gefallen — er
 * hatte keinen Rufer.) Ein erfundener Grund
 * schickt den Betreiber an die falsche Stellschraube — er sucht dann an
 * `timeout.idleDisplayOff` herum, waehrend die Ursache woanders liegt.
 */
export interface Schirmlage {
  /** Sagt der Server, dass das Hintergrundlicht ganz abgeschaltet ist? */
  schirmAus: boolean
  /** Kennt der Server den Rohwert? `false`, wenn er `prozent: null` schickte. */
  standBekannt: boolean
}

/** Aussagen ueber die JETZIGE Lage der Box — nie die immergleiche Beschreibung. */
export function lagesaetze(lage: Schirmlage): string[] {
  const saetze: string[] = []
  if (lage?.standBekannt === false) {
    saetze.push(
      'Die Box sagt nicht, worauf ihr Bildschirm steht — sie konnte den Wert des Hintergrundlichts nicht lesen. ' +
        'Die Zahl am Regler ist deshalb KEINE Auskunft über das Gerät, sondern nur der Wert, den ein Zug daran setzen würde.',
    )
  }
  if (lage?.schirmAus === true) {
    saetze.push(
      'Der Bildschirm der Box ist gerade ganz abgeschaltet — was der Regler zeigt, ist am Gerät nicht zu sehen. ' +
        'Die Einstellung wirkt, sobald er wieder angeht.',
    )
  }
  return saetze
}

/**
 * Was neben dem Regler steht. Pure.
 *
 * OHNE ZAHL, WENN ES KEINE GIBT. Ein Fragezeichen ist die einzige ehrliche
 * Antwort auf „worauf steht der Schirm?", wenn niemand es weiss — und es faellt
 * beim Ueberfliegen auf, was „100 %" gerade nicht tut.
 */
export function reglerAusgabe(prozent: number | null): string {
  return typeof prozent === 'number' ? `${prozent} %` : '? %'
}
