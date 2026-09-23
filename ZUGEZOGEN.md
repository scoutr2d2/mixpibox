# Zwei zugezogene Projekte — `llmwiki/` und `remote-step-installer/`

Betreiber, 08.08.2026: „ich möchte das wiki llm und auch die werkzeuge wie das
zum sd karte schreiben mit ins repository aufnehmen dass alles beisammen ist"
— und auf die Rückfrage: „ich möchte es alles in einem repo haben, wenn du
eine idee zur geschichte hast das zu behalten aber im prinzip reinkopieren."

Sie liegen deshalb **als gewöhnliche Ordner** im Baum. Wer sie öffnet, braucht
nichts weiter zu wissen; wer sie ändern oder nachziehen will, findet hier, wie
sie hereingekommen sind.

## Was von wo kam

| Ordner | Herkunft | Geschichte |
|---|---|---|
| `remote-step-installer/` | `http://git.local:3000/achim/remoteinstaller.git`, Zweig `main` | **vollständig** — alle 174 Commits |
| `llmwiki/` | `http://git.local:3000/achim/llmwiki_mupibox.git`, Zweig `main` | **gestaucht** auf einen Commit |

## Warum die eine ganz und die andere gestaucht

Es ist derselbe Grund, nur mit verschiedenem Ausgang: **Geschichte kostet
Platz, und der Preis war sehr verschieden.**

* Der Installer bringt 174 Commits über 111 Dateien mit. Sein `.git` ist
  8 MB; nach dem Hereinholen wuchs dieses Repository um **rund 1 MB** — Git
  teilt sich Objekte, wo sie gleich sind. Für so wenig gibt es keinen Grund,
  etwas wegzuwerfen.
* Das Wiki besteht aus **einer** Datei, die zählt: `pack.yaml`, 1,8 MB. Es hat
  311 Commits, und jeder davon ist im Wesentlichen eine neue Fassung dieser
  einen großen Datei. Sein `.git` ist **125 MB** — das Sechzigfache seines
  Inhalts. Vollständig hereingeholt hätte es dieses Repository von 551 auf
  etwa 680 MB gebracht, und jeder Klon hätte das mitgeladen.

Zusammen sind es jetzt **555 MB statt 551** — vier Megabyte für beides.

**DIE GESCHICHTE DES WIKIS IST NICHT WEG**, sie ist nur nicht hier. Sie steht
weiter im Ursprungs-Repository, und wer sie braucht, holt sie sich dort:

    git -C ../llmwiki_mupibox log --oneline

## Die Herkunftsrepos sind stillgelegt

**Betreiber, 10.08.2026:** „stilllegen — wir können es ja wieder aufspalten,
wenn es nötig wird; momentan gibt es nur die mupi/mixpi box, welche das Tool
verwendet."

Damit ist **dieser Baum die einzige Quelle**. `~/Downloads/remote-step-installer`
und `~/Downloads/llmwiki_mupibox` liegen noch da, werden aber nicht mehr
gepflegt: dort zu arbeiten hieße, eine zweite Wahrheit anzulegen, die
irgendwann still von dieser abweicht — genau der Zustand, den das Zusammenlegen
beenden sollte.

Beim Zusammenlegen nachgemessen (10.08.2026): das Wiki war **deckungsgleich**,
der Installer bis auf ein *leeres* `docs/`, das git ohnehin nicht führt. Beide
Herkunftsrepos standen exakt auf dem importierten Commit — es blieb nichts
liegen.

### Falls es doch wieder auseinander soll

Beide Ordner sind mit `git subtree` hereingekommen, nicht mit `cp` — deshalb
geht das jederzeit und ohne Datenverlust:

    git subtree push --prefix=remote-step-installer <url> main
    git subtree pull --prefix=llmwiki --squash <url-oder-pfad> main

`--squash` gehört beim Wiki **jedes Mal** dazu; ohne es käme die ganze
125-MB-Geschichte doch noch herein.

## Der Installer liest das Wissen jetzt aus dem Baum

Das Zusammenlegen war erst zur Hälfte wirksam: Die Ordner lagen hier, aber der
Controller zog sein Wissenspaket weiter aus dem stillgelegten Repo. **Gemessen
am 08.08.2026:**

| Wo | Fassung | Einträge |
|---|---|---|
| `llmwiki/pack.yaml` (Baum) | v160 | 583 |
| `~/.rsi/wiki/mupibox/` | v12 | 53 |
| `~/.rsi/wiki/llmwiki_mupibox/` | v5 | 45 |

Beide Zwischenspeicher waren **echte Teilmengen** des Baums — 53 von 53 und 45
von 45 stecken dort drin. Es fehlten also 530 Einträge, und keiner war neu.
Ein `rsi diagnose`, das darin sucht, findet den bekannten Fall nicht und
antwortet trotzdem „nichts bekannt".

Geändert:

* `controller/wiki.py` — `fetch` nimmt jetzt auch einen **örtlichen Pfad**
  (kopiert, nicht verknüpft: der Zwischenspeicher soll auch stehen, wenn der
  Baum gerade woanders liegt).
* `setup-controller.sh` — nimmt `llmwiki/pack.yaml` aus dem Baum, sobald es
  da ist; sonst weiter das Repo. Und der Aktualisieren-Zweig hängt nicht mehr
  an `git` — bei einer Datei hat git damit nichts zu tun.

Nachziehen von Hand geht so:

    python3 controller/wiki.py fetch ../llmwiki/pack.yaml --as mupibox

## Was das für den Alltag heißt

* **Die Werkzeuge dieses Baums fassen die zwei Ordner nicht an.** Sie messen
  `NewDesign/`, `src/` und `tools/`; die zugezogenen Projekte bringen ihre
  eigenen Prüfungen mit (`remote-step-installer/tests/`).
* **Das SD-Karten-Werkzeug** liegt bei `remote-step-installer/sdprep`
  (Kommandozeile), `sdtui` (Textoberfläche) und `sdgui` (Fenster). Alle drei
  sind Starter, die sich den passenden Python suchen; der Inhalt steht in
  `remote-step-installer/controller/`.
* **Nichts wird auf die Box ausgeliefert.** `tools/ausliefern.py` kennt fünf
  Ziele (Server, Player, www, Verwaltung, Skripte) — keines davon berührt
  diese beiden Ordner. Sie sind Werkzeug für den Schreibtisch, nicht Teil der
  Box.
