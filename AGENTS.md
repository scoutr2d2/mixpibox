# Arbeitsablauf in diesem Baum

Diese Datei wird zu Beginn JEDER Sitzung gelesen. `CLAUDE.md` daneben ist nur
noch ein Verweis hierher — der Ablauf soll nicht am Namen eines Werkzeugs
haengen (Betreiber, 04.09.2026: „dann waeren wir llm unabhaengig vom
projekt"). Sie steht hier, weil es sie am 04.09.2026 noch nicht gab: Die Einzelregeln lagen alle im Wissenspaket,
ihre REIHENFOLGE aber nirgends — und eine Sitzung sprang mitten in den Code,
statt erst zu fragen, was schon bekannt ist. Der Fehler war am Ende gefunden,
aber auf dem teuren Weg, und eine Nachbarsitzung hatte dasselbe parallel
gelöst, weil beide ihr Wissen nicht geteilt haben.

Dieselben sechs Schritte stehen im Wissenspaket unter
`arbeitsablauf-der-sitzung`. Zwei Orte, eine Regel — deshalb wacht
`tools/arbeitsablauf-deckung.py` quer darüber, dass sie nicht auseinander
laufen — und prüft zusätzlich, dass `CLAUDE.md` wirklich nur verweist und
keine eigene Regel trägt. Wer hier einen Schritt ändert, ändert ihn dort mit.

---

SCHRITT 1: wiki-zuerst — Erst das Wissenspaket fragen, dann den Code

Vor jeder Untersuchung und jedem Umbau. Das Paket ist 1,4 MB YAML; mit `grep`
findet man die Zeile, aber nicht den Eintrag, zu dem sie gehört:

```bash
python3 tools/wiki-suche.py --text "<begriff>"
```

Auch `--tag`, `--kind`, `--id … --lang`. Die teuerste Minute einer Sitzung ist
die, in der jemand etwas herausfindet, das längst dort steht.

SCHRITT 2: stand-von-draussen — Das Internet fragen, wo sich draußen etwas ändert

Sinnvoll bei fremden Schnittstellen, Bibliotheksfassungen, Fehlermeldungen aus
Fremdcode, Hardware-Eigenheiten. NICHT sinnvoll bei allem, was nur in diesem
Baum gilt. Wer diesen Schritt überspringt, sagt WARUM — dieselbe Pflicht wie
in der Regel `wer-nichts-tut-muss-sagen-warum`.

SCHRITT 3: werkzeug-suchen — Vor dem Eigenbau `tools/` durchsuchen

Fast jede Handschleife gibt es schon, und meist besser als den frisch
getippten Nachbau:

```bash
ls tools/ | grep -i <sache>
python3 tools/<werkzeug>.py --help
```

SCHRITT 4: werkzeug-bauen — Fehlt eines, wird es gebaut UND gespeichert

Untersuchen heißt: eine Datei in `tools/` schreiben, die ein Zweiter
wiederverwenden kann — kein Wegwerfbefehl in der Kommandozeile. Ein neues
Werkzeug gehört in einen Läufer (meist `tools/doku-luecken-probe.sh`), sonst
rostet es unbemerkt: eine Wache, die niemand ruft, ist keine Wache.

SCHRITT 5: doku — Erst dann bauen, und das Gebaute dokumentieren

Handlungsanweisungen sind Doku, egal in welcher Datei sie stehen — auch ein
`print()` mit einem Befehl darin. Zustandsaussagen bekommen ein Datum, damit
ein späterer Leser sie nachmisst, statt ihnen zu glauben.

SCHRITT 6: wiki-nachziehen — Den Fund ins Paket, im selben Zug wie der Commit

Als Textanhang über `tools/wiki-anhaengen.py` (niemals das Paket neu
formatieren — `safe_dump` schreibt 2,5 MB um und macht den Diff unlesbar).
Danach `tools/pack-verweise.py`. Was erst „später" ins Wiki soll, kommt nie
hinein, und die nächste Sitzung sucht von vorn.

Steht im Baum schon der noch nicht committete Eintrag einer Nachbarsitzung,
nimmt `git add llmwiki/pack.yaml` ihn mit — dieselbe Falle wie `git add -A`,
nur innerhalb einer Datei. Dann `tools/pack-eintrag-vereinzeln.py <id>`: es
legt HEAD-Stand plus genau den eigenen Eintrag in den Index und lässt den
Arbeitsbaum in Ruhe.

---

## Was dabei am meisten Zeit kostet

Diese Fallen haben in diesem Baum jeweils mindestens einen halben Tag
gekostet. Die ausführliche Fassung steht im Wissenspaket.

* **Grün glauben statt gegenprüfen.** Nach jedem neuen Test die Regel
  ABSICHTLICH brechen und nachsehen, dass er rot wird. Nur auf Committetem
  sabotieren, und zurücknehmen über einen gezielten Edit — nicht über
  `git checkout` (wirft unversionierte Arbeit weg) und nicht über `cp` (eine
  Nachbarsitzung schreibt in dieselbe Datei).
* **Der Baum gehört nicht dir allein.** Es laufen mehrere Sitzungen parallel.
  Vor dem Commit `git diff --cached` lesen, nicht den Baum; `git commit` ohne
  Pfad rufen. Vor dem Ausliefern prüfen, ob auf der Box schon etwas anderes
  liegt.
* **Eine Probe hinter einer Pipe verliert ihr Urteil.** Der Exit gehört
  `tail`. Die Bilanzzeile lesen, nicht den Rückgabewert.
* **`pgrep -f` zählt den eigenen Aufruf mit.** Ein Ergebnis von genau 1 ist
  fast immer die eigene Shell — `-af` nehmen und hinsehen, oder `-x`.
* **Am Gerät messen, nicht annehmen.** Zweimal mit Abstand: der Anlauf sieht
  aus wie ein Zustand. `journalctl` mit `grep -v python3`, sonst deckt der
  MuPiHAT-Logger alle fünf Sekunden alles zu.
* **Ein Dienst, der läuft, tut nicht, was er soll.** `systemctl is-active`
  beantwortet fast nie die Frage, die man wirklich hat.

## Kleinkram, der zuverlässig beißt

* `grep` ist hier `ugrep` — bei Binärdateien schweigt es, GNU `grep` zählt
  weiter. Ein leeres Ergebnis heißt nicht „kommt nicht vor".
* Die Shell ist `fish`: `VAR=wert befehl` kommt leer an, `env VAR=wert befehl`
  nehmen.
* Commit-Nachrichten über `-F datei`, nie über `-m`: Backticks führt die
  Shell aus.
* Ein `Edit` an einem Skript nimmt das Ausführbit; danach im Index auf
  `mode change 100755 => 100644` sehen.
