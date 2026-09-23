/**
 * Diagnose des MuPiHAT: Statusregister deuten, Platinenstand einordnen.
 *
 * WOFUER: am 2026-07-29 blinkte die Versorgungs-LED, es wurde nicht geladen,
 * und die Ursache stand NIRGENDS in der Oberflaeche — sie stand in den
 * Statusregistern des BQ25792, die niemand las. Eine Stunde Suche fuer etwas,
 * das ein Blick haette beantworten koennen.
 *
 * ALLE ZAHLEN UND TEXTE STAMMEN AUS DEM DATENBLATT (MuPiHAT+ Ver. 2.4,
 * 25.01.2025) bzw. dem BQ25792-Datenblatt — nichts davon ist geraten. Wo
 * etwas NICHT bestimmbar ist (der Platinenstand!), sagt dieser Kern das
 * ausdruecklich, statt zu schaetzen.
 *
 * REIN: kein Netz, kein Dateizugriff, keine Uhr, kein I2C. Der Server liest
 * die Register und reicht sie herein.
 */

/** Ein Registersatz, wie ihn der Server einliest. */
export interface Register {
  /** 0x1B Charger Status 0 */
  s0?: number
  /** 0x1C Charger Status 1 */
  s1?: number
  /** 0x1D Charger Status 2 */
  s2?: number
  /** 0x20 Fault Status 0 */
  f0?: number
  /** 0x21 Fault Status 1 */
  f1?: number
  /** 0x48 Part Information */
  teil?: number
}

export type Gewicht = 'ok' | 'hinweis' | 'warnung' | 'fehler'

export interface Befund {
  was: string
  wert: string
  gewicht: Gewicht
  bedeutung?: string
}

/**
 * Die vier LEDs der Platine — woertlich aus dem Datenblatt, Seite 12.
 *
 * Wichtig fuer die Fehlersuche: fuer PWR ist UEBERHAUPT KEIN Blinken
 * vorgesehen. Eine blinkende PWR heisst also woertlich, dass die 5 V kommen
 * und gehen.
 */
export const LEDS = [
  {
    name: 'PWR',
    funktion: '5-V-Versorgung',
    zustaende: ['aus: keine 5 V vom HAT', 'grün: 5 V liegen an'],
    hinweis: 'Blinken ist NICHT vorgesehen — blinkt sie, kommt und geht die Versorgung.',
  },
  {
    name: 'STATUS',
    funktion: 'Ladezustand',
    zustaende: [
      'aus: Laden beendet oder abgeschaltet',
      'an: lädt gerade',
      'blinkt mit 1 Hz: Störung',
    ],
  },
  {
    name: 'PLUG',
    funktion: 'USB-C-Steckereignis',
    zustaende: ['kurzes Aufblitzen bei jedem Steckereignis'],
    hinweis: 'Jede Neuerkennung einer Quelle ist ein Steckereignis — daher wiederholtes Blitzen.',
  },
  {
    name: 'CAP_MIS',
    funktion: 'USB-C-Fähigkeitskonflikt',
    zustaende: [
      'aus: kein USB-C angeschlossen',
      'an: alles passt',
      'wechselnd: Fähigkeitskonflikt USB PD',
    ],
    hinweis: 'Wechselnd heißt: das Netzteil kann nicht, was der HAT verlangt.',
  },
] as const

/**
 * Die Platinenstände — aus dem Änderungsverzeichnis des Datenblatts (S. 27)
 * und den drei Steckerlisten (S. 5–9).
 */
