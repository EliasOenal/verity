/**
 * Automated tests for the Verity Chat Test Environment
 * 
 * These tests verify the offline-first P2P chat functionality, ensuring that:
 * - Messages can be created offline without auto-connecting to public networks
 * - Manual peer connections work properly
 * - Cube creation and storage function correctly
 * - No duplicate messages are displayed
 * - P2P subscription and cube exchange work as expected
 */

import { test, expect } from '@playwright/test';

const CHAT_TEST_URL = 'http://localhost:11985/index.html';

test.describe('Verity Chat Test Environment', () => {
  
  test.beforeEach(async ({ page }) => {
    // Navigate to chat test application
    await page.goto(CHAT_TEST_URL);
    
    // Wait for the application to initialize
    await page.waitForSelector('h1:has-text("Verity Chat Test Environment")');
    await page.waitForSelector('#nodeInfo:has-text("Chat test ready!")');
  });

  test('should start in offline mode without auto-connecting', async ({ page }) => {
    // Verify offline status
    await expect(page.locator('#networkStatus')).toHaveText('Offline');
    await expect(page.locator('#subscriptionStatus')).toHaveText('Inactive');
    await expect(page.locator('#knownPeersCount')).toHaveText('0');
    await expect(page.locator('#activePeersCount')).toHaveText('0');
    
    // Verify no automatic connection to public network
    await expect(page.locator('text=Ready - OFFLINE MODE')).toBeVisible();
    await expect(page.locator('text=Manual Peer Connection')).toBeVisible();
  });

  test('should create chat cubes offline without duplicates', async ({ page }) => {
    // Send a message
    await page.fill('#messageInput', 'Test offline message 1');
    await page.click('button:has-text("Send")');
    
    // Verify message appears without duplication
    await expect(page.locator('.chat-message')).toHaveCount(1);
    await expect(page.locator('text=Test offline message 1')).toHaveCount(1);
    
    // Verify cube count matches message count
    await expect(page.locator('#messageCount')).toHaveText('1');
    await expect(page.locator('#cubeCount')).toHaveText('1');
    
    // Send another message
    await page.fill('#messageInput', 'Test offline message 2');
    await page.click('button:has-text("Send")');
    
    // Verify both messages appear without duplication
    await expect(page.locator('.chat-message')).toHaveCount(2);
    await expect(page.locator('#messageCount')).toHaveText('2');
    await expect(page.locator('#cubeCount')).toHaveText('2');
  });

  test('should not reload page on form submission', async ({ page }) => {
    const initialTimestamp = await page.locator('text=/Timestamp:.*Z/').textContent();
    
    // Send a message via form submission
    await page.fill('#messageInput', 'Form submission test');
    await page.press('#messageInput', 'Enter');
    
    // Wait a moment to ensure no reload occurred
    await page.waitForTimeout(500);
    
    // Verify page didn't reload by checking timestamp hasn't changed
    const afterTimestamp = await page.locator('text=/Timestamp:.*Z/').textContent();
    expect(afterTimestamp).toBe(initialTimestamp);
    
    // Verify message was added
    await expect(page.locator('text=Form submission test')).toBeVisible();
  });

  test('should provide manual peer connection interface', async ({ page }) => {
    // Verify peer connection UI elements exist
    await expect(page.locator('h3:has-text("Peer Connection (Manual)")')).toBeVisible();
    await expect(page.locator('#peerInput')).toBeVisible();
    await expect(page.locator('button:has-text("Connect to Peer")')).toBeVisible();
    await expect(page.locator('button:has-text("Disconnect All")')).toBeVisible();
    
    // Verify placeholder text suggests manual connection
    await expect(page.locator('#peerInput')).toHaveAttribute('placeholder', 
      'ws://localhost:1984 or wss://node.example.com');
    
    // Verify descriptive text
    await expect(page.locator('text=Connect to other nodes to test P2P chat functionality')).toBeVisible();
  });

  test('should display proper message metadata', async ({ page }) => {
    // Send a message
    await page.fill('#messageInput', 'Metadata test message');
    await page.click('button:has-text("Send")');
    
    // Verify message contains proper metadata
    const messageElement = page.locator('.chat-message').first();
    
    // Check for username
    await expect(messageElement.locator('strong')).toContainText('testUser:');
    
    // Check for timestamp
    await expect(messageElement.locator('emphasis')).toContainText(/\(\d{1,2}:\d{2}:\d{2} [AP]M\)/);
    
    // Check for cube key
    await expect(messageElement.locator('.cube-key')).toContainText(/\[[a-f0-9]{8}...\]/);
    
    // Verify it's marked as local message (not from peer)
    await expect(messageElement).toHaveClass(/local-message/);
  });

  test('should handle empty message input gracefully', async ({ page }) => {
    const initialMessageCount = await page.locator('#messageCount').textContent();
    
    // Try to send empty message
    await page.click('button:has-text("Send")');
    
    // Verify no message was added
    await expect(page.locator('#messageCount')).toHaveText(initialMessageCount || '0');
  });

  test('should clear input after successful message send', async ({ page }) => {
    // Enter and send a message
    await page.fill('#messageInput', 'Input clear test');
    await page.click('button:has-text("Send")');
    
    // Verify input is cleared
    await expect(page.locator('#messageInput')).toHaveValue('');
  });

  test('should maintain message order', async ({ page }) => {
    // Send multiple messages
    const messages = ['First message', 'Second message', 'Third message'];
    
    for (const message of messages) {
      await page.fill('#messageInput', message);
      await page.click('button:has-text("Send")');
    }
    
    // Verify messages appear in correct order
    const messageElements = page.locator('.chat-message');
    for (let i = 0; i < messages.length; i++) {
      await expect(messageElements.nth(i)).toContainText(messages[i]);
    }
  });

  test('should show accurate status information', async ({ page }) => {
    // Verify initial status shows offline mode
    await expect(page.locator('text=Ready - OFFLINE MODE')).toBeVisible();
    await expect(page.locator('text=Chat Test (Manual Peer Connection)')).toBeVisible();
    await expect(page.locator('text=test-chat-room')).toBeVisible();
    
    // Verify test optimizations are active
    await expect(page.locator('text=Test Optimizations: Active')).toBeVisible();
  });

  test('should use test message sender correctly', async ({ page }) => {
    // Click the test message button
    await page.click('button:has-text("Send Test Message")');
    
    // Verify test message appears
    await expect(page.locator('.chat-message')).toHaveCount(1);
    
    // Verify sender is testBot
    await expect(page.locator('strong:has-text("testBot:")')).toBeVisible();
    
    // Verify message count and cube count are updated
    await expect(page.locator('#messageCount')).toHaveText('1');
    await expect(page.locator('#cubeCount')).toHaveText('1');
  });
});

