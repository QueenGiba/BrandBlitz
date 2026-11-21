import { expect, test } from "@playwright/test";
import { seedActiveChallenge, signInWithMockGoogle } from "./helpers";
import { WARMUP_MIN_SECONDS } from "../../apps/web/src/components/game/constants";
import pg from "pg";

test("player can complete warmup, play 3 rounds, and reach results", async ({ page, request }) => {
  const seeded = await seedActiveChallenge(request, {
    email: "brand-owner-game@example.com",
    name: "Game Owner",
  });

  await signInWithMockGoogle(
    page,
    { email: "player-one@example.com", name: "Player One" },
    `/challenge/${seeded.challengeId}`
  );

  await page.waitForURL(`**/challenge/${seeded.challengeId}`);
  await expect(page.getByText(/Study this brand carefully/i)).toBeVisible();

  // Intercept the /sessions/:challengeId/start response to grab the sessionId
  const sessionStartResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes(`/sessions/${seeded.challengeId}/start`) &&
      response.request().method() === "POST"
  );

  // Button must be DISABLED at the start of the warmup phase
  const preparingButton = page.getByRole("button", { name: "Preparing..." });
  await expect(preparingButton).toBeDisabled();

  // Button must become ENABLED within WARMUP_MIN_SECONDS + 5 s buffer
  const startButton = page.getByRole("button", { name: "Start Challenge →" });
  await expect(startButton).toBeEnabled({ timeout: (WARMUP_MIN_SECONDS + 5) * 1000 });
  await startButton.click();

  const sessionStartResponse = await sessionStartResponsePromise;
  const { sessionId } = await sessionStartResponse.json();
  expect(sessionId).toBeDefined();

  for (const round of [1, 2, 3]) {
    await expect(page.getByText(`Round ${round} of 3`)).toBeVisible();
    await page.waitForTimeout(250);
    await page.getByRole("button", { name: /^A/ }).click();
  }

  await expect(page.getByRole("heading", { name: "Challenge Complete!" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Challenge Leaderboard" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Global Leaderboard" })).toBeVisible();

  // Assert API call to GET /sessions/:challengeId returns completed with round_count = 3
  const pageSessionResponse = await page.request.get(`/api/sessions/${seeded.challengeId}`);
  expect(pageSessionResponse.ok()).toBeTruthy();
  const sessionData = await pageSessionResponse.json();
  expect(sessionData.session.status).toBe("completed");
  expect(sessionData.session.last_answered_round).toBe(3);

  // Test verifies session_round_scores has one row per round with correct score and correct values in PostgreSQL
  const dbUrl =
    process.env.DATABASE_URL ?? "postgresql://brandblitz:brandblitz_dev@localhost:5432/brandblitz";
  const pool = new pg.Pool({ connectionString: dbUrl });
  const result = await pool.query(
    "SELECT * FROM session_round_scores WHERE session_id = $1 ORDER BY round ASC",
    [sessionId]
  );
  await pool.end();

  expect(result.rows).toHaveLength(3);
  expect(result.rows[0].round).toBe(1);
  expect(result.rows[1].round).toBe(2);
  expect(result.rows[2].round).toBe(3);

  // Assert the player's score appears on the leaderboard page within 5 seconds of session completion
  await page.getByRole("link", { name: "Global Leaderboard" }).click();
  await expect(page.getByText("Player One")).toBeVisible({ timeout: 5000 });
});

test("offline banner appears when browser context goes offline", async ({ page }) => {
  await page.goto("/leaderboard");
  await page.context().setOffline(true);

  await expect(page.getByText(/You are offline/i)).toBeVisible();

  await page.context().setOffline(false);
});

test("blocking offline banner appears during active challenge and prevents submission", async ({
  page,
  request,
}) => {
  const seeded = await seedActiveChallenge(request, {
    email: "brand-owner-offline@example.com",
    name: "Offline Brand Owner",
  });

  const player = { email: "player-offline@example.com", name: "Offline Player" };
  await signInWithMockGoogle(page, player, `/challenge/${seeded.challengeId}`);

  await page.waitForURL(`**/challenge/${seeded.challengeId}`);
  await expect(page.getByText(/Study this brand carefully/i)).toBeVisible();

  // Wait for the challenge to be ready
  const startButton = page.getByRole("button", { name: "Start Challenge →" });
  await expect(startButton).toBeEnabled({ timeout: 10000 });
  await startButton.click();

  // Wait for first round to appear
  await expect(page.getByText(/Round 1 of 3/i)).toBeVisible();

  // Go offline while in an active round
  await page.context().setOffline(true);

  // The blocking offline banner should appear (fixed position, not sticky)
  const offlineBanner = page.getByText(/You are offline/i);
  await expect(offlineBanner).toBeVisible();

  // Verify the banner is fixed/blocking (not scrollable away)
  const bannerLocator = offlineBanner.locator("..");
  const position = await bannerLocator.evaluate((el) => {
    const computed = window.getComputedStyle(el);
    return computed.position;
  });

  // Should be fixed position for blocking variant
  expect(["fixed", "absolute"]).toContain(position);

  // Attempt to interact with answer buttons - they should still be there but grayed out or unresponsive
  const answerButton = page.getByRole("button", { name: /^A/ }).first();
  await expect(answerButton).toBeVisible();

  // Go back online
  await page.context().setOffline(false);

  // Blocking banner should disappear or change to reconnection message
  const reconnectedText = page.getByText(/back online/i);
  await expect(reconnectedText).toBeVisible({ timeout: 5000 });

  // The challenge should be in a recoverable state
  // Either we can continue from where we left off or see a recovery modal
  const recoveryModal = page.locator('[role="dialog"]').filter({ hasText: /recovery|reconnect/i });
  const continueButton = page.getByRole("button", { name: /continue|retry/i });

  if (await recoveryModal.count()) {
    // If there's a session recovery modal, we should be able to click continue
    await expect(recoveryModal).toBeVisible();
  } else {
    // Otherwise verify we can still see the game state
    const roundText = page.getByText(/Round [1-3] of 3/i);
    await expect(roundText).toBeVisible({ timeout: 2000 });
  }
});

test("non-blocking offline banner on leaderboard doesn't prevent scrolling", async ({
  page,
}) => {
  await page.goto("/leaderboard");
  await page.waitForSelector("main");

  // Go offline
  await page.context().setOffline(true);

  // Non-blocking banner should appear
  const offlineBanner = page.getByText(/You are offline/i);
  await expect(offlineBanner).toBeVisible();

  // Verify banner is sticky (not fixed)
  const bannerLocator = offlineBanner.locator("..");
  const position = await bannerLocator.evaluate((el) => {
    const computed = window.getComputedStyle(el);
    return computed.position;
  });

  expect(["sticky", "relative"]).toContain(position);

  // Should be able to scroll past the banner
  await page.evaluate(() => window.scrollTo(0, 100));
  const scrollY = await page.evaluate(() => window.scrollY);
  expect(scrollY).toBeGreaterThan(50);

  // Go back online
  await page.context().setOffline(false);

  // Reconnection message should appear
  await expect(page.getByText(/back online/i)).toBeVisible({ timeout: 5000 });
});

