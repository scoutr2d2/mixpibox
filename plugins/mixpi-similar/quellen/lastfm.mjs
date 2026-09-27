/**
 * Last.fm — die einzige Quelle hier, die einen Zugangsschluessel braucht.
 *
 * ══ WAS OHNE SCHLUESSEL PASSIERT (gemessen 06.09.2026) ════════════════════
 *
 *     ohne `api_key`        HTTP 400, error 6
 *     erfundener Schluessel HTTP 403, error 10
 *
 * Beides sind saubere Fehler, keine leeren Listen — deshalb ist der Fall
 * „Gewicht steht auf 1, aber es liegt kein Schluessel vor" hier ausdruecklich
 * abgefangen und wird in Worte gefasst, statt bei jeder Anfrage einen 400 zu
 * kassieren. Ohne diese Zeile ist die haeufigste stille Fehlkonfiguration
 * dieses Plugins nicht zu sehen: eine Quelle, die eingeschaltet ist, nie
 * antwortet, und in keiner Fehlerliste auftaucht, weil sie ja „laeuft".
 *
 * ══ ZUM SCORE ═════════════════════════════════════════════════════════════
 *
 * `match` ist laut Doku echt 0..1, und eine MBID kommt oft (nicht immer) mit.
 * Verwendet wird von beidem nur die MBID: der `match`-Wert geht in die Fusion
 * nicht ein, weil RRF nur Raenge kennt — siehe `fusion.mjs`, dort steht,
 * warum das die bessere Wahl ist.
 *
 * NICHT AM ECHTEN DIENST GEMESSEN. Fuer Last.fm braucht es ein Konto, und
 * eines anzulegen war nicht Teil dieser Arbeit. Diese Datei folgt der Doku;
 * wer einen Schluessel eintraegt, ist der Erste, der sie wirklich fahren
 * laesst. Der Zeuge daneben faehrt sie gegen eine aufgezeichnete Antwort.
 */

export const id = 'lastfm'
export const name = 'Last.fm'
export const brauchtZugang = true

export const GRENZE = { menge: 5, fensterMs: 1000 }

const BASIS = 'https://ws.audioscrobbler.com/2.0/'

function adresseBauen(methode, felder, schluessel) {
  const p = new URLSearchParams({ method: methode, api_key: schluessel, format: 'json', ...felder })
  return `${BASIS}?${p.toString()}`
}

async function jsonHolen(adresse, umgebung) {
  const darf = await umgebung.marke(id, GRENZE)
  if (!darf) throw new Error('Last.fm-Takt ausgeschoepft — diesmal nicht gefragt.')

  const antwort = await umgebung.holen(adresse, { headers: { 'User-Agent': umgebung.nutzerKennung } })
  const rumpf = await antwort.text()
  let daten
  try {
    daten = JSON.parse(rumpf)
  } catch {
    throw new Error(`Last.fm antwortete nicht mit JSON (${rumpf.slice(0, 80)})`)
  }
  // LAST.FM MELDET FEHLER IM RUMPF, teils mit HTTP 200. `error 10` heisst
  // „Schluessel ungueltig" und ist die Auskunft, die der Betreiber braucht —
  // sie muss woertlich durchkommen.
  if (daten?.error) throw new Error(`Last.fm: ${daten.message ?? `Fehler ${daten.error}`}`)
  if (!antwort.ok) throw new Error(`Last.fm antwortete mit ${antwort.status}`)
  return daten
}

export default {
  id,
  name,
  brauchtZugang,
  grenze: GRENZE,

  async aufloesen(frage, umgebung) {
    const schluessel = umgebung.lastfmSchluessel
    if (!schluessel) {
      // KEIN WURF, SONDERN NICHTS. Ein Wurf stuende in `meta.errors` und
      // saehe aus wie eine Stoerung des Dienstes; ein fehlender Schluessel ist
      // aber keine Stoerung, sondern eine Einstellung. Sichtbar wird er
      // stattdessen in `/http/quellen` als `fehlt`.
      umgebung.protokoll?.('Last.fm ist gewichtet, aber es liegt kein Schluessel vor.')
      return null
    }
    if (!umgebung.holen) throw new Error('Dem Plugin fehlt das Recht "netz".')

    if (frage.mbid) return { quellenId: id, name: frage.name, mbid: frage.mbid }

    const daten = await jsonHolen(adresseBauen('artist.getinfo', { artist: frage.name, autocorrect: '1' }, schluessel), umgebung)
    const gefunden = daten?.artist
    if (!gefunden?.name) return null
    return { quellenId: id, name: gefunden.name, mbid: gefunden.mbid || undefined }
  },

  async aehnlich(ref, grenze, umgebung) {
    const schluessel = umgebung.lastfmSchluessel
    if (!schluessel) return []

    const felder = ref.mbid ? { mbid: ref.mbid } : { artist: ref.name, autocorrect: '1' }
    const daten = await jsonHolen(
      adresseBauen('artist.getsimilar', { ...felder, limit: String(Math.max(1, grenze)) }, schluessel),
      umgebung,
    )

    const liste = daten?.similarartists?.artist
    // EIN EINZELNER TREFFER KOMMT ALS OBJEKT, nicht als Liste — eine
    // Eigenheit der Last.fm-JSON-Ausgabe, die aus ihrer XML-Herkunft stammt.
    // Ohne diese Zeile wirft `.map` genau dann, wenn es einen Treffer gibt.
    const alsListe = Array.isArray(liste) ? liste : liste ? [liste] : []

    return alsListe
      .filter((a) => a?.name)
      .slice(0, grenze)
      .map((a, i) => ({ name: a.name, mbid: a.mbid || undefined, rang: i + 1 }))
  },
}
