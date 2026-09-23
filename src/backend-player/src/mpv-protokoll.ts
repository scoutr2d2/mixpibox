// Übersetzung zwischen dem bisherigen Player-Vertrag und mpvs JSON-IPC.
//
// REIN: kein Socket, kein Prozess, kein Zeitgeber. Damit ist der heikle Teil
// des mpv-Umbaus — Befehle bauen und Werte umformen — vollständig prüfbar,
// ohne mpv zu starten. Die Verkabelung liegt in mpv-wrapper.ts.
//
// WARUM DER UMBAU DIE ZWEI ALTEN FEHLER NICHT ERBEN KANN
// mplayer bekam eine ZEICHENKETTE auf stdin, also musste der Wrapper
// Anführungszeichen setzen und hat zusätzlich `decodeURIComponent` über die
// ganze Zeile laufen lassen. Daraus wurden zwei echte Fehler (siehe die
// MACKE-Tests in mplayer-wrapper.spec.ts): ein Pfad mit `%20` verlor seine
// Anführungszeichen, ein Dateiname mit `%` warf eine Ausnahme.
// mpv bekommt ein JSON-ARRAY. Ein Dateiname ist dort ein Element, kein Text
// in einer Befehlszeile — beide Fehler sind damit nicht "behoben", sondern
// baulich unmöglich. Deshalb wird hier NICHTS dekodiert und NICHTS gequotet.

/**
 * Namen des bisherigen Vertrags -> mpv-Eigenschaften.
 *
 * Links steht, was spotify-control abfragt und worauf es hört (die Namen
 * stammen aus mplayers Slave-Modus); rechts, wie mpv es nennt. Wer hier etwas
 * ergänzt, muss auch `wertUmsetzen` bedenken.
 */
export const EIGENSCHAFTEN: Readonly<Record<string, string>> = Object.freeze({
  time_pos: 'time-pos',
  length: 'duration',
  percent_pos: 'percent-pos',
  pause: 'pause',
  filename: 'filename',
  path: 'path',
  metadata: 'metadata',
  // Die STELLE in der Warteschlange, 1-basiert - genau das, was "Titel n"
  // meint. Vorher zaehlte spotify-control metadata-EREIGNISSE hoch, und mpv
  // meldet fuer EINE Datei mehrere; am Geraet gemessen stand deshalb bei
  // Titel 1 eine 3. mpv weiss es selbst, man muss nur fragen.
  playlist_pos: 'playlist-pos-1',
  playlist_count: 'playlist-count',
  // DER NAME DES LAUFENDEN EINTRAGS (F1). `metadata.Title` kommt aus der
  // DATEI und taugt bei der ARD nicht — die Ausspielpartner tragen dort den
  // Sendungsnamen mit ein ("Zu Besuch | Die Maus zum Hoeren (…)"), genau die
  // Doppelung, die `titleClean` in ard.ts wegnimmt. `media-title` dagegen
  // laesst sich SETZEN: `BEFEHLE.play`/`queue` legen ihn als Datei-Option
  // `force-media-title` in den Warteschlangeneintrag, und mpv meldet ihn beim
  // Uebergang von selbst weiter.
  media_title: 'media-title',
  // LEERLAUF IST KEINE WIEDERGABE (E109, Betreiber-Fund 31.08.2026 „beim
  // stop springen die titel"): mpvs `pause` ist im Idle FALSE, und der
  // Sekundentakt in spotify-control schrieb daraus jede Sekunde
  // `playing = true` — nach JEDEM Stop stand die Buchfuehrung dauerhaft auf
  // „spielt", waehrend mpv laengst leer war. `idle-active` sagt es ehrlich;
  // der Hoerer dort gewinnt gegen den pause-Poll.
  idle_active: 'idle-active',
})

/** mpv-Name -> unser Name (für den Rückweg beim Auswerten der Antwort). */
export const RUECKWAERTS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(EIGENSCHAFTEN).map(([unser, mpv]) => [mpv, unser])),
)

/** Die Felder, die spotify-control aus `metadata` liest — GROSS geschrieben. */
const META_FELDER = ['Title', 'Artist', 'Album', 'Year', 'Comment', 'Genre', 'Track'] as const

/**
 * mpvs Metadaten in die Form bringen, die der Verbraucher erwartet.
 *
 * DIE STELLE, an der ein stiller Bruch gedroht hätte: spotify-control liest
 * `val.Title` — mit grossem T. mpv liefert je nach Dateiformat `title`,
 * `TITLE` oder `Title`. Ohne diese Umsetzung wäre der Titelname nach dem
 * Umbau einfach leer, ohne Absturz und ohne Fehlermeldung.
 * Unbekannte Felder bleiben unverändert erhalten (Nebenwirkung: nichts geht
 * verloren, wer mehr braucht, findet es).
 */
