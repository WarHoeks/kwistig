import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * Media without the internet: a quiz package with images, an image question with
 * a reveal effect, and a flitsreeks with server-timed presses from two teams.
 * (YouTube needs the internet; it is checked by hand, see README.)
 */

const PIN = "e2e-pin-4321";
const root = path.resolve(import.meta.dirname, "..");
const shots = path.join(root, "test-results/demo");
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

async function newPage(browser: Browser, opts: object) {
  return (await browser.newContext(opts)).newPage();
}

async function signIn(page: Page, url: string) {
  await page.goto(url);
  await page.getByLabel("Pincode").fill(PIN);
  await page.getByRole("button", { name: "Inloggen" }).click();
  await expect(page.getByLabel("Pincode")).toHaveCount(0);
}

async function join(browser: Browser, code: string, team: string) {
  const p = await newPage(browser, PHONE);
  await p.goto(`/join/${code}`);
  await p.getByRole("tab", { name: "Nieuw team" }).click();
  await p.getByLabel("Teamnaam").fill(team);
  await p.getByRole("button", { name: "Team aanmaken" }).click();
  await expect(p.getByTestId("play-team-name")).toHaveText(team);
  return p;
}

test("media package, image reveal and flitsreeks", async ({ browser }) => {
  fs.mkdirSync(shots, { recursive: true });
  const zipPath = path.join(root, "test-results", "kitchen-sink.zip");
  execFileSync(process.execPath, [path.join(root, "scripts/make-sample-package.mjs"), "kitchen-sink", zipPath]);

  // Upload the package through the admin UI: preview, then import.
  const admin = await newPage(browser, { viewport: { width: 1280, height: 900 } });
  await signIn(admin, "/admin");
  await admin.getByTestId("package-input").setInputFiles(zipPath);
  await expect(admin.getByRole("dialog")).toContainText("Kwistig proefquiz");
  await expect(admin.getByRole("dialog")).toContainText("8 mediabestanden");
  await admin.getByRole("button", { name: "Importeren als nieuwe quiz" }).click();
  await expect(admin.getByText("Quiz geïmporteerd.")).toBeVisible();
  const quizzes = await (await admin.request.get("/api/quizzes")).json();
  const quizId = quizzes.find((q: { title: string }) => q.title === "Kwistig proefquiz").id as number;

  // Start it from the host and get two teams in.
  const host = await newPage(browser, PHONE);
  await signIn(host, "/host");
  host.on("dialog", (d) => void d.accept());
  const tabs = host.getByRole("button", { name: "Quizzen" });
  await expect(tabs.or(host.getByRole("button", { name: "Start" })).first()).toBeVisible();
  if (await tabs.isVisible()) await tabs.click();
  await host.getByRole("listitem").filter({ hasText: "Kwistig proefquiz" }).first().getByRole("button", { name: "Start" }).click();
  const confirmOk = host.getByTestId("confirm-ok");
  await host.waitForTimeout(300);
  if (await confirmOk.isVisible()) await confirmOk.click();

  const tv = await newPage(browser, { viewport: { width: 1920, height: 1080 } });
  await signIn(tv, "/tv");
  const code = (await tv.getByTestId("join-url").textContent())!.split("/").pop()!;
  const a = await join(browser, code, "Pixels");
  const b = await join(browser, code, "Sprinters");
  expect(quizId).toBeGreaterThan(0);

  await host.getByRole("button", { name: "Direct beginnen" }).click();
  await host.getByText("Volgorde").click();

  // ---------------------------------------------------------------- image with zoom reveal
  await host.getByRole("button", { name: /Hoeveel treden heeft deze trap/ }).click();
  const img = tv.locator("img[src^='/media/']").first();
  await expect(img).toBeVisible();
  // Before the question opens the image is fully zoomed in.
  await expect(img).toHaveAttribute("style", /scale\(5\)/);
  await host.getByRole("button", { name: /Open de vraag/ }).click();
  await a.getByPlaceholder("Typ een getal").fill("120");
  await a.getByRole("button", { name: "Stem" }).click();
  await host.getByRole("button", { name: /Antwoorden sluiten/ }).click();
  await expect(img).toHaveAttribute("style", /scale\(1\)/); // sharp after lock
  await tv.waitForTimeout(400);
  await tv.screenshot({ path: path.join(shots, "30-tv-image-question.png") });

  // ---------------------------------------------------------------- flitsreeks (run order is still open)
  await host.getByRole("button", { name: /Winnaar of verliezer/ }).click();
  await expect(tv.getByText("WINNAAR!")).toBeVisible();
  await host.getByRole("button", { name: /Start de flitsreeks/ }).click();
  // Countdown, then images; the phones follow the server clock.
  await expect(a.getByTestId("press-status")).toContainText("Begint over");
  await expect(tv.getByTestId("tv-sequence")).toHaveAttribute("data-index", "0", { timeout: 5000 });
  await a.getByTestId("press-button").click(); // image 1: yes
  await expect(a.getByTestId("press-button")).toContainText("Gedrukt");
  await tv.screenshot({ path: path.join(shots, "31-tv-flitsreeks.png") });
  await a.screenshot({ path: path.join(shots, "32-phone-flitsreeks.png") });
  await expect(tv.getByTestId("tv-sequence")).toHaveAttribute("data-index", "1", { timeout: 5000 });
  await b.waitForTimeout(500); // past the grace window
  await b.getByTestId("press-button").click(); // image 2: no — a wrong press
  // The sequence ends by itself and locks.
  await expect(host.getByRole("button", { name: /Toon antwoord/ })).toBeVisible({ timeout: 20_000 });
  await host.getByRole("button", { name: /Toon antwoord/ }).click();
  await expect(tv.getByText("Won het EK")).toBeVisible();
  await tv.waitForTimeout(400);
  await tv.screenshot({ path: path.join(shots, "33-tv-flitsreeks-reveal.png") });
  // Team A: image 1 right, 2 and 4 right (not pressed, "no"), 3 and 5 wrong (missed) → 3/5.
  await expect(a.getByTestId("play-sequence-score")).toHaveText("3 van 5 afbeeldingen goed");
  // Team B pressed only on image 2, a "no": just image 4 is right → 1/5.
  await expect(b.getByTestId("play-sequence-score")).toHaveText("1 van 5 afbeeldingen goed");

  // Spotlight one image from the host.
  await host.getByRole("button", { name: "▶" }).click();
  await expect(tv.getByText("1 / 5")).toBeVisible();
  await tv.screenshot({ path: path.join(shots, "34-tv-flitsreeks-spotlight.png") });
});
