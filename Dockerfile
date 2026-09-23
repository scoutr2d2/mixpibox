FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

# Ensure we install nodejs 16.
RUN curl -sL https://deb.nodesource.com/setup_22.x | bash

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    sudo \
    whiptail \
    curl \
    wget \
    cron \
    jq \
    mplayer \
    nodejs \
    npm \
    git \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Add dietpi user.
RUN groupadd -r dietpi && useradd -r -g dietpi dietpi
RUN groupadd -r gpio

# Add repo source.
USER dietpi
ARG mupisrc=/home/dietpi/MuPiBoxSource
COPY ./autosetup  $mupisrc/autosetup
COPY ./bin  $mupisrc/bin
COPY ./config  $mupisrc/config
COPY ./dev  $mupisrc/dev
COPY ./media  $mupisrc/media
COPY ./scripts  $mupisrc/scripts
COPY ./themes  $mupisrc/themes
USER root

# Needed for "Tracker "idealTree" already exists" error not happening
WORKDIR /home/dietpi

# Install nodejs packages.
RUN npm install -g @ionic/cli
# `npm install -g pm2` UND `pm2 startup` ENTFALLEN (14.08.2026).
# Der Startpunkt (docker/entrypoint.sh) ruft node inzwischen unmittelbar auf,
# so wie es die systemd-Units auf der Box tun. `pm2 startup` war hier ohnehin
# wirkungslos: es schreibt eine systemd-Unit — in einem Abbild ohne systemd.

# Create dirs.
RUN mkdir -p /home/dietpi/.mupibox
RUN mkdir -p /home/dietpi/MuPiBox/tts_files
RUN mkdir -p /home/dietpi/.mupibox/chromium_cache
RUN mkdir -p /home/dietpi/MuPiBox/sysmedia/sound
RUN mkdir -p /home/dietpi/.cache/spotify
RUN mkdir /home/dietpi/MuPiBox/sysmedia/images
RUN mkdir /home/dietpi/MuPiBox/media
RUN mkdir /home/dietpi/MuPiBox/media/audiobook
RUN mkdir /home/dietpi/MuPiBox/media/music
RUN mkdir /home/dietpi/MuPiBox/media/other
RUN mkdir /home/dietpi/MuPiBox/media/cover
RUN mkdir /home/dietpi/MuPiBox/themes
RUN mkdir -p /home/dietpi/.mupibox/Sonos-Kids-Controller-master/
RUN mkdir /usr/local/bin/mupibox
RUN mkdir /etc/mupibox
RUN mkdir /var/log/mupibox/

RUN mv -f $mupisrc/config/templates/mupiboxconfig.json "/etc/mupibox/mupiboxconfig.json"
RUN chown dietpi:dietpi /etc/mupibox/mupiboxconfig.json
RUN chmod 775 /etc/mupibox/mupiboxconfig.json

# Install mplayer wrapper
WORKDIR /home/dietpi/.mupibox
RUN git clone https://github.com/derhuerst/mplayer-wrapper
RUN cp $mupisrc/dev/customize/mplayer-wrapper/index.js /home/dietpi/.mupibox/mplayer-wrapper/index.js
WORKDIR /home/dietpi/.mupibox/mplayer-wrapper
RUN npm install

# Install google tts.
WORKDIR /home/dietpi/.mupibox
RUN git clone https://github.com/zlargon/google-tts
WORKDIR /home/dietpi/.mupibox/google-tts/
RUN npm install --save

# Frontend.
RUN cp $mupisrc/bin/nodejs/deploy.zip /home/dietpi/.mupibox/Sonos-Kids-Controller-master/sonos-kids-controller.zip
RUN mkdir -p /home/dietpi/.mupibox/Sonos-Kids-Controller-master
# TODO: Why does this throw an error?
RUN unzip /home/dietpi/.mupibox/Sonos-Kids-Controller-master/sonos-kids-controller.zip -d /home/dietpi/.mupibox/Sonos-Kids-Controller-master/; exit 0
RUN rm /home/dietpi/.mupibox/Sonos-Kids-Controller-master/sonos-kids-controller.zip
RUN mkdir -p /home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config/
RUN cp $mupisrc/config/templates/www.json /home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config/config.json
RUN cp $mupisrc/config/templates/monitor.json /home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config/monitor.json
WORKDIR /home/dietpi/.mupibox/Sonos-Kids-Controller-master 
RUN npm install

# Spotify player.
WORKDIR /home/dietpi/.mupibox
RUN wget https://github.com/amueller-tech/spotifycontroller/archive/main.zip
RUN unzip main.zip
RUN rm main.zip
WORKDIR /home/dietpi/.mupibox/spotifycontroller-main
RUN cp $mupisrc/config/templates/spotifycontroller.json /home/dietpi/.mupibox/spotifycontroller-main/config/config.json
RUN cp $mupisrc/bin/nodejs/spotify-control.js /home/dietpi/.mupibox/spotifycontroller-main/spotify-control.js
RUN ln -s /etc/mupibox/mupiboxconfig.json /home/dietpi/.mupibox/spotifycontroller-main/config/mupiboxconfig.json
RUN npm install

# Copy binaries.
RUN mv $mupisrc/bin/librespot/0.6.0/librespot-64bit /usr/bin/librespot
RUN mv $mupisrc/bin/fbv/fbv_64 /usr/bin/fbv
RUN chmod 755 /usr/bin/fbv /usr/bin/librespot

# TODO: Copy media files.
# RUN mv -f $mupisrc/config/templates/splash.txt /boot/splash.txt
# RUN wget https://gitlab.com/DarkElvenAngel/initramfs-splash/-/raw/master/boot/initramfs.img -O /boot/initramfs.img
# RUN cp $mupisrc/media/images/goodbye.png /home/dietpi/MuPiBox/sysmedia/images/goodbye.png
# RUN mv -f $mupisrc/media/images/splash.png /boot/splash.png
# RUN cp $mupisrc/media/images/MuPiLogo.jpg /home/dietpi/MuPiBox/sysmedia/images/MuPiLogo.jpg
# RUN cp $mupisrc/media/sound/shutdown.wav /home/dietpi/MuPiBox/sysmedia/sound/shutdown.wav
# RUN cp $mupisrc/media/sound/startup.wav /home/dietpi/MuPiBox/sysmedia/sound/startup.wav
# RUN cp $mupisrc/media/sound/low.wav /home/dietpi/MuPiBox/sysmedia/sound/low.wav
# RUN cp $mupisrc/media/sound/button_shutdown.wav /home/dietpi/MuPiBox/sysmedia/sound/button_shutdown.wav
# RUN cp $mupisrc/media/images/installation.jpg /home/dietpiMuPiBox/sysmedia/images/installation.jpg
# RUN cp $mupisrc/media/images/battery_low.jpg /home/dietpi/MuPiBox/sysmedia/images/battery_low.jpg

# TODO: Copy themes.

# Die Verwaltung laeuft im Node-Backend unter /admin auf Port 8200 (E47,
# 19.08.2026). Hier wurden frueher php und lighttpd fuer den alten
# PHP-Admin installiert.
RUN chown -R dietpi:dietpi /home/dietpi/MuPiBox/media/cover

EXPOSE 8200
EXPOSE 5005

WORKDIR /
COPY ./docker/entrypoint.sh /entrypoint.sh
ENTRYPOINT ["/bin/bash", "/entrypoint.sh"]
