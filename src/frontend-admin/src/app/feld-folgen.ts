/**
 * Was ein kleiner Wert BEDEUTET — ausgerechnet und hingeschrieben.
 *
 * ══ WOZU ═══════════════════════════════════════════════════════════════════
 *
 * Zwei Felder dieser Verwaltung nehmen Zahlen an, deren kleine Werte die Box
 * unbrauchbar machen — und beide stehen auf KEINER Oberflaeche der Box selbst.
 * Wer sie verstellt und danach vor der Box sitzt, findet dort nichts, womit er
 * es zuruecknehmen koennte:
 *
 *   „Ausschalten nach … Minuten Nichtstun" = 1
 *      Die Box schaltet sich eine Minute nach der letzten Beruehrung ab. Wer
 *      das nicht wollte, muss es von einem zweiten Geraet aus zuruecknehmen —
 *      im Wettlauf mit einem Zaehler, der schon laeuft.
 *
 *   „Hoechste Lautstaerke" = 1
 *      Die Box ist praktisch stumm und wirkt kaputt. Der Regler am Bildschirm
 *      der Box bietet nichts darueber an.
 *
 * DIE ZAHL SELBST IST NICHT VERBOTEN. Jemand kann sie wollen; es ist seine
 * Box. Was fehlte, war die FOLGE: nirgends stand, was aus „1" wird. Ein Feld,
 * aus dem man nicht zurueckkommt, muss das wenigstens sagen.
 *
 * ══ WARUM EINE EIGENE, REINE DATEI ═════════════════════════════════════════
 *
 * Dieselbe Begruendung wie bei schirm-text.ts und funk-text.ts nebenan: der
 * SATZ ist hier die Loesung, nicht ein Beiwerk der Loesung. Also muss er
 * pruefbar sein, ohne die Seite zu starten.
 *
 * ══ WO DIE WAHRHEIT WIRKLICH WOHNT ═════════════════════════════════════════
 *
 * NICHT HIER. Diese Datei rechnet nur vor, was die ausfuehrenden Skripte tun:
 *
 *   scripts/mupibox/idle_shutdown.sh   zaehlt und schaltet ab (STARTKARENZ)
 *   scripts/mupibox/mupi-lautstaerke.sh klemmt jede Lautstaerke (BODEN)
 *
 * Dort gehoert der Schutz hin und nicht in ein Eingabefeld: die Route
 * `/api/konfiguration` steht ohne Anmeldung offen, die alte PHP-Verwaltung
 * schreibt weiter direkt, und die Datei laesst sich von Hand aendern. Eine
 * Grenze in der Oberflaeche waere genau die, an der man vorbeikommt.
 *
 * Damit hier keine ZWEITE Wahrheit entsteht, sind die beiden Zahlen unten
 * benannt exportiert — und die Proben
 *   tools/lautstaerke-boden-probe.sh
 *   tools/leerlauf-uhr-nachspielen.sh
 * vergleichen sie gegen die Vorgabe im jeweiligen Skript. Laufen sie
 * auseinander, wird die Probe rot, nicht der Betreiber ueberrascht.
 *
 * ══ UND WARUM DIE SAETZE DIESE ZAHLEN TROTZDEM NICHT BEHAUPTEN ═════════════
 *
 * Die Proben oben vergleichen die Verwaltung mit den Skripten IM BAUM. Auf der
 * Box liegen aber nicht die Skripte aus dem Baum, sondern die, die zuletzt
 * jemand dorthin gebracht hat — und bis zum 08.08.2026 gab es dafuer ueberhaupt
 * keinen Weg ausser einer neuen Karte oder einem vollen Update.
 *
 * AM 08.08.2026 GEMESSEN, an der Box im Wohnzimmer:
 *   /usr/local/bin/mupibox/mupi-lautstaerke.sh:129   [ "$h" -lt 1 ] && h=100
 *   /usr/local/bin/mupibox/idle_shutdown.sh          45 Zeilen, kein STARTKARENZ
 * Also: KEIN Boden, sondern ein Rueckfall auf 100 — wer „Hoechste Lautstaerke"
 * auf 0 stellt, WEIL er die Box still haben will, bekommt die LAUTESTE
 * moegliche Box. Und keine Startkarenz. Die Verwaltung sagte an dieser Stelle
 * „die Box regelt nicht unter 10 %" und „erst 120 Sekunden spaeter" — beides
 * war auf DIESER Box falsch, und beim Gehoerschutz war es das Gegenteil.
 *
 * EINE ZAHL ZU NENNEN, DIE NICHT GILT, IST SCHLECHTER ALS KEINE. Besonders
 * bei einer, die „Gehoerschutz fuer Kinderohren" heisst: sie klingt wie eine
 * Zusage. Die Saetze unten nennen deshalb BEIDE moeglichen Ausgaenge und sagen
 * dazu, dass von hier aus nicht zu sehen ist, welcher gilt. Die Zahlen bleiben
 * exportiert — sie sind weiter die Vorgabe aus den Skripten im Baum, und die
 * Proben brauchen sie — aber sie treten nicht mehr als Auskunft ueber die Box
 * auf.
 *
 * WAS DAS AUFLOEST (und dann gehoert dieser Abschnitt zurueckgebaut):
 *   1. `tools/ausliefern.py --nur scripts` auf die Box laufen lassen. Danach
 *      liegen die Fassungen aus dem Baum dort, und beide Zahlen GELTEN.
 *   2. Erst dann darf hier wieder EINE Zahl stehen — und auch dann besser
 *      eine, die die Box selbst meldet, statt einer, die diese Datei glaubt.
 */

