/**
 * TONPFAD — den Spotify-Zweig im PipeWire-Graphen finden (BACKLOG E114).
 *
 * ══ WOZU DAS GEBRAUCHT WIRD ════════════════════════════════════════════════
 *
 * Die Mischliste (E108) spielt ein Album titelweise abwechselnd aus zwei
 * MASCHINEN: mpv fuer alles Lokale, Spotify fuer den Rest. Der Wechsel
 * zwischen beiden kostet am Geraet gemessen 1–2 Sekunden Stille, weil die
 * Spotify-Maschine erst anlaufen muss. Der Betreiber hat den Ausweg selbst
 * benannt: „wir benutzen doch pipewire das koennte man ja stumm machen auf
 * dem spotify pfad kein blub" — den Titel im STUMMEN starten lassen, puffern,
 * pausieren, auf 0 springen, und erst im Wechselmoment hoerbar machen. Alle
 * riskanten Befehle liegen dann in einem Fenster, in dem niemand zuhoert.
 *
 * Diese Datei ist der ERSTE Baustein davon und ausdruecklich NUR das: sie
 * beantwortet die Frage „WELCHE Kante im Graphen ist der Spotify-Ton?".
 * Sie schaltet nichts. Sie ruft keinen Prozess. Sie bekommt eine bereits
 * gelesene `pw-dump`-Ausgabe als Parameter herein und gibt eine BESCHREIBUNG
 * zurueck. Das Schalten steht in cue-schalter.ts, die Verdrahtung in den
 * Abspielweg steht NIRGENDS — sie braucht einen Beweis am Ton (BACKLOG E114).
 *
 * ══ DIE KARTIERUNG, AM GERAET GEMESSEN (31.08.2026, Spotify SPIELTE) ═══════
 *
 *     spotify (Stream/Output/Audio, application.name=Spotify)
 *         --> klangwerk --> klangwerk.ausgang --> alsa_output.platform-soc_…
 *     entzerrer.ausgang --> klangwerk            [das ist der mpv-Weg]
 *     spotify --> mixpi-mitschnitt               [die Aufnahme zapft VOR
 *                                                 dem Klangwerk ab]
 *     alsa_output --> mixpi-pegel                [die Pegelmessung]
 *
 * Zwei Dinge daran sind fuer diese Datei entscheidend:
 *
 * 1. BEIDE MASCHINEN LAUFEN BIS ZUM KLANGWERK GETRENNT. Der Spotify-Zweig
 *    ist einzeln schaltbar, ohne mpv anzufassen. Ohne diesen Befund waere
 *    das ganze Vorhaben gestorben.
 *
 * 2. DER MITSCHNITT ZAPFT VOR DEM KLANGWERK AB. Deshalb wird hier NICHT der
 *    Knoten stummgeschaltet (`wpctl set-mute`), obwohl das am Ton bewiesen
 *    funktioniert (Pegel ging auf [0,0,0,0], kein Knacken beim Zurueck).
 *    Mute traefe den Abgriff der Aufnahme MIT — die Aufzeichnung haette ein
 *    stilles Loch genau in der Laenge des Cues. Getrennt wird stattdessen
 *    der LINK spotify→klangwerk; die Aufnahme schneidet dann im stummen
 *    Fenster weiter mit, und genau das ist der Sinn der Selbstheilung
 *    (BACKLOG E108: der Wechselpunkt wandert, bis das Album lokal liegt).
 *
 * ══ WARUM MEHRERE KANDIDATENNAMEN ══════════════════════════════════════════
 *
 * Welche Spotify-Maschine laeuft, entscheidet `spotify.engine` in der
 * Konfiguration — librespot ODER Soloist (E42, „als alternative einfuehren
 * nicht als abloesung"). Die beiden melden sich unterschiedlich an, und
 * scripts/soloist/soloist-start.sh haelt fuer Soloist ausdruecklich fest:
 * „Der PipeWire-Knoten heisst `spotify` (nicht 'soloist')". librespot
 * wiederum traegt in vielen Fassungen `librespot` ein, kann seinen
 * `application.name` aber auch aus dem Geraetenamen bilden. Ein einziger
 * fest verdrahteter Name waere also eine Wette darauf, welche Maschine der
 * Betreiber gerade gewaehlt hat — und die verlorene Wette faende KEINE Kante
 * und schaltete stumm nichts ab. Deshalb drei Namen und drei Felder.
 *
 * Der Name allein entscheidet aber NIE. Die Klasse `Stream/Output/Audio`
 * muss dazukommen, und das ist die eigentliche Sicherung: sie schliesst die
 * Senken (`Audio/Sink`) aus und — wichtiger — die eigenen Aufnahmeknoten
 * `mixpi-mitschnitt` und `mixpi-pegel`, die als `Stream/Input/Audio`
 * laufen. Ein Werkzeug, das versehentlich den Mitschnitt trennt, waere die
 * teuerste denkbare Verwechslung.
 *
 * ══ ES WIRD NIE GEWORFEN ═══════════════════════════════════════════════════
 *
 * Dieselbe Begruendung wie in zeitschranke.ts und befehlspfad.ts: diese
 * Auswertung laeuft im Befehlszweig des Abspieldiensts. Ein geworfener
 * Fehler waere dort eine 500er Antwort statt Ton. Eine `pw-dump`-Ausgabe
 * einer fremden PipeWire-Fassung, ein abgeschnittener JSON-Text, ein `null`
 * — alles das ergibt hier „kein Plan", nicht einen Absturz. Der Aufrufer
 * bekommt zu lesen, WORAN es lag, und entscheidet selbst.
 */

