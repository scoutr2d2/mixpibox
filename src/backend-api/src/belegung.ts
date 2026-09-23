/**
 * DAS BELEGUNGSBUCH (E74) — wer haelt gerade welchen Strom.
 *
 * ══ WARUM DAS BEIM WIRT WOHNT UND NICHT IM PLUGIN ══════════════════════════
 *
 * `vergeben()` in stroeme.ts entscheidet, WER einen Strom bekommt — aber nur,
 * wenn ihm jemand sagt, was gerade belegt ist. Diese Auskunft kann kein
 * einzelnes Plugin geben: es sieht sich selbst und sonst nichts. Zwei
 * Mitschnitt-Arbeiter wuerden beide denselben freien Strom finden und beide
 * mit demselben Zugang starten — genau der Fall, den `pruefen()` als schwer
 * meldet: der zweite nimmt dem ersten die Wiedergabe weg.
 *
 * Nur der WIRT sieht alle Nachfrager. Deshalb fuehrt er das Buch, und die
 * Plugins fragen ihn.
 *
 * ══ DIE MIETE LAEUFT AB ════════════════════════════════════════════════════
 *
 * Ein Nehmer, der abstuerzt, gibt nichts zurueck. Ohne Ablauf haelt eine
 * einzige abgebrochene Aufnahme den Strom fuer immer — und die Box meldet
 * geduldig „nichts frei", bis jemand sie neu startet. Es gibt keinen Weg, das
 * VERLAESSLICH zu vermeiden (ein Prozess kann jederzeit sterben), also gibt es
 * einen, es zu ueberleben: jede Belegung hat eine Frist, und wer weiterarbeitet,
 * verlaengert sie.
 *
 * DIE FRIST HAENGT AM ZWECK. Ein Mitschnitt ist EIN Titel — Minuten. Ein Kind
 * hoert einen Nachmittag. Eine gemeinsame Zahl waere fuer das eine zu lang und
 * fuer das andere zu kurz.
 *
 * ══ DIE UHR KOMMT VON AUSSEN ═══════════════════════════════════════════════
 *
 * Damit die Fristen ohne Warten pruefbar sind. Ein Zeuge, der echte Sekunden
 * verstreichen laesst, wird entweder langsam oder unzuverlaessig, und meistens
 * beides.
 */
import { type Belegung, type Strom, type Vergabe, type Zweck, vergeben } from './stroeme'

/** Wie lange eine Belegung ohne Lebenszeichen gilt, je Zweck. */
export const FRIST_MS: Record<Zweck, number> = {
  // Ein Titel dauert Minuten; 30 sind reichlich Luft fuer einen langen
  // Hoerspiel-Teil samt Anlauf. Laenger heisst nur: ein abgestuerzter
  // Arbeiter blockiert laenger.
  mitschnitt: 30 * 60_000,
  // Ein Nachmittag. Der Spieler frischt ohnehin auf, solange er laeuft —
  // diese Frist faengt nur den Fall ab, dass er es nicht mehr tut.
  wiedergabe: 6 * 60 * 60_000,
}

export interface Eintrag extends Belegung {
  /**
   * DER AUSWEIS — und NICHT die Stromnummer.
   *
   * Der erste Entwurf liess Nehmer sich mit `nr` melden. Ein Zeuge hat das
   * sofort umgeworfen: nach einer Verdraengung haelt DIESELBE NUMMER jemand
   * anderes. Ein Lebenszeichen des Verdraengten traf dann den neuen Halter
   * („ja, du hast ihn noch" — hatte er nicht), und ein `freigeben(nr)` haette
   * dem Kind den Strom weggenommen, den es gerade bekommen hat.
   *
   * Eine Nummer bezeichnet den PLATZ, nicht die MIETE. Wer sich ausweisen
   * will, braucht etwas, das nur einmal vergeben wird.
   */
  marke: number
  /** Wer sie haelt — steht in Meldungen, damit man den Nehmer wiederfindet. */
  wer: string
  /** Letztes Lebenszeichen. Die Frist rechnet ab hier, nicht ab `seit`. */
  zuletzt: number
}

/** Was der Nehmer zurueckbekommt: die Zuteilung plus seinen Ausweis. */
export interface Zuteilung extends Vergabe {
  marke: number | null
}

export class Belegungsbuch {
  private eintraege: Eintrag[] = []
  private naechsteMarke = 1

  constructor(private readonly uhr: () => number = Date.now) {}

  /** Was gerade gehalten wird — abgelaufene sind schon draussen. */
  stand(): readonly Eintrag[] {
    this.aufraeumen()
    return [...this.eintraege]
  }

  /**
   * Abgelaufene Belegungen loswerden. Liefert, was geraeumt wurde.
   *
   * WIRD VOR JEDER FRAGE AUFGERUFEN, nicht von einem Zeitgeber. Ein Zeitgeber
   * mehr ist ein Zeitgeber, der beim Herunterfahren haengen bleibt; und
   * gefragt wird ohnehin nur, wenn jemand etwas will.
   */
  aufraeumen(): Eintrag[] {
    const jetzt = this.uhr()
    const raus = this.eintraege.filter((e) => jetzt - e.zuletzt > FRIST_MS[e.fuer])
    if (raus.length > 0) this.eintraege = this.eintraege.filter((e) => !raus.includes(e))
    return raus
  }

  /**
   * Einen Strom anfordern. Trägt ihn gleich ein, wenn einer zugeteilt wird.
   *
   * VERDRAENGUNG IST TEIL DER ZUTEILUNG, nicht ein zweiter Schritt: `vergeben`
   * nennt den Verdraengten, und hier verliert er den Eintrag. Zwischen beidem
   * darf nichts passieren, sonst haelt ihn ein Halbzustand doppelt belegt.
   */
  anfordern(pool: readonly Strom[], fuer: Zweck, wer: string, reserve = 1): Zuteilung {
    this.aufraeumen()
    const v = vergeben(pool, this.eintraege, fuer, reserve)
    if (v.nr === null) return { ...v, marke: null }
    if (v.verdraengt !== undefined) this.eintraege = this.eintraege.filter((e) => e.nr !== v.verdraengt)
    const jetzt = this.uhr()
    const marke = this.naechsteMarke++
    this.eintraege.push({ marke, nr: v.nr, fuer, seit: jetzt, zuletzt: jetzt, wer })
    return { ...v, marke }
  }

  /** Zurueckgeben — gegen den AUSWEIS. `false`, wenn er nicht (mehr) gilt. */
  freigeben(marke: number): boolean {
    const vorher = this.eintraege.length
    this.eintraege = this.eintraege.filter((e) => e.marke !== marke)
    return this.eintraege.length < vorher
  }

  /**
   * „Ich lebe noch" — verlaengert die Frist.
   *
   * `false`, wenn der Ausweis nicht (mehr) gilt. Das ist eine WICHTIGE Antwort
   * und kein Nebenbefund: wer verdraengt wurde, erfaehrt es genau hier — und
   * soll dann aufhoeren statt weiterzuschreiben. Das ist der Weg, auf dem ein
   * laufender Arbeiter merkt, dass er weichen soll, ohne dass ihn jemand
   * abschiessen muss.
   */
  lebenszeichen(marke: number): boolean {
    const e = this.eintraege.find((x) => x.marke === marke)
    if (!e) return false
    e.zuletzt = this.uhr()
    return true
  }

  /** Alles vergessen. Fuer Neustarts und Zeugen. */
  leeren(): void {
    this.eintraege = []
  }
}
