/**
 * MEDIATHEKEN — ZDF, KiKA, 3sat, arte, funk und die ARD-Anstalten auf einmal.
 *
 * ══ WARUM ES DIESES PLUGIN NEBEN mixpi-mediathek GIBT ═══════════════════════
 *
 * Betreiber am 20.09.2026: „video feature ausbauen kann man noch von weiteren
 * quellen videos beziehen ? zdf, youtube, netflix was ist moeglich". Die
 * Antwort steht im Wissenspaket unter `videoquellen-jenseits-der-ard`; das
 * Kurze davon: Netflix nie (Widevine), YouTube nur eingebettet mit Werbung vor
 * dem Kinderschirm — und die oeffentlich-rechtlichen Mediatheken liefern
 * progressive MP4-Adressen, die ein `<video>` ohne Bibliothek nimmt.
 *
 * FUENF EIGENE SCHNITTSTELLEN WAEREN FUENF FEHLERQUELLEN. `api.zdf.de` will
 * einen `apiToken`, der aus der Webseite gepflueckt werden muss und bei jedem
 * Umbau der ZDF-Seite bricht. Der Suchdienst von MediathekView kennt sie ALLE
 * und nennt die MP4-Adresse bereits im Suchergebnis — eine fremde
 * Schnittstelle statt fuenf.
 *
 * ══ DIESELBE TEILUNG WIE NEBENAN: PLUGIN WEISS, KERN ZAEHLT ════════════════
 *
 * Es sucht und loest auf. Es zaehlt nichts und entscheidet nichts — welches
 * Video fuer welches Profil freigegeben ist und wie oft es noch laufen darf,
 * steht in `src/backend-api/src/videofreigabe.ts`. Der Kern erreicht dieses
 * Plugin ueber das Feld `quelle` einer Freigabe.
 *
 * Kein `aufloesen()`, kein `suchen()`, kein Recht `medienquelle`: beides
 * fuehrte in den TON-Weg mit `mpv --no-video`, also zu einer Tonspur ohne
 * Bild. Der Bildweg ist der Kiosk-Browser.
 *
 * ══ DREI DINGE, DIE HIER ANDERS SIND ALS IN mixpi-mediathek ════════════════
 *
 *   KEINE BILDER. Der Suchdienst fuehrt kein Bildfeld — keines, das leer ist,
 *   sondern gar keines. Die Kacheln der Elternflaeche bleiben deshalb ohne
 *   Vorschau. `videofreigabe.ts` kennt das: „eine Freigabe ohne Bild ist eine
 *   Freigabe, eine ohne Kennung ist keine".
 *
 *   KEINE KENNUNG ZUM NACHSCHLAGEN. Jeder Eintrag TRAEGT eine (`id`, base64
 *   eines Hashes) — aber der Dienst durchsucht dieses Feld nicht. GEMESSEN am
 *   20.09.2026: `fields:["id"]` mit genau dieser Kennung liefert null Treffer.
 *   Deshalb ist die Kennung dieses Plugins der SUCHWEG ZURUECK und nicht die
 *   fremde Nummer: base64url von Sender, Sendung und Titel.
 *
 *   HOEHE STATT BREITE. mixpi-mediathek deckelt die BREITE, weil die ARD
 *   `maxHResolutionPx` mitliefert. Hier steht keine Aufloesung irgendwo — nur
 *   manchmal im Dateinamen (`…_AVC-720.mp4`), und der nennt die HOEHE.
 *
 * ══ KEINE ABHAENGIGKEITEN ═══════════════════════════════════════════════════
 * Wie jedes Plugin dieses Hauses: kein `npm install`, kein Bauschritt.
 */

/** Der oeffentliche Suchdienst von MediathekView. Gemessen am 20.09.2026. */
const TOR = 'https://mediathekviewweb.de/api/query'

