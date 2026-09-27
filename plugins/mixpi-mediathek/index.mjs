/**
 * ARD MEDIATHEK — das Wissen ueber die Mediathek, und NUR das.
 *
 * ══ WAS DIESES PLUGIN IST ═══════════════════════════════════════════════════
 *
 * Es ist die eine Haelfte der Belohnungs-Videos (Betreiber, 20.09.2026:
 * „ard videos einzelne videos freischalten mit abspiel haeufigkeit es soll
 * quasi eine belohnung sein"). Die Arbeitsteilung ist dieselbe wie bei den
 * Engine-Plugins — PLUGIN ZEIGT, KERN SCHALTET:
 *
 *   DIESES PLUGIN WEISS, was die ARD hat: es sucht, es loest eine Kennung zu
 *   einer abspielbaren MP4-Adresse auf, es nennt Titel, Bild, Dauer und bis
 *   wann etwas verfuegbar ist. Es zaehlt NICHTS und es entscheidet NICHTS.
 *
 *   DER KERN FUEHRT BUCH: welche Videos fuer welches Profil freigegeben sind,
 *   wie oft sie noch laufen duerfen, und ob ein Start erlaubt ist. Das steht
 *   in `src/backend-api/src/videofreigabe.ts` und den Routen daneben.
 *
 * WARUM NICHT ALLES HIER: die `http()`-Routen eines Plugins liegen hinter dem
 * Tor der Verwaltung (plugins/README.md, „Was NICHT geht"). Der Kinderschirm
 * erreicht sie nicht — und das ist Absicht, denn ein Zaehler, den die Seite
 * des Kindes selbst fuehrt, ist kein Zaehler. Der Kern fragt dieses Plugin
 * stellvertretend, und zwar erst, NACHDEM er die Freigabe geprueft hat.
 *
 * ══ WARUM ES KEIN `aufloesen()` HAT ═════════════════════════════════════════
 *
 * `aufloesen()` fuehrt nach `spielweg.ts`, also in den TON-Weg mit mpv
 * (`--no-video`, siehe mpv-wrapper.ts). Ein Video dort hineinzugeben ergaebe
 * eine Tonspur ohne Bild — genau das, was der Auftrag nicht ist. Der Bildweg
 * ist der Kiosk-Browser; er bekommt die MP4-Adresse ueber den Kern.
 *
 * Deshalb steht in `rechte` auch nur `netz`: ohne `aufloesen()` und `suchen()`
 * braucht es `medienquelle` nicht, und ein Recht, das man nicht braucht, holt
 * man sich nicht.
 *
 * ══ KEINE ABHAENGIGKEITEN ═══════════════════════════════════════════════════
 * Wie jedes Plugin dieses Hauses: kein `npm install`, kein Bauschritt.
 */

/** Der oeffentliche Einstieg der ARD. Gemessen am 20.09.2026, ohne Schluessel. */
const TOR = 'https://api.ardmediathek.de/page-gateway'

/**
 * WIE BREIT DAS BILD HOECHSTENS SEIN DARF.
 *
 * Der Schirm der Box ist 800x480 (DSI-2). Die ARD liefert dieselbe Folge als
 * 360p, 540p, 720p und 1080p. 540p (960x540) ist die kleinste Stufe, die den
 * Schirm noch voll fuellt — alles darueber kostet nur Rechenzeit, denn der
 * Pi 5 dekodiert H.264 in Software (ihm fehlt der Hardware-Dekoder des Pi 4).
 *
 * VERSTELLBAR ueber die Abfrage `?breite=`, damit eine Messung am Geraet
 * andere Stufen vergleichen kann, ohne dass jemand diese Zeile aendert.
 */
const BREITE_DECKEL = 960

/** Bildbreite fuer die Kacheln der Elternflaeche. */
const BILD_BREITE = 512

/** Wie viele Treffer eine Suche hoechstens meldet (Deckel der Antwort: 256 KB). */
const TREFFER_GRENZE = 24

/* ══ DIE REGELN — reine Funktionen, exportiert, damit sie Zeugen haben ══════
 *
 * Jede Entscheidung, die man sonst mitten in den HTTP-Aufruf schreibt, steht
 * hier einzeln und ohne Netz. Der Grund steht im Wissenspaket unter
 * `entscheidung-aus-dem-http-aufruf-herausloesen`: was im `await` klebt, ist
 * nur an einer laufenden Box pruefbar.
 */

