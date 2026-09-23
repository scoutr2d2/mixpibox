/**
 * DER PAPIERKORB DER MEDIENLISTE — welcher Ordner wirklich weg darf.
 *
 * Hier haengen keine Datenbankzeilen dran, sondern TONDATEIEN: die eingelesene
 * CD, das gekaufte Hoerbuch, die selbst aufgenommene Gute-Nacht-Geschichte mit
 * der Stimme eines Menschen. `mupibox-sicherung.py` sichert die KONFIGURATION;
 * /home/dietpi/MuPiBox/media steht NICHT in seiner Aufnahmeliste. Es gibt
 * keinen zweiten Papierkorb, keine Sicherung, kein Rueckgaengig. Wer hier
 * danebengreift, kann es einem Elternteil nicht erklaeren — und dem Kind erst
 * recht nicht.
 *
 * WAS VORHER DA STAND (spotify-control.ts, `deleteLocal`, bis 07.08.2026):
 *
 *     const deleteFilePath = decodeURI(deleteFile).replace(/:/g, '/')
 *     const deleteCMD = `rm -r "/home/dietpi/MuPiBox/media/${decodeURIComponent(deleteFilePath)}"`
 *     //cmdCall(deleteCMD);          <- SIEHT abgeschaltet aus
 *     exec(deleteCMD, …)            <- laeuft trotzdem
 *
 * Nachgebaut mit tools/loeschbefehl-nachbauen.mjs (nichts ausgefuehrt), und
 * anschliessend im Sandkasten WIRKLICH ausgefuehrt mit
 * tools/loeschen-sandkasten.ts. Vier verschiedene Fehler, uebereinander:
 *
 *   A  ('audiobook','Benjamin','Folge 12. Der Ausflug')
 *      -> rm -r ".../Benjamin/Folge 12"
 *      `path.parse(req.url).name` im Verteiler haelt alles ab dem letzten
 *      Punkt fuer eine DATEIENDUNG. Ein Punkt im Titel ist aber normal:
 *      „Folge 12. Der Ausflug", „Vol. 2", „Dr. Brumm". Der Listeneintrag
 *      verschwand, die Dateien blieben als Waisen liegen, und die Box meldete
 *      „geloescht" — der Betreiber glaubte, Platz geschaffen zu haben.
 *
 *   B  ('audiobook','Bibi','')  -> rm -r ".../audiobook/Bibi/"   ALLE Alben
 *      ('audiobook','','')      -> rm -r ".../audiobook//"       DIE KATEGORIE
 *      Ein leeres Feld liess den Pfad auf den ELTERNORDNER zusammenfallen.
 *      Ein `rm -r` auf eine ganze Kategorie ist nie das, was jemand wollte.
 *
 *   C  ('audiobook','Bibi','x" ; touch /tmp/beleg ; "')
 *      Der Pfad ging durch eine SHELL, umschlossen nur von `"`. Ein
 *      Anfuehrungszeichen im Titel bricht daraus aus. Interpret und Titel
 *      kommen aus data.json, und dort schiebt `/api/add` den rohen
 *      Anfragekoerper hinein (server.ts:9879) — die API steht in der Vorgabe
 *      (`interfacelogin.state=false`) OHNE ANMELDUNG im Heimnetz offen.
 *
 *   D  Der Ausgang wurde VERSCHWIEGEN. Fehler gingen nach `log.debug`, der
 *      Verteiler antwortete in jedem Fall `{status:'ok'}`. „Nicht vorhanden",
 *      „keine Rechte", „falscher Ordner" und „geloescht" sahen fuer die
 *      Oberflaeche gleich aus.
 *
 * WAS HIER STATTDESSEN GILT:
 *
 *   KEINE SHELL. Node loescht Verzeichnisse selbst (`fs.rm`). Ein Pfad, der
 *   nie in eine Befehlszeile gerinnt, kann auch nicht aus einer ausbrechen.
 *   Damit ist C nicht „entschaerft", sondern gegenstandslos.
 *
 *   GENAU EINMAL ENTSCHLUESSELN, und zwar FELDWEISE. Das alte `decodeURI`
 *   gefolgt von `decodeURIComponent` war ein DOPPELTES Entschluesseln: aus
 *   `%252e%252e` wurde `%2e%2e` wurde `..`. Hier wird jedes der drei Felder
 *   genau einmal durch `decodeURIComponent` gegeben — `%252e%252e` bleibt
 *   damit der Dateiname `%2e%2e`, ein Name wie jeder andere.
 *
 *   DREI GLIEDER, KEINES LEER. Die Ablage steht fest: der Erzeuger der
 *   Wiedergabelisten legt sie an (scripts/mupibox/m3u_generator.sh, Zeilen
 *   26/79/132) als media/<kategorie>/<interpret>/<titel>/, und Interpret wie
 *   Titel sind dort `basename`-Ergebnisse. Ein Eintrag vom Typ `library` —
 *   und nur so einer kommt ueberhaupt hierher (edit.page.ts:127) — hat also
 *   immer alle drei. Fehlt eines, ist es kein Album, sondern ein
 *   Elternordner. Dann wird NICHT geloescht, sondern abgelehnt, mit Grund.
 *
 *   IM MEDIENVERZEICHNIS BLEIBEN, GEPRUEFT STATT GEHOFFT. Zweimal: einmal am
 *   gebauten Pfad (`path.relative`, nicht `startsWith` auf Zeichenketten),
 *   und danach noch einmal an den AUFGELOESTEN Pfaden (`fs.realpath`) — sonst
 *   traegt eine Verknuepfung im Medienordner das Loeschen nach draussen.
 *
 *   DIE WAHRHEIT UEBER DEN AUSGANG. Jeder Weg endet in einem `Loeschausgang`
 *   mit Grund. Der Verteiler antwortet damit; „nicht vorhanden" ist ein
 *   Fehler und kein Erfolg.
 *
 * ES WIRD NIE GEWORFEN — dieselbe Begruendung wie in befehlspfad.ts und
 * zeitschranke.ts: ein Wurf im Befehlszweig ist eine 500er Antwort statt Ton.
 * Der Aufrufer bekommt zu lesen, welcher Ausgang eintrat, und entscheidet.
 */

