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
import { mergeAsyncGenerators, MergedAsyncGenerator } from '../../../../src/core/helpers/asyncGenerators';
import { RetrievalFormat } from '../../../../src/cci/veritum/veritum.definitions';
import { Cube } from '../../../../src/core/cube/cube';
import { CubeRetriever } from '../../../../src/core/networking/cubeRetrieval/cubeRetriever';
import { FieldType } from '../../../../src/cci/cube/cciCube.definitions';

interface ChatMessage {
  text: string;
  timestamp: string;
  sender: string;
  cubeKey?: string;
}

interface ChatRoom {
  id: string;
  name: string;
  notificationKey: NotificationKey;
  messages: ChatMessage[];
  subscription: MergedAsyncGenerator<Cube> | null;
  isProcessingMessages: boolean;
  processedCubeKeys: Set<string>;
}

let verityNode: VerityNode | null = null;
let currentChatRoom: ChatRoom | null = null;

async function initializeChatTest(): Promise<void> {
  if (!isBrowser) {
    throw new Error('Chat test must be run in browser environment');
  }

  console.log('Initializing chat test application with real Verity library');

  // Wait for libsodium to be ready
  await sodium.ready;

  const messages: ChatMessage[] = [];
  
  // Create a default chat room for testing peer-to-peer connectivity
  const defaultRoomName = 'test-chat-room';
  const chatNotificationKey = Buffer.alloc(32, 0x42) as NotificationKey;
  chatNotificationKey.write(defaultRoomName, 'utf-8');
  
  currentChatRoom = {
    id: defaultRoomName,
    name: defaultRoomName,
    notificationKey: chatNotificationKey,
    messages: messages,
    subscription: null,
    isProcessingMessages: false,
    processedCubeKeys: new Set<string>()
  };

  try {
    // Create a real VerityNode with enhanced networking for better peer connectivity
    verityNode = new VerityNode({
      ...testCciOptions,
      lightNode: false,  // Full node for chat capabilities
      inMemory: true,    // Fast in-memory storage for testing
      requiredDifficulty: 0,  // No proof-of-work for testing
      announceToTorrentTrackers: false, // Not supported in browser
      networkTimeoutMillis: 10000, // Longer timeout for better connectivity
      autoConnect: true, // Enable auto-connection to peers
      // Use WebRTC transport like demo app for better browser connectivity
      transports: new Map([[SupportedTransports.libp2p, ['/webrtc']]]),
      initialPeers: defaultInitialPeers, // Connect to default tracker peers
      useRelaying: true, // Enable relaying for better connectivity
    });

    await verityNode.readyPromise;
    console.log('VerityNode (chat) initialized successfully');

    // Start peer-to-peer chat subscription for receiving messages from other nodes
    await startChatRoomSubscription();
    console.log('Started peer-to-peer chat subscription');

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
            updateChatMessagesUI();
            
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
          return currentChatRoom?.messages || messages;
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
        <p><strong>Status:</strong> Ready with P2P Networking</p>
        <p><strong>Type:</strong> Chat Test with WebRTC Connectivity</p>
        <p><strong>Chat Room:</strong> ${currentChatRoom.name}</p>
        <p><strong>Node ID:</strong> chat-${Date.now()}</p>
        <p><strong>Messages:</strong> <span id="messageCount">0</span></p>
        <p><strong>Cubes:</strong> <span id="cubeCount">${cubeCount}</span></p>
        <p><strong>Known Peers:</strong> <span id="knownPeersCount">${knownPeers}</span></p>
        <p><strong>Active Peers:</strong> <span id="activePeersCount">${activePeers}</span></p>
        <p><strong>Network Status:</strong> <span id="networkStatus">Connecting...</span></p>
        <p><strong>P2P Subscription:</strong> <span id="subscriptionStatus">Active</span></p>
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
          const subscriptionStatusEl = document.getElementById('subscriptionStatus');
          
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
          
          if (subscriptionStatusEl) {
            if (currentChatRoom?.subscription && !currentChatRoom.isProcessingMessages) {
              subscriptionStatusEl.textContent = 'Active';
              subscriptionStatusEl.style.color = 'green';
            } else if (currentChatRoom?.isProcessingMessages) {
              subscriptionStatusEl.textContent = 'Processing...';
              subscriptionStatusEl.style.color = 'orange';
            } else {
              subscriptionStatusEl.textContent = 'Inactive';
              subscriptionStatusEl.style.color = 'red';
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

/**
 * Start subscription to receive chat messages from other peers
 */
async function startChatRoomSubscription(): Promise<void> {
  if (!verityNode || !currentChatRoom || currentChatRoom.subscription) {
    return;
  }

  console.log(`Starting P2P subscription for chat room: ${currentChatRoom.name}`);
  
  try {
    // Enable live subscription for future messages
    let futureCubes: AsyncGenerator<Cube> | undefined;
    if ('subscribeNotifications' in verityNode.cubeRetriever) {
      futureCubes = (verityNode.cubeRetriever as CubeRetriever)
        .subscribeNotifications(currentChatRoom.notificationKey, { format: RetrievalFormat.Cube });
    }

    // Fetch recent history from other peers
    const retrieverHistory: AsyncGenerator<Cube> = (verityNode.cubeRetriever as CubeRetriever)
      .getNotifications(currentChatRoom.notificationKey, { format: RetrievalFormat.Cube }) as AsyncGenerator<Cube>;

    // Merge streams: future notifications + existing history from peers
    currentChatRoom.subscription = futureCubes
      ? mergeAsyncGenerators(futureCubes, retrieverHistory)
      : mergeAsyncGenerators(retrieverHistory);

    // Start processing received cubes from peers
    processRoomMessageStream();
  } catch (error) {
    console.error(`Error starting P2P subscription: ${error}`);
  }
}

/**
 * Process incoming chat cubes from other peers
 */
async function processRoomMessageStream(): Promise<void> {
  if (!currentChatRoom?.subscription || currentChatRoom.isProcessingMessages) {
    return;
  }

  currentChatRoom.isProcessingMessages = true;
  console.log('Started processing P2P message stream');

  try {
    for await (const cube of currentChatRoom.subscription) {
      try {
        const cubeKey = await cube.getKeyString();
        
        // Skip if we've already processed this cube
        if (currentChatRoom.processedCubeKeys.has(cubeKey)) {
          continue;
        }
        
        // Parse chat message from cube
        const chatMessage = await parseChatCubeToMessage(cube);
        if (chatMessage) {
          chatMessage.cubeKey = cubeKey;
          
          // Add to message history
          currentChatRoom.messages.push(chatMessage);
          currentChatRoom.processedCubeKeys.add(cubeKey);
          
          // Update UI
          updateChatMessagesUI();
          
          console.log(`Received P2P message from ${chatMessage.sender}: ${chatMessage.text}`);
        }
      } catch (error) {
        console.warn(`Error processing received cube: ${error}`);
      }
    }
  } catch (error) {
    console.error(`Error in message stream processing: ${error}`);
  } finally {
    currentChatRoom.isProcessingMessages = false;
    console.log('Stopped processing P2P message stream');
  }
}

/**
 * Parse a chat cube into a ChatMessage
 */
async function parseChatCubeToMessage(cube: Cube): Promise<ChatMessage | null> {
  try {
    // Use the same parsing logic as ChatApplication.parseChatCube
    // Chat cubes use FieldType.USERNAME and FieldType.PAYLOAD
    const usernameField = cube.getFirstField(FieldType.USERNAME);
    const payloadField = cube.getFirstField(FieldType.PAYLOAD);
    
    if (usernameField && payloadField) {
      return {
        text: payloadField.value.toString('utf-8'),
        sender: usernameField.valueString || usernameField.value.toString(),
        timestamp: new Date().toISOString(),
      };
    }
    
    // Fallback: try to get fields by iterating through all fields
    const fields = Array.from(cube.getFields());
    let message = '';
    let author = '';
    
    for (const field of fields) {
      // Try to match field types - this is a best-effort approach
      const fieldValue = field.value?.toString() || '';
      if (fieldValue.length > 0 && fieldValue.length < 500) {
        // Heuristic: shorter fields are likely to be authors, longer ones messages
        if (fieldValue.length < 50 && !author) {
          author = fieldValue;
        } else if (fieldValue.length >= 50 && !message) {
          message = fieldValue;
        } else if (!message) {
          message = fieldValue;
        }
      }
    }
    
    if (message && author) {
      return {
        text: message,
        sender: author,
        timestamp: new Date().toISOString(),
      };
    }
    
    return null;
  } catch (error) {
    console.warn(`Error parsing chat cube: ${error}`);
    return null;
  }
}

/**
 * Update the chat messages UI with current message history
 */
function updateChatMessagesUI(): void {
  const chatBox = document.getElementById('chatMessages');
  if (!chatBox || !currentChatRoom) return;
  
  // Clear and rebuild message list
  chatBox.innerHTML = '';
  
  for (const message of currentChatRoom.messages) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message';
    
    const isFromPeer = message.cubeKey && !message.sender.includes('test'); // Simple heuristic
    if (isFromPeer) {
      messageDiv.classList.add('peer-message');
    }
    
    messageDiv.innerHTML = `
      <strong>${message.sender}:</strong> ${message.text} 
      <em>(${message.timestamp})</em>
      ${isFromPeer ? ' <span class="peer-indicator">[from peer]</span>' : ''}
    `;
    chatBox.appendChild(messageDiv);
  }
  
  // Scroll to bottom
  chatBox.scrollTop = chatBox.scrollHeight;
}