export const REVISIONEN = [
  {
    stand: '2.0',
    datum: '01/2024',
    aenderungen: ['Erster Stand (eigenes, älteres Datenblatt)'],
    pd: 'unbekannt',
  },
  {
    stand: '2.2',
    datum: '03/2024',
    aenderungen: [
      'GPIO-Stecker auf normale 2,54-mm-Stiftleiste',
      'LED des Einschaltknopfs auf GPIO13 (PWM)',
      'Aufbau für niedrigere Temperatur überarbeitet',
      'PTC-Sicherung auf 2,6 A',
      'Eingangsstrom-Grenze auf 1,75 A',
      'Eingangsspannung bis 12 V',
      'Weckfunktion für Powerbank',
    ],
    pd: 'unbekannt',
  },
  {
    stand: '2.3',
    datum: '04/2024',
    aenderungen: [
      'Erratum: Powerbank-Weckfunktion wegen Fehler wieder entfernt',
      'Beschreibung, wie sich die Eingangsstrom-Grenze ändern lässt',
    ],
    pd: 'unbekannt',
  },
  {
    stand: '3.0',
    datum: '07/2024',
    aenderungen: [
      'MuPiHAT 3.0',
      'J1/J15 als Molex KK 2,54 mm',
      'ERRATUM: Beschriftung von J2 vertauscht — der 5-V-Pin ist GND und umgekehrt',
    ],
    pd: 'ja',
  },
  {
    stand: '3.1',
    datum: '11/2024',
    aenderungen: ['J1/J15 auf JST XH 2,50 mm gewechselt'],
    pd: 'ja',
  },
  {
    stand: '3.2',
    datum: '01/2025',
    aenderungen: ['Neu: J3 — Anschluss für eine externe Lade-Status-LED'],
    pd: 'ja',
  },
  {
    stand: '3.4.1',
    datum: 'nach 01/2025',
    aenderungen: [
      'Neuer als das vorliegende Datenblatt (Ver. 2.4 endet bei 3.2)',
      'Am Gerät belegt: der Pi 5 startet darauf sauber',
    ],
    pd: 'ja',
  },
] as const

/** Was der Laderegler an seinem Eingang erkannt hat (VBUS_STAT, REG 0x1C). */
export const QUELLEN: Record<number, string> = {
  0x0: 'kein Eingang',
  0x1: 'USB-Anschluss (SDP, 500 mA)',
  0x2: 'USB-Ladeanschluss (CDP, 1,5 A)',
  0x3: 'Ladegerät (DCP, 3,25 A)',
  0x4: 'Ladegerät mit einstellbarer Spannung (HVDCP)',
  0x5: 'unbekanntes Netzteil (3 A)',
  0x6: 'Netzteil ohne Norm',
  0x7: 'gibt selbst Strom ab (OTG)',
  0x8: 'NICHT ANERKANNT',
  0xb: 'Box läuft direkt am Eingang',
}

/** Der Ladezustand (CHG_STAT, REG 0x1C). */
export const LADEZUSTAENDE: Record<number, string> = {
  0x0: 'lädt nicht',
  0x1: 'Erhaltungsladung',
  0x2: 'Vorladung',
  0x3: 'Schnellladung',
  0x4: 'Nachladung (Spannungsphase)',
  0x6: 'Abschlussladung',
  0x7: 'Laden abgeschlossen',
}

/** Die Störungen aus REG 0x20/0x21 — Namen aus dem BQ25792-Datenblatt. */
const STOERUNGEN_0: ReadonlyArray<readonly [number, string]> = [
  [0x80, 'Eingangsspannung zu hoch'],
  [0x40, 'Akkuspannung zu hoch'],
  [0x20, 'Eingangsstrom zu hoch'],
  [0x10, 'Akkustrom zu hoch'],
  [0x08, 'Wandler-Störung'],
  [0x04, 'VAC2 zu hoch'],
  [0x02, 'VAC1 zu hoch'],
  [0x01, 'Systemspannung zu niedrig'],
]
const STOERUNGEN_1: ReadonlyArray<readonly [number, string]> = [
  [0x80, 'Chip zu heiß (Abschaltung)'],
  [0x40, 'Ladezeit überschritten'],
  [0x20, 'Trickle-Zeit überschritten'],
  [0x10, 'Vorladezeit überschritten'],
  [0x04, 'Akku zu heiß/kalt (NTC)'],
]

/**
 * Die MERKER-Register 0x26/0x27 haben dieselbe Bitbelegung wie die
 * Status-Register 0x20/0x21 — sie halten aber fest, was seit der letzten
 * Abfrage PASSIERT ist, statt was gerade IST.
 *
 * Genau das braucht man bei einem Fehler, der taktet: eine Stoerung, die
 * eine halbe Sekunde anliegt, steht im Status-Register fast nie, im Merker
 * aber sehr wohl.
 *
 * ACHTUNG: Merker sind LESEND LOESCHEND. Wer sie abfragt, nimmt sie damit
 * weg — deshalb sammelt der Aufrufer sie ueber die Messreihe auf, statt sie
 * einzeln zu betrachten.
 */
export function ereignisse(m0?: number, m1?: number): string[] {
  return stoerungen(m0, m1)
}

export function stoerungen(f0?: number, f1?: number): string[] {
  const raus: string[] = []
  for (const [bit, text] of STOERUNGEN_0) if (((f0 ?? 0) & bit) !== 0) raus.push(text)
  for (const [bit, text] of STOERUNGEN_1) if (((f1 ?? 0) & bit) !== 0) raus.push(text)
  return raus
}

