/**
 * Bluetooth: suchen, koppeln, verbinden, entfernen.
 *
 * ERSETZT bluetooth.php und die Skripte darunter. Am Gerät nachgemessen
 * (Pi 5, BlueZ 5.82) — und dabei zeigte sich, dass die alte Kette an drei
 * Stellen gar nicht funktionieren KANN:
 *
 *   1. `autoconnect_bt.sh` ruft `bluetoothctl paired-devices`. Diesen Befehl
 *      gibt es in BlueZ 5.82 NICHT mehr; er antwortet „Invalid command in
 *      menu main". Das automatische Wiederverbinden lief also nie.
 *   2. `pair_bt.sh` schreibt `defaut-agent` — ein Tippfehler. Der Standard-
 *      Agent wird damit nie gesetzt, und Geräte, die einen brauchen, koppeln
 *      nicht. Ein zweiter Tippfehler (`ouput=` gesetzt, `$output` ausgegeben)
 *      sorgt dafür, dass man nie erfährt, was schiefging.
 *   3. bluetooth.php schiebt $_POST['bt_device'] bzw. ['remove_mac']
 *      UNQUOTIERT in einen sudo-Aufruf.
 *
 * Deshalb hier: kein einziges dieser Skripte, kein Shell-Aufruf, und eine
 * MAC-Adresse muss die Prüfung unten bestehen, bevor sie irgendwo landet.
 */

/**
 * Ist das eine Bluetooth-Adresse? Pure.
 *
 * DIE wichtigste Zeile dieser Datei. Genau hier hatte die alte Seite ihr
 * Loch: der Formularwert wanderte per Verkettung in `sudo …`. Erlaubt sind
 * ausschließlich sechs Zweiergruppen aus Hex, getrennt durch Doppelpunkte —
 * nichts sonst, keine Leerzeichen, keine Länge darüber hinaus.
 */
export function istMac(x: unknown): x is string {
  return typeof x === 'string' && /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/.test(x)
}

/** Adressen einheitlich in Großbuchstaben — BlueZ meldet sie so. */
export function macNormal(mac: string): string {
  return mac.toUpperCase()
}

export const AKTIONEN = ['koppeln', 'verbinden', 'trennen', 'vertrauen', 'entfernen'] as const
export type Aktion = (typeof AKTIONEN)[number]

export function istAktion(x: unknown): x is Aktion {
  return typeof x === 'string' && (AKTIONEN as readonly string[]).includes(x)
}

/** Aktion → bluetoothctl-Befehl. Feste Tabelle, nie zusammengesetzt. */
export const BEFEHL: Record<Aktion, string> = {
  koppeln: 'pair',
  verbinden: 'connect',
  trennen: 'disconnect',
  vertrauen: 'trust',
  entfernen: 'remove',
}

export interface Geraet {
  mac: string
  name: string
  gekoppelt?: boolean
  verbunden?: boolean
  vertraut?: boolean
  art?: Art
  /** true, wenn der „Name" nur die eigene Adresse ist (namenloser Streuer). */
  namenlos?: boolean
  /**
   * Ladezustand in Prozent — WENN das Geraet ihn meldet.
   *
   * BlueZ legt die Battery1-Schnittstelle nur an, wenn bluetoothd mit
   * `Experimental = true` laeuft, und selbst dann meldet ihn nur ein Teil der
   * Geraete (ueber HFP oder AVRCP). Deshalb OPTIONAL und nie geraten: ohne
   * Angabe steht schlicht nichts da, statt eines erfundenen Balkens.
   */
  akku?: number
  /**
   * Der ausgehandelte Audio-Codec, z. B. `sbc` oder `aptx`.
   *
   * Steht NICHT in BlueZ, sondern bei PipeWire an der Senke — die Aushandlung
   * passiert zwischen Tonserver und Geraet, nicht im Kopplungszustand. Nur
   * bei VERBUNDENEN Tongeraeten vorhanden; ohne Angabe steht nichts da.
   *
   * Warum es zaehlt: SBC ist der Pflicht-Codec, den jedes Geraet kann, und
   * der anfaelligste. Wer sieht, dass ein Lautsprecher mit aptX laeuft und
   * ein anderer mit SBC, versteht den Klangunterschied ohne zu raten.
   */
  codec?: string
}

