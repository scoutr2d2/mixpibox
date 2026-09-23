#!/bin/sh
# Harness entrypoint for the AdminInterface (PHP). Serves the box's admin pages
# against COPIES of the sim's config so they render and are editable locally,
# WITHOUT the box's sudo/hardware. This is a sandbox — edits land on the copies
# here, not on the sim's state files (the admin pages assume root/sudo + box paths).
set -e

# The admin runs many `sudo <cmd>` calls (box scripts assume root). Map `sudo` to
# `env`, which just execs its argument command — so `sudo mv …` becomes `mv …`
# instead of failing with "sudo: not found". Hardware calls (iwgetid, iwconfig …)
# simply aren't installed here and return empty; the pages still render.
ln -sf /usr/bin/env /usr/local/bin/sudo

CFG=/home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config
mkdir -p "$CFG" /etc/mupibox /home/dietpi/MuPiBox/media/cover /home/dietpi/.pm2/logs /var/www /tmp/support

# Writable config copies from the sim state, under the names the admin expects.
cp -f /seed/data.json          "$CFG/data.json"                2>/dev/null || echo '[]' > "$CFG/data.json"
cp -f /seed/config-api.json    "$CFG/config.json"              2>/dev/null || echo '{}' > "$CFG/config.json"
cp -f /seed/resume.json        "$CFG/resume.json"              2>/dev/null || echo '[]' > "$CFG/resume.json"
cp -f /seed/mupiboxconfig.json /etc/mupibox/mupiboxconfig.json 2>/dev/null || echo '{}' > /etc/mupibox/mupiboxconfig.json

# Force the web login OFF for the harness (on the box lighttpd/interfacelogin
# guards it; here there is no auth layer, so make the pages directly reachable).
php -r '$f="/etc/mupibox/mupiboxconfig.json"; $d=json_decode(@file_get_contents($f),true)?:[]; $d["interfacelogin"]=["state"=>false,"password"=>""]; file_put_contents($f,json_encode($d,JSON_PRETTY_PRINT));'

echo "[admin] AdminInterface on http://0.0.0.0:8300  (login disabled, sandboxed config)"
# display_errors=0 + output_buffering to match the box (lighttpd/php.ini): hide the
# PHP 8.3 undefined-array-key/null warnings the pages emit and fix the
# "session_start after headers sent" notice. Set MUPI_ADMIN_DEBUG=1 to see them
# (useful when modernizing the pages for PHP 8.3).
DISP=0; [ "${MUPI_ADMIN_DEBUG:-0}" = "1" ] && DISP=1
exec php -d display_errors=$DISP -d output_buffering=4096 -S 0.0.0.0:8300 -t /var/www/admin
