// Add Promise.withResolvers polyfill for Node.js 20 compatibility
import 'promise.withresolvers/auto';

import { describe, it, expect } from 'vitest';
import { Libp2pTransport } from '../../../src/core/networking/transport/libp2p/libp2pTransport';

describe('libp2p WebRTC circuit relay configuration verification', () => {
  it('should always include circuit relay transport when using WebRTC to prevent service dependency error', async () => {
    // This test verifies that the libp2p transport configuration always includes
    // circuit relay transport when WebRTC is used, preventing the error:
    // "Service "@libp2p/webrtc" required capability "@libp2p/circuit-relay-v2-transport" but it was not provided"
    
    const transport = new Libp2pTransport('/ip4/0.0.0.0/tcp/14985/ws');
    
    // Start the transport to trigger libp2p node creation
    await transport.start();
    
    // Verify the transport started successfully
    expect(transport.node).toBeDefined();
    expect(transport.node.status).toBe('started');
    
    // The fact that we got here without the circuit relay error means the configuration is correct
    console.log('libp2p transport created successfully with WebRTC and circuit relay');
    
    await transport.shutdown();
  }, 10000);

  it('should create valid multiaddrs for libp2p transport with default configuration', async () => {
    // Test that the default configuration creates valid multiaddrs
    const transport = new Libp2pTransport('/ip4/0.0.0.0/tcp/14986/ws');
    
    await transport.start();
    
    const multiaddrs = transport.node.getMultiaddrs();
    expect(multiaddrs.length).toBeGreaterThan(0);
    
    // Should have at least one WebSocket multiaddr
    const hasWebSocketAddr = multiaddrs.some(ma => 
      ma.toString().includes('/ws') && ma.toString().includes('/p2p/'));
    expect(hasWebSocketAddr).toBe(true);
    
    console.log('Generated multiaddrs:', multiaddrs.map(ma => ma.toString()));
    
    await transport.shutdown();
  }, 10000);
});