import fsp from 'node:fs/promises'
import path from 'node:path'

/** Wo die Medien liegen. Steht an einer Stelle, damit ein Pruefstand sie
 *  gegen einen Sandkasten tauschen kann — und NUR dafuer. */
export const MEDIEN_WURZEL = '/home/dietpi/MuPiBox/media'

/** Wie tief ein Album unter der Wurzel liegt: kategorie/interpret/titel. */
export const GLIEDER = 3

/** Was aus einem Loeschbefehl gelesen wurde — oder warum nicht. */
export type Loeschplan =
  | { ok: true; kategorie: string; interpret: string; titel: string; pfad: string }
  | { ok: false; grund: string }

/** Wie ein Loeschen ausging. Drei Faelle, keine Luege. */
export type Loeschausgang = { ok: true; pfad: string } | { ok: false; grund: string }

/**
 * Das ROHE letzte Glied eines `deletelocal`-Befehls — noch verschluesselt.
 *
 * WARUM NICHT `path.parse(req.url).name`, was der Verteiler sonst benutzt:
 * `name` ist der Basisname OHNE ENDUNG, und „Endung" heisst fuer `path.parse`
 * schlicht „alles ab dem letzten Punkt". Fuer die Verben (`stop`,
 * `setvolume:30`) ist das harmlos, weil da kein Punkt vorkommt. Fuer einen
 * TITEL ist es Datenverlust — Fehler A oben. Der Titel gehoert also gar nicht
 * erst durch `path.parse`; hier wird das Glied nach POSITION genommen, so wie
 * befehlspfad.ts es fuer die Adressen tut.
 *
 * @param url  `req.url`, roh (`/<raum>/deletelocal/<kat>:<interpret>:<titel>`)
 * @returns    das rohe Glied, oder `null` wenn der Befehl nicht diese Form hat
 */
export function loeschgliedAusUrl(url: string): string | null {
  if (typeof url !== 'string') return null
  // Abfrage und Sprungmarke gehoeren nicht zum Pfad.
  const pfad = url.split('?')[0].split('#')[0]
  const glieder = pfad.split('/')
  const i = glieder.indexOf('deletelocal')
  if (i < 0) return null
  // GENAU EIN Glied danach. Steht dort mehr, ist es nicht die Form, die die
  // Oberflaeche schickt — und dann wird geraten statt gelesen.
  if (glieder.length !== i + 2) return null
  return glieder[i + 1] || null
}

/** Ein Feld genau EINMAL entschluesseln. Ein einzelnes `%` wirft URIError —
 *  das ist kein Angriff, sondern ein Name wie „50% Rabatt" (dieses Projekt hat
 *  ihn an mpv-protokoll.ts schon einmal bezahlt). Hier wird er zu `null`. */
function feldLesen(roh: string): string | null {
  try {
    return decodeURIComponent(roh)
  } catch {
    return null
  }
}

