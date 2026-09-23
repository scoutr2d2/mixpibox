/**
 * ListenBrainz — Hoerdaten, und fuer diesen Anwendungsfall die schwaechste
 * Quelle im Feld. Sie ist deshalb in der Vorgabe niedrig gewichtet, nicht aus.
 *
 * ══ WAS GEMESSEN WURDE (06.09.2026) ═══════════════════════════════════════
 *
 * Der Endpunkt LEBT — die Kontrolle mit Popmusik liefert je 100 Treffer. Fuer
 * deutsche Kinderhoerspiele liefert er fast nichts:
 *
 *     Pettersson und Findus     0 Treffer
 *     Bibi Blocksberg           0 Treffer (bei vier von fuenf Algorithmen)
 *     Conni                     0 Treffer
 *     Benjamin Bluemchen        2 Treffer: „Simone Sommerland…" und RAMMSTEIN
 *
 * DER ZWEITE TREFFER IST DER GRUND FUER DIE NIEDRIGE VORGABE. Hoerdaten
 * messen, wer dasselbe hoert — und wer abends Kinderhoerspiele auflegt, hoert
 * nachts etwas anderes. Auf einer Box, vor der ein Kind sitzt, ist das keine
 * schwache Empfehlung, sondern eine falsche. Wer diese Quelle hochdreht,
 * sollte `mindestensQuellen` auf 2 stellen, damit ein Vorschlag wenigstens
 * eine zweite Stimme braucht.
 *
 * ══ DIE FALLE: OHNE `algorithm` GIBT ES KEINE ANTWORT ═════════════════════
 *
 * Roh durchprobiert, alle am selben Tag:
 *
 *     …/similar-artists/json?artist_mbids=<MBID>&algorithm=<ALG>   200
 *     dasselbe mit artist_mbid (Einzahl)                           400
 *     dasselbe OHNE algorithm                                      400
 *     …/similar-artists  (ohne /json)                              Zeitablauf
 *     api.listenbrainz.org/1/similar-artists                       404
 *
 * Beide Parameter sind Pflicht, die Mehrzahl-Form ist die richtige, und der
 * Fehler kommt als HTML zurueck, nicht als JSON — ein `.json()` darauf stirbt
 * an einem SyntaxError, der nichts ueber die Ursache sagt.
 *
 * UND: der Algorithmusname entscheidet ueber leer oder nicht. Bibi Blocksberg
 * liefert mit vier Algorithmen null Treffer und mit dem fuenften genau einen
 * sinnvollen (Benjamin Bluemchen). Wer nur einen probiert, haelt „leer" fuer
 * eine Eigenschaft des Dienstes statt fuer eine Eigenschaft seiner Anfrage.
 */

export const id = 'listenbrainz'
export const name = 'ListenBrainz (Hoerdaten)'
export const brauchtZugang = false

/**
 * DIESE QUELLE KANN NUR MIT MBID — sie hat keine Namenssuche.
 *
 * Das Merkmal steht hier und nicht im Wirt, damit der Wirt nicht wissen muss,
 * welche Quelle was braucht. Er fragt: „braucht ueberhaupt jemand eine
 * MBID?" — und laesst die Aufloesung sonst ganz weg. Das spart bei
 * abgeschalteter ListenBrainz-Quelle eine MusicBrainz-Anfrage JE FRAGE, und
 * die kostet bei 1 Anfrage/s eine ganze Sekunde von acht.
 */
export const brauchtMbid = true

/** Keine dokumentierte Grenze; hoeflich gedrosselt. */
export const GRENZE = { menge: 5, fensterMs: 2000 }

const BASIS = 'https://labs.api.listenbrainz.org/similar-artists/json'

/**
 * Die Algorithmen in der Reihenfolge, in der sie probiert werden.
 *
 * DER ZWEITE IST DER, DER BEI KINDERHOERSPIELEN ETWAS FAND. Er steht trotzdem
 * nicht an erster Stelle: der erste ist der breitere und liefert bei allem
 * anderen mehr. Probiert wird der Reihe nach, bis einer etwas sagt — mehr als
 * zwei Anfragen erlaubt die Frist nicht, deshalb ist die Liste kurz und nicht
 * vollstaendig.
 */
