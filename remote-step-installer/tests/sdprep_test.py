#!/usr/bin/env python3
"""
Tests für die SD-Vorbereitung (controller/sdprep.py) — pure Teile, KEIN Netz, KEIN
Schreiben auf Geräte.

Der wichtigste Block ist die Geräte-Filterung: ein falsch ausgewähltes Gerät zerstört
Daten, deshalb wird hier mit synthetischem `lsblk`-JSON geprüft, dass eine Systemplatte
NIEMALS als beschreibbar durchgeht.

  python3 tests/sdprep_test.py       # exit 0 = alles gruen
"""
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "controller"))
import sdprep  # noqa: E402

ok = bad = 0


def chk(name, cond):
    global ok, bad
    print(("  \033[32mOK  \033[0m" if cond else "  \033[31mFAIL\033[0m") + "  " + name)
    ok += bool(cond)
    bad += (not cond)


# ── Index parsen ───────────────────────────────────────────────────────────
HTML = """<a href="DietPi_RPi5-ARMv8-Trixie.img.xz">x</a>
<a href="DietPi_RPi5-ARMv8-Trixie_Amiberry.img.xz">x</a>
<a href="DietPi_RPi234-ARMv8-Bookworm.img.xz">x</a>
<a href="DietPi_RPi1-ARMv6-Forky.img.xz">x</a>
<a href="DietPi_NanoPiNEO2-ARMv8-Trixie.img.xz">x</a>
<a href="DietPi_RPi5-ARMv8-Trixie.img.xz.sha256">nicht doppelt</a>"""
ents = sdprep.parse_index(HTML)
chk("Index: 5 Images erkannt (Dubletten/.sha256 ignoriert)", len(ents) == 5)
e = next(x for x in ents if x["file"] == "DietPi_RPi5-ARMv8-Trixie.img.xz")
chk("Index: Board/Arch/Codename zerlegt", (e["board"], e["arch"], e["codename"]) == ("RPi5", "ARMv8", "Trixie"))
chk("Index: URL gebaut", e["url"].endswith("/downloads/images/DietPi_RPi5-ARMv8-Trixie.img.xz"))
chk("Index: Variante erkannt (Amiberry)",
    any(x["variant"] == "Amiberry" for x in ents))
chk("Auswahl: Sonder-Varianten sind standardmäßig AUS (nacktes System)",
    all(not x["variant"] for x in sdprep.select(ents, "RPi5")))
chk("Auswahl: nach Board+Codename", len(sdprep.select(ents, "RPi5", "Trixie")) == 1)
chk("Boards gelistet", "RPi5" in sdprep.boards(ents) and "NanoPiNEO2" in sdprep.boards(ents))

# ── Board-Alias: „RPi4" gibt es bei DietPi nicht ───────────────────────────
# Bis zum 31.08.2026 boten die Oberflaechen „RPi4" an (sdstart Board-Seite,
# sdgui BOARDS), `select()` verglich auf Gleichheit, und DietPi nennt das
# 64-Bit-Abbild fuer Pi 2/3/4 `RPi234`. Ergebnis beim ersten echten Pi-4-
# Versuch: „Kein Abbild für RPi4 gefunden."
#
# DIESE DATEI HAETTE ES FANGEN KOENNEN und tat es nicht: geprueft wurde
# ausschliesslich mit „RPi5" — der einzigen Kennung, die zufaellig stimmt.
# Eine Auswahl-Pruefung, die nur den Normalfall kennt, misst die Schreibweise
# des Testautors, nicht die Gegenstelle.
chk("Alias: RPi4 findet das RPi234-Abbild",
    len(sdprep.select(ents, "RPi4", "Bookworm")) == 1)
chk("Alias: RPi3 ebenso (Pi 3 ist 64-Bit-faehig)",
    len(sdprep.select(ents, "RPi3", "Bookworm")) == 1)
chk("Alias: RPi5 bleibt unberuehrt",
    len(sdprep.select(ents, "RPi5", "Trixie")) == 1)
chk("Alias: RPi234 direkt geht weiterhin",
    len(sdprep.select(ents, "RPi234", "Bookworm")) == 1)
# GEGENPROBE: der Alias darf keine Maschine sein, die immer irgendetwas
# findet. Ein Board, das es nicht gibt, muss leer bleiben.
chk("Alias: erfundenes Board bleibt leer",
    sdprep.select(ents, "RPi9", "Trixie") == [])
chk("Alias: Hinweis nur bei Umschreibung",
    sdprep.board_aufloesen("RPi4")[1] is not None
    and sdprep.board_aufloesen("RPi5")[1] is None
    and sdprep.board_aufloesen("RPi4")[0] == "RPi234")

# ── Geräte-Filterung (sicherheitskritisch) ─────────────────────────────────
LSBLK = json.loads("""{"blockdevices":[
 {"name":"nvme0n1","path":"/dev/nvme0n1","size":"1,8T","model":"Samsung SSD","tran":"nvme",
  "rm":false,"hotplug":false,"type":"disk","mountpoints":[],
  "children":[{"name":"nvme0n1p2","path":"/dev/nvme0n1p2","type":"part","mountpoints":["/","/home"]}]},
 {"name":"sda","path":"/dev/sda","size":"931G","model":"Backup HDD","tran":"sata",
  "rm":false,"hotplug":false,"type":"disk","mountpoints":["/mnt/backup"]},
 {"name":"mmcblk0","path":"/dev/mmcblk0","size":"29,7G","model":"SD32G","tran":"mmc",
  "rm":true,"hotplug":true,"type":"disk","mountpoints":[],
  "children":[{"name":"mmcblk0p1","path":"/dev/mmcblk0p1","type":"part","mountpoints":["/run/media/achim/bootfs"]}]},
 {"name":"sdb","path":"/dev/sdb","size":"14,4G","model":"USB DISK","tran":"usb",
  "rm":true,"hotplug":true,"type":"disk","mountpoints":[]},
 {"name":"zram0","path":"/dev/zram0","size":"15G","model":null,"tran":null,
  "rm":false,"hotplug":false,"type":"disk","mountpoints":["[SWAP]"]}]}""")
good, blocked = sdprep.safe_devices(LSBLK)
names = [d["path"] for d in good]
chk("SD-Karte wird angeboten", "/dev/mmcblk0" in names)
chk("USB-Stick wird angeboten", "/dev/sdb" in names)
chk("SYSTEMPLATTE wird NIEMALS angeboten", "/dev/nvme0n1" not in names)
chk("interne Datenplatte wird nicht angeboten", "/dev/sda" not in names)
chk("zram/SWAP wird nicht angeboten", "/dev/zram0" not in names)
chk("Systemplatte mit Grund ausgeschlossen",
    any(d["path"] == "/dev/nvme0n1" and "System" in d["reason"] for d in blocked))
chk("interne Platte mit Grund ausgeschlossen",
    any(d["path"] == "/dev/sda" and "Wechsel" in d["reason"] for d in blocked))
chk("Mountpoints der Kinder werden gesehen (SD ist gemountet)",
    any(d["path"] == "/dev/mmcblk0" and d["mounts"] for d in good))
chk("leeres/kaputtes lsblk → keine Geräte, kein Absturz", sdprep.safe_devices({}) == ([], []))

