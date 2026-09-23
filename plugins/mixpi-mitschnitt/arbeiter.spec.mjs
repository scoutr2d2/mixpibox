/**
 * Tests der reinen Teile des Leerlauf-Arbeiters (E66).
 *
 * DREI FALLEN AUS DEM BACKLOG, hier je ein Block. Alle drei sind vor dem
 * Bauen gefunden worden — das ist selten und soll nicht dadurch verlorengehen,
 * dass niemand sie festnagelt.
 *
 *   1. DER KNOTENNAME KOLLIDIERT. Zwei Soloist-Instanzen heissen beide
 *      `spotify`. Wer ueber den Namen abgreift, erwischt womoeglich den
 *      Familienstrom — und SIEHT DABEI AUS, ALS ARBEITE ER. Ton kommt, er
 *      wird aufgenommen, nur eben der falsche.
 *   2. OHNE `-d` HOERT DIE FAMILIE DEN MITSCHNITT MIT (E63, das Echo).
 *   3. DER SCHLUESSEL STEHT IN `ps`. Nicht loesbar — aber er muss nicht
 *      zusaetzlich im Journal stehen.
 */
import { deepStrictEqual, match, ok, strictEqual } from 'node:assert'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import {
  aufnahmeArgumente,
  befehlZumZeigen,
  knotenFuerPid,
  laufDeuten,
  metadatenArgumente,
  mitschnittArgumente,
  veredelungsArgumente,
} from './arbeiter.mjs'

/** So sieht `pw-dump` aus — gekuerzt auf das, worauf es ankommt. */
const DUMP = [
  { id: 34, type: 'PipeWire:Interface:Node', info: { props: { 'application.process.id': 630, 'node.name': 'entzerrer' } } },

  // DER LINK STEHT ABSICHTLICH VORN und traegt DENSELBEN Namen UND dieselbe
  // Kennung wie der Knoten darunter. Nur der Typ-Riegel trennt sie; ohne ihn
  // griffe der Arbeiter an etwas, das gar keine Ports hat.
  { id: 69, type: 'PipeWire:Interface:Link', info: { props: { 'application.process.id': 40967, 'node.name': 'spotify' } } },

  // ZWEI KNOTEN MIT DEMSELBEN NAMEN — genau die Lage aus Falle 1. Ueber den
  // Namen waeren sie nicht zu unterscheiden.
  { id: 70, type: 'PipeWire:Interface:Node', info: { props: { 'application.process.id': 1679, 'node.name': 'spotify' } } },
  { id: 71, type: 'PipeWire:Interface:Node', info: { props: { 'application.process.id': 40967, 'node.name': 'spotify' } } },
]

describe('FALLE 1 am Geraet: die Kennung sitzt am CLIENT, nicht am Knoten', () => {
  // AM GERAET GEMESSEN (21.08.2026). Die erste Fassung suchte direkt ueber
  // `application.process.id` am Knoten — Soloist setzt sie dort GAR NICHT:
  //
  //     application.name  Spotify
  //     client.id         75
  //     node.name         spotify
  //
  // Sie sitzt am CLIENT, und der Knoten verweist mit `client.id` auf ihn.
  // Ausserdem spaltet Soloist Kinder ab; welcher Prozess den Ton fuehrt, ist
  // nicht zugesichert. Deshalb eine MENGE von Kennungen.
  const ECHT = [
    { id: 93, type: 'PipeWire:Interface:Client', info: { props: { 'application.process.id': 127292, 'application.name': 'Spotify' } } },
    { id: 94, type: 'PipeWire:Interface:Client', info: { props: { 'application.process.id': 999999, 'application.name': 'Spotify' } } },
    // Zwei gleichnamige Knoten an VERSCHIEDENEN Clients — Falle 1 im Original.
    { id: 75, type: 'PipeWire:Interface:Node', info: { props: { 'client.id': 93, 'node.name': 'spotify', 'object.serial': 4711 } } },
    { id: 76, type: 'PipeWire:Interface:Node', info: { props: { 'client.id': 94, 'node.name': 'spotify', 'object.serial': 4712 } } },
  ]

  it('findet den Knoten ueber Prozess -> Client -> Knoten', () => {
    deepStrictEqual(knotenFuerPid(ECHT, 127292), { id: 75, name: 'spotify', serial: 4711 })
    deepStrictEqual(knotenFuerPid(ECHT, 999999), { id: 76, name: 'spotify', serial: 4712 })
  })

  it('nimmt eine MENGE von Kennungen — Soloist spaltet Kinder ab', () => {
    // Der Aufrufer reicht den Prozessbaum herein; irgendeiner davon fuehrt
    // den Ton.
    deepStrictEqual(knotenFuerPid(ECHT, [55, 127292, 66]), { id: 75, name: 'spotify', serial: 4711 })
    strictEqual(knotenFuerPid(ECHT, [55, 66]), null)
  })

  it('haelt Falle 1 trotzdem geschlossen', () => {
    // Zwei Soloist-Instanzen heissen beide `spotify` — aber ihre
    // Prozessbaeume sind verschieden.
    ok(knotenFuerPid(ECHT, 127292).id !== knotenFuerPid(ECHT, 999999).id)
  })
})

