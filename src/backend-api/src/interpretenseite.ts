/**
 * Die Interpretenseite — was sie zeigt und in welcher Reihenfolge.
 *
 * REINE LOGIK: kein Netz, kein Dateisystem, kein express. Herein kommen die
 * ROHEN Antworten Spotifys (`artists/<id>`, `top-tracks`, zweimal `albums`)
 * und die Werke der Box; heraus kommt die fertige Seite.
 *
 * WOZU DIE SEITE: Der Weg zu einem Interpreten fuehrte bisher nur ueber die
 * Alben, die zufaellig in einer Playlist der Box stecken. Eine Playlist ist
 * aber eine AUSWAHL — an der Box gemessen (02.08.2026) fehlt in acht Alben der
 * Pummeleinhorn-Playlist jeweils genau EIN Titel. Ueber den Interpreten soll
 * man an ALLES kommen, so wie bei Spotify selbst.
 *
 * WARUM IM SERVER: Dieselbe Begruendung wie bei playlist-alben.ts, und sie hat
 * sich dort bewaehrt. Die Oberflaeche darf `api.spotify.com` gar nicht selbst
 * fragen (llmwiki spotify-web-api-nicht-mehr-aus-dem-browser); die Zusammen-
 * stellung laege sonst hinter einem Netzaufruf und waere nur am lebenden
 * Geraet zu pruefen — ausgerechnet die Entdopplung, an der es haengt.
 *
 * WAS DIESE DATEI ABSICHTLICH NICHT TUT: Abspielbefehle bauen. Sie liefert je
 * Eintrag die ALBUM-KENNUNG und die 1-basierte TITELNUMMER; den Befehl formt
 * allein `startPlan` in spielfunktion.ts — die Oberflaeche schickt nur den
 * Wunsch (`spielenAnfordern` -> POST /api/spielen, seit E95/V Stufe 3 fuer
 * Katalog-Werke per Kennung). Zwei Stellen, die `spotify:album:<id>:<nr>:0`
 * bauen, waeren zwei Stellen, an denen die +1-Falle (llmwiki
 * spotify-sprungziel-um-eins-verschoben) wieder einziehen kann.
 *
 * ZWEI DINGE, DIE ES BEI SPOTIFY GIBT UND HIER NICHT:
 *
 *   MONATLICHE HOERER. Die Web-API kennt sie NICHT. open.spotify.com nennt
 *   fuer Alin Coen 112.866 monatliche Hoerer, die API liefert nur
 *   `followers.total` (54.602) und `popularity` (0-100) — beides GEMESSEN am
 *   2026-08-02. Das ist eine ANDERE Zahl, nicht dieselbe kleiner. Wer die
 *   monatlichen Hoerer will, muesste die HTML-Seite abgrasen; das ist keine
 *   Schnittstelle und faellt beim naechsten Spotify-Umbau um.
 *
 *   „FANS MOEGEN AUCH". `artists/<id>/related-artists` hat Spotify am
 *   2024-11-27 fuer neue Anwendungen abgeschaltet (mit `recommendations` und
 *   `audio-features`). An der Box am 2026-08-02 mit HTTP 404 bestaetigt.
 *   Lieber gar keine Reihe als eine, die immer leer bleibt.
 */
import { interpretSchluesselAus, interpretSchluesselTeile, normal } from './medien'
import type { Werk } from './werke'

/**
 * Welche Bildadressen `/api/bild/extern` ueberhaupt holen darf.
 *
 * BEWUSST SO ENG WIE DIE WEB-API-DURCHREICHE. Ein Endpunkt, der jede Adresse
 * holt, ist ein offener Vermittler: Jeder im Netz koennte die Box beliebige
 * Server abfragen lassen — und „im Netz" ist hier keine Huerde, die Box gibt
 * ihre Mediendaten ohnehin an jeden heraus ([[zugangsschluessel-im-browser]]).
 *
 * NUR EIN NAMENSTEIL vor der Domaene, und der darf keinen Punkt enthalten:
 * sonst kaeme `evil.com.scdn.co.angreifer.de` durch. GEMESSEN an der Box
 * kommen genau zwei Formen vor — `i.scdn.co` (Alben und Interpreten),
 * `image-cdn-fa.spotifycdn.com` (Playlists).
 */
