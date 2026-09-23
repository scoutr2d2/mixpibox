/**
 * DIE LISTE DER TITEL, DIE NOCH MITGESCHNITTEN WERDEN SOLLEN (E66/E73).
 *
 * SIE WOHNT IM PLUGIN, nicht im Server. Betreiber, 20.08.2026: „alles gehoert
 * ins plugin finde ich was zur aufzeichnung gehoert, die streams von spotify
 * sind service vom backend." Die Groesse dahinter: der Server fuehrt STROEME
 * als Dienst (heute Soloist/librespot, morgen Deezer) — was mit dem Ton
 * geschieht, ist Sache dessen, der ihn aufzeichnet.
 *
 * Abgelegt wird sie in `kontext.datenOrdner` — dem Ordner, den der Plugin-Wirt
 * je Kennung anlegt und den das Sicherungsnetz kennt.
 *
 * ══ WARUM ES DIE LISTE GIBT ════════════════════════════════════════════════
 *
 * Der Mitschnitt war ein PASSIVER ABGRIFF am Familienstrom: wer den Titel
 * wechselt, schneidet die Aufnahme ab (E63/E64). Mit der Liste wird daraus
 * etwas anderes — was angespielt wurde, wird VORGEMERKT und spaeter
 * vollstaendig nachgeschnitten. Das Abschneiden verschwindet als
 * Problemklasse, statt gemildert zu werden.
 *
 * ══ DIE DREI STUFEN (E73, Betreiber 20.08.2026) ════════════════════════════
 *
 *   unter 30 s gehoert          -> auf die Liste, im Leerlauf
 *   ueber 30 s, Rest kurz, frei -> sofort fertig aufnehmen (nicht hier)
 *   ueber 30 s, sonst           -> auf die Liste, aber mit VORRANG
 *
 * „Bei regem Hoeren kommt es nicht zu vielen Wechseln" — wer wirklich hoert,
 * wechselt selten; wer blaettert, erzeugt lauter Eintraege unter 30 s, und die
 * stehen hinten. Die Liste bleibt dadurch von selbst kurz.
 *
 * ══ VIER REGELN, DIE NICHT OFFENSICHTLICH SIND ═════════════════════════════
 *
 * 1. DIE PLATTE IST DIE WAHRHEIT, NICHT DIE LISTE. Sie weiss nur, was SIE
 *    aufgenommen hat. Geht sie verloren — Kartenschaden, Neuaufsetzen, oder sie
 *    existierte noch nicht —, gilt jeder Titel wieder als offen, und die Box
 *    nimmt alles ein zweites Mal auf. Aufnehmen ist eine Investition (einmal
 *    teuer, danach spart der lokale Titel Netz und Strom); zweimal bezahlt
 *    amortisiert sie sich nie. Deshalb `abgleichen()`.
 *
 * 2. `laeuft` MUSS SICH ERHOLEN. Faellt der Strom mitten in einer Aufnahme,
 *    bleibt ein Eintrag darauf stehen und blockiert fuer immer — still, denn
 *    von aussen sieht es aus, als liefe gerade etwas.
 *
 * 3. DER VERSUCH ZAEHLT BEIM BEGINN, nicht am Ende. Endet der Lauf hart, gibt
 *    es kein Ende, das noch zaehlen koennte.
 *
 * 4. EIN FEHLER KEHRT NICHT EWIG WIEDER, VERSCHWINDET ABER AUCH NICHT. Nach
 *    drei Anlaeufen bleibt der Eintrag liegen — sichtbar, mit Grund. Ein
 *    Eintrag, der verschwindet, sieht aus wie einer, den es nie gab.
 */

/** Ab wann ein Wechsel als „gehoert" gilt und nicht als Blaettern (E73). */
export const SCHWELLE_SEK = 30

/** Wie viele Anlaeufe ein Titel bekommt, bevor er liegen bleibt. */
export const HOECHSTENS_VERSUCHE = 3