/**
 * Codecs aus `pactl list sinks` lesen. Pure.
 *
 * Gesucht wird das Paar aus Senkenname und Codec-Eigenschaft:
 *
 *   Name: bluez_output.00_9E_C8_61_1A_EA.1
 *       api.bluez5.codec = "sbc"
 *
 * Die Adresse steckt IM NAMEN, mit Unterstrichen statt Doppelpunkten. Ein
 * `Name:` beginnt einen neuen Block; der Codec danach gehoert zu ihm, bis der
 * naechste `Name:` kommt.
 */
export function parseCodecs(text: string): Record<string, string> {
  const raus: Record<string, string> = {}
  let mac = ''
  for (const zeile of (text || '').split('\n')) {
    const name = /^\s*Name:\s*bluez_output\.([0-9A-Fa-f_]{17})\./.exec(zeile)
    if (name) {
      mac = name[1].replace(/_/g, ':').toUpperCase()
      continue
    }
    if (/^\s*Name:/.test(zeile)) {
      mac = '' // eine andere Senke — der folgende Codec gehoert nicht hierher
      continue
    }
    const c = /api\.bluez5\.codec\s*=\s*"([^"]+)"/.exec(zeile)
    if (c && mac) {
      raus[mac] = c[1]
      mac = ''
    }
  }
  return raus
}

/**
 * Ausgabe von `bluetoothctl devices` auswerten. Pure.
 *
 * Form: `Device 00:9E:C8:61:1A:EA 小米蓝牙音箱`
 * Der Name darf Leerzeichen und beliebige Zeichen enthalten — deshalb wird
 * nur bis zum zweiten Feld getrennt und der Rest bleibt zusammen.
 */
export function parseDevices(text: string): Geraet[] {
  const raus: Geraet[] = []
  for (const zeile of String(text || '').split('\n')) {
    const m = /^\s*Device\s+([0-9A-Fa-f:]{17})\s*(.*)$/.exec(zeile)
    if (!m) continue
    const mac = macNormal(m[1])
    const name = m[2].trim()
    raus.push({ mac, name: name || mac, namenlos: istNamenlos(mac, name) })
  }
  return raus
}

/**
 * Trägt das Gerät gar keinen Namen? Pure.
 *
 * BlueZ setzt als Ersatzname die Adresse mit Bindestrichen
 * (`28-0D-B6-85-BD-80`). Bei einer Suche sind das die meisten Funde: Handys,
 * Kopfhörer im Ruhezustand, Fitnessbänder, Werbe-Beacons. Sie hier zu
 * erkennen erlaubt der Oberfläche, sie wegzublenden — sonst sucht man seinen
 * Lautsprecher zwischen zwanzig Zahlenreihen.
 */
export function istNamenlos(mac: string, name: string): boolean {
  if (!name) return true
  return name.replace(/-/g, ':').toUpperCase() === macNormal(mac)
}

export type Art = 'lautsprecher' | 'kopfhoerer' | 'telefon' | 'eingabe' | 'rechner' | 'unbekannt'

/**
 * Was für ein Gerät ist das? Pure.
 *
 * BlueZ liefert in `info` ein `Icon:`-Feld (`audio-card`, `audio-headset` …).
 * Das ist verlässlicher als der Klassencode selbst zu zerlegen, und es steht
 * ohnehin da. Der Klassencode dient nur als Rückfall.
 */
export function art(icon?: string, klasse?: number): Art {
  const i = String(icon || '').toLowerCase()
  if (i.includes('headset') || i.includes('headphone')) return 'kopfhoerer'
  if (i.includes('audio') || i.includes('speaker')) return 'lautsprecher'
  if (i.includes('phone')) return 'telefon'
  if (i.includes('input') || i.includes('keyboard') || i.includes('mouse')) return 'eingabe'
  if (i.includes('computer')) return 'rechner'
  // Rückfall über die Hauptgeräteklasse (Bits 8–12 des Klassencodes).
  if (typeof klasse === 'number' && Number.isFinite(klasse)) {
    switch ((klasse >> 8) & 0x1f) {
      case 0x01:
        return 'rechner'
      case 0x02:
        return 'telefon'
      case 0x04:
        return 'lautsprecher'
      case 0x05:
        return 'eingabe'
      default:
        return 'unbekannt'
    }
  }
  return 'unbekannt'
}

