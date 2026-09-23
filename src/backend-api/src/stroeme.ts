/**
 * DIE STROEME DER BOX (E72).
 *
 * Der Gedanke (Betreiber, 20.08.2026): „ob man nicht 2 kinder mit einer box
 * mit 2 parallelen ausgaben ueber 2 bluetooth geraete bzw senken bedienen kann
 * dann waere es nicht starr mitschnitt und familien box eher eben stream 1
 * und 2".
 *
 * ══ WAS DAS UMDREHT ════════════════════════════════════════════════════════
 *
 * E66 war entworfen als „der Mitschnitt bekommt einen eigenen Zugang". Damit
 * waere der zweite Strom ein SONDERFALL — und jeder weitere ein neuer Sonderfall
 * daneben. Hier ist er der NORMALFALL: die Box fuehrt nummerierte Stroeme,
 * jeder mit eigenem Zugang und eigenem Tonziel. Der Mitschnitt ist EINER davon.
 *
 * Am 20.08.2026 an der Box gemessen, dass es traegt: zwei gleichzeitige
 * A2DP-Stroeme auf EINEM Funkbaustein, 180 Sekunden, keine Aussetzer, WLAN
 * unveraendert — und beide Lautsprecher hoerbar.
 *
 * ══ DIE EINE REGEL, DIE NICHT VERHANDELBAR IST ═════════════════════════════
 *
 * ZWEI STROEME DUERFEN SICH KEINEN ZUGANG TEILEN. Ein Spotify-Konto spielt
 * genau EINEN Strom; startet ein zweiter mit demselben Schluessel, nimmt er
 * dem ersten die Wiedergabe weg. Fuer ein Kind heisst das: die Musik hoert
 * mitten im Stueck auf, ohne dass jemand etwas getan hat.
 *
 * Das ist kein theoretischer Fall. Am 20.08.2026 stand fuer eine Weile der
 * PLATZHALTER `SPAK_HIER_EINSETZEN` als zweiter Schluessel in der
 * Konfiguration — verschieden vom ersten, also haette jede naive Pruefung
 * „zwei Konten" gemeldet. Erst die Laenge (19 statt 37) verriet es. Deshalb
 * prueft `pruefen()` nicht nur auf Gleichheit, sondern auf FORM.
 *
 * ══ WAS HIER NICHT DRINSTEHT ═══════════════════════════════════════════════
 *
 * Wie ein Strom gestartet wird. Das haengt an der Spotify Engine (Soloist braucht
 * einen spak_-Schluessel, librespot meldet sich per Zeroconf an und braucht
 * gar keinen) und gehoert zu den Startskripten. Dieses Modul beantwortet nur:
 * WELCHE Stroeme gibt es, WIE heissen sie, und WAS ist daran falsch.
 */

/** Wozu ein Strom da ist. Mehr Zwecke sind moeglich; diese zwei gibt es heute. */
export const ZWECKE = ['wiedergabe', 'mitschnitt'] as const
export type Zweck = (typeof ZWECKE)[number]

/** Womit ein Strom spielt. `zeroconf` heisst: kein Schluessel noetig. */
export const MASCHINEN = ['soloist', 'librespot'] as const
export type Maschine = (typeof MASCHINEN)[number]

export interface Strom {
  /** 1, 2, 3 … — die Identitaet. Sie steht im Geraetenamen. */
  nr: number
  zweck: Zweck
  maschine: Maschine
  /** Der spak_-Schluessel. Leer bei librespot — das ist kein Mangel. */
  schluessel: string
  /** Das Tonziel (PipeWire-Senke). Leer heisst: der Standard-Senke folgen. */
  senke: string
}

export interface Stroeme {
  stroeme: Strom[]
}

/**
 * WIE VIELE STROEME EINE BOX HOECHSTENS FUEHRT — und warum es eine Zahl gibt.
 *
 * Betreiber, 21.08.2026: „füge hinzu das man bis zu 5 ströme haben kann es
 * gibt ja im family account 5".
 *
 * Die Zahl faellt nicht vom Himmel, sie FOLGT aus der einen Regel weiter
 * unten: zwei Stroeme duerfen sich keinen Zugang teilen. Ein Strom braucht
 * also ein eigenes Konto — und so viele Konten gibt der Familientarif her.
 * Die Grenze ist damit keine Einstellung der Box, sondern eine Eigenschaft
 * des Tarifs; sie steht hier, damit die Oberflaeche sie nennen kann, statt
 * den Betreiber sechs Stroeme anlegen und erst am stummen Lautsprecher
 * merken zu lassen, dass der sechste keinem Konto gehoert.
 *
 * GEMELDET, NICHT VERBOTEN — wie alles in `pruefen`. Wer mehr eintraegt,
 * bekommt einen Befund und keine verschlossene Tuer: vielleicht hat die
 * naechste Box einen anderen Tarif.
 */
