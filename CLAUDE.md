# Arbeitsablauf in diesem Baum

**Der Arbeitsablauf steht in [AGENTS.md](AGENTS.md). Lies sie jetzt, bevor du
irgendetwas anderes tust.**

Diese Datei enthält mit Absicht KEINE eigene Regel — nur den Verweis.

## Warum es zwei Dateien gibt

`AGENTS.md` ist die werkzeugübergreifende Konvention: Sie wird von mehreren
Agenten-Werkzeugen von selbst gelesen. `CLAUDE.md` liest Claude Code von
selbst. Der Inhalt gehört deshalb in die neutrale Datei, damit der
Arbeitsablauf dieses Baums nicht an einem Werkzeugnamen hängt — dasselbe
Anliegen wie beim Wissenspaket, das auch kein Modell voraussetzt.

## Warum hier nichts Inhaltliches steht

Stünde hier auch nur ein Teil der Regeln, gäbe es zwei Wahrheiten über
denselben Ablauf, und `tools/arbeitsablauf-deckung.py` müsste drei Orte
vergleichen statt zwei. Die Wache prüft deshalb `AGENTS.md` gegen den
Wissenspaket-Eintrag `arbeitsablauf-der-sitzung` — und zusätzlich, dass diese
Datei wirklich nur verweist.