/** VBUS_STAT sitzt in den Bits 4:1, CHG_STAT in 7:5 (REG 0x1C). */
export function quelleAus(s1?: number): number | null {
  return s1 === undefined ? null : (s1 >> 1) & 0x0f
}
export function ladezustandAus(s1?: number): number | null {
  return s1 === undefined ? null : (s1 >> 5) & 0x07
}

/**
 * Wie viele VERSCHIEDENE Quellen-Einstufungen kamen in der Messreihe vor?
 *
 * Mehr als eine heisst: der Regler erkennt und verwirft im Wechsel — das ist
 * das Blinken. EINMAL LESEN GENUEGT NICHT, deshalb nimmt diese Funktion eine
 * REIHE entgegen und keinen Einzelwert.
 */
export function taktet(reihe: ReadonlyArray<Register>): boolean {
  const q = new Set(reihe.map((r) => quelleAus(r.s1)).filter((x) => x !== null))
  return q.size > 1
}

/**
 * Was laesst sich ueber den Platinenstand SAGEN — und was nicht?
 *
 * EHRLICH: der Stand ist NICHT auslesbar. Auf der Platine sitzt keine
 * Kennung, die ihn nennt; das Teile-Register des Ladereglers identifiziert
 * den CHIP, nicht das Board, und der ist ueber alle 3.x gleich. Was bleibt,
 * sind ANHALTSPUNKTE — und die Bitte, den Stand einmal einzutragen.
 */
export function revisionHinweise(opts: {
  teil?: number
  i2cAdressen?: ReadonlyArray<number>
  maxVbusMv?: number
  limitMa?: number
}): Befund[] {
  const raus: Befund[] = []
  if (opts.teil !== undefined) {
    raus.push({
      was: 'Laderegler',
      wert: `Teil-Kennung 0x${opts.teil.toString(16).padStart(2, '0')} (Typ ${(opts.teil >> 3) & 7}, Ausgabe ${opts.teil & 7})`,
      gewicht: 'hinweis',
      bedeutung:
        'Das ist die Kennung des CHIPS (BQ25792), nicht die der Platine. Über alle ' +
        'Stände 3.x ist sie gleich und taugt deshalb NICHT zur Bestimmung des Platinenstands.',
    })
  }
  if (opts.i2cAdressen?.length) {
    raus.push({
      was: 'Bausteine am I2C',
      wert: opts.i2cAdressen.map((a) => `0x${a.toString(16)}`).join(', '),
      gewicht: 'hinweis',
      bedeutung:
        'Nur der Laderegler (0x6b) ist im Datenblatt benannt. Ein zweiter Baustein ' +
        'deutet auf zusätzliche Elektronik hin, sein Fehlen auf eine einfachere Ausführung — ' +
        'beweisen lässt sich daraus kein Platinenstand.',
    })
  }
  if (opts.maxVbusMv !== undefined && opts.maxVbusMv > 5500) {
    raus.push({
      was: 'USB-PD',
      wert: `Eingang war schon bei ${(opts.maxVbusMv / 1000).toFixed(1)} V`,
      gewicht: 'ok',
      bedeutung:
        'Über 5,5 V kann nur zustande kommen, wenn ein PD-Vertrag ausgehandelt wurde — ' +
        'diese Platine kann USB-C Power Delivery.',
    })
  }
  if (opts.limitMa !== undefined) {
    const pd = opts.limitMa > 1500
    raus.push({
      was: 'Ausgehandelte Eingangsgrenze',
      wert: `${opts.limitMa} mA`,
      gewicht: pd ? 'ok' : 'warnung',
      bedeutung: pd
        ? 'Deutlich über 500 mA — die Quelle wurde als leistungsfähig erkannt.'
        : 'Nur 500 mA ist der Rückfallwert für einen einfachen USB-Anschluss: es kam ' +
          'kein Vertrag zustande. Das sagt etwas über das NETZTEIL, nicht über die Platine.',
    })
    const stand = standAusGrenze(opts.limitMa)
    if (stand) {
      raus.push({
        was: 'Hinweis auf den Platinenstand',
        wert: stand.stand,
        gewicht: 'ok',
        bedeutung: stand.warum,
      })
    }
  }
  return raus
}

