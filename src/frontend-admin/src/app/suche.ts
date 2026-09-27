/**
 * Die Suche ueber ALLE Einstellungen der Verwaltung.
 *
 * WOZU: Gleich werden Einstellungen zwischen Konfiguration, Darstellung,
 * Medien und einem neuen Streaming-Reiter verschoben. Danach steht nichts mehr
 * dort, wo der Benutzer es zuletzt gesehen hat. Diese Suche macht das
 * folgenlos — sie ist die Versicherung fuer den Umbau, nicht seine Zugabe.
 *
 * ZWEI DINGE MACHT SIE ANDERS, als eine Suche es ueblicherweise tut:
 *
 * 1. Gefunden wird der SICHTBARE TEXT, nicht der Feldname. Man sucht
 *    „Doppelte", nicht das Feld dahinter. Der Bestand besteht deshalb aus dem,
 *    was auf den Knoepfen steht — erhoben aus den Seiten selbst
 *    (tools/verwaltung-suchbestand.mjs), damit er nicht auseinanderlaeuft.
 *
 * 2. Der Treffer NENNT DIE SEITE, statt nur hinzuspringen. „Doppelte
 *    zusammenfassen — Darstellung › Elemente" sagt beim naechsten Mal, wo man
 *    ohne Suche nachsehen kann; ein blosser Sprung sagt gar nichts. Springen
 *    kann man trotzdem, aber die Auskunft kommt zuerst.
 *
 * WOHER DIE EINTRAEGE KOMMEN — drei Quellen, alle ohne Pflegeliste:
 *   * Der feste Teil: such-bestand.ts, aus den Vorlagen der Seiten erhoben.
 *     Dass er vollstaendig bleibt, prueft
 *     tools/verwaltung-suche-vollstaendig.test.mjs.
 *   * Die Felder der Konfigurationsseite: die entstehen erst zur Laufzeit
 *     (FELDER im Backend, ueber /api/konfiguration). Sie werden HIER aus
 *     derselben Quelle geholt, aus der die Seite sie hat — auseinanderlaufen
 *     koennen die beiden damit gar nicht.
 *   * Die Systemaktionen („Box neu starten", „Medien neu einlesen", …). Genau
 *     dieselbe Lage: die Titel stehen in AKTIONEN (backend-api/src/system.ts)
 *     und kommen ueber GET /api/system; in den Vorlagen steht nur {{ a.titel }},
 *     und Interpolationen wirft die Erhebung weg. Gemessen am 03.08.2026
 *     (node tools/verwaltung-suchbestand.mjs --alle): vier Aktionen fehlten
 *     im Bestand, ohne dass irgendetwas rot war.
 */
import { HttpClient } from '@angular/common/http'
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core'
import { Router } from '@angular/router'
import { firstValueFrom } from 'rxjs'
import { SUCH_BESTAND } from './such-bestand'
import { ortVon, type SuchEintrag, treffer } from './suche.filter'

/** Kuerzeres als zwei Zeichen trifft fast alles und hilft niemandem. */
const AB_ZEICHEN = 2

/** Mehr Zeilen als das passen nicht unter die Kopfleiste, ohne zu erschlagen. */
const HOECHSTENS = 10

interface KonfigFeld {
  id: string
  titel: string
  hinweis: string
  /** Kennung des Bereichs — entscheidet, auf WELCHE Seite der Treffer zeigt. */
  bereich?: string
}

interface KonfigBereich {
  id: string
  titel: string
  seite: 'konfiguration' | 'darstellung' | 'streaming' | 'ton'
}

/**
 * Wo eine Seite liegt und wie sie heisst.
 *
 * DIE FALLE, die das noetig macht (03.08.2026): seit die Felder nach der
 * Leitfrage sortiert sind, stehen sie auf DREI Seiten. Vorher schickte die
 * Suche jeden Treffer nach /konfiguration — das war richtig, solange es nur
 * eine Seite gab, und wurde mit dem Umzug still falsch. Ein Suchtreffer, der
 * auf die falsche Seite fuehrt, ist schlimmer als keiner: man sucht dort
 * weiter.
 */
const SEITE_ORT: Record<KonfigBereich['seite'], { name: string; weg: string }> = {
  konfiguration: { name: 'Konfiguration', weg: '/konfiguration' },
  darstellung: { name: 'Darstellung', weg: '/darstellung' },
  streaming: { name: 'Streaming-Dienste', weg: '/streaming' },
  ton: { name: 'Ton', weg: '/ton' },
}

