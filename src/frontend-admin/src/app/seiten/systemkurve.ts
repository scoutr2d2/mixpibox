/**
 * Last, Wärme und Speicher über die Zeit — die Kurve der Verwaltung.
 *
 * DER AUFTRAG (Betreiber, 08.08.2026): „ich möchte admin bereichen einen graph
 * für die cpu last temperatur und speicher verbrauch" — und auf die Rückfrage,
 * wo: „in beiden admin bereichen". Dies ist die zweite; die erste steht im
 * Eltern-Bereich der Box (`sysKurveBauen` in NewDesign/app.js).
 *
 * ══ DREI BAHNEN UNTEREINANDER, NICHT DREI LINIEN ÜBEREINANDER ═══════════
 * CPU und Speicher sind Prozent, die Wärme sind Grad. Auf eine Achse gezwungen
 * klebte die Temperaturkurve als „52 %" am Speicher — oder es bräuchte eine
 * zweite Achse rechts, und dann muss der Leser bei jeder Linie erst
 * nachschlagen, welche gilt. Drei Bahnen lösen das, ohne etwas zu kosten: jede
 * hat ihre eigene Skala, ihren Namen und ihre Zahl.
 *
 * UND SIE TEILEN SICH DIE ZEITACHSE — darum geht es. Die Frage lautet nie „wie
 * war die CPU", sondern „warum war die Box um drei Uhr nachts wach"; die
 * beantwortet erst, dass alle drei ZUR SELBEN ZEIT untereinander stehen. Ein
 * Ablesestrich durch alle drei, drei Zahlen.
 *
 * ══ VON HAND ALS SVG, OHNE EINE ZEILE AUS EINER BIBLIOTHEK ══════════════
 * Dieselbe Entscheidung wie bei der Akkukurve der Box: die Verwaltung wird oft
 * aus demselben Netz aufgerufen, in dem die Box steht, und ein Diagramm, das
 * ein Paket von einem CDN holen müsste, wäre genau dann leer, wenn jemand
 * wissen will, warum die Box hakt. 190 Zeilen Vorlage sind billiger als eine
 * Abhängigkeit.
 *
 * DIE REINEN REGELN LIEGEN NEBENAN in ../systemverlauf.ts und sind dort
 * geprüft (systemverlauf.spec.ts). Hier steht nur, wohin die Striche kommen.
 */
import { HttpClient } from '@angular/common/http'
import { ChangeDetectionStrategy, Component, type OnDestroy, type OnInit, computed, inject, signal } from '@angular/core'
import { firstValueFrom } from 'rxjs'
import {
  BAHNEN,
  GRAD_BIS,
  GRAD_MARKE,
  GRAD_VON,
  type Punkt,
  SPANNEN,
  type Satz,
  type Verlauf,
  WOCHENTAG,
  ablesePunkt,
  abdeckung,
  achse,
  duennSatz,
  heissSatz,
  jetztSatz,
  komma,
  leseSatz,
  minutenWort,
  stuecke,
  zahl,
} from '../systemverlauf'

/* ── DIE MASSE DER ZEICHENFLÄCHE ─────────────────────────────────────────
 * Alle Zahlen sind viewBox-Einheiten. Die Breite steht im Stilblatt auf
 * 100 %, damit nichts an einer gemessenen Fensterbreite hängt.
 *
 * DIESELBEN WIE IN DER BOX (NewDesign/app.js, `sysKurveBauen`): 560 breit,
 * Bahnen zu 44 mit 18 Abstand. Zwei Fassungen desselben Bildes, die
 * verschieden aussehen, wären zwei Bilder. */
const L = 38
const R = 552
const H = 44
const ABSTAND = 18
const T0 = 12
const UNTEN = T0 + 2 * (H + ABSTAND) + H
const ACHS_Y = UNTEN + 20
const LEG_Y = UNTEN + 42
const HOCH = LEG_Y + 8

/** Eine fertige Bahn, wie das Stilblatt sie braucht. */
interface Gezeichnet {
  feld: string
  name: string
  kopf: string
  T: number
  marken: { y: number; wort: string }[]
  markeY: number | null
  zuege: string[]
  punkte: { cx: number; cy: number }[]
  leer: string | null
}