# ── dietpi.txt patchen ─────────────────────────────────────────────────────
ORIG = """# DietPi
AUTO_SETUP_AUTOMATED=0
AUTO_SETUP_GLOBAL_PASSWORD=dietpi
# ein Kommentar
AUTO_SETUP_NET_HOSTNAME=DietPi
UNBEKANNT=behalten
"""
cfg = sdprep.dietpi_cfg("geheim", hostname="mupibox", wifi=True)
new = sdprep.patch_dietpi_txt(ORIG, cfg)
chk("Passwort gesetzt", "AUTO_SETUP_GLOBAL_PASSWORD=geheim" in new)
chk("automatisch aufsetzen an", "AUTO_SETUP_AUTOMATED=1" in new)
chk("Hostname gesetzt", "AUTO_SETUP_NET_HOSTNAME=mupibox" in new)
chk("WLAN an", "AUTO_SETUP_NET_WIFI_ENABLED=1" in new)
# Entweder-oder, wie der Assistent es fragt ("WLAN-SSID (leer = LAN)"): bleibt
# Ethernet auf DietPis Standard 1, haengt ein defekter LAN-Adapter (Link ja,
# DHCP nein) den Erstlauf auf, obwohl WLAN eingerichtet ist.
chk("bei WLAN ist Ethernet aus", "AUTO_SETUP_NET_ETHERNET_ENABLED=0" in new)
_lan = sdprep.patch_dietpi_txt(ORIG, sdprep.dietpi_cfg("geheim", wifi=False))
chk("ohne WLAN ist Ethernet an", "AUTO_SETUP_NET_ETHERNET_ENABLED=1" in _lan)
chk("ohne WLAN ist WLAN aus", "AUTO_SETUP_NET_WIFI_ENABLED=0" in _lan)
chk("OpenSSH gewählt", "AUTO_SETUP_SSH_SERVER_INDEX=-2" in new)
chk("KEINE Zusatzsoftware (nacktes System)", "AUTO_SETUP_INSTALL_SOFTWARE_ID=\n" in new)
chk("Custom-Script aktiviert (unser Agent)", "AUTO_SETUP_CUSTOM_SCRIPT_EXEC=1" in new)
chk("fremde Schlüssel bleiben erhalten", "UNBEKANNT=behalten" in new)
chk("Kommentare bleiben erhalten", "# ein Kommentar" in new)
chk("kein doppelter Schlüssel", new.count("AUTO_SETUP_GLOBAL_PASSWORD=") == 1)
chk("fehlende Schlüssel werden ergänzt", "AUTO_SETUP_TIMEZONE=" in new)

# ── WLAN-Datei ─────────────────────────────────────────────────────────────
# DietPi liest diese Datei als Bash-Skript und greift auf einen FESTEN
# Variablensatz zu. Eine selbst gebaute Minimaldatei liess die Haelfte weg und
# erfand Namen, die es nicht gibt -> die Box kam nicht ins WLAN, und weil der
# automatische Erstlauf Internet braucht, endete das in "first run setup failed".
DIETPI_WIFI = """# Entry 0
aWIFI_SSID[0]=''
aWIFI_KEY[0]=''
aWIFI_KEYMGR[0]='WPA-PSK'
aWIFI_PROTO[0]=''
aWIFI_PAIRWISE[0]=''
aWIFI_AUTH_ALG[0]=''
aWIFI_EAP[0]=''
aWIFI_IDENTITY[0]=''
aWIFI_PASSWORD[0]=''
aWIFI_PHASE1[0]=''
aWIFI_PHASE2[0]=''
aWIFI_CERT[0]=''
# Entry 1
aWIFI_SSID[1]=''
aWIFI_KEY[1]=''
aWIFI_KEYMGR[1]='WPA-PSK'
"""
pw = sdprep.patch_wifi_txt(DIETPI_WIFI, "Mein WLAN", "geheim'pass")
chk("SSID eingetragen", "aWIFI_SSID[0]='Mein WLAN'" in pw)
chk("Apostroph im Passwort escaped (Bash-sicher)", "'\\''" in pw)
chk("DietPis Variablensatz bleibt VOLLSTAENDIG",
    all(v in pw for v in ("aWIFI_EAP[0]", "aWIFI_IDENTITY[0]", "aWIFI_PASSWORD[0]",
                          "aWIFI_PHASE1[0]", "aWIFI_PHASE2[0]", "aWIFI_CERT[0]")))
chk("keine erfundenen Namen", "aWIFI_EAPID" not in pw and "aWIFI_EAPPHASE" not in pw)
chk("weitere Eintraege bleiben unberuehrt", "aWIFI_SSID[1]=''" in pw)
chk("Kommentare bleiben", "# Entry 0" in pw)
chk("offenes Netz -> KEYMGR NONE",
    "aWIFI_KEYMGR[0]='NONE'" in sdprep.patch_wifi_txt(DIETPI_WIFI, "Offen", ""))
chk("Laendercode NICHT hier (der gehoert in dietpi.txt)", "COUNTRY" not in pw)
# Rueckfall, falls die Karte gar keine Datei mitbringt: trotzdem vollstaendig
wf = sdprep.wifi_file("Mein WLAN", "k")
chk("Rueckfalldatei ist vollstaendig",
    all(v in wf for v in ("aWIFI_EAP[0]", "aWIFI_IDENTITY[0]", "aWIFI_PASSWORD[0]",
                          "aWIFI_PHASE1[0]", "aWIFI_PHASE2[0]", "aWIFI_CERT[0]")))
# Der Laendercode gehoert in die dietpi.txt — DietPis Standard dort ist GB.
_de = sdprep.patch_dietpi_txt("AUTO_SETUP_NET_WIFI_COUNTRY_CODE=GB\n",
                              sdprep.dietpi_cfg("pw", wifi=True, country="DE"))
chk("Laendercode landet in dietpi.txt", "AUTO_SETUP_NET_WIFI_COUNTRY_CODE=DE" in _de)
chk("GB wird ersetzt, nicht ergaenzt", _de.count("AUTO_SETUP_NET_WIFI_COUNTRY_CODE=") == 1)
# ══ DIESER WAECHTER STAND GENAU ANDERSHERUM ═════════════════════════════════
#
# Hier hiess es: chk("kein erfundener Lizenzschluessel",
#                    "AUTO_SETUP_ACCEPT_LICENSE" not in _de)
# — und er war RICHTIG gemessen: das damals benutzte DietPi-Abbild kannte den
# Schluessel nicht, null Vorkommen, nicht mal als Kommentar. Einen Schluessel
# zu schreiben, den niemand liest, ist Aberglaube.
#
# NUR HAT DIE MESSUNG EIN ABBILD GEBUNDEN, NICHT ALLE. Seit dem 10.08.2026
# schreibt der Assistent Trixie, und dort fragt der Erstlauf nach der
# Zustimmung. Der Betreiber sah, was daraus wird: „also blauer bildschirm
# install gestoppt von dietpi." Ein whiptail-Dialog auf einer Box ohne
# Tastatur wartet fuer immer.
#
# Der Waechter prueft deshalb jetzt das Gegenteil — und der alte Grund steht
# hier, damit niemand ihn ein zweites Mal entdeckt und zurueckdreht.
chk("die Lizenzzustimmung steht drin (sonst blauer Dialog auf Trixie)",
    "AUTO_SETUP_ACCEPT_LICENSE=1" in _de)
chk("und genau einmal", _de.count("AUTO_SETUP_ACCEPT_LICENSE") == 1)

# ── Erstboot-Skript ────────────────────────────────────────────────────────
s = sdprep.custom_script(agent_port=8099, ssh_pubkey="ssh-ed25519 AAAAC3xyz user@host")
chk("Skript ist bash", s.startswith("#!/bin/bash"))
chk("installiert den Agent nach /opt/step-agent", "/opt/step-agent/agent.py" in s)
chk("legt einen systemd-Dienst an", "step-agent.service" in s)
chk("bindet nur an localhost", "--host 127.0.0.1" in s)
chk("hinterlegt den Pair-Code zum Abholen", "paircode" in s)
chk("SSH-Schlüssel wird eingetragen", "authorized_keys" in s and "AAAAC3xyz" in s)
chk("ohne Schlüssel kein authorized_keys-Block", "authorized_keys" not in sdprep.custom_script())
# Regel: NUR python3 darf nachinstalliert werden (die einzige Voraussetzung des
# Agents — ein minimales DietPi bringt keins mit, siehe echter Lauf). Sonst nichts.
_installs = [ln.strip() for ln in s.splitlines() if "apt-get install" in ln or "apt install" in ln]
chk("installiert NUR python3 nach (sonst nichts)",
    len(_installs) == 1 and "python3" in _installs[0])
chk("Python-Pfad wird ERMITTELT, nicht angenommen",
    "command -v python3" in s and "ExecStart=$PY" in s)
chk("kein hartkodiertes /usr/bin/python3 mehr", "ExecStart=/usr/bin/python3" not in s)

