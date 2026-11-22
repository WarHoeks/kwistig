# Kwistig — build plan

*De huiskamerquiz.* Plan for Claude Code, 22 November 2026.

## Overview

Kwistig is a self-hosted living-room pub quiz: a big-screen TV display, one or more phones per team to answer, and a host remote on the quizmaster's phone. It runs as one Docker Compose stack on a laptop on the home network, with Dutch as the default language and English as the second.

**Goals for v1**

- A host can build a quiz in an admin UI or import it as JSON, then run it live from their phone.
- Teams join by scanning a QR code on the TV on one or more phones per team, then answer on those phones.
- Questions can use text, images, YouTube clips with start and end times, and Spotify tracks with start and end times.
- The host can show intro slides between rounds and send ad-hoc messages to the TV during the game.
- Everything works on the local network with no cloud dependency except YouTube and Spotify playback.

**Non-goals for v1**

- No user accounts beyond a single host PIN.
- No public internet hosting, no multi-tenant setup.
- No native Chromecast receiver app; the TV shows a web page via HDMI or a cast Chrome tab.
- No AI-generated questions yet (a later phase can add Ollama drafting).

**Name:** Kwistig. Dutch *kwistig* means lavish or generous, and it reads like *quiz*.

## Architecture

One Node process in one container serves the API, the WebSocket hub and the built frontend; the only outside services are YouTube and Spotify.

```
 Laptop (Docker)
 ┌──────────────────────────────────────┐
 │  Fastify + Socket.IO                 │◄──── WebSocket + HTTP ──── TV display (/tv, laptop browser on HDMI)
 │  (API, game state machine)           │◄──── WebSocket + HTTP ──── Host remote (/host, quizmaster phone)
 │  React frontend (/tv /host /play     │◄──── WebSocket + HTTP ──── Team phones (/play, one or more per team)
 │                  /admin)             │
 │  SQLite + media (./data volume)      │───── Spotify Web API (server side)
 └──────────────────────────────────────┘
 YouTube embed and Spotify Web Playback SDK run inside the TV page in the laptop browser.
```

The server is authoritative: devices send intents such as `submitAnswer` or `reveal`, and the server broadcasts the resulting state per role.

| Layer | Choice | Why |
| --- | --- | --- |
| Runtime | Node 22, TypeScript | One language for server and all screens |
| Server | Fastify + Socket.IO | Fast HTTP plus rooms per session and auto-reconnect |
| Database | SQLite via Drizzle ORM (better-sqlite3) | Single file in `./data`, no extra container |
| Validation | Zod | One schema for import, API and editor types |
| Frontend | React + Vite + Tailwind | Four route-based screens in one bundle |
| i18n | react-i18next | NL default, EN second |
| QR codes | `qrcode` package | Rendered server-side as SVG for the TV |
| Animation | Framer Motion, canvas-confetti | Rank changes and standings effects |
| Tests | Vitest + Playwright | State machine unit tests, one multi-device game test |

## Deployment

Kwistig runs as a single container on the host's laptop, published on port 8080 to the local network. Team phones and the host phone reach it over Wi-Fi at the laptop's LAN address; no Tailscale or reverse proxy is involved.

```yaml
services:
  kwistig:
    build: .
    image: kwistig:latest
    ports:
      - "8080:8080"
    volumes:
      - ./data:/app/data        # SQLite database + uploaded media
    environment:
      - PORT=8080
      - DEFAULT_LOCALE=nl
      - HOST_PIN=change-me              # protects /admin and /host
      - PUBLIC_BASE_URL=                # e.g. http://192.168.1.23:8080, used in the QR code
      - SPOTIFY_CLIENT_ID=              # optional, enables Spotify questions
      - SPOTIFY_REDIRECT_URI=http://127.0.0.1:8080/api/spotify/callback
    restart: unless-stopped
```

**Getting the QR code right.** Inside Docker the app cannot reliably see the laptop's LAN IP, so the join URL is resolved in this order:

