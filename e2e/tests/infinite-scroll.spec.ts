import { test, expect } from "@playwright/test";

test.describe("Infinite scroll pagination", () => {
  test("should load more challenges when scrolling to bottom", async ({ page }) => {
    // Intercept API calls
    const requests: string[] = [];
    await page.route("**/api/challenges*", (route) => {
      requests.push(route.request().url());
      route.continue();
    });

    await page.goto("/challenge");
    await page.waitForSelector("main");

    // Wait for initial cards to render
    const initialCards = page.locator("a[href^='/challenge/']");
    const initialCount = await initialCards.count();
    expect(initialCount).toBeGreaterThan(0);

    // Scroll to bottom to trigger infinite scroll
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    // Wait for the next page request
    await page.waitForTimeout(1000);

    // Check that more cards appeared
    const newCards = page.locator("a[href^='/challenge/']");
    const newCount = await newCards.count();
    expect(newCount).toBeGreaterThan(initialCount);

    // Verify cursor param was sent in the second request
    const cursorRequests = requests.filter((url) => url.includes("cursor="));
    expect(cursorRequests.length).toBeGreaterThanOrEqual(1);
  });

  // Issue #831: Test LiveGlobalLeaderboard's sessionStorage scroll-position restore
  test("should restore scroll position and loaded entries on leaderboard revisit", async ({
    page,
  }) => {
    await page.goto("/leaderboard");
    await page.waitForSelector("main");

    // Wait for initial leaderboard entries to render
    const initialRows = page.locator("tbody tr");
    const initialCount = await initialRows.count();
    expect(initialCount).toBeGreaterThan(0);

    // Scroll down to load multiple additional pages
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(1500);

    // Record the number of loaded entries after scrolling
    const loadedRows = page.locator("tbody tr");
    const loadedCount = await loadedRows.count();
    expect(loadedCount).toBeGreaterThanOrEqual(initialCount);

    // Record scroll position
    const scrollYBefore = await page.evaluate(() => window.scrollY);
    expect(scrollYBefore).toBeGreaterThan(0);

    // Navigate away (simulating a tab switch that would trigger pagehide/beforeunload)
    await page.goto("/dashboard");
    await page.waitForURL("**/dashboard");

    // Return to the leaderboard
    await page.goto("/leaderboard");
    await page.waitForTimeout(1500); // Allow restore sequence to complete

    // Verify the restore indicator appeared and disappeared (if visible)
    const restoreIndicator = page.getByText(/Restoring your place/i);
    // Indicator should be gone after restore completes
    if (await restoreIndicator.count()) {
      await expect(restoreIndicator).not.toBeVisible({ timeout: 5000 });
    }

    // Assert that entries were restored (at least close to original count)
    const restoredRows = page.locator("tbody tr");
    const restoredCount = await restoredRows.count();
    expect(restoredCount).toBeGreaterThanOrEqual(loadedCount * 0.8); // Allow 20% margin

    // Assert scroll position was restored (approximately)
    const scrollYAfter = await page.evaluate(() => window.scrollY);
    expect(Math.abs(scrollYAfter - scrollYBefore)).toBeLessThan(100);
  });

  // Issue #831: Test that cleared sessionStorage skips restore
  test("should load normally from top when sessionStorage is cleared", async ({ page }) => {
    await page.goto("/leaderboard");
    await page.waitForSelector("main");

    // Clear the sessionStorage for this page
    await page.evaluate(() => {
      sessionStorage.clear();
    });

    // Reload the page
    await page.reload();
    await page.waitForTimeout(500);

    // Assert we're at the top of the page
    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY).toBeLessThan(100);

    // Verify normal loading occurred (initial entries present)
    const rows = page.locator("tbody tr");
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);

    // No restore indicator should appear
    const restoreIndicator = page.getByText(/Restoring your place/i);
    await expect(restoreIndicator).not.toBeVisible();
  });
});
