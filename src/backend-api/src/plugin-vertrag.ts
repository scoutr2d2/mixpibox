/**
 * Der Plugin-Vertrag — was ein Fremdentwickler schreibt und was er dafuer bekommt.
 *
 * REINE LOGIK: keine Uhr, kein Dateisystem, kein Netz, kein Worker. Alles kommt
 * herein, heraus kommt ein Urteil — dieselbe Bauart wie kinderzeit.ts, und aus
 * demselben Grund: ein Manifestfehler, der erst beim Laden auf der Box auffaellt,
 * kostet einen Fremdentwickler einen Abend. Hier ist er in einem Test zu fassen.
 *
 * DIE NAMEN SIND DEUTSCH, wie im ganzen Baum (kinderzeit, weiterhoeren,
 * verschmelzung). Der Entwurf schrieb `resolveMedia`/`checkHealth`; das waere
 * die einzige englische Insel im Haus gewesen, und Fremdentwickler lesen
 * ohnehin die deutschen Beispiele daneben.
 */

// Der Zeilendeckel und die Zeilenform stehen in songtext.ts, nicht hier noch
// einmal: die Pruefung des Vertrags und die Auswertung im Kern muessen
// dieselbe Grenze meinen, sonst nimmt der Wirt an, was der Kern verwirft.
import { ZEILEN_DECKEL, type Songzeile } from './songtext'

/**
 * Was ein Plugin duerfen darf. Mehr Rechte gibt es nicht — die Liste ist die Grenze.
 *
 * `aufnahme` FAELLT AUS DER REIHE, und das gehoert hierhergeschrieben: die
 * anderen drei sind Schluessel zu etwas, das der Kontext reicht. Dieses ist
 * eine ANSAGE. Ein Worker darf `node:child_process` ohnehin importieren (siehe
 * den Kopf von plugin-laufwerk.ts) — das Recht haelt niemanden auf, der es
 * nicht eintraegt. Es steht in der Liste, damit im Eltern-Bereich LESBAR ist,
 * dass dieses Plugin mitschneidet, statt dass man es aus dem Quelltext erfaehrt.
 * Fuer E28 ist genau das eine Auflage: sichtbar, wo der Schalter sitzt.
 *
 * `klang` (21.08.2026) ist wieder ein Schluessel, aber zu etwas Neuem: das
 * Plugin wird nach einer FILTERKETTE gefragt (`klangkette()`, siehe unten) und
 * haengt damit im Signalweg der ganzen Box. Deshalb ist es ein eigenes Recht
 * und nicht Teil von `ereignisse`: wer die Plugin-Liste im Eltern-Bereich
 * liest, soll sehen, dass hier etwas am Ton mitrechnet. Was ein solches
 * Plugin beschreiben darf, ist ein geschlossenes Vokabular in klangkette.ts —
 * ausdruecklich KEIN freier PipeWire-Text, denn dessen Bausteine (`convolver`,
 * `ladspa`) laden Dateien nach.
 */
/*
 * `geraetestand` (E82) schaltet `kontext.geraet` frei: BENANNTE, lesende
 * Blicke auf den Geraetezustand (Dienst laeuft?, Soloist-Bau, Anmeldung,
 * Warnungsdatei) — eine geschlossene Liste von Rezepten im Laufwerk, kein
 * freier Befehl. EHRLICH GESAGT ist das eine Beschriftung, kein Kaefig
 * (wie bei `holen`): der Worker ist nicht eingesperrt, aber wer die
 * Plugin-Liste liest, sieht, dass dieses Plugin am Geraet horcht.
 */
/*
 * `songtext` (E84/B2) schaltet die Methode `songtext(titel, kontext)` frei: das
 * Plugin bekommt Interpret, Titel und DAUER des laufenden Stuecks und liefert
 * Zeilen mit Zeitmarken zurueck.
 *
 * WARUM EIN EIGENES RECHT UND NICHT `medienquelle`: die beiden beantworten
 * verschiedene Fragen. `medienquelle` heisst „ich sage, WAS gespielt wird" —
 * das Plugin bestimmt den Ton. `songtext` heisst „ich sage etwas UEBER das,
 * was ohnehin laeuft"; es bestimmt nichts, es beschriftet. Ein Textlieferant
 * braucht deshalb kein `medienquelle`, und wer die Plugin-Liste im
 * Eltern-Bereich liest, soll den Unterschied sehen: das eine waehlt aus, was
 * das Kind hoert, das andere nicht.
 *
 * WARUM ES UEBERHAUPT DEN KERN BRAUCHT (und `http()` nicht reicht): eigene
 * Plugin-Routen liegen hinter dem Tor der Verwaltung und erreichen den
 * Kinderschirm ausdruecklich nicht, und `fundPruefen` baut den Fund aus sechs
 * Feldern neu auf — ein Text laesst sich an ihn nicht anhaengen. Genau diese
 * doppelte Sperre nennt BACKLOG E84/B2 als Grund, warum das ein
 * Anmeldepunkt wird und kein Plugin-Sonderweg.
 */
export const RECHTE = ['medienquelle', 'ereignisse', 'netz', 'aufnahme', 'klang', 'geraetestand', 'songtext'] as const
export type Recht = (typeof RECHTE)[number]

/** Systemereignisse, auf die ein Plugin horchen kann. */
export const EREIGNISSE = ['wiedergabeGestartet', 'wiedergabeGestoppt', 'lautstaerke', 'kinderzeitEnde'] as const
export type Ereignisname = (typeof EREIGNISSE)[number]

/** Ein abspielbarer Fund: was mpv/librespot bekommt, plus was der Schirm zeigt. */
export interface Quelle {
  /** `strom` = URL fuer mpv (MP3/HLS). `datei` = Pfad auf der Box. */
  art: 'strom' | 'datei'
  adresse: string
}

export interface Titel {
  name: string
  kuenstler?: string
  /** Bild-URL. Wird vom Kern ueber die Offline-Ablage geschickt, nicht direkt geladen. */
  bild?: string
  dauerSek?: number
}

