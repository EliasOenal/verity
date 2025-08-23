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

  const messages: ChatMessage[] = []; // Kept for backward compatibility only
  
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
    // Create a real VerityNode for offline testing - no auto-connect to public network
    verityNode = new VerityNode({
      ...testCciOptions,
      lightNode: true,   // Light node - only stores own cubes, doesn't download everything
      inMemory: true,    // Fast in-memory storage for testing
      requiredDifficulty: 0,  // No proof-of-work for testing
      announceToTorrentTrackers: false, // Not supported in browser
      networkTimeoutMillis: 5000, // Reasonable timeout for testing
      autoConnect: false, // DO NOT auto-connect - manual connections only
      // Use WebRTC transport for browser P2P compatibility - WebSocket connections handled manually
      transports: new Map([[SupportedTransports.libp2p, ['/webrtc']]]),
      initialPeers: [], // No initial peers - completely offline by default
      useRelaying: false, // Disable relaying for cleaner testing
    });

    await verityNode.readyPromise;
    console.log('VerityNode (chat light node) initialized successfully - OFFLINE MODE');

    // DO NOT start peer-to-peer subscription automatically
    // Users must manually connect to peers first
    console.log('Chat test ready - use manual peer connection to test P2P functionality');

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
            
            const cubeKey = await chatCube.getKeyString();
            message.cubeKey = cubeKey;
            
            // Mark this cube as processed to avoid duplication when subscription picks it up
            if (currentChatRoom) {
              currentChatRoom.processedCubeKeys.add(cubeKey);
            }
            
            // Broadcast cube to connected peers for testing peer-to-peer exchange
            const knownPeers = verityNode.peerDB.peersVerified.size + verityNode.peerDB.peersExchangeable.size;
            try {
              const cubeInfo = await chatCube.getCubeInfo();
              verityNode.networkManager.broadcastKey([cubeInfo]);
              console.log(`Broadcasted cube to ${knownPeers} known peers`);
            } catch (broadcastError) {
              console.warn('Failed to broadcast cube to peers:', broadcastError);
              // Continue - local storage still works
            }
            
            // Add to local message history immediately for responsive UI
            if (currentChatRoom) {
              currentChatRoom.messages.push(message);
              // Sort messages by timestamp
              currentChatRoom.messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
            }
            
            // Update UI if available
            updateChatMessagesUI();
            
            console.log(`Created chat cube with key: ${cubeKey}`);
            
            return {
              success: true,
              message: message,
              cubeKey: cubeKey,
              totalMessages: currentChatRoom?.messages.length || 0,
              knownPeers: knownPeers
            };
          } catch (error) {
            console.error('Error creating chat cube:', error);
            return {
              success: false,
              error: (error as Error).message,
              totalMessages: currentChatRoom?.messages.length || 0
            };
          }
        },
        
        getMessages: () => {
          return {
            messages: currentChatRoom?.messages || [],
            count: currentChatRoom?.messages.length || 0
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
          return currentChatRoom?.messages || [];
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
        },

        // Manual peer connection for testing
        connectToPeer: async (peerAddress: string) => {
          if (!verityNode) {
            return { success: false, error: 'VerityNode not initialized' };
          }
          
          try {
            console.log(`Attempting to connect to peer: ${peerAddress}`);
            
            // Parse peer address and create Peer object
            let peer: Peer;
            if (peerAddress.startsWith('ws://') || peerAddress.startsWith('wss://')) {
              // WebSocket address
              peer = new Peer(new WebSocketAddress(peerAddress));
            } else {
              // Try to parse as generic address
              peer = new Peer(new WebSocketAddress(peerAddress));
            }
            
            // Add peer to database using learnPeer and connect using NetworkManager
            verityNode.peerDB.learnPeer(peer);
            const networkPeer = verityNode.networkManager.connect(peer);
            
            // Start chat subscription after successful connection
            if (!currentChatRoom?.subscription) {
              await startChatRoomSubscription();
              console.log('Started P2P chat subscription after peer connection');
            }
            
            const knownPeers = verityNode.peerDB.peersVerified.size + verityNode.peerDB.peersExchangeable.size;
            const activePeers = verityNode.peerDB.peersExchangeable.size;
            
            return {
              success: true,
              peerAddress: peerAddress,
              knownPeers: knownPeers,
              activePeers: activePeers
            };
          } catch (error) {
            console.error('Error connecting to peer:', error);
            return {
              success: false,
              error: (error as Error).message
            };
          }
        },

        // Disconnect from all peers (return to offline mode)
        disconnectFromPeers: async () => {
          if (!verityNode) {
            return { success: false, error: 'VerityNode not initialized' };
          }
          
          try {
            console.log('Disconnecting from all peers');
            
            // Stop chat subscription
            if (currentChatRoom?.subscription) {
              currentChatRoom.subscription.return(undefined);
              currentChatRoom.subscription = null;
              currentChatRoom.isProcessingMessages = false;
            }
            
            // Close all network peers
            for (const networkPeer of verityNode.networkManager.onlinePeers) {
              verityNode.networkManager.handlePeerClosed(networkPeer);
            }
            
            // Clear peer database
            verityNode.peerDB.peersExchangeable.clear();
            verityNode.peerDB.peersVerified.clear();
            verityNode.peerDB.peersUnverified.clear();
            
            return {
              success: true,
              message: 'Disconnected from all peers - back to offline mode'
            };
          } catch (error) {
            console.error('Error disconnecting from peers:', error);
            return {
              success: false,
              error: (error as Error).message
            };
          }
        }
      }
    };

    // Don't load local chat history on startup - only when connecting to peers
    // This prevents seeing old messages from previous test runs

    // Update UI
    const statusEl = document.getElementById('status');
    const nodeInfoEl = document.getElementById('nodeInfo');
    
    if (statusEl) {
      statusEl.textContent = 'Chat test ready!';
    }
    
    if (nodeInfoEl) {
      // For light node testing, avoid expensive getNumberOfStoredCubes() call
      // Instead track cubes locally for better performance
      const cubeCount = currentChatRoom?.processedCubeKeys.size || 0;
      const knownPeers = verityNode.peerDB.peersVerified.size + verityNode.peerDB.peersExchangeable.size;
      const activePeers = verityNode.peerDB.peersExchangeable.size;
      
      nodeInfoEl.innerHTML = `
        <h3>Chat Test Information</h3>
        <p><strong>Status:</strong> <span id="mainStatus">Ready - OFFLINE MODE</span></p>
        <p><strong>Type:</strong> Chat Test (Light Node, Manual Peer Connection)</p>
        <p><strong>Chat Room:</strong> ${currentChatRoom.name}</p>
        <p><strong>Node ID:</strong> chat-${Date.now()}</p>
        <p><strong>Messages:</strong> <span id="messageCount">0</span></p>
        <p><strong>Cubes:</strong> <span id="cubeCount">${cubeCount}</span></p>
        <p><strong>Known Peers:</strong> <span id="knownPeersCount">${knownPeers}</span></p>
        <p><strong>Active Peers:</strong> <span id="activePeersCount">${activePeers}</span></p>
        <p><strong>Network Status:</strong> <span id="networkStatus">Offline</span></p>
        <p><strong>P2P Subscription:</strong> <span id="subscriptionStatus">Inactive</span></p>
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
          const mainStatusEl = document.getElementById('mainStatus');
          
          if (knownPeersEl) knownPeersEl.textContent = updatedKnownPeers.toString();
          if (activePeersEl) activePeersEl.textContent = updatedActivePeers.toString();
          
          // Update both network status and main status consistently
          if (networkStatusEl && mainStatusEl) {
            if (updatedActivePeers > 0) {
              networkStatusEl.textContent = 'Connected';
              networkStatusEl.style.color = 'green';
              mainStatusEl.textContent = 'Ready - CONNECTED MODE';
              mainStatusEl.style.color = 'green';
            } else if (updatedKnownPeers > 0) {
              networkStatusEl.textContent = 'Connecting...';
              networkStatusEl.style.color = 'orange';
              mainStatusEl.textContent = 'Ready - CONNECTING...';
              mainStatusEl.style.color = 'orange';
            } else {
              networkStatusEl.textContent = 'Offline';
              networkStatusEl.style.color = 'red';
              mainStatusEl.textContent = 'Ready - OFFLINE MODE';
              mainStatusEl.style.color = 'red';
            }
          }
          
          if (subscriptionStatusEl) {
            if (currentChatRoom?.subscription && updatedActivePeers > 0) {
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
 * Only call this after manually connecting to peers
 */
async function startChatRoomSubscription(): Promise<void> {
  if (!verityNode || !currentChatRoom || currentChatRoom.subscription) {
    return;
  }

  console.log(`Starting P2P subscription for chat room: ${currentChatRoom.name}`);
  
  try {
    // Load local history first to populate interface immediately
    await loadLocalChatHistory();
    
    // 1) Enable live subscription for future messages
    let futureCubes: AsyncGenerator<Cube> | undefined;
    if ('subscribeNotifications' in verityNode.cubeRetriever) {
      futureCubes = (verityNode.cubeRetriever as CubeRetriever)
        .subscribeNotifications(currentChatRoom.notificationKey, { format: RetrievalFormat.Cube });
    }

    // 2) Also fetch network history from the retriever to cover what we don't have locally
    const retrieverHistory: AsyncGenerator<Cube> = (verityNode.cubeRetriever as CubeRetriever)
      .getNotifications(currentChatRoom.notificationKey, { format: RetrievalFormat.Cube }) as AsyncGenerator<Cube>;

    // 3) Merge streams: future first (already active), plus retriever history
    // This is the same pattern as the demo chat app for complete P2P synchronization
    currentChatRoom.subscription = futureCubes
      ? mergeAsyncGenerators(futureCubes, retrieverHistory)
      : mergeAsyncGenerators(retrieverHistory);

    // 4) Start processing merged stream immediately (local history is loaded separately for responsiveness)
    processRoomMessageStream();
    
    console.log('Started P2P subscription with merged network history and future notifications');
  } catch (error) {
    console.error(`Error starting P2P subscription: ${error}`);
  }
}

/**
 * Load chat history from local storage only (no network fetch)
 */
async function loadLocalChatHistory(): Promise<void> {
  if (!verityNode || !currentChatRoom) {
    return;
  }

  console.log(`Loading local chat history for room: ${currentChatRoom.name}`);
  
  try {
    // Get messages from the local store only
    const localCubes: AsyncGenerator<Cube> = 
      verityNode.cubeStore.getNotifications(currentChatRoom.notificationKey, { 
        format: RetrievalFormat.Cube
      }) as AsyncGenerator<Cube>;

    for await (const cube of localCubes) {
      try {
        const cubeKey = await cube.getKeyString();
        
        // Skip if we've already processed this cube
        if (currentChatRoom.processedCubeKeys.has(cubeKey)) {
          continue;
        }
        
        // Parse chat message from local cube
        const chatMessage = await parseChatCubeToMessage(cube);
        if (chatMessage) {
          chatMessage.cubeKey = cubeKey;
          
          // Add to message history
          currentChatRoom.messages.push(chatMessage);
          currentChatRoom.processedCubeKeys.add(cubeKey);
        }
      } catch (error) {
        console.warn(`Error processing local cube: ${error}`);
      }
    }
    
    // Sort messages by timestamp
    currentChatRoom.messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    
    // Update UI
    updateChatMessagesUI();
    
    console.log(`Loaded ${currentChatRoom.messages.length} local messages`);
  } catch (error) {
    console.error(`Error loading local history: ${error}`);
  }
}

/**
 * Process incoming chat cubes from network peers (both historical and future messages)
 */
async function processRoomMessageStream(): Promise<void> {
  if (!currentChatRoom?.subscription || currentChatRoom.isProcessingMessages) {
    return;
  }

  currentChatRoom.isProcessingMessages = true;
  console.log('Started processing P2P message stream (historical + future messages)');

  try {
    for await (const cube of currentChatRoom.subscription) {
      try {
        const cubeKey = await cube.getKeyString();
        
        // Skip if we've already processed this cube (avoid duplicates)
        if (currentChatRoom.processedCubeKeys.has(cubeKey)) {
          console.log(`Skipping duplicate cube: ${cubeKey.substring(0, 8)}...`);
          continue;
        }
        
        // Parse chat message from cube
        const chatMessage = await parseChatCubeToMessage(cube);
        if (chatMessage) {
          chatMessage.cubeKey = cubeKey;
          
          // Mark as processed first to prevent any race conditions
          currentChatRoom.processedCubeKeys.add(cubeKey);
          
          // Add to message history
          currentChatRoom.messages.push(chatMessage);
          
          // Sort messages by timestamp to maintain order
          currentChatRoom.messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
          
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
    
    // Improved logic to determine if message is from a peer
    // A message is from a peer if it has a cube key and the sender is NOT a local test user
    const isLocalTestUser = message.sender.includes('test') || message.sender === 'testBot' || message.sender === 'testUser';
    const isFromPeer = message.cubeKey && !isLocalTestUser;
    
    if (isFromPeer) {
      messageDiv.classList.add('peer-message');
    } else {
      messageDiv.classList.add('local-message');
    }
    
    const messageTime = new Date(message.timestamp).toLocaleTimeString();
    
    messageDiv.innerHTML = `
      <strong>${message.sender}:</strong> ${message.text} 
      <em>(${messageTime})</em>
      ${isFromPeer ? ' <span class="peer-indicator" style="color: green; font-weight: bold;">[from peer]</span>' : ''}
      ${message.cubeKey ? ` <span class="cube-key" style="font-size: 0.8em; color: gray;">[${message.cubeKey.substring(0, 8)}...]</span>` : ''}
    `;
    chatBox.appendChild(messageDiv);
  }
  
  // Scroll to bottom
  chatBox.scrollTop = chatBox.scrollHeight;
  
  // Update message count in the UI
  const messageCountEl = document.getElementById('messageCount');
  if (messageCountEl) {
    messageCountEl.textContent = currentChatRoom.messages.length.toString();
  }
}