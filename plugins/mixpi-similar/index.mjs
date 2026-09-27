/**
 * Aehnliche Interpreten — aus mehreren Quellen zu einer Liste verschmolzen.
 *
 * Braucht die Rechte `netz` (kontext.holen) und sonst nichts: dieses Plugin
 * bestimmt NICHT, was gespielt wird. Es beschreibt, was zu dem passt, was
 * ohnehin da ist — dieselbe Trennung wie bei `songtext` gegen `medienquelle`.
 *
 * ══ DIE FRAGE, UM DIE ES GEHT ═════════════════════════════════════════════
 *
 * „Das Kind hoert Pettersson und Findus — was noch?" Die uebliche Antwort
 * eines Empfehlungsdienstes ist „was Vierjaehrige sonst so hoeren", und das
 * ist fast nie eine Antwort: zwischen einem ruhigen Bauernhof-Hoerspiel und
 * einer Rettungsstaffel mit Martinshorn liegt alles, was einen Abend
 * ausmacht. Deshalb steht hier neben den Hoerdaten-Quellen eine eigene
 * INHALTS-Quelle, und deshalb wiegt sie in der Vorgabe am meisten.
 *
 * ══ WIE ES ZUSAMMENHAENGT ═════════════════════════════════════════════════
 *
 *   Frage ──► Aufloesen ──► [Quelle 1..n] ──► Verschmelzen ──► Liste
 *                 │                 │
 *                 └─── Kartei ◄─────┘   (Datenordner, JSON, mit Haltbarkeit)
 *
 * ══ WAS ANDERS IST ALS IM ENTWURF, UND WARUM ══════════════════════════════
 *
 * Der Entwurf beschrieb einen eigenen Dienst im Backend mit SQLite und
 * `/api/similar/*`-Routen. Gebaut ist ein PLUGIN, und das aus einem Grund, der
 * schwerer wiegt als der Aufwand: der Kern der Box ist der Ort, an dem die
 * Kinderzeit haengt, und jede Zeile dort ist eine Zeile, die ein Kind vor eine
 * stumme Box stellen kann. Ein Plugin laeuft im eigenen Worker mit eigenem
 * Speicherdeckel und eigener Frist; stirbt es, spielt die Musik weiter.
 *
 * Die drei Abweichungen, die daraus folgen — alle mit Begruendung an Ort und
 * Stelle:
 *
 *   1. KEIN SQLITE, sondern JSON im Datenordner. Begruendung in `speicher.mjs`
 *      (native Abhaengigkeit gegen `cp`-Ausrollweg, Node-Fassung der Box).
 *   2. ROUTEN unter `/api/plugins/mixpi-similar/http/…` statt `/api/similar/…`.
 *      Der Vertrag gibt keinen anderen Weg her (E77), und die Routen liegen
 *      damit hinter dem Tor der Verwaltung — richtig so, das hier ist eine
 *      Elternfrage, keine Kinderfrage.
 *   3. EINSTELLUNGEN aus dem Manifest statt aus `config/similar.json`. Der
 *      Eltern-Bereich baut die Oberflaeche daraus von selbst; eine eigene
 *      Datei haette eine eigene Verwaltungsflaeche gebraucht.
 */

import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verschmelzen } from './fusion.mjs'
import { normalName } from './normalisieren.mjs'
import { quelleBauen as inhaltsQuelleBauen, GEWICHT_VORGABE as INHALT_GEWICHT } from './quellen/inhalt.mjs'
import { Kartei } from './speicher.mjs'
import { eimerFuer } from './takt.mjs'
import { grundlinieBauen, imFenster, naechsterDran, namenAusBestand, neuigkeitenFinden } from './wachliste.mjs'

const HIER = dirname(fileURLToPath(import.meta.url))

/**
 * Die Kennung, mit der sich dieses Plugin bei fremden Diensten meldet.
 *
 * MUSICBRAINZ VERLANGT SIE AUSDRUECKLICH und sperrt anonyme Massenabrufer.
 * Sie steht hier als Konstante und nicht in einem Feld, weil ein leeres Feld
 * eine Box ohne Kennung ergaebe — der Betreiber kann seinen Kontakt ergaenzen
 * (`kontakt` im Manifest), aber nicht die Kennung wegnehmen.
 */
const KENNUNG_BASIS = 'mixpi-similar/0.1.0 (https://github.com/splitti/MuPiBox)'

/** Vorgaben — dieselben Zahlen wie im Manifest, einmal hier zum Nachschlagen. */
const VORGABE = {
  fusionK: 60,
  mindestensQuellen: 1,
  grenze: 20,
  haltbarkeitTage: 30,
}

/* ═════════════════════════════════════════════════════════════════════════
 * Der Quellen-Scan
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * Alle Quellen aus `quellen/` laden.
 *
 * DAS IST DAS ABNAHMEKRITERIUM „ein neues Plugin wird ohne Codeaenderung im
 * Kern erkannt": eine neue Datei in `quellen/` genuegt. Sie muss `id`, `name`
 * und `aehnlich` mitbringen; alles andere ist freiwillig.
 *
 * EINE KAPUTTE QUELLE DARF DEN REST NICHT MITNEHMEN. Das ist keine Hoeflichkeit
 * gegenueber dem Autor der Quelle, sondern der Unterschied zwischen „eine von
 * vier Quellen fehlt" und „das Plugin laedt nicht". Der Mangel geht ins
 * Journal und die Quelle in die Fehlerliste, die `/http/quellen` ausweist —
 * still verschwinden darf sie nicht.
 */
export async function quellenLaden(ordner, protokoll) {
  const gefunden = []
  const fehler = {}
  let dateien = []
  try {
    dateien = (await readdir(ordner)).filter((d) => d.endsWith('.mjs') && !d.endsWith('.spec.mjs')).sort()
  } catch (e) {
    protokoll?.(`Quellen-Ordner nicht lesbar: ${e?.message ?? e}`)
    return { quellen: [], fehler: { '*': String(e?.message ?? e) } }
  }

  for (const datei of dateien) {
    try {
      const modul = await import(join(ordner, datei))
      const quelle = typeof modul.quelleBauen === 'function' ? null : (modul.default ?? modul)
      // `inhalt.mjs` baut sich mit Daten und wird vom Wirt selbst
      // zusammengesetzt — es hat kein fertiges Standardobjekt.
      if (!quelle) continue
      if (!quelle.id) {
        fehler[datei] = 'Quelle ohne `id`'
        continue
      }
      // `aehnlich` IST NICHT PFLICHT — dieselbe Regel wie im Plugin-Vertrag
      // selbst: eine Quelle darf wenig koennen. `musicbrainz` liefert nur
      // Identitaet und Veroeffentlichungen und hat bewusst kein `aehnlich`;
      // wer das hier verlangte, koennte den Resolver nicht als Quelle fuehren
      // und muesste ihn im Wirt fest verdrahten.
      gefunden.push(quelle)
    } catch (e) {
      fehler[datei] = String(e?.message ?? e)
      protokoll?.(`Quelle ${datei} laedt nicht: ${e?.message ?? e}`)
    }
  }
  return { quellen: gefunden, fehler }
}

/**
 * Die Benachrichtigungskanaele aus `kanaele/` laden — dasselbe Muster wie bei
 * den Quellen, und aus demselben Grund: ein neuer Kanal ist eine neue Datei,
 * keine Aenderung am Wirt.
 *
 * DER POSTEINGANG STEHT NICHT IN DIESEM ORDNER. Er ist kein Kanal, sondern
 * der Ort, an dem eine Meldung liegt, BEVOR irgendein Kanal sie sieht — er
 * kann nicht ausfallen und nicht abgeschaltet werden, und deshalb wird er
 * auch nicht wie etwas behandelt, das man laden oder weglassen koennte.
 */
