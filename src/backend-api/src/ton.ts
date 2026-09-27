/**
 * Wohin der Ton geht: interner Verstärker oder Bluetooth-Lautsprecher.
 *
 * AM GERÄT AUSGEMESSEN (Pi 5, BlueZ 5.82, bluealsa), bevor eine Zeile davon
 * entstand:
 *
 *   /etc/asound.conf  default -> softvol "Master" -> plughw:MAX98357A
 *   bluealsa bietet   00:9E:…  A2DP (SBC) 48 kHz
 *   Ton erzeugen      mplayer (-slave -idle)  und  Chromium (Kiosk)
 *
 * DREI ERKENNTNISSE, die den Entwurf bestimmen:
 *
 * 1. `softvol` funktioniert AUCH VOR bluealsa, mit dem Regler weiterhin auf
 *    der MAX98357A-Karte (die existiert ja unabhängig davon, ob sie den Ton
 *    ausgibt). Nachgeprüft: es spielt, und `Master` regelt. Damit bleibt die
 *    Lautstärkeregelung der Box unverändert — egal wohin der Ton geht. Ohne
 *    diesen Kniff hätte man zwei Regler mit verschiedenen Wirkungen.
 *
 * 2. DER INTERNE VERSTÄRKER IST BELEGT, solange mplayer läuft (`-idle` hält
 *    den PCM offen; `aplay` meldet dann „Device or resource busy"). Ein
 *    Umschalten wirkt deshalb erst, wenn die Tonerzeuger neu starten.
 *
 * 3. Fällt der Lautsprecher aus, während er eingestellt ist, ist die Box
 *    STUMM — ALSA kennt keinen selbsttätigen Rückfall. Deshalb lässt sich
 *    Bluetooth nur wählen, wenn das Gerät gerade verbunden ist, und der Weg
 *    zurück ist immer verfügbar.
 */

export type Ziel = { art: 'intern' } | { art: 'bluetooth'; mac: string } | { art: 'ueberall' }

/**
 * DIE KOMBI-SENKE „UEBERALL" (15.08.2026): alle verbundenen Bluetooth-
 * Lautsprecher zugleich, mit Latenz-Ausgleich.
 *
 * Betreiber: „kann man eine multi bluetooth ausgabe machen? auf multiplen
 * geräten" — und auf den hoerbaren Versatz: „kann man da noch einen delay
 * ausgleich einbauen?" Die Senke baut PipeWire selbst
 * (libpipewire-module-combine-stream, config/templates/60-ueberall.conf):
 * `combine.latency-compensate` verzoegert die schnelleren Senken auf die
 * langsamste, und die stream.rules fangen JEDE bluez-Senke — WELCHE Boxen
 * mitspielen, entscheidet sich durch Verbinden/Trennen („ich würde gerne
 * auswählen welche geräte spielen": genau so).
 */
import path from 'node:path'

export const UEBERALL_SINK = 'ueberall'

/** Die Karte, die den Lautstärkeregler trägt — auch bei Bluetooth-Ausgabe. */
export const REGLER_KARTE = 'MAX98357A'
export const REGLER_NAME = 'Master'

/**
 * Ist das eine Bluetooth-Adresse? Pure.
 *
 * Eigene Prüfung statt eines Verweises auf bluetooth.ts: dieser Wert landet
 * in einer KONFIGURATIONSDATEI, die ALSA als root liest. Die Prüfung gehört
 * neben die Stelle, die sie braucht.
 */
export function istMac(x: unknown): x is string {
  return typeof x === 'string' && /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/.test(x)
}

export function istZiel(x: unknown): x is Ziel {
  if (!x || typeof x !== 'object') return false
  const z = x as Record<string, unknown>
  if (z['art'] === 'intern' || z['art'] === 'ueberall') return true
  return z['art'] === 'bluetooth' && istMac(z['mac'])
}

/**
 * Die ALSA-Konfiguration für ein Ziel erzeugen. Pure.
 *
 * Der Aufbau ist bewusst derselbe wie bisher — nur der Unterbau von
 * `pcm.mupibox` wechselt. Alles, was `default` benutzt (mplayer, Chromium,
 * aplay), folgt damit automatisch, ohne dass ein einziger Aufrufer etwas von
 * Bluetooth wissen muss.
 */
