import { expect, test } from "@playwright/test";
import pg from "pg";
import { WARMUP_MIN_SECONDS } from "../../apps/web/src/components/game/constants";
import { seedActiveChallenge, signInWithMockGoogle } from "./helpers";

const DB_URL =
  process.env.DATABASE_URL ?? "postgresql://brandblitz:brandblitz_dev@localhost:5432/brandblitz";
const OPTIONS = ["A", "B", "C", "D"] as const;

type OptionKey = (typeof OPTIONS)[number];

test("incorrect answer renders red ring state, advances round, and yields lower final score than all-correct run", async ({
  browser,
  page,
  request,
}) => {
  test.setTimeout(120_000);

  const seeded = await seedActiveChallenge(request, {
    email: "brand-owner-incorrect@example.com",
    name: "Incorrect Brand Owner",
  });

  // Read the authoritative correct options from PostgreSQL for all 3 rounds
  const pool = new pg.Pool({ connectionString: DB_URL });
  const questionsResult = await pool.query<{ round: number; correct_option: OptionKey }>(
    `SELECT round, correct_option
     FROM challenge_questions
     WHERE challenge_id = $1
     ORDER BY round ASC`,
    [seeded.challengeId]
  );
  await pool.end();

  expect(questionsResult.rows).toHaveLength(3);
  const correctByRound = new Map<number, OptionKey>(
    questionsResult.rows.map((row) => [row.round, row.correct_option])
  );

  // ── 1. Player 1: deliberately answer Round 1 wrong, Rounds 2-3 correct ───
  await signInWithMockGoogle(
    page,
    { email: "player-wrong@example.com", name: "Wrong Answer Player" },
    `/challenge/${seeded.challengeId}`
  );
  await page.waitForURL(`**/challenge/${seeded.challengeId}`);

  const startButton = page.getByRole("button", { name: "Start Challenge →" });
  await expect(startButton).toBeEnabled({ timeout: (WARMUP_MIN_SECONDS + 5) * 1000 });
  await startButton.click();

  // Round 1: pick an option that is NOT the correct_option
  await expect(page.getByText("Round 1 of 3")).toBeVisible();
  const round1Correct = correctByRound.get(1)!;
  const round1Wrong = OPTIONS.find((opt) => opt !== round1Correct)!;

  await page.waitForTimeout(250);
  const wrongButton = page.getByRole("button", { name: new RegExp(`^${round1Wrong}:`) });
  const round1AnswerPromise = page.waitForResponse(
    (response) =>
      response.url().includes(`/sessions/${seeded.challengeId}/answer/1`) &&
      response.request().method() === "POST"
  );
  await wrongButton.click();

  const round1Res = await round1AnswerPromise;
  expect(round1Res.ok()).toBeTruthy();
  const round1Data = (await round1Res.json()) as { correct: boolean; score: number };
  expect(round1Data.correct).toBe(false);
  expect(round1Data.score).toBe(0);

  // Assert wrong-answer visual state (red ring & border classes)
  await expect(wrongButton).toHaveClass(/border-red-600/);
  await expect(wrongButton).toHaveClass(/bg-red-50/);
  await expect(wrongButton).toHaveClass(/text-red-900/);
  await expect(wrongButton).toHaveClass(/ring-2/);
  await expect(wrongButton).toHaveClass(/ring-red-600/);

  // Round still advances normally to Round 2
  await expect(page.getByText("Round 2 of 3")).toBeVisible({ timeout: 5000 });

  // Rounds 2 & 3: pick the known correct options
  for (const round of [2, 3] as const) {
    await expect(page.getByText(`Round ${round} of 3`)).toBeVisible();
    const correctOpt = correctByRound.get(round)!;
    await page.waitForTimeout(250);
    const correctButton = page.getByRole("button", { name: new RegExp(`^${correctOpt}:`) });
    await correctButton.click();

    if (round === 2) {
      await expect(correctButton).toHaveClass(/border-green-600/);
      await expect(correctButton).toHaveClass(/ring-green-600/);
    }
  }

  await expect(page.getByRole("heading", { name: "Challenge Complete!" })).toBeVisible({
    timeout: 10_000,
  });

  const partialSessionRes = await page.request.get(`/api/sessions/${seeded.challengeId}`);
  expect(partialSessionRes.ok()).toBeTruthy();
  const partialSessionData = (await partialSessionRes.json()) as {
    session: { total_score: number; round_scores: number[] };
  };
  const partialScore = partialSessionData.session.total_score;
  expect(partialSessionData.session.round_scores[0]).toBe(0);

  // Wait for ResultScreen animated counter to settle on partialScore
  await expect(page.locator("p.text-6xl")).toHaveText(String(partialScore), { timeout: 5000 });

  // ── 2. Player 2: all-correct run on the same challenge ───────────────────
  const allCorrectContext = await browser.newContext();
  const allCorrectPage = await allCorrectContext.newPage();

  try {
    await signInWithMockGoogle(
      allCorrectPage,
      { email: "player-all-correct@example.com", name: "All Correct Player" },
      `/challenge/${seeded.challengeId}`
    );
    await allCorrectPage.waitForURL(`**/challenge/${seeded.challengeId}`);

    const startBtn2 = allCorrectPage.getByRole("button", { name: "Start Challenge →" });
    await expect(startBtn2).toBeEnabled({ timeout: (WARMUP_MIN_SECONDS + 5) * 1000 });
    await startBtn2.click();

    for (const round of [1, 2, 3] as const) {
      await expect(allCorrectPage.getByText(`Round ${round} of 3`)).toBeVisible();
      const correctOpt = correctByRound.get(round)!;
      await allCorrectPage.waitForTimeout(250);
      await allCorrectPage.getByRole("button", { name: new RegExp(`^${correctOpt}:`) }).click();
    }

    await expect(
      allCorrectPage.getByRole("heading", { name: /Challenge Complete!|Congratulations #1!/i })
    ).toBeVisible({ timeout: 10_000 });

    const fullSessionRes = await allCorrectPage.request.get(`/api/sessions/${seeded.challengeId}`);
    expect(fullSessionRes.ok()).toBeTruthy();
    const fullSessionData = (await fullSessionRes.json()) as {
      session: { total_score: number };
    };
    const allCorrectScore = fullSessionData.session.total_score;

    await expect(allCorrectPage.locator("p.text-6xl")).toHaveText(String(allCorrectScore), {
      timeout: 5000,
    });

    expect(partialScore).toBeLessThan(allCorrectScore);
  } finally {
    await allCorrectContext.close();
  }
});