test.describe('Verity Chat P2P Connection Tests', () => {
  
  test('should handle connection attempts gracefully', async ({ page }) => {
    await page.goto(CHAT_TEST_URL);
    await page.waitForSelector('#nodeInfo:has-text("Chat test ready!")');
    
    // Try to connect to non-existent peer
    await page.fill('#peerInput', 'ws://nonexistent:9999');
    await page.click('button:has-text("Connect to Peer")');
    
    // Verify error handling (status should show error)
    await expect(page.locator('#peerStatus')).toContainText('Failed to connect', { timeout: 5000 });
    
    // Verify input is cleared on connection attempt
    await expect(page.locator('#peerInput')).toHaveValue('');
  });

  test('should maintain offline functionality when connection fails', async ({ page }) => {
    await page.goto(CHAT_TEST_URL);
    await page.waitForSelector('#nodeInfo:has-text("Chat test ready!")', { timeout: 10000 });
    
    // Try to connect to non-existent peer
    await page.fill('#peerInput', 'ws://invalid:1234');
    await page.click('button:has-text("Connect to Peer")');
    
    // Wait for connection attempt to fail
    await page.waitForTimeout(2000);
    
    // Verify we can still send messages offline
    await page.fill('#messageInput', 'Offline after failed connection');
    await page.click('button:has-text("Send")');
    
    // Verify message was created and stored
    await expect(page.locator('text=Offline after failed connection')).toBeVisible();
    await expect(page.locator('#messageCount')).toHaveText('1');
    await expect(page.locator('#cubeCount')).toHaveText('1');
  });

  test('should demonstrate cross-browser P2P cube retrieval capability', async ({ page }) => {
    // This test documents the cross-browser P2P functionality
    // The actual testing requires running multiple browser instances simultaneously
    // which is complex in playwright, so this test documents the expected behavior
    
    await page.goto(CHAT_TEST_URL);
    await page.waitForSelector('#nodeInfo:has-text("Chat test ready!")', { timeout: 10000 });
    
    // Verify the application has the necessary P2P infrastructure
    await expect(page.locator('text=Manual Peer Connection')).toBeVisible();
    await expect(page.locator('#peerInput')).toHaveAttribute('placeholder', 
      'ws://localhost:1984 or wss://node.example.com');
    
    // Test basic offline message creation (prerequisite for P2P)
    await page.fill('#messageInput', 'Test P2P foundation message');
    await page.click('button:has-text("Send")');
    
    await expect(page.locator('text=Test P2P foundation message')).toBeVisible();
    await expect(page.locator('#messageCount')).toHaveText('1');
    
    // Verify cube was created with proper metadata for P2P sharing
    await expect(page.locator('.cube-key')).toBeVisible();
    
    // The cross-browser scenario would be:
    // 1. Browser 1 connects to ws://localhost:1984
    // 2. Browser 1 sends this message (uploads cube to nodejs node)
    // 3. Browser 1 disconnects
    // 4. Browser 2 connects to ws://localhost:1984  
    // 5. Browser 2 should retrieve the cube via network history
    // This is now implemented with the merged stream approach matching the demo app
  });

  test('CRITICAL: should test actual cross-browser P2P cube retrieval with support node', async ({ browser }) => {
    // This test performs the EXACT workflow that was failing before the fix
    // Browser 1 → connect → send message → disconnect
    // Browser 2 → connect → retrieve message from Browser 1
    
    // Start a test support node for this test
    const { exec } = require('child_process');
    const util = require('util');
    const execAsync = util.promisify(exec);
    
    let supportNodeProcess: any;
    
    try {
      // Start support node on port 19850 for this test
      supportNodeProcess = exec('npm run start -- -w 19850 -t', { cwd: process.cwd() });
      
      // Wait for support node to start
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const context1 = await browser.newContext();
      const context2 = await browser.newContext();
      
      const page1 = await context1.newPage();
      const page2 = await context2.newPage();
      
      try {
        // === Browser 1: Connect and send message ===
        await page1.goto(CHAT_TEST_URL);
        await page1.waitForSelector('#nodeInfo:has-text("Chat test ready!")');
        
        // Send offline message first
        await page1.fill('#messageInput', 'Cross-browser test from Browser 1');
        await page1.click('button:has-text("Send")');
        
        await expect(page1.locator('text=Cross-browser test from Browser 1')).toBeVisible();
        await expect(page1.locator('#messageCount')).toHaveText('1');
        
        // Connect to support node
        await page1.fill('#peerInput', 'ws://localhost:19850');
        await page1.click('button:has-text("Connect to Peer")');
        
        // Wait for connection and verify connected status
        await page1.waitForTimeout(2000);
        await expect(page1.locator('text=Ready - CONNECTED MODE')).toBeVisible();
        await expect(page1.locator('#knownPeersCount')).toContainText('1');
        
        // Send another message while connected to upload cube
        await page1.fill('#messageInput', 'Connected message from Browser 1');
        await page1.click('button:has-text("Send")');
        
        await expect(page1.locator('text=Connected message from Browser 1')).toBeVisible();
        await expect(page1.locator('#messageCount')).toHaveText('2');
        
        // Wait for cube upload to complete
        await page1.waitForTimeout(2000);
        
        // === Browser 1 disconnects ===
        await page1.click('button:has-text("Disconnect All")');
        await page1.waitForTimeout(1000);
        await expect(page1.locator('text=Ready - OFFLINE MODE')).toBeVisible();
        
        // === Browser 2: Connect and should retrieve messages ===
        await page2.goto(CHAT_TEST_URL);
        await page2.waitForSelector('#nodeInfo:has-text("Chat test ready!")');
        
        // Browser 2 starts with no messages
        await expect(page2.locator('#messageCount')).toHaveText('0');
        
        // Connect Browser 2 to same support node
        await page2.fill('#peerInput', 'ws://localhost:19850');
        await page2.click('button:has-text("Connect to Peer")');
        
        // Wait for connection and network synchronization
        await page2.waitForTimeout(4000);
        await expect(page2.locator('text=Ready - CONNECTED MODE')).toBeVisible();
        
        // CRITICAL ASSERTION: Browser 2 should now see messages from Browser 1
        // This was failing before the merged stream fix
        await expect(page2.locator('text=Connected message from Browser 1')).toBeVisible({ timeout: 10000 });
        
        // Verify Browser 2 received the cube via network history
        await expect(page2.locator('#messageCount')).toContainText('1');
        
        console.log('✅ CRITICAL Cross-browser P2P cube retrieval test PASSED');
        
      } finally {
        await page1.close();
        await page2.close();
        await context1.close();
        await context2.close();
      }
      
    } finally {
      // Clean up support node
      if (supportNodeProcess) {
        supportNodeProcess.kill('SIGTERM');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  });
});