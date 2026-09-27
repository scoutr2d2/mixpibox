/**
 * KONTEXT.GERAET (E82) — benannte, lesende Blicke auf den Geraetezustand,
 * fuer Plugins mit dem Recht `geraetestand`.
 *
 * ══ REZEPTE STATT BEFEHLE ══════════════════════════════════════════════════
 *
 * Ein Plugin fragt nach NAMEN (`soloist-fassung`), nie nach Programmen und
 * Argumenten. Die Zuordnung Name -> Programm steht HIER, in einer
 * geschlossenen Liste — ein Plugin-Update kann sich keine neuen Befehle
 * dazuwuenschen, und die Pruefstands-Ausgabe zeigt je Plugin, welche Namen
 * es zieht. EHRLICH GESAGT ist das eine Beschriftung, kein Kaefig (derselbe
 * Satz wie am `holen`-Zaun im Laufwerk): der Worker ist nicht eingesperrt.
 * Die Liste spart den bequemen Irrweg und macht den Vertrag pruefbar.
 *
 * ══ WARUM DIE INNEREN FRISTEN SO KURZ SIND ═════════════════════════════════
 *
 * Der ganze Plugin-Ruf hat 8 s (FRIST_MS im Wirt), und ein Fristriss
 * TERMINIERT den Worker samt allen offenen Rufen. Die alte Kern-Route
 * reihte bis zu vier solcher Blicke NACHEINANDER — im Haengefall waeren das
 * ueber 8 s und damit ein garantierter Riss, und der 3-s-Anmeldungs-Poll der
 * Engine-Karte machte daraus ein Neustart-Karussell. 2,5 s je Blick halten
 * auch die Serie unter der Ruf-Frist. Am Geraet gemessen antworten
 * `systemctl is-active` und `soloist ctl status` in Millisekunden; die Frist
 * ist fuer den Tag, an dem sie es nicht tun.
 *
 * ══ SYSTEMCTL-EIGENHEIT, DIE MAN WISSEN MUSS ═══════════════════════════════
 *
 * `is-active` antwortet fuer eine STEHENDE Unit mit Exit != 0 UND dem Wort
 * `inactive` auf stdout. Wer Exit != 0 als Fehler liest, meldet eine
 * ordnungsgemaess stehende Maschine als kaputt (so stand es schon im
 * dienste-Teil des Servers). Hier zaehlt das WORT, nie der Exit-Code.
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'

/** Dienste, deren Zustand ein Plugin erfragen darf. */
export const GERAET_DIENSTE = ['librespot.service', 'soloist.service', 'mupibox-player.service'] as const
export type GeraetDienst = (typeof GERAET_DIENSTE)[number]

/** Benannte Programme — Name -> [Programm, Argumente]. Alles lesend. */
export const GERAET_BEFEHLE: Record<string, readonly [string, readonly string[]]> = {
  /** `soloist -V`: Fassungszeile mit Baudatum — daran haengt der 90-Tage-Verfall. */
  'soloist-fassung': ['/usr/local/bin/soloist', ['-V']],
  /** Ist der Dienst bei Spotify angemeldet? ("logged in: yes/no") */
  'soloist-anmeldung': ['/usr/local/bin/soloist', ['ctl', 'status', '-D', '/var/lib/soloist']],
}

/** Benannte Dateien — Name -> Pfad. Nur lesen. */
export const GERAET_DATEIEN: Record<string, string> = {
  /** Der 90-Tage-Waechter legt sie ab Tag 76 ab (soloist-updater.sh). */
  'soloist-warnung': '/var/lib/soloist/update-warnung.txt',
  /** Umgebung der librespot-Unit (Bitrate, Name, Backend). */
  'librespot-umgebung': '/etc/librespot/env-librespot',
}

/** Gedeutete Worte statt roher Exit-Codes. */
export type DienstZustand = 'laeuft' | 'steht' | 'gescheitert' | 'wechselt' | 'unbekannt'

export interface Geraet {
  dienstZustand(dienst: GeraetDienst): Promise<DienstZustand>
  ausfuehren(name: keyof typeof GERAET_BEFEHLE): Promise<{ ok: boolean; text: string }>
  lesen(name: keyof typeof GERAET_DATEIEN): Promise<string | null>
}

const AUSGABE_HOECHSTENS = 4096
const DATEI_HOECHSTENS = 16384

function laufen(
  programm: string,
  argumente: readonly string[],
  fristMs: number,
): Promise<{ code: number | null; text: string }> {
  return new Promise((fertig) => {
    execFile(programm, [...argumente], { timeout: fristMs, maxBuffer: 64 * 1024 }, (fehler, stdout, stderr) => {
      const text = `${stdout ?? ''}${stderr ?? ''}`.trim().slice(0, AUSGABE_HOECHSTENS)
      if (fehler && typeof (fehler as { code?: unknown }).code !== 'number') {
        // ENOENT, Fristriss (killed) u. ae.: es GIBT keine Ausgabe des
        // Programms — das ist ein anderer Fall als Exit != 0 mit Wort.
        fertig({ code: null, text: text || (fehler as Error).message })
        return
      }
      fertig({ code: fehler ? ((fehler as { code?: number }).code ?? 1) : 0, text })
    })
  })
}

export function geraetBauen(fristMs = 2500): Geraet {
  return {
    async dienstZustand(dienst) {
      if (!GERAET_DIENSTE.includes(dienst)) return 'unbekannt'
      const { code, text } = await laufen('systemctl', ['is-active', dienst], fristMs)
      // Das WORT zaehlt (Kopf dieser Datei): `inactive` kommt mit Exit != 0.
      const wort = text.split('\n', 1)[0]
      if (wort === 'active') return 'laeuft'
      if (wort === 'inactive') return 'steht'
      if (wort === 'failed') return 'gescheitert'
      if (wort === 'activating' || wort === 'deactivating' || wort === 'reloading') return 'wechselt'
      return code === null ? 'unbekannt' : 'unbekannt'
    },

    async ausfuehren(name) {
      const rezept = GERAET_BEFEHLE[name]
      if (!rezept) return { ok: false, text: `kein Rezept "${String(name)}"` }
      const { code, text } = await laufen(rezept[0], rezept[1], fristMs)
      return { ok: code === 0, text }
    },

    async lesen(name) {
      const pfad = GERAET_DATEIEN[name]
      if (!pfad) return null
      try {
        return (await fs.readFile(pfad, 'utf8')).slice(0, DATEI_HOECHSTENS)
      } catch {
        // Fehlende Datei ist eine AUSKUNFT (keine Warnung hinterlegt),
        // kein Fehler.
        return null
      }
    },
  }
}
