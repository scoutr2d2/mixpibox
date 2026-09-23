/**
 * Zugriff auf den Netzwerkzustand der Box.
 *
 * Wie beim Dienste-Zugriff: keine Regeln hier, nur Übermittlung. Was ein
 * gültiger Netzwerkname ist, entscheidet das Backend — dort steht die Prüfung,
 * die wirklich zählt, weil der Wert von dort in die WLAN-Konfiguration wandert.
 */
import { HttpClient, HttpErrorResponse } from '@angular/common/http'
import { Injectable, inject } from '@angular/core'
import { firstValueFrom } from 'rxjs'

export interface Adresse {
  familie: 'v4' | 'v6'
  adresse: string
  praefix: number
}

export interface Schnittstelle {
  name: string
  aktiv: boolean
  funk: boolean
  adressen: Adresse[]
}

export interface WlanVerbindung {
  ssid: string
  signal: number | null
  frequenzMhz: number | null
}

export interface Netzlage {
  hostname: string
  schnittstellen: Schnittstelle[]
  wlan: WlanVerbindung | null
  stufe: 'gut' | 'mittel' | 'schwach' | 'unbekannt'
  /**
   * Damit die Seite „verbunden, aber nicht auslesbar" von „gar kein Funk"
   * unterscheiden kann. Auf der Box ist `iw` nicht installiert; ohne diese
   * Unterscheidung meldete sie „keine WLAN-Verbindung", obwohl eine bestand.
   */
  funkVorhanden?: boolean
  funkAktiv?: boolean
}

/** Ein Weg zur Box (Teil von /api/funk). */
export interface FunkWeg {
  name: string
  funk: boolean
  adresse: string
  /** null heisst „nicht feststellbar", NICHT „kein Kabel". */
  kabel: boolean | null
  zustand: string
  /**
   * Erreicht jemand die Box hierueber JETZT?
   *
   * Adresse UND Anschluss oben. Eine per DHCP geholte Adresse bleibt nach dem
   * Ziehen des Kabels noch eine Weile stehen — sie ist dann eine Erinnerung,
   * kein Weg.
   */
  traegt: boolean
  /**
   * Koennte das ein Rueckweg sein — echte Hardware und kein Funk?
   *
   * `tun0`, `wg0`, `docker0` haben eine Adresse und sind kein Funk, laufen aber
   * selbst ueber das WLAN. Das Backend erkennt sie am fehlenden `device` in
   * sysfs und zaehlt sie NICHT als zweiten Weg.
   */
  eigenstaendig: boolean
}

/**
 * Der Funkzustand — Antwort von GET /api/funk.
 *
 * `ausErlaubt` und `grund` kommen vom BACKEND und werden hier nicht
 * nachgerechnet. Die Bedingung („WLAN aus nur, wenn die Box danach noch
 * erreichbar ist") steht dort, weil sie dort nicht umgehbar ist.
 */
export interface Funklage {
  bluetooth: { an: boolean | null; vorhanden: boolean }
  wlan: { an: boolean; name: string; vorhanden: boolean; adresse: string }
  flug: boolean
  wege: FunkWeg[]
  zweiterWeg: FunkWeg | null
  ausErlaubt: boolean
  grund: string
  /** Laeuft diese Seite auf dem Schirm der Box selbst? Dann steht jemand davor. */
  vonDerBox: boolean
  schaltweg: 'ifupdown' | 'ip'
}

export type FunkAntwort = { ok: true; hinweis: string } | { ok: false; grund: string }

/** Ein gefundenes Funknetz (Ergebnis von /api/netzwerk/scan). */
export interface Funknetz {
  ssid: string
  signalDbm: number | null
  stufe: 'gut' | 'mittel' | 'schwach' | 'unbekannt'
  band: '2,4 GHz' | '5 GHz' | null
  sicherheit: 'offen' | 'wep' | 'wpa' | 'wpa-enterprise'
  wps: boolean
  /** Wie viele Zugangspunkte diese SSID ausstrahlen (Mesh/Repeater). */
  punkte: number
}

