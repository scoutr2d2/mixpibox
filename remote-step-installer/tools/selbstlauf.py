#!/usr/bin/env python3
"""Die Installation faehrt die BOX SELBST — ohne Laptop, gestartet vom Handy.

WOZU: Bisher lag das Rezept beim Controller auf dem Laptop, und der trieb die
Box Schritt fuer Schritt. Das ist richtig, solange jemand mit einem Rechner
davorsitzt. Wer nur ein Telefon hat, kam nicht los.

DIE UMKEHRUNG: Das Rezept wird beim Vorbereiten der SD-Karte MITGEGEBEN — als
JSON, weil auf einem frischen DietPi kein PyYAML liegt und wir es dort auch
nicht nachinstallieren wollen. Die Box hat damit alles, was der Controller
hatte, und faehrt sich selbst. Das Handy startet nur und schaut zu.

WAS DAS SCHWERE DARAN IST, UND WARUM ES HIER STEHT:

  1. DER LAUF UEBERLEBT NEUSTARTS. Das Rezept enthaelt welche (Display-
     Overlays, Kiosk, der Schlussneustart). Ein Fahrer, der beim Hochkommen
     wieder bei Schritt 1 anfaengt, macht aus einer Installation eine
     Endlosschleife. Deshalb liegt der Stand auf der Platte, NICHT im
     Arbeitsspeicher, und wird VOR jedem Schritt geschrieben — nicht danach:
     stuerzt die Box mitten im Schritt ab, darf er nicht als offen gelten und
     ewig wiederholt werden.

  2. ER SCHREIBT DENSELBEN FORTSCHRITT wie der ferngesteuerte Lauf. Schirm und
     Handy-Seite lesen ihn schon; ein zweiter Kanal waere ein zweiter Ort, an
     dem etwas auseinanderlaufen kann.

  3. EIN GESCHEITERTER SCHRITT HAELT AN, statt weiterzulaufen. Ohne Mensch
     davor ist "weiter, wird schon" der sicherste Weg zu einer Box, die
     halb eingerichtet ist und niemandem sagt, wo es klemmte. Ausnahme sind
     die als `optional` gekennzeichneten Schritte — die duerfen scheitern.

WAS ES NICHT TUT
  * Es entscheidet nichts. Workarounds, Ueberspringen, Wiederholen — all das
    kann nur ein Mensch, und wer nur ein Telefon hat, soll dafuer den
    Assistenten benutzen. Hier laeuft das Rezept, wie es geschrieben steht.
  * Es holt nichts aus dem Netz, was nicht im Rezept steht.
  * Es raeumt sich nicht selbst weg. Der Stand bleibt liegen — er ist der
    einzige Beleg, wie weit die Box gekommen ist.

AUFRUF
    sudo python3 selbstlauf.py --lauf /opt/mixpibox-lauf     # weiterfahren
    sudo python3 selbstlauf.py --lauf ... --von-vorn         # Stand verwerfen
    python3 selbstlauf.py --lauf ... --stand                 # nur nachsehen
"""
import argparse
import json
import os
import shlex
import shutil
import subprocess
import sys
import threading
import time

# Dieselbe Datei, die der Agent beim ferngesteuerten Lauf schreibt — Schirm
# und Handy-Seite lesen sie bereits.
FORTSCHRITT_ORDNER = "/run/mixpibox-einrichtung"
FORTSCHRITT_DATEI = os.path.join(FORTSCHRITT_ORDNER, "fortschritt.json")
# Der Stand dagegen MUSS einen Neustart ueberleben -> /var/lib, nicht /run.
STAND_DATEI = "/var/lib/mixpibox-lauf/stand.json"

# ══ WIE LANGE JEDER SCHRITT BRAUCHT ═════════════════════════════════════════
#
# Betreiber, 10.08.2026: „kann man die installation parallelisieren es ist schon
# sehr langsam auf dem pi" — und auf den Vorschlag, erst zu messen: „okay dann
# bringe das mit in den installer."
#
# EINE EIGENE DATEI UND KEIN FELD IM STAND. `stand_lesen()` gibt bewusst nur
# `fertig` und `gescheitert` zurueck und wirft alles andere weg; ein drittes
# Feld waere beim naechsten Schreiben still verschwunden. Und der Stand ist der
# Anker des Rueckwegs — er bleibt so schmal, wie er ist.
#
# EINE ZEILE JE SCHRITT, ANGEHAENGT. Ein Lauf ueberlebt Neustarts; eine Datei,
# die bei jedem Start neu geschrieben wuerde, haette am Ende nur die letzte
# Etappe. Angehaengt steht am Schluss der ganze Lauf da, quer ueber alle
# Neustarts — und genau den will man sehen, wenn man wissen will, wo die
# Minuten hingehen.
ZEITEN_DATEI = "/var/lib/mixpibox-lauf/zeiten.jsonl"


