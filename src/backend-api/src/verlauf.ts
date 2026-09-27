/**
 * DER MITSCHNITT — was wann wie lange und ueber welchen Dienst lief.
 *
 * Betreiber (15.08.2026): „ja dann richten wir den mitschnitt jetzt ein ich
 * würde auch gerne welchen dienst wie lange", dazu „ohne profil auswahl für
 * alle profile".
 *
 * ══ WARUM ES DEN MITSCHNITT BRAUCHT ═══════════════════════════════════════
 *
 * `gespielt.json` merkt sich je Werk nur ZWEI Zahlen: wie oft gestartet und
 * wann zuletzt. Damit laesst sich „oft gehoert" bauen und sonst nichts. Die
 * Frage „was lief gestern nachmittag, und wie lange" kann es nicht
 * beantworten — nicht weil die Daten schwer zu bekommen waeren, sondern weil
 * sie NIE GESCHRIEBEN wurden. Rueckwirkend gibt es sie nicht; der Mitschnitt
 * faengt an dem Tag an, an dem er eingeschaltet wird.
 *
 * ══ WIE DIE DAUER GEMESSEN WIRD, UND WARUM NICHT MIT DER WANDUHR ══════════
 *
 * Nicht „Startzeit bis Stoppzeit". Eine Box, die um 15:00 startet und um
 * 19:00 stumm in der Ecke steht, weil das Kind weggelaufen ist, haette sonst
 * vier Stunden Hoerzeit — und die Statistik behauptete etwas, das nie
 * stattgefunden hat.
 *
 * Stattdessen zaehlt der HERZSCHLAG. Die Oberflaeche meldet im Takt, WAS
 * gerade laeuft. Solange die Meldungen kommen, laeuft es; bleiben sie aus, ist
 * Schluss. Die Dauer ist die Summe der Abstaende zwischen zwei Schlaegen —
 * also gemessene Zeit und keine geschaetzte.
 *
 * DER TAKT IST 60 SEKUNDEN, NICHT ZWEI. Hier stand bis zum 20.08.2026 „alle
 * 2 s", und das war nie wahr: der Sender ist `stelleMerken()` in
 * NewDesign/app.js mit `TAKT_MERKEN = 60000`. Auf der falschen Annahme standen
 * beide Konstanten unten, und der Verlauf zaehlte dadurch ein Sechstel der
 * echten Hoerzeit (E74). Die Zahl steht jetzt als `SENDETAKT_MS` da, damit die
 * naechste Aenderung sie nicht wieder uebersieht.
 *
 * DIE LUECKE IST DER SCHLUSS: bleibt der Herzschlag laenger als
 * `LUECKE_MS` aus, gilt die Sitzung als beendet. Der naechste Schlag beginnt
 * eine neue. So kostet ein Aussetzer des Netzes hoechstens eine geteilte
 * Zeile, nie eine erfundene Stunde.
 *
 * KEIN EINZELNER SCHLAG WIRD VOLL GEZAEHLT: der Abstand wird bei
 * `SCHLAG_MAX_MS` gekappt. Sonst schriebe ein Schlag um 15:00 und der
 * naechste um 15:04 (weil das Netz hing) vier Minuten Hoerzeit gut, obwohl
 * dazwischen niemand etwas gehoert hat.
 */

/** Ein abgeschlossener Hoervorgang. Was hier steht, ist gemessen. */
export interface Sitzung {
  /** Beginn in ms seit 1970. */
  beginn: number
  /** Letzter Herzschlag in ms seit 1970. */
  ende: number
  /** Gemessene Hoerzeit in Sekunden (Summe der gekappten Abstaende). */
  sekunden: number
  /** Werkschluessel — dieselbe Form wie ueberall (`medienSchluessel`). */
  key: string
  /** Der Dienst: `spotify`, `ard`, `jellyfin`, `lokal` … */
  dienst: string
  titel?: string
  artist?: string
}

/** Eine noch laufende Sitzung — dasselbe, aber ohne festen Schluss. */
export type OffeneSitzung = Sitzung

