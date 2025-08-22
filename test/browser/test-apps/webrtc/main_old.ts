/**
 * WebRTC Test Application
 * 
 * This is a minimal web application for testing Verity WebRTC P2P functionality.
 * It initializes a light node optimized for WebRTC operations with testCoreOptions built-in.
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

let webrtcConnection: RTCPeerConnection | null = null;
let dataChannel: RTCDataChannel | null = null;

async function initializeWebRTCNodeTest(): Promise<void> {
  if (!isBrowser) {
    throw new Error('WebRTC node test must be run in browser environment');
  }

  logger.info('Initializing WebRTC node test application');

  // Wait for libsodium to be ready
  await sodium.ready;

  // Configure light node with test optimizations built-in
  const nodeOptions = {
    // Built-in test optimizations for fast execution
    ...testCoreOptions,
    
    // Light node configuration optimized for WebRTC
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

  // Expose to global scope for tests
  (window as any).verity = {
    node: node,
    cockpit: cockpit,
    
    webrtc: {
      connection: null,
      dataChannel: null,
      
      initializeConnection: async () => {
        try {
          log('Initializing WebRTC connection...', 'info');
          
          // Create RTCPeerConnection
          webrtcConnection = new RTCPeerConnection({
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' }
            ]
          });
          
          (window as any).verity.webrtc.connection = webrtcConnection;
          
          // Set up connection event handlers
          webrtcConnection.onconnectionstatechange = () => {
            const state = webrtcConnection?.connectionState;
            log(`WebRTC connection state: ${state}`, 'info');
            updateConnectionStatus(state || 'unknown');
          };
          
          webrtcConnection.oniceconnectionstatechange = () => {
            log(`ICE connection state: ${webrtcConnection?.iceConnectionState}`, 'info');
          };
          
          webrtcConnection.onicecandidateerror = (event) => {
            log(`ICE candidate error: ${(event as any).errorText}`, 'error');
          };
          
          log('WebRTC connection initialized successfully', 'success');
          
        } catch (error) {
          log(`Failed to initialize WebRTC: ${(error as Error).message}`, 'error');
        }
      },
      
      testDataChannel: async () => {
        if (!webrtcConnection) {
          log('No WebRTC connection available. Initialize first.', 'error');
          return;
        }
        
        try {
          log('Creating data channel...', 'info');
          
          // Create data channel
          dataChannel = webrtcConnection.createDataChannel('verity-test', {
            ordered: true
          });
          
          (window as any).verity.webrtc.dataChannel = dataChannel;
          
          // Set up data channel event handlers
          dataChannel.onopen = () => {
            log('Data channel opened', 'success');
            updateConnectionStatus('data-channel-open');
          };
          
          dataChannel.onclose = () => {
            log('Data channel closed', 'info');
          };
          
          dataChannel.onmessage = (event) => {
            log(`Received data: ${event.data}`, 'success');
          };
          
          dataChannel.onerror = (error) => {
            log(`Data channel error: ${error}`, 'error');
          };
          
          log('Data channel created successfully', 'success');
          
        } catch (error) {
          log(`Failed to create data channel: ${(error as Error).message}`, 'error');
        }
      },
      
      sendTestData: async () => {
        if (!dataChannel || dataChannel.readyState !== 'open') {
          log('Data channel not available or not open', 'error');
          return;
        }
        
        try {
          const testMessage = {
            type: 'test',
            timestamp: Date.now(),
            nodeId: node.networkManager.idString.substring(0, 8),
            data: 'Hello from Verity WebRTC test!'
          };
          
          const messageJson = JSON.stringify(testMessage);
          dataChannel.send(messageJson);
          
          log(`Sent test data: ${messageJson}`, 'info');
          
        } catch (error) {
          log(`Failed to send test data: ${(error as Error).message}`, 'error');
        }
      }
    },
    
    testUtils: {
      createUniqueTestCube: async (content?: string) => {
        const uniqueContent = content || `WEBRTC-${Date.now()}-${Math.random()}`;
        
        try {
          const veritum = cockpit.prepareVeritum();
          
          // Add unique content
          if (veritum.fields && veritum.fields.insertTillFull) {
            const payloadField = { 
              type: 4, // PAYLOAD type
              data: new TextEncoder().encode(uniqueContent) 
            };
            veritum.fields.insertTillFull([payloadField]);
          }
          
          await veritum.compile();
          const cubes = Array.from(veritum.chunks);
          
          if (cubes.length === 0) {
            throw new Error('No cubes generated from veritum');
          }
          
          const cube = cubes[0];
          const key = await cube.getKey();
          
          // Store the cube
          await node.cubeStore.addCube(cube);
          
          return {
            success: true,
            cubeKey: key,
            keyHex: key.toString('hex').substring(0, 32) + '...'
          };
        } catch (error) {
          return {
            success: false,
            error: (error as Error).message
          };
        }
      }
    }
  };

  function log(message: string, type: string = 'info'): void {
    const logDiv = document.getElementById('log');
    if (logDiv) {
      const entry = document.createElement('div');
      entry.className = `log-entry log-${type}`;
      entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
      logDiv.appendChild(entry);
      logDiv.scrollTop = logDiv.scrollHeight;
    }
  }

  function updateConnectionStatus(state: string): void {
    const statusDiv = document.getElementById('connectionStatus');
    if (statusDiv) {
      statusDiv.className = 'connection-status';
      
      switch (state) {
        case 'connected':
        case 'data-channel-open':
          statusDiv.className += ' connected';
          statusDiv.textContent = 'WebRTC Status: Connected';
          break;
        case 'connecting':
        case 'new':
          statusDiv.className += ' connecting';
          statusDiv.textContent = 'WebRTC Status: Connecting';
          break;
        default:
          statusDiv.className += ' disconnected';
          statusDiv.textContent = 'WebRTC Status: Disconnected';
      }
    }
  }

  // Set up event handlers
  const initButton = document.getElementById('initializeWebRTC');
  const testChannelButton = document.getElementById('testDataChannel');
  const sendDataButton = document.getElementById('sendTestData');
  
  if (initButton) {
    initButton.addEventListener('click', (window as any).verity.webrtc.initializeConnection);
  }
  
  if (testChannelButton) {
    testChannelButton.addEventListener('click', (window as any).verity.webrtc.testDataChannel);
  }
  
  if (sendDataButton) {
    sendDataButton.addEventListener('click', (window as any).verity.webrtc.sendTestData);
  }

  // Update UI
  const statusEl = document.getElementById('status');
  const nodeInfoEl = document.getElementById('nodeInfo');
  
  if (statusEl) {
    statusEl.textContent = 'WebRTC node ready!';
  }
  
  if (nodeInfoEl) {
    nodeInfoEl.innerHTML = `
      <h3>Node Information</h3>
      <p><strong>Node ID:</strong> ${node.networkManager.idString}</p>
      <p><strong>Node Type:</strong> ${node.constructor.name}</p>
      <p><strong>Light Node:</strong> ${node.isLightNode ? 'Yes' : 'No'}</p>
      <p><strong>WebRTC Support:</strong> ${typeof RTCPeerConnection !== 'undefined' ? 'Yes' : 'No'}</p>
      <p><strong>Cube Count:</strong> <span id="cubeCount">${await node.cubeStore.getNumberOfStoredCubes()}</span></p>
      <p><strong>Online Peers:</strong> <span id="peerCount">${node.networkManager.onlinePeers.length}</span></p>
      <p><strong>Test Optimizations:</strong> Active</p>
    `;
  }

  logger.info('WebRTC node test application ready');
}

// Initialize when page loads
if (isBrowser) {
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const statusEl = document.getElementById('status');
      if (statusEl) {
        statusEl.textContent = 'Initializing WebRTC node...';
      }
      
      await initializeWebRTCNodeTest();
    } catch (error) {
      logger.error('Failed to initialize WebRTC node test:', error);
      
      const statusEl = document.getElementById('status');
      if (statusEl) {
        statusEl.textContent = `Error: ${(error as Error).message}`;
      }
    }
  });
}