export const STROEME_HOECHSTENS = 5

export const STROEME_LEER: Stroeme = { stroeme: [] }

/**
 * Wie ein gueltiger Soloist-Schluessel aussieht.
 *
 * `spak_` und 32 Zeichen. Die LAENGE ist der Teil, auf den es ankommt: ein
 * Platzhalter ist verschieden vom echten Schluessel und faellt damit durch
 * jede Gleichheitspruefung — durch diese nicht.
 */
const SCHLUESSEL_MUSTER = /^spak_[A-Za-z0-9]{32}$/

export function istSchluessel(x: unknown): boolean {
  // KEIN TYPPRAEDIKAT (`x is string`). Das war der erste Entwurf und es war
  // schaedlich: `Strom.schluessel` IST schon ein string, und ein Praedikat
  // `x is string` engt ihn im Falsch-Zweig auf `never` ein — `s.schluessel.length`
  // in der Fehlermeldung liess sich danach nicht mehr uebersetzen. Ein
  // Praedikat gehoert dorthin, wo es wirklich etwas eingrenzt.
  return typeof x === 'string' && SCHLUESSEL_MUSTER.test(x)
}

function text(x: unknown): string {
  return typeof x === 'string' ? x.trim() : ''
}

export function stromAus(roh: unknown): Strom | null {
  if (!roh || typeof roh !== 'object') return null
  const r = roh as Record<string, unknown>
  const nr = r.nr
  if (typeof nr !== 'number' || !Number.isInteger(nr) || nr < 1) return null
  return {
    nr,
    zweck: ZWECKE.includes(r.zweck as Zweck) ? (r.zweck as Zweck) : 'wiedergabe',
    maschine: MASCHINEN.includes(r.maschine as Maschine) ? (r.maschine as Maschine) : 'soloist',
    schluessel: text(r.schluessel),
    senke: text(r.senke),
  }
}

/** Die Liste. Dieselbe Nummer zweimal: die erste gilt. */
export function stroemeAus(roh: unknown): Stroeme {
  const quelle = (roh && typeof roh === 'object' ? (roh as Record<string, unknown>) : {}).stroeme
  const stroeme: Strom[] = []
  const gesehen = new Set<number>()
  for (const r of Array.isArray(quelle) ? quelle : []) {
    const s = stromAus(r)
    if (!s || gesehen.has(s.nr)) continue
    gesehen.add(s.nr)
    stroeme.push(s)
  }
  return { stroeme: [...stroeme].sort((a, b) => a.nr - b.nr) }
}

/**
 * Wie der Strom in der Connect-Liste heisst: `<Boxname> Stream <n>`.
 *
 * DER ZWECK STEHT NICHT DRIN, und das ist Absicht (Betreiber, 20.08.2026:
 * „vielleicht sollten wir das geraet nicht mitschnitt nennen"). Der Name geht
 * an Spotify — Connect-Geraete stehen in der Geraeteliste des Kontos. Ein
 * Geraet namens „Mitschnitt" sagt dem Dienst woertlich, was es tut.
 *
 * DIE BOXNUMMER GEHOERT IN DEN BOXNAMEN, nicht hierher. Ein zweiter Kasten
 * heisst `MixPiBox_2` und bekommt damit `MixPiBox_2 Stream 1/2` von selbst.
 */
export function geraetename(strom: Strom, boxname: unknown): string {
  const box = text(boxname) || 'MuPiBox'
  return `${box} Stream ${strom.nr}`
}

/**
 * Wo dieser Strom seine ANMELDUNG ablegt.
 *
 * ══ WARUM DAS EINE REGEL BRAUCHT UND KEIN FELD ═════════════════════════════
 *
 * Betreiber, 21.08.2026: „wie verhindert man das man stetig neu koppeln muss?"
 * Am Geraet gemessen wurde nichts weggeraeumt — `soloist.service` stand mit
 * NRestarts=0, beide Ordner trugen ihre Konten. Der Eindruck kommt aus der
 * Bauart: JEDER STROM HAT SEINEN EIGENEN ORDNER UND DAMIT SEINE EIGENE
 * ANMELDUNG. Soloists eigene Hilfe sagt es woertlich — „--pair … run once
 * before --single-track to store credentials".
 *
 * Wer in der Spotify-App „die Box" koppelt, koppelt also immer nur EINEN
 * Strom. Der andere bleibt unberuehrt, und das fuehlt sich an wie „schon
 * wieder". Deshalb steht der Kopplungszustand jetzt je Strom in der
 * Oberflaeche: nicht die Kopplung wird haeufiger, sondern sichtbar.
 *
 * ══ DIE ZWEI ORTE ══════════════════════════════════════════════════════════
 *
 * Strom 1 traegt `soloist.service` — dessen `StateDirectory=soloist` macht
 * daraus /var/lib/soloist. Jeder weitere Strom laeuft als eigener Prozess des
 * Mitschnitt-Plugins und bekommt seinen Ordner nach der Nummer. Diese
 * Ungleichheit ist gewachsen und nicht schoen; sie steht hier an EINER Stelle,
 * damit sie sich spaeter an einer Stelle geradeziehen laesst.
 */
