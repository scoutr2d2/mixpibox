/**
 * DIE TITEL-KARTE EINES WERKS — abgeleitet, nicht dupliziert (E108).
 *
 * Betreiber (31.08.2026): „Der titel ist das kleinste teil nicht das album …
 * ein titel kann im album schon lokal vorliegen der nächste muss dann ggf
 * über einen anderen dienst geholt werden." Diese Datei beantwortet die
 * Frage „welcher Titel liegt WO vor" ohne eine vierte Wahrheit anzulegen:
 *
 *   - Die PLATTE weiss, was lokal liegt. Identitaet ueber Quellen hinweg ist
 *     die TITELNUMMER: die Aufnahme legt Spuren als `NN <Titel>.<endung>` ab
 *     (mixpi-mitschnitt, `spurname`), und die NN stammt aus der Quell-Liste
 *     des Meta-Albums — sie IST dieselbe Zaehlung wie `titel[].nr` in
 *     /inhalt. Der Name dient nur als GEGENPROBE (die Sanitisierung `/`->`_`
 *     der Aufnahme macht ihn unscharf).
 *   - GELESEN WIRD DAS VERZEICHNIS, NICHT DIE playlist.m3u: am Geraet
 *     gemessen (31.08.2026, „Guten Morgen") fuehrte die m3u 2 von 3
 *     vorhandenen Dateien — sie hinkt der Aufnahme nach. Die m3u bleibt der
 *     Abspiel-Vertrag des musicsearch-Wegs; fuer „welcher Titel ist da" ist
 *     sie die falsche Zeugin.
 *
 * REINE LOGIK: Dateinamen und Titellisten kommen herein (der Leser mit
 * readdir + mtime-Cache wohnt in server.ts), heraus kommt die Karte bzw. die
 * gemischte Liste. Kein Netz, kein Dateisystem, keine Uhr.
 */

/** Endungen, die die Aufnahme schreibt bzw. musicsearch findet — dieselbe
 *  Liste wie der find-Befehl in spotify-control.ts (`playList`). */
const SPUR_ENDUNGEN = ['.flac', '.mp3', '.m4a', '.wma', '.wav']

const SPUR_MUSTER = /^(\d{2,3})\s+(.+)(\.[a-z0-9]+)$/i

/** `NN <Titel>.flac` -> Nummer, oder null wenn das kein Spurname ist. */
export function spurNummerAus(dateiname: string | null | undefined): number | null {
  const m = SPUR_MUSTER.exec(String(dateiname ?? ''))
  if (!m) return null
  if (!SPUR_ENDUNGEN.includes(m[3].toLowerCase())) return null
  const nr = Number(m[1])
  return Number.isFinite(nr) && nr >= 1 ? nr : null
}

/**
 * IST DIESE SPUR ABSPIELBEREIT? — Betreiber-Regel vom 31.08.2026: „mitschnitt
 * soll sich nicht auf das album beziehen sondern auf den titel wenn titel
 * komplett dann ist er abspiel bereit."
 *
 * DIE AUSKUNFT STEHT SCHON AUF DER PLATTE, im DATEINAMEN: Die Aufnahme
 * vergleicht die aufgenommene mit der erwarteten Laenge (`vollstaendigkeit`
 * in mixpi-mitschnitt) und haengt unter 97 % ` (unvollstaendig NN%)` an —
 * ausdruecklich in den Namen und nicht bloss in ein Tag, „den Namen sieht
 * auch, wer nur den Ordner oeffnet". Hier wird sie nur GELESEN; eine zweite
 * Messung waere eine zweite Wahrheit ueber dieselbe Datei.
 *
 * Ein abgebrochener Titel wird also NICHT gespielt, solange eine andere
 * Quelle ihn ganz hat — er bleibt aber liegen (zum Puffern ist er mehr wert
 * als nichts, und die naechste Aufnahme ersetzt ihn).
 */
export function spurVollstaendig(dateiname: string | null | undefined): boolean {
  return !/\(unvollstaendig\s+\d+%\)/i.test(String(dateiname ?? ''))
}

/** Alle Spuren eines Albumordners als Karte Nummer -> Dateiname.
 *
 *  Bei doppelter Nummer gewinnt der ERSTE in sortierter Reihenfolge — ein
 *  zweiter Mitschnitt derselben Spur darf die Karte nicht kippen, und die
 *  Sortierung macht den Gewinner unabhaengig von der readdir-Laune. */
export function lokaleKarteAus(dateinamen: readonly string[]): Map<number, string> {
  const karte = new Map<number, string>()
  for (const name of [...dateinamen].sort()) {
    const nr = spurNummerAus(name)
    if (nr !== null && !karte.has(nr)) karte.set(nr, name)
  }
  return karte
}

/** Fuer den Namensvergleich: alles ausser Buchstaben und Ziffern faellt weg.
 *  Damit sind die Sanitisierung der Aufnahme (`/` -> `_`), Satzzeichen und
 *  Leerzeichen keine Unterschiede mehr. */
function namensKern(s: string): string {
  return String(s ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '')
}

