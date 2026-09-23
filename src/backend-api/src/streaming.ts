/**
 * Was die Box an Streaming-Anbietern KANN — und was davon eingerichtet ist.
 *
 * WARUM ES DIESE DATEI GIBT. Bis heute stand die Antwort auf „geht Jellyfin
 * hier eigentlich?" an drei Stellen verstreut: zwei Felder auf der
 * Konfigurationsseite (Server, Schlüssel), ein Absatz zur Spotify-Anmeldung
 * darunter und die Medienseite, die stumm keine Treffer lieferte, wenn etwas
 * fehlte. Wer die Box neu aufsetzt, muss aber ZUERST wissen, welche Quellen
 * es überhaupt gibt und welche davon antworten.
 *
 * WARUM PURE UND NICHT IM SERVER. Das hier sind Entscheidungsregeln
 * („eingerichtet heißt: Server UND Schlüssel"), keine Netzarbeit. Im
 * server.ts lägen sie hinter einem HTTP-Aufruf und wären nur am lebenden
 * Gerät prüfbar. Hier sind sie eine Funktion mit einem Argument.
 *
 * WAS HIER BEWUSST NICHT PASSIERT: es wird NICHTS angefragt. „Eingerichtet"
 * heißt „die Angaben sind vollständig", nicht „der Server antwortet". Das ist
 * eine ehrliche und eine billige Aussage; die teure („antwortet er?") gehört
 * an einen Knopf, den jemand drückt, nicht auf jeden Seitenaufruf.
 */
import { dienstAktiv } from './mixpi-anbieter'


/** Was ein Anbieter grundsätzlich beitragen kann. */
export type Faehigkeit = 'katalog' | 'suche' | 'abspielen'

/*
 * DIE BESCHRIFTUNG STEHT NICHT HIER, sondern in der Oberflaeche
 * (seiten/streaming.ts). Der erste Anlauf hatte hier eine zweite Tabelle mit
 * denselben drei Woertern — sie ging nie ueber die Leitung und war damit eine
 * zweite Wahrheit, die beim ersten Umbenennen auseinandergelaufen waere.
 * Ueber die Leitung geht die KENNUNG ('katalog'), angezeigt wird, was die
 * Seite daraus macht.
 */

/**
 * Der Stand eines Anbieters.
 *
 *   bereit         alles da, die Box kann ihn benutzen
 *   unvollstaendig etwas fehlt — WAS, sagt `warum`
 *   aus            nichts eingetragen; das ist kein Fehler, sondern eine Wahl
 *   abgeschaltet   eingerichtet oder nicht — von Hand ausgeknipst (E76).
 *                  BEWUSST EIN EIGENER STAND und kein zweites `aus`: „aus"
 *                  heißt „nie eingerichtet", und wer die beiden vermengt,
 *                  nimmt der Seite die Unterscheidung „da ist nichts" gegen
 *                  „da ist alles, es soll nur gerade nicht".
 *   geplant        im Repo gibt es dafür noch keine Zeile Code
 */
export type Stand = 'bereit' | 'unvollstaendig' | 'aus' | 'abgeschaltet' | 'geplant'

export interface Anbieter {
  id: string
  name: string
  /** Was er beitragen KANN, wenn er eingerichtet ist. */
  faehigkeiten: Faehigkeit[]
  stand: Stand
  /** Ein Satz, der den Stand begründet. Nie leer. */
  warum: string
  /**
   * Kennungen aus der FELDER-Tabelle, die diesen Anbieter einrichten.
   * Die Oberfläche zeigt genau diese Felder unter dem Anbieter — deshalb
   * stehen hier Kennungen und keine Pfade.
   */
  felder: string[]
}

/** Was der Aufrufer über die Anmeldungen wissen muss. */
export interface Lage {
  /** Die ganze Konfigurationsdatei (Geheimnisse dürfen geschwärzt sein). */
  konfig: unknown
  /**
   * Hat Spotify ein Zugangs-Merkmal? Kommt von außen, weil der
   * `refreshToken` in `ohneGeheimnisse` geleert wird — aus einer geschwärzten
   * Konfiguration ließe sich die Anmeldung nicht mehr ablesen. Genau in diese
   * Falle lief die erste Fassung: sie meldete jede Box als „nicht angemeldet".
   */
  spotifyAngemeldet: boolean
}

function text(konfig: unknown, gruppe: string, blatt: string): string {
  const g = (konfig as Record<string, unknown>)?.[gruppe]
  const w = (g as Record<string, unknown>)?.[blatt]
  return typeof w === 'string' ? w.trim() : ''
}

/**
 * Der Zustand aller Anbieter. Pure.
 *
 * Die Reihenfolge ist Absicht: erst das, was auf dieser Box tatsächlich
 * spielt, dann das Geplante. Ein „geplant" ganz oben ließe die Seite
 * aussehen, als wäre nichts fertig.
 */
