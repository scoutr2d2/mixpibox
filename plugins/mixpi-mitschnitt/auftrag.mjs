/**
 * DARF JETZT AUFGENOMMEN WERDEN, UND WAS? — die Entscheidung des Leerlaufs.
 *
 * Die Liste (`liste.mjs`) weiss, WAS ansteht. Sie weiss nicht, ob es gerade
 * GEHT. Das haengt an Dingen ausserhalb: spielt jemand, gibt es einen freien
 * Strom, hat der einen brauchbaren Zugang. Genau diese Trennung stand schon
 * beim Bau der Liste da — „die dritte Moeglichkeit ist keine Eigenschaft der
 * Liste, sondern eine Entscheidung des Aufrufers".
 *
 * HIER IST DER AUFRUFER. Rein, damit die Regeln nachlesbar sind statt im
 * Ablauf versteckt: hinein geht ein Lagebild, heraus kommt ein Auftrag oder
 * ein GRUND, warum keiner.
 *
 * ══ WARUM IMMER EIN GRUND ══════════════════════════════════════════════════
 *
 * Ein Leerlauf-Arbeiter, der „nichts zu tun" meldet, ist nicht zu
 * unterscheiden von einem, der kaputt ist. Beide tun nichts. Deshalb gibt
 * diese Funktion nie bloss `null` zurueck, sondern immer auch, WORAN es lag —
 * und das Befinden im Eltern-Bereich kann es anzeigen.
 *
 * ══ DIE SECHS GRUENDE, IN DIESER REIHENFOLGE ═══════════════════════════════
 *
 *   1. Es ist nichts vorgemerkt.            (der Normalfall, kein Mangel)
 *   2. Es spielt gerade jemand.             (Leerlauf heisst Leerlauf)
 *   3. Kein Strom fuer den Mitschnitt.      (nicht eingerichtet)
 *   4. Der Strom hat keinen brauchbaren Zugang.
 *   5. Der Zugang ist DERSELBE wie der der Wiedergabe.
 *   6. Der Strom hat keine eigene Senke.
 *
 * DIE REIHENFOLGE IST NICHT BELIEBIG. Sie geht vom Harmlosen zum Ernsten: „es
 * steht nichts an" ist kein Mangel und soll nicht wie einer aussehen. „Beide
 * Stroeme teilen sich einen Zugang" dagegen ist einer, und zwar der aus E72 —
 * der zweite nimmt dem ersten die Wiedergabe weg, mitten im Stueck.
 */

import { HOECHSTENS_VERSUCHE, naechster } from './liste.mjs'

/** Wie ein brauchbarer Soloist-Schluessel aussieht: `spak_` und 32 Zeichen. */
const SCHLUESSEL_MUSTER = /^spak_[A-Za-z0-9]{32}$/

export function istSchluessel(x) {
  return typeof x === 'string' && SCHLUESSEL_MUSTER.test(x)
}

/**
 * HIER STAND `stromFuerMitschnitt` — das Plugin suchte sich seinen Strom
 * selbst, naemlich den ersten mit `zweck === 'mitschnitt'`.
 *
 * ══ WARUM DAS WEG MUSSTE (E74, 22.08.2026) ═════════════════════════════════
 *
 * Selbst suchen geht genau so lange gut, wie es EINEN Sucher gibt. Zwei
 * Arbeiter faenden beide denselben Strom und starteten beide mit demselben
 * Zugang — der Fall, den `pruefen()` als schwer meldet: der zweite nimmt dem
 * ersten die Wiedergabe weg. Und der Zweck klebte am Strom, statt zur Laufzeit
 * vergeben zu werden; damit lag der zweite Zugang still, waehrend die Liste
 * 22 Titel tief war.
 *
 * JETZT FRAGT DAS PLUGIN. Der Wirt fuehrt das Buch (belegung.ts), weil nur er
 * ALLE Nachfrager sieht, und teilt eine Nummer zu. Den Schluessel dazu hat das
 * Plugin ohnehin schon aus `kontext.stroeme` — die Route gibt Plaetze, das
 * Recht `aufnahme` gibt Geheimnisse.
 *
 * `wasJetzt` bekommt den zugeteilten Strom deshalb HEREIN (`lage.strom`) und
 * prueft ihn nur noch.
 */

/** Die anderen Stroeme des Pools — fuer die Zugangs-Kollisionspruefung. */
export function andereStroeme(stroeme, ausser) {
  const alle = Array.isArray(stroeme?.stroeme) ? stroeme.stroeme : Array.isArray(stroeme) ? stroeme : []
  return alle.filter((s) => s && Number(s.nr) !== Number(ausser?.nr))
}

/**
 * Was jetzt zu tun ist.
 *
 * `lage`:
 *   spielt      — laeuft gerade eine Wiedergabe? (dann ist kein Leerlauf)
 *   stroeme     — die Aufstellung aus /api/stroeme
 *   liste       — die Mitschnitt-Liste
 *
 * Gibt `{ auftrag, grund }`. `auftrag` ist `null` oder
 * `{ eintrag, strom }` — der Titel und der Strom, ueber den er kommen soll.
 */
