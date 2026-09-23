/**
 * Songtexte von LRCLIB — synchron, wenn es sicher passt, sonst gar nicht.
 *
 * Braucht die Rechte `songtext` (die Methode) und `netz` (kontext.holen).
 *
 * ══ DIE FALLE, GEGEN DIE DIESES PLUGIN GEBAUT IST ═══════════════════════════
 *
 * LRCLIB ist nutzerbefuellt und fuehrt dieselbe Nummer VIELFACH: Studio,
 * Single-Edit, Live-Mitschnitt, Bearbeitung. Jede Fassung traegt eigene,
 * fuer sich RICHTIGE Zeitmarken. Am 05.09.2026 gemessen
 * (tools/songtext-quellen-probe.py, je 20 Treffer):
 *
 *     Queen - Bohemian Rhapsody   14 Dauern, 263-415 s   Spanne 152 s
 *     Radiohead - Creep           12 Dauern, 236-311 s   Spanne  75 s
 *     Nena - 99 Luftballons       10 Dauern, 229-284 s   Spanne  55 s
 *
 * WER DEN ERSTEN TREFFER NIMMT, liefert einen Text, der Wort fuer Wort stimmt
 * und um bis zu zweieinhalb Minuten versetzt laeuft — der schlimmste
 * Fehlerfall, weil er wie ein Fehler der Zeitbasis aussieht und der naechste
 * Sucher dort dann auch sucht. Deshalb entscheidet hier die DAUER, und im
 * Zweifel kommt NICHTS.
 *
 * WARUM /api/search UND NICHT /api/get: `get` sieht nach dem strengeren Weg
 * aus und ist es nicht. Gemessen am selben Tag:
 *
 *     duration=239 (richtig)  -> 200      album falsch   -> 404
 *     duration=30  (absurd)   -> 200 (!)  track erfunden -> 404
 *     duration=600 (absurd)   -> 404
 *
 * Das ALBUM riegelt ab, die DAUER nicht zuverlaessig — wer sich auf den 404
 * verlaesst, bekommt still die falsche Fassung. Ausserdem verlangt `get` einen
 * Albumnamen, den die Box bei lokaler Wiedergabe oft gar nicht kennt.
 * `search` liefert bis zu 20 Kandidaten MIT ihren Dauern, und die Auswahl
 * treffen wir selbst.
 *
 * llmwiki: `lrclib-fuehrt-dieselbe-nummer-vielfach`
 */

const BASIS = 'https://lrclib.net'

/**
 * LRCLIB VERLANGT eine Kennung — nachzulesen in der API-Doku:
 * der Client soll sich mit Namen, Fassung und Verweis melden. Ohne sie ist die
 * Box ein anonymer Massenabrufer; mit ihr steht im Log des Betreibers, wer
 * fragt. Das ist Hoeflichkeit gegenueber einem Dienst, der nichts verlangt.
 */
const KENNUNG = 'mixpi-lrclib/0.1.0 (https://github.com/splitti/MuPiBox)'

/** Vorgabe, wenn nichts eingestellt ist — dieselbe Zahl wie im Manifest. */
export const SPIELRAUM_VORGABE = 5

/**
 * Eine LRC-Zeichenkette in Zeilen zerlegen. Rein.
 *
 * WIRFT WEG: Kopfzeilen wie [ar:…], [ti:…], [length:…]. Sie sehen aus wie
 * Zeitmarken und sind Angaben ueber das Stueck — ohne diese Pruefung stuenden
 * sie als Text bei Sekunde 0 auf dem Schirm.
 *
 * BEHAELT: leere Texte MIT Zeitmarke. Das sind die Pausen zwischen den
 * Strophen, und sie sind der Grund, warum die Anzeige zwischendurch leer wird,
 * statt die letzte Zeile stehen zu lassen.
 *
 * MEHRERE MARKEN AN EINER ZEILE sind im Format ueblich (Refrain) — daraus
 * werden mehrere Zeilen, nicht eine.
 */
