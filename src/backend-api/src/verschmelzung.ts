/**
 * Verschmelzung — dasselbe Werk aus mehreren Diensten, EINE Kachel.
 *
 * REINE REGEL: kein Netz, kein Dateisystem, kein express, keine Uhr. Herein
 * kommen fertige Werke (werke.ts) und eine GEGEBENE Zuordnung, heraus kommt
 * die Liste, die eine Oberflaeche anzeigt. Genau deshalb liegt sie hier und
 * nicht im Server: dort laege sie hinter einem Netzaufruf und waere nur am
 * lebenden Geraet pruefbar — dieselbe Begruendung wie bei kinderzeit.ts.
 *
 * SIE ERFINDET KEINE ZUORDNUNG. Wer entscheidet, dass zwei Eintraege dasselbe
 * Album sind, ist eine andere Frage; sie hat mit `gruppiereTreffer()`
 * (medien.ts, Stufe 1 des Wissenspakets [quellen-verschmelzen]) bereits eine
 * getestete Antwort, und ab Stufe 2 kaeme der Fingerabdruck dazu. Hier wird
 * eine solche Antwort nur VERBRAUCHT. Beides in eine Datei zu legen hiesse,
 * die teure und fehleranfaellige Erkennung mit der billigen, immer gleichen
 * Aufloesung zu vermengen — und man koennte die Aufloesung nicht mehr pruefen,
 * ohne vorher etwas zu erkennen.
 *
 * WARUM DIE REGEL VOR DEN DATEN GEBAUT WIRD (gemessen 2026-08-02, nur lesend
 * per ssh): der Katalog der Box traegt 22 Eintraege — 21 spotify, 1 jellyfin,
 * 0 lokal. Die UEBERSCHNEIDUNG ZWISCHEN DEN DIENSTEN IST HEUTE NULL, es gibt
 * also nichts zu verschmelzen. Ohne Zuordnungen ist diese Datei deshalb
 * absichtlich ein Nichtstuer: sie ordnet nur die Quellen und gibt die Liste
 * unveraendert zurueck. Nachmessen laesst sich das jederzeit mit
 * tools/quellen-ueberschneidung.mjs.
 *
 * ZWEI DINGE, DIE HIER BEWUSST GETRENNT BLEIBEN:
 *
 *   `schluessel` ist IDENTITAET.  Daran haengen Verlauf (gespielt.json),
 *      Weiterhoeren (resume.json), Favoriten und die Bildadresse. Er kommt
 *      vom fuehrenden Werk der Zuordnung und aendert sich NICHT, wenn eine
 *      Quelle dazukommt — sonst verloere die Box ihren Verlauf genau in dem
 *      Moment, in dem jemand ein Album zusaetzlich lokal ablegt.
 *   `quellen` ist BEVORZUGUNG.  Die Reihenfolge sagt, WOMIT gespielt wird.
 *      Sie darf sich jederzeit aendern, ohne dass irgendetwas verlorengeht.
 *
 * WAS DIESE STUFE NICHT KANN, und das gehoert benannt statt still angenommen:
 * REGEL 1 des Wissenspakets [quellen-verschmelzen] — „gibt es EINE Quelle, die
 * das GANZE Album hat, nimm die, auch wenn eine hoeher priorisierte nur Teile
 * hat" — braucht Verfuegbarkeit JE TITEL (`titel[].da`). `Werk` fuehrt heute
 * nur Quellen auf WERKEBENE, also weiss hier niemand, ob eine Quelle das Album
 * vollstaendig hat. Die Regel gehoert in genau diesen Baustein, aber erst dann.
 * Bis dahin gilt die Reihenfolge stur — und weil ein Quellenwechsel 1-2 s
 * Stille kostet (gemessen, Wissenspaket [dienste-umschalten]), wird ein Album
 * ohnehin aus EINER Quelle gespielt.
 */
import type { Quelle, Werk } from './werke'

/** Dieselben Namen wie `dienstVon()` — keine zweite Liste. */
export type Dienst = Quelle['dienst']