/**
 * WIE HOCH DAS BILD HOECHSTENS SEIN DARF.
 *
 * Der Schirm der Box ist 800x480. 720p (1280x720) verkleinert sich darauf
 * sauber, und der Pi 5 dekodiert H.264 in Software — DIESE GRENZE IST NICHT
 * GEMESSEN, sondern gesetzt. Wer sie nachmessen will, dreht `?hoehe=` und
 * sieht am Geraet nach, statt diese Zeile zu aendern.
 */
const HOEHE_DECKEL = 720

/** Wie viele Treffer eine Suche hoechstens meldet (Deckel der Antwort: 256 KB). */
const TREFFER_GRENZE = 24

/**
 * Wie lang die Kennung hoechstens werden darf.
 *
 * Sie wandert in eine Freigabe, und `freigabeNormalisieren` im Kern verwirft
 * alles ueber 512 Zeichen. Ein Treffer, dessen Kennung darueber laege, faellt
 * lieber HIER weg — sonst sieht das Elternteil eine Kachel, deren Knopf
 * kommentarlos nichts tut.
 */
const KENNUNG_GRENZE = 512

/**
 * Das Trennzeichen in der Kennung: Zeichen 31 (unit separator).
 *
 * Es steht als `fromCharCode` da und nicht als Escape im Quelltext, weil ein
 * Steuerzeichen, das man SIEHT, in jedem Werkzeug anders aussieht — und weil
 * ein Escape beim Schreiben der Datei schon einmal zum echten Byte geworden
 * ist, statt als Escape dazustehen. Kein Sendungstitel enthaelt es.
 */
const TRENN = String.fromCharCode(31)

/* ══ DIE REGELN — reine Funktionen, exportiert, damit sie Zeugen haben ══════ */

/**
 * Sender, Sendung und Titel zu EINER Kennung — und zurueck.
 *
 * WARUM ALLE DREI: GEMESSEN am 20.09.2026 liegt dieselbe Maus-Folge unter ZWEI
 * Sendern (KiKA als `AVC-540`, WDR als `AVC-720`, gleiche Datei-UUID). Ohne
 * den Sender waere die Kennung zweideutig, und welche Fassung laeuft,
 * entschiede die Reihenfolge der Antwort.
 *
 * base64url, weil `freigabeNormalisieren` im Kern nur `[A-Za-z0-9+/=_-]`
 * durchlaesst — die Kennung steht spaeter in einem Pfad.
 */
export function kennungAus(sender, sendung, titel) {
  const roh = [sender ?? '', sendung ?? '', titel ?? ''].map((s) => String(s).trim()).join(TRENN)
  return Buffer.from(roh, 'utf8').toString('base64url')
}

/** Eine Kennung zurueck in ihre drei Teile — oder `null`, wenn sie keine ist. */
export function kennungLesen(kennung) {
  const s = String(kennung ?? '').trim()
  if (!s || !/^[A-Za-z0-9_=-]+$/.test(s)) return null
  let roh
  try {
    roh = Buffer.from(s, 'base64url').toString('utf8')
  } catch {
    return null
  }
  const teile = roh.split(TRENN)
  if (teile.length !== 3) return null
  const [sender, sendung, titel] = teile
  // OHNE TITEL GIBT ES KEINEN WEG ZURUECK: gesucht wird nach ihm. Sender und
  // Sendung duerfen leer sein (manche Eintraege fuehren keine Sendung).
  if (!titel) return null
  return { sender, sendung, titel }
}

/**
 * Ist das eine NEBENFASSUNG derselben Folge?
 *
 * Dieselbe Sperrliste wie in mixpi-mediathek, und aus demselben Grund: die
 * Suche nach „Maus" liefert die Folge dreimal (normal, Audiodeskription,
 * Gebaerdensprache). Fuer ein Elternteil, das eine Belohnung aussucht, sind
 * das drei gleich aussehende Zeilen.
 */
export function nebenfassung(name) {
  return /\((?:audiodeskription|mit geb(?:ä|ae)rdensprache|geb(?:ä|ae)rdensprache|h(?:ö|oe)rfassung|klare sprache)\)\s*$/i.test(
    String(name ?? '').trim(),
  )
}