export function metadatenUmsetzen(roh: unknown): Record<string, string> {
  const res: Record<string, string> = Object.create(null)
  if (!roh || typeof roh !== 'object') return res
  const gross = new Map(META_FELDER.map((f) => [f.toLowerCase(), f]))
  for (const [k, v] of Object.entries(roh as Record<string, unknown>)) {
    if (typeof v !== 'string' && typeof v !== 'number') continue
    const ziel = gross.get(k.toLowerCase()) ?? k
    // Erster Treffer gewinnt: liefert mpv 'title' UND 'Title', ist der Inhalt
    // derselbe — doppeltes Zuweisen wäre nur Zufall, welcher gewinnt.
    if (!(ziel in res)) res[ziel] = String(v)
  }
  return res
}

/**
 * Einen von mpv gelesenen Wert in die Form des bisherigen Vertrags bringen.
 *
 * mpv liefert bereits getypt (Zahl bleibt Zahl, Wahrheitswert bleibt
 * Wahrheitswert) — anders als mplayer, wo alles Text war und der Parser
 * `NaN` erzeugen konnte. Wir geben deshalb NICHT künstlich NaN zurück,
 * sondern lassen einen fehlenden Wert `null` sein; die Hörer schreiben ihn
 * nur in `currentMeta` weiter.
 */
export function wertUmsetzen(unserName: string, roh: unknown): unknown {
  if (unserName === 'metadata') return metadatenUmsetzen(roh)
  if (unserName === 'pause') return roh === true
  // Wie `pause`: eine Wahrheitsfrage bleibt eine Wahrheitsfrage, auch wenn
  // mpv sie mal als „property unavailable" beantwortet (E109).
  if (unserName === 'idle_active') return roh === true
  if (unserName === 'time_pos' || unserName === 'length' || unserName === 'percent_pos') {
    return typeof roh === 'number' && Number.isFinite(roh) ? roh : null
  }
  if (unserName === 'filename' || unserName === 'path' || unserName === 'media_title') {
    return typeof roh === 'string' ? roh : null
  }
  return roh
}

/**
 * Darf diese Eigenschaft mit diesem Wert gemeldet werden? Pure.
 *
 * AM GERÄT PASSIERT (2026-07-27): nach dem Umschalten auf mpv starb der
 * Wiedergabedienst alle 380 ms neu — eine Absturzschleife, in der pm2 immer
 * wieder einen frischen mpv anwarf. Ursache: `filename` und `path` werden von
 * den Hörern in spotify-control.ts direkt zerlegt
 *
 *     val.split('.mp3')[0] …        val.split('/')[7]
 *
 * und mpv beantwortet beide Eigenschaften im LEERLAUF mit `null`. mplayer hat
 * sie nie gemeldet, solange nichts geladen war — die Hörer durften also
 * annehmen, dass ein Wert ankommt.
 *
 * Der Wrapper hat die Aufgabe, mplayers Verhalten nachzubilden. Ein fehlender
 * Dateiname ist keine Meldung, sondern das Ausbleiben einer Meldung: für diese
 * zwei Eigenschaften wird `null` deshalb GESCHLUCKT statt weitergereicht.
 *
 * Bewusst NUR diese beiden: bei `time_pos`/`length`/`percent_pos` ist `null`
 * eine echte Aussage („keine Position"), die die Hörer gefahrlos nach
 * currentMeta schreiben.
 *
 * `media_title` KAM AM 06.08.2026 DAZU, und aus demselben Grund — nur ist der
 * Fall hier nicht der Leerlauf, sondern der Übergang: ZWISCHEN zwei Titeln
 * schiebt mpv `media-title = null` (an der Box gemessen, mpv 0.40.0). Ein
 * Hörer, der das durchreicht, leert bei JEDEM Titelwechsel kurz die
 * Titelzeile — also genau in dem Augenblick, in dem das Kind hinschaut.
 * Die leere Zeichenkette steht mit in der Regel: einen erzwungenen Namen
 * setzen wir nur, wenn er nicht leer ist, ein leerer Wert kann also nur von
 * mpv selbst kommen und wäre ebenfalls nur ein Loch in der Anzeige.
 */
