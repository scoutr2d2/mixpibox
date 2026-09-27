# mixpi-gruppen — Interpreten-Gruppen mit Jev

Schlägt vor, welche Interpretennamen der Bibliothek zusammengehören — etwa
„Die Maus" (ARD, Spotify) und „Die Maus, Eva mit Gitarre, Der Elefant"
(eigener Ordner). **Zusammengelegt wird erst, wenn du es auf der Seite
Medien → Gruppen bestätigst.**

Stand 26.09.2026: gebaut und mit Zeugen geprüft. **Gegen den echten Dienst noch
nicht gefahren** — dafür braucht es einen Schlüssel mit Guthaben.

## Einrichten

1. Unter openrouter.ai einen Schlüssel anlegen (Settings → Keys) und etwas
   Guthaben aufladen. Jev kostet laut OpenRouter 0,042 $ je Million
   Eingabe-Token, die Ausgabe nichts. Ein Durchlauf über die ganze Bibliothek
   der Box (39 Paare am 26.09.2026) liegt weit unter einem Cent.
2. In der Verwaltung unter **Plugins → Interpreten-Gruppen (Jev)** einschalten
   und den Schlüssel ins Feld „OpenRouter-Schlüssel" eintragen.
3. **Verbindung prüfen** drücken. Kommt „antwortet in … ms", passt alles.

Wer statt OpenRouter direkt bei TypeSafe einen Zugang hat, stellt „Anbieter"
auf `typesafe` und trägt den TypeSafe-Schlüssel ein.

## Benutzen

**Medien → Gruppen → Jetzt vorschlagen lassen.** Der Durchlauf läuft im
Hintergrund; die Seite zeigt den Fortschritt. Danach steht je Vorschlag:

* **Unter „…" zusammenlegen** — der Name mit mehr Einträgen wird die Gruppe,
  der andere kommt dazu.
* **Nein** — der Vorschlag kommt nicht wieder (zurückholbar über
  „Abgelehnte wieder vorschlagen").

Unter **Bestehende Gruppen** löst ✕ (zweimal klicken) einen Namen wieder aus
seiner Gruppe.

Ein zweiter Durchlauf fragt nur Paare, die noch keine Antwort haben — nach
neuen Alben also nur die neuen.

## Was hinausgeht

Je Paar: die beiden Namen, ihre Dienste, die Zahl der Einträge und bis zu fünf
Titel. Keine Profile, keine Hörzeiten, keine Adressen.

## Was es noch nicht tut

Die runde Interpretenreihe der Box richtet sich weiter nach den einzelnen
Namen. Die Gruppen liegen in `config/interpreten.json` bereit; das Umstellen
der Reihe auf sie ist ein eigener Schritt.

## Prüfen

    node --test plugins/mixpi-gruppen/index.spec.mjs
    npx tsx tools/plugin-pruefen.mjs plugins/mixpi-gruppen
