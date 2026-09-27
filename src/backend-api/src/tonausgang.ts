/**
 * WO SPIELT ES? — die Ausgänge der Box und die Wahl dazwischen.
 *
 * ══ DER FALL, WEGEN DEM ES DAS GIBT ═══════════════════════════════════════
 * Gemeldet am 08.08.2026: „das deaktivieren eines bluetooth gerätes fehlt noch
 * also bei 2 verbundenen eins auswählen wo es spielen soll."
 *
 * ══ TRENNEN GAB ES SCHON — AUSWÄHLEN NICHT ═══════════════════════════════
 * Der Weg `POST /api/bluetooth/:mac/trennen` ist alt, und die Zeile im
 * Bluetooth-Fach bietet ihn an. Was fehlte, ist die andere Hälfte: Sind ZWEI
 * Lautsprecher verbunden, entscheidet nicht Bluetooth, wo der Ton hingeht,
 * sondern der TONSERVER. Am Gerät nachgesehen (.169, 08.08.2026):
 *
 *     pactl list short sinks
 *       62     alsa_output.platform-soc_107c000000_sound.stereo-fallback
 *       40524  bluez_output.7C_96_D2_89_35_CC.1               RUNNING
 *     pactl get-default-sink -> bluez_output.7C_96_D2_89_35_CC.1
 *
 * Es ist PipeWire mit der Pulse-Schicht. Die Wahl ist also `set-default-sink`
 * — und, weil ein LAUFENDER Strom die alte Wahl behält, zusätzlich
 * `move-sink-input` für jeden Strom. Wer nur die Vorgabe umstellt, hört den
 * Wechsel erst beim nächsten Stück; für ein Kind sieht das aus, als sei nichts
 * passiert.
 *
 * ══ REIN ══════════════════════════════════════════════════════════════════
 * Kein Netz, kein Prozessaufruf, kein Express. Diese Datei liest die Ausgaben
 * von `pactl` und entscheidet, was ein gültiger Ausgangsname ist; wer `pactl`
 * ruft, steht in server.ts.
 */

/** Ein Ausgang, wie ihn die Oberfläche braucht. */
export interface Ausgang {
  /** Der technische Name, mit dem `pactl` arbeitet. */
  name: string
  /** Was am Schirm steht. */
  wort: string
  /** 'bluetooth' | 'box' | 'anders' — entscheidet nur über das Zeichen. */
  art: 'bluetooth' | 'box' | 'anders'
  /** Spielt gerade hierher (Vorgabe des Tonservers). */
  gewaehlt: boolean
  /** Der Tonserver meldet ihn als laufend. */
  laeuft: boolean
}

/**
 * Ein Ausgangsname, wie `pactl` ihn vergibt — und NICHTS anderes.
 *
 * ══ DAS IST EIN RIEGEL UND KEINE FORMPRÜFUNG ═════════════════════════════
 * Der Name kommt aus dem Netz und geht in einen Prozessaufruf. Zwar ruft
 * server.ts `execFile` ohne Shell (kein `;` und kein `&&` wären wirksam) —
 * aber ein Name mit einem führenden `-` wäre für `pactl` eine OPTION, und
 * welche Optionen ein künftiges pactl kennt, weiß hier niemand.
 *
 * Erlaubt sind deshalb nur Buchstaben, Ziffern, Punkt, Bindestrich und
 * Unterstrich, und der erste Buchstabe muss ein Buchstabe sein. Genau das
 * liefert PipeWire (`alsa_output.…`, `bluez_output.7C_96_D2_89_35_CC.1`).
 */
export function istAusgangsname(x: unknown): x is string {
  return typeof x === 'string' && x.length > 0 && x.length <= 200 && /^[A-Za-z][A-Za-z0-9._-]*$/.test(x)
}

/** Die MAC aus einem `bluez_output.7C_96_D2_89_35_CC.1` — oder null. */
export function macAusSink(name: unknown): string | null {
  const m = /^bluez_output\.([0-9A-Fa-f]{2}(?:_[0-9A-Fa-f]{2}){5})\b/.exec(String(name ?? ''))
  return m ? m[1].replace(/_/g, ':').toUpperCase() : null
}

/**
 * `pactl list short sinks` auswerten.
 *
 * DIE ZEILEN SIND TABGETRENNT: Kennung, Name, Treiber, Format, Zustand. Der
 * Zustand ist RUNNING, IDLE oder SUSPENDED.
 *
 * WAS NICHT DURCHKOMMT: Zeilen, deren Name nicht durch `istAusgangsname`
 * geht. `pactl` schreibt bei einem Fehler auch schon mal eine Meldung auf die
 * Standardausgabe („Failed to load cookie file…", am Gerät gesehen) — die
 * hätte sonst als Ausgang in der Liste gestanden.
 */
export function sinksAus(text: unknown): { name: string; laeuft: boolean }[] {
  const raus: { name: string; laeuft: boolean }[] = []
  for (const z of String(text ?? '').split('\n')) {
    const t = z.split('\t')
    if (t.length < 2) continue
    const name = t[1].trim()
    if (!istAusgangsname(name)) continue
    raus.push({ name, laeuft: /RUNNING/i.test(z) })
  }
  return raus
}

