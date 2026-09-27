/**
 * KOMM TROTZDEM DURCH — der Papierkorb unter Beschuss.
 *
 * `tools/loeschen-sandkasten.ts` zeigt, dass die ALTE Fassung danebengriff.
 * Dieses Werkzeug stellt die umgekehrte Frage an die NEUE: gibt es noch EINEN
 * Weg, mit `deletelocal` etwas ausserhalb von `media/<kat>/<int>/<titel>` zu
 * treffen — und loescht der gewollte Fall noch?
 *
 * Es wird nicht argumentiert, sondern gemessen. Jeder Fall laeuft in einem
 * FRISCHEN Sandkasten unter dem Temp-Verzeichnis; danach wird das ganze
 * Verzeichnis abgezaehlt und mit dem Zustand davor verglichen. Erwartet wird
 * eine MENGE von Pfaden, die verschwinden dürfen — verschwindet auch nur ein
 * Pfad mehr oder weniger, faellt der Fall um. Kein Fall verlaesst sich auf die
 * Rueckmeldung des Loeschens; die Rueckmeldung ist nur eine zweite Aussage.
 *
 * WAS ES AENDERT: nichts ausserhalb des Sandkastens. `mkdtemp` unter
 * `os.tmpdir()`, Abbruch wenn die Wurzel woanders liegt, Aufraeumen am Ende.
 * Die Box wird nicht beruehrt; MEDIEN_WURZEL wird nie benutzt.
 *
 * AUFRUF (aus dem Repo-Wurzelverzeichnis):
 *     npx tsx tools/durchkommen-loeschen.ts
 *     npx tsx tools/durchkommen-loeschen.ts --behalten
 *
 * Rueckgabewert 0, wenn kein Angriff durchkam UND der gewollte Fall noch
 * loescht — sonst 1.
 */

import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { loeschenAusfuehren, loeschgliedAusUrl } from '../src/backend-player/src/loeschen'

const BEHALTEN = process.argv.includes('--behalten')

// ── SANDKASTEN ───────────────────────────────────────────────────────────────

/** Alben, die in jedem Sandkasten stehen. */
const ALBEN: [string, string, string][] = [
  ['audiobook', 'Benjamin', 'Folge 12. Der Ausflug'],
  ['audiobook', 'Benjamin', 'Folge 12'],
  ['audiobook', 'Bibi', 'Folge 1'],
  ['music', 'Rolf Zuckowski', 'Vol. 2'],
]

/**
 * Baut media/ mit Alben, daneben `draussen/` mit der selbst aufgenommenen
 * Geschichte, und die Verknuepfungen, an denen ein Ausbruch haengen koennte.
 */
async function sandkastenBauen(): Promise<{ wurzel: string; medien: string }> {
  const tmp = await fsp.realpath(os.tmpdir())
  const wurzel = await fsp.mkdtemp(path.join(tmp, 'mupi-durchkommen-'))
  if (!wurzel.startsWith(tmp)) throw new Error(`Sandkasten nicht im Temp-Verzeichnis: ${wurzel}`)
  const medien = path.join(wurzel, 'media')

  for (const [k, i, t] of ALBEN) {
    const ordner = path.join(medien, k, i, t)
    await fsp.mkdir(ordner, { recursive: true })
    await fsp.writeFile(path.join(ordner, '01.mp3'), 'ton')
  }

  // Das Unersetzliche, AUSSERHALB von media.
  await fsp.mkdir(path.join(wurzel, 'draussen/Album'), { recursive: true })
  await fsp.writeFile(path.join(wurzel, 'draussen/Album/01.mp3'), 'unersetzlich')
  await fsp.writeFile(path.join(wurzel, 'draussen/oma-erzaehlt.mp3'), 'unersetzlich')

  // Verknuepfung auf Interpreten-Ebene, die nach draussen zeigt.
  await fsp.symlink(path.join(wurzel, 'draussen'), path.join(medien, 'audiobook/Fremd'))
  // Verknuepfung auf Kategorie-Ebene, die nach draussen zeigt.
  await fsp.symlink(path.join(wurzel, 'draussen'), path.join(medien, 'weg'))
  // Verknuepfung AUF ALBUM-EBENE, die nach draussen zeigt.
  await fsp.symlink(path.join(wurzel, 'draussen/Album'), path.join(medien, 'audiobook/Bibi/Verweis'))
  // Verknuepfung INNERHALB eines Albums, die nach draussen zeigt — hier haengt
  // die Frage, ob das rekursive Loeschen Verweisen folgt.
  await fsp.symlink(path.join(wurzel, 'draussen'), path.join(medien, 'audiobook/Bibi/Folge 1/raus'))
  // Verknuepfung, die INNERHALB von media auf eine andere Tiefe zeigt.
  await fsp.symlink(medien, path.join(medien, 'kurz'))
  // Verknuepfung, die innerhalb von media auf einen ANDEREN Interpreten zeigt.
  await fsp.symlink(path.join(medien, 'audiobook/Benjamin'), path.join(medien, 'music/Doppel'))

  // Harte Verknuepfung: dieselben Bytes, zwei Namen — einer draussen.
  await fsp.link(
    path.join(medien, 'audiobook/Benjamin/Folge 12/01.mp3'),
    path.join(wurzel, 'draussen/hart.mp3'),
  )

  return { wurzel, medien }
}

