import { expect, test } from "@playwright/test";
import pg from "pg";
import { ROUND_SECONDS, WARMUP_MIN_SECONDS } from "../../apps/web/src/components/game/constants";
import { seedActiveChallenge, signInWithMockGoogle } from "./helpers";

const DB_URL =
  process.env.DATABASE_URL ?? "postgresql://brandblitz:brandblitz_dev@localhost:5432/brandblitz";

test("round timeout shows low-time urgency state, auto-advances, and records zero-point non-answer", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);

  const seeded = await seedActiveChallenge(request, {
    email: "brand-owner-timeout@example.com",
    name: "Timeout Brand Owner",
  });

  await signInWithMockGoogle(
    page,
    { email: "player-timeout@example.com", name: "Timeout Player" },
    `/challenge/${seeded.challengeId}`
  );
  await page.waitForURL(`**/challenge/${seeded.challengeId}`);

  const sessionStartPromise = page.waitForResponse(
    (response) =>
      response.url().includes(`/sessions/${seeded.challengeId}/start`) &&
      response.request().method() === "POST"
  );

  const startButton = page.getByRole("button", { name: "Start Challenge →" });
  await expect(startButton).toBeEnabled({ timeout: (WARMUP_MIN_SECONDS + 5) * 1000 });
  await startButton.click();

  const sessionStartResponse = await sessionStartPromise;
  const { sessionId } = (await sessionStartResponse.json()) as { sessionId: string };
  expect(sessionId).toBeDefined();

  // Round 1: do not click any answer option and wait for timer urgency + expiry
  await expect(page.getByText("Round 1 of 3")).toBeVisible();

  const timerNumber = page.locator('[data-tutorial="timer"] span').first();
  await expect(timerNumber).toBeVisible();

  // isLow (<= 5s) applies red pulsing classes before expiry
  await expect(timerNumber).toHaveClass(/animate-pulse/, {
    timeout: (ROUND_SECONDS + 2) * 1000,
  });
  await expect(timerNumber).toHaveClass(/text-red-500/);

  // Wait for round 1 to expire and auto-advance to Round 2 without any click
  const round1AnswerPromise = page.waitForResponse(
    (response) =>
      response.url().includes(`/sessions/${seeded.challengeId}/answer/1`) &&
      response.request().method() === "POST"
  );
  await expect(page.getByText("Round 2 of 3")).toBeVisible({
    timeout: (ROUND_SECONDS + 5) * 1000,
  });

  const round1AnswerResponse = await round1AnswerPromise;
  expect(round1AnswerResponse.ok()).toBeTruthy();
  const round1Payload = (await round1AnswerResponse.json()) as {
    correct: boolean;
    score: number;
  };
  expect(round1Payload.correct).toBe(false);
  expect(round1Payload.score).toBe(0);

  // Answer rounds 2 and 3 normally to finish the session
  for (const round of [2, 3]) {
    await expect(page.getByText(`Round ${round} of 3`)).toBeVisible();
    await page.waitForTimeout(250);
    await page.getByRole("button", { name: /^A:/ }).click();
  }

  await expect(page.getByRole("heading", { name: "Challenge Complete!" })).toBeVisible({
    timeout: 10_000,
  });

  // Verify persisted session and round score records reflect a non-answer (NULL, 0 pts)
  const pool = new pg.Pool({ connectionString: DB_URL });
  const sessionResult = await pool.query(
    `SELECT round_1_answer, round_1_score
     FROM game_sessions
     WHERE id = $1`,
    [sessionId]
  );
  const roundScoresResult = await pool.query(
    `SELECT round, score, correct
     FROM session_round_scores
     WHERE session_id = $1 AND round = 1`,
    [sessionId]
  );
  await pool.end();

  expect(sessionResult.rows).toHaveLength(1);
  expect(sessionResult.rows[0].round_1_answer).toBeNull();
  expect(sessionResult.rows[0].round_1_score).toBe(0);

  expect(roundScoresResult.rows).toHaveLength(1);
  expect(roundScoresResult.rows[0].score).toBe(0);
  expect(roundScoresResult.rows[0].correct).toBe(false);
});
