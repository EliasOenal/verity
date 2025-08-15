import { Libp2pConnection } from "../../../src/core/networking/transport/libp2p/libp2pConnection";
import { Libp2pServer } from "../../../src/core/networking/transport/libp2p/libp2pServer";
import { Libp2pTransport } from "../../../src/core/networking/transport/libp2p/libp2pTransport";

import { Multiaddr, multiaddr } from '@multiformats/multiaddr'

import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

describe('libp2p transport', () => {
  it('should transmit messages between client to server', async () => {
    // Create two separate transports for server and client
    const serverTransport = new Libp2pTransport('/ip4/0.0.0.0/tcp/11985/ws');
    await serverTransport.start();
    const server = serverTransport.server;

    const clientTransport = new Libp2pTransport('/ip4/0.0.0.0/tcp/11986/ws');
    await clientTransport.start();

    // expect a server-side connection to be spawned by the server upon connection
    let serverConn: Libp2pConnection;
    server.on("incomingConnection", (conn: Libp2pConnection) => {
      serverConn = conn;
    });

    // create connection from client to server
    const clientConn = new Libp2pConnection(multiaddr('/ip4/127.0.0.1/tcp/11985/ws'), clientTransport);
    await clientConn.readyPromise;
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(serverConn!).toBeInstanceOf(Libp2pConnection);

    // prepare for message to be received
    const serverReceivedMessages: Buffer[] = [];
    const clientReceivedMessages: Buffer[] = [];
    serverConn!.on("messageReceived", (msgData: Buffer) => {
      serverReceivedMessages.push(msgData);
    });
    clientConn.on("messageReceived", (msgData: Buffer) => {
      clientReceivedMessages.push(msgData);
    });

    // Send a message from client to server
    clientConn.send(Buffer.from("Salve serve, cliens tuus sum."));

    // Wait for the message to arrive
    await new Promise((resolve) => setTimeout(resolve, 1000));

    expect(serverReceivedMessages).toHaveLength(1); // client did send a message
    expect(clientReceivedMessages).toHaveLength(0); // Server did not send message yet
    expect(serverReceivedMessages[0].toString()).toEqual("Salve serve, cliens tuus sum.");

    // Send a message from server to client
    serverConn!.send(Buffer.from("Salve cliens, ad tuum servitium."));

    // Wait for the message to arrive
    await new Promise((resolve) => setTimeout(resolve, 1000));

    expect(serverReceivedMessages).toHaveLength(1);
    expect(clientReceivedMessages).toHaveLength(1);
    expect(clientReceivedMessages[0].toString()).toEqual("Salve cliens, ad tuum servitium.");

    // Clean up
    await clientConn.close();
    await serverConn!.close();
    await serverTransport.shutdown();
    await clientTransport.shutdown();
  }, 10000);


  it.todo('automatically creates server objects as per supplied spec');
});