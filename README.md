# Metronome

A browser-based metronome served from a Docker container (nginx, linux/amd64).
The click sound is generated in your browser with the Web Audio API, so open the
page on whatever device you want to hear it from.

## Run on your x86 server

Copy this folder to the server, then:

```bash
docker compose up -d --build
```

Open `http://<server-ip>:8080`. Change the left side of `"8080:80"` in
`docker-compose.yml` to use a different port.

Without Compose:

```bash
docker build --platform linux/amd64 -t metronome .
docker run -d --name metronome -p 8080:80 --restart unless-stopped metronome
```

### Building on a Mac (Apple Silicon) and shipping the image

```bash
docker buildx build --platform linux/amd64 -t metronome --load .
docker save metronome | gzip > metronome.tar.gz
# copy to the server, then:
gunzip -c metronome.tar.gz | docker load
```

## Features

- Tempo 20–300 BPM: slider, ± buttons, tap tempo; space bar starts/stops
- Beats per bar 1–12; click any beat to move the accent (beat 1 by default)
- Subdivisions: none, eighths, triplets, sixteenths, quintuplets, sextuplets
- Volume sliders: master, accent, beats, and each subdivision position
- Tempo ramp toward a target BPM, either stepped (+X BPM every N bars) or
  smooth (X BPM per minute); works speeding up or slowing down
- Settings are remembered in the browser