/**
 * Ein Netz, dessen Zugangsdaten die Box schon kennt (E115, 31.08.2026).
 *
 * `id` ist die Netzkennung von wpa_supplicant. Sie ist NICHT dauerhaft: nach
 * einem Vergessen und einem Neustart vergibt wpa_supplicant die Nummern neu.
 * Deshalb wird die Liste nach jeder Tat frisch geholt und nie gemerkt — eine
 * alte Kennung waere ein Loeschbefehl auf ein anderes Netz.
 */
export interface GespeichertesNetz {
  id: number
  ssid: string
  /** Die Box haengt GERADE in diesem Netz. */
  aktuell: boolean
  /** Gespeichert, aber gerade nicht in der Auswahl. */
  abgeschaltet: boolean
}

@Injectable({ providedIn: 'root' })
export class NetzwerkDienst {
  private readonly http = inject(HttpClient)

  async lage(): Promise<Netzlage> {
    return await firstValueFrom(this.http.get<Netzlage>('/api/netzwerk'))
  }

  /**
   * Ein WLAN hinterlegen.
   *
   * Wichtig für die Anzeige: das wirkt NICHT sofort. Auf der Box holt ein
   * Hintergrunddienst den Eintrag innerhalb von etwa zwei Sekunden ab und
   * startet die Funkverbindung neu — wer währenddessen über genau dieses WLAN
   * verbunden ist, verliert die Seite kurz. Das muss die Oberfläche sagen.
   */
  async wlanHinterlegen(
    ssid: string,
    psk: string,
  ): Promise<{ ok: true } | { ok: false; grund: string }> {
    try {
      await firstValueFrom(this.http.post('/api/netzwerk/wlan', { ssid, psk }))
      return { ok: true }
    } catch (e) {
      if (e instanceof HttpErrorResponse) {
        // Das Backend nennt den Grund (zu lang, verbotenes Zeichen …) —
        // den zeigen wir wörtlich, statt ihn durch ein eigenes "ungültig"
        // zu ersetzen, das niemandem weiterhilft.
        const gemeldet = (e.error as { error?: string } | null)?.error
        if (gemeldet) return { ok: false, grund: gemeldet }
        if (e.status === 401) return { ok: false, grund: 'Die Anmeldung ist abgelaufen.' }
        if (e.status === 0) return { ok: false, grund: 'Die Box antwortet nicht.' }
      }
      return { ok: false, grund: 'Das Speichern ist fehlgeschlagen.' }
    }
  }

  /** Denselben Fehlertext-Weg fuer alle neuen Aufrufe — das Backend nennt den Grund. */
  private grundAus(e: unknown, standard: string): string {
    if (e instanceof HttpErrorResponse) {
      const gemeldet = (e.error as { error?: string } | null)?.error
      if (gemeldet) return gemeldet
      if (e.status === 401) return 'Die Anmeldung ist abgelaufen.'
      if (e.status === 0) return 'Die Box antwortet nicht.'
    }
    return standard
  }

  /**
   * Verfuegbare Netze suchen.
   *
   * Dauert rund fuenf Sekunden: der Scan ist auf der Box zweistufig, und
   * zwischen Anstoss und Ergebnis muss gewartet werden. Die Oberflaeche muss
   * das anzeigen, sonst wirkt sie haengengeblieben.
   */
  async suchen(): Promise<{ ok: true; netze: Funknetz[] } | { ok: false; grund: string }> {
    try {
      const a = await firstValueFrom(
        this.http.get<{ netze: Funknetz[] }>('/api/netzwerk/scan'),
      )
      return { ok: true, netze: a.netze ?? [] }
    } catch (e) {
      return { ok: false, grund: this.grundAus(e, 'Die Suche ist fehlgeschlagen.') }
    }
  }

  /**
   * Mit einem Netz verbinden.
   *
   * Die Aenderung ist NOCH NICHT dauerhaft: sie gilt nur im Arbeitsspeicher,
   * bis `bestaetigen()` sie festschreibt. Bleibt die Bestaetigung aus, rollt
   * die Box von selbst zurueck — deshalb liefert die Antwort mit, wie viele
   * Sekunden dafuer bleiben.
   */
  async verbinden(
    ssid: string,
    psk: string,
  ): Promise<{ ok: true; bestaetigenBis: number; gesichert: boolean } | { ok: false; grund: string }> {
    try {
      const a = await firstValueFrom(
        this.http.post<{ bestaetigenBis?: number; gesichert?: boolean }>(
          '/api/netzwerk/verbinden',
          { ssid, psk },
        ),
      )
      return { ok: true, bestaetigenBis: a.bestaetigenBis ?? 0, gesichert: a.gesichert !== false }
    } catch (e) {
      return { ok: false, grund: this.grundAus(e, 'Die Verbindung ist fehlgeschlagen.') }
    }
  }

