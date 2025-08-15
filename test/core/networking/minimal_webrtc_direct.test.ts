// Add Promise.withResolvers polyfill for Node.js 20 compatibility
import 'promise.withresolvers/auto';

import { describe, it, expect } from 'vitest';
import { createLibp2p } from 'libp2p';
import { webRTCDirect } from '@libp2p/webrtc';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { isNode } from 'browser-or-node';

describe('WebRTC-Direct minimal test', () => {
  it('should create a minimal webRTC-Direct node', async () => {
    if (!isNode) {
      console.log('Skipping WebRTC-Direct minimal test in browser environment');
      return;
    }
    
    const node = await createLibp2p({
      addresses: {
        listen: [
          '/ip4/0.0.0.0/udp/0/webrtc-direct'
        ]
      },
      transports: [
        webRTCDirect()
      ],
      connectionEncrypters: [noise()],
      streamMuxers: [yamux()]
    });

    await node.start();
    
    console.log('Minimal WebRTC-Direct node multiaddrs:', node.getMultiaddrs().map(ma => ma.toString()));
    
    expect(node.status).toBe('started');
    expect(node.getMultiaddrs().length).toBeGreaterThan(0);
    
    // Should have at least one WebRTC-Direct multiaddr with certhash
    const hasWebRTCDirect = node.getMultiaddrs().some(ma => 
      ma.toString().includes('/webrtc-direct/') && ma.toString().includes('/certhash/'));
    
    expect(hasWebRTCDirect).toBe(true);
    
    await node.stop();
  }, 10000);
});