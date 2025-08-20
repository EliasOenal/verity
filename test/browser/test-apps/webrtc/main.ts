/**
 * WebRTC Test Application
 * 
 * This is a minimal web application for testing Verity WebRTC P2P functionality.
 * It provides basic WebRTC testing capabilities.
 */

import { isBrowser } from 'browser-or-node';
import sodium from 'libsodium-wrappers-sumo';

let webrtcConnection: RTCPeerConnection | null = null;
let dataChannel: RTCDataChannel | null = null;

async function initializeWebRTCTest(): Promise<void> {
  if (!isBrowser) {
    throw new Error('WebRTC test must be run in browser environment');
  }

  console.log('Initializing WebRTC test application');

  // Wait for libsodium to be ready
  await sodium.ready;

  // Expose WebRTC functionality to global scope for tests
  (window as any).verity = {
    nodeType: 'webrtc-test',
    testUtils: {
      createConnection: async () => {
        try {
          webrtcConnection = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
          });
          
          dataChannel = webrtcConnection.createDataChannel('test', {
            ordered: true
          });
          
          dataChannel.onopen = () => {
            console.log('Data channel opened');
          };
          
          dataChannel.onmessage = (event) => {
            console.log('Data channel message:', event.data);
          };
          
          return {
            success: true,
            connectionState: webrtcConnection.connectionState,
            timestamp: new Date().toISOString()
          };
        } catch (error) {
          return {
            success: false,
            error: (error as Error).message
          };
        }
      },
      
      sendData: async (data: string) => {
        if (!dataChannel || dataChannel.readyState !== 'open') {
          return {
            success: false,
            error: 'Data channel not open'
          };
        }
        
        try {
          const message = `WEBRTC-${data}-${Date.now()}-${Math.random()}`;
          dataChannel.send(message);
          return {
            success: true,
            message: message,
            timestamp: new Date().toISOString()
          };
        } catch (error) {
          return {
            success: false,
            error: (error as Error).message
          };
        }
      },
      
      getConnectionInfo: () => {
        return {
          hasConnection: webrtcConnection !== null,
          connectionState: webrtcConnection?.connectionState || 'none',
          hasDataChannel: dataChannel !== null,
          dataChannelState: dataChannel?.readyState || 'none',
          timestamp: new Date().toISOString()
        };
      },
      
      closeConnection: () => {
        if (dataChannel) {
          dataChannel.close();
          dataChannel = null;
        }
        
        if (webrtcConnection) {
          webrtcConnection.close();
          webrtcConnection = null;
        }
        
        return {
          success: true,
          closed: true,
          timestamp: new Date().toISOString()
        };
      },
      
      createTestData: async () => {
        const data = `WEBRTC-DATA-${Date.now()}-${Math.random()}`;
        return {
          success: true,
          data: data,
          length: data.length
        };
      }
    }
  };

  // Update UI
  const statusEl = document.getElementById('status');
  const nodeInfoEl = document.getElementById('nodeInfo');
  
  if (statusEl) {
    statusEl.textContent = 'WebRTC test ready!';
  }
  
  if (nodeInfoEl) {
    nodeInfoEl.innerHTML = `
      <h3>WebRTC Test Information</h3>
      <p><strong>Status:</strong> Ready</p>
      <p><strong>Type:</strong> WebRTC Test</p>
      <p><strong>Connection:</strong> <span id="connectionState">None</span></p>
      <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
      <p><strong>Test Optimizations:</strong> Active</p>
    `;
  }

  console.log('WebRTC test application ready');
}

// Initialize when page loads
if (isBrowser) {
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const statusEl = document.getElementById('status');
      if (statusEl) {
        statusEl.textContent = 'Initializing WebRTC test...';
      }
      
      await initializeWebRTCTest();
    } catch (error) {
      console.error('Failed to initialize WebRTC test:', error);
      
      const statusEl = document.getElementById('status');
      if (statusEl) {
        statusEl.textContent = `Error: ${(error as Error).message}`;
      }
    }
  });
}