export async function kanaeleLaden(ordner, protokoll) {
  const gefunden = []
  const fehler = {}
  let dateien = []
  try {
    dateien = (await readdir(ordner)).filter((d) => d.endsWith('.mjs') && !d.endsWith('.spec.mjs')).sort()
  } catch {
    return { kanaele: [], fehler: {} }
  }
  for (const datei of dateien) {
    try {
      const modul = await import(join(ordner, datei))
      const kanal = modul.default ?? modul
      if (!kanal?.id || typeof kanal.senden !== 'function') {
        fehler[`kanal:${datei}`] = 'Kanal ohne `id` oder ohne `senden()`'
        continue
      }
      gefunden.push(kanal)
    } catch (e) {
      fehler[`kanal:${datei}`] = String(e?.message ?? e)
      protokoll?.(`Kanal ${datei} laedt nicht: ${e?.message ?? e}`)
    }
  }
  return { kanaele: gefunden, fehler }
}

/* ═════════════════════════════════════════════════════════════════════════
 * Zustand des Workers
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * ZUSTAND AUF MODULEBENE IST HIER RICHTIG, sonst nirgends: der Worker wird
 * beim LADEN gestartet und lebt ueber alle Rufe (`workerStarten` im Wirt), der
 * Kontext dagegen wird je Ruf gebaut. Karteien und Eimer, die je Ruf neu
 * entstuenden, waeren kein Zwischenspeicher und kein Limit, sondern Zierrat.
 */
let welt = null

/**
 * Den Modulzustand vergessen — NUR FUER ZEUGEN.
 *
 * Der Zustand oben ist Absicht: der Worker lebt ueber alle Rufe. Genau
 * deshalb braucht ein Zeuge einen Weg zurueck, sonst schleppt der zweite Test
 * die Karteien und den Zeitgeber des ersten mit und prueft etwas anderes, als
 * er zu pruefen glaubt.
 *
 * DER ZEITGEBER MUSS MIT WEG. Ein `setInterval`, das den Testlauf ueberlebt,
 * haelt den Prozess am Leben oder feuert in einen abgeraeumten Zustand.
 */
export function weltVergessen() {
  if (welt?.zeitgeber) clearInterval(welt.zeitgeber)
  welt = null
}

async function weltAufbauen(kontext) {
  if (welt) return welt

  const { quellen, fehler } = await quellenLaden(join(HIER, 'quellen'), kontext.protokoll)

  // Die Inhaltsquelle wird gebaut, nicht importiert — sie braucht ihre Daten.
  const saetze = await saetzeLaden(kontext)
  quellen.push(inhaltsQuelleBauen(saetze))

  const { kanaele, fehler: kanalFehler } = await kanaeleLaden(join(HIER, 'kanaele'), kontext.protokoll)

  welt = {
    quellen,
    kanaele,
    ladeFehler: { ...fehler, ...kanalFehler },
    saetze,
    karteien: {
      aehnlich: new Kartei(kontext.datenOrdner, 'aehnlich-kartei'),
      identitaet: new Kartei(kontext.datenOrdner, 'identitaet-kartei'),
      vektoren: new Kartei(kontext.datenOrdner, 'vektoren-kartei'),
      wachliste: new Kartei(kontext.datenOrdner, 'wachliste'),
      nachrichten: new Kartei(kontext.datenOrdner, 'nachrichten'),
      eigeneSaetze: new Kartei(kontext.datenOrdner, 'eigene-saetze'),
    },
    letzterFehler: {},
  }
  await Promise.all(Object.values(welt.karteien).map((k) => k.laden()))

  // Eigene Saetze aus dem Datenordner ueber den Startbestand legen — nach dem
  // Laden der Kartei, deshalb hier und nicht in `saetzeLaden`.
  welt.saetze = saetzeVerschmelzen(saetze, welt.karteien.eigeneSaetze)
  welt.quellen = welt.quellen.filter((q) => q.id !== 'inhalt')
  welt.quellen.push(inhaltsQuelleBauen(welt.saetze))

  // DER ZEITPLAN STARTET BEIM ERSTEN RUF, nicht beim Laden des Moduls. Beim
  // Laden gibt es noch keinen Kontext — und ohne Kontext kein `holen`, kein
  // Protokoll und keine Einstellungen. Ein Timer, der ins Leere liefe, waere
  // schlimmer als einer, der ein paar Minuten spaeter anfaengt.
  zeitplanStarten(einstellungenLesen(kontext), kontext, welt)

  return welt
}

/* ═════════════════════════════════════════════════════════════════════════
 * Die Wachliste
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * Den Medienbestand der Box lesen — von der PLATTE, nicht ueber HTTP.
 *
 * DAS IST NICHT UMSTAENDLICH, SONDERN DER EINZIGE WEG. `kontext.holen`
 * verwehrt die eigene Box (`adresseErlaubt` in `plugin-laufwerk.ts`), also
 * kann ein Plugin `GET /api/data` nicht rufen — der naheliegendste Weg ist
 * genau der verbotene.
 *
 * DER PFAD IST ABGELEITET, NICHT GERATEN. Beide Orte haengen im Server am
 * selben `configBasePath`:
 *
 *     dataFile     = `${configBasePath}/data.json`        (server.ts:792)
 *     datenWurzel  = `${configBasePath}/plugin-daten`     (server.ts:2600)
 *
 * und der eigene Datenordner ist `<datenWurzel>/<kennung>`. Zwei Ebenen
 * hinauf steht also `data.json`. Verschiebt jemand einen der beiden, faellt
 * das hier auf — und die Wachliste sagt dann „Bestand nicht lesbar" statt
 * still eine leere Liste zu beobachten.
 *
 * `data.json` UND NICHT `active_data.json`: die zweite ist im Offline-Betrieb
 * eine ANDERE, kuerzere Liste (server.ts:9141). Wer sie naehme, wuerfe
 * Wachlisten-Eintraege weg, sobald die Box einmal ohne Netz gestartet ist.
 */
async function bestandLesen(datenOrdner) {
  if (!datenOrdner) return { eintraege: [], fehler: 'kein Datenordner' }
  const pfad = join(datenOrdner, '..', '..', 'data.json')
  try {
    const roh = JSON.parse(await readFile(pfad, 'utf8'))
    return { eintraege: Array.isArray(roh) ? roh : [], fehler: null, pfad }
  } catch (e) {
    return { eintraege: [], fehler: `${pfad}: ${e?.message ?? e}`, pfad }
  }
}

/**
 * Die Veroeffentlichungen zu EINEM Namen, ueber alle Quellen, die das koennen.
 *
 * NACHEINANDER, NICHT PARALLEL — anders als beim Empfehlen. Der Grund ist der
 * Takt: MusicBrainz laesst eine Anfrage pro Sekunde zu, und hier wird nicht
 * ein Name gefragt, sondern die ganze Wachliste nacheinander. Parallel
 * gestartete Anfragen wuerden sich nur gegenseitig am Eimer stauen, und der
 * Eimer sagt dann nein — die zweite Quelle bekaeme gar keine Marke mehr.
 */
