/**
 * Vorlesen im Abspieldienst — EIN Sprechweg statt zwei.
 *
 * WAS HIER FRUEHER STAND und warum es weg ist (am Geraet belegt, 04.08.2026,
 * Box .169, mit tools/sprechwege-am-geraet.sh):
 *
 * Der Abspieldienst holte den Ton bei GOOGLE (`google-tts-api`), legte ihn als
 * MP3 unter `/home/dietpi/MuPiBox/tts_files` ab und spielte die Datei. Das war
 * gleich dreifach kaputt:
 *
 *   1. DAS VERZEICHNIS GAB ES NICHT. `autosetup.sh` legt es an, diese Box hatte
 *      es nicht (mehr). Ergebnis im Protokoll, woertlich:
 *        Error: ENOENT ... open '/home/dietpi/MuPiBox/tts_files/Probe Google.mp3'
 *      Also: Ton bei Google geholt, Netz belastet — und dann weggeworfen. Der
 *      Fehler landete in `.catch(console.error)` und war am Bildschirm unsichtbar.
 *   2. DIE GANZE TONDATEI STAND IM SYSTEMPROTOKOLL. `console.log({ base64 })`
 *      schrieb jede Ansage vollstaendig als Base64 in den Journal — beim Messen
 *      rund 5 kB Rauschen fuer zwei gesprochene Woerter.
 *   3. DER ZWEIG FEUERTE NUR MIT ANHAENGSEL. Geprueft wurde
 *      `command.dir.includes('say/')`, aber `path.parse('/current/say/Hallo')`
 *      liefert `dir = '/current/say'` — OHNE Schraegstrich am Ende. Nur weil die
 *      Oberflaeche die Lautstaerke anhaengt (`/current/say/Hallo/40`, aus
 *      `/api/sonos` -> `tts.volume`) wurde der Zweig ueberhaupt erreicht. Ohne
 *      dieses Anhaengsel blieb die Box still, ohne eine Zeile im Protokoll.
 *      (Diese Lautstaerke wurde uebrigens abgeschnitten und nie benutzt.)
 *
 * PIPER KANN DAS ALLES SCHON, und zwar besser: er rechnet AUF der Box (kein
 * Netz, kein fremder Dienst, keine Kinderstimmen bei Google), er hat einen
 * Zwischenspeicher, und der Server haelt den Dienst warm. Am Geraet gemessen
 * (04.08.2026): 1,69 s kalt, 0,0016 s warm.
 *
 * DESHALB LAEDT DIESER DIENST GAR NICHTS MEHR HERUNTER. Er spielt die
 * Schnittstelle des Servers DIREKT ab — `http://127.0.0.1:8200/api/vorlesen/
 * sprich?text=…`. Am Geraet geprueft: mpv UND mplayer spielen diese Adresse
 * anstandslos (2,0 s Ton, sauber erkanntes PCM 22050 Hz). Damit entfaellt der
 * ganze Dateikram — und mit ihm die Fehlerklasse aus Punkt 1.
 *
 * WAS PIPER NICHT KANN, ausdruecklich hingeschrieben statt verschwiegen: von
 * den 21 Sprachen der alten Google-Liste deckt der Piper-Bestand 20 ab. Es
 * FEHLT genau eine: JAPANISCH (`ja`). Gemessen 04.08.2026 gegen den
 * Stimmenkatalog (171 Stimmen, 49 Sprachfamilien), siehe
 * tools/sprachdeckung-piper-google.py. Wer die Box auf Japanisch vorlesen
 * lassen will, kann das nach dieser Umstellung nicht mehr.
 */

/** Laenger nimmt der Server ohnehin nicht an (VL_TEXT_MAX in server.ts). */
export const SPRECH_TEXT_MAX = 300

/**
 * Den zu sprechenden Text aus einem Abspiel-Pfad holen.
 *
 * Die Oberflaeche schickt Befehle als PFAD, nicht als Abfrage — das ist das
 * Erbe von sonos-kids-controller. Fuer das Vorlesen kommen drei Formen vor:
 *
 *   /<raum>/say/Hallo%20Welt        die schlichte
 *   /<raum>/say/Hallo%20Welt/40     mit angehaengter Lautstaerke (die
 *                                   Oberflaeche haengt sie an, sobald in
 *                                   /api/sonos ein `tts.volume` steht — auf
 *                                   dieser Box "40")
 *   /<raum>/say/Hallo/Welt          die alte mehrteilige (der Vorlaeufer
 *                                   ersetzte Schraegstriche durch Leerzeichen)
 *
 * ALLE DREI werden verstanden. Die alte Fassung verstand faktisch nur die
 * zweite (siehe Kopfkommentar, Punkt 3) — wer die Lautstaerke aus der
 * Konfiguration nahm, machte die Box damit stumm.
 *
 * @returns den Text, oder null wenn das kein Sprechbefehl ist.
 */
