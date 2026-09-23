/**
 * Systemzustand und die vier Knöpfe, die man täglich braucht.
 *
 * ERSETZT die Kopfleiste des PHP-Admins (Herunterfahren, Neustart, Chromium
 * neu starten, Mediendatenbank neu laden) und Teile von admin.php.
 *
 * Wie bei Diensten und Netzwerk: die Aktionen stehen in einer FESTEN Tabelle,
 * und der Anrufer schickt nur deren Kennung. Ein Pfad oder ein Befehl kommt
 * nie von außen — auch nicht mittelbar. Damit ist die Frage „was, wenn jemand
 * etwas anderes hineinschreibt?" nicht beantwortet, sondern gar nicht erst
 * gestellt.
 *
 * WARUM ES HIER KEIN „ANZEIGE NEU STARTEN" GIBT — am Gerät gelernt, zweimal:
 * `restart_kiosk.sh` beendet Chromium, und weil Chromium der Client von xinit
 * ist, stirbt damit auch X. Anschließend soll chromium-autostart.sh es wieder
 * hochbringen — das ruft aber `startx … -- tty2`, braucht also eine KONSOLE.
 * Beim Booten kommt die aus einer root-Anmeldung auf tty1; aus einem Dienst
 * (pm2) oder über SSH gibt es keine, und der Bildschirm bleibt schwarz.
 * Ein Knopf, der die Anzeige zuverlässig killt und nicht zurückholt, ist
 * schlimmer als kein Knopf. Wer die Anzeige erneuern will, startet die Box neu
 * — das dauert rund 25 Sekunden und geht immer.
 */

/**
 * WOHIN eine Aktion in der Verwaltung gehört.
 *
 * Nach derselben Leitfrage sortiert wie die Konfigurationsfelder (BEREICHE in
 * konfiguration.ts, G5 vom 03.08.2026): „Medien" ist, was DA IST, „box" ist der
 * Zustand der Maschine. Und wie dort steht die Zuordnung AM FELD und nicht in
 * der Oberfläche — sonst kennt sie jede Seite, die die Liste anzeigt, ein
 * bisschen anders, und beim nächsten Umsortieren muss man sie suchen.
 */
export type Aktionsbereich = 'medien' | 'box'

export interface SystemAktion {
  /** Was ausgeführt wird — fest, nie aus einer Anfrage zusammengesetzt. */
  befehl: string
  args: string[]
  titel: string
  hinweis: string
  /** true = die Box ist danach erst mal weg; die Oberfläche fragt dann nach. */
  einschneidend: boolean
  /** Auf welcher Seite der Verwaltung der Knopf steht. */
  bereich: Aktionsbereich
  /**
   * true = dieser Befehl nimmt den Server mit, der gerade antworten soll.
   *
   * ══ WARUM DAS EIN EIGENES DATUM IST UND NICHT `einschneidend` ═══════════
   *
   * Die beiden sehen sich ähnlich und meinen Verschiedenes. `einschneidend`
   * ist eine Frage an den MENSCHEN („bist du sicher?"). Dieses hier ist eine
   * Aussage über die MASCHINE: kommt die Antwort noch heraus, wenn wir auf
   * das Ende des Befehls warten?
   *
   * Bei `neustart` und `herunterfahren` lautet sie nein — `poweroff` beendet
   * auch den Node-Prozess, und ein `res.json()` danach ginge ins Leere. Für
   * alle anderen lautet sie ja, und dann MUSS gewartet werden: sonst meldet
   * die Oberfläche Erfolg, bevor irgendetwas passiert ist.
   *
   * WAS DAS GEKOSTET HAT: `drehung-zurueck` ruft eine Datei, die es auf der
   * Box gar nicht gibt (/opt/mupibox-tools/bootwache.py). Der Knopf meldete
   * trotzdem jahrelang „erledigt", weil die Antwort vor dem `execFile`
   * hinausging und der Fehler nur ins Serverprotokoll fiel. Ausgerechnet der
   * Knopf für den schwarzen Bildschirm log am zuverlässigsten.
   */
  nimmtUnsMit: boolean
}

/**
 * Die erlaubten Aktionen. Die Pfade stammen aus der MuPiBox-Installation
 * (/usr/local/bin/mupibox), nicht aus der Konfiguration — ein umlenkbarer
 * Pfad wäre eine Hintertür.
 */
