# Kwistig

*De huiskamerquiz.* A self-hosted living-room pub quiz: the TV shows the questions, teams answer on their phones, and the quizmaster runs it all from their own phone. See [docs/PLAN.md](docs/PLAN.md) for the full design.

**Status:** Phase 1 (skeleton, data, admin editor) is done. The live game (TV, host remote, team phones) arrives in Phase 2, media in Phase 3 and Spotify in Phase 4. The setup steps below already describe the finished app.

## Run it

```sh
docker compose up -d --build
```

Then open `http://127.0.0.1:8080/admin` on the laptop and sign in with the host PIN.

Everything is stored in `./data`: the SQLite database, uploaded media and team photos. Back up that folder, or use the backup download in admin settings.

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

Open the TV page **in a browser on the laptop itself**, at `http://127.0.0.1:8080/tv`, and show it via HDMI or by casting the Chrome tab. This one choice makes both YouTube and Spotify work.

Kwistig doesn't log in to YouTube. The embedded player uses whatever Google account is signed in to that browser profile, so signing the laptop's Chrome into a YouTube Premium account removes ads in the embeds. The "YouTube test" in admin settings shows whether that worked. Some videos don't allow embedding; the editor flags them when you save.

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
npm test               # Vitest: schema, API, state machine, scoring
npm run e2e            # Playwright: full game with TV, host and two teams
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

Quizzes import and export as JSON. The JSON Schema is served at `/api/schema/quiz.json`, so you can hand it to an LLM to generate quizzes that import cleanly. [samples/kitchen-sink.json](samples/kitchen-sink.json) uses every answer type and media type.