const BILD_HERKUNFT = /^[a-z0-9-]+\.(scdn\.co|spotifycdn\.com)$/i

export function bildHerkunftErlaubt(adresse: unknown): boolean {
  try {
    const ziel = new URL(String(adresse ?? ''))
    // NUR https: eine http-Adresse liesse sich unterwegs austauschen, und das
    // Ergebnis landet ohne weitere Pruefung im Coverspeicher der Box.
    return ziel.protocol === 'https:' && BILD_HERKUNFT.test(ziel.hostname)
  } catch {
    return false
  }
}

/** Ein Bild, das ueber die BOX geht — nie eine CDN-Adresse. */
export function bildDurchgereicht(adresse: unknown): string | null {
  const a = String(adresse ?? '').trim()
  if (!bildHerkunftErlaubt(a)) return null
  return `/api/bild/extern?u=${encodeURIComponent(a)}`
}

/**
 * Aus Spotifys Bilderliste das RICHTIGE Bild.
 *
 * Spotify liefert 640/320/160 px. Genommen wird das MITTLERE: Die Kacheln
 * sind 118 px, der Kopf 88 px — 640 px waeren bei 0,14 mm/px das Sechsfache
 * dessen, was der Schirm darstellen kann, und jedes davon geht einmal durch
 * das WLAN des Pi und einmal auf die SD-Karte.
 */
export function bildMittel(bilder: unknown): string | null {
  const liste = Array.isArray(bilder) ? (bilder as Array<{ url?: string }>) : []
  if (!liste.length) return null
  const gewaehlt = liste[1] ?? liste[0]
  return bildDurchgereicht(gewaehlt?.url)
}

export interface InterpretKopf {
  name: string
  bild: string | null
  /** Hoechstens zwei — auf 800 px passt keine dritte Angabe in die Zeile. */
  genres: string[]
  /** `followers.total`. AUSDRUECKLICH nicht „monatliche Hoerer", siehe Kopf. */
  follower: number
  /**
   * AUS WELCHEN DIENSTEN DIESER INTERPRET IN DIESER BOX BESTEHT (E45).
   *
   * Betreiber, 19.08.2026: „baue die interpreten so um das es meta interpreten
   * der box sind nicht nur von Spotify … falls Spotify wegbricht soll es
   * immer noch interpeten geben können … wichtig ist mir auch das die service
   * tags dort angezeigt werden."
   *
   * Gezaehlt wird ueber die WERKE der Box, nicht ueber die Herkunft der
   * Seite: ein Interpret, dessen Hoerspiele bei ARD liegen und dessen Lieder
   * lokal, traegt beide Zeichen. Spotify steht NUR dann drin, wenn wirklich
   * ein Werk von dort kommt — die blosse Tatsache, dass Spotify den
   * Interpreten kennt, ist keine Quelle in dieser Box.
   *
   * WARUM IM SERVER UND NICHT IN DER OBERFLAECHE: die Zuordnung Werk ->
   * Interpret ist hier schon getroffen (`schluesselDerBox`, zwei Namen), und
   * eine zweite Fassung derselben Regel in app.js waere genau die Drift, die
   * E43 gekostet hat.
   */
  dienste: string[]
}

export interface InterpretEintrag {
  /** Spotify-Albumkennung, oder der Werkschluessel bei eigenen Werken. */
  kennung: string
  titel: string
  /** Zweite Zeile der Kachel — Jahr, Titelzahl, Dienst. Nie erfunden. */
  unter?: string
  bild: string | null
  /**
   * NUR bei eigenen Werken: der Schluessel aus der Medienliste. Damit startet
   * die Oberflaeche ueber ihren gewohnten Weg (`spielen()`), statt fuer
   * Jellyfin, lokal und Spotify je einen zweiten zu bekommen.
   */
  schluessel?: string
  /** NUR bei „Beliebteste Titel": das Album, aus dem der Titel kommt. */
  albumKennung?: string
  /** NUR bei „Beliebteste Titel": 1-basiert, so wie Spotify sie fuehrt. */
  titelNr?: number
  /**
   * NUR bei eigenen Werken: die Dienste HINTER DIESEM Werk (E45).
   *
   * Ein verschmolzenes Album traegt mehrere — genau dafuer ist es eine Liste.
   * Fehlt das Feld, kommt der Eintrag von Spotify (Diskografie, beliebteste
   * Titel); die Oberflaeche zeichnet dort das Spotify-Zeichen, weil die
   * Herkunft der Reihe es sagt und nicht geraten werden muss.
   */
  dienste?: string[]
}

