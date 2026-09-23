# backend-player needs the mplayer binary (the generic url/file audio engine).
# Everything else is plain Node 22 (matches the box's Node target).
FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends mplayer ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app/src/backend-player