/**
 * Ein ARD-Bildobjekt zu einer Adresse machen.
 *
 * `{width}` IST EIN PLATZHALTER, KEINE ADRESSE. Roh gespeichert antwortet die
 * ARD mit HTTP 400 — dieselbe Falle wie in mixpi-ardsounds, dort gemessen.
 */
export function bildAus(bilder, breite = BILD_BREITE) {
  const roh = bilder?.aspect16x9?.src ?? bilder?.src ?? bilder?.aspect1x1?.src ?? ''
  const s = String(roh).trim()
  if (!s) return ''
  return s.replace(/\{width\}/g, String(breite)).replace(/%7Bwidth%7D/gi, String(breite))
}

/**
 * Ist das eine NEBENFASSUNG derselben Folge?
 *
 * GEMESSEN AM 20.09.2026: die Suche nach „Sendung mit der Maus" liefert
 * dieselbe Folge DREIMAL — normal, „(Audiodeskription)" und „(mit
 * Gebaerdensprache)". Fuer ein Elternteil, das eine Belohnung aussucht, sind
 * das drei gleich aussehende Kacheln mit gleichem Bild und gleicher Dauer;
 * die Wahl zwischen ihnen ist keine, die jemand treffen will.
 *
 * ES IST EINE SPERRLISTE AUF DEM TITEL, keine Erlaubnisliste auf einem Feld:
 * die Teaser tragen KEIN Merkmal, das die Fassung nennt (nachgesehen —
 * `binaryFeatures` steht am Werk, nicht am Teaser). Der Titel ist das, was da
 * ist. Wer eine dieser Fassungen ausdruecklich will, gibt ihre Kennung
 * direkt an `video/<kennung>` — dieser Filter sitzt NUR in der Suche.
 */
export function nebenfassung(name) {
  return /\((?:audiodeskription|mit geb(?:ä|ae)rdensprache|geb(?:ä|ae)rdensprache|h(?:ö|oe)rfassung)\)\s*$/i.test(
    String(name ?? '').trim(),
  )
}

/** Ein Datum in der Vergangenheit? Ohne Datum gilt der Eintrag. */
export function abgelaufen(bis, jetzt) {
  const s = String(bis ?? '').trim()
  if (!s) return false
  const ende = Date.parse(s)
  return Number.isFinite(ende) && ende < jetzt
}

/**
 * Rohe Teaser der Suche -> Treffer fuer die Elternflaeche.
 *
 * @param {object} rumpf  Antwort von /widgets/ard/search/vod
 * @param {number} jetzt  Date.now() — hereingereicht, damit der Zeuge nicht wartet
 */
export function trefferAus(rumpf, jetzt, mitNebenfassungen = false) {
  const raus = []
  for (const t of rumpf?.teasers ?? []) {
    if (!t) continue
    const kennung = String(t.id ?? '').trim()
    const name = String(t.longTitle ?? t.title ?? t.shortTitle ?? '').trim()
    if (!kennung || !name) continue
    if (!mitNebenfassungen && nebenfassung(name)) continue
    if (abgelaufen(t.availableTo, jetzt)) continue
    const eintrag = {
      kennung,
      name,
      sendung: String(t.show?.title ?? '').trim(),
      kinderinhalt: t.isChildContent === true,
    }
    const bild = bildAus(t.images)
    if (bild) eintrag.bild = bild
    const dauer = Number(t.duration)
    if (Number.isFinite(dauer) && dauer > 0) eintrag.dauerSek = Math.floor(dauer)
    const bis = String(t.availableTo ?? '').trim()
    if (bis) eintrag.verfuegbarBis = bis
    raus.push(eintrag)
    if (raus.length >= TREFFER_GRENZE) break
  }
  return raus
}