export const ZUSTAENDE = ['offen', 'laeuft', 'fertig', 'fehler']
export const HERKUENFTE = ['automatisch', 'hand']

export const LISTE_LEER = { eintraege: [] }

const URI_MUSTER = /^spotify:track:[A-Za-z0-9]+$/

export function istTitelUri(x) {
  return typeof x === 'string' && URI_MUSTER.test(x)
}

function text(x) {
  return typeof x === 'string' ? x.replace(/\s+/g, ' ').trim() : ''
}

function zahl(x) {
  return typeof x === 'number' && Number.isInteger(x) && x >= 0 ? x : 0
}

/**
 * Die Spurnummer — oder `null`.
 *
 * NICHT `zahl()`: dort ist 0 der Ersatzwert, hier waere 0 eine Luege. Eine
 * fehlende Nummer heisst „ich weiss es nicht", und der Dateiname bekommt dann
 * gar kein Zahlenpraefix. Stuende dort 0, entstuende `00 Titel.flac` neben dem
 * spaeter richtig benannten `07 Titel.flac` — zwei Dateien fuer ein Stueck.
 */
function nummerAus(x) {
  return typeof x === 'number' && Number.isFinite(x) && x > 0 ? Math.round(x) : null
}

/**
 * Entscheidet aus der gehoerten Dauer, wie ein Wechsel einzuordnen ist.
 *
 * ES GIBT NUR ZWEI ANTWORTEN HIER: vormerken mit oder ohne Vorrang. Die dritte
 * Moeglichkeit aus E73 — „jetzt sofort fertig aufnehmen" — ist keine
 * Eigenschaft der Liste, sondern eine Entscheidung des Aufrufers: sie haengt
 * daran, ob ein Strom frei ist und wie lang der Rest noch waere. Wer sie hier
 * unterbraechte, muesste der Liste beibringen, was ein Strom ist.
 */
export function einordnen(gehoertSek) {
  const s = typeof gehoertSek === 'number' && gehoertSek >= 0 ? gehoertSek : 0
  return { vorrang: s >= SCHWELLE_SEK, gehoert: s }
}

export function eintragAus(roh) {
  if (!roh || typeof roh !== 'object') return null
  if (!istTitelUri(roh.uri)) return null
  const zustand = ZUSTAENDE.includes(roh.zustand) ? roh.zustand : 'offen'
  return {
    uri: roh.uri,
    titel: text(roh.titel),
    interpret: text(roh.interpret),
    /* ══ WARUM ALBUM, ALBUM-INTERPRET UND NUMMER MITREISEN ══════════════════
     *
     * Ohne sie kann Regel 1 nicht arbeiten. `abgleichen()` fragt „liegt das
     * schon auf der Platte?", und diese Frage ist ein PFAD:
     *
     *     <kategorie>/<albumInterpret>/<album>/<nn titel>.flac
     *
     * Fehlt auch nur eines der Stuecke, laesst der Pfad sich nicht bilden, die
     * Pruefung findet nichts — und die Box nimmt ein zweites Mal auf. Genau
     * die Verschwendung, gegen die die Liste gebaut ist.
     *
     * DER ALBUM-INTERPRET IST NICHT DER TITEL-INTERPRET. Der Ordner gehoert
     * dem Album (siehe `titelAus` in index.mjs, 20.08.2026): `interpret` sind
     * die Mitwirkenden DIESES Titels, Gaeste eingeschlossen, und die ergaeben
     * je Gast einen eigenen Ordner. Beide werden getragen, weil beide gebraucht
     * werden — der eine fuer den Ordner, der andere fuer die Datei-Merkmale.
     */
    album: text(roh.album),
    albumInterpret: text(roh.albumInterpret),
    nummer: nummerAus(roh.nummer),
    /* ══ UND WARUM DAS BILD MITREIST (E135/1c, 10.09.2026) ══════════════════
     *
     * Es ist die einzige BEILAGE in dieser Reihe — alles andere hier bildet
     * einen Pfad oder ein Datei-Merkmal, ohne das die Aufnahme scheitert. Das
     * Bild fehlt lautlos: die FLAC entsteht, die Kachel erscheint, und statt
     * des Covers steht das Maskottchen da.
     *
     * Genau daran ist es zwei Wochen lang durchgerutscht. Der LIVE-Weg holt
     * `album.images[0]` aus dem Spielerzustand und bettet es ein; der
     * NACHSCHNITT baut die Aufnahme allein aus diesem Eintrag — und der trug
     * das Feld nicht, obwohl es beim Vormerken bereitlag. Ergebnis am Geraet
     * (07.09.2026, Kreuztabelle ueber 69 Alben): 42 ohne jedes Bild, alle in
     * Nachtstunden entstanden. llmwiki `der-stille-zweitweg-verliert-die-
     * beilage`.
     */
    bild: text(roh.bild),
    // ERHOLUNG (Regel 2): was beim Laden noch auf `laeuft` steht, hat kein Ende
    // gefunden — der Prozess ist weg, sonst wuerde nicht geladen.
    zustand: zustand === 'laeuft' ? 'offen' : zustand,
    herkunft: HERKUENFTE.includes(roh.herkunft) ? roh.herkunft : 'automatisch',
    vorrang: roh.vorrang === true,
    versuche: zahl(roh.versuche),
    grund: text(roh.grund),
  }
}

