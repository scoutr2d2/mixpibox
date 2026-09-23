/**
 * Deezer — die einzige Netzquelle, die fuer Kinderhoerspiele wirklich traegt.
 *
 * ══ GEMESSEN, NICHT ANGENOMMEN (06.09.2026, tools/similar-quellen-probe.py) ══
 *
 * Vier deutsche Kinderserien gegen zwei Popmusiker als Kontrolle:
 *
 *     Quelle          Kinderserien   Kontrolle
 *     MusicBrainz         4/4          2/2      (nur Identitaet, keine Aehnlichkeit)
 *     ListenBrainz        1/4          2/2
 *     Deezer /related     3/4          2/2
 *
 * Und die Treffer sind brauchbar, nicht nur vorhanden:
 *
 *     Pettersson und Findus → Benjamin Bluemchen, Die Fuchsbande, Pumuckl,
 *                             Astrid Lindgren Deutsch, Kati & Azuro
 *     Bibi Blocksberg       → Bibi und Tina, Deine Freunde,
 *                             Die Schule der magischen Tiere
 *
 * Deshalb steht Deezers Gewicht in der Vorgabe bei 1,0 und nicht bei den 0,7
 * des Entwurfs: die Begruendung fuer 0,7 war „liefert keinen Score", und das
 * stimmt — nur ist ein fehlender Score fuer RRF voellig gleichgueltig, weil
 * RRF ohnehin nur den Rang benutzt. Herabgestuft wurde damit die beste Quelle.
 *
 * ══ DIE FALLE: DER ERSTE TREFFER IST NICHT DER BESTE ══════════════════════
 *
 * Am selben Tag gemessen: `/search/artist?q=Conni` liefert 25 Treffer, und der
 * ERSTE ist „Conni & Co" (id 57582222) — eine Filmreihe mit 20 Alben und
 * `/related` = LEER. Die gesuchte Hoerspielserie heisst ebenfalls „Conni"
 * (id 75255), hat 95 Alben, 29 964 Anhaenger und 20 Aehnliche.
 *
 * Wer den ersten Treffer nimmt, bekommt eine leere Liste und haelt Deezer fuer
 * nutzlos. `nb_fan` und `nb_album` stehen im Suchergebnis schon drin — es
 * kostet keine zusaetzliche Anfrage, den richtigen zu waehlen.
 */

import { normalName } from '../normalisieren.mjs'

export const id = 'deezer'
export const name = 'Deezer'
export const brauchtZugang = false

/** Dokumentiert sind ~50 Anfragen / 5 s. Bewusst darunter geblieben. */
export const GRENZE = { menge: 40, fensterMs: 5000 }

const BASIS = 'https://api.deezer.com'

/**
 * Wie viel ein Suchtreffer taugt.
 *
 * NICHT „wie aehnlich ist der Name", sondern „ist das der Eintrag, hinter dem
 * der Katalog steht". Ein Interpret mit 95 Alben und 30 000 Anhaengern ist der
 * gesuchte; einer mit 20 Alben und keinem Anhaenger ist die Namensdublette.
 *
 * DER NAME BLEIBT DIE ERSTE BEDINGUNG — ohne sie gewaenne bei jeder Suche der
 * groesste Katalog, nicht der gesuchte Interpret. Die Zahlen entscheiden nur
 * noch UNTER den Namensgleichen.
 */
export function besterTreffer(daten, gesuchterName) {
  const liste = Array.isArray(daten?.data) ? daten.data : []
  if (liste.length === 0) return null
  const ziel = normalName(gesuchterName)

  const bewertet = liste.map((k) => {
    const n = normalName(k?.name)
    const genau = n === ziel
    // „Conni & Co" enthaelt „conni" — das ist ein Treffer zweiter Klasse und
    // darf einen genauen Treffer nie schlagen.
    const enthalten = !genau && (n.startsWith(`${ziel} `) || n.includes(ziel))
    return {
      k,
      genau,
      enthalten,
      anhaenger: Number(k?.nb_fan) || 0,
      alben: Number(k?.nb_album) || 0,
    }
  })

  const brauchbar = bewertet.filter((b) => b.genau || b.enthalten)
  if (brauchbar.length === 0) return null

  brauchbar.sort((a, b) => {
    if (a.genau !== b.genau) return a.genau ? -1 : 1
    if (b.anhaenger !== a.anhaenger) return b.anhaenger - a.anhaenger
    return b.alben - a.alben
  })
  return brauchbar[0].k
}

