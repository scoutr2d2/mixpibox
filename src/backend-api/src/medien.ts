/**
 * Medienverwaltung — die Bibliothek der Box über alle Dienste hinweg.
 *
 * REINE LOGIK: kein Dateisystem, kein Netz. Hereinkommt die Liste, heraus
 * kommt eine geordnete Sicht darauf.
 *
 * WARUM ES DIESES STÜCK GIBT: der verbliebene alte Endpunkt /api/edit
 * arbeitet mit einem INDEX in data.json (sein Loesch-Geschwister ist am
 * 19.09.2026 gefallen). Der Index ist keine
 * Identität — er verschiebt sich, sobald jemand anderes etwas einfügt oder
 * löscht, und die Oberfläche liest ihn aus active_data.json, die im
 * Offline-Betrieb eine ANDERE Liste ist (dann steht dort nur offline_data).
 * Wer darauf aufbaut, löscht früher oder später den falschen Eintrag.
 * Hier wird deshalb über einen aus dem INHALT abgeleiteten Schlüssel
 * gearbeitet.
 */

/** Die Kategorien, denen ein Eintrag zugeordnet werden kann. */
export const KATEGORIEN = ['music', 'audiobook', 'other'] as const
export type Kategorie = (typeof KATEGORIEN)[number]

export interface Eintrag {
  type: string
  category?: string
  title?: string
  artist?: string
  cover?: string
  id?: string
  playlistid?: string
  showid?: string
  audiobookid?: string
  spotify_url?: string
  /**
   * „Hier fehlt noch etwas." — gesetzt vom Mitschnitt (E89).
   *
   * ══ WARUM EIN FLAG UND NICHT EINE STUECKZAHL ═══════════════════════════
   * Eine Zahl waere aus der `playlist.m3u` ABLEITBAR, und damit haette
   * dieselbe Frage zwei Antworten, die auseinanderlaufen koennen. Was
   * dagegen NUR der Mitschnitt weiss, ist, ob sein Lauf sauber zu Ende kam:
   * ein Album mit einem einzigen Stueck kann eine Single sein — oder ein
   * abgebrochener Mitschnitt. Von aussen sieht das gleich aus.
   *
   * ══ DIE RICHTUNG IST ABSICHT ═══════════════════════════════════════════
   * Gesetzt wird es beim ANLEGEN, geloescht am Ende eines sauberen Laufs.
   * Stirbt der Mitschnitt unterwegs, loescht es NIEMAND — und die Kachel
   * sagt weiter, dass etwas fehlt. Andersherum („am Ende setzen") bliebe
   * genau der Abbruchfall stumm, also der einzige, auf den es ankommt.
   *
   * FEHLT ES, IST NICHTS BEHAUPTET. Bestandseintraege tragen es nicht, und
   * das heisst „unbekannt", nicht „vollstaendig" — dieselbe Zurueckhaltung
   * wie bei `fehlt` in werke.ts.
   */
  unvollstaendig?: boolean
  [k: string]: unknown
}

/**
 * Welchem DIENST ein Eintrag gehört — für Filter und Anzeige.
 *
 * WARUM `ard` HIER SOFORT STEHT UND NICHT ERST, WENN ES „SICH LOHNT"
 * (04.08.2026, BACKLOG E4/A5): Dieser Name landet über `medienSchluessel()`
 * im SCHLÜSSEL (`ard:81889970`), und der Schlüssel wird FESTGESCHRIEBEN — an
 * ihm hängen Verlauf (gespielt.json), Weiterhören (resume.json), Favoriten
 * und die Zuordnungen des Abgleichs. Ohne diese Zeile hieße jeder
 * ARD-Eintrag `anderes:81889970`; sie später nachzutragen wäre keine
 * Verbesserung, sondern eine Wanderung aller dieser Verweise.
 */
export function dienstVon(
  e: Eintrag,
): 'spotify' | 'jellyfin' | 'lokal' | 'radio' | 'rss' | 'ard' | 'plugin' | 'anderes' {
  const t = String(e?.type ?? '').toLowerCase()
  if (t.startsWith('spotify')) return 'spotify'
  if (t.startsWith('jellyfin')) return 'jellyfin'
  if (t === 'library' || t === 'local') return 'lokal'
  if (t === 'radio') return 'radio'
  if (t === 'rss') return 'rss'
  if (t === 'ard') return 'ard'
  // EIN EINZIGES MITGLIED FUER ALLE PLUGINS (E87), nicht eines je Plugin.
  // WELCHES Plugin gemeint ist, steht in `id` — siehe `pluginKennungAus`.
  if (t === 'plugin') return 'plugin'
  return 'anderes'
}

/* ══ PLUGIN-INHALT IN DER MEDIENLISTE (E87) ═════════════════════════════════
 *
 * ── DIE FRAGE, DIE DAS HANDBUCH OFFEN LIESS ────────────────────────────────
 * „Wie kommt Plugin-Inhalt in die Medienliste?" — bis hierher gar nicht.
 * `mixpi-ardsounds` kam nur durch, weil ARD im Kern eigene Dienste hat; jedes
 * weitere Medien-Plugin haette denselben Sonderweg gebraucht, und genau die
 * Bauart sollte das Plugin-System abschaffen.
 *
 * ── DIE FORM, UND WARUM SIE SO IST ─────────────────────────────────────────
 * Ein Eintrag traegt `type: 'plugin'` und in `id` die VOLLE Medienkennung des
 * Plugins, also `<plugin-kennung>:<rest>`:
 *
 *     { "type": "plugin", "id": "mixpi-archive:faust1teil_1412_librivox" }
 *
 * Daraus baut `medienSchluessel()` ohne Zutun `plugin:mixpi-archive:faust…`.
 * Das ist eine STABILE Identitaet: daran haengen Verlauf, Weiterhoeren und
 * Favoriten, und sie aendert sich nicht, wenn das Plugin seine Fassung
 * wechselt.
 *
 * WARUM NICHT `type: '<plugin-kennung>'` DIREKT, was verlockender aussaehe:
 * `dienstVon()` ist eine REINE Funktion. Sie kennt kein Plugin-Register und
 * kann deshalb nicht entscheiden, ob „mixpi-archive" ein geladenes Plugin ist
 * oder ein Tippfehler — beide sehen gleich aus. Sie muesste die Liste der
 * geladenen Plugins hereingereicht bekommen, und damit waere sie nicht mehr
 * rein und nicht mehr ohne Box pruefbar. Ein festes Wort davor kostet ein
 * Feld und beantwortet die Frage syntaktisch.
 *
 * WARUM DER DOPPELPUNKT NICHT STOERT: `kennungZerlegen()` (plugin-vertrag.ts)
 * teilt am ERSTEN Doppelpunkt. Auf `id` angewandt kommt genau das Richtige
 * heraus — Plugin-Kennung und Rest —, waehrend der Schluessel davor sein
 * eigenes `plugin:` traegt.
 */

/**
 * Die Medienkennung des Plugins aus einem Eintrag — oder null.
 *
 * PRUEFT NICHT, OB ES DAS PLUGIN GIBT. Das kann nur der Wirt, und er sagt es
 * mit einer verstaendlichen Meldung; hier wird nur die FORM gelesen.
 */
export function pluginKennungAus(e: Eintrag): string | null {
  if (dienstVon(e) !== 'plugin') return null
  const roh = String(e?.id ?? '').trim()
  // OHNE DOPPELPUNKT IST ES KEINE MEDIENKENNUNG, sondern ein halber Eintrag.
  // Ihn durchzulassen hiesse, dem Wirt „" als Rest zu schicken.
  const i = roh.indexOf(':')
  if (i <= 0 || i === roh.length - 1) return null
  return roh
}

/**
 * Zeichenkette auf einen vergleichbaren Kern reduzieren (Suche + Schlüssel).
 *
 * BLEIBT WIE SIE IST, obwohl sie zwei nachweisbare Schwächen hat (siehe
 * `interpretSchluesselAus` gleich darunter). Der Grund steht in
 * `medienSchluessel()`: aus dieser Funktion entsteht der ERSATZSCHLÜSSEL eines
 * Eintrags ohne Dienstkennung (`spotify:t:unknown|external playback`), und auf
 * Werkschlüsseln steht die MEDIENAUSWAHL jedes Kindes (auswahl.ts, Dateien
 * profile/<kind>/auswahl.json). Sie hier zu verbessern hieße, die Auswahl der
 * Kinder still auf fremde Schlüssel zeigen zu lassen — eine echte Wanderung,
 * für einen Gewinn, den es an dieser Stelle gar nicht gibt.
 */