/**
 * Welche Quelle gewinnt, wenn es dasselbe Werk mehrfach gibt.
 *
 * NICHT GESCHMACK, SONDERN ABSICHERUNG. An EINEM Tag (2026-07-27/28) fiel
 * Spotify auf DREI unabhaengige Arten aus: die Web-API beantwortete
 * Browser-Aufrufe nicht mehr (403), das Web-SDK bekam seinen Tonabruf
 * verweigert (403 storage-resolve), und librespot war zu alt, worauf jeder
 * Titel „not available" meldete. Jellyfin und lokal fielen an dem Tag KEIN
 * EINZIGES MAL aus; Jellyfin lieferte die Originaldatei beim ersten Versuch.
 * Dazu bauartbedingt: Spotify braucht Premium, Netz und ein aktives Konto.
 *
 * Spotify ist damit die ENTDECKUNGS-Schicht, nicht das Archiv. Die Vorgabe
 * steht so im Wissenspaket [quellen-verschmelzen] Punkt 7 („Reihenfolge
 * lokal -> jellyfin -> spotify") und ist dort begruendet, nicht geraten.
 *
 * RADIO, RSS UND `anderes` STEHEN ABSICHTLICH NICHT DRIN: sie sind keine
 * Ausgabe DESSELBEN Werks, sondern eigene Dinge (ein Stream ist kein Album).
 * Sie sortieren deshalb ans Ende — siehe `rang()`.
 *
 * UND `ard` AUCH NICHT — die Frage wurde beim Bau von E4/A5 gestellt
 * (04.08.2026) und hier beantwortet, statt sie offen zu lassen:
 *
 *   1. Es gibt nichts zu verschmelzen. Verschmolzen wird DASSELBE Werk aus
 *      zwei Diensten. Eine ARD-Kachel ist eine SENDUNG mit rollender
 *      Folgenliste, kein Album — und die ARD liefert kein Merkmal, an dem sie
 *      dasselbe waere wie ein lokales Album. Allein auf Interpret+Titel zu
 *      verschmelzen verbietet das Wissenspaket [quellen-verschmelzen]
 *      ausdruecklich.
 *   2. Selbst wenn: sie duerfte nie VORNE stehen. Die ARD ist die einzige
 *      Quelle, deren Adresse zwischen dem Auflisten und dem Antippen ablaufen
 *      kann (`availableTo`, an Folge 16657073 mit 404 belegt). Eine Quelle mit
 *      Verfallsdatum vor ein lokales Archiv zu setzen waere genau die
 *      Umkehrung des Grundes, aus dem diese Liste ueberhaupt existiert.
 *
 * NACHGEPRUEFT AM 05.08.2026, beim Anschliessen der Folgen-Lane und des
 * Weiterhoerens (BACKLOG E4/A10) — die beiden Punkte tragen weiter, und die
 * Arbeit hat einen DRITTEN geliefert:
 *
 *   3. `quellen[0]` entscheidet nicht nur, WOMIT gespielt wird, sondern auch,
 *      in welcher Einheit die gemerkte Stelle herausgeht (`fortsetzenMit` in
 *      weiterhoeren.ts). Die EINHEIT rechnet der Server um — die FOLGENKENNUNG
 *      einer ARD-Stelle (`resumeardfolge`) ist ausserhalb der ARD aber
 *      bedeutungslos. Eine verschmolzene Kachel, deren bevorzugte Quelle
 *      wechselt, verloere ihre Stelle also STILL: die Zeile bliebe stehen, der
 *      Tipp finge von vorn an. Und Punkt 1 wird dadurch schaerfer statt
 *      schwaecher — dass die Folgenliste ROLLT, ist genau der Grund, warum es
 *      kein Merkmal gibt, an dem eine Folge dasselbe waere wie ein Titel eines
 *      lokalen Albums.
 *
 * `rang()` sortiert Unbekanntes ohnehin ans Ende — das gewuenschte Verhalten
 * gibt es also umsonst. Erst wenn die Reihenfolge einstellbar wird, braucht
 * `ard` einen Platz in einer Liste: naemlich den letzten.
 */
export const QUELLEN_REIHENFOLGE: readonly Dienst[] = ['lokal', 'jellyfin', 'spotify']

/**
 * Woher eine Zuordnung stammt. Sie REIST MIT, sie wird nicht nachtraeglich
 * erschlossen: das Wissenspaket verlangt ausdruecklich, dass die Verwaltung
 * „verbunden per Fingerabdruck" anzeigen kann statt eines Orakels. Wer eine
 * falsche Zusammenfassung sieht, muss erkennen koennen, WER sie behauptet hat.
 */
export const STUFEN = ['hand', 'locker', 'fingerabdruck', 'acoustid'] as const
export type Stufe = (typeof STUFEN)[number]

export function istStufe(s: unknown): s is Stufe {
  return typeof s === 'string' && (STUFEN as readonly string[]).includes(s)
}

/** „Diese Werke sind dasselbe." Eine Behauptung, keine Erkennung. */
export interface Zuordnung {
  /** Das FUEHRENDE Werk: seine Identitaet (Schluessel, Bild, Titel) bleibt. */
  schluessel: string
  /** Die Schluessel, die darin aufgehen. */
  auch: string[]
  /** Wer das behauptet — siehe `STUFEN`. */
  stufe: Stufe
}

/**
 * Ein Werk, in dem mehrere aufgegangen sind.
 *
 * ERWEITERT `Werk`, statt dessen Form zu aendern: eine Oberflaeche, die die
 * Zusatzfelder nicht kennt, zeigt weiterhin genau das Richtige. Die Felder
 * fehlen an unverschmolzenen Werken ganz — `undefined` heisst hier „nichts
 * verschmolzen", nicht „unbekannt".
 */
export interface VerschmolzenesWerk extends Werk {
  /** Die Schluessel, die in diesem Werk aufgegangen sind. */
  auchSchluessel?: string[]
  /** Wer die Zusammenfassung behauptet hat. */
  stufe?: Stufe
}