export interface Fund {
  titel: Titel
  quelle: Quelle
}

/**
 * EIN WERK MIT GEORDNETEN FOLGEN (E78) — das Gegenstueck zu `aufloesen`.
 *
 * `aufloesen` liefert genau EINEN Fund; eine Sendung, ein Album, ein Feed
 * sind aber LISTEN, und die Oberflaeche spielt sie als Warteschlange (erste
 * Folge starten, Rest anhaengen). Bis E78 konnte das nur der Kern — die
 * Kartierung vom 22.08.2026 nannte es als erste der vier Strukturluecken,
 * an denen eine Anbieter-Migration scheitert.
 *
 * DIE REIHENFOLGE IST TEIL DER ANTWORT: die Liste kommt so, wie sie gespielt
 * werden soll. Wuensche (aelteste/neueste zuerst) reist im `rest`, wie beim
 * Podcast-Plugin die Folgennummer — hinter `#`.
 */
export interface Folge {
  /** Die dauerhafte Kennung der Folge beim Anbieter — NIE die Tonadresse. */
  kennung: string
  name: string
  kuenstler?: string
  bild?: string
  dauerSek?: number
  quelle: Quelle
}

export interface Inhalt {
  titel: string
  /** Wer unter der Kachel steht — beim Radio der Sender, beim Album der Interpret. */
  kuenstler?: string
  folgen: Folge[]
  /**
   * `false` heisst: es gibt beim Anbieter mehr, als hier steht (Abfragegrenze
   * erreicht). Die Oberflaeche zeigt dann an, dass die Liste ein Ausschnitt
   * ist, statt sie fuer das Ganze auszugeben.
   */
  vollstaendig: boolean
}

/**
 * Was ein Plugin an Einstellungen BRAUCHT — und wie der Eltern-Bereich danach
 * fragen soll.
 *
 * WOZU EINE ERKLAERUNG STATT EINES FREIEN OBJEKTS: ohne sie muesste jeder
 * Plugin-Autor eine eigene Bedienoberflaeche mitliefern (die es nicht gibt),
 * oder die Eltern muessten JSON tippen. Mit ihr kann EINE Seite im
 * Eltern-Bereich jedes Plugin bedienen — sie liest die Felder und baut die
 * Eingaben daraus.
 */
export const FELDARTEN = ['text', 'zahl', 'schalter', 'geheim'] as const
export type Feldart = (typeof FELDARTEN)[number]

export interface Feld {
  /** Unter diesem Namen steht der Wert in `kontext.einstellungen`. */
  schluessel: string
  art: Feldart
  /** Was ueber dem Eingabefeld steht. */
  name: string
  /** Ein Satz darunter. Optional, aber fast immer die Muehe wert. */
  hinweis?: string
  vorgabe?: string | number | boolean
}

/**
 * WO ein Plugin sich in der Verwaltung ANMELDET (E77, 22.08.2026).
 *
 * Betreiber: „das plugin system soll ermoeglichen die steuerung in die
 * jeweilige sektion zu haengen wie heute auch" und „plugins so bauen das die
 * sich anmelden koennen in sektionen".
 *
 * DIE RICHTUNG IST DER PUNKT: das Plugin sagt „ich gehoere in die ARD-Karte",
 * nicht die Karte „ich kenne dieses Plugin". Vorher war jede solche Beziehung
 * im Kern fest verdrahtet (der Klangwerk-Abschnitt der Ton-Seite fragt
 * `gibtKlangPlugins()`) — mit jedem Plugin eine Stelle mehr.
 *
 * EIN GESCHLOSSENES VOKABULAR wie bei Feldarten und Klanggliedern: eine
 * Sektion ist ein Ort, den die Verwaltung WIRKLICH hat. Ein freier Text
 * hiesse, dass ein Plugin sich an einen Ort haengt, den es nicht gibt, und
 * niemand merkt es. Die Liste waechst mit der Verwaltung.
 */
export const SEKTIONEN = [
  'streaming/spotify',
  'streaming/jellyfin',
  'streaming/ardsounds',
  'ton',
  'medien',
] as const
export type Sektion = (typeof SEKTIONEN)[number]

/**
 * WELCHE KERN-KONFIGURATION ein Plugin einsehen darf (E80, 22.08.2026).
 *
 * ══ WARUM NICHT EIGENE PLUGIN-FELDER ═══════════════════════════════════════
 *
 * Die Zugaenge der Anbieter (jellyfin.server, jellyfin.apiKey) wohnen in der
 * Kern-Konfiguration und werden von der Streaming-Karte verwaltet — samt dem
 * E76-Schalter daneben. Eigene Plugin-Felder hiessen: dieselben Werte an
 * zwei Orten, ein Migrationsskript fuer jede Bestandsbox, und zwei
 * Verwaltungsflaechen fuer eine Sache. Stattdessen MELDET das Plugin AN,
 * welche Gruppen es braucht, und der Wirt reicht sie in den Kontext — genau
 * das stroeme-Muster des Rechts `aufnahme`.
 *
 * ══ EINE GESCHLOSSENE LISTE, KEIN FREIER GRIFF ═════════════════════════════
 *
 * `spotify` steht BEWUSST NICHT darin: dort liegen refreshToken und
 * clientSecret — Geheimnisse, die kein Plugin je braucht, um zu spielen
 * (Abspielen laeuft ueber den Kern). Was ein Plugin einsehen darf, ist eine
 * Kern-Entscheidung je Gruppe, nicht je Plugin.
 *
 * `maschine` (E82) ist KEINE Dateigruppe, sondern wird vom Kern BERECHNET
 * (kernKonfigGruppen in server.ts): {engine, hatSchluessel}. Die Engine-
 * Plugins sehen damit, welche Tonmaschine gewaehlt ist und OB ein
 * Soloist-Schluessel hinterlegt ist — nie den Schluessel selbst. Und weil
 * sie eine Gruppe wie jede andere ist, greift der E80-Neustart: wer die
 * Engine umschaltet, startet genau die Plugins neu, die `maschine`
 * angemeldet haben.
 */