/**
 * Zeichen, die in einem EINZELNEN Ordnernamen nicht vorkommen koennen.
 * Ein Schraegstrich waere kein Name mehr, sondern eine weitere Ebene; die
 * Null beendet den Pfad im Systemaufruf und wuerde den Rest verschlucken.
 *
 * DER RUECKWAERTSSCHRAEGSTRICH STEHT HIER NICHT MEHR (nachgetragen 07.08.2026).
 *
 * Er stand in der ersten Fassung mit drin — aus der Gewohnheit, „\" fuer einen
 * Pfadtrenner zu halten. UNTER LINUX IST ER KEINER, sondern ein gewoehnliches
 * Zeichen im Dateinamen. Gemessen mit tools/loeschen-echte-namen.ts an einem
 * echten Ordner: `media/music/AC\DC/Album/` liess sich ueber den Muelleimer
 * NICHT MEHR loeschen („enthaelt einen Schraegstrich"), waehrend die alte
 * Fassung ihn klaglos wegraeumte. Das ist ein Rueckschritt: ein Album, das
 * ein Elternteil auf der Box hat, war ploetzlich nur noch ueber SSH loszuwerden
 * — und die Oberflaeche sagte dazu nichts, weil sie die Begruendung wegwirft.
 *
 * ES KOSTET NICHTS, IHN ZUZULASSEN. Der Pfad wird mit `path.resolve` gebaut
 * und geht durch `fs.rm`, nie durch eine Shell; `path.sep` ist auf dieser
 * Plattform `/`, und `tiefePruefen` zaehlt genau danach. Ein `\` im Namen kann
 * also keine Ebene erzeugen und nirgends hinausfuehren.
 *
 * WO ER WEITER GILT: auf einer Plattform, deren `path` ihn als Trenner liest.
 * Der Abspieldienst laeuft auf der Box, nicht auf Windows — die Zeile steht
 * hier trotzdem, weil die Begruendung oben genau daran haengt und ein
 * stillschweigend falscher Riegel schlimmer ist als ein benannter.
 */
const KEIN_NAME = process.platform === 'win32' ? /[/\\\0]/ : /[/\0]/

/**
 * Aus dem rohen Glied den zu loeschenden Ordner bestimmen — ohne Dateisystem.
 *
 * Rein, damit der Pruefstand jeden Fall durchspielen kann, ohne dass irgendwo
 * etwas verschwindet.
 */
export function loeschplanBauen(glied: string | null, wurzel: string = MEDIEN_WURZEL): Loeschplan {
  if (typeof glied !== 'string' || glied === '') {
    return { ok: false, grund: 'kein Ziel im Befehl' }
  }

  // NACH DEM ROHEN DOPPELPUNKT TRENNEN, VOR dem Entschluesseln. Die
  // Oberflaeche setzt die Felder mit `encodeURIComponent` zusammen
  // (player.service.ts:233); ein Doppelpunkt IM Feld steht dort also als
  // `%3A` und kann nicht als Trenner missverstanden werden. Wer erst
  // entschluesselt und dann trennt, verliert genau diese Eindeutigkeit.
  const teile = glied.split(':')
  if (teile.length !== GLIEDER) {
    return {
      ok: false,
      grund: `erwartet wird Kategorie:Interpret:Titel, gelesen wurden ${teile.length} Glieder`,
    }
  }

  const namen: string[] = []
  const beschriftung = ['Kategorie', 'Interpret', 'Titel']
  for (let i = 0; i < teile.length; i++) {
    const wert = feldLesen(teile[i])
    if (wert === null) {
      return { ok: false, grund: `${beschriftung[i]} ist nicht lesbar (kaputte Prozentfolge)` }
    }
    // LEER HEISST ELTERNORDNER. Fehler B: ein leerer Titel machte aus dem
    // Album den Interpreten, ein leerer Interpret aus dem Interpreten die
    // ganze Kategorie. Kein `library`-Eintrag kann so aussehen — der
    // Erzeuger der Wiedergabelisten fuellt alle drei aus `basename`.
    if (wert.trim() === '') {
      return { ok: false, grund: `${beschriftung[i]} fehlt — das waere der Elternordner, nicht das Album` }
    }
    if (KEIN_NAME.test(wert)) {
      return { ok: false, grund: `${beschriftung[i]} enthaelt einen Schraegstrich — das ist kein einzelner Ordner` }
    }
    if (wert === '.' || wert === '..') {
      return { ok: false, grund: `${beschriftung[i]} ist „${wert}" — das zeigt aus dem Album heraus` }
    }
    namen.push(wert)
  }

  const wurzelAbs = path.resolve(wurzel)
  const ziel = path.resolve(wurzelAbs, ...namen)

  // GEPRUEFT, NICHT GEHOFFT. Nach den Pruefungen oben KANN das hier nicht mehr
  // fehlschlagen — genau deshalb steht es da: es ist der Riegel, der haelt,
  // wenn oben jemand etwas lockert. Verglichen wird der aufgeloeste Pfad
  // (`path.relative`), nicht die Zeichenkette: `/media-alt` faengt auch mit
  // `/media` an.
  const innen = tiefePruefen(wurzelAbs, ziel)
  if (innen) return { ok: false, grund: innen }

  return { ok: true, kategorie: namen[0], interpret: namen[1], titel: namen[2], pfad: ziel }
}