export interface VerschmelzOptionen {
  /** Abweichende Bevorzugung. Leer oder fehlend = `QUELLEN_REIHENFOLGE`. */
  reihenfolge?: readonly Dienst[]
  /** Abweichende Metadaten-Bevorzugung. Leer oder fehlend = `METADATEN_REIHENFOLGE`. */
  metadaten?: readonly Dienst[]
}

/* ══ ZWEI REIHENFOLGEN, UND SIE ZEIGEN IN VERSCHIEDENE RICHTUNGEN (E85) ══════
 *
 * Betreiber, 22.08.2026: „interpret, album, titel gehören der box, die meta
 * infos auch. und setzen sich aus den anbieter infos zusammen. ich würde
 * hauptsächlich spotify als nr 1 quelle bevorzugen."
 *
 * DAS WIDERSPRICHT `QUELLEN_REIHENFOLGE` NICHT, es ist eine ANDERE FRAGE.
 * Oben steht ausführlich begründet, warum zum ABSPIELEN lokal vor jellyfin
 * vor spotify kommt: Spotify fiel an einem Tag auf drei unabhängige Arten
 * aus, braucht Premium, Netz und ein aktives Konto. Das ist Absicherung gegen
 * AUSFALL.
 *
 * Beim BESCHRIFTEN gibt es keinen Ausfall. Fällt Spotify aus, ist der Titel
 * längst geschrieben; er steht in der Ablage der Box und wird nicht erneut
 * geholt. Und dort ist Spotify die gepflegteste Quelle: einheitliche
 * Schreibweise, richtige Umlaute, ein Cover in guter Auflösung — während eine
 * lokale Datei trägt, was ihr Tagger hinterlassen hat, und die ARD den
 * Anstaltsnamen als Interpret führt („WDR" statt „Quarks").
 *
 * ZWEI ACHSEN, ZWEI LISTEN. Sie zusammenzulegen hiesse, eine der beiden
 * Begründungen aufzugeben — und beide sind gemessen.
 */
export const METADATEN_REIHENFOLGE: readonly Dienst[] = ['spotify', 'jellyfin', 'lokal']

/** Was eine verschmolzene Kachel beschriftet — und woher das Bild kommt. */
export interface Metadaten {
  titel: string
  interpret?: string
  bild: string
}

/**
 * Titel, Interpret und Bild aus den Mitgliedern zusammensetzen.
 *
 * FELDWEISE, NICHT WERKWEISE. Der beste Titel und das beste Bild müssen nicht
 * aus derselben Quelle kommen: die ARD kennt oft den ausführlicheren Titel
 * („Quarks Science Cops"), Spotify das bessere Cover. Jedes Feld sucht sich
 * deshalb einzeln den ersten Mitgliedseintrag, der es überhaupt trägt.
 *
 * DIE IDENTITÄT BLEIBT UNBERÜHRT. `schluessel` steht hier nicht — an ihm
 * hängen Verlauf, Weiterhören und Favoriten, und er kommt weiterhin vom
 * führenden Werk. Beschriftung darf wandern, Identität nicht. Das `bild` ist
 * die eine Ausnahme, die wie eine Identität AUSSIEHT: es ist ein Weg über die
 * Box (`/api/bild/<schluessel>`), zeigt aber nach der Verschmelzung auf den
 * Schlüssel des Mitglieds, dessen Cover gewonnen hat — sonst müsste man die
 * Bytes umkopieren, um ein Bild zu wechseln.
 *
 * OHNE `hatBild` WIRD NICHT GEWECHSELT. Ein Mitglied ohne Cover würde die
 * Kachel auf einen 404 zeigen lassen, also auf ihren Anfangsbuchstaben — ein
 * vorhandenes Bild gegen keines zu tauschen wäre eine Verschlechterung, die
 * wie ein Fehler aussieht.
 */
export function metadatenVerschmelzen(
  mitglieder: readonly Werk[],
  reihenfolge: readonly Dienst[] = METADATEN_REIHENFOLGE,
): Metadaten | null {
  const echte = (Array.isArray(mitglieder) ? mitglieder : []).filter((w) => w && typeof w === 'object')
  if (!echte.length) return null
  // Nach der Metadaten-Bevorzugung ordnen — der Rang kommt vom ERSTEN
  // (bevorzugten) Dienst des Werks, denn genau der hat es beschriftet.
  const geordnet = [...echte].sort(
    (a, b) => rang(a.quellen?.[0]?.dienst, reihenfolge) - rang(b.quellen?.[0]?.dienst, reihenfolge),
  )
  const ersterMit = <T>(nimm: (w: Werk) => T | undefined | ''): T | undefined => {
    for (const w of geordnet) {
      const x = nimm(w)
      if (x) return x
    }
    return undefined
  }
  const titel = ersterMit((w) => String(w.titel ?? '').trim())
  const interpret = ersterMit((w) => String(w.interpret ?? '').trim())
  const bildWerk = geordnet.find((w) => w.hatBild)
  const aus: Metadaten = {
    // LEER GIBT ES NICHT: hat kein Mitglied einen Titel, bleibt der des
    // führenden Werks stehen — eine Kachel ohne Beschriftung ist auf der Box
    // nicht wiederzufinden.
    titel: titel || String(echte[0].titel ?? ''),
    bild: (bildWerk ?? echte[0]).bild,
  }
  if (interpret) aus.interpret = interpret
  return aus
}