export type ReihenId = 'box' | 'top' | 'alben' | 'singles' | 'sammlungen'

export interface InterpretReihe {
  id: ReihenId
  titel: string
  eintraege: InterpretEintrag[]
  /**
   * NUR wenn Spotify MEHR fuehrt, als geholt wurde: die Gesamtzahl.
   *
   * Spotify deckelt `limit` bei 50, und an der Box gemessen (2026-08-02, ueber
   * die Durchreiche) ist das bei Hoerspielen die Regel und nicht die Ausnahme:
   *
   *     Die drei ???       308 Alben  ->  50 geliefert
   *     Bibi Blocksberg    241 Alben  ->  50 geliefert
   *     Rolf Zuckowski      53 Alben  ->  50 geliefert
   *     Alin Coen            5 Alben  ->   5 geliefert
   *
   * Ohne diese Zahl sieht eine Reihe mit 50 Kacheln aus wie „das ist alles" —
   * und genau das war der Anlass fuer die ganze Seite („eine Playlist ist eine
   * AUSWAHL"). Sie hier zu verschweigen hiesse, denselben Fehler eine Ebene
   * hoeher zu wiederholen. Gesetzt wird sie NUR beim Abschneiden; ein Eintrag,
   * der der Entdopplung zum Opfer faellt, ist kein Verlust und zaehlt nicht.
   */
  gesamt?: number
}

export interface Interpretenseite {
  kopf: InterpretKopf
  reihen: InterpretReihe[]
  /** Was NICHT geholt werden konnte — benannt, nicht verschwiegen. */
  ausfaelle: ReihenId[]
}

/** Was der Bauer bekommt. `null` heisst „nicht geholt oder fehlgeschlagen". */
export interface InterpretRohdaten {
  artist: Record<string, unknown> | null
  topTracks: Array<Record<string, unknown>> | null
  alben: Array<Record<string, unknown>> | null
  singles: Array<Record<string, unknown>> | null
  /**
   * `include_groups=compilation` — bei Spotify die Reihe „Compilations".
   *
   * NICHT dasselbe wie `appears_on`: Eine Sammlung ist eine Veroeffentlichung
   * DES Interpreten, ein `appears_on` eine fremde Platte mit einem Gastauftritt.
   * GEMESSEN (2026-08-02, ueber die Box): Rolf Zuckowski 44 Sammlungen und 60
   * `appears_on`. Die 44 gehoeren ihm und fehlten hier vollstaendig; die 60
   * bleiben absichtlich draussen (siehe unten am Bauer).
   */
  sammlungen: Array<Record<string, unknown>> | null
  /**
   * Wie viele Spotify je Reihe INSGESAMT fuehrt — das Feld `total` aus
   * DERSELBEN Antwort, aus der auch die Eintraege kommen. Kostet also keinen
   * zusaetzlichen Abruf. Fehlt es, wird nichts behauptet.
   */
  gesamt?: Partial<Record<ReihenId, number>>
  /** Die Werke der Box — daraus wird „In deiner Box". */
  werke: Werk[]
  /**
   * DER NAME, UNTER DEM DIE KACHEL ANGETIPPT WURDE — nicht bloss ein Ersatz.
   *
   * Er war urspruenglich nur der Rueckfall, falls `artists/<id>` nicht
   * antwortet. Seit es die Freischaltung gibt (interpreten.ts), ist er das
   * ZWEITE Wort in einer Frage, die vorher nur eine Antwort hatte: Ein
   * Interpret der eigenen Bibliothek wird unter seinem BIBLIOTHEKSNAMEN mit
   * der Kennung eines anders heissenden Spotify-Treffers freigeschaltet — und
   * das ist auf dieser Box der haeufigste Fall (7 von 16 Namen, gemessen
   * 2026-08-03 mit tools/interpreten-erkennung.mjs). Siehe `schluesselDerBox`.
   */
  name?: string
}