  /**
   * Bestaetigen, dass die Box noch erreichbar ist.
   *
   * Dass diese Anfrage ankommt, IST der Beweis — mehr wird nicht geprueft.
   */
  async bestaetigen(): Promise<{ ok: true } | { ok: false; grund: string }> {
    try {
      await firstValueFrom(this.http.post('/api/netzwerk/bestaetigen', {}))
      return { ok: true }
    } catch (e) {
      return { ok: false, grund: this.grundAus(e, 'Die Bestaetigung ist fehlgeschlagen.') }
    }
  }

  /**
   * Wie ging der letzte Wechsel aus? Seit der Selbstbestaetigung sagt es der
   * Server (`ausgang`: selbst/bestaetigt) — `null` heisst: kein frischer
   * Ausgang, der Wecker hat zurueckgerollt oder es gab keinen Wechsel.
   */
  async wechselAusgang(): Promise<{ ssid: string; wie: string } | null> {
    try {
      const a = await firstValueFrom(
        this.http.get<{ ausgang?: { ssid: string; wie: string } | null }>('/api/netzwerk/watchdog'),
      )
      return a.ausgang ?? null
    } catch {
      return null
    }
  }

  /**
   * Der Funkzustand — und WELCHE Wege es zur Box gibt.
   *
   * Das Feld, auf das es ankommt, ist `ausErlaubt`. Es kommt vom Backend und
   * wird hier nicht nachgerechnet: die Bedingung steht dort, weil eine
   * Oberflaeche umgehbar ist. Diese Seite zeigt sie nur an.
   */
  async funklage(): Promise<Funklage> {
    return await firstValueFrom(this.http.get<Funklage>('/api/funk'))
  }

  async bluetoothSchalten(an: boolean): Promise<FunkAntwort> {
    return await this.funkPost('/api/funk/bluetooth', { an })
  }

  /**
   * WLAN an oder aus.
   *
   * `vorOrt` heisst „ich stehe vor der Box". Es wird nur mitgeschickt, wenn
   * das Backend die Seite als von der Box selbst kommend sieht — sonst lehnt
   * es ohnehin ab, und ein Knopf, der 409 kassiert, ist schlechter als
   * keiner.
   */
  async wlanSchalten(an: boolean, vorOrt = false): Promise<FunkAntwort> {
    return await this.funkPost('/api/funk/wlan', { an, vorOrt })
  }

  async flugSchalten(an: boolean, vorOrt = false): Promise<FunkAntwort> {
    return await this.funkPost('/api/funk/flug', { an, vorOrt })
  }

  private async funkPost(weg: string, koerper: unknown): Promise<FunkAntwort> {
    try {
      const a = await firstValueFrom(
        this.http.post<{ ok?: boolean; hinweis?: string; an?: boolean }>(weg, koerper),
      )
      // DER STATUS ALLEIN REICHT NICHT. Beim EINSCHALTEN antwortet der Server
      // erst, wenn er nachgesehen hat — und meldet 200 mit `ok: false`, wenn
      // das WLAN trotz aller Befehle unten geblieben ist (fehlende Rechte
      // etwa). Das als Erfolg anzuzeigen waere genau die stille Luege, gegen
      // die der Server dort nachsieht.
      if (a?.ok === false) {
        return { ok: false, grund: a.hinweis || 'Das Schalten hat nicht gewirkt.' }
      }
      return { ok: true, hinweis: a?.hinweis ?? '' }
    } catch (e) {
      // Beim Abschalten ist ein Abbruch der VERBINDUNG der Normalfall, nicht
      // der Fehlerfall: die Antwort geht ueber genau den Weg, der gerade
      // gekappt wird. Das darf nicht als „fehlgeschlagen" dastehen.
      if (e instanceof HttpErrorResponse && e.status === 0) {
        return { ok: true, hinweis: 'Die Box antwortet nicht mehr — beim Abschalten des WLANs normal.' }
      }
      return { ok: false, grund: this.grundAus(e, 'Das Schalten ist fehlgeschlagen.') }
    }
  }