/**
 * Die Form einer Adresse — MP4 oder nicht.
 *
 * GEMESSEN am 20.09.2026: SRF und ORF liefern ueber diesen Dienst
 * ausschliesslich HLS (`.m3u8`). Chromium spielt das nicht von sich aus; eine
 * solche Kachel waere ein schwarzer Schirm mit Abspielzeichen. Sie faellt
 * deshalb schon in der SUCHE weg, nicht erst beim Start — was gar nicht erst
 * freigegeben werden kann, enttaeuscht auch niemanden.
 */
export function istMp4(adresse) {
  const s = String(adresse ?? '')
    .split('?')[0]
    .toLowerCase()
  return s.startsWith('http') && s.endsWith('.mp4')
}

/**
 * Die Hoehe aus einem Dateinamen — oder 0, wenn er keine nennt.
 *
 * ZWEI FORMEN AM ECHTEN DIENST GEMESSEN (20.09.2026):
 *     …_AVC-720.mp4        die ARD-Anstalten und KiKA   -> 720
 *     …_960x540.mp4        aeltere ARD-Ablagen          -> 540
 *     …_3360k_p36v17.mp4   ZDF und 3sat                 -> 0 (nennt keine)
 *
 * DIE NULL IST EIN ERGEBNIS, KEIN FEHLER: sie fuehrt in `besteAdresse` zur
 * mittleren Stufe. Geraten wird hier nichts — ein `p36` in eine Hoehe
 * umzurechnen waere eine Tabelle, die niemand pflegt.
 */
export function hoeheAus(adresse) {
  const name =
    String(adresse ?? '')
      .split('?')[0]
      .split('/')
      .pop() ?? ''
  const mitBreite = /[_-](\d{3,4})x(\d{3,4})[._-]/i.exec(name)
  if (mitBreite) return Number(mitBreite[2])
  const avc = /avc[_-](\d{3,4})[._-]/i.exec(name)
  if (avc) return Number(avc[1])
  const p = /[_-](\d{3,4})p[._-]/i.exec(name)
  if (p) return Number(p[1])
  return 0
}

/**
 * Welche der drei angebotenen Stufen genommen wird.
 *
 * DER DIENST NENNT DREI ADRESSEN UND KEINE AUFLOESUNG: `url_video_low`,
 * `url_video`, `url_video_hd`. Was dahinter steckt, steht bestenfalls im
 * Dateinamen (siehe `hoeheAus`).
 *
 *   IST DIE HOEHE LESBAR, gilt dieselbe Regel wie nebenan: die groesste
 *   Stufe, die den Deckel nicht reisst; gibt es keine darunter, die
 *   kleinste ueberhaupt.
 *
 *   IST SIE NICHT LESBAR, gilt die MITTLERE STUFE. Das ist die Sendefassung —
 *   bei allen am 20.09.2026 gemessenen Sendern liegt `url_video` zwischen den
 *   beiden anderen. Es ist eine ANNAHME und steht hier, damit sie auffaellt;
 *   `?stufe=klein|mittel|gross` haengt daneben, damit man sie am Geraet
 *   widerlegen kann, ohne diese Datei zu aendern.
 */