// ─────────────────────────────────────────────────────────────────────────
// Was aus einer pw-dump-Ausgabe herausgelesen wird
// ─────────────────────────────────────────────────────────────────────────

/** Ein Tonknoten, auf die vier Felder eingedampft, die hier zaehlen. */
export interface TonKnoten {
  readonly id: number
  /** `node.name` — bei Soloist `spotify`, bei der Senke `klangwerk`. */
  readonly name: string
  /** `media.class` — der Riegel: nur `Stream/Output/Audio` speist ein. */
  readonly klasse: string
  /** `application.name`, leerer Text wenn das Feld fehlt. */
  readonly anwendung: string
  /** `application.process.binary`, leerer Text wenn das Feld fehlt. */
  readonly programm: string
}

/**
 * Eine Kante des Graphen. Die vier Nummern kommen aus `info` und heissen in
 * der pw-dump-Ausgabe `output-node-id`, `output-port-id`, `input-node-id`,
 * `input-port-id` — nachgelesen NICHT aus der Erinnerung, sondern gegen das
 * Programm selbst (`strings /usr/bin/pw-dump` zeigt exakt diese vier).
 */
export interface TonLink {
  readonly id: number
  readonly ausgangKnoten: number
  readonly ausgangPort: number
  readonly eingangKnoten: number
  readonly eingangPort: number
}

/** Ein auszufuehrender Befehl — als Daten, damit ihn ein Test einsammeln kann. */
export interface Befehl {
  readonly programm: string
  readonly argumente: readonly string[]
}

/** Der fertige Cue-Plan: was zu trennen ist, und was ausdruecklich bleibt. */
export interface CuePlan {
  /** Der einspeisende Spotify-Knoten. */
  readonly quelle: TonKnoten
  /** Die Senke, in die er einspeist — im Alltag `klangwerk`. */
  readonly senke: TonKnoten
  /** Die Kanten, die das Cue trennt und danach wieder herstellt. */
  readonly kanten: readonly TonLink[]
  /**
   * Kanten DESSELBEN Knotens, die absichtlich stehen bleiben — im Alltag
   * der Abgriff `spotify → mixpi-mitschnitt`. Steht im Plan, damit beim
   * Lesen sichtbar ist, dass das Auslassen eine Entscheidung war und kein
   * Uebersehen (siehe Kopfkommentar, Punkt 2).
   */
  readonly geschont: readonly TonLink[]
}

/**
 * Warum es keinen Plan gibt, ist so wichtig wie der Plan selbst — deshalb
 * eine unterscheidbare Antwort statt eines nackten `null`. „Spotify spielt
 * gerade nicht" ist der NORMALFALL (der Knoten existiert nur bei laufender
 * Wiedergabe; die Mittagsmessung des 31.08. hat genau daran einen halben Tag
 * verloren), waehrend `mehrdeutig` ein Fall ist, in dem lieber gar nichts
 * geschaltet wird.
 */