/**
 * DER NAME MUSS VOLLSTAENDIG SEIN, BIS AUF DAS LETZTE STUECK. Am Dienst
 * nachgestellt (06.09.2026), dreimal dieselbe MBID:
 *
 *     …_threshold_10_limit_100_filter_True_skip_30   200
 *     …_threshold_15_limit_50_skip_30                200
 *     …_threshold_10_limit_100                       400
 *
 * Der dritte ist der zweite mit abgeschnittenem Ende — und er ist nicht etwa
 * eine gueltige Kurzform, sondern schlicht kein Algorithmus. Es gibt hier
 * keine Vorgabe und keine Ergaenzung: was nicht Zeichen fuer Zeichen stimmt,
 * ist ein 400. Genau daran ist die erste Fassung dieser Datei gescheitert,
 * und der Fehler sah aus wie ein toter Dienst.
 */
export const ALGORITHMEN = [
  'session_based_days_7500_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30',
  'session_based_days_9000_session_300_contribution_5_threshold_15_limit_50_skip_30',
]

export default {
  id,
  name,
  brauchtZugang,
  grenze: GRENZE,

  /**
   * ListenBrainz kennt NUR MBIDs — es gibt hier keine eigene Namenssuche.
   * Ohne MBID aus der Aufloesung ist diese Quelle stumm, und das ist richtig
   * so: eine geratene MBID waere eine falsche Identitaet.
   */
  async aufloesen(frage) {
    if (!frage?.mbid) return null
    return { quellenId: id, name: frage.name, mbid: frage.mbid }
  },

  async aehnlich(ref, grenze, umgebung) {
    if (!ref?.mbid) return []
    if (!umgebung.holen) throw new Error('Dem Plugin fehlt das Recht "netz".')

    for (const algorithmus of ALGORITHMEN) {
      const darf = await umgebung.marke(id, GRENZE)
      if (!darf) break

      const adresse = `${BASIS}?artist_mbids=${encodeURIComponent(ref.mbid)}&algorithm=${encodeURIComponent(algorithmus)}`
      const antwort = await umgebung.holen(adresse, {
        headers: { 'User-Agent': umgebung.nutzerKennung, Accept: 'application/json' },
      })
      if (!antwort.ok) {
        // DER FEHLER IST HTML. Ihn zu parsen waere sinnlos; der Status ist die
        // ganze Auskunft.
        umgebung.protokoll?.(`ListenBrainz: ${antwort.status} bei ${algorithmus.slice(0, 30)}…`)
        continue
      }

      let daten
      try {
        daten = JSON.parse(await antwort.text())
      } catch {
        umgebung.protokoll?.('ListenBrainz antwortete nicht mit JSON.')
        continue
      }

      const treffer = trefferLesen(daten, ref.mbid)
      if (treffer.length > 0) {
        return treffer.slice(0, grenze).map((t, i) => ({ ...t, rang: i + 1 }))
      }
    }
    return []
  },
}

/**
 * Die Antwort auslesen — und den Interpreten selbst herauswerfen.
 *
 * DASS ER MITGELIEFERT WIRD, IST GEMESSEN: „Nena" steht in der Antwort zu
 * Nena mit dem hoechsten Wert (453), unter einer anderen MBID (die Person
 * statt der Band). Ohne diesen Filter stuende in der Empfehlung zu einer Serie
 * an erster Stelle dieselbe Serie.
 *
 * DER `score` WIRD NICHT WEITERGEREICHT, und das ist Absicht: er ist ein roher
 * Zaehler ohne Obergrenze (Nena 60–453, Benjamin Bluemchen 19–20) und
 * zwischen zwei Interpreten nicht vergleichbar. Die Reihenfolge traegt die
 * ganze Auskunft, und mehr braucht RRF nicht.
 */
export function trefferLesen(daten, eigeneMbid) {
  const liste = Array.isArray(daten) ? daten : Array.isArray(daten?.data) ? daten.data : []
  return liste
    .filter((a) => a?.name && a?.artist_mbid !== eigeneMbid)
    .map((a) => ({ name: a.name, mbid: a.artist_mbid }))
}