# ── Boot-Partition vorbereiten (gegen ein Fake-Verzeichnis) ────────────────
with tempfile.TemporaryDirectory() as d:
    with open(os.path.join(d, "dietpi.txt"), "w") as f:
        f.write(ORIG)
    written = sdprep.prepare_boot(d, password="pw", hostname="testbox",
                                  wifi={"ssid": "S", "key": "K"}, ssh_pubkey="ssh-ed25519 AAA x@y")
    chk("dietpi.txt geschrieben", "dietpi.txt" in written)
    chk("dietpi-wifi.txt geschrieben", os.path.isfile(os.path.join(d, "dietpi-wifi.txt")))
    # STANDARD: der Agent wird NICHT mitgebacken — `./connect --install` bringt ihn
    # spaeter hin und dann in der AKTUELLEN Fassung (statt der beim Kartenschreiben).
    chk("Agent NICHT mitgebacken (Standard)", not os.path.exists(os.path.join(d, "step-agent")))
    sk = os.path.join(d, "Automation_Custom_Script.sh")
    chk("Erstboot-Skript ausführbar", os.access(sk, os.X_OK))
    with open(sk) as f:
        body = f.read()
    chk("Erstboot-Skript hinterlegt NUR den SSH-Schlüssel",
        "authorized_keys" in body and "step-agent" not in body)
    with open(os.path.join(d, "dietpi.txt")) as f:
        chk("Hostname in der geschriebenen Datei", "AUTO_SETUP_NET_HOSTNAME=testbox" in f.read())

with tempfile.TemporaryDirectory() as d2:      # OPT-IN: Agent doch mitbacken
    with open(os.path.join(d2, "dietpi.txt"), "w") as f:
        f.write(ORIG)
    sdprep.prepare_boot(d2, password="pw", bake_agent=True)
    chk("--bake-agent: Agent liegt auf der Karte",
        os.path.isfile(os.path.join(d2, "step-agent", "agent.py")))
    with open(os.path.join(d2, "step-agent", "agent.py")) as f:
        chk("--bake-agent: es ist der echte Agent", "PAIR CODE" in f.read())

# ── Trockenlauf: es darf NICHTS geschrieben werden ─────────────────────────
lines = []
rc = sdprep.write_image("/tmp/nicht-da.img.xz", "/dev/sdz", dry_run=True, on_line=lines.append)
chk("Trockenlauf schreibt nicht (kein Rückgabecode)", rc is None)
chk("Trockenlauf zeigt den Befehl", any("dd" in l or "rpi-imager" in l for l in lines))

# ── Passwortfreie Anmeldung: Schlüssel erzeugen + hinterlegen ──────────────
# Gegen ein TEMPORAERES HOME, damit der echte ~/.ssh unangetastet bleibt.
import subprocess  # noqa: E402

_home = os.environ.get("HOME")
with tempfile.TemporaryDirectory() as fake_home:
    os.environ["HOME"] = fake_home
    sdprep.KEY_PATH = os.path.join(fake_home, ".ssh", "id_ed25519")
    chk("ohne Schlüssel und ohne create: leer", sdprep.default_pubkey() == "")
    if shutil_which := __import__("shutil").which("ssh-keygen"):
        pub, made = sdprep.ensure_local_key()
        chk("Schlüssel wird erzeugt", made and pub.startswith("ssh-ed25519 "))
        chk("Schlüsseldatei liegt im HOME", os.path.isfile(sdprep.KEY_PATH + ".pub"))
        chk("privater Schlüssel nur für den Besitzer lesbar",
            oct(os.stat(sdprep.KEY_PATH).st_mode)[-3:] == "600")
        pub2, made2 = sdprep.ensure_local_key()
        chk("zweiter Aufruf erzeugt KEINEN neuen (idempotent)", pub2 == pub and not made2)
        chk("default_pubkey(create=True) liefert denselben", sdprep.default_pubkey(create=True) == pub)

        # Das Skript, das connect.py auf der BOX ausfuehrt: zweimal angewandt darf
        # der Schluessel NICHT doppelt in authorized_keys stehen.
        sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "controller"))
        import connect  # noqa: E402
        box = os.path.join(fake_home, "box")
        os.makedirs(box, exist_ok=True)
        env = dict(os.environ, HOME=box)
        for _ in range(2):
            subprocess.run(["sh", "-c", connect.INSTALL_KEY], input=pub + "\n",
                           text=True, capture_output=True, env=env)
        ak = os.path.join(box, ".ssh", "authorized_keys")
        lines = [l for l in open(ak).read().splitlines() if l.strip()] if os.path.isfile(ak) else []
        chk("Schlüssel landet in authorized_keys", len(lines) >= 1 and lines[0] == pub)
        chk("zweimal hinterlegt = trotzdem EIN Eintrag", len(lines) == 1)
        chk("authorized_keys ist 600", oct(os.stat(ak).st_mode)[-3:] == "600")
        chk("~/.ssh ist 700", oct(os.stat(os.path.dirname(ak)).st_mode)[-3:] == "700")
    else:
        chk("ssh-keygen vorhanden (Test übersprungen)", True)
if _home is not None:
    os.environ["HOME"] = _home


# ── Root-Rechte: der Weg muss ZUR LAGE passen ──────────────────────────────
# In der TUI gehoert das Terminal Textual, ein fragendes sudo bricht dort ab.
# Deshalb wird hier mit vorgetaeuschter Umgebung geprueft — es laeuft KEIN
# echtes sudo.
import subprocess as _sp
_echt_run, _echt_which, _echt_euid = _sp.run, sdprep.shutil.which, os.geteuid


def _lage(*, root=False, sudo_da=True, sudo_ohne_pw=False, pkexec_da=True, grafisch=True):
    os.geteuid = lambda: 0 if root else 1000
    sdprep.shutil.which = lambda c: {"sudo": "/usr/bin/sudo" if sudo_da else None,
                                     "pkexec": "/usr/bin/pkexec" if pkexec_da else None}.get(c, "/usr/bin/" + c)

    class _Erg:
        returncode = 0 if sudo_ohne_pw else 1
    _sp.run = lambda *a, **k: _Erg()
    sdprep.subprocess.run = _sp.run
    for v in ("DISPLAY", "WAYLAND_DISPLAY"):
        os.environ.pop(v, None)
    if grafisch:
        os.environ["WAYLAND_DISPLAY"] = "wayland-0"


try:
    _lage(root=True)
    chk("als root: kein Helfer noetig", sdprep.root_helper(False) == ([], {}, ""))

    _lage(sudo_ohne_pw=False)
    chk("im Terminal darf sudo fragen", sdprep.root_helper(True)[0] == ["sudo"])

    _lage(sudo_ohne_pw=True)
    chk("gemerkte Freigabe wird genutzt", sdprep.root_helper(False)[0] == ["sudo"])

    # Ohne gemerkte Freigabe: sudo GRAFISCH fragen lassen, nicht pkexec.
    # pkexec entscheidet selbst, wessen Passwort es will (oft root) und weist
    # das eigene, richtige Passwort ab — am Geraet genau so erlebt.
    _lage(sudo_ohne_pw=False, grafisch=True)
    sdprep._ASKPASS.clear()
    sdprep._ASKPASS.append("/tmp/fake-askpass")
    weg, umg, hinweis = sdprep.root_helper(False)
    chk("ohne Freigabe: sudo mit grafischer Abfrage", weg == ["sudo", "-A", "--"])
    chk("askpass wird mitgegeben", umg.get("SUDO_ASKPASS") == "/tmp/fake-askpass")
    chk("Hinweis nennt das eigene Passwort", "DEIN" in hinweis)

    # Kein Dialogwerkzeug -> pkexec als Rueckfall, MIT Warnung
    sdprep._ASKPASS.clear()
    _echt_ap = sdprep.askpass_script
    sdprep.askpass_script = lambda: None
    weg, umg, hinweis = sdprep.root_helper(False)
    chk("ohne Dialogwerkzeug: pkexec", weg == ["pkexec"])
    chk("und die polkit-Falle wird benannt", "root-Passwort" in hinweis)
    sdprep.askpass_script = _echt_ap

    _lage(sudo_ohne_pw=False, pkexec_da=False, grafisch=False)
    sdprep.askpass_script = lambda: None
    weg, umg, grund = sdprep.root_helper(False)
    chk("kein Weg: sauberes Nein statt Absturz", weg is None)
    chk("Grund nennt den Ausweg (sudo -v)", "sudo -v" in grund)
    sdprep.askpass_script = _echt_ap