export const KONFIG_GRUPPEN = ['jellyfin', 'ard', 'maschine'] as const
export type KonfigGruppe = (typeof KONFIG_GRUPPEN)[number]

/**
 * Ein Knopf, den die Verwaltung fuer das Plugin zeigt (E77).
 *
 * DEKLARATIV WIE DIE FELDER, aus demselben Grund: die Verwaltung ist
 * kompiliertes Angular, ein Plugin kann keine Oberflaeche nachliefern. Es
 * meldet an, WELCHE Handgriffe es anbietet; EINE generische Komponente baut
 * die Knoepfe und ruft `aktion(kennung)` im Worker. Was zurueckkommt, ist
 * dieselbe Form wie bei `befinden`: ok + ein Satz.
 */
export interface Aktion {
  /** Unter dieser Kennung wird `aktion()` gerufen. Gleiche Regeln wie Feld-Schluessel. */
  kennung: string
  /** Was auf dem Knopf steht. */
  name: string
  /** Ein Satz daneben. Optional. */
  hinweis?: string
}

/**
 * Ein Schluessel wird zu einem Feld in einem Objekt.
 *
 * `__proto__`, `constructor` und `prototype` sind deshalb keine Geschmacksfrage:
 * ein Plugin, das `__proto__` als Schluessel anmeldet, veraendert beim Schreiben
 * der Einstellungen den Prototyp — und damit den ganzen Prozess, nicht nur sich
 * selbst.
 */
const SCHLUESSEL = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/
const VERBOTEN = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * Das Manifest (`plugin.json`).
 *
 * `kennung` IST der Namensraum — sie ist zugleich das Schema-Praefix
 * (`mupibox-podcast:…`) und das Routenstueck (`/api/plugins/mupibox-podcast/`).
 * Der Entwurf liess Plugins ihr Praefix WAEHLEN (`"schemes": ["deezer"]`); dann
 * melden zwei Plugins `deezer:` an und die Ladereihenfolge entscheidet, welche
 * Sendung ein Kind hoert. Abgeleitet statt angemeldet ist der Konflikt nicht
 * geloest, sondern unmoeglich — und npm entscheidet die Eindeutigkeit fuer uns.
 */
export interface Manifest {
  kennung: string
  /** Anzeigename fuer die Oberflaeche. Beschriftung, nicht Schluessel. */
  name: string
  fassung: string
  /** Einstiegsdatei, relativ zum Plugin-Ordner. */
  haupt: string
  rechte: Recht[]
  /** Was der Eltern-Bereich abfragen soll. Leer ist der Normalfall. */
  felder: Feld[]
  /** Wo in der Verwaltung dieses Plugin erscheint (E77). Ohne: nur auf der Plugin-Seite. */
  sektion?: Sektion
  /**
   * Ein Bild, das das Plugin MITBRINGT (E77) — Dateiname relativ zum
   * Plugin-Ordner, nur .svg oder .png. Betreiber: „icons mit bringen die
   * eingehaengt werden koennen". Kein Icon-Katalog im Kern: das Bild gehoert
   * dem Plugin und reist mit ihm. Ausgeliefert wird es vom Wirt unter
   * `/api/plugins/<kennung>/icon` — nie als freier Pfad.
   */
  icon?: string
  /** Knoepfe, die die Verwaltung fuer dieses Plugin zeigt (E77). */
  aktionen: Aktion[]
  /** Kern-Konfigurationsgruppen, die dieses Plugin einsehen darf (E80). */
  konfig: KonfigGruppe[]
}

/**
 * Eine Kennung muss ein DATEINAME und ein URL-STUECK sein duerfen.
 *
 * Sie landet in `/api/plugins/<kennung>/` und in einem Pfad unter dem
 * Plugin-Ordner. `..`, `/` und Grossbuchstaben sind deshalb keine
 * Geschmacksfrage: `..` waere ein Ausbruch aus dem Ordner, Grossbuchstaben
 * brechen auf Dateisystemen, die nicht zwischen Gross und Klein unterscheiden.
 * Dieselbe Vorsicht wie `kennungPruefen` in profile.ts.
 */
const KENNUNG = /^[a-z][a-z0-9-]{2,63}$/
/** Drei Zahlen, durch Punkte getrennt — mehr will hier niemand auswerten. */
const FASSUNG = /^\d+\.\d+\.\d+$/

export interface ManifestUrteil {
  ok: boolean
  /** Bei ok: das geputzte Manifest. Sonst null. */
  manifest: Manifest | null
  /** Was fehlt, im Klartext. Geht so an den Entwickler, darum ausformuliert. */
  maengel: string[]
}

/**
 * Fremde Eingaben zu einem gueltigen Manifest — oder zu einer Liste von Maengeln.
 *
 * ANDERS ALS BEI DEN REGELN DER KINDERZEIT WIRD HIER NICHTS GEBOGEN.
 * `regelnNormalisieren` biegt kaputte Werte auf die freundliche Seite, weil eine
 * kaputte Konfigurationsdatei ein Kind nicht aussperren darf. Hier ist es
 * umgekehrt: ein Manifest, das man errichtig-biegt, laedt ein Plugin mit
 * Rechten, die sein Autor nie hinschrieb. Im Zweifel wird NICHT geladen.
 */