export function lrcZerlegen(lrc) {
  if (!lrc || typeof lrc !== 'string') return []
  const zeilen = []

  for (const roh of lrc.split(/\r?\n/)) {
    const marken = []
    let rest = roh
    for (;;) {
      const treffer = /^\s*\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/.exec(rest)
      if (!treffer) break
      const bruchteil = treffer[3] ?? ''
      // Die LAENGE entscheidet, nicht die Zahl: "5" heisst 50 Hundertstel,
      // nicht 5 Millisekunden.
      const bruch =
        bruchteil === ''
          ? 0
          : bruchteil.length === 3
            ? Number(bruchteil)
            : Number(bruchteil.padEnd(2, '0')) * 10
      marken.push(Number(treffer[1]) * 60000 + Number(treffer[2]) * 1000 + bruch)
      rest = rest.slice(treffer[0].length)
    }
    if (!marken.length) continue
    const text = rest.trim()
    for (const zeitMs of marken) {
      if (Number.isFinite(zeitMs) && zeitMs >= 0) zeilen.push({ zeitMs, text })
    }
  }

  zeilen.sort((a, b) => a.zeitMs - b.zeitMs)
  return zeilen
}

/**
 * WELCHE der Fassungen gehoert zu dem, was laeuft? Rein — und die eigentliche
 * Arbeit dieses Plugins.
 *
 * Die Regeln, in dieser Reihenfolge:
 *   1. OHNE eigene Dauer wird NICHT gewaehlt. Ein Radio-Strom laesst sich
 *      nicht zuordnen, und genau dort waere der erste Treffer besonders
 *      verlockend und besonders falsch.
 *   2. Nur Treffer MIT Zeitmarken. Ein reiner Text ohne Marken ist fuer die
 *      synchrone Anzeige nichts wert.
 *   3. Es gewinnt die GERINGSTE Abweichung, nicht der erste Treffer.
 *   4. Liegt auch die beste weiter als der Spielraum daneben: NICHTS.
 */
export function auswaehlen(treffer, dauerSek, spielraum = SPIELRAUM_VORGABE) {
  if (!Array.isArray(treffer)) return null
  if (!Number.isFinite(dauerSek) || dauerSek <= 0) return null

  let besteSynchron = null
  let abweichungSynchron = Number.POSITIVE_INFINITY
  let besteEinfach = null
  let abweichungEinfach = Number.POSITIVE_INFINITY

  for (const t of treffer) {
    if (!t || t.instrumental) continue
    const dauer = Number(t.duration)
    if (!Number.isFinite(dauer) || dauer <= 0) continue
    const abweichung = Math.abs(dauer - dauerSek)
    // DER DAUER-RIEGEL GILT AUCH FUER UNSYNCHRONEN TEXT, und das ist keine
    // uebertriebene Vorsicht: bei „Bibi Blocksberg — Die neue Schule" hat
    // LRCLIB 20 Treffer, alle ohne Zeitmarken und alle mit dem Hoerspiel
    // NICHTS zu tun (gemessen 05.09.2026). Wer den Riegel nur fuer den
    // synchronen Weg setzt, zeigt beim Hoerspiel einen fremden Text —
    // ausgerechnet dort, wo am meisten schiefgehen kann.
    if (abweichung > spielraum) continue

    if (t.syncedLyrics) {
      if (abweichung < abweichungSynchron) {
        besteSynchron = t
        abweichungSynchron = abweichung
      }
    } else if (t.plainLyrics) {
      if (abweichung < abweichungEinfach) {
        besteEinfach = t
        abweichungEinfach = abweichung
      }
    }
  }

  // SYNCHRON SCHLAEGT UNSYNCHRON, immer — auch wenn der unsynchrone Treffer
  // naeher an der Dauer liegt. Mitlaufen ist mehr wert als eine Sekunde
  // Genauigkeit bei einer Laengenangabe, die ohnehin gerundet ist.
  return besteSynchron ?? besteEinfach
}

/**
 * Die Suchadresse. Rein, damit im Zeugen steht, WONACH gefragt wird —
 * und damit sichtbar bleibt, dass kein Album mitgeschickt wird.
 *
 * `artist_name` + `track_name` statt des freien `q`: die freie Suche mischt
 * beide Felder und liefert bei kurzen Titeln ("Männer") viel Fremdes.
 */
export function sucheAdresse(interpret, titel) {
  const p = new URLSearchParams({ artist_name: interpret, track_name: titel })
  return `${BASIS}/api/search?${p.toString()}`
}

