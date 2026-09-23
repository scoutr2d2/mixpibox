"""
Controller core: transport to the agent (pair / run / stream / abort / shutdown).
Pure stdlib (urllib) so it's dependency-light and reusable by both the CLI and the
Textual TUI. The recipe loader (stepctl.py) uses PyYAML; this transport does not.
"""
import json
import urllib.request
import urllib.error


class AgentError(Exception):
    pass


class Agent:
    def __init__(self, base="http://127.0.0.1:8099"):
        self.base = base.rstrip("/")
        self.token = None

    def _req(self, method, path, body=None, stream=False, timeout=None):
        url = self.base + path
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        if self.token:
            req.add_header("Authorization", f"Bearer {self.token}")
        try:
            resp = urllib.request.urlopen(req, timeout=timeout)
        except urllib.error.HTTPError as e:
            raise AgentError(f"{e.code} {e.read().decode(errors='replace')}")
        except urllib.error.URLError as e:
            raise AgentError(f"connect failed: {e.reason} (agent up? tunnel open?)")
        except OSError as e:      # z.B. ConnectionResetError — kein Traceback dafuer
            raise AgentError(f"Verbindung abgebrochen: {e} (Agent gerade neu gestartet? Tunnel tot?)")
        if stream:
            return resp
        return json.loads(resp.read() or b"{}")

    # ---- API ---------------------------------------------------------------
    def pair(self, code):
        self.token = self._req("POST", "/pair", {"code": str(code)})["token"]
        return self.token

    def status(self):
        return self._req("GET", "/status")

    def run(self, step_id, cmd, timeout=None, schritt=None):
        """Einen Schritt fahren.

        `schritt` ist optional: {"nummer": 5, "gesamt": 30, "titel": "…"}. Es
        steuert NICHTS, sondern landet auf dem Bildschirm der Box — wer davor
        sitzt, sieht sonst 10 bis 20 Minuten lang nicht, ob noch etwas
        passiert. Die Gesamtzahl kennt nur diese Seite: das Rezept liegt beim
        Controller, der Agent sieht immer nur den naechsten Befehl.
        """
        rumpf = {"id": step_id, "cmd": cmd, "timeout": timeout}
        if schritt:
            rumpf["schritt"] = schritt
        return self._req("POST", "/run", rumpf)["run_id"]

    def abort(self, run_id):
        return self._req("POST", f"/abort/{run_id}")

    def search(self, query):
        """Look up a package on the target (search / versions / candidates)."""
        return self._req("POST", "/search", {"query": query})["results"]

    def perf(self):
        """Read-only boot/runtime snapshot for analysis + targeted optimization."""
        return self._req("GET", "/perf")["perf"]

    def config(self, paths=None):
        """Read (secret-redacted) config files for targeted analysis."""
        return self._req("POST", "/config", {"paths": paths})["config"]

    def sysinfo(self):
        """Detected environment (distro codename, DietPi version, boot/dietpi dirs, model)."""
        return self._req("GET", "/sysinfo")["sysinfo"]

    def put(self, local_path, remote_path, mode=None):
        """Eine Datei auf die Box legen (fuer eigene Pakete wie deploy.zip).
        Die Box muss dafuer NICHTS aus dem Netz holen."""
        import base64
        with open(local_path, "rb") as f:
            data = f.read()
        r = self._req("POST", "/put", {"path": remote_path,
                                       "b64": base64.b64encode(data).decode(),
                                       "mode": mode})
        if r.get("error"):
            raise AgentError(r["error"])
        return r

    def diagnose(self, run_id=None):
        """Read-only post-mortem evidence for diagnosing a failure (known OR unknown):
        the failed run's output tail + generic system probes (broken pkgs, failed units,
        disk/mem, journal/kernel errors, apt lock, DNS). Secret-redacted."""
        return self._req("POST", "/diagnose", {"run_id": run_id})["diag"]

    def shutdown(self, remove=False):
        return self._req("POST", "/shutdown", {"remove": bool(remove)})

    def stream(self, run_id, on_line):
        """Read the SSE stream; call on_line(text) per output line; return the
        final result dict {exit, aborted, timedout}."""
        resp = self._req("GET", f"/stream/{run_id}", stream=True)
        event = None
        result = {"exit": None, "aborted": False, "timedout": False}
        for raw in resp:
            line = raw.decode(errors="replace").rstrip("\n")
            if line.startswith("event:"):
                event = line.split(":", 1)[1].strip()
            elif line.startswith("data:"):
                try:
                    payload = json.loads(line.split(":", 1)[1].strip())
                except Exception:
                    continue
                if event == "done":
                    result.update(payload)
                    break
                if "line" in payload:
                    on_line(payload["line"])
            elif line == "":
                event = None
        return result


