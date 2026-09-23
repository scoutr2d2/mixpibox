/**
 * KLANG — das Musterplugin fuer den TON.
 *
 * Podcast zeigt die Medienquelle, WLED die Ereignisse; dieses hier zeigt die
 * dritte Haelfte: ein Plugin, das im SIGNALWEG haengt. Es spielt nichts und
 * horcht auf nichts — es wird einmal gefragt, was es in die Filterkette
 * haengen will, und der Kern baut daraus die PipeWire-Kette.
 *
 * ══ DER FALL, WEGEN DEM ES DAS GIBT ═══════════════════════════════════════
 * Betreiber, 21.08.2026: „ich habe die boxen so angebracht das sie seitlich
 * rausstrahlen leicht angewinkelt nach vorne wenn man direkt davor sitzt
 * macht es ein komisches hörgefühl".
 *
 * Was da passiert, sind drei Dinge zugleich:
 *   1. NEBEN DER ACHSE FEHLT HOCHTON. Kleine Breitbaender buendeln oberhalb
 *      von etwa 3 kHz; 60 bis 90 Grad daneben fehlen leicht 6 bis 12 dB.
 *      Klingt dumpf, „unter einer Decke". -> Regler „Hoehen".
 *   2. DIE MITTE ZERFAELLT. Bei grossem Oeffnungswinkel und kurzem Abstand
 *      hoert jedes Ohr fast nur seinen Lautsprecher; Gesang hat keinen Ort
 *      mehr, er reisst nach links und rechts auseinander. DAS ist meistens
 *      das „komische Gefuehl". -> Regler „Stereobasis", der wichtigste hier.
 *   3. KAMMFILTER — nur, wenn beide Chassis DASSELBE Signal bekommen (Mono
 *      gebrueckt). Gleiches Signal, verschiedene Laufzeit zu jedem Ohr,
 *      Ausloeschungen in den Mitten. DAS KANN DIESES PLUGIN NICHT HEILEN,
 *      und es soll das auch nicht behaupten: dagegen hilft nur, ein Chassis
 *      abzuschalten oder die Aufstellung zu aendern.
 *
 * ══ WAS SOFTWARE NICHT KANN ═══════════════════════════════════════════════
 * Die Abstrahlrichtung. Ein Hochtonabfall laesst sich im Pegel ausgleichen,
 * aber was physisch an den Ohren vorbeigeht, kommt als Raumreflexion zurueck —
 * es wird lauter, nicht klarer. Die Chassis zehn bis fuenfzehn Grad weiter
 * nach vorn zu kippen schlaegt jeden Regler hier. Das steht so auch in den
 * Hinweisen der Felder, damit es liest, wer die Box einstellt.
 *
 * ══ WIE ES ARBEITET ═══════════════════════════════════════════════════════
 * Gar nicht — es BESCHREIBT nur. `klangkette()` wird beim Start und nach
 * jeder Einstellungsaenderung EINMAL gefragt und liefert eine Liste von
 * Gliedern; gerechnet wird danach in PipeWire, nicht in JavaScript. Deshalb
 * kostet dieses Plugin im Betrieb nichts ausser seinen 11 MB Worker.
 *
 * Die Reihenfolge der Glieder ist Absicht:
 *   Stereobasis -> Hochpass -> Bass -> Hoehen -> Vorpegel
 * Erst mischen, dann entzerren (sonst entzerrte man einen Kanal, den die
 * Matrix gleich darauf mit dem anderen verrechnet), und der Vorpegel ganz
 * zuletzt, wo er die Summe aller Anhebungen auffaengt.
 */

/** Die Eckfrequenzen der beiden Kuhschwaenze. Nicht einstellbar — siehe unten. */
const BASS_HZ = 100
const HOEHEN_HZ = 4000

/**
 * Eine Zahl aus den Einstellungen holen und in ihre Grenzen biegen.
 *
 * HIER WIRD GEBOGEN UND NICHT GEWORFEN, obwohl der Kern streng prueft — und
 * das ist kein Widerspruch: was aus einem Zahlenfeld des Eltern-Bereichs
 * kommt, ist ein Versehen (eine 500 im dB-Feld), kein Angriff. Ein Versehen
 * soll den Klang nicht abschalten, sondern gedeckelt wirken. Was der Kern
 * abweist, waere dagegen ein Fehler IN DIESEM PLUGIN.
 */
function zahl(wert, vorgabe, min, max) {
  const n = Number(wert)
  if (!Number.isFinite(n)) return vorgabe
  return Math.max(min, Math.min(max, n))
}