export function manifestPruefen(roh: unknown): ManifestUrteil {
  const maengel: string[] = []
  const r = (roh ?? {}) as Record<string, unknown>
  const text = (feld: string): string => (typeof r[feld] === 'string' ? (r[feld] as string).trim() : '')

  const kennung = text('kennung')
  if (!kennung) maengel.push('`kennung` fehlt — sie ist zugleich Namensraum und Routenstueck.')
  else if (!KENNUNG.test(kennung))
    maengel.push(
      `\`kennung\` "${kennung}" ist unbrauchbar: erlaubt sind 3 bis 64 Zeichen, klein, ` +
        'Beginn mit einem Buchstaben, danach a-z, 0-9 und Bindestrich.',
    )

  const name = text('name')
  if (!name) maengel.push('`name` fehlt — er steht als Beschriftung in der Oberflaeche.')

  const fassung = text('fassung')
  if (!fassung) maengel.push('`fassung` fehlt (etwa "1.0.0").')
  else if (!FASSUNG.test(fassung)) maengel.push(`\`fassung\` "${fassung}" ist keine Form "1.0.0".`)

  const haupt = text('haupt')
  if (!haupt) maengel.push('`haupt` fehlt — die Einstiegsdatei, etwa "index.mjs".')
  // KEIN AUSBRUCH AUS DEM PLUGIN-ORDNER. `haupt` wird zu einem Pfad; ein
  // "../../../etc/passwd" waere sonst ein Ladebefehl.
  else if (haupt.includes('..') || haupt.startsWith('/'))
    maengel.push(`\`haupt\` "${haupt}" muss innerhalb des Plugin-Ordners liegen (kein ".." und kein "/" am Anfang).`)

  const rechte: Recht[] = []
  const rohRechte = r.rechte
  if (rohRechte !== undefined && !Array.isArray(rohRechte)) {
    maengel.push('`rechte` muss eine Liste sein, etwa ["medienquelle", "netz"].')
  } else {
    for (const x of (rohRechte ?? []) as unknown[]) {
      if (typeof x === 'string' && (RECHTE as readonly string[]).includes(x)) {
        if (!rechte.includes(x as Recht)) rechte.push(x as Recht)
      } else {
        maengel.push(`\`rechte\` kennt "${String(x)}" nicht. Erlaubt: ${RECHTE.join(', ')}.`)
      }
    }
  }
  // EINE MEDIENQUELLE OHNE NETZ IST FAST IMMER EIN VERGESSENES RECHT — aber
  // nicht immer (eine Quelle, die nur lokale Dateien anbietet, braucht keins).
  // Deshalb ein Hinweis im Protokoll und KEIN Mangel: ein Plugin abzuweisen,
  // das richtig sein koennte, waere schlimmer als ein `holen`, das wirft.

  // ── Die Felder ──────────────────────────────────────────────────────────
  const felder: Feld[] = []
  const rohFelder = r.felder
  if (rohFelder !== undefined && !Array.isArray(rohFelder)) {
    maengel.push('`felder` muss eine Liste sein.')
  } else {
    for (const x of (rohFelder ?? []) as unknown[]) {
      const f = (x ?? {}) as Record<string, unknown>
      const schluessel = typeof f.schluessel === 'string' ? f.schluessel.trim() : ''
      if (!SCHLUESSEL.test(schluessel)) {
        maengel.push(
          `\`felder\`: "${schluessel}" taugt nicht als Schluessel — Buchstabe zuerst, dann Buchstaben, Ziffern, Unterstrich.`,
        )
        continue
      }
      if (VERBOTEN.has(schluessel)) {
        maengel.push(`\`felder\`: "${schluessel}" ist nicht erlaubt — es wuerde den Prototyp veraendern.`)
        continue
      }
      if (felder.some((g) => g.schluessel === schluessel)) {
        maengel.push(`\`felder\`: "${schluessel}" steht zweimal drin.`)
        continue
      }
      if (typeof f.art !== 'string' || !(FELDARTEN as readonly string[]).includes(f.art)) {
        maengel.push(`\`felder\`: "${schluessel}" hat die Art "${String(f.art)}". Erlaubt: ${FELDARTEN.join(', ')}.`)
        continue
      }
      const feldName = typeof f.name === 'string' ? f.name.trim() : ''
      if (!feldName) {
        maengel.push(`\`felder\`: "${schluessel}" braucht einen \`name\` — er steht ueber dem Eingabefeld.`)
        continue
      }
      const feld: Feld = { schluessel, art: f.art as Feldart, name: feldName }
      if (typeof f.hinweis === 'string' && f.hinweis.trim()) feld.hinweis = f.hinweis.trim()
      if (f.vorgabe !== undefined) {
        // EINE VORGABE FUER EIN GEHEIMNIS IST EIN WIDERSPRUCH: sie stuende im
        // Klartext im Manifest, das jeder lesen kann, der das Plugin laedt.
        if (f.art === 'geheim') {
          maengel.push(`\`felder\`: "${schluessel}" ist geheim und darf keine \`vorgabe\` haben.`)
          continue
        }
        feld.vorgabe = f.vorgabe as string | number | boolean
      }
      felder.push(feld)
    }
  }

  // ── Sektion, Icon, Aktionen (E77) ───────────────────────────────────────
  //
  // ALLE DREI SIND FREIWILLIG — ein Plugin ohne sie ist genau so gueltig wie
  // vor E77. Aber WENN sie dastehen, gelten dieselben harten Regeln wie beim
  // Rest: im Zweifel wird nicht geladen, nichts wird gebogen.
  let sektion: Sektion | undefined
  if (r.sektion !== undefined) {
    const s = text('sektion')
    if ((SEKTIONEN as readonly string[]).includes(s)) sektion = s as Sektion
    else maengel.push(`\`sektion\` "${String(r.sektion)}" gibt es nicht. Erlaubt: ${SEKTIONEN.join(', ')}.`)
  }

  let icon: string | undefined
  if (r.icon !== undefined) {
    const i = text('icon')
    // DIESELBE AUSBRUCHS-REGEL WIE BEI `haupt`: der Name wird zu einem Pfad
    // unter dem Plugin-Ordner, und der Wirt liefert die Datei aus. Dazu die
    // Endung: der Browser bekommt einen Content-Type nach Endung — eine
    // beliebige Datei unter /icon auszuliefern hiesse, dass ein Plugin dort
    // seine ganze Ablage veroeffentlichen kann.
    if (!i) maengel.push('`icon` ist leer — entweder ein Dateiname oder gar nicht.')
    else if (i.includes('..') || i.startsWith('/'))
      maengel.push(`\`icon\` "${i}" muss innerhalb des Plugin-Ordners liegen (kein ".." und kein "/" am Anfang).`)
    else if (!/\.(svg|png)$/.test(i)) maengel.push(`\`icon\` "${i}" muss auf .svg oder .png enden.`)
    else icon = i
  }

  const aktionen: Aktion[] = []
  const rohAktionen = r.aktionen
  if (rohAktionen !== undefined && !Array.isArray(rohAktionen)) {
    maengel.push('`aktionen` muss eine Liste sein, etwa [{"kennung": "pruefen", "name": "Verbindung prüfen"}].')
  } else {
    for (const x of (rohAktionen ?? []) as unknown[]) {
      const a = (x ?? {}) as Record<string, unknown>
      const aKennung = typeof a.kennung === 'string' ? a.kennung.trim() : ''
      // DIESELBEN REGELN WIE BEI FELD-SCHLUESSELN, aus denselben Gruenden —
      // die Kennung landet in einer Route und in einem Methodenaufruf.
      if (!SCHLUESSEL.test(aKennung) || VERBOTEN.has(aKennung)) {
        maengel.push(
          `\`aktionen\`: "${aKennung}" taugt nicht als Kennung — Buchstabe zuerst, dann Buchstaben, Ziffern, Unterstrich.`,
        )
        continue
      }
      if (aktionen.some((b) => b.kennung === aKennung)) {
        maengel.push(`\`aktionen\`: "${aKennung}" steht zweimal drin.`)
        continue
      }
      const aName = typeof a.name === 'string' ? a.name.trim() : ''
      if (!aName) {
        maengel.push(`\`aktionen\`: "${aKennung}" braucht einen \`name\` — er steht auf dem Knopf.`)
        continue
      }
      const aktion: Aktion = { kennung: aKennung, name: aName }
      if (typeof a.hinweis === 'string' && a.hinweis.trim()) aktion.hinweis = a.hinweis.trim()
      aktionen.push(aktion)
    }
  }

  // ── Kern-Konfiguration (E80) ────────────────────────────────────────────
  const konfig: KonfigGruppe[] = []
  const rohKonfig = r.konfig
  if (rohKonfig !== undefined && !Array.isArray(rohKonfig)) {
    maengel.push('`konfig` muss eine Liste sein, etwa ["jellyfin"].')
  } else {
    for (const x of (rohKonfig ?? []) as unknown[]) {
      if (typeof x === 'string' && (KONFIG_GRUPPEN as readonly string[]).includes(x)) {
        if (!konfig.includes(x as KonfigGruppe)) konfig.push(x as KonfigGruppe)
      } else {
        maengel.push(`\`konfig\` kennt "${String(x)}" nicht. Erlaubt: ${KONFIG_GRUPPEN.join(', ')}.`)
      }
    }
  }

  if (maengel.length > 0) return { ok: false, manifest: null, maengel }
  const manifest: Manifest = { kennung, name, fassung, haupt, rechte, felder, aktionen, konfig }
  if (sektion) manifest.sektion = sektion
  if (icon) manifest.icon = icon
  return { ok: true, manifest, maengel: [] }
}