export type CueBefund =
  | { readonly art: 'bereit'; readonly plan: CuePlan }
  | { readonly art: 'kein-spotify' }
  | { readonly art: 'keine-senke'; readonly gesucht: readonly string[] }
  | { readonly art: 'keine-links'; readonly quelle: TonKnoten; readonly senke: TonKnoten }
  | { readonly art: 'mehrdeutig'; readonly kandidaten: readonly TonKnoten[] }

// ─────────────────────────────────────────────────────────────────────────
// REIN: die Merkmale
// ─────────────────────────────────────────────────────────────────────────

/** Nur DIESE Klasse speist ein. Siehe Kopfkommentar — der eigentliche Riegel. */
export const EINSPEISE_KLASSE = 'Stream/Output/Audio'

/**
 * Die Namen, unter denen sich eine Spotify-Maschine anmelden kann.
 * `spotify` (Soloist, am Geraet gemessen), `librespot` (die andere Maschine),
 * `soloist` (das Programm selbst, falls eine Fassung sich doch so eintraegt).
 */
export const SPOTIFY_NAMEN: readonly string[] = ['spotify', 'librespot', 'soloist']

/** Die Senke, in die beide Maschinen einspeisen (src/backend-api/src/ton.ts). */
export const KLANGWERK_SENKE = 'klangwerk'

/**
 * Passt ein Wert auf einen der Kandidatennamen?
 *
 * Verglichen wird KLEINGESCHRIEBEN und als GANZER Name — mit genau zwei
 * erlaubten Anhaengseln: PipeWire haengt bei Namensgleichheit eine
 * Unterscheidung an (`spotify.1`), und ein Geraetename kann als
 * `Spotify (Kinderzimmer)` ankommen. Zugelassen sind darum nur Punkt,
 * Leerraum und Klammer auf.
 *
 * BINDESTRICH UND UNTERSTRICH SIND ABSICHTLICH NICHT DABEI. Was hier nicht
 * passen darf, ist ein Name, der den Kandidaten bloss ENTHAELT: ein Knoten
 * `spotify-mitschnitt` waere sonst eine Spotify-EINSPEISUNG, und das Cue
 * trennte die Aufnahme statt des Tons. Der Kreis der erlaubten Anhaengsel
 * ist deshalb so klein wie moeglich gehalten — im Zweifel findet das Cue
 * nichts (1–2 s Stille wie bisher), statt das Falsche zu treffen.
 */
function nameTrifft(wert: string): boolean {
  const klein = wert.trim().toLowerCase()
  if (klein === '') return false
  return SPOTIFY_NAMEN.some((n) => klein === n || (klein.startsWith(n) && /[.\s(]/.test(klein.charAt(n.length))))
}

/**
 * Ist dieser Knoten die Spotify-Einspeisung?
 *
 * BEIDE Bedingungen muessen halten: die Klasse (Riegel) UND einer der drei
 * Namensplaetze. Die Reihenfolge im `||` ist keine Rangfolge — ein Treffer
 * genuegt, und mehr als eine Quelle zu befragen ist der ganze Punkt.
 */
export function istSpotifyEinspeisung(knoten: TonKnoten): boolean {
  if (knoten.klasse !== EINSPEISE_KLASSE) return false
  return nameTrifft(knoten.anwendung) || nameTrifft(knoten.name) || nameTrifft(knoten.programm)
}

// ─────────────────────────────────────────────────────────────────────────
// REIN: die pw-dump-Ausgabe auslesen — misstrauisch, ohne je zu werfen
// ─────────────────────────────────────────────────────────────────────────

/** Eine Zahl, oder `null`. `"85"` gilt: manche Fassungen liefern Text. */
function zahl(wert: unknown): number | null {
  if (typeof wert === 'number' && Number.isFinite(wert)) return wert
  if (typeof wert === 'string' && wert.trim() !== '') {
    const n = Number(wert)
    if (Number.isFinite(n)) return n
  }
  return null
}

/** Ein Text, oder leer. Fehlende Felder sind in pw-dump die Regel, kein Fehler. */
function text(wert: unknown): string {
  return typeof wert === 'string' ? wert : ''
}

/** Die Liste der Objekte — alles andere (null, Objekt, Text) ergibt eine leere. */
function objekte(dump: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(dump)) return []
  return dump.filter((o): o is Record<string, unknown> => typeof o === 'object' && o !== null)
}

function props(objekt: Record<string, unknown>): Record<string, unknown> {
  const info = objekt.info
  if (typeof info !== 'object' || info === null) return {}
  const p = (info as Record<string, unknown>).props
  return typeof p === 'object' && p !== null ? (p as Record<string, unknown>) : {}
}

