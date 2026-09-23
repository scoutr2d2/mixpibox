/**
 * WAS DIE BOX GERADE KOSTET — Prozesse, Speicher, Startzeiten.
 *
 * ══ WOZU ═══════════════════════════════════════════════════════════════════
 * Betreiber, 20.08.2026: „ich will auch einen performance tab ins admin menu
 * mit prozessen die laufen wann laufen wieviel speicher bentötigen boot zeit
 * aber in graph form."
 *
 * Der Verlauf von CPU und Speicher wird laengst mitgeschrieben
 * (systemverlauf.ts, minuetlich, sieben Tage). Was fehlte, ist die Frage
 * WOHIN der Speicher geht: eine Kurve, die 60 Prozent zeigt, sagt nicht, ob
 * das der Kiosk ist oder der Abspieldienst.
 *
 * ══ PSS UND NICHT RSS ══════════════════════════════════════════════════════
 * Chromium verteilt sich auf acht Prozesse, die sich ihren Programmtext
 * TEILEN. Wer RSS aufaddiert, zaehlt dieselben Seiten achtmal und kommt auf
 * Zahlen, die groesser sind als der verbaute Speicher. PSS (proportional set
 * size) teilt jede geteilte Seite durch die Zahl ihrer Nutzer — die Summe
 * ueber alle Prozesse ergibt damit wieder das, was wirklich belegt ist.
 *
 * DIE 16-KB-SEITEN DES PI 5 (llmwiki pi5-hat-16k-seiten) treffen uns hier
 * NICHT: smaps_rollup zaehlt bereits in Kilobyte, nicht in Seiten. Wer
 * dagegen /proc/<pid>/statm nimmt und mit 4096 multipliziert, liegt auf
 * dieser Box um den Faktor vier daneben.
 *
 * ══ ZUSAMMENFASSEN STATT AUFZAEHLEN ════════════════════════════════════════
 * Acht Chromium-Prozesse einzeln aufzulisten hilft niemandem — die Frage ist
 * „was kostet der Kiosk", nicht „was kostet Renderer #4". Prozesse werden
 * deshalb zu GRUPPEN verdichtet, und die Gruppe traegt die Zahl ihrer
 * Mitglieder, damit die Verdichtung sichtbar bleibt.
 */

/** Ein einzelner Prozess, wie ihn `ps` gemeldet hat. */
export interface RohProzess {
  pid: number
  /** Sekunden seit dem Start dieses Prozesses. */
  laufzeit: number
  /** Prozentanteil an einem Kern, wie ihn ps ueber die Lebenszeit mittelt. */
  cpu: number
  /** Der Befehl, ungekuerzt. */
  befehl: string
}

/** Eine Gruppe zusammengehoeriger Prozesse. */
export interface Gruppe {
  name: string
  /** Speicher in Kilobyte (PSS). */
  speicher: number
  anzahl: number
  /** Laufzeit des AELTESTEN Mitglieds in Sekunden. */
  laufzeit: number
  cpu: number
}

/**
 * Wie eine Befehlszeile heisst, wenn man sie einem Menschen zeigt.
 *
 * DIE REIHENFOLGE IST DIE ENTSCHEIDUNG: `chromium --type=renderer` traegt
 * beides, und wer zuerst auf „renderer" prueft, bekommt eine Gruppe
 * „Renderer" neben einer Gruppe „Kiosk" — dieselbe Sache, zweimal gezaehlt.
 * Deshalb steht der Kiosk vorn.
 */