/**
 * Die reine Spotify-Kennung eines Werks, oder '' wenn es keine gibt.
 *
 * ALLE QUELLEN, NICHT NUR DIE ERSTE (berichtigt 19.08.2026, E45-Review).
 * Hier stand `w.quellen[0]`, und das war richtig, solange jedes Werk genau
 * eine Quelle hatte. Seit dem Verschmelzen (E17) traegt ein Werk mehrere,
 * und VORN steht die BEVORZUGTE — lokal oder Jellyfin. Die Spotify-Kennung
 * fiel damit hinten herunter, die Entdopplung gegen die Diskografie griff
 * nicht, und dasselbe Album stand zweimal auf der Seite: einmal unter „In
 * deiner Box", einmal unter „Alben".
 */
function spotifyKennungVon(w: Werk): string {
  for (const q of Array.isArray(w?.quellen) ? w.quellen : []) {
    if (!q || q.dienst !== 'spotify') continue
    const roh = String(q.kennung ?? '').trim()
    const netz = /open\.spotify\.com\/(?:intl-[a-z-]+\/)?[a-z]+\/([A-Za-z0-9]+)/.exec(roh)
    if (netz) return netz[1]
    const verweis = /^spotify:[a-z]+:([A-Za-z0-9]+)$/.exec(roh)
    if (verweis) return verweis[1]
    if (/^[A-Za-z0-9]{22}$/.test(roh)) return roh
  }
  return ''
}

/** Die Dienste hinter einem Werk, ohne Dubletten, in der Reihenfolge der Quellen. */
function diensteVon(w: Werk): string[] {
  const raus: string[] = []
  for (const q of Array.isArray(w?.quellen) ? w.quellen : []) {
    const d = String(q?.dienst ?? '').trim()
    if (d && !raus.includes(d)) raus.push(d)
  }
  return raus
}

/** Das Jahr aus `release_date` (`2019`, `2019-03`, `2019-03-08`). */
function jahrVon(datum: unknown): string {
  const m = /^(\d{4})/.exec(String(datum ?? ''))
  return m ? m[1] : ''
}

/**
 * Ein Veroeffentlichungs-Eintrag als Kachel.
 *
 * Die Unterzeile nennt Jahr und Titelzahl — beides steht in der Antwort und
 * ist genau das, was zwei gleichnamige Fassungen unterscheidbar macht (das
 * Album von 2015 gegen die Neuauflage von 2021).
 */
function albumEintrag(a: Record<string, unknown>): InterpretEintrag | null {
  const kennung = String(a?.id ?? '').trim()
  if (!kennung) return null
  const jahr = jahrVon(a?.release_date)
  const anzahl = Number(a?.total_tracks) || 0
  const teile = [jahr, anzahl ? `${anzahl} Titel` : ''].filter(Boolean)
  return {
    kennung,
    titel: String(a?.name ?? '').trim(),
    unter: teile.join(' · ') || undefined,
    bild: bildMittel(a?.images),
  }
}

