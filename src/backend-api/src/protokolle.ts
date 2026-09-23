/**
 * Protokolle lesen.
 *
 * ERSETZT logviewer.php und geht darüber hinaus: die alte Seite kannte sechs
 * fest verdrahtete Dateien. Hier kommen zusätzlich die JOURNALE der Dienste
 * dazu, die die Dienste-Seite ohnehin schon kennt — und genau die braucht man,
 * wenn ein Dienst „gestört" anzeigt und man wissen will, warum.
 *
 * Zwei Regeln wie überall in dieser Verwaltung:
 *   - Kein Pfad vom Anrufer. Die Dateien stehen in einer festen Tabelle, die
 *     Dienstnamen prüft dieselbe Freigabe wie auf der Dienste-Seite.
 *   - Keine Shell. journalctl wird über execFile mit Argument-Array gerufen.
 *
 * Und eine dritte, die hier eigen ist: es wird immer nur das ENDE gelesen.
 * Ein Protokoll kann hunderte Megabyte haben; wer es ganz in den Speicher
 * zöge, brächte auf einem Pi mit 1 GB die Box zum Stehen.
 */

export interface Protokolldatei {
  id: string
  pfad: string
  titel: string
  hinweis: string
}

/**
 * Die lesbaren Dateien. Feste Tabelle — ein Pfad aus einer Anfrage wäre ein
 * Leseloch über das ganze Dateisystem (/etc/shadow lässt grüßen).
 */
/*
 * HIER STANDEN VIER pm2-PROTOKOLLE — ENTFERNT (2026-08-02):
 *   server-out, server-error, spotify-out, spotify-error
 *   (/home/dietpi/.pm2/logs/*.log)
 *
 * Seit die Dienste als systemd-Units laufen, schreibt niemand mehr hinein. Am
 * Geraet gemessen: die Dateien standen still seit dem 29.07. 20:51 — dem Tag
 * der Umstellung —, waren aber noch da und wurden deshalb ANSTANDSLOS
 * ausgeliefert. Die Protokollseite zeigte also vier Tage alte Zeilen und sah
 * dabei aus wie immer. Ein leeres Protokoll faellt auf, ein eingefrorenes
 * nicht: das ist die gefaehrlichere Sorte.
 *
 * Ersatz gibt es bereits: dieselben Ausgaben stehen jetzt im Journal der
 * Dienste, abrufbar ueber /api/protokolle/dienst/<name> mit
 * `mupibox-server` und `mupibox-player`. Die Oberflaeche listet sie neben
 * den Dateien, es geht also nichts verloren.
 */
/*
 * ZWEI PFADE UNTER /var/log/mupibox/ — KORRIGIERT (2026-08-30):
 *   idle-shutdown      /var/log/mupibox/idle_shutdown.log     → /tmp/…
 *   shutdown-control   /var/log/mupibox/shutdown_control.log  → /tmp/…
 *
 * Beide Pfade waren beim Schreiben dieser Seite AUSGEDACHT und nie gegen die
 * Schreiber gehalten. Geschrieben wird seit jeher nach /tmp:
 *
 *   scripts/mupibox/idle_shutdown.sh:108   : "${LOG:=/tmp/idle_shutdown.log}"
 *   scripts/OnOffShim/off_trigger.sh:10    LOGFILE="/tmp/shutdown_control.log"
 *
 * `LOG` setzt niemand von aussen — `mupi_idle_shutdown.service` hat keine
 * `Environment=`-Zeile. `autosetup.sh:397` legt /var/log/mupibox/ an, und
 * danach schreibt dort nie jemand hinein. Diese Seite antwortete also fuer
 * BEIDE Dateieintraege dauerhaft „Protokoll nicht lesbar".
 *
 * DIE RICHTUNG DER KORREKTUR IST NICHT BELIEBIG. Der Leser folgt den
 * Schreibern, nicht umgekehrt: `off_trigger.sh` laeuft am Knopf und greift
 * fuer alles Erhoehte zu `sudo` — ein Schreibziel unter /var/log haette ihm
 * Rechte abverlangt, die er nicht hat. Den Ausschaltweg fuer eine Leseseite
 * umzubauen waere der teurere und riskantere von zwei Wegen.
 *
 * ES WAR SOGAR SCHON GESEHEN: der Kopf von `fehlergrund.ts` zitiert als
 * Beispiel genau das ENOENT auf /var/log/mupibox/idle_shutdown.log, am
 * 07.08.2026 an einem echten Serverprozess gemessen. Gelesen wurde daraus
 * „der Pfad steht in der Antwort" — dass er FALSCH ist, las niemand mit.
 *
 * Wache: tools/protokoll-pfade-deckung.py haelt jeden Pfad dieser Tabelle
 * gegen den Baum. `protokolle.spec.ts` prueft seit dem pm2-Fall nur
 * `!pfad.includes('.pm2')` — das Symptom des letzten Falls, nicht die Sorte.
 */
