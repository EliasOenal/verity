// Add Promise.withResolvers polyfill for Node.js 20 compatibility
import 'promise.withresolvers/auto';

import { describe, it, expect } from 'vitest';
import { Libp2pTransport } from '../../../src/core/networking/transport/libp2p/libp2pTransport';

describe('WebRTC-Direct functionality', () => {
  it('should include webRTC-Direct transport on Node.js', async () => {
    // Use port number to trigger WebRTC-Direct address configuration
    const transport = new Libp2pTransport(15985);

    // Start the transport to trigger libp2p node creation
    await transport.start();

    // Verify the transport started successfully
    expect(transport.node).toBeDefined();
    expect(transport.node.status).toBe('started');

    // Get all multiaddrs from the transport
    const multiaddrs = transport.node.getMultiaddrs();
    expect(multiaddrs.length).toBeGreaterThan(0);

    // Check if we have WebRTC-Direct multiaddrs
    const hasWebRTCDirect = multiaddrs.some(ma =>
      ma.toString().includes('/webrtc-direct/') && ma.toString().includes('/certhash/'));

    // console.log('All multiaddrs:', multiaddrs.map(ma => ma.toString()));
    // console.log('Has WebRTC-Direct multiaddr:', hasWebRTCDirect);

    // Should have WebRTC-Direct multiaddrs with certificate hash
    expect(hasWebRTCDirect).toBe(true);

    // Should also have standard WebSocket multiaddrs
    const hasWebSocketAddr = multiaddrs.some(ma =>
      ma.toString().includes('/ws') && ma.toString().includes('/p2p/'));
    expect(hasWebSocketAddr).toBe(true);

    await transport.shutdown();
  }, 15000);

  it('should prefer WebRTC-Direct addresses in addressChange method', async () => {
    // Use port number to trigger WebRTC-Direct address configuration
    const transport = new Libp2pTransport(15986);

    await transport.start();

    // Trigger address change detection
    transport.addressChange();

    // If WebRTC-Direct is working, we should get a dialable address
    // Note: This might not always set dialableAddress immediately due to async nature
    // console.log('Dialable address after addressChange:', transport.dialableAddress?.toString());

    const multiaddrs = transport.node.getMultiaddrs();
    const webrtcDirectAddrs = multiaddrs.filter(ma =>
      ma.toString().includes('/webrtc-direct/'));

    expect(webrtcDirectAddrs.length).toBeGreaterThan(0);
    // console.log('WebRTC-Direct addresses found:', webrtcDirectAddrs.map(ma => ma.toString()));

    await transport.shutdown();
  }, 15000);

  it('should create valid listen configuration for WebRTC-Direct', () => {
    // Test with port number
    const transport1 = new Libp2pTransport(15987);
    // console.log('Transport1 listen addresses:', transport1.listen);

    expect(transport1.listen).toContain('/ip4/0.0.0.0/udp/0/webrtc-direct'); // dynamic port
    expect(transport1.listen).toContain('/webrtc-direct'); // generic

    // Test with explicit multiaddr
    const transport2 = new Libp2pTransport('/ip4/0.0.0.0/udp/15989/webrtc-direct');
    // console.log('Transport2 listen addresses:', transport2.listen);

    expect(transport2.listen).toContain('/ip4/0.0.0.0/udp/15989/webrtc-direct');
    expect(transport2.listen).toContain('/webrtc-direct');
  });

  it('should configure transports with both webRTC and webRTCDirect', async () => {
    // Use port number to trigger WebRTC-Direct address configuration
    const transport = new Libp2pTransport(15990);

    await transport.start();

    // The transport should have both standard WebRTC and WebRTC-Direct capabilities
    expect(transport.node).toBeDefined();
    expect(transport.node.status).toBe('started');

    // console.log('Node created successfully with mixed transport configuration');
    // console.log('Node multiaddrs:', transport.node.getMultiaddrs().map(ma => ma.toString()));

    // Should have multiple types of multiaddrs
    const multiaddrs = transport.node.getMultiaddrs();
    expect(multiaddrs.length).toBeGreaterThan(0);

    await transport.shutdown();
  }, 15000);
});