/**
 * Der Platinenstand aus der Eingangsstrom-Grenze — der einzige Wert, der sich
 * zwischen den Ständen wirklich unterscheidet.
 *
 * AM GERÄT BELEGT (2026-07-30), zwei Platinen im direkten Vergleich:
 *
 *     MuPiHAT 2.2  ->  1780 mA      Änderungsliste: "Input Current Limit to 1.75A"
 *     MuPiHAT 3.4.1 -> 2230 mA      Datenblatt S. 15: "limited to 2.2A"
 *
 * Die Grenze ist laut Datenblatt "defined by hardware configuration" — sie
 * steckt also in der Platine, nicht in der Software. Die Teile-Kennung des
 * Ladereglers (REG 0x48) war auf BEIDEN Platinen 0x08, taugt also nicht.
 *
 * ES GILT NUR MIT EINEM TAUGLICHEN NETZTEIL. Ohne eines steht dort der
 * ausgehandelte Wert (etwa 500 mA bei einem einfachen USB-Anschluss), und
 * der sagt nichts über die Platine. Deshalb gibt es unterhalb von 1000 mA
 * KEINE Aussage statt einer schlechten.
 */
export function standAusGrenze(limitMa: number): { stand: string; warum: string } | null {
  if (limitMa < 1000) return null
  const nah = (ziel: number) => Math.abs(limitMa - ziel) <= 150
  if (nah(1750)) {
    return {
      stand: 'vermutlich 2.2 oder 2.3',
      warum:
        'Die Eingangsgrenze liegt bei rund 1,75 A. Genau diesen Wert nennt die '
        + 'Änderungsliste für den Stand 2.2 — ab 3.0 sind es 2,2 A. Am Gerät gemessen: '
        + '1780 mA auf einer 2.2 gegen 2230 mA auf einer 3.4.1.',
    }
  }
  if (nah(2200)) {
    return {
      stand: 'vermutlich 3.x',
      warum:
        'Die Eingangsgrenze liegt bei rund 2,2 A — der Wert, den das Datenblatt (S. 15) '
        + 'für die Stände 3.x nennt ("limited to 2.2A ... without additional heat sink").',
    }
  }
  return {
    stand: 'kein bekannter Wert',
    warum:
      `${limitMa} mA passt zu keinem dokumentierten Stand (2.2: 1,75 A · 3.x: 2,2 A). `
      + 'Möglicherweise wurde die Grenze per Software überschrieben.',
  }
}

/**
 * Der Gesamtbefund aus einer Messreihe.
 *
 * `reihe` sind mehrere Registersaetze ueber einige Sekunden — anders laesst
 * sich ein taktender Eingang nicht von einem stabilen unterscheiden.
 */