/**
 * Die ganze Seite.
 *
 * DIE REIHENFOLGE IST EINE ABWEICHUNG VOM VORBILD, und zwar mit Absicht:
 * Spotify beginnt mit den beliebtesten Titeln, hier steht „In deiner Box"
 * vorn. Das Kind sucht auf dieser Box zuerst das, was es KENNT — und diese
 * Reihe ist ausserdem die einzige, die ohne einen einzigen Netzabruf
 * dasteht. Danach folgt Spotifys eigene Anordnung: Beliebteste, Alben,
 * Singles und EPs.
 *
 * ENTDOPPELT WIRD QUER UEBER ALLE REIHEN, ueber die Albumkennung: Ein Album,
 * das schon in der Box liegt, taucht in „Alben" nicht noch einmal auf.
 * Innerhalb einer Reihe zusaetzlich ueber den normalisierten Namen — Spotify
 * fuehrt dieselbe Veroeffentlichung gern mehrfach, und drei Fassungen
 * desselben Titels nebeneinander sehen aus wie ein Fehler der Box.
 *
 * „ERSCHEINT AUF" WIRD NICHT GEBAUT (`include_groups=appears_on`; bei Alin
 * Coen 27, bei Rolf Zuckowski 60 Eintraege — 2026-08-02 gemessen). Das sind
 * FREMDE Platten, auf denen der Interpret einen Gastauftritt hat; auf einer
 * Kinderbox ist das die Reihe, die in die Irre fuehrt. NICHT zu verwechseln
 * mit `compilation` — das sind EIGENE Sammlungen, und die stehen seit heute
 * als Reihe „Sammlungen" drin.
 */
