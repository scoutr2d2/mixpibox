/**
 * Aus n Ranglisten eine machen — Reciprocal Rank Fusion.
 *
 *     score(a) = Σ_q  w_q · 1 / (k + rang_q(a))
 *
 * ══ WARUM NICHT DIE SCORES DER QUELLEN ADDIERT WERDEN ═════════════════════
 *
 * Weil sie nicht dieselbe Sprache sprechen. Gemessen an den Antwortformen:
 * Last.fm liefert `match` als 0..1 mit 1,0 fuer den ersten Treffer und einem
 * steilen Abfall; ListenBrainz liefert eine eigene, unbegrenzte Zaehlskala;
 * Deezer liefert GAR KEINEN Score, nur eine Reihenfolge. Wer diese Zahlen
 * addiert, addiert Aepfel, Birnen und eine leere Menge — und die Quelle mit
 * den groessten Zahlen gewinnt jede Abstimmung, unabhaengig davon, wie gut sie
 * ist.
 *
 * RRF benutzt nur den RANG. Damit ist jede Quelle gleich laut, und wie laut
 * sie sein SOLL, entscheidet allein `w_q` — eine Zahl, die der Betreiber
 * einstellt und versteht. Das ist der ganze Grund fuer die Wahl.
 *
 * ══ WAS k TUT ═════════════════════════════════════════════════════════════
 *
 * `k` daempft die Spitze. Bei k=60 ist der Abstand zwischen Rang 1 und Rang 2
 * winzig (1/61 gegen 1/62), zwischen Rang 1 und Rang 20 immer noch klein.
 * Das ist Absicht: es bedeutet, dass ZWEI Quellen auf Rang 10 mehr wiegen als
 * EINE Quelle auf Rang 1. Genau das will man hier — Uebereinstimmung mehrerer
 * Quellen ist das Signal, nicht die Ueberzeugung einer einzelnen.
 *
 * Wer k klein macht (k=1), dreht das um: dann gewinnt der erste Treffer der
 * lautesten Quelle. Das ist eine gueltige Einstellung und meistens die
 * falsche.
 */

/** Die uebliche Wahl aus der Literatur, und die Vorgabe im Manifest. */
export const K_VORGABE = 60

/**
 * Mehrere Ranglisten zu einer verschmelzen.
 *
 * `listen` ist ein Objekt `{ quellenId: [{ schluessel, name, mbid? }, …] }`,
 * jede Liste bereits in ihrer eigenen Reihenfolge (Rang 1 zuerst).
 * `gewichte` ist `{ quellenId: zahl }`; eine Quelle mit Gewicht 0 oder ohne
 * Eintrag traegt nichts bei.
 *
 * Zurueck kommt eine absteigend sortierte Liste mit `quellen: { id: rang }` —
 * die Herkunft REIST MIT, sie wird nicht nachtraeglich rekonstruiert. Ohne sie
 * ist ein Ergebnis nicht zu beurteilen: "warum steht das da?" ist die erste
 * Frage, die jemand stellt, und sie muss ohne einen zweiten Lauf zu
 * beantworten sein.
 */
export function verschmelzen(listen, gewichte = {}, { k = K_VORGABE, mindestensQuellen = 1, grenze = 20 } = {}) {
  const kZahl = Number.isFinite(k) && k > 0 ? k : K_VORGABE
  const gesammelt = new Map()

  for (const [quelle, liste] of Object.entries(listen ?? {})) {
    const gewicht = Number(gewichte[quelle])
    // GEWICHT 0 HEISST AUS. Das ist derselbe Schalter wie `enabled` — zwei
    // Felder fuer "aus" und "wie laut" waeren zwei Wege, dasselbe zu sagen,
    // und irgendwann steht `enabled: true, weight: 0` da und niemand weiss,
    // was gilt.
    if (!Number.isFinite(gewicht) || gewicht <= 0) continue
    if (!Array.isArray(liste)) continue

    // DOPPELTE INNERHALB EINER QUELLE zaehlen einmal, mit ihrem BESTEN Rang.
    // Deezer liefert unter zwei IDs denselben Namen, wenn ein Interpret dort
    // zweimal angelegt ist; ohne diese Sperre bekaeme er von einer einzigen
    // Quelle zwei Stimmen.
    const gesehen = new Set()

    liste.forEach((treffer, i) => {
      if (!treffer || !treffer.schluessel) return
      if (gesehen.has(treffer.schluessel)) return
      gesehen.add(treffer.schluessel)

      const rang = i + 1
      let eintrag = gesammelt.get(treffer.schluessel)
      if (!eintrag) {
        eintrag = {
          schluessel: treffer.schluessel,
          name: treffer.name,
          mbid: treffer.mbid,
          unaufgeloest: !treffer.mbid,
          punkte: 0,
          quellen: {},
        }
        gesammelt.set(treffer.schluessel, eintrag)
      }
      // EINE MBID, DIE SPAETER KOMMT, GEWINNT. Deezer nennt den Namen zuerst,
      // MusicBrainz liefert die Identitaet nach — wer den ersten Fund
      // festhaelt, wirft die bessere Auskunft weg.
      if (!eintrag.mbid && treffer.mbid) {
        eintrag.mbid = treffer.mbid
        eintrag.unaufgeloest = false
      }
      eintrag.quellen[quelle] = rang
      eintrag.punkte += gewicht * (1 / (kZahl + rang))
    })
  }

  const schwelle = Number.isFinite(mindestensQuellen) && mindestensQuellen > 0 ? mindestensQuellen : 1

  return [...gesammelt.values()]
    .filter((e) => Object.keys(e.quellen).length >= schwelle)
    .sort((a, b) => {
      if (b.punkte !== a.punkte) return b.punkte - a.punkte
      // GLEICHSTAND BRAUCHT EINE ZWEITE REGEL, sonst haengt die Reihenfolge an
      // der Einfuegereihenfolge der Map — und die haengt daran, welche Quelle
      // zufaellig zuerst geantwortet hat. Dasselbe Ergebnis muss zweimal
      // gleich aussehen, sonst ist jeder Zeuge darueber ein Wackelkandidat.
      const qa = Object.keys(a.quellen).length
      const qb = Object.keys(b.quellen).length
      if (qb !== qa) return qb - qa
      return String(a.name).localeCompare(String(b.name), 'de')
    })
    .slice(0, Number.isFinite(grenze) && grenze > 0 ? grenze : 20)
}