export function nameVon(befehl: string): string {
  const b = befehl.toLowerCase()
  if (/\bcog\b|wpewebprocess|wpenetworkprocess/.test(b)) return 'Kiosk (Cog)'
  if (/chromium|chrome-sandbox/.test(b)) return 'Kiosk (Chromium)'
  if (/\bxorg\b|\/usr\/lib\/xorg/.test(b)) return 'X-Server'
  if (/node .*server\.js|server\.js/.test(b)) return 'Server (Backend)'
  if (/spotify-control|node .*player/.test(b)) return 'Abspieldienst'
  if (/\bmpv\b/.test(b)) return 'mpv'
  if (/mplayer/.test(b)) return 'mplayer'
  if (/soloist/.test(b)) return 'Soloist (Spotify)'
  if (/librespot/.test(b)) return 'librespot'
  if (/mupihat/.test(b)) return 'MuPiHAT'
  if (/pulseaudio|pipewire/.test(b)) return 'Tonsystem'
  if (/bluetoothd|bluealsa/.test(b)) return 'Bluetooth'
  if (/wpa_supplicant|dhcpcd|NetworkManager/.test(b)) return 'Netz'
  if (/systemd-journald/.test(b)) return 'Journal'
  if (/\bsystemd\b/.test(b)) return 'systemd'
  if (/python3?\b/.test(b)) {
    // Python-Dienste heissen nach ihrem SKRIPT und nicht nach dem
    // Interpreter — sonst stuenden fuenf verschiedene Aufgaben in einer Zeile.
    const m = befehl.match(/([\w.-]+)\.py\b/)
    if (m) return m[1]
  }
  const erstes = befehl.trim().split(/\s+/)[0] || 'unbekannt'
  return erstes.split('/').pop() || 'unbekannt'
}

/**
 * `ps -eo pid=,etimes=,pcpu=,args=` auswerten.
 *
 * TOLERANT GEGEN KAPUTTE ZEILEN: Eine Box, deren Prozessliste sich waehrend
 * des Lesens aendert, liefert gelegentlich abgeschnittene Zeilen. Die
 * einzelne Zeile faellt dann weg — nicht die ganze Anzeige.
 */
export function psLesen(text: string): RohProzess[] {
  const aus: RohProzess[] = []
  for (const zeile of String(text || '').split('\n')) {
    const m = zeile.trim().match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(.+)$/)
    if (!m) continue
    aus.push({
      pid: Number(m[1]),
      laufzeit: Number(m[2]),
      cpu: Number(m[3]),
      befehl: m[4],
    })
  }
  return aus
}

/**
 * Prozesse zu Gruppen verdichten und nach Speicher ordnen.
 *
 * `speicherJe` kommt getrennt herein, weil es aus smaps_rollup stammt und
 * nicht aus ps: PSS steht in keiner ps-Spalte.
 */
export function gruppieren(
  prozesse: RohProzess[],
  speicherJe: Map<number, number>,
  grenze = 12,
): { gruppen: Gruppe[]; rest: Gruppe | null; gesamt: number } {
  const nach = new Map<string, Gruppe>()
  let gesamt = 0
  for (const p of prozesse) {
    const kb = speicherJe.get(p.pid) ?? 0
    gesamt += kb
    const name = nameVon(p.befehl)
    const g = nach.get(name)
    if (g) {
      g.speicher += kb
      g.anzahl += 1
      g.cpu = Math.round((g.cpu + p.cpu) * 10) / 10
      // Der AELTESTE zaehlt: er sagt, seit wann es diese Sache gibt. Ein
      // frisch nachgestarteter Renderer macht den Kiosk nicht juenger.
      g.laufzeit = Math.max(g.laufzeit, p.laufzeit)
    } else {
      nach.set(name, { name, speicher: kb, anzahl: 1, laufzeit: p.laufzeit, cpu: p.cpu })
    }
  }
  const alle = [...nach.values()].sort((a, b) => b.speicher - a.speicher)
  const gruppen = alle.slice(0, grenze)
  const uebrig = alle.slice(grenze)
  // DER REST WIRD GENANNT UND NICHT WEGGELASSEN: ein Balkendiagramm, dessen
  // Summe nicht aufgeht, laedt zu falschen Schluessen ein.
  // „Übrige" UND KEINE ZAHL IM NAMEN: „1 weitere" ist grammatisch falsch,
  // „1 weiterer" ohne Bezugswort abgehackt, und eine Sonderbehandlung fuer
  // den Singular waere Aufwand fuer einen Randfall. Wie viele es sind, steht
  // ohnehin in `anzahl` — dort kann es die Anzeige richtig beugen.
  const rest: Gruppe | null = uebrig.length
    ? {
        name: 'Übrige',
        speicher: uebrig.reduce((s, g) => s + g.speicher, 0),
        anzahl: uebrig.reduce((s, g) => s + g.anzahl, 0),
        laufzeit: Math.max(...uebrig.map((g) => g.laufzeit)),
        cpu: Math.round(uebrig.reduce((s, g) => s + g.cpu, 0) * 10) / 10,
      }
    : null
  return { gruppen, rest, gesamt }
}