export function besteAdresse(eintrag, deckel = HOEHE_DECKEL, wunsch = '') {
  const slots = [
    { name: 'klein', adresse: eintrag?.url_video_low },
    { name: 'mittel', adresse: eintrag?.url_video },
    { name: 'gross', adresse: eintrag?.url_video_hd },
  ]
    .map((s) => ({ ...s, adresse: String(s.adresse ?? '').trim() }))
    .filter((s) => istMp4(s.adresse))
  if (!slots.length) return null

  if (wunsch) {
    const gewuenscht = slots.find((s) => s.name === wunsch)
    if (gewuenscht) return { adresse: gewuenscht.adresse, hoehe: hoeheAus(gewuenscht.adresse), stufe: gewuenscht.name }
  }

  const mitHoehe = slots.map((s) => ({ ...s, hoehe: hoeheAus(s.adresse) })).filter((s) => s.hoehe > 0)
  if (!mitHoehe.length) {
    const mittel = slots.find((s) => s.name === 'mittel') ?? slots[0]
    return { adresse: mittel.adresse, hoehe: 0, stufe: mittel.name }
  }
  const passend = mitHoehe.filter((s) => s.hoehe <= deckel)
  const gewaehlt = passend.length
    ? passend.reduce((a, b) => (b.hoehe > a.hoehe ? b : a))
    : mitHoehe.reduce((a, b) => (b.hoehe < a.hoehe ? b : a))
  // `name` UND NICHT `stufe`: die Slots heissen oben `name`. Der erste Wurf
  // schrieb hier `gewaehlt.stufe` und lieferte still `undefined` — den Zeugen
  // fiel es nicht auf, weil sie die Stufe nur in den beiden anderen Zweigen
  // lasen. Gefunden hat es tools/mediathekview-probe.mjs am echten Dienst.
  return { adresse: gewaehlt.adresse, hoehe: gewaehlt.hoehe, stufe: gewaehlt.name }
}

/**
 * Ein roher Eintrag des Dienstes -> ein Treffer fuer die Elternflaeche.
 *
 * `null` heisst: taugt nicht als Belohnung. Vier Gruende, alle stumm, weil
 * eine Trefferliste mit Begruendungen fuer Ausgelassenes niemandem hilft.
 */
export function trefferAus(roh, deckel = HOEHE_DECKEL) {
  const titel = String(roh?.title ?? '').trim()
  if (!titel) return null
  if (nebenfassung(titel)) return null
  const quelle = besteAdresse(roh, deckel)
  if (!quelle) return null // nur HLS (SRF, ORF) oder gar nichts
  const sender = String(roh?.channel ?? '').trim()
  const sendung = String(roh?.topic ?? '').trim()
  const kennung = kennungAus(sender, sendung, titel)
  if (kennung.length > KENNUNG_GRENZE) return null
  const eintrag = {
    kennung,
    name: titel,
    sendung: sendung || sender,
    sender,
    // KEIN `kinderinhalt`: der Dienst fuehrt kein solches Merkmal. Es hier zu
    // erfinden (etwa „Sender ist KiKA") waere eine Zusicherung, die niemand
    // haelt — die Elternflaeche liest lieber gar nichts als etwas Falsches.
    kinderinhalt: false,
  }
  const dauer = Number(roh?.duration)
  if (Number.isFinite(dauer) && dauer > 0) eintrag.dauerSek = Math.floor(dauer)
  return eintrag
}

/** Die rohe Antwort des Dienstes -> Trefferliste. */
export function trefferListe(rumpf, anzahl = TREFFER_GRENZE, deckel = HOEHE_DECKEL) {
  const raus = []
  const gesehen = new Set()
  for (const roh of rumpf?.result?.results ?? []) {
    const t = trefferAus(roh, deckel)
    if (!t) continue
    // DUBLETTEN AUF DER KENNUNG: derselbe Sender mit derselben Folge zweimal
    // (der Dienst fuehrt Wiederholungen einzeln). Die erste gilt.
    if (gesehen.has(t.kennung)) continue
    gesehen.add(t.kennung)
    raus.push(t)
    if (raus.length >= anzahl) break
  }
  return raus
}

/**
 * Den EINEN Eintrag zu einer Kennung aus einer Antwort fischen.
 *
 * DER DIENST KANN NICHT NACH DER KENNUNG SUCHEN (siehe Kopf), also wird nach
 * dem Titel gesucht und HIER genau verglichen. Der Vergleich ist streng auf
 * allen drei Teilen — eine Folge, deren Titel sich geaendert hat, gilt als
 * verschwunden. Das ist die richtige Richtung: lieber „gibt es nicht mehr" mit
 * Grund als heimlich ein anderes Video.
 *
 * MEHRERE TREFFER: der NEUESTE gewinnt. Eine Wiederholung derselben Folge ist
 * derselbe Inhalt, und die juengere Ablage lebt laenger.
 */
