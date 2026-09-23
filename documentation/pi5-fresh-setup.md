# MuPiBox — Frisch-Setup (Raspberry Pi 5, Waveshare 5" DSI)

Komplette Anleitung zum Sauberaufsetzen dieser MuPiBox-Version auf einer frischen
SD, für einen **Raspberry Pi 5** mit **Waveshare 5inch DSI LCD (800×480)** am
Port **DSI1**. Läuft genauso auf einem Pi 4 (die SD ist dual-tauglich).

> Alles, was wir uns bei der ersten Runde erarbeitet haben, ist hier eingebaut:
> der richtige SD-Pfad, WLAN, der Pi-5-Grafik-Fix (KMS), das Waveshare-Overlay,
> `rpi-lgpio` und der Spotify-Login. Einfach von oben nach unten abarbeiten.

---

## Was gebraucht wird
- Laptop mit diesem Repo unter `~/Downloads/MuPiBox` (aktueller Stand — `git pull`)
- microSD (≥ 8 GB) + Kartenleser
- **Raspberry Pi Imager** (`sudo pacman -S rpi-imager` / raspberrypi.com/software)
- WLAN-Name + Passwort

---

## 1 · DietPi auf die SD flashen
1. **Raspberry Pi Imager** öffnen → **Choose OS** → *DietPi* (bzw. das DietPi-Image
   „Raspberry Pi 2/3/4/5, ARMv8, 64-bit" von dietpi.com) → **Choose Storage** = die SD
   → **Write**.
2. SD einmal raus und wieder rein, damit sie neu gemountet wird.

---

## ⚡ Schnellweg — EIN Befehl (empfohlen)
Statt der manuellen Schritte 2–4 + 6 macht **ein Skript** alles: die SD automatisch
finden (kein Pfad-Raten), unsere Version einbacken, WLAN setzen **und das
Waveshare-Display vorkonfigurieren**, sodass der Pi 5 direkt **mit Bild** hochkommt:
```sh
cd ~/Downloads/MuPiBox
scripts/flash-mupibox-sd.sh --wifi 'DEIN_WLAN_SSID'
```
- Das WLAN-**Passwort** wird versteckt abgefragt.
- Am Ende zeigt es den Auswerf-Befehl + die Pi-Schritte.
- Danach **direkt weiter bei Schritt 5** (SD in den Pi).
- Optionen: `--no-waveshare` (Display nicht vorkonfigurieren), `--help`.

> Die nummerierten Schritte 2–4/6 unten sind nur die **manuelle Alternative** —
> das Skript macht genau das.

---

## 2 · Den echten Boot-Pfad finden
Wichtig: dieser Rechner mountet die SD **NICHT** unter `/media/achim/bootfs`,
sondern unter `/run/media/achim/<SERIENNUMMER>`. Erst den Pfad rausfinden:

```sh
lsblk -o NAME,SIZE,FSTYPE,LABEL,MOUNTPOINT | grep -i vfat
```
Die **vfat**-Zeile (~128 MB) ist die Boot-Partition, z. B.
`/run/media/achim/FCC6-0430`. Den Pfad merken.

---

## 3 · Unsere Version + WLAN einbacken
```sh
cd ~/Downloads/MuPiBox
git pull   # falls es Updates gab

# <BOOT> durch den Pfad aus Schritt 2 ersetzen, <SSID> durch deinen WLAN-Namen:
scripts/make-boot-sd.sh /run/media/achim/FCC6-0430 --wifi 'DEIN_WLAN_SSID'
```
- Das WLAN-**Passwort** wird danach **versteckt** abgefragt (kommt nicht in die
  History), eintippen + Enter.
- Das Skript backt diese Repo-Version (`MuPiBox-4.3.0.tgz` inkl. der fertig
  gebauten `bin/nodejs/deploy.zip` mit allen Fixes) + das autosetup + den
  DietPi-First-Boot-Installer auf die SD.

Fehlt WLAN mal (Ethernet-Betrieb), einfach `--wifi …` weglassen.

---

## 4 · SD sicher auswerfen
```sh
sync
udisksctl unmount -b /dev/sda1
udisksctl unmount -b /dev/sda2
```
(`/dev/sda` ggf. an dein Gerät aus `lsblk` anpassen.) Dann SD rausziehen.

---

## 5 · In den Pi 5, erster Boot
1. SD in den Pi 5, Display-FPC an **DSI1** (der Port näher an den Kamera-Anschlüssen).
2. Strom dran, einschalten.
3. Der erste Boot macht **automatisch**: DietPi-Grundsetup → unser MuPiBox-Installer.
   Das dauert **10–20 min** (lädt Node, Chromium, Abhängigkeiten).

**Mitlesen per SSH** (der Pi meldet sich per WLAN im Netz an):
```sh
ssh dietpi@<box-ip>        # erstes Passwort: dietpi
tail -f /var/tmp/mupibox-firstboot.log
```
> Das DietPi-Image ist **Debian 13 (Trixie)** — neuer als das getestete Bookworm.
> Läuft in aller Regel; falls der Installer an einem Paket hängt, die Fehlerzeile
> aus dem Log notieren.

---

## 6 · Display: Waveshare 5" DSI auf dem Pi 5 (falls der Schirm schwarz bleibt)
Der Pi 5 kann **nur volles KMS** (`vc4-kms-v3d`) — kein Legacy-Framebuffer. Das
generische autosetup ist ab dieser Version schon Pi-5-fest, aber falls der Schirm
nach dem Reboot **schwarz** bleibt, das hier per SSH auf der Box ausführen (setzt
KMS + das Waveshare-Overlay, räumt alte/falsche Grafik-Zeilen weg):

```sh
CFG=/boot/firmware/config.txt
sudo cp "$CFG" "$CFG.bak"

# Legacy/falsche Grafik-Reste raus (fkms, offizielles 7"-Overlay, Legacy-Framebuffer):
sudo sed -i -E '/vc4-fkms-v3d/d; /vc4-kms-dsi-7inch/d; /^framebuffer_width=/d; /^framebuffer_height=/d' "$CFG"

# Volles KMS + Waveshare 5" DSI (800x480) auf DSI1 — jeweils nur einmal:
grep -q '^dtoverlay=vc4-kms-v3d'                         "$CFG" || echo 'dtoverlay=vc4-kms-v3d'                         | sudo tee -a "$CFG"
grep -q 'vc4-kms-dsi-waveshare-panel,5_0_inch'          "$CFG" || echo 'dtoverlay=vc4-kms-dsi-waveshare-panel,5_0_inch' | sudo tee -a "$CFG"

sudo reboot
```
Nach dem Reboot kommen **Bild + Touch** (der Waveshare-Overlay bringt den Touch mit).
- Auf **DSI0** statt DSI1 wäre es `…waveshare-panel,5_0_inch,dsi0`.
- Anderes Panel? Verfügbare Größen zeigt `dtoverlay -h vc4-kms-dsi-waveshare-panel`.

---

## 7 · Spotify-Login
Vom Laptop aus im Browser:
```
https://<box-ip>:8200
```
öffnen und bei Spotify einloggen (siehe auch `documentation/hardware-test.md`).
Der Login liegt pro Gerät lokal — einmal pro frischer Box nötig.

---

## 8 · Optional
- **Theme** (Standard ist „blue"): in der Box-Config `mupibox.theme` z. B. auf
  `axolotl` setzen (Admin → MuPi-Conf oder JSON-Editor).
- **MuPiHAT** (Akku/Audio, falls verbaut): die GPIO-Skripte laufen dank
  `rpi-lgpio` (ist eingebacken) auf dem Pi 5. Audio ist **MAX98357A** (nicht das
  generische `hifiberry-dac`) — falls kein Ton kommt, hier melden, dann ziehen wir
  die Audio-Config nach. **Wichtig:** MuPiHAT **Rev 3.4.1+** für den Pi 5 (ältere
  Rev 3.x haben ein Power-Ramp-Problem).

---

## Troubleshooting (kurz)
| Symptom | Erste Hilfe |
|---|---|
| **Schwarzer Schirm**, SSH geht | Schritt 6 (Display-Fix) ausführen. Bleibt es schwarz: `cat /boot/firmware/config.txt`, `dmesg \| grep -iE 'dsi\|drm\|panel'`, `ls /boot/firmware/overlays/vc4-kms-dsi-waveshare-panel.dtbo` schicken. |
| **Kein SSH / Box nicht im Netz** | WLAN in Schritt 3 vergessen? SD nochmal mit `--wifi …` einbacken, oder LAN-Kabel. |
| **Installer hängt** (Trixie/Paket) | Zeile aus `/var/tmp/mupibox-firstboot.log` schicken. |
| **App lädt nicht** (`:8200`) | `journalctl -u mupibox-server -f` auf der Box (mit `sudo`, sonst „No journal files were opened"); neu starten mit `sudo systemctl restart mupibox-server mupibox-player`. Zustand: `systemctl status mupibox-server`. |
| **Ganz neu anfangen** | Ab Schritt 1 wiederholen (SD neu flashen). |

---

*Stand: Repo-Commit siehe `git log`. Diese SD ist dual-tauglich (Pi 4 + Pi 5); der
Waveshare-/DSI1-Teil in Schritt 6 ist Pi-5-spezifisch.*