export default {
  /**
   * Der Songtext zum laufenden Stueck.
   *
   * EINE EINZIGE ANFRAGE. Ein Plugin-Ruf hat 8 Sekunden (FRIST_MS im Wirt),
   * und wer sie reisst, wird abgeraeumt und neu gestartet. Zwei Anfragen
   * hintereinander waeren im Haengefall schon knapp.
   *
   * EINE LEERE LISTE IST DAS NORMALE ERGEBNIS, kein Fehlschlag: fuer
   * Hoerspiele findet sich nichts (gemessen 0 von 5), fuer deutsche
   * Kinderlieder oft auch nicht (3 von 5), bei Popmusik dagegen 5 von 5.
   * Geworfen wird nur, wenn die Frage wirklich nicht zu beantworten war.
   */
  async songtext({ interpret, titel, dauerSek }, kontext) {
    if (!kontext.holen) throw new Error('Dem Plugin fehlt das Recht "netz".')

    // OHNE INTERPRET ODER TITEL wird gar nicht erst gefragt. Ein leerer Name
    // trifft irgendetwas, und irgendetwas ist hier das Schlimmste.
    if (!interpret || !titel) return { zeilen: [] }

    // OHNE DAUER waere jede Wahl geraten — siehe auswaehlen(). Dann lieber
    // gar nicht erst das Netz bemuehen.
    if (!Number.isFinite(dauerSek) || dauerSek <= 0) {
      kontext.protokoll('ohne Dauer wird nicht gesucht — die Fassung waere geraten')
      return { zeilen: [] }
    }

    const spielraum = Number(kontext.einstellungen?.dauerSpielraum) || SPIELRAUM_VORGABE

    const antwort = await kontext.holen(sucheAdresse(interpret, titel), {
      headers: { 'User-Agent': KENNUNG },
    })
    if (!antwort.ok) {
      // 404 heisst hier "kenne ich nicht" und ist eine Auskunft, kein Fehler.
      if (antwort.status === 404) return { zeilen: [] }
      throw new Error(`LRCLIB antwortete mit ${antwort.status}`)
    }

    // .text() + JSON.parse statt .json(): der Pruefstand faelscht nur `text`,
    // und ein eigener Parse-Schritt sagt bei einer Fehlerseite, WAS ankam,
    // statt an einem nackten SyntaxError zu zerschellen.
    const rumpf = await antwort.text()
    let treffer
    try {
      treffer = JSON.parse(rumpf)
    } catch {
      throw new Error(`LRCLIB antwortete nicht mit JSON (${rumpf.slice(0, 80)})`)
    }

    const beste = auswaehlen(treffer, dauerSek, spielraum)
    if (!beste) {
      const anzahl = Array.isArray(treffer) ? treffer.length : 0
      kontext.protokoll(
        `${interpret} - ${titel}: ${anzahl} Treffer, keiner passt auf ${dauerSek} s (+/- ${spielraum} s)`,
      )
      return { zeilen: [] }
    }

    // UNSYNCHRON IST EIN EIGENES ERGEBNIS, kein halbes: `absaetze` statt
    // `zeilen`. Die Oberflaeche kann daraus nur eine Leseansicht bauen, und
    // genau das soll sie auch — ein Text ohne Marken, der so tut, als liefe er
    // mit, ist schlimmer als einer, der ehrlich stillsteht.
    if (!beste.syncedLyrics) {
      const absaetze = String(beste.plainLyrics || '')
        .split(/\r?\n/)
        .map((z) => z.trim())
      kontext.protokoll(
        `${interpret} - ${titel}: Fassung ${beste.duration} s gewaehlt, ${absaetze.length} Zeilen OHNE Zeitmarken`,
      )
      return { absaetze }
    }

    const zeilen = lrcZerlegen(beste.syncedLyrics)
    kontext.protokoll(
      `${interpret} - ${titel}: Fassung ${beste.duration} s gewaehlt, ${zeilen.length} Zeilen`,
    )
    return { zeilen }
  },

  /**
   * Was der Eltern-Bereich unter dem Namen zeigt.
   *
   * SAGT, WAS FEHLT, statt nur "ok" zu melden: ohne das Recht `netz` kann
   * dieses Plugin gar nichts, und das soll man lesen koennen, ohne in den
   * Quelltext zu sehen.
   */
  befinden(kontext) {
    if (!kontext.holen) return { ok: false, text: 'Ohne das Recht "netz" kann ich nichts holen.' }
    const spielraum = Number(kontext.einstellungen?.dauerSpielraum) || SPIELRAUM_VORGABE
    return {
      ok: true,
      text: `Bereit. Nur Fassungen, deren Laenge auf ${spielraum} s genau passt — sonst bleibt die Anzeige leer.`,
    }
  },
}
