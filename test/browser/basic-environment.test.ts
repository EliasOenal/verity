import { test, expect } from '@playwright/test';

/**
 * Basic browser environment test to verify Verity loads correctly
 */
test.describe('Verity Browser Environment', () => {
  test('should load Verity web application', async ({ page }) => {
    await page.goto('/');
    
    // Check that the basic page structure loads
    await expect(page).toHaveTitle(/Verity/);
    
    // Verify the main UI container is present
    const veraContainer = page.locator('.vera-container');
    await expect(veraContainer).toBeVisible();
    
    // Check that JavaScript has loaded by looking for elements created by the UI
    const identitySection = page.locator('.verityIdentitySection');
    await expect(identitySection).toBeVisible();
  });

  test('should have access to browser-specific APIs', async ({ page }) => {
    await page.goto('/');
    
    // Test IndexedDB availability
    const hasIndexedDB = await page.evaluate(() => {
      return 'indexedDB' in window;
    });
    expect(hasIndexedDB).toBe(true);
    
    // Test WebRTC availability
    const hasWebRTC = await page.evaluate(() => {
      return 'RTCPeerConnection' in window;
    });
    expect(hasWebRTC).toBe(true);
    
    // Test if we can access crypto APIs
    const hasCrypto = await page.evaluate(() => {
      return 'crypto' in window && 'subtle' in window.crypto;
    });
    expect(hasCrypto).toBe(true);
  });
});