/**
 * Der Platz eines Dienstes in der Bevorzugung.
 *
 * Ein UNBEKANNTER Dienst sortiert ans Ende, statt zu werfen. Grund: die
 * Reihenfolge ist kuenftig einstellbar (Wissenspaket, Konfigseite in der
 * Verwaltung), und eine Liste, in der jemand einen Dienst vergessen hat, darf
 * nicht die ganze Startseite kosten. Ans Ende heisst: er kommt dran, wenn
 * sonst keiner kann — das ist immer noch besser als gar nicht.
 */
export function rang(dienst: unknown, reihenfolge: readonly Dienst[] = QUELLEN_REIHENFOLGE): number {
  const r = reihenfolge.length ? reihenfolge : QUELLEN_REIHENFOLGE
  const i = (r as readonly string[]).indexOf(String(dienst ?? ''))
  return i >= 0 ? i : r.length
}

/**
 * Hat diese Quelle das GANZE Werk? — REGEL 1 aus E17/V6.
 *
 * WER NICHTS SAGT, HAT ALLES. Ein Streamingdienst fuehrt keine Zahlen mit;
 * fuer ihn ist die Frage bedeutungslos, und `undefined` heisst hier
 * ausdruecklich „vollstaendig", nicht „unbekannt". Nur so bleibt jedes
 * bestehende Werk unveraendert.
 *
 * Gefragt wird NICHT nach einem Anteil. „Fast ganz" gibt es nicht: ein Album,
 * dem ein Titel fehlt, ist beim Anhoeren ein Album, dem ein Titel fehlt.
 */
export function istGanz(q: Quelle | null | undefined): boolean {
  const gesamt = Number(q?.titelGesamt ?? 0)
  if (!(gesamt > 0)) return true
  const da = Number(q?.titelDa ?? 0)
  return da >= gesamt
}

/**
 * Die Quellen eines Werks in die Bevorzugung bringen.
 *
 * ZWEI STUFEN, und die erste ist die wichtigere:
 *
 *   1. VOLLSTAENDIGKEIT. Eine Quelle mit dem ganzen Werk schlaegt eine
 *      unvollstaendige — auch wenn die unvollstaendige hoeher steht. Das ist
 *      REGEL 1 aus E17/V6, und ohne sie kehrt sich die Bevorzugung ins
 *      Gegenteil: sobald lokale Mitschnitte dazukommen, verdraengte ein halbes
 *      Album das ganze, und auf der gewohnten Kachel blieben drei Lieder von
 *      zwoelf uebrig. Ein Kind, dem sein Album abhanden kommt, weil die Box
 *      „naeher dran" war, versteht diese Begruendung nicht.
 *   2. Erst DANN der Rang (lokal vor jellyfin vor spotify).
 *
 * STABIL: gleichrangige Quellen behalten ihre Reihenfolge (`Array.sort` ist
 * seit ES2019 stabil). Das ist kein Detail — bei zwei Quellen desselben
 * Dienstes entschiede sonst der Zufall, welche gespielt wird.
 *
 * Gibt IMMER eine neue Liste zurueck; die Eingabe bleibt unberuehrt.
 */
export function quellenOrdnen(
  quellen: Quelle[] | undefined,
  reihenfolge: readonly Dienst[] = QUELLEN_REIHENFOLGE,
): Quelle[] {
  const q = (Array.isArray(quellen) ? quellen : []).filter((x) => x && typeof x === 'object')
  return [...q].sort((a, b) => {
    const ganzA = istGanz(a) ? 0 : 1
    const ganzB = istGanz(b) ? 0 : 1
    if (ganzA !== ganzB) return ganzA - ganzB
    return rang(a.dienst, reihenfolge) - rang(b.dienst, reihenfolge)
  })
}

/*
 * DIE QUELLE, MIT DER GESPIELT WERDEN SOLL — und warum es dafuer seit dem
 * 19.09.2026 keine eigene Funktion mehr gibt (AUDIT-2026-09-19 Rang 7).
 *
 * Die Frage wird HIER beantwortet und nicht im Abspieldienst:
 * `spotify-control.ts` verzweigt nur nach dem VERB der Adresse (`library/`,
 * `jellyfin/`, `spotify:` …) — der Dienst waehlt nichts, er fuehrt aus.
 * Entschieden wird dort, wo der Befehl ENTSTEHT: seit E95/V `startPlan` in
 * spielfunktion.ts, und das nimmt `quellen[0]`.
 *
 * GENAU DARAN ist `bevorzugteQuelle(quellen)` gestorben: weil
 * `verschmelzeWerke()` die Quellen bereits geordnet ablegt, IST `quellen[0]`
 * die Antwort. Acht Stellen im Baum nehmen sie direkt so; die Huelle, die
 * noch einmal ordnet und dann `[0]` nimmt, rief keine davon. Ihre Spec ist
 * nicht mitgestorben, sondern auf `quellenOrdnen(...)[0]` umgeschrieben —
 * geprueft wurde dort die ORDNUNG, und die lebt.
 *
 * `[0] ?? null` statt eines Notbehelfs: ein Werk ohne Quelle hat keinen
 * Abspielweg, und einen zu erfinden startete im besten Fall nichts und im
 * schlimmsten das Falsche.
 */