export function wasJetzt(lage) {
  const liste = lage?.liste ?? { eintraege: [] }
  const eintraege = Array.isArray(liste.eintraege) ? liste.eintraege : []

  // 1. NICHTS VORGEMERKT — der Normalfall. Kein Mangel, und er soll auch
  //    nicht wie einer klingen.
  const offen = eintraege.filter((e) => e.zustand === 'offen')
  if (offen.length === 0) {
    const haengen = eintraege.filter((e) => e.zustand === 'fehler').length
    return {
      auftrag: null,
      grund: haengen
        ? `nichts offen (${haengen} nach ${HOECHSTENS_VERSUCHE} Anlaeufen liegengeblieben)`
        : 'nichts vorgemerkt',
    }
  }

  // 2. ES SPIELT JEMAND — UND ES GIBT KEINEN ZWEITEN UNABHAENGIGEN STROM.
  //
  //    Bis zum 04.09.2026 hiess es hier pauschal „Leerlauf heisst Leerlauf",
  //    aus der Ein-Strom-Zeit. Der Betreiber, nachdem die Box laengst zwei
  //    Soloisten mit eigenen Zugaengen fuhr: „wir haben doch 2 soloisten,
  //    warum zeichnet der eine nicht auf? … die regel macht nur <2 sinn."
  //    Recht hat er: Der zweite Strom ist GENAU dafuer da. Gewartet wird
  //    nur noch, wenn die Unabhaengigkeit fehlt — zwei VERSCHIEDENE,
  //    brauchbare Zugaenge im Pool. Ob der zugeteilte Strom wirklich
  //    unabhaengig ist, pruefen die Regeln 3 bis 6 danach im Einzelnen
  //    (eigener Zugang, keine Kollision, eigene Senke).
  if (lage?.spielt) {
    // Der Pool kommt als `{ stroeme: [...] }` herein — dieselbe Huelle, die
    // `andereStroeme` unten auspackt. Ein direktes `lage.stroeme` waere das
    // Objekt, nicht das Array, und die Zaehlung faende NULL Zugaenge.
    const pool = Array.isArray(lage?.stroeme?.stroeme)
      ? lage.stroeme.stroeme
      : Array.isArray(lage?.stroeme)
        ? lage.stroeme
        : []
    const zugaenge = new Set(pool.map((x) => x?.schluessel).filter((k) => istSchluessel(k)))
    if (zugaenge.size < 2) {
      return { auftrag: null, grund: 'es spielt gerade, und ein zweiter unabhaengiger Strom fehlt — der Leerlauf wartet' }
    }
  }

  // 3. DER WIRT HAT KEINEN STROM ZUGETEILT.
  //
  //    SEIN GRUND WIRD DURCHGEREICHT, nicht durch einen eigenen ersetzt: er
  //    weiss, WARUM nichts frei war („haelt 1 Strom fuers Hoeren frei", „kein
  //    Strom frei", „kein Strom eingerichtet"), und das Plugin weiss es nicht.
  //    Ein selbst erfundener Grund waere hier schlechter als gar keiner.
  const strom = lage?.strom ?? null
  if (!strom) {
    return { auftrag: null, grund: lage?.vergabeGrund || 'kein Strom zugeteilt' }
  }

  // 4. KEIN BRAUCHBARER ZUGANG. „Gesetzt" reicht nicht — der Platzhalter
  //    SPAK_HIER_EINSETZEN war gesetzt, verschieden vom anderen, und trotzdem
  //    kein Zugang (E72, am 20.08.2026 an der Box). Deshalb die FORM.
  if (strom.maschine === 'soloist' && !istSchluessel(strom.schluessel)) {
    return {
      auftrag: null,
      grund: strom.schluessel
        ? `der Zugang von Strom ${strom.nr} hat nicht die Form spak_ + 32 Zeichen`
        : `Strom ${strom.nr} hat keinen Zugang`,
    }
  }

  // 5. DERSELBE ZUGANG WIE DIE WIEDERGABE — Fall 3 aus E66, und der teure.
  //    Spotify spielt je Konto genau EINEN Strom; startet ein zweiter mit
  //    demselben Schluessel, nimmt er dem ersten die Wiedergabe weg. Fuer ein
  //    Kind heisst das: die Musik hoert mitten im Stueck auf.
  //
  //    ES WIRD GEPRUEFT, OBWOHL GERADE NICHTS SPIELT. Der Leerlauf endet, wenn
  //    jemand eine Kachel antippt — und dann laeuft die Aufnahme noch.
  //    SEIT E74 PRUEFT DAS GEGEN DEN GANZEN POOL, nicht nur gegen Stroeme mit
  //    Zweck „wiedergabe": der Zweck haengt nicht mehr am Strom, jeder kann
  //    jederzeit ein Hoerer werden. Was hier gesucht wird, ist ein
  //    KONFIGURATIONSFEHLER — zwei Eintraege mit demselben Zugang. Die Vergabe
  //    schuetzt davor nicht, sie verteilt nur Plaetze.
  if (istSchluessel(strom.schluessel)) {
    const kollision = andereStroeme(lage?.stroeme, strom).find((w) => w.schluessel === strom.schluessel)
    if (kollision) {
      return {
        auftrag: null,
        grund:
          `Strom ${strom.nr} teilt sich den Zugang mit Strom ${kollision.nr} — ` +
          'eine Aufnahme naehme dem Hoeren die Wiedergabe weg',
      }
    }
  }

  // 6. KEINE EIGENE SENKE — Falle 2 aus E66, und hier hat sie einen zweiten
  //    Zahn. Ohne `-d` hoerte die Familie den Mitschnitt mit, deshalb baut
  //    `aufnahmeArgumente` gar keinen Befehl. WUERDE HIER TROTZDEM EIN AUFTRAG
  //    HERAUSKOMMEN, verbrauchte jeder Takt einen Versuch an einer Sache, die
  //    gar nicht am Titel liegt — nach drei Anlaeufen laege der Eintrag auf
  //    `fehler`, und zwar reihum die ganze Liste.
  //
  //    EIN UMSTAND IST KEIN TITELFEHLER. Dieselbe Trennung wie bei der
  //    Zeitsperre in `laufDeuten`.
  //    DIE SENKE GEHOERT ZUM ZWECK, NICHT ZUM STROM (E74, 22.08.2026).
  //
  //    Bis der Pool kam, hing sie am Strom: Strom 2 war „der Mitschnitt" und
  //    trug `senke: mixpi-mitschnitt`. Sobald die Vergabe irgendeinen freien
  //    Strom zuteilt, traegt der die falsche — am Geraet gemessen teilte der
  //    Wirt Strom 1 zu, und dessen Senke ist LEER, also der Familien-
  //    lautsprecher. Haette der Arbeiter sie genommen, haetten alle den
  //    Mitschnitt gehoert; er hat stattdessen abgelehnt, und der Grund nannte
  //    genau das.
  //
  //    Ein Mitschnitt geht IMMER in die Leersenke, gleich welchen Strom er
  //    bekommt. Was am Strom steht, ist sein Ziel beim HOEREN — eine ganz
  //    andere Frage.
  const senke = lage?.mitschnittSenke || ''
  if (!senke) {
    return {
      auftrag: null,
      grund: 'keine Senke fuer den Mitschnitt — ohne sie hoerte die Familie ihn mit',
    }
  }

  const eintrag = naechster(liste)
  if (!eintrag) return { auftrag: null, grund: 'nichts offen' }

  // DIE SENKE FAEHRT IM AUFTRAG MIT, nicht im Strom: der Arbeiter soll nicht
  // noch einmal entscheiden muessen, wohin der Ton geht.
  return { auftrag: { eintrag, strom, senke }, grund: '' }
}

