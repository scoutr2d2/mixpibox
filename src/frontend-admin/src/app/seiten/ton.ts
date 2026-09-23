/**
 * Die Seite „Ton" — ALLES Hörbare an einem Ort.
 *
 * GEWUENSCHT (Betreiber, 15.08.2026), in vier Schritten desselben Tages:
 * „ich würde den ton jetzt gerne in einem eigenen tab haben … mit manueller
 * einstellung der lautstärke pro tonquelle", dann „auch pro senke … mir geht
 * es mehr um die senken", dann „noch ein delay ausgleich manuell und ein
 * equalizer", dann „mache die senken einzeln wählbar … gezielt auswählbar
 * was man haben möchte" — und die Ton-Sektion der Konfigurationsseite zog
 * mit um („in konfiguration gibt es noch eine ton sektion die kann man
 * umziehen").
 *
 * DER SCHNITT: Bluetooth = die SCHNITTSTELLE (koppeln, verbinden, Adapter).
 * Diese Seite = der TON: wohin er geht (Ziele, auch der MuPiHAT), wer bei
 * „Überall" mitspielt, wie laut je Ausgabe und je Quelle, der Klang
 * (Equalizer, Versatz je Box) und die Grundeinstellungen (Start- und
 * Höchstlautstärke, Wiedergabe-Maschine).
 *
 * WAS DIE BOX SICH MERKT: Pegel merkt der Tonserver selbst (WirePlumber,
 * restore-Module); Equalizer, Versatz und Überall-Auswahl merkt der Server
 * in klang.json — Knoten-Eigenschaften sind flüchtig, eine Wache im Server
 * wendet sie nach Verbinden und Neustart neu an. Diese Seite SCHREIBT nur.
 *
 * DER ANMELDEPUNKT FÜR TON-PLUGINS IST DA (21.08.2026) — und er brauchte den
 * erwarteten Vertrags-Ausbau NICHT. Hier stand: „braucht den Vertrags-Ausbau,
 * siehe BACKLOG E36/B". Der Denkfehler war die Annahme, ein Plugin müsse eine
 * Oberfläche mitbringen. Es meldet stattdessen seine Regler als `felder` im
 * Manifest an — das gab es längst, der Plugin-Bereich baut daraus schon seine
 * Eingaben —, und diese Seite tut dasselbe. Neu war nur das Recht `klang` und
 * ein Ruf `klangkette()`, der eine geprüfte Gliederliste liefert
 * (klangkette.ts). Fremdes JS kommt dabei nicht in die Seite; genau das war
 * der Grund, warum `UiExtension` gestrichen wurde, und der gilt weiter.
 *
 * Anlass war die seitliche Abstrahlung der Lautsprecher (Betreiber, 21.08.):
 * dagegen hilft eine KANALMATRIX, und die kann der Fünfband-Equalizer nicht —
 * er rechnet je Kanal, er mischt nicht zwischen ihnen.
 *
 * KEINE BACKTICKS in dieser Vorlage — Template-Literal
 * ([[backticks-in-angular-vorlagen]]).
 */
import { HttpClient } from '@angular/common/http'
import {
  ChangeDetectionStrategy,
  Component,
  type OnDestroy,
  type OnInit,
  inject,
  signal,
} from '@angular/core'
import { firstValueFrom } from 'rxjs'

type Ziel = { art: 'intern' } | { art: 'bluetooth'; mac: string } | { art: 'ueberall' }

interface Tonlage {
  ziel: Ziel
  titel: string
  stumm: boolean
  verbunden: { mac: string; name: string }[]
  ueberallDa?: boolean
}

interface SenkeMitPegel {
  sinkName: string
  ziel: Ziel
  titel: string
  prozent: number
  /** Traegt DIESE Senke die Nutzerlautstärke? Der Server entscheidet das
   *  (`regelndeSenkeWaehlen`), nicht die Oberfläche — siehe `gesamt()`. */
  regelnd?: boolean
}

interface Quelle {
  kennung: number
  name: string
  roh: string
  prozent: number
}

interface KlangStand {
  entzerrer: { an: boolean; baender: Record<string, number> }
  versatz: Record<string, number>
  deckel: Record<string, number>
  ueberall: {
    intern: boolean
    glieder: { mac: string; name: string; an: boolean; verbunden: boolean }[]
  }
}

/** Eine Zeile der Ausgaben-Karte: Haekchen, Pegel, Deckel, ggf. Versatz. */
interface AusgabeZeile {
  /** 'intern' oder die Bluetooth-Adresse — der Schluessel fuer Auswahl und Deckel. */
  schluessel: string
  name: string
  verbunden: boolean
  /** Fehlt, wenn die Box gerade getrennt ist — dann gibt es nichts zu regeln. */
  sinkName?: string
  prozent?: number
  deckel: number
  mac?: string
}

/**
 * Der Stand des Klangwerks — was die Ton-Plugins in den Signalweg haengen.
 *
 * `gibt` und `an` sind ABSICHTLICH getrennt: ein Plugin kann eingehaengt sein
 * und seine Kette trotzdem nicht wirken (vom Tonstapel abgelehnt, Prozess
 * nicht hochgekommen). Ein Abschnitt, der dann „aktiv" zeigt, schickt den
 * Betreiber auf die falsche Suche.
 */
interface KlangwerkStand {
  gibt: boolean
  an: boolean
  text: string
  plugins: string[]
}

/** Ein Klang-Plugin mit seinen Reglern, wie die Ton-Seite sie braucht. */
interface KlangPlugin {
  kennung: string
  name: string
  zustand: string
  grund?: string
  felder: { schluessel: string; art: string; name: string; hinweis?: string; vorgabe?: unknown }[]
  werte: Record<string, unknown>
}

interface KonfigFeld {
  id: string
  bereich: string
  art: string
  titel: string
  hinweis?: string
  min?: number
  max?: number
  wert?: unknown
  /** Bei art 'auswahl': die AUFGELOESTEN Moeglichkeiten, wie die
   *  Konfigurationsseite sie bekommt — /api/konfiguration schickt `auswahl`,
   *  nie das interne `festeAuswahl` (das stand hier zuerst, und die Liste
   *  der Wiedergabe-Maschine war leer). */
  auswahl?: { wert: string; titel: string }[]
}