/** Was `systemd-analyze` ueber den letzten Start sagt. */
export interface Startzeit {
  /** Sekunden im Kernel. */
  kernel: number | null
  /** Sekunden im Userland. */
  userland: number | null
  /** Sekunden gesamt bis zum erreichten Ziel. */
  gesamt: number | null
}

/**
 * Die Zeile von `systemd-analyze time` auswerten.
 *
 * SIE IST NICHT IMMER GLEICH GEBAUT: mit Firmware- und Loader-Zeiten (x86)
 * stehen fuenf Posten da, auf dem Pi meist nur „kernel" und „userspace".
 * Deshalb wird nach BENANNTEN Posten gesucht und nicht nach Position.
 */
export function startzeitLesen(text: string): Startzeit {
  const zahl = (was: string): number | null => {
    // DREI SCHREIBWEISEN, alle am Geraet gesehen: "7.725s", "1min 4.123s"
    // und — der Fall, der diese Zeile gekostet hat — "794ms".
    // GEMESSEN am 20.08.2026 auf der Box: „Startup finished in 794ms (kernel)
    // + 7.725s (userspace)". Der erste Entwurf verlangte ein "s" direkt nach
    // der Zahl und fand deshalb NICHTS; die Startzeit zeigte einen leeren
    // Kernel-Posten, waehrend der Userland-Posten dastand. Ein halb
    // gefuellter Balken sieht aus wie eine Aussage.
    const m = String(text).match(
      new RegExp(`(?:(\\d+)min\\s+)?([\\d.]+)(ms|s)\\s*\\(${was}\\)`),
    )
    if (!m) return null
    const min = m[1] ? Number(m[1]) * 60 : 0
    const roh = Number(m[2])
    if (!Number.isFinite(roh)) return null
    const s = m[3] === 'ms' ? roh / 1000 : roh
    return Math.round((min + s) * 100) / 100
  }
  const gesamtM = String(text).match(/=\s*(?:(\d+)min\s+)?([\d.]+)s/)
  const gesamt = gesamtM
    ? Math.round(((gesamtM[1] ? Number(gesamtM[1]) * 60 : 0) + Number(gesamtM[2])) * 100) / 100
    : null
  return { kernel: zahl('kernel'), userland: zahl('userspace'), gesamt }
}

/** Ein Dienst mit seiner Startdauer, aus `systemd-analyze blame`. */
export interface Bremser {
  name: string
  sekunden: number
}

/**
 * `systemd-analyze blame` auswerten — wer den Start aufhaelt.
 *
 * WARUM NUR DIE OBERSTEN: die Liste hat auf dieser Box ueber hundert
 * Eintraege, und die unteren liegen im Millisekundenbereich. Ein Graph mit
 * hundert Balken zeigt nichts.
 */
export function blameLesen(text: string, grenze = 10): Bremser[] {
  const aus: Bremser[] = []
  for (const zeile of String(text || '').split('\n')) {
    const m = zeile.trim().match(/^(?:(\d+)min\s+)?([\d.]+)(m?s)\s+(\S+)$/)
    if (!m) continue
    const min = m[1] ? Number(m[1]) * 60 : 0
    const wert = Number(m[2])
    const s = m[3] === 'ms' ? wert / 1000 : wert
    aus.push({ name: m[4], sekunden: Math.round((min + s) * 100) / 100 })
    if (aus.length >= grenze) break
  }
  return aus
}