export function darfGemeldetWerden(name: string, wert: unknown): boolean {
  if (name === 'media_title') return typeof wert === 'string' && wert !== ''
  if (name === 'filename' || name === 'path') return wert !== null && wert !== undefined
  return true
}

/**
 * Die Datei-Optionen eines `loadfile` — das fünfte Element des Befehls.
 *
 * Nur Zeichenketten: mpv erwartet dort die Optionen so, wie sie auch auf der
 * Kommandozeile stünden.
 */
export type MpvDateiOptionen = Readonly<Record<string, string>>

export type MpvBefehl = Array<string | number | boolean | MpvDateiOptionen>

/**
 * Die Befehle des bisherigen Vertrags als mpv-Befehlsarrays.
 *
 * Jeder Wert ist ein eigenes Element. Ein Dateiname mit Leerzeichen, Prozent-
 * oder Anführungszeichen braucht deshalb keinerlei Behandlung.
 */
/**
 * Ein `loadfile` — wahlweise mit einem MITGEGEBENEN Titelnamen (F1).
 *
 * WOZU: `currentTrackname` bleibt bei mpv auf dem Namen stehen, den der
 * Startbefehl gesetzt hat. Rückt mpv von selbst zur nächsten Folge, geht der
 * Name nicht mit — an der Box zweimal an verschiedenen Quellen gemessen
 * (Jellyfin und ARD). Aus der DATEI ist der richtige Name nicht zu holen: bei
 * der ARD stünde dort die Doppelung „Folge | Sendung (Datum)".
 *
 * ER MUSS AUCH NICHT GEHOLT WERDEN — er liegt längst im Befehl:
 *
 *     ardqueue/<Adresse>/Zu Besuch:title:artist:Die Maus
 *
 * `force-media-title` ist in mpv eine DATEI-Option, also eine je
 * Warteschlangeneintrag. Damit trägt jeder Eintrag seinen eigenen Namen, und
 * beim Übergang meldet mpv ihn von selbst. Eine im Dienst MITGEFÜHRTE Liste
 * („Eintrag 2 heißt …") täte das nicht: der jfqueue/ardqueue-Zweig verwirft
 * einen Befehl, wenn Spotify gerade den Ton besitzt — die Folge fehlt dann in
 * mpvs Warteschlange, stünde aber in der Liste, und ab da wären alle Namen um
 * eins verschoben. Im Eintrag kann der Name nicht verrutschen: wird der
 * Eintrag verworfen, ist der Name mit ihm weg.
 *
 * DER INDEX `-1` IST PFLICHT. Die kürzere Form `loadfile <adr> append
 * {optionen}` beantwortet mpv 0.40 mit „invalid parameter" — und zwar STILL,
 * im Socket, ohne eine Zeile in der Oberfläche. Weil dann gar nichts geladen
 * würde (also: stumme Box statt falschem Namen), fängt der Wrapper einen
 * fehlgeschlagenen `loadfile` ab und schickt ihn ohne Namen nach.
 *
 * OHNE Namen bleibt der Befehl WORTGLEICH wie vorher — kein `-1`, keine
 * Optionen. Der lokale Weg (`library`, `queue`) und das Vorlesen fahren
 * damit unverändert weiter.
 */
function ladeBefehl(was: string, modus: 'replace' | 'append-play', titel?: string, ab = 0): MpvBefehl {
  // ── DER VORSPANN-SPRUNG IST EINE DATEI-OPTION, KEIN BEFEHL DANACH ───────
  // (15.08.2026, Betreiber: „jingle überspringen") Ein `seek` nach dem Start
  // traefe nur den EINEN Titel — die Folge, die mpv Stunden spaeter von
  // selbst erreicht, finge wieder beim Jingle an. Als Option am `loadfile`
  // traegt JEDER Eintrag der Warteschlange seinen Startpunkt bei sich.
  // `start` versteht mpv als Sekunden.
  const opt: Record<string, string> = {}
  if (titel) opt['force-media-title'] = titel
  if (ab > 0) opt.start = String(ab)
  if (!titel && ab <= 0) return ['loadfile', was, modus]
  return ['loadfile', was, modus, -1, opt]
}

/** Derselbe `loadfile` OHNE den Namen — der Rückfall, wenn mpv ihn ablehnt. */
export function ohneTitel(befehl: MpvBefehl): MpvBefehl | null {
  if (befehl[0] !== 'loadfile' || befehl.length < 5) return null
  return befehl.slice(0, 3)
}