finally:
    _sp.run, sdprep.subprocess.run = _echt_run, _echt_run
    sdprep.shutil.which, os.geteuid = _echt_which, _echt_euid

# ── config.txt: NUR aktive Zeilen zaehlen ─────────────────────────────────
# DietPi liefert den KMS-Treiber AUSKOMMENTIERT aus. Ein simpler Textvergleich
# hielt ihn fuer vorhanden, ergaenzte nur das Panel — und das setzt ihn voraus.
# Ergebnis am Geraet: Bildschirm blieb schwarz.
AUSKOMMENTIERT = "# DietPi\n#dtoverlay=vc4-kms-v3d,noaudio\narm_64bit=1\n"
_c = sdprep.config_debug(AUSKOMMENTIERT)
chk("auskommentierter Treiber zaehlt NICHT als vorhanden",
    any(z.strip() == "dtoverlay=vc4-kms-v3d" for z in _c.splitlines()))
chk("Panel ebenfalls gesetzt",
    any(z.strip() == "dtoverlay=vc4-kms-dsi-7inch" for z in _c.splitlines()))
chk("Kommentarzeile bleibt unangetastet", "#dtoverlay=vc4-kms-v3d,noaudio" in _c)
_aktiv = "dtoverlay=vc4-kms-v3d\ndtoverlay=vc4-kms-dsi-7inch\n"
chk("wirklich aktive Zeilen werden nicht verdoppelt", sdprep.config_debug(_aktiv) == _aktiv)
chk("zweimal angewandt stabil", sdprep.config_debug(_c) == _c)

# ── WLAN-Passwort vom Rechner holen ───────────────────────────────────────
_echt_run3, _echt_which3 = sdprep.subprocess.run, sdprep.shutil.which
try:
    sdprep.shutil.which = lambda c: "/usr/bin/nmcli"

    class _Erg3:
        returncode, stdout, stderr = 0, "geheimes-wlan-pw\n", ""
    sdprep.subprocess.run = lambda *a, **k: _Erg3()
    chk("gespeichertes Passwort wird geholt", sdprep.wifi_secret("Heimnetz") == "geheimes-wlan-pw")
    chk("ohne SSID kein Aufruf", sdprep.wifi_secret("") == "")

    class _Erg4:
        returncode, stdout, stderr = 10, "", "unknown connection"
    sdprep.subprocess.run = lambda *a, **k: _Erg4()
    chk("unbekanntes Netz -> leer (dann wird getippt)", sdprep.wifi_secret("Fremd") == "")
    sdprep.shutil.which = lambda c: None
    chk("ohne nmcli -> leer", sdprep.wifi_secret("Heimnetz") == "")
finally:
    sdprep.subprocess.run, sdprep.shutil.which = _echt_run3, _echt_which3

# ── Fortschritt: dd-Zeilen lesen (fuer den festen Balken) ─────────────────
chk("dd-Fortschritt gelesen",
    sdprep.parse_dd_progress("1234567 bytes (1,2 MB, 1,2 MiB) copied, 1 s, 1,2 MB/s") == 1234567)
chk("englische Fassung ebenso",
    sdprep.parse_dd_progress("4194304 bytes (4.2 MB, 4.0 MiB) copied, 0.5 s") == 4194304)
# Der Balken bewegte sich nicht, weil dd auf einem deutschen System "Byte"
# schreibt (gross, Einzahl) — gesucht wurde "bytes".
chk("DEUTSCHE Fassung ('Byte', gross, Einzahl)",
    sdprep.parse_dd_progress("209715200 Byte (210 MB, 200 MiB) kopiert, 0,004 s, 52,0 GB/s")
    == 209715200)
chk("deutsche Datensatz-Zeile ist kein Fortschritt",
    sdprep.parse_dd_progress("200+0 Datensätze ein") is None)
chk("Einzahl 'byte' auch", sdprep.parse_dd_progress("1 byte copied, 0 s") == 1)
chk("Abschlusszeile ist kein Fortschritt",
    sdprep.parse_dd_progress("512+0 records in") is None)
chk("Fehlermeldung ist kein Fortschritt",
    sdprep.parse_dd_progress("dd: failed to open '/dev/x': Permission denied") is None)
chk("leere Zeile stuerzt nicht ab", sdprep.parse_dd_progress("") is None)

# ── Bildschirm beim Erstboot (Fehlersuche) ────────────────────────────────
CL = "console=serial0,115200 console=tty1 root=PARTUUID=abc rootfstype=ext4 quiet logo.nologo loglevel=0 rootwait\n"
neu_cl = sdprep.cmdline_debug(CL)
chk("quiet fliegt raus", "quiet" not in neu_cl)
chk("logo.nologo fliegt raus", "logo.nologo" not in neu_cl)
chk("loglevel=0 fliegt raus", "loglevel=" not in neu_cl)
chk("Bildschirm schaltet nicht ab", "consoleblank=0" in neu_cl)
chk("vorhandenes console=tty1 bleibt", neu_cl.count("console=tty1") == 1)
chk("root-Angabe bleibt unangetastet", "root=PARTUUID=abc" in neu_cl)
chk("ohne console=tty wird eins gesetzt",
    "console=tty1" in sdprep.cmdline_debug("root=/dev/mmcblk0p2 rootwait"))
chk("consoleblank steht nur einmal drin",
    sdprep.cmdline_debug("root=x consoleblank=600").count("consoleblank=") == 1)

CF = "# DietPi\ndtparam=audio=on\n"
neu_cf = sdprep.config_debug(CF)
chk("KMS-Treiber ergänzt", "dtoverlay=vc4-kms-v3d" in neu_cf)
chk("DSI-Panel ergänzt", "dtoverlay=vc4-kms-dsi-7inch" in neu_cf)
chk("Bestehendes bleibt stehen", "dtparam=audio=on" in neu_cf)
chk("zweimal angewandt ändert nichts mehr", sdprep.config_debug(neu_cf) == neu_cf)

# Gegen ein Fake-Boot-Verzeichnis: nur auf Wunsch, sonst unangetastet
import tempfile as _tf
for wunsch in (False, True):
    with _tf.TemporaryDirectory() as d:
        open(os.path.join(d, "dietpi.txt"), "w").write(ORIG)
        open(os.path.join(d, "cmdline.txt"), "w").write(CL)
        open(os.path.join(d, "config.txt"), "w").write(CF)
        sdprep.prepare_boot(d, password="pw", hostname="b", wifi=None, ssh_pubkey="",
                            debug_display=wunsch)
        hat = "quiet" not in open(os.path.join(d, "cmdline.txt")).read()
        chk(f"debug_display={wunsch} -> Konsole {'sichtbar' if wunsch else 'unverändert'}",
            hat is wunsch)

# ── Nachlesen von der Karte: faengt es die ECHTEN Fehler? ─────────────────
# Beide Fehler unten sind am Geraet passiert und blieben still — sie zeigten
# sich erst Minuten spaeter beim Booten der Box. Genau das soll die Nachlese
# sofort sichtbar machen.
import tempfile as _tf2


def _karte(**dateien):
    d = _tf2.mkdtemp(prefix="karte-")
    for name, inhalt in dateien.items():
        open(os.path.join(d, name.replace("__", "-").replace("_txt", ".txt")), "w").write(inhalt)
    return d


GUT_WIFI = ("aWIFI_SSID[0]='Heim'\naWIFI_KEY[0]='k'\naWIFI_KEYMGR[0]='WPA-PSK'\n"
            "aWIFI_EAP[0]=''\naWIFI_IDENTITY[0]=''\naWIFI_PASSWORD[0]=''\n"
            "aWIFI_PHASE1[0]=''\naWIFI_PHASE2[0]=''\naWIFI_CERT[0]=''\n")
