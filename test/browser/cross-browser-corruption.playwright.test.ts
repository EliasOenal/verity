import { test, expect } from '@playwright/test';

const CHAT_TEST_URL = 'http://localhost:11985/chat/index.html';

test.describe('Cross-Browser Cube Corruption Testing', () => {
  test('test actual cross-browser cube retrieval for corruption', async ({ browser }) => {
    // Create two browser contexts to simulate two different browsers
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();
    
    try {
      // Browser 1: Setup and send message
      console.log('=== BROWSER 1 SETUP ===');
      await page1.goto(CHAT_TEST_URL);
      await page1.waitForSelector('#status:has-text("Chat test ready!")', { timeout: 8000 });
      
      // Browser 1: Create message offline first
      await page1.fill('#messageInput', 'Cross-browser test message');
      await page1.click('button:has-text("Send")');
      await page1.waitForTimeout(1000);
      
      console.log('Browser 1: Created offline message');
      
      // Browser 1: Connect to support node
      await page1.fill('#peerInput', 'ws://localhost:1984');
      await page1.click('button:has-text("Connect to Peer")');
      await page1.waitForTimeout(3000);
      
      const status1 = await page1.locator('#networkStatus').textContent();
      console.log('Browser 1 network status:', status1);
      
      // Wait a bit to ensure cube is uploaded
      await page1.waitForTimeout(2000);
      
      // Browser 1: Disconnect
      await page1.click('button:has-text("Disconnect All")');
      await page1.waitForTimeout(1000);
      
      console.log('Browser 1: Disconnected');
      
      // Browser 2: Setup and try to retrieve
      console.log('=== BROWSER 2 SETUP ===');
      await page2.goto(CHAT_TEST_URL);
      await page2.waitForSelector('#status:has-text("Chat test ready!")', { timeout: 8000 });
      
      // Browser 2: Connect to support node
      await page2.fill('#peerInput', 'ws://localhost:1984');
      await page2.click('button:has-text("Connect to Peer")');
      await page2.waitForTimeout(5000); // Give more time for network retrieval
      
      const status2 = await page2.locator('#networkStatus').textContent();
      console.log('Browser 2 network status:', status2);
      
      // Check Browser 2 messages
      const chatMessages2 = await page2.locator('#chatMessages').textContent();
      console.log('Browser 2 chat messages:', chatMessages2);
      
      // Check if Browser 2 retrieved the message from Browser 1
      const hasOriginalMessage = chatMessages2.includes('Cross-browser test message');
      console.log('Browser 2 has original message:', hasOriginalMessage);
      
      if (hasOriginalMessage) {
        // Check if the message is corrupted
        const chatHTML2 = await page2.locator('#chatMessages').innerHTML();
        console.log('Browser 2 chat HTML:', chatHTML2);
        
        // Look for corruption indicators
        const hasCorruption = chatHTML2.includes('undefined') || 
                             chatHTML2.includes('[object Object]') ||
                             chatHTML2.includes('NaN') ||
                             chatHTML2.includes('null') ||
                             !chatHTML2.includes('Cross-browser test message');
        
        if (hasCorruption) {
          console.log('🔴 CORRUPTION DETECTED in Browser 2!');
          console.log('Expected: "Cross-browser test message"');
          console.log('Actual HTML:', chatHTML2);
        } else {
          console.log('✅ No corruption detected - message retrieved correctly');
        }
      } else {
        console.log('⚠️  Browser 2 did not retrieve the message from Browser 1');
        
        // Check message count
        const messageCount = await page2.locator('#messageCount').textContent();
        console.log('Browser 2 message count:', messageCount);
        
        if (messageCount === '0') {
          console.log('❌ Network retrieval completely failed');
        }
      }
      
    } finally {
      await context1.close();
      await context2.close();
    }
  });
});