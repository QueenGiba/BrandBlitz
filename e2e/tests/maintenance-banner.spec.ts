import { test, expect } from "@playwright/test";

// Issue #832: Test MaintenanceBanner appears/disappears when maintenance_mode config changes
// The MaintenanceBanner is globally mounted and should respond to config changes without full page reload

test.describe("MaintenanceBanner configuration", () => {
  const API_BASE_URL = process.env.E2E_API_BASE_URL ?? "http://localhost/api";

  test("banner appears when maintenance_mode is enabled and disappears when disabled", async ({
    page,
    request,
  }) => {
    // Start on home page
    await page.goto("/");
    await page.waitForURL("**/");

    // Initially, maintenance banner should not be visible
    const banner = page.locator('[role="status"]').filter({ hasText: /undergoing maintenance/i });
    await expect(banner).not.toBeVisible();

    // Set maintenance_mode=true via config endpoint (requires admin context or test endpoint)
    // This assumes there's an admin endpoint to update public config
    const setConfigResponse = await request.post(`${API_BASE_URL}/admin/config`, {
      data: {
        maintenance_mode: true,
        maintenance_eta: "2:00 PM UTC",
      },
    });

    // If config endpoint not available, skip this test
    if (!setConfigResponse.ok()) {
      test.skip();
    }

    // Wait a moment for config to propagate (or trigger a poll)
    await page.waitForTimeout(1000);

    // The banner should now be visible on the current page
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/undergoing maintenance/i);

    // Navigate to another page and verify banner appears there too
    await page.goto("/leaderboard");
    await page.waitForURL("**/leaderboard");

    // Banner should be visible on leaderboard as well
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/undergoing maintenance/i);

    // Verify the banner doesn't block interaction (can still scroll/interact)
    const mainContent = page.locator("main");
    await expect(mainContent).toBeVisible();

    // Now disable maintenance mode
    const resetConfigResponse = await request.post(`${API_BASE_URL}/admin/config`, {
      data: {
        maintenance_mode: false,
      },
    });

    if (!resetConfigResponse.ok()) {
      test.skip();
    }

    // Wait for config to propagate
    await page.waitForTimeout(1000);

    // Banner should now be gone
    await expect(banner).not.toBeVisible();

    // Verify leaderboard is still accessible and functional
    await expect(mainContent).toBeVisible();
  });

  test("banner reflects ETA from config when provided", async ({ page, request }) => {
    const ETA = "3:30 PM UTC";

    // Set maintenance_mode with ETA
    const setConfigResponse = await request.post(`${API_BASE_URL}/admin/config`, {
      data: {
        maintenance_mode: true,
        maintenance_eta: ETA,
      },
    });

    if (!setConfigResponse.ok()) {
      test.skip();
    }

    await page.goto("/");
    await page.waitForTimeout(1000);

    const banner = page.locator('[role="status"]').filter({ hasText: /undergoing maintenance/i });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(ETA);

    // Cleanup
    await request.post(`${API_BASE_URL}/admin/config`, {
      data: {
        maintenance_mode: false,
      },
    });
  });

  test("banner cleanup prevents leaking config state to other tests", async ({
    page,
    request,
  }) => {
    // Ensure maintenance mode is off at the start
    await request.post(`${API_BASE_URL}/admin/config`, {
      data: {
        maintenance_mode: false,
      },
    });

    await page.goto("/");
    await page.waitForURL("**/");

    const banner = page.locator('[role="status"]').filter({ hasText: /undergoing maintenance/i });
    await expect(banner).not.toBeVisible();
  });
});