def repo_root():
    import os
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def list_recipes():
    import os
    d = os.path.join(repo_root(), "recipes")
    if not os.path.isdir(d):
        return []
    return sorted(os.path.splitext(f)[0] for f in os.listdir(d) if f.endswith((".yaml", ".yml")))


def resolve_recipe(spec):
    """Eine Recipe finden, EGAL wie sie angegeben wurde: absolut, relativ zum
    Arbeitsverzeichnis, relativ zum Repo, in recipes/, oder einfach der Name
    ('demo'). Sonst scheitert es je nachdem, aus welchem Verzeichnis man startet —
    genau die Falle, die die ./-Starter sonst wieder aufmachen würden."""
    import os
    if not spec:
        raise FileNotFoundError("keine Recipe angegeben (--recipe)")
    root = repo_root()
    base = os.path.basename(spec)
    stem = os.path.splitext(base)[0]
    cands = [spec, os.path.join(root, spec), os.path.join(root, "recipes", base)]
    cands += [os.path.join(root, "recipes", stem + ext) for ext in (".yaml", ".yml")]
    for c in cands:
        if os.path.isfile(c):
            return c
    have = list_recipes()
    raise FileNotFoundError(
        f"Recipe '{spec}' nicht gefunden.\n"
        + (f"  Vorhanden: {', '.join(have)}\n  z.B.:  --recipe {have[0]}\n" if have
           else "  (im Ordner recipes/ liegt keine .yaml)\n"))


def boxen():
    """Das Inventar aus `boxen.yaml` im Repo lesen → Liste der Boxen.

    Bis dahin stand nirgends im Repo, WELCHE Boxen es gibt: die beiden Adressen
    lebten im Kopf und in der Shell-History. Fehlt die Datei (oder PyYAML), kommt
    eine leere Liste zurück und alles läuft wie vorher — ein Inventar ist eine
    Erleichterung, keine Voraussetzung.

    (PyYAML wird bewusst erst hier drin importiert: der Transport oben bleibt
    reine Standardbibliothek.)"""
    import os
    p = os.path.join(repo_root(), "boxen.yaml")
    if not os.path.isfile(p):
        return []
    try:
        import yaml
        with open(p) as f:
            daten = yaml.safe_load(f) or {}
    except Exception:
        return []
    return [b for b in (daten.get("boxen") or []) if isinstance(b, dict)]


def box_finden(modell=None, name=None):
    """Welche Box aus dem Inventar ist gemeint? → der Eintrag oder None.

    Reihenfolge: ein ausdrücklicher Name (Argument oder $RSI_BOX) schlägt alles,
    sonst entscheidet das erkannte Modell (pi4/pi5) — die beiden Boxen
    unterscheiden sich genau darin. Passen MEHRERE Einträge auf ein Modell,
    kommt None zurück: dann lieber nichts einspeisen als die falsche Box raten."""
    import os
    wunsch = str(name or os.environ.get("RSI_BOX") or "").strip().lower()
    liste = boxen()
    if wunsch:
        for b in liste:
            if str(b.get("name", "")).strip().lower() == wunsch:
                return b
        return None
    if modell:
        treffer = [b for b in liste
                   if str(b.get("modell", "")).strip().lower() == str(modell).strip().lower()]
        if len(treffer) == 1:
            return treffer[0]
    return None


def box_env(modell=None, name=None):
    """Die box-eigenen Env-Werte (z.B. MUPI_HOST) → {} wenn keine Box passt.

    Damit bekommt jede Box ihren eigenen Namen, ohne dass ein Rezept dafür
    zweimal existieren muss: der Pi 5 heisst MuPiBox, der Pi 4 MuPiBox2."""
    b = box_finden(modell, name)
    return dict(b.get("env") or {}) if b else {}


