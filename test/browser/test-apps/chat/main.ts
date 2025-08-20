/**
 * Chat Test Application
 * 
 * This is a minimal web application for testing Verity chat functionality.
 * It provides basic chat interface for testing purposes.
 */

import { isBrowser } from 'browser-or-node';
import sodium from 'libsodium-wrappers-sumo';

interface ChatMessage {
  text: string;
  timestamp: string;
  sender: string;
}

async function initializeChatTest(): Promise<void> {
  if (!isBrowser) {
    throw new Error('Chat test must be run in browser environment');
  }

  console.log('Initializing chat test application');

  // Wait for libsodium to be ready
  await sodium.ready;

  const messages: ChatMessage[] = [];

  // Expose chat functionality to global scope for tests
  (window as any).verity = {
    nodeType: 'chat-test',
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
          timestamp: new Date().toISOString()
        };
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
      <p><strong>Messages:</strong> <span id="messageCount">0</span></p>
      <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
      <p><strong>Test Optimizations:</strong> Active</p>
    `;
  }

  console.log('Chat test application ready');
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