export function asoundConf(ziel: Ziel): string {
  const kopf = [
    '# Von der MuPiBox-Verwaltung geschrieben.',
    '# Von Hand geaenderte Zeilen gehen beim naechsten Umschalten verloren;',
    '# die vorherige Fassung liegt als /etc/asound.conf.vorher daneben.',
    '',
  ]
  const unterbau =
    ziel.art === 'bluetooth'
      ? [
          '    slave.pcm {',
          '        type bluealsa',
          `        device "${ziel.mac.toUpperCase()}"`,
          '        profile "a2dp"',
          '    }',
        ]
      : [`    slave.pcm "plughw:CARD=${REGLER_KARTE},DEV=0"`]

  return [
    ...kopf,
    'pcm.mupibox {',
    '    type softvol',
    ...unterbau,
    // Der Regler bleibt auf der internen Karte — am Geraet geprueft, dass das
    // auch bei Bluetooth-Ausgabe funktioniert. So gibt es EINEN Regler.
    `    control.name "${REGLER_NAME}"`,
    `    control.card "${REGLER_KARTE}"`,
    '}',
    '',
    'pcm.!default {',
    '    type plug',
    '    slave.pcm "mupibox"',
    '}',
    '',
    'ctl.!default {',
    '    type hw',
    `    card "${REGLER_KARTE}"`,
    '}',
    '',
  ].join('\n')
}

/**
 * Aus einer vorhandenen asound.conf lesen, wohin der Ton gerade geht. Pure.
 *
 * Bewusst nachsichtig: die Datei kann von Hand oder von einer älteren Fassung
 * stammen. Was nicht eindeutig nach Bluetooth aussieht, gilt als intern —
 * das ist der Zustand, in dem die Box auf jeden Fall Ton macht.
 */
export function parseAsound(text: string): Ziel {
  const t = String(text || '')
  if (!/type\s+bluealsa/.test(t)) return { art: 'intern' }
  const m = /device\s+"([0-9A-Fa-f:]{17})"/.exec(t)
  return m ? { art: 'bluetooth', mac: m[1].toUpperCase() } : { art: 'intern' }
}

export function zielGleich(a: Ziel, b: Ziel): boolean {
  if (a.art !== b.art) return false
  if (a.art === 'bluetooth' && b.art === 'bluetooth')
    return a.mac.toUpperCase() === b.mac.toUpperCase()
  return true
}

/** Kurzer, lesbarer Name eines Ziels. Pure. */
export function zielName(ziel: Ziel, geraetName?: string): string {
  if (ziel.art === 'intern') return 'Eingebauter Lautsprecher'
  if (ziel.art === 'ueberall') return 'Überall (alle Bluetooth-Lautsprecher)'
  return geraetName ? `Bluetooth: ${geraetName}` : `Bluetooth: ${ziel.mac}`
}

// ── PipeWire ──────────────────────────────────────────────────────────────
// Seit dem Umstieg (2026-07-27) liegt die Tonausgabe nicht mehr in
// /etc/asound.conf, sondern ist die STANDARD-SENKE von PipeWire. Umschalten
// heisst `pactl set-default-sink <name>` statt eine Datei zu schreiben —
// und es wirkt SOFORT, ohne Dienste neu zu starten.
//
// Die ALSA-Funktionen darueber bleiben: eine Box ohne PipeWire (aeltere
// Installation) laeuft unveraendert weiter, server.ts waehlt den Weg.

export interface Senke {
  /** Laufende Nummer von PipeWire — aendert sich bei jedem Verbinden. */
  id: number
  /** Stabiler Name, z. B. `bluez_output.00_9E_C8_61_1A_EA.1`. */
  name: string
}

/**
 * Ausgabe von `pactl list sinks short` lesen. Pure.
 *
 * Format: `<id>\t<name>\t<treiber>\t<format>\t<zustand>`, eine Zeile je Senke.
 * Unvollstaendige Zeilen werden uebergangen statt zu werfen — die Liste ist
 * eine Momentaufnahme, und ein Bluetooth-Geraet kann mitten im Lesen gehen.
 */
export function parsePactlSinks(text: string): Senke[] {
  const res: Senke[] = []
  for (const zeile of (text || '').split('\n')) {
    const teile = zeile.split('\t')
    if (teile.length < 2) continue
    const id = Number.parseInt(teile[0], 10)
    const name = teile[1].trim()
    if (!Number.isFinite(id) || !name) continue
    res.push({ id, name })
  }
  return res
}

/**
 * Welches Ziel steckt hinter einem Senkennamen? Pure.
 *
 * PipeWire benennt Bluetooth-Senken `bluez_output.<MAC mit Unterstrichen>.<n>`
 * — die Adresse steht also im Namen und muss nicht nachgeschlagen werden.
 * Alles andere gilt als INTERN: das ist der Zustand MIT Ton, und wer hier
 * raet und danebenliegt, macht die Box stumm.
 */
export function zielAusSinkName(name: string): Ziel {
  const rein = (name || '').trim()
  // Die Kombi-Senke ZUERST: sie ist weder bluez noch „intern" — als intern
  // gedeutet wuerde der Zustand „Ueberall laeuft" in der Anzeige zum
  // eingebauten Lautsprecher, und niemand faende den Unterschied.
  if (rein === UEBERALL_SINK) return { art: 'ueberall' }
  const m = /^bluez_output\.([0-9A-Fa-f_]{17})\./.exec(rein)
  if (!m) return { art: 'intern' }
  return { art: 'bluetooth', mac: m[1].replace(/_/g, ':').toUpperCase() }
}