# ══ WO LIEGT DER FORK? ══════════════════════════════════════════════════════
#
# DIE HUERDE, DIE DAS AUFLOEST (gefunden 23.09.2026 beim Schreiben der
# GitHub-README): Hier stand `os.path.expanduser(fork or "~/Downloads/MuPiBox")`.
# Das ist der Pfad AUF DEM RECHNER DES BETREIBERS. Wer das Repo von GitHub
# woandershin klont und `./sdstart` drueckt, bekommt eine Karte, auf der die
# Rezeptquellen fehlen — gemeldet nur als eine Zeile im Protokoll
# („N Rezept-Quelle(n) fehlten — diese Schritte laufen ins Leere"), und die
# Box installiert sich dann halb. `MUPI_REPO` half nicht: die Variable lasen
# nur die Rezepte im ferngesteuerten Lauf, nicht dieser Weg.
#
# SECHS QUELLEN, IN DIESER REIHENFOLGE — und die erste, die WIRKLICH wie der
# Fork aussieht, gewinnt. Geraten wird nicht: jede Bewerbung wird an einem
# Merkmal geprueft, das nur der Fork hat.
#
#   1. ausdruecklich uebergeben (`fork=` bzw. `./sdstart --fork <pfad>`)
#   2. $MUPI_REPO — dieselbe Variable, die die Rezepte lesen
#   3. DER ELTERNORDNER DIESES INSTALLERS. Seit dem 08.08.2026 liegt der
#      remote-step-installer IM Fork (ZUGEZOGEN.md), also ist sein Elternordner
#      die Antwort — egal, wohin geklont wurde. Das ist der Normalfall und der
#      Grund, warum niemand mehr etwas setzen muss.
#   4. ~/Downloads/mixpibox und 5. ~/mixpibox — die Klon-Schreibweisen von
#      heute (Betreiber, 23.09.2026: „MuPiBox ist alt").
#   6. ~/Downloads/MuPiBox, der alte Standard. Bleibt, damit ein Installer, der
#      AUS dem Fork herausgezogen wurde, weiter funktioniert.
#
# WAS DAS MERKMAL IST: `config/templates/mupiboxconfig.json` plus `scripts/`
# plus `plugins/` — genau die drei Orte, aus denen `recipes/mupibox-app.yaml`
# Dateien holt. Ein Ordner, der die hat, IST der Fork; ein Ordner ohne sie
# waere eine stille Fehlerquelle.
FORK_MERKMALE = ("config/templates/mupiboxconfig.json", "scripts", "plugins")


def ist_fork(pfad):
    """Sieht dieser Ordner aus wie der MixPiBox-Fork? (rein, ohne Nebenwirkung)"""
    import os
    if not pfad or not os.path.isdir(pfad):
        return False
    return all(os.path.exists(os.path.join(pfad, m)) for m in FORK_MERKMALE)


def fork_wurzel(vorgabe=None):
    """Den Fork finden -> (pfad, woher). `woher` wird ANGEZEIGT, nicht verschwiegen.

    Gibt immer einen Pfad zurueck — notfalls den alten Standard, damit der
    Aufrufer dieselbe Fehlermeldung bekommt wie frueher statt einer neuen.
    """
    import os
    bewerber = [
        (os.path.expanduser(vorgabe) if vorgabe else "", "uebergeben"),
        (os.path.expanduser(os.environ.get("MUPI_REPO", "")), "$MUPI_REPO"),
        (os.path.dirname(repo_root()), "Elternordner des Installers"),
        # DIE BEIDEN SCHREIBWEISEN DES NAMENS. Der Ordner hiess frueher wie der
        # Ursprung (MuPiBox); wer heute von GitHub klont, bekommt `mixpibox`.
        # Betreiber, 23.09.2026: „MuPiBox ist alt." Beide bleiben stehen,
        # damit ein bestehender Rechner nicht umziehen muss.
        (os.path.expanduser("~/Downloads/mixpibox"), "~/Downloads/mixpibox"),
        (os.path.expanduser("~/mixpibox"), "~/mixpibox"),
        (os.path.expanduser("~/Downloads/MuPiBox"), "alter Standard"),
    ]
    abgelehnt = ""
    umg = os.environ.get("MUPI_REPO", "")
    if umg and not ist_fork(os.path.expanduser(umg)):
        abgelehnt = f" ($MUPI_REPO={umg} sah nicht wie der Fork aus)"
    if vorgabe and not ist_fork(os.path.expanduser(vorgabe)):
        # LAUT SAGEN, NICHT STILL UEBERGEHEN: Wer `--fork` setzt, meint es; wenn
        # der Ordner nicht wie der Fork aussieht, ist die Frage nicht „welchen
        # nehmen wir dann", sondern „warum stimmt die Vorgabe nicht".
        abgelehnt = f" (Vorgabe {os.path.expanduser(vorgabe)} sah nicht wie der Fork aus)"
    for pfad, woher in bewerber:
        if pfad and ist_fork(pfad):
            return pfad, woher + abgelehnt
    # NICHTS SIEHT WIE DER FORK AUS. Dann die ausdrueckliche Vorgabe bzw. den
    # alten Standard zurueckgeben: der Aufrufer meldet die fehlenden Quellen
    # einzeln, und das ist eine bessere Auskunft als ein Abbruch hier.
    if vorgabe:
        return os.path.expanduser(vorgabe), "uebergeben (ohne Merkmal!)"
    return os.path.expanduser("~/Downloads/MuPiBox"), "alter Standard (ohne Merkmal!)"