/**
 * Ausgabe von `bluetoothctl info <mac>` auswerten. Pure.
 *
 * Zeilen der Form `\tPaired: yes`. Fehlt eine Angabe, bleibt das Feld
 * `undefined` statt `false` — „weiß ich nicht" ist etwas anderes als „nein".
 */
export function parseInfo(text: string): Partial<Geraet> {
  const feld: Record<string, string> = {}
  for (const zeile of String(text || '').split('\n')) {
    const i = zeile.indexOf(':')
    if (i < 1) continue
    const k = zeile.slice(0, i).trim()
    // Nur die schlichten `Schlüssel: Wert`-Zeilen; UUID-Zeilen und die
    // Kopfzeile („Device 00:9E:…") haben eine andere Form.
    if (!/^[A-Za-z]+$/.test(k)) continue
    feld[k] = zeile.slice(i + 1).trim()
  }
  const ja = (s?: string) => (s === undefined ? undefined : s === 'yes')
  const klasseRoh = /^0x([0-9a-fA-F]+)/.exec(feld['Class'] ?? '')
  const raus: Partial<Geraet> = {
    gekoppelt: ja(feld['Paired']),
    verbunden: ja(feld['Connected']),
    vertraut: ja(feld['Trusted']),
    art: art(feld['Icon'], klasseRoh ? Number.parseInt(klasseRoh[1], 16) : undefined),
  }
  const name = feld['Alias'] || feld['Name']
  if (name) raus.name = name
  const a = akkuAus(feld['Battery'] ?? feld['BatteryPercentage'] ?? text)
  if (a !== undefined) raus.akku = a
  return raus
}

/**
 * Den Ladezustand aus der Ausgabe holen. Pure.
 *
 * bluetoothctl schreibt ihn als `Battery Percentage: 0x54 (84)` — die Zeile
 * hat zwei Woerter vor dem Doppelpunkt und faellt deshalb durch den
 * Schluessel-Filter oben; darum wird hier zusaetzlich der ganze Text
 * durchsucht. Bevorzugt wird die Dezimalzahl in Klammern; fehlt sie, gilt der
 * Hex-Wert.
 */
export function akkuAus(text?: string): number | undefined {
  if (!text) return undefined
  const m = /Battery\s*Percentage:\s*(?:0x([0-9a-fA-F]+))?\s*(?:\((\d+)\))?/.exec(text)
  if (m) {
    const wert = m[2] !== undefined ? Number.parseInt(m[2], 10) : m[1] !== undefined ? Number.parseInt(m[1], 16) : NaN
    if (Number.isFinite(wert) && wert >= 0 && wert <= 100) return wert
  }
  // Schlichte Form `Battery: 84` — manche Fassungen schreiben es so.
  const s = /^\s*(\d{1,3})\s*%?\s*$/.exec(text)
  if (s) {
    const wert = Number.parseInt(s[1], 10)
    if (wert >= 0 && wert <= 100) return wert
  }
  return undefined
}

export interface Adapter {
  mac: string
  name: string
  an: boolean
  sucht: boolean
  sichtbar: boolean
}

/** Ausgabe von `bluetoothctl show` auswerten. Pure. */
export function parseShow(text: string): Adapter | null {
  const kopf = /Controller\s+([0-9A-Fa-f:]{17})\s*(.*)/.exec(String(text || ''))
  if (!kopf) return null
  const feld: Record<string, string> = {}
  for (const zeile of String(text).split('\n')) {
    const m = /^\s+([A-Za-z]+):\s*(.*)$/.exec(zeile)
    if (m) feld[m[1]] = m[2].trim()
  }
  return {
    mac: macNormal(kopf[1]),
    name: feld['Alias'] || kopf[2].replace(/\[default\]/, '').trim(),
    an: feld['Powered'] === 'yes',
    sucht: feld['Discovering'] === 'yes',
    sichtbar: feld['Discoverable'] === 'yes',
  }
}

/**
 * Geräte in eine sinnvolle Reihenfolge bringen. Pure.
 *
 * Verbundenes zuerst, dann Gekoppeltes, dann alles mit Namen, zuletzt die
 * namenlosen Streuer. Wer die Seite öffnet, sucht meistens sein eigenes
 * Gerät — und das ist entweder schon bekannt oder hat wenigstens einen Namen.
 */