GUT_DT = ("AUTO_SETUP_AUTOMATED=1\nAUTO_SETUP_NET_HOSTNAME=mupibox\n"
          "AUTO_SETUP_SSH_SERVER_INDEX=-2\nAUTO_SETUP_NET_WIFI_ENABLED=1\n"
          "AUTO_SETUP_NET_WIFI_COUNTRY_CODE=DE\n")
GUT_CL = "root=x consoleblank=0\n"
GUT_CF = "dtoverlay=vc4-kms-v3d\ndtoverlay=vc4-kms-dsi-7inch\n"
_wifi = {"ssid": "Heim", "key": "k"}


def _fehler(d, **kw):
    return [t for ok, t in sdprep.verify_boot(d, **kw) if not ok]


_d = _karte(**{"dietpi_txt": GUT_DT, "dietpi__wifi_txt": GUT_WIFI,
               "cmdline_txt": GUT_CL, "config_txt": GUT_CF})
# Im Fehlersuche-Modus gehoert auch die Selbstdiagnose auf die Karte.
open(os.path.join(_d, "Automation_Custom_PreScript.sh"), "w").write(sdprep.diagnose_prescript())
chk("heile Karte: nichts zu meckern",
    _fehler(_d, wifi=_wifi, debug_display=True, diagnose=True, hostname="mupibox") == [])
chk("Diagnose-Schalter aus -> PreScript wird nicht verlangt",
    not any("Selbstdiagnose" in t for t in
            _fehler(_karte(**{"dietpi_txt": GUT_DT, "dietpi__wifi_txt": GUT_WIFI,
                              "cmdline_txt": GUT_CL, "config_txt": GUT_CF}),
                    wifi=_wifi, debug_display=True)))

# Fehler 1: Panel-Overlay OHNE den Treiber, den es voraussetzt -> Schirm blieb schwarz
_d = _karte(**{"dietpi_txt": GUT_DT, "dietpi__wifi_txt": GUT_WIFI, "cmdline_txt": GUT_CL,
               "config_txt": "#dtoverlay=vc4-kms-v3d,noaudio\ndtoverlay=vc4-kms-dsi-7inch\n"})
chk("fehlender Grafiktreiber wird gemeldet",
    any("vc4-kms-v3d" in t for t in _fehler(_d, wifi=_wifi, debug_display=True)))

# Fehler 2: WLAN-Datei ohne DietPis Variablen -> Box kam nie ins Netz
_d = _karte(**{"dietpi_txt": GUT_DT, "cmdline_txt": GUT_CL, "config_txt": GUT_CF,
               "dietpi__wifi_txt": "aWIFI_SSID[0]='Heim'\naWIFI_KEY[0]='k'\n"
                                   "aWIFI_EAPID[0]=''\n"})
_f = _fehler(_d, wifi=_wifi, debug_display=True)
chk("unvollstaendige WLAN-Variablen werden gemeldet", any("vollständig" in t for t in _f))
chk("und die fehlenden werden BENANNT", any("aWIFI_PASSWORD[0]" in t for t in _f))

# Fehler 3: Laendercode auf DietPis Standard GB -> 5 GHz kann unerreichbar sein
_d = _karte(**{"dietpi_txt": GUT_DT.replace("COUNTRY_CODE=DE", "COUNTRY_CODE=GB"),
               "dietpi__wifi_txt": GUT_WIFI, "cmdline_txt": GUT_CL, "config_txt": GUT_CF})
chk("Laendercode GB wird beanstandet",
    any("Ländercode" in t for t in _fehler(_d, wifi=_wifi)))

# Fehler 4: quiet stehengeblieben -> man saehe beim Booten nichts
_d = _karte(**{"dietpi_txt": GUT_DT, "dietpi__wifi_txt": GUT_WIFI,
               "cmdline_txt": "root=x quiet consoleblank=0\n", "config_txt": GUT_CF})
chk("stehengebliebenes 'quiet' wird gemeldet",
    any("quiet" in t for t in _fehler(_d, debug_display=True)))

chk("fehlende dietpi.txt wird gemeldet",
    any("dietpi.txt" in t for t in _fehler(_karte(**{"config_txt": GUT_CF}))))

# ── Selbstdiagnose der Box: PreScript + Deutung ───────────────────────────
ps = sdprep.diagnose_prescript()
chk("PreScript schreibt auf die Boot-Partition", sdprep.DIAGNOSE_DATEI in ps)
chk("PreScript richtet einen Dienst ein", "wifi-diagnose.service" in ps)
chk("WLAN-Schluessel wird NIE in die Diagnose uebernommen",
    "aWIFI_(SSID|KEYMGR)" in ps and "aWIFI_KEY" not in ps.replace("aWIFI_KEYMGR", ""))
chk("sammelt Funkzustand", "wpa_cli" in ps and "iw dev wlan0 link" in ps)
chk("sammelt Protokoll", "journalctl" in ps)
# Die Verklemmung vom Geraet darf nie zurueckkommen: der Erstboot wartete auf
# den Dienst, der Dienst per After=network.target auf das Netz — und das Netz
# kommt erst NACH dem Erstboot. Schirm stand bei "please wait".
chk("KEINE Ordnung auf network.target", "After=network.target" not in ps)
chk("Start wartet NIE (systemd-run / --no-block)",
    "systemd-run" in ps and "--no-block" in ps)
chk("enable ohne --now (das wuerde warten)", "enable --now" not in ps)

KOPF = "aWIFI_SSID[0]='Heim'\n"
chk("leere Datei -> Diagnose lief nie", sdprep.deute_diagnose("")[0] == "leer")
chk("IPv4 da -> ok (Adresse steht in der Folgezeile)",
    sdprep.deute_diagnose(KOPF + "3: wlan0: <BROADCAST,UP> mtu 1500\n"
                                 "    inet 192.168.178.44/24 brd 192.168.178.255\n")[0] == "ok")
chk("fremde Schnittstelle zaehlt nicht als WLAN",
    sdprep.deute_diagnose(KOPF + "wlan0 vorhanden\n2: eth0: <UP>\n    inet 10.0.0.2/24\n")[0]
    != "ok")
chk("kein wlan0 -> kein Funk", sdprep.deute_diagnose(KOPF)[0] == "kein-funk")
chk("rfkill blockiert -> kein Funk",
    sdprep.deute_diagnose(KOPF + "wlan0\nSoft blocked: yes\n")[0] == "kein-funk")
b = sdprep.deute_diagnose(KOPF + "wlan0 vorhanden\nwpa_state=COMPLETED\n"
                          "dhclient: DHCPDISCOVER on wlan0\n")
chk("verbunden ohne Adresse -> Routerseite", b[0] == "keine-adresse")
chk("... und sagt: DISCOVER unbeantwortet", any("unbeantwortet" in x for x in b[1]))
b = sdprep.deute_diagnose(KOPF + "wlan0\nSSID: Heim\nCTRL-EVENT-ASSOC-REJECT\n")
chk("Netz sichtbar, nie verbunden -> Anmeldung", b[0] == "anmeldung")
chk("... mit Beleg aus dem Protokoll", any("ASSOC-REJECT" in x for x in b[1]))
b = sdprep.deute_diagnose(KOPF + "wlan0\nSSID: Nachbar\nSSID: Anderes\n")
chk("Ziel-Netz nirgends im Scan -> unsichtbar", b[0] == "netz-unsichtbar")
chk("... zaehlt die anderen Netze", any("2 andere" in x for x in b[1]))