describe('FALLE 1: der Knoten wird ueber die PROZESSKENNUNG gefunden', () => {
  it('unterscheidet zwei gleichnamige Knoten', () => {
    // Der Kern der Falle. Ueber den Namen waeren beide dasselbe.
    deepStrictEqual(knotenFuerPid(DUMP, 40967), { id: 71, name: 'spotify', serial: null })
    deepStrictEqual(knotenFuerPid(DUMP, 1679), { id: 70, name: 'spotify', serial: null })
  })

  it('nimmt nur Knoten, keine Links', () => {
    // Objekt 69 traegt dieselbe Kennung UND denselben Namen, ist aber ein
    // Link — und steht vorn. Wer ihn erwischt, haengt an etwas ohne Ports.
    strictEqual(knotenFuerPid(DUMP, 40967).id, 71)
  })

  it('gibt null, wenn der Prozess keinen Knoten hat', () => {
    // Der Knoten entsteht erst, WAEHREND gespielt wird. Vorher gibt es ihn
    // nicht, und das ist kein Fehler.
    strictEqual(knotenFuerPid(DUMP, 99999), null)
  })

  it('verlangt einen NAMEN — eine Kennung allein nutzt nichts', () => {
    // `pw-link` spricht Ports ueber `<name>:output_FL` an.
    const ohne = [{ id: 9, type: 'PipeWire:Interface:Node', info: { props: { 'application.process.id': 5 } } }]
    strictEqual(knotenFuerPid(ohne, 5), null)
  })

  it('eine unlesbare Ausgabe heisst „unbekannt", nicht „kein Knoten"', () => {
    // Beides ergibt null — aber der Aufrufer darf aus kaputtem JSON nicht
    // schliessen, dass nichts spielt. Deshalb wirft es nicht.
    strictEqual(knotenFuerPid('{kein json', 1679), null)
    strictEqual(knotenFuerPid(null, 1679), null)
    strictEqual(knotenFuerPid(DUMP, 'keine zahl'), null)
    strictEqual(knotenFuerPid(DUMP, 0), null)
  })

  it('liest auch die rohe Zeichenkette', () => {
    deepStrictEqual(knotenFuerPid(JSON.stringify(DUMP), 1679), { id: 70, name: 'spotify', serial: null })
  })
})

describe('FALLE 2: ohne eigene Senke wird gar nicht aufgenommen', () => {
  const voll = {
    name: 'MixPiBox Stream 2',
    schluessel: `spak_${'b'.repeat(32)}`,
    uri: 'spotify:track:0PyuOAMz1lv0z737JcQNOg',
    senke: 'mitschnitt-leer',
  }

  it('setzt -d auf die Senke', () => {
    const a = aufnahmeArgumente(voll)
    const i = a.indexOf('-d')
    ok(i >= 0, 'ohne -d hoert die Familie mit')
    strictEqual(a[i + 1], 'mitschnitt-leer')
  })

  it('GIBT GAR KEINEN BEFEHL ohne Senke', () => {
    // Lieber nicht aufnehmen als der Familie in den Lautsprecher spielen —
    // das Stueck steht auf der Liste und laeuft nicht weg.
    strictEqual(aufnahmeArgumente({ ...voll, senke: '' }), null)
    strictEqual(aufnahmeArgumente({ ...voll, senke: undefined }), null)
  })

  it('spielt genau EIN Stueck', () => {
    // `--single-track` beendet sich selbst. Das ist das harte Signal, das die
    // 97-%-Schaetzung aus E64a ersetzt.
    const a = aufnahmeArgumente(voll)
    const i = a.indexOf('--single-track')
    ok(i >= 0)
    strictEqual(a[i + 1], voll.uri)
  })

  it('trennt Daten und Zwischenspeicher, wenn sie genannt sind', () => {
    // Zwei Instanzen im selben Datenordner traeten sich auf die Anmeldung.
    const a = aufnahmeArgumente({ ...voll, datenOrdner: '/var/lib/soloist2', cacheOrdner: '/var/cache/soloist2' })
    strictEqual(a[a.indexOf('-D') + 1], '/var/lib/soloist2')
    strictEqual(a[a.indexOf('-C') + 1], '/var/cache/soloist2')
  })

  it('verlangt Name, Schluessel und Titel', () => {
    for (const feld of ['name', 'schluessel', 'uri']) {
      strictEqual(aufnahmeArgumente({ ...voll, [feld]: '' }), null, feld)
    }
  })
})