1. The base URL saved in the admin settings page.
2. `PUBLIC_BASE_URL` from the environment.
3. The TV page's own origin, if it was opened via a LAN address rather than `localhost` or `127.0.0.1`.
4. Otherwise the TV shows a warning with instructions instead of a broken QR code.

The admin settings page shows the current join URL and a "test from your phone" hint.

**Practical caveats to document in the README**

- Allow inbound port 8080 on the laptop firewall for private networks.
- Phones must be on the same Wi-Fi without client isolation; many guest networks block device-to-device traffic.
- Spotify only accepts `http://127.0.0.1` loopback redirects over plain HTTP, so the Spotify connect step must be done in a browser on the laptop itself (see YouTube and Spotify).
- Everything persists in `./data`: the SQLite file, uploaded images, cached thumbnails and team photos.

## The four screens

One web app serves four role-based screens; all live views stay in sync through a single WebSocket connection to the server.

| Screen | Route | Device | Auth |
| --- | --- | --- | --- |
| TV display | `/tv` | Laptop on HDMI, or a cast Chrome tab | Host PIN once, kept in a cookie |
| Host remote | `/host` | Quizmaster's phone | Host PIN |
| Team phone | `/play` (entered via `/join/<code>`) | One or more phones per team | Player token from joining |
| Admin | `/admin` | Laptop | Host PIN |

### TV display

- Full-screen, large type, readable from 4 metres; 16:9 layout that also survives a 4:3 projector.
- Lobby: quiz title, the QR code, the join URL in text, and joined teams appearing live with their name and emoji.
- Team photo step: a grid of teams that fills in live as photos arrive.
- Question view: round name, question number, the prompt, media (image, YouTube player, Spotify "now playing" visual without track info), answer options if any, a countdown bar, and a row of team chips that light up once a team has answered.
- Reveal view: the correct answer, which teams got it right, optional host explanation text.
- Slide view for intros and messages, and a scoreboard view with team photos, animated ranking changes and standings effects.
- Never shows the answer or host notes before reveal; the server only sends them to the TV at reveal time.

### Host remote

The host phone is the real control surface during the game:

- **Quiz picker:** the quiz library, with a start button per quiz. Starting one creates a new session and switches the TV to its lobby. Starting a quiz while another runs asks for confirmation and ends the current session with its scoreboard saved.
- Current item and next item preview, including the correct answer and private host notes.
- Navigation: next, previous, jump to any item in the run order.
- Media: play, pause, replay from the start marker, mute.
- Timer: start, add 15 seconds, stop; optional auto-lock when it ends.
- Answers: lock, reveal, see live which teams answered; mark open answers correct, half or wrong; adjust any team's score by hand.
- Show scoreboard on the TV at any moment.
- **Messages:** type a free-text message and push it to the TV as a full-screen slide or a banner overlay, with saved quick messages such as "Pauze! Tijd voor een drankje" or "Laatste ronde!". Dismiss returns the TV to where it was.
- Teams: see each team's phones, rename, merge or remove a team, move a phone to another team; see which teams still need a photo.

### Team phone

- Scanning the QR opens `/join/<code>` with two choices: **Nieuw team** (team name, emoji, colour) or **Bij een team aansluiten** (pick from the list of teams already in the game). Each phone can add an optional nickname.
- Each phone in a team votes. For multiple choice and true/false every phone picks an option; for open and number questions a phone types an answer and presses Enter, which proposes it and votes for it, and teammates can tap any proposal to vote for it too. Votes sync live to the team's other phones with who voted for what, and a phone can change or take back its vote until the host locks. At lock the option with the most votes is the team's answer; a tie is decided by a random draw.
- Each question shows the matching input: answer buttons, a text field, a number field, a buzzer, or the flitsreeks button.
- After the lock every phone in the team shows "Ingeleverd" and waits.
- After reveal the phones show whether the team was right, the team's current score and rank, and the team photo with its standings effect.
- A player token in `localStorage` puts a phone that slept or refreshed back in the same team. The host can move a phone to another team or remove it.
- Language toggle NL/EN in the corner; it defaults to the quiz's language.

### Admin

