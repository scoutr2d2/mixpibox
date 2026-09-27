/**
 * Nachrichten AN die Box — Matrix, Signal, Telegram in einer Form.
 *
 * WOFUER: Eltern sind nicht im Haus und wollen dem Kind etwas sagen
 * („in zehn Minuten Abendessen"). Heute kann die Box nur HINAUS melden
 * (`scripts/telegram/telegram_send_message.py`, seit Jahren) — die Richtung
 * herein gab es nie. Der Empfaenger ist ein Kind im Vorschulalter: es liest
 * nicht, also gehoert zu jeder Nachricht die Moeglichkeit, sie VORZULESEN,
 * und nicht nur ein Kaestchen mit Buchstaben darin.
 *
 * DREI WEGE, EINE FORM. Matrix, Signal und Telegram unterscheiden sich in
 * allem — Verschluesselung, Anmeldung, Abholweg —, aber was hinten
 * herauskommt, ist dreimal dasselbe: wer, wann, welcher Satz. Deshalb steht
 * die Umformung HIER und in keinem der drei Holer: ein Fehler in der
 * Absenderpruefung waere sonst dreimal zu machen und dreimal zu vergessen.
 *
 * REINE LOGIK: keine Uhr, kein Netz, kein Dateisystem. Herein kommt das rohe
 * Ereignis des jeweiligen Dienstes, heraus kommt eine `Nachricht` oder
 * `null`. Damit ist der gefaehrlichste Teil — WER durchkommt — in einem Test
 * zu fassen, ohne dass jemand einen Matrix-Server aufsetzen muss. Dieselbe
 * Bauart wie `kinderzeit.ts` und `vorlesen.ts`, aus demselben Grund.
 *
 * ══ DIE ERLAUBNISLISTE IST DAS EIGENTLICHE STUECK ══════════════════════════
 *
 * Betreiber, 20.09.2026, auf die Frage nach fremden Absendern: feste
 * Erlaubnisliste. Das ist hier keine Bequemlichkeit, sondern die Bedingung,
 * unter der die Sache ueberhaupt gebaut werden darf: ein offener Kanal auf
 * einen Kinderschirm ist ein Kanal, ueber den ein Fremder einem Kind etwas
 * sagt. Wer NICHT in der Liste steht, kommt nicht durch — und zwar VOR dem
 * Ablegen, nicht erst beim Anzeigen. Eine verworfene Nachricht wird gezaehlt
 * (`AbgewiesenGrund`), damit im Eltern-Bereich steht, DASS jemand klopft;
 * ihr Text wird nicht aufgehoben.
 */

/** Die Wege, ueber die eine Nachricht hereinkommen kann. */
export const WEGE = ['matrix', 'signal', 'telegram'] as const
export type Weg = (typeof WEGE)[number]

/**
 * Wie lang ein Satz sein darf, bevor er abgeschnitten wird.
 *
 * 500 Zeichen sind ungefaehr, was auf dem Schirm der Box lesbar Platz hat,
 * und deutlich mehr, als jemand einem Kind vorliest. Der Deckel ist NICHT
 * kosmetisch: die Nachrichten liegen in einer Datei, die bei jedem Takt
 * gelesen und geschrieben wird, und ein Absender bestimmt die Laenge.
 */
export const TEXT_DECKEL = 500

/**
 * Wie viele Nachrichten die Box aufhebt.
 *
 * Es ist ein Ringspeicher, keine Ablage: die aelteste faellt heraus, wenn
 * die 51. kommt. Eine unbegrenzte Liste waere eine Datei, die ein Absender
 * beliebig wachsen lassen kann — auf einer Box mit SD-Karte.
 */
export const DECKEL = 50

/** Eine Nachricht, so wie sie auf der Box liegt. */
export interface Nachricht {
  /**
   * Dauerhafte Kennung — sie kommt vom DIENST, nicht von uns.
   *
   * WARUM NICHT EINE EIGENE ZAEHLUNG: alle drei Wege werden ABGEHOLT, und
   * ein Abholen kann doppelt passieren (Netz weg, Antwort verloren, Holer
   * neu gestartet). Mit der Kennung des Dienstes faellt die Dublette in
   * `einfuegen` heraus; mit einer eigenen Zaehlung stuende dieselbe
   * Nachricht zweimal auf dem Schirm, und das Kind wuerde zweimal gerufen.
   */
  id: string
  weg: Weg
  /** Die technische Kennung des Absenders — die, gegen die geprueft wird. */
  absender: string
  /** Wie der Absender heisst, wenn der Dienst es sagt. Sonst leer. */
  absenderName: string
  text: string
  /** Wann die Nachricht abgeschickt wurde (ms seit 1970), laut Dienst. */
  zeit: number
  gelesen: boolean
  /** Ob sie schon vorgelesen wurde. Getrennt von `gelesen`: siehe unten. */
  gesprochen: boolean
}