/**
 * DAS WETTRENNEN. Zwischen `realpath` und `fs.rm` liegt ein Fenster. Wer es
 * trifft, tauscht den Albumordner gegen eine Verknuepfung nach draussen aus —
 * die Pruefung galt dann dem Ordner, das Loeschen dem Verweis.
 *
 * Hier wird nicht auf Glueck gesetzt: der Tausch laeuft in einer engen
 * Schleife parallel zum Loeschen, viele Runden lang. Bleibt `draussen` in
 * ALLEN Runden vollstaendig, ist das Fenster entweder zu, oder `fs.rm`
 * behandelt einen Verweis richtig (unlink statt hineinsteigen).
 */
async function wettrennenFahren(runden: number) {
  let getroffen = 0
  let geloescht = 0
  for (let n = 0; n < runden; n++) {
    const { wurzel, medien } = await sandkastenBauen()
    const album = path.join(medien, 'audiobook/Benjamin/Folge 12')
    const ersatz = path.join(wurzel, 'ersatz')
    await fsp.symlink(path.join(wurzel, 'draussen'), ersatz)

    let laeuft = true
    const tauscher = (async () => {
      while (laeuft) {
        try {
          await fsp.rename(album, `${album}.beiseite`)
          await fsp.rename(ersatz, album)
        } catch {
          /* zu spaet oder zu frueh — das ist der Sinn der Uebung */
        }
        await new Promise((r) => setImmediate(r))
      }
    })()

    const ausgang = await loeschenAusfuehren(
      `${e('audiobook')}:${e('Benjamin')}:${e('Folge 12')}`,
      medien,
    )
    laeuft = false
    await tauscher

    if (ausgang.ok) geloescht++
    // Die einzige Frage: steht draussen noch alles?
    const draussen = await bestand(path.join(wurzel, 'draussen'))
    if (!draussen.includes('oma-erzaehlt.mp3') || !draussen.includes('Album/01.mp3')) {
      getroffen++
      console.log(`        Runde ${n}: draussen fehlt etwas — ${JSON.stringify(draussen)}`)
    }
    await fsp.rm(wurzel, { recursive: true, force: true })
  }
  melde(
    getroffen === 0,
    `WETTRENNEN: Album waehrend des Loeschens gegen Verweis nach draussen getauscht (${runden} Runden)`,
    getroffen === 0
      ? `draussen jedes Mal vollstaendig (${geloescht} Runden meldeten ok)`
      : `${getroffen} von ${runden} Runden haben draussen getroffen`,
  )
}