export function anbieterLage(lage: Lage): Anbieter[] {
  const { konfig } = lage

  // ── Spotify ─────────────────────────────────────────────────────────────
  const clientId = text(konfig, 'spotify', 'clientId')
  let spotify: Anbieter
  if (!clientId) {
    spotify = {
      id: 'spotify',
      name: 'Spotify',
      faehigkeiten: ['katalog', 'suche', 'abspielen'],
      stand: 'aus',
      warum: 'Keine Client-ID eingetragen. Ohne sie gibt es keine Anmeldung und keine Suche.',
      felder: ['spotifyClientId', 'spotifyZwischenspeicher', 'spotifyCacheStufe', 'spotifyPlaylistSuche'],
    }
  } else if (!lage.spotifyAngemeldet) {
    spotify = {
      id: 'spotify',
      name: 'Spotify',
      faehigkeiten: ['katalog', 'suche', 'abspielen'],
      stand: 'unvollstaendig',
      warum:
        'Client-ID ist da, aber noch niemand angemeldet. Die Anmeldung läuft auf der Box selbst und nur über https.',
      felder: ['spotifyClientId', 'spotifyZwischenspeicher', 'spotifyCacheStufe', 'spotifyPlaylistSuche'],
    }
  } else {
    spotify = {
      id: 'spotify',
      name: 'Spotify',
      faehigkeiten: ['katalog', 'suche', 'abspielen'],
      stand: 'bereit',
      warum: 'Client-ID eingetragen und ein Zugangs-Merkmal hinterlegt.',
      felder: ['spotifyClientId', 'spotifyZwischenspeicher', 'spotifyCacheStufe', 'spotifyPlaylistSuche'],
    }
  }

  // ── Jellyfin ────────────────────────────────────────────────────────────
  const server = text(konfig, 'jellyfin', 'server')
  const schluessel = text(konfig, 'jellyfin', 'apiKey')
  let jellyfin: Anbieter
  if (!server && !schluessel) {
    jellyfin = {
      id: 'jellyfin',
      name: 'Jellyfin',
      faehigkeiten: ['katalog', 'suche', 'abspielen'],
      stand: 'aus',
      warum: 'Nichts eingetragen — die Box sucht dort gar nicht erst.',
      felder: ['jellyfinServer', 'jellyfinSchluessel'],
    }
  } else if (!server || !schluessel) {
    jellyfin = {
      id: 'jellyfin',
      name: 'Jellyfin',
      faehigkeiten: ['katalog', 'suche', 'abspielen'],
      stand: 'unvollstaendig',
      // BEIDE Hälften einzeln benennen: „unvollständig" allein lässt raten,
      // und genau dieses Raten kostet bei einem API-Schlüssel, den man nicht
      // zurücklesen kann, den ganzen Nachmittag.
      warum: server
        ? 'Server eingetragen, aber kein API-Schlüssel. Jellyfin antwortet dann auf nichts.'
        : 'API-Schlüssel hinterlegt, aber keine Server-Adresse. Es gibt niemanden zu fragen.',
      felder: ['jellyfinServer', 'jellyfinSchluessel'],
    }
  } else {
    jellyfin = {
      id: 'jellyfin',
      name: 'Jellyfin',
      faehigkeiten: ['katalog', 'suche', 'abspielen'],
      stand: 'bereit',
      warum: `Server ${server} eingetragen, API-Schlüssel hinterlegt.`,
      felder: ['jellyfinServer', 'jellyfinSchluessel'],
    }
  }

  const alle: Anbieter[] = [
    spotify,
    jellyfin,
    {
      /*
       * ARD SOUNDS IST SEIT 04.08.2026 GEBAUT (BACKLOG E4/A4+A5): das Modul
       * `ard.ts`, die damaligen Kernrouten `/api/ard/suche` und
       * `/api/ard/kinder` (mit E77 ersatzlos gefallen; die Suche wohnt seit
       * E79 unter `/api/plugins/mixpi-ardsounds/http/suche`), der
       * Typ `ard` in `dienstVon`/`artVon` und die Verben `ard`/`ardqueue` im
       * Abspieldienst. Bis heute stand hier trotzdem „geplant" — die Seite
       * behauptete das Gegenteil dessen, was die Box kann.
       *
       * WARUM „bereit" OHNE JEDES FELD, und warum das kein Sonderfall ist:
       * Die Audiothek braucht KEINEN Schlüssel. Gemessen am 04.08.2026
       * (tools/ard-audiothek-probe.py zugang): der GraphQL-Endpunkt antwortet
       * ohne jede Kopfzeile mit 200, ein erfundenes Bearer-Merkmal wird
       * ignoriert, 20 Anfragen hintereinander laufen ohne Drosselung. Bei
       * Spotify und Jellyfin heißt „bereit" deshalb „die Angaben sind
       * vollständig"; hier heißt es „es gibt nichts einzutragen". Ein leeres
       * `felder` ist damit die WAHRE Angabe und nicht eine fehlende — die
       * Oberfläche zeigt dann schlicht keine Liste (`k.felder.length > 0`).
       */
      id: 'ardsounds',
      name: 'ARD Sounds',
      faehigkeiten: ['katalog', 'suche', 'abspielen'],
      stand: 'bereit',
      warum:
        'Gebaut und ohne Einrichtung nutzbar — ARD Sounds (frueher Audiothek) verlangt keinen Zugangsschlüssel. Die Tonadresse wird bei jedem Abspielen frisch geholt, weil sie abläuft.',
      felder: [],
    },
    {
      id: 'deezer',
      name: 'Deezer',
      faehigkeiten: ['katalog', 'suche', 'abspielen'],
      stand: 'geplant',
      warum: 'Vorgemerkt, noch nicht entschieden. Es gibt dafür weder Code noch Konfiguration.',
      felder: [],
    },
  ]

  /* ══ DER AKTIV-SCHALTER SCHLAEGT JEDEN ANDEREN STAND (E76) ════════════════
   *
   * ALS NACHBEARBEITUNG und nicht als vierter Zweig je Anbieter: der Schalter
   * gilt unabhaengig davon, ob eingerichtet ist — ein abgeschaltetes Spotify
   * mit Client-ID und Anmeldung ist genauso abgeschaltet wie eines ohne.
   * Drei Zweige mal drei Anbieter waeren neun Stellen fuer dieselbe Regel.
   *
   * DIE FELDER BLEIBEN STEHEN, und der Schalter kommt an den ANFANG: wer
   * abgeschaltet hat, braucht genau diesen Schalter, um wieder anzuschalten —
   * eine Karte, die im Aus-Zustand ihre Felder versteckte, haette keinen
   * Rueckweg.
   *
   * Die Kennungen hier (spotify/jellyfin/ardsounds) sind die der SEITE; die
   * des Schalters (spotify/jellyfin/ard) sind die der WERKE (`dienstVon`).
   * Die Abbildung steht an dieser einen Stelle.
   */
  const schalterFeld: Record<string, { dienst: string; feld: string }> = {
    spotify: { dienst: 'spotify', feld: 'spotifyAktiv' },
    jellyfin: { dienst: 'jellyfin', feld: 'jellyfinAktiv' },
    ardsounds: { dienst: 'ard', feld: 'ardAktiv' },
  }
  for (const a of alle) {
    const s = schalterFeld[a.id]
    if (!s) continue
    a.felder = [s.feld, ...a.felder]
    if (!dienstAktiv(konfig, s.dienst)) {
      a.stand = 'abgeschaltet'
      a.warum =
        'Von Hand abgeschaltet. Die Kacheln bleiben sichtbar, sind aber ausgegraut; das Abspielen wird mit einem freundlichen Satz verweigert. Die Einrichtung bleibt erhalten — der Schalter unten macht alles rückgängig.'
    }
  }

  return alle
}

