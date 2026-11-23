# Test night checklist

A dress rehearsal with real devices, using the quiz **Generale repetitie** (`samples/generale-repetitie.zip`). It touches every question type, every media type and every effect once. Plan about 30 minutes.

Tick things off as you go and write down anything odd: what you did, on which device, and what you expected instead.

## What you need

- The laptop running Kwistig (`docker compose up -d`), connected to the TV.
- Your phone as the host.
- At least three other phones for two teams, so one team has two players. Four phones is better.
- Spotify connected in **Admin → Instellingen** (optional: skip question 2.3 without it).
- Sound on the TV.

## Before the guests arrive

- [ ] In **Admin**, the quiz *Generale repetitie* is in the list. If not, build the package with `node scripts/make-sample-package.mjs generale-repetitie` and upload `samples/generale-repetitie.zip` with **Pakket uploaden**.
- [ ] Open the quiz and click **🖨 Afdrukken**. Every question shows its answer; the Spotify and YouTube questions show their clip times. Untick *Met antwoorden*: the answers disappear.
- [ ] In the editor, click **+ Trivia-ronde toevoegen**, pick a category and fetch 5 questions. A fourth round appears with English questions. Keep it if you like, then **Opslaan**.
- [ ] Click a question in the editor: the preview at the top shows how it looks on the TV.
- [ ] **Admin → Instellingen**: *Geluidseffecten* is on, *Rustige modus* is off.

## Setting up

- [ ] On the laptop, open `http://localhost:8080/tv` in Chrome, sign in, make it full screen (F11) and **click the page once** so sound is allowed.
- [ ] In the same Chrome, **Admin → Instellingen → YouTube-test → Test afspelen**: the music video plays without an ad.
- [ ] On your phone, open `http://<laptop-ip>:8080/host`, sign in and start *Generale repetitie*.
- [ ] The TV shows a QR code. Scan it with two phones and create two teams.
- [ ] Join one of the teams from a third phone (*Bij een team aansluiten*).
- [ ] Start the photo step: each team takes a team photo, and the photos show up on the TV.
- [ ] Switch one phone to English with the NL/EN toggle. Questions that have a translation show in English there.

## Round 1: Warming up

- [ ] **1.1 Multiple choice (Canberra):** the two players in the same team vote for different answers. Both phones show each other's votes. After closing, one of them was picked; the host sees the votes per team. The host note shows on your phone only.
- [ ] **1.2 True/false (octopus):** worth 2 points; the TV shows "2 punten".
- [ ] **1.3 Open question with a blurred image (Van Gogh):** the image starts blurred and sharpens. Type "van gog": it should count as correct. One player types an answer, the other votes for it.
- [ ] **1.4 Number with a zoomed image (stairs):** the image starts zoomed in and zooms out. The team closest to 128 wins the point.
- [ ] **1.5 Number with tolerance (Berlin Wall):** a 20-second timer. 1988, 1989 and 1990 all count. Let the timer run out: answers close by themselves.
- [ ] **Standings slide:** rows slide into place, the leader gets a gold frame and crown, and the last team's photo cracks.

## Round 2: Watch and listen

- [ ] **Background image** on the round slide.
- [ ] **2.1 YouTube, clip first:** press play on your phone. The clip plays 43–53 s, then the question opens and the timer starts.
- [ ] **2.2 YouTube, sound only:** the video is hidden but you hear it. The timer starts together with the sound. On reveal, the next part plays with the picture.
- [ ] **2.3 Spotify:** the music starts together with the timer, and the TV shows no track info. After closing, the next 10 seconds play before you reveal the answer.
- [ ] Try **Opnieuw** (replay) and **Geluid uit** (mute) on your phone during a clip.
- [ ] **2.4 News headline:** the TV shows a real NOS headline with one word blanked out, and the article's photo. *(If the article has been taken down, replace the URL in the editor with a current one.)*
- [ ] **2.5 Pixelated image (podium):** the image starts pixelated and gets sharper.
- [ ] **Break slide:** a 2-minute countdown. Now try:
  - [ ] Refresh a team phone: it comes back in the same team and on the same screen.
  - [ ] Refresh the TV: it comes back where it was.
  - [ ] Restart the container (`docker compose restart`): after a few seconds every device reconnects and the game continues.
- [ ] **Standings slide:** if the order changed, the old leader is dethroned (its frame disappears in a puff) and the new leader sparkles.

## Round 3: Fast and furious

- [ ] **3.1 Buzzer (Volga):** the first team to press gets the turn; the other phones show who pressed first and their button is locked. On your phone, press **Fout**: that team is out and the buzzer opens again for the others. Then **Goed** for the second team: 3 points.
- [ ] **3.2 Buzzer (eleven):** two teams press at almost the same moment. Only one gets the turn.
- [ ] **3.3 Flitsreeks:** after a 3-second countdown, five images flash by, 3 seconds each. Press **WINNAAR!** only for the winners. A wrong press costs half a point. Afterwards each phone shows "x van 5 afbeeldingen goed". Use ▶ on your phone to go through the images on the TV one by one.
- [ ] **Final slide:** a drum roll, the teams appear from last place up, then "En de winnaar is…" with the winning photo, a fanfare and confetti.

## Afterwards

- [ ] On your phone, end the quiz with **Quiz beëindigen**. The TV returns to its waiting screen.
- [ ] **Admin → Sessies** lists tonight's session with the final standings.
- [ ] **Admin → Instellingen → Back-up downloaden** gives you a zip.
- [ ] Optional: turn on *Rustige modus* and play one question. There is no confetti or shaking, and the frames and cracks stay still.

## When something goes wrong

Note the question number, the device (TV, host or which team phone) and what happened. A screenshot from the phone helps. If a device froze, refreshing it should always bring it back.
