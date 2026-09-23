/**
 * MusicBrainz — Identitaet und Veroeffentlichungen, KEINE Aehnlichkeit.
 *
 * Diese Quelle hat absichtlich kein `aehnlich()`: MusicBrainz ist ein Katalog,
 * kein Empfehlungsdienst. Sie liefert die MBID, und die MBID ist der Schluessel,
 * an dem die anderen Quellen zusammenfinden — ohne sie stuende dieselbe Serie
 * unter vier Schreibweisen vier Mal im Ergebnis.
 *
 * ══ GEMESSEN (06.09.2026) ═════════════════════════════════════════════════
 *
 * Alle vier geprueften Kinderserien werden gefunden, mit `score` 100:
 * Pettersson und Findus, Bibi Blocksberg, Conni, Benjamin Bluemchen — als Typ
 * „Character"/„Other", Land DE. Als Resolver ist das die verlaesslichste
 * Quelle im Feld (4/4, wo ListenBrainz 1/4 schafft).
 *
 * Die TAGS taugen zur Einordnung („audio drama", „hoerspiel", „children"),
 * aber nicht zur Aehnlichkeit: die Zaehler liegen bei 1 bis 3. Das ist die
 * Handschrift einiger weniger Freiwilliger, kein Signal.
 *
 * ══ DIE FALLE: 503 IST NICHT „GIBT ES NICHT" ══════════════════════════════
 *
 * MusicBrainz drosselt AUCH DANN, wenn die eine Anfrage pro Sekunde
 * eingehalten wird — im Messlauf kamen 5 von 18 Anfragen als HTTP 503 zurueck
 * („exceeding the allowable rate limit"). Wer 503 als leeres Ergebnis liest,
 * streicht Serien, die da sind, und traegt das Nichts in die Kartei.
 *
 * Deshalb wirft diese Datei bei 503 ausdruecklich, statt `null` zu liefern:
 * ein Wurf landet in `meta.errors` und faellt auf den alten Karteieintrag
 * zurueck, ein `null` wuerde als „kenne ich nicht" gespeichert.
 */

export const id = 'musicbrainz'
export const name = 'MusicBrainz (Identitaet)'
export const brauchtZugang = false

/**
 * Die Regel des Dienstes ist 1 Anfrage/s. Hier steht sie als 1 je 1100 ms —
 * die 100 ms sind kein Aberglaube, sondern die Antwort auf die 503er oben:
 * die Uhr des Dienstes und die eigene laufen nie genau gleich.
 */
export const GRENZE = { menge: 1, fensterMs: 1100 }

const BASIS = 'https://musicbrainz.org/ws/2'

async function jsonHolen(adresse, umgebung) {
  if (!umgebung.holen) throw new Error('Dem Plugin fehlt das Recht "netz".')
  const darf = await umgebung.marke(id, GRENZE, 2000)
  if (!darf) throw new Error('MusicBrainz-Takt ausgeschoepft — diesmal nicht gefragt.')

  const antwort = await umgebung.holen(adresse, {
    // OHNE KENNUNG SPERRT MUSICBRAINZ. Das ist keine Hoeflichkeit, sondern
    // Bedingung der Nutzung.
    headers: { 'User-Agent': umgebung.nutzerKennung, Accept: 'application/json' },
  })
  if (antwort.status === 503) throw new Error('MusicBrainz drosselt gerade (503)')
  if (!antwort.ok) throw new Error(`MusicBrainz antwortete mit ${antwort.status}`)
  return JSON.parse(await antwort.text())
}

/**
 * Der beste Kandidat aus der Suche.
 *
 * DIE SCHWELLE IST DER PUNKT. MusicBrainz gibt zu jedem Treffer einen `score`
 * von 0 bis 100 und liefert IMMER etwas — auch zu einem Namen, den es nicht
 * kennt. Ohne Schwelle bekaeme „Das Pummeleinhorn" irgendeine Metalband mit
 * score 43 als Identitaet zugewiesen, und diese falsche MBID waere dann der
 * Schluessel, unter dem alle anderen Quellen zusammengefuehrt werden.
 */
export function bestenWaehlen(daten, mindestens = 85) {
  const liste = Array.isArray(daten?.artists) ? daten.artists : []
  const beste = liste.find((a) => Number(a?.score) >= mindestens)
  return beste ?? null
}

export default {
  id,
  name,
  brauchtZugang,
  grenze: GRENZE,

  async aufloesen(frage, umgebung) {
    if (frage.mbid) {
      return { quellenId: id, name: frage.name, mbid: frage.mbid }
    }
    const adresse = `${BASIS}/artist?query=${encodeURIComponent(frage.name)}&fmt=json&limit=10`
    const daten = await jsonHolen(adresse, umgebung)
    const beste = bestenWaehlen(daten)
    if (!beste) return null
    return { quellenId: id, name: beste.name, mbid: beste.id, extra: { typ: beste.type, land: beste.country } }
  },

  /**
   * KEIN `aehnlich` — siehe den Kopf. Der Verzeichnis-Scan kommt damit klar;
   * eine Quelle darf wenig koennen, das ist der Vertrag.
   */

  /**
   * Veroeffentlichungen als Release-Groups.
   *
   * DIE RELEASE-GROUP-MBID IST DER GRUND, warum diese Quelle bei der Wachliste
   * mitmacht, obwohl Deezer die genaueren Daten hat: sie ist der einzige
   * stabile Schluessel, an dem sich ein Deezer-Album und ein
   * MusicBrainz-Eintrag als DASSELBE Werk erkennen lassen.
   */
  async veroeffentlichungen(ref, umgebung) {
    if (!ref?.mbid) return []
    const adresse = `${BASIS}/release-group?artist=${ref.mbid}&fmt=json&limit=100`
    const daten = await jsonHolen(adresse, umgebung)
    const liste = Array.isArray(daten?.['release-groups']) ? daten['release-groups'] : []
    return liste
      .filter((g) => g?.title)
      .map((g) => ({
        titel: g.title,
        // OFT NUR EIN JAHR ("2024"), und das bleibt hier auch so stehen.
        // Ein auf "2024-01-01" aufgefuelltes Datum saehe taggenau aus und
        // waere erfunden — und die Wachliste entschiede danach, ob etwas neu
        // ist.
        erschienen: g['first-release-date'] ?? null,
        gruppeMbid: g.id,
        quellenRef: `mb:${g.id}`,
      }))
  },
}