/**
 * EIN Versuch aus `GET /api/werke/:schluessel/inhalt` — dieselbe Form wie
 * `InhaltAntwort` in server.ts, hier aber STRUKTURELL beschrieben statt von
 * dort importiert: diese Datei bleibt frei von jedem Bezug auf server.ts,
 * genau wie der Dateikopf es verlangt („kein Netz, kein Dateisystem, kein
 * express, keine Uhr"). TypeScript prueft die Passung trotzdem — server.ts
 * liefert exakt `{status, body}` und erfuellt diese Form von selbst.
 */
export interface InhaltKandidat {
  readonly status: number
  readonly body: Readonly<Record<string, unknown>>
}

/** Titel einer Antwort zaehlen — `0`, wenn `body.titel` fehlt oder keine Liste ist. */
function titelAnzahl(k: InhaltKandidat): number {
  const t = (k.body as { titel?: unknown })?.titel
  return Array.isArray(t) ? t.length : 0
}

/**
 * WELCHE ANTWORT GEWINNT, wenn `/inhalt` ALLE Kandidaten eines verschmolzenen
 * Werks geholt hat, statt beim ersten Erfolg aufzuhoeren — E95 Stufe 1
 * „Vollstaendigkeit schlaegt Reihenfolge".
 *
 * DER MESSFALL, DER DAS NOETIG MACHTE (Betreiber, 29.08.2026 nachts, Album
 * „Nah" von Alin Coen): die lokale Quelle steht in `QUELLEN_REIHENFOLGE`
 * vorn, ihre Mitschnitt-`playlist.m3u` traegt aber nur einen TEIL der Titel —
 * der erste ist als kaputt vermerkt, drei weitere stehen noch auf der
 * Vormerkliste des Mitschnitts. Der alte Rueckfall (server.ts, vor dieser
 * Stufe) nahm den ERSTEN Erfolg und damit die lokale Antwort: die Box zeigte
 * nur die aufgezeichneten Stuecke, obwohl Spotify daneben die volle Liste
 * gehabt haette. Wortwoertlich der Betreiber, Minuten spaeter, an genau
 * diesem Album: „jetzt sehe ich nur die aufgezeichneten titel von nah aber
 * nicht die verfuegbaren von spotify."
 *
 * DIE REGEL, IN DIESER REIHENFOLGE:
 *
 *   1. Die ERSTE erfolgreiche (200er) Antwort mit `body.vollstaendig ===
 *      true`, in der Reihenfolge der Bevorzugung. Zwei Quellen, die beide
 *      "vollstaendig" sagen, werden NICHT nach Titelzahl verglichen — wer
 *      das ganze Werk hat, hat es, unabhaengig davon, wie viele Titel das
 *      sind (ein Hoerspiel mit 8 Kapiteln ist nicht "unvollstaendiger" als
 *      eines mit 12).
 *   2. Sagt KEINE Quelle "vollstaendig", gewinnt die 200er-Antwort mit den
 *      MEISTEN Titeln — bei Gleichstand die FRUEHERE in der Bevorzugung
 *      (die Schleife ersetzt nur bei einer STRENG groesseren Zahl, das haelt
 *      sie stabil). Das ist der eigentliche Kern dieser Stufe: meldet die
 *      bevorzugte Quelle WENIGER Titel als eine andere erfolgreiche, gewinnt
 *      die vollere.
 *   3. Scheitern ALLE, kommt der Fehler der BEVORZUGTEN (ersten) Quelle durch
 *      — dieselbe Antwort, die es ohne diese Wahl gegeben haette. `liste[0]`
 *      genuegt: der Aufrufer uebergibt die Kandidaten in Bevorzugungs-
 *      Reihenfolge, und die erste ist per Definition die bevorzugte.
 *
 * WARUM DER LOKALE ZWEIG HEUTE (server.ts, `inhaltFuerEintrag`) SEIN
 * `vollstaendig` WEGLAESST statt es wie vor dieser Stufe fest auf `true` zu
 * setzen: „die m3u wird ganz gelesen" ist wahr, sagt aber nichts darueber,
 * ob der MITSCHNITT vollstaendig ist — genau umgekehrt, die m3u eines
 * Mitschnitts IST der (moeglicherweise unvollstaendige) aufgezeichnete
 * Bestand. Mit `vollstaendig: true` haette Stufe 1 fuer den Nah-Fall NICHTS
 * geaendert: die lokale Antwort waere weiterhin ueber Stufe 1 gewonnen,
 * unabhaengig von ihrer Titelzahl, und Stufe 2 (der eigentliche Fix) haette
 * nie gegriffen. `undefined` wirft den lokalen Kandidaten also absichtlich
 * auf Stufe 2 zurueck, wo die Titelzahl ihn schlaegt, wenn eine andere Quelle
 * mehr traegt — GENAU DAS BEHEBT DEN MESSFALL. Der Mitschnitt-Befund
 * (Wissenspaket-Stufe 2, `befunde.json`) wird das spaeter praeziser sagen
 * koennen ("N von M Titeln, davon K kaputt"); bis dahin ist "unbekannt" die
 * EHRLICHERE Aussage als ein erfundenes "ganz".
 *
 * EINE LEERE LISTE IST EIN PROGRAMMIERFEHLER DES AUFRUFERS, keine normale
 * Eingabe: `/inhalt` ruft diese Funktion nur, nachdem `eintraegeInBevorzugung`
 * mindestens einen Kandidaten geliefert hat. Ein leeres Array haette also
 * schon vorher den anderen Rueckweg genommen (`eintragZuSchluessel`) — hier
 * anzukommen bedeutet, dass genau das vergessen wurde.
 */