/**
 * DIE GEGENPROBE: passt der Spur-Dateiname zum Titelnamen der Liste?
 *
 * Die Nummer ist die Identitaet — aber nur innerhalb DERSELBEN Zaehlung. Die
 * NN der Aufnahme folgt der Quell-Liste des Meta-Albums (meist Spotify);
 * eine Jellyfin-Liste desselben Albums zaehlt fast immer gleich, kann aber
 * abweichen (Bonustitel, andere Ausgabe). Bei Nummerngleichheit mit ganz
 * anderem Namen wird NICHT zugeordnet — dann spielt die Listen-Quelle den
 * Titel, statt dass die falsche Datei laeuft.
 *
 * UNSCHARF MIT ABSICHT: verglichen werden die Namenskerne (nur Buchstaben
 * und Ziffern), Gleichheit ODER Enthaltensein genuegt — „Guten Morgen _
 * Good Morning (Englisch)" (Dateiname, sanitisiert) muss „Guten Morgen /
 * Good Morning (Englisch)" (Listenname) treffen. Ist einer der Kerne leer
 * (Name bestand nur aus Zeichen), ist nichts pruefbar — dann entscheidet
 * die Nummer allein.
 */
export function spurNamePasst(dateiname: string, titelname: string): boolean {
  const m = SPUR_MUSTER.exec(String(dateiname ?? ''))
  const a = namensKern(m ? m[2] : String(dateiname ?? ''))
  const b = namensKern(titelname)
  if (!a || !b) return true
  return a === b || a.includes(b) || b.includes(a)
}

export interface MischOptionen {
  /** Voller Albumordner AUS SICHT DES ABSPIELERS (auf der Box der
   *  Medienordner; in Tests der MUPIBOX_MEDIA_DIR-Pfad). */
  readonly basisPfad: string
  /** Die eingestellte Dienst-Reihenfolge (`abspielReihenfolge`). Dienste,
   *  die darin fehlen, reihen sich hinten ein. */
  readonly reihenfolge: readonly string[]
  /** Der Dienst der hereingereichten Liste (z. B. 'jellyfin'). */
  readonly eigenerDienst: string
}

/**
 * JE TITEL DIE BESTE QUELLE — der Kern der Mischliste.
 *
 * Herein kommt die GEWINNER-Liste eines Werks (die /inhalt-Bauart mit
 * `befehl`/`anhaengen` je Titel) und die lokale Spuren-Karte des zugehoerigen
 * Albumordners. Heraus kommt dieselbe Liste, je Titel ergaenzt um:
 *
 *   quelle    der Dienst, ueber den DIESER Titel kaeme (die Plakette)
 *   quellen   alle Dienste, die ihn haben (die Matrix des Steuerpults)
 *
 * und — wo `lokal` nach der eingestellten Reihenfolge gewinnt — mit
 * ERSETZTEN Befehlen: `datei/…` statt des Stroms, `dateiqueue/…` statt des
 * Anhaengens. Die Befehlsform ist die der jfBefehle in server.ts (Adresse
 * kodiert, `:title:artist:`-Schwanz), das Verb die E108-Familie im
 * Abspieldienst.
 *
 * Ein Titel OHNE eigenen Befehl (Jellyfin ohne Stromadresse) wird lokal
 * bedient, wenn die Spur da ist — sonst bleibt er, was er war: ein Eintrag
 * ohne Abspielweg, den `spielVersuch` aussortiert.
 */
/**
 * NUR DIE HERKUNFT STEMPELN, NICHT MISCHEN — fuer die Zweige, deren Weg ein
 * GANZ-ALBUM bleibt (lokal ueber die m3u, Spotify ueber die eine Maschine,
 * ARD/Plugin ueber ihre Folgenliste): je Titel `quelle` = der eigene Dienst,
 * `quellen` = was nachweislich vorliegt. Das lokale Haekchen kommt aus der
 * Spuren-Karte samt Namens-Gegenprobe — fuer die Titel-Matrix des
 * Steuerpults (Stufe 2), NICHT fuer den Abspielweg: Spotify mischt nicht
 * titelweise (Maschinenwechsel kostet 1-2 s Stille, [dienste-umschalten]);
 * der EINE Wechselpunkt ist E108 Stufe 3.
 */