export const AKTIONEN: Record<string, SystemAktion> = {
  'medien-neu': {
    befehl: 'sudo',
    args: ['/usr/local/bin/mupibox/m3u_generator.sh'],
    titel: 'Medien neu einlesen',
    hinweis: 'Liest die Musikdateien neu ein. Nötig, wenn neue Dateien nicht auftauchen.',
    einschneidend: false,
    // NICHT „box": das hier ändert nichts an der Maschine, es ändert, WAS DA
    // IST. Deshalb steht der Knopf seit dem 03.08.2026 auf der Medienseite und
    // nicht mehr unter System. Der Endpunkt (POST /api/system/medien-neu) ist
    // derselbe geblieben — es ist die Bedienung gewandert, nicht die Aktion.
    bereich: 'medien',
    nimmtUnsMit: false,
  },
  'drehung-zurueck': {
    // Nimmt eine falsche Bildschirm-Drehung zurueck — DERSELBE Weg, den man
    // ueber SSH nimmt (`bootwache.py --zuruecknehmen`). Er ist hier, weil der
    // Fehlerfall "schwarzer Bildschirm" das System WEITERLAUFEN laesst: Netz
    // und Verwaltung sind erreichbar, man muss nicht an die Karte.
    befehl: 'sudo',
    args: ['/opt/mupibox-tools/bootwache.py', '--zuruecknehmen'],
    titel: 'Bildschirm-Drehung zurücknehmen',
    hinweis:
      'Stellt die zuletzt bewährte Boot-Konfiguration wieder her und startet neu. ' +
      'Für den Fall, dass der Bildschirm nach einer Umstellung schwarz bleibt.',
    einschneidend: true,
    bereich: 'box',
    // AUF DIESEN HIER WIRD GEWARTET, und er ist der Grund für das ganze Datum:
    // wer ihn drückt, sieht gerade nichts und braucht die Wahrheit. „Fehlt auf
    // der Box" muss als Fehler ankommen und nicht als Haken.
    nimmtUnsMit: false,
  },
  'kiosk-heim': {
    // Beendet NUR den Browser; die Autologin-Kette der Box startet ihn
    // frisch auf der Startseite (am Geraet belegt: xinit -> chromium mit
    // fester --homepage, getty spawnt nach).
    //
    // WOZU (Betreiber, 14.08.2026): der Kiosk war per Browser-Sprung auf
    // accounts.spotify.com gelandet — fremde Seite, keine Tastatur, keine
    // Adresszeile, kein Zurueck: „ich bin gefangen bei hier am geraet den
    // ton anmelden." Der Sprung selbst ist ausgebaut; dieser Knopf ist das
    // Netz darunter, fuer jeden kuenftigen Weg, auf dem der Schirm auf
    // einer fremden Seite festhaengt.
    //
    // EIN FESTES SKRIPT, KEIN sh -c: die Tabelle setzt keine Befehle aus
    // Bestandteilen zusammen (Spec darunter — das sind root-Befehle). Und
    // anders als das einst entfernte „Anzeige neu starten" MISST das Skript
    // das Wiederkommen und endet rot, wenn die Autologin-Kette nicht
    // uebernimmt — der Knopf sagt dann die Wahrheit statt „erledigt".
    befehl: 'sudo',
    args: ['/usr/local/bin/mupibox/mupi-kiosk-heim.sh'],
    titel: 'Kiosk zurückholen',
    hinweis:
      'Beendet den Browser der Box; er startet von selbst frisch auf der Startseite. ' +
      'Für den Fall, dass der Bildschirm auf einer fremden Seite festhängt.',
    // einschneidend, aus ZWEI Gruenden: der Schirm wird kurz schwarz (das
    // ist eine Frage an den Menschen) — und box + nicht-einschneidend
    // stuende NIRGENDS in der Bedienung (die Systemseite zeigt nur
    // Einschneidendes; der Bedienweg-Test unten haelt genau dieses Loch).
    einschneidend: true,
    bereich: 'box',
    nimmtUnsMit: false,
  },
  neustart: {
    befehl: 'sudo',
    args: ['/usr/local/bin/mupibox/restart.sh'],
    titel: 'Box neu starten',
    hinweis: 'Die Box fährt herunter und wieder hoch. Das dauert etwa eine Minute.',
    einschneidend: true,
    bereich: 'box',
    nimmtUnsMit: true,
  },
  herunterfahren: {
    befehl: 'sudo',
    args: ['/usr/local/bin/mupibox/shutdown.sh'],
    titel: 'Box ausschalten',
    hinweis: 'Die Box fährt herunter. Zum Einschalten muss jemand am Gerät sein.',
    einschneidend: true,
    bereich: 'box',
    nimmtUnsMit: true,
  },
}