def expand_path(s):
    """`~`, `$VAR` UND `${VAR:-fallback}` auflösen. Letzteres kann Pythons
    expandvars nicht — es ist aber genau die Form, die ein Recipe braucht, damit ein
    Pfad ohne gesetzte Variable trotzdem sinnvoll vorbelegt ist.

    ══ `MUPI_REPO` WIRD GESUCHT, NICHT GERATEN (23.09.2026) ═══════════════════
    Die Rezepte holen ihre Dateien aus `${MUPI_REPO:-$HOME/Downloads/mixpibox}`.
    Der Ersatzwert dahinter ist der Pfad EINES Rechners — auf jedem anderen
    (und auf jedem Klon von GitHub) zeigt er ins Leere, und der Lauf stirbt erst
    im Schritt, der die Datei hochladen soll. Vorher half nur, die Variable von
    Hand zu setzen; wer das nicht wusste, bekam „Datei nicht gefunden".

    Deshalb: ist `MUPI_REPO` nicht gesetzt, fragt diese Stelle denselben Finder,
    den auch der SD-Assistent benutzt (`fork_wurzel`) — Elternordner des
    Installers, `~/Downloads/mixpibox`, `~/mixpibox`, alter Standard. Genommen
    wird der erste Ordner, der WIRKLICH wie der Fork aussieht. Damit geben der
    ferngesteuerte Lauf und die geschriebene Karte dieselbe Antwort; sie taten
    es vorher nicht.

    Der Ersatzwert im Rezept bleibt als letzte Reserve stehen: findet der Finder
    nichts, gilt wieder, was dort steht."""
    import os
    import re as _re

    def fork():
        # Der Finder prueft auch eine gesetzte Variable an den Merkmalen
        # (dieselbe Regel wie beim SD-Assistenten) — eine Variable, die auf
        # einen Ordner ohne Fork zeigt, wird uebergangen, und das steht in der
        # Meldung. GEFRAGT WIRD JEDES MAL (ein Test setzt die Variable zwischen
        # zwei Aufrufen um; ein Memo haette die erste Antwort festgehalten),
        # GESAGT wird eine Antwort nur einmal — sonst stuende die Zeile 47-mal
        # im Protokoll eines Laufs.
        pfad, woher = fork_wurzel()
        meldung = f"Fork fuer die Rezeptquellen: {pfad}  ({woher})"
        if getattr(expand_path, "_gesagt", None) != meldung:
            import sys
            print(meldung, file=sys.stderr)
            expand_path._gesagt = meldung
        return pfad if ist_fork(pfad) else None

    def sub(m):
        var, default = m.group(1), m.group(2)
        val = os.environ.get(var, "")
        if var == "MUPI_REPO":
            f = fork()
            if f:
                return f
        return val if val else os.path.expandvars(default)

    s = _re.sub(r"\$\{([A-Za-z_][A-Za-z0-9_]*):-([^}]*)\}", sub, str(s))
    # Die blanke Form (`$MUPI_REPO/…`, `${MUPI_REPO}/…`) — sie steht als Beispiel
    # in der Doku von step_puts und wurde bis zum 23.09.2026 NICHT ueber den
    # Finder aufgeloest (laufpaket.py konnte es laengst).
    if "MUPI_REPO" in s:
        f = fork()
        if f:
            s = s.replace("${MUPI_REPO}", f).replace("$MUPI_REPO", f)
    return os.path.expanduser(os.path.expandvars(s))


