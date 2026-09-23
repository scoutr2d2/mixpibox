/**
 * DER GRUND NACH DRAUSSEN — ohne den Pfad.
 *
 * WARUM ES DIESE DATEI GIBT. Der Fehlerbehandler ganz unten in server.ts
 * beantwortet nur, was bis zu ihm KOMMT. Ein Weg mit eigenem `try/catch`, der
 * `err.message` in seine Antwort schreibt, geht an ihm vorbei — und
 * `err.message` eines Dateizugriffs IST der Pfad:
 *
 *   GET /api/protokolle/datei/idle-shutdown
 *   → {"error":"Protokoll nicht lesbar",
 *      "grund":"ENOENT: no such file or directory, stat '/var/log/mupibox/idle_shutdown.log'"}
 *
 * Am 07.08.2026 an einem echten Serverprozess ohne NODE_ENV gemessen
 * (tools/fehlerbehandler-leck-schau.mjs). Die Verwaltung steht auf einer
 * Bestandsbox OHNE Anmeldung offen (`interfacelogin.state` ist in der Vorlage
 * `false`) — das ging also an jeden im Netz.
 *
 * DIE REGEL IST DIESELBE WIE OBEN IM BEHANDLER: ein FESTER Satz je Fall.
 * Nicht „die Meldung durchreichen, wenn sie harmlos aussieht" — welche
 * Meldung gerade vorliegt, weiss diese Stelle nicht, und die naechste
 * Fehlerquelle bringt eine Meldung mit, an die hier niemand gedacht hat.
 * Was ueber das Netz geht, ist knapp; was ins Protokoll geht, bleibt
 * vollstaendig (das machen die Aufrufer, jeder mit seinem eigenen
 * `console.warn`).
 *
 * DER SATZ IST TROTZDEM EINE AUSKUNFT. „Die Datei gibt es nicht" und „die Box
 * darf sie nicht lesen" sind zwei verschiedene Sachen, und der Betreiber vor
 * dem Bildschirm kann mit dem Unterschied etwas anfangen. Verschwiegen wird
 * der Pfad, nicht der Grund.
 */

/** Was ein Systemfehler von Node an Zusatzangaben mitbringt. */
interface Systemfehler {
  code?: unknown
}

/**
 * Ein kurzer, pfadfreier Grund fuer eine Antwort nach draussen.
 *
 * Gefuettert wird ausschliesslich `err.code` — die Kennung, die Node an
 * Systemfehlern setzt. Die MELDUNG wird nie angesehen: sie ist genau das
 * Feld, in dem der Pfad steht.
 */
export function grundNachAussen(err: unknown): string {
  const code = (err as Systemfehler | null | undefined)?.code
  switch (typeof code === 'string' ? code : '') {
    case 'ENOENT':
      return 'Die Datei gibt es (noch) nicht.'
    case 'EACCES':
    case 'EPERM':
      return 'Die Box darf da nicht hinsehen.'
    case 'EISDIR':
      return 'Da liegt ein Verzeichnis, keine Datei.'
    case 'ENOTDIR':
      return 'Der Weg dorthin stimmt nicht.'
    case 'EMFILE':
    case 'ENFILE':
      return 'Die Box hat gerade zu viele Dateien offen.'
    case 'ENOSPC':
      return 'Auf der Karte ist kein Platz mehr.'
    case 'EROFS':
      return 'Die Karte laesst sich gerade nicht beschreiben.'
    case 'ETIMEDOUT':
    case 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER':
      return 'Das hat zu lange gedauert.'
    default:
      return 'Das hat nicht geklappt.'
  }
}