export function waehleInhalt<T extends InhaltKandidat>(kandidaten: readonly T[]): T {
  const liste = Array.isArray(kandidaten) ? kandidaten : []
  if (!liste.length) {
    throw new Error('waehleInhalt: keine Kandidaten - der Aufrufer muss mindestens die bevorzugte Quelle liefern')
  }
  const erfolge = liste.filter((k) => k.status >= 200 && k.status < 300)
  if (!erfolge.length) return liste[0]
  // KEIN VORRANG MEHR FUER `vollstaendig === true` (Kritiker-Lauf 30.08.,
  // AUDIT-2026-08-30 §1.1): Die erste Fassung nahm den ersten Kandidaten mit
  // gesetztem Flag VOR jedem Titelzahl-Vergleich. Der lokale Zweig laesst das
  // Flag aber BEWUSST weg (seine m3u ist der Bestand, nicht das Album), und
  // Spotify meldete es praktisch immer - ein KOMPLETT aufgenommener
  // Mitschnitt (12/12, ohne Flag) verlor damit dauerhaft gegen die
  // Netz-Fassung (12, true). Die Quellenreihenfolge lokal->spotify, gebaut
  // gegen den Dreifachausfall vom 27.07., war fuer genau diesen Fall tot.
  //
  // DIE REGEL SEITHER: die fruehere Reihung gewinnt; ein spaeter gereihter
  // Kandidat uebernimmt NUR, wenn er MEHR Titel liefert. `vollstaendig`
  // bleibt reine Anzeige-Auskunft im Body (die Oberflaeche schreibt "(die
  // neuesten)" daran), entscheidet aber keine Quellwahl mehr.
  //
  // BEKANNTE GRENZE, bis Stufe 2 (befunde.json/titelGesamt): eine
  // Deluxe-Fassung mit Bonustiteln (14) schlaegt das komplette lokale Album
  // (12) weiterhin - erst der Mitschnitt-Befund kann "komplett" von "mehr
  // ist verfuegbar" unterscheiden.
  let bester = erfolge[0]
  let besteAnzahl = titelAnzahl(bester)
  for (let i = 1; i < erfolge.length; i++) {
    const anzahl = titelAnzahl(erfolge[i])
    if (anzahl > besteAnzahl) {
      bester = erfolge[i]
      besteAnzahl = anzahl
    }
  }
  return bester
}

/**
 * WO EIN GESCHLUCKTER SCHLUESSEL JETZT WOHNT — die Bruecke fuer alles, was
 * sich einen Schluessel GEMERKT hat.
 *
 * DAS IST DIE ANDERE HAELFTE DER TRENNUNG oben. `schluessel` bleibt Identitaet,
 * ja — aber nur der des FUEHRENDEN Werks. Der des geschluckten verschwindet aus
 * `/api/werke`, und mit ihm faende eine gemerkte Stelle (resume.json), ein
 * Verlaufseintrag (gespielt.json) oder ein Favorit ihre Kachel nicht mehr: Die
 * Zeile stuende da und fuehrte auf nichts.
 *
 * AM 2026-08-03 IN DER VORSCHAU GEMESSEN (tools/verschmelzung-befehle.mjs):
 * genau so sah es aus. Die Weiterhoeren-Kachel eines verschmolzenen Albums
 * fuehrte ins Leere, obwohl das Album auf der Startseite stand — nur eben unter
 * dem anderen Schluessel.
 *
 * DIE RICHTUNG IST GESCHLUCKT -> FUEHREND und nur diese. Umgekehrt gaebe es
 * keine eindeutige Antwort (ein fuehrendes Werk hat mehrere Geschluckte), und
 * der fuehrende Schluessel selbst steht nicht darin: wer ihn schon hat, braucht
 * keine Bruecke.
 */