export function eintragFinden(rumpf, teile) {
  let beste = null
  for (const roh of rumpf?.result?.results ?? []) {
    if (String(roh?.title ?? '').trim() !== teile.titel) continue
    if (String(roh?.topic ?? '').trim() !== teile.sendung) continue
    if (String(roh?.channel ?? '').trim() !== teile.sender) continue
    const zeit = Number(roh?.timestamp) || 0
    if (!beste || zeit > (Number(beste.timestamp) || 0)) beste = roh
  }
  return beste
}

/**
 * Ein gefundener Eintrag -> alles, was der Kern ueber dieses Video braucht.
 *
 * WIRFT NICHT, SONDERN MELDET `{ ok: false, grund }` — wie nebenan. Ein
 * geworfener Fehler waere eine Zeile im Journal; der Grund soll bis vor das
 * Kind kommen.
 */
export function videoAus(eintrag, teile, deckel = HOEHE_DECKEL, wunsch = '') {
  if (!eintrag) return { ok: false, grund: 'nicht mehr in der Mediathek' }
  const quelle = besteAdresse(eintrag, deckel, wunsch)
  if (!quelle) return { ok: false, grund: 'keine abspielbare Fassung gefunden' }
  const video = {
    ok: true,
    kennung: kennungAus(teile.sender, teile.sendung, teile.titel),
    name: teile.titel,
    sendung: teile.sendung || teile.sender,
    sender: teile.sender,
    kinderinhalt: false,
    quelle,
  }
  const dauer = Number(eintrag.duration)
  if (Number.isFinite(dauer) && dauer > 0) video.dauerSek = Math.floor(dauer)
  const text = String(eintrag.description ?? '').trim()
  if (text) video.beschreibung = text.slice(0, 600)
  return video
}

/** Eine Zahl aus der Abfrage, mit Grenzen und Vorgabe. */
export function zahlAus(roh, vorgabe, klein, gross) {
  const n = Number(roh)
  if (!Number.isFinite(n)) return vorgabe
  return Math.min(gross, Math.max(klein, Math.floor(n)))
}

/** Nur die drei Namen sind Stufen; alles andere heisst „keine Vorgabe". */
export function stufeAus(roh) {
  const s = String(roh ?? '')
    .trim()
    .toLowerCase()
  return s === 'klein' || s === 'mittel' || s === 'gross' ? s : ''
}

/* ══ DER NETZWEG ════════════════════════════════════════════════════════════ */

/**
 * Die Anfrage an den Suchdienst.
 *
 * `future: false` laesst Ankuendigungen weg — was noch nicht gesendet wurde,
 * hat keine Datei, und eine Belohnung, die erst naechsten Sonntag existiert,
 * ist keine.
 */
export function anfrageBauen(felder, begriff, anzahl) {
  return {
    queries: [{ fields: felder, query: begriff }],
    sortBy: 'timestamp',
    sortOrder: 'desc',
    future: false,
    offset: 0,
    size: anzahl,
  }
}

/**
 * WARUM `Content-Type: text/plain` UND KEIN JSON.
 *
 * GEMESSEN am 20.09.2026: mit `application/json` antwortet der Dienst 400. Der
 * Rumpf IST JSON — nur der Kopf muss luegen. Wer das nicht weiss, haelt den
 * Dienst fuer kaputt und sucht den Fehler bei sich.
 */
async function fragen(kontext, rumpf) {
  if (!kontext.holen) throw new Error('Dem Plugin fehlt das Recht "netz" in plugin.json.')
  const antwort = await kontext.holen(TOR, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', accept: 'application/json' },
    body: JSON.stringify(rumpf),
  })
  if (!antwort.ok) throw new Error(`Der Suchdienst antwortet mit ${antwort.status}`)
  const inhalt = await antwort.json()
  if (inhalt?.err) throw new Error(String(inhalt.err))
  return inhalt
}