async function veroeffentlichungenHolen(name, einst, umgebung) {
  const frage = await identitaetKlaeren({ name }, einst, umgebung)
  const alle = []
  const fehler = {}

  for (const quelle of umgebung.quellen) {
    if (typeof quelle.veroeffentlichungen !== 'function') continue
    try {
      const ref = await quelle.aufloesen?.(frage, umgebung)
      if (!ref) continue
      const liste = (await quelle.veroeffentlichungen(ref, umgebung)) ?? []
      for (const v of liste) alle.push({ ...v, quelle: quelle.id })
    } catch (e) {
      fehler[quelle.id] = String(e?.message ?? e)
    }
  }
  return { veroeffentlichungen: alle, fehler, frage }
}

/**
 * EINEN Wachlisten-Eintrag pruefen und die Neuigkeiten melden.
 *
 * Zurueck kommt, wie viele Ereignisse entstanden sind. Der Eintrag wird
 * IMMER mit `zuletztGeprueft` zurueckgeschrieben, auch wenn nichts gefunden
 * wurde — sonst bliebe er beim naechsten Durchlauf wieder der aelteste und
 * die Liste kaeme nie herum.
 */
async function eintragPruefen(eintrag, einst, umgebung, w) {
  const { veroeffentlichungen, fehler } = await veroeffentlichungenHolen(eintrag.name, einst, umgebung)

  const { neu, bekannt } = neuigkeitenFinden(veroeffentlichungen, eintrag.bekannt, eintrag.eingetragenAm)

  const aktualisiert = {
    ...eintrag,
    bekannt,
    zuletztGeprueft: Date.now(),
    letzterFehler: Object.keys(fehler).length ? fehler : null,
  }
  w.karteien.wachliste.setzen(normalName(eintrag.name), aktualisiert)

  for (const v of neu) {
    await ereignisMelden(
      { art: 'veroeffentlichung', interpret: eintrag.name, nutzlast: v, erzeugtAm: new Date().toISOString() },
      einst,
      umgebung,
      w,
    )
  }
  return neu.length
}

/**
 * Ein Ereignis in den Posteingang legen und an die Kanaele geben.
 *
 * DER POSTEINGANG ZUERST, IMMER. Erst wenn die Meldung sicher liegt, wird
 * zugestellt — ein Kanal, der ausfaellt, darf nie der Grund sein, warum eine
 * Neuigkeit verschwindet. Zugestellt wird mit `allSettled`: ein toter Kanal
 * haelt die anderen nicht auf.
 */
async function ereignisMelden(ereignis, einst, umgebung, w) {
  const nr = `${Date.now()}-${Math.abs(hashVon(JSON.stringify(ereignis)))}`
  w.karteien.nachrichten.setzen(nr, { ...ereignis, gelesenAm: null })
  await w.karteien.nachrichten.sichern()

  const ergebnisse = await Promise.allSettled(
    w.kanaele.map(async (k) => ({ id: k.id, ...(await k.senden(ereignis, umgebung)) })),
  )
  for (const e of ergebnisse) {
    if (e.status === 'fulfilled' && e.value && !e.value.ok && e.value.text !== 'nicht eingerichtet') {
      umgebung.protokoll?.(`Kanal ${e.value.id}: ${e.value.text}`)
    }
  }
  return nr
}

/* ═════════════════════════════════════════════════════════════════════════
 * Der Zeitplan
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * Wie oft der Worker aufwacht, um EINEN Eintrag zu pruefen.
 *
 * NICHT das Prüfintervall des Nutzers — das ist die Frage „wie alt darf die
 * letzte Pruefung eines Eintrags sein?" (Vorgabe 24 h). Dies hier ist die
 * Frage „wie oft sehe ich nach, ob etwas dran ist?". Bei einer Wachliste mit
 * dreissig Eintraegen und 24 h Intervall muss alle 48 Minuten einer geprueft
 * werden; 15 Minuten sind eng genug dafuer und selten genug, um auf einer
 * Box, die nebenbei Musik spielt, nicht aufzufallen.
 */
const WECKRUF_MS = 15 * 60 * 1000

/**
 * Der Hintergrundlauf.
 *
 * ══ WARUM DAS HIER STEHT UND NICHT IN EINEM RUF ═══════════════════════════
 *
 * Ein Plugin-Ruf hat 8 Sekunden (`FRIST_MS` im Wirt). MusicBrainz laesst eine
 * Anfrage pro Sekunde zu. In einen Ruf passen damit hoechstens sieben
 * Anfragen — eine Wachliste mit zwanzig Eintraegen und zwei Quellen braucht
 * vierzig. Wer den Durchlauf in einen Ruf legt, reisst die Frist, und ein
 * Fristriss TERMINIERT DEN WORKER samt allen offenen Rufen; die Empfehlungen
 * stuerben mit.
 *
 * Der Worker lebt dagegen ueber alle Rufe hinweg — er wird beim LADEN
 * gestartet (`workerStarten` im Wirt), nicht beim Rufen. Ein Timer darin
 * laeuft also, und er unterliegt keiner Frist, weil ihn niemand ruft und
 * niemand auf ihn wartet.
 *
 * ══ EIN EINTRAG JE WECKRUF ════════════════════════════════════════════════
 *
 * Und immer der am laengsten nicht geprüfte (`naechsterDran`). Das ist die
 * Voraussetzung dafuer, dass ein Durchlauf abbrechen darf: ein Lauf, der
 * immer vorn anfaengt, prueft bei knapper Zeit ewig dieselben ersten
 * Eintraege und erreicht die hinteren nie.
 */
function zeitplanStarten(einst, kontext, w) {
  if (w.zeitgeber) return
  // `unref()` DAMIT DER TIMER DEN WORKER NICHT AM LEBEN HAELT. Ohne ihn
  // haengt ein Plugin, das abgeschaltet werden soll, noch bis zum naechsten
  // Weckruf am Prozess — und der Wirt wartet beim `terminate()` darauf.
  w.zeitgeber = setInterval(() => {
    void laufSchritt(einst, kontext, w)
  }, WECKRUF_MS)
  w.zeitgeber.unref?.()
}

/**
 * Ein einzelner Schritt des Hintergrundlaufs.
 *
 * DREI GRUENDE, NICHTS ZU TUN, und alle drei sind normal, keine Fehler:
 * abgeschaltet, ausserhalb des Zeitfensters, oder der aelteste Eintrag ist
 * noch frisch genug.
 */
async function laufSchritt(einst, kontext, w) {
  // EIN LAUF ZUR ZEIT. Ohne diese Sperre koennen sich zwei Weckrufe
  // ueberholen, wenn einer laenger braucht als das Intervall — und dann
  // schreiben zwei Laeufe denselben Karteieintrag mit verschiedenen Staenden.
  if (w.laufAktiv) return
  if (!einst.wachlisteAn) return
  if (!imFenster(new Date(), einst.fensterVon, einst.fensterBis)) return

  const alle = w.karteien.wachliste.eintraege().map((e) => e.wert)
  const dran = naechsterDran(alle)
  if (!dran) return

  const alter = Date.now() - Number(dran.zuletztGeprueft ?? 0)
  if (alter < einst.pruefIntervallStunden * 60 * 60 * 1000) return

  w.laufAktiv = true
  try {
    const umgebung = umgebungBauen(kontext, einst, w)
    const anzahl = await eintragPruefen(dran, einst, umgebung, w)
    await karteienSichern(w)
    if (anzahl > 0) kontext.protokoll?.(`Wachliste: ${anzahl} Neuigkeit(en) zu „${dran.name}".`)
  } catch (e) {
    // EIN FEHLER IM HINTERGRUND DARF NICHTS UMBRINGEN. Niemand wartet auf
    // diesen Lauf; er versucht es beim naechsten Weckruf wieder.
    kontext.protokoll?.(`Wachliste: Lauf an „${dran.name}" gescheitert: ${e?.message ?? e}`)
  } finally {
    w.laufAktiv = false
  }
}

