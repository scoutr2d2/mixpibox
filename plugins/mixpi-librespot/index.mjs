/**
 * LIBRESPOT — das Gesicht der freien Spotify-Tonmaschine (E82).
 *
 * ══ WAS DIESES PLUGIN IST UND WAS NICHT ════════════════════════════════════
 *
 * Es ist die AUSKUNFT: laeuft die Maschine, ist sie gewaehlt, mit welcher
 * Bitrate spielt sie. Der HEBEL — spotify.engine schreiben, Units neu
 * starten — bleibt im Kern (PUT /api/spotify/maschine): die Zusicherung
 * „genau eine Maschine laeuft, der Rueckweg ist immer frei" haengt an den
 * ExecConditions der Units, und die kann ein Plugin nur behaupten, nicht
 * tragen. Dieses Plugin abschalten nimmt also nie den Ton — nur die
 * Auskunftsflaeche.
 *
 * ══ WOHER DIE FAKTEN KOMMEN ════════════════════════════════════════════════
 *
 *   kontext.konfig.maschine   {engine, hatSchluessel} — vom Kern BERECHNET
 *                             (nie der Schluessel selbst). Aendert sich die
 *                             Wahl, startet der Wirt dieses Plugin neu.
 *   kontext.geraet            benannte, lesende Blicke (Recht `geraetestand`):
 *                             dienstZustand('librespot.service') und
 *                             lesen('librespot-umgebung') fuer die Bitrate —
 *                             GELESEN, nicht behauptet (die feste „160" in
 *                             der alten Karte stimmte nur zufaellig).
 *
 * KURZ GEMERKT (2,5 s): die Engine-Karte der Verwaltung fragt im 3-s-Takt,
 * und die Steckleiste fragt zusaetzlich — ohne Merker liefe je Seitenbesuch
 * dieselbe systemctl-Kette mehrfach.
 *
 * KEINE ABHAENGIGKEITEN, wie bei jedem Plugin dieses Hauses.
 */

const MERK_MS = 2500
let merk = null

/** Test-Naht: den Merker leeren, damit Zeugen frisch messen. */
export function zwischenspeicherLeeren() {
  merk = null
}

function gewaehlt(kontext) {
  return String(kontext.konfig?.maschine?.engine ?? 'librespot') !== 'soloist'
}

async function standErheben(kontext) {
  if (merk && merk.bis > Date.now()) return merk.stand
  const g = kontext.geraet
  if (!g) return { dienst: 'unbekannt', bitrate: null }
  const dienst = await g.dienstZustand('librespot.service')
  // Bitrate aus der Unit-Umgebung — dieselbe Zeile, die die Unit selbst
  // sourct. Fehlt die Datei, ist „unbekannt" die ehrliche Antwort.
  const umgebung = await g.lesen('librespot-umgebung')
  const m = umgebung ? /^\s*export\s+LIBRESPOT_BITRATE\s*=\s*"?(\d+)"?/m.exec(umgebung) : null
  const stand = { dienst, bitrate: m ? Number(m[1]) : null }
  merk = { stand, bis: Date.now() + MERK_MS }
  return stand
}

function satzAus(kontext, stand) {
  const wahl = gewaehlt(kontext) ? 'Gewählte Maschine' : 'Nicht gewählt (Soloist spielt)'
  const dienst =
    stand.dienst === 'laeuft'
      ? 'läuft'
      : stand.dienst === 'steht'
        ? 'steht'
        : stand.dienst === 'gescheitert'
          ? 'ist gescheitert'
          : stand.dienst === 'wechselt'
            ? 'startet gerade'
            : 'Zustand unbekannt'
  const ton = stand.bitrate ? `Ton mit ${stand.bitrate} kbps` : 'Bitrate unbekannt'
  return `${wahl} — Dienst ${dienst}, ${ton}.`
}

export default {
  async befinden(kontext) {
    if (!kontext.geraet) {
      return { ok: false, text: 'Das Recht `geraetestand` fehlt — kein Blick auf die Maschine.' }
    }
    const stand = await standErheben(kontext)
    // ok heisst: die Lage ist in Ordnung. Eine NICHT gewaehlte Maschine, die
    // steht, ist genau richtig so — erst „gewaehlt und laeuft nicht" ist rot.
    const ok = gewaehlt(kontext) ? stand.dienst === 'laeuft' : stand.dienst !== 'gescheitert'
    return { ok, text: satzAus(kontext, stand) }
  },

  async aktion(kennung, kontext) {
    if (kennung !== 'pruefen') return { ok: false, text: `Unbekannte Aktion "${kennung}".` }
    if (!kontext.geraet) return { ok: false, text: 'Das Recht `geraetestand` fehlt.' }
    merk = null // eine ausdrueckliche Pruefung misst frisch
    const stand = await standErheben(kontext)
    return { ok: true, text: satzAus(kontext, stand) }
  },

  /** `stand` — die strukturierte Auskunft fuer die Engine-Karte des Kerns. */
  async http(anfrage, kontext) {
    if (anfrage.methode !== 'GET') return { status: 405, inhalt: { fehler: 'nur GET' } }
    if (anfrage.pfad !== 'stand') return { status: 404, inhalt: { fehler: `kein Pfad "${anfrage.pfad}"` } }
    const stand = await standErheben(kontext)
    return { inhalt: { ...stand, gewaehlt: gewaehlt(kontext) } }
  },
}