# Diagnose und Bildschirm sind GETRENNT schaltbar
for schirm, diag in ((False, False), (True, False), (False, True), (True, True)):
    with _tf.TemporaryDirectory() as d:
        open(os.path.join(d, "dietpi.txt"), "w").write(ORIG)
        open(os.path.join(d, "cmdline.txt"), "w").write("root=x quiet\n")
        open(os.path.join(d, "config.txt"), "w").write("arm_64bit=1\n")
        sdprep.prepare_boot(d, password="pw", wifi=None, ssh_pubkey="",
                            debug_display=schirm, diagnose=diag)
        ps_da = os.path.isfile(os.path.join(d, "Automation_Custom_PreScript.sh"))
        schirm_an = "quiet" not in open(os.path.join(d, "cmdline.txt")).read()
        chk(f"Schirm={schirm} Diagnose={diag} -> PreScript {'da' if diag else 'weg'}, "
            f"Konsole {'sichtbar' if schirm else 'still'}",
            ps_da is diag and schirm_an is schirm)

# ── PAM-Sperre erkennen (sonst sucht man den Fehler im Programm) ──────────
FAILLOCK = """achim:
When                Type  Source                                           Valid
2026-07-26 12:52:29 SVC   polkit-1                                             V
2026-07-26 12:52:42 SVC   polkit-1                                             V
2026-07-26 12:52:58 SVC   polkit-1                                             V
"""
lage = sdprep.faillock_lage(FAILLOCK, deny=3, unlock_time=600)
chk("drei Fehlversuche gezaehlt", lage["versuche"] == 3)
chk("sagt, ab wann es wieder geht", lage["frei_ab"] == "13:02:58")
# Der Fixtext liegt in der Vergangenheit: die Sperre ist laengst abgelaufen.
# Nur zu zaehlen wuerde hier faelschlich "gesperrt" melden.
chk("abgelaufene Sperre gilt nicht mehr", lage["gesperrt"] is False)
# Dieselben drei Fehlversuche, aber gerade eben -> jetzt sperrt es wirklich.
import time as _t
_jetzt = [_t.strftime("%Y-%m-%d %H:%M:%S", _t.localtime(_t.time() - i)) for i in (30, 20, 10)]
_frisch = "kopf:\n" + "\n".join(f"{ts} SVC   polkit-1                     V" for ts in _jetzt) + "\n"
chk("frische Fehlversuche sperren", sdprep.faillock_lage(_frisch, deny=3, unlock_time=600)["gesperrt"] is True)
chk("zwei Versuche sperren noch nicht",
    sdprep.faillock_lage("\n".join(FAILLOCK.splitlines()[:4]) + "\n",
                         deny=3, unlock_time=600)["gesperrt"] is False)
chk("abgelaufene Eintraege (I) zaehlen nicht",
    sdprep.faillock_lage(FAILLOCK.replace(" V", " I"), deny=3, unlock_time=600)["versuche"] == 0)
chk("leere Ausgabe: keine Sperre",
    sdprep.faillock_lage("", deny=3, unlock_time=600)["gesperrt"] is False)

# ── WLANs des Rechners auslesen (Bequemlichkeit, aber fehlervermeidend) ───
_echt_nmcli = sdprep._nmcli


def _nmcli_fake(args, timeout=12):
    if "connection" in args:
        return ["Heimnetz:802-11-wireless", "LAN-Kabel:802-3-ethernet"]
    return [
        "Heimnetz:44:WPA2",
        "Heimnetz:81:WPA2",          # dasselbe Netz, zweites Band
        "Nachbar:33:WPA2",
        ":90:WPA2",                  # verstecktes Netz -> kein Name
        "Doppel:punkt:55:WPA2",      # Doppelpunkt IN der SSID
        "Kaputt",                    # unbrauchbare Zeile
    ]


try:
    sdprep._nmcli = _nmcli_fake
    netze = sdprep.wifi_networks()
    namen = [n["ssid"] for n in netze]
    chk("gespeichertes Netz steht oben", namen[0] == "Heimnetz")
    chk("Doppelsender zusammengefasst", namen.count("Heimnetz") == 1)
    chk("staerkeres Signal gewinnt", netze[0]["signal"] == 81)
    chk("als gespeichert markiert", netze[0]["gespeichert"] is True)
    chk("verstecktes Netz wird weggelassen", "" not in namen)
    chk("Doppelpunkt in der SSID bleibt heil", "Doppel:punkt" in namen)
    chk("kaputte Zeile stuerzt nicht ab", "Kaputt" not in namen)
    chk("fremdes Netz ist nicht gespeichert",
        next(n for n in netze if n["ssid"] == "Nachbar")["gespeichert"] is False)
    sdprep._nmcli = lambda *a, **k: []
    chk("ohne nmcli: leere Liste statt Absturz", sdprep.wifi_networks() == [])

    # Aktives Netz erkennen — nur DESSEN Schluessel ist bewiesen richtig
    # (am Geraet: gespeichertes Profil war veraltet -> WRONG_KEY auf der Box).
    sdprep._nmcli = lambda a, **k: (["no:Nachbar", "ja:Heimnetz", "no:Anderes"]
                                    if "ACTIVE,SSID" in ",".join(a) else [])
    chk("aktives Netz erkannt (deutsches 'ja')", sdprep.wifi_active() == "Heimnetz")
    sdprep._nmcli = lambda a, **k: (["no:Nachbar", "yes:Home"]
                                    if "ACTIVE,SSID" in ",".join(a) else [])
    chk("englisches 'yes' ebenso", sdprep.wifi_active() == "Home")
    sdprep._nmcli = lambda a, **k: ["no:Nachbar"] if "ACTIVE,SSID" in ",".join(a) else []
    chk("kein aktives Netz -> leer", sdprep.wifi_active() == "")
finally:
    sdprep._nmcli = _echt_nmcli

# ── Vor dem Schreiben aushängen (Desktop hängt Karten selbsttätig ein) ────
_gerufen = []
_echt_lbd, _echt_which2, _echt_run2 = sdprep.list_block_devices, sdprep.shutil.which, sdprep.subprocess.run
try:
    sdprep.shutil.which = lambda c: "/usr/bin/udisksctl"
    sdprep.list_block_devices = lambda: {"blockdevices": [
        {"path": "/dev/mmcblk0", "children": [
            {"path": "/dev/mmcblk0p1", "mountpoints": ["/run/media/x/bootfs"]},
            {"path": "/dev/mmcblk0p2", "mountpoints": [None]}]},
        {"path": "/dev/sdb", "children": [
            {"path": "/dev/sdb1", "mountpoints": ["/mnt/fremd"]}]}]}

    class _Erg2:
        returncode, stderr, stdout = 0, "", ""
    sdprep.subprocess.run = lambda a, **k: (_gerufen.append(a), _Erg2())[1]
    sdprep.unmount_all("/dev/mmcblk0")
    _ziele = [a[-1] for a in _gerufen]
    chk("eingehängte Partition wird ausgehängt", "/dev/mmcblk0p1" in _ziele)
    chk("nicht eingehängte bleibt unberührt", "/dev/mmcblk0p2" not in _ziele)
    chk("FREMDES Geraet wird nie angefasst", "/dev/sdb1" not in _ziele)
finally:
    sdprep.list_block_devices, sdprep.shutil.which = _echt_lbd, _echt_which2
    sdprep.subprocess.run = _echt_run2

# ── Ausgabe MITLESEN: dd trennt Fortschritt mit \r, Fehler mit \n ─────────
_zeilen = []
_rc = sdprep.run_streaming(
    ["bash", "-c", "printf 'a\rb\rc\n'; printf 'Fehler\n' >&2; exit 3"], _zeilen.append)
chk("Rueckgabecode durchgereicht", _rc == 3)
chk("Fortschritt (\r) wird getrennt", ["a", "b", "c"] == _zeilen[:3])
chk("stderr landet im Protokoll", "Fehler" in _zeilen)

# ── DER VORSTART DARF NICHT AUFGEBEN ─────────────────────────────────────
# Am 09.08.2026 lief der ganze Handy-Weg zum ersten Mal sauber durch, und
# dann scheiterte DietPis Erstinstallation an einem wackligen WLAN
# (674 kB in 4min30). Der Vorstart meldete "fertig" und ging — die Box
# landete auf "MixPiBox login:", eine Sackgasse fuer jemanden mit nur einem
# Touchscreen. Diese Zeilen halten die Behebung fest.
print("\n── Vorstart: schwaches Netz ist kein Grund aufzuhoeren ──")
_v = sdprep.vorstart_skript()