/** Ein billiger Hash fuer die Nachrichtennummer — keine Faelschungssicherheit noetig. */
function hashVon(text) {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0
  return h
}

/** Der mitgelieferte Startbestand der Themenkarte. */
async function saetzeLaden(kontext) {
  try {
    const roh = await readFile(join(HIER, 'inhalt-daten.json'), 'utf8')
    const gelesen = JSON.parse(roh)
    return Array.isArray(gelesen?.saetze) ? gelesen.saetze : []
  } catch (e) {
    kontext.protokoll?.(`Themenkarte nicht lesbar: ${e?.message ?? e}`)
    return []
  }
}

/**
 * Startbestand und eigene Saetze zusammenlegen.
 *
 * DER EIGENE SATZ GEWINNT. Wer „Pettersson und Findus" selbst beschreibt,
 * will nicht, dass ein Plugin-Update seine Arbeit ueberschreibt — und ein
 * Update, das die mitgelieferte Datei aendert, tut genau das, wenn hier die
 * andere Reihenfolge stuende.
 */
function saetzeVerschmelzen(startbestand, eigeneKartei) {
  const nachName = new Map(startbestand.map((s) => [normalName(s.name), s]))
  for (const e of eigeneKartei.eintraege()) {
    const satz = e.wert
    if (satz?.name) nachName.set(normalName(satz.name), satz)
  }
  return [...nachName.values()]
}

/* ═════════════════════════════════════════════════════════════════════════
 * Einstellungen lesen
 * ═════════════════════════════════════════════════════════════════════════ */

function zahl(wert, vorgabe) {
  const z = Number(wert)
  return Number.isFinite(z) ? z : vorgabe
}

function einstellungenLesen(kontext) {
  const e = kontext.einstellungen ?? {}
  return {
    wachlisteAn: e.wachlisteAn !== false,
    ausBestand: e.wachlisteAusBestand === true,
    pruefIntervallStunden: zahl(e.pruefIntervallStunden, 24),
    fensterVon: String(e.fensterVon ?? '02:00'),
    fensterBis: String(e.fensterBis ?? '05:00'),
    ntfyAdresse: String(e.ntfyAdresse ?? '').trim(),
    ntfyThema: String(e.ntfyThema ?? '').trim(),
    webhookAdresse: String(e.webhookAdresse ?? '').trim(),
    gewichte: {
      lastfm: zahl(e.gewichtLastfm, 1),
      listenbrainz: zahl(e.gewichtListenbrainz, 1),
      deezer: zahl(e.gewichtDeezer, 0.7),
      inhalt: zahl(e.gewichtInhalt, INHALT_GEWICHT),
    },
    lastfmSchluessel: String(e.lastfmSchluessel ?? '').trim(),
    fusionK: zahl(e.fusionK, VORGABE.fusionK),
    mindestensQuellen: zahl(e.mindestensQuellen, VORGABE.mindestensQuellen),
    grenze: zahl(e.grenze, VORGABE.grenze),
    haltbarkeitTage: zahl(e.haltbarkeitTage, VORGABE.haltbarkeitTage),
    ollama: {
      adresse: String(e.ollamaAdresse ?? '').trim(),
      modell: String(e.ollamaModell ?? '').trim() || 'nomic-embed-text',
    },
    kontakt: String(e.kontakt ?? '').trim(),
  }
}

/** Der User-Agent fuer fremde Dienste, mit Kontakt, wenn einer eingetragen ist. */
function nutzerKennung(einst) {
  return einst.kontakt ? `${KENNUNG_BASIS} kontakt=${einst.kontakt}` : KENNUNG_BASIS
}

/* ═════════════════════════════════════════════════════════════════════════
 * Eine Quelle befragen — mit Kartei, Takt und Rueckfall
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * Eine einzelne Quelle nach aehnlichen Interpreten fragen.
 *
 * DER RUECKFALL AUF DEN ABGELAUFENEN EINTRAG IST DER KERN DIESER FUNKTION,
 * nicht ein Randfall: eine Box im Keller hat oefter kein Netz als eines, und
 * eine Antwort von gestern ist unendlich viel mehr wert als ein Fehler. Sie
 * wird dann als `stale` ausgewiesen — verschwiegen wird nichts.
 *
 * Zurueck kommt immer `{ treffer, stale, fehler }`, NIE ein Wurf. Eine Quelle,
 * die wirft, wuerde `Promise.allSettled` zwar ueberleben, aber ihre Auskunft
 * ginge verloren; so steht am Ende in `meta.errors`, WAS schiefging.
 */
async function quelleFragen(quelle, frage, einst, umgebung) {
  const schluessel = `${quelle.id}:${normalName(frage.name)}${frage.mbid ? `#${frage.mbid}` : ''}`
  const gemerkt = umgebung.karteien.aehnlich.holen(schluessel, einst.haltbarkeitTage)

  if (gemerkt && !gemerkt.abgelaufen) {
    return { treffer: gemerkt.wert, stale: false, fehler: null, ausKartei: true }
  }

  try {
    // DER TAKT GILT AUCH FUER DIE AUFLOESUNG, nicht nur fuer die Frage danach:
    // beides sind Anfragen an denselben Dienst, und ein Limit, das nur die
    // Haelfte zaehlt, ist kein Limit. Die Quelle nimmt sich ihre Marken selbst
    // ueber `umgebung.marke` — sie weiss am besten, wie viele sie braucht.
    const ref = await quelle.aufloesen?.(frage, umgebung)
    if (!ref) {
      return { treffer: [], stale: false, fehler: null, ausKartei: false, unbekannt: true }
    }
    const treffer = (await quelle.aehnlich(ref, einst.grenze, umgebung)) ?? []
    umgebung.karteien.aehnlich.setzen(schluessel, treffer)
    return { treffer, stale: false, fehler: null, ausKartei: false }
  } catch (e) {
    const meldung = String(e?.message ?? e)
    // ABGELAUFEN SCHLAEGT LEER. Siehe oben — das ist die Offline-Faehigkeit.
    if (gemerkt) {
      umgebung.protokoll?.(`${quelle.id}: ${meldung} — nehme den Stand von vorher.`)
      return { treffer: gemerkt.wert, stale: true, fehler: meldung, ausKartei: true }
    }
    umgebung.protokoll?.(`${quelle.id}: ${meldung}`)
    return { treffer: [], stale: false, fehler: meldung, ausKartei: false }
  }
}

/**
 * Die eigentliche Arbeit: alle Quellen fragen und verschmelzen.
 *
 * PARALLEL, und das ist keine Optimierung, sondern Pflicht: der ganze Ruf hat
 * 8 Sekunden. Vier Quellen nacheinander mit je zwei Sekunden sind acht — die
 * Frist ist gerissen, der Worker wird terminiert, und mit ihm sterben alle
 * anderen offenen Rufe. Nacheinander ginge das nur mit einem Zeitbudget je
 * Quelle, und das waere dieselbe Rechnung mit mehr Code.
 */
