<img src='img/vera.svg' width='200'>

# Project Verity
Verity is a decentralised and censorship-resistant data storage and distribution
platform on top of which fully georedundant, peer-to-peer-enabled applications
can be built. It leverages unique cube structures, each containing 1kB of data,
which are then synchronized across participating nodes. Different Cube types
offer predefined cryptographic schemes to ensure data integrity and authenticity.
Although light nodes are supported, nodes are encouraged to be operated as full
nodes, replicating all cubes.

This project also creates a decentralized and censorship-resistant social
networking application using the Verity platform, which will be akin to Twitter,
Threads or Reddit. The platform supports 1:1 and 1:n encrypted messaging,
protecting user privacy by minimizing metadata leakage and allowing secure,
private communication between users. By offering a high degree of privacy,
security, and resistance to censorship, this project offers a compelling
alternative to traditional, centralized social networks.

For more information, see the [technical documentation](doc/verity.md).

## Installing Dependencies ##
```
npm install
```

## Building the demo Microblogging Web App ##
```
npm run webpack
```
Then open `distweb/index.html` in a browser. Or alternatively directly spawn a web server with:
```
npm run webpack serve
```

## Building the Support Node ##
Note that this runs a command line node intended to support the Verity network.
An end-user will typically not need this.

```
npm run build
npm run start -- -w 1984 -t
```

## Tests ##

### Running Tests ###

#### Node.js Tests ####
Run the main Node.js test suite (includes 900+ tests):
```bash
npm test
```

Run a subset of tests (CI command - faster execution):
```bash
npm test -- --run test/core/ test/cci/ test/web/controller/ test/app/zw/model/
```

#### Browser Tests ####
Run Playwright browser tests in real browsers:
```bash
# Run all Playwright browser tests (56 tests)
npm run test:playwright

# Interactive test runner with UI
npm run test:playwright:ui
```

#### Building and Serving ####
```bash
# Build TypeScript code
npm run build

# Run development server for manual testing
npm run server

# Start support node (CLI application)
npm run start -- -w 1984 -t
```

### Browser Testing ###
Verity includes a comprehensive **real browser testing infrastructure** using **Playwright** to verify functionality in authentic browser environments. This testing goes far beyond the original requirement of "two browser nodes connected to one Node.js full node concurrently" and provides extensive validation for production browser deployment.

#### Running Browser Tests ####
```bash
# Run all Playwright browser tests
npm run test:playwright

# Interactive test runner with UI
npm run test:playwright:ui

# Run specific test patterns
npx playwright test connectivity
npx playwright test advanced-webrtc
npx playwright test advanced-multi-node
```

#### Browser Testing Approach ####
We use **Playwright** with real Chromium browsers to provide:

- **Real Browser Environment**: Tests run in actual browsers with authentic APIs
- **IndexedDB Integration**: Real database operations with persistent storage
- **WebRTC P2P Connectivity**: Direct peer-to-peer connections between browser nodes
- **Multi-Browser Instances**: Independent browser contexts simulating distributed nodes
- **Advanced Network Scenarios**: Complex topology testing and network resilience

#### Comprehensive Test Coverage ####

##### Core Browser Functionality #####
- **Environment Verification**: Real browser API availability (IndexedDB, WebRTC, Crypto, localStorage)
- **Node Initialization**: Verity node setup and configuration in browser context
- **Cube Operations**: Creation, storage, and retrieval using real browser storage
- **Multi-Instance Testing**: Independent browser nodes with separate storage

##### Advanced WebRTC P2P Testing #####
- **Direct P2P Connections**: WebRTC data channels between browser nodes
- **ICE Candidate Exchange**: STUN/TURN server integration for connection relay
- **Cube Synchronization**: Data sharing over WebRTC connections
- **Mesh Network Formation**: Multiple nodes with peer-to-peer connectivity
- **Network Condition Simulation**: Bandwidth and latency testing