/** Derselbe Titel zweimal ist ein Auftrag, nicht zwei. Der erste gilt. */
export function listeAus(roh) {
  const quelle = (roh && typeof roh === 'object' ? roh : {}).eintraege
  const eintraege = []
  const gesehen = new Set()
  for (const r of Array.isArray(quelle) ? quelle : []) {
    const e = eintragAus(r)
    if (!e || gesehen.has(e.uri)) continue
    gesehen.add(e.uri)
    eintraege.push(e)
  }
  return { eintraege }
}

/**
 * Was an einem vorhandenen Eintrag noch LEER ist, aus dem neuen nachtragen.
 *
 * NUR LEERES WIRD GEFUELLT — ein vorhandener Wert wird nie ueberschrieben.
 * Auch das ist „nur nach oben": von „weiss ich nicht" zu „weiss ich" ist ein
 * Gewinn, in die andere Richtung waere es Datenverlust durch einen zufaellig
 * schlechteren Fund.
 *
 * WOZU: Ein von Hand nachgelegter Titel bringt oft nur seine Adresse mit —
 * jemand hat eine URI eingetragen, mehr nicht. Ohne Album und Nummer kann
 * `abgleichen()` seine Datei nicht suchen, er gilt ewig als offen und wird
 * womoeglich doppelt aufgenommen. Spielt derselbe Titel spaeter einmal, sind
 * die Angaben da — und werden hier eingesammelt, statt verworfen.
 */
function lueckenFuellen(da, neu) {
  const felder = {}
  // `bild` steht mit in der Reihe, und das ist mehr als Symmetrie: die Liste
  // traegt Eintraege aus der Zeit VOR E135/1c, die kein Bild haben. Spielt so
  // ein Titel noch einmal, ist die Adresse da — und wird hier eingesammelt,
  // statt zum zweiten Mal verworfen.
  for (const f of ['titel', 'interpret', 'album', 'albumInterpret', 'bild']) {
    const wert = text(neu?.[f])
    if (wert && !text(da[f])) felder[f] = wert
  }
  const n = nummerAus(neu?.nummer)
  if (n !== null && nummerAus(da.nummer) === null) felder.nummer = n
  return { felder, etwas: Object.keys(felder).length > 0 }
}