- Quiz library: create, duplicate, delete; download a quiz as a package and upload one (see Quiz packages).
- Quiz editor: rounds, and within each round an ordered list of items (questions and slides), drag to reorder.
- Item editor per type, with a live preview rendered with the real TV layout.
- Media library with image upload, and YouTube and Spotify pickers that let you set and test start and end times.
- JSON import and export (see Data model and JSON import).
- Settings: join base URL, default language, host PIN, Spotify connect and disconnect, a YouTube playback test, a "rustige modus" toggle for effects, and a full backup download of the whole `./data` folder.
- Past sessions keep their final scoreboard; the host can delete a session (and its photos).

## Game flow

The server runs one state machine per game session, and only host-remote actions advance it; teams can only submit answers while it is in Answering.

```
Lobby ──start──► Teamfoto's ──► Item shown ──open──► Answering ──lock or timer──► Locked ──reveal──► Revealed
 (teams join)    (photo step)    (slide or media)     (phones active)              (host marks)       (scores update)
                                     ▲                                                                   │
                                     └──────────── next item (slides go straight here) ◄─────────────────┤
                                                                                                         │ last item
                                                                                                         ▼
                                                                                                     Finished
                                                                                                 (winner sequence)
```

Three things sit on top of any state without changing it: a host message overlay, the scoreboard view, and a paused media player. "Previous" steps back one item and restores its last state, including submitted answers.

**Rules the implementation must keep**

- Every transition is written to SQLite before it is broadcast, so a crashed or restarted container resumes exactly where it was.
- Each role gets its own projection of the state: the TV and team phones never receive the correct answer, accepted answers or host notes before Revealed.
- A team's answer is decided by its phones' votes: each phone has one vote it can change or retract until the lock, the server broadcasts the tally only to that team's phones and the host, and at lock the option with the most votes wins, with a server-side random draw on a tie (open answers count together after normalising case, accents and articles; numbers by value). For buzzers and flitsreeks presses the first press from any of the team's phones counts.
- Answers arriving after Locked are rejected with a clear message on the phone.
- Timers and flitsreeks schedules run on the server; clients render countdowns from server timestamps, so a slow phone cannot get extra time.
- Media start and stop are host commands relayed to the TV, which reports `ended` back so the host sees playback state.
- Only one game session is active at a time; starting another quiz from the host remote ends the current one.

## Team photos and standings effects

After all teams have joined and the host presses start, every team takes a photo on a phone; that photo is the team's face on the TV for the rest of the game, and it reacts to the standings with confetti, cracks and sparkles.

### The photo step

- The state machine has a step between Lobby and the first item: **Teamfoto's**. Team phones show "Maak een teamfoto"; the TV shows a grid of teams that fills in live as photos arrive.
- Any phone in the team can take it; the first photo submitted counts, and the team can retake until the host moves on.
- The host remote shows who is missing and has "Start zonder foto's": teams without a photo keep their emoji and colour.
- **Camera access over plain HTTP:** browsers only allow live camera access (`getUserMedia`) on HTTPS or `127.0.0.1`, and team phones reach the laptop over plain HTTP on the LAN. So the photo uses `<input type="file" accept="image/*" capture="user">`, which opens the phone's own camera app and works without HTTPS. The phone then shows a square crop preview with a retake button.
- The phone resizes the photo to 800 × 800 px JPEG before upload, so uploads are fast and the TV stays smooth.
- Photos are stored per session in `./data/sessions/<id>/`, never in quiz packages, and are deleted when the host deletes the session.

### Standings states

After each reveal the server compares the new standings with the previous ones and sends each team a state plus what changed. The TV plays effects only on a change, so a team that stays in first doesn't get confetti after every question.

| State | When | Effect on the team photo |
| --- | --- | --- |
| Leader | Rank 1 (ties share it) | Gold frame, a confetti burst when gained |
| Round winner | Most points in the round just finished | Confetti shower and a small crown on the round-end scoreboard |
| Last place | Lowest score, with 3 or more teams | Crack overlay that deepens from 1 to 3 levels the longer they stay last, a short shake when it appears |
| Comeback | Leaves last place | Sparkles, and the cracks heal by drawing themselves back in reverse |
| Dethroned | Loses rank 1 | The gold frame and confetti poof away; if they also drop to last, a new crack appears |

