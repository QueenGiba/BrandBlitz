import { expect, test } from "@playwright/test";
import pg from "pg";
import { seedActiveChallenge, signInWithMockGoogle } from "./helpers";

const DB_URL =
  process.env.DATABASE_URL ?? "postgresql://brandblitz:brandblitz_dev@localhost:5432/brandblitz";

async function seedSessionForPlayer(
  challengeId: string,
  userId: string,
  options: { expired: boolean }
): Promise<string> {
  const pool = new pg.Pool({ connectionString: DB_URL });
  const startedOffset = options.expired ? "NOW() - INTERVAL '60 seconds'" : "NOW()";

  const result = await pool.query<{ id: string }>(
    `UPDATE game_sessions
     SET warmup_completed_at = NOW() - INTERVAL '25 seconds',
         challenge_started_at = ${startedOffset},
         status = 'active',
         round_1_answer = 'A',
         round_1_score = 120,
         round_1_reaction_ms = 2500,
         total_score = 120
     WHERE challenge_id = $1 AND user_id = $2 AND status != 'abandoned'
     RETURNING id`,
    [challengeId, userId]
  );
  await pool.end();

  expect(result.rows).toHaveLength(1);
  return result.rows[0].id;
}

async function getCurrentUserId(page: import("@playwright/test").Page): Promise<string> {
  const meRes = await page.request.get("/api/users/me");
  expect(meRes.ok()).toBeTruthy();
  const mePayload = (await meRes.json()) as { user: { id: string } };
  return mePayload.user.id;
}

test.describe("SessionRecoveryModal", () => {
  test("Resume returns player to the interrupted round with accumulated score intact", async ({
    page,
    request,
  }) => {
    const seeded = await seedActiveChallenge(request, {
      email: "brand-owner-recovery-resume@example.com",
      name: "Recovery Resume Owner",
    });

    await signInWithMockGoogle(
      page,
      { email: "player-recovery-resume@example.com", name: "Recovery Resume Player" },
      `/challenge/${seeded.challengeId}`
    );
    await page.waitForURL(`**/challenge/${seeded.challengeId}`);

    // Wait for warmup-start to create the initial session row
    await expect(page.getByText(/Study this brand carefully/i)).toBeVisible();
    const userId = await getCurrentUserId(page);
    await seedSessionForPlayer(seeded.challengeId, userId, { expired: false });

    // Reload to trigger SessionRecoveryModal
    await page.reload();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Resume challenge?" })).toBeVisible();
    await expect(dialog.getByText("120")).toBeVisible();

    await dialog.getByRole("button", { name: "Resume" }).click();

    // Modal closes and player resumes at Round 2 of 3
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Round 2 of 3")).toBeVisible();

    // Complete Rounds 2 and 3 and verify the previously accumulated 120 pts are intact
    for (const round of [2, 3]) {
      await expect(page.getByText(`Round ${round} of 3`)).toBeVisible();
      await page.waitForTimeout(250);
      await page.getByRole("button", { name: /^A:/ }).click();
    }

    await expect(page.getByRole("heading", { name: "Challenge Complete!" })).toBeVisible({
      timeout: 10_000,
    });

    const sessionRes = await page.request.get(`/api/sessions/${seeded.challengeId}`);
    expect(sessionRes.ok()).toBeTruthy();
    const sessionData = (await sessionRes.json()) as {
      session: { status: string; total_score: number; round_scores: number[] };
    };
    expect(sessionData.session.status).toBe("completed");
    expect(sessionData.session.round_scores[0]).toBe(120);
    expect(sessionData.session.total_score).toBeGreaterThanOrEqual(120);
  });

  test("Forfeit abandons the interrupted session and prevents continuing it", async ({
    page,
    request,
  }) => {
    const seeded = await seedActiveChallenge(request, {
      email: "brand-owner-recovery-forfeit@example.com",
      name: "Recovery Forfeit Owner",
    });

    await signInWithMockGoogle(
      page,
      { email: "player-recovery-forfeit@example.com", name: "Recovery Forfeit Player" },
      `/challenge/${seeded.challengeId}`
    );
    await page.waitForURL(`**/challenge/${seeded.challengeId}`);

    await expect(page.getByText(/Study this brand carefully/i)).toBeVisible();
    const userId = await getCurrentUserId(page);
    const sessionId = await seedSessionForPlayer(seeded.challengeId, userId, { expired: false });

    await page.reload();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Resume challenge?" })).toBeVisible();

    await dialog.getByRole("button", { name: "Forfeit" }).click();
    await expect(dialog.getByRole("heading", { name: "Forfeit session?" })).toBeVisible();

    const forfeitDeletePromise = page.waitForResponse(
      (response) =>
        response.url().includes(`/sessions/${seeded.challengeId}`) &&
        response.request().method() === "DELETE"
    );
    await dialog.getByRole("button", { name: "Confirm Forfeit" }).click();

    const deleteResponse = await forfeitDeletePromise;
    expect(deleteResponse.status()).toBe(204);

    // Modal closes and player is moved out of the interrupted round
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Round 2 of 3")).toBeHidden();

    // Verify old session is abandoned in PostgreSQL
    const pool = new pg.Pool({ connectionString: DB_URL });
    const dbCheck = await pool.query<{ status: string; abandon_reason: string }>(
      `SELECT status, abandon_reason FROM game_sessions WHERE id = $1`,
      [sessionId]
    );
    await pool.end();

    expect(dbCheck.rows[0].status).toBe("abandoned");
    expect(dbCheck.rows[0].abandon_reason).toBe("explicit");
  });

  test("Expired session renders Start New and starts a fresh session", async ({
    page,
    request,
  }) => {
    const seeded = await seedActiveChallenge(request, {
      email: "brand-owner-recovery-expired@example.com",
      name: "Recovery Expired Owner",
    });

    await signInWithMockGoogle(
      page,
      { email: "player-recovery-expired@example.com", name: "Recovery Expired Player" },
      `/challenge/${seeded.challengeId}`
    );
    await page.waitForURL(`**/challenge/${seeded.challengeId}`);

    await expect(page.getByText(/Study this brand carefully/i)).toBeVisible();
    const userId = await getCurrentUserId(page);
    const expiredSessionId = await seedSessionForPlayer(seeded.challengeId, userId, {
      expired: true,
    });

    await page.reload();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Session expired" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Resume" })).toBeHidden();

    const startNewDeletePromise = page.waitForResponse(
      (response) =>
        response.url().includes(`/sessions/${seeded.challengeId}`) &&
        response.request().method() === "DELETE"
    );
    await dialog.getByRole("button", { name: "Start New" }).click();

    const deleteResponse = await startNewDeletePromise;
    expect(deleteResponse.status()).toBe(204);

    // Modal closes and player starts a fresh warmup instead of resuming the timed-out round
    await expect(dialog).toBeHidden();
    await expect(page.getByText(/Study this brand carefully/i)).toBeVisible();
    await expect(page.getByText("Round 2 of 3")).toBeHidden();

    const pool = new pg.Pool({ connectionString: DB_URL });
    const dbCheck = await pool.query<{ status: string }>(
      `SELECT status FROM game_sessions WHERE id = $1`,
      [expiredSessionId]
    );
    await pool.end();
    expect(dbCheck.rows[0].status).toBe("abandoned");
  });
});