/**
 * Gespeicherte Werte auf die angemeldeten Felder beziehen.
 *
 * ANDERS ALS BEIM MANIFEST WIRD HIER GEBOGEN, nicht abgewiesen. Der Grund ist
 * derselbe wie bei `regelnNormalisieren` in kinderzeit.ts: eine kaputte
 * Einstellungsdatei darf ein Plugin nicht aussperren, sondern soll es mit den
 * Vorgaben starten lassen. Ein Manifest schreibt ein Entwickler, eine
 * Einstellungsdatei entsteht im Betrieb.
 *
 * WAS NICHT ANGEMELDET IST, FAELLT HERAUS. Sonst wuechse die Datei mit jedem
 * Umbau eines Plugins um Reste, die niemand mehr zuordnen kann — und ein
 * Plugin bekaeme Werte, mit denen es nicht rechnet.
 */
export function einstellungenNormalisieren(roh: unknown, felder: Feld[]): Record<string, unknown> {
  const q = (roh ?? {}) as Record<string, unknown>
  const aus: Record<string, unknown> = {}
  for (const f of felder) {
    const wert = Object.hasOwn(q, f.schluessel) ? q[f.schluessel] : undefined
    switch (f.art) {
      case 'zahl': {
        const n = Number(wert)
        aus[f.schluessel] = Number.isFinite(n) ? n : Number(f.vorgabe ?? 0)
        break
      }
      case 'schalter':
        aus[f.schluessel] = wert === undefined ? f.vorgabe === true : wert === true
        break
      default:
        aus[f.schluessel] = typeof wert === 'string' ? wert : String(f.vorgabe ?? '')
    }
  }
  return aus
}

/**
 * Fuer die Anzeige: Geheimnisse LEEREN, nicht entfernen.
 *
 * Dieselbe Haltung wie in konfiguration.ts („Nicht loeschen, sondern leeren:
 * die FORM bleibt gleich"). Ein Feld, das verschwindet, laesst die Oberflaeche
 * stolpern; ein leeres Feld ist ein leeres Feld.
 */
export function einstellungenMaskieren(werte: Record<string, unknown>, felder: Feld[]): Record<string, unknown> {
  const aus = { ...werte }
  for (const f of felder) if (f.art === 'geheim') aus[f.schluessel] = ''
  return aus
}

/**
 * Eine Aenderung einarbeiten — und dabei Geheimnisse NICHT verlieren.
 *
 * DAS IST DIE STELLE, AN DER MAN STILL DATEN VERNICHTET. Der Eltern-Bereich
 * liest die Einstellungen (Geheimnis kommt als `''` an), jemand aendert das
 * Feld daneben und schickt alles zurueck — und das leere Geheimnis
 * ueberschriebe das echte. Der Benutzer sieht keinen Fehler; das Plugin
 * scheitert erst beim naechsten Aufruf, an einer Stelle, die nichts damit
 * zu tun hat.
 *
 * Deshalb: ein LEERES Geheimnis heisst „unveraendert lassen". Wer eines
 * loeschen will, hat dafuer `--` … nein: er traegt ein neues ein. Ein
 * Geheimnis zu LEEREN ist mit dieser Regel nicht moeglich — das ist der Preis,
 * und er ist kleiner als der stille Verlust.
 */
