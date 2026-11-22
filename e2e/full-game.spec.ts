import fs from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * A full game with one TV, one host and two teams on three phones (team A has
 * two phones, to check the shared answer). Screenshots go to test-results/demo/.
 */

const PIN = "e2e-pin-4321";
const root = path.resolve(import.meta.dirname, "..");
const quiz = JSON.parse(fs.readFileSync(path.join(root, "samples/text-10.json"), "utf8")) as object;
const shots = path.join(root, "test-results/demo");

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const TV = { viewport: { width: 1920, height: 1080 } };

async function newPage(browser: Browser, opts: object) {
  const ctx = await browser.newContext(opts);
  return ctx.newPage();
}

async function signIn(page: Page, url: string) {
  await page.goto(url);
  await page.getByLabel("Pincode").fill(PIN);
  await page.getByRole("button", { name: "Inloggen" }).click();
  await expect(page.getByLabel("Pincode")).toHaveCount(0);
}

/** Demo screenshot, taken after CSS transitions settle. */
async function shot(page: Page, name: string) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(shots, `${name}.png`) });
}

test("full game: TV, host and two teams", async ({ browser }) => {
  fs.mkdirSync(shots, { recursive: true });

  // ---------------------------------------------------------------- setup
  const host = await newPage(browser, PHONE);
  await signIn(host, "/host");
  const imported = await host.request.post("/api/quizzes/import", { data: quiz });
  expect(imported.status()).toBe(201);
  await host.reload();
  // On a repeated run a game is already going: confirm stopping it.
  host.on("dialog", (d) => void d.accept());
  const quizzesTab = host.getByRole("button", { name: "Quizzen" });
  await expect(quizzesTab.or(host.getByRole("button", { name: "Start" })).first()).toBeVisible();
  if (await quizzesTab.isVisible()) await quizzesTab.click();
  await host
    .getByRole("listitem")
    .filter({ hasText: "Huiskamerquiz: tien vragen" })
    .first()
    .getByRole("button", { name: "Start" })
    .click();
  await expect(host.getByText("Teams melden zich aan")).toBeVisible();

  const tv = await newPage(browser, TV);
  await signIn(tv, "/tv");
  await expect(tv.getByTestId("join-qr")).toBeVisible();
  const joinUrl = (await tv.getByTestId("join-url").textContent())!;
  const code = joinUrl.split("/").pop()!;
  expect(code).toMatch(/^[A-Z]{4}$/);

  // ---------------------------------------------------------------- join
  const sanne = await newPage(browser, PHONE);
  await sanne.goto(`/join/${code}`);
  await sanne.getByLabel("Teamnaam").fill("De Bollen");
  await sanne.getByLabel("Jouw naam (optioneel)").fill("Sanne");
  await sanne.getByRole("button", { name: "Team aanmaken" }).click();
  await expect(sanne.getByTestId("play-team-name")).toHaveText("De Bollen");

  const jip = await newPage(browser, PHONE);
  await jip.goto(`/join/${code}`);
  await jip.getByRole("button", { name: /De Bollen/ }).click();
  await jip.getByLabel("Jouw naam (optioneel)").fill("Jip");
  await jip.getByRole("button", { name: "Aansluiten" }).click();
  await expect(jip.getByTestId("play-team-name")).toHaveText("De Bollen");

  const kim = await newPage(browser, PHONE);
  await kim.goto(`/join/${code}`);
  await expect(kim.getByRole("button", { name: /De Bollen/ })).toBeVisible();
  await kim.getByRole("tab", { name: "Nieuw team" }).click();
  await kim.getByLabel("Teamnaam").fill("Quizzers");
  await kim.getByLabel("Jouw naam (optioneel)").fill("Kim");
  await kim.getByRole("button", { name: "Team aanmaken" }).click();
  await expect(kim.getByTestId("play-team-name")).toHaveText("Quizzers");

  await expect(tv.getByText("2 teams doen mee")).toBeVisible();
  await shot(tv, "01-tv-lobby");
  await shot(sanne, "02-phone-lobby");

  // ---------------------------------------------------------------- photos
  await host.getByRole("button", { name: /Teamfoto's maken/ }).click();
  await expect(tv.getByText("Teamfoto's!")).toBeVisible();
  const jpeg = await sanne.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 1200;
    c.height = 900;
    const g = c.getContext("2d")!;
    const grad = g.createLinearGradient(0, 0, 1200, 900);
    grad.addColorStop(0, "#f59e0b");
    grad.addColorStop(1, "#ec4899");
    g.fillStyle = grad;
    g.fillRect(0, 0, 1200, 900);
    g.font = "bold 300px sans-serif";
    g.fillText("🧠", 420, 560);
    return c.toDataURL("image/jpeg", 0.9).split(",")[1]!;
  });
  await sanne.getByTestId("photo-input").setInputFiles({ name: "team.jpg", mimeType: "image/jpeg", buffer: Buffer.from(jpeg, "base64") });
  await sanne.getByRole("button", { name: "Gebruik deze foto" }).click();
  await expect(sanne.getByText("Mooie foto!")).toBeVisible();
  await expect(tv.getByRole("img", { name: "De Bollen" })).toHaveAttribute("src", /\/api\/sessions\/\d+\/photos\/team-/);
  await expect(host.getByText("Nog geen foto: Quizzers")).toBeVisible();
  await shot(tv, "03-tv-photos");
  await host.getByRole("button", { name: /Start zonder alle foto's/ }).click();

  // ---------------------------------------------------------------- slide, then Q1 (multiple choice)
  await expect(tv.getByRole("heading", { name: "Ronde 1: Nederland" })).toBeVisible();
  await expect(sanne.getByText("Kijk naar de tv")).toBeVisible();
  await host.getByRole("button", { name: "Volgende →" }).first().click();

  await expect(tv.getByRole("heading", { name: "Wat is de hoofdstad van Nederland?" })).toBeVisible();
  await expect(host.getByTestId("host-correct")).toContainText("Amsterdam");
  await expect(host.getByText("Den Haag is de regeringszetel")).toBeVisible();
  // Nothing on the TV or phones gives the answer away before reveal.
  await expect(tv.getByText("✓")).toHaveCount(0);
  await expect(tv.getByText("regeringszetel")).toHaveCount(0);

  await host.getByRole("button", { name: /Open de vraag/ }).click();
  // Team voting: each phone votes; teammates see who voted for what within a second.
  await sanne.getByTestId("vote-option-0").click(); // Rotterdam
  await expect(jip.getByTestId("vote-option-0")).toContainText("Sanne", { timeout: 1000 });
  await jip.getByTestId("vote-option-2").click(); // Amsterdam
  await expect(sanne.getByTestId("vote-option-2")).toContainText("Jip", { timeout: 1000 });
  await expect(sanne.getByTestId("vote-status")).toContainText("Gelijke stand");
  await expect(host.getByTestId("host-tally").first()).toContainText("(1)");
  await sanne.getByTestId("vote-option-2").click(); // Sanne is convinced: 2–0
  await expect(jip.getByTestId("vote-option-2")).toContainText("Sanne");
  await expect(jip.getByTestId("vote-status")).not.toContainText("Gelijke stand");
  await kim.getByTestId("vote-option-1").click(); // Den Haag
  await expect(tv.locator("[data-state=in]")).toHaveCount(2);
  await shot(tv, "04-tv-question");
  await shot(jip, "05-phone-vote");
  await shot(host, "06-host-answering");

  await host.getByRole("button", { name: /Antwoorden sluiten/ }).click();
  await expect(sanne.getByTestId("play-team-answer")).toHaveText(/Amsterdam/);
  await expect(sanne.getByTestId("play-locked")).toContainText("2 van 2 stemmen");
  await host.getByRole("button", { name: /Toon antwoord/ }).click();
  await expect(sanne.getByTestId("play-result")).toHaveAttribute("data-verdict", "correct");
  await expect(kim.getByTestId("play-result")).toHaveAttribute("data-verdict", "wrong");
  await expect(tv.getByText("Den Haag is de regeringszetel")).toHaveCount(0); // host notes never reach the TV
  await expect(tv.locator("[data-state=right]")).toHaveCount(1);
  await shot(tv, "07-tv-reveal");
  await shot(sanne, "08-phone-result");

  // A phone that refreshes comes back in the same team and state.
  await sanne.reload();
  await expect(sanne.getByTestId("play-team-name")).toHaveText("De Bollen");
  await expect(sanne.getByTestId("play-result")).toHaveAttribute("data-verdict", "correct");
  await expect(sanne.getByTestId("play-score")).toHaveText("1");

  // ---------------------------------------------------------------- Q2 true/false: a 1–1 tie is drawn
  await host.getByRole("button", { name: "Volgende →" }).first().click();
  await host.getByRole("button", { name: /Open de vraag/ }).click();
  await expect(host.getByText("0 van 2 teams geantwoord")).toBeVisible();
  await sanne.getByTestId("vote-option-0").click(); // Waar
  await jip.getByTestId("vote-option-1").click(); // Niet waar
  await kim.getByTestId("vote-option-0").click();
  await expect(host.getByText("2 van 2 teams geantwoord")).toBeVisible();
  await host.getByRole("button", { name: /Antwoorden sluiten/ }).click();
  await expect(jip.getByTestId("play-locked")).toContainText("Geloot uit een gelijke stand");
  await expect(host.getByTestId(/host-answer-/).filter({ hasText: "De Bollen" }).getByText("geloot")).toBeVisible();
  await host.getByRole("button", { name: /Toon antwoord/ }).click();
  await expect(kim.getByTestId("play-result")).toHaveAttribute("data-verdict", "correct");
  await expect(jip.getByTestId("play-result")).toHaveAttribute("data-verdict", /correct|wrong/);
  await expect(tv.getByText("De Afsluitdijk is 32 kilometer lang.")).toBeVisible();

  // ---------------------------------------------------------------- Q3 open: propose, vote along, fuzzy match, host overrides
  await host.getByRole("button", { name: "Volgende →" }).first().click();
  await host.getByRole("button", { name: /Open de vraag/ }).click();
  await expect(jip.getByText("In welke stad staat de Domtoren?")).toBeVisible();
  await jip.getByPlaceholder("Typ een antwoord").fill("utreht");
  await jip.getByPlaceholder("Typ een antwoord").press("Enter");
  // Jip's proposal shows up on Sanne's phone; she votes for it with one tap.
  await sanne.getByTestId("proposals").getByRole("button", { name: /utreht/ }).click();
  await expect(jip.getByTestId("proposals").getByRole("button", { name: /utreht/ })).toContainText("2");
  await shot(sanne, "07b-phone-proposals");
  await kim.getByPlaceholder("Typ een antwoord").fill("Amersfoort");
  await kim.getByRole("button", { name: "Stem" }).click();
  await host.getByRole("button", { name: /Antwoorden sluiten/ }).click();
  const bollenRow = host.getByTestId(/host-answer-/).filter({ hasText: "De Bollen" });
  await expect(bollenRow.getByText("bijna")).toBeVisible();
  await expect(bollenRow.getByRole("button", { name: "Goed" })).toHaveAttribute("aria-pressed", "true");
  const quizzersRow = host.getByTestId(/host-answer-/).filter({ hasText: "Quizzers" });
  await quizzersRow.getByRole("button", { name: "Half" }).click();
  await expect(quizzersRow.getByRole("button", { name: "Half" })).toHaveAttribute("aria-pressed", "true");
  await shot(host, "09-host-marking");
  await host.getByRole("button", { name: /Toon antwoord/ }).click();
  await expect(kim.getByTestId("play-result")).toHaveAttribute("data-verdict", "half");
  await expect(kim.getByTestId("play-score")).toHaveText("1,5");

  // ---------------------------------------------------------------- live message and scoreboard overlay
  await host.getByRole("button", { name: "Berichten" }).click();
  await host.getByRole("listitem").filter({ hasText: "Pauze! Tijd voor een drankje" }).getByRole("button", { name: "Als dia" }).click();
  await expect(tv.getByText("Pauze! Tijd voor een drankje")).toBeVisible();
  await shot(tv, "10-tv-message");
  await host.getByRole("button", { name: "Bericht weghalen" }).click();
  await expect(tv.getByText("Pauze! Tijd voor een drankje")).toHaveCount(0);
  await host.getByRole("button", { name: "Spel" }).click();
  await host.getByRole("button", { name: "Tussenstand op tv" }).click();
  await expect(tv.getByRole("heading", { name: "Tussenstand" })).toBeVisible();
  await shot(tv, "11-tv-scoreboard");
  await host.getByRole("button", { name: "Tussenstand weg" }).click();

  // ---------------------------------------------------------------- team management: score adjust
  await host.getByRole("button", { name: "Teams" }).click();
  await host
    .getByTestId(/host-team-/)
    .filter({ has: host.getByRole("button", { name: "Quizzers", exact: true }) })
    .getByRole("button", { name: "+1", exact: true })
    .click();
  await expect(kim.getByText(/^2,5 · #\d/)).toBeVisible(); // rank depends on the Q2 draw
  await host.getByRole("button", { name: "Spel" }).click();

  // ---------------------------------------------------------------- jump to the last item, then finish
  await host.getByText("Volgorde").click();
  await host.getByRole("button", { name: /En de winnaar is/ }).click();
  await expect(tv.getByRole("heading", { name: "En de winnaar is..." })).toBeVisible();
  await host.getByRole("button", { name: /Naar de eindstand/ }).first().click();
  await expect(tv.getByRole("heading", { name: "Eindstand" })).toBeVisible();
  await expect(tv.getByText("Winnaar!")).toBeVisible();
  await expect(kim.getByText("Klaar! Jullie eindigden als")).toBeVisible();
  await shot(tv, "12-tv-final");
});
