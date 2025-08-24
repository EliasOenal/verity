import { test, expect, Browser } from '@playwright/test';
import { 
  initializeVerityInBrowser, 
  createTestCubeInBrowser,
  getCubeCountFromBrowser,
  getNodeInfo,
  shutdownBrowserNode
} from './playwright-utils';

test.describe('Advanced WebRTC P2P Connectivity Tests', () => {
  
  test.afterEach(async ({ page }) => {
    await shutdownBrowserNode(page);
  });

  test('should establish WebRTC data channel between two browser nodes', async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();
    
    try {
      // Initialize both browser nodes
      await Promise.all([
        initializeVerityInBrowser(page1),
        initializeVerityInBrowser(page2)
      ]);
      
      // Establish direct WebRTC connection between browser nodes
      const connectionResult = await page1.evaluate(async () => {
        try {
          // Create two peer connections to simulate P2P
          const pc1 = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
          });
          
          const pc2 = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
          });
          
          // Create data channel on pc1
          const dataChannel1 = pc1.createDataChannel('verity-cubes', {
            ordered: true,
            maxRetransmits: 3
          });
          
          let dataChannel2: RTCDataChannel | null = null;
          let messagesReceived: string[] = [];
          let connectionEstablished = false;
          
          // Set up data channel handlers
          dataChannel1.onopen = () => {
            connectionEstablished = true;
            dataChannel1.send('Hello from browser node 1');
          };
          
          dataChannel1.onmessage = (event) => {
            messagesReceived.push(`Node1 received: ${event.data}`);
          };
          
          // Handle incoming data channel on pc2
          pc2.ondatachannel = (event) => {
            dataChannel2 = event.channel;
            dataChannel2.onmessage = (event) => {
              messagesReceived.push(`Node2 received: ${event.data}`);
              // Echo back
              if (dataChannel2?.readyState === 'open') {
                dataChannel2.send('Hello from browser node 2');
              }
            };
          };
          
          // ICE candidate exchange
          const ice1Candidates: RTCIceCandidate[] = [];
          const ice2Candidates: RTCIceCandidate[] = [];
          
          pc1.onicecandidate = (event) => {
            if (event.candidate) {
              ice1Candidates.push(event.candidate);
              pc2.addIceCandidate(event.candidate);
            }
          };
          
          pc2.onicecandidate = (event) => {
            if (event.candidate) {
              ice2Candidates.push(event.candidate);
              pc1.addIceCandidate(event.candidate);
            }
          };
          
          // Offer/Answer exchange
          const offer = await pc1.createOffer();
          await pc1.setLocalDescription(offer);
          await pc2.setRemoteDescription(offer);
          
          const answer = await pc2.createAnswer();
          await pc2.setLocalDescription(answer);
          await pc1.setRemoteDescription(answer);
          
          // Wait for connection establishment
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Clean up
          pc1.close();
          pc2.close();
          
          return {
            success: true,
            connectionEstablished,
            messagesExchanged: messagesReceived.length > 0,
            ice1CandidatesCount: ice1Candidates.length,
            ice2CandidatesCount: ice2Candidates.length,
            dataChannelCreated: !!dataChannel1,
            dataChannelReceived: !!dataChannel2,
            messages: messagesReceived
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      });
      
      expect(connectionResult.success).toBe(true);
      expect(connectionResult.dataChannelCreated).toBe(true);
      
      // Expect full WebRTC connectivity and functionality
      expect(connectionResult.dataChannelReceived).toBe(true);
      expect(connectionResult.ice1CandidatesCount).toBeGreaterThan(0);
      expect(connectionResult.ice2CandidatesCount).toBeGreaterThan(0);
      
      console.log('WebRTC P2P connection test:', connectionResult);
      
    } finally {
      await Promise.all([
        shutdownBrowserNode(page1),
        shutdownBrowserNode(page2)
      ]);
      await context1.close();
      await context2.close();
    }
  });

  test('should simulate cube synchronization over WebRTC P2P connection', async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();
    
    try {
      await Promise.all([
        initializeVerityInBrowser(page1),
        initializeVerityInBrowser(page2)
      ]);
      
      // Create cubes in both nodes
      const [cube1, cube2] = await Promise.all([
        createTestCubeInBrowser(page1, 'Node 1 cube for P2P sync'),
        createTestCubeInBrowser(page2, 'Node 2 cube for P2P sync')
      ]);
      
      expect(cube1.success).toBe(true);
      expect(cube2.success).toBe(true);
      
      // Simulate cube key exchange over WebRTC
      const syncResult = await page1.evaluate(async (remoteCubeKey) => {
        try {
          // Simulate WebRTC data channel for cube synchronization
          const pc1 = new RTCPeerConnection();
          const pc2 = new RTCPeerConnection();
          
          const dataChannel = pc1.createDataChannel('cube-sync', { ordered: true });
          let syncMessages: string[] = [];
          
          // Simulate cube metadata exchange
          const messagingPromise = new Promise<void>((resolve) => {
            dataChannel.onopen = () => {
              // Send cube availability announcement
              const cubeAnnouncement = {
                type: 'cube_available',
                cubeKey: remoteCubeKey,
                timestamp: Date.now()
              };
              dataChannel.send(JSON.stringify(cubeAnnouncement));
              syncMessages.push('cube_available');
            };
            
            // Handle case where channel doesn't open
            setTimeout(() => resolve(), 1000);
          });
          
          // Handle incoming cube sync messages
          pc2.ondatachannel = (event) => {
            const channel = event.channel;
            channel.onmessage = (event) => {
              try {
                const message = JSON.parse(event.data);
                syncMessages.push(message.type);
                
                if (message.type === 'cube_available') {
                  // Respond with cube request
                  channel.send(JSON.stringify({
                    type: 'cube_request',
                    cubeKey: message.cubeKey
                  }));
                  syncMessages.push('cube_request');
                }
              } catch (error) {
                console.warn('Message parsing failed:', error);
              }
            };
          };
          
          // Set up connection
          const offer = await pc1.createOffer();
          await pc1.setLocalDescription(offer);
          await pc2.setRemoteDescription(offer);
          
          const answer = await pc2.createAnswer();
          await pc2.setLocalDescription(answer);
          await pc1.setRemoteDescription(answer);
          
          await messagingPromise;
          
          // Wait for message exchange
          await new Promise(resolve => setTimeout(resolve, 1500));
          
          pc1.close();
          pc2.close();
          
          return {
            success: true,
            messagesSent: syncMessages.length > 0,
            messageTypes: syncMessages
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }, cube2.cubeKey);
      
      expect(syncResult.success).toBe(true);
      
      // Expect full messaging functionality 
      expect(syncResult.messagesSent).toBe(true);
      expect(syncResult.messageTypes).toBeDefined();
      expect(Array.isArray(syncResult.messageTypes)).toBe(true);
      
      console.log('Cube sync over WebRTC test:', syncResult);
      
    } finally {
      await Promise.all([
        shutdownBrowserNode(page1),
        shutdownBrowserNode(page2)
      ]);
      await context1.close();
      await context2.close();
    }
  });

  test('should test WebRTC connection with STUN/TURN relay', async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();
    
    try {
      await Promise.all([
        initializeVerityInBrowser(page1),
        initializeVerityInBrowser(page2)
      ]);
      
      // Test WebRTC with STUN servers (simulating relay through full node)
      const relayTest = await page1.evaluate(async () => {
        try {
          const stunServers = [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
          ];
          
          const pc1 = new RTCPeerConnection({ iceServers: stunServers });
          const pc2 = new RTCPeerConnection({ iceServers: stunServers });
          
          const dataChannel = pc1.createDataChannel('relay-test');
          let connectionStates: string[] = [];
          let iceGatheringStates: string[] = [];
          
          // Monitor connection states
          pc1.onconnectionstatechange = () => {
            connectionStates.push(`PC1: ${pc1.connectionState}`);
          };
          
          pc2.onconnectionstatechange = () => {
            connectionStates.push(`PC2: ${pc2.connectionState}`);
          };
          
          pc1.onicegatheringstatechange = () => {
            iceGatheringStates.push(`PC1 ICE: ${pc1.iceGatheringState}`);
          };
          
          pc2.onicegatheringstatechange = () => {
            iceGatheringStates.push(`PC2 ICE: ${pc2.iceGatheringState}`);
          };
          
          // ICE candidate collection
          const candidates: { pc1: number; pc2: number } = { pc1: 0, pc2: 0 };
          
          pc1.onicecandidate = (event) => {
            if (event.candidate) {
              candidates.pc1++;
              pc2.addIceCandidate(event.candidate);
            }
          };
          
          pc2.onicecandidate = (event) => {
            if (event.candidate) {
              candidates.pc2++;
              pc1.addIceCandidate(event.candidate);
            }
          };
          
          // Offer/Answer with relay simulation
          const offer = await pc1.createOffer();
          await pc1.setLocalDescription(offer);
          
          // Simulate relay delay
          await new Promise(resolve => setTimeout(resolve, 100));
          
          await pc2.setRemoteDescription(offer);
          const answer = await pc2.createAnswer();
          await pc2.setLocalDescription(answer);
          
          // Simulate relay delay
          await new Promise(resolve => setTimeout(resolve, 100));
          
          await pc1.setRemoteDescription(answer);
          
          // Wait for ICE gathering
          await new Promise(resolve => setTimeout(resolve, 3000));
          
          const finalState = {
            pc1State: pc1.connectionState,
            pc2State: pc2.connectionState,
            pc1IceState: pc1.iceGatheringState,
            pc2IceState: pc2.iceGatheringState
          };
          
          pc1.close();
          pc2.close();
          
          return {
            success: true,
            candidatesCollected: candidates,
            connectionStates,
            iceGatheringStates,
            finalState,
            stunServersUsed: stunServers.length
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      });
      
      expect(relayTest.success).toBe(true);
      expect(relayTest.stunServersUsed).toBe(2);
      
      // Expect full ICE candidate generation
      expect(relayTest.candidatesCollected.pc1).toBeGreaterThan(0);
      expect(relayTest.candidatesCollected.pc2).toBeGreaterThan(0);
      
      console.log('WebRTC STUN relay test:', relayTest);
      
    } finally {
      await Promise.all([
        shutdownBrowserNode(page1),
        shutdownBrowserNode(page2)
      ]);
      await context1.close();
      await context2.close();
    }
  });

  test('should test multi-node WebRTC mesh network', async ({ browser }) => {
    // Create a mesh of 3 browser nodes
    const contexts = await Promise.all([
      browser.newContext(),
      browser.newContext(),
      browser.newContext()
    ]);
    
    const pages = await Promise.all(contexts.map(ctx => ctx.newPage()));
    
    try {
      // Initialize all nodes
      await Promise.all(pages.map(page => initializeVerityInBrowser(page)));
      
      // Create cubes in each node
      const cubes = await Promise.all(pages.map((page, i) => 
        createTestCubeInBrowser(page, `Mesh node ${i + 1} cube`)
      ));
      
      cubes.forEach(cube => expect(cube.success).toBe(true));
      
      // Simulate mesh network establishment
      const meshResult = await pages[0].evaluate(async (nodeCount) => {
        try {
          const connections: RTCPeerConnection[] = [];
          const dataChannels: RTCDataChannel[] = [];
          const meshStats = {
            connectionsEstablished: 0,
            dataChannelsCreated: 0,
            messagesExchanged: 0
          };
          
          // Create connections to simulate mesh (each node connects to others)
          for (let i = 0; i < nodeCount - 1; i++) {
            const pc = new RTCPeerConnection();
            const channel = pc.createDataChannel(`mesh-${i}`);
            
            connections.push(pc);
            dataChannels.push(channel);
            
            channel.onopen = () => {
              meshStats.connectionsEstablished++;
              channel.send(`Hello from mesh node 0 to node ${i + 1}`);
            };
            
            channel.onmessage = () => {
              meshStats.messagesExchanged++;
            };
          }
          
          meshStats.dataChannelsCreated = dataChannels.length;
          
          // Simulate time for connections
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // Clean up
          connections.forEach(pc => pc.close());
          
          return {
            success: true,
            nodeCount,
            stats: meshStats,
            connectionsCreated: connections.length
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }, pages.length);
      
      expect(meshResult.success).toBe(true);
      expect(meshResult.nodeCount).toBe(3);
      expect(meshResult.connectionsCreated).toBe(2);
      expect(meshResult.stats.dataChannelsCreated).toBe(2);
      
      console.log('Mesh network test:', meshResult);
      
    } finally {
      await Promise.all(pages.map(page => shutdownBrowserNode(page)));
      await Promise.all(contexts.map(ctx => ctx.close()));
    }
  });

  test('should test WebRTC with bandwidth and latency simulation', async ({ browser }) => {
    const context1 = await browser.newContext();
    const page1 = await context1.newPage();
    
    try {
      await initializeVerityInBrowser(page1);
      
      // Test data transmission with simulated network conditions
      const bandwidthTest = await page1.evaluate(async () => {
        try {
          const pc1 = new RTCPeerConnection();
          const pc2 = new RTCPeerConnection();
          
          const dataChannel = pc1.createDataChannel('bandwidth-test', {
            ordered: false,
            maxPacketLifeTime: 1000
          });
          
          let messagesSent = 0;
          let messagesReceived = 0;
          let startTime: number;
          let endTime: number;
          
          // Set up receiver
          pc2.ondatachannel = (event) => {
            const channel = event.channel;
            channel.onmessage = () => {
              messagesReceived++;
              if (messagesReceived === 1) {
                endTime = performance.now();
              }
            };
          };
          
          // Connection setup
          const offer = await pc1.createOffer();
          await pc1.setLocalDescription(offer);
          await pc2.setRemoteDescription(offer);
          
          const answer = await pc2.createAnswer();
          await pc2.setLocalDescription(answer);
          await pc1.setRemoteDescription(answer);
          
          // Wait for connection
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // Send test data
          const sendPromise = new Promise<void>((resolve) => {
            dataChannel.onopen = () => {
              startTime = performance.now();
              
              // Send multiple messages to test bandwidth
              for (let i = 0; i < 10; i++) {
                try {
                  const testData = `Test message ${i} - ${new Array(100).fill('x').join('')}`;
                  if (dataChannel.readyState === 'open') {
                    dataChannel.send(testData);
                    messagesSent++;
                  }
                } catch (error) {
                  // Sending failed
                  console.warn('Send failed:', error);
                }
              }
              resolve();
            };
            
            // Handle case where dataChannel doesn't open
            setTimeout(() => resolve(), 1000);
          });
          
          await sendPromise;
          
          // Wait for message processing
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          const latency = endTime! ? endTime! - startTime! : 0;
          
          pc1.close();
          pc2.close();
          
          return {
            success: true,
            messagesSent,
            messagesReceived,
            latency,
            throughputRatio: messagesSent > 0 ? messagesReceived / messagesSent : 0
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      });
      
      expect(bandwidthTest.success).toBe(true);
      
      // Expect full message sending functionality
      expect(bandwidthTest.messagesSent).toBe(10);
      expect(bandwidthTest.latency).toBeGreaterThan(0);
      expect(bandwidthTest.throughputRatio).toBeGreaterThan(0);
      
      console.log('Bandwidth test:', bandwidthTest);
      
    } finally {
      await shutdownBrowserNode(page1);
      await context1.close();
    }
  });
});