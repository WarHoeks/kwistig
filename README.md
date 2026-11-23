# Kwistig

A self-hosted living-room pub quiz: Connect your laptop to a screen through HDMI/DP to show the questions, teams answer on their phones, and the quizmaster runs it all from their own phone. See [docs/PLAN.md](docs/PLAN.md) for the full design.

## Features

### Question types

- 🔤 **Multiple choice:** two to six options, shown on the TV with a letter and a colour.
- ✅ **True or false.**
- ✍️ **Open question:** teams type an answer. Small typos, capitals and accents don't matter, and you can list several accepted answers.
- 🔢 **Number:** closest team wins, or every answer within a margin you set (for example 1989 ± 1).
- 🔔 **Buzzer:** the first team to press gets the turn and says the answer out loud. You mark it right or wrong from your phone; a wrong team is out and the buzzer opens again for the others.
- ⚡ **Flitsreeks:** a series of images flashes by on the TV and teams press a button (with your own label, like *WINNAAR!*) when an image matches. Faster presses can earn a bonus and wrong presses can cost points.

### Media

- 🖼️ **Images** that start blurred, pixelated or zoomed in and become clear while teams think.
- 🎬 **YouTube clips** from a start to an end second. Show the video or play only the sound, play the clip before the question or together with it, and add a continuation that shows what happened next when you reveal the answer.
- 🎵 **Spotify fragments** played on the TV without showing the song or artist, with the same timing options as YouTube. You can turn one of your own playlists into a music round in one go.
- 📰 **News headlines:** paste a news article link and the TV shows its headline with one word blanked out, plus the article's photo.
- 🪧 **Slides** between questions, with a background colour or image, a break countdown, or the standings.

### Playing

- 📱 **No app to install:** teams scan a QR code on the TV and play in the phone's browser.
- 👥 **Teams with several phones:** every player votes. The answer with the most votes counts, and a tie is decided by lot. For open and number questions, a player's answer becomes an option the rest of the team can vote for.
- 📸 **Team photos** taken on the phone at the start, used on the TV all night.
- 🎮 **The quizmaster's phone is the remote:** open, close and reveal questions, play and replay clips, jump around in the quiz, and see each team's answer and your own notes. Timers start together with the music or video.
- 🔄 **Nothing gets lost:** every step is saved, so a refreshed phone, a crashed browser or even a restarted server picks up exactly where it was.
- 🌍 **Dutch and English:** the app is Dutch by default, and every phone can switch language. Questions can have both a Dutch and an English version.

### On the TV

- 🏆 **Standings with drama:** the leader gets a golden frame and a crown, the last team's photo cracks a bit more each round, and a dethroned leader's frame disappears in a puff. Rows slide to their new place when the ranking changes.
- 🎉 **A proper finale:** a drum roll, the teams from last place up, and then the winner with a fanfare and confetti.
- 🔊 **Sound effects** for the buzzer, right and wrong answers, and the winner. A calm mode turns off the confetti and shaking, and the TV also follows the device's reduce-motion setting.
- 📺 Designed for a 1920×1080 screen read from across the room.

### Preparing a quiz

