#!/usr/bin/env python3
"""
Test fuer `connect --watch`: Verbindungsverlust MELDEN und selbst wieder verbinden.

Simuliert einen Reboot (Agent stirbt, kommt mit NEUEM Pair-Code zurueck) und prueft,
dass die Schleife das meldet, die Rueckkehr erkennt und selbsttaetig neu pairt.
SSH/Tunnel sind gefaelscht — geprueft wird die Zustandslogik, nicht das Netz.

  python3 tests/watch_test.py        # 4 Checks, exit 0 = alles gruen
"""
import io, sys, time, threading, subprocess, os, re
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO+"/controller")
import connect
from core import Agent

PORT = 8271
# Agent A starten
def start():
    p = subprocess.Popen([sys.executable, REPO+"/agent/agent.py","--port",str(PORT),
                          "--paircode-file","/tmp/wt-pc"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(200):
        if os.path.exists("/tmp/wt-pc"): break
        time.sleep(0.02)
    return p
os.path.exists("/tmp/wt-pc") and os.remove("/tmp/wt-pc")
a = start()
connect.pair(f"http://127.0.0.1:{PORT}", open("/tmp/wt-pc").read().strip())

# watch() faelschen: kein echtes SSH — wir simulieren "Box erreichbar" + Neu-Pairing
connect.ssh_reachable = lambda h,p=22,timeout=4: True
connect._kill_stale_tunnel = lambda *a, **k: None
connect.open_tunnel = lambda *a, **k: True
connect.fetch_paircodes = lambda *a, **k: [open("/tmp/wt-pc").read().strip()] if os.path.exists("/tmp/wt-pc") else []

out = io.StringIO()
real_print = print
def cap(*args, **kw):
    real_print(*args, **{**kw, "file": out})
connect.print = cap          # nur die Ausgaben von say() abfangen
import builtins
orig_say = connect.say
connect.say = lambda k, s: out.write(s + "\n")

def stop_later():
    time.sleep(7); a.terminate(); a.wait(timeout=5)          # "Reboot"
    time.sleep(6); os.remove("/tmp/wt-pc"); b = start()      # Box kommt zurueck (NEUER Code)
    time.sleep(14); b.terminate()
    os._exit_flag = True
t = threading.Thread(target=stop_later, daemon=True); t.start()

def stopper():
    time.sleep(32)
    import _thread; _thread.interrupt_main()
threading.Thread(target=stopper, daemon=True).start()
try:
    connect.watch("testhost", local=PORT)
except (KeyboardInterrupt, SystemExit):
    pass
connect.say = orig_say
log = out.getvalue()
real_print("── Ausgabe von --watch ──")
for l in log.splitlines(): real_print("   ", l.strip())
real_print()
checks = [
    ("Start als verbunden erkannt", "Start: verbunden" in log),
    ("Verlust GEMELDET",            "Verbindung weg" in log),
    ("Rückkehr erkannt",            "SSH ist wieder da" in log or "wieder verbunden" in log),
    ("selbsttätig neu gepairt",     "wieder verbunden" in log),
]
bad = 0
for n,c in checks:
    real_print(("  \033[32mOK  \033[0m" if c else "  \033[31mFAIL\033[0m")+"  "+n); bad += (not c)
real_print(f"\n{len(checks)-bad}/{len(checks)} bestanden")
sys.exit(1 if bad else 0)