/** Die Senke zu einem Ziel finden -> Name oder null. Pure. */
export function sinkFuerZiel(senken: Senke[], ziel: Ziel): string | null {
  for (const s of senken) {
    // DER ENTZERRER IST NIE EIN ZIEL: er ist eine Durchgangsstation. Ohne
    // diese Zeile hielte die intern-Suche ihn fuer den eingebauten
    // Lautsprecher (er ist weder bluez noch ueberall) — und „Eingebauter
    // Lautsprecher" schaltete dann auf den Equalizer statt auf den HAT.
    if (s.name === ENTZERRER_SINK) continue
    const z = zielAusSinkName(s.name)
    if (z.art !== ziel.art) continue
    if (z.art === 'intern' || z.art === 'ueberall') return s.name
    if (ziel.art === 'bluetooth' && z.art === 'bluetooth' && z.mac === ziel.mac.toUpperCase())
      return s.name
  }
  return null
}

/**
 * Unter PipeWire kann es KEINE stumme Box durch ein abwesendes Geraet geben:
 * ein ausgeschalteter Lautsprecher ist schlicht keine Senke, und PipeWire
 * spielt auf der verbleibenden weiter. Umgeschaltet werden darf deshalb auf
 * alles, was gerade als Senke DA ist — die Pruefung ist die Liste selbst.
 */
export function darfUmschaltenPw(senken: Senke[], ziel: Ziel): Pruefung {
  if (ziel.art === 'intern') return { ok: true }
  if (ziel.art === 'ueberall') {
    // Die Kombi-Senke existiert auch OHNE verbundene Lautsprecher (die
    // Regel-Datei baut sie immer) — aber ohne mindestens einen waere
    // „Überall" schlicht Stille, und ein Kind stuende vor dem stummen
    // Kasten. Dieselbe Haltung wie bei `darfUmschalten` unten.
    if (!sinkFuerZiel(senken, ziel)) {
      return { ok: false, grund: 'Die Überall-Ausgabe steht auf dieser Box nicht bereit.' }
    }
    const einer = senken.some((s) => zielAusSinkName(s.name).art === 'bluetooth')
    return einer
      ? { ok: true }
      : { ok: false, grund: 'Kein Bluetooth-Lautsprecher verbunden — Überall wäre Stille.' }
  }
  return sinkFuerZiel(senken, ziel)
    ? { ok: true }
    : { ok: false, grund: 'Dieses Gerät ist gerade nicht verbunden.' }
}

export interface Pruefung {
  ok: boolean
  grund?: string
}

/* ══ DIE QUELLEN — was gerade in den Tonserver hineinspielt (15.08.2026) ════
 *
 * Betreiber: „auch noch mit manueller einstellung der lautstärke pro
 * tonquelle". Eine QUELLE ist ein sink-input von PipeWire: Spotify
 * (librespot), Hoerspiele/Radio (mplayer/mpv), der Kiosk-Browser. Gemerkt
 * wird die Wahl von WirePlumber selbst (restore-stream, je Anwendung) —
 * einmal eingestellt, gilt sie auch beim naechsten Abspielen.
 *
 * NICHT JEDER STROM IST EINE QUELLE: die Kombi-Senke „Überall" erzeugt fuer
 * jede Mitglieds-Box einen INTERNEN Zubringer-Strom ohne application.name —
 * ein Regler dafuer waere ein zweiter Regler fuer dieselbe Musik, und wer
 * ihn verstellt, verstellt eine Box der Kombi einzeln, ohne es zu wissen.
 * Deshalb zaehlt nur, was einen Anwendungsnamen traegt.
 */
export interface TonQuelle {
  /** Die sink-input-Nummer — nur fuer DIESEN Moment gueltig. */
  kennung: number
  /** Der Anzeigename fuer Menschen. */
  name: string
  /** Der rohe Anwendungsname, fuer die Zuordnung und die Fehlersuche. */
  roh: string
  /** Lautstaerke in Prozent (Kanal vorn links; die Box faehrt stereo-gleich). */
  prozent: number
}

/** Aus dem rohen Anwendungsnamen ein Wort, das ein Elternteil kennt. */
export function quellenAnzeigeName(roh: string): string {
  if (/librespot/i.test(roh)) return 'Spotify'
  // Der Soloist-Knoten heisst schlicht `spotify` (App "Spotify") — wer hier
  // nach "soloist" sucht, findet nichts (llmwiki: soloist-erste-messung).
  // GENAU dieser Name, kein Teilstring: sonst hiesse jede
  // Anwendung mit "spotify" im Namen so wie die Tonmaschine.
  if (/^spotify$/i.test(roh)) return 'Spotify'
  if (/mpv|mplayer/i.test(roh)) return 'Hörspiele & Radio'
  if (/chromium|chrome/i.test(roh)) return 'Bildschirm (Kiosk)'
  // `PipeWire ALSA [x]` ist Verpackung, nicht Name.
  const m = /^PipeWire ALSA \[(.+)\]$/.exec(roh)
  return m ? m[1] : roh
}