@Component({
  selector: 'mupi-systemkurve',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    /* ══ DIE KURVE STEHT IN EINER KARTE WIE ALLES DANEBEN (20.08.2026) ══
       Betreiber: „das design den cpu verlaufs nochmal angehen, das sieht noch
       nicht stimmig aus in performance (und system) zum rest."
       Auf BEIDEN Seiten stehen ringsum Kaesten mit Rand und Flaeche — die
       Werte-Kaestchen der Systemseite, der gestapelte Balken und der
       Wasserfall der Leistungsseite. Die Kurve lag als einziges Element nackt
       auf dem Grund und wirkte dadurch wie etwas, das noch nicht fertig
       eingebaut ist. Dieselben drei Werte wie bei .wert dort: Flaeche, Rand,
       12 px Radius.
       KEIN BACKTICK IN DIESEN KOMMENTAREN — der styles-Block ist eine
       Vorlage, und ein Backtick beendet sie mitten im Satz.
       :host UND NICHT EIN WRAPPER IM TEMPLATE: so gilt es fuer jede Seite,
       die die Komponente einbindet — auch fuer die naechste. */
    :host {
      display: block;
      background: var(--flaeche);
      border: 1px solid var(--rand);
      border-radius: 12px;
      padding: 0.9rem 1rem 0.7rem;
    }
    .kopf { display: flex; align-items: baseline; gap: 0.8rem; flex-wrap: wrap; margin-bottom: 0.4rem; }
    .stand { font-size: 1.15rem; }
    .unter { color: var(--gedaempft); font-size: 0.88rem; }
    .spanne { margin-left: auto; }
    .hinweis, .fuss { color: var(--gedaempft); font-size: 0.85rem; margin: 0.4rem 0 0; }
    svg {
      /* HOEHE WAECHST MIT DER BREITE (15.08.2026, Betreiber: „der graph
         wirkt gestaucht"): mit fester Hoehe von 230px wurde die 560 Einheiten
         breite Zeichenflaeche auf bis zu 60rem Inhaltsbreite gestreckt —
         die Kurven um gut 40 % plattgedrueckt, die Schrift breitgezogen.
         Das Seitenverhaeltnis ist das der viewBox (560 x 230). */
      display: block; width: 100%; height: auto; aspect-ratio: 560 / 230;
      /* Ohne das entscheidet der Browser beim ersten Millimeter selbst, ob er
         blättert — und der Ablesestrich geht zufällig verloren, je nachdem wie
         schräg der Zeiger ansetzt. */
      touch-action: none;
    }
    .gitter { stroke: var(--rand); stroke-width: 1; }
    .gitter.senkrecht { stroke-dasharray: 2 4; }
    .achszahl { fill: var(--gedaempft); font-size: 10px; font-weight: 600; }
    /* ══ DIE UNTERSCHEIDUNG HÄNGT NICHT AN DER FARBE ══════════════════════
     * Dreifach getrennt: ORT (jede Bahn hat ihre Zeile), FORM (durchgezogen,
     * gestrichelt, gepunktet) und erst dann FARBE. Der NAME steht zusätzlich
     * IN jeder Bahn — wer eine Linie sieht, muss nicht nachschlagen. */
    .linie { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
    .linie.c { stroke: var(--schrift); }
    .linie.g { stroke: var(--warn); stroke-dasharray: 7 3; }
    .linie.m { stroke: var(--leit); stroke-dasharray: 1.5 3.5; }
    .punkt.c { fill: var(--schrift); }
    .punkt.g { fill: var(--warn); }
    .punkt.m { fill: var(--leit); }
    .luecke { fill: url(#vw-luecke); stroke: none; }
    .luecke-strich { fill: var(--gedaempft); opacity: 0.26; }
    /* Die Drosselmarke ist eine Schwelle, keine Messung — sie darf die Kurve
       daneben nicht überschreien. */
    .marke { stroke: var(--warn); stroke-width: 1; stroke-dasharray: 3 3; opacity: 0.5; }
    .markenwort { fill: var(--warn); opacity: 0.75; }
    /* paint-order:stroke legt einen Saum in der Grundfarbe unter den Namen.
       Ohne ihn verschwindet er, sobald die Linie durch die linke obere Ecke
       läuft — und das tut sie bei voller Auslastung immer. */
    .bahnname {
      fill: var(--schrift); stroke: var(--grund); stroke-width: 3; paint-order: stroke;
      font-size: 11px; font-weight: 600;
    }
    .griff { stroke: var(--schrift); stroke-width: 1.5; opacity: 0.65; pointer-events: none; }
  `,
  template: `
    <div class="kopf">
      <div>
        <div class="stand">{{ satz().kopf }}</div>
        <div class="unter">{{ satz().unter }}</div>
      </div>
      <button type="button" class="spanne" (click)="spanneWechseln()">
        {{ stunden() === 24 ? '7 Tage' : '24 Stunden' }}
      </button>
    </div>

    @if (fehler(); as f) {
      <p class="hinweis">{{ f }}</p>
    } @else if (duenn(); as d) {
      <p class="hinweis">{{ d }}</p>
    } @else if (bahnen().length) {
      <svg
        [attr.viewBox]="'0 0 560 ' + HOCH"
        preserveAspectRatio="none"
        role="img"
        [attr.aria-label]="vorlesen()"
        (pointerdown)="griffAn($event)"
        (pointermove)="griffZieht($event)"
        (pointerup)="griffAus()"
        (pointercancel)="griffAus()"
        (pointerleave)="griffAus()"
      >
        <defs>
          <pattern id="vw-luecke" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(-45)">
            <rect class="luecke-strich" width="1.2" height="8" />
          </pattern>
        </defs>

        <!-- ZUERST DIE LÜCKEN, damit Gitter und Linien DARÜBER liegen. -->
        @for (k of luecken(); track k.x + '-' + k.y) {
          <rect class="luecke" [attr.x]="k.x" [attr.y]="k.y" [attr.width]="k.w" [attr.height]="H" />
        }

        @for (b of bahnen(); track b.feld) {
          @for (m of b.marken; track m.wort) {
            <line class="gitter" [attr.x1]="L" [attr.y1]="m.y" [attr.x2]="R" [attr.y2]="m.y" />
            <text class="achszahl" [attr.x]="L - 6" [attr.y]="m.y + 3.5" text-anchor="end">{{ m.wort }}</text>
          }
          @if (b.markeY !== null) {
            <line class="marke" [attr.x1]="L" [attr.y1]="b.markeY" [attr.x2]="R" [attr.y2]="b.markeY" />
            <text class="achszahl markenwort" [attr.x]="R - 2" [attr.y]="b.markeY - 3" text-anchor="end">
              ab hier bremst sie sich
            </text>
          }
          <text class="bahnname" [attr.x]="L + 4" [attr.y]="b.T + 11">{{ b.kopf }}</text>
          @for (z of b.zuege; track $index) {
            <polyline [class]="'linie ' + b.feld" [attr.points]="z" />
          }
          @for (p of b.punkte; track $index) {
            <circle [class]="'punkt ' + b.feld" [attr.cx]="p.cx" [attr.cy]="p.cy" r="2" />
          }
          @if (b.leer) {
            <text class="achszahl" [attr.x]="(L + R) / 2" [attr.y]="b.T + H / 2 + 3" text-anchor="middle">{{ b.leer }}</text>
          }
        }

        <!-- DIE ZEITMARKEN: einmal, unter allen drei Bahnen. Sie sind der ganze
             Grund für die Stapelung — dieselbe Stelle ist dieselbe Minute. -->
        @for (m of marken(); track m.t) {
          @for (b of bahnen(); track b.feld) {
            <line class="gitter senkrecht" [attr.x1]="m.x" [attr.y1]="b.T" [attr.x2]="m.x" [attr.y2]="b.T + H" />
          }
          <text class="achszahl" [attr.x]="m.x" [attr.y]="ACHS_Y" text-anchor="middle">{{ m.wort }}</text>
        }

        <!-- Die Legende hat EINEN Eintrag. Die drei Linienmuster wären
             ueberfluessig — jede Bahn traegt ihren Namen in sich. Was bleibt, ist
             das Einzige, das man nicht errät: eine Schraffur heißt nicht von
             selbst „hier war die Box aus". -->
        <rect class="luecke" [attr.x]="L" [attr.y]="LEG_Y - 9" width="20" height="11" />
        <text class="achszahl" [attr.x]="L + 25" [attr.y]="LEG_Y">keine Messwerte</text>

        @if (griffX() !== null) {
          <line class="griff" [attr.x1]="griffX()" [attr.x2]="griffX()" [attr.y1]="T0" [attr.y2]="UNTEN" />
        }
      </svg>

      @if (heiss(); as h) {
        <p class="hinweis">{{ h }}</p>
      }
      <p class="fuss">{{ fuss() }}</p>
    }
  `,
})
export class Systemkurve implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient)

  protected readonly L = L
  protected readonly R = R
  protected readonly H = H
  protected readonly T0 = T0
  protected readonly UNTEN = UNTEN
  protected readonly ACHS_Y = ACHS_Y
  protected readonly LEG_Y = LEG_Y
  protected readonly HOCH = HOCH

  readonly stunden = signal<number>(SPANNEN[0])
  readonly verlauf = signal<Verlauf | null>(null)
  readonly fehler = signal<string | null>(null)
  /** Wo der Ablesestrich steht (viewBox-Einheiten), oder null. */
  readonly griffX = signal<number | null>(null)
  /** Was unter dem Strich gelesen wird — null heißt „zeig das Jetzt". */
  private readonly gelesen = signal<Satz | null>(null)

  private uhr: ReturnType<typeof setInterval> | null = null

  ngOnInit(): void {
    void this.holen()
    // EINE MINUTE, NICHT FÜNF SEKUNDEN. Der Server misst im Minutentakt
    // (`MESS_MS` in systemverlauf.ts); schneller zu fragen holte dieselbe
    // Reihe noch einmal und die Kurve sähe Zeichen für Zeichen gleich aus.
    this.uhr = setInterval(() => void this.holen(), 60000)
  }

  ngOnDestroy(): void {
    if (this.uhr !== null) clearInterval(this.uhr)
    this.uhr = null
  }

  async holen(): Promise<void> {
    const stunden = this.stunden()
    try {
      const v = await firstValueFrom(this.http.get<Verlauf>(`/api/system/verlauf?stunden=${stunden}`))
      // Zwischendurch umgeschaltet? Dann gehört diese Antwort niemandem mehr.
      if (this.stunden() !== stunden) return
      this.verlauf.set(v && typeof v === 'object' ? v : null)
      this.fehler.set(null)
    } catch (e) {
      if (this.stunden() !== stunden) return
      // DER 404 IST EINE EIGENE AUSKUNFT. Eine Box mit älterem Server kennt
      // den Weg nicht — das ist kein Defekt und soll nicht wie einer klingen.
      const status = (e as { status?: number })?.status
      this.fehler.set(
        status === 404
          ? 'Dieser Server zeichnet Last, Wärme und Speicher noch nicht auf. Ein Update der Box bringt die Kurve mit.'
          : 'Der Systemverlauf ist gerade nicht abrufbar.',
      )
      this.verlauf.set(null)
    }
  }

  spanneWechseln(): void {
    const i = SPANNEN.indexOf(this.stunden() as (typeof SPANNEN)[number])
    this.stunden.set(SPANNEN[(i + 1) % SPANNEN.length])
    // DIE ALTE ANTWORT FÄLLT WEG, bevor die neue da ist. Bliebe sie stehen,
    // zeigte die Seite für den Augenblick des Abrufs eine 24-Stunden-Kurve
    // unter der Überschrift „7 Tage".
    this.verlauf.set(null)
    this.griffX.set(null)
    this.gelesen.set(null)
    void this.holen()
  }

  /* ── DIE ABGELEITETEN GRÖSSEN ─────────────────────────────────────────── */

  private readonly punkte = computed<Punkt[]>(() => {
    const v = this.verlauf()
    return v && Array.isArray(v.punkte) ? v.punkte : []
  })

  private readonly luecke = computed(() => {
    const w = Number(this.verlauf()?.lueckeMs)
    // DER SERVER SAGT ES SELBST. Er kennt seinen Messtakt; ihn aus Abständen
    // zu schätzen wäre ein Rückschritt. 4 Minuten nur als Rückfall.
    return Number.isFinite(w) && w > 0 ? w : 240000
  })

  /** Die Stücke OHNE Wertbezug — sie gelten für alle drei Bahnen. */
  private readonly zeitStuecke = computed(() => stuecke(this.punkte(), this.luecke(), null))

  private readonly rahmen = computed(() => {
    const v = this.verlauf()
    const letzter = v?.jetzt && Number.isFinite(Number(v.jetzt.t)) ? Number(v.jetzt.t) : 0
    // `bis` ist der SPÄTERE von Messpunkt und Browseruhr: War die Box drei
    // Stunden aus, endete das Bild sonst vor drei Stunden — und ausgerechnet
    // die Lücke am rechten Rand, die man sucht, wäre unsichtbar.
    const bis = Math.max(letzter, Date.now())
    return { von: bis - this.stunden() * 3600000, bis }
  })

  private xVon(t: number): number {
    const { von, bis } = this.rahmen()
    return L + ((Math.min(bis, Math.max(von, Number(t))) - von) / (bis - von)) * (R - L)
  }

  private yVon(art: string, T: number, w: number): number {
    if (art === 'grad') {
      const g = Math.max(GRAD_VON, Math.min(GRAD_BIS, Number(w)))
      return T + H - ((g - GRAD_VON) / (GRAD_BIS - GRAD_VON)) * H
    }
    return T + H - (Math.max(0, Math.min(100, Number(w))) / 100) * H
  }

  readonly duenn = computed(() => (this.verlauf() ? duennSatz(this.punkte(), this.zeitStuecke()) : null))
  readonly heiss = computed(() => heissSatz(this.punkte()))

  readonly satz = computed<Satz>(() => this.gelesen() ?? jetztSatz(this.verlauf()))

  readonly bahnen = computed<Gezeichnet[]>(() => {
    const v = this.verlauf()
    if (!v) return []
    const j = v.jetzt
    const luecke = this.luecke()
    return BAHNEN.map((b, i) => {
      const T = T0 + i * (H + ABSTAND)
      const jetztWert = j ? zahl(j, b.feld) : Number.NaN
      const zuege: string[] = []
      const einzeln: { cx: number; cy: number }[] = []
      for (const st of stuecke(this.punkte(), luecke, b.feld)) {
        if (st.length === 1) {
          einzeln.push({ cx: this.xVon(st[0].t), cy: this.yVon(b.art, T, zahl(st[0], b.feld)) })
          continue
        }
        zuege.push(
          st.map((p) => this.xVon(p.t).toFixed(1) + ',' + this.yVon(b.art, T, zahl(p, b.feld)).toFixed(1)).join(' '),
        )
      }
      const hatWerte = this.punkte().some((p) => Number.isFinite(zahl(p, b.feld)))
      return {
        feld: b.feld,
        name: b.name,
        kopf:
          b.name +
          (Number.isFinite(jetztWert)
            ? '  ' + (b.art === 'grad' ? komma(jetztWert) + ' °C' : Math.round(jetztWert) + ' %')
            : ''),
        T,
        // ZWEI MARKEN JE BAHN und nicht drei: auf 44 Einheiten Höhe stehen drei
        // Beschriftungen zu 10 px so dicht, dass sie zur Schraffur werden.
        marken:
          b.art === 'grad'
            ? [
                { y: this.yVon(b.art, T, GRAD_BIS), wort: GRAD_BIS + '°' },
                { y: this.yVon(b.art, T, GRAD_VON), wort: GRAD_VON + '°' },
              ]
            : [
                { y: this.yVon(b.art, T, 100), wort: '100 %' },
                { y: this.yVon(b.art, T, 0), wort: '0' },
              ],
        markeY: b.art === 'grad' ? this.yVon(b.art, T, GRAD_MARKE) : null,
        zuege,
        punkte: einzeln,
        leer: hatWerte ? null : b.art === 'grad' ? 'kein Wärmesensor' : 'keine Messwerte',
      }
    })
  })

  /** Die Flächen ohne Messwerte — je Lücke eine Fläche JE Bahn. */
  readonly luecken = computed(() => {
    if (!this.verlauf()) return []
    const { von, bis } = this.rahmen()
    const kanten: [number, number][] = []
    let vorher = von
    for (const st of this.zeitStuecke()) {
      const a = Number(st[0].t)
      const e = Number(st[st.length - 1].t)
      if (a > vorher) kanten.push([vorher, a])
      vorher = Math.max(vorher, e)
    }
    if (bis > vorher) kanten.push([vorher, bis])
    const raus: { x: number; y: number; w: number }[] = []
    for (const [a, e] of kanten) {
      const x1 = this.xVon(a)
      const x2 = this.xVon(e)
      // UNTER EINEM BILDPUNKT WIRD NICHTS GEMALT — ein 0,3 breites Rechteck
      // ist ein Strich, der aussieht wie ein Zeichenfehler.
      if (x2 - x1 < 1) continue
      for (let i = 0; i < BAHNEN.length; i++) raus.push({ x: x1, y: T0 + i * (H + ABSTAND), w: x2 - x1 })
    }
    return raus
  })

  readonly marken = computed(() => {
    if (!this.verlauf()) return []
    const { von, bis } = this.rahmen()
    return achse(von, bis).map((m) => {
      const d = new Date(m.t)
      return {
        t: m.t,
        x: this.xVon(m.t),
        wort: m.tag
          ? WOCHENTAG[d.getDay()]
          : String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'),
      }
    })
  })

  readonly fuss = computed(() => {
    const v = this.verlauf()
    if (!v) return ''
    const ms = abdeckung(this.zeitStuecke())
    return (
      'Aufgezeichnet: ' +
      minutenWort(Math.round(ms / 60000)) +
      ' der letzten ' +
      (this.stunden() === 24 ? '24 Stunden' : '7 Tage') +
      ' · ' +
      (Number(v.gesamt) || 0) +
      ' Messpunkte.'
    )
  })

  /** Die Sprachausgabe bekommt die AUSSAGE, nicht das Bild. Drei Linienzüge
   *  sind für sie nichts; die Spitzenwerte sind das, was nur im Bild steckt. */
  readonly vorlesen = computed(() => {
    const p = this.punkte()
    return (
      'Verlauf der letzten ' +
      (this.stunden() === 24 ? '24 Stunden' : '7 Tage') +
      ': ' +
      BAHNEN.map((b) => {
        const werte = p.map((x) => zahl(x, b.feld)).filter((w) => Number.isFinite(w))
        if (!werte.length) return b.name + ' ohne Messwerte'
        return b.name + ' höchstens ' + Math.round(Math.max(...werte)) + (b.art === 'grad' ? ' Grad' : ' Prozent')
      }).join(', ')
    )
  })

  /* ── DER ABLESESTRICH ─────────────────────────────────────────────────
   *
   * DIE WERTE GEHEN NACH OBEN, nicht unter den Zeiger. Er verdeckt genau die
   * Stelle, die er zeigt; ein Feld darunter wäre unlesbar, und eines, das ihm
   * ausweicht, spränge beim Ziehen hin und her. Sie gehen in die zwei Zeilen,
   * die ohnehin dastehen — das kostet keinen Bildpunkt und beantwortet
   * zugleich, was VOR dem Ziehen dort steht: der jetzige Wert.
   *
   * GERASTET WIRD AUF DEN MESSWERT, nicht auf den Zeiger. Ein Strich zwischen
   * zwei Messungen behauptete eine Genauigkeit, die die Reihe nicht hat. */
  griffAn(ev: PointerEvent): void {
    ;(ev.currentTarget as Element | null)?.setPointerCapture?.(ev.pointerId)
    this.ablesen(ev)
  }

  griffZieht(ev: PointerEvent): void {
    const el = ev.currentTarget as Element | null
    if (el?.hasPointerCapture?.(ev.pointerId)) this.ablesen(ev)
  }

  griffAus(): void {
    this.griffX.set(null)
    // ZURÜCK AUF „JETZT" ÜBER DIESELBE RECHNUNG wie beim Aufbau, nicht über
    // gemerkten Text: während jemand zieht, läuft der Takt weiter.
    this.gelesen.set(null)
  }

  private ablesen(ev: PointerEvent): void {
    const el = ev.currentTarget as Element | null
    const r = el?.getBoundingClientRect()
    if (!r?.width) return
    // VON BILDSCHIRM- IN ZEICHENKOORDINATEN. `preserveAspectRatio: none`
    // streckt die Fläche auf die Spaltenbreite; der Faktor ist 560/r.width.
    const xRoh = ((ev.clientX - r.left) / r.width) * 560
    const x = Math.max(L, Math.min(R, xRoh))
    const { von, bis } = this.rahmen()
    const t = von + ((x - L) / (R - L)) * (bis - von)
    // AUF DEN ZEITSTÜCKEN und nicht auf denen einer Bahn: der Strich gilt für
    // alle drei, und die Wärmebahn kann Löcher haben, die die anderen nicht
    // haben. `ablesePunkt` gibt ein PAAR zurück — wer das Ergebnis direkt auf
    // Wahrheit prüft, schreibt „NaN:NaN" auf den Schirm.
    const { punkt, luecke } = ablesePunkt(this.zeitStuecke(), t)
    this.griffX.set(punkt ? this.xVon(punkt.t) : x)
    // DIE GRENZEN DER AUFZEICHNUNG GEHEN MIT. Ohne sie hiesse jede leere
    // Stelle „die Box war aus" — auch die 23 Stunden vor dem ersten Messwert
    // einer Reihe, die erst 44 Minuten alt ist. Siehe `lueckenSatz`.
    const st = this.zeitStuecke()
    const spanne = st.length
      ? { von: Number(st[0][0].t), bis: Number(st[st.length - 1][st[st.length - 1].length - 1].t) }
      : undefined
    this.gelesen.set(leseSatz(punkt, luecke, t, this.stunden() > 24, Number(this.verlauf()?.kerne), spanne))
  }
}
