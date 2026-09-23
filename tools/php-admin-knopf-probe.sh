#!/usr/bin/env bash
#
# HISTORISCH SEIT E47 (19.08.2026) — DIESE PROBE KANN NICHT MEHR LAUFEN.
# Sie haengt `AdminInterface/www` in einen Container; der Ordner liegt seit E47
# nicht mehr im Baum (null versionierte Dateien, null `.php` im ganzen Baum).
# Kein Laeufer ruft sie; sie steht hier als Beleg, wie der Beweis gefuehrt
# wurde. Wer sie wiederbeleben will, braucht zuerst den Baum aus der Historie.
# Vermerkt am 26.08.2026 im Doku-Lauf, gleiche Familie wie das tote
# `admin`-Profil in `harness/docker-compose.yml`.
#
# WOZU: Beweist, dass der Update-Knopf des alten PHP-Admins NICHTS mehr tut —
# indem er ihn wirklich drueckt. Statisches Lesen (php-admin-fremdbezug-schau.py)
# sagt nur, dass die Zeile weg ist; hier wird der POST abgeschickt.
#
# WARUM DAS UEBERHAUPT GEHT, OHNE ETWAS ZU INSTALLIEREN — drei Vorkehrungen:
#   1. --network none. Der Container hat NUR die Rueckschleife. Selbst wenn
#      irgendwo noch ein `curl … | bash` steckte, kaeme es nicht ins Netz.
#      Das ist die Vorkehrung, auf die man sich verlassen kann; die anderen
#      beiden sind Bequemlichkeit.
#   2. AdminInterface/www haengt SCHREIBGESCHUETZT (:ro) drin.
#   3. --rm, eigenes Dateisystem. Was der Container kaputtmacht, ist danach weg.
#
# ACHTUNG, DIE FALLE AUS harness/admin-entrypoint.sh: dort wird `sudo` auf `env`
# gemappt, damit die Seiten rendern. Das heisst: ein `sudo bash` LAEUFT dann
# wirklich. Genau deshalb steht hier --network none und nicht "wir passen auf".
#
# AUFRUF:
#   tools/php-admin-knopf-probe.sh
#
# RUECKGABE: 0 wenn jeder gefaehrliche POST mit der Sperrmeldung antwortet und
# die Seiten OHNE NETZ rendern; sonst 1.
set -u

WURZEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BILD="php:8.3-cli"

if ! command -v docker >/dev/null 2>&1; then
	echo "docker fehlt — Probe uebersprungen (kein Fehler, aber auch kein Beweis)."
	exit 0
fi

# Das Pruefskript laeuft IM Container. Es startet php -S auf der Rueckschleife
# und schickt die POSTs mit PHP selbst — das Bild php:8.3-cli bringt kein curl mit.
LAUF=$(cat <<'INNEN'
set -e
ln -sf /usr/bin/env /usr/local/bin/sudo
mkdir -p /etc/mupibox /home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config
cat > /etc/mupibox/mupiboxconfig.json <<'JSON'
{"mupibox":{"version":"4.2.0-fork","host":"mupibox","ip_control_backend":false},
 "chromium":{"debug":0},
 "interfacelogin":{"state":false,"password":""},
 "tweaks":{"vnc":"0"}}
JSON
echo '[]' > /home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config/data.json

php -d display_errors=1 -d error_reporting=E_ALL -S 127.0.0.1:8300 -t /var/www/admin >/tmp/server.log 2>&1 &
sleep 2

php -r '
$fehler = 0;

/* Die POSTs, die frueher den Fork geloescht haetten. Jeder muss mit der
   Sperrmeldung antworten — NICHT mit "Update complete". */
$knoepfe = [
  "mupibox_update"      => "MuPiBox-Update (stable)",
  "mupibox_update_beta" => "MuPiBox-Update (beta)",
  "mupibox_update_dev"  => "MuPiBox-Update (development)",
  "config_update"       => "Konfigurations-Nachzug vom Upstream",
  "resetMupiConf"       => "Werkseinstellung",
];
foreach ($knoepfe as $feld => $erwartet) {
  $ctx = stream_context_create(["http" => [
    "method" => "POST",
    "header" => "Content-Type: application/x-www-form-urlencoded",
    "content" => http_build_query([$feld => "1"]),
    "timeout" => 20,
    "ignore_errors" => true,
  ]]);
  $antwort = @file_get_contents("http://127.0.0.1:8300/admin.php", false, $ctx);
  if ($antwort === false) {
    printf("  FEHLER  POST %-22s keine Antwort (Seite gestorben?)\n", $feld);
    $fehler = 1;
    continue;
  }
  $gesperrt = strpos($antwort, "Gesperrt:") !== false;
  $vollzug  = strpos($antwort, "Update complete") !== false
           || strpos($antwort, "is set to initial") !== false;
  if ($gesperrt && !$vollzug) {
    printf("  ok      POST %-22s -> gesperrt\n", $feld);
  } else {
    printf("  FEHLER  POST %-22s gesperrt=%d vollzogen=%d\n", $feld, $gesperrt, $vollzug);
    $fehler = 1;
  }
}

/* Und: die Seiten muessen OHNE NETZ ueberhaupt erscheinen. Vor der Aenderung
   war das nicht so — count(null) auf dem fehlgeschlagenen version.json-Abruf
   ist unter PHP 8 ein fataler TypeError. */
foreach (["index.php", "admin.php", "tweaks.php", "service.php", "network.php"] as $seite) {
  $ctx = stream_context_create(["http" => ["timeout" => 20, "ignore_errors" => true]]);
  $antwort = @file_get_contents("http://127.0.0.1:8300/" . $seite, false, $ctx);
  $kopf = isset($http_response_header[0]) ? $http_response_header[0] : "keine Antwort";
  $fatal = $antwort !== false && strpos($antwort, "Fatal error") !== false;
  if ($antwort !== false && strpos($kopf, "200") !== false && !$fatal) {
    printf("  ok      GET  %-22s ohne Netz gerendert (%d Zeichen)\n", $seite, strlen($antwort));
  } else {
    printf("  FEHLER  GET  %-22s %s%s\n", $seite, $kopf, $fatal ? " [Fatal error im Rumpf]" : "");
    $fehler = 1;
  }
}
exit($fehler);
'
INNEN
)

echo "== Knopf-Probe im Container (php:8.3-cli, --network none) =="
docker run --rm \
	--network none \
	-v "${WURZEL}/AdminInterface/www:/var/www/admin:ro" \
	"${BILD}" \
	bash -c "${LAUF}"
RC=$?

echo
if [ "${RC}" -eq 0 ]; then
	echo "Ergebnis: in Ordnung — kein gefaehrlicher POST kommt mehr durch."
else
	echo "Ergebnis: FEHLER (rc=${RC})"
fi
exit "${RC}"