export function normal(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Zeichen, die zwischen Wörtern nur TRENNEN — sie fallen weg wie bisher.
 *
 * Die Liste ist ABSICHTLICH kurz und wird aufgezählt statt umschrieben: sie ist
 * die Ausnahme, und jede Erweiterung muss sich an einem echten Namen belegen
 * lassen. Drin steht, was in Namen als Klebstoff auftritt —
 * „lismio: Kids - Hörbücher & Musik", „matze.sp.hh", „jasche-98", „AC/DC",
 * „Guns N' Roses", „Team Karacho, Rola". Nicht drin steht alles Übrige; siehe
 * die Begründung an `interpretSchluesselAus`.
 */
const TRENNZEICHEN = new Set([
  ' ',
  '\t',
  '\n',
  '\r',
  '\u00a0',
  '-',
  '‐',
  '‑',
  '‒',
  '–',
  '—',
  '_',
  '.',
  ',',
  ':',
  ';',
  '&',
  '+',
  '/',
  '\\',
  '|',
  '@',
  '·',
  "'",
  '‘',
  '’',
  '´',
  '`',
  '"',
  '‚',
  '“',
  '”',
  '«',
  '»',
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
])

/**
 * Unsichtbares — Nullbreiten, Verbinder, Darstellungswähler, weiches Trennen.
 *
 * ALS AUFZÄHLUNG UND NICHT ALS BEREICH: U+FE0F ist ein kombinierendes
 * Zeichen, und in einer Zeichenklasse neben anderen ist das eine Falle
 * (biome `noMisleadingCharacterClass` — die Klasse trifft dann nicht, was
 * dasteht). Die Alternation meint genau diese fünf und nichts sonst.
 */
const UNSICHTBAR = /\u200b|\u200c|\u200d|\ufe0f|\u00ad/g

/** Ein Buchstabe oder eine Ziffer — IRGENDEINER, nicht nur a–z. */
const ISTWORT = /[\p{L}\p{N}]/u

/**
 * DER SCHLÜSSEL DES INTERPRETEN — großzügig bei der SCHREIBWEISE, streng beim
 * ZEICHENWORT.
 *
 * ══ WARUM ES IHN GEBEN MUSS (E45-Bestandsreview, 19.08.2026) ═══════════════
 *
 * Hier stand `normal()`, und `normal()` ersetzt ALLES, was kein a–z und keine
 * Ziffer ist, durch ein Leerzeichen:
 *
 *     normal("Die drei ???")  ->  "die drei"
 *     normal("Die drei !!!")  ->  "die drei"      DERSELBE SCHLÜSSEL.
 *
 * Beides sind echte Kosmos-Kinderserien, und die Box führt „Die drei ???"
 * bereits. An diesem einen Schlüssel hängt die halbe Interpretenwelt, und jede
 * Kette wurde am Code nachgezogen:
 *
 *   1. EINE Rundkachel und EIN Regal für zwei Serien (`interpretenReihe`
 *      gruppiert nach `Werk.interpretSchluessel`).
 *   2. WER DEN EINEN FREISCHALTET, LÖSCHT DEN ANDEREN. `freischalten()` legt
 *      vorn an, `interpretenAblageAus()` behält je Schlüssel den ERSTEN —
 *      still, ohne Meldung, und die Kachel führt danach auf die falsche
 *      Spotify-Seite.
 *   3. Eine Ablehnung versteckt beide.
 *   4. Auf der Interpretenseite stehen die Werke der einen Serie unter
 *      „In deiner Box" der anderen.
 *   5. `zuPruefen` schlägt nur EINEN der beiden Namen bei Spotify nach; das
 *      Urteil gilt danach für beide.
 *
 * Für ein Kind, das nicht liest, ist das keine Kleinigkeit: es tippt auf sein
 * Gesicht und bekommt eine fremde Serie.
 *
 * ══ DIE REGEL ══════════════════════════════════════════════════════════════
 *
 * Der Name zerfällt in WÖRTER (Buchstaben und Ziffern) und ZEICHENWÖRTER
 * (alles andere, was kein bloßes Trennzeichen ist). Beide bleiben stehen,
 * durch je ein Leerzeichen getrennt:
 *
 *     "Die drei ???"                     ->  "die drei ???"
 *     "Die Drei???"                      ->  "die drei ???"    (dieselbe Serie)
 *     "Die drei !!!"                     ->  "die drei !!!"    (die andere)
 *     "lismio: Kids - Hörbücher & Musik" ->  "lismio kids horbucher musik"
 *
 * Die GROSSZÜGIGKEIT, um die es beim Gruppieren geht, bleibt vollständig
 * erhalten — Groß-/Kleinschreibung, zusammengesetzte und zerlegte Umlaute,
 * mehrfache Leerzeichen und der Klebstoff aus `TRENNZEICHEN` fallen weiter
 * zusammen. Weggeworfen wird nur noch, was nichts unterscheidet.
 *
 * ══ IN WELCHE RICHTUNG DER ZWEIFELSFALL FÄLLT ══════════════════════════════
 *
 * Es gibt zwei Fehler, und sie sind NICHT gleich teuer:
 *   (A) Zwei Interpreten teilen sich einen Schlüssel — eine Kachel für zwei,
 *       und eine Freischaltung löscht STILL die andere. Nicht zu sehen, nicht
 *       zurückzuholen.
 *   (B) Ein Interpret bekommt zwei Schlüssel („Wham!" neben „Wham") — zwei
 *       Kacheln, sichtbar, und ein berichtigter Name räumt es auf.
 * Deshalb bleibt im Zweifel ein Zeichen STEHEN. Dieselbe Abwägung, die
 * llmwiki [regal-je-interpret-gegen-verschmelzen] für die Gegenrichtung
 * trifft — dort ging es um Werke, hier um Personen.
 *
 * ══ ZWEI SCHÄDEN, DIE DABEI MIT AUFFIELEN ══════════════════════════════════
 *
 * 1. `normal()` KLEINSCHREIBT VOR NFKD, und für Zierschrift ist das die
 *    falsche Reihenfolge: „𝓛" hat keine Kleinform, NFKD macht daraus erst
 *    danach ein „L" — und das fällt dann als Nicht-a–z heraus.
 *        normal("𝓛𝓮𝓸𝓷𝓲𝓮♡") -> "eonie"      der Anfangsbuchstabe fehlt.
 *    Hier steht NFKD zuerst, danach die Kleinschreibung.
 * 2. `normal()` KENNT NUR a–z. „Straße" wurde zu „stra e", ein kyrillischer
 *    Name zur LEEREN Zeichenkette — und ein leerer Schlüssel heißt in
 *    `werkAus()` „gar kein Regal". Ein ganzer Interpret war damit unsichtbar.
 *    `ISTWORT` prüft deshalb auf Buchstabe/Ziffer, nicht auf a–z.
 *
 * ══ WAS DIESE FUNKTION NICHT IST ═══════════════════════════════════════════
 *
 * NICHT `namensSchluessel` (interpreten.ts). Der vergleicht Namen gegen
 * SPOTIFYS Treffer und entfernt gar kein Zeichen — „Gehört das zusammen?" und
 * „Ist das derselbe Interpret bei Spotify?" sind zwei Fragen, und die Messung
 * vom 03.08.2026 hat gezeigt, was ein gemeinsamer Vergleich kostet.
 * NICHT `normal` (oben). Der bleibt beim Werkschlüssel, weil dort die
 * Medienauswahl der Kinder darauf steht.
 *
 * ══ BESTANDSDATEN ══════════════════════════════════════════════════════════
 *
 * Der Schlüssel wird NIRGENDS als Wahrheit abgelegt: `Werk.interpretSchluessel`
 * entsteht bei jedem Abruf neu, und `interpretenAblageAus()` bildet den
 * `schluessel` der Ablage ausdrücklich NEU aus dem Namen, statt der Datei zu
 * glauben. Eine Änderung hier wandert deshalb von selbst mit; was in
 * config/interpreten.json noch alt dasteht, zieht `interpretenAblageWandern()`
 * einmalig nach (interpreten.ts). Die Medienauswahl der Kinder steht auf
 * WERKschlüsseln und wird gar nicht berührt.
 */
export function interpretSchluesselAus(s: unknown): string {
  const roh = String(s ?? '')
    // NFKD ZUERST, DANN kleinschreiben — siehe Schaden 1 oben.
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(UNSICHTBAR, '')
    .toLowerCase()
  const worte: string[] = []
  let lauf = ''
  let art: 'wort' | 'zeichen' | null = null
  let hatWort = false
  const schliessen = () => {
    if (lauf) worte.push(lauf)
    if (lauf && art === 'wort') hatWort = true
    lauf = ''
    art = null
  }
  // Über CODEPUNKTE, nicht über Codeeinheiten: ein Emoji ist ein Zeichen und
  // keine zwei Hälften, aus denen zwei Zeichenwörter würden.
  for (const z of roh) {
    if (TRENNZEICHEN.has(z)) {
      schliessen()
      continue
    }
    const jetzt = ISTWORT.test(z) ? 'wort' : 'zeichen'
    if (art && art !== jetzt) schliessen()
    art = jetzt
    lauf += z
  }
  schliessen()
  // KEIN EINZIGER BUCHSTABE, KEINE ZIFFER — dann ist das kein Name, sondern ein
  // Platzhalter („???" steht in getaggten Bibliotheken für „unbekannt"). Ein
  // Schlüssel daraus wäre der Sammelposten, vor dem llmwiki
  // [regal-je-interpret-gegen-verschmelzen] in Regel 1 warnt, und `normal()`
  // hat ihn genauso zurückgewiesen. Diese Zeile ist deshalb KEINE Änderung des
  // Verhaltens, sondern ihre Erhaltung — nur eben ausgesprochen, statt sich aus
  // dem Wegwerfen der Zeichen zu ergeben.
  return hatWort ? worte.join(' ') : ''
}

/**
 * Die TEILE eines Mehrnamen-Strings — als Interpretenschlüssel.
 *
 * "Team Karacho, ANOTHER NGUYEN" ist EIN `artist`-Feld, aber ZWEI Interpreten,
 * und der ganze String als `interpretSchluessel` liess solche Alben aus dem
 * Kreis "Team Karacho" herausfallen: die Rundkachel konnte für sie nie
 * mitlaufen, und die Interpretenseite zeigte sie unter "In deiner Box" nicht
 * (Betreiber, 12.09.2026: "konkret team karacho klappt es nicht").
 *
 * GETRENNT WIRD NUR AM KOMMA. `&` und `feat.` bleiben zusammen, mit Absicht:
 * "Simone Sommerland, Karsten Glück & die Kita-Frösche" zerfällt damit in
 * "simone sommerland" und "karsten glück & die kita-frösche" — der
 * Gruppenname bleibt ein Name. Wer am `&` trennte, erfände Interpreten, die
 * es nicht gibt.
 *
 * Die Aufrufer legen Kombi-Werke NUR zu Kreisen, die ohnehin bestehen
 * (Solo-Werke oder Freischaltung) — aus jedem Feature-Gast einen eigenen
 * Kreis zu machen hiesse, die Reihe mit Fremden zu fluten.
 */
export function interpretSchluesselTeile(s: unknown): string[] {
  return String(s ?? '')
    .split(',')
    .map(interpretSchluesselAus)
    .filter(Boolean)
}

/**
 * Ein stabiler Schlüssel für einen Eintrag.
 *
 * Bevorzugt die Kennung des Dienstes (die ändert sich nie), sonst Titel und
 * Interpret. Bewusst NICHT der Listenindex — siehe Kopf dieser Datei.
 */
export function medienSchluessel(e: Eintrag): string {
  const dienst = dienstVon(e)
  const kennung = e?.id || e?.playlistid || e?.showid || e?.audiobookid || e?.spotify_url
  if (kennung) return `${dienst}:${String(kennung).trim()}`
  return `${dienst}:t:${normal(e?.artist)}|${normal(e?.title)}`
}

/** Die Liste mit Schlüsseln versehen — die Sicht, die die Verwaltung bekommt. */
export function mitSchluessel(liste: Eintrag[]): (Eintrag & { schluessel: string })[] {
  return (Array.isArray(liste) ? liste : []).map((e) => ({ ...e, schluessel: medienSchluessel(e) }))
}

/**
 * Den Eintrag zu einem Schlüssel finden.
 *
 * Gibt -1 zurück, wenn es ihn nicht (mehr) gibt — der Aufrufer muss dann
 * abbrechen statt zu raten. Bei MEHREREN Treffern ebenfalls -1: doppelte
 * Schlüssel bedeuten, dass die Liste zwei gleiche Einträge enthält, und dann
 * ist nicht entscheidbar, welcher gemeint war. Lieber nichts tun als das
 * Falsche.
 */
export function findeIndex(liste: Eintrag[], schluessel: string): number {
  if (!Array.isArray(liste) || !schluessel) return -1
  let treffer = -1
  for (let i = 0; i < liste.length; i++) {
    if (medienSchluessel(liste[i]) === schluessel) {
      if (treffer >= 0) return -1
      treffer = i
    }
  }
  return treffer
}

/** Ist das eine Kategorie, die die Box kennt? */
export function istKategorie(k: unknown): k is Kategorie {
  return typeof k === 'string' && (KATEGORIEN as readonly string[]).includes(k)
}

/**
 * DIE WACHE GEGEN ADRESSEN IM TITEL — eine Kachelbeschriftung ist kein Link.
 *
 * ══ DER BEFUND, UND WAS AN IHM NICHT GEKLÄRT IST ═══════════════════════════
 * Am 04.08.2026 stand in data.json der Box .169 wörtlich:
 *
 *     title = "EMMA6 - Completehttp://192.168.178.169:8200/assets/images/nocover_mupi.png"
 *
 * Also der Titel, **ohne Trennzeichen** verklebt mit der Adresse eines
 * Platzhalterbildes. Auf dem Schirm war die Kachel damit unlesbar, und
 * `medienSchluessel()` bildet aus so einem Titel einen Schlüssel, an dem
 * Verlauf und Weiterhören hängen — die Zeile schadet also mehr als sie aussieht.
 *
 * DIE URSACHE IST **NICHT BELEGT**, und deshalb steht hier keine
 * Ursachenreparatur. Im ganzen Quelltext steht für dieses Bild überall der
 * RELATIVE Pfad (`assets/images/nocover_mupi.png`) und nirgends eine absolute
 * Adresse mit der IP der Box; die Verklebung entsteht also nicht an einer
 * Stelle, die man zeigen könnte. Was sich zeigen lässt, ist der WEG in die
 * Datei: `/api/add` und `/api/edit` schreiben den Rumpf der Anfrage
 * unverändert nach data.json — dort kommt an, was ein Formular schickt, ob es
 * nun stimmt oder nicht.
 *
 * ══ WAS SIE TUT, UND WAS SIE AUSDRÜCKLICH NICHT TUT ════════════════════════
 * Sie schneidet **nur** zusammenhängende `http://`- und `https://`-Läufe
 * heraus und lässt alles andere Zeichen für Zeichen stehen. Kein Kürzen, kein
 * Normalisieren, kein Erraten eines „gemeinten" Titels.
 *
 * SIE DARF EINEN LEGITIMEN TITEL NICHT ZERSTÖREN, und das ist die einzige
 * Regel, die wirklich zählt:
 *
 *   • Ohne `://` passiert GAR NICHTS. „AC/DC", „Die drei ???", „Folge 12: Der
 *     Fluch", „Bilder einer Ausstellung" — alle unangetastet.
 *   • Bliebe nach dem Schnitt NICHTS übrig, bleibt der Titel wie er war. Ein
 *     Eintrag, der wirklich nur eine Adresse als Namen trägt, ist eine
 *     Merkwürdigkeit; ihn zu leeren wäre eine Kachel ohne Beschriftung, und
 *     die ist auf der Box nicht wiederzufinden.
 *
 * SIE GILT BEIM SPEICHERN, NICHT BEIM LESEN. Was schon in data.json steht,
 * bleibt stehen, bis jemand es anfasst — eine Wache, die auch beim Lesen
 * putzte, verstecke den Schaden, statt ihn zu verhindern. Die Zeile von .169
 * ist am 04.08.2026 von Hand bereinigt worden (Sicherungen
 * `*.vor-titelputz-20260804T222712`).
 */
export function titelOhneAdresse(roh: unknown): string {
  const s = String(roh ?? '')
  if (!s.includes('://')) return s.trim()
  // Bis zum nächsten Leerraum — eine Adresse endet nicht an einem Komma oder
  // einer Klammer, und `nocover_mupi.png` enthält einen Unterstrich.
  const ohne = s.replace(/https?:\/\/\S*/gi, ' ')
  // Der Schnitt kann zwei Wortteile aneinanderrücken lassen; mehrfacher
  // Leerraum wird deshalb zu einem.
  const sauber = ohne.replace(/\s+/g, ' ').trim()
  // NICHTS ÜBRIG HEISST: nichts tun. Siehe oben.
  return sauber || s.trim()
}

/**
 * Dieselbe Wache für einen ganzen Roheintrag, wie ihn `/api/add` und
 * `/api/edit` **unverändert** in data.json schreiben.
 *
 * WARUM DORT UND NICHT NUR IN `neuerEintrag`: Die beiden alten Routen gehen an
 * `neuerEintrag`/`aenderungAnwenden` **vorbei** — sie nehmen den Rumpf der
 * Anfrage und legen ihn ab (`data.push(req.body)`,
 * `data.splice(i, 1, req.body.data)`). Genau das ist der Weg, auf dem der
 * verklebte Titel von .169 in die Datei gelangt sein kann; die neue Verwaltung
 * gibt es erst seit ein paar Tagen, die Zeile ist älter.
 *
 * ALLES ANDERE BLEIBT, WIE ES KOMMT. Es wird kein Feld ergänzt, keines
 * weggenommen und keines geprüft — diese Routen dürfen weiterhin schreiben,
 * was ein Formular schickt. Nur der Titel geht durch die Wache.
 */
export function mitGeputztemTitel<T>(roh: T): T {
  if (!roh || typeof roh !== 'object' || Array.isArray(roh)) return roh
  const e = roh as Record<string, unknown>
  if (typeof e.title !== 'string') return roh
  const sauber = titelOhneAdresse(e.title)
  if (sauber === e.title) return roh
  return { ...e, title: sauber } as T
}

/**
 * Änderungen an einem Eintrag übernehmen — nur die erlaubten Felder.
 *
 * Absichtlich eng: die Verwaltung darf zuordnen und beschriften, aber NICHT
 * die Kennung oder den Typ verbiegen. Sonst zeigt ein Eintrag nach dem
 * Bearbeiten auf nichts mehr, und niemand weiß, warum.
 */
export function aenderungAnwenden(alt: Eintrag, patch: Record<string, unknown>): Eintrag {
  const neu: Eintrag = { ...alt }
  if (istKategorie(patch.category)) neu.category = patch.category
  // Der TITEL darf nie leer werden: eine Kachel ohne Beschriftung ist auf der
  // Box nicht wiederzufinden. Ein leerer Wert wird deshalb ignoriert — und
  // eine hereingerutschte Adresse geschnitten (`titelOhneAdresse`).
  if (typeof patch.title === 'string' && patch.title.trim()) neu.title = titelOhneAdresse(patch.title)
  // Der INTERPRET dagegen darf geleert werden - nicht jede Liste hat einen
  // sinnvollen, und ein erzwungener Platzhalter ("Andrea68") ist schlechter
  // als gar keine Angabe.
  if (typeof patch.artist === 'string') neu.artist = patch.artist.trim()
  if (typeof patch.cover === 'string' && patch.cover.trim()) neu.cover = patch.cover.trim()
  /* SETZEN UND LOESCHEN — beides, und deshalb anders gebaut als die Felder
   * darueber (E89). Die pruefen auf „ist da und nicht leer" und lassen den
   * alten Wert sonst stehen; das ist bei Titel und Cover richtig, hier waere
   * es fatal: die Marke muss am Ende eines sauberen Laufs WEGGEHEN koennen.
   *
   * `false` loescht deshalb ausdruecklich, statt „false" zu speichern. Ein
   * gespeichertes `false` waere eine Behauptung („dieses Album ist
   * vollstaendig"), die der Mitschnitt gar nicht aufstellen kann — er weiss
   * nur, dass SEIN Lauf durch ist. */
  if (patch.unvollstaendig === true) neu.unvollstaendig = true
  else if (patch.unvollstaendig === false) delete neu.unvollstaendig
  return neu
}

/**
 * Einen neuen Eintrag aus einem Suchtreffer bauen und prüfen.
 *
 * Gibt null zurück, wenn Wesentliches fehlt — ein Eintrag ohne Kennung wäre
 * eine Kachel, die beim Antippen nichts tut.
 */
export function neuerEintrag(roh: Record<string, unknown>): Eintrag | null {
  const type = String(roh?.type ?? '').trim()
  if (!type) return null
  const e: Eintrag = {
    type,
    category: istKategorie(roh.category) ? roh.category : 'music',
    title: titelOhneAdresse(roh.title),
    artist: String(roh.artist ?? '').trim(),
  }
  for (const feld of ['id', 'playlistid', 'showid', 'audiobookid', 'spotify_url', 'cover'] as const) {
    const w = roh[feld]
    if (typeof w === 'string' && w.trim()) e[feld] = w.trim()
  }
  // NUR DAS ECHTE `true` ZAEHLT (E89). Ein „false" traegt keine Aussage und
  // hat am Eintrag nichts verloren — fehlt das Feld, heisst das „unbekannt".
  // Und `'true'` als ZEICHENKETTE zaehlt ausdruecklich nicht: sie waere in
  // JavaScript wahr und traege damit eine Behauptung, die niemand geschickt
  // hat.
  if (roh.unvollstaendig === true) e.unvollstaendig = true
  if (!e.title) return null
  const dienst = dienstVon(e)
  const hatKennung = Boolean(e.id || e.playlistid || e.showid || e.audiobookid || e.spotify_url)
  // Radio und RSS tragen ihre Adresse in `id`; alles andere braucht eine
  // Kennung des Dienstes, sonst ist der Eintrag nicht abspielbar.
  if (!hatKennung && dienst !== 'lokal') return null
  return e
}

/** Steht dieser Eintrag schon in der Liste? */
export function schonVorhanden(liste: Eintrag[], e: Eintrag): boolean {
  return findeIndex(liste, medienSchluessel(e)) >= 0
}

/**
 * Freitextsuche über die eigene Bibliothek.
 *
 * Sucht in Titel, Interpret, Kategorie und Dienst — wer „jellyfin" eingibt,
 * will die Jellyfin-Einträge sehen, und wer „hörbuch" eingibt, die Hörbücher.
 */
export function filtern(liste: (Eintrag & { schluessel: string })[], q: string): typeof liste {
  const n = normal(q)
  if (!n) return liste
  const teile = n.split(' ').filter(Boolean)
  return liste.filter((e) => {
    const heu = `${normal(e.title)} ${normal(e.artist)} ${normal(e.category)} ${dienstVon(e)}`
    return teile.every((t) => heu.includes(t))
  })
}

/**
 * Server und Schlüssel aus einer Jellyfin-Bild-Adresse herauslösen.
 *
 * Nötig, weil der Jellyfin-Zugangsschlüssel bisher NUR in der Oberfläche
 * liegt (je Herkunft im Browser) — serverseitig steht in der Konfiguration
 * bloß die Adresse. Die gespeicherten Einträge tragen ihn aber in ihrer
 * Bild-Adresse mit sich, und daraus kann die Box ihn wiedergewinnen, ohne
 * dass jemand ihn erneut eintippen muss.
 */
export function jellyfinZugangAus(coverUrl: unknown): { server: string; schluessel: string } | null {
  const s = String(coverUrl ?? '')
  const m = /^(https?:\/\/[^/]+)\/.*[?&]api_key=([^&#]+)/.exec(s)
  if (!m) return null
  return { server: m[1], schluessel: decodeURIComponent(m[2]) }
}

/**
 * Welchen Spotify-Weg braucht dieser Eintrag? — PUR.
 *
 * ══ DER FEHLER, AUS DEM DAS ENTSTAND (06.09.2026, Box .81) ═════════════════
 * „Quarks Science Cops" zeigte KEINE Folgen. Die Kette dahinter hatte drei
 * Glieder, und jedes für sich sah harmlos aus:
 *
 *   1. Der Eintrag stand als `audiobookid` in der Bibliothek — Spotify kennt
 *      die Kennung aber als SHOW (`audiobooks/<id>` → 404, `shows/<id>` → 200).
 *   2. Die Kennung wurde aus `id ?? playlistid` gelesen; bei einem Podcast
 *      sind beide leer, der Abruf endete mit „keineKennung".
 *   3. Und selbst mit Kennung lief er in den ALBUM-Zweig, weil die ART
 *      unterwegs verloren ging: drei Aufrufer legten sie nach `id` und
 *      reichten `showid` nicht weiter.
 *
 * Sichtbar war davon nur: eine Kachel ohne Inhalt. Weil dasselbe Werk mit der
 * ARD-Fassung verschmolzen ist, lieferte am Ende ARD alle Titel — Cover und
 * Schlüssel von Spotify, Inhalt von woanders. Der Betreiber sah „falsche
 * Cover" und „es öffnet einen komplett anderen Titel".
 *
 * DESHALB STEHT DIE ENTSCHEIDUNG JETZT AN EINER STELLE. Wer einen
 * Spotify-Eintrag abrufen will, fragt hier, was er ist — statt die
 * Feldnamen ein viertes Mal von Hand zu sortieren.
 *
 * REIHENFOLGE IST ABSICHT: `playlistid` zuerst (eine Playlist kann nebenbei
 * ein `id`-Feld tragen), dann die Podcast-Felder, dann `id` als Album.
 */
export function spotifyAbruf(e: unknown): { kennung: string; art: 'playlist' | 'show' | 'album' } | null {
  const b = (e ?? {}) as Record<string, unknown>
  const wort = (x: unknown) => (typeof x === 'string' ? x.trim() : '')
  const playlist = wort(b.playlistid)
  if (playlist) return { kennung: playlist, art: 'playlist' }
  // `audiobookid` ZÄHLT ALS SHOW, nicht als eigene Art: In dieser Bibliothek
  // steht dort nachweislich eine Show-Kennung (der einzige Eintrag am
  // 06.09.2026 war genau das), und Spotifys Hörbuch-Weg ist ein anderer
  // Produktzweig, den die Box nie benutzt hat. Wer echte Hörbücher aufnimmt,
  // baut hier eine vierte Art ein — und merkt es an dieser Zeile.
  const show = wort(b.showid) || wort(b.audiobookid)
  if (show) return { kennung: show, art: 'show' }
  const album = wort(b.id)
  if (album) return { kennung: album, art: 'album' }
  return null
}

/** Der Web-API-Pfad zu den Titeln eines Eintrags — eine Seite. */
export function spotifyTitelPfad(
  a: { kennung: string; art: 'playlist' | 'show' | 'album' },
  seite: number,
  proSeite: number,
): string {
  const teil = `limit=${proSeite}&offset=${seite * proSeite}&market=DE`
  if (a.art === 'playlist') return `playlists/${a.kennung}/tracks?${teil}`
  if (a.art === 'show') return `shows/${a.kennung}/episodes?${teil}`
  return `albums/${a.kennung}/tracks?${teil}`
}

/**
 * Cover-Adressen, die auf die BOX SELBST zeigen, relativ machen.
 *
 * DER BEFUND DAHINTER (AUDIT-2026-09-05-B §4, Wiki
 * [cover-wirtsname-loest-auf-tote-schnittstelle]): Die Alt-Fork-Konvention
 * schreibt Cover als ABSOLUTE Adresse mit Wirtsnamen in die Medienliste
 * (`http://MixPiBox:8200/cover/…`). Wer sie laden will — der Browser wie
 * dieser Server selbst — muss den Namen auflösen, und der Router-DNS gab am
 * Gerät zeitweise die IPv6 einer gerade ABGESCHALTETEN Schnittstelle heraus:
 * dieselben Cover luden mal ja, mal nein. Die Dateien lagen dabei immer da
 * (35× 200 über 127.0.0.1, gemessen mit tools/box/cover-adressen-probe.py).
 *
 * RELATIV IST IMMUN: `/cover/…` hängt am selben Wirt wie die Seite, egal
 * unter welchem Namen oder welcher Adresse die Box gerade gerufen wurde.
 *
 * NUR PORT 8200 UND NUR /cover/: das ist die Signatur „diese Box, statischer
 * Cover-Ordner". Fremde Adressen (Spotify-CDN, Jellyfin — die trägt den
 * api_key, aus dem jellyfinZugangAus() den Zugang gewinnt!) bleiben
 * unangetastet. Der WIRT ist bewusst egal (Name, IPv4, IPv6, localhost):
 * die Box wurde unter mehreren davon angeschrieben, und jeder veraltet.
 *
 * PUR UND AN DER LESESTELLE, nicht als Migration der Datei: die Liste wird
 * von mehreren Schreibern gepflegt (Verwaltung, Aufnahme-Plugin); eine
 * Normalisierung beim AUSLIEFERN heilt alle Bestandseinträge auf einmal und
 * kann keinem Schreiber dazwischenfunken.
 */
export function coverAufBoxRelativieren(cover: unknown): string {
  const s = String(cover ?? '')
  const m = /^https?:\/\/[^/]+:8200(\/cover\/.+)$/i.exec(s)
  return m ? m[1] : s
}

/** Den Jellyfin-Zugang aus der Bibliothek gewinnen (erster Eintrag, der ihn trägt). */
export function jellyfinZugangAusListe(liste: Eintrag[]): { server: string; schluessel: string } | null {
  for (const e of Array.isArray(liste) ? liste : []) {
    if (dienstVon(e) !== 'jellyfin') continue
    const z = jellyfinZugangAus(e.cover)
    if (z) return z
  }
  return null
}

/**
 * Treffer verschiedener Dienste zusammenführen, die DASSELBE meinen.
 *
 * Sucht man „Lumpenpack", liefern Spotify und Jellyfin oft dasselbe Album —
 * zweimal untereinander sieht aus wie zwei Alben. Hier bekommen solche Treffer
 * dieselbe `gruppe` und in `auchIn` die anderen Dienste, in denen es liegt.
 *
 * ZURÜCKHALTEND, mit Absicht. Verglichen wird der normalisierte TITEL und der
 * INTERPRET; sind bei BEIDEN Titelzahlen bekannt und verschieden, gilt es
 * NICHT als dasselbe. Genau daran unterscheiden sich Standard- und
 * Deluxe-Ausgabe, und die falsch zusammenzuwerfen wäre schlimmer als sie
 * getrennt zu lassen: der Mensch sieht zwei Zeilen und entscheidet selbst,
 * statt eine Zeile zu sehen, die das Falsche verspricht.
 *
 * Interpreten werden LOSE verglichen (einer muss im anderen vorkommen) —
 * Spotify schreibt „Das Lumpenpack", Jellyfin oft „Das Lumpenpack; Gast".
 */
export interface TrefferArtig {
  dienst: string
  art?: string
  title?: string
  artist?: string
  titelAnzahl?: number
  /**
   * Gesamtdauer in Millisekunden, wenn der Dienst sie nennt (E86).
   *
   * HEUTE NENNT SIE NIEMAND — `Werk` führt keine Gesamtdauer, und `/api/medien`
   * reicht die Einträge durch, die auch keine tragen. Das Feld steht hier,
   * damit die Regel `laenge` schon geschrieben werden kann; sie schweigt,
   * solange es fehlt.
   */
  dauerMs?: number
  [k: string]: unknown
}

function interpretenPassen(a: string, b: string): boolean {
  const x = normal(a)
  const y = normal(b)
  if (!x || !y) return true // einer sagt nichts — dann trennt es auch nicht
  return x === y || x.includes(y) || y.includes(x)
}

/* ══ DER WORTSACK (E85) ═════════════════════════════════════════════════════
 *
 * ── DER FUND, DER DAS NÖTIG MACHTE (Betreiber, 22.08.2026) ──────────────────
 * Derselbe Podcast lag in beiden Diensten und blieb getrennt:
 *
 *     ARD Sounds   Titel „Quarks Science Cops"   Interpret „WDR"
 *     Spotify      Titel „Science Cops"          Interpret „Quarks"
 *
 * Der alte Vergleich scheiterte an BEIDEN Feldern: `normal(title)` verlangte
 * Gleichheit („quarks science cops" ist nicht „science cops"), und
 * `interpretenPassen("wdr","quarks")` findet keinen im anderen. Der Betreiber
 * sah es am Bild — beide Kacheln trugen dasselbe Motiv.
 *
 * ES SIND DIESELBEN WÖRTER, nur anders auf die Felder verteilt. Genau das
 * misst der Wortsack: Titel UND Interpret zusammen, als Menge.
 *
 * ── WARUM NICHT DAS BILD ───────────────────────────────────────────────────
 * Es wäre das nächstliegende Merkmal und ist das teuerste. Gemessen: die ARD
 * liefert ein JPEG von api.ardmediathek.de (512 px, 79 397 Bytes), Spotify
 * eines von i.scdn.co in anderer Größe und mit anderem Encoder. „Gleich"
 * heißt hier VISUELL gleich, nie byteweise — das braucht einen
 * Wahrnehmungs-Hash und damit einen JPEG-Dekoder, den dieses Projekt nicht
 * hat. Der Wortsack löst denselben Fall ohne Netz, ohne Dekoder und ohne
 * neue Abhängigkeit. Das Bild wird trotzdem festgeschrieben — siehe
 * `metadatenVerschmelzen()` in verschmelzung.ts —, es taugt nur nicht zum
 * FINDEN.
 *
 * ── ZWEI REGELN, UND WARUM ES BEIDE BRAUCHT ────────────────────────────────
 * Am echten Katalog durchgespielt, mit den Gegenbeispielen daneben:
 *
 *   1. TEILMENGE der Wortsäcke. Der kleinere muss ganz im größeren stecken.
 *      Trennt „Greatest Hits/A" von „Greatest Hits/B" — dort hat jede Seite
 *      ein Wort, das die andere nicht kennt.
 *
 *   2. DECKUNG auf den TITELWÖRTERN, mindestens die Hälfte. Ohne sie risse
 *      Regel 1 einen echten Fehler auf: die WDR-Sendung „Quarks" trägt den
 *      Wortsack {quarks, wdr}, und der steckt vollständig in
 *      {quarks, science, cops, wdr}. Quarks und Quarks Science Cops sind
 *      aber ZWEI Sendungen. Mit Regel 2 fällt es auseinander — ein
 *      Titelwort von drei ist zu wenig (33 %), während „science cops"
 *      gegen „quarks science cops" auf 67 % kommt.
 *
 * DAS BLEIBT EINE VERMUTUNG, keine Auskunft. Das Wissenspaket
 * [quellen-verschmelzen] verlangt unter Punkt e ausdrücklich, dass ein Mensch
 * „das ist dasselbe" und „das ist NICHT dasselbe" festschreiben kann, weil
 * Automatik sich irrt. Diese Regel macht diesen Handbetrieb NICHT überflüssig
 * — sie verschiebt nur, wie oft er gebraucht wird.
 */

/** Titel und Interpret zu einer Wortmenge — die Felder zählen hier nicht. */
function wortsack(titel: unknown, interpret: unknown): Set<string> {
  const worte = `${normal(titel)} ${normal(interpret)}`.split(' ').filter(Boolean)
  return new Set(worte)
}

function titelWorte(titel: unknown): Set<string> {
  return new Set(normal(titel).split(' ').filter(Boolean))
}

/** Wie viele Wörter der einen Menge in der anderen stecken, als Anteil. */
function deckung(klein: Set<string>, gross: Set<string>): number {
  if (klein.size === 0) return 0
  let da = 0
  for (const w of klein) if (gross.has(w)) da++
  return da / klein.size
}

/* ══ DIE ABSTUFUNG (E86) ════════════════════════════════════════════════════
 *
 * Betreiber, 22.08.2026: „vielleicht mit abstufungs möglichkeit zum
 * ausschalten von bild vergleich oder so".
 *
 * ── WAS HIER DRINSTEHT, UND WAS ABSICHTLICH NICHT ──────────────────────────
 * Jedes Merkmal, das in diesem Regelsatz auftaucht, WIRKT. Es gibt hier
 * keinen Schalter für etwas, das noch nicht gebaut ist — das Projekt hat mit
 * genau dieser Sorte schon Lehrgeld gezahlt (BACKLOG X13: ein Dienstschalter,
 * der auf einer frisch bespielten Karte ins Leere zeigte, und niemand
 * verstand den Widerspruch).
 *
 * DESHALB FEHLEN ZWEI, DIE MAN HIER SUCHEN WÜRDE:
 *
 *   `bild`  — der Wunsch, der diese Abstufung ausgelöst hat. Gemessen
 *      22.08.2026: die ARD liefert ein JPEG von api.ardmediathek.de (512 px,
 *      79 397 Bytes), Spotify eines von i.scdn.co in anderer Größe und mit
 *      anderem Encoder. „Gleich" heißt hier VISUELL gleich, nie byteweise —
 *      das braucht einen Wahrnehmungs-Hash und damit einen JPEG-Dekoder.
 *      Das Projekt hat keine Bildbibliothek, Node bringt keinen Dekoder mit.
 *      Ein `bild: false`, das nichts abschaltet, wäre eine Zusage, die die
 *      Box nicht einlöst.
 *   `fingerabdruck` — vergleicht den TON statt der Beschriftung und ist im
 *      Plan [quellen-verschmelzen] als Punkt d beschrieben. Braucht `fpcalc`,
 *      das auf der Box nicht installiert ist (gemessen 28.07.2026), und für
 *      Spotify ohnehin erst einen Mitschnitt.
 *
 * Beide sind in `STUFEN` (verschmelzung.ts) als HERKUNFT einer Zuordnung
 * bereits vorgesehen. Wer sie baut, trägt sie hier nach — die Form steht.
 *
 * ── WARUM `laenge` TROTZDEM DRIN IST, obwohl heute niemand Dauern liefert ──
 * Sie ist KEIN toter Schalter, sondern eine Regel ohne Daten: sie trennt,
 * wenn BEIDE Seiten eine Dauer nennen und die auseinandergeht. Nennt keiner
 * eine, sagt sie nichts — genauso wie `titelzahl` sich verhält, wenn eine
 * Seite ihre Titelzahl verschweigt. Heute nennt kein Aufrufer Dauern
 * (`Werk` führt keine Gesamtdauer, `dauerMs` sitzt nur an einzelnen Titeln
 * eigener Listen); die Regel greift also erst, wenn jemand sie mitgibt. Der
 * Unterschied zum Bild ist wesentlich: hier fehlen DATEN, dort ein WERKZEUG.
 */
export interface AbgleichRegeln {
  /** Die lockere Regel aus E85. Aus = nur gleiche Titel werden zusammengefasst. */
  wortsack: boolean
  /** Wie viele Wörter der kleinere Sack mindestens haben muss. */
  mindestWorte: number
  /** Anteil des längeren Titels, den der kürzere decken muss (0 bis 1). */
  titelDeckung: number
  /** Verschiedene Titelzahlen trennen (Deluxe gegen Standard). */
  titelzahl: boolean
  /** Verschiedene Gesamtdauern trennen — wenn beide Seiten eine nennen. */
  laenge: boolean
  /** Wie weit Dauern auseinandergehen dürfen, als Anteil. */
  dauerToleranz: number
}

/** Nur gleiche Titel — der Stand vor E85, für den, dem die Automatik zu viel ist. */
export const REGELN_STRENG: AbgleichRegeln = {
  wortsack: false,
  mindestWorte: 2,
  titelDeckung: 0.5,
  titelzahl: true,
  laenge: true,
  dauerToleranz: 0.02,
}

/** Die Vorgabe: Wortsack an, beide Sicherungen an. */
export const REGELN_NORMAL: AbgleichRegeln = { ...REGELN_STRENG, wortsack: true }

/**
 * Mehr Treffer, mehr Irrtümer — und beides sichtbar.
 *
 * Ein Titelwort von dreien reicht hier (33 %), womit „Quarks" und „Quarks
 * Science Cops" zusammenfielen. Das ist KEIN Versehen, sondern der Preis
 * dieser Stufe: wer sie wählt, will lieber einmal zu viel zusammenfassen und
 * es von Hand trennen, als Paare zu übersehen.
 */
export const REGELN_LOCKER: AbgleichRegeln = { ...REGELN_NORMAL, mindestWorte: 2, titelDeckung: 0.33 }

export const ABSTUFUNGEN = { streng: REGELN_STRENG, normal: REGELN_NORMAL, locker: REGELN_LOCKER } as const
export type Abstufung = keyof typeof ABSTUFUNGEN

export function istAbstufung(s: unknown): s is Abstufung {
  return typeof s === 'string' && Object.hasOwn(ABSTUFUNGEN, s)
}

/** Zwei Zahlen widersprechen einander nur, wenn BEIDE etwas sagen. */
function widersprichtZahl(a: unknown, b: unknown): boolean {
  return typeof a === 'number' && typeof b === 'number' && a !== b
}

/**
 * Zwei Dauern widersprechen einander, wenn sie weiter auseinanderliegen als
 * die Toleranz erlaubt.
 *
 * GEMESSEN WIRD AM LÄNGEREN, nicht am Mittel: zwei Minuten Abweichung sind
 * bei einer Zwei-Minuten-Aufnahme alles und bei einem Hörbuch nichts. Der
 * Plan [quellen-verschmelzen] nennt unter Punkt c ±2 % als brauchbaren Wert,
 * an einem echten Paar erprobt.
 */
function widersprichtDauer(a: unknown, b: unknown, toleranz: number): boolean {
  const x = Number(a)
  const y = Number(b)
  if (!Number.isFinite(x) || !Number.isFinite(y) || x <= 0 || y <= 0) return false
  const gross = Math.max(x, y)
  return Math.abs(x - y) / gross > Math.max(0, toleranz)
}

/**
 * Meinen zwei Treffer dasselbe Werk? Reine Regel, kein Netz.
 *
 * Exportiert, weil sie einzeln geprüft gehört: die Gegenbeispiele im Zeugen
 * sind der eigentliche Wert dieser Funktion, nicht die Treffer.
 */
export function meinenDasselbe(a: TrefferArtig, b: TrefferArtig, regeln: AbgleichRegeln = REGELN_NORMAL): boolean {
  const titelA = titelWorte(a.title)
  const titelB = titelWorte(b.title)
  // OHNE TITEL KEINE AUSSAGE. Zwei namenlose Einträge sind nicht „dasselbe",
  // sie sind bloß beide unbeschriftet.
  if (titelA.size === 0 || titelB.size === 0) return false

  // WIDERSPRUCH SCHLÄGT ÄHNLICHKEIT — vor jeder Regel, die zusammenführt.
  // Zwei Angaben, die einander ausschließen, bleiben getrennt, egal wie
  // ähnlich die Namen klingen.
  if (regeln.titelzahl && widersprichtZahl(a.titelAnzahl, b.titelAnzahl)) return false
  if (regeln.laenge && widersprichtDauer(a.dauerMs, b.dauerMs, regeln.dauerToleranz)) return false

  // Der alte, engere Weg gilt weiter — er ist für gleiche Titel genauer,
  // weil er den Interpreten wirklich vergleicht statt ihn nur einzurechnen.
  if (normal(a.title) === normal(b.title)) {
    return interpretenPassen(String(a.artist ?? ''), String(b.artist ?? ''))
  }

  // AB HIER IST ES DIE LOCKERE REGEL. Wer sie abschaltet, bekommt genau das
  // Verhalten von vor E85 zurück: nur gleiche Titel werden zusammengefasst.
  if (!regeln.wortsack) return false

  const sackA = wortsack(a.title, a.artist)
  const sackB = wortsack(b.title, b.artist)
  const [klein, gross] = sackA.size <= sackB.size ? [sackA, sackB] : [sackB, sackA]
  // REGEL 1: der kleinere Sack muss GANZ im größeren stecken.
  if (klein.size < regeln.mindestWorte || deckung(klein, gross) < 1) return false

  /* REGEL 2: der KÜRZERE Titel muss den längeren zu `titelDeckung` decken.
   * Gefragt wird also: wie viel vom längeren Titel steht auch im kürzeren?
   *   „science cops" gegen „quarks science cops"  -> 2 von 3 = 67 %  trifft
   *   „quarks"       gegen „quarks science cops"  -> 1 von 3 = 33 %  trennt */
  const [kTitel, gTitel] = titelA.size <= titelB.size ? [titelA, titelB] : [titelB, titelA]
  return deckung(gTitel, kTitel) >= regeln.titelDeckung
}

export function gruppiereTreffer<T extends TrefferArtig>(
  treffer: T[],
  regeln: AbgleichRegeln = REGELN_NORMAL,
): (T & { gruppe: number; auchIn: string[] })[] {
  const aus = (Array.isArray(treffer) ? treffer : []).map((t) => ({ ...t, gruppe: -1, auchIn: [] as string[] }))
  let naechste = 0
  for (let i = 0; i < aus.length; i++) {
    if (aus[i].gruppe >= 0) continue
    aus[i].gruppe = naechste++
    for (let j = i + 1; j < aus.length; j++) {
      if (aus[j].gruppe >= 0) continue
      if (aus[j].dienst === aus[i].dienst) continue // derselbe Dienst: zwei Ausgaben, keine Dublette
      if (aus[j].art !== aus[i].art) continue
      // EINE STELLE, NICHT ZWEI. Die Titelzahl-Sicherung stand bis E86 hier
      // NOCH EINMAL, neben der in `meinenDasselbe`. Zwei Antworten auf
      // dieselbe Frage laufen irgendwann auseinander — und die Abstufung
      // hätte nur eine der beiden abgeschaltet.
      if (!meinenDasselbe(aus[i], aus[j], regeln)) continue
      aus[j].gruppe = aus[i].gruppe
    }
  }
  // Je Gruppe eintragen, in welchen ANDEREN Diensten es das noch gibt.
  const proGruppe = new Map<number, Set<string>>()
  for (const t of aus) {
    if (!proGruppe.has(t.gruppe)) proGruppe.set(t.gruppe, new Set())
    proGruppe.get(t.gruppe)?.add(t.dienst)
  }
  for (const t of aus) {
    t.auchIn = [...(proGruppe.get(t.gruppe) ?? [])].filter((d) => d !== t.dienst).sort()
  }
  return aus
}

/**
 * Zwei Schlüssel ohne Rücksicht auf die Reihenfolge zu EINER Zeichenkette —
 * dieselbe Regel wie `paarSchluessel` in abgleich.ts (hier nicht importiert,
 * siehe `BestaetigtePaarung`). Getrennt durch U+0000, nicht durch ein
 * Leerzeichen: ein `lokal:t:…`-Ersatzschlüssel TRÄGT Leerzeichen (`normal()`
 * trennt Wörter damit), und zwei verschiedene Paare könnten sonst dieselbe
 * zusammengesetzte Zeichenkette ergeben.
 */
function paarKennung(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`
}

/**
 * Wonach `gruppiereMitVerschmelzung` fragt — nur das Nötige aus einer
 * `Zuordnung` (verschmelzung.ts). ALS EIGENE, KLEINE FORM UND NICHT ALS
 * IMPORT: `abgleich.ts` importiert bereits AUS dieser Datei
 * (`gruppiereTreffer`, `REGELN_NORMAL`); der umgekehrte Weg wäre ein Kreis.
 */
export interface BestaetigtePaarung {
  schluessel: string
  auch: readonly string[]
}

/**
 * Wie `gruppiereTreffer`, aber mit dem, was in `config/verschmelzung.json`
 * bereits FESTSTEHT — bestätigte Zuordnungen (jede Stufe, auch „hand") und
 * ausdrückliche Trennungen (`getrennt`).
 *
 * ══ WARUM NICHT EINFACH `gruppiereTreffer` UM EINEN PARAMETER ERWEITERN ═════
 * Die Funktion hat drei weitere Aufrufer, die von einer Ablage nichts wissen
 * sollen: `zuordnungenVorschlagen` (abgleich.ts) berechnet gerade, was die
 * HEURISTIK vorschlägt — unabhängig davon, was schon bestätigt ist, sonst
 * verschwände „neu" (was seit dem letzten Abgleich dazukam) in der eigenen
 * Bestätigung. `/api/medien/:schluessel/andere` und `/api/medien/suche`
 * gruppieren SUCHTREFFER, die gar keinen Platz in der Ablage haben. Eine
 * zusätzliche Sicht für die Bibliotheksliste ist deshalb sauberer als ein
 * Parameter, den drei von vier Aufrufern ignorieren müssten.
 *
 * ══ DIE HEURISTIK BLEIBT DIE GRUNDLAGE ══════════════════════════════════════
 * `gruppiereTreffer` läuft zuerst und unverändert. Danach greifen zwei
 * Korrekturen, beide als Vereinigung von Mengen (Union-Find) über dem
 * SCHLÜSSEL — nicht über der Gruppennummer, denn die kann sich dabei ändern:
 *
 *   1. GETRENNT SCHLÄGT HEURISTIK. `gruppiereTreffer` bildet seine Gruppen als
 *      STERN: EIN Eintrag eröffnet die Gruppe (der mit dem kleinsten Index),
 *      jeder weitere wird NUR gegen DIESEN verglichen, nie gegeneinander.
 *      Jede solche Verbindung lässt sich deshalb einzeln zurücknehmen: steht
 *      das Paar (Anführer, Mitglied) in `getrennt`, wird genau diese Kante
 *      übersprungen statt gezogen — der Rest der Gruppe bleibt zusammen.
 *   2. BESTÄTIGTE ZUORDNUNGEN SCHLAGEN ALLES. Sie kommen von Hand (Verwaltung)
 *      oder von einem Plugin, das seine eigene Quelle kennt (der Mitschnitt,
 *      siehe plugins/mixpi-mitschnitt) — beides ist eine AUSSAGE, keine
 *      Vermutung, und gilt deshalb unabhängig davon, ob die Heuristik
 *      dasselbe gefunden hätte. Ein Schlüssel, den es in `treffer` nicht
 *      (mehr) gibt, wird übergangen — dieselbe Zurückhaltung wie in
 *      `verschmelzeWerke()`.
 *
 * ══ NICHTS VERSCHWINDET ══════════════════════════════════════════════════
 * Jeder übergebene Treffer steht auch im Ergebnis — nur seine `gruppe` kann
 * sich ändern. Wer zusammengehört, bekommt dieselbe Nummer; `auchIn` wird aus
 * den ENDGÜLTIGEN Gruppen neu gebildet, sonst zeigte es die Dienste von VOR
 * der Korrektur.
 */
export function gruppiereMitVerschmelzung<T extends TrefferArtig & { schluessel: string }>(
  treffer: T[],
  optionen: {
    zuordnungen?: readonly BestaetigtePaarung[]
    getrennt?: readonly (readonly string[])[]
    regeln?: AbgleichRegeln
  } = {},
): (T & { gruppe: number; auchIn: string[] })[] {
  const basis = gruppiereTreffer(treffer, optionen.regeln ?? REGELN_NORMAL)
  if (basis.length < 2) return basis

  const gesperrt = new Set<string>()
  for (const p of Array.isArray(optionen.getrennt) ? optionen.getrennt : []) {
    if (Array.isArray(p) && p.length === 2 && p[0] && p[1]) gesperrt.add(paarKennung(String(p[0]), String(p[1])))
  }

  // Union-Find über den SCHLÜSSEL — jeder Treffer beginnt als seine eigene Menge.
  const eltern = new Map<string, string>()
  for (const t of basis) if (!eltern.has(t.schluessel)) eltern.set(t.schluessel, t.schluessel)
  const wurzel = (s: string): string => {
    let x = s
    while (eltern.get(x) !== x) x = eltern.get(x) as string
    let y = s
    while (eltern.get(y) !== x) {
      const weiter = eltern.get(y) as string
      eltern.set(y, x)
      y = weiter
    }
    return x
  }
  const vereinen = (a: string, b: string) => {
    if (!eltern.has(a) || !eltern.has(b)) return // nicht in dieser Liste — nichts zu tun
    const wa = wurzel(a)
    const wb = wurzel(b)
    if (wa !== wb) eltern.set(wb, wa)
  }

  // 1. Die heuristischen STERNE nachbilden — jede Kante einzeln prüfbar.
  const jeGruppe = new Map<number, (typeof basis)[number][]>()
  for (const t of basis) {
    const liste = jeGruppe.get(t.gruppe)
    if (liste) liste.push(t)
    else jeGruppe.set(t.gruppe, [t])
  }
  for (const mitglieder of jeGruppe.values()) {
    if (mitglieder.length < 2) continue
    const anfuehrer = mitglieder[0]
    for (const m of mitglieder.slice(1)) {
      if (gesperrt.has(paarKennung(anfuehrer.schluessel, m.schluessel))) continue
      vereinen(anfuehrer.schluessel, m.schluessel)
    }
  }

  // 2. Bestätigte Zuordnungen — sie gelten, auch wenn die Heuristik geschwiegen hätte.
  for (const z of Array.isArray(optionen.zuordnungen) ? optionen.zuordnungen : []) {
    const fuehrend = String(z?.schluessel ?? '').trim()
    if (!fuehrend) continue
    for (const roh of Array.isArray(z?.auch) ? z.auch : []) {
      const s = String(roh ?? '').trim()
      if (s) vereinen(fuehrend, s)
    }
  }

  // 3. Neu nummerieren — in der Reihenfolge des ersten Auftretens.
  const neueNummer = new Map<string, number>()
  let naechste = 0
  const endgueltig = basis.map((t) => {
    const w = wurzel(t.schluessel)
    let n = neueNummer.get(w)
    if (n === undefined) {
      n = naechste++
      neueNummer.set(w, n)
    }
    return { ...t, gruppe: n }
  })

  // `auchIn` neu bilden — nach der Korrektur, nicht vor ihr.
  const dienstJeGruppe = new Map<number, Set<string>>()
  for (const t of endgueltig) {
    const s = dienstJeGruppe.get(t.gruppe) ?? new Set<string>()
    s.add(String(t.dienst))
    dienstJeGruppe.set(t.gruppe, s)
  }
  for (const t of endgueltig) {
    t.auchIn = [...(dienstJeGruppe.get(t.gruppe) ?? [])].filter((d) => d !== t.dienst).sort()
  }

  return endgueltig
}

// ── Eigene Listen der Box ────────────────────────────────────────────────────

/** Ein Titel in einer eigenen Liste — auf das Nötige eingedampft. */
export interface ListenTitel {
  quelle: 'spotify' | 'jellyfin' | 'lokal'
  title: string
  artist?: string
  uri?: string
  id?: string
  pfad?: string
  album?: string
  cover?: string
  dauerMs?: number
}

/**
 * Einen Suchtreffer in einen Listen-Titel verwandeln — oder ablehnen.
 *
 * HIER SASS EIN ECHTER FEHLER (2026-07-28): ein ALBUM landete als vermeintlicher
 * Titel in einer Liste. Einer Jellyfin-Kennung sieht man nicht an, ob sie ein
 * Album oder ein Stück meint, und diese Funktion hat sie durchgewinkt — der
 * Eintrag sah gültig aus und hätte nie gespielt. Für Spotify verhindert die
 * Prüfung auf `spotify:track:` genau das (eine Album-URI beginnt mit
 * `spotify:album:`); bei Jellyfin muss der AUFRUFER vorher fragen, was die
 * Kennung ist — das kann nur der Server, deshalb steht es dort.
 *
 * JELLYFIN NUR MIT DER ITEM-ID, nie mit fertiger Adresse: die trägt den
 * Zugangsschlüssel, und der gehört nicht in jede Zeile jeder Liste.
 */
export function listenTitelAus(roh: Record<string, unknown>): ListenTitel | null {
  const quelle = String(roh?.dienst ?? roh?.quelle ?? '').toLowerCase()
  const title = String(roh?.title ?? '').trim()
  if (!title) return null

  const t: ListenTitel = {
    quelle: quelle as ListenTitel['quelle'],
    title,
    artist: String(roh?.artist ?? '').trim(),
    dauerMs: Number(roh?.dauerMs) || undefined,
    album: String(roh?.album ?? '').trim() || undefined,
    cover: String(roh?.cover ?? '').trim() || undefined,
  }
  if (quelle === 'spotify') {
    const uri = String(roh?.uri ?? '').trim()
    // NUR Stücke: eine Album- oder Listen-URI wäre kein abspielbarer Titel.
    if (!uri.startsWith('spotify:track:')) return null
    t.uri = uri
  } else if (quelle === 'jellyfin') {
    const id = String(roh?.id ?? '').trim()
    if (!id) return null
    t.id = id
  } else if (quelle === 'lokal') {
    const pfad = String(roh?.pfad ?? '').trim()
    if (!pfad) return null
    t.pfad = pfad
  } else {
    return null
  }
  return t
}

/**
 * Sind das zweimal derselbe Titel?
 *
 * Verglichen wird die Kennung innerhalb der Quelle, NICHT der Name: zwei
 * Aufnahmen können gleich heißen, und derselbe Titel kann in zwei Diensten
 * liegen — dann ist er zweimal in der Liste, und das ist auch richtig so.
 */
export function gleicherListenTitel(a: Partial<ListenTitel>, b: Partial<ListenTitel>): boolean {
  return a.quelle === b.quelle && (a.uri ?? a.id ?? a.pfad) === (b.uri ?? b.id ?? b.pfad)
}