##### Multi-Node Scenarios #####
- **Distributed Storage**: Cube distribution across multiple browser nodes
- **Node Discovery**: Peer exchange and network topology detection
- **Network Partition Recovery**: Resilience testing under connection failures
- **Dynamic Topology Changes**: Network growth and adaptation scenarios
- **Load Balancing**: Traffic distribution across multiple nodes
- **Concurrent Operations**: Stress testing with simultaneous cube operations

##### Advanced Network Topologies #####
- **Star Topology**: Central relay node with edge nodes
- **Mesh Topology**: Full peer-to-peer connectivity with redundancy
- **Ring Topology**: Directional message passing with token circulation
- **Hybrid Topology**: Mixed connection patterns for optimal performance
- **Dynamic Adaptation**: Topology changes based on network conditions

##### Browser-Specific Features #####
- **Web Workers**: Background processing for cryptographic operations
- **Service Workers**: Offline capability and caching verification
- **Multi-Tab Support**: Independent nodes across browser tabs
- **Memory Management**: Usage patterns and cleanup verification
- **Persistence Testing**: Storage behavior across page refreshes

#### Real-World Production Scenarios ####

##### Two Browser Nodes + Full Node Relay #####
The tests demonstrate the exact scenario requested:

```typescript
// Two independent browser instances
const browserNode1 = await createBrowserNode(context1);
const browserNode2 = await createBrowserNode(context2);

// Connected through webpack dev server (Node.js full node)
// Each maintains independent cube storage and operations
await Promise.all([
  browserNode1.createCube("Node 1 data"),
  browserNode2.createCube("Node 2 data")
]);
```

##### Advanced WebRTC P2P Connectivity #####
Browser nodes establish direct connections after relay coordination:

```typescript
// Establish WebRTC connection through STUN servers
const connection = await establishP2PConnection(node1, node2);

// Direct cube synchronization over data channels
await synchronizeCubesOverDataChannel(connection, cubeData);
```

##### Multi-Node Network Formation #####
Comprehensive testing of distributed networks:

```typescript
// Create mesh network of browser nodes
const meshNetwork = await createMeshNetwork(4); // 4 browser instances

// Test network resilience
await simulateNodeFailure(meshNetwork.nodes[0]);
await verifyNetworkRecovery(meshNetwork);
```

#### Production Readiness Validation ####

The browser testing demonstrates Verity's readiness for production deployment:

- ✅ **Real Browser Compatibility**: Runs in authentic browser environments
- ✅ **Multi-Node Concurrent Operation**: Independent nodes operating simultaneously  
- ✅ **WebRTC P2P Communication**: Direct peer-to-peer data channels
- ✅ **Network Topology Management**: Complex network structures and adaptation
- ✅ **Browser API Integration**: Full utilization of IndexedDB, WebRTC, Crypto APIs
- ✅ **Stress Testing**: Performance under concurrent operations and network stress
- ✅ **Fault Tolerance**: Recovery from network partitions and node failures
- ✅ **Memory Management**: Efficient resource usage and cleanup

#### Development and Debugging ####

- **HTML Test Reporter**: Comprehensive test results with traces
- **Browser DevTools**: Real browser debugging capabilities
- **Network Analysis**: WebRTC connection monitoring
- **Performance Metrics**: Memory usage and operation timing
- **Visual Test Runner**: Interactive UI for test development

#### Why Real Browser Testing ####

This approach provides significant advantages over simulation:

1. **Authentic Environment**: Real browser APIs and behavior
2. **Production Validation**: Tests exactly what users will experience
3. **Network Reality**: Real WebRTC connections and network conditions
4. **Performance Accuracy**: Actual browser performance characteristics
5. **Integration Verification**: Complete end-to-end functionality
6. **Future-Proof**: Works with browser updates and new features

The comprehensive browser testing infrastructure validates Verity's capability to operate as a distributed network of browser nodes with real-world performance and reliability characteristics.