/** Ein Eintrag der Erlaubnisliste. */
export interface Erlaubt {
  weg: Weg
  /** Matrix-ID (@mama:server), Telefonnummer (+49…) oder Telegram-Chat-ID. */
  absender: string
  /** Wie die Box den Absender nennt, wenn der Dienst keinen Namen liefert. */
  name?: string
}

/** Warum eine Nachricht nicht durchkam. */
export type AbgewiesenGrund = 'unbekannt' | 'leer' | 'kein-text'

// ─────────────────────────────────────────────────────────────────────────
// Absender: eine Schreibweise, gegen die geprueft wird
// ─────────────────────────────────────────────────────────────────────────

/**
 * Bringt einen Absender in die EINE Schreibweise, in der verglichen wird.
 *
 * DER GRUND STEHT IN DEN DIENSTEN, NICHT IN UNS. Alle drei schreiben
 * denselben Absender auf mehr als eine Art:
 *
 *   Matrix    `@Mama:Server.example` und `@mama:server.example` sind
 *             DASSELBE Konto — der Namensteil ist bei Matrix
 *             kleingeschrieben definiert, der Serverteil ist ein
 *             Rechnername und damit ohnehin ohne Gross-Klein.
 *   Signal    `+49 170 1234567`, `+49-170-1234567` und `+491701234567`
 *             sind dieselbe Nummer. Der Eltern-Bereich bekommt die Nummer
 *             von Hand getippt, also kommt sie mit Leerzeichen an.
 *   Telegram  eine Zahl, die als Zahl ODER als Zeichenkette ankommt, je
 *             nachdem, wer sie weiterreicht.
 *
 * WER DAS WEGLAESST, baut eine Erlaubnisliste, die MANCHMAL greift — und das
 * ist schlimmer als keine: die Eltern tragen die Mutter ein, die Mutter
 * schreibt, nichts kommt an, und niemand sucht den Fehler bei der
 * Schreibweise.
 */
export function absenderSchluessel(weg: Weg, roh: unknown): string {
  const s = String(roh ?? '').trim()
  if (!s) return ''
  if (weg === 'matrix') return s.toLowerCase()
  if (weg === 'signal') {
    // Nur Ziffern; alles andere (Leerzeichen, Bindestriche, Klammern,
    // Schraegstriche) ist Schreibweise, nicht Nummer.
    const ziffern = s.replace(/[^0-9]/g, '')
    if (!ziffern) return ''
    // `0049…` und `+49…` sind dieselbe Nummer — die erste Form tippt jeder,
    // der ein Telefonbuch abschreibt.
    if (s.startsWith('+')) return `+${ziffern}`
    if (ziffern.startsWith('00')) return `+${ziffern.slice(2)}`
    // ══ EINE NATIONALE NUMMER IST HIER KEIN SCHLUESSEL, SONDERN NICHTS ══
    //
    // `0170 0000000` LAESST SICH NICHT UMRECHNEN: welches Land, steht
    // nirgends. Man koennte ein Land raten — und genau das waere die
    // Erlaubnisliste, die MANCHMAL greift: die Eltern tragen die Nummer
    // national ein, Signal meldet sie international, nichts kommt an, und
    // niemand sucht den Fehler bei der Schreibweise.
    //
    // Deshalb kommt hier `''` heraus und nicht eine Nummer, die nie passt:
    // ein leerer Schluessel ist ein UNGUELTIGER Eintrag, und der
    // Eltern-Bereich weist ihn beim Eintragen ab, statt ihn stumm
    // aufzunehmen (`erlaubtPruefen` in nachrichten-ablage.ts).
    return ''
  }
  // Telegram: eine Zahl, oft mit Minus davor (Gruppen). Sonst nichts.
  return /^-?[0-9]+$/.test(s) ? s : ''
}