/** Eine Aktion der Box, so wie GET /api/system sie herausgibt. */
interface SystemAktionKurz {
  id: string
  titel: string
  hinweis: string
  /** true = die Box ist danach erst mal weg. Kommt von JEDEM Serverstand. */
  einschneidend?: boolean
  /**
   * 'medien' oder 'box' — entscheidet, auf WELCHE Seite der Treffer zeigt.
   *
   * FEHLT auf Boxen mit einem Serverstand vor dem 03.08.2026. Gemessen an
   * Box .169 (04.08.2026, tools/verwaltung-suche-aktionen.mjs): alle vier
   * Aktionen kamen OHNE dieses Feld. Der Rueckfall unten ist deshalb kein
   * theoretischer Zweig, sondern der Weg, den heute jede nicht neu
   * ausgerollte Box geht.
   */
  bereich?: string
}

/**
 * Wo die Knoepfe einer Systemaktion stehen.
 *
 * WARUM DAS HIER STEHEN MUSS und nicht mitkommt: der Server sagt `bereich`
 * ('medien' | 'box') — das ist die Zuordnung zur SACHE. Auf welcher Seite der
 * Verwaltung diese Sache bedient wird, weiss nur die Verwaltung. Genau wie
 * SEITE_ORT daneben.
 *
 * DER ABSCHNITT IST DIE ZWEITE WAHRHEIT, die hier nicht zu vermeiden war: die
 * Ueberschrift, unter der die Knoepfe stehen, kennt nur die Vorlage. Damit sie
 * nicht still veraltet, prueft suche.spec.ts („nennt einen Abschnitt, den es
 * auf der Seite wirklich gibt"), dass jeder dieser Namen als Ueberschrift im
 * erhobenen SUCH_BESTAND vorkommt. Wird die h2 umbenannt, sammelt
 * tools/verwaltung-suchbestand.mjs --schreiben den neuen Namen ein und der
 * Test wird rot — nicht die Suche still ungenau.
 */
export const AKTION_ORT: Record<string, { name: string; weg: string; abschnitt: string }> = {
  medien: { name: 'Medien', weg: '/medien', abschnitt: 'Neu einlesen' },
  box: { name: 'System', weg: '/system', abschnitt: 'Box aus- und einschalten' },
}

/**
 * Wohin eine Aktion OHNE Bereichsangabe gehoert — und warum sie ohne
 * einschneidende Wirkung gar nicht in die Suche kommt.
 *
 * GEMESSEN AM GERAET (Box .169, 04.08.2026,
 * tools/verwaltung-suche-aktionen.mjs): Der laufende Serverstand schickt
 * `bereich` NICHT mit. Der Rueckfall ist also der Normalfall, solange nicht
 * ausgerollt ist — und geraten werden darf hier nichts.
 *
 * NACHGESEHEN, WO DER KNOPF DANN WIRKLICH STEHT:
 *   * seiten/system.ts zeigt `harte()` = alle EINSCHNEIDENDEN Aktionen. Das
 *     fragt `bereich` nicht ab. Ein einschneidender Knopf steht also auch auf
 *     einer alten Box unter „System" — der Treffer stimmt.
 *   * seiten/medien.ts zeigt `filter((a) => a.bereich === 'medien')`. Ohne das
 *     Feld ist die Karte LEER und wird gar nicht gezeichnet.
 *
 * Eine sanfte Aktion ohne `bereich` hat auf so einer Box also NIRGENDWO einen
 * Knopf. Sie in die Suche zu nehmen hiesse, auf eine Seite zu schicken, auf
 * der nichts steht — und dort sucht man dann weiter. Ein Treffer ins Leere ist
 * schlimmer als keiner; deshalb faellt sie heraus, statt geraten zu werden.
 */
const AKTION_ORT_OHNE_ANGABE = 'box'

function ortDerAktion(a: SystemAktionKurz): { name: string; weg: string; abschnitt: string } | null {
  const bekannt = a.bereich ? AKTION_ORT[a.bereich] : undefined
  if (bekannt) return bekannt
  return a.einschneidend ? AKTION_ORT[AKTION_ORT_OHNE_ANGABE] : null
}