function info(objekt: Record<string, unknown>): Record<string, unknown> {
  const i = objekt.info
  return typeof i === 'object' && i !== null ? (i as Record<string, unknown>) : {}
}

/** Alle Tonknoten aus der Ausgabe. Objekte ohne `id` fallen still weg. */
export function knotenAus(dump: unknown): readonly TonKnoten[] {
  const heraus: TonKnoten[] = []
  for (const o of objekte(dump)) {
    if (o.type !== 'PipeWire:Interface:Node') continue
    const id = zahl(o.id)
    if (id === null) continue
    const p = props(o)
    heraus.push({
      id,
      name: text(p['node.name']),
      klasse: text(p['media.class']),
      anwendung: text(p['application.name']),
      programm: text(p['application.process.binary']),
    })
  }
  return heraus
}

/**
 * Alle Kanten aus der Ausgabe. Eine Kante, der eine der vier Nummern fehlt,
 * ist fuer das Cue unbrauchbar (weder trennen noch zurueckverbinden waere
 * moeglich) und faellt deshalb weg, statt als halbe Kante weiterzureisen.
 */
export function linksAus(dump: unknown): readonly TonLink[] {
  const heraus: TonLink[] = []
  for (const o of objekte(dump)) {
    if (o.type !== 'PipeWire:Interface:Link') continue
    const id = zahl(o.id)
    const i = info(o)
    const ausgangKnoten = zahl(i['output-node-id'])
    const ausgangPort = zahl(i['output-port-id'])
    const eingangKnoten = zahl(i['input-node-id'])
    const eingangPort = zahl(i['input-port-id'])
    if (id === null || ausgangKnoten === null || ausgangPort === null) continue
    if (eingangKnoten === null || eingangPort === null) continue
    heraus.push({ id, ausgangKnoten, ausgangPort, eingangKnoten, eingangPort })
  }
  return heraus
}

/** Alle Knoten, die als Spotify-Einspeisung in Frage kommen, nach `id` sortiert. */
export function spotifyKandidaten(dump: unknown): readonly TonKnoten[] {
  return knotenAus(dump)
    .filter(istSpotifyEinspeisung)
    .sort((a, b) => a.id - b.id)
}