describe('FALLE 3: der Schluessel steht in ps — aber nicht auch noch im Journal', () => {
  it('verdeckt ihn in der Zeile zum Zeigen', () => {
    const a = aufnahmeArgumente({
      name: 'X',
      schluessel: `spak_${'c'.repeat(32)}`,
      uri: 'spotify:track:abc',
      senke: 'leer',
    })
    const zeile = befehlZumZeigen(a)
    ok(!zeile.includes('c'.repeat(32)), `der Schluessel steht in der Zeile: ${zeile}`)
    match(zeile, /spak_<verborgen>/)
    // Und das, was man wirklich lesen will, bleibt drin.
    match(zeile, /--single-track spotify:track:abc/)
    match(zeile, /-d leer/)
  })

  it('vertraegt Unsinn', () => {
    strictEqual(befehlZumZeigen(null), '')
    strictEqual(befehlZumZeigen(['-k']), '-k', 'ein -k ohne Wert darf nicht abstuerzen')
  })
})

describe('laufDeuten — das harte Signal', () => {
  it('Rueckgabewert 0 heisst: ganz gespielt', () => {
    deepStrictEqual(laufDeuten({ code: 0 }), { fertig: true, grund: '' })
  })

  it('die Zeitsperre wird eigens benannt', () => {
    // Sie ist kein Fehler des TITELS, sondern der Umstaende. Wer sie als
    // Titelfehler zaehlt, verbraucht drei Anlaeufe an einem Netzproblem.
    const r = laufDeuten({ frist: true, code: null })
    strictEqual(r.fertig, false)
    match(r.grund, /Zeitsperre/)
  })

  it('nimmt den Grund aus der Ausgabe mit', () => {
    const r = laufDeuten({ code: 1, ausgabe: '\n\n  track not available in your country\nmehr' })
    strictEqual(r.fertig, false)
    match(r.grund, /not available/)
  })

  it('kommt auch ohne Ausgabe zurecht', () => {
    match(laufDeuten({ code: 3, ausgabe: '' }).grund, /endete mit 3/)
    match(laufDeuten({ code: null, signal: 'SIGKILL' }).grund, /SIGKILL/)
  })
})

