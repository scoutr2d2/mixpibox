/**
 * SOLOIST — das Gesicht des offiziellen Spotify-Clients der Box (E82).
 *
 * ══ WAS DIESES PLUGIN IST UND WAS NICHT ════════════════════════════════════
 *
 * Die AUSKUNFT: laeuft der Dienst, wie alt ist der Build (90-Tage-Verfall!),
 * ist die Box bei Spotify angemeldet, liegt eine Updater-Warnung. Der HEBEL
 * (spotify.engine, Unit-Neustarts, Schluessel-Annahme) bleibt im Kern —
 * siehe den Kopf von mixpi-librespot, dieselbe Begruendung. Abschalten
 * nimmt die Auskunft, nie den Ton.
 *
 * ══ DIE UMGEZOGENEN REGELN ═════════════════════════════════════════════════
 *
 *   VERFALL   Ein Soloist-Build traegt 90 Tage AB BAU-DATUM, dann verweigert
 *             ihn Spotify. Das Datum steht in der `-V`-Zeile in Klammern:
 *             `soloist 1.3.7.385 build 1787153493 (20260819) (…)`. Diese
 *             Rechnung wohnte bis E82 in src/backend-api/spotify-maschine.ts
 *             und ist MIT ihren Zeugen hierher gezogen (nicht kopiert).
 *   ANMELDUNG `soloist ctl status` sagt woertlich "logged in: yes/no" — und
 *             wird NUR gefragt, wenn der Dienst laeuft; direkt nach einem
 *             Start fehlt die Anmeldung bis zu ~1 min (llmwiki), das ist
 *             „noch nicht", kein Fehler.
 *   SCHLUESSEL Der spak_ selbst kommt hier NIE an: kontext.konfig.maschine
 *             traegt nur hatSchluessel (Boolean). Was dieses Plugin ausgibt,
 *             kann keinen Schluessel verraten, den es nie sah.
 *
 * KURZ GEMERKT (2,5 s) — die Engine-Karte pollt im 3-s-Takt, solange die
 * Anmeldung fehlt; genau dann laeuft hier sonst je Takt eine Befehlskette.
 *
 * KEINE ABHAENGIGKEITEN, wie bei jedem Plugin dieses Hauses.
 */

/** Wie viele Tage ein Soloist-Build ab BAU-Datum traegt. Von Spotify gesetzt. */
const VERFALL_TAGE = 90

const MERK_MS = 2500
let merk = null

/** Test-Naht: den Merker leeren, damit Zeugen frisch messen. */
export function zwischenspeicherLeeren() {
  merk = null
}

/** Das Bau-Datum aus der `-V`-Zeile — die Klammer mit dem Datum, nicht die Build-Nummer. */
export function bauDatumAus(vZeile) {
  const m = /\((20\d{6})\)/.exec(String(vZeile ?? ''))
  return m ? m[1] : null
}

/** Alter in Tagen und Resttage bis zum Verfall. `null`, wenn nichts zu rechnen ist. */
export function verfallAus(bauDatum, heute) {
  if (!bauDatum || !/^20\d{6}$/.test(bauDatum)) return null
  const gebaut = Date.UTC(Number(bauDatum.slice(0, 4)), Number(bauDatum.slice(4, 6)) - 1, Number(bauDatum.slice(6, 8)))
  if (!Number.isFinite(gebaut)) return null
  const alterTage = Math.floor((heute.getTime() - gebaut) / 86_400_000)
  if (alterTage < 0) return null
  return { alterTage, verfallInTagen: Math.max(0, VERFALL_TAGE - alterTage) }
}

function gewaehlt(kontext) {
  return String(kontext.konfig?.maschine?.engine ?? 'librespot') === 'soloist'
}

function hatSchluessel(kontext) {
  return Boolean(kontext.konfig?.maschine?.hatSchluessel)
}