export function identitaetsKarte(werke: readonly VerschmolzenesWerk[] | null | undefined): Map<string, string> {
  const karte = new Map<string, string>()
  for (const w of Array.isArray(werke) ? werke : []) {
    if (!w || typeof w !== 'object' || !w.schluessel) continue
    for (const s of Array.isArray(w.auchSchluessel) ? w.auchSchluessel : []) {
      const k = String(s ?? '').trim()
      // DER ERSTE GILT. Zwei Werke, die denselben Schluessel geschluckt haben,
      // gibt es nach `verschmelzeWerke` nicht (`verbraucht`) — eine von Hand
      // geschriebene Ablage kann es trotzdem hergeben, und dann ist die stille
      // Wahl besser als ein Absturz auf der Startseite eines Kindes.
      if (k && k !== w.schluessel && !karte.has(k)) karte.set(k, w.schluessel)
    }
  }
  return karte
}

/**
 * Zugeordnete Werke zu je EINEM zusammenfassen.
 *
 * Die Eingabe wird NICHT veraendert (flache Kopien) — der Aufrufer haelt die
 * rohe Liste oft noch fuer etwas anderes.
 *
 * VIER FAELLE, IN DENEN NICHT VERSCHMOLZEN WIRD, alle aus dem Bestand
 * abgeschaut statt neu entschieden:
 *
 *   1. ZWEI WERKE DESSELBEN DIENSTES. Dieselbe Zurueckhaltung uebt
 *      `gruppiereTreffer()` mit `aus[j].dienst === aus[i].dienst`: zwei
 *      Spotify-Alben gleichen Namens sind Standard und Deluxe, nicht dasselbe.
 *      Im Zweifel zwei Kacheln — der Mensch entscheidet, statt eine Kachel zu
 *      sehen, die das Falsche verspricht.
 *   2. VERSCHIEDENE `art`. Der Abspielbefehl entsteht aus `art` UND `dienst`
 *      (spielfunktion.ts `startPlan`: `{album, playlist, show}[werk.art]`), eine Kachel
 *      hat aber nur EINE `art`. Ein Album mit einer Playlist zu verschmelzen
 *      ergaebe fuer die zweite Quelle einen Befehl, den der Dienst nicht
 *      einloest.
 *   3. EIN MEHRDEUTIGER SCHLUESSEL. Traegt die Liste denselben Schluessel
 *      zweimal, ist nicht entscheidbar, welches Werk gemeint war — genau so
 *      verhaelt sich `findeIndex()` (medien.ts) mit seiner -1. AUF DER BOX
 *      GEMESSEN (2026-08-02): zwei Eintraege tragen dieselbe `playlistid`
 *      („JoJo — Das Pummeleinhorn") und unterscheiden sich nur in `category`.
 *      Wer darauf verschmilzt, verschmilzt ein geratenes Werk.
 *   4. EIN SCHLUESSEL IN ZWEI ZUORDNUNGEN. Die erste gilt, die zweite faellt
 *      GANZ weg. Ketten (A=B, B=C) still zu A=B=C aufzuloesen waere die Sorte
 *      Grosszuegigkeit, die man erst auf der Box bemerkt.
 *
 * Eine Zuordnung mit unbekannter `stufe` wird ABGEWIESEN, nicht auf „hand"
 * gebogen: die Stufe ist keine Verzierung, sondern das, woran der Mensch in
 * der Verwaltung ablesen soll, wem er die Zusammenfassung zu verdanken hat.
 * Sie zu erfinden waere eine Luege ueber die Herkunft; zwei Kacheln statt
 * einer sind dagegen bloss ein sichtbarer Tippfehler in der Ablage.
 */