@Component({
  selector: 'mupi-ton',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    h1 { font-size: 1.3rem; margin: 0 0 0.35rem; }
    p.unter { color: var(--gedaempft); margin: 0 0 1.4rem; font-size: 0.94rem; }
    h2 { font-size: 1.05rem; margin: 1.4rem 0 0.5rem; }
    .karte {
      background: var(--flaeche); border: 1px solid var(--rand); border-radius: 12px;
      padding: 1rem 1.1rem; margin-bottom: 0.9rem;
    }
    /* Klangwerk: die Lage-Zeile ist die wichtigste Auskunft des Abschnitts —
       „angemeldet" und „wirkt" sind zweierlei, und das muss man SEHEN. */
    .kw-lage {
      display: flex; align-items: center; gap: 0.5rem; margin: 0.6rem 0 0.9rem;
      font-size: 0.94rem;
    }
    .kw-punkt {
      width: 0.6rem; height: 0.6rem; border-radius: 50%; background: var(--leit);
      flex: none;
    }
    .kw-lage.kw-aus { color: var(--gedaempft); }
    .kw-lage.kw-aus .kw-punkt { background: var(--gedaempft); }
    .kw-plugin { border-top: 1px solid var(--rand); padding-top: 0.8rem; margin-top: 0.8rem; }
    .kw-plugin h3 { font-size: 0.98rem; margin: 0 0 0.6rem; }
    /* Der Wert steht NEBEN dem Namen, nicht unter dem Regler: beim Ziehen
       schaut man auf den Daumen, und der Blick soll nicht wandern. */
    .kw-plugin label { display: flex; justify-content: space-between; align-items: baseline; gap: 0.6rem; }
    .kw-wert { color: var(--leit); font-variant-numeric: tabular-nums; font-weight: 600; }
    .kw-plugin input[type='range'] { width: 100%; accent-color: var(--leit); margin: 0.15rem 0 0; }
    .kw-liveaus { color: var(--gedaempft); font-size: 0.88rem; margin: 0.4rem 0 0; }
    /* Die Buehne: echte Lautsprecher grau und fest, wahrgenommene Quellen
       farbig und beweglich. Der Uebergang laesst sie beim Ziehen GLEITEN
       statt springen — das ist der ganze Punkt der Anzeige. */
    .kw-buehne { width: 100%; max-width: 20rem; height: auto; display: block; margin: 0.2rem auto 0; }
    .kw-box { fill: none; stroke: var(--gedaempft); stroke-width: 2; }
    .kw-quelle { fill: var(--leit); transition: cx 90ms linear; }
    .kw-spann { stroke: var(--leit); stroke-width: 2; opacity: 0.35; transition: x1 90ms linear, x2 90ms linear; }
    .kw-kopf { fill: none; stroke: var(--schrift); stroke-width: 2; }
    .kw-ohren { fill: none; stroke: var(--schrift); stroke-width: 2; }
    .kw-mini { fill: var(--gedaempft); font-size: 11px; text-anchor: middle; }
    .kw-mitte { fill: var(--schrift); }
    .kw-buehnentext { color: var(--gedaempft); font-size: 0.88rem; text-align: center; margin: 0.1rem 0 0.7rem; }
    /* Der Frequenzgang. Die Kurve traegt keinen Uebergang: sie kommt vom
       Server und springt in Stufen von 80 ms — ein CSS-Uebergang auf das
       Pfad-Attribut liefe der naechsten Antwort hinterher und ruckelte
       sichtbar. (Und KEINE BACKTICKS hier drin: dieser Block IST ein
       Template-Literal, ein Backtick im Kommentar reisst die Datei ab —
       genau das ist beim Schreiben dieser Zeilen passiert.) */
    .kw-gang { margin: 0.8rem 0 0.2rem; }
    .kw-gang svg { width: 100%; height: auto; display: block; }
    .kw-null { stroke: var(--rand); stroke-width: 1.5; }
    .kw-raster { stroke: var(--rand); stroke-width: 1; opacity: 0.5; stroke-dasharray: 2 3; }
    .kw-kurve { fill: none; stroke: var(--leit); stroke-width: 2.5; stroke-linejoin: round; }
    .kw-links { text-anchor: start; }
    .kw-pegel { color: var(--gedaempft); font-size: 0.88rem; text-align: center; margin: 0.1rem 0 0.6rem; }
    .kw-pegel.kw-warnung { color: var(--warnung, #c47f00); font-weight: 600; }
    .ziele { display: flex; gap: 0.6rem; flex-wrap: wrap; }
    .ziele button {
      font: inherit; padding: 0.55rem 0.9rem; border-radius: 10px;
      border: 1px solid var(--rand); background: var(--grund); color: var(--schrift);
      cursor: pointer;
    }
    .ziele button.aktiv { border-color: var(--leit); font-weight: 600; }
    .ziele button[disabled] { opacity: 0.55; cursor: default; }
    .mit { display: flex; align-items: center; cursor: pointer; }
    .mit input { accent-color: var(--leit); width: 1.15rem; height: 1.15rem; }
    .doppel { position: relative; flex: 2 1 12rem; height: 2.4rem; }
    .doppel input[type='range'] {
      position: absolute; left: 0; right: 0; top: 50%; transform: translateY(-50%);
      width: 100%; margin: 0; pointer-events: none; background: transparent; flex: none;
      z-index: 1;
    }
    /* Die Fahnen liegen UEBER der Bahn des Hauptreglers — der steht zuletzt
       im Baum und malte sonst darueber („rot und grün ist immer noch hinter
       dem balken"). Klicks fallen trotzdem durch: pointer-events greift nur
       am Griff. */
    .doppel input.deckel, .doppel input.fahne { z-index: 2; }
    .doppel input[type='range']::-webkit-slider-thumb { pointer-events: auto; }
    .doppel input[type='range']::-moz-range-thumb { pointer-events: auto; }
    /* Die Fahnen (Deckel rot, Einschalt gruen) zeichnen ihre Griffe SELBST:
       als ueberlagerte Regler lagen die nativen Griffe halb hinter der Bahn
       des obersten und wirkten hohl („der rote bollen und grüne ist nicht
       gefüllt"). Eigene Bahn unsichtbar, Griff als gefuellter Punkt. */
    .doppel input.deckel, .doppel input.fahne { -webkit-appearance: none; appearance: none; }
    .doppel input.deckel::-webkit-slider-runnable-track,
    .doppel input.fahne::-webkit-slider-runnable-track { height: 0; background: transparent; }
    .doppel input.deckel::-moz-range-track,
    .doppel input.fahne::-moz-range-track { height: 0; background: transparent; }
    /* DIE FAHNEN VERLASSEN DIE BAHN („der grüne schieber kann hinter dem
       blauen verschwinden und ist nicht mehr trennbar"): Rot haengt als
       Faehnchen UEBER der Bahn, Gruen DARUNTER, der Hauptgriff bleibt allein
       darauf — bei gleichem Wert verdeckt nichts mehr etwas. */
    .doppel input.deckel::-webkit-slider-thumb, .doppel input.fahne::-webkit-slider-thumb {
      -webkit-appearance: none; appearance: none;
      width: 12px; height: 12px;
      border: 2px solid var(--flaeche); pointer-events: auto;
    }
    .doppel input.deckel::-webkit-slider-thumb {
      margin-top: -19px; border-radius: 4px 4px 50% 50%;
    }
    .doppel input.fahne::-webkit-slider-thumb {
      margin-top: 7px; border-radius: 50% 50% 4px 4px;
    }
    .doppel input.deckel::-moz-range-thumb, .doppel input.fahne::-moz-range-thumb {
      width: 12px; height: 12px;
      border: 2px solid var(--flaeche); pointer-events: auto;
    }
    .doppel input.deckel::-moz-range-thumb {
      transform: translateY(-13px); border-radius: 4px 4px 50% 50%;
    }
    .doppel input.fahne::-moz-range-thumb {
      transform: translateY(13px); border-radius: 50% 50% 4px 4px;
    }
    .doppel input.deckel::-webkit-slider-thumb { background: var(--fehler); }
    .doppel input.fahne::-webkit-slider-thumb { background: var(--gut); }
    .doppel input.deckel::-moz-range-thumb { background: var(--fehler); }
    .doppel input.fahne::-moz-range-thumb { background: var(--gut); }
    .gesamt { border-color: var(--leit); }
    .gesamt .mit { font-size: 1.1rem; cursor: default; }
    .gesamt-erklaerung {
      display: flex; gap: 0.9rem; flex-wrap: wrap; margin-top: 0.2rem;
      font-size: 0.95rem; color: var(--gedaempft);
    }
    .gesamt-erklaerung .rot { color: var(--fehler); font-weight: 600; }
    .gesamt-erklaerung .gruen { color: var(--gut); font-weight: 600; }
    .pegel { display: grid; gap: 0.7rem; }
    .pegel-zeile {
      display: flex; gap: 0.9rem; align-items: center; flex-wrap: wrap;
      background: var(--grund); border: 1px solid var(--rand); border-radius: 10px;
      padding: 0.6rem 0.85rem;
    }
    .pegel-wer { flex: 1 1 14rem; min-width: 0; }
    .pegel-name { font-weight: 500; }
    .pegel-roh { color: var(--gedaempft); font-size: 0.8rem; }
    input[type='range'] { flex: 2 1 12rem; accent-color: var(--leit); }
    .pegel-wert { width: 3.2rem; text-align: right; font-variant-numeric: tabular-nums; }
    .versatz { display: flex; gap: 0.35rem; align-items: center; }
    .versatz input {
      font: inherit; width: 4.6rem; padding: 0.3rem 0.4rem; border-radius: 8px;
      border: 1px solid var(--rand); background: var(--flaeche); color: var(--schrift);
      text-align: right;
    }
    .eq { display: grid; gap: 0.55rem; }
    .eq-zeile { display: flex; gap: 0.9rem; align-items: center; flex-wrap: wrap; }
    .eq-wer { flex: 0 0 9.5rem; }
    .eq-freq { color: var(--gedaempft); font-size: 0.8rem; }
    .eq-wert { width: 3.6rem; text-align: right; font-variant-numeric: tabular-nums; }
    .schalter { display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.7rem; }
    .schalter input { accent-color: var(--leit); }
    .feld { margin-bottom: 0.9rem; }
    .feld label { display: block; font-weight: 500; margin-bottom: 0.25rem; }
    .feld input, .feld select {
      font: inherit; padding: 0.45rem 0.6rem; border-radius: 8px; max-width: 100%;
      border: 1px solid var(--rand); background: var(--grund); color: var(--schrift);
    }
    .feld .hinweis { color: var(--gedaempft); font-size: 0.85rem; margin-top: 0.25rem; }
    .klangwahl { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; }
    .klangwahl button {
      font: inherit; padding: 0.45rem 0.8rem; border-radius: 8px; cursor: pointer;
      border: 1px solid var(--rand); background: var(--grund); color: var(--schrift);
    }
    .klangwahl button[disabled] { opacity: 0.55; cursor: default; }
    .knoepfe { display: flex; gap: 0.6rem; }
    .knoepfe button {
      font: inherit; padding: 0.5rem 0.9rem; border-radius: 10px; cursor: pointer;
      border: 1px solid var(--rand); background: var(--grund); color: var(--schrift);
    }
    .knoepfe button.leit { border-color: var(--leit); font-weight: 600; }
    .knoepfe button[disabled] { opacity: 0.55; cursor: default; }
    .klein { color: var(--gedaempft); font-size: 0.88rem; }
    .meldung { padding: 0.75rem 0.9rem; border-radius: 10px; margin-bottom: 1rem; font-size: 0.9rem; }
    .meldung.fehler { background: color-mix(in srgb, var(--fehler) 18%, transparent); color: var(--fehler); }
    .meldung.gut { background: color-mix(in srgb, var(--gut) 16%, transparent); color: var(--gut); }
  `,
  template: `
    <h1>Ton</h1>
    <p class="unter">
      Wohin der Ton geht, wie laut, und wie er klingt. Koppeln und Verbinden
      von Lautsprechern wohnt auf der Seite Bluetooth; hier wird gehört.
    </p>

    @if (fehler(); as f) {
      <div class="meldung fehler">{{ f }}</div>
    }
    @if (getan(); as g) {
      <div class="meldung gut">{{ g }}</div>
    }

    @if (ton(); as t) {
      <div class="karte">
        <h2 style="margin-top:0">Ausgaben</h2>
        <div class="pegel">
          @if (gesamt(); as ges) {
            <div class="pegel-zeile gesamt">
              <span class="mit" title="alle zusammen">📢</span>
              <div class="pegel-wer">
                <div class="pegel-name">Alle zusammen</div>
                <div class="gesamt-erklaerung">
                  <span>stellt alle spielenden Ausgaben gemeinsam</span>
                  @if (hoechste() !== null) {
                    <span class="rot">● Grenze: {{ hoechste() }} %</span>
                  }
                  @if (einschalt() !== null) {
                    <span class="gruen">● Startlautstärke: {{ einschalt() }} %</span>
                  }
                </div>
              </div>
              <span class="doppel">
                @if (einschalt() !== null) {
                  <input
                    type="range"
                    class="fahne"
                    min="0"
                    max="125"
                    step="5"
                    [value]="einschalt()"
                    [title]="'Einschalt-Lautstärke: ' + einschalt() + ' % — startet die Box damit (höchstens bis zur roten Grenze)'"
                    (change)="einschaltSetzen($any($event.target).value)"
                  />
                }
                @if (hoechste() !== null) {
                  <input
                    type="range"
                    class="deckel"
                    min="0"
                    max="125"
                    step="5"
                    [value]="hoechste()"
                    [title]="'Höchstgrenze: ' + hoechste() + ' % — lauter geht die Box nie; beim Verschieben wandern Lautstärke und grüne Fahne im Verhältnis mit'"
                    (change)="hoechsteSetzen($any($event.target).value)"
                  />
                }
                <input
                  type="range"
                  min="0"
                  max="125"
                  step="5"
                  [value]="ges.prozent ?? 0"
                  [title]="'Gesamtlautstärke: ' + (ges.prozent ?? 0) + ' % — höchstens bis zur roten Grenze'"
                  (change)="senkePegel(ges, $any($event.target).value)"
                />
              </span>
              <span class="pegel-wert">{{ ges.prozent }} %</span>
            </div>
          }
          @for (z of ausgaben(); track z.schluessel) {
            <div class="pegel-zeile">
              <label class="mit" [title]="istGewaehlt(z.schluessel) ? 'spielt' : 'spielt nicht'">
                <input
                  type="checkbox"
                  [checked]="istGewaehlt(z.schluessel)"
                  [disabled]="beschaeftigt() || (!z.verbunden && !istGewaehlt(z.schluessel))"
                  (change)="umschalten(z.schluessel)"
                />
              </label>
              <div class="pegel-wer">
                <div class="pegel-name">{{ z.name }}{{ z.verbunden ? '' : ' (getrennt)' }}</div>
                @if (z.deckel < 125) {
                  <div class="pegel-roh">Deckel {{ z.deckel }} %</div>
                }
              </div>
              <span class="doppel">
                <input
                  type="range"
                  class="deckel"
                  min="0"
                  max="125"
                  step="5"
                  [value]="z.deckel"
                  title="Höchstpegel dieser Ausgabe (Deckel)"
                  (change)="deckelSetzen(z, $any($event.target).value)"
                />
                <input
                  type="range"
                  min="0"
                  max="125"
                  step="5"
                  [value]="z.prozent ?? 0"
                  [disabled]="!z.sinkName"
                  title="Lautstärke"
                  (change)="senkePegel(z, $any($event.target).value)"
                />
              </span>
              <span class="pegel-wert">{{ z.sinkName ? z.prozent + ' %' : '–' }}</span>
              @if (z.mac) {
                <span class="versatz">
                  <input
                    type="number"
                    min="0"
                    max="1000"
                    step="10"
                    [value]="versatzVon(z.mac)"
                    (change)="versatzSetzen(z.mac, $any($event.target).value)"
                  />
                  ms Versatz
                </span>
              }
            </div>
          }
        </div>
        <p class="klein">
          Häkchen: wer spielt — mehrere zusammen spielen im Gleichlauf, eine
          getrennte gewählte Box tritt beim Verbinden von selbst bei; ein
          laufendes Lied wandert beim Umschalten mit (beim Zusammenstellen
          mehrerer Ausgaben kurzer Aussetzer). Der Regler trägt zwei Griffe: vorn die
          Lautstärke, der graue dahinter ist der Deckel — höher als er kommt
          diese Ausgabe nie, egal woher gedreht wird. Hinkt eine Box hörbar
          nach, gib ihr ein paar Millisekunden Versatz. Die Box merkt sich
          alles je Gerät.
        </p>
      </div>

      <div class="karte">
        <h2 style="margin-top:0">Wie laut — je Quelle</h2>
        @if (quellen().length === 0) {
          <p class="klein">
            Gerade spielt nichts. Sobald eine Quelle spielt (Spotify, Hörspiele,
            der Bildschirm), steht sie hier mit eigenem Regler — und die Box
            merkt sich die Wahl je Quelle für das nächste Mal.
          </p>
        } @else {
          <div class="pegel">
            @for (q of quellen(); track q.kennung) {
              <div class="pegel-zeile">
                <div class="pegel-wer">
                  <div class="pegel-name">{{ q.name }}</div>
                  @if (q.name !== q.roh) {
                    <div class="pegel-roh">{{ q.roh }}</div>
                  }
                </div>
                <input
                  type="range"
                  min="0"
                  max="125"
                  step="5"
                  [value]="q.prozent"
                  (change)="quellePegel(q, $any($event.target).value)"
                />
                <span class="pegel-wert">{{ q.prozent }} %</span>
              </div>
            }
          </div>
        }
      </div>

      @if (klang(); as k) {
        <div class="karte">
          <h2 style="margin-top:0">Klang (Equalizer)</h2>
          <div class="schalter">
            <input
              type="checkbox"
              id="eq-an"
              [checked]="k.entzerrer.an"
              (change)="eqAn($any($event.target).checked)"
            />
            <label for="eq-an">Equalizer verwenden</label>
          </div>
          <div class="eq">
            @for (b of baender; track b.schluessel) {
              <div class="eq-zeile">
                <div class="eq-wer">
                  <div class="pegel-name">{{ b.name }}</div>
                  <div class="eq-freq">{{ b.freq }}</div>
                </div>
                <input
                  type="range"
                  min="-12"
                  max="12"
                  step="1"
                  [value]="bandWert(k, b.schluessel)"
                  [disabled]="!k.entzerrer.an"
                  (change)="eqBand(b.schluessel, $any($event.target).value)"
                />
                <span class="eq-wert">{{ bandWert(k, b.schluessel) }} dB</span>
              </div>
            }
          </div>
          <p class="klein">
            Wirkt auf alles, was die Box spielt — egal auf welcher Ausgabe.
            Null ist neutral; Anheben über Null kann bei voller Lautstärke
            verzerren.
          </p>
        </div>
      }
    } @else {
      <p class="klein">Einen Moment…</p>
    }

    @if (klangwerk(); as kw) {
      @if (kw.gibt) {
        <div class="karte">
          <h2 style="margin-top:0">Klangwerk (Ton-Plugins)</h2>
          <p class="klein" style="margin-top:0">
            Sitzt <strong>vor</strong> dem Equalizer im Signalweg. Hier hängen
            Plugins Dinge ein, die der Equalizer nicht kann — vor allem die
            Stereobasis, die zwischen den Kanälen mischt.
          </p>

          <div class="kw-lage" [class.kw-aus]="!kw.an">
            <span class="kw-punkt"></span>
            <span>{{ kw.an ? 'Wirkt gerade: ' + kw.text : kwLageText(kw) }}</span>
          </div>

          @for (p of klangPlugins(); track p.kennung) {
            <div class="kw-plugin">
              <h3>{{ p.name }}</h3>
              @if (kwSkala(p.kennung, 'basis')) {
                <!-- DIE STEREOBASIS ZUM ANSEHEN. Betreiber, 21.08.2026: „der
                     player in der mitte beim stereo und die 'lautsprecher'
                     quellen wandern je nachdem auseinander".
                     Grau und fest: die ECHTEN Lautsprecher, die sich nicht
                     bewegen. Farbig und wandernd: wo der Ton HERZUKOMMEN
                     SCHEINT. Bei 0 fallen beide in der Mitte zusammen — dann
                     gibt es nur noch eine Quelle, und genau das ist Mono. -->
                <svg class="kw-buehne" viewBox="0 0 300 116" role="img"
                     [attr.aria-label]="'Stereobasis ' + kwZahl(p, 'basis') + ' Prozent'">
                  <!-- die zwei echten Lautsprecher, unbeweglich -->
                  <rect x="16" y="20" width="20" height="30" rx="3" class="kw-box" />
                  <rect x="264" y="20" width="20" height="30" rx="3" class="kw-box" />
                  <text x="26" y="64" class="kw-mini">L</text>
                  <text x="274" y="64" class="kw-mini">R</text>
                  <!-- die wahrgenommenen Quellen: sie wandern -->
                  <line [attr.x1]="kwQuelle(p, -1)" y1="35" [attr.x2]="kwQuelle(p, 1)" y2="35" class="kw-spann" />
                  <circle [attr.cx]="kwQuelle(p, -1)" cy="35" r="9" class="kw-quelle" />
                  <circle [attr.cx]="kwQuelle(p, 1)" cy="35" r="9" class="kw-quelle" />
                  <!-- der Hoerer davor: Kopf mit zwei Ohren. KEIN Bogen am
                       Kreis entlang — der zeichnet nur die Kontur nach und
                       ist im Bild nicht zu erkennen (nachgesehen). -->
                  <circle cx="150" cy="84" r="9" class="kw-kopf" />
                  <circle cx="140" cy="84" r="3" class="kw-kopf" />
                  <circle cx="160" cy="84" r="3" class="kw-kopf" />
                  <text x="150" y="110" class="kw-mini kw-mitte">du</text>
                </svg>
                <p class="kw-buehnentext">{{ kwBuehnenText(p) }}</p>
              }
              @if (p.zustand !== 'bereit') {
                <p class="hinweis">
                  Dieses Plugin ist gerade {{ p.zustand === 'aus' ? 'abgeschaltet' : 'nicht bereit' }}{{ p.grund ? ': ' + p.grund : '' }}.
                  Seine Regler wirken erst wieder, wenn es läuft — den Schalter dafür
                  gibt es unter Plugins.
                </p>
              }
              @for (f of p.felder; track f.schluessel) {
                <div class="feld">
                  @if (f.art === 'schalter') {
                    <label [for]="'kw-' + p.kennung + '-' + f.schluessel">{{ f.name }}</label>
                    <div class="schalter">
                      <input
                        type="checkbox"
                        [id]="'kw-' + p.kennung + '-' + f.schluessel"
                        [checked]="kwWert(p, f.schluessel) === true"
                        [disabled]="p.zustand !== 'bereit'"
                        (change)="kwSetzen(p, f.schluessel, $any($event.target).checked)"
                      />
                    </div>
                  } @else if (kwSkala(p.kennung, f.schluessel); as s) {
                    <!-- SCHIEBEREGLER MIT LIVE-WIRKUNG. Das Ziehen (input)
                         schickt eine Probe an den laufenden Filtergraphen —
                         hoerbar, ohne dass der Ton aussetzt. Erst
                         „Uebernehmen" macht daraus einen gemerkten Wert. -->
                    <label [for]="'kw-' + p.kennung + '-' + f.schluessel">
                      {{ f.name }}
                      <span class="kw-wert">{{ kwAnzeige(p, f.schluessel, s) }}</span>
                    </label>
                    <input
                      type="range"
                      [id]="'kw-' + p.kennung + '-' + f.schluessel"
                      [min]="s.min"
                      [max]="s.max"
                      [step]="s.schritt"
                      [value]="kwZahl(p, f.schluessel)"
                      [disabled]="p.zustand !== 'bereit'"
                      (input)="kwZiehen(p, f.schluessel, $any($event.target).value)"
                    />
                  } @else {
                    <label [for]="'kw-' + p.kennung + '-' + f.schluessel">{{ f.name }}</label>
                    <input
                      [id]="'kw-' + p.kennung + '-' + f.schluessel"
                      [type]="f.art === 'zahl' ? 'number' : 'text'"
                      [value]="kwWert(p, f.schluessel)"
                      [disabled]="p.zustand !== 'bereit'"
                      (change)="kwSetzen(p, f.schluessel, $any($event.target).value)"
                    />
                  }
                  @if (f.hinweis) {
                    <div class="hinweis">{{ f.hinweis }}</div>
                  }
                </div>
              }
              @if (kwGang().length > 1) {
                <!-- DER FREQUENZGANG. Keine Illustration: die Kurve wird aus
                     denselben Biquad-Formeln gerechnet, die PipeWire fuer
                     bq_* benutzt — sie zeigt, was die Kette WIRKLICH tut.
                     Die Stereobasis fehlt darin mit Absicht: sie mischt
                     zwischen den Kanaelen und hat keinen Frequenzgang. -->
                <div class="kw-gang">
                  <svg viewBox="0 0 300 120" role="img"
                       [attr.aria-label]="'Frequenzgang, Spitze ' + kwSpitzeText()">
                    <!-- Null-Linie und die ±12-dB-Marken -->
                    <line x1="0" y1="60" x2="300" y2="60" class="kw-null" />
                    <line x1="0" y1="24" x2="300" y2="24" class="kw-raster" />
                    <line x1="0" y1="96" x2="300" y2="96" class="kw-raster" />
                    <text x="4" y="21" class="kw-mini kw-links">+12</text>
                    <text x="4" y="105" class="kw-mini kw-links">-12</text>
                    <!-- die Frequenzmarken, dort wo die Regler wirken -->
                    @for (m of kwMarken; track m.hz) {
                      <line [attr.x1]="kwX(m.hz)" y1="8" [attr.x2]="kwX(m.hz)" y2="112" class="kw-raster" />
                      <text [attr.x]="kwX(m.hz)" y="118" class="kw-mini">{{ m.wort }}</text>
                    }
                    <path [attr.d]="kwPfad()" class="kw-kurve" />
                  </svg>
                </div>
                <p class="kw-pegel" [class.kw-warnung]="kwSpitze() >= 1">
                  {{ kwSpitzeText() }}
                </p>
              }
              @if (kwLiveGrund()) {
                <p class="kw-liveaus">{{ kwLiveGrund() }}</p>
              }
              <div class="knoepfe">
                <button
                  type="button"
                  [disabled]="kwSpeichert() || !kwOffen(p.kennung) || p.zustand !== 'bereit'"
                  (click)="kwSpeichern(p)"
                >
                  {{ kwSpeichert() ? 'Wird übernommen…' : 'Übernehmen' }}
                </button>
                @if (kwOffen(p.kennung)) {
                  <span class="klein">Noch nicht übernommen</span>
                }
              </div>
            </div>
          }
          <p class="klein">
            Das Übernehmen startet das Plugin neu und baut die Filterkette frisch
            auf — der Ton setzt dabei kurz aus.
          </p>
        </div>
      }
    }

    @if (tonFelder().length > 0) {
      <div class="karte">
        <h2 style="margin-top:0">Grundeinstellungen</h2>
        @for (f of grundFelder(); track f.id) {
          <div class="feld">
            <label [for]="'ton-' + f.id">{{ f.titel }}</label>
            @if (f.id === 'startKlang' || f.id === 'schlussKlang') {
              <div class="klangwahl">
                <select
                  [id]="'ton-' + f.id"
                  [value]="konfigWert(f)"
                  (change)="konfigSetzen(f, $any($event.target).value)"
                >
                  @if (!klangBekannt(f)) {
                    <option [value]="konfigWert(f)" selected>{{ konfigWert(f) || '– keiner –' }}</option>
                  }
                  @for (k of klaenge(); track k.pfad) {
                    <option [value]="k.pfad" [selected]="konfigWert(f) === k.pfad">{{ k.name }}</option>
                  }
                </select>
                <button type="button" [disabled]="!konfigWert(f)" (click)="probeHoeren(konfigWert(f))">
                  ▶ Probehören
                </button>
              </div>
            } @else if (f.art === 'auswahl') {
              <select
                [id]="'ton-' + f.id"
                [value]="konfigWert(f)"
                (change)="konfigSetzen(f, $any($event.target).value)"
              >
                @for (w of f.auswahl ?? []; track w.wert) {
                  <option [value]="w.wert" [selected]="konfigWert(f) === w.wert">{{ w.titel }}</option>
                }
              </select>
            } @else {
              <input
                [id]="'ton-' + f.id"
                type="number"
                [min]="f.min ?? null"
                [max]="f.max ?? null"
                [value]="konfigWert(f)"
                (change)="konfigSetzen(f, $any($event.target).value)"
              />
            }
            @if (f.hinweis) {
              <div class="hinweis">{{ f.hinweis }}</div>
            }
          </div>
        }
        <div class="knoepfe">
          <button
            type="button"
            class="leit"
            [disabled]="speichert() || offenAnzahl() === 0"
            (click)="konfigSpeichern()"
          >
            {{ speichert() ? 'Speichert…' : 'Speichern' }}
          </button>
          <button type="button" [disabled]="speichert() || offenAnzahl() === 0" (click)="konfigVerwerfen()">
            Verwerfen
          </button>
        </div>
      </div>
    }
  `,
})
export class TonSeite implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient)

  readonly ton = signal<Tonlage | null>(null)
  readonly senken = signal<SenkeMitPegel[]>([])
  readonly quellen = signal<Quelle[]>([])
  readonly klang = signal<KlangStand | null>(null)
  readonly fehler = signal('')
  readonly getan = signal('')
  readonly beschaeftigt = signal(false)

  // Die drei umgezogenen Felder der frueheren Ton-Sektion der
  // Konfigurationsseite — dieselbe Feldtabelle, gelesen statt nachgebaut.
  readonly tonFelder = signal<KonfigFeld[]>([])
  readonly offen = signal<Record<string, unknown>>({})
  readonly speichert = signal(false)
  /** Die Klang-Dateien der Box (sysmedia/sound) fuer Einschalt-/Ausschalt-Klang. */
  readonly klaenge = signal<{ name: string; pfad: string }[]>([])

  /* ══ KLANGWERK: DER ANMELDEPUNKT FUER TON-PLUGINS (21.08.2026) ═══════════
   *
   * Im Kopf dieser Datei stand bis heute „NOCH NICHT HIER, ABSICHTLICH".
   * Jetzt ist er da — und er sieht anders aus als geplant: es braucht KEINEN
   * eigenen Vertrags-Ausbau fuer Oberflaechen, weil ein Klang-Plugin seine
   * Regler ueber die laengst vorhandenen `felder` im Manifest anmeldet. Die
   * Seite baut daraus die Eingaben, genau wie der Plugin-Bereich es tut.
   * Fremdes JS kommt dabei nicht in die Seite — das war der Grund, warum
   * `UiExtension` gestrichen wurde, und der gilt weiter.
   */
  readonly klangwerk = signal<KlangwerkStand | null>(null)
  readonly klangPlugins = signal<KlangPlugin[]>([])
  readonly kwSpeichert = signal(false)
  /**
   * Was der Betreiber geaendert, aber noch nicht uebernommen hat —
   * je Plugin ein Beutel.
   *
   * WARUM NICHT DIREKT BEIM TIPPEN SPEICHERN: jedes Speichern startet das
   * Plugin neu und baut die Filterkette auf — der Ton setzt dabei aus. Wer
   * eine Zahl tippt, erzeugte sonst bei jeder Ziffer einen Aussetzer.
   */
  private readonly kwOffenWerte = signal<Record<string, Record<string, unknown>>>({})

  /** Anzeigereihenfolge und Beschriftung der fuenf Baender aus 61-entzerrer.conf. */
  readonly baender = [
    { schluessel: 'tief', name: 'Tiefen', freq: '100 Hz' },
    { schluessel: 'tmitte', name: 'Tiefmitten', freq: '250 Hz' },
    { schluessel: 'mitte', name: 'Mitten', freq: '1 kHz' },
    { schluessel: 'hmitte', name: 'Hochmitten', freq: '4 kHz' },
    { schluessel: 'hoch', name: 'Höhen', freq: '10 kHz' },
  ]

  private uhr: ReturnType<typeof setInterval> | null = null

  ngOnInit(): void {
    void this.laden()
    void this.felderLaden()
    void this.klangPluginsLaden()
    // ALLE FUENF SEKUNDEN NACHLADEN, solange die Seite offen ist: Quellen
    // kommen und gehen mit der Wiedergabe, und ein Regler fuer einen Strom
    // von vorhin stellte ins Leere. Still, ohne Ladeanzeige — sonst zuckte
    // die Liste unter dem Finger. Die Grundeinstellungen sind NICHT im Takt:
    // der Takt wuerde eine halb getippte Zahl unter den Fingern ersetzen.
    this.uhr = setInterval(() => {
      if (!this.beschaeftigt()) void this.laden()
    }, 5000)
  }

  ngOnDestroy(): void {
    if (this.uhr) clearInterval(this.uhr)
  }

  private async laden(): Promise<void> {
    try {
      const [t, p, k, kw] = await Promise.all([
        firstValueFrom(this.http.get<Tonlage>('/api/ton')),
        firstValueFrom(this.http.get<{ senken: SenkeMitPegel[]; quellen: Quelle[] }>('/api/ton/pegel')),
        firstValueFrom(this.http.get<KlangStand>('/api/ton/klang')),
        firstValueFrom(this.http.get<KlangwerkStand>('/api/ton/klangwerk')),
      ])
      this.ton.set(t)
      this.senken.set(p.senken)
      this.quellen.set(p.quellen)
      this.klang.set(k)
      // NUR DIE LAGE IM TAKT, nicht die Werte: die Regler stehen weiter unten
      // in `klangPlugins` und wuerden sonst alle fuenf Sekunden eine halb
      // getippte Zahl unter den Fingern ersetzen — dieselbe Falle, die bei
      // den Grundeinstellungen schon vermerkt ist.
      this.klangwerk.set(kw)
    } catch {
      // Der bisherige Stand bleibt stehen — besser eine Anzeige von eben als
      // gar keine, und der naechste Takt versucht es wieder.
    }
  }

  /**
   * Die Klang-Plugins mit ihren Reglern holen — einmal beim Oeffnen und nach
   * jedem Uebernehmen.
   *
   * DIE WERTE KOMMEN VOM SERVER, NICHT AUS DEN VORGABEN DES MANIFESTS: was
   * die Eltern eingestellt haben, steht in den Einstellungen; die `vorgabe`
   * gilt nur, solange dort nichts steht — und diese Zusammenfuehrung macht
   * der Wirt, nicht diese Seite.
   */
  private async klangPluginsLaden(): Promise<void> {
    try {
      const liste = await firstValueFrom(
        this.http.get<{
          geladen: { kennung: string; name: string; zustand: string; grund?: string; rechte: string[] }[]
        }>('/api/plugins'),
      )
      const klang = (liste.geladen ?? []).filter((p) => (p.rechte ?? []).includes('klang'))
      const fertig: KlangPlugin[] = []
      for (const p of klang) {
        const e = await firstValueFrom(
          this.http.get<{
            felder: KlangPlugin['felder']
            werte: Record<string, unknown>
          }>(`/api/plugins/${encodeURIComponent(p.kennung)}/einstellungen`),
        )
        fertig.push({
          kennung: p.kennung,
          name: p.name,
          zustand: p.zustand,
          grund: p.grund,
          felder: e.felder ?? [],
          werte: e.werte ?? {},
        })
      }
      this.klangPlugins.set(fertig)
      this.kwOffenWerte.set({})
      // EINMAL DIE KURVE HOLEN, damit sie beim Oeffnen der Seite schon da
      // steht und nicht erst nach dem ersten Reglerzug erscheint. Das setzt
      // die gespeicherten Werte live — also genau das, was ohnehin gilt, und
      // damit hoerbar nichts.
      const erstes = fertig.find((x) => x.zustand === 'bereit' && this.kwSkala(x.kennung, 'basis'))
      if (erstes) void this.kwLive(erstes)
    } catch {
      /* dann ohne den Abschnitt — er verschwindet, statt falsch dazustehen */
    }
  }

  /** Was in einem Regler steht: das Offene, sonst der gespeicherte Wert. */
  kwWert(p: KlangPlugin, schluessel: string): unknown {
    const offen = this.kwOffenWerte()[p.kennung]
    if (offen && schluessel in offen) return offen[schluessel]
    return p.werte[schluessel] ?? ''
  }

  /** Hat dieses Plugin ungespeicherte Aenderungen? */
  kwOffen(kennung: string): boolean {
    return Object.keys(this.kwOffenWerte()[kennung] ?? {}).length > 0
  }

  /**
   * Warum gerade nichts wirkt — im Klartext.
   *
   * DREI GRUENDE SIND ZU UNTERSCHEIDEN, und sie verlangen verschiedene
   * Handgriffe: nichts eingestellt (Regler bewegen), Plugin nicht bereit
   * (unter Plugins einschalten), Kette abgelehnt (Journal lesen). Ein
   * gemeinsames „inaktiv" schickte den Betreiber dreimal an die falsche
   * Stelle.
   */
  kwLageText(kw: KlangwerkStand): string {
    if (kw.plugins.length === 0) {
      const bereit = this.klangPlugins().some((p) => p.zustand === 'bereit')
      if (!bereit && this.klangPlugins().length > 0) {
        return 'Wirkt nicht — das Plugin läuft gerade nicht.'
      }
      return 'Wirkt nicht — alle Regler stehen auf Vorgabe.'
    }
    return `Angemeldet (${kw.text}), aber der Tonstapel hat die Kette nicht übernommen — siehe Journal.`
  }

  /** Eine Aenderung merken. Uebernommen wird sie erst auf Knopfdruck. */
  kwSetzen(p: KlangPlugin, schluessel: string, wert: unknown): void {
    this.kwOffenWerte.update((alle) => ({
      ...alle,
      [p.kennung]: { ...(alle[p.kennung] ?? {}), [schluessel]: wert },
    }))
  }

  /* ══ DIE SCHIEBEREGLER ════════════════════════════════════════════════════
   *
   * Betreiber, 21.08.2026: „mit reglern am besten ‚live‘ zum hören".
   *
   * DIE SKALEN STEHEN HIER UND NICHT IM MANIFEST. Der Plugin-Vertrag kennt
   * bei `zahl` kein Min/Max — und ihn dafuer zu erweitern hiesse, jedes
   * bestehende Plugin anzufassen. Fuer die BEKANNTEN Felder von mixpi-klang
   * sind die Grenzen hier hinterlegt; jedes andere Zahlenfeld bekommt wie
   * bisher ein Eingabefeld. Meldet ein Plugin spaeter eigene Grenzen an,
   * gehoert diese Tabelle ersetzt, nicht erweitert.
   */
  private readonly skalen: Record<string, { min: number; max: number; schritt: number; einheit: string }> = {
    basis: { min: 0, max: 100, schritt: 5, einheit: '%' },
    hochpass: { min: 0, max: 300, schritt: 10, einheit: 'Hz' },
    hoehen: { min: -12, max: 12, schritt: 1, einheit: 'dB' },
    bass: { min: -12, max: 12, schritt: 1, einheit: 'dB' },
    vorpegel: { min: -12, max: 0, schritt: 1, einheit: 'dB' },
    // Die zwei Dynamik-Regler (21.08.2026). Der Kompressor geht nur bis 8:
    // darueber wird es hoerbar gepresst, und ein Regler, dessen oberes Drittel
    // niemand benutzen soll, macht die brauchbare Spanne kleiner.
    kompressor: { min: 0, max: 8, schritt: 0.5, einheit: ':1' },
    kompSchwelle: { min: -30, max: 0, schritt: 1, einheit: 'dB' },
    begrenzer: { min: -6, max: 0, schritt: 0.5, einheit: 'dB' },
  }

  /** Die Skala eines Feldes — oder null, dann bleibt es ein Eingabefeld. */
  kwSkala(kennung: string, schluessel: string): { min: number; max: number; schritt: number; einheit: string } | null {
    if (kennung !== 'mixpi-klang') return null
    return this.skalen[schluessel] ?? null
  }

  /** Der Zahlenwert eines Reglers. */
  kwZahl(p: KlangPlugin, schluessel: string): number {
    const w = Number(this.kwWert(p, schluessel))
    return Number.isFinite(w) ? w : 0
  }

  /* ══ DIE BUEHNE — STEREOBASIS ZUM ANSEHEN ═════════════════════════════════
   *
   * Betreiber, 21.08.2026: „der player in der mitte beim stereo und die
   * ‚lautsprecher‘ quellen wandern je nachdem auseinander".
   *
   * WAS SIE ZEIGT UND WARUM: eine Prozentzahl sagt nicht, was sie bewirkt.
   * Das Bild schon — die echten Lautsprecher stehen fest (grau), die
   * WAHRGENOMMENEN Quellen wandern (farbig). Bei 0 fallen sie in der Mitte
   * zusammen: dann gibt es nur noch eine Quelle, und genau das ist Mono.
   *
   * Sie haengt an denselben Werten wie der Regler, bewegt sich also beim
   * Ziehen mit — ohne eigene Logik, ohne zweiten Zustand.
   */

  /** x-Koordinate einer wahrgenommenen Quelle. seite: -1 links, +1 rechts. */
  kwQuelle(p: KlangPlugin, seite: number): number {
    const b = Math.max(0, Math.min(100, this.kwZahl(p, 'basis')))
    // 150 ist die Mitte, 124 der halbe Abstand der echten Lautsprecher.
    // Bei 100 sitzt die Quelle AUF dem Lautsprecher, bei 0 in der Mitte.
    return 150 + seite * (b / 100) * 124
  }

  /** Ein Satz unter der Buehne — was die Stellung bedeutet. */
  kwBuehnenText(p: KlangPlugin): string {
    const b = Math.round(this.kwZahl(p, 'basis'))
    if (b >= 100) return 'Volle Breite — so, wie es aufgenommen wurde.'
    if (b === 0) return 'Mono: beide Boxen geben dasselbe. Die Mitte steht fest, egal wo man sitzt.'
    if (b <= 30) return 'Fast Mono — die Mitte ist sehr stabil, die Breite fast weg.'
    return 'Die Mitte rückt zusammen und wird stabiler, etwas Breite bleibt.'
  }

  /** Was neben dem Reglernamen steht — mit Einheit, und „aus" wo es das heisst. */
  kwAnzeige(p: KlangPlugin, schluessel: string, s: { einheit: string }): string {
    const w = this.kwZahl(p, schluessel)
    if (schluessel === 'hochpass' && w < 40) return 'aus'
    if (schluessel === 'basis' && w >= 100) return 'unverändert'
    if (schluessel === 'basis' && w === 0) return 'Mono'
    // 0 heisst bei diesen dreien AUS und nicht „null Dezibel" — die Zahl
    // allein waere an der Stelle eine Falschaussage.
    if (schluessel === 'kompressor') return w < 1.5 ? 'aus' : `${w}:1`
    if (schluessel === 'begrenzer') return w === 0 ? 'aus' : `${w} dB`
    if (schluessel === 'kompSchwelle') return `ab ${w} dB`
    const vor = s.einheit === 'dB' && w > 0 ? '+' : ''
    return `${vor}${w} ${s.einheit}`
  }

  /** Warum das Live-Hoeren gerade nicht geht — leer, wenn es geht. */
  readonly kwLiveGrund = signal('')

  /* ══ FREQUENZGANG UND PEGEL ═══════════════════════════════════════════════
   *
   * Betreiber, 21.08.2026: eine Kurve, die sich beim Ziehen mitbewegt, und
   * eine Anzeige, „damit man Uebersteuern durch Anhebungen sieht statt hoert".
   *
   * GERECHNET WIRD IM SERVER, nicht hier: die Biquad-Formeln stehen in
   * klangkette.ts und sind dort geprueft. Sie hier zu wiederholen hiesse,
   * zwei Fassungen derselben Mathematik zu pflegen — und die zweite waere
   * die ungetestete. Die Kurve kommt deshalb mit der Live-Antwort mit, die
   * ohnehin bei jedem Reglerzug geholt wird.
   */
  readonly kwGang = signal<{ hz: number; dB: number }[]>([])
  readonly kwSpitze = signal(0)

  /** Wo die Regler wirken — als Orientierung im Bild. */
  readonly kwMarken = [
    { hz: 100, wort: '100' },
    { hz: 1000, wort: '1k' },
    { hz: 4000, wort: '4k' },
    { hz: 10000, wort: '10k' },
  ]

  /** Hz auf die x-Achse. Logarithmisch, 20 Hz bis 20 kHz. */
  kwX(hz: number): number {
    const von = Math.log10(20)
    const bis = Math.log10(20000)
    return ((Math.log10(Math.max(20, Math.min(20000, hz))) - von) / (bis - von)) * 300
  }

  /** dB auf die y-Achse. Mitte 60 ist 0 dB, ±12 dB sind ±36 Bildpunkte. */
  private kwY(dB: number): number {
    return 60 - Math.max(-16, Math.min(16, dB)) * 3
  }

  /** Die Kurve als SVG-Pfad. */
  kwPfad(): string {
    const g = this.kwGang()
    if (g.length < 2) return ''
    return g.map((p, i) => `${i === 0 ? 'M' : 'L'} ${this.kwX(p.hz).toFixed(1)} ${this.kwY(p.dB).toFixed(1)}`).join(' ')
  }

  /**
   * Was unter der Kurve steht.
   *
   * ERST AB +1 dB VON UEBERSTEUERN REDEN: ein Kuhschwanz mit Guete 1 hat
   * auch bei reiner ABSENKUNG einen Ueberschwinger von etwa 0,44 dB (am
   * Modell nachgemessen). Wer schon darauf warnte, warnte bei jeder
   * Einstellung — und eine Warnung, die immer leuchtet, liest niemand.
   *
   * Und „KANN uebersteuern", nicht „uebersteuert": ueber 0 dB heisst nur,
   * dass ein bereits voll ausgesteuertes Signal nun keine Luft mehr hat. Ob
   * es die je hatte, entscheidet das Stueck, nicht die Kette.
   */
  kwSpitzeText(): string {
    const s = this.kwSpitze()
    const g = Math.round(s * 10) / 10
    if (s >= 1) return `Spitze +${g} dB — kann bei lauten Stellen übersteuern. Vorpegel senken schafft Luft.`
    if (s <= -1) return `Spitze ${g} dB — reichlich Luft nach oben.`
    return `Spitze ${g > 0 ? '+' : ''}${g} dB — unkritisch.`
  }

  /**
   * Am Regler ziehen: Wert merken UND als Probe an den laufenden Graphen.
   *
   * ══ WARUM GEDROSSELT WIRD ═══════════════════════════════════════════════
   * Ein Schieberegler feuert `input` bei JEDEM Pixel. Ungebremst waeren das
   * dutzende Anfragen je Sekunde, jede mit einem Plugin-Ruf und einem
   * `pw-cli` dahinter — die Box käme nicht hinterher, und die Regler
   * ruckelten. Ein Zeitgeber von 80 ms buendelt das: es bleibt fluessig
   * (12 Schritte je Sekunde sind fuers Ohr durchgehend), und die letzte
   * Stellung geht IMMER hinaus, auch wenn sie in eine Pause faellt.
   */
  private liveUhr: ReturnType<typeof setTimeout> | null = null

  kwZiehen(p: KlangPlugin, schluessel: string, wert: string): void {
    this.kwSetzen(p, schluessel, Number(wert))
    if (this.liveUhr) clearTimeout(this.liveUhr)
    this.liveUhr = setTimeout(() => void this.kwLive(p), 80)
  }

  /** Die Probe an den laufenden Filtergraphen schicken. Wirft nie. */
  private async kwLive(p: KlangPlugin): Promise<void> {
    const werte = { ...p.werte, ...(this.kwOffenWerte()[p.kennung] ?? {}) }
    try {
      const a = await firstValueFrom(
        this.http.post<{
          ok: boolean
          live: boolean
          grund?: string
          text?: string
          gang?: { hz: number; dB: number }[]
          spitze?: number
        }>('/api/ton/klangwerk/live', { kennung: p.kennung, werte }),
      )
      this.kwLiveGrund.set(a.live ? '' : (a.grund ?? ''))
      // Kurve und Pegel kommen IMMER mit — auch wenn nicht live gestellt
      // werden konnte. Sonst stuende die Anzeige ausgerechnet beim ersten
      // Reglerzug leer, wenn das Klangwerk noch nicht laeuft.
      if (a.gang) this.kwGang.set(a.gang)
      if (typeof a.spitze === 'number') this.kwSpitze.set(a.spitze)
      if (a.live && a.text) this.klangwerk.update((alt) => (alt ? { ...alt, an: true, text: a.text as string } : alt))
    } catch {
      // Eine gescheiterte PROBE ist kein Fehler, den der Betreiber sehen
      // muss — der Regler steht trotzdem richtig, und „Übernehmen" geht
      // seinen eigenen Weg.
      this.kwLiveGrund.set('')
    }
  }

  /**
   * Die Aenderungen uebernehmen: Einstellungen setzen (das startet das Plugin
   * neu), dann die Filterkette frisch aufbauen lassen.
   *
   * DIE ZWEI SCHRITTE SIND NICHT ZU EINEM ZU MACHEN: das Setzen startet den
   * Worker neu, und ein frisch gestarteter Worker antwortet nicht sofort. Der
   * Server hat deshalb einen eigenen Weg fuer den Neuaufbau, den diese Seite
   * ruft, wenn das Speichern durch ist.
   */
  async kwSpeichern(p: KlangPlugin): Promise<void> {
    const offen = this.kwOffenWerte()[p.kennung]
    if (!offen || Object.keys(offen).length === 0) return
    this.kwSpeichert.set(true)
    this.fehler.set('')
    this.getan.set('')
    try {
      await firstValueFrom(this.http.put(`/api/plugins/${encodeURIComponent(p.kennung)}/einstellungen`, offen))
      const stand = await firstValueFrom(this.http.post<KlangwerkStand>('/api/ton/klangwerk/neu', {}))
      this.klangwerk.update((alt) => (alt ? { ...alt, ...stand } : alt))
      await this.klangPluginsLaden()
      this.getan.set(stand.an ? `Übernommen: ${stand.text}` : 'Übernommen.')
    } catch (e) {
      const g = (e as { error?: { error?: string } })?.error?.error
      this.fehler.set(g || 'Die Klang-Einstellung ließ sich nicht übernehmen.')
      await this.klangPluginsLaden()
    } finally {
      this.kwSpeichert.set(false)
    }
  }

  private async felderLaden(): Promise<void> {
    try {
      const [k, kl] = await Promise.all([
        firstValueFrom(this.http.get<{ felder: KonfigFeld[] }>('/api/konfiguration')),
        firstValueFrom(this.http.get<{ klaenge: { name: string; pfad: string }[] }>('/api/ton/klaenge')),
      ])
      this.tonFelder.set((k.felder ?? []).filter((f) => f.bereich === 'ton'))
      this.klaenge.set(kl.klaenge ?? [])
      this.offen.set({})
    } catch {
      /* dann ohne Grundeinstellungen — die Karte bleibt einfach weg */
    }
  }

  /**
   * Die Felder der Grundeinstellungen-Karte — OHNE die Hoechstlautstaerke:
   * die wohnt seit dem roten Griff auf der Gesamt-Zeile der Ausgaben-Karte
   * und stuende hier nur noch als die Doppelung, die der Betreiber gerade
   * hinausgeworfen hat.
   */
  grundFelder(): KonfigFeld[] {
    return this.tonFelder().filter((f) => f.id !== 'maxLautstaerke' && f.id !== 'startLautstaerke')
  }

  /** Die Einschalt-Lautstaerke (mupibox.startVolume) — oder null, solange die Felder fehlen. */
  einschalt(): number | null {
    const f = this.tonFelder().find((x) => x.id === 'startLautstaerke')
    if (!f) return null
    const w = Number(f.wert)
    return Number.isFinite(w) ? w : null
  }

  /** Die gruene Fahne — auch sie endet an der roten Grenze. */
  async einschaltSetzen(wert: string): Promise<void> {
    const rot = this.hoechste() ?? 100
    const prozent = Math.max(0, Math.min(100, Math.min(rot, Math.round(Number(wert) || 0))))
    this.fehler.set('')
    try {
      await firstValueFrom(
        this.http.post('/api/konfiguration', { aenderungen: { startLautstaerke: prozent } }),
      )
      this.tonFelder.update((liste) =>
        liste.map((f) => (f.id === 'startLautstaerke' ? { ...f, wert: prozent } : f)),
      )
      this.getan.set(`Lautstärke beim Einschalten: ${prozent} %.`)
    } catch (e) {
      const g = (e as { error?: { error?: string } })?.error?.error
      this.fehler.set(g || 'Die Einschalt-Lautstärke ließ sich nicht setzen.')
      await this.felderLaden()
    }
  }

  klangBekannt(f: KonfigFeld): boolean {
    return this.klaenge().some((k) => k.pfad === this.konfigWert(f))
  }

  async probeHoeren(pfad: string): Promise<void> {
    this.fehler.set('')
    try {
      await firstValueFrom(this.http.post('/api/ton/klang-probe', { pfad }))
      this.getan.set('Der Klang spielt auf der aktuellen Ausgabe.')
    } catch (e) {
      const g = (e as { error?: { error?: string } })?.error?.error
      this.fehler.set(g || 'Der Klang ließ sich nicht abspielen.')
    }
  }

  /**
   * Die Geraete der Wohin-Karte: alle GEKOPPELTEN Boxen (aus /api/ton/klang,
   * mit Namen und verbunden-Stand). Solange der Klang-Stand noch nicht
   * geladen ist, wenigstens die verbundenen aus /api/ton.
   */
  glieder(): { mac: string; name: string; an: boolean; verbunden: boolean }[] {
    const k = this.klang()
    if (k) return k.ueberall.glieder
    return (this.ton()?.verbunden ?? []).map((v) => ({ mac: v.mac, name: v.name, an: true, verbunden: true }))
  }

  /**
   * Wer gerade spielt, als Menge: 'intern' und/oder Bluetooth-Adressen.
   * Bei einem direkten Ziel genau eines; bei „Überall" die gewaehlten
   * Mitglieder aus dem Klang-Stand.
   */
  gewaehlt(): Set<string> {
    const t = this.ton()
    if (!t) return new Set()
    if (t.ziel.art === 'intern') return new Set(['intern'])
    if (t.ziel.art === 'bluetooth') return new Set([t.ziel.mac])
    const s = new Set<string>()
    const k = this.klang()
    if (k?.ueberall.intern) s.add('intern')
    for (const g of k?.ueberall.glieder ?? []) if (g.an) s.add(g.mac)
    return s
  }

  istGewaehlt(ziel: string): boolean {
    return this.gewaehlt().has(ziel)
  }

  /**
   * EIN Knopfdruck, EIN Modell (Betreiberwunsch 15.08.2026: „einfach die
   * geräte wohin auswählen … es wirkt doppelt"): die Wohin-Knoepfe sind
   * die Auswahl. Einer gewaehlt = direktes Ziel; mehrere = Überall mit
   * genau diesen Mitgliedern. Der letzte laesst sich nicht abwaehlen —
   * eine Box ohne Ausgabe waere einfach stumm.
   */
  async umschalten(ziel: string): Promise<void> {
    if (this.beschaeftigt()) return
    const t = this.ton()
    if (!t) return
    const s = new Set(this.gewaehlt())
    if (!t.ueberallDa) {
      // Ohne die Kombi-Senke gibt es kein Zusammenspiel — dann ersetzt
      // ein Tipp die Wahl, wie frueher.
      s.clear()
      s.add(ziel)
    } else if (s.has(ziel)) {
      if (s.size === 1) return
      s.delete(ziel)
    } else {
      s.add(ziel)
    }

    this.beschaeftigt.set(true)
    this.fehler.set('')
    this.getan.set('')
    try {
      if (s.size === 1) {
        const allein = [...s][0]
        const zielWert: Ziel = allein === 'intern' ? { art: 'intern' } : { art: 'bluetooth', mac: allein }
        const a = await firstValueFrom(
          this.http.post<{ ok: boolean; titel: string }>('/api/ton', { ziel: zielWert }),
        )
        // KEIN „wurde abgebrochen" MEHR (Betreiber: „stimmt nicht ganz"):
        // unter PipeWire folgen laufende Stroeme der Vorgabe — das Lied
        // wandert mit, gemessen am Geraet. Der Satz stammte aus der
        // ALSA-Zeit, in der die Abspieler neu starten mussten.
        this.getan.set(`Ton geht jetzt an: ${a.titel} — ein laufendes Lied wandert mit.`)
      } else {
        // DIE GESAMTLAUTSTAERKE REIST MIT (Betreiber 15.08.2026: „warum
        // springt der alles regler"): beim Wechsel von einem Geraet auf
        // mehrere uebernimmt die Kombi den Pegel, den man GERADE gehoert
        // hat — sonst zeigte „Alle zusammen" ploetzlich den alten
        // Kombi-Wert von frueher. (Der Neubau selbst vergisst nichts,
        // am Geraet gemessen: 60 % ueberlebten den Haekchen-Wechsel.)
        const mitgenommen = t.ziel.art !== 'ueberall' ? this.gesamt()?.prozent : undefined
        // Erst die Mitglieder angleichen (nur die Aenderungen — jede baut
        // die Kombi neu auf), dann auf „Überall" stellen.
        const k = this.klang()
        const paare: [string, boolean][] = [['intern', s.has('intern')]]
        for (const g of k?.ueberall.glieder ?? []) paare.push([g.mac, s.has(g.mac)])
        for (const [wer, an] of paare) {
          const vorher =
            wer === 'intern'
              ? (k?.ueberall.intern ?? false)
              : (k?.ueberall.glieder.find((x) => x.mac === wer)?.an ?? true)
          if (vorher !== an) await firstValueFrom(this.http.post('/api/ton/ueberall', { ziel: wer, an }))
        }
        if (t.ziel.art !== 'ueberall') {
          await firstValueFrom(this.http.post('/api/ton', { ziel: { art: 'ueberall' } }))
        }
        if (mitgenommen !== undefined) {
          // JE MITGLIED, NICHT DIE KOMBI (05.09.2026): der POST auf
          // sinkName 'ueberall' erntet seit dem 04.09. den 409 „Die Kombi
          // laesst sich nicht direkt regeln" — die Mitnahme der Lautstaerke
          // brach also GENAU an der Stelle, die sie versprach. Der Server
          // sagt selbst, was stattdessen gilt: die einzelnen Ausgaben
          // stellen, DIE halten. Eine gerade erst zugeschaltete
          // Bluetooth-Senke kann noch fehlen (Verbinden dauert) — dann
          // uebernimmt der Pegel-Nagel der Wache; hier wird nur gestellt,
          // was schon da ist, und ein Einzelfehler reisst die anderen
          // nicht mit.
          const daSenken = this.senken()
          for (const [wer, an] of paare) {
            if (!an) continue
            const senke =
              wer === 'intern'
                ? daSenken.find((x) => x.ziel.art === 'intern' && /^alsa_output\./.test(x.sinkName))
                : daSenken.find((x) => x.ziel.art === 'bluetooth' && x.ziel.mac === wer)
            if (!senke) continue
            await firstValueFrom(
              this.http.post('/api/ton/senke', { sinkName: senke.sinkName, prozent: mitgenommen }),
            ).catch(() => {})
          }
        }
        this.getan.set(
          `Es spielen jetzt ${s.size} Ausgaben zusammen — ein laufendes Lied wandert mit, beim Umbau kann es kurz aussetzen.`,
        )
      }
      await this.laden()
    } catch (e) {
      const g = (e as { error?: { error?: string } })?.error?.error
      this.fehler.set(g || 'Die Tonausgabe ließ sich nicht umstellen.')
      await this.laden()
    } finally {
      this.beschaeftigt.set(false)
    }
  }

  /**
   * Die Zeilen der Ausgaben-Karte: der eingebaute Lautsprecher und jede
   * GEKOPPELTE Box — auch getrennte (Haekchen und Deckel gelten weiter,
   * nur der Regler ruht). Pegel kommen aus den vorhandenen Senken dazu.
   */
  ausgaben(): AusgabeZeile[] {
    const senken = this.senken()
    const deckel = this.klang()?.deckel ?? {}
    // NUR DIE ECHTE KARTE, NICHT DER ERSTE intern-TREFFER (05.09.2026): die
    // Auffangregel des Servers stempelt auch klangwerk, entzerrer und die
    // Aufnahme-Senke mixpi-mitschnitt als „intern". Der erste Treffer war
    // je nach Reihenfolge die Aufnahme-Senke — ihr Regler lief dann gegen
    // eine Durchreiche und erntete den 409 („steht fest auf 100 %"), den
    // der Betreiber zu sehen bekam. Hardware erkennt man am Praefix; das
    // ist dieselbe Regel wie istHardwareSenke im Server.
    const intern = senken.find((s) => s.ziel.art === 'intern' && /^alsa_output\./.test(s.sinkName))
    const zeilen: AusgabeZeile[] = [
      {
        schluessel: 'intern',
        name: 'Eingebauter Lautsprecher (MuPiHAT)',
        verbunden: true,
        sinkName: intern?.sinkName,
        prozent: intern?.prozent,
        deckel: deckel['intern'] ?? 125,
      },
    ]
    for (const g of this.glieder()) {
      const s = senken.find((x) => x.ziel.art === 'bluetooth' && x.ziel.mac === g.mac)
      zeilen.push({
        schluessel: g.mac,
        name: g.name,
        verbunden: g.verbunden,
        sinkName: s?.sinkName,
        prozent: s?.prozent,
        deckel: deckel[g.mac] ?? 125,
        mac: g.mac,
      })
    }
    return zeilen
  }

  /**
   * Die Gesamt-Zeile „Alle zusammen": der Regler der Kombi-Senke, also der
   * MASTER ueber allen spielenden Gliedern. Nur sichtbar, wenn mehrere
   * Ausgaben spielen — bei einem direkten Ziel IST die Geraetezeile der
   * Gesamtregler, eine zweite waere wieder die Doppelung von vorhin.
   */
  gesamt(): AusgabeZeile | null {
    const t = this.ton()
    if (!t) return null
    // IMMER SICHTBAR (seit dem roten Griff): die Zeile traegt die
    // Hoechstlautstaerke der Box — die muss auch erreichbar sein, wenn nur
    // ein Geraet spielt. Der Lautstaerke-Griff stellt dann dieselbe Senke
    // wie die Geraetezeile: es IST dieselbe Gesamtlautstaerke.
    // ══ DIE REGELNDE SENKE, NICHT DIE ERSTE PASSENDE (05.09.2026) ═════════
    // `find(art === art)` nahm die erste Senke mit passender Art — und drei
    // trugen `intern`: mixpi-mitschnitt, die Karte und klangwerk. Gewonnen
    // hat die Aufnahme-Senke: sie steht immer auf 100 %, muss dort bleiben
    // (der Mitschnitt bleibt pur) und weist jeden Wert ab. Der Betreiber sah
    // genau das: „der regler ist darauf gesprungen, kurz darauf wieder 100".
    // Welche es ist, sagt jetzt der Server — eine Regel, kein zweites Raten.
    const s =
      t.ziel.art === 'ueberall'
        ? this.senken().find((x) => x.ziel.art === 'ueberall')
        : (this.senken().find((x) => x.regelnd) ??
          this.senken().find(
            (x) =>
              x.ziel.art === t.ziel.art &&
              (t.ziel.art !== 'bluetooth' || (x.ziel.art === 'bluetooth' && x.ziel.mac === t.ziel.mac)),
          ))
    if (!s) return null
    return {
      schluessel: 'gesamt',
      name: 'Alle zusammen',
      verbunden: true,
      sinkName: s.sinkName,
      prozent: s.prozent,
      deckel: 125,
    }
  }

  /** Die Hoechstlautstaerke der Box (mupibox.maxVolume) — oder null, solange die Felder fehlen. */
  hoechste(): number | null {
    const f = this.tonFelder().find((x) => x.id === 'maxLautstaerke')
    if (!f) return null
    const w = Number(f.wert)
    return Number.isFinite(w) ? w : null
  }

  /**
   * Der ROTE GRIFF der Gesamt-Zeile: die Hoechstgrenze — und seit dem
   * 15.08.2026 auch die BEZUGSGROESSE der beiden anderen („den roten als
   * 100% für den blauen machen … verschiebt sich prozentual … auch so bei
   * grün"): wandert Rot, wandern Gesamtlautstaerke und Einschalt-Fahne im
   * selben Verhaeltnis mit, ihre relative Lage zwischen Null und Rot
   * bleibt. Schreibweg unveraendert (POST /api/konfiguration; beide Felder
   * in EINEM Aufruf, damit kein halber Stand entsteht).
   */
  async hoechsteSetzen(wert: string): Promise<void> {
    const neu = Math.max(0, Math.min(100, Math.round(Number(wert) || 0)))
    const alt = this.hoechste() ?? 100
    const anteil = (w: number) => (alt > 0 ? Math.round((w * neu) / alt) : Math.min(w, neu))
    this.fehler.set('')
    try {
      const aenderungen: Record<string, number> = { maxLautstaerke: neu }
      const gruenAlt = this.einschalt()
      const gruenNeu = gruenAlt !== null ? Math.min(neu, anteil(gruenAlt)) : null
      if (gruenNeu !== null && gruenNeu !== gruenAlt) aenderungen['startLautstaerke'] = gruenNeu
      await firstValueFrom(this.http.post('/api/konfiguration', { aenderungen }))
      this.tonFelder.update((liste) =>
        liste.map((f) =>
          f.id === 'maxLautstaerke'
            ? { ...f, wert: neu }
            : f.id === 'startLautstaerke' && gruenNeu !== null
              ? { ...f, wert: gruenNeu }
              : f,
        ),
      )
      const ges = this.gesamt()
      if (ges?.sinkName && ges.prozent !== undefined) {
        const blauNeu = Math.min(neu, anteil(ges.prozent))
        if (blauNeu !== ges.prozent) await this.senkePegel(ges, String(blauNeu))
      }
      this.getan.set(`Höchste Lautstärke: ${neu} % — Lautstärke und Einschalt-Fahne sind im Verhältnis mitgewandert.`)
    } catch (e) {
      const g = (e as { error?: { error?: string } })?.error?.error
      this.fehler.set(g || 'Die Höchstlautstärke ließ sich nicht setzen.')
      await this.felderLaden()
    }
  }

  async senkePegel(z: AusgabeZeile, wert: string): Promise<void> {
    if (!z.sinkName) return
    const sinkName = z.sinkName
    // AUF DER GESAMT-ZEILE IST ROT DIE GRENZE („blau kann garnicht über
    // rot"): der Hauptgriff endet an der Hoechstgrenze, ueber sie hinaus
    // schnappt er zurueck.
    let gewuenscht = Number(wert)
    if (z.schluessel === 'gesamt') {
      const rot = this.hoechste()
      if (rot !== null) gewuenscht = Math.min(gewuenscht, rot)
    }
    this.fehler.set('')
    try {
      // Der Server klemmt auf den Deckel und nennt den WIRKLICH gesetzten
      // Pegel — der Regler zeigt danach die Wahrheit, nicht den Wunsch.
      const a = await firstValueFrom(
        this.http.post<{ ok: boolean; prozent: number }>('/api/ton/senke', {
          sinkName,
          prozent: gewuenscht,
        }),
      )
      this.senken.update((liste) =>
        liste.map((x) => (x.sinkName === sinkName ? { ...x, prozent: a.prozent } : x)),
      )
    } catch (e) {
      const g = (e as { error?: { error?: string } })?.error?.error
      this.fehler.set(g || 'Der Pegel ließ sich nicht setzen.')
      await this.laden()
    }
  }

  async deckelSetzen(z: AusgabeZeile, wert: string): Promise<void> {
    const prozent = Math.max(0, Math.min(125, Math.round(Number(wert) || 0)))
    this.fehler.set('')
    try {
      const a = await firstValueFrom(
        this.http.post<{ ok: boolean; deckel: Record<string, number> }>('/api/ton/deckel', {
          ziel: z.schluessel,
          prozent,
        }),
      )
      this.klang.update((k) => (k ? { ...k, deckel: a.deckel } : k))
      // Stand der Regler gleich mitziehen: was ueber dem Deckel lag, hat
      // der Server bereits heruntergeholt.
      if (z.sinkName && (z.prozent ?? 0) > prozent) {
        const sinkName = z.sinkName
        this.senken.update((liste) =>
          liste.map((x) => (x.sinkName === sinkName ? { ...x, prozent } : x)),
        )
      }
    } catch (e) {
      const g = (e as { error?: { error?: string } })?.error?.error
      this.fehler.set(g || 'Der Deckel ließ sich nicht setzen.')
      await this.laden()
    }
  }

  async quellePegel(q: Quelle, wert: string): Promise<void> {
    const prozent = Number(wert)
    this.fehler.set('')
    try {
      await firstValueFrom(this.http.post('/api/ton/quelle', { kennung: q.kennung, prozent }))
      this.quellen.update((liste) =>
        liste.map((x) => (x.kennung === q.kennung ? { ...x, prozent } : x)),
      )
    } catch (e) {
      const g = (e as { error?: { error?: string } })?.error?.error
      this.fehler.set(g || 'Der Pegel ließ sich nicht setzen — spielt die Quelle noch?')
      await this.laden()
    }
  }

  versatzVon(mac: string): number {
    return this.klang()?.versatz[mac.toUpperCase()] ?? 0
  }

  async versatzSetzen(mac: string, wert: string): Promise<void> {
    const ms = Math.max(0, Math.min(1000, Math.round(Number(wert) || 0)))
    this.fehler.set('')
    try {
      await firstValueFrom(this.http.post('/api/ton/versatz', { mac, ms }))
      this.klang.update((k) => {
        if (!k) return k
        const versatz = { ...k.versatz }
        if (ms === 0) delete versatz[mac.toUpperCase()]
        else versatz[mac.toUpperCase()] = ms
        return { ...k, versatz }
      })
    } catch (e) {
      const g = (e as { error?: { error?: string } })?.error?.error
      this.fehler.set(g || 'Der Versatz ließ sich nicht setzen.')
      await this.laden()
    }
  }

  bandWert(k: KlangStand, schluessel: string): number {
    return k.entzerrer.baender[schluessel] ?? 0
  }

  async eqAn(an: boolean): Promise<void> {
    this.fehler.set('')
    try {
      const a = await firstValueFrom(
        this.http.post<{ ok: boolean; entzerrer: KlangStand['entzerrer'] }>('/api/ton/entzerrer', { an }),
      )
      this.klang.update((k) => (k ? { ...k, entzerrer: a.entzerrer } : k))
      await this.laden()
    } catch (e) {
      const g = (e as { error?: { error?: string } })?.error?.error
      this.fehler.set(g || 'Der Equalizer ließ sich nicht umschalten.')
    }
  }

  async eqBand(schluessel: string, wert: string): Promise<void> {
    this.fehler.set('')
    try {
      const a = await firstValueFrom(
        this.http.post<{ ok: boolean; entzerrer: KlangStand['entzerrer'] }>('/api/ton/entzerrer', {
          baender: { [schluessel]: Number(wert) },
        }),
      )
      this.klang.update((k) => (k ? { ...k, entzerrer: a.entzerrer } : k))
    } catch (e) {
      const g = (e as { error?: { error?: string } })?.error?.error
      this.fehler.set(g || 'Das Band ließ sich nicht stellen.')
      await this.laden()
    }
  }

  async ueberallWahl(ziel: string, an: boolean): Promise<void> {
    this.fehler.set('')
    try {
      await firstValueFrom(this.http.post('/api/ton/ueberall', { ziel, an }))
      await this.laden()
    } catch (e) {
      const g = (e as { error?: { error?: string } })?.error?.error
      this.fehler.set(g || 'Die Auswahl ließ sich nicht ändern.')
      await this.laden()
    }
  }

  konfigWert(f: KonfigFeld): string {
    const o = this.offen()
    if (Object.hasOwn(o, f.id)) return String(o[f.id])
    return String(f.wert ?? '')
  }

  konfigSetzen(f: KonfigFeld, wert: string): void {
    const o = { ...this.offen() }
    if (String(f.wert ?? '') === wert) delete o[f.id]
    else o[f.id] = wert
    this.offen.set(o)
    this.getan.set('')
  }

  offenAnzahl(): number {
    return Object.keys(this.offen()).length
  }

  konfigVerwerfen(): void {
    this.offen.set({})
    this.fehler.set('')
  }

  async konfigSpeichern(): Promise<void> {
    if (this.speichert() || this.offenAnzahl() === 0) return
    this.speichert.set(true)
    this.fehler.set('')
    this.getan.set('')
    try {
      const a = await firstValueFrom(
        this.http.post<{ ok: boolean; geaendert: { titel: string }[] }>('/api/konfiguration', {
          aenderungen: this.offen(),
        }),
      )
      this.getan.set(`Gespeichert: ${a.geaendert.map((g) => g.titel).join(', ')}.`)
      await this.felderLaden()
    } catch (e) {
      const g = (e as { error?: { error?: string } })?.error?.error
      this.fehler.set(g || 'Das Speichern ist fehlgeschlagen.')
    } finally {
      this.speichert.set(false)
    }
  }
}