/**
 * Die Kennungen der mixpi-Leersenken aus `pactl list short sinks`.
 *
 * ══ ES GIBT SENKEN, DIE ABSICHTLICH INS LEERE FÜHREN ═════════════════════
 * Der Mitschnitt (plugins/mixpi-mitschnitt) spielt Titel SELBST, um sie
 * aufzunehmen — still, in die Leersenke `mixpi-mitschnitt` aus
 * config/templates/62-mixpi-mitschnitt.conf. Ein Strom, der DORT hängt,
 * hängt dort mit Absicht: Wer ihn beim Ausgangswechsel mitnimmt, macht den
 * stummen Mitschnitt plötzlich hörbar — und die Aufnahme greift danach den
 * falschen Weg ab.
 *
 * ERKANNT AM NAMEN, nicht an einer Eigenschaft: die Kurzausgabe von `pactl`
 * verrät nicht, ob hinter einer Senke Hardware steckt. Alles Eigene der Box
 * heißt `mixpi-…` (die Leersenke heute, weitere morgen); die gewachsenen
 * Wege (`alsa_output.…`, `bluez_output.…`, `entzerrer`) heißen es nie.
 *
 * ZURÜCK KOMMEN KENNUNGEN, KEINE NAMEN — in der Stromliste steht die Senke
 * als Nummer, und genau dagegen muss `stroemeAus` vergleichen.
 */
export function mixpiLeersenken(sinkText: unknown): Set<string> {
  const raus = new Set<string>()
  for (const z of String(sinkText ?? '').split('\n')) {
    const t = z.split('\t')
    if (t.length < 2) continue
    const kennung = t[0].trim()
    if (/^\d+$/.test(kennung) && t[1].trim().startsWith('mixpi-')) raus.add(kennung)
  }
  return raus
}

/**
 * Die Kennungen der laufenden Ströme aus `pactl list short sink-inputs`.
 *
 * SIE WERDEN GEBRAUCHT, WEIL EIN LAUFENDER STROM DIE ALTE WAHL BEHÄLT. Ohne
 * `move-sink-input` hörte man den Wechsel erst beim nächsten Stück.
 *
 * GESCHONT WIRD, WESSEN SENKE IN `geschont` STEHT (die zweite Spalte ist
 * die Senken-KENNUNG): Ströme in einer mixpi-Leersenke — heute der stumme
 * Mitschnitt — bleiben beim Ausgangswechsel, wo sie sind.
 */
export function stroemeAus(text: unknown, geschont?: ReadonlySet<string>): string[] {
  const raus: string[] = []
  for (const z of String(text ?? '').split('\n')) {
    const t = z.split('\t')
    if (t.length < 2) continue
    const kennung = t[0].trim()
    if (!/^\d+$/.test(kennung)) continue
    if (geschont?.has(t[1].trim())) continue
    raus.push(kennung)
  }
  return raus
}

/** Ein Bluetooth-Gerät, soweit es für den Namen zählt. */
export interface BtName {
  mac?: string
  name?: string
}

/**
 * Der Name, der am Schirm steht.
 *
 * ══ ER KOMMT AUS DER BLUETOOTH-LISTE, NICHT AUS DEM SINK-NAMEN ═══════════
 * `bluez_output.7C_96_D2_89_35_CC.1` ist für niemanden ein Lautsprecher.
 * Steht dieselbe MAC in der Bluetooth-Liste, heißt der Ausgang wie das Gerät
 * dort — „Teufel ROCKSTER Cross". Findet sich nichts, bleibt die MAC übrig:
 * eine Adresse ist hässlich, aber sie ist WAHR, und ein erfundener Name
 * („Lautsprecher 2") wäre eine Behauptung.
 *
 * DER EINGEBAUTE AUSGANG HEISST NACH DEM, WAS ER IST. `alsa_output.…` ist auf
 * dieser Box der MAX98357A auf dem MuPiHAT — also der Lautsprecher IN der
 * Box. Andere ALSA-Ausgänge (HDMI) bekämen denselben Satz; das ist bewusst
 * grob gehalten, weil die Box genau einen eingebauten Weg hat und alles
 * andere hier nicht vorkommt.
 */
export function ausgangWort(name: string, bt: readonly BtName[]): { wort: string; art: Ausgang['art'] } {
  const mac = macAusSink(name)
  if (mac) {
    const g = (Array.isArray(bt) ? bt : []).find((x) => String(x?.mac ?? '').toUpperCase() === mac)
    const wort = String(g?.name ?? '').trim()
    return { wort: wort || mac, art: 'bluetooth' }
  }
  if (name.startsWith('alsa_output.')) return { wort: 'Lautsprecher der Box', art: 'box' }
  return { wort: name, art: 'anders' }
}

/**
 * Die ganze Liste, fertig für die Oberfläche.
 *
 * SORTIERT: der eingebaute Ausgang zuletzt. Wer zwei Lautsprecher verbunden
 * hat, will zwischen IHNEN wählen; die Box selbst ist der Rückweg und steht
 * deshalb unten — dort, wo man ihn sucht, wenn nichts anderes geht.
 */
export function ausgaenge(sinkText: unknown, vorgabe: unknown, bt: readonly BtName[]): Ausgang[] {
  const v = String(vorgabe ?? '').trim()
  const liste = sinksAus(sinkText)
    // MIXPI-SENKEN SIND KEIN ANGEBOT: das sind interne Parkplaetze (die
    // Leersenke des Mitschnitts). In der Liste standen sie als „anders" —
    // und wer sie waehlte, parkte ALLE Stroeme dauerhaft im Stummen, denn
    // die Schonung laesst sie beim Rueckwechsel absichtlich liegen. Der
    // POST-Riegel im Server ist das Gegenstueck fuer Direktaufrufe.
    .filter((s) => !s.name.startsWith('mixpi-'))
    .map((s) => {
      const { wort, art } = ausgangWort(s.name, bt)
      return { name: s.name, wort, art, gewaehlt: s.name === v, laeuft: s.laeuft }
    })
  liste.sort((a, b) => (a.art === 'box' ? 1 : 0) - (b.art === 'box' ? 1 : 0) || a.wort.localeCompare(b.wort, 'de'))
  return liste
}