export function sortiert(liste: Geraet[]): Geraet[] {
  const rang = (g: Geraet) =>
    g.verbunden ? 0 : g.gekoppelt ? 1 : g.namenlos ? 3 : 2
  return [...liste].sort(
    (a, b) => rang(a) - rang(b) || a.name.localeCompare(b.name, 'de'),
  )
}

/** Wie lange gesucht wird (Sekunden). Kurz genug zum Warten, lang genug zum Finden. */
export const SUCHE_MIN = 3
export const SUCHE_MAX = 30
export const SUCHE_VORGABE = 10

export function suchdauer(roh: unknown): number {
  const n = typeof roh === 'number' ? roh : Number.parseInt(String(roh ?? ''), 10)
  if (!Number.isFinite(n)) return SUCHE_VORGABE
  return Math.min(Math.max(Math.floor(n), SUCHE_MIN), SUCHE_MAX)
}

/**
 * Die Fehlzeile eines gescheiterten `select <wahl>` aus der Ausgabe tilgen. Pure.
 *
 * WOZU (am Geraet gefunden, 09.09.2026, MixPiBox .62): Die Adapterwahl in
 * /etc/mupibox/bt-adapter zeigte auf einen USB-Stecker, den es nicht mehr gab
 * (am 20.08. gewechselt, die Datei blieb). Jede bluetoothctl-Sitzung beginnt
 * mit `select <wahl>` — und BlueZ antwortet dann
 *
 *     Controller 08:BF:B8:56:CE:44 not available
 *
 * Diese eine Zeile vergiftete ZWEI Auswertungen zugleich: `ergebnis()` las
 * „not available" als Ausgang des eigentlichen Befehls (jedes Verbinden uebers
 * Menue meldete sofort „not available", obwohl der Versuch auf dem
 * Standard-Adapter laengst lief), und die Abbruch-Erkennung in btctl()
 * beendete die Sitzung 400 ms spaeter — der Verbindungsaufbau wurde
 * abgewuergt, bevor der Lautsprecher antworten konnte. `parseShow` nahm die
 * Zeile obendrein als Controller-Kopf und meldete die tote MAC als Adapter.
 *
 * NUR die Controller-Zeile der GEWAEHLTEN Adresse faellt weg. Ein
 * `Device … not available` ist eine echte Auskunft (Geraet aus oder weg)
 * und bleibt stehen — genau dieser Unterschied ist der Sinn der Funktion.
 */
export function ohneSelectFehlzeile(text: string, wahl: string): string {
  const w = String(wahl || '').trim().toUpperCase()
  if (!istMac(w)) return String(text || '')
  return String(text || '')
    .split('\n')
    .filter((z) => !(z.toUpperCase().includes(`CONTROLLER ${w}`) && /not available/i.test(z)))
    .join('\n')
}

/**
 * Hat die Aktion geklappt? Pure.
 *
 * `bluetoothctl` endet auch bei Misserfolg oft mit Rückgabecode 0 und sagt
 * das Ergebnis nur im Text. Deshalb wird der Text ausgewertet — und im
 * Zweifel als Misserfolg gewertet, statt Erfolg zu behaupten.
 */
export function ergebnis(text: string): { ok: boolean; meldung: string } {
  const t = String(text || '')
  const fehler = /(Failed to [a-z]+|not available|Device not found|org\.bluez\.Error\.[A-Za-z]+)/.exec(t)
  if (fehler) {
    const m = /Failed to [a-z]+:?\s*(.*)/.exec(t)
    return { ok: false, meldung: (m?.[1] || fehler[1]).trim() }
  }
  if (/(Pairing successful|Connection successful|Changing .* succeeded|succeeded)/i.test(t))
    return { ok: true, meldung: '' }
  // Kein klares Wort in beide Richtungen: nicht behaupten, es habe geklappt.
  return { ok: false, meldung: t.trim().split('\n').slice(-1)[0] || 'keine Rückmeldung' }
}

