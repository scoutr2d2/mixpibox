/**
 * Netzwerkzustand lesen und ein WLAN hinterlegen.
 *
 * ERSETZT network.php. Dort wanderte z.B. $_POST['wifinr'] per Verkettung in
 * `wpa_cli remove_network …` (network.php:178). Hier gilt dieselbe Regel wie
 * bei den Diensten: keine Shell, und alles, was hereinkommt, wird geprüft,
 * bevor es irgendwohin geschrieben wird.
 *
 * WARUM DIE PRÜFUNG HIER WIRKLICH ZÄHLT — nachgesehen im Repo, nicht vermutet:
 * `scripts/mupibox/add_wifi.sh` ist eine ROOT-Schleife, die alle 2 Sekunden
 * `wlan.json` liest und den Namen dort UNQUOTIERT in wpa_supplicant.conf
 * schreibt (add_wifi.sh:48: `echo '\tssid="'${SSID}'"' | sudo tee -a`).
 * Wer also in diese Datei schreiben darf, schreibt in die WLAN-Konfiguration
 * der Box. Genau diese Datei beschrieb der alte Weg `POST /api/addwlan`
 * ungeprüft, und er lag vor dem Anmeldetor, also offen im ganzen LAN. Er ist
 * am 19.09.2026 gefallen (AUDIT-2026-09-19 Rang 7): kein Rufer im Baum, und
 * am Gerät (.62) trug `wlan.json` 3 Byte mit der mtime des Einrichtungstages
 * — die Route ist dort nie benutzt worden.
 *
 * Deshalb sind die Grenzen unten eng und begründet, nicht nach Gefühl.
 */

/** Ein Netzwerkname darf laut IEEE 802.11 höchstens 32 BYTE lang sein. */
export const SSID_MAX_BYTES = 32
/** WPA-PSK: 8 bis 63 Zeichen (64 wäre der rohe Schlüssel in Hex). */
export const PSK_MIN = 8
export const PSK_MAX = 63

export interface Pruefung {
  ok: boolean
  grund?: string
}

/**
 * Netzwerknamen prüfen. Pure.
 *
 * Verboten sind Steuerzeichen, Anführungszeichen und Rückstrich — nicht aus
 * Prinzip, sondern weil genau die aus einer Zeile in wpa_supplicant.conf
 * ausbrechen könnten. Ein echter Netzwerkname braucht sie nicht.
 */
