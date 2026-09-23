# librespot auf der Box

**Fassung >= 0.8.0 ist Pflicht.** Aeltere Staende fragen einen ueberholten
Metadaten-Endpunkt ab, der keine Tondatei mehr mitliefert; jeder Titel meldet
dann „not available" und es kommt kein Ton. Im A/B-Test belegt (2026-07-28,
gleiche Anmeldung, gleiches Album): 0.6.0-dev stumm, 0.8.0 spielt.

librespot-org veroeffentlicht **keine fertigen Binaerdateien** — selber bauen:

```bash
sudo apt-get install -y build-essential pkg-config libasound2-dev libssl-dev
curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
git clone --depth 1 --branch v0.8.0 https://github.com/librespot-org/librespot.git
cd librespot
CARGO_BUILD_JOBS=2 cargo build --release --no-default-features \
  --features "native-tls,alsa-backend,rodio-backend,with-libmdns"
sudo install -m755 target/release/librespot /usr/bin/librespot
```

Zwei Fallstricke beim Bau:
- **`CARGO_BUILD_JOBS=2`** — mit allen vier Kernen reicht der Speicher des
  Pi 5 (2 GB) nicht.
- **`native-tls` mit angeben** — seit 0.7.0 muss die TLS-Umsetzung
  ausdruecklich gewaehlt werden; mit `--no-default-features` allein bricht
  der Bau in `librespot-oauth` ab.

Nach einem Tausch **beide** Dienste neu starten: librespot bekommt eine neue
Geraetekennung, und `spotify-control` merkt sich die alte (nimmt Befehle dann
mit HTTP 200 an, spielt aber nicht).

```bash
sudo systemctl restart librespot && pm2 restart spotify-control
```