export function datenOrdner(strom: Strom): string {
  return strom.nr === 1 ? '/var/lib/soloist' : `/var/lib/mixpi-strom-${strom.nr}`
}

/**
 * Was dieser Strom klanglich liefert — und ob daran etwas zu waehlen ist.
 *
 * SOLOIST HAT KEINEN SCHALTER. Am 21.08.2026 die vollstaendige Schalterliste
 * von `soloist --help` durchgesehen: weder `--bitrate` noch `--quality` noch
 * `--format`. Er spielt verlustfrei, fertig. Ein Regler daneben waere eine
 * Behauptung ueber eine Wahl, die es nicht gibt.
 *
 * LIBRESPOT KANN 96/160/320 — tut es aber nach fester Zahl: in
 * /etc/librespot/env-librespot steht `LIBRESPOT_BITRATE=160`, nicht aus der
 * Konfiguration gelesen. Deshalb nimmt diese Funktion die Zahl ENTGEGEN,
 * statt sie zu kennen: wer sie nicht gemessen hat, soll hier auch keine
 * nennen.
 */
export function klangWort(strom: Strom, bitrate?: number | null): { wort: string; waehlbar: boolean } {
  if (strom.maschine === 'soloist') return { wort: 'verlustfrei', waehlbar: false }
  const n = typeof bitrate === 'number' && bitrate > 0 ? bitrate : null
  return { wort: n ? `${n} kbps` : 'kbps unbekannt', waehlbar: true }
}

export interface Befund {
  /** Welche Stroeme betroffen sind. */
  nr: number[]
  was: string
  /** `true` = die Box spielt damit nachweislich falsch, nicht nur unschoen. */
  schwer: boolean
}

/**
 * Was an dieser Aufstellung falsch ist.
 *
 * ES MELDET, ES VERBIETET NICHT. Eine Box, die wegen einer Konfigurationsfrage
 * gar nicht mehr spielt, ist schlimmer als eine, die falsch spielt und es sagt
 * — dieselbe Richtung wie beim Kiosk-Rueckfall und bei der Haltedauer.
 */