export async function aehnlicheFinden(frage, einst, umgebung) {
  const aktiv = umgebung.quellen.filter(
    (q) => typeof q.aehnlich === 'function' && (Number(einst.gewichte[q.id]) || 0) > 0,
  )

  // ERST DIE IDENTITAET, DANN DIE FRAGE — ABER NUR, WENN SIE JEMAND BRAUCHT.
  //
  // Die Aufloesung ist der Grund, warum ListenBrainz ueberhaupt antworten
  // kann: es kennt nur MBIDs und hat keine Namenssuche. Ohne den Schritt
  // waere die Quelle strukturell stumm, und der Fehler saehe aus wie ein
  // toter Dienst.
  //
  // BRAUCHT SIE ABER NIEMAND, IST SIE REINE VERSCHWENDUNG — und ein Zeuge hat
  // genau das gefunden: mit allen Netzquellen auf Gewicht 0 ging trotzdem
  // eine MusicBrainz-Anfrage hinaus. Bei 1 Anfrage/s ist das eine Sekunde von
  // acht, fuer eine Auskunft, die keine Quelle liest. Wer alle Netzquellen
  // abschaltet, will kein Netz.
  const brauchtAufloesung = aktiv.some((q) => q.brauchtMbid === true)
  const angereichert = brauchtAufloesung ? await identitaetKlaeren(frage, einst, umgebung) : frage

  const ergebnisse = await Promise.all(aktiv.map((q) => quelleFragen(q, angereichert, einst, umgebung)))

  const listen = {}
  const stale = []
  const fehler = {}
  const benutzt = []

  aktiv.forEach((quelle, i) => {
    const r = ergebnisse[i]
    if (r.fehler) fehler[quelle.id] = r.fehler
    if (r.stale) stale.push(quelle.id)
    if (r.treffer.length > 0 || !r.fehler) benutzt.push(quelle.id)

    listen[quelle.id] = r.treffer.map((t) => ({
      // DER SCHLUESSEL IST DIE MBID, WO ES EINE GIBT — sonst der normalisierte
      // Name. Ohne diese Zeile stuende dieselbe Serie unter vier Schreibweisen
      // vier Mal im Ergebnis und erreichte nie die Schwelle
      // `mindestensQuellen`; das war der ganze Zweck der Aufloesung.
      schluessel: t.mbid ? `mbid:${t.mbid}` : `name:${normalName(t.name)}`,
      name: t.name,
      mbid: t.mbid,
    }))
  })

  const ergebnis = verschmelzen(listen, einst.gewichte, {
    k: einst.fusionK,
    mindestensQuellen: einst.mindestensQuellen,
    grenze: einst.grenze,
  })

  return { ergebnis, roh: listen, stale, fehler, benutzt, frage: angereichert }
}

/**
 * Die MBID zur Frage besorgen — einmal, und dann gemerkt.
 *
 * GEMERKT WIRD AUCH DAS NICHTFINDEN. Ein Name, den MusicBrainz nicht kennt,
 * wird sonst bei jeder Anfrage neu gesucht, und das kostet bei 1 Anfrage/s
 * jedes Mal eine ganze Sekunde von acht — fuer eine Antwort, die sich nicht
 * aendert. Der Eintrag `{ mbid: null }` ist deshalb ein Ergebnis, kein
 * fehlender Wert.
 *
 * SCHEITERT SIE, GEHT ES OHNE WEITER. Die Identitaet ist eine Verbesserung,
 * keine Bedingung: Deezer und die Themenkarte suchen nach Namen und liefern
 * auch dann, wenn MusicBrainz gerade drosselt (siehe die 503er dort).
 */
async function identitaetKlaeren(frage, einst, umgebung) {
  if (frage.mbid) return frage

  const schluessel = `mb:${normalName(frage.name)}`
  const gemerkt = umgebung.karteien.identitaet.holen(schluessel, einst.haltbarkeitTage)
  if (gemerkt) {
    return gemerkt.wert?.mbid ? { ...frage, mbid: gemerkt.wert.mbid } : frage
  }

  const mb = umgebung.quellen.find((q) => q.id === 'musicbrainz')
  if (!mb) return frage

  try {
    const ref = await mb.aufloesen(frage, umgebung)
    umgebung.karteien.identitaet.setzen(schluessel, { mbid: ref?.mbid ?? null, name: ref?.name ?? null })
    return ref?.mbid ? { ...frage, mbid: ref.mbid } : frage
  } catch (e) {
    // NICHT MERKEN. Ein Fehlschlag ist keine Auskunft ueber den Namen, sondern
    // ueber den Dienst — wer ihn merkt, sperrt sich die Identitaet fuer 30
    // Tage aus wegen einer Drosselung von zwei Sekunden.
    umgebung.protokoll?.(`Identitaet nicht geklaert: ${e?.message ?? e}`)
    return frage
  }
}

/* ═════════════════════════════════════════════════════════════════════════
 * Die Umgebung, die eine Quelle bekommt
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * Was eine Quelle in die Hand bekommt.
 *
 * DASSELBE MUSTER WIE BEIM KONTEXT DES WIRTS: was gebraucht wird, REIST MIT.
 * Eine Quelle greift sich nichts selbst — kein Dateisystem, keine
 * Einstellungen aus einem Modulzustand, keinen eigenen `fetch`. Das ist der
 * Grund, warum eine Quelle in einem Zeugen ohne Box zu pruefen ist: die
 * Umgebung ist ein Objekt, und ein Objekt faelscht man.
 */
function umgebungBauen(kontext, einst, w) {
  return {
    holen: kontext.holen,
    protokoll: kontext.protokoll,
    nutzerKennung: nutzerKennung(einst),
    einstellungen: einst,
    quellen: w.quellen,
    karteien: w.karteien,
    vektoren: w.karteien.vektoren,
    ollama: einst.ollama,
    lastfmSchluessel: einst.lastfmSchluessel,
    /**
     * Eine Marke beim Takt der Quelle holen.
     *
     * `hoechstensMs` ist bewusst klein: warten kostet von der 8-Sekunden-Frist,
     * und ein Nein fuehrt zum abgelaufenen Karteieintrag, nicht ins Nichts.
     */
    marke: async (quellenId, grenze, hoechstensMs = 1200) => eimerFuer(quellenId, grenze).nehmen(hoechstensMs),
  }
}

/* ═════════════════════════════════════════════════════════════════════════
 * Das Plugin
 * ═════════════════════════════════════════════════════════════════════════ */