/*
 * HIER STAND `zusammenfassung(liste)` — „Kurzfassung für die Übersicht":
 * {bereit, offen, geplant}. Herausgenommen am 03.08.2026 beim Gegenlesen.
 *
 * DER GRUND ist derselbe, aus dem in diesem Umbau schon `geteilt`,
 * `bereichsangabe` und das zweite FAEHIGKEIT_TEXT herausgeflogen sind
 * ([[funktion-die-nur-ihr-eigener-test-benutzt]]) — nur eine Etage weiter:
 * die Zahlen gingen über `/api/streaming` hinaus, gelesen hat sie NIEMAND.
 * Die Übersichtsseite, für die der Name sie auswies, ist statisch und fragt
 * die Box gar nicht; die Streaming-Seite zeigt ohnehin jede Karte einzeln,
 * eine Zählung darüber sagt dort nichts Neues.
 *
 * Ein Feld in einer Antwort, das niemand liest, ist teurer als keins: Beim
 * nächsten Lesen sieht es aus wie ein tragender Teil, und wer die Zählregel
 * ändert („zählt geplant als offen?"), ändert nichts und merkt es nicht.
 *
 * WENN DIE ÜBERSICHT DIE ZAHL EINMAL ZEIGEN SOLL, gehört zur Wiederkehr die
 * Regel dazu, die hier verlorengeht und deshalb aufgeschrieben bleibt:
 * „geplant" zählt NICHT als „aus" — sonst läse sich die Zahl wie ein Mangel,
 * obwohl niemand etwas falsch gemacht hat.
 */