chk("Skript ist gueltige Shell",
    __import__("subprocess").run(["bash", "-n"], input=_v, text=True).returncode == 0)

# 1) Der Schirm holt sich Python SELBST. Vorher stand im Log der Karte
#    "line 88: PY: unbound variable", und der MixPi-Schirm kam den ganzen
#    Boot nicht hoch: die Box zeigte DietPis Textwand.
_schirm = _v.split("schirm_sicherstellen() {")[1].split("\n}")[0]
chk("Schirm borgt sich $PY nicht, sondern sucht selbst",
    "${PY:-" in _schirm and 'setsid "$P"' in _schirm)

# 2) Aufgeben ist ausgeschlossen: die Schleife laeuft, BIS es steht.
chk("es wird wiederholt, bis das Grundsystem steht",
    "until dietpi_weiterfuehren; do" in _v)
chk("und der Bildschirm sagt waehrenddessen, was los ist",
    "phase netzschwach" in _v)
chk("nicht fertig heisst Rueckgabe 1 — sonst merkt es der Aufrufer nie",
    "  return 1\n}" in _v)

# 3) apt bekommt Geduld — genau die Fristen, an denen es scheiterte.
chk("apt wiederholt und wartet laenger",
    'Acquire::Retries "6";' in _v and 'Acquire::https::Timeout "60";' in _v)

# 4) Der Namensdienst bekommt ein zweites Bein und wird an DREI Namen
#    geprueft. Ein einzelnes getent kann zufaellig durchkommen, waehrend die
#    Leitung fuer alles andere zu schwach ist.
chk("oeffentlicher Namensserver als zweites Bein",
    "nameserver 9.9.9.9" in _v)
_dns = _v.split("dns_wirklich_da() {")[1].split("\n}")[0]
chk("drei Namen geprueft, zwei muessen antworten",
    _dns.count("deb.debian.org") and "dietpi.com" in _dns
    and "raw.githubusercontent.com" in _dns and '-ge 2' in _dns)

# 5) Die Selbsterneuerung muss VOR dem Kopieren entscheiden. Stand der
#    Vergleich dahinter, verglich er $0 mit der Datei, die gerade ueber $0
#    kopiert worden war — immer "gleich", das exec feuerte nie, und eine
#    aufgefrischte Karte wirkte erst einen Boot spaeter.
_vor = _v.index("NEUER=nein")
_kopie = _v.index('cp -a "$Q"/. "$E"/')
_exec = _v.index('exec "$E/vorstart.sh"')
chk("erst vergleichen, dann kopieren", _vor < _kopie < _exec)
chk("verglichen wird die Karte gegen das laufende Skript",
    'cmp -s "$Q/vorstart.sh" "$0"' in _v)
chk("eine kaputte Fassung von der Karte wird zurueckgerollt",
    'cp "$SICHER" "$E/vorstart.sh"' in _v)

# 6) Unvollstaendige Paketlisten sind der zweite Killer: der gescheiterte
#    erste Lauf hinterliess apt ohne Haupt-Repo, und DietPi sperrt sein
#    eigenes apt-update eine Stunde lang — auch nach einem GESCHEITERTEN.
#    Ohne eigenen Nachschlag waren die sechs Anlaeufe sechsmal dasselbe.
chk("Paketlisten werden vor dietpi-software geprueft",
    "paketlisten_holen ||" in _v)
chk("geprueft wird am Paket, an dem es starb",
    'apt-cache policy openssh-client' in _v)

# 7) Auf einer FERTIGEN Box hat der Einrichtungsschirm nichts mehr zu malen.
#    Der Vorstart laeuft bei jedem Boot; ohne diese Bremse zeichnete er in
#    denselben Bildspeicher wie MuPiBox' Startbildschirm — am Geraet als
#    "der install boot screen rueckt durch den mupi bootscreen" zu sehen.
_ss = _v.split("schirm_sicherstellen() {")[1].split("\n}")[0]
chk("fertige Box: der Einrichtungsschirm bleibt aus",
    "/var/lib/mixpibox-lauf/fertig" in _ss)
chk("und zwar BEVOR irgendetwas gestartet wird",
    _ss.index("/var/lib/mixpibox-lauf/fertig") < _ss.index("setsid"))

# ── Rueckmeldung, wenn kein Netz besteht ───────────────────────────────────
# Betreiber, 31.08.2026, nach einem Lauf, der eine halbe Stunde bei 7 % stand:
# „ich habe gemerkt das wir keine rueckmeldung das kein netz besteht".
# Diese Tests fahren KEIN Netz an — `netz_pruefen` und `_get` werden ersetzt.
import socket as _socket  # noqa: E402


class _FakeAntwort:
    """Spielt eine HTTP-Antwort, deren Fenster mal leer bleiben.

    `plan` ist eine Liste: bytes = liefert Daten, None = Lesefenster laeuft ab
    (socket.timeout), b"" = sauberes Ende."""

    def __init__(self, plan, total=None):
        self.plan, self.headers = list(plan), {}
        gesamt = sum(len(x) for x in plan if isinstance(x, bytes))
        self.headers["Content-Length"] = str(total if total is not None else gesamt)

    def read(self, _n=None):
        if not self.plan:
            return b""
        x = self.plan.pop(0)
        if x is None:
            raise _socket.timeout("Lesefenster leer")
        return x

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _mit_netz(fn, *, plan, total=None, geduld=None):
    """download() gegen die Attrappe fahren; gibt (ergebnis, hinweise, fehler)."""
    echt_get, echt_pruefen, echt_geduld = sdprep._get, sdprep.netz_pruefen, sdprep.GEDULD_S
    sdprep._get = lambda url, timeout=60: _FakeAntwort(plan, total)
    sdprep.netz_pruefen = lambda *a, **k: (True, "")
    if geduld is not None:
        sdprep.GEDULD_S = geduld
    hinweise, fehler, erg = [], None, None
    try:
        erg = fn(hinweise)
    except sdprep.KeinNetz as f:
        fehler = str(f)
    finally:
        sdprep._get, sdprep.netz_pruefen, sdprep.GEDULD_S = echt_get, echt_pruefen, echt_geduld
    return erg, hinweise, fehler


_tmp = tempfile.mkdtemp()
_ziel = os.path.join(_tmp, "abbild.img.xz")

# 1. Leeres Fenster -> es MUSS eine Rueckmeldung geben (der eigentliche Wunsch)
_erg, _hin, _fehler = _mit_netz(
    lambda h: sdprep.download("http://x/y", _ziel,
                              on_hinweis=lambda t: h.append(t)),
    plan=[b"AAA", None, b"BBB", b""])
chk("Stillstand: es kommt eine Rueckmeldung (statt stummem Balken)", len(_hin) >= 1)
chk("Stillstand: die Meldung nennt das Netz",
    any("Netzverbindung" in t for t in _hin))
chk("Stillstand: Erholung wird auch gemeldet",
    any("wieder da" in t for t in _hin))
chk("Stillstand: der Download laeuft danach zu Ende", _erg == _ziel and _fehler is None)
chk("Stillstand: alle Bytes sind angekommen",
    os.path.isfile(_ziel) and open(_ziel, "rb").read() == b"AAABBB")

# 2. Geduld erschoepft -> KeinNetz, und die Zieldatei entsteht NICHT.
#    Ein halb geladenes Abbild als fertig liegenzulassen waere schlimmer als
#    der Abbruch: das Schreiben darauf ergaebe eine Karte, die halb bootet.
os.remove(_ziel)
_erg, _hin, _fehler = _mit_netz(
    lambda h: sdprep.download("http://x/y", _ziel,
                              on_hinweis=lambda t: h.append(t)),
    plan=[b"AAA", None, None, None], geduld=0)
chk("Geduld erschoepft: KeinNetz geworfen", _fehler is not None)
chk("Geduld erschoepft: Zieldatei NICHT angelegt", not os.path.exists(_ziel))
chk("Geduld erschoepft: die Meldung ist ein lesbarer Satz",
    _fehler is not None and ("kein Byte" in _fehler or "nicht erreichbar" in _fehler))