/**
 * Steht dieser Absender auf der Liste? Gibt den Eintrag zurueck oder null.
 *
 * KEIN RUECKFALL AUF „LISTE LEER HEISST ALLE". Eine leere Liste heisst
 * NIEMAND. Das ist die unbequeme Richtung, und sie ist die richtige: eine
 * frisch eingeschaltete Box ohne einen einzigen Eintrag darf nicht fuer
 * jeden offen sein, der die Raumkennung kennt.
 */
export function eintragFuer(weg: Weg, absender: string, liste: readonly Erlaubt[]): Erlaubt | null {
  const schluessel = absenderSchluessel(weg, absender)
  if (!schluessel) return null
  for (const e of liste) {
    if (e.weg !== weg) continue
    if (absenderSchluessel(weg, e.absender) === schluessel) return e
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────
// Text: was auf dem Schirm steht und was vorgelesen wird
// ─────────────────────────────────────────────────────────────────────────

/**
 * Steuerzeichen raus — ueber CODEPUNKTE, nicht ueber einen Regelausdruck.
 *
 * WARUM SO UMSTAENDLICH: die Zeichenklasse dafuer muesste die Escapes fuer
 * die Steuerzeichen im QUELLTEXT tragen, und genau die werden beim
 * maschinellen Schreiben dieser Datei zu den ECHTEN Bytes — eine Datei mit
 * einem NUL darin, die niemand mehr lesen will. Der Vergleich auf Zahlen
 * hat dieses Problem nicht und liest sich obendrein als das, was er ist.
 *
 * U+2028 und U+2029 stehen dabei, weil sie in einer JavaScript-Zeichenkette
 * die ZEILE beenden. Die Nachricht wandert durch JSON in die Oberflaeche.
 */
export function steuerlos(s: string): string {
  let aus = ''
  for (const z of s) {
    const c = z.codePointAt(0) ?? 0
    const steuer = c < 0x20 || c === 0x7f || c === 0x85 || c === 0x2028 || c === 0x2029
    aus += steuer ? ' ' : z
  }
  return aus
}

/**
 * Macht aus dem rohen Text des Dienstes einen Satz, der angezeigt und
 * vorgelesen werden darf.
 *
 * 1. STEUERZEICHEN RAUS (siehe `steuerlos`).
 * 2. JEDER WEISSRAUM WIRD EIN LEERZEICHEN. Zeilenumbrueche in einer
 *    Nachrichtenkarte bringen nichts, und die Sprachausgabe liest sie als
 *    nichts. Hundert leere Zeilen dagegen schieben die Karte auf.
 * 3. ABSCHNEIDEN MIT ZEICHEN. Ein stumm gekuerzter Text ist eine
 *    Falschauskunft: wer „Wir holen dich um" liest, weiss nicht, dass da
 *    noch etwas stand. Das Auslassungszeichen sagt es.
 */
export function textSaeubern(roh: unknown): string {
  const eng = steuerlos(String(roh ?? ''))
    .replace(/\s+/g, ' ')
    .trim()
  if (eng.length <= TEXT_DECKEL) return eng
  return `${eng.slice(0, TEXT_DECKEL - 1).trimEnd()}…`
}

/**
 * Was die Sprachausgabe sagt — mit Absender davor.
 *
 * „Nachricht von Mama: In zehn Minuten gibt es Essen." Ein Kind, das nicht
 * liest, erfaehrt den Absender sonst nirgends; auf dem Schirm steht er
 * daneben, im Ton gibt es kein Daneben.
 */
export function sprechtext(n: Pick<Nachricht, 'absenderName' | 'absender' | 'text'>): string {
  const wer = (n.absenderName || '').trim() || n.absender
  if (!wer) return n.text
  return `Nachricht von ${wer}: ${n.text}`
}

// ─────────────────────────────────────────────────────────────────────────
// Die drei Umformungen
// ─────────────────────────────────────────────────────────────────────────

/** Was eine Umformung liefert: entweder eine Nachricht oder ein Grund. */
export type Umformung =
  | { ok: true; nachricht: Nachricht }
  | { ok: false; grund: AbgewiesenGrund; weg: Weg; absender: string }

function fertig(
  weg: Weg,
  id: string,
  absenderRoh: unknown,
  nameRoh: unknown,
  textRoh: unknown,
  zeit: number,
  liste: readonly Erlaubt[],
): Umformung {
  const absender = absenderSchluessel(weg, absenderRoh)
  const text = textSaeubern(textRoh)
  // DIE REIHENFOLGE IST ABSICHT: erst der Absender, dann der Text. Ein
  // Fremder soll nicht erfahren, ob sein leerer Text etwas ausgeloest haette.
  const eintrag = eintragFuer(weg, absender, liste)
  if (!eintrag) return { ok: false, grund: 'unbekannt', weg, absender }
  if (!text) return { ok: false, grund: 'leer', weg, absender }
  return {
    ok: true,
    nachricht: {
      id,
      weg,
      absender,
      absenderName: textSaeubern(nameRoh) || (eintrag.name ?? '').trim(),
      text,
      zeit: Number.isFinite(zeit) && zeit > 0 ? Math.round(zeit) : 0,
      gelesen: false,
      gesprochen: false,
    },
  }
}

/**
 * Ein Matrix-Ereignis aus `/sync`.
 *
 * NUR `m.room.message` MIT `msgtype: 'm.text'`. Alles andere — Bilder,
 * Beitritte, Reaktionen, Zustandsaenderungen — ist keine Nachricht an das
 * Kind. Ein Bild waere ein eigenes Stueck Arbeit (Herunterladen, Ablegen,
 * Anzeigen) und ausdruecklich nicht dabei.
 *
 * VERSCHLUESSELTE RAEUME GEHEN NICHT, und das ist hier sichtbar: ein Ereignis
 * vom Typ `m.room.encrypted` traegt keinen `body`, faellt also durch. Der
 * Eltern-Bereich muss das SAGEN (siehe nachrichten-holer.ts) — ein Raum, in
 * dem die Mutter schreibt und nichts ankommt, ist sonst ein Fehler, den
 * niemand findet.
 */
export function ausMatrix(ereignis: unknown, liste: readonly Erlaubt[]): Umformung | null {
  const e = ereignis as Record<string, unknown> | null
  if (!e || typeof e !== 'object') return null
  if (e.type !== 'm.room.message') return null
  const inhalt = e.content as Record<string, unknown> | undefined
  if (!inhalt || typeof inhalt !== 'object') return null
  if (inhalt.msgtype !== 'm.text') {
    return { ok: false, grund: 'kein-text', weg: 'matrix', absender: absenderSchluessel('matrix', e.sender) }
  }
  const id = String(e.event_id ?? '')
  if (!id) return null
  return fertig('matrix', id, e.sender, undefined, inhalt.body, Number(e.origin_server_ts), liste)
}

/**
 * Ein Telegram-Update aus `getUpdates`.
 *
 * `from.id` IST DER ABSENDER, NICHT `chat.id`. In einer Gruppe sind die
 * beiden verschieden, und geprueft gehoert der Mensch, der tippt — sonst
 * reicht es, EINEN Gruppenchat freizugeben, damit jedes Mitglied darin dem
 * Kind schreiben kann. `chat.id` steht trotzdem in der Kennung, damit
 * dieselbe Nachrichtennummer aus zwei Chats nicht kollidiert.
 */
export function ausTelegram(update: unknown, liste: readonly Erlaubt[]): Umformung | null {
  const u = update as Record<string, unknown> | null
  if (!u || typeof u !== 'object') return null
  const m = (u.message ?? u.edited_message) as Record<string, unknown> | undefined
  if (!m || typeof m !== 'object') return null
  const von = m.from as Record<string, unknown> | undefined
  const chat = m.chat as Record<string, unknown> | undefined
  const absender = von?.id ?? chat?.id
  if (typeof m.text !== 'string') {
    return { ok: false, grund: 'kein-text', weg: 'telegram', absender: absenderSchluessel('telegram', absender) }
  }
  const id = `tg:${String(chat?.id ?? '?')}:${String(m.message_id ?? '')}`
  const name = [von?.first_name, von?.last_name].filter((t) => typeof t === 'string' && t).join(' ')
  // `date` ist bei Telegram in SEKUNDEN. Wer das uebersieht, legt jede
  // Nachricht auf den 20. Januar 1970 und sortiert die Liste verkehrt.
  return fertig('telegram', id, absender, name, m.text, Number(m.date) * 1000, liste)
}

/**
 * Eine Signal-Meldung aus dem JSON-RPC-Strom von `signal-cli daemon`.
 *
 * Die Form ist `{ envelope: { source, sourceName, timestamp, dataMessage:
 * { message } } }`. Zustellbestaetigungen, Lesebestaetigungen und
 * Tippanzeigen kommen ueber denselben Strom und tragen KEIN `dataMessage` —
 * sie fallen mit `null` heraus, nicht als Abweisung: sonst zaehlte die Box
 * jede Lesebestaetigung der Mutter als Klopfen eines Fremden.
 */
export function ausSignal(meldung: unknown, liste: readonly Erlaubt[]): Umformung | null {
  const m = meldung as Record<string, unknown> | null
  if (!m || typeof m !== 'object') return null
  const h = (m.envelope ?? m) as Record<string, unknown>
  const daten = h.dataMessage as Record<string, unknown> | undefined
  if (!daten || typeof daten !== 'object') return null
  const absender = h.sourceNumber ?? h.source
  if (typeof daten.message !== 'string' || !daten.message.trim()) {
    return { ok: false, grund: 'kein-text', weg: 'signal', absender: absenderSchluessel('signal', absender) }
  }
  const zeit = Number(daten.timestamp ?? h.timestamp)
  // Die Kennung ist Absender + Zeitstempel: Signal vergibt keine
  // Nachrichtennummer, aber der Zeitstempel IST bei Signal die Kennung
  // einer Nachricht (danach werden Antworten und Loeschungen adressiert).
  const id = `sig:${absenderSchluessel('signal', absender)}:${String(zeit)}`
  return fertig('signal', id, absender, h.sourceName, daten.message, zeit, liste)
}

// ─────────────────────────────────────────────────────────────────────────
// Die Liste auf der Box
// ─────────────────────────────────────────────────────────────────────────

/**
 * Haengt eine Nachricht an und haelt den Deckel — Dubletten fallen heraus.
 *
 * NEUESTE ZUERST. Die Oberflaeche zeigt die oberste; eine Liste, die hinten
 * waechst, muesste jede Anzeige selbst drehen, und eine davon wuerde es
 * vergessen.
 */
export function einfuegen(liste: readonly Nachricht[], neu: Nachricht, deckel = DECKEL): Nachricht[] {
  if (liste.some((n) => n.id === neu.id)) return [...liste]
  return [neu, ...liste].slice(0, Math.max(1, deckel))
}

/** Wie viele noch niemand gesehen hat. */
export function ungelesen(liste: readonly Nachricht[]): number {
  return liste.filter((n) => !n.gelesen).length
}

/**
 * Die naechste Nachricht, die vorgelesen werden soll — oder null.
 *
 * `gesprochen` IST NICHT `gelesen`, und die Trennung hat einen Anlass: das
 * Kind wegzutippen („gelesen") und die Box sprechen zu lassen sind zwei
 * verschiedene Dinge. Waeren es dieselbe Marke, wuerde eine Nachricht, die
 * das Kind wegtippt, bevor der Satz zu Ende ist, beim naechsten Takt erneut
 * gesprochen — oder umgekehrt eine vorgelesene nie mehr angezeigt.
 *
 * AELTESTE ZUERST: gesprochen wird in der Reihenfolge, in der geschrieben
 * wurde. Die Anzeige dreht die Liste, der Ton nicht.
 */
export function naechsteZumSprechen(liste: readonly Nachricht[]): Nachricht | null {
  const offen = liste.filter((n) => !n.gesprochen)
  if (!offen.length) return null
  return offen.reduce((a, b) => (a.zeit <= b.zeit ? a : b))
}

/**
 * Soll fuer dieses Profil vorgelesen werden?
 *
 * Betreiber, 20.09.2026: „das vorlesen soll an und ausgeschaltet werden
 * koennen fuer das jeweilige profil".
 *
 * FEHLT DAS FELD AM PROFIL, GILT DIE BOX-EINSTELLUNG — dieselbe Regel wie
 * bei `merken` in profile.ts, und aus demselben Grund: ein Kind, das nie
 * etwas eingestellt hat, verhaelt sich wie am Tag davor. Eine Vorgabe am
 * Profil waere eine zweite Antwort auf dieselbe Frage.
 */
export function vorlesenAn(profilWert: boolean | undefined, boxWert: boolean): boolean {
  return profilWert === undefined ? boxWert : profilWert
}