describe('der Arbeiter ist auch WIRKLICH eingehaengt', () => {
  // DIE FEHLERKLASSE, vor der scripts/systemd/einrichten.sh in seinem Kopf
  // warnt: „ein Skript liegt fertig auf der Box, funktioniert — und NIEMAND
  // startet es." Vier Mal an einem Tag passiert, und einmal beim Schreiben
  // dieses Arbeiters beinahe wieder.
  //
  // Geprueft wird der QUELLTEXT, nicht die Wirkung — die braucht einen
  // laufenden Wirt. Aber der eine Aufruf, dessen Fehlen alles wirkungslos
  // macht, laesst sich hier festnageln.
  /**
   * Der Quelltext OHNE Kommentare.
   *
   * Ohne dieses Abstreifen ueberlebt eine Textsuche einen auskommentierten
   * Aufruf — und genau das ist hier passiert: die Gegenprobe „der Takt wird
   * nicht mehr gestellt" blieb gruen, weil `// leerlaufTakt(true, …)` das
   * Muster noch erfuellte. Ein Test, der einen abgeschalteten Aufruf fuer
   * vorhanden haelt, ist schlimmer als keiner.
   */
  const quelle = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((z) => z.replace(/^\s*\/\/.*$/, ''))
    .join('\n')

  // ZWEI AUFRUFE, ZWEI BEREICHE — und die duerfen sich NICHT ueberlappen.
  // Die erste Fassung dieser beiden Tests schnitt beide Male denselben,
  // grossen Block heraus (`ereignis` bis `befinden`). Darin lagen BEIDE
  // Aufrufe, also deckte jeder den anderen: einen auszukommentieren blieb
  // gruen. Ein Test, der zwei Dinge prueft und dabei nur eines braucht,
  // prueft in Wahrheit keines.
  const teil = (von, bis) => {
    const a = quelle.indexOf(von)
    ok(a > 0, `nicht gefunden: ${von}`)
    const b = quelle.indexOf(bis, a + von.length)
    ok(b > a, `Ende nicht gefunden: ${bis}`)
    return quelle.slice(a, b)
  }

  it('der Takt wird beim START der Wiedergabe gestellt', () => {
    // Der Abschnitt NACH der Erlaubnispruefung und VOR dem Start — dort und
    // nur dort steht der eine Aufruf, um den es hier geht.
    match(teil('this._zuletzt = null', 'starten(e, kontext.protokoll)'), /leerlaufTakt\(true/)
  })

  it('und AUCH beim Anhalten der Wiedergabe', () => {
    // Sonst naehme eine Box, die seit dem Neustart nichts gespielt hat, auch
    // nie etwas nach — der Leerlauf beginnt ja genau dort.
    match(teil("if (name === 'wiedergabeGestoppt'", "if (name !== 'wiedergabeGestartet')"), /leerlaufTakt\(true/)
  })

  it('und im BEFINDEN — sonst schlaeft die Liste einen Neustart lang', () => {
    // Der Vertrag kennt keinen Lade-Haken. Ohne diesen dritten Aufruf laegen
    // nach einem Neustart vorgemerkte Titel da und warteten auf ein Ereignis,
    // das niemand ausloest.
    match(teil('async befinden(kontext)', 'return urteil.ja'), /leerlaufTakt\(true/)
  })

  it('es laeuft immer nur EIN Durchgang', () => {
    // Zwei gleichzeitige Laeufe waeren zwei Soloist-Instanzen auf demselben
    // Zugang — und die nehmen sich gegenseitig die Wiedergabe weg.
    const ab = quelle.indexOf('async function leerlaufDurchgang(')
    ok(ab > 0)
    match(quelle.slice(ab, ab + 400), /if \(arbeit\.laeuft \|\| lauf\.prozess\) return/)
  })

  it('der Versuch zaehlt beim BEGINN, nicht am Ende', () => {
    // Regel 3 der Liste: endet der Lauf hart, gibt es kein Ende, das noch
    // zaehlen koennte.
    const ab = quelle.indexOf('async function leerlaufDurchgang(')
    const block = quelle.slice(ab, quelle.indexOf('function leerlaufTakt('))
    const beginn = block.indexOf('beginnen(liste')
    const aufnahme = block.indexOf('einenAufnehmen(')
    ok(beginn > 0 && aufnahme > beginn, 'beginnen() muss VOR der Aufnahme stehen')
  })

  it('die halbe Datei heisst anders als die fertige', () => {
    // Ein Abbruch darf nichts liegen lassen, was vollstaendig aussieht — ein
    // halbes Hoerspiel ist kein Puffer, sondern ein Versprechen, das bricht.
    const ab = quelle.indexOf('async function einenAufnehmen(')
    const block = quelle.slice(ab, quelle.indexOf('async function leerlaufDurchgang('))
    // ZWEI ZWISCHENSTUFEN SEIT E135/1c (10.09.2026): die rohe Aufnahme
    // (`.teil.flac`) und die veredelte mit Tags und Bild (`.fertig.flac`).
    // BEIDE tragen den fuehrenden Punkt, und umbenannt wird erst danach —
    // sonst laege waehrend des Veredelns eine Datei da, die vollstaendig
    // aussieht und keine Tags hat.
    match(block, /\.teil\.flac/)
    match(block, /\.fertig\.flac/)
    const zwischen = block.indexOf('const zwischen =')
    const veredelt = block.indexOf('const veredelt =')
    const umbenennen = block.indexOf('rename(abgelegt, ziel)')
    ok(zwischen > 0 && veredelt > zwischen, 'erst die rohe, dann die veredelte Zwischendatei')
    ok(umbenennen > veredelt, 'das Umbenennen kommt zuletzt')
    match(block, /rm\(zwischen, \{ force: true \}\)/)
    // Das Veredeln darf die Aufnahme nicht verschlucken: misslingt es, wird
    // die ROHE Datei abgelegt (`abgelegt` faengt als `zwischen` an).
    match(block, /let abgelegt = zwischen/)
  })
})

describe('DIE ERLAUBNIS GILT AUCH IM LEERLAUF', () => {
  // Die beiden Schalter („Ich habe die Rechtslage gelesen" und „Spotify
  // mitschneiden") sind die ganze Zusicherung dieses Plugins. Der passive
  // Abgriff fragt sie. Der Leerlauf-Arbeiter nimmt AKTIV auf — ohne dieselbe
  // Pruefung schnitte er mit, waehrend beide Schalter aus sind, und zwar
  // unsichtbar: niemand hoert, was in eine Leersenke laeuft.
  //
  // Eine Zusicherung, die nur einer von zwei Wegen einhaelt, ist keine.
  const quelle = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((z) => z.replace(/^\s*\/\/.*$/, ''))
    .join('\n')

  it('der Leerlauf fragt erlaubt(), bevor er irgendetwas tut', () => {
    const ab = quelle.indexOf('async function leerlaufDurchgang(')
    ok(ab > 0)
    const block = quelle.slice(ab, quelle.indexOf('function leerlaufTakt('))
    match(block, /erlaubt\(einstellungen, 'spotify'\)/)
  })

  it('und zwar VOR dem ersten Auftrag, nicht danach', () => {
    // Nach dem Auftrag waere zu spaet: `beginnen()` haette den Versuch schon
    // gezaehlt und die Liste angefasst.
    const ab = quelle.indexOf('async function leerlaufDurchgang(')
    const block = quelle.slice(ab, quelle.indexOf('function leerlaufTakt('))
    const pruefung = block.indexOf('erlaubt(einstellungen')
    const arbeit = block.indexOf('arbeit.laeuft = true')
    ok(pruefung > 0 && pruefung < arbeit, 'die Erlaubnis muss vor der Arbeit stehen')
  })
})

describe('die Antwort des Servers wird richtig gelesen', () => {
  // AM GERAET GEFUNDEN, nicht hier: `stroemeHolen` prueft `antwort.status`,
  // nicht `antwort.ok`. Das Feld `ok` gibt es bei `serverSchicken` nicht —
  // es loest mit `{ status, inhalt }` auf, nicht in der Gestalt einer
  // fetch-Antwort. Der Ausdruck war immer falsch, die Funktion gab immer
  // null, und der Leerlauf meldete geduldig „kein Strom eingerichtet",
  // obwohl beide Stroeme sauber eingetragen waren.
  //
  // Ein Test kann das nicht von selbst finden — die reinen Zeugen pruefen
  // `wasJetzt` gegen ERFUNDENE Aufstellungen und wissen nichts darueber, ob
  // die echte je ankommt. Er kann es aber festhalten, damit es nicht
  // zurueckkommt.
  const quelle = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((z) => z.replace(/^\s*\/\/.*$/, ''))
    .join('\n')

  it('die Stroeme kommen aus dem KONTEXT, nicht ueber HTTP', () => {
    // Ueber HTTP konnte es nie gehen: `GET /api/stroeme` gibt den Zugang
    // bewusst nie heraus. Das Plugin bekam Stroeme ohne Schluessel und meldete
    // geduldig „Strom 2 hat keinen Zugang" — obwohl einer eingetragen war.
    ok(!/serverSchicken\('\/api\/stroeme'/.test(quelle), 'fragt wieder ueber HTTP nach den Stroemen')
    const ab = quelle.indexOf('function stroemeAusKontext(')
    ok(ab > 0, 'stroemeAusKontext fehlt')
    match(quelle.slice(ab, ab + 400), /kontextStroeme/)
  })

  it('und werden aus dem Kontext uebernommen, wenn der Wirt sie reicht', () => {
    match(quelle, /if \(Array\.isArray\(kontext\.stroeme\)\) kontextStroeme = kontext\.stroeme/)
  })

  it('ohne Stroeme gibt es null, nicht eine leere Aufstellung', () => {
    // „Nicht zu erfahren" ist etwas anderes als „keine". Ohne das Recht
    // `aufnahme` gibt es das Feld gar nicht, und `wasJetzt` soll dann seinen
    // eigenen Grund nennen statt einer erfundenen leeren Liste.
    const ab = quelle.indexOf('function stroemeAusKontext(')
    match(quelle.slice(ab, ab + 400), /: null/)
  })
})

describe('EIN UMSTAND DARF NICHT DIE GANZE LISTE VERBRENNEN', () => {
  // Am Geraet gesehen (21.08.2026): Strom 2 war nicht gekoppelt, also
  // scheiterte JEDER Titel — mit demselben Grund. Der Arbeiter haette sich
  // reihum durch alle 31 Eintraege gearbeitet und jeden nach drei Anlaeufen
  // auf `fehler` gelegt. Am Ende stuende eine Liste voller kaputter Titel und
  // EIN kaputter Strom.
  //
  // Dasselbe Prinzip wie bei der Zeitsperre in `laufDeuten`, nur eine Ebene
  // hoeher: Wenn derselbe Grund bei VERSCHIEDENEN Titeln wiederkehrt, liegt es
  // nicht an den Titeln.
  const quelle = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((z) => z.replace(/^\s*\/\/.*$/, ''))
    .join('\n')

  const teil = (von, bis) => {
    const a = quelle.indexOf(von)
    ok(a > 0, `nicht gefunden: ${von}`)
    const b = quelle.indexOf(bis, a + von.length)
    ok(b > a, `Ende nicht gefunden: ${bis}`)
    return quelle.slice(a, b)
  }

  it('zaehlt gleiche Fehlgruende und haelt den Takt an', () => {
    const block = teil('async function leerlaufDurchgang(', 'function leerlaufTakt(')
    match(block, /arbeit\.letzterFehlgrund/)
    match(block, /leerlaufTakt\(false\)/)
  })

  it('setzt den Zaehler bei Erfolg zurueck', () => {
    // Sonst summierten sich Fehlschlaege ueber Stunden und der Takt stuende
    // irgendwann wegen zweier Fehler, die nichts miteinander zu tun hatten.
    const block = teil('async function leerlaufDurchgang(', 'function leerlaufTakt(')
    match(block, /arbeit\.gleicheFehler = 0/)
  })

  it('sagt in der Meldung, dass es NICHT an den Titeln liegt', () => {
    // Wer nur „angehalten" liest, sucht den Fehler in der Liste.
    const block = teil('async function leerlaufDurchgang(', 'function leerlaufTakt(')
    match(block, /liegt nicht an den Titeln/)
  })

  it('jeder Strom bekommt einen eigenen Datenordner', () => {
    // Zwei Soloist-Instanzen im selben Ordner treten sich auf die Anmeldung —
    // und die Anmeldung ist genau das, was --single-track verlangt.
    // BEIDE ZEILEN EINZELN — die erste Fassung suchte nur nach dem Muster
    // `mixpi-strom-${strom.nr}` irgendwo im Block, und das stand auch in der
    // cacheOrdner-Zeile. Die Sabotage an `datenOrdner` blieb dadurch gruen.
    const block = teil('async function einenAufnehmen(', 'async function leerlaufDurchgang(')
    match(block, /datenOrdner: strom\.datenOrdner \|\| `\/var\/lib\/mixpi-strom-\$\{strom\.nr\}`/)
    match(block, /cacheOrdner: strom\.cacheOrdner \|\| `\/var\/cache\/mixpi-strom-\$\{strom\.nr\}`/)
  })
})

describe('DIE SERIENNUMMER — der Griff, den der Name nicht ersetzt (Befund 23.08.2026)', () => {
  /* WARUM ES DIESE ZEUGEN GIBT
   *
   * Am 22.08.2026 wurden vier Mitschnitte digital STILL aufgenommen und als
   * fertig abgehakt; zwei weitere desselben Abends enthielten zur Haelfte die
   * FAMILIENWIEDERGABE. Ursache: der Abgriff wurde ueber den NAMEN gelegt, und
   * beide Soloist-Instanzen heissen `spotify`.
   *
   * `knotenFuerPid` hatte die Eindeutigkeit die ganze Zeit — ueber die
   * Prozesskennung — und gab sie als `id` + `name` zurueck. Der Aufrufer warf
   * die Eindeutigkeit dann weg und verlinkte ueber den Namen.
   *
   * AM GERAET GEMESSEN (23.08.2026), warum es die SERIENNUMMER sein muss und
   * nicht die Id: `pw-record --target` nimmt laut eigener Hilfe „node target
   * serial or name". Die Id stimmte in der Messung nur ZUFAELLIG mit der
   * Seriennummer ueberein (33 = 33).
   */
  const ZWEI_SOLOISTS = [
    { id: 20, type: 'PipeWire:Interface:Client', info: { props: { 'application.process.id': 1608 } } },
    { id: 21, type: 'PipeWire:Interface:Client', info: { props: { 'application.process.id': 4242 } } },
    // Beide heissen `spotify`. Nur die Seriennummer trennt sie zuverlaessig.
    { id: 98, type: 'PipeWire:Interface:Node', info: { props: { 'client.id': 20, 'node.name': 'spotify', 'object.serial': 8801 } } },
    { id: 99, type: 'PipeWire:Interface:Node', info: { props: { 'client.id': 21, 'node.name': 'spotify', 'object.serial': 8802 } } },
  ]

  it('DER FALL VOM 22.08.: zwei `spotify`, und jeder bekommt seine eigene Serie', () => {
    const familie = knotenFuerPid(ZWEI_SOLOISTS, 1608)
    const arbeiter = knotenFuerPid(ZWEI_SOLOISTS, 4242)
    // Ueber den Namen waeren die beiden NICHT zu unterscheiden — genau daran
    // ist es gescheitert.
    strictEqual(familie.name, arbeiter.name)
    ok(familie.serial !== arbeiter.serial, 'die Seriennummern muessen sich unterscheiden')
    strictEqual(familie.serial, 8801)
    strictEqual(arbeiter.serial, 8802)
  })

  it('die Serie wird DURCHGEREICHT, nicht neu erfunden', () => {
    // Sabotage, die das rot macht: in knotenFuerPid `serial` fest auf die
    // `id` setzen. Dann kaeme hier 98 statt 8801 — und am Geraet haette
    // `--target` still auf die Standardquelle zurueckgegriffen.
    strictEqual(knotenFuerPid(ZWEI_SOLOISTS, 1608).serial, 8801)
    ok(knotenFuerPid(ZWEI_SOLOISTS, 1608).serial !== knotenFuerPid(ZWEI_SOLOISTS, 1608).id)
  })

  it('OHNE object.serial kommt null — und NICHT die Id als Ersatz', () => {
    // Ein stiller Ersatz waere hier das Schlimmste: der Aufrufer haelt den
    // Abgriff fuer gesichert, `--target` faellt auf die Standardquelle
    // zurueck, und der Lautsprecher-Monitor landet in der Datei.
    const ohneSerie = [
      { id: 7, type: 'PipeWire:Interface:Node', info: { props: { 'application.process.id': 5, 'node.name': 'spotify' } } },
    ]
    const k = knotenFuerPid(ohneSerie, 5)
    strictEqual(k.serial, null)
    strictEqual(k.id, 7)
  })

  it('eine unbrauchbare Serie wird zu null, nicht zu NaN', () => {
    // `Number('x')` ist NaN, und NaN als `--target` waere die Zeichenkette
    // "NaN" — ein Ziel, das es nicht gibt, also wieder die Standardquelle.
    const krumm = [
      { id: 8, type: 'PipeWire:Interface:Node', info: { props: { 'application.process.id': 6, 'node.name': 'spotify', 'object.serial': 'keine' } } },
    ]
    strictEqual(knotenFuerPid(krumm, 6).serial, null)
  })
})

describe('DER ABGRIFF: ohne --target nimmt die Box den Lautsprecher auf', () => {
  /* DIE ZEUGEN, DIE AM 22.08.2026 GEFEHLT HABEN.
   *
   * Gegengeprobt: `--target` aus dem alten, eingebetteten Aufruf entfernt —
   * alle 195 Tests blieben gruen. Deshalb steht die Argumentliste jetzt in
   * einer reinen Funktion, und deshalb stehen diese Faelle hier.
   */
  const voll = { knotenName: 'mixpi-aufnahme', serial: 8802, rate: 48000, ziel: '/tmp/x.flac' }

  it('SETZT --target, UND ZWAR AUF DIE SERIENNUMMER', () => {
    const a = mitschnittArgumente(voll)
    const i = a.indexOf('--target')
    ok(i >= 0, 'ohne --target sucht sich pw-record die Standardquelle: den Lautsprecher')
    strictEqual(a[i + 1], '8802')
  })

  it('DIE SERIENNUMMER, NICHT DER NAME — beide Soloists heissen `spotify`', () => {
    // Der Knotenname taucht nur als EIGENname des Mitschneiders auf (-P),
    // niemals als Ziel. Wer das verwechselt, greift die falsche Instanz ab.
    const a = mitschnittArgumente({ ...voll, knotenName: 'spotify' })
    strictEqual(a[a.indexOf('--target') + 1], '8802')
    strictEqual(a[a.indexOf('-P') + 1], '{ node.name = "spotify" }')
  })

  it('GIBT GAR KEINEN BEFEHL OHNE SERIENNUMMER', () => {
    // Lieber nicht aufnehmen als eine Datei erzeugen, von der niemand weiss,
    // was drin ist. Genau diese vier Faelle sind am 22.08. still geworden.
    for (const kaputt of [null, undefined, 0, -1, Number.NaN, 'keine', '']) {
      strictEqual(mitschnittArgumente({ ...voll, serial: kaputt }), null, String(kaputt))
    }
  })

  it('und auch nicht ohne Ziel, Namen oder Abtastrate', () => {
    strictEqual(mitschnittArgumente({ ...voll, ziel: '' }), null)
    strictEqual(mitschnittArgumente({ ...voll, knotenName: '' }), null)
    strictEqual(mitschnittArgumente({ ...voll, rate: 0 }), null)
  })

  it('die Abtastrate und das Ziel kommen durch', () => {
    const a = mitschnittArgumente(voll)
    strictEqual(a[a.indexOf('--rate') + 1], '48000')
    strictEqual(a[a.length - 1], '/tmp/x.flac')
  })
})

/* ══ E135/1c: DER NACHSCHNITT SCHREIBT TAGS UND BILD ════════════════════════
 *
 * Bis zum 10.09.2026 tat er beides nicht — `pw-record` schreibt reinen Ton,
 * und danach wurde nur umbenannt. Am Geraet gemessen (07.09., alle 69 Alben):
 * 42 ohne jedes Bild, alle nachts entstanden. Diese Zeugen halten fest, was
 * die Argumente koennen muessen, damit das nicht ein viertes Mal durchrutscht.
 */
describe('metadatenArgumente — leere Werte sind kein Tag', () => {
  it('macht aus Paaren -metadata-Schalter', () => {
    deepStrictEqual(metadatenArgumente({ title: 'Sandmann', artist: 'Rolf' }), [
      '-metadata', 'title=Sandmann',
      '-metadata', 'artist=Rolf',
    ])
  })

  it('LEERES FAELLT WEG statt als leerer Tag hineinzugehen', () => {
    // Ein `artist=` in der Datei liest jede Musikverwaltung als
    // „ausdruecklich leer" — schlimmer als gar kein artist.
    deepStrictEqual(metadatenArgumente({ title: 'X', artist: '', album: '   ', track: null }), [
      '-metadata', 'title=X',
    ])
  })

  it('Zahlen kommen durch, Unsinn nicht', () => {
    deepStrictEqual(metadatenArgumente({ track: 7 }), ['-metadata', 'track=7'])
    deepStrictEqual(metadatenArgumente(null), [])
    deepStrictEqual(metadatenArgumente({ a: {}, b: [] }), [])
  })
})

describe('veredelungsArgumente — Tags und Bild ohne den Ton anzufassen', () => {
  const voll = { quelle: '/m/.x.teil.flac', ziel: '/m/.x.fertig.flac' }

  it('KOPIERT DEN TON, statt ihn neu zu rechnen', () => {
    // Der ganze Punkt: die FLAC liegt fertig da. Sie noch einmal zu codieren
    // kostet auf dieser Box Minuten und gewinnt kein Bit.
    const a = veredelungsArgumente(voll)
    strictEqual(a[a.indexOf('-c:a') + 1], 'copy')
    ok(!a.includes('flac'), 'kein Neucodieren')
  })

  it('haengt das Bild als attached_pic an — nicht als Videospur', () => {
    const a = veredelungsArgumente({ ...voll, bild: '/m/.cover.jpg' })
    strictEqual(a[a.indexOf('-disposition:v:0') + 1], 'attached_pic')
    strictEqual(a[a.lastIndexOf('-i') + 1], '/m/.cover.jpg')
    ok(a.includes('mjpeg'))
  })

  it('ohne Bild bleibt es beim Ton allein', () => {
    const a = veredelungsArgumente(voll)
    ok(!a.includes('attached_pic'))
    strictEqual(a[a.indexOf('-map') + 1], '0:a')
  })

  it('QUELLE UND ZIEL DUERFEN NICHT DIESELBE DATEI SEIN', () => {
    // ffmpeg kann nicht in die Datei schreiben, aus der es liest — es
    // entstuende eine leere, und die Aufnahme waere weg.
    strictEqual(veredelungsArgumente({ quelle: '/m/x.flac', ziel: '/m/x.flac' }), null)
  })

  it('und gar kein Befehl ohne Quelle oder Ziel', () => {
    strictEqual(veredelungsArgumente({ ...voll, quelle: '' }), null)
    strictEqual(veredelungsArgumente({ ...voll, ziel: '' }), null)
    strictEqual(veredelungsArgumente(null), null)
  })

  it('das Ziel steht am Ende, die Tags davor', () => {
    const a = veredelungsArgumente({ ...voll, tags: { title: 'Y' } })
    strictEqual(a[a.length - 1], '/m/.x.fertig.flac')
    strictEqual(a[a.length - 2], 'title=Y')
  })
})