// ═══════════════════════════════════════════════════════════════════════════
// FUNKADAPTER — welcher traegt den Ton, und taugt er dafuer?
// ═══════════════════════════════════════════════════════════════════════════
//
// WOFUER (am Geraet gefunden, 2026-07-28): eine Box kann mehrere
// Bluetooth-Adapter haben - den eingebauten und einen oder mehrere USB-Stecker.
// Welcher gerade den Ton traegt, sieht man nirgends, und es ist nicht
// gleichgueltig: der Ton lief hier ueber einen CSR-Klon mit 310 Byte je Paket,
// waehrend ein ASUS-Stecker mit 1021 Byte ungenutzt daneben steckte. Dreimal so
// viele Pakete fuer dieselbe Musik - genau daran bricht A2DP zuerst, und es
// klingt wie Aussetzer beim Hoeren.
//
// WARUM ALS GEPRUEFTER KERN: dieselbe Auswertung lief zuerst als Bash-Skript,
// und sie hatte ZWEI Fehler, die beim Drueberlesen unsichtbar waren -
// `/sys/class/bluetooth` listet auch VERBINDUNGEN wie "hci0:72" (sah aus wie
// ein weiterer Adapter), und `hciconfig` schreibt Geraeteadresse und Paketgroesse
// auf DIESELBE Zeile (das dritte Feld war ein Stueck der MAC, nicht die MTU).
// Beide Faelle stehen unten als Test.

export interface Funkadapter {
  /** hci0, hci1, … */
  name: string
  /** USB oder UART. UART heisst: eingebaut. */
  bus: string
  /** Bluetooth-Fassung, etwa "5.1". Leer, wenn nicht gemeldet. */
  fassung: string
  /** Groesse eines Datenpakets in Byte. Die wichtigste Zahl fuer Musik. */
  mtu: number
  /** Wie viele Pakete gleichzeitig unterwegs sein duerfen. */
  puffer: number
  /** USB-Kennung wie "0b05:190e", leer beim eingebauten. */
  kennung: string
  /** Klartextname des Chips, wenn wir ihn kennen. */
  chip: string
  /**
   * Wie der Adapter einem MENSCHEN gegenueber heisst.
   *
   * "hci0" sagt niemandem etwas, und beim naechsten Start kann daraus "hci2"
   * werden - die Nummer haengt daran, was zuerst gefunden wurde. Wer im
   * Elternbereich entscheiden soll, welcher Stecker den Ton traegt, braucht
   * einen Namen, den er am Geraet wiedererkennt.
   */
  bezeichnung: string
  /** 0 bis 10 - wie gut taugt er fuer Musik? */
  note: number
  /** Ein Satz, der die Note erklaert. */
  urteil: string
  /** Traegt dieser Adapter gerade den Ton? */
  traegtTon: boolean
  /**
   * Ist der Adapter eingeschaltet?
   *
   * WICHTIG FUER DIE BEWERTUNG: ein ausgeschalteter Adapter meldet seine
   * Bluetooth-Fassung nicht. Wer das nicht beruecksichtigt, zeigt ihm eine
   * schlechte Note an, obwohl er vielleicht der beste im Geraet ist - er ist
   * bloss gerade aus. Genau das war in der ersten Fassung zu sehen.
   */
  an: boolean
}

/** Chips, die wir mit Namen kennen - und was von ihnen zu halten ist. */
const CHIPS: Record<string, { name: string; gut: boolean }> = {
  '0a12:0001': { name: 'CSR8510-Klon', gut: false },
  '0bda:8771': { name: 'Realtek RTL8761BU', gut: true },
  '0bda:8761': { name: 'Realtek RTL8761B', gut: true },
  '0b05:190e': { name: 'ASUS USB-BT500 (RTL8761B)', gut: true },
  // DER NACHFOLGER (15.08.2026): Bluetooth 6.0, meldet sich als Realtek —
  // dieselbe Familie wie die bewaehrten 8761er. `gut` ist hier nicht
  // geraten, sondern AM GERAET gemessen (Box .57): Suchlauf fand 8 Geraete
  // in 8 s, der Teufel ROCKSTER koppelt und vertraut. Ohne diesen Eintrag
  // stand er als "USB-Adapter (0b05:1d70)" da und bekam Note 5 statt 10 —
  // ein Vorurteil der Tabelle, kein Messwert.
  '0b05:1d70': { name: 'ASUS USB-BT600', gut: true },
  '0bda:b82c': { name: 'Realtek RTL8822', gut: true },
  '8087:0032': { name: 'Intel AX210', gut: true },
  '8087:0029': { name: 'Intel AX200', gut: true },
}

