// mpv hinter DEMSELBEN Vertrag wie mplayer-wrapper.ts — der Nachfolger.
//
// Die Übersetzung (Befehle, Werte, Meldungen) liegt rein in mpv-protokoll.ts
// und ist dort geprüft. Hier steht nur die Verkabelung: Prozess starten,
// Unix-Socket verbinden, Zeilen zuordnen, Ereignisse abgeben.
//
// UNTERSCHIED ZU MPLAYER, DER DIE ARBEIT LEICHTER MACHT
// mplayer musste für jeden Wert einzeln gefragt werden (`get_property` im
// Sekundentakt, siehe die setInterval in spotify-control). mpv kann
// Eigenschaften BEOBACHTEN (`observe_property`) und meldet Änderungen von
// selbst. Beides wird unterstützt: getProps() bleibt, damit der vorhandene
// Aufrufer unverändert weiterläuft, aber die Beobachtung liefert die Werte
// auch ohne ihn — flüssiger und mit weniger Verkehr.

import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

import {
  anfrageZeile,
  BEFEHLE,
  darfGemeldetWerden,
  EIGENSCHAFTEN,
  type MpvBefehl,
  meldungLesen,
  ohneTitel,
  wertUmsetzen,
} from './mpv-protokoll'

// Derselbe Vertrag wie MplayerPlayer — bewusst wortgleich, damit
// spotify-control nicht angefasst werden muss.
interface MpvPlayer extends EventEmitter {
  exec(cmd: string, args?: Array<string | number>): void
  getProps(props: string[]): void
  seek(pos: number | string): void
  seekPercent(pos: number | string): void
  /** `titel` ist WAHLFREI und gibt es bei mplayer NICHT — dort fällt das
   *  zweite Argument ins Leere, und der Aufrufer darf es trotzdem übergeben.
   *  Wozu es dient, steht an `ladeBefehl` in mpv-protokoll.ts (F1).
   *  `ab` (Sekunden) überspringt den Anfang — der Vorspann-Sprung; ebenfalls
   *  wahlfrei und bei mplayer wirkungslos. */
  play(fileOrUrl: string, titel?: string, ab?: number): void
  playList(fileOrUrl: string): void
  queue(fileOrUrl: string, titel?: string, ab?: number): void
  queueList(fileOrUrl: string): void
  next(): void
  previous(): void
  playPause(): void
  /** AUSDRUECKLICH pausieren/weiterspielen (absolut, kein Umschalter).
   *  Gibt es bei mplayer NICHT (der kennt nur den Umschalter) — Aufrufer
   *  muessen auf Vorhandensein pruefen. */
  pauseAn?(): void
  pauseAus?(): void
  setVolume(amount: number | string): void
  /** Absolut zu Titel N springen (1-basiert). Gibt es bei mplayer NICHT —
   *  Aufrufer muessen auf Vorhandensein pruefen. */
  titelPos?(n: number | string): void
  stop(): void
  close(): void
}

interface MpvOptionen {
  /** Ausführbares mpv (für Tests überschreibbar). */
  programm?: string
  /** Zusätzliche Argumente, z. B. --ao=alsa/--audio-device. */
  argumente?: string[]
  /** Pfad des IPC-Sockets; sonst einer im Temp-Verzeichnis. */
  socket?: string
}