/**
 * Einen Titel vormerken.
 *
 * STEHT ER SCHON DA, PASSIERT NICHTS — auch nicht, wenn er `fertig` oder
 * `fehler` ist. Das ist der Punkt: was einmal aufgenommen wurde, wird nicht
 * bei jedem Anspielen erneut aufgenommen.
 *
 * ZWEI AUSNAHMEN, beide „nach oben": Ein von HAND nachgelegter Titel darf
 * einen automatischen uebernehmen, und ein Eintrag darf VORRANG bekommen, den
 * er noch nicht hatte. Andersherum nie — was jemand ausdruecklich wollte oder
 * was schon dringlich war, faellt nicht durch einen nebenbei angespielten
 * Titel zurueck.
 */
export function vormerken(liste, eintrag, herkunft = 'automatisch', vorrang = false) {
  if (!istTitelUri(eintrag?.uri)) return { liste, ok: false, grund: 'keine brauchbare Titel-Adresse' }
  const da = liste.eintraege.find((e) => e.uri === eintrag.uri)
  if (da) {
    const nachOben = (herkunft === 'hand' && da.herkunft !== 'hand') || (vorrang && !da.vorrang)
    const luecken = lueckenFuellen(da, eintrag)
    if (!nachOben && !luecken.etwas) return { liste, ok: false, grund: 'steht schon in der Liste' }
    return {
      liste: {
        eintraege: liste.eintraege.map((e) =>
          e.uri === da.uri
            ? {
                ...e,
                ...luecken.felder,
                herkunft: herkunft === 'hand' ? 'hand' : e.herkunft,
                vorrang: e.vorrang || vorrang,
              }
            : e,
        ),
      },
      ok: true,
      grund: nachOben ? 'stand schon da, jetzt weiter vorn' : 'stand schon da, Angaben ergaenzt',
    }
  }
  return {
    liste: {
      eintraege: [
        ...liste.eintraege,
        {
          uri: eintrag.uri,
          titel: text(eintrag.titel),
          interpret: text(eintrag.interpret),
          album: text(eintrag.album),
          albumInterpret: text(eintrag.albumInterpret),
          nummer: nummerAus(eintrag.nummer),
          bild: text(eintrag.bild),
          zustand: 'offen',
          herkunft,
          vorrang: vorrang === true,
          versuche: 0,
          grund: '',
        },
      ],
    },
    ok: true,
    grund: '',
  }
}

/**
 * Der naechste Titel — oder `null`.
 *
 * DREI STUFEN (E73): von Hand Nachgelegtes zuerst, dann was ueber der Schwelle
 * gehoert wurde (`vorrang`), dann der Rest. Innerhalb einer Stufe gilt die
 * Reihenfolge der Liste.
 *
 * Wer in der Verwaltung etwas eintraegt, wartet darauf. Wer einen Titel fast
 * zu Ende gehoert hat, will ihn eher als einen, den er angetippt und sofort
 * weggewischt hat.
 */
export function naechster(liste) {
  const offen = liste.eintraege.filter((e) => e.zustand === 'offen')
  return (
    offen.find((e) => e.herkunft === 'hand') ?? offen.find((e) => e.vorrang) ?? offen[0] ?? null
  )
}

/**
 * DIE PLATTE GEGEN DIE LISTE HALTEN — Regel 1.
 *
 * `schonVorhanden(eintrag)` sagt, ob die Datei bereits liegt. Alles, was sie
 * bejaht, wird auf `fertig` gesetzt, ohne es noch einmal aufzunehmen.
 *
 * DER AUFRUFER REICHT DIE PRUEFUNG HEREIN, damit dieses Modul rein bleibt und
 * ohne Dateisystem pruefbar ist. Im Plugin ist es ein `stat` auf den Pfad, den
 * `albumOrdner`/`spurname` ohnehin bilden.
 *
 * WARUM `fertig` UND NICHT ENTFERNEN: Ein Eintrag, der verschwindet, sieht aus
 * wie einer, den es nie gab. `fertig` sagt „liegt vor" und ist damit die
 * Antwort auf die Frage, die spaeter jemand stellt.
 */
