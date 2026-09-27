/**
 * ARD SOUNDS — der Pilot des erweiterten Vertrags (E77).
 *
 * ══ WAS DIESES PLUGIN IST UND WAS NICHT ════════════════════════════════════
 *
 * Es ist der DURCHSTICH fuer drei neue Faehigkeiten: sich in einer SEKTION
 * anmelden (`sektion` im Manifest — es erscheint in der ARD-Karte der
 * Streaming-Seite), ein ICON mitbringen (`icon.svg` reist im Plugin-Ordner)
 * und eigene FLAECHEN anbieten (die Aktion „Erreichbarkeit messen" und die
 * Route `/api/plugins/mixpi-ardsounds/http/kategorien`).
 *
 * Es ERSETZT die ARD-Funktionen des Kerns noch nicht — Kacheln, Folgenlisten,
 * Weiterhoeren und der Vorspann-Sprung wohnen weiter in server.ts/ard.ts. Die
 * Kartierung vom 22.08.2026 nennt die vier Strukturluecken, die vor einer
 * echten Migration zu schliessen sind (Folgenlisten-Aufloesung,
 * Kachel-Integration, Browse-Routen, Weiterhoeren). Der Pilot beweist den
 * Vertrag; die Migration ist ein eigener Schritt.
 *
 * KEINE ABHAENGIGKEITEN, wie bei jedem Plugin dieses Hauses: ein Plugin, das
 * `npm install` auf einer Pi im Kinderzimmer braucht, ist kein Plugin,
 * sondern ein Nachmittag.
 */

const GRAPHQL = 'https://api.ardaudiothek.de/graphql'