export function interpretenseiteBauen(roh: InterpretRohdaten): Interpretenseite {
  const artist = roh.artist ?? null
  const name = String(artist?.name ?? roh.name ?? '').trim()
  const follower = Number((artist?.followers as { total?: unknown } | undefined)?.total) || 0
  const genres = (Array.isArray(artist?.genres) ? (artist.genres as unknown[]) : [])
    .map((g) => String(g ?? '').trim())
    .filter(Boolean)
    .slice(0, 2)

  // Der Kopf wird UNTEN fertiggestellt: Bild und Dienste haengen an den
  // eigenen Werken, und die kennt der Bauer erst nach der Box-Reihe.
  const kopf: InterpretKopf = { name, bild: bildMittel(artist?.images), genres, follower, dienste: [] }

  const reihen: InterpretReihe[] = []
  const ausfaelle: ReihenId[] = []
  // Quer ueber alle Reihen: was einmal steht, steht nicht noch einmal.
  const gesehen = new Set<string>()

  // ── In deiner Box ────────────────────────────────────────────────────────
  //
  // Zugeordnet ueber `interpretSchluessel` — dasselbe Feld, nach dem auch das
  // Regal gruppiert (werke.ts). Es hier ein zweites Mal aus dem Namen zu
  // rechnen waere die dritte Fassung derselben Regel, und genau daraus stammt
  // der bis heute offene Fall [box-kachel-zeigt-fremde-quelle].
  //
  // ZWEI NAMEN, NICHT EINER — und das ist eine Reparatur, kein Zusatz.
  //
  // Hier stand nur `normal(name)`, und `name` ist `artist.name` von Spotify
  // (der Ersatzname der Kachel greift nur, wenn `artists/<id>` ausfaellt).
  // Solange die Reihe allein aus Namensgleichheit entstand, war das dasselbe.
  // Seit der Freischaltung ist es das NICHT mehr: Die Verwaltung schickt
  // ausdruecklich die Kennung eines Spotify-Treffers MIT dem
  // BIBLIOTHEKSNAMEN (llmwiki [interpreten-verwaltungsseite]), damit die
  // Kachel ihre eigenen Werke behaelt — und genau dafuer gibt es sie, denn
  // sieben von sechzehn Namen dieser Box kennt Spotify anders.
  //
  // GEMESSEN (2026-08-03, tools/interpret-freigeschaltet-seite.mjs, ohne Box
  // und ohne Netz): „EUROPA Hörspiele & Kinderlieder" mit der Kennung von
  // „EUROPA" freigeschaltet steht MIT seinem Werk in der Reihe — auf seiner
  // Seite fehlte „In deiner Box" aber ganz, weil
  // normal("EUROPA") != normal("EUROPA Hörspiele & Kinderlieder"). Das Kind
  // tippt also auf die Kachel, unter der sein Hoerspiel gezaehlt wird, und das
  // Hoerspiel ist dort nicht mehr.
  //
  // WARUM ES GEFAHRLOS IST, BEIDE ZU NEHMEN: Es sind Werke DIESER Box, und
  // beide Schluessel gehoeren zu genau der Kachel, die angetippt wurde. Die
  // Entdopplung ueber `gesehen` weiter unten faengt den Fall ab, dass beide
  // Namen dieselben Werke treffen.
  //
  // DERSELBE SCHLUESSEL WIE AM WERK — seit 19.08.2026 also
  // `interpretSchluesselAus` und nicht mehr `normal()` (E45-Bestandsreview,
  // Begruendung in medien.ts). Waere hier `normal()` stehengeblieben, traefe
  // der Vergleich seit dem Umbau GAR NICHTS mehr: das Werk traegt
  // „die drei ???", gesucht wuerde „die drei". „In deiner Box" waere leer —
  // dieselbe leere Reihe wie im Fall „EUROPA", nur aus dem umgekehrten Grund.
  const schluesselDerBox = new Set([interpretSchluesselAus(name), interpretSchluesselAus(roh.name)].filter(Boolean))
  // AUCH DIE MEHRNAMEN-WERKE (12.09.2026): "Du schaffst das schon" gehoert
  // "Team Karacho, ANOTHER NGUYEN" — der ganze String traf den Seitennamen
  // nie, das Album fehlte unter "In deiner Box", waehrend die REIHE es dem
  // Kreis inzwischen zuzaehlt (interpretenReihe, Schritt 1b). Kreis und
  // Seite muessen dieselbe Antwort geben, sonst tippt das Kind auf einen
  // markierten Kreis und das laufende Album ist dahinter nicht zu finden.
  // Dieselbe Regel, dieselbe Funktion: Teile nur am Komma.
  const eigene = (Array.isArray(roh.werke) ? roh.werke : []).filter(
    (w) =>
      w?.interpretSchluessel &&
      (schluesselDerBox.has(w.interpretSchluessel) ||
        interpretSchluesselTeile(w.interpret).some((t) => schluesselDerBox.has(t))),
  )
  const boxEintraege: InterpretEintrag[] = []
  for (const w of eigene) {
    // DERSELBE SCHLUESSEL ZWEIMAL IST EIN EINTRAG. Auf der Box liegt die
    // Playlist 2QqQXuDKNR8HK1cFxf0NhW in ZWEI Kategorien und kommt in
    // /api/werke doppelt zurueck (gemessen 2026-08-02) — ungefiltert stuenden
    // hier zwei gleiche Kacheln nebeneinander.
    if (gesehen.has(w.schluessel)) continue
    gesehen.add(w.schluessel)
    const spot = spotifyKennungVon(w)
    if (spot) gesehen.add(spot)
    const dienste = diensteVon(w)
    // JE KACHEL IHRE ZEICHEN (E45): ein verschmolzenes Album traegt beide.
    for (const d of dienste) if (!kopf.dienste.includes(d)) kopf.dienste.push(d)
    boxEintraege.push({
      kennung: spot || w.schluessel,
      titel: w.titel,
      bild: w.bild,
      schluessel: w.schluessel,
      dienste: dienste.length ? dienste : undefined,
    })
  }
  if (boxEintraege.length) reihen.push({ id: 'box', titel: 'In deiner Box', eintraege: boxEintraege })

  /* ══ DER KOPF FAELLT AUF DIE BOX ZURUECK (E45) ═══════════════════════════
   *
   * Betreiber, 19.08.2026: „falls Spotify wegbricht soll es immer noch
   * interpeten geben können … der interpet ist … nicht nur von Spotify."
   *
   * Ohne Spotify-Antwort (kein Netz, keine Kennung, gesperrtes Konto) hatte
   * der Kopf bisher NUR den Namen: kein Bild, keine Zahl, nichts. Die eigenen
   * Werke tragen aber ein Cover, und das ist ein besseres Gesicht als ein
   * grauer Kasten mit einem Buchstaben. Es wird NUR genommen, wenn Spotify
   * keines liefert — ein echtes Interpretenbild bleibt immer vorn.
   */
  if (!kopf.bild) {
    const mitBild = boxEintraege.find((e) => e.bild)
    if (mitBild) kopf.bild = mitBild.bild
  }

  // ── Beliebteste Titel ────────────────────────────────────────────────────
  //
  // GESTARTET WIRD UEBER DAS ALBUM, nicht ueber `spotify:track:`. Grund:
  // spotify-control.ts setzt fuer alles ausser `episode` ein `context_uri`,
  // und ein einzelner Titel ist als Kontext ungueltig. Deshalb reisen
  // Albumkennung und 1-basierte Titelnummer mit — den Befehl
  // `spotify:album:<id>:<nr>:0` baut die Oberflaeche daraus, so wie sie es
  // fuer die Album-Lane bereits bewiesen tut.
  if (roh.topTracks === null) {
    ausfaelle.push('top')
  } else {
    const top: InterpretEintrag[] = []
    for (const t of roh.topTracks) {
      const album = (t?.album ?? {}) as Record<string, unknown>
      const albumKennung = String(album?.id ?? '').trim()
      const nr = Number(t?.track_number) || 0
      // Ohne Album oder Nummer gaebe es keinen Weg zum Ton — eine Kachel, die
      // nichts startet, ist ein Versprechen ohne Deckung.
      if (!albumKennung || nr < 1) continue
      const kennung = String(t?.id ?? '').trim() || `${albumKennung}:${nr}`
      if (gesehen.has(kennung)) continue
      gesehen.add(kennung)
      top.push({
        kennung,
        titel: String(t?.name ?? '').trim(),
        unter: String(album?.name ?? '').trim() || undefined,
        bild: bildMittel(album?.images),
        albumKennung,
        titelNr: nr,
      })
    }
    if (top.length) reihen.push({ id: 'top', titel: 'Beliebteste Titel', eintraege: top })
  }

  // ── Alben, Singles, Sammlungen ───────────────────────────────────────────
  //
  // DIESELBE ORDNUNG WIE BEI SPOTIFY, und „Sammlungen" ist Spotifys
  // „Compilations". Sie fehlte, und das war kein kleiner Rest: bei Rolf
  // Zuckowski sind es 44 Veroeffentlichungen (2026-08-02 an der Box gemessen),
  // also mehr als seine 21 Singles. Bei Alin Coen, Bibi Blocksberg und
  // Die drei ??? sind es null — die Reihe faellt dann von selbst weg, denn
  // eine leere Reihe wird gar nicht erst gebaut.
  const veroeffentlichungen: Array<{ id: ReihenId; titel: string; roh: Array<Record<string, unknown>> | null }> = [
    { id: 'alben', titel: 'Alben', roh: roh.alben },
    { id: 'singles', titel: 'Singles und EPs', roh: roh.singles },
    { id: 'sammlungen', titel: 'Sammlungen', roh: roh.sammlungen },
  ]
  for (const v of veroeffentlichungen) {
    if (v.roh === null) {
      ausfaelle.push(v.id)
      continue
    }
    const namenDieserReihe = new Set<string>()
    const eintraege: InterpretEintrag[] = []
    // NEUESTES ZUERST. Ohne Sortierung kommt Spotifys eigene Ordnung, und die
    // ist bei `include_groups` nicht zugesichert.
    const sortiert = [...v.roh].sort((a, b) =>
      String(b?.release_date ?? '').localeCompare(String(a?.release_date ?? '')),
    )
    for (const a of sortiert) {
      const e = albumEintrag(a)
      if (!e) continue
      if (gesehen.has(e.kennung)) continue
      const kern = normal(e.titel)
      if (kern && namenDieserReihe.has(kern)) continue
      gesehen.add(e.kennung)
      if (kern) namenDieserReihe.add(kern)
      eintraege.push(e)
    }
    if (!eintraege.length) continue
    // ABGESCHNITTEN heisst: Spotify fuehrt mehr, als GEHOLT wurde — nicht
    // „mehr, als uebrig blieb". Wer eine Doppelung wegwirft, verliert nichts
    // und braucht darueber nichts zu sagen; wer bei 308 nach 50 aufhoert, sehr
    // wohl.
    const gesamt = Number(roh.gesamt?.[v.id]) || 0
    const reihe: InterpretReihe = { id: v.id, titel: v.titel, eintraege }
    if (gesamt > v.roh.length) reihe.gesamt = gesamt
    reihen.push(reihe)
  }

  return { kopf, reihen, ausfaelle }
}