export function titelQuellenStempeln(
  titel: readonly Record<string, unknown>[],
  karte: ReadonlyMap<number, string>,
  eigenerDienst: string,
): Record<string, unknown>[] {
  return titel.map((t) => {
    if (eigenerDienst === 'lokal') {
      // ══ EINE KENNUNG, SONST IST DER TITEL NICHT WIEDERZUERKENNEN ═════════
      //
      // Betreiber, 11.09.2026: „von lokal spielen da geht es noch nicht" — der
      // laufende Titel bekam in der Liste keinen Indikator.
      //
      // Die Oberflaeche bildet ihre Kennungen aus `uri` (Spotify) ODER `id`
      // (ARD, Jellyfin). Lokale Titel hatten WEDER das eine NOCH das andere;
      // `stueckKennung` und `folgeKennung` geben dann beide '' zurueck, die
      // Kachel traegt kein `data-spielt`, und `spieltMarkieren()` sieht sie
      // nicht einmal an. Keine vergessene Zeile, sondern eine fehlende Zutat.
      //
      // DIE NUMMER GENUEGT, und das ist keine Nachlaessigkeit: `folgeKennung`
      // stellt den WERKSCHLUESSEL voran (`folge|<schluessel>|<id>`) — die
      // Nummer muss also nur innerhalb EINES Werks eindeutig sein, und genau
      // das ist sie. Ein Dateipfad waere hier gar nicht zu haben: der
      // Abspieldienst liefert je Stueck nur `{nr, name}`.
      //
      // HIER UND NICHT AN DEN VIER AUFRUFSTELLEN: `titelQuellenStempeln` ist
      // die Naht, durch die JEDE lokale Titelliste laeuft (server.ts 12285,
      // 12424, 12538, 12714). Der erste Anlauf setzte die Kennung an genau
      // einer davon — das verschmolzene Werk nahm eine andere und blieb
      // unmarkiert. Ein Befund, der nach dem Fix wiederkehrt, heisst: die
      // Wache stand hinter dem Ereignis.
      //
      // NUR WENN NICHTS DA IST: Traegt ein Titel schon `id` oder `uri`, gilt
      // seine eigene Kennung. Sie zu ueberschreiben hiesse, eine funktionierende
      // Zuordnung gegen eine schwaechere zu tauschen.
      const hatKennung = t.id !== undefined || t.uri !== undefined
      const nr = Number(t.nr)
      const kennung = !hatKennung && Number.isFinite(nr) ? { id: String(nr) } : {}
      return { ...t, ...kennung, quelle: 'lokal', quellen: ['lokal'] }
    }
    const nr = Number(t.nr)
    const spur = Number.isFinite(nr) ? karte.get(nr) : undefined
    const lokalDa = spur !== undefined && spurVollstaendig(spur) && spurNamePasst(spur, String(t.titel ?? ''))
    return { ...t, quelle: eigenerDienst, quellen: [...(lokalDa ? ['lokal'] : []), eigenerDienst] }
  })
}

export function titelMischen(
  titel: readonly Record<string, unknown>[],
  karte: ReadonlyMap<number, string>,
  opt: MischOptionen,
): Record<string, unknown>[] {
  const enc = encodeURIComponent
  return titel.map((t) => {
    const nr = Number(t.nr)
    const spur = Number.isFinite(nr) ? karte.get(nr) : undefined
    const name = String(t.titel ?? '')
    // ABSPIELBEREIT heisst KOMPLETT (Betreiber-Regel, siehe spurVollstaendig):
    // eine abgebrochene Spur zaehlt nicht als lokale Quelle.
    const lokalDa = spur !== undefined && spurVollstaendig(spur) && spurNamePasst(spur, name)
    /* ══ „DER EIGENE DIENST HAT IHN" HEISST NICHT IMMER `befehl` ═════════════
     *
     * Betreiber, 04.09.2026: „ich will das es lokal spielt deshalb haben wir
     * den wechsel drin."
     *
     * Bis hierher galt ein Titel nur dann als beim eigenen Dienst vorhanden,
     * wenn er einen `befehl` trug. Das stimmt fuer die mpv-Familie (Jellyfin
     * und ARD liefern fertige Befehle) und ist fuer SPOTIFY falsch: dessen
     * Titel tragen `uri` (`spotify:track:…`) und nie einen `befehl`, weil
     * Spotify bis heute als GANZES Album gestartet wird. Am Geraet gemessen
     * an „101 Meerjungfrauen": jeder Titel fuehrt `uri`, keiner `befehl`.
     *
     * Folge: Wer diese Funktion fuer Spotify aufrief, bekam fuer JEDEN Titel
     * `quellen: []` — auch fuer die, die lokal vorliegen. Das Mischen war
     * dort also nicht „abgeschaltet", es haette schlicht Unsinn geliefert.
     * Deshalb steht die Frage jetzt als HANDHABE, nicht als Befehlsform: ein
     * Titel ist beim eigenen Dienst da, wenn es irgendetwas gibt, womit man
     * ihn dort anfassen kann.
     */
    const eigeneDa =
      (typeof t.befehl === 'string' && t.befehl !== '') || (typeof t.uri === 'string' && t.uri !== '')
    const quellen: string[] = []
    if (lokalDa) quellen.push('lokal')
    if (eigeneDa) quellen.push(opt.eigenerDienst)
    if (!quellen.length) return { ...t, quellen }
    const wahl = opt.reihenfolge.find((d) => quellen.includes(d)) ?? quellen[0]
    if (wahl !== 'lokal') return { ...t, quelle: wahl, quellen }
    const schwanz = `${enc(`${opt.basisPfad}/${spur}`)}/${enc(name)}:title:artist:${enc(String(t.interpret ?? ''))}`
    return { ...t, quelle: 'lokal', quellen, befehl: `datei/${schwanz}`, anhaengen: `dateiqueue/${schwanz}` }
  })
}