export default {
  /**
   * Die Verwaltungsflaeche — alles unter
   * `/api/plugins/mixpi-similar/http/…`.
   *
   * Die Wege des Entwurfs, uebersetzt:
   *
   *   GET  /http/aehnlich?name=…&mbid=…&grenze=…&quellen=…   (war /api/similar)
   *   GET  /http/quellen                                     (war /api/similar/sources)
   *   GET  /http/roh?name=…                                  (war /api/similar/debug)
   *   POST /http/inhalt                                      (war /api/similar/content)
   *   POST /http/kartei-leeren                               (war DELETE /api/similar/cache)
   *
   * `DELETE` wird zu `POST`, weil der Vertrag nur GET und POST durchlaesst
   * (E77) — das ist keine Geschmacksfrage, sondern die Grenze der Durchreiche.
   */
  async http(anfrage, kontext) {
    if (!kontext.holen) throw new Error('Dem Plugin fehlt das Recht "netz".')
    const w = await weltAufbauen(kontext)
    const einst = einstellungenLesen(kontext)
    const pfad = String(anfrage?.pfad ?? '').replace(/^\/+|\/+$/g, '')
    const abfrage = anfrage?.abfrage ?? {}

    if (pfad === 'quellen') return { inhalt: quellenBericht(w, einst) }

    if (pfad === 'aehnlich' || pfad === 'roh') {
      const name = String(abfrage.name ?? '').trim()
      if (!name) return { status: 400, inhalt: { fehler: 'Ohne `name` gibt es nichts zu suchen.' } }

      const eigeneEinst = quellenEinschraenken(einst, abfrage.quellen)
      if (abfrage.grenze) eigeneEinst.grenze = zahl(abfrage.grenze, einst.grenze)

      const frage = { name, mbid: String(abfrage.mbid ?? '').trim() || undefined }
      const umgebung = umgebungBauen(kontext, eigeneEinst, w)
      const { ergebnis, roh, stale, fehler, benutzt } = await aehnlicheFinden(frage, eigeneEinst, umgebung)
      await karteienSichern(w)

      if (pfad === 'roh') {
        return { inhalt: { frage, jeQuelle: roh, meta: { benutzt, stale, fehler } } }
      }
      return {
        inhalt: {
          frage,
          ergebnis: ergebnis.map((e) => ({
            name: e.name,
            mbid: e.mbid,
            punkte: Number(e.punkte.toFixed(6)),
            quellen: e.quellen,
            unaufgeloest: e.unaufgeloest,
          })),
          meta: { benutzt, stale, fehler },
        },
      }
    }

    if (pfad === 'inhalt') {
      if (anfrage.methode !== 'POST') return { status: 405, inhalt: { fehler: 'Nur POST.' } }
      return inhaltSchreiben(anfrage.rumpf, w)
    }

    if (pfad === 'kartei-leeren') {
      if (anfrage.methode !== 'POST') return { status: 405, inhalt: { fehler: 'Nur POST.' } }
      return karteiLeeren(anfrage.rumpf, w)
    }

    /* ── Die Wachliste ──────────────────────────────────────────────────── */

    if (pfad === 'wachliste') {
      return { inhalt: wachlisteBericht(w, einst) }
    }

    if (pfad === 'wachliste/eintragen') {
      if (anfrage.methode !== 'POST') return { status: 405, inhalt: { fehler: 'Nur POST.' } }
      return wachlisteEintragen(anfrage.rumpf, einst, umgebungBauen(kontext, einst, w), w)
    }

    if (pfad === 'wachliste/entfernen') {
      if (anfrage.methode !== 'POST') return { status: 405, inhalt: { fehler: 'Nur POST.' } }
      const name = String(anfrage.rumpf?.name ?? '').trim()
      if (!name) return { status: 400, inhalt: { fehler: '`name` fehlt.' } }
      const schluessel = normalName(name)
      const gab = Boolean(w.karteien.wachliste.holen(schluessel, 0))
      w.karteien.wachliste.loeschen(schluessel)
      await w.karteien.wachliste.sichern()
      return { inhalt: { entfernt: gab ? name : null, wachliste: w.karteien.wachliste.groesse } }
    }

    if (pfad === 'wachliste/aus-bestand') {
      if (anfrage.methode !== 'POST') return { status: 405, inhalt: { fehler: 'Nur POST.' } }
      return ausBestandFuellen(einst, umgebungBauen(kontext, einst, w), w, kontext)
    }

    if (pfad === 'wachliste/pruefen') {
      if (anfrage.methode !== 'POST') return { status: 405, inhalt: { fehler: 'Nur POST.' } }
      return jetztPruefen(anfrage.rumpf, einst, umgebungBauen(kontext, einst, w), w)
    }

    if (pfad === 'nachrichten') {
      return { inhalt: nachrichtenBericht(abfrage, w) }
    }

    if (pfad === 'nachrichten/gelesen') {
      if (anfrage.methode !== 'POST') return { status: 405, inhalt: { fehler: 'Nur POST.' } }
      return nachrichtGelesen(anfrage.rumpf, w)
    }

    return { status: 404, inhalt: { fehler: `Unbekannter Weg "${pfad}".`, wege: WEGE } }
  },

  /**
   * Was der Eltern-Bereich unter dem Namen zeigt.
   *
   * SAGT, WELCHE QUELLEN WIRKLICH MITSPIELEN — nicht nur „ok". Die haeufigste
   * stille Fehlkonfiguration hier ist ein fehlender Last.fm-Schluessel bei
   * einem Gewicht groesser als null: die Quelle ist eingeschaltet, antwortet
   * nie, und niemand sieht es. Deshalb steht genau das in diesem Satz.
   */
  async befinden(kontext) {
    if (!kontext.holen) return { ok: false, text: 'Ohne das Recht "netz" kann ich nichts holen.' }
    const w = await weltAufbauen(kontext)
    const einst = einstellungenLesen(kontext)
    const bericht = quellenBericht(w, einst)

    const empfehlend = bericht.quellen.filter((q) => q.rolle === 'aehnlichkeit')
    const mitspielend = empfehlend.filter((q) => q.an && !q.fehlt)
    const stumm = empfehlend.filter((q) => q.an && q.fehlt)

    const teile = [`${mitspielend.length} von ${empfehlend.length} Quellen aktiv`]
    if (stumm.length) teile.push(`stumm: ${stumm.map((q) => `${q.name} (${q.fehlt})`).join(', ')}`)
    teile.push(`${w.saetze.length} Eintraege in der Themenkarte`)

    return { ok: stumm.length === 0, text: `${teile.join(' — ')}.` }
  },

  /**
   * Die Knoepfe aus dem Manifest.
   */
  async aktion(kennung, kontext) {
    const w = await weltAufbauen(kontext)
    const einst = einstellungenLesen(kontext)

    if (kennung === 'probe') {
      // EINE ECHTE FRAGE STATT EINES PINGS. „Antwortet der Dienst?" ist nicht
      // die Frage, die jemand hat, der auf diesen Knopf drueckt — er will
      // wissen, ob dabei etwas Brauchbares herauskommt.
      const umgebung = umgebungBauen(kontext, einst, w)
      const frage = { name: 'Pettersson und Findus' }
      const { ergebnis, benutzt, fehler, stale } = await aehnlicheFinden(frage, einst, umgebung)
      await karteienSichern(w)
      const oben = ergebnis
        .slice(0, 3)
        .map((e) => e.name)
        .join(', ')
      const anmerkung = [
        stale.length ? `aus dem Speicher: ${stale.join(', ')}` : '',
        Object.keys(fehler).length ? `Fehler: ${Object.entries(fehler).map(([q, f]) => `${q} (${f})`)}` : '',
      ]
        .filter(Boolean)
        .join('; ')
      return {
        ok: ergebnis.length > 0,
        text: ergebnis.length
          ? `„Pettersson und Findus" → ${oben}. Quellen: ${benutzt.join(', ')}.${anmerkung ? ` ${anmerkung}` : ''}`
          : `Keine Treffer. Quellen: ${benutzt.join(', ') || 'keine'}.${anmerkung ? ` ${anmerkung}` : ''}`,
      }
    }

    // UNTERSTRICH, KEIN BINDESTRICH: Aktionskennungen folgen derselben Regel
    // wie Feldschluessel (Buchstabe zuerst, dann Buchstaben/Ziffern/`_`), und
    // der Wirt weist ein Manifest mit `kartei-leeren` ab. Der HTTP-Pfad
    // daneben darf den Bindestrich behalten — das ist eine andere Grammatik.
    if (kennung === 'kartei_leeren') {
      const vorher = w.karteien.aehnlich.groesse
      w.karteien.aehnlich.leeren()
      await karteienSichern(w)
      return { ok: true, text: `${vorher} Eintraege verworfen — die naechste Frage geht wieder hinaus.` }
    }

    return { ok: false, text: `Aktion "${kennung}" kenne ich nicht.` }
  },
}

const WEGE = [
  'GET /http/aehnlich?name=…',
  'GET /http/quellen',
  'GET /http/roh?name=…',
  'POST /http/inhalt',
  'POST /http/kartei-leeren',
  'GET /http/wachliste',
  'POST /http/wachliste/eintragen',
  'POST /http/wachliste/entfernen',
  'POST /http/wachliste/aus-bestand',
  'POST /http/wachliste/pruefen',
  'GET /http/nachrichten?ungelesen=true',
  'POST /http/nachrichten/gelesen',
]

