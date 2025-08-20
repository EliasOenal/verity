/**
 * Chat Test Application
 * 
 * This is a minimal web application for testing Verity chat functionality.
 * It initializes a light node optimized for chat operations with testCoreOptions built-in.
 */

import { VerityNode } from '../../../src/cci/verityNode';
import { Cockpit } from '../../../src/cci/cockpit';
import { coreCubeFamily } from '../../../src/core/cube/cube';
import { cciFamily } from '../../../src/cci/cube/cciCube';
import { SupportedTransports } from '../../../src/core/networking/networkDefinitions';
import { defaultInitialPeers } from '../../../src/core/coreNode';
import { isBrowser } from 'browser-or-node';
import { logger } from '../../../src/core/logger';
import { testCoreOptions } from '../../core/testcore.definition';
import sodium from 'libsodium-wrappers-sumo';

interface ChatMessage {
  text: string;
  timestamp: string;
  sender: string;
}

async function initializeChatNodeTest(): Promise<void> {
  if (!isBrowser) {
    throw new Error('Chat node test must be run in browser environment');
  }

  logger.info('Initializing chat node test application');

  // Wait for libsodium to be ready
  await sodium.ready;

  // Configure light node with test optimizations built-in
  const nodeOptions = {
    // Built-in test optimizations for fast execution
    ...testCoreOptions,
    
    // Light node configuration suitable for chat
    lightNode: true,
    useRelaying: true,
    transports: new Map([[SupportedTransports.libp2p, ['/webrtc']]]),
    initialPeers: defaultInitialPeers,
    family: [cciFamily, coreCubeFamily]
  };

  // Create and initialize the node
  const node = new VerityNode(nodeOptions);
  const cockpit = new Cockpit(node);

  // Wait for node to be ready
  await node.readyPromise;

  // Chat message history
  const chatMessages: ChatMessage[] = [];

  // Expose to global scope for tests
  (window as any).verity = {
    node: node,
    cockpit: cockpit,
    chatMessages: chatMessages,
    
    testUtils: {
      sendMessage: async (messageText: string) => {
        try {
          const timestamp = new Date().toISOString();
          const messageData: ChatMessage = {
            text: messageText,
            timestamp: timestamp,
            sender: node.networkManager.idString.substring(0, 8)
          };
          
          // Create a cube containing the message
          const veritum = cockpit.prepareVeritum();
          
          // Add message content to the veritum
          const messagePayload = new TextEncoder().encode(JSON.stringify(messageData));
          const payloadField = { type: 4, data: messagePayload }; // PAYLOAD type
          
          if (veritum.fields && veritum.fields.insertTillFull) {
            veritum.fields.insertTillFull([payloadField]);
          }
          
          // Compile and store the message cube
          await veritum.compile();
          const cubes = Array.from(veritum.chunks);
          
          if (cubes.length > 0) {
            const cube = cubes[0];
            const key = await cube.getKey();
            await node.cubeStore.addCube(cube);
            
            // Add to local message history
            chatMessages.push(messageData);
            
            // Update UI
            displayMessage(messageData);
            
            return { 
              success: true, 
              cubeKey: key,
              keyHex: key.toString('hex').substring(0, 32) + '...'
            };
          } else {
            throw new Error('No cubes generated from message');
          }
        } catch (error) {
          return { success: false, error: (error as Error).message };
        }
      },
      
      sendTestMessage: async () => {
        const testMessages = [
          "Hello from Verity chat test!",
          "Testing message functionality",
          "This is a test message with unique content",
          `Test message at ${Date.now()}`
        ];
        const randomMessage = testMessages[Math.floor(Math.random() * testMessages.length)];
        return await (window as any).verity.testUtils.sendMessage(randomMessage);
      },
      
      getChatHistory: () => chatMessages,
      
      clearChat: () => {
        chatMessages.length = 0;
        const messagesEl = document.getElementById('messages');
        if (messagesEl) {
          messagesEl.innerHTML = '';
        }
      }
    }
  };

  // Display message in UI
  function displayMessage(messageData: ChatMessage): void {
    const messagesDiv = document.getElementById('messages');
    if (messagesDiv) {
      const messageDiv = document.createElement('div');
      messageDiv.className = 'message sent';
      messageDiv.innerHTML = `
        <strong>${messageData.sender}:</strong> ${messageData.text}
        <br><small>${new Date(messageData.timestamp).toLocaleTimeString()}</small>
      `;
      messagesDiv.appendChild(messageDiv);
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }
  }

  // Set up form handlers
  const messageForm = document.getElementById('messageForm') as HTMLFormElement;
  if (messageForm) {
    messageForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = document.getElementById('messageInput') as HTMLInputElement;
      if (input && input.value.trim()) {
        await (window as any).verity.testUtils.sendMessage(input.value.trim());
        input.value = '';
      }
    });
  }

  // Update UI
  const statusEl = document.getElementById('status');
  const nodeInfoEl = document.getElementById('nodeInfo');
  
  if (statusEl) {
    statusEl.textContent = 'Chat node ready!';
  }
  
  if (nodeInfoEl) {
    nodeInfoEl.innerHTML = `
      <h3>Node Information</h3>
      <p><strong>Node ID:</strong> ${node.networkManager.idString}</p>
      <p><strong>Node Type:</strong> ${node.constructor.name}</p>
      <p><strong>Light Node:</strong> ${node.isLightNode ? 'Yes' : 'No'}</p>
      <p><strong>Cube Count:</strong> <span id="cubeCount">${await node.cubeStore.getNumberOfStoredCubes()}</span></p>
      <p><strong>Online Peers:</strong> <span id="peerCount">${node.networkManager.onlinePeers.length}</span></p>
      <p><strong>Chat Messages:</strong> <span id="messageCount">0</span></p>
      <p><strong>Test Optimizations:</strong> Active</p>
    `;
  }

  logger.info('Chat node test application ready');
}

// Initialize when page loads
if (isBrowser) {
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const statusEl = document.getElementById('status');
      if (statusEl) {
        statusEl.textContent = 'Initializing chat node...';
      }
      
      await initializeChatNodeTest();
    } catch (error) {
      logger.error('Failed to initialize chat node test:', error);
      
      const statusEl = document.getElementById('status');
      if (statusEl) {
        statusEl.textContent = `Error: ${(error as Error).message}`;
      }
    }
  });
}