def zeit_vermerken(kennung, name, sekunden, code, pfad=ZEITEN_DATEI):
    """Eine Zeile ans Zeitprotokoll. Faellt sie aus, laeuft der Lauf weiter —
    eine Messung darf die Installation nie aufhalten."""
    try:
        os.makedirs(os.path.dirname(pfad), exist_ok=True)
        with open(pfad, "a", encoding="utf-8") as f:
            f.write(json.dumps({"schritt": kennung, "name": name,
                                "sekunden": round(sekunden, 1),
                                "code": code}, ensure_ascii=False) + "\n")
    except OSError:
        pass
# NICHT nach /var/log — dort raeumt DietPi auf. Am 09.08.2026 an der
# laufenden Box gesehen: um 22:13 hatte die Datei 230 KB, um 22:17 exakt 0.
# Ein Aufraeumer (dietpi-logclear/RAMlog) hatte sie MITTEN IM LAUF geleert.
# Das kostet nicht nur die Fehlersuche, es nimmt auch dem Schirm die Quelle,
# aus der er zeigt, was gerade passiert. /var/lib ueberlebt beides — dort
# liegt der Stand aus demselben Grund schon.
PROTOKOLL = "/var/lib/mixpibox-lauf/lauf.log"


def _schreibe_atomar(pfad, daten):
    os.makedirs(os.path.dirname(pfad), exist_ok=True)
    vor = pfad + ".neu"
    with open(vor, "w", encoding="utf-8") as f:
        json.dump(daten, f)
        f.flush()
        os.fsync(f.fileno())
    os.replace(vor, pfad)


def fortschritt_melden(nummer, gesamt, titel, laeuft, exit_code=None):
    """STILL bei Fehlern: ein Lauf, der an seiner Anzeige scheitert, waere ein
    Werkzeug, das an seinem Zubehoer zerbricht."""
    try:
        _schreibe_atomar(FORTSCHRITT_DATEI, {
            "nummer": nummer, "gesamt": gesamt, "titel": str(titel)[:60],
            "laeuft": laeuft, "exit": exit_code,
            "abgebrochen": False, "seit": time.time(),
        })
    except OSError:
        pass