/**
 * WIE OFT DIE OBERFLAECHE WIRKLICH MELDET — die Zahl, von der die beiden
 * darunter abhaengen.
 *
 * SIE STEHT HIER, WEIL SIE HIER GEBRAUCHT WIRD, aber sie gehoert nicht diesem
 * Modul: gesetzt wird sie als `TAKT_MERKEN` in NewDesign/app.js. Wer sie dort
 * aendert, muss hier nachziehen — `verlauf.spec.ts` misst das nach und faellt
 * sonst.
 *
 * ══ WARUM DAS EINE EIGENE KONSTANTE IST (E74, 20.08.2026) ═════════════════
 *
 * Bis heute stand hier keine, und der Kopfkommentar dieses Moduls behauptete
 * einen Takt von ZWEI Sekunden. Den gab es nie. Der Sender ist
 * `stelleMerken()` — eine „merk dir meine Stelle"-Meldung mit 60-Sekunden-Takt
 * (begruendet mit dem Verschleiss der SD-Karte) und einer Fuenf-Minuten-Sperre
 * gegen unveraenderte Staende.
 *
 * FOLGE DER FALSCHEN ANNAHME: `LUECKE_MS` stand auf 30 s und war damit KUERZER
 * als der Sendetakt. Jede Meldung begann eine neue Sitzung, jede zaehlte
 * gekappt 10 s — der Verlauf schrieb zehn Sekunden pro Minute Hoerzeit auf.
 * Eine Stunde Hoeren wurde zu zehn Minuten, und weil das plausibel aussah,
 * fiel es ueber Wochen niemandem auf.
 *
 * Wer sich an einen fremden Aufruf haengt, erbt DESSEN Takt — nicht den, den
 * er sich vorstellt. Deshalb steht er jetzt als Zahl da und nicht als Satz.
 */
export const SENDETAKT_MS = 60_000

/**
 * Ohne Meldung laenger als das gilt die Sitzung als beendet.
 *
 * ANDERTHALB SENDETAKTE. Eine ausgefallene Meldung soll die Sitzung noch nicht
 * zerschneiden; zwei ausgefallene sind Stille. Kuerzer als der Sendetakt darf
 * es NIE sein — dann beginnt jede Meldung eine neue Sitzung, und genau das war
 * der Fehler von E74.
 */
export const LUECKE_MS = SENDETAKT_MS * 1.5

/**
 * So viel darf EIN Abstand hoechstens gutschreiben.
 *
 * GENAU EIN SENDETAKT. Weniger waere Unterschlagung: der normale Abstand
 * zwischen zwei Meldungen IST der Sendetakt, und er wurde wirklich gehoert.
 * Mehr waere Erfindung.
 *
 * DER PREIS IST DERSELBE, DEN DER SENDETAKT SCHON ABGEWOGEN HAT: Ein hartes
 * Ausschalten mitten im Titel schreibt jetzt hoechstens 60 s gut, die nicht
 * gehoert wurden — vorher 10 s. Der Kommentar bei `TAKT_MERKEN` hat diesen
 * Tausch bereits bewusst gemacht („kostet hoechstens 60 s statt 15 s
 * Hoerfortschritt"); hier gilt er aus demselben Grund.
 */
export const SCHLAG_MAX_MS = SENDETAKT_MS

/** So viele Sitzungen werden je Profil behalten. */
export const MAX_SITZUNGEN = 2000

/** Kuerzer als das wird gar nicht erst aufgeschrieben. */
export const MIN_SEKUNDEN = 5

/**
 * Den Dienst aus einem Werkschluessel lesen. Pure.
 *
 * Der Schluessel hat die Form `dienst:kennung` (`ard:10378841`,
 * `spotify:2hp3…`). Was keinen Doppelpunkt hat oder einen unbekannten Kopf
 * traegt, heisst `sonstige` — geraten wird nicht.
 */
export function dienstAus(key: unknown): string {
  const s = String(key ?? '')
  const i = s.indexOf(':')
  if (i < 1) return 'sonstige'
  const kopf = s.slice(0, i).toLowerCase()
  return /^[a-z][a-z0-9_-]{1,20}$/.test(kopf) ? kopf : 'sonstige'
}

/**
 * Einen Herzschlag verarbeiten. PURE — die Uhr kommt als Argument herein.
 *
 * Gibt zurueck, was danach offen ist und was (falls etwas) abgeschlossen
 * wurde. Der Aufrufer schreibt das Abgeschlossene weg; diese Funktion weiss
 * nichts von Dateien.
 *
 * @param offen   die bisher laufende Sitzung, oder null
 * @param schlag  was gerade laeuft
 * @param jetzt   ms seit 1970
 */
export function schlagVerarbeiten(
  offen: OffeneSitzung | null,
  schlag: { key: string; titel?: string; artist?: string },
  jetzt: number,
): { offen: OffeneSitzung | null; fertig: Sitzung | null } {
  const key = String(schlag?.key ?? '').trim()
  if (!key || !Number.isFinite(jetzt)) return { offen, fertig: null }

  const neueSitzung = (): OffeneSitzung => ({
    beginn: jetzt,
    ende: jetzt,
    sekunden: 0,
    key,
    dienst: dienstAus(key),
    ...(schlag.titel ? { titel: String(schlag.titel).slice(0, 200) } : {}),
    ...(schlag.artist ? { artist: String(schlag.artist).slice(0, 200) } : {}),
  })

  if (!offen) return { offen: neueSitzung(), fertig: null }

  const abstand = jetzt - offen.ende
  // EINE UHR, DIE ZURUECKSPRINGT, darf die Zeit nicht negativ machen (auf der
  // Box stellt sich die Uhr nach dem Start per NTP — das ist ein echter Fall).
  if (abstand < 0) return { offen: { ...offen, ende: jetzt }, fertig: null }

  const gewechselt = offen.key !== key
  if (gewechselt || abstand > LUECKE_MS) {
    return { offen: neueSitzung(), fertig: abschliessen(offen) }
  }

  return {
    offen: {
      ...offen,
      ende: jetzt,
      sekunden: offen.sekunden + Math.min(abstand, SCHLAG_MAX_MS) / 1000,
    },
    fertig: null,
  }
}