export function pruefeSsid(ssid: unknown): Pruefung {
  if (typeof ssid !== 'string') return { ok: false, grund: 'kein Text' }
  if (ssid.length === 0) return { ok: false, grund: 'leer' }
  if (Buffer.byteLength(ssid, 'utf8') > SSID_MAX_BYTES)
    return { ok: false, grund: `länger als ${SSID_MAX_BYTES} Byte` }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: genau die sollen raus
  if (/[\u0000-\u001f\u007f]/.test(ssid)) return { ok: false, grund: 'enthält Steuerzeichen' }
  if (/["\\]/.test(ssid)) return { ok: false, grund: 'enthält " oder \\' }
  return { ok: true }
}

/** Passwort prüfen. Pure. Der Wert selbst wird NIE protokolliert. */
export function pruefePsk(psk: unknown): Pruefung {
  // Ein offenes Netz hat kein Passwort — das ist erlaubt.
  if (psk === undefined || psk === null || psk === '') return { ok: true }
  if (typeof psk !== 'string') return { ok: false, grund: 'kein Text' }
  if (psk.length < PSK_MIN || psk.length > PSK_MAX)
    return { ok: false, grund: `muss ${PSK_MIN} bis ${PSK_MAX} Zeichen haben` }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: genau die sollen raus
  if (/[\u0000-\u001f\u007f]/.test(psk)) return { ok: false, grund: 'enthält Steuerzeichen' }
  if (/["\\]/.test(psk)) return { ok: false, grund: 'enthält " oder \\' }
  return { ok: true }
}

export interface Adresse {
  familie: 'v4' | 'v6'
  adresse: string
  praefix: number
}

export interface Schnittstelle {
  name: string
  aktiv: boolean
  /** true, wenn es nach WLAN aussieht (wlan0, wlp2s0 …). */
  funk: boolean
  adressen: Adresse[]
}

/**
 * Ausgabe von `ip -j addr show` auswerten. Pure.
 *
 * `ip -j` liefert fertiges JSON — kein Zeilenparsen, keine Sprachabhängigkeit.
 * Ältere iproute2-Fassungen kennen -j nicht; dann kommt kein JSON, und wir
 * geben eine leere Liste zurück statt zu werfen.
 */
export function parseIpAddr(text: string): Schnittstelle[] {
  let roh: unknown
  try {
    roh = JSON.parse(text)
  } catch {
    return []
  }
  if (!Array.isArray(roh)) return []
  const raus: Schnittstelle[] = []
  for (const e of roh as Record<string, unknown>[]) {
    const name = typeof e['ifname'] === 'string' ? e['ifname'] : ''
    if (!name || name === 'lo') continue
    const info = Array.isArray(e['addr_info']) ? (e['addr_info'] as Record<string, unknown>[]) : []
    const adressen: Adresse[] = []
    for (const a of info) {
      const adresse = typeof a['local'] === 'string' ? a['local'] : ''
      const familie = a['family'] === 'inet' ? 'v4' : a['family'] === 'inet6' ? 'v6' : null
      if (!adresse || !familie) continue
      // Verbindungslokale v6-Adressen (fe80::) helfen niemandem beim Zugriff.
      if (familie === 'v6' && adresse.toLowerCase().startsWith('fe80')) continue
      adressen.push({ familie, adresse, praefix: Number(a['prefixlen']) || 0 })
    }
    raus.push({
      name,
      aktiv: e['operstate'] === 'UP',
      funk: /^(wl|wlan)/.test(name),
      adressen,
    })
  }
  return raus
}

export interface WlanVerbindung {
  ssid: string
  /** Empfangsstärke in dBm (negativ; näher an 0 ist besser). */
  signal: number | null
  frequenzMhz: number | null
}

/**
 * Ausgabe von `iw dev <if> link` auswerten. Pure.
 *
 * Nicht verbunden meldet `iw` mit "Not connected." — dann null.
 */
export function parseIwLink(text: string): WlanVerbindung | null {
  if (!text || /not connected/i.test(text)) return null
  const ssid = /^\s*SSID:\s*(.+)$/m.exec(text)?.[1]?.trim()
  if (!ssid) return null
  const signal = /^\s*signal:\s*(-?\d+)/m.exec(text)?.[1]
  const freq = /^\s*freq:\s*(\d+)/m.exec(text)?.[1]
  return {
    ssid,
    signal: signal === undefined ? null : Number(signal),
    frequenzMhz: freq === undefined ? null : Number(freq),
  }
}

/**
 * Empfangsstärke in eine verständliche Stufe übersetzen. Pure.
 *
 * dBm sagt Laien nichts. Die Schwellen sind die üblichen Faustwerte:
 * ab -60 sehr gut, bis -70 brauchbar, darunter wird es wacklig.
 */
export function signalStufe(dbm: number | null): 'gut' | 'mittel' | 'schwach' | 'unbekannt' {
  if (dbm === null || Number.isNaN(dbm)) return 'unbekannt'
  if (dbm >= -60) return 'gut'
  if (dbm >= -70) return 'mittel'
  return 'schwach'
}

/**
 * Den Eintrag bauen, den add_wifi.sh erwartet. Pure.
 *
 * Die Form ist NICHT frei wählbar: das Skript liest `.[].ssid` und `.[].pw`
 * per jq aus einer Liste. Wer hier umbenennt, bricht die Box, ohne dass es
 * jemand merkt — deshalb steht es hier an einer Stelle, mit Test.
 */
export function wlanEintrag(ssid: string, psk?: string): { ssid: string; pw: string } {
  return { ssid, pw: psk ?? '' }
}

/**
 * Pegel aus /proc/net/wireless lesen. Pure.
 *
 * AM GERÄT GELERNT: `iw` ist auf dieser Box GAR NICHT installiert, ebenso
 * wenig iwconfig, iwgetid oder nmcli. Die Seite meldete deshalb „keine
 * WLAN-Verbindung", obwohl eine bestand — schlimmer als keine Angabe, weil es
 * eine FALSCHE ist.
 *
 * /proc/net/wireless kommt dagegen vom Kernel selbst: kein Werkzeug, keine
 * Rechte, immer da, sobald es überhaupt eine Funkschnittstelle gibt. Form:
 *
 *   Inter-| sta-|   Quality        | …
 *    face | tus | link level noise | …
 *    wlan0: 0000   39.  -71.  -256 …
 *
 * Die Werte tragen einen angehängten Punkt („-71."), der NICHT ein
 * Dezimaltrennzeichen ist, sondern die Kennzeichnung „aktualisiert".
 */
export function parseProcWireless(text: string, schnittstelle?: string): number | null {
  for (const zeile of String(text || '').split('\n')) {
    const m = /^\s*([A-Za-z0-9_.-]+):\s+\S+\s+([-\d.]+)\s+([-\d.]+)/.exec(zeile)
    if (!m) continue
    if (schnittstelle && m[1] !== schnittstelle) continue
    const pegel = Number.parseInt(m[3], 10)
    if (!Number.isFinite(pegel)) continue
    // 0 heisst hier "keine Angabe", nicht "hervorragend".
    return pegel === 0 ? null : pegel
  }
  return null
}

/**
 * Ausgabe von `wpa_cli -i <if> status` auswerten. Pure.
 *
 * Auf dieser Box liegt wpa_cli in /sbin und ist im PATH von `dietpi` NICHT
 * sichtbar — es muss mit vollem Pfad und über sudo gerufen werden.
 */
export function parseWpaStatus(text: string): { ssid: string; frequenzMhz: number | null } | null {
  const felder: Record<string, string> = {}
  for (const zeile of String(text || '').split('\n')) {
    const i = zeile.indexOf('=')
    if (i > 0) felder[zeile.slice(0, i).trim()] = zeile.slice(i + 1).trim()
  }
  const ssid = felder['ssid']
  if (!ssid) return null
  const f = Number.parseInt(felder['freq'] ?? '', 10)
  return { ssid, frequenzMhz: Number.isFinite(f) ? f : null }
}

/**
 * Traegt die Box das Ziel-Netz beweisbar? Pure — der Stoff fuer die
 * SELBSTBESTAETIGUNG eines WLAN-Wechsels.
 *
 * WOZU (Betreiber, 14.08.2026, zum dritten Mal): „warum werden die wlan
 * passwoerter nicht gespeichert". Der Totmannschalter schrieb das Passwort
 * erst mit der Bestaetigung des Menschen fest — aber gerade wenn der Wechsel
 * GELINGT, wechselt die Adresse der Box, und der Bestaetigen-Knopf erreicht
 * sie nicht mehr. Der Schutz bestrafte den Erfolgsfall.
 *
 * Deshalb bestaetigt die Box sich selbst, sobald DREI Dinge zusammen wahr
 * sind — jedes einzelne reicht nicht:
 *   wpa_state=COMPLETED   die Anmeldung ist durch (ein falsches Passwort
 *                         kommt hier NIE an — es pendelt zwischen SCANNING
 *                         und 4WAY_HANDSHAKE)
 *   ssid=<ziel>           es ist DAS bestellte Netz, nicht ein Rueckfall
 *                         auf ein anderes gespeichertes
 *   ip_address            DHCP hat geantwortet — die Box ist im Netz auch
 *                         ansprechbar, nicht nur assoziiert
 *
 * INTERNET IST ABSICHTLICH KEINE BEDINGUNG: ein Netz ohne Weg nach draussen
 * ist eine erlaubte Wahl (Gastnetz), das sagt schon die Oberflaeche.
 */
export function traegtDasNetz(statusText: string, zielSsid: string): boolean {
  const felder: Record<string, string> = {}
  for (const zeile of String(statusText || '').split('\n')) {
    const i = zeile.indexOf('=')
    if (i > 0) felder[zeile.slice(0, i).trim()] = zeile.slice(i + 1).trim()
  }
  return (
    felder['wpa_state'] === 'COMPLETED' &&
    felder['ssid'] === zielSsid &&
    Boolean(felder['ip_address'])
  )
}

// ── Verfuegbare Netze suchen ────────────────────────────────────────────────
//
// WARUM SO UND NICHT ANDERS: auf dieser Box gibt es WEDER `iw` NOCH iwlist,
// iwconfig, iwgetid oder nmcli (siehe parseProcWireless). Uebrig bleibt
// `wpa_cli` — was ohnehin richtig ist, weil wpa_supplicant der Stapel der Box
// ist und der Stack-Wechsel auf NetworkManager bewusst NICHT gemacht wurde.
//
// Der Ablauf ist zweistufig: `scan` stoesst die Suche an und antwortet sofort
// mit "OK", die Ergebnisse holt danach `scan_results`. Zwischen beidem muss
// gewartet werden — sonst liest man die Liste des VORIGEN Durchlaufs.

/** Ein gefundenes Funknetz, so wie wpa_supplicant es meldet. */
export interface ScanZeile {
  bssid: string
  frequenzMhz: number | null
  signalDbm: number | null
  flags: string
  ssid: string
}

/**
 * Ausgabe von `wpa_cli -i <if> scan_results` zerlegen. Pure.
 *
 * Form (tabgetrennt, erste Zeile ist eine Ueberschrift):
 *
 *   bssid / frequency / signal level / flags / ssid
 *   00:11:22:33:44:55	2412	-45	[WPA2-PSK-CCMP][ESS]	MeinNetz
 *
 * Nachsichtig gegenueber allem, was nicht passt: die Liste ist eine
 * Momentaufnahme der Funkumgebung, und ein halb geschriebener Eintrag darf
 * die ganze Seite nicht scheitern lassen. Eine LEERE SSID ist ein verstecktes
 * Netz — das laesst sich nicht per Klick auswaehlen und faellt deshalb raus.
 */
export function parseScanResults(text: string): ScanZeile[] {
  const raus: ScanZeile[] = []
  for (const zeile of String(text || '').split('\n')) {
    const t = zeile.split('\t')
    if (t.length < 5) continue
    const bssid = t[0].trim()
    if (!/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i.test(bssid)) continue // faengt die Ueberschrift
    const ssid = t.slice(4).join('\t').trim() // eine SSID darf einen Tab enthalten
    if (!ssid) continue
    const f = Number.parseInt(t[1], 10)
    const s = Number.parseInt(t[2], 10)
    raus.push({
      bssid: bssid.toLowerCase(),
      frequenzMhz: Number.isFinite(f) ? f : null,
      signalDbm: Number.isFinite(s) ? s : null,
      flags: t[3].trim(),
      ssid,
    })
  }
  return raus
}

export type Sicherheit = 'offen' | 'wep' | 'wpa' | 'wpa-enterprise'

/**
 * Welche Absicherung meldet das Netz? Pure.
 *
 * Der Unterschied zwischen `wpa` und `wpa-enterprise` ist fuer die
 * Oberflaeche entscheidend: bei ENTERPRISE (EAP, Benutzername + Passwort +
 * ggf. Zertifikat) reicht die Eingabe eines Passworts NICHT. So ein Netz
 * anzubieten, als koenne man sich mit einem Passwort verbinden, fuehrt in
 * eine Sackgasse — lieber ehrlich abblenden.
 */
export function sicherheitAusFlags(flags: string): Sicherheit {
  const f = String(flags || '').toUpperCase()
  if (f.includes('-EAP')) return 'wpa-enterprise'
  if (f.includes('WPA')) return 'wpa' // deckt WPA, WPA2 und WPA3/SAE ab
  if (f.includes('RSN')) return 'wpa'
  if (f.includes('WEP')) return 'wep'
  return 'offen'
}

/** Bietet dieses Netz WPS per Knopfdruck an? Pure. */
export function hatWps(flags: string): boolean {
  return String(flags || '').toUpperCase().includes('[WPS')
}

/** 2,4 oder 5 GHz — aus der Frequenz. Pure. `null` wenn unbekannt. */
export function bandAusFrequenz(mhz: number | null): '2,4 GHz' | '5 GHz' | null {
  if (mhz === null || !Number.isFinite(mhz)) return null
  if (mhz >= 2400 && mhz < 2500) return '2,4 GHz'
  if (mhz >= 4900 && mhz < 5900) return '5 GHz'
  return null
}

/** Braucht dieses Netz ein Passwort, das man eintippen kann? Pure. */
export function brauchtPasswort(s: Sicherheit): boolean {
  return s === 'wpa' || s === 'wep'
}

/**
 * Wie ist das Netz verschluesselt — als lesbarer Name. Pure.
 *
 * `sicherheitAusFlags` beantwortet die FRAGE DER OBERFLAECHE („brauche ich ein
 * Passwort?"), hier geht es um die Anzeige: WPA2, WPA3, gemischt. Der
 * Unterschied ist keine Spitzfindigkeit — ein Geraet, das an einem reinen
 * WPA3-Netz scheitert, kommt an demselben Router im Uebergangsbetrieb
 * (WPA2+SAE) problemlos hinein, und das sieht man nur hier.
 */
export function verschluesselungName(flags: string): string {
  const f = String(flags || '').toUpperCase()
  if (f.includes('-EAP')) return 'WPA2-Enterprise'
  const wpa3 = f.includes('SAE')
  const wpa2 = f.includes('WPA2') || f.includes('RSN')
  const wpa1 = /\[WPA-/.test(f)
  if (wpa3 && wpa2) return 'WPA2/WPA3'
  if (wpa3) return 'WPA3'
  if (wpa2 && wpa1) return 'WPA/WPA2'
  if (wpa2) return 'WPA2'
  if (wpa1) return 'WPA'
  if (f.includes('WEP')) return 'WEP'
  return 'offen'
}

/** Ein Netz, dessen Zugangsdaten wpa_supplicant bereits kennt. */
export interface GespeichertesNetz {
  /** Die Netzkennung von wpa_supplicant — die Zahl aus `list_networks`. */
  id: number
  ssid: string
  /** Die Box haengt GERADE in diesem Netz ([CURRENT]). */
  aktuell: boolean
  /** Abgeschaltet ([DISABLED]) — gespeichert, aber gerade nicht in der Auswahl. */
  abgeschaltet: boolean
}

/**
 * Ausgabe von `wpa_cli list_networks` auswerten. Pure.
 *
 * Form (tabgetrennt, erste Zeile Ueberschrift):
 *   0\tMeinNetz\tany\t
 *   1\tAnderes\tany\t[CURRENT]
 *
 * Damit laesst sich in der Liste zeigen, welche Netze die Box schon KENNT
 * (Passwort liegt vor) und in welchem sie GERADE haengt.
 *
 * DIE KENNUNG WIRD SEIT E115 MITGENOMMEN (31.08.2026). Sie war vorher
 * weggeworfen, weil die Scan-Liste nur „kenne ich / haenge ich drin" brauchte.
 * Fuers Verbinden OHNE Passwort ist sie aber der ganze Punkt: `select_network`
 * spricht Netze ausschliesslich ueber diese Zahl an, und nur eine Zahl, die
 * HIER aus der echten Liste gelesen wurde, darf spaeter an wpa_cli gehen
 * (siehe pruefeNetzKennung und der Kommentar am Dateikopf zu network.php:178).
 */
export function parseListNetworks(text: string): GespeichertesNetz[] {
  const raus: GespeichertesNetz[] = []
  for (const zeile of String(text || '').split('\n')) {
    const t = zeile.split('\t')
    if (t.length < 2) continue
    const kennung = t[0].trim()
    if (!/^\d+$/.test(kennung)) continue // faengt die Ueberschrift
    const ssid = t[1].trim()
    if (!ssid) continue
    const flaggen = t[3] ?? ''
    raus.push({
      id: Number.parseInt(kennung, 10),
      ssid,
      aktuell: flaggen.includes('[CURRENT]'),
      abgeschaltet: flaggen.includes('[DISABLED]'),
    })
  }
  return raus
}

/** Ergebnis der Kennungspruefung — mit dem gefundenen Netz, wenn es eines gibt. */
export interface KennungPruefung extends Pruefung {
  /** Nur gesetzt, wenn `ok`. Traegt SSID und Zustand des getroffenen Netzes. */
  netz?: GespeichertesNetz
}

/**
 * Eine Netzkennung gegen die WIRKLICH vorhandenen Netze pruefen. Pure.
 *
 * DAS IST DIE STELLE, DIE ZAEHLT (E115, 31.08.2026). Am Dateikopf steht, wie
 * `network.php:178` `$_POST['wifinr']` per Verkettung in
 * `wpa_cli remove_network …` schob. Der neue Weg schickt wieder eine ZAHL VON
 * AUSSEN an wpa_cli — diesmal ueber execFile mit Argument-Array, also ohne
 * Shell. Das allein reicht aber nicht:
 *
 *   * `remove_network 7` auf eine Kennung, die dem Anrufer gar nicht gehoert,
 *     loescht trotzdem ein fremdes Netz. Ohne Shell, aber genauso weg.
 *   * `select_network all` ist bei wpa_cli ein gueltiges Wort und wuerde
 *     etwas voellig anderes tun als bestellt.
 *
 * Deshalb ist die Regel nicht „sieht wie eine Zahl aus", sondern „steht in der
 * Liste, die wir gerade selbst von wpa_supplicant gelesen haben". Eine
 * wohlgeformte Zahl, die es nicht gibt, wird abgelehnt — nicht durchgereicht
 * und von wpa_cli mit FAIL quittiert, denn dann stuende die Entscheidung bei
 * einem Fremdprozess statt hier.
 *
 * Angenommen werden eine echte Zahl und eine reine Ziffernfolge (JSON-Zahlen
 * kommen als `number`, Formularwerte als Text). NICHT angenommen: '01', '1e1',
 * '0x1', ' 1', '1;reboot', 1.5, negatives — sie koennten alle irgendwo anders
 * wieder zu etwas anderem werden als hier.
 */
export function pruefeNetzKennung(
  kennung: unknown,
  gespeichert: GespeichertesNetz[],
): KennungPruefung {
  let zahl: number
  if (typeof kennung === 'number') {
    if (!Number.isInteger(kennung) || kennung < 0) return { ok: false, grund: 'keine Netzkennung' }
    zahl = kennung
  } else if (typeof kennung === 'string') {
    // Genau Ziffern, keine fuehrende Null (ausser der blossen '0'), kein
    // Vorzeichen, kein Leerraum. Alles andere ist kein Wert aus unserer Liste.
    if (!/^(0|[1-9]\d*)$/.test(kennung)) return { ok: false, grund: 'keine Netzkennung' }
    zahl = Number.parseInt(kennung, 10)
  } else {
    return { ok: false, grund: 'keine Netzkennung' }
  }
  const netz = gespeichert.find((n) => n.id === zahl)
  if (!netz) return { ok: false, grund: 'unbekanntes Netz' }
  return { ok: true, netz }
}

/**
 * Ausgabe von `wpa_cli get_network <id> priority` auswerten. Pure.
 *
 * wpa_cli antwortet mit dem blossen Wert („10") oder mit „FAIL", wenn das Feld
 * nie gesetzt wurde. FAIL ist hier KEIN Fehler: die Vorgabe von
 * wpa_supplicant ist 0, und genau die ist dann gemeint.
 */
export function prioritaetAus(text: string): number {
  const m = /^\s*(-?\d+)\s*$/m.exec(String(text || ''))
  if (!m) return 0
  const n = Number.parseInt(m[1], 10)
  return Number.isFinite(n) ? n : 0
}

/**
 * Welche Prioritaet muss das gewaehlte Netz bekommen, damit es gewinnt? Pure.
 *
 * WARUM NICHT EINFACH 10 (E115, 31.08.2026): `/api/netzwerk/verbinden` setzt
 * jedem neu eingerichteten Netz fest `priority 10`. Wer zwei Netze ueber die
 * Verwaltung eingerichtet hat, hat also ZWEI Netze mit Prioritaet 10 — und
 * genau zwischen diesen beiden will der Betreiber umschalten. Eine feste 10
 * waere dort kein Vorrang, sondern ein Gleichstand, und wpa_supplicant duerfte
 * nach dem `enable_network all` zum staerkeren ALTEN Netz zurueckspringen.
 *
 * Darum: streng ueber allem, was sonst gespeichert ist. Die Zahl waechst mit
 * jedem Wechsel um eins; wpa_supplicant nimmt Ganzzahlen, das traegt weit
 * laenger als jede Box lebt.
 */
export function naechstePrioritaet(vorhandene: number[]): number {
  let hoechste = 0
  for (const w of vorhandene) if (Number.isFinite(w) && w > hoechste) hoechste = w
  return hoechste + 1
}

/** Empfang EINES Bandes eines Netzes. */
export interface BandStaerke {
  band: '2,4 GHz' | '5 GHz'
  signalDbm: number | null
  stufe: ReturnType<typeof signalStufe>
  /** Zugangspunkte auf diesem Band. */
  punkte: number
}

/** Ein Netz, wie es die Oberflaeche anzeigt. */
export interface Funknetz {
  ssid: string
  signalDbm: number | null
  stufe: ReturnType<typeof signalStufe>
  /** Band des STAERKSTEN Zugangspunkts. */
  band: '2,4 GHz' | '5 GHz' | null
  /** ALLE Baender, auf denen dieser Name sendet — meist 2,4 UND 5 GHz. */
  baender: ('2,4 GHz' | '5 GHz')[]
  /**
   * Empfang JE BAND, staerkstes zuerst.
   *
   * Der Grund: bei einem Namen auf beiden Baendern unterscheidet sich der
   * Empfang oft um 10-20 dB. Ein einziger Wert verschweigt genau das —
   * und beim Aufstellen der Box ist „welches Band ist hier besser?" die
   * eigentliche Frage.
   */
  proBand: BandStaerke[]
  sicherheit: Sicherheit
  /**
   * Muss der Bediener hier ein Passwort eintippen?
   *
   * VERDRAHTET AM 19.09.2026 (AUDIT-2026-09-19 Rang 7). `brauchtPasswort`
   * stand bis dahin nur in netzwerk.ts und in der eigenen Spec — die Regel
   * war geprueft und wurde nirgends gefragt. Sie GEHOERT hierher: die
   * Oberflaeche entscheidet daran, ob sie ein Passwortfeld zeigt, und
   * `sicherheit` allein zu uebertragen hiess, die Fallunterscheidung ein
   * zweites Mal im Browser zu schreiben. Ein Netz mit `wpa-enterprise` ist
   * dabei der Fall, den eine Nachbildung regelmaessig falsch macht: es
   * braucht Zugangsdaten, aber KEIN Passwort, das man hier eintippen kann.
   */
  brauchtPasswort: boolean
  /** Lesbarer Name der Verschluesselung (WPA2, WPA2/WPA3, offen …). */
  verschluesselung: string
  wps: boolean
  /** Wie viele Zugangspunkte diese SSID ausstrahlen (Mesh/Repeater). */
  punkte: number
  /** Die Box kennt dieses Netz bereits (Zugangsdaten liegen vor). */
  bekannt: boolean
  /** Die Box haengt GERADE in diesem Netz. */
  verbunden: boolean
}

/**
 * Aus den rohen Scanzeilen die Liste fuer die Oberflaeche bauen. Pure.
 *
 * ENTDOPPELT NACH SSID: ein Mesh oder ein Repeater strahlt dieselbe SSID aus
 * mehreren Zugangspunkten aus. Ungefiltert stuende das Heimnetz drei- bis
 * fuenfmal in der Liste — genau das, was die Auswahl unbrauchbar macht. Es
 * gewinnt der STAERKSTE Eintrag; die Zahl der Punkte bleibt als Angabe
 * erhalten, weil sie erklaert, warum ein Netz gut erreichbar ist.
 *
 * Sortiert nach Empfang, absteigend — ein Netz ohne Pegelangabe ganz nach
 * unten statt nach oben (`null` ist keine gute Verbindung).
 */
export function netzeAusScan(
  zeilen: ScanZeile[],
  bekannte: { ssid: string; aktuell: boolean }[] = [],
): Funknetz[] {
  type Sammlung = {
    z: ScanZeile
    punkte: number
    baender: Set<string>
    proBand: Map<string, { signalDbm: number | null; punkte: number }>
  }
  const merkeBand = (s: Sammlung, b: string | null, pegel: number | null) => {
    if (!b) return
    const vor = s.proBand.get(b)
    if (!vor) {
      s.proBand.set(b, { signalDbm: pegel, punkte: 1 })
      return
    }
    vor.punkte += 1
    if (pegel !== null && (vor.signalDbm === null || pegel > vor.signalDbm)) vor.signalDbm = pegel
  }
  const beste = new Map<string, Sammlung>()
  for (const z of zeilen) {
    const b = bandAusFrequenz(z.frequenzMhz)
    const vor = beste.get(z.ssid)
    if (!vor) {
      const s: Sammlung = { z, punkte: 1, baender: new Set(b ? [b] : []), proBand: new Map() }
      merkeBand(s, b, z.signalDbm)
      beste.set(z.ssid, s)
      continue
    }
    vor.punkte += 1
    merkeBand(vor, b, z.signalDbm)
    // Baender werden GESAMMELT, nicht ueberschrieben: derselbe Name sendet
    // meist auf 2,4 UND 5 GHz, und das ist eine Angabe fuer sich — sie sagt,
    // ob die Box ueberhaupt die Wahl hat. Der staerkste Zugangspunkt
    // bestimmt weiterhin Pegel und Merkmale.
    if (b) vor.baender.add(b)
    const alt = vor.z.signalDbm
    const neu = z.signalDbm
    if (neu !== null && (alt === null || neu > alt)) vor.z = z
  }
  const bekanntSet = new Map(bekannte.map((b) => [b.ssid, b.aktuell]))
  const raus: Funknetz[] = []
  for (const { z, punkte, baender, proBand } of beste.values()) {
    raus.push({
      ssid: z.ssid,
      signalDbm: z.signalDbm,
      stufe: signalStufe(z.signalDbm),
      band: bandAusFrequenz(z.frequenzMhz),
      // Aufsteigend, damit „2,4 + 5 GHz" immer in derselben Reihenfolge steht.
      baender: [...baender].sort() as ('2,4 GHz' | '5 GHz')[],
      proBand: [...proBand.entries()]
        .map(([band, w]) => ({
          band: band as '2,4 GHz' | '5 GHz',
          signalDbm: w.signalDbm,
          stufe: signalStufe(w.signalDbm),
          punkte: w.punkte,
        }))
        // Staerkstes Band zuerst — das ist die Antwort auf „welches nehme ich?"
        .sort((x, y) => (y.signalDbm ?? -999) - (x.signalDbm ?? -999)),
      sicherheit: sicherheitAusFlags(z.flags),
      brauchtPasswort: brauchtPasswort(sicherheitAusFlags(z.flags)),
      verschluesselung: verschluesselungName(z.flags),
      wps: hatWps(z.flags),
      punkte,
      bekannt: bekanntSet.has(z.ssid),
      verbunden: bekanntSet.get(z.ssid) === true,
    })
  }
  // Erst das Netz, in dem die Box haengt, dann die bekannten, dann nach
  // Empfang. Wer die Liste oeffnet, sucht meistens genau eines von beiden.
  raus.sort((a, b) => {
    if (a.verbunden !== b.verbunden) return a.verbunden ? -1 : 1
    if (a.bekannt !== b.bekannt) return a.bekannt ? -1 : 1
    const x = a.signalDbm ?? Number.NEGATIVE_INFINITY
    const y = b.signalDbm ?? Number.NEGATIVE_INFINITY
    return y - x || a.ssid.localeCompare(b.ssid, 'de')
  })
  return raus
}