/** Die erste Senke, deren `node.name` in der Wunschliste steht. */
export function senkeFinden(dump: unknown, namen: readonly string[] = [KLANGWERK_SENKE]): TonKnoten | null {
  const alle = knotenAus(dump)
  for (const wunsch of namen) {
    const treffer = alle.find((k) => k.name === wunsch)
    if (treffer) return treffer
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────
// REIN: der Plan
// ─────────────────────────────────────────────────────────────────────────

export interface CueOptionen {
  /**
   * Die Senke, deren Zulauf getrennt wird — als LISTE, weil der erste
   * vorhandene Name gewinnt. Vorgabe ist allein `klangwerk`. Bewusst NICHT
   * mit einem Rueckfall auf `alsa_output…` versehen: ob der Spotify-Zweig
   * bei ABGESCHALTETEM Klangwerk direkt an der Karte haengt, ist NICHT
   * gemessen, und ein geratener Rueckfall traefe im Zweifel die falsche
   * Kante. Wer das misst, traegt den Namen hier ein.
   */
  readonly senkenNamen?: readonly string[]
}

/**
 * Aus einer pw-dump-Ausgabe den Cue-Plan ableiten — mit Begruendung, wenn
 * es keinen gibt.
 *
 * ══ DIE ENTSCHEIDUNG BEI ZWEI KANDIDATEN ═══════════════════════════════════
 *
 * Zwei Treffer sind kein erfundener Randfall: Soloists Knoten BLEIBT in der
 * Pause stehen (gemessen 19.08.2026, scripts/soloist/soloist-start.sh),
 * waehrend librespots verschwand. Ein Maschinenwechsel oder ein zweiter,
 * noch nicht abgeraeumter Knoten liefert also zwei Kandidaten, von denen nur
 * EINER Ton fuehrt. Die Entscheidung faellt deshalb NICHT ueber den Namen,
 * sondern ueber den Graphen: wer Kanten zur Senke hat, spielt.
 *
 * Haben ZWEI Kandidaten Kanten zur Senke, wird ausdruecklich NICHTS geplant.
 * Ein Cue, das in dieser Lage raet, trennt mit halber Wahrscheinlichkeit den
 * falschen Ton — und der Preis fuers Nichtstun ist bloss die 1–2 Sekunden
 * Stille, die es ohne das Cue ohnehin gaebe.
 */
export function cueBefundAus(dump: unknown, optionen: CueOptionen = {}): CueBefund {
  const kandidaten = spotifyKandidaten(dump)
  if (kandidaten.length === 0) return { art: 'kein-spotify' }

  const senkenNamen = optionen.senkenNamen ?? [KLANGWERK_SENKE]
  const senke = senkeFinden(dump, senkenNamen)
  if (!senke) return { art: 'keine-senke', gesucht: senkenNamen }

  const links = linksAus(dump)
  const zurSenke = (k: TonKnoten) => links.filter((l) => l.ausgangKnoten === k.id && l.eingangKnoten === senke.id)

  const spielende = kandidaten.filter((k) => zurSenke(k).length > 0)
  if (spielende.length > 1) return { art: 'mehrdeutig', kandidaten: spielende }

  // Keiner fuehrt zur Senke: der Knoten ist da, der Ton nicht. Gemeldet wird
  // der erste Kandidat, damit der Aufrufer beim Suchen weiss, WEN es gab.
  const quelle = spielende[0] ?? kandidaten[0]
  const kanten = zurSenke(quelle)
  if (kanten.length === 0) return { art: 'keine-links', quelle, senke }

  const geschont = links.filter((l) => l.ausgangKnoten === quelle.id && l.eingangKnoten !== senke.id)
  return { art: 'bereit', plan: { quelle, senke, kanten, geschont } }
}

/**
 * Der Plan, oder `null`. Die schlanke Form fuer Aufrufer, denen der Grund
 * egal ist. `cueBefundAus` bleibt daneben stehen, weil beim Suchen am Geraet
 * genau der Grund die Frage ist.
 */
export function cuePlanAus(dump: unknown, optionen: CueOptionen = {}): CuePlan | null {
  const befund = cueBefundAus(dump, optionen)
  return befund.art === 'bereit' ? befund.plan : null
}

// ─────────────────────────────────────────────────────────────────────────
// REIN: die Befehle — als Daten, nicht als Ausfuehrung
// ─────────────────────────────────────────────────────────────────────────

/**
 * Trennen: `pw-link -d <link-id>`. Die Link-Nummer genuegt, das Programm
 * kennt diese Form ausdruecklich („Disconnect: pw-link -d [options]
 * link-id", `pw-link --help`, gegengelesen 31.08.2026).
 */
export function trennBefehle(plan: CuePlan): readonly Befehl[] {
  return plan.kanten.map((k) => ({ programm: 'pw-link', argumente: ['-d', String(k.id)] }))
}

/**
 * Zurueckverbinden: `pw-link <ausgang-port> <eingang-port>` mit den
 * PORT-Nummern, nicht den Knoten-Nummern.
 *
 * Die Link-Nummer taugt hier NICHT: der Link ist beim Trennen als Objekt
 * verschwunden, seine Nummer bezeichnet nichts mehr. Die beiden PORTS
 * dagegen gehoeren zu den Knoten und ueberleben das Trennen — sie sind das
 * Einzige, woraus sich dieselbe Kante wieder herstellen laesst. Genau
 * deshalb traegt `TonLink` die Portnummern mit, obwohl zum Trennen die
 * Link-Nummer gereicht haette.
 */
export function verbindBefehle(plan: CuePlan): readonly Befehl[] {
  return plan.kanten.map((k) => ({
    programm: 'pw-link',
    argumente: [String(k.ausgangPort), String(k.eingangPort)],
  }))
}

/** Eine Zeile fuer Protokoll und Messwerkzeug — kurz, aber vollstaendig. */
export function planBeschreiben(plan: CuePlan): string {
  const kanten = plan.kanten.map((k) => `${k.ausgangPort}->${k.eingangPort} (Link ${k.id})`).join(', ')
  const geschont = plan.geschont.length > 0 ? `, geschont: ${plan.geschont.map((k) => k.id).join(', ')}` : ''
  return `${plan.quelle.name} (${plan.quelle.id}) -> ${plan.senke.name} (${plan.senke.id}): ${kanten}${geschont}`
}