/**
 * `pactl -f json list sink-inputs` auswerten. Pure.
 *
 * Nachsichtig wie alle Zerleger dieser Datei: ein unlesbarer Rumpf ist eine
 * leere Liste, kein Fehler — die Seite zeigt dann ehrlich „gerade spielt
 * nichts" statt zu brechen.
 */
export function quellenAusPactlJson(text: string): TonQuelle[] {
  let roh: unknown
  try {
    roh = JSON.parse(text)
  } catch {
    return []
  }
  if (!Array.isArray(roh)) return []
  const raus: TonQuelle[] = []
  for (const e of roh as Record<string, unknown>[]) {
    const kennung = Number(e?.index)
    const props = (e?.properties ?? {}) as Record<string, unknown>
    const app = typeof props['application.name'] === 'string' ? (props['application.name'] as string) : ''
    if (!Number.isFinite(kennung) || !app) continue
    const vol = (e?.volume ?? {}) as Record<string, { value_percent?: string }>
    const links = vol['front-left']?.value_percent ?? vol[Object.keys(vol)[0]]?.value_percent ?? ''
    const prozent = Number.parseInt(String(links).replace('%', ''), 10)
    raus.push({
      kennung,
      name: quellenAnzeigeName(app),
      roh: app,
      prozent: Number.isFinite(prozent) ? prozent : 100,
    })
  }
  return raus
}

/**
 * Ein gueltiger Quellen-Pegel: 0 bis 125 Prozent, ganzzahlig.
 *
 * 125 UND NICHT 100 ALS DECKEL: eine leise abgemischte Quelle (manche
 * Hoerspiele) darf ETWAS ueber die anderen hinaus — mehr aber nicht, denn
 * ab ~130 % uebersteuert PipeWire hoerbar, und ein Kind kann den Regler
 * nicht von einem kaputten Lautsprecher unterscheiden.
 */
export function quellenPegelGueltig(p: unknown): p is number {
  return typeof p === 'number' && Number.isInteger(p) && p >= 0 && p <= 125
}

/**
 * DIE SENKEN MIT PEGEL — „auch pro senke" (Betreiber, 15.08.2026).
 *
 * Je Ausgabe ein eigener Regler: der eingebaute Verstaerker (MuPiHAT), jede
 * Bluetooth-Box einzeln, die Kombi „Überall" als Ganzes. Der wichtigste
 * Fall ist der Angleich zweier ungleich lauter Boxen im Überall-Betrieb.
 * Auch diese Werte merkt sich WirePlumber je Geraet von selbst.
 */
export interface TonSenkeMitPegel {
  /** Der Senkenname — der Schluessel fuer pactl. */
  sinkName: string
  /** Was fuer eine Ausgabe das ist (fuers Beschriften und Sortieren). */
  ziel: Ziel
  prozent: number
}

/* ══ KLANG: EQUALIZER UND MANUELLER VERSATZ (15.08.2026) ═══════════════════
 *
 * Betreiber: „noch ein delay ausgleich manuell und ein equalizer". Beides
 * ist am Geraet gemessen, bevor es hier stand:
 *   * Der Equalizer ist die Filterkette aus config/templates/61-entzerrer
 *     .conf (fuenf Baender); die Regler stellt der Server zur Laufzeit per
 *     Props (`eq_<band>:Gain`, in dB).
 *   * Der Versatz je Bluetooth-Box ist `latencyOffsetNsec` am Senken-Knoten
 *     — er fliesst in DENSELBEN Latenz-Ausgleich ein, den die Ueberall-
 *     Kombi faehrt: Wer nachhinkt, bekommt mehr gemeldeten Versatz, und
 *     der Ausgleich rueckt die anderen nach.
 * Gemerkt wird beides in klang.json (die Box-Sicherung nimmt sie mit);
 * angewendet wird nach Boot, Verbinden und Tonstapel-Neustart neu — die
 * Knoten-Eigenschaften selbst sind fluechtig.
 */
export const ENTZERRER_SINK = 'entzerrer'
export const ENTZERRER_AUSGANG = 'entzerrer.ausgang'