/**
 * Sekunden nach dem Start, in denen idle_shutdown.sh noch nicht zaehlt —
 * in der Fassung IM BAUM. Ob sie auf einer bestimmten Box gilt, weiss diese
 * Datei nicht (siehe Kopf).
 */
export const STARTKARENZ_SEKUNDEN = 120

/**
 * Unter diesen Prozent regelt mupi-lautstaerke.sh nicht — in der Fassung IM
 * BAUM. Aeltere Fassungen auf der Box machen aus einem Wert unter 1 statt
 * dessen 100 %. Siehe Kopf.
 */
export const LAUTSTAERKE_BODEN = 10

export interface Folge {
  /** Steht ueberhaupt etwas da? */
  hinweis: boolean
  /**
   * `ruhig`  — nur ausgerechnet, damit man die Folge sieht.
   * `warnen` — der Wert fuehrt in eine Lage, aus der es am Geraet keinen Weg
   *            zurueck gibt.
   */
  schwere: 'ruhig' | 'warnen'
  satz: string
}

const OHNE: Folge = { hinweis: false, schwere: 'ruhig', satz: '' }

/** Nur echte, ganze, nicht-negative Zahlen — alles andere ist keine Aussage wert. */
function zahl(wert: unknown): number | null {
  const n = Number.parseInt(String(wert ?? '').trim(), 10)
  return Number.isFinite(n) ? n : null
}

/**
 * ══ „Ausschalten nach … Minuten Nichtstun"
 *
 * DER SATZ NENNT SEKUNDEN, weil „1 Minute" harmlos aussieht und „60 Sekunden
 * nach dem letzten Antippen" nicht. Genau darum geht es: die Folge sichtbar
 * machen, nicht die Eingabe verbieten.
 *
 * ER NENNT AUCH, WAS MITZAEHLT. Bis zum 07.08.2026 zaehlte idle_shutdown.sh
 * ausschliesslich „es laeuft keine Wiedergabe" — ein Kind, das durch die
 * Kacheln blaetterte, wurde mitten im Suchen abgeschaltet. Seitdem zaehlt die
 * Beruehrung mit. Wer den Satz liest, muss wissen, welche der beiden Fassungen
 * auf seiner Box laeuft; deshalb steht „Beruehrung" ausdruecklich darin.
 *
 * UND ER NENNT DEN WEG ZURUECK — beziehungsweise dass es ihn an der Box nicht
 * gibt. Das ist die eigentliche Auskunft.
 */
export function ausschaltFolge(wert: unknown): Folge {
  const minuten = zahl(wert)
  if (minuten === null) return OHNE
  if (minuten <= 0) {
    return {
      hinweis: true,
      schwere: 'ruhig',
      satz: 'Die Box schaltet sich nicht von allein aus.',
    }
  }
  const sekunden = minuten * 60
  // DIE STARTKARENZ WIRD NICHT MEHR ZUGESAGT, sondern als das genannt, was sie
  // ist: eine Eigenschaft der Fassung auf der Box. Auf dieser Box lag am
  // 08.08.2026 eine idle_shutdown.sh ohne jede Karenz — der Satz haette dort
  // eine Schonfrist versprochen, die es nicht gab.
  const grundsatz =
    `Die Box schaltet sich ${sekunden} Sekunden nach der letzten Berührung ` +
    'und dem Ende der Wiedergabe ab. Ob diese Frist nach dem Einschalten erst ' +
    `später beginnt, hängt von der Fassung auf der Box ab: die aktuelle wartet ` +
    `${STARTKARENZ_SEKUNDEN} Sekunden, ältere zählen sofort los — dann kann die ` +
    'Box ausgehen, bevor jemand sie überhaupt bedienen konnte.'
  // Ab wann gewarnt wird: bei 3 Minuten und weniger ist die Frist kuerzer als
  // eine Folge Vorlesen, ein Windelwechsel oder ein Gang zur Tuer. Das ist
  // keine Grenze im Feld — man darf es einstellen — nur der Punkt, ab dem der
  // Satz laut wird.
  if (minuten > 3) return { hinweis: true, schwere: 'ruhig', satz: grundsatz }
  return {
    hinweis: true,
    schwere: 'warnen',
    satz:
      `${grundsatz} Dieses Feld steht auf KEINER Oberfläche der Box selbst — ` +
      'zurückstellen lässt es sich nur von hier aus, also von einem zweiten Gerät im Netz.',
  }
}