export function verschmelzeWerke(
  werke: Werk[],
  zuordnungen: Zuordnung[] = [],
  opt: VerschmelzOptionen = {},
): VerschmolzenesWerk[] {
  const reihenfolge = Array.isArray(opt.reihenfolge) && opt.reihenfolge.length ? opt.reihenfolge : QUELLEN_REIHENFOLGE
  const metaReihenfolge = Array.isArray(opt.metadaten) && opt.metadaten.length ? opt.metadaten : METADATEN_REIHENFOLGE
  // Auch OHNE jede Zuordnung ordnet jedes Werk seine Quellen. Damit ist
  // `quellen[0]` ueberall die bevorzugte Quelle — heute ohne Wirkung (jedes
  // Werk hat genau eine), aber die Oberflaeche muss deswegen nie umgebaut
  // werden.
  const aus: VerschmolzenesWerk[] = (Array.isArray(werke) ? werke : [])
    .filter((w) => w && typeof w === 'object')
    .map((w) => ({ ...w, quellen: quellenOrdnen(w.quellen, reihenfolge) }))

  // Wie oft kommt ein Schluessel vor? Alles ueber eins ist mehrdeutig (Fall 3).
  const anzahl = new Map<string, number>()
  for (const w of aus) anzahl.set(w.schluessel, (anzahl.get(w.schluessel) ?? 0) + 1)
  const stelle = new Map<string, number>()
  for (let i = 0; i < aus.length; i++) {
    if (anzahl.get(aus[i].schluessel) === 1) stelle.set(aus[i].schluessel, i)
  }

  const verbraucht = new Set<string>()
  const geschluckt = new Set<number>()

  for (const z of Array.isArray(zuordnungen) ? zuordnungen : []) {
    if (!istStufe(z?.stufe)) continue
    const fuehrend = String(z?.schluessel ?? '').trim()
    if (!fuehrend) continue
    // Der fuehrende Schluessel zuerst, danach die uebrigen — ohne Dubletten
    // und ohne den fuehrenden ein zweites Mal.
    const mitglieder = [fuehrend, ...(Array.isArray(z.auch) ? z.auch : []).map((s) => String(s ?? '').trim())].filter(
      (s, i, a) => s && a.indexOf(s) === i,
    )
    if (mitglieder.length < 2) continue
    if (mitglieder.some((s) => verbraucht.has(s))) continue // Fall 4
    if (mitglieder.some((s) => (anzahl.get(s) ?? 0) > 1)) continue // Fall 3
    const indizes = mitglieder.map((s) => stelle.get(s)).filter((i): i is number => i !== undefined)
    // Ein Schluessel, den es in dieser Liste nicht gibt, wird uebergangen: die
    // Zuordnung ueberlebt das Loeschen eines Eintrags, ohne den Rest zu
    // entwerten. Bleibt weniger als ein Paar uebrig, gibt es nichts zu tun.
    if (indizes.length < 2) continue

    // Fehlt das fuehrende Werk (geloescht), fuehrt das erste noch vorhandene.
    // Die Kachel verschwindet dadurch nicht — sie heisst nur anders.
    const fIdx = stelle.get(fuehrend) ?? Math.min(...indizes)
    const basis = aus[fIdx]
    const quellen = [...basis.quellen]
    const dienste = new Set(quellen.map((q) => q.dienst))
    const auchSchluessel: string[] = []
    // `fehlt` ueberlebt nur, wenn ALLE Quellen weg sind — siehe unten.
    let allefehlen = Boolean(basis.fehlt)
    // `quelleAus` (E76) folgt derselben Regel: nur wenn ALLE Mitglieder
    // abgeschaltet sind, bleibt die Markierung — sonst spielt ja eine.
    let alleAus = Boolean(basis.quelleAus)

    for (const i of indizes) {
      if (i === fIdx) continue
      const m = aus[i]
      if (m.art !== basis.art) continue // Fall 2
      if (!m.quellen.length) continue
      if (m.quellen.some((q) => dienste.has(q.dienst))) continue // Fall 1
      for (const q of m.quellen) {
        quellen.push(q)
        dienste.add(q.dienst)
      }
      auchSchluessel.push(m.schluessel)
      allefehlen = allefehlen && Boolean(m.fehlt)
      alleAus = alleAus && Boolean(m.quelleAus)
      geschluckt.add(i)
    }
    if (!auchSchluessel.length) continue

    for (const s of mitglieder) verbraucht.add(s)

    /* DIE BESCHRIFTUNG WIRD ZUSAMMENGESETZT (E85), die Identität nicht.
     * `basis.schluessel` bleibt, was er war — daran hängen Verlauf,
     * Weiterhören und Favoriten. Titel, Interpret und Bild dagegen kommen aus
     * der bevorzugten METADATEN-Quelle, siehe `metadatenVerschmelzen()`.
     *
     * VOR `basis.quellen = …`, UND DAS IST DER GANZE WITZ. Danach trägt das
     * führende Werk ALLE Quellen, und `metadatenVerschmelzen()` liest den
     * Rang aus `quellen[0]` — es sähe dann jedes Mitglied als das, was die
     * ABSPIEL-Ordnung nach vorn gestellt hat, und die Metadaten-Ordnung
     * liefe ins Leere. Beim ersten Bau genau so passiert: der Titel blieb
     * „Quarks Science Cops" statt „Science Cops" zu werden. */
    const meta = metadatenVerschmelzen(
      [basis, ...indizes.filter((i) => geschluckt.has(i)).map((i) => aus[i])],
      metaReihenfolge,
    )
    if (meta) {
      basis.titel = meta.titel
      basis.bild = meta.bild
      if (meta.interpret) basis.interpret = meta.interpret
      else delete basis.interpret
    }

    basis.quellen = quellenOrdnen(quellen, reihenfolge)
    basis.auchSchluessel = auchSchluessel
    basis.stufe = z.stufe
    // BEIM ANBIETER GELOESCHT gilt jetzt fuer das WERK, nicht mehr fuer den
    // Eintrag. Ein Album, das bei Spotify verschwunden ist, aber in Jellyfin
    // liegt, ist nicht weg — es waere die Kachel auszugrauen, die als einzige
    // noch spielt. Umgekehrt darf die Markierung nicht verschwinden, solange
    // wirklich keine Quelle mehr da ist.
    if (allefehlen) basis.fehlt = true
    else delete basis.fehlt
    // Sind alle Mitglieder abgeschaltet, behaelt die Basis ihre Markierung
    // (welcher Dienst genannt wird, entscheidet die bevorzugte Quelle) —
    // sonst faellt sie weg, denn mindestens eine Quelle spielt.
    if (!alleAus) delete basis.quelleAus
  }

  return aus.filter((_, i) => !geschluckt.has(i))
}