def _put_feld(item, *namen):
    """Ein Feld eines `put:`-Eintrags holen — DEUTSCH oder englisch benannt.

    Die Rezepte sind auf Deutsch geschrieben und tragen an mehreren Stellen
    `von:/nach:/modus:`; gelesen wurde bisher ausschliesslich `src:/dest:/mode:`.
    Ein solcher Schritt starb deshalb VOR seinem `run:` mit „put: braucht src
    und dest" — hochgeladen wurde nichts, und was der Schritt danach ausrollen
    sollte, fehlte auf der Box. Beide Schreibweisen gelten jetzt, damit kein
    Rezept dafür umgeschrieben werden muss."""
    for n in namen:
        v = item.get(n)
        if v not in (None, ""):
            return v
    return ""


def step_puts(agent, step, on_line=None):
    """Die `put:`-Liste eines Recipe-Schritts hochladen, BEVOR sein `run:` läuft.
    So installiert ein Recipe eigene Pakete (deploy.zip, Configs …), ohne dass die
    Box sie irgendwo herunterladen muss.

        - id: app
          put:
            - src: $MUPI_REPO/bin/nodejs/deploy.zip     # $VARS werden ersetzt
              dest: /tmp/deploy.zip
            - von: tools/mupihat-eingang.py             # deutsch geht genauso …
              nach: /usr/local/bin/mupibox/…            # … und relativ heisst:
              modus: "0755"                             #     relativ zum Repo
          run: unzip -o /tmp/deploy.zip -d …

    Gibt die Zahl der übertragenen Dateien zurück; fehlende Quelldateien werfen
    FileNotFoundError mit klarem Text (typisch: das andere Repo liegt woanders)."""
    import os
    say = on_line or (lambda s: None)
    n = 0
    for item in (step.get("put") or []):
        src = expand_path(_put_feld(item, "src", "von"))
        dest = str(_put_feld(item, "dest", "nach"))
        mode = _put_feld(item, "mode", "modus") or None
        if not src or not dest:
            raise ValueError(f"put: braucht von/nach (bzw. src/dest) (Schritt '{step.get('id')}')")
        if not os.path.isabs(src):
            # RELATIV HEISST: relativ zum Repo, nicht zum Arbeitsverzeichnis.
            # Sonst hängt ein Rezeptlauf davon ab, aus welchem Verzeichnis er
            # gestartet wurde — aus $HOME gestartet fand er `tools/…` nicht,
            # und der Schritt brach ab, statt die Datei zu legen. Genau die
            # Falle, die `resolve_recipe()` für die Rezepte längst zumacht.
            src = os.path.join(repo_root(), src)
        if os.path.isdir(src):
            # VERZEICHNIS: unterwegs zu einem .tgz packen und das schieben — sonst
            # muesste man Dutzende Einzeldateien auflisten (68 Skripte, 17 Themes …).
            # Der Schritt entpackt es dann selbst (tar xzf <dest>).
            import subprocess
            import tempfile
            with tempfile.NamedTemporaryFile(suffix=".tgz", delete=False) as tf:
                tmp = tf.name
            try:
                parent, name = os.path.dirname(src.rstrip("/")), os.path.basename(src.rstrip("/"))
                r = subprocess.run(["tar", "czf", tmp, "-C", parent or ".", name],
                                   capture_output=True, text=True)
                if r.returncode != 0:
                    raise ValueError(f"tar fehlgeschlagen fuer {src}: {(r.stderr or '').strip()[:200]}")
                size = os.path.getsize(tmp)
                say(f"↑ {name}/ → {dest}  ({size/1024:.0f} KB, gepackt)")
                agent.put(tmp, dest, mode)
            finally:
                try:
                    os.unlink(tmp)
                except OSError:
                    pass
            n += 1
            continue
        if not os.path.isfile(src):
            raise FileNotFoundError(
                f"Datei fuer '{step.get('id')}' nicht gefunden: {src}\n"
                f"  (relative Pfade werden gegen das Repo aufgeloest: {repo_root()})\n"
                f"  Tipp: Pfad per Umgebungsvariable setzen, z.B.  export MUPI_REPO=~/Downloads/mixpibox")
        size = os.path.getsize(src)
        say(f"↑ {os.path.basename(src)} → {dest}  ({size/1024:.0f} KB)")
        agent.put(src, dest, mode)
        n += 1
    return n


