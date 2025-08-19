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
```
npm test
```

### Browser Testing ###
Verity includes a comprehensive browser testing infrastructure to verify functionality in browser environments, including browser-specific features like IndexedDB and WebRTC. The tests simulate the goal of two browser nodes connected to one Node.js full node.

#### Running Browser Tests ####
```
npm run test:browser
```

#### Browser Testing Approach ####
We use a hybrid testing approach that combines:

- **Vitest with JSDOM**: For simulating browser environment with DOM APIs
- **fake-indexeddb**: For testing IndexedDB storage functionality
- **CoreNode with browser configuration**: Testing actual Verity nodes in browser mode
- **Multi-node scenarios**: Testing browser-to-browser and browser-to-server communication

#### Browser Test Coverage ####
- **Basic Node Functionality**: Creating and configuring browser CoreNodes
- **Storage Testing**: IndexedDB-based storage with fake-indexeddb simulation
- **Network Configuration**: WebRTC transport setup for browser environments
- **Multi-node Connectivity**: Multiple browser nodes connecting through a server node
- **Cube Operations**: Creating, storing, and retrieving cubes in browser context
- **Browser API Verification**: Confirming availability of IndexedDB, WebRTC, and crypto APIs

#### Why This Approach ####
We selected this approach over full browser automation (like Playwright/Puppeteer) because:

1. **Environment Independence**: Works in CI/CD environments without browser downloads
2. **Speed**: Faster test execution compared to real browser instances
3. **Reliability**: No network dependencies or browser version conflicts
4. **Focus**: Tests core Verity functionality rather than UI interactions
5. **Debugging**: Better debugging experience with standard Node.js tools

The test infrastructure demonstrates Verity's capability to run as browser nodes while maintaining full compatibility with the core protocol.