/* ══ DAS KLANGWERK: DIE KETTE DER TON-PLUGINS (21.08.2026) ═════════════════
 *
 * Betreiber: „bitte implementiere ein plugin für den sound". Anlass war die
 * seitliche Abstrahlung der Lautsprecher — dagegen hilft eine KANALMATRIX,
 * und die kann der Fuenfband-Entzerrer nicht (er rechnet je Kanal, er mischt
 * nicht zwischen ihnen). Was ein Plugin beschreiben darf, steht in
 * klangkette.ts; hier stehen nur die Namen, unter denen es im Tonstapel
 * auftaucht.
 *
 * ES IST EINE ZWEITE DURCHGANGSSTATION, keine zweite Ausgabe. Der Ton laeuft
 *
 *     Quellen -> klangwerk -> entzerrer -> Ziel
 *
 * wobei jede Station uebersprungen wird, die aus ist. Genau deshalb sind
 * `DURCHGANG_SENKEN` und `istDurchgang` hier und nicht im Server: die Frage
 * „ist diese Senke ein Ziel oder nur eine Station?" wird an fuenf Stellen
 * gestellt, und eine vergessene davon zeigt dem Betreiber „Klangwerk" als
 * Lautsprecher an (genau das passierte dem Entzerrer am 15.08.2026).
 */
export const KLANGWERK_SINK = 'klangwerk'
export const KLANGWERK_AUSGANG = 'klangwerk.ausgang'

/**
 * Die Stationen in der Reihenfolge des Signalwegs — zuerst die vorderste.
 *
 * DAS KLANGWERK STEHT VORN, und das ist eine Entscheidung: die Stereobasis
 * soll auf das GEMISCHTE Signal wirken, und der Entzerrer danach auf das
 * Ergebnis. Andersherum entzerrte man einen Kanal, den die Matrix gleich
 * darauf mit dem anderen verrechnet.
 */
export const DURCHGANG_SENKEN = [KLANGWERK_SINK, ENTZERRER_SINK] as const

/** Ist diese Senke nur Durchgang — also niemals ein Ziel? Pure. */
export function istDurchgang(name: unknown): boolean {
  return (DURCHGANG_SENKEN as readonly string[]).includes(String(name ?? ''))
}

/* ══ WO DIE NUTZERLAUTSTAERKE WOHNT (05.09.2026) ═══════════════════════════
 *
 * Auf der Senke, die das Signal ZULETZT verlaesst — echte Hardware. Alles
 * davor (klangwerk, entzerrer, ueberall) ist Durchgang und steht fest auf
 * 100 %; eine Filter-Kette nimmt ohnehin keine Lautstaerke an.
 *
 * DIE PRUEFUNG GEHT AUF DIE SORTE, NICHT AUF EINE NAMENSLISTE. `istDurchgang`
 * zaehlt zwei Namen auf und kannte deshalb `mixpi-mitschnitt` nicht — die
 * stille Aufnahme-Senke eines Plugins. Sie fiel in die Auffangregel „alles
 * andere ist intern", landete in der Verwaltung an erster Stelle und wurde
 * dort zum Gesamt-Regler: er sprang bei jedem Zug auf 100 zurueck, weil der
 * Mitschnitt pur bleiben MUSS und keinen Wert annimmt.
 *
 * Eine Liste haette man nachpflegen muessen — und das naechste Plugin haette
 * denselben Fehler ausgeloest. Hardware erkennt man an ihrem Praefix; alles
 * Virtuelle hat keines. Der Server muss dafuer keinen Plugin-Namen kennen.
 */
export function istHardwareSenke(name: unknown): boolean {
  const n = String(name ?? '')
  return /^alsa_output\./.test(n) || /^bluez_output\./.test(n)
}

/**
 * Die Senke, die die Nutzerlautstaerke traegt — Bluetooth VOR Karte. Pure.
 *
 * Dieselbe Reihenfolge wie `regelnde_senke()` in mupi-lautstaerke.sh: spielt
 * ein Kopfhoerer, gehoert ihm der Regler. Zwei Regeln waeren zwei Wahrheiten,
 * und die Oberflaeche zeigte dann etwas anderes an, als die Tasten stellen.
 */
export function regelndeSenkeWaehlen<T extends { sinkName: string }>(senken: readonly T[]): T | null {
  const echte = (senken ?? []).filter((s) => s && istHardwareSenke(s.sinkName))
  return echte.find((s) => /^bluez_output\./.test(s.sinkName)) ?? echte[0] ?? null
}

/**
 * Welche Stationen sind aktiv, in Reihenfolge? Pure.
 *
 * `da` sagt, welche Senken der Tonstapel gerade zeigt: eine Station, deren
 * Senke fehlt (Prozess noch nicht hochgekommen, Kette abgelehnt), wird
 * UEBERSPRUNGEN statt den Weg abreissen zu lassen. Das ist der Unterschied
 * zwischen „ohne Effekt" und „stumm".
 */