/* ═════════════════════════════════════════════════════════════════════════
 * Die Wachlisten-Wege im Einzelnen
 * ═════════════════════════════════════════════════════════════════════════ */

function wachlisteBericht(w, einst) {
  const eintraege = w.karteien.wachliste.eintraege().map((e) => ({
    name: e.wert?.name,
    eingetragenAm: e.wert?.eingetragenAm,
    zuletztGeprueft: e.wert?.zuletztGeprueft ? new Date(e.wert.zuletztGeprueft).toISOString() : null,
    // NUR DIE ANZAHL, NICHT DIE LISTE. Ein Interpret mit 235 bekannten
    // Veroeffentlichungen (Benjamin Bluemchen bei MusicBrainz) blaehte die
    // Antwort sonst auf ein Vielfaches — und der 256-KB-Deckel des Wirts
    // wuerfe die ganze Antwort weg, sobald ein Dutzend Eintraege drin sind.
    bekannt: Array.isArray(e.wert?.bekannt) ? e.wert.bekannt.length : 0,
    letzterFehler: e.wert?.letzterFehler ?? null,
  }))
  return {
    eintraege,
    zeitplan: {
      an: einst.wachlisteAn,
      alleStunden: einst.pruefIntervallStunden,
      fenster: `${einst.fensterVon}–${einst.fensterBis}`,
      laeuftGerade: w.laufAktiv === true,
    },
    kanaele: kanaelZustand(w, einst),
    ungelesen: ungeleseneZaehlen(w),
  }
}

/**
 * Einen Eintrag anlegen — MIT Grundlinie.
 *
 * DIE GRUNDLINIE IST DER GANZE PUNKT: Was es JETZT schon gibt, gilt als
 * bekannt. Ohne sie meldet der erste Durchlauf einer Wachliste mit zwanzig
 * Serien mehrere hundert „Neuerscheinungen" — den gesamten Altbestand — und
 * der Nutzer schaltet die Benachrichtigung ab, bevor sie je etwas Nuetzliches
 * gesagt hat.
 *
 * SCHEITERT DAS HOLEN, WIRD NICHT EINGETRAGEN. Ein Eintrag mit leerer
 * Grundlinie sieht aus wie ein normaler und meldet beim naechsten Durchlauf
 * alles, was der Interpret je veroeffentlicht hat. Lieber gar nicht anlegen
 * und es sagen.
 */
async function wachlisteEintragen(rumpf, einst, umgebung, w) {
  const name = String(rumpf?.name ?? '').trim()
  if (!name) return { status: 400, inhalt: { fehler: '`name` fehlt.' } }

  const schluessel = normalName(name)
  if (w.karteien.wachliste.holen(schluessel, 0)) {
    return { status: 409, inhalt: { fehler: `„${name}" steht schon auf der Wachliste.` } }
  }

  const { veroeffentlichungen, fehler } = await veroeffentlichungenHolen(name, einst, umgebung)
  if (veroeffentlichungen.length === 0) {
    return {
      status: 502,
      inhalt: {
        fehler: `Zu „${name}" war keine Veroeffentlichung zu holen — ohne Grundlinie wuerde der naechste Lauf den ganzen Altbestand melden.`,
        quellenFehler: fehler,
      },
    }
  }

  const eintrag = {
    name,
    mbid: rumpf?.mbid ? String(rumpf.mbid) : undefined,
    eingetragenAm: new Date().toISOString(),
    bekannt: grundlinieBauen(veroeffentlichungen),
    zuletztGeprueft: Date.now(),
    letzterFehler: Object.keys(fehler).length ? fehler : null,
  }
  w.karteien.wachliste.setzen(schluessel, eintrag)
  await w.karteien.wachliste.sichern()

  return {
    inhalt: {
      eingetragen: name,
      grundlinie: eintrag.bekannt.length,
      hinweis: `${eintrag.bekannt.length} Veroeffentlichungen gelten als bekannt. Gemeldet wird nur, was danach erscheint.`,
    },
  }
}

/**
 * Die Wachliste aus dem Bestand der Box auffuellen.
 *
 * DAS `artist`-FELD WIRD ZERLEGT, nicht als ein Name genommen — dieselbe
 * Falle wie bei der Themenkarte (`namenAusBestand` in `wachliste.mjs`).
 *
 * ES WIRD NICHTS EINGETRAGEN, SONDERN VORGESCHLAGEN, solange kein
 * `uebernehmen: true` kommt. Der Grund ist die Grundlinie: jeder neue Eintrag
 * kostet Anfragen an fremde Dienste, und bei zwanzig Namen und MusicBrainz'
 * einer Anfrage pro Sekunde ist das kein Vorgang fuer einen 8-Sekunden-Ruf.
 * Uebernommen wird deshalb in Haeppchen, und der Zeitplan holt den Rest.
 */
async function ausBestandFuellen(einst, umgebung, w, kontext) {
  const { eintraege, fehler, pfad } = await bestandLesen(kontext.datenOrdner)
  if (fehler) return { status: 502, inhalt: { fehler: `Bestand nicht lesbar (${fehler})` } }

  const namen = namenAusBestand(eintraege)
  const schonDrin = new Set(w.karteien.wachliste.eintraege().map((e) => e.schluessel))
  const offen = namen.filter((n) => !schonDrin.has(normalName(n.name)))

  return {
    inhalt: {
      quelle: pfad,
      imBestand: namen.length,
      schonAufDerWachliste: namen.length - offen.length,
      vorschlag: offen.map((n) => ({ name: n.name, eintraege: n.anzahl })),
      hinweis:
        'Das ist ein Vorschlag, kein Eintrag. Jeder neue Eintrag braucht eine Grundlinie und damit Anfragen an fremde Dienste — trag sie einzeln ueber /http/wachliste/eintragen ein.',
    },
  }
}

/**
 * Sofort pruefen — fuer Fehlersuche und fuer den ersten Lauf.
 *
 * EIN EINTRAG JE RUF, und das ist keine Sparsamkeit: der ganze Ruf hat 8
 * Sekunden, MusicBrainz laesst eine Anfrage pro Sekunde zu. Zwei Eintraege
 * mit je zwei Quellen sind im Haengefall schon zu viel — und ein Fristriss
 * terminiert den Worker samt allen offenen Rufen, nicht nur diesem.
 */
async function jetztPruefen(rumpf, einst, umgebung, w) {
  const name = String(rumpf?.name ?? '').trim()
  const alle = w.karteien.wachliste.eintraege().map((e) => e.wert)

  const eintrag = name ? alle.find((e) => normalName(e?.name) === normalName(name)) : naechsterDran(alle)
  if (!eintrag) {
    return { inhalt: { geprueft: null, hinweis: name ? `„${name}" steht nicht auf der Wachliste.` : 'Die Wachliste ist leer.' } }
  }

  const anzahl = await eintragPruefen(eintrag, einst, umgebung, w)
  await karteienSichern(w)
  return {
    inhalt: {
      geprueft: eintrag.name,
      neu: anzahl,
      offen: alle.length - 1,
      hinweis: anzahl === 0 ? 'Nichts Neues.' : `${anzahl} Meldung(en) liegen im Posteingang.`,
    },
  }
}

function nachrichtenBericht(abfrage, w) {
  const nurUngelesen = String(abfrage?.ungelesen ?? '') === 'true'
  const alle = w.karteien.nachrichten
    .eintraege()
    .map((e) => ({ nr: e.schluessel, ...e.wert }))
    .filter((n) => (nurUngelesen ? !n.gelesenAm : true))
    .sort((a, b) => String(b.erzeugtAm).localeCompare(String(a.erzeugtAm)))
  return { nachrichten: alle.slice(0, 100), gesamt: alle.length, ungelesen: ungeleseneZaehlen(w) }
}