The same state shows on the team's own phones: their photo with its frame or cracks after each reveal.

### Implementation

- **Rank changes:** team cards slide to their new positions using Framer Motion layout animations.
- **Confetti:** the `canvas-confetti` library, fired from the photo's position on screen.
- **Cracks:** a few hand-drawn SVG crack paths over the photo. They appear and heal by animating `stroke-dashoffset`, and "deepening" means adding more paths.
- **Sparkles, poof and shake:** CSS keyframe animations with small particle elements.
- **Accessibility:** a "rustige modus" setting turns effects down for anyone sensitive to motion, and the app respects `prefers-reduced-motion`.

The effects run on the TV scoreboard and the round-end scoreboard, and briefly on the reveal screen. They never run during a question.

## Item types

A quiz is a list of rounds, and each round is an ordered list of items. An item is either a **question** or a **slide**. Any question can carry one media attachment, so "a YouTube question" is just a question with YouTube media.

### Question answer types

| Answer type | Team phone shows | Scoring |
| --- | --- | --- |
| `multiple_choice` | 2 to 6 big buttons (A–F) | Automatic |
| `true_false` | Two buttons, Waar / Niet waar | Automatic |
| `open` | Text field | Auto-suggested by matching against a list of accepted answers (case- and accent-insensitive, small typos allowed); host confirms or overrides each one |
| `number` | Number field | Closest team wins the points, or every team within a set tolerance scores |
| `buzzer` | One big BUZZ button | Game-show style: the first team to press is shown on the TV with a sound, answers out loud, and the host marks it right or wrong. Wrong reopens the buzzer for the other teams |
| `rapid_sequence` (flitsreeks) | One big button with a custom label, such as WINNAAR! | Per image: pressed while it was on screen counts as yes, not pressed as no. Points per correct image, optional speed bonus (see Flitsreeks) |

Every question has `points` (default 1), an optional `timeLimitSec`, optional `hostNotes` (host phone only) and an optional `explanation` shown on the TV at reveal.

### Flitsreeks (rapid image sequence)

A flitsreeks is one question made of 5 to 20 images shown one after another, each for a fixed time (default 5 seconds), with a single yes/no statement for the whole series. Example: ten photos of people, "Winnaar of verliezer in 2026? Druk op WINNAAR bij een winnaar."

- **TV:** the statement first, a 3-2-1 countdown, then each image full screen with a progress bar and a counter ("3 / 10"). Nothing shows which teams pressed during the run.
- **Phones:** one big button with the configured label. A press while an image is on screen marks that image "yes" for the team; no press means "no". The first press from any phone in the team counts and cannot be undone, so speed and nerve both matter.
- **Timing:** the server owns the schedule. It sends a start timestamp and image duration, judges each press by its own receive time, and gives a 300 ms grace window after each image switch to absorb Wi-Fi delay (configurable).
- **Scoring:** `pointsPerImage` (default 1) for every image judged correctly, both presses and non-presses. Optional `speedBonus` adds up to 1 point for a correct press in the first second. Optional `wrongPressPenalty` subtracts points for pressing on a "no" image.
- **Reveal:** the TV shows all images in a grid, each marked yes or no, with how many teams pressed on it; the host can step through them one by one.

```json
{
  "kind": "question",
  "answerType": "rapid_sequence",
  "prompt": "Winnaar of verliezer in 2026?",
  "buttonLabel": "WINNAAR!",
  "secondsPerImage": 5,
  "scoring": { "pointsPerImage": 1, "speedBonus": true, "wrongPressPenalty": 0 },
  "images": [
    { "src": "media/persoon1.jpg", "yes": true, "caption": "Won het EK" },
    { "src": "media/persoon2.jpg", "yes": false, "caption": "Degradeerde" }
  ]
}
```

Captions are only shown at reveal.

### Media attachments