/** `null`, wenn `ziel` genau {@link GLIEDER} Ebenen unter `wurzel` liegt —
 *  sonst der Grund, warum nicht. */
function tiefePruefen(wurzel: string, ziel: string): string | null {
  const rel = path.relative(wurzel, ziel)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    return 'Ziel liegt nicht im Medienverzeichnis'
  }
  const tiefe = rel.split(path.sep).length
  if (tiefe !== GLIEDER) {
    return `Ziel liegt ${tiefe} statt ${GLIEDER} Ebenen unter dem Medienverzeichnis — das ist kein Album`
  }
  return null
}

/**
 * Den Ordner wirklich loeschen — und sagen, was daraus wurde.
 *
 * @param glied   das rohe Glied aus {@link loeschgliedAusUrl}
 * @param wurzel  das Medienverzeichnis (der Pruefstand setzt hier den Sandkasten)
 */
export async function loeschenAusfuehren(glied: string | null, wurzel: string = MEDIEN_WURZEL): Promise<Loeschausgang> {
  const plan = loeschplanBauen(glied, wurzel)
  if (!plan.ok) return plan

  // DIE ZWEITE PRUEFUNG, AN DER WIRKLICHKEIT. Bis hier war alles Rechnen mit
  // Zeichenketten. Eine Verknuepfung `media/audiobook/Bibi -> /home/dietpi`
  // besteht jede davon und traegt das Loeschen trotzdem aus dem Medienordner
  // heraus. Deshalb wird ab jetzt mit AUFGELOESTEN Pfaden gearbeitet.
  let wurzelEcht: string
  try {
    wurzelEcht = await fsp.realpath(wurzel)
  } catch {
    return { ok: false, grund: `Medienverzeichnis ${wurzel} nicht gefunden` }
  }

  let art: Awaited<ReturnType<typeof fsp.lstat>>
  try {
    art = await fsp.lstat(plan.pfad)
  } catch (fehler) {
    const code = (fehler as NodeJS.ErrnoException)?.code
    // NICHT VORHANDEN IST EIN FEHLER, KEIN ERFOLG. Genau diesen Fall verschwieg
    // die alte Stelle — und genau er trat bei jedem Titel mit Punkt ein.
    if (code === 'ENOENT') return { ok: false, grund: `nicht vorhanden: ${plan.pfad}` }
    return { ok: false, grund: `nicht lesbar (${code ?? fehler}): ${plan.pfad}` }
  }

  if (art.isSymbolicLink()) {
    return { ok: false, grund: `${plan.pfad} ist eine Verknuepfung, kein Albumordner` }
  }
  if (!art.isDirectory()) {
    return { ok: false, grund: `${plan.pfad} ist kein Ordner` }
  }

  let zielEcht: string
  try {
    zielEcht = await fsp.realpath(plan.pfad)
  } catch (fehler) {
    return { ok: false, grund: `Ziel nicht aufloesbar (${(fehler as Error)?.message ?? fehler})` }
  }

  // Aufgeloest gegen aufgeloest — hier faellt eine Verknuepfung weiter oben im
  // Pfad (Kategorie oder Interpret) durch, die nach draussen zeigt.
  const draussen = tiefePruefen(wurzelEcht, zielEcht)
  if (draussen) return { ok: false, grund: `${draussen} (aufgeloest: ${zielEcht})` }

  try {
    // KEINE SHELL. `force:false`, damit ein inzwischen verschwundener Ordner
    // nicht als Erfolg durchgeht.
    await fsp.rm(zielEcht, { recursive: true, force: false })
  } catch (fehler) {
    const code = (fehler as NodeJS.ErrnoException)?.code
    return { ok: false, grund: `Loeschen fehlgeschlagen (${code ?? ''}): ${(fehler as Error)?.message ?? fehler}` }
  }

  return { ok: true, pfad: zielEcht }
}
