import { WebSocketConnection } from "../../../src/core/networking/transport/webSocket/webSocketConnection";
import { WebSocketServer } from "../../../src/core/networking/transport/webSocket/webSocketServer";
import { WebSocketTransport } from "../../../src/core/networking/transport/webSocket/webSocketTransport";
import { WebSocketAddress } from "../../../src/core/peering/addressing";

describe('WebSocket transport', () => {
  it('should transmit messages between client to server', async () => {
    // Manually create a WebSocket server
    const transport = new WebSocketTransport();
    await transport.start();
    const server = new WebSocketServer(transport, 11984);
    await server.start();

    // expect a server-side connection to be spawned by the server upon connection
    let serverConn: WebSocketConnection = undefined;
    server.on("incomingConnection", (conn: WebSocketConnection) => {
      serverConn = conn;
    });

    // create connection
    const clientConn = new WebSocketConnection(new WebSocketAddress('localhost', 11984));
    await clientConn.readyPromise;
    expect(serverConn).toBeInstanceOf(WebSocketConnection);

    // prepare for message to be received
    const serverReceivedMessages: Buffer[] = [];
    const clientReceivedMessages: Buffer[] = [];
    serverConn.on("messageReceived", (msgData: Buffer) => {
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

    // Send a message from client to server
    serverConn.send(Buffer.from("Salve cliens, ad tuum servitium."));

    // Wait for the message to arrive
    await new Promise((resolve) => setTimeout(resolve, 1000));

    expect(serverReceivedMessages).toHaveLength(1);
    expect(clientReceivedMessages).toHaveLength(1);
    expect(clientReceivedMessages[0].toString()).toEqual("Salve cliens, ad tuum servitium.");

    // Clean up
    await clientConn.close();
    await serverConn.close();
    await server.shutdown();
  });


  it.skip('automatically creates server objects as per supplied spec', async() => {
    // TODO IMPLEMENT
  });
});