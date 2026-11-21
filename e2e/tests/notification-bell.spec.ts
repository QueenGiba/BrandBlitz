import { expect, test } from "@playwright/test";
import pg from "pg";
import { seedActiveChallenge, signInWithMockGoogle } from "./helpers";

const DB_URL =
  process.env.DATABASE_URL ?? "postgresql://brandblitz:brandblitz_dev@localhost:5432/brandblitz";

test("NotificationBell shows toast for new notification, opens drawer, and supports mark-read / mark-all-read", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);

  const seeded = await seedActiveChallenge(request, {
    email: "brand-owner-notif@example.com",
    name: "Notif Brand Owner",
  });

  const player = { email: "player-notif@example.com", name: "Notif Player" };
  await signInWithMockGoogle(page, player, `/challenge/${seeded.challengeId}`);
  await page.waitForURL(`**/challenge/${seeded.challengeId}`);

  // Set player's streak to 6 with last_play_day = yesterday so completing this
  // challenge triggers a real 7-day streak_milestone notification.
  const sessionRes = await page.request.get(`/api/sessions/${seeded.challengeId}`);
  expect(sessionRes.ok()).toBeTruthy();
  const meRes = await page.request.get("/api/users/me");
  expect(meRes.ok()).toBeTruthy();
  const mePayload = (await meRes.json()) as { user: { id: string } };
  const userId = mePayload.user.id;

  const pool = new pg.Pool({ connectionString: DB_URL });
  await pool.query(
    `UPDATE users
     SET streak = 6,
         last_play_day = (CURRENT_DATE - INTERVAL '1 day')::date
     WHERE id = $1`,
    [userId]
  );

  // Complete warmup and all 3 rounds to trigger updateStreak -> streak_milestone notification
  const startButton = page.getByRole("button", { name: "Start Challenge →" });
  await expect(startButton).toBeEnabled({ timeout: 30_000 });
  await startButton.click();

  for (const round of [1, 2, 3]) {
    await expect(page.getByText(`Round ${round} of 3`)).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(250);
    await page.getByRole("button", { name: /^A/ }).click();
  }

  await expect(page.getByRole("heading", { name: "Challenge Complete!" })).toBeVisible({
    timeout: 10_000,
  });

  // Seed a second unread notification so we can verify both individual mark-read
  // decrementing the badge count and mark-all-read clearing the remainder.
  await pool.query(
    `INSERT INTO notifications (user_id, type, payload)
     VALUES ($1, 'badge_earned', $2::jsonb)`,
    [userId, JSON.stringify({ badge_name: "First Win" })]
  );
  await pool.end();

  // Navigate to a page with the Header (which mounts NotificationBell for authenticated users)
  await page.goto("/challenges");

  // 1. Toast appears with the streak milestone icon and summary text
  const streakToast = page
    .getByRole("alert")
    .filter({ hasText: /7-day streak milestone reached!/i })
    .first();
  await expect(streakToast).toBeVisible({ timeout: 10_000 });
  await expect(streakToast).toContainText("🔥");

  // 2. Bell shows unread badge count >= 2; clicking opens the drawer with unread styling
  const bellButton = page.getByRole("button", { name: /^Notifications/ });
  await expect(bellButton).toBeVisible();
  const initialLabel = (await bellButton.getAttribute("aria-label")) ?? "";
  const countMatch = initialLabel.match(/\((\d+)\s+unread\)/);
  const initialUnreadCount = countMatch ? Number(countMatch[1]) : 0;
  expect(initialUnreadCount).toBeGreaterThanOrEqual(2);

  await bellButton.click();
  await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();

  const markReadButtons = page.getByRole("button", { name: "Mark as read" });
  const initialMarkReadCount = await markReadButtons.count();
  expect(initialMarkReadCount).toBeGreaterThanOrEqual(2);

  // Unread item has the unread background highlight class
  const firstUnreadRow = markReadButtons.first().locator("..");
  await expect(firstUnreadRow).toHaveClass(/bg-\[var\(--primary\)\]\/5/);

  // 3. Clicking individual 'Mark as read' updates its read state and decrements badge count
  await markReadButtons.first().click();
  await expect(bellButton).toHaveAttribute(
    "aria-label",
    `Notifications (${initialUnreadCount - 1} unread)`
  );
  await expect(markReadButtons).toHaveCount(initialMarkReadCount - 1);

  // 4. Clicking 'Mark all read' clears the unread badge count to zero
  await page.getByRole("button", { name: "Mark all read" }).click();
  await expect(bellButton).toHaveAttribute("aria-label", "Notifications");
  await expect(markReadButtons).toHaveCount(0);
});