/**
 * HCI-Versionscode -> Bluetooth-Fassung.
 *
 * WOZU: `hciconfig` uebersetzt den Code selbst — aber nur, solange es ihn
 * KENNT. Fuer Bluetooth 6.0 (Code 0xe) druckt das Werkzeug von 2023 nur
 * "HCI Version:  (0xe)", und wer allein das erste Feld liest, haelt einen
 * 6.0-Adapter fuer einen ohne Fassung. GENAU SO GESCHEHEN (15.08.2026,
 * ASUS USB-BT600 an Box .57): Note 5 statt 10, und der Betreiber wunderte
 * sich zu Recht, dass der neue Stick schlechter dastehen soll als der alte.
 */
const HCI_FASSUNGEN: Record<number, string> = {
  6: '4.0',
  7: '4.1',
  8: '4.2',
  9: '5.0',
  10: '5.1',
  11: '5.2',
  12: '5.3',
  13: '5.4',
  14: '6.0',
  15: '6.1',
}

/**
 * `hciconfig -a` auswerten.
 *
 * STOLPERSTEIN, der hier absichtlich behandelt wird: Geraeteadresse und
 * Paketgroesse stehen auf EINER Zeile —
 *   "BD Address: 00:15:83:F9:C5:4F  ACL MTU: 310:10  SCO MTU: 64:8"
 * Wer dort nach dem dritten Feld greift, bekommt die MAC. Deshalb wird
 * ausdruecklich nach "ACL MTU:" gesucht.
 */