export function stationen(an: { klangwerk: boolean; entzerrer: boolean }, da: readonly string[]): string[] {
  const raus: string[] = []
  if (an.klangwerk && da.includes(KLANGWERK_SINK)) raus.push(KLANGWERK_SINK)
  if (an.entzerrer && da.includes(ENTZERRER_SINK)) raus.push(ENTZERRER_SINK)
  return raus
}

/** Der Ausgangsknoten einer Station. Pure. */
export function ausgangVon(sink: string): string {
  return sink === KLANGWERK_SINK ? KLANGWERK_AUSGANG : ENTZERRER_AUSGANG
}
export const EQ_BAENDER = ['tief', 'tmitte', 'mitte', 'hmitte', 'hoch'] as const
export type EqBand = (typeof EQ_BAENDER)[number]

export interface Klang {
  entzerrer: { an: boolean; baender: Record<EqBand, number> }
  /** MAC -> Millisekunden zusaetzlicher Versatz (0..1000). */
  versatz: Record<string, number>
  /**
   * Wer bei „Überall" mitspielt: Schluessel 'intern' oder eine MAC.
   * FEHLT ein Eintrag, gilt die Vorgabe: Bluetooth-Boxen spielen mit,
   * der eingebaute Lautsprecher nicht — das ist das Verhalten, das die
   * Kombi hatte, bevor sie waehlbar wurde (Betreiber 15.08.2026: „mache
   * die senken einzeln wählbar … gezielt auswählbar was man haben möchte").
   */
  ueberall: Record<string, boolean>
  /**
   * FESTGENAGELTER Pegel je Ausgabe ('intern', MAC oder 'ueberall' -> 0..125):
   * die Einmessung aus der Verwaltung (Betreiber 04.09.2026: „kann man es
   * nicht auf die eingestellte staerke nageln"). Die Wache stellt diese
   * Werte im Takt ZURUECK — gegen WirePlumber-Restore, BT-Reconnect und
   * jede andere Hand am Regler. Kein Eintrag heisst: niemand nagelt.
   */
  pegel: Record<string, number>
  /**
   * Hoechstpegel je Ausgabe ('intern' oder MAC -> 0..124): der EINMESS-Deckel
   * (Betreiber 15.08.2026: „eine maximale lautstärke was limitiert … im
   * gleichen regler"). 125 heisst „kein Deckel" und wird NICHT gespeichert.
   * Durchgesetzt wird er im Server — auch gegen Pegel, die von woanders
   * kommen (Kiosk, WirePlumber-Restore), nicht nur gegen den Regler.
   */
  deckel: Record<string, number>
}

/**
 * Darf diese Klang-Datei abgespielt werden? Pure.
 *
 * Der Probe-Endpunkt bekommt einen PFAD vom Browser — ohne diesen Riegel
 * spielte er jede Datei der Box ab (und mplayer nimmt vieles). Erlaubt ist
 * nur, was IM Klang-Ordner liegt (nach Normalisierung — `..` zaehlt nicht)
 * und wie Ton heisst.
 */
export function klangDateiErlaubt(wurzel: string, pfad: string): boolean {
  if (typeof pfad !== 'string' || pfad.length === 0 || pfad.includes('\0')) return false
  if (!/\.(wav|mp3|ogg|flac)$/i.test(pfad)) return false
  const norm = path.normalize(pfad)
  return norm.startsWith(`${path.normalize(wurzel)}${path.sep}`)
}

/** Der Deckel einer Ausgabe — 125, wenn keiner gesetzt ist. Pure. */
export function deckelFuer(klang: Klang, ziel: Ziel): number {
  if (ziel.art === 'intern') return klang.deckel['intern'] ?? 125
  if (ziel.art === 'bluetooth') return klang.deckel[ziel.mac.toUpperCase()] ?? 125
  return 125
}

export function klangVorgabe(): Klang {
  return {
    entzerrer: { an: false, baender: { tief: 0, tmitte: 0, mitte: 0, hmitte: 0, hoch: 0 } },
    versatz: {},
    ueberall: {},
    deckel: {},
    pegel: {},
  }
}

/** Spielt dieses Ziel bei „Überall" mit? Pure — die Vorgabe steht bei Klang. */
export function ueberallMitglied(klang: Klang, ziel: 'intern' | string): boolean {
  if (ziel === 'intern') return klang.ueberall['intern'] === true
  const wert = klang.ueberall[ziel.toUpperCase()]
  return wert !== false
}