export function einstellungenZusammenfuehren(
  alt: Record<string, unknown>,
  neu: unknown,
  felder: Feld[],
): Record<string, unknown> {
  const n = einstellungenNormalisieren(neu, felder)
  const aus = { ...n }
  for (const f of felder) {
    if (f.art !== 'geheim') continue
    if (!n[f.schluessel]) aus[f.schluessel] = alt[f.schluessel] ?? ''
  }
  return aus
}

/**
 * Was ein Plugin ZURUECKGIBT, ist genauso fremd wie das Manifest.
 *
 * DIESE PRUEFUNG LAEUFT IM HAUPTPROZESS, nicht im Worker. Der Worker-Code
 * gehoert zwar uns, teilt sich aber den Speicher mit dem Plugin — ein Plugin,
 * das `JSON.stringify` oder den Briefweg umbiegt, koennte dort jede Pruefung
 * aushebeln. Was der Wirt annimmt, prueft der Wirt.
 *
 * DER GEFAEHRLICHE FALL IST `datei`. Ohne diese Pruefung waere
 * `{art:'datei', adresse:'/etc/shadow'}` ein Abspielbefehl — mpv liest, was
 * dasteht, und ein Vorlese-Plugin haette daraus eine Vorlesefunktion fuer die
 * Schattendatei gemacht. Deshalb: nur UNTERHALB der Medienwurzel, und der
 * Vergleich laeuft auf dem AUFGELOESTEN Pfad, sonst reicht ein `..` im Namen.
 */
export interface FundUrteil {
  ok: boolean
  fund: Fund | null
  maengel: string[]
}

export function fundPruefen(roh: unknown, medienWurzel: string): FundUrteil {
  const maengel: string[] = []
  const r = (roh ?? {}) as Record<string, unknown>
  const rohTitel = (r.titel ?? {}) as Record<string, unknown>
  const rohQuelle = (r.quelle ?? {}) as Record<string, unknown>

  const name = typeof rohTitel.name === 'string' ? rohTitel.name.trim() : ''
  if (!name) maengel.push('`titel.name` fehlt — ohne Namen steht auf dem Schirm nichts.')

  const art = rohQuelle.art
  const adresse = typeof rohQuelle.adresse === 'string' ? rohQuelle.adresse.trim() : ''
  if (!adresse) maengel.push('`quelle.adresse` fehlt.')

  if (art === 'strom') {
    try {
      const u = new URL(adresse)
      // `file:` MUSS HIER HERAUSFALLEN. Sonst ist der Weg ueber `datei` versperrt
      // und der ueber `strom` offen — dieselbe Luecke mit anderem Namen.
      if (u.protocol !== 'http:' && u.protocol !== 'https:')
        maengel.push(`\`quelle.adresse\` darf nur http/https sein, nicht "${u.protocol}".`)
    } catch {
      maengel.push(`\`quelle.adresse\` "${adresse}" ist keine gueltige URL.`)
    }
  } else if (art === 'datei') {
    // Kein path-Modul hier — diese Datei bleibt rein. Die Normalisierung ist
    // einfach genug, um sie von Hand zu machen, und damit auch im Browser und
    // im Pruefstand eines Fremdentwicklers lauffaehig.
    if (!adresse.startsWith('/')) {
      maengel.push('`quelle.adresse` muss bei `datei` ein absoluter Pfad sein.')
    } else {
      const teile: string[] = []
      for (const stueck of adresse.split('/')) {
        if (stueck === '' || stueck === '.') continue
        if (stueck === '..') teile.pop()
        else teile.push(stueck)
      }
      const rein = `/${teile.join('/')}`
      const wurzel = medienWurzel.replace(/\/+$/, '')
      if (rein !== wurzel && !rein.startsWith(`${wurzel}/`))
        maengel.push(`\`quelle.adresse\` liegt ausserhalb der Medienwurzel (${wurzel}).`)
    }
  } else {
    maengel.push(`\`quelle.art\` muss "strom" oder "datei" sein, nicht "${String(art)}".`)
  }

  if (maengel.length > 0) return { ok: false, fund: null, maengel }
  const titel: Titel = { name }
  if (typeof rohTitel.kuenstler === 'string') titel.kuenstler = rohTitel.kuenstler.trim()
  if (typeof rohTitel.bild === 'string') titel.bild = rohTitel.bild.trim()
  if (Number.isFinite(Number(rohTitel.dauerSek))) titel.dauerSek = Math.max(0, Math.floor(Number(rohTitel.dauerSek)))
  return { ok: true, fund: { titel, quelle: { art: art as 'strom' | 'datei', adresse } }, maengel: [] }
}

/**
 * Was ein Plugin als INHALT zurueckgibt, ist genauso fremd wie ein Fund (E78).
 *
 * JEDE Folge laeuft durch dieselbe Quellen-Pruefung wie bei `fundPruefen` —
 * eine Liste ist kein Freibrief, und die 40. Folge mit `file:///etc/shadow`
 * waere dieselbe Luecke wie beim einzelnen Fund, nur besser versteckt.
 *
 * KAPUTTE FOLGEN FALLEN HERAUS, die Liste bleibt: eine Sendung mit 59 guten
 * und einer krummen Folge ist eine Sendung mit 59 Folgen, kein Fehler. NUR
 * eine leere Liste nach dem Sieben ist dem Aufrufer als solche zu melden —
 * das entscheidet er, nicht diese Pruefung.
 */
export interface InhaltUrteil {
  ok: boolean
  inhalt: Inhalt | null
  maengel: string[]
}

/** Mehr Folgen nimmt der Wirt nicht an — eine Warteschlange, kein Katalog. */
export const FOLGEN_DECKEL = 500

