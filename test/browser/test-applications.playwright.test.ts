import { test, expect } from '@playwright/test';

// Base URL for test applications
const TEST_APP_BASE_URL = 'http://localhost:11985';

test.describe('Verity Test Applications', () => {
  test.beforeAll(async () => {
    // Wait a moment for the test server to be fully ready
    await new Promise(resolve => setTimeout(resolve, 2000));
  });

  test.describe('Full Node Test Application', () => {
    test('should load and initialize successfully', async ({ page }) => {
      await page.goto(`${TEST_APP_BASE_URL}/full-node-test.html`);
      
      // Wait for initialization
      await page.waitForFunction(() => (window as any).verity !== undefined, { timeout: 10000 });
      
      // Test the node functionality
      const nodeType = await page.evaluate(() => (window as any).verity.nodeType);
      expect(nodeType).toBe('full-node');
      
      // Test creating test data
      const testResult = await page.evaluate(async () => {
        return await (window as any).verity.testUtils.createTestData();
      });
      
      expect(testResult.success).toBe(true);
      expect(testResult.data).toContain('FULL-NODE-');
      expect(testResult.length).toBeGreaterThan(0);
      
      // Test getting node info
      const nodeInfo = await page.evaluate(() => {
        return (window as any).verity.testUtils.getNodeInfo();
      });
      
      expect(nodeInfo.type).toBe('full-node');
      expect(nodeInfo.capabilities).toContain('cube-storage');
    });
  });

  test.describe('Light Node Test Application', () => {
    test('should load and provide light node functionality', async ({ page }) => {
      await page.goto(`${TEST_APP_BASE_URL}/light-node-test.html`);
      
      await page.waitForFunction(() => (window as any).verity !== undefined, { timeout: 10000 });
      
      const nodeType = await page.evaluate(() => (window as any).verity.nodeType);
      expect(nodeType).toBe('light-node');
      
      // Test creating multiple test items
      const multipleResults = await page.evaluate(async () => {
        return await (window as any).verity.testUtils.createMultipleTestItems(3);
      });
      
      expect(multipleResults).toHaveLength(3);
      expect(multipleResults[0].success).toBe(true);
      expect(multipleResults[0].data).toContain('LIGHT-NODE-');
      expect(multipleResults[0].index).toBe(0);
      
      // Verify all items are unique
      const dataValues = multipleResults.map((result: any) => result.data);
      const uniqueValues = new Set(dataValues);
      expect(uniqueValues.size).toBe(3);
    });
  });

  test.describe('Chat Test Application', () => {
    test('should provide chat functionality', async ({ page }) => {
      await page.goto(`${TEST_APP_BASE_URL}/`); // This loads the default chat page
      
      await page.waitForFunction(() => (window as any).verity !== undefined, { timeout: 10000 });
      
      const nodeType = await page.evaluate(() => (window as any).verity.nodeType);
      expect(nodeType).toBe('chat-test');
      
      // Test sending a message
      const messageResult = await page.evaluate(async () => {
        return await (window as any).verity.testUtils.sendMessage('Hello, World!', 'testSender');
      });
      
      expect(messageResult.success).toBe(true);
      expect(messageResult.message.text).toBe('Hello, World!');
      expect(messageResult.message.sender).toBe('testSender');
      expect(messageResult.totalMessages).toBe(1);
      
      // Test getting messages
      const messagesResult = await page.evaluate(() => {
        return (window as any).verity.testUtils.getMessages();
      });
      
      expect(messagesResult.count).toBe(1);
      expect(messagesResult.messages[0].text).toBe('Hello, World!');
      
      // Test creating a chat room
      const roomResult = await page.evaluate(async () => {
        return await (window as any).verity.testUtils.createChatRoom('TestRoom');
      });
      
      expect(roomResult.success).toBe(true);
      expect(roomResult.roomName).toBe('TestRoom');
      expect(roomResult.roomId).toContain('CHAT-ROOM-TestRoom-');
    });
  });

  test.describe('WebRTC Test Application', () => {
    test('should provide WebRTC functionality', async ({ page }) => {
      await page.goto(`${TEST_APP_BASE_URL}/webrtc-test.html`);
      
      await page.waitForFunction(() => (window as any).verity !== undefined, { timeout: 10000 });
      
      const nodeType = await page.evaluate(() => (window as any).verity.nodeType);
      expect(nodeType).toBe('webrtc-test');
      
      // Test creating a WebRTC connection
      const connectionResult = await page.evaluate(async () => {
        return await (window as any).verity.testUtils.createConnection();
      });
      
      expect(connectionResult.success).toBe(true);
      expect(connectionResult.connectionState).toBeDefined();
      
      // Test getting connection info
      const connectionInfo = await page.evaluate(() => {
        return (window as any).verity.testUtils.getConnectionInfo();
      });
      
      expect(connectionInfo.hasConnection).toBe(true);
      expect(connectionInfo.hasDataChannel).toBe(true);
      
      // Test creating test data
      const testDataResult = await page.evaluate(async () => {
        return await (window as any).verity.testUtils.createTestData();
      });
      
      expect(testDataResult.success).toBe(true);
      expect(testDataResult.data).toContain('WEBRTC-DATA-');
      
      // Test closing connection
      const closeResult = await page.evaluate(() => {
        return (window as any).verity.testUtils.closeConnection();
      });
      
      expect(closeResult.success).toBe(true);
      expect(closeResult.closed).toBe(true);
    });
  });

  test.describe('Multi-Application Scenarios', () => {
    test('should demonstrate different node types working together', async ({ browser }) => {
      // Create multiple browser contexts for different node types
      const fullNodeContext = await browser.newContext();
      const lightNodeContext = await browser.newContext();
      
      const fullNodePage = await fullNodeContext.newPage();
      const lightNodePage = await lightNodeContext.newPage();
      
      try {
        // Initialize both nodes
        await fullNodePage.goto(`${TEST_APP_BASE_URL}/full-node-test.html`);
        await lightNodePage.goto(`${TEST_APP_BASE_URL}/light-node-test.html`);
        
        await fullNodePage.waitForFunction(() => (window as any).verity !== undefined, { timeout: 10000 });
        await lightNodePage.waitForFunction(() => (window as any).verity !== undefined, { timeout: 10000 });
        
        // Create data on both nodes
        const fullNodeData = await fullNodePage.evaluate(async () => {
          return await (window as any).verity.testUtils.createTestData();
        });
        
        const lightNodeData = await lightNodePage.evaluate(async () => {
          return await (window as any).verity.testUtils.createTestData();
        });
        
        // Verify both nodes created different data
        expect(fullNodeData.success).toBe(true);
        expect(lightNodeData.success).toBe(true);
        expect(fullNodeData.data).not.toBe(lightNodeData.data);
        
        // Verify node types are different
        const fullNodeType = await fullNodePage.evaluate(() => (window as any).verity.nodeType);
        const lightNodeType = await lightNodePage.evaluate(() => (window as any).verity.nodeType);
        
        expect(fullNodeType).toBe('full-node');
        expect(lightNodeType).toBe('light-node');
        
      } finally {
        await fullNodeContext.close();
        await lightNodeContext.close();
      }
    });
  });
});