export function abgleichen(liste, schonVorhanden) {
  if (typeof schonVorhanden !== 'function') return { liste, erledigt: [] }
  const erledigt = []
  const eintraege = liste.eintraege.map((e) => {
    if (e.zustand === 'fertig') return e
    let da = false
    try {
      da = schonVorhanden(e) === true
    } catch {
      // EINE PRUEFUNG, DIE WIRFT, HEISST NICHT „liegt nicht vor". Sie heisst
      // „unbekannt" — und bei unbekannt bleibt der Eintrag stehen, statt
      // stillschweigend erledigt zu werden.
      return e
    }
    if (!da) return e
    erledigt.push(e.uri)
    return { ...e, zustand: 'fertig', grund: 'lag schon auf der Platte' }
  })
  return { liste: { eintraege }, erledigt }
}

function setzen(liste, uri, wie) {
  if (!liste.eintraege.some((e) => e.uri === uri)) return { liste, ok: false }
  return { liste: { eintraege: liste.eintraege.map((e) => (e.uri === uri ? wie(e) : e)) }, ok: true }
}

/** Der Mitschnitt hat begonnen. Zaehlt den Versuch SOFORT (Regel 3). */
export function beginnen(liste, uri) {
  return setzen(liste, uri, (e) => ({ ...e, zustand: 'laeuft', versuche: e.versuche + 1 }))
}

export function abschliessen(liste, uri) {
  return setzen(liste, uri, (e) => ({ ...e, zustand: 'fertig', grund: '' }))
}

/** Zurueck in die Reihe, solange Versuche uebrig sind — sonst liegen lassen. */
export function scheitern(liste, uri, grund) {
  return setzen(liste, uri, (e) => ({
    ...e,
    zustand: e.versuche >= HOECHSTENS_VERSUCHE ? 'fehler' : 'offen',
    grund: text(grund) || 'ohne Angabe',
  }))
}

/**
 * ZURUECK IN DIE REIHE, OHNE DASS ES ZAEHLT (E74/4).
 *
 * Fuer die Verdraengung: der Strom wurde fuers Hoeren gebraucht, mitten in der
 * Aufnahme. Der TITEL hat daran nichts falsch gemacht.
 *
 * ══ WARUM NICHT `scheitern` ════════════════════════════════════════════════
 *
 * Weil der Versuch beim BEGINN gezaehlt wird (Regel 3). Wuerde eine
 * Verdraengung als Fehlschlag verbucht, waeren nach drei Kindern, die
 * zwischendurch Musik anmachen, drei Versuche verbraucht — und der Titel laege
 * auf `fehler`, ohne dass je etwas an ihm falsch war. Je beliebter die Box,
 * desto kaputter die Liste.
 *
 * ══ WARUM NICHT `zuruecksetzen` ════════════════════════════════════════════
 *
 * Das setzt `versuche` auf 0 und vergaebe damit auch ECHTE frueherer
 * Fehlschlaege. Hier wird genau der EINE Versuch zurueckgenommen, den dieser
 * Lauf gekostet hat — nicht mehr und nicht weniger.
 */
export function zuruecklegen(liste, uri) {
  return setzen(liste, uri, (e) => ({
    ...e,
    zustand: 'offen',
    versuche: Math.max(0, e.versuche - 1),
    grund: '',
  }))
}

export function zuruecksetzen(liste, uri) {
  return setzen(liste, uri, (e) => ({ ...e, zustand: 'offen', versuche: 0, grund: '' }))
}

/** Einen Eintrag entfernen. Der einzige Weg, auf dem etwas verschwindet. */
export function entfernen(liste, uri) {
  const rest = liste.eintraege.filter((e) => e.uri !== uri)
  return { liste: { eintraege: rest }, ok: rest.length !== liste.eintraege.length }
}

/** Was in der Verwaltung oben steht: wie viele wovon. */
export function stand(liste) {
  const z = { offen: 0, laeuft: 0, fertig: 0, fehler: 0 }
  for (const e of liste.eintraege) z[e.zustand]++
  return z
}