export function inhaltPruefen(roh: unknown, medienWurzel: string): InhaltUrteil {
  const r = (roh ?? {}) as Record<string, unknown>
  const titel = typeof r.titel === 'string' ? r.titel.trim() : ''
  if (!titel) return { ok: false, inhalt: null, maengel: ['`titel` fehlt — ohne ihn steht auf dem Schirm nichts.'] }
  if (!Array.isArray(r.folgen)) return { ok: false, inhalt: null, maengel: ['`folgen` muss eine Liste sein.'] }
  if (r.folgen.length > FOLGEN_DECKEL)
    return { ok: false, inhalt: null, maengel: [`${r.folgen.length} Folgen — der Deckel liegt bei ${FOLGEN_DECKEL}.`] }

  const folgen: Folge[] = []
  const maengel: string[] = []
  const gesehen = new Set<string>()
  for (const x of r.folgen) {
    const f = (x ?? {}) as Record<string, unknown>
    const kennung = typeof f.kennung === 'string' ? f.kennung.trim() : ''
    const name = typeof f.name === 'string' ? f.name.trim() : ''
    if (!kennung || !name) {
      maengel.push(`Folge ohne ${kennung ? 'Name' : 'Kennung'} uebergangen.`)
      continue
    }
    if (gesehen.has(kennung)) {
      maengel.push(`Folge "${kennung}" steht doppelt drin — die zweite faellt heraus.`)
      continue
    }
    // DIE QUELLE DURCH DIESELBE PRUEFUNG WIE EIN FUND — inklusive des
    // Pfad-Gefaengnisses fuer `datei`. Wiederverwendet, nicht nachgebaut.
    const urteil = fundPruefen({ titel: { name }, quelle: f.quelle }, medienWurzel)
    if (!urteil.ok || !urteil.fund) {
      maengel.push(`Folge "${kennung}": ${urteil.maengel.join(' ')}`)
      continue
    }
    gesehen.add(kennung)
    const folge: Folge = { kennung, name, quelle: urteil.fund.quelle }
    if (typeof f.kuenstler === 'string' && f.kuenstler.trim()) folge.kuenstler = f.kuenstler.trim()
    if (typeof f.bild === 'string' && f.bild.trim()) folge.bild = f.bild.trim()
    if (Number.isFinite(Number(f.dauerSek))) folge.dauerSek = Math.max(0, Math.floor(Number(f.dauerSek)))
    folgen.push(folge)
  }

  const inhalt: Inhalt = { titel, folgen, vollstaendig: r.vollstaendig !== false }
  if (typeof r.kuenstler === 'string' && r.kuenstler.trim()) inhalt.kuenstler = r.kuenstler.trim()
  return { ok: true, inhalt, maengel }
}

/**
 * Was ein Plugin als SONGTEXT zurueckgibt (E84/B2) — genauso fremd wie ein Fund.
 *
 * DIE FORM: `{ zeilen: [{ zeitMs, text }] }`. Mehr nicht. Wie bei `fundPruefen`
 * wird die Antwort NEU AUFGEBAUT statt durchgereicht — was das Plugin sonst
 * noch anhaengt, faellt still heraus. Der Grund ist derselbe: was auf dem
 * Kinderschirm landet, soll aus einer Weissliste kommen, nicht aus dem
 * Wohlwollen eines Fremdentwicklers.
 *
 * KAPUTTE ZEILEN FALLEN HERAUS, die Liste bleibt — dieselbe Regel wie bei
 * `inhaltPruefen`: ein Text mit 59 guten und einer krummen Zeile ist ein Text
 * mit 59 Zeilen, kein Fehler.
 *
 * SORTIERT WIRD HIER, nicht beim Aufrufer. Eine unsortierte Liste ist kein
 * Mangel des Plugins (das LRC-Format erlaubt Refrain-Marken in beliebiger
 * Reihenfolge), aber `zeileJetzt()` sucht binaer und braucht die Ordnung.
 * Wer sich darauf verlaesst, ohne dass jemand sie herstellt, bekommt einen
 * Fehler, der nur bei manchen Liedern auftritt.
 *
 * WAS HIER NICHT GEPRUEFT WIRD, weil es hier nicht zu pruefen ist: OB der Text
 * zum laufenden Stueck gehoert. Das entscheidet die Dauer, und das tut
 * `fassungWaehlen()` in songtext.ts — dort steht auch, warum das die
 * gefaehrlichste Stelle des ganzen Vorgangs ist.
 */
export interface SongtextUrteil {
  ok: boolean
  /** Zeilen MIT Zeitmarke. Leer, wenn der Text unsynchron ist. */
  zeilen: Songzeile[]
  /** Zeilen OHNE Zeitmarke. Leer, wenn der Text synchron ist. */
  absaetze: string[]
  /** true = mitlaufend anzeigbar, false = nur zum Lesen (Vollbild). */
  synchron: boolean
  maengel: string[]
}

/**
 * ZWEI FORMEN, ABSICHTLICH GETRENNT — nicht eine mit optionaler Zeitmarke:
 *
 *     { zeilen: [{ zeitMs, text }] }   synchron, laeuft mit
 *     { absaetze: ["…", "…"] }         unsynchron, nur zum Lesen
 *
 * Eine gemeinsame Form mit `zeitMs?` haette bedeutet, dass jede Stelle, die
 * mitlaufen will, erst nachsehen muss, ob die Marke wirklich da ist — und die
 * eine Stelle, die es vergisst, zeigt bei Sekunde 0 den ganzen Text auf einmal.
 * Getrennte Felder machen aus der Frage „ist das synchron?" eine, die der
 * Aufrufer nicht stellen KANN, ohne sie zu beantworten.
 *
 * Liefert ein Plugin BEIDES, gewinnt `zeilen` — synchron ist mehr.
 */