@Component({
  selector: 'mupi-suche',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { position: relative; display: block; width: min(22rem, 100%); }
    input {
      padding: 0.5rem 0.75rem;
      background: var(--flaeche);
      font-size: 0.94rem;
    }
    .liste {
      position: absolute; top: calc(100% + 0.35rem); right: 0; left: 0;
      z-index: 20; max-height: 70dvh; overflow-y: auto;
      background: var(--flaeche); border: 1px solid var(--rand);
      border-radius: 12px; padding: 0.3rem;
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.45);
    }
    .zeile {
      display: flex; width: 100%; gap: 0.75rem; align-items: baseline;
      justify-content: space-between; text-align: left;
      background: transparent; color: var(--schrift);
      padding: 0.5rem 0.6rem; border-radius: 8px;
    }
    .zeile:hover, .zeile.marke { background: var(--grund); }
    .zeile .was { min-width: 0; overflow-wrap: anywhere; }
    /* Der Ort ist die eigentliche Auskunft — er wird nie abgeschnitten. */
    .zeile .wo { flex: none; color: var(--leit); font-size: 0.82rem; }
    .leer { color: var(--gedaempft); font-size: 0.9rem; margin: 0; padding: 0.6rem; }
    .fuss {
      color: var(--gedaempft); font-size: 0.78rem; margin: 0;
      padding: 0.45rem 0.6rem 0.3rem; border-top: 1px solid var(--rand);
    }
  `,
  template: `
    <!-- Die ARIA-Angaben sind nicht Zierde: ohne sie ist ein Feld, unter dem
         eine Liste auftaucht, fuer eine Vorlesehilfe ein Feld ohne Liste. -->
    <input
      type="search"
      autocomplete="off"
      placeholder="Einstellung suchen …"
      aria-label="Einstellung suchen"
      role="combobox"
      aria-autocomplete="list"
      aria-controls="such-liste"
      [attr.aria-expanded]="offen() && frage().trim().length >= 2"
      [value]="frage()"
      (focus)="aufwachen()"
      (input)="fragen($any($event.target).value)"
      (keydown)="taste($event)"
      (blur)="offen.set(false)"
    />
    @if (offen() && frage().trim().length >= 2) {
      <div class="liste" id="such-liste" role="listbox" aria-label="Treffer">
        @if (gefunden().length === 0) {
          <p class="leer">Nichts gefunden.</p>
        }
        @for (t of gefunden(); track t.weg + t.text; let i = $index) {
          <!-- mousedown statt click: das Verlassen des Feldes schliesst die
               Liste, und blur kaeme vor einem click — der Treffer waere dann
               schon weg, bevor er ankommt. -->
          <button
            type="button"
            class="zeile"
            role="option"
            [class.marke]="i === marke()"
            [attr.aria-selected]="i === marke()"
            (mousedown)="hin(t)"
          >
            <span class="was">{{ t.text }}</span>
            <span class="wo">{{ ort(t) }}</span>
          </button>
        }
        @if (gefunden().length > 0) {
          <p class="fuss">Rechts steht, auf welcher Seite es liegt.</p>
        }
      </div>
    }
  `,
})
export class Suche {
  private readonly http = inject(HttpClient)
  private readonly router = inject(Router)

  readonly frage = signal('')
  readonly offen = signal(false)
  readonly marke = signal(0)

  /** Die Felder der Konfigurationsseite, sobald sie geholt sind. */
  private readonly dazu = signal<SuchEintrag[]>([])
  private geholt = false

  /** Die Systemaktionen, sobald sie geholt sind. Eigenes Signal, eigener Abruf. */
  private readonly aktionen = signal<SuchEintrag[]>([])
  private aktionenGeholt = false

  readonly gefunden = computed(() =>
    treffer([...SUCH_BESTAND, ...this.dazu(), ...this.aktionen()], this.frage(), HOECHSTENS),
  )

  ort(e: SuchEintrag): string {
    return ortVon(e)
  }

  /**
   * Beim ersten Hineinklicken die Konfigurationsfelder nachholen.
   *
   * Nicht schon beim Laden der Verwaltung: das waere ein Abruf auf JEDER
   * Seite, nur fuer den Fall, dass jemand sucht. Und nicht bei jedem Tippen:
   * einmal genuegt, die Felder wechseln waehrend einer Sitzung nicht.
   */
  aufwachen(): void {
    this.offen.set(true)
    void this.konfigHolen()
    void this.aktionenHolen()
  }

  private async konfigHolen(): Promise<void> {
    if (this.geholt) return
    this.geholt = true
    try {
      const a = await firstValueFrom(
        this.http.get<{ felder: KonfigFeld[]; bereiche?: KonfigBereich[] }>('/api/konfiguration'),
      )
      // Bereich -> Seite. Fehlt die Angabe (aelterer Server), bleibt es bei
      // der Konfigurationsseite: lieber der alte, richtige Ort als gar keiner.
      const wohin = new Map((a?.bereiche ?? []).map((b) => [b.id, b]))
      this.dazu.set(
        (a?.felder ?? []).map((f) => {
          const b = f.bereich ? wohin.get(f.bereich) : undefined
          const ort = SEITE_ORT[b?.seite ?? 'konfiguration']
          return {
            text: f.titel,
            seite: ort.name,
            weg: ort.weg,
            // Der Bereichstitel steht als Abschnitt am Treffer — „Spotify
            // Client-ID — Streaming-Dienste > Zugaenge der Anbieter" sagt beim
            // naechsten Mal, wo man ohne Suche nachsieht.
            bereich: b?.titel ?? '',
            zusatz: f.hinweis ?? '',
          }
        }),
      )
    } catch {
      // Kein Grund, laut zu werden: dann findet die Suche eben nur den festen
      // Bestand. Ein Suchfeld darf nie der Grund sein, warum eine Seite meckert.
      this.geholt = false
    }
  }

  /**
   * Die Systemaktionen nachholen — derselbe Weg wie bei den Feldern.
   *
   * WARUM NICHT AUS DEM ERHOBENEN BESTAND: In der Vorlage steht {{ a.titel }}.
   * Der Titel entsteht erst zur Laufzeit; tools/verwaltung-suchbestand.mjs
   * wirft Interpolationen weg und kann das gar nicht anders — dort steht ein
   * Wert, den nur die Box kennt.
   *
   * WARUM NICHT DIE VIER TITEL HIER HINSCHREIBEN: dann gaebe es sie zweimal,
   * und beim ersten Umbenennen im Backend liefen sie auseinander. Schlimmer:
   * eine Box mit anderem Stand haette Knoepfe, die die Suche nicht kennt — und
   * die Suche haette Treffer, die es auf der Box nicht gibt. Ein Treffer, der
   * ins Leere fuehrt, ist schlimmer als keiner (llmwiki:
   * verwaltung-suche-bestand-aus-den-seiten).
   *
   * WAS ES KOSTET, und deshalb steht es hier: GET /api/system liest neben der
   * Aktionsliste auch Temperatur und Plattenbelegung (ein df). EINMAL je
   * Sitzung, beim ersten Hineinklicken ins Suchfeld — nicht beim Laden jeder
   * Seite und nicht bei jedem Tastendruck.
   *
   * EIN EIGENER, SCHLANKER ENDPUNKT WAERE DIE ALTERNATIVE. Er ist bewusst
   * nicht gebaut: er waere ein zweiter Weg zu derselben Liste, und die Frage
   * „welcher von beiden ist der aktuelle?" faengt genau so an.
   */
  private async aktionenHolen(): Promise<void> {
    if (this.aktionenGeholt) return
    this.aktionenGeholt = true
    try {
      const a = await firstValueFrom(this.http.get<{ aktionen?: SystemAktionKurz[] }>('/api/system'))
      const dazu: SuchEintrag[] = []
      for (const k of a?.aktionen ?? []) {
        const ort = ortDerAktion(k)
        // null heisst: auf DIESER Box hat die Aktion keinen Knopf. Siehe die
        // Begruendung an AKTION_ORT_OHNE_ANGABE.
        if (!ort) continue
        dazu.push({
          text: k.titel,
          seite: ort.name,
          weg: ort.weg,
          bereich: ort.abschnitt,
          // Der Hinweis wird MITGESUCHT, aber nicht gezeigt — genau wie bei
          // den Konfigurationsfeldern. Wer „schwarzer Bildschirm" tippt,
          // findet so „Bildschirm-Drehung zurücknehmen", ohne den Namen des
          // Knopfes zu kennen.
          zusatz: k.hinweis ?? '',
        })
      }
      this.aktionen.set(dazu)
    } catch {
      // Wie bei den Feldern: ein Suchfeld darf nie der Grund sein, warum eine
      // Seite meckert. Beim naechsten Hineinklicken wird es erneut versucht.
      this.aktionenGeholt = false
    }
  }

  fragen(text: string): void {
    this.frage.set(text)
    this.marke.set(0)
    this.offen.set(true)
  }

  taste(e: KeyboardEvent): void {
    const liste = this.gefunden()
    if (e.key === 'Escape') {
      this.offen.set(false)
      ;(e.target as HTMLElement).blur()
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (liste.length === 0) return
      e.preventDefault()
      const schritt = e.key === 'ArrowDown' ? 1 : -1
      this.marke.set((this.marke() + schritt + liste.length) % liste.length)
      return
    }
    if (e.key === 'Enter') {
      const ziel = liste[this.marke()]
      if (ziel) {
        e.preventDefault()
        this.hin(ziel)
        ;(e.target as HTMLElement).blur()
      }
    }
  }

  /**
   * Zur Seite des Treffers.
   *
   * Die Frage bleibt NICHT stehen: sie waere auf der neuen Seite eine offene
   * Liste ueber dem, was man gerade sehen wollte.
   */
  hin(e: SuchEintrag): void {
    this.offen.set(false)
    this.frage.set('')
    this.marke.set(0)
    void this.router.navigate([e.weg])
  }
}