/**
 * Die PipeWire-Konfiguration fuer die Überall-Kombi bauen. Pure.
 *
 * WARUM EINE GENERIERTE DATEI STATT EINER FESTEN: die Mitglieder sind
 * waehlbar. Und warum ein EIGENER pipewire-Prozess (`pipewire -c <datei>`)
 * statt `pactl load-module module-combine-sink`: der Pulse-Wrapper schluckt
 * JEDES unbekannte Argument kommentarlos (am Geraet gemessen —
 * `voelliger.quatsch=ja` laedt anstandslos), der Latenz-Ausgleich waere
 * also still verloren gegangen. Als Client-Prozess traegt das native Modul
 * alle Argumente, und ein Mitgliederwechsel ist nur ein Prozess-Neustart
 * (<1 s, gemessen) — Tonstapel und Bluetooth bleiben unberuehrt.
 *
 * Die Regeln zuenden, sobald eine passende Senke ERSCHEINT: eine gewaehlte,
 * gerade getrennte Box braucht keinen Umbau — sie tritt beim Verbinden von
 * selbst bei.
 */
export function ueberallConfBauen(intern: boolean, macs: string[]): string {
  const treffer: string[] = []
  if (intern) treffer.push('            { media.class = "Audio/Sink" node.name = "~alsa_output.*" }')
  for (const m of macs) {
    if (!istMac(m)) continue
    const unterstrichen = m.toUpperCase().replace(/:/g, '_')
    treffer.push(`            { media.class = "Audio/Sink" node.name = "~bluez_output.${unterstrichen}.*" }`)
  }
  // OHNE GLIEDER KEINE REGEL: ein `matches = []` traefe sonst ALLES.
  const regeln =
    treffer.length === 0
      ? ''
      : `      stream.rules = [
        { matches = [
${treffer.join('\n')}
          ]
          actions = { create-stream = { } }
        }
      ]\n`
  return `# VOM MIXPI-SERVER GENERIERT — Aenderungen ueberleben keinen Mitgliederwechsel.
# Quelle der Auswahl: klang.json (Verwaltung, Ton-Seite).
context.properties = { log.level = 2 }
context.spa-libs = {
  audio.convert.* = audioconvert/libspa-audioconvert
  support.*       = support/libspa-support
}
context.modules = [
  { name = libpipewire-module-protocol-native }
  { name = libpipewire-module-client-node }
  { name = libpipewire-module-adapter }
  { name = libpipewire-module-combine-stream
    args = {
      combine.mode = sink
      node.name = "${UEBERALL_SINK}"
      node.description = "Überall (Auswahl)"
      combine.latency-compensate = true
      combine.props = { audio.position = [ FL FR ] }
      stream.props = { }
${regeln}    }
  }
]
`
}

/**
 * Eine (womoeglich kaputte) klang.json in einen gueltigen Stand verwandeln.
 * Pure, nachsichtig: Unsinn wird zur Vorgabe, Zahlen werden EINGEFANGEN
 * (dB auf ±12, Versatz auf 0..1000 ms) — ein von Hand uebertriebener Wert
 * darf keine unhoerbare oder sekundenversetzte Box ergeben.
 */
export function klangNormalisieren(roh: unknown): Klang {
  const aus = klangVorgabe()
  if (!roh || typeof roh !== 'object') return aus
  const r = roh as {
    entzerrer?: { an?: unknown; baender?: Record<string, unknown> }
    versatz?: Record<string, unknown>
    ueberall?: Record<string, unknown>
  }
  aus.entzerrer.an = r.entzerrer?.an === true
  for (const b of EQ_BAENDER) {
    const w = Number(r.entzerrer?.baender?.[b])
    if (Number.isFinite(w)) aus.entzerrer.baender[b] = Math.max(-12, Math.min(12, Math.round(w)))
  }
  for (const [mac, wert] of Object.entries(r.versatz ?? {})) {
    if (!istMac(mac)) continue
    const ms = Number(wert)
    if (!Number.isFinite(ms)) continue
    const rein = Math.max(0, Math.min(1000, Math.round(ms)))
    if (rein > 0) aus.versatz[mac.toUpperCase()] = rein
  }
  for (const [ziel, wert] of Object.entries(r.ueberall ?? {})) {
    if (typeof wert !== 'boolean') continue
    if (ziel === 'intern') aus.ueberall['intern'] = wert
    else if (istMac(ziel)) aus.ueberall[ziel.toUpperCase()] = wert
  }
  for (const [ziel, wert] of Object.entries((r as { deckel?: Record<string, unknown> }).deckel ?? {})) {
    const p = Number(wert)
    if (!Number.isFinite(p)) continue
    const rein = Math.max(0, Math.min(125, Math.round(p)))
    // 125 ist „kein Deckel" — kein Eintrag, sonst wuechse die Datei mit
    // jedem Zuruecksetzen.
    if (rein >= 125) continue
    if (ziel === 'intern') aus.deckel['intern'] = rein
    else if (istMac(ziel)) aus.deckel[ziel.toUpperCase()] = rein
  }
  for (const [ziel, wert] of Object.entries((r as { pegel?: Record<string, unknown> }).pegel ?? {})) {
    const p = Number(wert)
    if (!Number.isFinite(p)) continue
    const rein = Math.max(0, Math.min(125, Math.round(p)))
    // NUR BLUETOOTH-HARDWARE wird genagelt: 'intern' ist der Tastenknopf,
    // und die Kombi-Senke ('ueberall') gehorcht Stellbefehlen nur
    // wetterwendisch (04.09.2026, zweimal am Geraet gemessen: erst hielt
    // wpctl 0.40, nach dem Neuaufbau ignorierte derselbe Aufruf) — ein
    // Nagel, der mal haelt und mal nicht, ist schlimmer als keiner.
    if (istMac(ziel)) aus.pegel[ziel.toUpperCase()] = rein
  }
  return aus
}