export const BEFEHLE = {
  play: (was: string, titel?: string, ab = 0): MpvBefehl => ladeBefehl(was, 'replace', titel, ab),
  queue: (was: string, titel?: string, ab = 0): MpvBefehl => ladeBefehl(was, 'append-play', titel, ab),
  playList: (was: string): MpvBefehl => ['loadlist', was, 'replace'],
  queueList: (was: string): MpvBefehl => ['loadlist', was, 'append'],
  next: (): MpvBefehl => ['playlist-next', 'force'],
  previous: (): MpvBefehl => ['playlist-prev', 'force'],
  // mplayers `pause` war ein UMSCHALTER, kein "pausiere". `cycle` ist das
  // Gegenstück — ein `set pause yes` würde ein zweites Antippen verschlucken.
  playPause: (): MpvBefehl => ['cycle', 'pause'],
  stop: (): MpvBefehl => ['stop'],
  quit: (): MpvBefehl => ['quit'],
  setVolume: (n: number | string): MpvBefehl => ['set_property', 'volume', Number(n)],
  /**
   * ABSOLUT zu Titel N springen, 1-basiert.
   *
   * WOZU: mplayer kannte nur relative Schritte (`pt_step`), und genau deshalb
   * rechnete spotify-control eine Differenz aus. mpv kann es direkt — die
   * Eigenschaft `playlist-pos-1` steht oben in EIGENSCHAFTEN bereits.
   *
   * Ein absoluter Sprung ist nicht nur bequemer, er ist RICHTIGER: Die
   * Differenz stimmt nur, solange `currentMeta.currentTracknr` mit der
   * Wirklichkeit uebereinstimmt. Nach einem Titelwechsel von selbst, nach
   * einem Fehlschlag oder nach `stop` tut sie das nicht mehr, und der Sprung
   * landet dann irgendwo.
   */
  titelPos: (n: number | string): MpvBefehl => ['set_property', 'playlist-pos-1', Number(n)],
  seek: (n: number | string): MpvBefehl => ['seek', Number(n), 'absolute'],
  seekPercent: (n: number | string): MpvBefehl => ['seek', Number(n), 'absolute-percent'],
  getProp: (mpvName: string): MpvBefehl => ['get_property', mpvName],
  beobachte: (id: number, mpvName: string): MpvBefehl => ['observe_property', id, mpvName],
} as const

/** Eine Zeile für mpvs IPC-Socket: ein JSON-Objekt pro Zeile. */
export function anfrageZeile(befehl: MpvBefehl, anfrageId: number): string {
  return `${JSON.stringify({ command: befehl, request_id: anfrageId })}\n`
}

export type Meldung =
  | { art: 'antwort'; anfrageId: number; erfolg: boolean; wert: unknown }
  | { art: 'eigenschaft'; name: string; wert: unknown }
  | { art: 'titelwechsel' }
  | { art: 'listeEnde' }
  | { art: 'unbekannt' }

/**
 * Eine Zeile von mpv deuten. Pure.
 *
 * Unlesbares ergibt `unbekannt` statt einer Ausnahme: mpv schreibt auf
 * denselben Kanal gelegentlich auch Nicht-JSON, und ein Wurf hier würde den
 * Datenstrom-Hörer abreissen — also genau in dem Moment, in dem Musik läuft.
 */
export function meldungLesen(zeile: string): Meldung {
  let o: Record<string, unknown>
  try {
    o = JSON.parse(zeile) as Record<string, unknown>
  } catch {
    return { art: 'unbekannt' }
  }
  if (!o || typeof o !== 'object') return { art: 'unbekannt' }

  if (typeof o.request_id === 'number') {
    return {
      art: 'antwort',
      anfrageId: o.request_id,
      erfolg: o.error === 'success',
      wert: o.data,
    }
  }
  if (o.event === 'property-change' && typeof o.name === 'string') {
    const unser = RUECKWAERTS[o.name]
    if (!unser) return { art: 'unbekannt' }
    return { art: 'eigenschaft', name: unser, wert: wertUmsetzen(unser, o.data) }
  }
  // `file-loaded` ist mpvs Entsprechung zu mplayers "Starting playback...":
  // die Datei ist offen und die Metadaten stehen bereit.
  if (o.event === 'file-loaded') return { art: 'titelwechsel' }
  // Das Ende der Liste. mpv meldet `idle` erst, wenn nichts mehr folgt —
  // `end-file` allein feuert auch zwischen zwei Titeln und wäre falsch.
  if (o.event === 'idle') return { art: 'listeEnde' }
  return { art: 'unbekannt' }
}