export function parseAdapter(text: string): Funkadapter[] {
  const aus: Funkadapter[] = []
  let jetzt: Funkadapter | null = null

  for (const zeile of String(text || '').split('\n')) {
    const kopf = /^(hci\d+):\s*(.*)$/.exec(zeile)
    if (kopf) {
      jetzt = {
        name: kopf[1],
        bus: (/Bus:\s*(\S+)/.exec(kopf[2]) || [])[1] || '',
        fassung: '',
        mtu: 0,
        puffer: 0,
        kennung: '',
        chip: '',
        bezeichnung: '',
        an: false,
        note: 0,
        urteil: '',
        traegtTon: false,
      }
      aus.push(jetzt)
      continue
    }
    if (!jetzt) continue

    const mtu = /ACL MTU:\s*(\d+):(\d+)/.exec(zeile)
    if (mtu) {
      jetzt.mtu = Number(mtu[1])
      jetzt.puffer = Number(mtu[2])
    }
    // ERST DAS WORT, DANN DER CODE: "HCI Version: 5.1 (0xa)" traegt beides,
    // "HCI Version:  (0xe)" nur den Code — hciconfig kennt neuere Fassungen
    // nicht beim Namen (siehe HCI_FASSUNGEN). Der Code ist die verlaessliche
    // Quelle; das Wort bleibt der Rueckfall fuer Ausgaben ohne Klammer.
    const ver = /HCI Version:\s*([^\s(]*)\s*(?:\(0x([0-9a-fA-F]+)\))?/.exec(zeile)
    if (ver && zeile.includes('HCI Version:')) {
      const code = ver[2] ? Number.parseInt(ver[2], 16) : Number.NaN
      jetzt.fassung = HCI_FASSUNGEN[code] || ver[1] || (ver[2] ? `(0x${ver[2]})` : '')
    }
    if (/\bUP\b/.test(zeile)) jetzt.an = true
  }
  return aus
}

/**
 * Ein Name, den man am Geraet wiedererkennt.
 *
 * Reihenfolge: der bekannte Chip zuerst (das steht auf dem Stecker), sonst
 * "Eingebauter Funk" bzw. "USB-Adapter". Die hci-Nummer wird bewusst NICHT
 * zum Namen gemacht - sie kann sich beim naechsten Start aendern.
 */
export function adapterBezeichnung(a: Funkadapter): string {
  if (a.chip) return a.chip
  if (a.bus === 'UART') return 'Eingebauter Funk der Box'
  if (a.bus === 'USB') return a.kennung ? `USB-Adapter (${a.kennung})` : 'USB-Adapter'
  return 'Funkadapter'
}

/**
 * Wie gut taugt ein Adapter fuer Musik? 0 bis 10.
 *
 * DIE REIHENFOLGE IST BEGRUENDET, nicht geraten:
 *   Die PAKETGROESSE zaehlt am meisten. Sie bestimmt, wie oft gefunkt werden
 *   muss, und A2DP bricht als Erstes an zu vielen kleinen Paketen.
 *   Die FASSUNG danach - 5.x hat mehr Luft als 4.0.
 *   Der CHIP zuletzt, als Zuschlag oder Abzug fuer bekannte Kandidaten.
 *
 * EINGEBAUT WIRD ABGEWERTET, obwohl die Zahlen gut aussehen: beim Raspberry Pi
 * teilen sich WLAN und Bluetooth dasselbe Funkmodul. Wer einen Stecker
 * benutzt, hat sie meist genau deshalb getrennt - ein Vorschlag "nimm den
 * eingebauten" waere dann ein Rueckschritt.
 */
export function bewerteAdapter(a: Funkadapter): { note: number; urteil: string } {
  let n = 0
  const gruende: string[] = []

  if (a.mtu >= 1000) n += 5
  else if (a.mtu >= 600) n += 3
  else if (a.mtu >= 400) n += 2
  else if (a.mtu > 0) {
    n += 0
    gruende.push(`nur ${a.mtu} Byte je Paket — eng für Musik`)
  }

  const f = Number.parseFloat(a.fassung)
  if (f >= 5.1) n += 3
  else if (f >= 5) n += 2
  else if (f > 0) gruende.push(`Bluetooth ${a.fassung}`)

  const chip = CHIPS[a.kennung]
  if (chip?.gut) {
    n += 2
    gruende.push(chip.name)
  } else if (chip && !chip.gut) {
    n -= 2
    gruende.push(`${chip.name} — bekannt für Aussetzer bei Musik`)
  }

  if (a.bus === 'UART') {
    n -= 3
    gruende.push('eingebaut — teilt sich Chip und Antenne mit dem WLAN')
  }

  n = Math.max(0, Math.min(10, n))
  if (!gruende.length) gruende.push(a.mtu >= 1000 ? 'große Pakete, gut für Musik' : 'unauffällig')
  // Ein ausgeschalteter Adapter meldet seine Fassung nicht - seine Note waere
  // also zu niedrig und der Vergleich unfair. Lieber gar keine Note nennen.
  if (!a.an) return { note: 0, urteil: 'ausgeschaltet — keine Aussage möglich' }
  return { note: n, urteil: gruende.join(' · ') }
}

/**
 * Die Adapter zusammenstellen, bewerten und den besten zuerst.
 *
 * @param hciText   Ausgabe von `hciconfig -a`
 * @param kennungen hci-Name -> USB-Kennung (kommt aus dem Dateisystem)
 * @param traeger   welcher hci-Name gerade den Ton traegt
 */
export function adapterListe(
  hciText: string,
  kennungen: Record<string, string> = {},
  traeger = '',
): Funkadapter[] {
  const liste = parseAdapter(hciText)
  for (const a of liste) {
    a.kennung = kennungen[a.name] || ''
    a.chip = CHIPS[a.kennung]?.name || ''
    a.bezeichnung = adapterBezeichnung(a)
    a.traegtTon = a.name === traeger
    const b = bewerteAdapter(a)
    a.note = b.note
    a.urteil = b.urteil
  }
  // Bester zuerst; bei Gleichstand der, der gerade laeuft (kein Grund zu wechseln).
  return liste.sort((x, y) => y.note - x.note || Number(y.traegtTon) - Number(x.traegtTon))
}

/**
 * Gibt es einen SPUERBAR besseren als den, der gerade laeuft?
 *
 * Zwei Noten Abstand, damit die Oberflaeche nicht wegen eines Punktes zum
 * Umstecken raet. Ein Rat, der sich nicht lohnt, kostet nur Vertrauen.
 */
export function besserenFinden(liste: Funkadapter[]): Funkadapter | null {
  const jetzt = liste.find((a) => a.traegtTon)
  if (!jetzt) return null
  // Nur eingeschaltete vergleichen: von einem ausgeschalteten wissen wir zu
  // wenig, um zum Umstecken zu raten.
  const bester = liste.find((a) => !a.traegtTon && a.an && a.note >= jetzt.note + 2)
  return bester || null
}
