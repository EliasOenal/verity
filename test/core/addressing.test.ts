import { SupportedTransports, AddressError } from "../../src/core/networking/networkDefinitions";
import { AddressAbstraction, WebSocketAddress } from "../../src/core/peering/addressing";

import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

describe('AddressAbstraction', () => {
  describe('CreateAddress', () => {
    it('should return undefined for empty address', () => {
      expect(AddressAbstraction.CreateAddress('')).toBeUndefined();
    });

    it('should guess type based on address prefix', () => {
      const wsAddress = AddressAbstraction.CreateAddress('ws://localhost:8080');
      const libp2pAddress = AddressAbstraction.CreateAddress('/ip4/127.0.0.1/tcp/8081/ws');

      expect(wsAddress?.type).toBe(SupportedTransports.ws);
      expect(libp2pAddress?.type).toBe(SupportedTransports.libp2p);
    });

    it('should return undefined for invalid address', () => {
      expect(AddressAbstraction.CreateAddress('invalid', 31337 as SupportedTransports)).toBeUndefined();
    });

  })

  describe('constructor', () => {
    it('should throw AddressError for falsy address', () => {
      expect(() => new AddressAbstraction(null)).toThrow(AddressError);
    });

    it('should construct AddressAbstraction from string address', () => {
      const addressAbstraction = new AddressAbstraction('ws://localhost:8080');
      expect(addressAbstraction.type).toBe(SupportedTransports.ws);
    });

    it('should throw AddressError for unknown address type', () => {
      const unknownAddress: any = { invalid: true };
      expect(() => new AddressAbstraction(unknownAddress)).toThrow(AddressError);
    });
  });

  describe('equals method', () => {
    it('should return true for equal AddressAbstraction instances', () => {
      const address1 = new AddressAbstraction('ws://localhost:8080');
      const address2 = new AddressAbstraction('ws://localhost:8080');
      expect(address1.equals(address2)).toBe(true);
    });

    it('should return false for different address schemes', () => {
      const address1 = new AddressAbstraction('ws://127.0.0.1:8080');
      const address2 = new AddressAbstraction('/ip4/127.0.0.1/tcp/8080/ws');
      expect(address1.equals(address2)).toBe(false);
    });
  });

  // Test cases for ip, port, and toString methods
  describe('getters', () => {
    it('ip should return IP address', () => {
      const address = new AddressAbstraction('ws://localhost:8080');
      expect(address.ip).toBe('localhost');
    });

    it('port should return port number', () => {
      const address = new AddressAbstraction('ws://localhost:8080');
      expect(address.port).toBe(8080);
    });

    it('toString should return string representation of the address', () => {
      const address = new AddressAbstraction('localhost:8080');
      expect(address.toString()).toBe('localhost:8080');
    });
  });
});

describe('WebSocketAddress', () => {
  it('convertIPv6toIPv4 should convert IPv6 to IPv4', () => {
    const ipv6Address = '2001:0db8:85a3:0000:0000:8a2e:0370:7334';
    const ipv4Address = WebSocketAddress.convertIPv6toIPv4(`::ffff:${ipv6Address}`);
    expect(ipv4Address).toBe(ipv6Address);
  });

  it('constructor should create WebSocketAddress instance', () => {
    const wsAddress = new WebSocketAddress('localhost', 8080);
    expect(wsAddress.address).toBe('localhost');
    expect(wsAddress.port).toBe(8080);
  });

  it('equals should return true for equal WebSocketAddress instances', () => {
    const address1 = new WebSocketAddress('localhost', 8080);
    const address2 = new WebSocketAddress('localhost', 8080);
    expect(address1.equals(address2)).toBe(true);
  });

  it('equals should return false for different WebSocketAddress instances', () => {
    const address1 = new WebSocketAddress('localhost', 8080);
    const address2 = new WebSocketAddress('example.com', 8080);
    expect(address1.equals(address2)).toBe(false);
  });

  it('toString should return string representation of the WebSocketAddress', () => {
    const wsAddress = new WebSocketAddress('localhost', 8080);
    expect(wsAddress.toString(true)).toBe('ws://localhost:8080');
  });

  it('should interpret :: as localhost', () => {
    const wsAddress = new WebSocketAddress(':::8080')
    expect(wsAddress.toString(true)).toBe('ws://0.0.0.0:8080');
  })
});