/** Der Schluessel eines Ziels in `pegel`/`deckel`. Pure. */
export function zielSchluessel(ziel: Ziel): string {
  if (ziel.art === 'bluetooth') return ziel.mac.toUpperCase()
  return ziel.art
}

/** Der genagelte Pegel einer Ausgabe — null, wenn niemand nagelt. Pure. */
export function pegelFuer(klang: Klang, ziel: Ziel): number | null {
  const p = klang.pegel[zielSchluessel(ziel)]
  return Number.isFinite(p) ? p : null
}

/**
 * Den Strom eines benannten Knotens in `pactl -f json list sink-inputs`
 * finden — gebraucht, um den Entzerrer-Ausgang zu verfolgen und zu
 * verschieben. Pure.
 */
export function sinkInputNachKnotenname(
  text: string,
  nodeName: string,
): { kennung: number; sinkNr: number } | null {
  let roh: unknown
  try {
    roh = JSON.parse(text)
  } catch {
    return null
  }
  if (!Array.isArray(roh)) return null
  for (const e of roh as Record<string, unknown>[]) {
    const props = (e?.properties ?? {}) as Record<string, unknown>
    if (props['node.name'] !== nodeName) continue
    const kennung = Number(e?.index)
    const sinkNr = Number(e?.sink)
    if (Number.isFinite(kennung)) return { kennung, sinkNr: Number.isFinite(sinkNr) ? sinkNr : -1 }
  }
  return null
}

/** `pactl -f json list sinks` auswerten. Pure. Nachsichtig wie oben. */
export function senkenMitPegelAusPactlJson(text: string): TonSenkeMitPegel[] {
  let roh: unknown
  try {
    roh = JSON.parse(text)
  } catch {
    return []
  }
  if (!Array.isArray(roh)) return []
  const raus: TonSenkeMitPegel[] = []
  for (const e of roh as Record<string, unknown>[]) {
    const sinkName = typeof e?.name === 'string' ? (e.name as string) : ''
    if (!sinkName) continue
    // DER ENTZERRER BEKOMMT KEINEN REGLER: als Senke gilt er sonst als
    // „intern" und stand als ZWEITER „Eingebauter Lautsprecher" in der
    // Liste (Betreiber, 15.08.2026). Sein Pegel gehoert auch niemandem:
    // er ist eine Durchgangsstation, geregelt wird an Quelle und Ziel.
    if (sinkName === ENTZERRER_SINK) continue
    const vol = (e?.volume ?? {}) as Record<string, { value_percent?: string }>
    const links = vol['front-left']?.value_percent ?? vol[Object.keys(vol)[0]]?.value_percent ?? ''
    const prozent = Number.parseInt(String(links).replace('%', ''), 10)
    raus.push({
      sinkName,
      ziel: zielAusSinkName(sinkName),
      prozent: Number.isFinite(prozent) ? prozent : 100,
    })
  }
  return raus
}

/**
 * Darf auf dieses Ziel umgeschaltet werden? Pure.
 *
 * Der wichtige Fall ist der zweite: ein nicht verbundener Lautsprecher als
 * Ausgabe bedeutet eine STUMME Box, und ALSA schaltet nicht von selbst
 * zurück. Wer das Kind vor dem stummen Kasten stehen lässt, hat nichts
 * gewonnen — also vorher prüfen statt hinterher erklären.
 */
export function darfUmschalten(
  ziel: Ziel,
  verbundene: { mac: string; name?: string }[],
): Pruefung {
  if (ziel.art === 'intern') return { ok: true }
  // Der ALTE Stapel (ALSA/bluealsa) kennt keine Kombi-Senke — dort ehrlich
  // absagen statt eine asound.conf zu erfinden, die niemand testen kann.
  if (ziel.art === 'ueberall') {
    return { ok: false, grund: 'Überall gibt es nur mit dem PipeWire-Tonstapel.' }
  }
  const da = verbundene.some((g) => g.mac.toUpperCase() === ziel.mac.toUpperCase())
  if (!da)
    return {
      ok: false,
      grund:
        'Dieses Gerät ist gerade nicht verbunden. Ohne Verbindung bliebe die Box stumm — ' +
        'erst auf der Bluetooth-Seite verbinden.',
    }
  return { ok: true }
}