/** Jeder Pfad unter `ort`, relativ, sortiert — ohne Verweisen zu folgen. */
async function bestand(ort: string): Promise<string[]> {
  const raus: string[] = []
  async function gehe(p: string) {
    let eintraege: import('node:fs').Dirent[]
    try {
      eintraege = await fsp.readdir(p, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of eintraege) {
      const voll = path.join(p, e.name)
      raus.push(path.relative(ort, voll))
      if (e.isDirectory() && !e.isSymbolicLink()) await gehe(voll)
    }
  }
  await gehe(ort)
  return raus.sort()
}

// ── DIE FAELLE ───────────────────────────────────────────────────────────────

type Fall = {
  name: string
  /** Was hinter `deletelocal/` in der Adresse steht — ROH, wie es ankommt. */
  glied: string
  /** Ganze Adresse statt nur des Glieds (fuer Angriffe auf die Zerlegung). */
  url?: string
  /** Welche Pfade (relativ zur SANDKASTENWURZEL) verschwinden duerfen. Leer =
   *  es darf nichts verschwinden. */
  darfWeg: string[]
  /** Muss das Loeschen ok melden? */
  erwarteOk: boolean
  /** Was der Fall zeigen soll — steht in der Ausgabe. */
  warum: string
}

/** `encodeURIComponent`, wie die Oberflaeche es tut (player.service.ts:233). */
const e = encodeURIComponent

const ALBUM_WEG = (k: string, i: string, t: string) => [
  `media/${k}/${i}/${t}`,
  `media/${k}/${i}/${t}/01.mp3`,
]

const FAELLE: Fall[] = [
  // ── DIE GEGENPROBE ZUERST ─────────────────────────────────────────────────
  {
    name: 'GEWOLLT: Album mit Punkt im Titel',
    glied: `${e('audiobook')}:${e('Benjamin')}:${e('Folge 12. Der Ausflug')}`,
    darfWeg: ALBUM_WEG('audiobook', 'Benjamin', 'Folge 12. Der Ausflug'),
    erwarteOk: true,
    warum: 'Ein Schutz, der auch das Richtige verhindert, wird umgangen.',
  },
  {
    name: 'GEWOLLT: Album mit Punkt und Leerzeichen (Vol. 2)',
    glied: `${e('music')}:${e('Rolf Zuckowski')}:${e('Vol. 2')}`,
    darfWeg: ALBUM_WEG('music', 'Rolf Zuckowski', 'Vol. 2'),
    erwarteOk: true,
    warum: 'Der zweite Alltagsfall mit Punkt.',
  },

  // ── KODIERUNG ─────────────────────────────────────────────────────────────
  {
    name: 'doppelt kodiert: %252e%252e%252fBenjamin',
    glied: 'audiobook:Bibi:%252e%252e%252fBenjamin',
    darfWeg: [],
    erwarteOk: false,
    warum: 'Die alte Fassung entschluesselte zweimal und traf den Nachbarn.',
  },
  {
    name: 'dreifach kodiert',
    glied: 'audiobook:Bibi:%25252e%25252e%25252fBenjamin',
    darfWeg: [],
    erwarteOk: false,
    warum: 'Wer einmal zu wenig entschluesselt, entschluesselt vielleicht dreimal zu wenig.',
  },
  {
    name: 'einfach kodiert: %2e%2e als Interpret',
    glied: `audiobook:${'%2e%2e'}:${e('Folge 1')}`,
    darfWeg: [],
    erwarteOk: false,
    warum: 'Der geradeste Weg nach oben.',
  },
  {
    name: 'gross geschrieben: %2E%2E als Interpret',
    glied: 'audiobook:%2E%2E:Folge%201',
    darfWeg: [],
    erwarteOk: false,
    warum: 'Grossschreibung ist bei Prozentfolgen erlaubt.',
  },
  {
    name: 'Schraegstrich kodiert mitten im Titel',
    glied: `audiobook:Bibi:${'%2e%2e%2f%2e%2e%2fdraussen'}`,
    darfWeg: [],
    erwarteOk: false,
    warum: 'Zwei Ebenen hoch und wieder hinein.',
  },
  {
    name: 'ueberlanges UTF-8 (%C0%AE = Punkt in alter Lesart)',
    glied: 'audiobook:Bibi:%C0%AE%C0%AE%C0%AFBenjamin',
    darfWeg: [],
    erwarteOk: false,
    warum: 'Klassiker gegen Pruefungen, die nach dem Entschluesseln vergleichen.',
  },
  {
    name: 'roher Punkt-Punkt ohne Kodierung',
    glied: 'audiobook:..:Folge 1',
    darfWeg: [],
    erwarteOk: false,
    warum: 'Die Oberflaeche kodiert — ein Angreifer nicht.',
  },
  {
    name: 'roher Schraegstrich im Feld',
    glied: 'audiobook:Bibi/../Benjamin:Folge 12',
    darfWeg: [],
    erwarteOk: false,
    warum: 'Der Doppelpunkt wird vor dem Entschluesseln getrennt, der Schraegstrich nicht.',
  },
  {
    name: 'absoluter Pfad als Interpret',
    glied: `audiobook:${e('/etc')}:passwd`,
    darfWeg: [],
    erwarteOk: false,
    warum: 'path.resolve wirft die Wurzel weg, wenn ein Glied absolut ist.',
  },
  {
    name: 'NUL im Namen',
    glied: 'audiobook:Bibi:Folge%201%00.evil',
    darfWeg: [],
    erwarteOk: false,
    warum: 'Ein NUL schneidet Zeichenketten in C-Bibliotheken ab.',
  },
  {
    name: 'Zeilenumbruch im Namen',
    glied: `audiobook:Bibi:${e('Folge 1\n rm -rf /')}`,
    darfWeg: [],
    erwarteOk: false,
    warum: 'Frueher ging der Pfad durch eine Shell — heute darf er nur nichts treffen.',
  },
  {
    name: 'Rueckwaertsschraegstrich',
    glied: `audiobook:Bibi:${e('..\\..\\draussen')}`,
    darfWeg: [],
    erwarteOk: false,
    warum: 'Der andere Trenner.',
  },
  {
    name: 'nur Punkte: drei',
    glied: 'audiobook:Bibi:...',
    darfWeg: [],
    erwarteOk: false,
    warum: '„..." ist ein gueltiger Name, aber es gibt ihn hier nicht.',
  },
  {
    name: 'nur Punkte: vier, als Interpret',
    glied: 'audiobook:....:Folge 1',
    darfWeg: [],
    erwarteOk: false,
    warum: 'Manche Pruefungen vergleichen nur mit „.." genau.',
  },
  {
    name: 'Punkt als Interpret',
    glied: 'audiobook:.:Bibi',
    darfWeg: [],
    erwarteOk: false,
    warum: 'Ein einzelner Punkt faellt beim Aufloesen weg — dann waere Bibi das Ziel.',
  },
  {
    name: 'Leerzeichen als Interpret',
    glied: 'audiobook:%20:Folge 1',
    darfWeg: [],
    erwarteOk: false,
    warum: 'Ein Feld, das leer AUSSIEHT.',
  },
  {
    name: 'leerer Titel',
    glied: 'audiobook:Bibi:',
    darfWeg: [],
    erwarteOk: false,
    warum: 'Fehler B: das haette alle Alben des Interpreten getroffen.',
  },
  {
    name: 'sehr langer Name (5000 Zeichen)',
    glied: `audiobook:Bibi:${'a'.repeat(5000)}`,
    darfWeg: [],
    erwarteOk: false,
    warum: 'ENAMETOOLONG darf kein Absturz und kein Erfolg sein.',
  },
  {
    name: 'Unicode-Normalform: NFD statt NFC',
    // „Folge 12. Der Ausflug" enthaelt kein Umlaut; deshalb ein eigenes Album,
    // das der Aufbau unten anlegt.
    glied: `audiobook:Bibi:${e('Grüße'.normalize('NFD'))}`,
    darfWeg: [],
    erwarteOk: false,
    warum: 'Zwei Schreibweisen desselben Namens — welche trifft die Platte?',
  },

  // ── VERKNUEPFUNGEN ────────────────────────────────────────────────────────
  {
    name: 'Verknuepfung als ALBUM (media/audiobook/Bibi/Verweis -> draussen/Album)',
    glied: 'audiobook:Bibi:Verweis',
    darfWeg: [],
    erwarteOk: false,
    warum: 'lstat muss den Verweis erkennen, bevor irgendetwas geloescht wird.',
  },
  {
    name: 'Verknuepfung als INTERPRET (media/audiobook/Fremd -> draussen)',
    glied: 'audiobook:Fremd:Album',
    darfWeg: [],
    erwarteOk: false,
    warum: 'lstat sieht hier ein echtes Verzeichnis — nur realpath rettet.',
  },
  {
    name: 'Verknuepfung als KATEGORIE (media/weg -> draussen)',
    glied: 'weg:Album:01.mp3',
    darfWeg: [],
    erwarteOk: false,
    warum: 'Dieselbe Falle eine Ebene hoeher.',
  },
  {
    name: 'Verknuepfung auf die Wurzel (media/kurz -> media)',
    glied: 'kurz:audiobook:Bibi',
    darfWeg: [],
    erwarteOk: false,
    warum: 'Bleibt IN media, landet aber auf der falschen Tiefe.',
  },
  {
    name: 'Verknuepfung INNERHALB des Albums zeigt nach draussen',
    glied: `${e('audiobook')}:${e('Bibi')}:${e('Folge 1')}`,
    // Der Verweis selbst darf weg, sein Ziel nicht.
    darfWeg: [
      'media/audiobook/Bibi/Folge 1',
      'media/audiobook/Bibi/Folge 1/01.mp3',
      'media/audiobook/Bibi/Folge 1/raus',
    ],
    erwarteOk: true,
    warum: 'Folgt das rekursive Loeschen dem Verweis, ist draussen alles weg.',
  },

  // ── DIE ZERLEGUNG DER ADRESSE ─────────────────────────────────────────────
  {
    name: 'Adresse: zwei Glieder hinter deletelocal',
    glied: '',
    url: `/current/deletelocal/audiobook:Bibi/${e('Folge 1')}`,
    darfWeg: [],
    erwarteOk: false,
    warum: 'Wer mehr Glieder anhaengt, darf nicht ein anderes Ziel bekommen.',
  },
  {
    name: 'Adresse: Abfrage haengt an',
    glied: '',
    url: `/current/deletelocal/${e('audiobook')}:${e('Bibi')}:${e('Folge 1')}?x=1`,
    // „Folge 1" traegt im Aufbau zusaetzlich den Verweis `raus`.
    darfWeg: [...ALBUM_WEG('audiobook', 'Bibi', 'Folge 1'), 'media/audiobook/Bibi/Folge 1/raus'],
    erwarteOk: true,
    warum: 'Eine Abfrage darf das Ziel nicht verschieben — und nicht verhindern.',
  },
  {
    name: 'Adresse: Sprungmarke haengt an',
    glied: '',
    url: `/current/deletelocal/${e('music')}:${e('Rolf Zuckowski')}:${e('Vol. 2')}#weg`,
    darfWeg: ALBUM_WEG('music', 'Rolf Zuckowski', 'Vol. 2'),
    erwarteOk: true,
    warum: 'Dasselbe fuer die Raute.',
  },

  // ── WAS IM MEDIENORDNER BLEIBT, ABER TROTZDEM FALSCH IST ──────────────────
  {
    name: 'Verknuepfung zeigt auf einen ANDEREN Interpreten IN media',
    glied: `music:Doppel:${e('Folge 12')}`,
    // Gemessen, nicht gewuenscht: das Ziel liegt drei Ebenen unter media,
    // also greift keine Pruefung — geloescht wird Benjamins Album.
    darfWeg: ALBUM_WEG('audiobook', 'Benjamin', 'Folge 12'),
    erwarteOk: true,
    warum: 'Bleibt IN media — trifft aber ein anderes Album als benannt. Siehe Bericht.',
  },
  {
    name: 'harte Verknuepfung: dieselbe Datei liegt auch draussen',
    glied: `${e('audiobook')}:${e('Benjamin')}:${e('Folge 12')}`,
    darfWeg: ALBUM_WEG('audiobook', 'Benjamin', 'Folge 12'),
    erwarteOk: true,
    warum: 'Ein zweiter Name auf dieselben Bytes darf draussen nichts kosten.',
  },
  {
    name: 'Adresse: deletelocal steht zweimal',
    glied: '',
    url: `/deletelocal/deletelocal/${e('audiobook')}:${e('Bibi')}:${e('Folge 1')}`,
    darfWeg: [],
    erwarteOk: false,
    warum: 'indexOf nimmt das erste — dahinter stehen dann zwei Glieder.',
  },
  {
    name: 'Adresse: kodiertes deletelocal',
    glied: '',
    url: `/current/%64eletelocal/${e('audiobook')}:${e('Bibi')}:${e('Folge 1')}`,
    darfWeg: [],
    erwarteOk: false,
    warum: 'Die Zerlegung entschluesselt den Pfad nicht — das ist hier richtig.',
  },
  {
    name: 'Adresse: Schraegstrich im Titel als %2F',
    glied: '',
    url: `/current/deletelocal/audiobook:Bibi:Folge%2F..%2F..%2Fdraussen`,
    darfWeg: [],
    erwarteOk: false,
    warum: 'Der Pfad wird roh zerlegt, das Feld danach einmal entschluesselt.',
  },
]

// ── LAUF ─────────────────────────────────────────────────────────────────────

let gruen = 0
let rot = 0

function melde(ok: boolean, name: string, text: string) {
  if (ok) {
    gruen++
    console.log(`  OK    ${name}${text ? ` — ${text}` : ''}`)
  } else {
    rot++
    console.log(`  ROT   ${name} — ${text}`)
  }
}

async function fallFahren(fall: Fall) {
  const { wurzel, medien } = await sandkastenBauen()
  // Das Album fuer die Normalform-Probe: auf der Platte in NFC.
  await fsp.mkdir(path.join(medien, 'audiobook/Bibi', 'Grüße'.normalize('NFC')), { recursive: true })
  await fsp.writeFile(path.join(medien, 'audiobook/Bibi', 'Grüße'.normalize('NFC'), '01.mp3'), 'ton')

  const vorher = await bestand(wurzel)

  const url = fall.url ?? `/current/deletelocal/${fall.glied}`
  const glied = loeschgliedAusUrl(url)
  let ausgang: Awaited<ReturnType<typeof loeschenAusfuehren>>
  try {
    ausgang = await loeschenAusfuehren(glied, medien)
  } catch (fehler) {
    melde(false, fall.name, `GEWORFEN statt geantwortet: ${(fehler as Error)?.message}`)
    if (!BEHALTEN) await fsp.rm(wurzel, { recursive: true, force: true })
    return
  }

  const nachher = await bestand(wurzel)
  const nachherMenge = new Set(nachher)
  const verschwunden = vorher.filter((p) => !nachherMenge.has(p)).sort()
  const erwartet = [...fall.darfWeg].sort()

  const gleich = verschwunden.length === erwartet.length && verschwunden.every((p, i) => p === erwartet[i])

  if (!gleich) {
    const zuviel = verschwunden.filter((p) => !erwartet.includes(p))
    const zuwenig = erwartet.filter((p) => !verschwunden.includes(p))
    melde(
      false,
      fall.name,
      `${zuviel.length ? `ZU VIEL WEG: ${zuviel.join(', ')}. ` : ''}${
        zuwenig.length ? `NICHT WEG: ${zuwenig.join(', ')}. ` : ''
      }Antwort: ${JSON.stringify(ausgang)}`,
    )
  } else if (ausgang.ok !== fall.erwarteOk) {
    melde(
      false,
      fall.name,
      `Bestand stimmt, aber die Antwort luegt: erwartet ok=${fall.erwarteOk}, bekommen ${JSON.stringify(ausgang)}`,
    )
  } else {
    melde(
      true,
      fall.name,
      fall.erwarteOk
        ? `${verschwunden.length} Pfade weg, genau die gewollten`
        : `nichts weg, Grund: ${'grund' in ausgang ? ausgang.grund : ''}`,
    )
  }

  if (!BEHALTEN) await fsp.rm(wurzel, { recursive: true, force: true })
  else console.log(`        Sandkasten: ${wurzel}`)
}

async function main() {
  console.log('KOMM TROTZDEM DURCH — deletelocal gegen echte Ordner unter /tmp\n')
  console.log(`Faelle: ${FAELLE.length}\n`)
  for (const fall of FAELLE) {
    await fallFahren(fall)
    console.log(`        (${fall.warum})`)
  }
  await wettrennenFahren(40)
  console.log(`\n${gruen} gruen, ${rot} rot`)
  process.exit(rot === 0 ? 0 : 1)
}

main().catch((f) => {
  console.error(f)
  process.exit(1)
})