def anzeige_schritt(step, nummer=None, gesamt=None):
    """Die Beigabe fuer den Bildschirm der Box — aus einem Rezept-Schritt.

    An EINER Stelle gebaut, damit CLI und TUI dasselbe zeigen. Ohne Nummer
    kommt None zurueck: eine Anzeige „Schritt ? von ?" waere schlechter als
    gar keine, denn sie sieht nach Fehler aus."""
    if nummer is None or gesamt is None:
        return None
    return {"nummer": int(nummer), "gesamt": int(gesamt),
            "titel": str(step.get("name") or step.get("id") or "")[:60]}


def step_check(agent, step, prefix="", on_line=None, timeout=60):
    """Die Probe `check:` eines Schritts AUF DER BOX ausfuehren — nach dem `run:`.

    Ein Schritt meldete bisher genau eines: dass sein `run:` mit 0 geendet ist.
    Das ist nicht dasselbe wie „hat gewirkt" — ein `|| true`, ein leeres
    Verzeichnis, ein `daemon-reload` ohne Datei dahinter enden alle mit 0.
    Genau dafür tragen 27 Schritte ein `check:`, und genau das wurde nie
    ausgeführt; die Schritte meldeten Erfolg, ohne etwas bewirkt zu haben.

        check: "systemctl is-active mupibox-server >/dev/null"

    Der Prefix ist DERSELBE wie beim Schritt — eine Probe darf $BOOT_DIR und
    $MUPI_USER benutzen, mehrere tun es. Der eigene, knappe Timeout ist Absicht:
    eine Probe ist eine Frage, keine Arbeit, und darf einen Lauf nicht aufhalten.

    Rückgabe: True/False — oder None, wenn der Schritt keine Probe hat (dann
    bleibt es beim Ergebnis des `run:`)."""
    cmd = step.get("check")
    if not cmd or not str(cmd).strip():
        return None
    say = on_line or (lambda s: None)
    sid = str(step.get("id", "schritt")) + ":check"
    try:
        run_id = agent.run(sid, prefix + str(cmd), timeout)
        res = agent.stream(run_id, on_line=say)
    except AgentError as e:
        # Die Probe selbst kam nicht durch (Tunnel weg, Agent neu gestartet).
        # Das ist KEIN bestandener Schritt — lieber einmal zu viel nachfragen.
        say(f"Probe nicht ausfuehrbar: {e}")
        return False
    return res.get("exit") == 0 and not res.get("aborted") and not res.get("timedout")


def box_fakten(agent):
    """Schlagworte der erkannten Box für `when:` (pi4, bcm2711, trixie …).

    Die Erkennung gibt es längst (`sysinfo`), die Auswertung auch (`hardware`),
    und die TUI führt beides zusammen — die beiden CLI-Runner nie. Sie fuhren
    jeden Schritt, auch die, die ausdrücklich für die andere Box gedacht sind.

    Kommt die Erkennung nicht durch, kommt eine LEERE Menge zurück: dann läuft
    alles wie bisher, statt eine Installation stillschweigend zu halbieren —
    dieselbe Regel, die `hardware.passt()` schon für sich anwendet."""
    import os
    import sys
    hier = os.path.dirname(os.path.abspath(__file__))
    if hier not in sys.path:
        sys.path.insert(0, hier)
    try:
        import hardware
        import sysinfo
        return hardware.fakten(sysinfo.normalize(agent.sysinfo()))
    except Exception:
        return set()


def _token_file(base):
    import hashlib, os, tempfile
    return os.path.join(tempfile.gettempdir(), f"rsi-{hashlib.sha1(base.encode()).hexdigest()[:12]}.token")


def cached_agent(base, pair=None):
    """An Agent with a paired token — pair (caching the token) or load the cached one.
    rsi.py and perf.py share the same cache, so one `rsi.py pair` covers both."""
    import os
    a = Agent(base)
    tf = _token_file(base)
    if pair:
        a.pair(pair)
        with open(tf, "w") as f:
            f.write(a.token)
        os.chmod(tf, 0o600)
    elif os.path.exists(tf):
        a.token = open(tf).read().strip()
    else:
        raise AgentError("nicht verbunden — entweder  ./connect <box>  (holt Code + Tunnel selbst) "
                         "oder  --pair <CODE>  vom Agent")
    return a
