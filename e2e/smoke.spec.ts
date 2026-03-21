import { test, expect } from "@playwright/test";

test.describe("Numa — Smoke tests", () => {
  test("Landing page (/) loads with correct title", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/numa|nuta|num[eé]rologie/i);
    await expect(page.locator("body")).toBeVisible();
  });

  test("Chat page (/chat) loads", async ({ page }) => {
    await page.goto("/chat");
    await expect(page.locator("body")).toBeVisible();
  });

  test("Legal page (/legal.html) loads", async ({ page }) => {
    const response = await page.goto("/legal.html");
    expect(response?.status()).toBe(200);
  });

  test("Privacy page (/privacy.html) loads", async ({ page }) => {
    const response = await page.goto("/privacy.html");
    expect(response?.status()).toBe(200);
  });

  test("Terms page (/terms.html) loads", async ({ page }) => {
    const response = await page.goto("/terms.html");
    expect(response?.status()).toBe(200);
  });

  test("API health (/api/health) returns 200", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("ok");
  });
});
