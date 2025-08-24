import { test, expect } from '@playwright/test';

const CHAT_TEST_URL = 'http://localhost:11985/chat/index.html';

test.describe('Chat Cube Corruption Testing', () => {
  test('detect cube corruption issues', async ({ page }) => {
    await page.goto(CHAT_TEST_URL);
    await page.waitForSelector('#status:has-text("Chat test ready!")', { timeout: 8000 });
    
    // Send a test message
    await page.fill('#messageInput', 'Hello corruption test');
    await page.click('button:has-text("Send")');
    
    // Wait for message to appear
    await page.waitForTimeout(2000);
    
    // Check what the actual content is
    const chatMessages = await page.locator('#chatMessages').textContent();
    console.log('Chat messages content:', chatMessages);
    
    // Check if the message appears correctly
    const messageVisible = await page.locator('text=Hello corruption test').isVisible();
    console.log('Message visible:', messageVisible);
    
    // Get the raw HTML to see exactly what's rendered
    const chatHTML = await page.locator('#chatMessages').innerHTML();
    console.log('Chat HTML:', chatHTML);
    
    // Now let's test cross-browser scenario
    // First connect to the support node
    await page.fill('#peerInput', 'ws://localhost:1984');
    await page.click('button:has-text("Connect to Peer")');
    
    // Wait for connection
    await page.waitForTimeout(3000);
    
    // Check connection status
    const status = await page.locator('#networkStatus').textContent();
    console.log('Network status:', status);
    
    // Send another message while connected
    await page.fill('#messageInput', 'Connected message test');
    await page.click('button:has-text("Send")');
    
    await page.waitForTimeout(2000);
    
    // Check the new message content
    const finalChatMessages = await page.locator('#chatMessages').textContent();
    console.log('Final chat messages:', finalChatMessages);
    
    // Check for any corruption indicators
    const hasGarbledText = finalChatMessages.includes('undefined') || 
                          finalChatMessages.includes('[object Object]') ||
                          finalChatMessages.includes('NaN');
    
    console.log('Has garbled text:', hasGarbledText);
    
    if (hasGarbledText) {
      console.log('CORRUPTION DETECTED in chat messages!');
    }
  });
});