export function songtextPruefen(roh: unknown): SongtextUrteil {
  const leer = { zeilen: [] as Songzeile[], absaetze: [] as string[], synchron: false }
  const r = (roh ?? {}) as Record<string, unknown>

  // ── Der unsynchrone Weg: nur Text, kein Mitlaufen ──────────────────────
  if (!Array.isArray(r.zeilen) && Array.isArray(r.absaetze)) {
    if (r.absaetze.length > ZEILEN_DECKEL)
      return { ok: false, ...leer, maengel: [`${r.absaetze.length} Absaetze — der Deckel liegt bei ${ZEILEN_DECKEL}.`] }
    const absaetze: string[] = []
    const maengel: string[] = []
    for (const x of r.absaetze) {
      if (typeof x !== 'string') {
        maengel.push(`Absatz, der kein Text ist (${typeof x}), uebergangen.`)
        continue
      }
      absaetze.push(x.trim())
    }
    // NICHT sortiert und NICHT entdoppelt: ohne Zeitmarke ist die Reihenfolge
    // der Quelle die einzige, die es gibt, und eine Zeile, die zweimal
    // vorkommt, ist meist der Refrain.
    return { ok: true, zeilen: [], absaetze, synchron: false, maengel }
  }

  if (!Array.isArray(r.zeilen))
    return { ok: false, ...leer, maengel: ['`zeilen` oder `absaetze` muss eine Liste sein.'] }
  if (r.zeilen.length > ZEILEN_DECKEL)
    return { ok: false, ...leer, maengel: [`${r.zeilen.length} Zeilen — der Deckel liegt bei ${ZEILEN_DECKEL}.`] }

  const zeilen: Songzeile[] = []
  const maengel: string[] = []
  for (const x of r.zeilen) {
    const z = (x ?? {}) as Record<string, unknown>
    const zeitMs = Number(z.zeitMs)
    if (!Number.isFinite(zeitMs) || zeitMs < 0) {
      maengel.push(`Zeile mit unbrauchbarer Zeitmarke (${String(z.zeitMs)}) uebergangen.`)
      continue
    }
    // LEERER TEXT IST ERLAUBT und nicht dasselbe wie eine fehlende Zeile: das
    // sind die Pausen zwischen den Strophen, und sie sind der Grund, warum die
    // Anzeige zwischendurch leer wird, statt die letzte Zeile stehen zu lassen.
    if (typeof z.text !== 'string') {
      maengel.push(`Zeile bei ${zeitMs} ms ohne Text uebergangen.`)
      continue
    }
    zeilen.push({ zeitMs: Math.floor(zeitMs), text: z.text.trim() })
  }

  zeilen.sort((a, b) => a.zeitMs - b.zeitMs)
  return { ok: true, zeilen, absaetze: [], synchron: true, maengel }
}

/**
 * Aus einem Befehl an den Abspieldienst ein Ereignis machen — oder keins.
 *
 * REIN, DAMIT DIE ZUORDNUNG PRUEFBAR IST. Sie sitzt im Proxy, also auf dem
 * heissesten Weg der Box: jeder Kacheltipp geht dort durch. Eine Zuordnung,
 * die man nur im Betrieb pruefen kann, wird nie geprueft.
 *
 * `istStartbefehl` KOMMT AUS kinderzeit.ts und wird hier BEWUSST
 * wiederverwendet, statt ein zweites Muster zu pflegen: was als Start gilt,
 * darf nicht davon abhaengen, wer fragt. Traegt jemand dort einen neuen Dienst
 * nach, bekommen die Plugins ihn ohne weiteres Zutun mit.
 *
 * `pause` UND `stop` ergeben BEIDE „gestoppt", aber die Nutzlast nennt das
 * Verb. Fuer ein Lichtplugin ist beides „Licht aus"; wer den Unterschied
 * braucht, findet ihn — statt dass wir hier fuer ihn entscheiden.
 */
const STOPP = /\/(stop|pause)(\/|$|\?)/
const LAUTSTAERKE = /\/setvolume:(\d{1,3})(\/|$|\?)/

export function ereignisAusBefehl(
  pfad: unknown,
  istStart: (p: string) => boolean,
): { name: Ereignisname; nutzlast: unknown } | null {
  if (typeof pfad !== 'string' || !pfad) return null
  const p = pfad.toLowerCase()

  const laut = LAUTSTAERKE.exec(p)
  if (laut) {
    const wert = Number(laut[1])
    // Ueber 100 ist keine Lautstaerke, sondern ein Tippfehler oder ein
    // Angriffsversuch — ein Plugin soll damit nicht rechnen muessen.
    return wert >= 0 && wert <= 100 ? { name: 'lautstaerke', nutzlast: { wert } } : null
  }
  // DIE REIHENFOLGE IST ABSICHT: `stop` zuerst. Ein Pfad, der beides enthaelt,
  // gilt als Anhalten — dieselbe Vorsicht wie bei NICHT_START in kinderzeit.ts,
  // wo das Verneinen zuerst steht und gewinnt.
  if (STOPP.test(p)) return { name: 'wiedergabeGestoppt', nutzlast: { verb: /\/pause/.test(p) ? 'pause' : 'stop' } }
  if (istStart(pfad)) return { name: 'wiedergabeGestartet', nutzlast: {} }
  return null
}

/** Das Schema-Praefix eines Plugins. Abgeleitet, nie gewaehlt. */
export function praefix(kennung: string): string {
  return `${kennung}:`
}

/** Das Routenstueck eines Plugins. Ebenfalls abgeleitet. */
export function routenStueck(kennung: string): string {
  return `/api/plugins/${kennung}/`
}

/**
 * Gehoert diese Medienkennung einem Plugin — und wenn ja, welchem?
 *
 * `mupibox-podcast:https://…/feed.xml` → { kennung, rest }
 *
 * DER DOPPELPUNKT TRENNT NUR EINMAL. Eine URL im Rest enthaelt selbst einen
 * (`https://`), und ein `split(':')` haette sie zerschnitten — der Fehler faellt
 * erst auf, wenn das erste Plugin URLs durchreicht, und sieht dann aus wie ein
 * kaputter Feed.
 */
export function kennungZerlegen(medienKennung: unknown): { kennung: string; rest: string } | null {
  if (typeof medienKennung !== 'string') return null
  const i = medienKennung.indexOf(':')
  if (i <= 0) return null
  const kennung = medienKennung.slice(0, i)
  if (!KENNUNG.test(kennung)) return null
  const rest = medienKennung.slice(i + 1)
  if (!rest) return null
  return { kennung, rest }
}