/**
 * Eine offene Sitzung schliessen — beim Stillstand oder beim Herunterfahren.
 *
 * Zu kurze fallen weg: wer durch die Kacheln blaettert, erzeugt sonst eine
 * Zeile je angetipptem Werk, und der Verlauf besteht aus Fehlgriffen.
 */
export function abschliessen(offen: OffeneSitzung | null): Sitzung | null {
  if (!offen) return null
  const s = Math.round(offen.sekunden)
  if (s < MIN_SEKUNDEN) return null
  return { ...offen, sekunden: s }
}

/** Eine Sitzung anhaengen und die Liste deckeln. Pure. */
export function anhaengen(bisher: readonly Sitzung[], neu: Sitzung | null): Sitzung[] {
  if (!neu) return bisher as Sitzung[]
  const liste = [...bisher, neu]
  // Die ALTEN fallen weg, nicht die neuen — ein Verlauf, der vorne abschneidet,
  // waere ein Verlauf ohne Gegenwart.
  return liste.length > MAX_SITZUNGEN ? liste.slice(liste.length - MAX_SITZUNGEN) : liste
}

/**
 * Je Dienst zusammenzaehlen. Pure.
 *
 * `von`/`bis` sind ms seit 1970; wer nichts angibt, bekommt alles. Eine
 * Sitzung zaehlt zu dem Zeitraum, in dem sie BEGONNEN hat — sonst muesste
 * eine Sitzung ueber Mitternacht geteilt werden, und dafuer ist die Frage
 * „welcher Dienst wie lange" zu grob.
 */
export function nachDienst(
  sitzungen: readonly Sitzung[],
  von = -Infinity,
  bis = Infinity,
): { dienst: string; sekunden: number; anzahl: number }[] {
  const summe = new Map<string, { sekunden: number; anzahl: number }>()
  for (const s of sitzungen) {
    if (!s || s.beginn < von || s.beginn > bis) continue
    const d = s.dienst || 'sonstige'
    const alt = summe.get(d) ?? { sekunden: 0, anzahl: 0 }
    summe.set(d, { sekunden: alt.sekunden + (Number(s.sekunden) || 0), anzahl: alt.anzahl + 1 })
  }
  return [...summe.entries()]
    .map(([dienst, w]) => ({ dienst, ...w }))
    .sort((a, b) => b.sekunden - a.sekunden)
}

/** Je Tag zusammenzaehlen (oertliche Zeit). Pure — der Tag kommt als Formatierer. */
export function nachTag(
  sitzungen: readonly Sitzung[],
  tagVon: (ms: number) => string,
): { tag: string; sekunden: number; anzahl: number }[] {
  const summe = new Map<string, { sekunden: number; anzahl: number }>()
  for (const s of sitzungen) {
    if (!s) continue
    const t = tagVon(s.beginn)
    const alt = summe.get(t) ?? { sekunden: 0, anzahl: 0 }
    summe.set(t, { sekunden: alt.sekunden + (Number(s.sekunden) || 0), anzahl: alt.anzahl + 1 })
  }
  return [...summe.entries()].map(([tag, w]) => ({ tag, ...w })).sort((a, b) => (a.tag < b.tag ? 1 : -1))
}

/** Was von der Platte kommt, ist erst einmal Verdacht. Pure. */
export function verlaufNormalisieren(roh: unknown): Sitzung[] {
  const liste = Array.isArray(roh) ? roh : []
  const raus: Sitzung[] = []
  for (const e of liste) {
    const o = e as Partial<Sitzung>
    const beginn = Number(o?.beginn)
    const sekunden = Number(o?.sekunden)
    const key = String(o?.key ?? '').trim()
    if (!key || !Number.isFinite(beginn) || !Number.isFinite(sekunden) || sekunden < 0) continue
    const ende = Number.isFinite(Number(o?.ende)) ? Number(o.ende) : beginn
    raus.push({
      beginn,
      ende,
      sekunden: Math.round(sekunden),
      key,
      dienst: String(o?.dienst || dienstAus(key)),
      ...(o?.titel ? { titel: String(o.titel).slice(0, 200) } : {}),
      ...(o?.artist ? { artist: String(o.artist).slice(0, 200) } : {}),
    })
    if (raus.length >= MAX_SITZUNGEN) break
  }
  return raus
}
