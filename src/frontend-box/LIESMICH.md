# Hier stand die alte Box-Oberfläche (gelöscht mit E118/1e, 05.09.2026)

Die Angular/Ionic-App ist mit E118 gefallen — es gibt EINE Oberfläche
(`NewDesign/`, ausgeliefert unter `/neu/`). Fundstellen für die beschlossenen
Übernahmen: `dokumentation/ALT-UEBERNAHMEN.md`; den vollen Baum trägt die
git-Historie vor dem Löschungs-Commit.

## Warum hier trotzdem zwei Dateien liegen

`src/frontend-box/src/app/now-playing.ts` (+ Spec) ist REINE Logik ohne Angular und war zum
Zeitpunkt der Löschung in einer PARALLELEN Sitzung in Arbeit (Songtext-Naht,
BACKLOG E84/B2 — uncommittete Erweiterung um fortschrittJetzt/Interpret).
Eine Löschung oder ein Umzug hätte diese Arbeit vernichtet bzw. der Sitzung
die Datei unter dem Editor weggezogen.

**Nachzügler-Regel:** Sobald die E84/B2-Arbeit committet ist, zieht die Datei
an ihren richtigen Ort (`src/backend-api/src/` oder als Modul zu
`NewDesign/`) und dieser Ordner fällt ganz. Kein Bauwerkzeug hängt mehr an
ihr (kein package.json hier = kein Workspace); das NewDesign trägt ihre
Logik längst übersetzt (Herkunfts-Kommentare in app.js nennen sie).