export default {
  /**
   * Was in den Signalweg soll.
   *
   * @param {object} kontext protokoll, einstellungen
   * @returns {Array} Glieder, wie klangkette.ts sie kennt
   */
  klangkette(kontext) {
    const e = kontext.einstellungen ?? {}

    const basis = zahl(e.basis, 100, 0, 100)
    // 0 heisst aus. Unter 40 Hz waere ein Hochpass wirkungslos, ueber 300
    // naehme er Grundton weg — dazwischen liegt, was bei kleinen Chassis
    // sinnvoll ist.
    const hochpass = zahl(e.hochpass, 0, 0, 300)
    // Die Eckfrequenzen von Bass und Hoehen sind FEST, und das ist eine
    // Entscheidung: wer sie einstellen kann, stellt sie falsch ein, und fuer
    // den Zweck (Kinderbox, kleine Chassis) sind 100 Hz und 4 kHz die
    // Stellen, an denen es klemmt. Wer mehr will, hat den Fuenfband-
    // Entzerrer direkt darueber auf derselben Seite.
    const bass = zahl(e.bass, 0, -12, 12)
    const hoehen = zahl(e.hoehen, 0, -12, 12)
    // Nur daempfend — der Kern weist einen anhebenden Vorpegel ab, weil er
    // den eingemessenen Deckel der Ton-Seite aushebeln wuerde.
    const vorpegel = zahl(e.vorpegel, 0, -12, 0)
    // ══ DIE ZWEI DYNAMIK-REGLER (21.08.2026) ═══════════════════════════════
    // 0 heisst AUS, nicht „Verhaeltnis 0": ein Kompressor mit 1:1 taete
    // ohnehin nichts, kostete aber Rechenzeit und stuende im Signalweg.
    const kompressor = zahl(e.kompressor, 0, 0, 20)
    const kompSchwelle = zahl(e.kompSchwelle, -18, -30, 0)
    const begrenzer = zahl(e.begrenzer, 0, -20, 0)

    // ══ ALLES AUF VORGABE HEISST: GAR NICHT IM WEG STEHEN ══════════════════
    // Dann liefert das Plugin NICHTS, und der Kern baut die Klangwerk-Senke
    // erst gar nicht auf. Eine Box, an der niemand etwas eingestellt hat,
    // soll keinen Filterprozess mitschleppen.
    const wirktEtwas =
      basis < 100 || hochpass >= 40 || bass !== 0 || hoehen !== 0 || vorpegel < 0 || kompressor >= 1.5 || begrenzer < 0
    if (!wirktEtwas) return []

    // ══ SOBALD ETWAS WIRKT: IMMER ALLE FUENF GLIEDER ══════════════════════
    // Auch die neutralen. DAS IST DIE VORAUSSETZUNG FUERS LIVE-REGELN
    // (Betreiber, 21.08.2026: Regler „am besten live zum hören"): der Kern
    // kann Werte nur dann am laufenden Graphen stellen, wenn dessen STRUKTUR
    // gleich bleibt. Wuerde ein Glied bei Vorgabewert verschwinden, riefe
    // jeder Reglerzug ueber die Null einen Neubau hervor — und damit einen
    // Tonaussetzer mitten im Einstellen.
    //
    // Was das kostet, ist gemessen und nicht geschaetzt: die ganze Kette lag
    // auf der Box (Pi 5) bei 8 MB und 0,0 % CPU im Leerlauf. Vier neutrale
    // Filter mehr sind dort kein Posten.
    //
    // Ein Hochpass „aus" wird zu 20 Hz — das ist unterhalb dessen, was die
    // Chassis abstrahlen, also hoerbar nichts, aber ein gueltiges Glied
    // (der Kern verlangt mindestens 20 Hz).
    const glieder = [
      { art: 'basis', breite: basis },
      { art: 'hochpass', freq: hochpass >= 40 ? hochpass : 20 },
      { art: 'kuhschwanz', lage: 'tief', freq: BASS_HZ, dB: bass },
      { art: 'kuhschwanz', lage: 'hoch', freq: HOEHEN_HZ, dB: hoehen },
      { art: 'vorpegel', dB: vorpegel },
    ]

    // ══ DYNAMIK NUR, WENN SIE GEWOLLT IST — anders als die fuenf oben ══════
    // Die Regel „immer alle Glieder" gilt fuer die Filter, deren neutrale
    // Fassung nichts kostet. Bei den LADSPA-Bausteinen ist das anders: sie
    // laden eine fremde .so, belegen Speicher und rechnen mit. Einen
    // Kompressor mitlaufen zu lassen, der auf 1:1 steht, waere Aufwand fuer
    // nichts.
    //
    // DER PREIS IST EHRLICH ZU NENNEN: schaltet man sie ein oder aus, aendert
    // sich die STRUKTUR, und der Kern muss neu bauen statt live zu stellen —
    // der Ton setzt dabei kurz aus. Am REGLER ziehen (Verhaeltnis, Schwelle,
    // Decke) bleibt live; nur das Ein- und Ausschalten kostet den Aussetzer.
    if (kompressor >= 1.5) {
      glieder.push({
        art: 'kompressor',
        schwelle: kompSchwelle,
        verhaeltnis: kompressor,
        /* MAKEUP FOLGT VERHAELTNIS *UND* SCHWELLE — beides, und daran lag
         * ein echter Fehler (Betreiber, 23.08.2026: „die lautstaerke ist
         * stark gedeckelt").
         *
         * Hier stand `min(12, verhaeltnis * 1,5)`. Das ignoriert die
         * SCHWELLE, und die entscheidet mit, wie viel ueberhaupt
         * weggenommen wird. Am Geraet gemessen (pw-dump der laufenden
         * Kette): Schwelle -18 dB, Verhaeltnis 3, Makeup 5 dB.
         *
         * NACHGERECHNET fuer einen Gipfel bei 0 dBFS:
         *     Ausgang = Schwelle + (0 - Schwelle) / Verhaeltnis
         *             = -18 + 18/3 = -12 dB
         * Es fehlen also 12 dB, aufgeholt wurden 5 — SIEBEN dB zu wenig.
         * Kinderhoerspiele sind bis dicht unter 0 dBFS ausgesteuert, und
         * genau die Gipfel tragen die empfundene Lautstaerke.
         *
         * DIE RICHTIGE FORMEL stellt die Einheit bei 0 dBFS wieder her:
         *     |Schwelle| * (1 - 1/Verhaeltnis)
         * Bei -18 und 3:1 sind das 12 dB, bei -18 und 8:1 knapp 16.
         *
         * DER DECKEL VON 12 dB BLEIBT, und er ist jetzt eine bewusste
         * Grenze statt eines Zufalls: mehr hiesse, dass leise Stellen im
         * Grundrauschen der kleinen Chassis ankommen. Wer staerker
         * komprimiert, bekommt also nicht die volle Aufholung — dafuer gibt
         * es den Begrenzer, der die Spitzen ohnehin faengt. */
        makeup: Math.min(12, Math.round(Math.abs(kompSchwelle) * (1 - 1 / kompressor))),
      })
    }
    if (begrenzer < 0) glieder.push({ art: 'begrenzer', grenze: begrenzer })

    // EINE ZEILE INS JOURNAL — aber nicht bei jedem Reglerzug. Beim Live-
    // Regeln wird diese Funktion vielfach je Sekunde gerufen; ein Protokoll
    // je Ruf machte das Journal unlesbar, und genau dort sucht man spaeter.
    const marke = `${basis}/${hochpass}/${bass}/${hoehen}/${vorpegel}/${kompressor}/${kompSchwelle}/${begrenzer}`
    if (kontext.protokoll && this._zuletzt !== marke) {
      this._zuletzt = marke
      kontext.protokoll(
        `Kette: Basis ${basis} %, Hochpass ${hochpass}, Bass ${bass}, Hoehen ${hoehen}, ` +
          `Vor ${vorpegel}, Komp ${kompressor || 'aus'}, Begr ${begrenzer || 'aus'}`,
      )
    }
    return glieder
  },

  /**
   * „Geht es dir gut?" — im Eltern-Bereich sichtbar.
   *
   * SAGT AUCH, WENN NICHTS EINGESTELLT IST. Ein Plugin, das mit „alles in
   * Ordnung" antwortet, waehrend alle Regler auf Vorgabe stehen und nichts
   * wirkt, laesst den Betreiber an der falschen Stelle suchen.
   */
  befinden(kontext) {
    const anzahl = this.klangkette(kontext).length
    if (anzahl === 0) {
      return { ok: true, text: 'bereit — aber alle Regler stehen auf Vorgabe, es wirkt nichts' }
    }
    return { ok: true, text: `${anzahl} Glied(er) im Signalweg` }
  },
}