export function pruefen(a: Stroeme): Befund[] {
  const befunde: Befund[] = []
  const stroeme = a.stroeme

  // 1. DERSELBE ZUGANG ZWEIMAL — der schwere Fall.
  const jeSchluessel = new Map<string, number[]>()
  for (const s of stroeme) {
    if (!s.schluessel) continue
    jeSchluessel.set(s.schluessel, [...(jeSchluessel.get(s.schluessel) ?? []), s.nr])
  }
  for (const [, nrs] of jeSchluessel) {
    if (nrs.length > 1) {
      befunde.push({
        nr: nrs,
        was: 'teilen sich denselben Zugang — ein Konto spielt nur EINEN Strom, der zweite nimmt dem ersten die Wiedergabe weg',
        schwer: true,
      })
    }
  }

  for (const s of stroeme) {
    // 2. EIN SCHLUESSEL, DER KEINER IST. Der Platzhalter-Fall.
    if (s.maschine === 'soloist' && s.schluessel && !istSchluessel(s.schluessel)) {
      befunde.push({
        nr: [s.nr],
        was: `der Schluessel hat nicht die Form spak_ + 32 Zeichen (${s.schluessel.length} Zeichen) — steht da noch ein Platzhalter?`,
        schwer: true,
      })
    }
    // 3. SOLOIST OHNE SCHLUESSEL laeuft gar nicht erst an.
    if (s.maschine === 'soloist' && !s.schluessel) {
      befunde.push({ nr: [s.nr], was: 'Soloist ohne Schluessel — der Dienst startet nicht', schwer: true })
    }
    // 4. LIBRESPOT MIT SCHLUESSEL ist kein Fehler, aber ein Missverstaendnis:
    //    librespot meldet sich per Zeroconf an und benutzt ihn nie.
    if (s.maschine === 'librespot' && s.schluessel) {
      befunde.push({
        nr: [s.nr],
        was: 'librespot braucht keinen Schluessel (Zeroconf) — er wird ignoriert',
        schwer: false,
      })
    }
  }

  // 5. MEHR STROEME ALS KONTEN. Siehe STROEME_HOECHSTENS: die Grenze kommt
  //    vom Tarif, nicht von der Box. Schwer, weil der ueberzaehlige Strom
  //    zwangslaeufig ein Konto doppelt benutzt — und damit dem anderen die
  //    Wiedergabe wegnimmt, mitten im Stueck.
  if (stroeme.length > STROEME_HOECHSTENS) {
    befunde.push({
      nr: stroeme.slice(STROEME_HOECHSTENS).map((s) => s.nr),
      was: `mehr als ${STROEME_HOECHSTENS} Stroeme — so viele eigene Spotify-Konten gibt der Familientarif her; der ueberzaehlige muesste sich eines teilen`,
      schwer: true,
    })
  }

  // 6. DASSELBE TONZIEL ZWEIMAL. Kein Fehler der Box, aber zwei Kinder hoeren
  //    dann beide Stroeme uebereinander aus demselben Lautsprecher.
  const jeSenke = new Map<string, number[]>()
  for (const s of stroeme) {
    if (!s.senke) continue
    jeSenke.set(s.senke, [...(jeSenke.get(s.senke) ?? []), s.nr])
  }
  for (const [senke, nrs] of jeSenke) {
    if (nrs.length > 1) {
      befunde.push({
        nr: nrs,
        was: `spielen beide auf ${senke} — dann liegt der eine Strom ueber dem anderen`,
        schwer: false,
      })
    }
  }

  return befunde
}

/* ══ DER POOL UND SEINE VERGABE (E74, 22.08.2026) ═══════════════════════════
 *
 * Betreiber: „kann man nicht einfach einen pool von strömen haben und falls da
 * pickt sich einer den zum hören" — dazu die Regeln: „hören hat vorrang zu
 * mitschnitt", „mitgeschnitten werden kann wenn keiner hört bzw ein stream
 * frei ist", „wenn mehr als einer frei ist geht das abarbeiten schneller".
 *
 * ══ WARUM DAS VORHER ANDERS WAR ════════════════════════════════════════════
 *
 * Nicht durch Entscheidung, sondern durch Wachstum. E66 war „der Mitschnitt
 * bekommt einen eigenen Zugang", E72 machte daraus nummerierte Stroeme — aber
 * der ZWECK blieb am Strom festgeschweisst. Ein Strom WAR eine Rolle. Damit
 * lag der zweite Zugang still, waehrend die Liste 22 Titel tief war, und ein
 * dritter haette gar nichts beschleunigt.
 *
 * ══ WARUM DER POOL HIER TRAEGT ═════════════════════════════════════════════
 *
 * Das uebliche Gegenargument — Konten seien nicht austauschbar, jedes habe
 * seine eigene Bibliothek — gilt fuer DIESE Box nicht. Sie spielt keine
 * „deine Playlists", sondern die URIs ihrer eigenen Medienliste, und jedes
 * Premium-Konto kann jede URI abspielen. Was bleibt, ist kosmetisch: der
 * „zuletzt gehoert"-Verlauf verteilt sich auf die Konten, die dran waren.
 *
 * ══ DIE ENTSCHEIDUNG IST PUR ═══════════════════════════════════════════════
 *
 * `vergeben()` kennt keine Prozesse, keine Ordner und keine Zeit. Es bekommt
 * den Pool, die Belegung und die Nachfrage und sagt, welcher Strom es wird —
 * oder WARUM keiner. Damit laesst sich jede Regel ohne Box pruefen, und die
 * Gruende stehen als Text da statt als `null`, das man spaeter raten muss.
 */

/** Ein belegter Strom: welche Nummer, wofuer, und seit wann (Millisekunden). */
export interface Belegung {
  nr: number
  fuer: Zweck
  /** Beginn in ms. Entscheidet bei Verdraengung, wer weichen muss. */
  seit: number
}

export interface Vergabe {
  /** Der zugeteilte Strom — `null`, wenn keiner geht. */
  nr: number | null
  /** Warum dieser, oder warum keiner. Steht so in Protokoll und Oberflaeche. */
  grund: string
  /** Welcher laufende Mitschnitt dafuer weichen muss. */
  verdraengt?: number
}

