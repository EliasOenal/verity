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
import { ChatApplication } from '../../../../src/app/chatApplication';
import { NotificationKey } from '../../../../src/core/cube/cube.definitions';
import { SupportedTransports } from '../../../../src/core/networking/networkDefinitions';
import { defaultInitialPeers } from '../../../../src/core/coreNode';

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
  
  // Create a notification key for chat room (32 bytes)
  const chatNotificationKey = Buffer.alloc(32, 0x42) as NotificationKey;

  try {
    // Create a real VerityNode with networking enabled for chat testing
    verityNode = new VerityNode({
      ...testCciOptions,
      lightNode: false,  // Full node for chat capabilities
      inMemory: true,    // Fast in-memory storage
      requiredDifficulty: 0,  // No proof-of-work for testing
      announceToTorrentTrackers: false,
      networkTimeoutMillis: 5000, // Longer timeout for real networking
      autoConnect: true, // Enable auto-connection to peers
      // Enable networking with WebRTC transport similar to demo app
      transports: new Map([[SupportedTransports.libp2p, ['/webrtc']]]),
      initialPeers: defaultInitialPeers, // Connect to default peers
      useRelaying: true, // Enable relaying for better connectivity
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
          
          try {
            // Create actual chat cube using ChatApplication
            const chatCube = await ChatApplication.createChatCube(
              message.sender,
              message.text,
              chatNotificationKey
            );
            
            // Add cube to the cube store
            await verityNode.cubeStore.addCube(chatCube);
            
            // Broadcast cube to connected peers for testing peer-to-peer exchange
            try {
              const cubeInfo = await chatCube.getCubeInfo();
              verityNode.networkManager.broadcastKey([cubeInfo]);
              console.log(`Broadcasted cube to ${verityNode.peerDB.peersVerified.size + verityNode.peerDB.peersExchangeable.size} known peers`);
            } catch (broadcastError) {
              console.warn('Failed to broadcast cube to peers:', broadcastError);
              // Continue - local storage still works
            }
            
            // Add to local message history
            messages.push(message);
            
            // Update UI if available
            const chatBox = document.getElementById('chatMessages');
            if (chatBox) {
              const messageDiv = document.createElement('div');
              messageDiv.innerHTML = `<strong>${message.sender}:</strong> ${message.text} <em>(${message.timestamp})</em>`;
              chatBox.appendChild(messageDiv);
            }
            
            console.log(`Created chat cube with key: ${await chatCube.getKeyString()}`);
            
            return {
              success: true,
              message: message,
              cubeKey: await chatCube.getKeyString(),
              totalMessages: messages.length
            };
          } catch (error) {
            console.error('Error creating chat cube:', error);
            return {
              success: false,
              error: (error as Error).message,
              totalMessages: messages.length
            };
          }
        },
        
        getMessages: () => {
          return {
            messages: messages,
            count: messages.length
          };
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

        // Get chat history and network information
        getChatHistory: () => {
          return messages;
        },

        sendTestMessage: async () => {
          const testMessage = `Test message ${Date.now()}`;
          return await (window as any).verity.testUtils.sendMessage(testMessage, 'testBot');
        },

        getNetworkInfo: () => {
          if (!verityNode) return null;
          return {
            knownPeers: verityNode.peerDB.peersVerified.size + verityNode.peerDB.peersExchangeable.size,
            activePeers: verityNode.peerDB.peersExchangeable.size,
            networkManager: verityNode.networkManager.constructor.name
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
      const cubeCount = await verityNode.cubeStore.getNumberOfStoredCubes();
      const knownPeers = verityNode.peerDB.peersVerified.size + verityNode.peerDB.peersExchangeable.size;
      const activePeers = verityNode.peerDB.peersExchangeable.size;
      
      nodeInfoEl.innerHTML = `
        <h3>Chat Test Information</h3>
        <p><strong>Status:</strong> Ready</p>
        <p><strong>Type:</strong> Chat Test with Networking</p>
        <p><strong>Node ID:</strong> chat-${Date.now()}</p>
        <p><strong>Messages:</strong> <span id="messageCount">0</span></p>
        <p><strong>Cubes:</strong> <span id="cubeCount">${cubeCount}</span></p>
        <p><strong>Known Peers:</strong> <span id="knownPeersCount">${knownPeers}</span></p>
        <p><strong>Active Peers:</strong> <span id="activePeersCount">${activePeers}</span></p>
        <p><strong>Network Status:</strong> <span id="networkStatus">Connecting...</span></p>
        <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
        <p><strong>Test Optimizations:</strong> Active</p>
      `;
      
      // Update network status periodically
      setInterval(async () => {
        try {
          const updatedKnownPeers = verityNode.peerDB.peersVerified.size + verityNode.peerDB.peersExchangeable.size;
          const updatedActivePeers = verityNode.peerDB.peersExchangeable.size;
          
          const knownPeersEl = document.getElementById('knownPeersCount');
          const activePeersEl = document.getElementById('activePeersCount');
          const networkStatusEl = document.getElementById('networkStatus');
          
          if (knownPeersEl) knownPeersEl.textContent = updatedKnownPeers.toString();
          if (activePeersEl) activePeersEl.textContent = updatedActivePeers.toString();
          if (networkStatusEl) {
            if (updatedActivePeers > 0) {
              networkStatusEl.textContent = 'Connected';
              networkStatusEl.style.color = 'green';
            } else if (updatedKnownPeers > 0) {
              networkStatusEl.textContent = 'Connecting...';
              networkStatusEl.style.color = 'orange';
            } else {
              networkStatusEl.textContent = 'Offline';
              networkStatusEl.style.color = 'red';
            }
          }
        } catch (error) {
          // Ignore networking status update errors
          console.log('Network status update error (non-critical):', error.message);
        }
      }, 3000);
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