/**
 * ══ „Hoechste Lautstaerke"
 *
 * HIER STAND EINE ZUSAGE, DIE AUF DIESER BOX NICHT GALT — und zwar mit dem
 * Vorzeichen verkehrt herum. Der Satz lautete: „die Box regelt nicht unter
 * 10 %, sonst waere sie von einer kaputten Box nicht zu unterscheiden."
 * Gemessen am 08.08.2026 stand in `/usr/local/bin/mupibox/mupi-lautstaerke.sh`
 * Zeile 129 aber `[ "$h" -lt 1 ] && h=100`: kein Boden, sondern ein RUECKFALL.
 * Wer 0 eintraegt, WEIL er die Box still haben will, bekommt die LAUTESTE
 * moegliche Box — direkt an Kinderohren, unter einer Beschriftung, die
 * „Gehoerschutz fuer Kinderohren" heisst.
 *
 * Ein Helligkeitsregler auf 20 % bei schwarzem Schirm ist aergerlich. Eine
 * Lautstaerke-Zusage, die ins Gegenteil kippt, ist etwas anderes.
 *
 * DER SATZ NENNT DESHALB BEIDE AUSGAENGE und sagt dazu, dass von hier aus
 * nicht zu sehen ist, welcher gilt. Er nennt weiter ausdruecklich die 0 — sie
 * ist der Wert, den dieses Feld anbietet und den jemand fuer „stumm" haelt.
 *
 * UND ER SAGT JETZT DOCH, WAS ZU TUN IST. Frueher stand hier: „bitte hoeher
 * stellen" gehoert nicht hinein, ein Gehoerschutz darf niedrig sein. Das gilt
 * fuer eine Box, die den Boden HAT — dort ist ein kleiner Wert eine leise Box.
 * Solange er fehlen kann, ist ein kleiner Wert keine leise Box, sondern ein
 * Muenzwurf mit zwei sehr verschiedenen Seiten. Davor zu warnen ist keine
 * Bevormundung, sondern die Auskunft selbst.
 *
 * SOBALD scripts/ ausgeliefert IST (tools/ausliefern.py --nur scripts), darf
 * hier wieder EINE Zahl stehen. Vorher nicht.
 */
export function lautstaerkeFolge(wert: unknown): Folge {
  const prozent = zahl(wert)
  if (prozent === null) return OHNE
  if (prozent >= LAUTSTAERKE_BODEN) return OHNE
  const wasSteht = prozent <= 0 ? '0 % bedeutet nicht stumm' : `${prozent} % ist nicht einfach leise`
  return {
    hinweis: true,
    schwere: 'warnen',
    satz:
      `${wasSteht}: was hier steht, ist bei kleinen Werten nicht das, was am ` +
      `Lautsprecher ankommt. Auf einer Box mit der aktuellen Fassung gelten ` +
      `mindestens ${LAUTSTAERKE_BODEN} %. Auf einer Box, die sie noch nicht hat, ` +
      `wird aus einem Wert unter 1 die VOLLE Lautstärke — das Gegenteil. Welche ` +
      `der beiden läuft, ist von hier aus nicht zu sehen; solange das so ist, ist ` +
      `ein Wert unter ${LAUTSTAERKE_BODEN} % keine leise Box, sondern ein Risiko. ` +
      'Auch dieses Feld steht auf KEINER Oberfläche der Box selbst — leiser geht ' +
      'nur über die Datei auf der Box.',
  }
}

/**
 * Die Folge zu einem Feld dieser Seite — oder gar keine.
 *
 * ÜBER DIE KENNUNG und nicht ueber den Titel: die Kennung kommt vom Server
 * (konfiguration.ts, `id`) und aendert sich nicht, wenn jemand die Beschriftung
 * umformuliert.
 */
export function feldFolge(id: string, wert: unknown): Folge {
  switch (id) {
    case 'ausschaltenNach':
      return ausschaltFolge(wert)
    case 'maxLautstaerke':
      return lautstaerkeFolge(wert)
    default:
      return OHNE
  }
}
