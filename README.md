# Metronome

A browser-based metronome served from a Docker container (nginx, linux/amd64).
The click sound is generated in your browser with the Web Audio API, so open the
page on whatever device you want to hear it from.

## Deploying

Every push to `main` triggers a GitHub Actions workflow
(`.github/workflows/docker-image.yml`). It builds the linux/amd64 image and
publishes it as `ghcr.io/jmartaudio/metronome:latest`, plus a tag for each
commit (`sha-xxxxxxx`).

### Portainer (Community Edition)

1. **Stacks → Add stack → Repository**
2. Repository URL: `https://github.com/jmartaudio/metronome`,
   reference `refs/heads/main`, compose path `docker-compose.yml`
3. Deploy. Portainer only pulls the image; it never builds anything.

To update: push to `main`, wait for the workflow to finish (the **Actions**
tab on GitHub), then click **Pull and redeploy** on the stack in Portainer.

The stack joins the external `proxy` network for Traefik, which serves it at
`metronome.local.fuzzhouse.com`. It is also published directly on port 8085.

### Plain Docker

```bash
docker compose pull && docker compose up -d
```

### Building locally

```bash
docker build --platform linux/amd64 -t metronome .
docker run --rm -p 8080:80 metronome
```

## Features

- Tempo 20–300 BPM: slider, ± buttons, tap tempo; space bar starts/stops
- Beats per bar 1–12; click any beat to move the accent (beat 1 by default)
- Subdivisions: none, eighths, triplets, sixteenths, quintuplets, sextuplets
- Volume sliders: master, accent, beats, and each subdivision position
- Tempo ramp toward a target BPM, either stepped (+X BPM every N bars) or
  smooth (X BPM per minute); works speeding up or slowing down
- Settings are remembered in the browser