async function standErheben(kontext) {
  if (merk && merk.bis > Date.now()) return merk.stand
  const g = kontext.geraet
  if (!g) {
    return { dienst: 'unbekannt', build: null, alterTage: null, verfallInTagen: null, warnung: null, anmeldung: null }
  }
  const dienst = await g.dienstZustand('soloist.service')
  // Das Binary kann fehlen (Installation ist Sache von einrichten.sh) —
  // dann bleibt alles ehrlich null.
  const fassung = await g.ausfuehren('soloist-fassung')
  const build = fassung.ok ? (fassung.text.split('\n', 1)[0] ?? null) : null
  const verfall = verfallAus(bauDatumAus(build), new Date())
  const warnung = ((await g.lesen('soloist-warnung')) ?? '').trim() || null
  // NUR BEI LAUFENDEM DIENST fragen — sonst ist die Antwort keine Auskunft.
  let anmeldung = null
  if (dienst === 'laeuft') {
    const a = await g.ausfuehren('soloist-anmeldung')
    anmeldung = /logged in:\s*yes/i.test(a.text) ? 'ja' : /logged in:\s*no/i.test(a.text) ? 'nein' : 'unbekannt'
  }
  const stand = {
    dienst,
    build,
    alterTage: verfall?.alterTage ?? null,
    verfallInTagen: verfall?.verfallInTagen ?? null,
    warnung,
    anmeldung,
  }
  merk = { stand, bis: Date.now() + MERK_MS }
  return stand
}

function satzAus(kontext, stand) {
  if (gewaehlt(kontext)) {
    if (!hatSchluessel(kontext)) return 'Gewählt, aber KEIN Soloist-Schlüssel hinterlegt — die Box bleibt stumm.'
    const dienst =
      stand.dienst === 'laeuft' ? 'läuft' : stand.dienst === 'wechselt' ? 'startet gerade' : `Dienst: ${stand.dienst}`
    const anmeldung =
      stand.anmeldung === 'ja'
        ? 'angemeldet'
        : stand.anmeldung === 'nein'
          ? 'NICHT angemeldet (einmal aus der Spotify-App verbinden)'
          : 'Anmeldung unbekannt'
    const rest = stand.verfallInTagen !== null ? `, Build noch ${stand.verfallInTagen} Tage gültig` : ''
    return `Gewählte Maschine — ${dienst}, ${anmeldung}${rest}.`
  }
  const rest = stand.verfallInTagen !== null ? ` Build noch ${stand.verfallInTagen} Tage gültig.` : ''
  return `Nicht gewählt (librespot spielt).${rest}`
}

export default {
  async befinden(kontext) {
    if (!kontext.geraet) {
      return { ok: false, text: 'Das Recht `geraetestand` fehlt — kein Blick auf die Maschine.' }
    }
    const stand = await standErheben(kontext)
    // Rot ist: gewaehlt und nicht spielfaehig (Dienst steht, Schluessel
    // fehlt, Anmeldung fehlt) ODER eine Updater-Warnung liegt an.
    const ok = gewaehlt(kontext)
      ? hatSchluessel(kontext) && stand.dienst === 'laeuft' && stand.anmeldung === 'ja' && !stand.warnung
      : stand.dienst !== 'gescheitert' && !stand.warnung
    return { ok, text: stand.warnung ? `${satzAus(kontext, stand)} — ${stand.warnung}` : satzAus(kontext, stand) }
  },

  async aktion(kennung, kontext) {
    if (kennung !== 'pruefen') return { ok: false, text: `Unbekannte Aktion "${kennung}".` }
    if (!kontext.geraet) return { ok: false, text: 'Das Recht `geraetestand` fehlt.' }
    merk = null // eine ausdrueckliche Pruefung misst frisch
    const stand = await standErheben(kontext)
    const build = stand.build ? ` (${stand.build})` : ''
    return { ok: true, text: `${satzAus(kontext, stand)}${build}` }
  },

  /** `stand` — die strukturierte Auskunft fuer die Engine-Karte des Kerns. */
  async http(anfrage, kontext) {
    if (anfrage.methode !== 'GET') return { status: 405, inhalt: { fehler: 'nur GET' } }
    if (anfrage.pfad !== 'stand') return { status: 404, inhalt: { fehler: `kein Pfad "${anfrage.pfad}"` } }
    const stand = await standErheben(kontext)
    return { inhalt: { ...stand, gewaehlt: gewaehlt(kontext), hatSchluessel: hatSchluessel(kontext) } }
  },
}