/** Ein Dienst auf der Boot-Zeitachse. */
export interface Balken {
  name: string
  /** Sekunden seit dem Systemstart, an denen der Dienst zu starten begann. */
  von: number
  /** Sekunden seit dem Systemstart, an denen er aktiv wurde. */
  bis: number
}

/**
 * `systemctl show "*.service" -p Id -p InactiveExitTimestampMonotonic
 *  -p ActiveEnterTimestampMonotonic` auswerten.
 *
 * EIN AUFRUF FUER ALLE, und das ist der Grund, warum es ueberhaupt geht:
 * einzeln abgefragt waeren es auf dieser Box 53 Prozessstarts, jeder mit
 * eigener Verbindung zum systemd-Bus. Die Sammelform liefert dieselben Daten
 * in einem Rutsch, getrennt durch Leerzeilen.
 *
 * MONOTON UND NICHT WANDUHR: Die Zeitstempel zaehlen ab dem Systemstart in
 * Mikrosekunden. Genau das braucht eine Boot-Achse — eine Wanduhr spraenge
 * beim ersten Zeitabgleich mitten im Bild.
 *
 * NUR WAS WIRKLICH LIEF: Ein Dienst, der nie startete, hat beide Stempel auf
 * 0; ein noch laufender oneshot hat `bis` = 0. Beide fallen heraus, statt als
 * Balken der Laenge „bis zum Ursprung" zu erscheinen.
 */
export function zeitachseLesen(text: string, grenze = 14, bootEnde = 0): Balken[] {
  const aus: Balken[] = []
  let name = ''
  let von = 0
  let bis = 0
  const fertig = () => {
    // Beide Stempel muessen echt sein. `von > bis` kommt bei Diensten vor,
    // die schon einmal liefen und neu gestartet wurden — dann stimmt das Paar
    // nicht mehr zusammen und ergaebe einen rueckwaerts laufenden Balken.
    if (name && von > 0 && bis > 0 && bis >= von) {
      aus.push({
        name: name.replace(/\.service$/, ''),
        von: Math.round((von / 1_000_000) * 100) / 100,
        bis: Math.round((bis / 1_000_000) * 100) / 100,
      })
    }
    name = ''
    von = 0
    bis = 0
  }
  for (const zeile of String(text || '').split('\n')) {
    const z = zeile.trim()
    if (!z) {
      fertig()
      continue
    }
    const [k, ...r] = z.split('=')
    const v = r.join('=')
    if (k === 'Id') name = v
    else if (k === 'InactiveExitTimestampMonotonic') von = Number(v) || 0
    else if (k === 'ActiveEnterTimestampMonotonic') bis = Number(v) || 0
  }
  fertig()
  // ══ NUR WAS ZUM START GEHOERT ═════════════════════════════════════════════
  // Die Stempel sagen, wann ein Dienst ZULETZT anlief — nicht, wann er beim
  // Booten anlief. Ein spaeter neu gestarteter Dienst traegt deshalb eine
  // Zeit weit jenseits des Bootvorgangs.
  // AM GERAET GESEHEN (20.08.2026): `ifup@wlan0` stand mit 17,4 bis 21,6 s in
  // der Liste, waehrend der Boot nach 8,5 s durch war — ein WLAN-Reconnect.
  // Auf einer gemeinsamen Achse zieht ein solcher Ausreisser alle anderen
  // Balken auf ein Zehntel zusammen; die Achse zeigt dann nichts mehr.
  // Mit `bootEnde = 0` bleibt alles drin — dann ist die Startzeit unbekannt,
  // und lieber eine unscharfe Achse als eine leere.
  const gefiltert = bootEnde > 0 ? aus.filter((b) => b.bis <= bootEnde) : aus
  // NACH DAUER GEORDNET UND NICHT NACH STARTZEIT: Die Frage lautet „was hat
  // aufgehalten", nicht „was kam zuerst". Wer die Reihenfolge sehen will,
  // liest sie an den Balken ab — die Achse ist ja gemeinsam.
  gefiltert.sort((a, b) => b.bis - b.von - (a.bis - a.von))
  return gefiltert.slice(0, grenze)
}