  /**
   * Die gespeicherten Netze der Box holen (E115).
   *
   * Anders als `suchen()` dauert das keine fuenf Sekunden und braucht keinen
   * Funkscan: es ist eine Frage an wpa_supplicant, was es schon kennt. Genau
   * deshalb steht die Liste auch dann, wenn der Empfang gerade wackelt — und
   * fuer diesen Fall ist sie gebaut.
   */
  async gespeicherte(): Promise<
    { ok: true; netze: GespeichertesNetz[] } | { ok: false; grund: string }
  > {
    try {
      const a = await firstValueFrom(
        this.http.get<{ netze: GespeichertesNetz[] }>('/api/netzwerk/gespeichert'),
      )
      return { ok: true, netze: a.netze ?? [] }
    } catch (e) {
      return { ok: false, grund: this.grundAus(e, 'Die gespeicherten Netze sind nicht lesbar.') }
    }
  }

  /**
   * Mit einem gespeicherten Netz verbinden — OHNE Passwort.
   *
   * Betreiber, 31.08.2026: „das geht nicht ueber die box es ist immer ein
   * passwort erforderlich". Das Passwort liegt der Box schon vor; verlangt
   * wurde es nur, weil der alte Weg jedes Mal einen NEUEN Eintrag anlegte.
   *
   * Die Antwort traegt dieselben Felder wie `verbinden()`: bleibt aus der
   * Ferne die Bestaetigung aus, rollt die Box zurueck.
   */
  async gespeichertVerbinden(
    kennung: number,
  ): Promise<
    | { ok: true; ssid: string; schonVerbunden: boolean; bestaetigenBis: number; gesichert: boolean; hinweis: string }
    | { ok: false; grund: string }
  > {
    try {
      const a = await firstValueFrom(
        this.http.post<{
          ssid?: string
          schonVerbunden?: boolean
          bestaetigenBis?: number
          gesichert?: boolean
          hinweis?: string
        }>('/api/netzwerk/gespeichert/verbinden', { kennung }),
      )
      return {
        ok: true,
        ssid: a.ssid ?? '',
        schonVerbunden: a.schonVerbunden === true,
        bestaetigenBis: a.bestaetigenBis ?? 0,
        gesichert: a.gesichert !== false,
        hinweis: a.hinweis ?? '',
      }
    } catch (e) {
      return { ok: false, grund: this.grundAus(e, 'Die Verbindung ist fehlgeschlagen.') }
    }
  }

  /**
   * Ein gespeichertes Netz vergessen.
   *
   * Das AKTUELLE Netz lehnt das Backend mit 409 ab — sonst naehme die Box sich
   * selbst vom Netz. Der Grund kommt woertlich von dort und wird angezeigt,
   * statt ihn durch ein eigenes „fehlgeschlagen" zu ersetzen.
   */
  async gespeichertVergessen(
    kennung: number,
  ): Promise<{ ok: true; ssid: string; netze: GespeichertesNetz[] } | { ok: false; grund: string }> {
    try {
      const a = await firstValueFrom(
        this.http.post<{ ssid?: string; netze?: GespeichertesNetz[] }>(
          '/api/netzwerk/gespeichert/vergessen',
          { kennung },
        ),
      )
      return { ok: true, ssid: a.ssid ?? '', netze: a.netze ?? [] }
    } catch (e) {
      return { ok: false, grund: this.grundAus(e, 'Das Netz liess sich nicht entfernen.') }
    }
  }

  /** WPS per Knopfdruck starten (Router-Knopf druecken, dann diesen hier). */
  async wps(): Promise<{ ok: true; fensterSek: number } | { ok: false; grund: string }> {
    try {
      const a = await firstValueFrom(
        this.http.post<{ fensterSek?: number }>('/api/netzwerk/wps', {}),
      )
      return { ok: true, fensterSek: a.fensterSek ?? 120 }
    } catch (e) {
      return { ok: false, grund: this.grundAus(e, 'WPS ist fehlgeschlagen.') }
    }
  }
}
