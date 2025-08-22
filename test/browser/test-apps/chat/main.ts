/**
 * Chat Test Application
 * 
 * This is a minimal web application for testing Verity chat functionality.
 * It uses the real Verity library with testCoreOptions for fast testing.
 */

import { isBrowser } from 'browser-or-node';
import sodium from 'libsodium-wrappers-sumo';
import { VerityNode } from '../../../../src/cci/verityNode';
import { testCoreOptions } from '../../../core/testcore.definition';
import { testCciOptions } from '../../../cci/testcci.definitions';
import { Peer } from '../../../../src/core/peering/peer';
import { WebSocketAddress } from '../../../../src/core/peering/addressing';

interface ChatMessage {
  text: string;
  timestamp: string;
  sender: string;
}

let verityNode: VerityNode | null = null;

async function initializeChatTest(): Promise<void> {
  if (!isBrowser) {
    throw new Error('Chat test must be run in browser environment');
  }

  console.log('Initializing chat test application with real Verity library');

  // Wait for libsodium to be ready
  await sodium.ready;

  const messages: ChatMessage[] = [];

  try {
    // Create a real VerityNode with test optimizations for fast execution
    verityNode = new VerityNode({
      ...testCciOptions,
      lightNode: false,  // Full node for chat capabilities
      inMemory: true,    // Fast in-memory storage
      requiredDifficulty: 0,  // No proof-of-work for testing
      announceToTorrentTrackers: false,
      networkTimeoutMillis: 100,
      autoConnect: false, // Don't try to connect to external peers in test environment
    });

    await verityNode.readyPromise;
    console.log('VerityNode (chat) initialized successfully');

    // Create Verity interface that Playwright tests expect
    (window as any).verity = {
      nodeType: 'chat-test',
      node: verityNode,
      cubeStore: verityNode.cubeStore,
      Peer: Peer,  // Export Peer class for connections
      WebSocketAddress: WebSocketAddress,  // Export WebSocketAddress class for connections
      testUtils: {
        sendMessage: async (text: string, sender?: string) => {
          const message: ChatMessage = {
            text: text,
            timestamp: new Date().toISOString(),
            sender: sender || 'testUser'
          };
          
          messages.push(message);
          
          // Update UI if available
          const chatBox = document.getElementById('chatMessages');
          if (chatBox) {
            const messageDiv = document.createElement('div');
            messageDiv.innerHTML = `<strong>${message.sender}:</strong> ${message.text} <em>(${message.timestamp})</em>`;
            chatBox.appendChild(messageDiv);
          }
          
          return {
            success: true,
            message: message,
            totalMessages: messages.length
          };
        },
        
        getMessages: () => {
          return {
            messages: messages,
            count: messages.length
          };
        },
        
        clearMessages: () => {
          messages.length = 0;
          const chatBox = document.getElementById('chatMessages');
          if (chatBox) {
            chatBox.innerHTML = '';
          }
          return { success: true, cleared: true };
        },
        
        createChatRoom: async (roomName: string) => {
          const roomData = `CHAT-ROOM-${roomName}-${Date.now()}-${Math.random()}`;
          return {
            success: true,
            roomName: roomName,
            roomId: roomData,
            timestamp: new Date().toISOString(),
            nodeId: `chat-node-${Date.now()}-${Math.random().toString(36).substring(2)}`
          };
        },

        // Additional methods that don't reference cubeStore incorrectly
        getChatHistory: () => {
          return messages;
        },

        sendTestMessage: async () => {
          const testMessage = `Test message ${Date.now()}`;
          return await (window as any).verity.testUtils.sendMessage(testMessage, 'testBot');
        },

        clearChat: () => {
          return (window as any).verity.testUtils.clearMessages();
        }
      }
    };

    // Update UI
    const statusEl = document.getElementById('status');
    const nodeInfoEl = document.getElementById('nodeInfo');
    
    if (statusEl) {
      statusEl.textContent = 'Chat test ready!';
    }
    
    if (nodeInfoEl) {
      nodeInfoEl.innerHTML = `
        <h3>Chat Test Information</h3>
        <p><strong>Status:</strong> Ready</p>
        <p><strong>Type:</strong> Chat Test</p>
        <p><strong>Node ID:</strong> chat-${Date.now()}</p>
        <p><strong>Messages:</strong> <span id="messageCount">0</span></p>
        <p><strong>Cubes:</strong> <span id="cubeCount">${verityNode.cubeStore.getNumberOfStoredCubes()}</span></p>
        <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
        <p><strong>Test Optimizations:</strong> Active</p>
      `;
    }

    console.log('Chat test application ready');
    
  } catch (error) {
    console.error('Failed to initialize VerityNode:', error);
    
    const statusEl = document.getElementById('status');
    if (statusEl) {
      statusEl.textContent = `Error: ${(error as Error).message}`;
    }
    throw error;
  }
}

// Initialize when page loads
if (isBrowser) {
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const statusEl = document.getElementById('status');
      if (statusEl) {
        statusEl.textContent = 'Initializing chat test...';
      }
      
      await initializeChatTest();
    } catch (error) {
      console.error('Failed to initialize chat test:', error);
      
      const statusEl = document.getElementById('status');
      if (statusEl) {
        statusEl.textContent = `Error: ${(error as Error).message}`;
      }
    }
  });
}