def stand_lesen(pfad=STAND_DATEI):
    try:
        with open(pfad, encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        return {"fertig": [], "gescheitert": None}
    if not isinstance(d, dict):
        return {"fertig": [], "gescheitert": None}
    fertig = d.get("fertig")
    return {
        "fertig": [str(x) for x in fertig] if isinstance(fertig, list) else [],
        "gescheitert": d.get("gescheitert") if isinstance(d.get("gescheitert"), str) else None,
    }


def sagen(text, protokoll=None):
    """Auf den Bildschirm UND in die Datei. Ohne die Datei waere nach einem
    Neustart nicht mehr nachzuvollziehen, was vorher geschah — und genau das
    ist der Fall, in dem man es braucht.

    Der Pfad wird ERST BEIM AUFRUF gelesen, nicht als Vorgabewert gebunden:
    sonst steht die Konstante von der Importzeit fest und laesst sich nicht
    mehr umbiegen — was jeden Test zwingt, nach /var/log zu schreiben.
    """
    print(text, flush=True)
    protokoll = protokoll or PROTOKOLL
    try:
        os.makedirs(os.path.dirname(protokoll), exist_ok=True)
        with open(protokoll, "a", encoding="utf-8") as f:
            f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {text}\n")
    except OSError:
        pass


# ── Die Umgebung der Box: dieselbe Logik wie beim Controller ────────────────
class OertlicherAgent:
    """Was `sysinfo.recipe_prefix` von einem Agenten braucht — aber ohne HTTP.

    Der ferngesteuerte Weg fragt den Agenten ueber den Tunnel; hier LAUFEN wir
    auf derselben Box. Die Erkennung selbst wird nicht nachgebaut, sondern die
    Funktion des Agenten direkt aufgerufen: zwei Erkennungen, die auseinander-
    laufen koennen, waeren die naechste Fehlerquelle.
    """

    def __init__(self, agentmodul):
        self._agent = agentmodul

    def sysinfo(self):
        return self._agent.sysinfo()


def _laden(name, pfad):
    import importlib.util
    spec = importlib.util.spec_from_file_location(name, pfad)
    modul = importlib.util.module_from_spec(spec)
    sys.modules[name] = modul          # sysinfo.py importiert `core` und `model`
    spec.loader.exec_module(modul)
    return modul


def nur_rezept_prefix(rezept):
    """Der Rueckfall: wenigstens die `env:` des Rezepts setzen.

    OHNE DAS IST DER LAUF STILL KAPUTT. Scheitert die Umgebungserkennung, hatte
    die erste Fassung gar keinen Prefix — und damit auch keine Rezept-Variablen.
    Schritte, die `$MUPI_USER` oder `$MUPI_APP` benutzen, liefen dann gegen
    LEERE Werte: `rm -rf "$MUPI_APP/www"` wird so zu `rm -rf "/www"`. Der
    Controller hat diesen Rueckfall seit jeher (stepctl.env_prefix); hier
    fehlte er.
    """
    env = rezept.get("env") or {}
    if not env:
        return ""
    return "; ".join(f"export {k}={shlex.quote(str(v))}"
                     for k, v in env.items() if str(v) != "") + "; "


def umgebung_ermitteln(lauf, rezept):
    """(prefix, fakten, hardware) — mit Rueckfall auf die reinen Rezept-Werte.

    LEERE FAKTEN HEISSEN: NICHTS AUSLASSEN. Dieselbe Regel wie im Controller —
    eine gescheiterte Erkennung darf eine Installation nicht stillschweigend
    halbieren.
    """
    try:
        agentmodul = _laden("agentmod", "/opt/step-agent/agent.py")
        _laden("core", os.path.join(lauf, "core.py"))
        _laden("model", os.path.join(lauf, "model.py"))
        sysinfo = _laden("sysinfo", os.path.join(lauf, "sysinfo.py"))
        hardware = _laden("hardware", os.path.join(lauf, "hardware.py"))
    except (OSError, ImportError, AttributeError) as e:
        sagen(f"  Umgebungserkennung nicht moeglich ({e}) — es wird nichts ausgelassen.")
        return nur_rezept_prefix(rezept), set(), None
    try:
        agent = OertlicherAgent(agentmodul)
        prefix = sysinfo.recipe_prefix(agent, rezept)
        env = sysinfo.normalize(agent.sysinfo())
        fakten = set(hardware.fakten(env)) if hasattr(hardware, "fakten") else set()
        return prefix, fakten, hardware
    except Exception as e:                                   # noqa: BLE001
        sagen(f"  Umgebungserkennung unvollstaendig ({e}) — es wird nichts ausgelassen.")
        return nur_rezept_prefix(rezept), set(), None


# ── Ein Schritt ─────────────────────────────────────────────────────────────
def dateien_legen(schritt, lauf):
    """Die `put:`-Dateien an ihren Platz bringen. -> Fehlertext oder None.

    Die Quellen wurden beim Vorbereiten der Karte MITKOPIERT und im Rezept auf
    ihren dortigen Namen umgeschrieben — hier wird nichts mehr gesucht und
    nichts aus dem Netz geholt.
    """
    for p in schritt.get("put") or []:
        quelle = os.path.join(lauf, "dateien", p["ablage"])
        ziel = p["dest"]
        if not os.path.exists(quelle):
            return f"mitgegebene Datei fehlt: {p['ablage']}"
        try:
            os.makedirs(os.path.dirname(ziel.rstrip("/")) or "/", exist_ok=True)
            if os.path.isdir(quelle):
                # EIN VERZEICHNIS, DAS ALS ARCHIV ANKOMMEN SOLL, MUSS GEPACKT
                # WERDEN — der Controller tut das seit jeher unterwegs
                # (core.py: "VERZEICHNIS: unterwegs zu einem .tgz packen"),
                # und die Rezeptschritte verlassen sich darauf: sie rufen
                # `tar xzf <dest>`. Der Selbstlauf kopierte es stattdessen als
                # Verzeichnis. Am Geraet, Schritt 37 von 53:
                #     tar: /tmp/mupi-scripts.tgz: Cannot read: Is a directory
                # Dieselbe Rezeptzeile, zwei Wege, zwei Ergebnisse — genau die
                # Sorte Unterschied, die erst nach 36 gelungenen Schritten
                # auffaellt.
                if ziel.endswith((".tgz", ".tar.gz")):
                    # UNTER DEM URSPRUENGLICHEN NAMEN packen, nicht unter dem
                    # Ablagenamen: die Schritte entpacken und greifen auf
                    # "scripts/..." zu, waehrend die Ablage kollisionssicher
                    # "fdd2f0f0-scripts" heisst. Faellt die Angabe (aeltere
                    # Pakete), bleibt der Ablagename — dann scheitert es
                    # sichtbar statt still falsch zu liefern.
                    wurzel = p.get("wurzel") or os.path.basename(quelle.rstrip("/"))
                    import tempfile as _tf
                    with _tf.TemporaryDirectory() as _d:
                        _ziel_dir = os.path.join(_d, wurzel)
                        shutil.copytree(quelle, _ziel_dir)
                        r = subprocess.run(["tar", "czf", ziel, "-C", _d, wurzel],
                                           capture_output=True, text=True)
                    if r.returncode != 0:
                        return (f"{p['ablage']} -> {ziel}: tar fehlgeschlagen: "
                                f"{(r.stderr or '').strip()[:160]}")
                else:
                    # dirs_exist_ok: ein zweiter Lauf ueber dasselbe Verzeichnis
                    # ist der Normalfall (Wiederaufnahme nach Neustart).
                    shutil.copytree(quelle, ziel, dirs_exist_ok=True)
            else:
                shutil.copy2(quelle, ziel)
            if p.get("mode"):
                os.chmod(ziel, int(str(p["mode"]), 8))
        except (OSError, ValueError) as e:
            return f"{p['ablage']} -> {ziel}: {e}"
    return None


# ── ZWEI GRENZEN, UND BEIDE MUESSEN WIRKEN ────────────────────────────────
# Die Leerlaufgrenze ist das schaerfere Werkzeug: ein Schritt, der arbeitet,
# sagt etwas. Einer, der zehn Minuten lang schweigt, haengt. Die Gesamtgrenze
# faengt den Rest ab — endlose Schleifen, ein Spiegel, der nur noch tropft.
# Beide sind je Schritt ueberschreibbar (`timeout:` und `leerlauf:` im
# Rezept); eine 0 schaltet die jeweilige Grenze ab, fuer den einen Posten,
# der wirklich stundenlang stumm rechnen darf.
LEERLAUF_GRENZE = 600
GESAMT_GRENZE = 3600


def neustart_ausloesen():
    """Die Box neu starten. EINE FUNKTION, DAMIT ES EINE NAHT GIBT.

    WARUM NICHT EINFACH `subprocess.run(["reboot"])` MITTEN IM ABLAUF:
    Dieser Ablauf wird getestet, und Tests laufen auf dem RECHNER DES
    ENTWICKLERS. Der Schutz hing zuerst daran, dass der Test `subprocess.run`
    im Modul ersetzt — er griff, aber nur zufaellig: haette jemand den
    Neustart spaeter auf `os.system` oder `os.execv` umgestellt, waere beim
    naechsten Testlauf der Arbeitsrechner heruntergefahren. Der Betreiber hat
    genau danach gefragt.

    Mit dieser Funktion gibt es GENAU EINE Stelle, die ein Test stillegen
    muss, und sie heisst so, dass man sie nicht uebersieht. Was drin steht,
    darf sich aendern, ohne den Schutz zu brechen.
    """
    # NUR AUF EINER BOX, NIEMALS AUF EINEM ARBEITSRECHNER.
    # Dieses Modul wird auch importiert und getestet, und ein Test, der den
    # Rechner des Entwicklers herunterfaehrt, ist kein Test, sondern ein
    # Unfall. Die Pruefung kostet nichts und macht die ganze Fehlerklasse
    # unmoeglich — auch fuer den, der dieses Modul spaeter woanders anfasst.
    # Beide Pfade gibt es auf der Box laengst, wenn wir hier ankommen:
    # /boot/dietpi seit dem Abbild, /etc/mupibox seit dem Schritt
    # 'mupiboxconfig'.
    if not (os.path.isdir("/boot/dietpi") or os.path.isdir("/etc/mupibox")):
        sagen("  Kein MixPiBox-System — der Neustart wird NICHT ausgeloest.")
        return
    try:
        os.sync()
    except OSError:
        pass
    time.sleep(3)
    try:
        subprocess.run(["reboot"], timeout=30)
    except (OSError, subprocess.SubprocessError) as e:
        sagen(f"  Neustart liess sich nicht ausloesen: {e}")


def _dauer_sagen(sekunden):
    """"4 Minuten" oder "12 Sekunden" — nie das sinnlose "0 Minuten"."""
    sekunden = int(sekunden)
    if sekunden < 60:
        return f"{sekunden} Sekunden"
    minuten = sekunden // 60
    return f"{minuten} Minute" + ("n" if minuten != 1 else "")


def _abwuergen(p):
    """Erst hoeflich, dann bestimmt — und immer die ganze Prozessgruppe.

    Die Gruppe, weil `run:` eine Shell ist: ein SIGTERM an sie allein laesst
    die Enkel (apt, systemctl) am Leben, und die halten dann die Sperren.
    """
    for signal_nr, warten in ((15, 5.0), (9, 2.0)):
        try:
            os.killpg(os.getpgid(p.pid), signal_nr)
        except OSError:
            return
        try:
            p.wait(timeout=warten)
            return
        except subprocess.TimeoutExpired:
            continue


def schritt_fahren(schritt, prefix, zeitgrenze=None, leerlaufgrenze=None):
    """-> (exit_code, abgelaufen). Die Ausgabe laeuft mit ins Protokoll.

    DIE AUSGABE LAEUFT IN EINEM EIGENEN FADEN MIT, und das ist der Kern.
    Frueher stand hier `for zeile in p.stdout:` und ERST DANACH
    `p.wait(timeout=...)`. Die Schleife endet aber erst, wenn der Prozess
    seine Ausgabe schliesst — ein haengender Schritt schreibt nichts und
    schliesst nichts. Die Grenze wurde also nie erreicht, auch wenn ein
    Rezept eine setzte: sie galt nur fuer die Spanne zwischen "Ausgabe zu"
    und "Prozess beendet", und die ist praktisch null.
    Am 09.08.2026 hing so `systemctl enable --now mupibox-touch-bridge` neun
    Minuten lang und haette ewig gehangen — die Box sah langsam aus und stand
    in Wahrheit still, bei Last 0,01 und 0 kB/s.
    """
    befehl = prefix + str(schritt.get("run") or "true")
    if zeitgrenze is None:
        zeitgrenze = GESAMT_GRENZE
    if leerlaufgrenze is None:
        leerlaufgrenze = LEERLAUF_GRENZE
    try:
        p = subprocess.Popen(befehl, shell=True, stdout=subprocess.PIPE,
                             stderr=subprocess.STDOUT, text=True, bufsize=1,
                             preexec_fn=os.setsid)
    except OSError as e:
        sagen(f"  konnte nicht starten: {e}")
        return 1, False

    letzte = [time.time()]

    def mitlesen():
        try:
            for zeile in p.stdout:
                letzte[0] = time.time()
                sagen("  " + zeile.rstrip("\n"))
        except (OSError, ValueError):
            pass

    faden = threading.Thread(target=mitlesen, daemon=True)
    faden.start()

    beginn = time.time()
    while True:
        try:
            code = p.wait(timeout=2)
            break
        except subprocess.TimeoutExpired:
            pass
        jetzt = time.time()
        if zeitgrenze and jetzt - beginn > zeitgrenze:
            grund = f"laeuft seit {_dauer_sagen(jetzt - beginn)}"
        elif leerlaufgrenze and jetzt - letzte[0] > leerlaufgrenze:
            grund = f"sagt seit {_dauer_sagen(jetzt - letzte[0])} nichts mehr"
        else:
            continue
        sagen(f"  ZEITGRENZE: {grund} — der Schritt wird beendet.")
        _abwuergen(p)
        return 124, True
    faden.join(timeout=5)
    # Nach JEDEM Schritt auf die Platte. Ein Schritt kann bootkritische Dateien
    # geaendert haben; bleiben die im Zwischenspeicher und die Box haengt
    # danach, ist die zuletzt geschriebene Datei zerstoert. Dieselbe Begruendung
    # wie im Agenten — hier zaehlt sie doppelt, weil das Rezept Neustarts
    # enthaelt und niemand danebensitzt.
    try:
        os.sync()
    except OSError:
        pass
    return p.returncode, False


def probe_bestehen(schritt, prefix):
    """Das `check:` NACH dem Schritt. -> True/False/None (kein check)."""
    cmd = schritt.get("check")
    if not cmd or not str(cmd).strip():
        return None
    try:
        r = subprocess.run(prefix + str(cmd), shell=True, capture_output=True,
                           text=True, timeout=60)
    except (OSError, subprocess.SubprocessError):
        return False
    return r.returncode == 0


# ── Der Lauf ────────────────────────────────────────────────────────────────
def fahren(lauf, von_vorn=False, stand_datei=STAND_DATEI):
    rezept_pfad = os.path.join(lauf, "rezept.json")
    try:
        with open(rezept_pfad, encoding="utf-8") as f:
            rezept = json.load(f)
    except (OSError, ValueError) as e:
        sagen(f"Rezept nicht lesbar ({rezept_pfad}): {e}")
        return 2
    schritte = rezept.get("steps") or []
    if not schritte:
        sagen("Das Rezept hat keine Schritte.")
        return 2

    stand = {"fertig": [], "gescheitert": None} if von_vorn else stand_lesen(stand_datei)
    fertig = set(stand["fertig"])
    gesamt = len(schritte)
    sagen(f"=== Selbstlauf: {gesamt} Schritte, {len(fertig)} bereits erledigt ===")

    prefix, fakten, hardware = umgebung_ermitteln(lauf, rezept)

    for i, schritt in enumerate(schritte, start=1):
        kennung = str(schritt.get("id") or f"schritt{i}")
        name = schritt.get("name") or kennung
        if kennung in fertig:
            continue

        # `when:` — Schritte fuer die ANDERE Hardware auslassen. Ohne Erkennung
        # wird nichts ausgelassen (siehe umgebung_ermitteln).
        if hardware is not None and schritt.get("when"):
            try:
                if not hardware.passt(schritt.get("when"), fakten):
                    sagen(f"[{i}/{gesamt}] uebersprungen (nur fuer »{schritt['when']}«): {name}")
                    fertig.add(kennung)
                    _schreibe_atomar(stand_datei, {"fertig": sorted(fertig),
                                                   "gescheitert": None})
                    continue
            except Exception:                                # noqa: BLE001
                pass

        sagen(f"[{i}/{gesamt}] {name}")
        fortschritt_melden(i, gesamt, name, laeuft=True)

        # DER STAND WIRD VOR DEM SCHRITT GESCHRIEBEN. Faellt die Box mitten
        # drin aus, steht er als "laufend" da und wird beim Hochkommen erneut
        # versucht — ein Schritt, der als fertig gilt, ohne es zu sein, waere
        # der schlimmere Fall.
        _schreibe_atomar(stand_datei, {"fertig": sorted(fertig),
                                       "gescheitert": None, "laufend": kennung})

        fehler = dateien_legen(schritt, lauf)
        if fehler:
            sagen(f"  Dateien: {fehler}")
            fortschritt_melden(i, gesamt, name, laeuft=False, exit_code=1)
            _schreibe_atomar(stand_datei, {"fertig": sorted(fertig),
                                           "gescheitert": kennung})
            if schritt.get("optional"):
                sagen("  (optional — es geht weiter)")
                continue
            return 1

        _t0 = time.monotonic()
        code, abgelaufen = schritt_fahren(schritt, prefix, schritt.get("timeout"),
                                          schritt.get("leerlauf"))
        _dauer = time.monotonic() - _t0
        zeit_vermerken(kennung, name, _dauer, code)
        if _dauer >= 30:
            # NUR die langen nennen. Wer bei 53 Schritten jede Sekunde meldet,
            # macht das Protokoll unlesbar und verdeckt genau die Stellen, um
            # die es geht.
            sagen(f"  ({_dauer_sagen(_dauer)})")
        geprueft = probe_bestehen(schritt, prefix) if code == 0 else None
        gut = code == 0 and geprueft is not False

        if gut:
            fertig.add(kennung)
            _schreibe_atomar(stand_datei, {"fertig": sorted(fertig), "gescheitert": None})
            fortschritt_melden(i, gesamt, name, laeuft=False, exit_code=0)
            continue

        grund = ("Zeitgrenze" if abgelaufen
                 else f"Probe misslungen (check:)" if geprueft is False
                 else f"Fehlercode {code}")
        sagen(f"  GESCHEITERT: {grund}")
        fortschritt_melden(i, gesamt, name, laeuft=False, exit_code=code or 1)
        if schritt.get("optional"):
            sagen("  (optional — es geht weiter)")
            fertig.add(kennung)
            _schreibe_atomar(stand_datei, {"fertig": sorted(fertig), "gescheitert": None})
            continue
        _schreibe_atomar(stand_datei, {"fertig": sorted(fertig), "gescheitert": kennung})
        sagen(f"Der Lauf haelt an. Nach dem Beheben: erneut starten, "
              f"er macht bei »{kennung}« weiter.")
        return 1

    sagen("=== Alle Schritte durch. ===")
    fortschritt_melden(gesamt, gesamt, "Fertig", laeuft=False, exit_code=0)
    # DIE MARKE, DIE DEN EINRICHTUNGSSCHIRM ZUM SCHWEIGEN BRINGT.
    # Der Vorstart startet ihn bei JEDEM Boot; ist die Box fertig, malt er
    # danach in denselben Bildspeicher wie MuPiBox' eigener Startbildschirm.
    # Am Geraet gesehen: "nach dem neustart rueckt der install boot screen
    # durch den mupi bootscreen". Zwei Zeichner auf /dev/fb0 ergeben genau
    # das. Ab hier hat der Einrichtungsschirm nichts mehr zu sagen — die Box
    # IST eingerichtet. In /var/lib, weil die Marke Neustarts ueberleben muss.
    marke = os.path.join(os.path.dirname(STAND_DATEI), "fertig")
    # OB WIR HIER ZUM ERSTEN MAL STEHEN, MUSS VOR DEM SCHREIBEN FESTSTEHEN.
    # Danach gibt es die Marke immer, und die Antwort waere immer "nein".
    erstes_mal = not os.path.exists(marke)
    try:
        os.makedirs(os.path.dirname(STAND_DATEI), exist_ok=True)
        with open(marke, "w", encoding="utf-8") as f:
            f.write(time.strftime("%Y-%m-%dT%H:%M:%S") + "\n")
    except OSError:
        pass

    # DIREKT NEU STARTEN — KEIN ABSCHLUSS-SCHIRM MEHR.
    # Der Betreiber: "den einricht schritt am ende braucht man nicht, wir
    # koennen direkt einen reboot machen; ich habe vor einen Ersttart-
    # assistenten zu machen". Das ist der bessere Weg: was jetzt noch
    # einzustellen ist, gehoert auf den Touchscreen der Box, nicht auf eine
    # Seite, die man am Handy aufrufen muss — und der Abschluss-Schirm zeigte
    # ohnehin auf eine Oberflaeche, die erst nach diesem Neustart antwortet.
    #
    # NUR BEIM ERSTEN MAL, UND DAS IST DER GEFAEHRLICHE TEIL: diese Unit
    # laeuft bei JEDEM Start, damit sie einen unterbrochenen Lauf fortsetzen
    # kann. Steht schon alles, kommt sie trotzdem bis hierher — ein
    # bedingungsloser Neustart waere eine Schleife, aus der die Box nie
    # wieder herausfaende.
    if not erstes_mal:
        return 0
    sagen("Neustart — danach ist es die MixPiBox.")
    neustart_ausloesen()
    return 0


APT_ZEITEN = "/var/lib/mixpibox-lauf/apt-zeiten.log"


def apt_zeiten_zeigen(pfad=APT_ZEITEN):
    """Laden gegen Auspacken — die Trennung, an der die Werkzeugwahl haengt.

    WOZU: Die Zeiten je Schritt sagen „83 % stecken in drei apt-Aufrufen",
    aber nicht, WORIN. nala beschleunigt das Laden, eatmydata das Auspacken.
    Wer das verwechselt, baut um und gewinnt nichts.

    WOHER DIE ZEILEN KOMMEN: aus zwei apt-Haken (99mixpibox-zeiten, gesetzt im
    Vorstart). Sie erwischen JEDEN apt-Aufruf, auch die von DietPi. Nicht aus
    /var/log/apt — DietPi loescht das am Ende seiner Einrichtung (am
    10.08.2026 nachgesehen: 0 Byte, auf die Minute der Fertigstellung datiert).

    ZWISCHEN apt-start UND dpkg-start LIEGT DAS LADEN, zwischen dpkg-start und
    dpkg-ende das Auspacken. Ein `apt-get install` ohne vorheriges `update`
    hat kein apt-start — dann faellt nur die Ladezeit weg, das Auspacken bleibt
    messbar. Lieber eine Haelfte ehrlich als beide geschaetzt.
    """
    try:
        with open(pfad, encoding="utf-8") as f:
            zeilen = [z.split(None, 1) for z in f if z.strip()]
    except OSError:
        return
    punkte = []
    for teil in zeilen:
        if len(teil) == 2 and teil[0].isdigit():
            punkte.append((int(teil[0]), teil[1].strip()))
    if not punkte:
        return
    laden = auspacken = 0
    letzte_start = None
    for zeit, was in punkte:
        if was.startswith("apt-start"):
            letzte_start = zeit
        elif was == "dpkg-start":
            if letzte_start is not None:
                laden += max(0, zeit - letzte_start)
                letzte_start = None
            auspacken -= zeit          # Beginn merken, unten wieder addieren
        elif was == "dpkg-ende":
            auspacken += zeit
    if laden or auspacken:
        gesamt = laden + auspacken
        print(f"\napt: laden {laden}s, auspacken {auspacken}s")
        if gesamt:
            print(f"     -> {laden * 100 // gesamt}% laden, "
                  f"{auspacken * 100 // gesamt}% auspacken")
            print("     laden gross  -> parallele Downloads (nala) helfen")
            print("     auspacken gross -> eatmydata / weniger apt-Aufrufe helfen")


def zeiten_zeigen(pfad=ZEITEN_DATEI, wieviele=12):
    """Die langsamsten Schritte, absteigend — und was sie zusammen ausmachen.

    WOZU: Damit die Frage „koennen wir parallelisieren?" eine Zahl bekommt statt
    einer Vermutung. Wer sieht, dass die Haelfte der Zeit in einem einzigen
    apt-Schritt steckt, weiss auch, dass paralleles Herunterladen dort etwas
    bringt und an allen anderen nichts.
    """
    try:
        with open(pfad, encoding="utf-8") as f:
            zeilen = [json.loads(z) for z in f if z.strip()]
    except (OSError, ValueError):
        return
    if not zeilen:
        return
    gesamt = sum(z.get("sekunden") or 0 for z in zeilen)
    print(f"\nZeiten: {len(zeilen)} Schritte, zusammen {_dauer_sagen(gesamt)}")
    for z in sorted(zeilen, key=lambda x: -(x.get("sekunden") or 0))[:wieviele]:
        s = z.get("sekunden") or 0
        anteil = (s / gesamt * 100) if gesamt else 0
        print(f"  {s:7.1f}s  {anteil:4.1f}%  {z.get('name') or z.get('schritt')}")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--lauf", default="/opt/mixpibox-lauf",
                    help="Ordner mit rezept.json und dateien/")
    ap.add_argument("--von-vorn", action="store_true", help="Stand verwerfen")
    ap.add_argument("--stand", action="store_true", help="nur nachsehen, nichts tun")
    ap.add_argument("--nur-wenn-angefangen", action="store_true",
                    help="still enden, wenn noch kein Lauf begonnen wurde (fuer die Unit)")
    a = ap.parse_args()

    # DIE UNIT LAEUFT BEI JEDEM START — sie muss ja einen Lauf fortsetzen
    # koennen, der von einem Neustart unterbrochen wurde. Solange niemand
    # gestartet hat, darf sie aber NICHTS tun: sonst richtete sich jede frisch
    # bespielte Karte von selbst ein, ohne dass jemand zugestimmt haette.
    # Die Standdatei IST die Zustimmung — sie entsteht nur beim Start.
    if a.nur_wenn_angefangen and not os.path.exists(STAND_DATEI):
        return 0

    if a.stand:
        s = stand_lesen()
        print(f"erledigt: {len(s['fertig'])}")
        if s["gescheitert"]:
            print(f"gescheitert bei: {s['gescheitert']}")
        zeiten_zeigen()
        apt_zeiten_zeigen()
        return 0
    if os.geteuid() != 0:
        print("als root starten (die Schritte richten das System ein)", file=sys.stderr)
        return 2
    return fahren(a.lauf, von_vorn=a.von_vorn)


if __name__ == "__main__":
    sys.exit(main())