/**
 * NEBENSPUREN AM DATEINAMEN — weil `audios[].kind` nicht traegt.
 *
 * GEMESSEN AM 20.09.2026 an „Kommissar Wisting" (Das Erste), nachdem die
 * erste Auswahl auf der Box ausgerechnet die Hoerfassung erwischt hatte.
 * In DERSELBEN Gruppe `main` lagen drei Saetze:
 *
 *     JOB_..._audiodeskription_960x540.mp4    audios[].kind: standard   (!)
 *     JOB_..._internationalerton_960x540.mp4  audios[].kind: audio-description (!)
 *     JOB_..._sendeton_960x540.mp4            audios[].kind: standard
 *
 * DIE MARKIERUNG WAR VERTAUSCHT: die Hoerfassung hiess „standard", und der
 * internationale Ton (Musik und Geraeusche, KEIN Dialog) hiess
 * „audio-description". Dazu stand `languageCode: 'nor'` an einer deutschen
 * Fassung. Wer sich allein auf das Feld verlaesst, gibt einem Kind mit
 * gleicher Wahrscheinlichkeit einen Film ohne Dialog.
 *
 * DIE REIHENFOLGE TRAEGT AUCH NICHT: die Hoerfassung stand hier VORN.
 *
 * WAS TRAEGT, IST DER DATEINAME. Er ist eine Kruecke und wird hier auch so
 * behandelt — als SPERRLISTE mit Rueckfall: passt nichts mehr, wenn man sie
 * anwendet, gilt sie nicht. Lieber die falsche Tonspur als gar kein Video;
 * eine Erlaubnisliste auf „sendeton" haette alle Werke stumm gestellt, die
 * dieses Wort nicht benutzen (die Maus-Folgen tun es nicht).
 */
const NEBENSPUR_WORTE = ['audiodeskription', 'hoerfassung', 'hörfassung', 'internationalerton', 'klarsprache']

export function nebenspur(adresse) {
  const name = String(adresse ?? '')
    .split('/')
    .pop()
    .toLowerCase()
  return NEBENSPUR_WORTE.some((w) => name.includes(w))
}

/**
 * Die beste abspielbare Adresse aus einer `mediaCollection`.
 *
 * FUENF REGELN, alle am echten Dienst nachgesehen (20.09.2026, „Klima-Maus
 * Teil 6" mit 15 Adressen und „Kommissar Wisting" mit 15 in DREI Saetzen):
 *
 *   GRUPPE     `streams[].kind === 'main'`. Daneben liegt `sign-language`
 *              (dieselbe Folge mit eingeblendeter Gebaerdensprache) — eine
 *              gute Sache, aber nicht das, was jemand unausgesprochen meint.
 *   FORM       nur `video/mp4`. `application/vnd.apple.mpegurl` (HLS) kann
 *              ein `<video>`-Element in Chromium NICHT von sich aus spielen;
 *              es braucht eine Bibliothek. Progressive MP4 spielt es direkt.
 *   TONSPUR    zwei Merkmale, weil EINES nicht traegt: `audios[].kind` sagt
 *              bei der Maus die Wahrheit und bei Wisting das Gegenteil (siehe
 *              `nebenspur`). Gemieden wird deshalb, was NACH EINEM DER BEIDEN
 *              eine Nebenspur ist.
 *   RUECKFALL  bleibt danach nichts uebrig, gilt erst der Dateiname nicht
 *              mehr, dann auch das Feld nicht. Lieber die falsche Tonspur
 *              als ein schwarzes Bild.
 *   BREITE     die groesste Stufe, die den Deckel nicht reisst. Gibt es
 *              keine darunter, gilt die KLEINSTE ueberhaupt — lieber ein
 *              zu grosses Bild als gar keins.
 */
