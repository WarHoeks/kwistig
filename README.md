# Kwistig

*De huiskamerquiz.* A self-hosted living-room pub quiz: the TV shows the questions, teams answer on their phones, and the quizmaster runs it all from their own phone. See [docs/PLAN.md](docs/PLAN.md) for the full design.

**Status:** Phases 1–3 are done: admin editor, the live game with team voting, images with reveal effects, YouTube clips, news headlines, flitsreeks, quiz packages and backups. Spotify arrives in Phase 4 and the buzzer in Phase 5; until then those questions show their text only. The setup steps below already describe the finished app.

## A quiz night

1. On the laptop, open **`http://localhost:8080/tv`** in Chrome, sign in with the PIN once, and put it on the TV (see [step 4](#4-the-tv-page-and-youtube-sign-in) for why `localhost`).
2. On your phone, open `http://<laptop-ip>:8080/host`, sign in, and start a quiz. The TV shows a QR code.
3. Teams scan the QR code, create a team or join one, and take a team photo when you start the photo step.
4. Drive the game from your phone: open, close, reveal, next. Refreshing any device puts it back where it was, and so does restarting the container.

## Run it

```sh
docker compose up -d --build
```

Then open `http://localhost:8080/admin` on the laptop and sign in with the host PIN.

Everything is stored in `./data`: the SQLite database, uploaded media and team photos. Back up that folder, or use **Admin → Instellingen → Back-up downloaden**, which zips a consistent copy of the database plus all media while the app keeps running.

Values you don't want in the shared `docker-compose.yml` (your PIN, your LAN address) can go in a `docker-compose.override.yml` next to it; Compose merges it automatically and Git ignores it:

```yaml
services:
  kwistig:
    environment:
      - HOST_PIN=your-pin
      - PUBLIC_BASE_URL=http://192.168.1.23:8080
```

Set `EXTERNAL_FETCH=false` to stop Kwistig from fetching anything from the internet (image URLs on import, news articles, YouTube checks).

## Setup

### 1. Host PIN

Change `HOST_PIN` in `docker-compose.yml` before the first quiz night, to something of at least 6 characters: guests on your Wi-Fi can reach the login page, and wrong attempts are only rate-limited per device. It protects `/admin`, `/host` and the TV. A PIN saved later in admin settings overrides the environment value, and changing the PIN signs out every device.

### 2. Firewall

Phones reach the laptop over Wi-Fi, so inbound TCP port **8080** must be allowed on the laptop for private networks.

- **Windows:** `New-NetFirewallRule -DisplayName "Kwistig" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow -Profile Private` (run as administrator), and make sure your Wi-Fi is set to *Private network*.
- **macOS:** System Settings → Network → Firewall → Options: allow incoming connections for Docker.
- **Linux (ufw):** `sudo ufw allow from 192.168.0.0/16 to any port 8080 proto tcp`

All phones must be on the same Wi-Fi as the laptop. Guest networks often use *client isolation*, which blocks phones from reaching the laptop; use the main network.

### 3. `PUBLIC_BASE_URL` (the QR code)

Inside Docker the app can't see the laptop's LAN address, so tell it where phones can reach it:

1. Find the laptop's LAN IP (`ipconfig` on Windows, `ipconfig getifaddr en0` on macOS, `hostname -I` on Linux), for example `192.168.1.23`.
2. Set `PUBLIC_BASE_URL=http://192.168.1.23:8080` in `docker-compose.yml` and run `docker compose up -d`.

A base URL saved in admin settings takes precedence over the environment. If neither is set and the TV page was opened via a LAN address, that address is used. Otherwise the TV shows a warning instead of a broken QR code. Give the laptop a DHCP reservation in your router so the address doesn't change between quiz nights.

### 4. The TV page and YouTube sign-in

Open the TV page **in Chrome on the laptop itself**, at **`http://localhost:8080/tv`**, and show it via HDMI or by casting the Chrome tab. This one choice makes both YouTube and Spotify work.

**Use `localhost`, not `127.0.0.1` or the LAN IP.** Many music videos (record-label uploads) refuse to play in embeds on a page whose address is a bare IP, with YouTube error 150, while the same page via a host name plays fine. Tested in Chrome: the official "Never Gonna Give You Up" video fails on `http://127.0.0.1:8080` and `http://192.168.1.x:8080` and plays on `http://localhost:8080`. `localhost` is still a secure context, so Spotify's player works there too. The TV shows a banner with a one-click switch when it's opened via an IP address during a YouTube question.

Kwistig doesn't log in to YouTube. The embedded player uses whatever Google account is signed in to that browser profile, so signing the laptop's Chrome into a YouTube Premium account removes ads in the embeds. Some videos don't allow embedding at all; the editor checks every YouTube link (via YouTube's oEmbed) and flags those. If Chrome blocks autoplay after the TV page reloads, the TV shows "Klik om af te spelen": click it once on the laptop.

**Playing a clip:** the host's phone has play/pause, replay (from the start marker) and mute. A clip set to *Eerst afspelen* fills the TV until it ends; then the question appears.

### 5. Spotify app (optional)

Spotify questions need a Spotify Premium account and your own Spotify developer app:

1. Go to the [Spotify developer dashboard](https://developer.spotify.com/dashboard) and create an app. Select *Web API* and *Web Playback SDK*.
2. Add the redirect URI `http://127.0.0.1:8080/api/spotify/callback` exactly. Spotify doesn't accept `localhost`, only the loopback IP.
3. Put the app's Client ID in `SPOTIFY_CLIENT_ID` in `docker-compose.yml` and restart.
4. In admin settings, click **Connect Spotify** *from a browser on the laptop* (the redirect only works on `127.0.0.1`). You only do this once.

Development Mode apps allow up to five authorised users and need the app owner to have Premium. Only the host signs in, so that's enough.

## Development

Requirements: Node 22+.

```sh
npm install
npm run build          # shared → web → server
npm run dev:server     # API on :8080 (tsx watch)
npm run dev:web        # Vite on :5173, proxies /api and /socket.io to :8080
npm test               # Vitest: schema, API, state machine, scoring, matching, sockets
npx playwright install chromium   # once
npm run build && npm run e2e      # Playwright: full game, plus media/package/flitsreeks (screenshots in test-results/demo)
npm run i18n:check     # nl.json and en.json must have the same keys
npm run typecheck
```

After changing `apps/server/src/db/schema.ts`, run `npm run db:generate` and commit the new migration in `apps/server/drizzle/`.

### Layout

```
packages/shared   Zod quiz schema, socket protocol, matching — used by server and web
apps/server       Fastify + Socket.IO + Drizzle/SQLite
apps/web          React + Vite + Tailwind: /tv /host /play /join/:code /admin
samples/          Sample quizzes, used by the tests
```

### Quiz format

Quizzes import and export as JSON. The JSON Schema is served at `/api/schema/quiz.json`, so you can hand it to an LLM to generate quizzes that import cleanly. Image URLs in an imported file are downloaded and stored locally. [samples/kitchen-sink.json](samples/kitchen-sink.json) uses every answer type and media type.

A **quiz package** (`kwistig-<quiz>.zip`, from the library or the host's quiz picker) holds `manifest.json` with a checksum per file, `quiz.json`, every image in `media/`, and fetched news headlines and YouTube details in `cache/`. Uploading one shows a preview and offers *import as new* or *replace* when the same quiz is already there. Images are stored by content hash, so shared images are kept once. Team photos and scores are never in a package.

`node scripts/make-sample-package.mjs` builds `samples/kitchen-sink.zip` from the sample quiz and its placeholder images (`node scripts/make-sample-images.mjs` regenerates those).