export default {
  /**
   * Die freie Flaeche — zwei Wege, und beide nur lesend.
   *
   *   GET suche?begriff=…&anzahl=…&hoehe=…     Treffer fuer die Elternflaeche
   *   GET video/<kennung>?hoehe=…&stufe=…      eine abspielbare Adresse
   *
   * `video/<kennung>` RUFT AUCH DER KERN, und zwar erst, wenn die Freigabe
   * steht. Die Adresse wird bei JEDEM Start frisch geholt: die Sender ziehen
   * Folgen zurueck, und zwischen Freigabe und Anschauen liegen Tage.
   */
  async http(anfrage, kontext) {
    const pfad = String(anfrage?.pfad ?? '').replace(/^\/+/, '')
    const abfrage = anfrage?.abfrage ?? {}

    if (anfrage?.methode !== 'GET') {
      return { status: 405, inhalt: { fehler: 'nur GET' } }
    }

    if (pfad === 'suche') {
      const begriff = String(abfrage.begriff ?? '').trim()
      if (begriff.length < 2) return { status: 400, inhalt: { fehler: 'begriff fehlt (mindestens zwei Zeichen)' } }
      const anzahl = zahlAus(abfrage.anzahl, 12, 1, TREFFER_GRENZE)
      const deckel = zahlAus(abfrage.hoehe, HOEHE_DECKEL, 180, 2160)
      try {
        // MEHR HOLEN ALS ZEIGEN: Nebenfassungen und HLS-Eintraege fallen erst
        // hier weg, und eine Suche, die sechs von zwoelf aussortiert, soll
        // trotzdem zwoelf zeigen.
        const rumpf = await fragen(kontext, anfrageBauen(['topic', 'title'], begriff, Math.min(60, anzahl * 3)))
        return { inhalt: { treffer: trefferListe(rumpf, anzahl, deckel) } }
      } catch (f) {
        return { status: 502, inhalt: { fehler: f.message } }
      }
    }

    if (pfad.startsWith('video/')) {
      const kennung = decodeURIComponent(pfad.slice('video/'.length)).trim()
      const teile = kennungLesen(kennung)
      if (!teile) return { status: 400, inhalt: { fehler: 'kennung fehlt oder ist keine' } }
      const deckel = zahlAus(abfrage.hoehe, HOEHE_DECKEL, 180, 2160)
      const wunsch = stufeAus(abfrage.stufe)
      try {
        // GESUCHT WIRD NACH DEM TITEL, verglichen wird auf allen drei Teilen
        // (siehe `eintragFinden`). Der Titel ist der einzige Weg zurueck.
        const rumpf = await fragen(kontext, anfrageBauen(['title'], teile.titel, 30))
        const video = videoAus(eintragFinden(rumpf, teile), teile, deckel, wunsch)
        if (!video.ok) return { status: 404, inhalt: video }
        return { inhalt: video }
      } catch (f) {
        return { status: 502, inhalt: { fehler: f.message } }
      }
    }

    return { status: 404, inhalt: { fehler: `unbekannter Pfad "${pfad}" — es gibt suche und video/<kennung>` } }
  },

  /** Geht es dir gut? Steht in der Verwaltung unter „Erweiterungen". */
  async befinden(kontext) {
    if (!kontext.holen) return { ok: false, text: 'Recht "netz" fehlt' }
    return { ok: true, text: 'bereit — Suche und Auflösung über mediathekviewweb.de' }
  },

  /** Der Knopf aus der Verwaltung: antwortet der Dienst, und wie schnell? */
  async aktion(kennung, kontext) {
    if (kennung !== 'pruefen') return { ok: false, text: `unbekannte Aktion "${kennung}"` }
    if (!kontext.holen) return { ok: false, text: 'Recht "netz" fehlt' }
    const ab = Date.now()
    try {
      const rumpf = await fragen(kontext, anfrageBauen(['topic', 'title'], 'Maus', 5))
      const ms = Date.now() - ab
      const n = trefferListe(rumpf).length
      return { ok: n > 0, text: `Suchdienst antwortet in ${ms} ms, ${n} spielbare Treffer auf „Maus“` }
    } catch (f) {
      return { ok: false, text: `Suchdienst nicht erreichbar: ${f.message}` }
    }
  },
}
