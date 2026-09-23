"""Miss den Speicherabdruck eines Python-Prozesses nach einem Import.

Aufruf:  python3 tools/import-abdruck-messen.py <name> [modul ...]
Liest die eigene smaps_rollup vor und nach den Importen und gibt
Rss/Pss/Pss_Anon in kB sowie die Zahl geladener Module aus.
Kurzlebig: startet keinen Dienst, oeffnet keinen Bus.
"""
import sys, time

def werte():
    d = {}
    for z in open("/proc/self/smaps_rollup"):
        t = z.split()
        if t and t[0].rstrip(":") in ("Rss", "Pss", "Pss_Anon", "Pss_File", "Private_Dirty"):
            d[t[0].rstrip(":")] = int(t[1])
    return d

name = sys.argv[1]
mods = sys.argv[2:]
vor = werte()
n_vor = len(sys.modules)
t0 = time.monotonic()
for m in mods:
    __import__(m)
dt = time.monotonic() - t0
nach = werte()
n_nach = len(sys.modules)
print("%-22s Rss=%6d Pss=%6d PssAnon=%6d PssFile=%5d Module=%4d(+%d) Importzeit=%.2fs"
      % (name, nach["Rss"], nach["Pss"], nach["Pss_Anon"], nach["Pss_File"],
         n_nach, n_nach - n_vor, dt))