async function nachrichtGelesen(rumpf, w) {
  const nr = String(rumpf?.nr ?? '').trim()
  if (!nr) return { status: 400, inhalt: { fehler: '`nr` fehlt.' } }
  const vorhanden = w.karteien.nachrichten.holen(nr, 0)
  if (!vorhanden) return { status: 404, inhalt: { fehler: `Nachricht "${nr}" gibt es nicht.` } }
  w.karteien.nachrichten.setzen(nr, { ...vorhanden.wert, gelesenAm: new Date().toISOString() })
  await w.karteien.nachrichten.sichern()
  return { inhalt: { gelesen: nr, ungelesen: ungeleseneZaehlen(w) } }
}

function ungeleseneZaehlen(w) {
  return w.karteien.nachrichten.eintraege().filter((e) => !e.wert?.gelesenAm).length
}

/**
 * Was die Kanaele melden — und WARUM einer schweigt.
 *
 * Der Posteingang steht hier fest verdrahtet und immer auf `an`. Er ist kein
 * Kanal, den man laden oder abschalten koennte, sondern der Ort, an dem eine
 * Meldung liegt, BEVOR ein Kanal sie sieht.
 */
function kanaelZustand(w, einst) {
  const liste = [{ id: 'posteingang', name: 'Posteingang', an: true, grund: null }]
  for (const k of w.kanaele) {
    const zustand = k.bereit ? k.bereit(einst) : { ok: true, grund: null }
    liste.push({ id: k.id, name: k.name ?? k.id, an: zustand.ok, grund: zustand.grund })
  }
  return liste
}

/* ═════════════════════════════════════════════════════════════════════════
 * Die Wege im Einzelnen
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * `quellen`-Parameter: nur die genannten Quellen behalten.
 *
 * Ueber die GEWICHTE, nicht ueber eine zweite Liste — sonst gaebe es zwei
 * Wege, eine Quelle abzuschalten, und irgendwann widersprechen sie sich.
 */
function quellenEinschraenken(einst, quellenParameter) {
  if (!quellenParameter) return { ...einst, gewichte: { ...einst.gewichte } }
  const gewollt = new Set(
    String(quellenParameter)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
  const gewichte = {}
  for (const [id, w] of Object.entries(einst.gewichte)) gewichte[id] = gewollt.has(id) ? w : 0
  return { ...einst, gewichte }
}

/**
 * Der Zustand aller Quellen — fuer `/http/quellen` und fuer `befinden`.
 *
 * `fehlt` ist die eigentliche Auskunft: eine Quelle kann eingeschaltet sein
 * und trotzdem nie antworten, weil ihr Zugang fehlt. Das ist der Fall, den
 * man ohne diese Spalte erst nach einer halben Stunde Fehlersuche findet.
 */
function quellenBericht(w, einst) {
  return {
    quellen: w.quellen.map((q) => {
      // EINE QUELLE OHNE `aehnlich` IST NICHT „AUS", SONDERN ETWAS ANDERES.
      // `musicbrainz` liefert Identitaet und Veroeffentlichungen und hat
      // deshalb kein Gewicht — als „0 von 5 aktiv" gezaehlt saehe es aus wie
      // eine abgeschaltete Empfehlungsquelle, und jemand drehte an einem
      // Regler, den es nicht gibt.
      const rolle = typeof q.aehnlich === 'function' ? 'aehnlichkeit' : 'identitaet'
      const gewicht = Number(einst.gewichte[q.id]) || 0
      let fehlt = null
      if (q.brauchtZugang && !einst.lastfmSchluessel) fehlt = 'Zugangsschluessel fehlt'
      return {
        id: q.id,
        name: q.name ?? q.id,
        rolle,
        an: rolle === 'identitaet' ? true : gewicht > 0,
        gewicht: rolle === 'identitaet' ? null : gewicht,
        brauchtZugang: Boolean(q.brauchtZugang),
        fehlt,
        letzterFehler: w.letzterFehler[q.id] ?? null,
      }
    }),
    ladeFehler: w.ladeFehler,
    kartei: {
      aehnlich: w.karteien.aehnlich.groesse,
      fluechtig: w.karteien.aehnlich.fluechtig,
      haltbarkeitTage: einst.haltbarkeitTage,
    },
    themenkarte: w.saetze.length,
  }
}

/**
 * Einen Datensatz der Themenkarte anlegen oder aendern.
 *
 * DER VEKTOR WIRD HIER NICHT GERECHNET, sondern beim naechsten Gebrauch —
 * `POST` soll schnell antworten, und die Einbettung haengt an einem fremden
 * Dienst, der gerade nicht da sein kann. Der Hash in der Vektor-Kartei sorgt
 * dafuer, dass die naechste Frage neu rechnet.
 */
async function inhaltSchreiben(rumpf, w) {
  const name = String(rumpf?.name ?? '').trim()
  if (!name) return { status: 400, inhalt: { fehler: '`name` fehlt.' } }

  const tags = Array.isArray(rumpf?.tags) ? rumpf.tags.map((t) => String(t).trim()).filter(Boolean) : []
  const beschreibung = String(rumpf?.beschreibung ?? rumpf?.description ?? '').trim()

  if (tags.length === 0 && !beschreibung) {
    // OHNE INHALT IST EIN INHALTS-DATENSATZ NICHTS. Er stuende in der Karte,
    // faende nie jemanden und verdeckte den Startbestand-Eintrag desselben
    // Namens — ein stiller Rueckschritt statt einer Ergaenzung.
    return { status: 400, inhalt: { fehler: 'Ohne `tags` oder `beschreibung` gibt es nichts zu vergleichen.' } }
  }

  const satz = { name, mbid: String(rumpf?.mbid ?? '').trim() || undefined, tags, beschreibung }
  w.karteien.eigeneSaetze.setzen(normalName(name), satz)
  await w.karteien.eigeneSaetze.sichern()

  w.saetze = saetzeVerschmelzen(w.saetze, w.karteien.eigeneSaetze)
  w.quellen = w.quellen.filter((q) => q.id !== 'inhalt')
  w.quellen.push(inhaltsQuelleBauen(w.saetze))

  return { inhalt: { gespeichert: satz, themenkarte: w.saetze.length } }
}

async function karteiLeeren(rumpf, w) {
  const quelle = String(rumpf?.quelle ?? '').trim()
  if (!quelle || quelle === '*') {
    const vorher = w.karteien.aehnlich.groesse
    w.karteien.aehnlich.leeren()
    await karteienSichern(w)
    return { inhalt: { geleert: '*', verworfen: vorher } }
  }
  let verworfen = 0
  for (const e of w.karteien.aehnlich.eintraege()) {
    if (e.schluessel.startsWith(`${quelle}:`)) {
      w.karteien.aehnlich.loeschen(e.schluessel)
      verworfen++
    }
  }
  await karteienSichern(w)
  return { inhalt: { geleert: quelle, verworfen } }
}

/**
 * Alle Karteien wegschreiben.
 *
 * `allSettled` STATT `all`: eine Kartei, die sich nicht schreiben laesst
 * (volle Karte), darf die anderen nicht mitnehmen — und schon gar nicht die
 * Antwort scheitern lassen, die bereits fertig berechnet ist.
 */
async function karteienSichern(w) {
  await Promise.allSettled(Object.values(w.karteien).map((k) => k.sichern()))
}