export const DATEIEN: Record<string, Protokolldatei> = {
  'idle-shutdown': {
    id: 'idle-shutdown',
    pfad: '/tmp/idle_shutdown.log',
    titel: 'Abschalten bei Nichtstun',
    hinweis: 'Wann die Box sich selbst ausgeschaltet hat. Liegt unter /tmp und ist nach einem Neustart leer.',
  },
  'shutdown-control': {
    id: 'shutdown-control',
    pfad: '/tmp/shutdown_control.log',
    titel: 'Ausschalt-Steuerung',
    hinweis: 'Warum die Box heruntergefahren ist. Liegt unter /tmp und ist nach einem Neustart leer.',
  },
  /*
   * Das Chromium-Protokoll — die letzte der 16 Funktionen aus der
   * Bestandsaufnahme (G3), die hier wirklich nur EINE Zeile kostet.
   *
   * Der alte Weg war `debug.php`: dreizehn Zeilen, die `sudo cat` auf genau
   * diesen Pfad riefen und die Datei als Download zurueckgaben. Hier liegt die
   * Tabelle schon da, es fehlte der Eintrag.
   *
   * ZWEI DINGE, DIE MAN WISSEN MUSS, und die deshalb im Hinweis stehen:
   *   1. Die Datei entsteht nur, wenn `chromium.debug` auf "1" steht — nur
   *      dann haengt chromium-autostart.sh `--enable-logging --v=1` an
   *      (Zeile 69-71). Sonst ist sie schlicht nicht da, und ein leeres
   *      Protokoll sieht aus wie ein Fehler der Verwaltung.
   *   2. Sie gehoert dem Nutzer `dietpi`, nicht root — der Pfad steht deshalb
   *      unter /home und nicht unter /var/log.
   */
  chromium: {
    id: 'chromium',
    pfad: '/home/dietpi/.config/chromium/chrome_debug.log',
    titel: 'Browser der Box (Chromium)',
    hinweis:
      'Entsteht nur bei eingeschalteter Fehlersuche (chromium.debug). Fehlt sie, ist nichts kaputt — es wird nur nichts mitgeschrieben.',
  },
}

export function istProtokolldatei(x: unknown): x is keyof typeof DATEIEN {
  return typeof x === 'string' && Object.hasOwn(DATEIEN, x)
}

/** Wie viele Zeilen höchstens — auch wenn jemand mehr verlangt. */
export const ZEILEN_MAX = 2000
export const ZEILEN_VORGABE = 200

/** Angeforderte Zeilenzahl auf etwas Vernünftiges bringen. Pure. */
export function zeilenzahl(roh: unknown): number {
  const n = typeof roh === 'string' ? Number.parseInt(roh, 10) : Number(roh)
  if (!Number.isFinite(n) || n <= 0) return ZEILEN_VORGABE
  return Math.min(Math.floor(n), ZEILEN_MAX)
}

/**
 * Die letzten n Zeilen aus einem Textstück ziehen. Pure.
 *
 * Bewusst hier und nicht per `tail`: so ist es testbar und kommt ohne einen
 * weiteren Prozess aus. Der Aufrufer liest ohnehin nur das Ende der Datei.
 */
export function letzteZeilen(text: string, n: number): string[] {
  if (!text) return []
  const zeilen = text.split('\n')
  // Ein abschliessender Zeilenumbruch erzeugt eine leere letzte Zeile, die
  // sonst als Inhalt gezählt würde.
  if (zeilen.length > 0 && zeilen[zeilen.length - 1] === '') zeilen.pop()
  return zeilen.slice(-n)
}

/**
 * Wie viel vom Dateiende gelesen werden muss, um n Zeilen sicher zu haben.
 * Pure.
 *
 * Grosszügig geschätzt (200 Byte je Zeile), gedeckelt auf 2 MB. Lieber einmal
 * etwas zu viel lesen als eine abgeschnittene Ausgabe zeigen — aber niemals
 * die ganze Datei, die auch 500 MB haben kann.
 */
export function lesefenster(zeilen: number): number {
  return Math.min(Math.max(zeilen * 200, 16 * 1024), 2 * 1024 * 1024)
}

export type Stufe = 'fehler' | 'warnung' | 'info'

/**
 * Grobe Einstufung einer Protokollzeile. Pure.
 *
 * Absichtlich einfach und PRÄFIX-/wortbasiert, nicht per Teilzeichenkette:
 * eine Zeile „keine Fehler aufgetreten" darf nicht rot leuchten. Dieselbe
 * Lehre wie beim LogCutter, wo `...WARNINGS=true` als Warnung gezählt wurde.
 */
export function stufeVonZeile(zeile: string): Stufe {
  const t = zeile.trim()
  if (/^\[?(error|err|fatal|critical|crit)\b/i.test(t)) return 'fehler'
  if (/^\[?(warn|warning)\b/i.test(t)) return 'warnung'
  // Auch die verbreitete Form „... : ERROR: ..." mitnehmen, aber nur als
  // eigenständiges Wort mit Doppelpunkt — nicht irgendwo im Fliesstext.
  if (/\b(error|fehler|failed|fehlgeschlagen)\s*:/i.test(t)) return 'fehler'
  if (/\b(warnung|warning)\s*:/i.test(t)) return 'warnung'
  return 'info'
}