export function istSystemAktion(x: unknown): x is keyof typeof AKTIONEN {
  return typeof x === 'string' && Object.hasOwn(AKTIONEN, x)
}

/**
 * Laufzeit in etwas Lesbares übersetzen. Pure.
 *
 * „268344 Sekunden" beantwortet die eigentliche Frage nicht — die lautet
 * meistens „läuft die Box seit dem letzten Stromausfall durch?".
 */
export function laufzeitText(sekunden: number): string {
  if (!Number.isFinite(sekunden) || sekunden < 0) return 'unbekannt'
  const s = Math.floor(sekunden)
  const tage = Math.floor(s / 86400)
  const stunden = Math.floor((s % 86400) / 3600)
  const minuten = Math.floor((s % 3600) / 60)
  if (tage > 0) return `${tage} ${tage === 1 ? 'Tag' : 'Tage'}, ${stunden} h`
  if (stunden > 0) return `${stunden} h ${minuten} min`
  return `${minuten} min`
}

/**
 * Temperatur aus /sys/class/thermal/... lesen. Pure.
 *
 * Der Kernel liefert Milligrad ("54321" = 54,3 °C). Auf Rechnern ohne diese
 * Datei gibt es schlicht keine Angabe — null, nicht 0, sonst stünde dort
 * „0 °C" und jemand sucht nach einem Fehler.
 */
export function parseTemperatur(text: string): number | null {
  const roh = Number.parseInt(text.trim(), 10)
  if (!Number.isFinite(roh)) return null
  const grad = roh > 1000 ? roh / 1000 : roh
  // Werte außerhalb jeder Vernunft deuten auf einen anderen Sensor hin.
  if (grad < -50 || grad > 150) return null
  return Math.round(grad * 10) / 10
}

export interface Platte {
  gesamt: number
  benutzt: number
  frei: number
  prozent: number
}

/**
 * Ausgabe von `df -B1 /` auswerten. Pure.
 *
 * -B1 zwingt Bytes, damit nicht je nach Umgebung K/M/G herauskommt. Die
 * Kopfzeile wird übersprungen; eine lange Gerätebezeichnung kann die Zeile
 * umbrechen, deshalb wird von HINTEN gezählt.
 */
export function parseDf(text: string): Platte | null {
  const zeilen = text.trim().split('\n').filter(Boolean)
  if (zeilen.length < 2) return null
  const felder = zeilen[zeilen.length - 1].trim().split(/\s+/)
  if (felder.length < 5) return null
  // Von hinten: … <gesamt> <benutzt> <frei> <prozent> <einhängepunkt>
  const prozent = Number.parseInt(felder[felder.length - 2], 10)
  const frei = Number(felder[felder.length - 3])
  const benutzt = Number(felder[felder.length - 4])
  const gesamt = Number(felder[felder.length - 5])
  if (![gesamt, benutzt, frei].every(Number.isFinite) || gesamt <= 0) return null
  return { gesamt, benutzt, frei, prozent: Number.isFinite(prozent) ? prozent : 0 }
}

/** Bytes in etwas Lesbares. Pure. */
export function groesse(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '–'
  const einheiten = ['B', 'kB', 'MB', 'GB', 'TB']
  let i = 0
  let z = bytes
  while (z >= 1024 && i < einheiten.length - 1) {
    z /= 1024
    i++
  }
  return `${z.toFixed(z < 10 && i > 0 ? 1 : 0)} ${einheiten[i]}`
}

/**
 * Ist der Platz knapp? Pure.
 *
 * Nicht nur Kosmetik: eine volle Karte ist auf dieser Box schon einmal als
 * „Backend tot" aufgetreten, weil ein fehlgeschlagener Schreibvorgang den
 * Server mitnahm. Ab 90 % soll die Seite das sagen, BEVOR es weh tut.
 */
export function platteKnapp(p: Platte | null): boolean {
  return p !== null && p.prozent >= 90
}