| Media | Configured with | Playback notes |
| --- | --- | --- |
| Image | Upload, or URL fetched and stored locally | Reveal effect: none, pixelated to sharp, zoomed in to full, or blurred to sharp, over the timer duration |
| YouTube | Video URL or ID, `startSec`, `endSec`, `hideVideo` | `hideVideo` plays audio only behind a cover, for music or sound questions |
| Spotify | Track URL or URI, `startSec`, `endSec` | TV shows an animated equaliser, never the title, artist or cover until reveal |
| News | Article URL | Server fetches the headline and `og:image` once and stores them; the question can blank a word from the headline |

Media can be set to play **before** the question text (watch first, then the question appears) or **with** it. Media can also be attached to the reveal instead, for example the full clip after a guess-the-song question.

### Slides

Slides are pre-authored items for round intros, rules, breaks and the final "en de winnaar is..." moment. A slide has a title, a short Markdown body, an optional background image or colour, and optional media. Common uses:

- Round intro: "Ronde 3: Muziek uit de jaren 90" with the rules for that round.
- Break: "Pauze — 10 minuten" with a countdown.
- Scoreboard slide: a slide that tells the TV to show the current standings.

Live host messages from the host remote are separate from slides: they are typed during the game, are not saved in the quiz, and are overlaid on whatever the TV shows.

### Random trivia (later phase)

An admin action "Add a trivia round" pulls multiple-choice questions from the Open Trivia DB API by category and difficulty, stores them as normal editable questions, and marks them as English. Ollama-drafted Dutch questions can come after that.

## YouTube and Spotify

Both play on the TV page, so the TV should be a browser on the laptop itself, opened at `http://127.0.0.1:8080/tv` and shown via HDMI or a cast Chrome tab. That one choice solves YouTube sign-in, Spotify playback and Spotify's redirect rules together.

### YouTube without ads

- The app does not log in to YouTube. The embedded IFrame player uses whatever Google account is signed in to that browser, so signing the laptop's Chrome profile into a YouTube Premium (Family) account removes ads in the embeds.
- Use the normal `youtube.com` embed, not `youtube-nocookie.com`, which ignores the sign-in.
- Use the IFrame Player API: `loadVideoById({videoId, startSeconds, endSeconds})`, listen for `onStateChange` to tell the server when the clip ends, and expose play, pause and replay to the host remote.
- Some videos block embedding (player errors 101 and 150). The admin editor tests every YouTube item on save and flags blocked ones.
- The settings page has a "YouTube test" that plays a known clip and shows whether an ad appeared, so the host can check the sign-in before guests arrive.

### Spotify sync

Spotify works for a personal app like this, within the current rules: since February 2026, Development Mode apps need the app owner to have Premium, allow one Client ID per developer and at most five authorised users (https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security). Only the host signs in, so this fits. Redirect URIs must be HTTPS or a loopback IP such as `http://127.0.0.1`; `localhost` is not accepted (https://developer.spotify.com/documentation/web-api/concepts/redirect_uri).

**Setup (once):** create an app in the Spotify developer dashboard, add `http://127.0.0.1:8080/api/spotify/callback` as redirect URI, put the Client ID in the environment, then click "Connect Spotify" in admin settings from a browser on the laptop. Use Authorization Code with PKCE; the server stores the refresh token in SQLite and refreshes access tokens itself. Being signed in to Spotify in another browser tab is not enough and is not needed: Kwistig plays through its own player with its own sign-in, and this connect step happens once, not every quiz night.

**Playback, two modes:**

1. **TV player (default).** The TV page loads the Spotify Web Playback SDK and registers as a Spotify Connect device called "Kwistig TV". To play a clip the server calls the Web API play endpoint for that device with the track URI and `position_ms`, then pauses at `endSec`. This needs a desktop browser with DRM support and a secure context, which `127.0.0.1` provides and a LAN IP over plain HTTP does not.
2. **Connect device (fallback).** If the TV page is not on the laptop, the host picks any active Spotify Connect device in admin (a speaker, a phone, a Chromecast) and the server controls playback there.

**Playlist import.** In admin, "Import from Spotify" lists the host's own playlists; picking one creates a music round with one question per selected track (default: "Wie is de artiest?", open answer, accepted answer pre-filled from the track's artist, a random 20-second start point the host can adjust).

