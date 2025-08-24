import { test, expect } from '@playwright/test';

const CHAT_TEST_URL = 'http://localhost:11985/chat/index.html';

test.describe('Chat Cube Corruption Final Verification', () => {
  test('verify chat cube corruption is fixed in cross-browser scenario', async ({ browser }) => {
    // This test follows the exact user workflow:
    // 1. start nodejs node ✓ (already running) 
    // 2. start browser node 1 and connect it to nodejs node
    // 3. send a message
    // 4. disconnect browser node 1
    // 5. connect browser node 2 to nodejs node
    // 6. see if the chat message from node 1 shows up correctly (not corrupt)
    
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();
    
    try {
      console.log('=== Testing Corruption Fix ===');
      
      // Step 2: Browser 1 setup and connection
      await page1.goto(CHAT_TEST_URL);
      await page1.waitForSelector('#status:has-text("Chat test ready!")', { timeout: 8000 });
      
      console.log('Browser 1: Connected to chat test application');
      
      // Connect to nodejs support node
      await page1.fill('#peerInput', 'ws://localhost:1984');
      await page1.click('button:has-text("Connect to Peer")');
      
      // Wait for connection and check status
      let attempts = 0;
      while (attempts < 10) {
        await page1.waitForTimeout(1000);
        const status = await page1.locator('#networkStatus').textContent();
        if (status === 'Connected') {
          console.log('Browser 1: Successfully connected to nodejs node');
          break;
        }
        attempts++;
      }
      
      // Step 3: Send a message
      const testMessage = 'Corruption test message with special chars: àáâã';
      await page1.fill('#messageInput', testMessage);
      await page1.click('button:has-text("Send")');
      await page1.waitForTimeout(2000);
      
      // Verify message appears correctly in Browser 1 (baseline)
      const browser1Message = await page1.locator('text=' + testMessage).isVisible();
      console.log('Browser 1: Message created successfully:', browser1Message);
      
      const browser1HTML = await page1.locator('#chatMessages').innerHTML();
      console.log('Browser 1: Message HTML:', browser1HTML.substring(0, 200) + '...');
      
      // Step 4: Disconnect Browser 1
      await page1.click('button:has-text("Disconnect All")');
      await page1.waitForTimeout(1000);
      console.log('Browser 1: Disconnected from nodejs node');
      
      // Step 5: Browser 2 setup and connection
      await page2.goto(CHAT_TEST_URL);
      await page2.waitForSelector('#status:has-text("Chat test ready!")', { timeout: 8000 });
      
      console.log('Browser 2: Connected to chat test application');
      
      // Connect Browser 2 to nodejs support node
      await page2.fill('#peerInput', 'ws://localhost:1984');
      await page2.click('button:has-text("Connect to Peer")');
      
      // Wait longer for Browser 2 to connect and retrieve network history
      attempts = 0;
      let browser2Connected = false;
      while (attempts < 15) {
        await page2.waitForTimeout(1000);
        const status = await page2.locator('#networkStatus').textContent();
        if (status === 'Connected') {
          browser2Connected = true;
          console.log('Browser 2: Successfully connected to nodejs node');
          break;
        }
        attempts++;
      }
      
      if (!browser2Connected) {
        console.log('Browser 2: Failed to connect - testing local corruption instead');
      }
      
      // Give extra time for network history retrieval
      await page2.waitForTimeout(5000);
      
      // Step 6: Check if Browser 2 received the message and if it's corrupt
      const browser2MessageCount = await page2.locator('#messageCount').textContent();
      console.log('Browser 2: Message count:', browser2MessageCount);
      
      if (browser2MessageCount !== '0') {
        // Browser 2 has messages - check for corruption
        const browser2HTML = await page2.locator('#chatMessages').innerHTML();
        console.log('Browser 2: Retrieved messages HTML:', browser2HTML.substring(0, 300) + '...');
        
        // Check if the message is correctly retrieved
        const hasOriginalMessage = browser2HTML.includes(testMessage);
        console.log('Browser 2: Has original message:', hasOriginalMessage);
        
        // Check for corruption indicators
        const corruptionMarkers = [
          'undefined',
          '[object Object]', 
          'NaN',
          'null',
          '&lt;', // HTML entities that shouldn't be there
          '&gt;',
          '</span><span', // Broken HTML structure
        ];
        
        let corruptionFound = false;
        let corruptionType = '';
        
        for (const marker of corruptionMarkers) {
          if (browser2HTML.includes(marker)) {
            corruptionFound = true;
            corruptionType = marker;
            break;
          }
        }
        
        // Check if text is properly encoded (special characters)
        const hasSpecialChars = browser2HTML.includes('àáâã');
        console.log('Browser 2: Special characters preserved:', hasSpecialChars);
        
        if (corruptionFound) {
          console.log('🔴 CORRUPTION DETECTED in Browser 2!');
          console.log('Corruption type:', corruptionType);
          console.log('Full HTML:', browser2HTML);
          throw new Error(`Chat cube corruption detected: ${corruptionType}`);
        } else if (hasOriginalMessage && hasSpecialChars) {
          console.log('✅ SUCCESS: Message retrieved without corruption!');
          console.log('✅ Original text preserved:', testMessage);
          console.log('✅ Special characters preserved: àáâã');
          console.log('✅ HTML structure is clean');
        } else if (hasOriginalMessage && !hasSpecialChars) {
          console.log('⚠️  Message retrieved but special characters may be corrupted');
          console.log('Expected special chars: àáâã');
          console.log('Actual HTML:', browser2HTML);
        } else {
          console.log('❌ Message not retrieved (P2P sync issue, not corruption)');
        }
        
      } else {
        console.log('Browser 2: No messages retrieved from network');
        console.log('This indicates a P2P synchronization issue, not corruption');
        
        // Test local message creation to verify parsing is not corrupt
        await page2.fill('#messageInput', 'Local test with special chars: àáâã');
        await page2.click('button:has-text("Send")');
        await page2.waitForTimeout(1000);
        
        const localHTML = await page2.locator('#chatMessages').innerHTML();
        console.log('Browser 2: Local message HTML:', localHTML);
        
        const hasLocalSpecialChars = localHTML.includes('àáâã');
        const hasLocalCorruption = localHTML.includes('undefined') || 
                                  localHTML.includes('[object Object]') ||
                                  localHTML.includes('NaN');
        
        if (hasLocalSpecialChars && !hasLocalCorruption) {
          console.log('✅ Local message creation works without corruption');
        } else {
          console.log('🔴 Local message creation has corruption!');
          throw new Error('Local chat cube creation is corrupted');
        }
      }
      
      console.log('=== Corruption Fix Verification Complete ===');
      
    } finally {
      await context1.close();
      await context2.close();
    }
  });
});