const createPlayer = (opt: MpvOptionen = {}): MpvPlayer => {
  const out = new EventEmitter() as MpvPlayer
  const sockPfad = opt.socket || path.join(os.tmpdir(), `mupibox-mpv-${process.pid}-${Date.now()}.sock`)

  // Ein liegengebliebener Socket aus einem Absturz würde mpv am Start hindern.
  try {
    fs.unlinkSync(sockPfad)
  } catch {
    /* gab es nicht — gut so */
  }

  const proc = spawn(
    opt.programm || 'mpv',
    [
      '--idle=yes', // ohne Datei nicht beenden — mplayers -idle
      '--no-video',
      '--no-terminal', // keine Tastatursteuerung, kein Statusgeschreibsel
      '--msg-level=all=warn',
      /* ══ DER PUFFER IST FÜR VIDEO GEBAUT, NICHT FÜR HÖRSPIELE (E51) ═══════
       *
       * GEMESSEN an der laufenden Box (20.08.2026): mpv belegte im LEERLAUF
       * 152 MB PSS, davon 134 MB anonymer Speicher — und hatte dabei nichts
       * geladen (`get_property path` → "property unavailable"). Der Grund
       * steht in mpvs eigener Voreinstellung:
       *
       *     --demuxer-max-bytes   default: 150.000 MiB
       *
       * Das ist die Auslegung für Video. Diese Box spielt Ton: MP3 mit
       * 128 kbps sind 16 kB/s, ARD liefert 128er-MP3, Spotify läuft ohnehin
       * über librespot/soloist. 32 MiB fassen damit rund 33 MINUTEN Vorlauf
       * — mehr, als jede Netzstörung überbrücken muss, und ein Fünftel des
       * bisherigen Anspruchs.
       *
       * `--cache-secs` bleibt unangetastet: es deckelt die Sekunden, nicht
       * die Bytes, und ist ohne die Byte-Grenze wirkungslos gewesen.
       *
       * WARUM NICHT KLEINER: bei einer Netzstörung liest mpv aus dem Puffer
       * weiter. Wer ihn auf 4 MiB stellt, hört bei jedem WLAN-Zucken eine
       * Lücke — und genau daran arbeitet die Netzabriss-Spur gerade.
       */
      '--demuxer-max-bytes=32MiB',
      '--demuxer-max-back-bytes=8MiB',
      /* ══ GLEICH LAUT ÜBER ALLE STÜCKE (21.08.2026) ═══════════════════════
       *
       * Betreiber: gefragt war Lautheit „beides" — innerhalb eines Stücks
       * (das macht der Kompressor im Klangwerk) UND zwischen den Stücken.
       * Dieses hier ist das Zwischen.
       *
       * DAS PROBLEM IST ALLTÄGLICH: ein Hörspiel ist leise gemastert, das
       * nächste laut, ein altes Kinderlied wieder anders. Wer die Lautstärke
       * für das eine einstellt, erschrickt beim nächsten — und bei einer Box,
       * die ein Kind allein bedient, wird daraus entweder zu leise oder zu
       * laut.
       *
       * REPLAYGAIN UND NICHT `loudnorm`: mpv kann beides, aber `loudnorm`
       * (ffmpeg, EBU R128) ANALYSIERT beim Abspielen und braucht dafür
       * Vorlauf — auf einem Pi kostet das Rechenzeit bei jedem Titel.
       * ReplayGain liest nur ein TAG, das im Stück schon steht, und kostet
       * nichts.
       *
       * `--replaygain=track` und nicht `album`: die Box spielt Hörspiel-
       * kapitel und einzelne Lieder, oft quer durcheinander. Album-Werte
       * hielten die Lautheitsunterschiede INNERHALB eines Albums absichtlich
       * fest — richtig für eine durchgehörte Platte, falsch für eine
       * Kachelbox.
       *
       * `--replaygain-clip=yes` LÄSST mpv NOTFALLS DÄMPFEN, damit eine
       * angehobene Datei nicht übersteuert. Das ist die billigere Hälfte
       * dessen, was der Begrenzer im Klangwerk tut, und sie greift schon,
       * bevor das Signal die Kette erreicht.
       *
       * OHNE TAG PASSIERT NICHTS. Die meisten gerippten und heruntergeladenen
       * Dateien tragen ReplayGain-Tags; wo keine sind, spielt mpv wie bisher.
       * Das ist der ehrliche Stand — es ist eine Verbesserung für den
       * Großteil der Bibliothek, keine Garantie für jede Datei.
       *
       * SPOTIFY IST NICHT BETROFFEN: das läuft über soloist, nicht über mpv.
       * Dort normalisiert der Dienst selbst.
       */
      '--replaygain=track',
      '--replaygain-clip=yes',
      /* ══ DEN NÄCHSTEN EINTRAG SCHON LADEN (E108) ═════════════════════════
       *
       * Betreiber (31.08.2026): „beim linearen abspielen könnte man ja schon
       * vor laden … zumindest wenn das nächste kommt." Innerhalb der
       * mpv-Familie ist genau das eine EINGEBAUTE Option: mpv öffnet den
       * nächsten Warteschlangen-Eintrag, während der aktuelle noch spielt —
       * der Übergang Datei→Stromadresse in der Mischliste (lokal neben
       * Jellyfin, E108) kommt damit ohne Anlauf-Lücke aus. Der teure Fall
       * bleibt der MASCHINENWECHSEL zu Spotify; der ist hier ausdrücklich
       * nicht gelöst (E108 Stufe 3, PipeWire-Cue).
       *
       * Die Grenze der Option, ehrlich benannt (mpv-Handbuch): vorgeladen
       * wird beim ERREICHEN des Endes, nicht Minuten vorher, und nur der
       * jeweils nächste Eintrag — genau das reicht für einen nahtlosen
       * Übergang und hält den Puffer-Deckel oben (32 MiB) unangetastet. */
      '--prefetch-playlist=yes',
      `--input-ipc-server=${sockPfad}`,
      ...(opt.argumente || []),
    ],
    { env: process.env, stdio: ['ignore', 'ignore', 'pipe'] },
  )

  let sock: net.Socket | null = null
  let warteschlange: string[] = []
  let anfrageId = 0
  // Welche Abfrage wollte welche Eigenschaft wissen? Nötig, weil mpv in der
  // Antwort nur die request_id zurückgibt, nicht den Namen.
  const offeneAbfragen = new Map<number, string>()
  // Welcher `loadfile` trug einen erzwungenen Titelnamen — und wie hieße er
  // ohne? Siehe `ladeMit` weiter unten.
  const offeneLadungen = new Map<number, MpvBefehl>()

  const sende = (zeile: string): void => {
    if (sock?.writable) sock.write(zeile)
    else warteschlange.push(zeile) // vor dem Verbinden gesendet: nachholen
  }
  const schicke = (befehl: MpvBefehl): void => sende(anfrageZeile(befehl, ++anfrageId))

  /**
   * Einen `loadfile` schicken und den RÜCKFALL bereithalten.
   *
   * WARUM ÜBERHAUPT EIN RÜCKFALL: Der Titelname reist als Datei-Option mit
   * (`force-media-title`), und die Langform mit Index gibt es erst in
   * neueren mpv. Lehnt ein älteres mpv den Befehl ab, wird GAR NICHTS
   * geladen — die Box bliebe stumm, und zwar still: mpv antwortet nur auf dem
   * Socket, die Oberfläche bekäme weiterhin ihr `{status:'ok'}`.
   *
   * Ein falscher Titelname ist ein Schönheitsfehler. Eine stumme Box ist
   * keiner. Deshalb wird ein fehlgeschlagener `loadfile` MIT Namen ohne ihn
   * wiederholt — dann spielt die Folge, und die Anzeige ist so gut wie vor
   * diesem Umbau. Gemeldet wird es trotzdem, sonst sucht man den fehlenden
   * Namen später im Dunkeln.
   */
  const ladeMit = (befehl: MpvBefehl): void => {
    const id = ++anfrageId
    const rueckfall = ohneTitel(befehl)
    if (rueckfall) offeneLadungen.set(id, rueckfall)
    sende(anfrageZeile(befehl, id))
  }

  // ── Verbinden, sobald mpv den Socket angelegt hat ────────────────────────
  // mpv erzeugt ihn erst nach dem Start; ein sofortiger connect schlägt fehl.
  // Deshalb mit Frist wiederholen statt blind zu warten.
  let versuche = 0
  const verbinde = (): void => {
    if (proc.exitCode !== null) return
    const s = net.createConnection(sockPfad)
    s.on('connect', () => {
      sock = s
      s.setEncoding('utf8')
      // Ab jetzt meldet mpv Änderungen von selbst. Die Beobachtungs-Nummer
      // ist mpvs eigene und hat mit request_id nichts zu tun — deshalb ein
      // eigener Zähler, sonst verschiebt sich beides gegeneinander.
      let beobachtungId = 0
      for (const mpvName of Object.values(EIGENSCHAFTEN)) {
        schicke(BEFEHLE.beobachte(++beobachtungId, mpvName))
      }
      const nachzuholen = warteschlange
      warteschlange = []
      for (const z of nachzuholen) s.write(z)
      out.emit('bereit')
    })
    s.on('error', () => {
      if (++versuche < 100 && proc.exitCode === null) setTimeout(verbinde, 50)
      else out.emit('error', new Error(`mpv-Socket ${sockPfad} nicht erreichbar`))
    })

    let rest = ''
    s.on('data', (stueck: string) => {
      // Zeilenweise selbst zusammensetzen: ein TCP/Unix-Stück endet nicht
      // zwingend an einer Zeilengrenze, und eine halb gelesene JSON-Zeile
      // wäre ein Fehler mitten in der Wiedergabe.
      rest += stueck
      const zeilen = rest.split('\n')
      rest = zeilen.pop() || ''
      for (const z of zeilen) if (z.trim()) verarbeite(z)
    })
  }

  const verarbeite = (zeile: string): void => {
    const m = meldungLesen(zeile)
    if (m.art === 'eigenschaft') {
      // Ein leerer filename/path wird geschluckt — siehe darfGemeldetWerden.
      if (!darfGemeldetWerden(m.name, m.wert)) return
      out.emit('prop', m.name, m.wert)
      out.emit(m.name, m.wert)
      return
    }
    if (m.art === 'antwort') {
      // ERST DIE LADUNGEN: ein `loadfile` ist keine Abfrage, seine Antwort
      // steht in keinem `offeneAbfragen` und wäre unten still verworfen
      // worden — genau der Fall, den der Rückfall abfangen soll.
      const rueckfall = offeneLadungen.get(m.anfrageId)
      if (rueckfall !== undefined) {
        offeneLadungen.delete(m.anfrageId)
        if (!m.erfolg) {
          out.emit('stderr', 'mpv-wrapper: loadfile mit force-media-title abgelehnt — noch einmal ohne Titelnamen\n')
          schicke(rueckfall)
        }
        return
      }
      const name = offeneAbfragen.get(m.anfrageId)
      offeneAbfragen.delete(m.anfrageId)
      if (!name || !m.erfolg) return // fehlgeschlagene Abfrage: still verwerfen, wie früher
      const wert = wertUmsetzen(name, m.wert)
      // Auch die ANTWORT auf getProps(['filename']) kann leer sein — ein
      // Titelwechsel feuert, bevor mpv die Datei offen hat. Gleiche Regel.
      if (!darfGemeldetWerden(name, wert)) return
      out.emit('prop', name, wert)
      out.emit(name, wert)
      return
    }
    if (m.art === 'titelwechsel') out.emit('track-change')
    else if (m.art === 'listeEnde') out.emit('playlist-finish')
  }

  setTimeout(verbinde, 20)

  let geschlossen = false
  // Lässt sich mpv gar nicht starten (nicht installiert -> ENOENT), meldet
  // Node das als 'error' auf dem Kindprozess. OHNE diesen Hörer WIRFT das und
  // reisst den ganzen Wiedergabe-Dienst mit — pm2 startet neu, es scheitert
  // wieder, und die Box ist in einer Schleife statt mit einer Meldung stumm.
  // Genau der Fall, der eintritt, wenn jemand in der Verwaltung auf mpv
  // stellt, ohne es installiert zu haben.
  proc.on('error', (e) => {
    if (geschlossen) return
    geschlossen = true
    out.emit('stderr', `mpv laesst sich nicht starten: ${e.message}\n`)
    out.emit('close', null)
  })
  proc.on('close', (code) => {
    geschlossen = true
    try {
      sock?.destroy()
    } catch {
      /* egal */
    }
    try {
      fs.unlinkSync(sockPfad)
    } catch {
      /* schon weg */
    }
    out.emit('close', code)
  })
  // mpvs Warnungen nicht verschlucken — sonst sucht man Fehler im Dunkeln.
  proc.stderr?.on('data', (b: Buffer) => out.emit('stderr', b.toString()))

  // ── der Vertrag ──────────────────────────────────────────────────────────
  //
  // ══ KLEBRIGE EIGENSCHAFTEN ABSTREIFEN (15.08.2026, am Geraet bewiesen) ══
  // `pause` und `loop-file` sind bei mpv EIGENSCHAFTEN DES PROZESSES, nicht
  // der Wiedergabe: beide ueberleben `stop` UND den naechsten `loadfile`.
  // Die Folgen sehen aus wie zwei verschiedene Fehler und sind derselbe:
  //   * pause=yes von frueher -> der naechste Start steht lautlos still
  //     („es spielt nicht einfach den naechsten titel ab");
  //   * loop-file=inf von frueher -> Folge 1 kreist endlos, waehrend die
  //     volle Warteschlange daneben wartet (gemessen: Zeit sprang 318 -> 2
  //     auf DERSELBEN Position, statt auf Folge 2 zu ruecken).
  // Deshalb streift jeder START und jedes STOP beide Eigenschaften ab —
  // hier im Wrapper, damit KEIN Aufrufer daran denken muss.
  const abstreifen = () => {
    schicke(['set_property', 'pause', false])
    schicke(['set_property', 'loop-file', 'no'])
  }
  out.play = (f, titel, ab) => {
    abstreifen()
    ladeMit(BEFEHLE.play(f, titel, ab))
  }
  out.playList = (f) => {
    abstreifen()
    schicke(BEFEHLE.playList(f))
  }
  out.queue = (f, titel, ab) => ladeMit(BEFEHLE.queue(f, titel, ab))
  out.queueList = (f) => schicke(BEFEHLE.queueList(f))
  out.next = () => schicke(BEFEHLE.next())
  out.previous = () => schicke(BEFEHLE.previous())
  out.playPause = () => schicke(BEFEHLE.playPause())
  // Absolut statt Umschalter: `cycle pause` hinter einem Merkfeld kann
  // kippen (Feld sagt „spielt", mpv steht) — wer AUSDRUECKLICH Pause oder
  // Weiter will, setzt die Eigenschaft und kann nicht danebengreifen.
  out.pauseAn = () => schicke(['set_property', 'pause', true])
  out.pauseAus = () => schicke(['set_property', 'pause', false])
  out.stop = () => {
    schicke(BEFEHLE.stop())
    abstreifen()
  }
  out.setVolume = (n) => schicke(BEFEHLE.setVolume(n))
  out.seek = (n) => schicke(BEFEHLE.seek(n))
  out.titelPos = (n) => schicke(BEFEHLE.titelPos(n))
  out.seekPercent = (n) => schicke(BEFEHLE.seekPercent(n))

  out.getProps = (props) => {
    for (const p of props) {
      const mpvName = EIGENSCHAFTEN[p]
      if (!mpvName) continue // unbekannt: still übergehen, wie mplayer es tat
      const id = ++anfrageId
      offeneAbfragen.set(id, p)
      sende(anfrageZeile(BEFEHLE.getProp(mpvName), id))
    }
  }

  // exec() gibt es nur, weil spotify-control es an einer Stelle benutzt. Ein
  // roher mplayer-Slave-Befehl hat in mpv keine Entsprechung — statt ihn
  // stillschweigend zu verschlucken, wird er gemeldet.
  out.exec = (cmd, args = []) => {
    out.emit('stderr', `mpv-wrapper: roher Befehl ohne Entsprechung übergangen: ${cmd} ${args.join(' ')}\n`)
  }

  out.close = () => {
    if (geschlossen) return
    schicke(BEFEHLE.quit())
    // Nachfassen, falls mpv den quit nicht mehr liest.
    setTimeout(() => {
      if (!geschlossen) proc.kill('SIGTERM')
    }, 1500).unref?.()
  }

  return out
}

export = createPlayer