**To verify during build:** Spotify reduced the set of endpoints available in Development Mode. Confirm the player, playlist and track endpoints used here still work for a new Development Mode app before building the import feature (https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide).

## Data model and JSON import

Quiz content and live game state are stored separately: a quiz is reusable content, a game session is one evening's play of it with its own teams and scores.

| Table | Key fields |
| --- | --- |
| `quiz` | id, title, language (`nl` or `en`), description, created/updated |
| `round` | id, quizId, order, title, default points and time limit |
| `item` | id, roundId, order, kind (`question` or `slide`), JSON payload validated by type |
| `media_asset` | id, quizId, kind (`image`, `youtube`, `spotify`, `news`), stored file path or external id, SHA-256, cached metadata |
| `game_session` | id, quizId, join code, state, current item, started/ended |
| `team` | id, sessionId, name, emoji, colour, photo path, score, standings state (leader, last place, crack level) |
| `player` | id, teamId, nickname, token hash, last seen (one row per phone) |
| `answer` | id, sessionId, itemId, teamId, playerId (last to change it), subIndex (image number in a flitsreeks), value, submittedAt, verdict (`correct`, `half`, `wrong`, `pending`), points |
| `setting` | key, value (base URL, PIN hash, Spotify tokens, default language) |

### JSON import format

Import accepts either a single `.json` file or a `.zip` containing `quiz.json` plus a `media/` folder. Images are referenced by a path inside the zip (`media/...`) or by URL, which the server downloads and stores. Any text field can be a plain string (in the quiz language) or an object with `nl` and `en`. Export writes the same format, so a quiz round-trips.

```json
{
  "version": 1,
  "title": "Kerstquiz 2026",
  "language": "nl",
  "rounds": [
    {
      "title": "Ronde 1: Muziek",
      "defaults": { "points": 1, "timeLimitSec": 30 },
      "items": [
        {
          "kind": "slide",
          "title": "Ronde 1: Muziek",
          "body": "Herken het nummer. **Artiest** is genoeg."
        },
        {
          "kind": "question",
          "answerType": "open",
          "prompt": "Wie zingt dit?",
          "acceptedAnswers": ["Doe Maar"],
          "media": { "type": "spotify", "uri": "spotify:track:...", "startSec": 42, "endSec": 62, "play": "before" }
        },
        {
          "kind": "question",
          "answerType": "multiple_choice",
          "prompt": { "nl": "Wat gebeurt er hierna?", "en": "What happens next?" },
          "options": ["Hij valt", "Hij springt", "Hij danst", "Hij rent weg"],
          "correct": 2,
          "media": { "type": "youtube", "videoId": "...", "startSec": 75, "endSec": 90 }
        },
        {
          "kind": "question",
          "answerType": "number",
          "prompt": "Hoeveel treden heeft deze trap?",
          "correct": 128,
          "scoring": { "mode": "closest" },
          "media": { "type": "image", "src": "media/trap.jpg", "reveal": "zoom" },
          "hostNotes": "Bron: gemeentearchief"
        }
      ]
    }
  ]
}
```

**Validation.** One Zod schema is the single source of truth: it validates imports, types the editor, and is exported as JSON Schema at `/api/schema/quiz.json`. That file can be handed to an LLM to generate quizzes that import cleanly. Import errors list the exact path, such as `rounds[0].items[2].options: needs 2 to 6 entries`, and nothing is saved until the whole file is valid.

### Quiz packages (download and upload)

Every quiz can be downloaded and uploaded on its own as one zip, from the admin library and the host remote's quiz picker. A package is `kwistig-<quiz-slug>.zip` containing:

- `manifest.json`: package format version, app version, quiz id, export date, and a checksum per file.
- `quiz.json`: the quiz in the import format above.
- `media/`: every uploaded image the quiz uses.
- `cache/`: fetched news headlines and images, and stored YouTube and Spotify metadata, so the quiz shows correctly without fetching anything again.