/* ══ GILT DER NACHTMODUS GERADE? (E127, 04.09.2026) ═════════════════════════
 *
 * Betreiber: „ein nacht modus den man aktivieren kann um schneller
 * aufzunehmen mit 2 streams, in dem fall jedoch dann das spotify abspielen
 * abstellt."
 *
 * REIN UND OHNE UHR: Die Zeit kommt herein, sie wird nicht hier geholt.
 * Sonst waere die Regel nur am lebenden Geraet und nur nachts zu pruefen —
 * dieselbe Trennung wie bei der Kinderzeit.
 *
 * ══ DREI ENTSCHEIDUNGEN ════════════════════════════════════════════════════
 *
 * OHNE ZEITFENSTER GILT ER SOFORT. Wer den Schalter umlegt und beide Felder
 * leer laesst, meint „jetzt" — nicht „nie".
 *
 * UEBER MITTERNACHT IST DER NORMALFALL. 22:00 bis 06:00 heisst: von 22 Uhr
 * bis Mitternacht UND von Mitternacht bis 6 Uhr. Wer das nicht bedenkt,
 * baut einen Nachtmodus, der nachts nie gilt.
 *
 * EINE UNLESBARE ZEIT SCHALTET AB, nicht ein: „22" oder „abends" ergibt
 * kein Fenster, und ein Modus, der Spotify stumm schaltet, darf nicht aus
 * einem Tippfehler entstehen.
 */
export function nachtmodusGilt(einstellungen, jetzt) {
  if (einstellungen?.nachtmodus !== true) return false
  const von = uhrzeitMinuten(einstellungen?.nachtVon)
  const bis = uhrzeitMinuten(einstellungen?.nachtBis)
  if (von === null && bis === null) return true
  if (von === null || bis === null) return false
  const d = jetzt instanceof Date ? jetzt : new Date(jetzt)
  const m = d.getHours() * 60 + d.getMinutes()
  return von <= bis ? m >= von && m < bis : m >= von || m < bis
}

/** `HH:MM` als Minuten seit Mitternacht — oder null. Pure. */
export function uhrzeitMinuten(x) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(x ?? '').trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}