export function befunde(opts: {
  reihe: ReadonlyArray<Register>
  vbusMv?: ReadonlyArray<number>
  limitMa?: number
  tempC?: number
  /** Ueber die ganze Messreihe eingesammelte Merker-Ereignisse. */
  ereignisse?: ReadonlyArray<string>
}): Befund[] {
  const raus: Befund[] = []
  const letzte = opts.reihe[opts.reihe.length - 1] ?? {}

  // Stoerungen zuerst — sie erklaeren alles Weitere.
  const st = stoerungen(letzte.f0, letzte.f1)
  raus.push(
    st.length
      ? {
          was: 'Störungen',
          wert: st.join(', '),
          gewicht: 'fehler',
          bedeutung:
            'Der Laderegler meldet eine echte Störung. Die STATUS-LED blinkt dabei ' +
            'laut Datenblatt mit 1 Hz.',
        }
      : { was: 'Störungen', wert: 'keine', gewicht: 'ok' },
  )

  // Die MERKER erzaehlen, was waehrend der Messung passiert ist - eine
  // Stoerung von einer halben Sekunde steht im Status-Register fast nie.
  if (opts.ereignisse) {
    raus.push(
      opts.ereignisse.length
        ? {
            was: 'Ereignisse während der Messung',
            wert: opts.ereignisse.join(', '),
            gewicht: 'warnung',
            bedeutung:
              'Aus den Merker-Registern 0x26/0x27 eingesammelt. Sie halten fest, was '
              + 'AUFGETRETEN ist, auch wenn es beim Blick auf den Status längst vorbei war.',
          }
        : {
            was: 'Ereignisse während der Messung',
            wert: 'keine',
            gewicht: 'ok',
            bedeutung: undefined,
          },
    )
  }

  const q = quelleAus(letzte.s1)
  const wechselt = taktet(opts.reihe)
  const gesehen = [...new Set(opts.reihe.map((r) => quelleAus(r.s1)).filter((x) => x !== null))]
  if (q !== null) {
    if (wechselt) {
      raus.push({
        was: 'Netzteil',
        wert: gesehen.map((x) => QUELLEN[x as number] ?? `0x${(x as number).toString(16)}`).join(' / '),
        gewicht: 'fehler',
        bedeutung:
          'Der Laderegler erkennt die Quelle, verwirft sie und fängt von vorn an — immer ' +
          'wieder. Genau dieser Takt ist das Blinken, und geladen wird dabei nie. Das ' +
          'Datenblatt verlangt ein USB-PD-3.0-Netzteil mit 20 W (S. 21).',
      })
    } else {
      const schwach = q === 0x0 || q === 0x1 || q === 0x8
      raus.push({
        was: 'Netzteil',
        wert: QUELLEN[q] ?? `unbekannt (0x${q.toString(16)})`,
        gewicht: schwach ? 'warnung' : 'ok',
        bedeutung: schwach
          ? 'Der Laderegler hält die Quelle für zu schwach. Das Datenblatt verlangt ein ' +
            'USB-PD-3.0-Netzteil mit 20 W (S. 21).'
          : undefined,
      })
    }
  }

  const l = ladezustandAus(letzte.s1)
  if (l !== null) {
    raus.push({
      was: 'Ladevorgang',
      wert: LADEZUSTAENDE[l] ?? `unbekannt (0x${l.toString(16)})`,
      gewicht: 'hinweis',
    })
  }

  if (opts.vbusMv?.length) {
    const min = Math.min(...opts.vbusMv)
    const max = Math.max(...opts.vbusMv)
    // Ein gesunder Eingang haelt seine Spannung auf rund 200 mV genau.
    const bricht = max > 4000 && min < max - 500
    raus.push({
      was: 'Eingangsspannung',
      wert: min === max ? `${min} mV` : `${min}…${max} mV`,
      gewicht: bricht ? 'fehler' : 'ok',
      bedeutung: bricht
        ? 'Der Eingang bricht zusammen und kommt wieder — dasselbe Bild wie oben. ' +
          'Fast immer ein zu schwaches Netzteil oder ein zu dünnes/langes Kabel.'
        : undefined,
    })
  }

  if (opts.limitMa !== undefined) {
    // Das Datenblatt (S. 15): "The Input Current is limited to 2.2A. This limit
    // is defined by hardware configuration in order to operate the HAT safely
    // without additional heat sink."
    const zu = opts.limitMa > 2300
    raus.push({
      was: 'Eingangsstrom-Grenze',
      wert: `${opts.limitMa} mA`,
      gewicht: opts.limitMa <= 500 ? 'warnung' : zu ? 'warnung' : 'ok',
      bedeutung:
        opts.limitMa <= 500
          ? 'Der Rückfallwert für einen einfachen USB-Anschluss — es kam kein Vertrag ' +
            'zustande. Der Pi 5 allein zieht mehr.'
          : zu
            ? 'Über der Hardware-Grenze von 2,2 A, die das Datenblatt für den Betrieb ' +
              'OHNE Kühlkörper nennt (S. 15).'
            : undefined,
    })
  }

  if (opts.tempC !== undefined) {
    // Kein Wert aus dem Datenblatt, sondern die Abschaltschwelle des Bausteins
    // (TSHUT typ. 150 Grad) mit Abstand. Ab 70 Grad wird es eng, wenn das
    // Gehaeuse zusaetzlich staut.
    raus.push({
      was: 'Temperatur des Ladereglers',
      wert: `${opts.tempC} °C`,
      gewicht: opts.tempC >= 85 ? 'fehler' : opts.tempC >= 70 ? 'warnung' : 'ok',
      bedeutung:
        opts.tempC >= 70
          ? 'Beim Laden mit vollem Strom wird der Baustein warm; die 2,2-A-Grenze ist ' +
            'laut Datenblatt genau dafür gewählt. Dauerhaft hohe Werte sprechen für ' +
            'schlechte Belüftung im Gehäuse.'
          : undefined,
    })
  }

  return raus
}

/* c8 ignore next 3 */
declare const module: { exports: unknown } | undefined
if (typeof module !== 'undefined')
  module.exports = {
    LEDS,
    REVISIONEN,
    QUELLEN,
    LADEZUSTAENDE,
    stoerungen,
    ereignisse,
    quelleAus,
    ladezustandAus,
    taktet,
    revisionHinweise,
    standAusGrenze,
    befunde,
  }