Uploading a package validates it, shows a preview (title, rounds, question count, size), and offers **import as new quiz** or, when the same quiz id already exists, **replace it**. Media files are stored by SHA-256, so shared images are not duplicated. Game sessions, scores and team photos are not part of a package.

The package holds JSON and files rather than a SQLite file: one database holds all quizzes plus live game state, so per-quiz JSON is what can move cleanly between installs, be read in a text editor, or be generated by an LLM. A full backup of everything, including the database, is a separate download in settings; it uses SQLite's `VACUUM INTO` so the copy is consistent even while the app runs.

## Internationalisation

Dutch is the default and the reference language; English is a full second language. Two separate things are translated:

1. **App UI strings** (buttons, labels, errors, "Ingeleverd", "Wacht op de quizmaster"). These live in `nl.json` and `en.json` message files via `react-i18next`. Every string goes through a key from day one; a CI check fails if a key exists in `nl` but not in `en`.
2. **Quiz content.** Each quiz has a language. Any text field may be a string in that language or an `{nl, en}` object. The TV shows the quiz language; a team phone may switch to the other language and falls back to the quiz language where no translation exists.

Language choice per screen: admin and host remote follow the host setting; the TV follows the quiz; team phones start with the quiz language and remember a manual switch. Dates and numbers use `Intl` with `nl-NL` or `en-GB`. Answer matching for open questions ignores case, accents and leading articles in both languages (`de`, `het`, `een`, `the`, `a`).

## Build phases

Each phase ends with something playable; phase 2 is the first real quiz night.

### Phase 1 — Skeleton and data

- [ ] Repo, Docker multi-stage build, Compose file, health endpoint
- [ ] SQLite with Drizzle migrations, Zod quiz schema, JSON import and export (plain `.json`)
- [ ] Host PIN login, i18n setup with `nl` and `en` files
- [ ] Admin: quiz list and a basic editor for rounds, slides and text-only questions

**Done when:** a sample quiz JSON imports, shows in the editor, and exports identically.

### Phase 2 — Live game core

- [ ] Game session with join code, WebSocket hub, server-side state machine
- [ ] TV: lobby with QR code, team photo grid, question, reveal, slide and scoreboard views
- [ ] Team phones: join as a new team or an existing one, shared team answer synced across phones, team photo step, multiple choice, true/false, open and number answers, rejoin by token
- [ ] Host remote: quiz picker, navigation, timer, lock, reveal, mark open answers, score adjust, live messages, team and phone management

**Done when:** three phones join over Wi-Fi from the laptop running Docker, take team photos, play a 10-question text quiz, and refreshing any device mid-game recovers its state. Two phones in the same team see each other's answer changes within a second.

### Phase 3 — Media

- [ ] Image upload with reveal effects
- [ ] Quiz packages: per-quiz zip download and upload; full backup download
- [ ] Flitsreeks question type with server-timed presses and reveal grid
- [ ] YouTube via the IFrame Player API with start/end, audio-only cover, embed check
- [ ] News article fetch (headline and image cached)
- [ ] Media controls on the host remote

**Done when:** a YouTube clip plays exactly from `startSec` to `endSec` on the TV and the host can replay it from the phone.

### Phase 4 — Spotify

- [ ] PKCE connect flow on `127.0.0.1`, token refresh
- [ ] Web Playback SDK device on the TV, Connect-device fallback
- [ ] Playlist import into a music round

**Done when:** a Spotify question plays a 20-second fragment on the TV without showing track info, and stops on time.

### Phase 5 — Polish and extras

- [ ] Buzzer answer type, sounds, standings effects on team photos (confetti, cracks, sparkles, poof), rank animations, final "winnaar" sequence
- [ ] Open Trivia DB round generator; optional Ollama drafting
- [ ] Print view of a quiz with answers for the host

## Open decisions to settle early

- Whether team phones may see the question text on their own screen, or only the answer inputs (TV-only keeps everyone watching the TV).
- Default scoring for `number` questions: closest-wins or tolerance.
- Whether to support two TV pages at once (for example a second screen in the kitchen).