export function besteQuelle(streams, deckel = BREITE_DECKEL) {
  const gruppen = (streams ?? []).filter((s) => s && (s.kind ?? 'main') === 'main')
  const sammeln = gruppen.length ? gruppen : (streams ?? [])
  const kandidaten = []
  for (const gruppe of sammeln) {
    for (const m of gruppe?.media ?? []) {
      const adresse = String(m?.url ?? '').trim()
      if (!adresse) continue
      if (!/^https?:\/\//i.test(adresse)) continue
      if (String(m?.mimeType ?? '').toLowerCase() !== 'video/mp4') continue
      const spuren = m?.audios ?? []
      const breite = Number(m?.maxHResolutionPx)
      kandidaten.push({
        adresse,
        breite: Number.isFinite(breite) && breite > 0 ? breite : 0,
        hoehe: Number(m?.maxVResolutionPx) || 0,
        stufe: String(m?.forcedLabel ?? '').trim(),
        // ZWEI GETRENNTE MERKMALE, nicht ein verodertes: nur so laesst sich
        // stufenweise zurueckfallen, wenn eines von beiden alles wegnimmt.
        alsAdMarkiert: spuren.length > 0 && spuren.every((a) => String(a?.kind ?? 'standard') !== 'standard'),
        nebenspurImNamen: nebenspur(adresse),
      })
    }
  }
  if (!kandidaten.length) return null
  // DIE LEITER: erst beides meiden, dann nur das Feld, dann alles.
  const stufen = [
    kandidaten.filter((k) => !k.alsAdMarkiert && !k.nebenspurImNamen),
    kandidaten.filter((k) => !k.alsAdMarkiert),
    kandidaten,
  ]
  const uebrig = stufen.find((l) => l.length) ?? kandidaten
  const passend = uebrig.filter((k) => k.breite > 0 && k.breite <= deckel)
  const waehlen = (liste) => liste.reduce((a, b) => (b.breite > a.breite ? b : a))
  const gewaehlt = passend.length
    ? waehlen(passend)
    : // Nichts unter dem Deckel: die kleinste Stufe nehmen, die es gibt.
      uebrig.reduce((a, b) => (b.breite > 0 && (a.breite === 0 || b.breite < a.breite) ? b : a))
  // Die Merkmale gehoeren in die Auswahl, nicht in die Antwort.
  return { adresse: gewaehlt.adresse, breite: gewaehlt.breite, hoehe: gewaehlt.hoehe, stufe: gewaehlt.stufe }
}

/**
 * Warum dieses Video NICHT laufen darf — oder `null`, wenn es darf.
 *
 * DREI SPERREN, und jede hat einen anderen Satz fuer das Elternteil. Ein
 * blosses „geht nicht" waere hier besonders teuer: die Freigabe geschieht
 * Tage vor dem Anschauen, und was dann fehlt, fehlt vor dem Kind.
 *
 * ══ `isGeoBlocked` IST KEINE SPERRE — GEMESSEN AM GERAET (20.09.2026) ════
 *
 * Der erste Wurf zaehlte es als vierte Sperre, und genau daran ist die erste
 * Freigabe auf der Box gescheitert: „Kommissar Wisting" meldete
 * `isGeoBlocked: true`, das Plugin antwortete „nur in Deutschland abrufbar"
 * — und ein HEAD auf dieselbe MP4-Adresse, aus demselben Wohnzimmer,
 * antwortete 200 video/mp4.
 *
 * DAS FELD BESCHREIBT DAS WERK, NICHT DEN FRAGENDEN. Es heisst „dieses
 * Video gibt es nur im Inland" und nicht „du darfst es nicht". Eine Box, die
 * in Deutschland steht, spielt es. Wer es als Sperre liest, sperrt die
 * eigenen Kinder von Inhalten aus, die ihnen offenstehen — und zwar
 * unsichtbar, weil die Absage plausibel klingt.
 *
 * WAS BEI EINER ECHTEN GEOSPERRE PASSIERT (Box im Ausland): die Adresse
 * kommt, und der Abruf scheitert. Das faengt der Video-Schirm ab („Das Video
 * lässt sich nicht abspielen."). Ein Fehler zur Laufzeit ist hier die
 * ehrlichere Antwort als eine Vorhersage, die in 99 % der Faelle falsch ist.
 *
 * `nurInland` reist stattdessen als MERKMAL mit (siehe videoAus).
 */
export function sperrgrund(werk, jetzt) {
  if (!werk) return 'nicht gefunden'
  if (werk.blockedByFsk === true) return 'durch die FSK gesperrt'
  if (werk.blockedByLoginOnly === true) return 'nur mit ARD-Konto abrufbar'
  if (abgelaufen(werk.availableTo, jetzt)) return 'nicht mehr in der Mediathek'
  return null
}

/** Gibt es das Video nur im Inland? Ein Merkmal, keine Sperre (siehe oben). */
export function nurInland(werk) {
  return werk?.geoblocked === true || werk?.mediaCollection?.embedded?.isGeoBlocked === true
}

/**
 * Eine Werkseite -> alles, was der Kern ueber dieses Video wissen muss.
 *
 * WIRFT NICHT, SONDERN MELDET: `{ ok: false, grund }`. Ein geworfener Fehler
 * waere im Worker eine Zeile im Journal; hier soll der Grund bis in die
 * Elternflaeche durchkommen.
 */
export function videoAus(seite, jetzt, deckel = BREITE_DECKEL) {
  const werk = (seite?.widgets ?? []).find((w) => w?.mediaCollection) ?? null
  const grund = sperrgrund(werk, jetzt)
  if (grund) return { ok: false, grund }
  const quelle = besteQuelle(werk.mediaCollection?.embedded?.streams, deckel)
  if (!quelle) return { ok: false, grund: 'keine abspielbare Fassung gefunden' }
  const meta = werk.mediaCollection?.embedded?.meta ?? {}
  const name = String(werk.title ?? meta.title ?? seite?.title ?? '').trim()
  const video = {
    ok: true,
    kennung: String(werk.id ?? seite?.id ?? '').trim(),
    name: name || 'Video',
    sendung: String(werk.show?.title ?? meta.seriesTitle ?? '').trim(),
    kinderinhalt: seite?.isChildContent === true,
    quelle,
  }
  if (nurInland(werk)) video.nurInland = true
  const bild = bildAus(werk.image)
  if (bild) video.bild = bild
  const dauer = Number(meta.durationSeconds)
  if (Number.isFinite(dauer) && dauer > 0) video.dauerSek = Math.floor(dauer)
  const bis = String(werk.availableTo ?? '').trim()
  if (bis) video.verfuegbarBis = bis
  const text = String(werk.synopsis ?? meta.synopsis ?? '').trim()
  if (text) video.beschreibung = text.slice(0, 600)
  return video
}

/** Eine Zahl aus der Abfrage, mit Grenzen und Vorgabe. */
export function zahlAus(roh, vorgabe, klein, gross) {
  const n = Number(roh)
  if (!Number.isFinite(n)) return vorgabe
  return Math.min(gross, Math.max(klein, Math.floor(n)))
}

/* ══ DER NETZWEG ════════════════════════════════════════════════════════════ */

async function fragen(kontext, adresse) {
  if (!kontext.holen) throw new Error('Dem Plugin fehlt das Recht "netz" in plugin.json.')
  const antwort = await kontext.holen(adresse, { headers: { accept: 'application/json' } })
  if (!antwort.ok) throw new Error(`ARD antwortet mit ${antwort.status}`)
  return await antwort.json()
}

/** Suche in der Mediathek (nur Abrufbares, kein Livestream). */
export function sucheAdresse(begriff, anzahl) {
  const p = new URLSearchParams({
    searchString: begriff,
    pageSize: String(anzahl),
    platform: 'web',
  })
  return `${TOR}/widgets/ard/search/vod?${p.toString()}`
}

/** Die Werkseite zu einer Kennung. */
export function videoAdresse(kennung) {
  const p = new URLSearchParams({ embedded: 'false', mcV6: 'true' })
  return `${TOR}/pages/ard/item/${encodeURIComponent(kennung)}?${p.toString()}`
}

export default {
  /**
   * Die freie Flaeche — zwei Wege, und beide nur lesend.
   *
   *   GET suche?begriff=…&anzahl=…&alle=1    Treffer fuer die Elternflaeche
   *   GET video/<kennung>?breite=…           eine abspielbare Adresse
   *
   * `video/<kennung>` RUFT AUCH DER KERN, und zwar erst, wenn die Freigabe
   * steht. Die Adresse haelt nicht ewig (die ARD zieht Folgen zurueck), also
   * wird sie bei JEDEM Start frisch geholt statt bei der Freigabe gespeichert.
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
      try {
        const rumpf = await fragen(kontext, sucheAdresse(begriff, anzahl))
        return { inhalt: { treffer: trefferAus(rumpf, Date.now(), abfrage.alle === '1') } }
      } catch (f) {
        return { status: 502, inhalt: { fehler: f.message } }
      }
    }

    if (pfad.startsWith('video/')) {
      const kennung = decodeURIComponent(pfad.slice('video/'.length)).trim()
      if (!kennung) return { status: 400, inhalt: { fehler: 'kennung fehlt' } }
      const deckel = zahlAus(abfrage.breite, BREITE_DECKEL, 240, 1920)
      try {
        const seite = await fragen(kontext, videoAdresse(kennung))
        const video = videoAus(seite, Date.now(), deckel)
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
    return { ok: true, text: 'bereit — Suche und Auflösung über api.ardmediathek.de' }
  },

  /** Der Knopf aus der Verwaltung: antwortet die ARD, und wie schnell? */
  async aktion(kennung, kontext) {
    if (kennung !== 'pruefen') return { ok: false, text: `unbekannte Aktion "${kennung}"` }
    if (!kontext.holen) return { ok: false, text: 'Recht "netz" fehlt' }
    const ab = Date.now()
    try {
      const rumpf = await fragen(kontext, sucheAdresse('Maus', 1))
      const ms = Date.now() - ab
      const n = (rumpf?.teasers ?? []).length
      return { ok: n > 0, text: `ARD antwortet in ${ms} ms, ${n} Treffer auf „Maus“` }
    } catch (f) {
      return { ok: false, text: `ARD nicht erreichbar: ${f.message}` }
    }
  },
}