# 3. Abbruch mitten drin (Content-Length groesser als geliefert)
_erg, _hin, _fehler = _mit_netz(
    lambda h: sdprep.download("http://x/y", _ziel, on_hinweis=lambda t: h.append(t)),
    plan=[b"AAA", b""], total=999)
chk("Unvollstaendig: als Fehler erkannt, nichts uebernommen",
    _fehler is not None and "unvollstaendig" in _fehler.lower()
    and not os.path.exists(_ziel))

# 4. netz_pruefen trennt „Name nicht aufloesbar" von „niemand nimmt ab"
_steht, _grund = sdprep.netz_pruefen("kein.host.invalid", 443, timeout=2)
chk("netz_pruefen: unaufloesbarer Name wird als solcher gemeldet",
    _steht is False and "aufloesen" in _grund)

# 5. GEGENPROBE: ohne leeres Fenster darf KEINE Rueckmeldung kommen — eine
#    Wache, die immer meldet, ist so nutzlos wie eine, die nie meldet.
_erg, _hin, _fehler = _mit_netz(
    lambda h: sdprep.download("http://x/y", _ziel, on_hinweis=lambda t: h.append(t)),
    plan=[b"AAA", b"BBB", b""])
chk("Gegenprobe: glatter Lauf meldet NICHTS", _hin == [] and _fehler is None)
shutil_rmtree = __import__("shutil").rmtree
shutil_rmtree(_tmp, ignore_errors=True)


# ── Wo liegt der Fork? (fork_wurzel / ist_fork) ────────────────────────────
#
# DIE HUERDE, DIE DAS AUFLOEST: `prepare_boot` nahm `~/Downloads/MuPiBox` an —
# den Pfad des Betreibers. Ein Klon von GitHub an anderer Stelle bekam eine
# Karte ohne Rezeptquellen, gemeldet nur als eine Zeile im Protokoll. Geprueft
# wird hier deshalb BEIDES: dass ein echter Fork erkannt wird, und dass ein
# beliebiger Ordner es NICHT wird — eine Erkennung, die immer ja sagt, ist
# schlimmer als keine.
_fw = tempfile.mkdtemp(prefix="forkprobe-")
_echt = os.path.join(_fw, "fork")
for _t in ("config/templates", "scripts", "plugins"):
    os.makedirs(os.path.join(_echt, _t), exist_ok=True)
open(os.path.join(_echt, "config/templates/mupiboxconfig.json"), "w").write("{}")
_leer = os.path.join(_fw, "leer")
os.makedirs(_leer, exist_ok=True)
_halb = os.path.join(_fw, "halb")               # nur zwei der drei Merkmale
os.makedirs(os.path.join(_halb, "scripts"), exist_ok=True)
os.makedirs(os.path.join(_halb, "plugins"), exist_ok=True)

chk("ist_fork: Ordner mit allen drei Merkmalen", sdprep.ist_fork(_echt) is True)
chk("ist_fork: leerer Ordner ist KEIN Fork", sdprep.ist_fork(_leer) is False)
chk("ist_fork: zwei von drei Merkmalen reichen NICHT", sdprep.ist_fork(_halb) is False)
chk("ist_fork: nicht vorhandener Pfad", sdprep.ist_fork(os.path.join(_fw, "gibtsnicht")) is False)

_pfad, _woher = sdprep.fork_wurzel(_echt)
chk("fork_wurzel: die Vorgabe gewinnt", _pfad == _echt and _woher == "uebergeben")

_vorher = os.environ.get("MUPI_REPO")
os.environ["MUPI_REPO"] = _echt
_pfad, _woher = sdprep.fork_wurzel()
chk("fork_wurzel: $MUPI_REPO wird gelesen", _pfad == _echt and _woher == "$MUPI_REPO")
os.environ["MUPI_REPO"] = _leer
_pfad, _woher = sdprep.fork_wurzel()
chk("fork_wurzel: $MUPI_REPO ohne Merkmal wird uebergangen", _pfad != _leer)
if _vorher is None:
    os.environ.pop("MUPI_REPO", None)
else:
    os.environ["MUPI_REPO"] = _vorher

# DER NORMALFALL, UND DER EIGENTLICHE PUNKT: Dieser Installer LIEGT im Fork
# (ZUGEZOGEN.md, 08.08.2026). Also findet er ihn ohne jede Vorgabe — egal,
# wohin jemand das Repo geklont hat.
_pfad, _woher = sdprep.fork_wurzel()
# DIE HERKUNFT MUSS MITGEPRUEFT WERDEN, nicht nur der Pfad: auf dem Rechner des
# Betreibers IST ~/Downloads/MuPiBox der Fork — der Pfad allein stimmt also auch
# dann, wenn die Elternordner-Suche kaputt ist und der alte Standard greift.
# Bei der Mutationsprobe (repo_root -> /tmp) faellt genau diese Zeile.
chk("fork_wurzel: findet den Fork ohne Vorgabe (Elternordner)",
    sdprep.ist_fork(_pfad) and _woher == "Elternordner des Installers"
    and _pfad == os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.abspath(sdprep.__file__)))))

# Eine falsche Vorgabe wird nicht still uebergangen, sondern gesagt.
_pfad, _woher = sdprep.fork_wurzel(_leer)
chk("fork_wurzel: abgelehnte Vorgabe steht in der Herkunft",
    sdprep.ist_fork(_pfad) and "sah nicht wie der Fork aus" in _woher)

# ── ${MUPI_REPO:-…} wird GESUCHT, nicht geraten (core.expand_path) ─────────
#
# Der ferngesteuerte Lauf holt seine Dateien aus `${MUPI_REPO:-…}`. Bis zum
# 23.09.2026 war der Ersatzwert der Pfad EINES Rechners; auf jedem anderen
# starb der Lauf erst in dem Schritt, der die Datei hochladen sollte. Jetzt
# fragt `expand_path` denselben Finder wie der SD-Assistent — geprueft wird
# beides: dass er greift, und dass eine gesetzte Variable IHN schlaegt.
import core                                                     # noqa: E402

_altes_repo = os.environ.pop("MUPI_REPO", None)
_aufgeloest = core.expand_path("${MUPI_REPO:-/gibtsnicht}/bin/nodejs/deploy.zip")
chk("expand_path: ohne MUPI_REPO greift der Fork-Finder",
    sdprep.ist_fork(os.path.dirname(os.path.dirname(os.path.dirname(_aufgeloest))))
    and not _aufgeloest.startswith("/gibtsnicht"))

os.environ["MUPI_REPO"] = _echt
chk("expand_path: eine gesetzte Variable schlaegt den Finder",
    core.expand_path("${MUPI_REPO:-/gibtsnicht}/x") == _echt + "/x")
os.environ.pop("MUPI_REPO", None)

chk("expand_path: andere Variablen bleiben unberuehrt",
    core.expand_path("${GIBTESNICHT_XY:-/ersatz}/x") == "/ersatz/x")

# GEGENPROBE ZUM FINDER: sieht nichts wie der Fork aus, gilt wieder der
# Ersatzwert aus dem Rezept — sonst schoebe die Auskunft einen falschen Pfad
# unter, statt die alte, bekannte Fehlermeldung zu liefern.
_repo_alt = core.repo_root
_home_alt = os.environ.get("HOME")
try:
    core.repo_root = lambda: os.path.join(_fw, "nirgends", "controller")
    os.environ["HOME"] = _fw
    chk("expand_path: findet er nichts, gilt der Ersatzwert des Rezepts",
        core.expand_path("${MUPI_REPO:-/ersatzwert}/x") == "/ersatzwert/x")
finally:
    core.repo_root = _repo_alt
    if _home_alt is not None:
        os.environ["HOME"] = _home_alt
if _altes_repo is not None:
    os.environ["MUPI_REPO"] = _altes_repo

shutil_rmtree2 = __import__("shutil").rmtree
shutil_rmtree2(_fw, ignore_errors=True)

print(f"\n{ok}/{ok + bad} bestanden")
sys.exit(1 if bad else 0)