export function sprechTextAus(pfad: unknown): string | null {
  if (typeof pfad !== 'string' || !pfad) return null
  // Eine Abfrage haengt nicht am Text — und `path.parse` wuerde sie mitnehmen.
  const ohneAbfrage = pfad.split('?')[0].split('#')[0]
  const teile = ohneAbfrage.split('/').filter(Boolean)
  const wo = teile.indexOf('say')
  if (wo < 0) return null

  const rest = teile.slice(wo + 1)
  if (rest.length === 0) return null

  // Die angehaengte Lautstaerke ist KEIN Text. Sie wurde noch nie angewendet
  // (der Vorlaeufer schnitt sie ab und warf sie weg), also fliegt sie auch
  // hier raus — aber nur, wenn davor wirklich etwas steht: „/say/40" soll
  // die Zahl sprechen duerfen und nicht ins Leere laufen.
  if (rest.length > 1 && /^\d+$/.test(rest[rest.length - 1])) rest.pop()

  const text = rest
    .map((t) => {
      try {
        return decodeURIComponent(t)
      } catch {
        // Kaputte Prozentfolge: lieber das Rohe sprechen als gar nichts.
        return t
      }
    })
    .join(' ')
    .trim()

  return text ? text.slice(0, SPRECH_TEXT_MAX) : null
}

/**
 * Die Adresse, unter der der Server den Satz spricht.
 *
 * BEWUSST 127.0.0.1 und nicht der Rechnername: der Abspieldienst und der
 * Server laufen auf DERSELBEN Box. Ueber die Schleife braucht es weder Namens-
 * aufloesung noch Netz — und ein Vorlesen, das an einem kaputten WLAN scheitert,
 * waere genau der Fehler, den wir hier gerade loswerden.
 *
 * Der Port folgt derselben Umgebungsvariablen wie im Server
 * (`MUPIBOX_HTTP_PORT`), damit eine Verschiebung nicht die Haelfte mitnimmt.
 */
export function sprechAdresse(text: string, port: number): string {
  return `http://127.0.0.1:${port}/api/vorlesen/sprich?text=${encodeURIComponent(text.slice(0, SPRECH_TEXT_MAX))}`
}

/** Wo der Server sagt, ob er ueberhaupt sprechen kann. */
export function sprechBereitAdresse(port: number): string {
  return `http://127.0.0.1:${port}/api/vorlesen`
}

/**
 * Ist auf DIESER Box ueberhaupt eine Stimme da?
 *
 * WARUM DAS GEFRAGT WIRD, obwohl man es auch einfach probieren koennte:
 * `autosetup.sh` installiert Piper NICHT — er wurde auf der Entwicklungsbox
 * von Hand eingerichtet (siehe Wissenspaket [vorlesen-tts], Abschnitt
 * EINRICHTUNG). Auf einer frisch aufgesetzten Box gibt es also weder Piper
 * noch Stimmen. Ohne diese Frage waere die Folge: der Abspieler schickt mpv
 * auf eine Adresse, die 500 liefert, mpv spielt nichts, und die Box bleibt
 * STILL — ohne einen Hinweis, woran es lag.
 *
 * Genau diese Sorte Fehler war der Grund fuer diesen ganzen Umbau (der
 * ENOENT, den niemand sah). Ihn durch einen neuen stillen Fehler zu ersetzen
 * waere ein schlechter Tausch.
 */
export function bereitAus(antwort: unknown): { bereit: boolean; stimmen: number } {
  const a = antwort as { bereit?: unknown; stimmen?: unknown } | null
  const stimmen = Array.isArray(a?.stimmen) ? a.stimmen.length : 0
  // BEIDES noetig: `bereit` meldet nur, dass das Programm da ist. Ohne eine
  // einzige `.onnx`-Datei kann es trotzdem nicht sprechen.
  return { bereit: a?.bereit === true && stimmen > 0, stimmen }
}