/** JSON holen und dabei Deezers eigene Fehlerform beachten. */
async function jsonHolen(adresse, umgebung) {
  if (!umgebung.holen) throw new Error('Dem Plugin fehlt das Recht "netz".')
  const darf = await umgebung.marke(id, GRENZE)
  if (!darf) throw new Error('Deezer-Takt ausgeschoepft — diesmal nicht gefragt.')

  const antwort = await umgebung.holen(adresse, { headers: { 'User-Agent': umgebung.nutzerKennung } })
  if (!antwort.ok) throw new Error(`Deezer antwortete mit ${antwort.status}`)
  const rumpf = await antwort.text()
  let daten
  try {
    daten = JSON.parse(rumpf)
  } catch {
    throw new Error(`Deezer antwortete nicht mit JSON (${rumpf.slice(0, 80)})`)
  }
  // DEEZER MELDET FEHLER MIT HTTP 200 UND EINEM `error`-FELD. Wer nur den
  // Status prueft, haelt eine Fehlermeldung fuer ein Ergebnis und traegt sie
  // als leere Liste in die Kartei — dort steht sie dann 30 Tage.
  if (daten?.error) throw new Error(`Deezer: ${daten.error.message ?? JSON.stringify(daten.error)}`)
  return daten
}

export default {
  id,
  name,
  brauchtZugang,
  grenze: GRENZE,

  async aufloesen(frage, umgebung) {
    const suche = `${BASIS}/search/artist?q=${encodeURIComponent(frage.name)}&limit=25`
    const daten = await jsonHolen(suche, umgebung)
    const treffer = besterTreffer(daten, frage.name)
    if (!treffer) return null
    return {
      quellenId: id,
      name: treffer.name,
      // DEEZER FUEHRT KEINE MBID. Das Feld bleibt leer, statt eine erfundene
      // Kennung zu tragen — der Wirt faellt dann auf den Namen zurueck.
      extra: { deezerId: treffer.id, anhaenger: treffer.nb_fan, alben: treffer.nb_album },
    }
  },

  /**
   * Die Aehnlichen — genau 20, ohne Score, nur in ihrer Reihenfolge.
   *
   * Das Fehlen des Scores ist kein Mangel: RRF benutzt ohnehin nur den Rang.
   */
  async aehnlich(ref, grenze, umgebung) {
    const deezerId = ref?.extra?.deezerId
    if (!deezerId) return []
    const daten = await jsonHolen(`${BASIS}/artist/${deezerId}/related?limit=${Math.min(50, grenze * 2)}`, umgebung)
    const liste = Array.isArray(daten?.data) ? daten.data : []
    return liste.slice(0, grenze).map((a, i) => ({
      name: a.name,
      rang: i + 1,
      extra: { deezerId: a.id, anhaenger: a.nb_fan },
    }))
  },

  /**
   * Veroeffentlichungen — fuer die Wachliste.
   *
   * DEEZER IST HIER DIE GENAUERE QUELLE: `release_date` ist taggenau (25 von
   * 25 in der Messung, auch bei Hoerspielen), waehrend MusicBrainz bei
   * Hoerspielen ueberwiegend nur das Jahr fuehrt (Bibi Blocksberg: 8 taggenau
   * gegen 15 nur Jahr). Wer nach dem MusicBrainz-Datum sortiert, sortiert
   * Rauschen.
   *
   * OHNE UPC, UND DAS IST ABSICHT: der UPC steht nicht in der Albenliste,
   * sondern nur an jedem einzelnen `/album/{id}`. Bei 290 Alben eines
   * Interpreten waeren das 290 zusaetzliche Anfragen fuer ein Feld, das nur
   * beim Zusammenlegen mit MusicBrainz hilft — die Dublettenpruefung kommt
   * ueber Titel und Jahr auch ohne ihn aus.
   */
  async veroeffentlichungen(ref, umgebung) {
    const deezerId = ref?.extra?.deezerId
    if (!deezerId) return []
    const daten = await jsonHolen(`${BASIS}/artist/${deezerId}/albums?limit=50`, umgebung)
    const liste = Array.isArray(daten?.data) ? daten.data : []
    return liste
      .filter((a) => a?.title && a?.release_date)
      .map((a) => ({
        titel: a.title,
        erschienen: a.release_date,
        quellenRef: `deezer:${a.id}`,
        adresse: a.link,
      }))
  },
}