/** Eine GraphQL-Frage an die ARD. Liefert { daten, ms } oder wirft. */
async function fragen(kontext, query, variables) {
  const ab = Date.now()
  const antwort = await kontext.holen(GRAPHQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  const ms = Date.now() - ab
  if (!antwort.ok) throw new Error(`ARD antwortet mit ${antwort.status}`)
  const rumpf = await antwort.json()
  return { daten: rumpf?.data ?? null, ms }
}

/* ══ DIE FOLGEN-REGELN (E78) ═════════════════════════════════════════════════
 *
 * UEBERNOMMEN AUS ard.ts, WO JEDE EINZELNE GEMESSEN IST — die Messprotokolle
 * stehen dort und werden hier nicht wiederholt. Das ist waehrend der Migration
 * eine ZWEITE WAHRHEIT neben dem Kern, und zwar wissentlich: ein Plugin ist
 * eigenstaendig (keine Imports aus src/), und die Duplikation endet, wenn der
 * Kern-Zweig faellt und dieses Plugin die einzige Wahrheit ist. Wer hier etwas
 * aendert, sieht in ard.ts nach, ob die Messung dagegen spricht.
 *
 * Die Regeln in Kurzform:
 *   TON        erste audios[]-Adresse, deren mimeType nach Ton aussieht ODER
 *              fehlt (Nachsicht: gemessen war eine Datei ohne Merkmal ein MP3).
 *   ABGELAUFEN audioList[].availableTo in der Vergangenheit -> Folge faellt.
 *              Ohne Datum gilt sie — die meisten Folgen tragen keins.
 *   SPERRLISTE EVENT_LIVESTREAM und NOT_FOUND sind keine Folgen. Eine
 *              SPERRLISTE, keine Erlaubnisliste: bei MausZoom sind spielbare
 *              Stuecke SECTION, eine Erlaubnisliste hatte sie stumm gedampft.
 *   ORDNUNG    nach publishDate; ohne Datum hinten, nie geraten.
 *   BILD       url1X1 vor url, {width}-Platzhalter fuellen (512) — roh
 *              gespeichert antwortet die Adresse mit HTTP 400.
 */
const KEINE_FOLGE = ['EVENT_LIVESTREAM', 'NOT_FOUND']
const BILD_BREITE = 512
const FOLGEN_GRENZE = 60

function bildAus(bild) {
  const roh = String(bild?.url1X1 ?? bild?.url ?? '').trim()
  if (!roh) return ''
  return roh.replace(/\{width\}/g, String(BILD_BREITE)).replace(/%7Bwidth%7D/gi, String(BILD_BREITE))
}

function tonAus(folge) {
  for (const t of folge?.audios ?? []) {
    const url = String(t?.url ?? '').trim()
    if (!url) continue
    const art = String(t?.mimeType ?? '').trim().toLowerCase()
    if (art && !art.startsWith('audio/')) continue
    return url
  }
  return null
}

function abgelaufen(folge, jetzt) {
  for (const a of folge?.audioList ?? []) {
    const bis = String(a?.availableTo ?? '').trim()
    if (!bis) continue
    const ende = Date.parse(bis)
    if (Number.isFinite(ende) && ende < jetzt) return true
  }
  return false
}

/** Rohe items-Knoten -> spielbare Folgen, geordnet. */
function folgenAus(knoten, richtung, jetzt) {
  const folgen = []
  for (const roh of knoten ?? []) {
    if (!roh) continue
    if (KEINE_FOLGE.includes(String(roh.itemType ?? ''))) continue
    if (roh.isPublished === false) continue
    const ton = tonAus(roh)
    if (!ton) continue
    if (abgelaufen(roh, jetzt)) continue
    const kennung = String(roh.id ?? '').trim()
    const name = String(roh.titleClean ?? roh.title ?? '').trim()
    if (!kennung || !name) continue
    const f = {
      kennung,
      name,
      quelle: { art: 'strom', adresse: ton },
      veroeffentlicht: String(roh.publishDate ?? '').trim(),
    }
    const bild = bildAus(roh.image)
    if (bild) f.bild = bild
    const dauer = Number(roh.duration)
    if (Number.isFinite(dauer) && dauer > 0) f.dauerSek = Math.floor(dauer)
    folgen.push(f)
  }
  const mit = folgen.filter((f) => f.veroeffentlicht)
  const ohne = folgen.filter((f) => !f.veroeffentlicht)
  mit.sort((a, b) => {
    const x = Date.parse(a.veroeffentlicht)
    const y = Date.parse(b.veroeffentlicht)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return 0
    return richtung === 'aelteste' ? x - y : y - x
  })
  // Das Hilfsfeld bleibt im Plugin — der Vertrag kennt es nicht.
  return [...mit, ...ohne].map(({ veroeffentlicht, ...f }) => f)
}

/**
 * Die Sammlungen samt Altersfenster UND Teaser-URNs — EINE Listen-Abfrage,
 * 15 min gemerkt. Die URNs reisen mit, weil die Einzel-Abfrage sie nicht mehr
 * traegt (Messung siehe sammlung/-Pfad).
 */
async function sammlungenHolen(kontext) {
  const alt = gemerkt('sammlungen')
  if (alt) return alt
  const { daten } = await fragen(kontext, '{ editorialCollections(first: 400) { nodes { id title numberOfElements document } } }')
  return merken(
    'sammlungen',
    (daten?.editorialCollections?.nodes ?? [])
      .filter((n) => n?.id && n?.title)
      .map((n) => ({
        id: String(n.id),
        titel: String(n.title),
        anzahl: Number(n.numberOfElements) || 0,
        fenster: altersfensterAus(n.title),
        urns: (Array.isArray(n.document?.teasers) ? n.document.teasers : [])
          .map((x) => String(x ?? ''))
          .filter((u) => /^urn:ard:[a-z]+:[0-9a-f]+$/i.test(u))
          .slice(0, 60),
      })),
  )
}

const FELDER_FOLGE =
  'id title titleClean duration publishDate itemType isPublished image { url url1X1 } audios { url mimeType } audioList { availableFrom availableTo }'

/* ══ DIE BROWSE-REGELN (E79) — Regale, Sammlungen, Suche ════════════════════
 *
 * Wie die Folgen-Regeln aus ard.ts uebernommen, samt der Messungen dahinter:
 *
 *   ALTERSFENSTER  stehen IM TITEL der Sammlung („von 3 bis 6", „ab 5
 *                  Jahren") — von 323 Sammlungen tragen genau ZWEI eine
 *                  Angabe. Deshalb siebt Alter allein nicht; dazu kommt der
 *                  Kinderbezug am Titel, und nichts wird weggeworfen (der
 *                  Schalter `alle=1` zeigt den Rest).
 *   DREI RAENGE    passt / kein Fenster / passt nicht — sonst steht das
 *                  Gesuchte zwischen 300 anderen.
 *   NACHLAUF       wer 7 ist, hoert „3 bis 6" noch: zwei Jahre Toleranz an
 *                  der Obergrenze.
 *   KINDER-REGAL   Kategorie 42914714 ist die von der ARD GEPFLEGTE
 *                  Kinderliste — kein Ratespiel am Titel.
 */
const KINDER_KATEGORIE = '42914714'
const FELDER_SENDUNG = 'id title synopsis numberOfElements image { url url1X1 } publicationService { title }'

function altersfensterAus(titel) {
  const s = String(titel ?? '')
  const passt = (n) => Number.isFinite(n) && n >= 0 && n <= 18
  const spanne = /\bvon\s+(\d{1,2})\s+bis\s+(\d{1,2})\b/i.exec(s)
  if (spanne) {
    const von = Number(spanne[1])
    const bis = Number(spanne[2])
    if (passt(von) && passt(bis) && bis > von) return { von, bis }
  }
  const ab = /\bab\s+(\d{1,2})\s*(?:jahren?|j\.)/i.exec(s)
  if (ab && passt(Number(ab[1]))) return { von: Number(ab[1]), bis: null }
  const kurz = /kinder\s+ab\s+(\d{1,2})\b/i.exec(s)
  if (kurz && passt(Number(kurz[1]))) return { von: Number(kurz[1]), bis: null }
  return null
}

function sammlungPasst(fenster, alter) {
  if (alter === null || !fenster) return true
  if (alter < fenster.von) return false
  if (fenster.bis !== null && alter > fenster.bis + 2) return false
  return true
}

function kinderBezug(titel) {
  const s = String(titel ?? '')
  if (/kinderwunsch|kinderlos|kindesmiss|kinderarmut|kinderschutz/i.test(s)) return false
  return /\bkinder|\bkids\b|kleinkind|vorlese|sandm(ä|ae)nnchen|h(ö|oe)rspiel f(ü|ue)r/i.test(s)
}

/** Eine rohe Sendung in die Form der Box — und ihr data.json-Vorschlag. */
function sendungAus(roh) {
  const kennung = String(roh?.id ?? '').trim()
  if (!kennung) return null
  const s = {
    kennung,
    titel: String(roh?.title ?? '').trim(),
    bild: bildAus(roh?.image),
    herausgeber: String(roh?.publicationService?.title ?? '').trim() || 'ARD Sounds',
  }
  const text = String(roh?.synopsis ?? '').trim()
  if (text) s.text = text.slice(0, 300)
  return s
}

/** Der data.json-Eintrag zu einer Sendung — die EINE Stelle dieser Form. */
function vorschlagAus(s) {
  return { type: 'ard', category: 'audiobook', id: s.kennung, title: s.titel, artist: s.herausgeber, cover: s.bild }
}

/* ══ DIE RADIOSENDER (E84) ══════════════════════════════════════════════════
 *
 * WARUM DAS EIN EIGENER EINSTIEG IST UND KEINE GELOCKERTE SPERRE.
 * `folgenAus()` wirft `EVENT_LIVESTREAM` weiter weg, und das bleibt richtig:
 * ein nicht endender Strom zwischen den Folgen einer Hoerspielreihe ist fuer
 * ein Kind eine Kachel, die niemand mehr ausbekommt
 * ([[ard-items-ohne-ton-und-die-falschen-zahlen]]). Die Sender kommen aus
 * einer ANDEREN Abfrage: `permanentLivestreams` (195 Stueck, gemessen
 * 22.08.2026 mit tools/ard-sender-probe.mjs). Die Sperre wird also nicht
 * aufgeweicht — es kommt eine zweite Sorte daneben.
 *
 * WARUM DER VORSCHLAG `type: 'radio'` TRAEGT UND NICHT `'ard'`.
 * `artVon()` im Kern (werke.ts) bildet `dienst === 'ard'` UNBEDINGT auf
 * `'show'` ab — „eine Folge nach der anderen". Ein Sender ist das nicht, und
 * die Oberflaeche erwartete hinter der Kachel eine Folgenliste, die es nie
 * geben wird. `'radio'` ist die Art, die der Kern fuer „laeuft, bis jemand
 * aufhoert" ohnehin hat; sie traegt ihre Adresse in `id`.
 *
 * WARUM HIER DIE ADRESSE GESPEICHERT WIRD, obwohl `aufloesen()` daneben genau
 * das Gegenteil predigt („Kennung speichern, Adresse holen"): jene Regel gilt
 * FOLGEN, und sie gilt dort zu Recht — eine Folge traegt `availableTo` und
 * verschwindet. Ein Sender hat kein Ablaufdatum; seine Adresse ist die
 * oeffentliche Icecast-Adresse der Anstalt. Die Regel umzudrehen hiesse, fuer
 * jeden Senderdruck eine GraphQL-Abfrage zu verlangen — und der Kern fragt
 * fuer `radio` gar kein Plugin, das ginge nur mit einer Kernaenderung.
 * Wandert eine Adresse doch einmal, wird der Sender neu hinzugefuegt.
 */
const SENDER_FELDER = 'id title image { url url1X1 } audios { url mimeType } publicationService { title }'

/** Wie viele Sender die ARD kennt, mit Luft nach oben (gemessen: 195). */
const SENDER_GRENZE = 400

function senderAus(roh) {
  const kennung = String(roh?.id ?? '').trim()
  const titel = String(roh?.title ?? '').trim()
  // OHNE TON KEIN SENDER. Ein Eintrag ohne abspielbare Adresse waere eine
  // Kachel, die beim Druck nichts tut — schlimmer als eine fehlende Kachel.
  const adresse = tonAus(roh)
  if (!kennung || !titel || !adresse) return null
  return {
    kennung,
    titel,
    adresse,
    bild: bildAus(roh?.image),
    herausgeber: String(roh?.publicationService?.title ?? '').trim() || 'ARD Sounds',
  }
}

/** Der data.json-Eintrag zu einem Sender — die Adresse steht in `id`. */
function senderVorschlagAus(s) {
  return { type: 'radio', category: 'music', id: s.adresse, title: s.titel, artist: s.herausgeber, cover: s.bild }
}

/** Alle Sender, 15 Minuten gemerkt — 195 Stueck sind eine Abfrage wert, nicht zwanzig. */
async function senderHolen(kontext) {
  const da = gemerkt('sender')
  if (da) return da
  const { daten } = await fragen(
    kontext,
    `query($n:Int){ permanentLivestreams(first:$n){ nodes { ${SENDER_FELDER} } } }`,
    { n: SENDER_GRENZE },
  )
  return merken('sender', (daten?.permanentLivestreams?.nodes ?? []).map(senderAus).filter(Boolean))
}

/** 15-Minuten-Zwischenspeicher im Worker — er lebt, bis das Plugin neu startet. */
const speicher = new Map()

/**
 * TESTNAHT: den Zwischenspeicher leeren.
 *
 * Der Speicher ist eine Modulvariable und ueberlebt damit zwischen den
 * Zeugen eines Specs — der Kinderbezug-Zeuge bekam die Sammlungen des
 * VORIGEN Zeugen serviert (22.08.2026). Im Betrieb ruft das niemand; der
 * Worker-Neustart leert ohnehin.
 */
export function zwischenspeicherLeeren() {
  speicher.clear()
}
function gemerkt(schluessel) {
  const e = speicher.get(schluessel)
  return e && Date.now() < e.bis ? e.wert : null
}
function merken(schluessel, wert) {
  speicher.set(schluessel, { wert, bis: Date.now() + 15 * 60_000 })
  return wert
}

export default {
  /**
   * Eine Sendung zu ihrer geordneten Folgenliste (E78).
   *
   * rest: `<sendungskennung>` oder `<sendungskennung>#aelteste`. Die
   * Reihenfolge reist hinter `#` wie beim Podcast-Plugin die Folgennummer;
   * WER sie wuenscht, entscheidet der Kern (er kennt den data.json-Eintrag),
   * WAS sie bedeutet, entscheidet dieses Plugin.
   */
  async inhalt(rest, kontext) {
    if (!kontext.holen) throw new Error('Das Recht `netz` fehlt.')
    const [kennung, wunsch] = String(rest).split('#', 2)
    if (!kennung) throw new Error('keine Sendungskennung')
    const richtung = wunsch === 'aelteste' ? 'aelteste' : 'neueste'
    const { daten } = await fragen(
      kontext,
      `query($id:ID!, $n:Int){ programSet(id:$id){ id title publicationService { title } items(first:$n, orderBy:PUBLISH_DATE_DESC, condition:{isPublished:true}){ nodes { ${FELDER_FOLGE} } } } }`,
      { id: kennung, n: FOLGEN_GRENZE },
    )
    const sendung = daten?.programSet
    if (!sendung) throw new Error(`Sendung ${kennung} ist der ARD unbekannt`)
    const roh = sendung.items?.nodes ?? []
    return {
      titel: String(sendung.title ?? '').trim() || kennung,
      // Ohne Anstalt bleibt das Feld unter der Kachel leer — dann steht dort
      // lieber der Name des Dienstes als gar nichts (Regel aus ard.ts).
      kuenstler: String(sendung.publicationService?.title ?? '').trim() || 'ARD Sounds',
      // LEER IST EIN ERGEBNIS: eine Sendung kann gerade ohne abrufbare Folge
      // dastehen (alles abgelaufen). Das ist die Wahrheit, kein Fehler.
      folgen: folgenAus(roh, richtung, Date.now()),
      vollstaendig: roh.length < FOLGEN_GRENZE,
    }
  },

  /**
   * EINE Folge — der Weg direkt vor dem Abspielen. rest: `<folgenkennung>`.
   * Kennung speichern, Adresse holen: zwischen dem Anlegen der Kachel und dem
   * Druck des Kindes koennen Monate liegen, und die Tonadresse laeuft ab.
   */
  async aufloesen(rest, kontext) {
    if (!kontext.holen) throw new Error('Das Recht `netz` fehlt.')
    const kennung = String(rest).split('#', 1)[0]
    const { daten } = await fragen(
      kontext,
      `query($id:ID!){ item(id:$id){ ${FELDER_FOLGE} programSet { title } } }`,
      { id: kennung },
    )
    const roh = daten?.item
    const [folge] = folgenAus(roh ? [roh] : [], 'neueste', Date.now())
    if (!folge) throw new Error(`Folge ${kennung} ist nicht (mehr) abspielbar`)
    return {
      titel: {
        name: folge.name,
        kuenstler: String(roh?.programSet?.title ?? '').trim() || undefined,
        bild: folge.bild,
        dauerSek: folge.dauerSek,
      },
      quelle: folge.quelle,
    }
  },

  /**
   * Ein Satz fuer die Karte: ist die ARD von dieser Box aus erreichbar?
   *
   * BEWUSST EINE ECHTE, KLEINE PROBE und kein gemerkter Zustand — die Karte
   * fragt selten (beim Oeffnen der Seite), und eine Auskunft, die nur einen
   * alten Speicher wiedergibt, hat am 22.08.2026 schon zweimal in die Irre
   * gefuehrt ([[auskunft-aus-fremdem-zwischenspeicher]]).
   */
  async befinden(kontext) {
    if (!kontext.holen) return { ok: false, text: 'Das Recht `netz` fehlt — ohne es gibt es nichts zu fragen.' }
    try {
      const { daten, ms } = await fragen(kontext, 'query{ editorialCategories(first:1){ nodes { id } } }')
      const da = Array.isArray(daten?.editorialCategories?.nodes)
      return da
        ? { ok: true, text: `ARD Sounds antwortet (${ms} ms). Ohne Schlüssel, wie immer.` }
        : { ok: false, text: 'ARD antwortet, aber nicht in der erwarteten Form.' }
    } catch (f) {
      return { ok: false, text: `ARD nicht erreichbar: ${f.message}` }
    }
  },

  /**
   * Der Knopf aus dem Manifest. Nur angemeldete Kennungen kommen an —
   * der Wirt prueft gegen `aktionen`, bevor er ruft.
   */
  async aktion(kennung, kontext) {
    if (kennung !== 'pruefen') return { ok: false, text: `Unbekannte Aktion "${kennung}".` }
    if (!kontext.holen) return { ok: false, text: 'Das Recht `netz` fehlt.' }
    const zeiten = []
    for (let i = 0; i < 3; i++) {
      try {
        const { ms } = await fragen(kontext, 'query{ editorialCategories(first:1){ nodes { id } } }')
        zeiten.push(ms)
      } catch (f) {
        return { ok: false, text: `Anfrage ${i + 1} von 3 scheiterte: ${f.message}` }
      }
    }
    const schnitt = Math.round(zeiten.reduce((a, b) => a + b, 0) / zeiten.length)
    return { ok: true, text: `Dreimal gefragt: ${zeiten.join(', ')} ms — Mittel ${schnitt} ms.` }
  },

  /**
   * Die freie Flaeche unter /api/plugins/mixpi-ardsounds/http/… (E79).
   *
   * Sechs Pfade — das komplette Stoebern der Verwaltung:
   *   kategorien                    die redaktionellen Regale
   *   kategorie/<id>                ein Regal, mit data.json-Vorschlag je Sendung
   *   sammlungen?alter=&alle=1     Sammlungen, nach Alter gesiebt und gereiht
   *   sammlung/<id>                 der Inhalt einer Sammlung
   *   suche?q=&anzahl=              Sendungssuche mit Vorschlag
   *   sender?q=                     die Radiosender (E84), Vorschlag als `radio`
   *
   * `schonDa` FEHLT MIT ABSICHT: ob eine Sendung schon in der Bibliothek
   * steht, weiss die Bibliothek — die Verwaltungsseite rechnet es aus ihren
   * eigenen Eintraegen. Ein Plugin, das die Medienliste liest, waere ein
   * Plugin mit Kern-Wissen. Und das PROFIL-Alter kommt als Zahl herein
   * (`?alter=7`): WER 7 ist, weiss der Kern, WAS 7 bedeutet, dieses Plugin.
   */
  async http(anfrage, kontext) {
    if (anfrage.methode !== 'GET') return { status: 405, inhalt: { fehler: 'nur GET' } }
    if (!kontext.holen) return { status: 502, inhalt: { fehler: 'Das Recht `netz` fehlt.' } }
    const pfad = anfrage.pfad
    try {
      if (pfad === 'kategorien') {
        const regale =
          gemerkt('kategorien') ??
          merken(
            'kategorien',
            (
              await fragen(kontext, 'query($n:Int){ editorialCategories(first:$n){ nodes { id title } } }', { n: 60 })
            ).daten?.editorialCategories?.nodes
              ?.filter((n) => n?.id && n?.title)
              ?.map((n) => ({ id: String(n.id), titel: String(n.title), fuerKinder: String(n.id) === KINDER_KATEGORIE })) ?? [],
          )
        return { inhalt: { kategorien: regale } }
      }

      if (pfad.startsWith('kategorie/')) {
        const kennung = pfad.slice('kategorie/'.length).replace(/[^0-9]/g, '')
        if (!kennung) return { status: 404, inhalt: { fehler: 'keine Kategorie angegeben' } }
        const { daten } = await fragen(
          kontext,
          `query($id:ID!, $n:Int){ editorialCategory(id:$id){ programSets(first:$n){ nodes { ${FELDER_SENDUNG} } } } }`,
          { id: kennung, n: 400 },
        )
        const sendungen = (daten?.editorialCategory?.programSets?.nodes ?? []).map(sendungAus).filter(Boolean)
        return {
          inhalt: {
            kategorie: kennung,
            fuerKinder: kennung === KINDER_KATEGORIE,
            sendungen: sendungen.map((s) => ({ ...s, vorschlag: vorschlagAus(s) })),
          },
        }
      }

      if (pfad === 'sender') {
        /* GESIEBT WIRD HIER, NICHT IN DER ABFRAGE. `permanentLivestreams`
         * nimmt zwar `filter` an, aber 195 Saetze sind eine einzige Abfrage
         * wert — gemerkt fuer 15 Minuten, danach kostet jede Suche nichts.
         * Der Weg ueber `filter` haette je Tastendruck eine Abfrage gemacht. */
        const alle = await senderHolen(kontext)
        const suche = String(anfrage.abfrage.q ?? '').trim().toLowerCase()
        const passend = suche
          ? alle.filter((s) => `${s.titel} ${s.herausgeber}`.toLowerCase().includes(suche))
          : alle
        return {
          inhalt: {
            gesamt: alle.length,
            sender: passend
              .map((s) => ({ ...s, vorschlag: senderVorschlagAus(s) }))
              .sort((a, b) => a.titel.localeCompare(b.titel, 'de')),
          },
        }
      }

      if (pfad === 'sammlungen') {
        const alterRoh = Number(anfrage.abfrage.alter)
        const alter = Number.isFinite(alterRoh) && anfrage.abfrage.alter !== '' ? alterRoh : null
        const alleZeigen = anfrage.abfrage.alle === '1'
        const alle = await sammlungenHolen(kontext)
        // Leere Sammlungen gar nicht erst anbieten — eine Kachel ohne Deckung.
        let brauchbar = alle.filter((s) => s.anzahl > 0)
        const gesamt = brauchbar.length
        if (alter !== null && !alleZeigen) {
          brauchbar = brauchbar.filter((s) => (s.fenster ? sammlungPasst(s.fenster, alter) : kinderBezug(s.titel)))
        }
        const rang = (s) => (alter === null ? 1 : s.fenster ? (sammlungPasst(s.fenster, alter) ? 0 : 2) : 1)
        return {
          inhalt: {
            gefiltert: alter !== null && !alleZeigen,
            gesamt,
            sammlungen: brauchbar
              .map((s) => ({ ...s, passt: sammlungPasst(s.fenster, alter) }))
              .sort((a, b) => rang(a) - rang(b) || a.titel.localeCompare(b.titel, 'de')),
          },
        }
      }

      if (pfad.startsWith('sammlung/')) {
        const kennung = pfad.slice('sammlung/'.length).replace(/[^0-9]/g, '')
        if (!kennung) return { status: 404, inhalt: { fehler: 'keine Sammlung angegeben' } }
        /* DIE URNS KOMMEN AUS DER LISTEN-ABFRAGE, nicht aus der Einzel-Abfrage.
         *
         * Am 22.08.2026 gemessen: `editorialCollection(id:…)` liefert
         * `document: null` — fuer DIESELBE Sammlung, fuer die die Liste
         * `editorialCollections` ein volles document mit teasers traegt. Der
         * alte Kern-Weg nutzte die Einzel-Abfrage und war damit still kaputt:
         * Titel ja, Sendungen leer, kein Fehler. Seitdem die ARD das Feld dort
         * nicht mehr fuellt, ist die Liste die einzige Quelle. */
        const sammlungen = await sammlungenHolen(kontext)
        const eintrag = sammlungen.find((s) => s.id === kennung)
        const urns = eintrag?.urns ?? []
        const c = { title: eintrag?.titel ?? '' }
        const sendungen = new Map()
        if (urns.length) {
          const teile = urns.map((u, i) => `t${i}: itemByCoreId(coreId: "${u}") { programSet { id title synopsis } }`)
          const { daten: teaser } = await fragen(kontext, `{ ${teile.join(' ')} }`)
          for (const wert of Object.values(teaser ?? {})) {
            const ps = wert?.programSet
            if (!ps?.id || !ps?.title) continue
            // Dieselbe Sendung steht oft mit mehreren Folgen drin — die Box
            // kennt Sendungen, keine Folgen: einmal je Sendung.
            if (!sendungen.has(String(ps.id))) {
              sendungen.set(String(ps.id), {
                id: String(ps.id),
                titel: String(ps.title),
                text: String(ps.synopsis ?? '').slice(0, 300),
              })
            }
          }
        }
        return { inhalt: { titel: String(c?.title ?? ''), sendungen: [...sendungen.values()] } }
      }

      if (pfad === 'suche') {
        const q = String(anfrage.abfrage.q ?? '').trim()
        if (!q) return { status: 400, inhalt: { fehler: 'kein Suchbegriff' } }
        const anzahl = Math.min(50, Math.max(1, Number(anfrage.abfrage.anzahl) || 10))
        const { daten } = await fragen(
          kontext,
          `query($q:String, $n:Int){ search(query:$q, limit:$n, type:All){ programSets { totalCount nodes { ${FELDER_SENDUNG} } } } }`,
          { q, n: anzahl },
        )
        const such = daten?.search
        const sendungen = (such?.programSets?.nodes ?? []).map(sendungAus).filter(Boolean)
        return {
          inhalt: {
            sendungen: sendungen.map((s) => ({ ...s, vorschlag: vorschlagAus(s) })),
            // ALS BEHAUPTUNG weitergereicht, nicht als Wahrheit — die Zahlen
            // der Schnittstelle lagen gemessen um Faktor 5,4 daneben.
            behauptet: Number(such?.programSets?.totalCount) || 0,
          },
        }
      }

      return { status: 404, inhalt: { fehler: `kein Pfad "${pfad}"` } }
    } catch (f) {
      return { status: 502, inhalt: { fehler: f.message } }
    }
  },
}