- ✏️ **Editor in the browser** with rounds, drag-and-drop ordering and a live preview of how each question looks on the TV.
- 🧠 **Trivia rounds:** fetch ready-made multiple-choice or true/false questions from [Open Trivia DB](https://opentdb.com) by category and difficulty (in English), then edit them like your own.
- 🖨️ **Printable answer sheet** with all questions, answers, notes and clip times, or a questions-only copy.
- 📦 **Quiz packages:** download a quiz with all its images as one zip and import it on another Kwistig.
- 💾 **Backups and history:** one-click backup of everything, and the final standings of every past quiz night.

### Running it

- 🐳 **One Docker container** on your own laptop or home server, with everything stored in a `./data` folder. No accounts and no cloud service; teams only need your Wi-Fi.
- 🔒 **PIN-protected** host and admin pages. Teams never receive the right answer before it is revealed.

## A quiz night

Doing it for the first time? Play the test quiz with a few friends first (build it with `node scripts/make-sample-package.mjs generale-repetitie`, then upload `samples/generale-repetitie.zip` in Admin), using the checklist in [docs/TEST-NIGHT.md](docs/TEST-NIGHT.md).

1. On the laptop, open **`http://localhost:8080/tv`** in Chrome, sign in with the PIN once, and put it on the TV (see [step 4](#4-the-tv-page-and-youtube-sign-in) for why `localhost`).
2. On your phone, open `http://<laptop-ip>:8080/host`, sign in, and start a quiz. The TV shows a QR code.
3. Teams scan the QR code, create a team or join one, and take a team photo when you start the photo step.
4. Drive the game from your phone: open, close, reveal, next. A clip that goes with a question starts together with the answers and the timer; a clip set to play first opens the question, with its timer, when it ends. Refreshing any device puts it back where it was, and so does restarting the container.
5. For a paper backup, open the quiz in **Admin** and choose **Afdrukken**: every question with its answer, notes and clip times. Untick *Met antwoorden* for a questions-only copy.
6. Sound effects and confetti are on by default. Click the TV page once so the browser allows sound; **Admin → Instellingen → Tv-effecten** has a calm mode (no confetti or shaking) and a switch for the sounds.
7. Afterwards, **Admin → Sessies** keeps every quiz night's final standings; delete a session there to remove its team photos too.

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

Change the PIN before the first quiz night, to something of at least 6 characters: guests on your Wi-Fi can reach the login page, and wrong attempts are only rate-limited per device. It protects `/admin`, `/host` and the TV. Either set `HOST_PIN` in `docker-compose.yml`, or change it under **Admin → Instellingen → Pincode** (needs the current PIN). A PIN saved in admin overrides `HOST_PIN`; *Terug naar HOST_PIN* removes it again. Changing the PIN signs out every other device.

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

Kwistig doesn't log in to YouTube. The embedded player uses whatever Google account is signed in to that browser profile, so signing the laptop's Chrome into a YouTube Premium account removes ads in the embeds. Run **Admin → Instellingen → YouTube-test** in that Chrome before guests arrive: it plays a music video the way the TV does, and if an ad plays first, that profile isn't signed in with Premium (a page can't detect ads itself, so this is a visual check). Some videos don't allow embedding at all; the editor checks every YouTube link (via YouTube's oEmbed) and flags those. If Chrome blocks autoplay after the TV page reloads, the TV shows "Klik om af te spelen": click it once on the laptop.

**Playing a clip:** the host's phone has play/pause, replay (from the start marker) and mute. A clip set to *Eerst afspelen* fills the TV until it ends; then the question appears.

### 5. Spotify app (optional)

Spotify questions need a Spotify Premium account and your own Spotify developer app. Everything is set up under **Admin → Instellingen → Spotify**, which walks through the same steps:

1. Go to the [Spotify developer dashboard](https://developer.spotify.com/dashboard) and create an app. Select *Web API* and *Web Playback SDK*.
2. Add the redirect URI shown in admin settings to the app, exactly (by default `http://127.0.0.1:8080/api/spotify/callback`). Spotify doesn't accept `localhost`, only the loopback IP. If Docker publishes Kwistig on another port, change the redirect URI in admin settings to match and register that one.
3. Paste the app's Client ID in admin settings and save. (`SPOTIFY_CLIENT_ID` and `SPOTIFY_REDIRECT_URI` in `docker-compose.yml` still work as defaults; values saved in admin win.)
4. Click **Spotify koppelen** *in a browser on the laptop* (the redirect goes to `127.0.0.1`). You only do this once; Kwistig keeps the login (Authorization Code with PKCE, no client secret) and refreshes it itself.
5. Open the TV page at `http://localhost:8080/tv`. It becomes the Spotify Connect device **Kwistig TV**; click the TV screen once so the browser allows sound. **Spotify testen** in admin settings checks every endpoint Kwistig uses with your account.

When a Spotify question plays, the TV shows only an animated equaliser, never the title, artist or cover. The host's play/pause/replay/mute buttons work as for YouTube; the server starts the clip at its start marker and pauses it at the end marker. If the TV page isn't a player (for example it isn't on the laptop), pick a **reserve-apparaat** in admin settings: any Spotify Connect speaker, phone or Chromecast that's on.

**Round from a playlist:** in the quiz editor, *Ronde uit Spotify-playlist* turns tracks of one of your playlists into "Wie is de artiest?" questions with a random 20-second fragment, which you can then edit. Since February 2026 Spotify only returns the tracks of playlists **you own or collaborate on** to apps like this; to use someone else's or one of Spotify's own playlists, copy it into a playlist of your own first.

Development Mode apps (what you get by default) need the app owner to have Premium, allow up to five authorised users, and up to 25 apps per developer. Only the host signs in, so that's enough. See the Spotify notes in [docs/PLAN.md](docs/PLAN.md) for what changed in Spotify's API in 2026.

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

## License

Kwistig is free for personal and other noncommercial use under the [PolyForm Noncommercial License 1.0.0](LICENSE). You may run it, change it and share it for quiz nights at home, at school, in a club or for a charity. Commercial use, such as selling it, running paid quiz events with it or offering it as a service, needs permission: open an issue to ask.

This makes Kwistig source-available rather than open source in the OSI sense. The libraries it uses keep their own (MIT, ISC and Apache-2.0) licenses.