/**
 * Wer bekommt einen Strom.
 *
 * ══ DIE DREI REGELN ════════════════════════════════════════════════════════
 *
 * 1. HOEREN GEWINNT IMMER. Ist nichts frei, weicht ein laufender Mitschnitt.
 *    Kein Kind wartet auf eine Aufnahme.
 *
 * 2. VERDRAENGT WIRD DER JUENGSTE MITSCHNITT. Er hat am wenigsten Arbeit
 *    gesammelt — die halbe Datei ist ohnehin verloren (der Arbeiter benennt
 *    erst bei Erfolg um), also soll moeglichst wenig davon verloren gehen.
 *    Die aeltere Aufnahme laeuft weiter und wird fertig.
 *
 * 3. DER MITSCHNITT HAELT `reserve` STROEME FREI. Er nimmt einen nur, wenn
 *    DANACH noch so viele frei sind. Damit ist Verdraengung der Sonderfall
 *    und nicht der Normalbetrieb: wer anfangen will, findet fast immer etwas.
 */
export function vergeben(
  pool: readonly Strom[],
  belegt: readonly Belegung[],
  fuer: Zweck,
  reserve = 1,
): Vergabe {
  const belegteNr = new Set(belegt.map((b) => b.nr))
  // NUR STROEME AUS DEM POOL. Eine Belegung auf einer Nummer, die es nicht
  // (mehr) gibt, darf keinen Platz blockieren — sonst haelt ein
  // zurueckgebliebener Eintrag die Box fuer voll, obwohl sie leer ist.
  const frei = pool.filter((s) => !belegteNr.has(s.nr)).sort((a, b) => a.nr - b.nr)

  if (pool.length === 0) return { nr: null, grund: 'kein Strom eingerichtet' }

  if (fuer === 'wiedergabe') {
    if (frei.length > 0) return { nr: frei[0].nr, grund: 'freier Strom' }

    // NICHTS FREI — dann muss ein Mitschnitt weichen. Der juengste zuerst.
    const mitschnitte = belegt.filter((b) => b.fuer === 'mitschnitt')
    if (mitschnitte.length === 0) {
      return { nr: null, grund: 'alle Stroeme hoeren gerade — es gibt nichts zu verdraengen' }
    }
    const juengster = [...mitschnitte].sort((a, b) => b.seit - a.seit)[0]
    return {
      nr: juengster.nr,
      grund: 'nichts frei — der juengste Mitschnitt weicht',
      verdraengt: juengster.nr,
    }
  }

  // MITSCHNITT. Er nimmt nur, was uebrig bleibt.
  if (frei.length === 0) return { nr: null, grund: 'kein Strom frei' }
  if (frei.length - 1 < reserve) {
    return {
      nr: null,
      grund: `haelt ${reserve} ${reserve === 1 ? 'Strom' : 'Stroeme'} fuers Hoeren frei`,
    }
  }
  return { nr: frei[0].nr, grund: 'freier Strom, Reserve bleibt' }
}

// ZWEI VORGRIFFE SIND AM 19.09.2026 GEFALLEN (AUDIT-2026-09-19 Rang 7):
//
//   `mitschnittPlaetze(pool, belegt, reserve)` — wie viele Mitschnitte
//   gleichzeitig laufen duerfen. Die Rechnung war richtig und geprueft, aber
//   es gibt in diesem Baum keinen Mitschnitt, der Plaetze anfragt: kein
//   Endpunkt, kein Aufrufer, nur die eigene Spec.
//
//   `fuerZweck(a, zweck)` — die Stroeme eines Zwecks. Ein `filter` in einer
//   Huelle, die niemand rief.
//
// Der Vergabeweg (`naechsterFreier`, `/api/stroeme/vergabe`) kommt ohne
// beide aus. Wer den Mitschnitt baut, holt die Rechnung aus der Geschichte
// zurueck — mit dem Verbraucher im selben Zug, nicht davor.

/**
 * Die Aufstellung, die eine Box ohne eigene Angabe hat.
 *
 * EIN Strom, Wiedergabe, mit dem vorhandenen Schluessel. Das ist genau der
 * Zustand jeder Box von heute — die Einfuehrung der Stroeme aendert an einer
 * bestehenden Box also NICHTS, solange niemand einen zweiten eintraegt.
 */
export function vorgabe(schluessel: unknown, maschine: unknown = 'soloist'): Stroeme {
  return {
    stroeme: [
      {
        nr: 1,
        zweck: 'wiedergabe',
        maschine: MASCHINEN.includes(maschine as Maschine) ? (maschine as Maschine) : 'soloist',
        schluessel: text(schluessel),
        senke: '',
      },
    ],
  }
}
