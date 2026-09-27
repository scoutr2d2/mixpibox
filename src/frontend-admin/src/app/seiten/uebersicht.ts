/**
 * Startseite hinter der Anmeldung.
 *
 * Sie zeigt, was es schon gibt, und sagt offen, was noch fehlt — eine leere
 * Seite ohne Erklaerung liest sich wie ein Fehler.
 */
import { ChangeDetectionStrategy, Component } from '@angular/core'
import { RouterLink } from '@angular/router'

@Component({
  selector: 'mupi-uebersicht',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    h1 { font-size: 1.3rem; margin: 0 0 0.35rem; }
    p.unter { color: var(--gedaempft); margin: 0 0 1.5rem; }
    /* DIESELBEN VIER UEBERSCHRIFTEN WIE IN DER KOPFLEISTE, in derselben
       Reihenfolge. Vorher trug diese Seite dreizehn Kacheln in EINER anderen
       Reihenfolge als die Leiste daneben — zwei Menuebaeume ueber demselben
       Bestand, und wer den einen gelernt hatte, fand sich im anderen nicht
       zurecht. Wenn hier etwas anders heissen soll als dort, ist das ein
       Befund und keine Gestaltung. */
    h2.gruppe {
      font-size: 0.78rem; letter-spacing: 0.06em; text-transform: uppercase;
      color: var(--gedaempft); margin: 1.8rem 0 0.7rem; font-weight: 600;
    }
    h2.gruppe:first-of-type { margin-top: 0; }
    .kacheln { display: grid; gap: 0.8rem; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); }
    a.kachel {
      display: block; text-decoration: none; color: inherit;
      background: var(--flaeche); border: 1px solid var(--rand); border-radius: 12px;
      padding: 1rem 1.1rem;
    }
    a.kachel:hover { border-color: var(--leit); }
    .kachel h2 { margin: 0 0 0.3rem; font-size: 1.02rem; }
    .kachel p { margin: 0; color: var(--gedaempft); font-size: 0.9rem; }
    .rest { margin-top: 2rem; color: var(--gedaempft); font-size: 0.9rem; max-width: 42rem; }
  `,
  template: `
    <h1>Verwaltung</h1>
    <p class="unter">Was möchtest du einstellen?</p>

    <!-- DIE VIER GRUPPEN SIND DIESELBEN WIE IN DER KOPFLEISTE (05.08.2026),
         und zwar in derselben Reihenfolge und mit denselben Woertern. Vorher
         standen hier dreizehn Kacheln in einer DRITTEN Ordnung — weder die der
         Leiste noch eine erkennbare eigene. Wer eine Gliederung baut und die
         Uebersicht daneben unsortiert laesst, hat keine gebaut, sondern eine
         zweite danebengestellt.
         Die Ueberschriften sind die LEITFRAGE aus dem Wiki
         ([[admin-gliederung-leitfrage]]), auf die Seiten angewandt — nicht
         hier erfunden, sondern uebernommen. -->
    <h2 class="gruppe">Was da ist</h2>
    <div class="kacheln">
      <!-- „Doppelte" und „Interpreten" bekommen KEINE eigene Kachel: sie sind
           seit dem 03.08.2026 Unterseiten von „Medien", und zwei Kacheln, die
           auf dasselbe Ziel zeigen wie der Weg dort, waeren ein zweiter
           Menuebaum neben dem ersten. Genannt werden sie trotzdem — wer sie
           sucht, liest hier, wo sie liegen. -->
      <a class="kachel" routerLink="/medien">
        <h2>Medien</h2>
        <p>
          Alben, Hörbücher und Listen suchen, aufnehmen und ordnen — und von hier weiter
          zu Doppelten und Interpreten.
        </p>
      </a>
      <a class="kachel" routerLink="/streaming">
        <h2>Streaming-Dienste</h2>
        <p>Woher die Musik kommt: Spotify, Jellyfin — was sie können und ob sie eingerichtet sind.</p>
      </a>
    </div>

    <h2 class="gruppe">Was man sieht und hört</h2>
    <div class="kacheln">
      <a class="kachel" routerLink="/darstellung">
        <h2>Darstellung</h2>
        <p>Wie die Box aussieht: Kacheln anordnen, Startseite, Farbthema, welche Oberfläche.</p>
      </a>
      <a class="kachel" routerLink="/kinderzeit">
        <h2>Profile</h2>
        <p>Name, Bild, Geburtstag, Medien und Spielzeiten — alles zu einem Kind an einem Ort.</p>
      </a>
      <a class="kachel" routerLink="/vorlesen">
        <h2>Vorlesen</h2>
        <p>Ob und mit welcher Stimme die Box vorliest.</p>
      </a>
    </div>

    <h2 class="gruppe">Was die Box ist</h2>
    <div class="kacheln">
      <!-- OHNE „Farbthema" (nachgezogen 03.08.2026): das Feld ist mit G5 auf
           die Darstellungsseite gewandert. Die Kachel hier ist der Wegweiser,
           den man VOR dem Suchen liest — sie darf als einzige nicht auf einen
           Ort zeigen, an dem nichts mehr steht. -->
      <a class="kachel" routerLink="/konfiguration">
        <h2>Konfiguration</h2>
        <p>Name, Lautstärke, Zeitschaltungen, Anmeldung, Sperren.</p>
      </a>
      <a class="kachel" routerLink="/netzwerk">
        <h2>Netzwerk</h2>
        <p>WLAN-Verbindung, gespeicherte Netze, Adresse der Box.</p>
      </a>
      <a class="kachel" routerLink="/bluetooth">
        <h2>Bluetooth</h2>
        <p>Lautsprecher und Kopfhörer suchen, koppeln und verbinden.</p>
      </a>
      <a class="kachel" routerLink="/mupihat">
        <h2>MuPiHAT</h2>
        <p>Ladeteil und Akku: Zustand, Kurve, Diagnose.</p>
      </a>
    </div>

    <h2 class="gruppe">Wenn etwas klemmt</h2>
    <div class="kacheln">
      <!-- „Systemdienste", nicht „Dienste". Der Menuepunkt und der Titel der
           Seite heissen seit dem 03.08.2026 so; blieb es hier bei „Dienste",
           war der genaue Name genau an der Stelle verschwunden, an der man
           ihn zuerst liest — und die Suche gab auf „dienste" einen VOLLtreffer
           auf diese Kachel aus, der nach „/" fuehrte, waehrend die gemeinte
           Seite auf Rang fuenf stand. -->
      <a class="kachel" routerLink="/dienste">
        <h2>Systemdienste</h2>
        <p>Was auf der Box läuft: starten, anhalten, beim Hochfahren mitnehmen.</p>
      </a>
      <!-- NACHGEZOGEN 03.08.2026, gleich zweifach: „Medien einlesen" ist auf
           die Medienseite gewandert, und „Anzeige neu starten" stand hier
           schon vorher falsch — den Knopf gibt es bewusst nicht (er toetet X
           und holt es nicht zurueck, siehe backend-api/src/system.ts). Eine
           Kachel, die etwas verspricht, was die Seite nicht hat, schickt genau
           die Leute weg, die sie lesen. -->
      <a class="kachel" routerLink="/system">
        <h2>System</h2>
        <p>Zustand der Box, Systemeinstellungen, Oberfläche neu laden, aus- und einschalten.</p>
      </a>
      <a class="kachel" routerLink="/protokolle">
        <h2>Protokolle</h2>
        <p>Wenn etwas nicht geht: hier steht, was die Box zuletzt gemeldet hat.</p>
      </a>
      <a class="kachel" routerLink="/aktualisierung">
        <h2>Aktualisierung</h2>
        <p>Was läuft hier, woher kam es, und gibt es etwas Neueres?</p>
      </a>
    </div>

    <!-- PRAEZISIERT am 03.08.2026: „Anmeldungen bei Spotify und Jellyfin laufen
         nicht hier" stimmte so nicht mehr. Jellyfin wird vollständig hier
         eingerichtet (Server und Schlüssel stehen unter „Streaming-Dienste"),
         und nur die SPOTIFY-Anmeldung braucht wirklich den Browser der Box:
         Spotify nimmt eine Rückleitung nur über https an, und https liegt auf
         einem anderen Port als diese Verwaltung. -->
    <p class="rest">
      Nur die <strong>Anmeldung bei Spotify</strong> läuft nicht hier, sondern auf der
      Box selbst — dort unter „Einstellungen“, weil Spotify eine Rückleitung über
      https verlangt. Alles andere zu den Quellen steht unter „Streaming-Dienste“.
    </p>
  `,
})
export class UebersichtSeite {}
