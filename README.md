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

## Quick Start

### For Application Developers

If you want to build applications on top of Verity:

1. **Install Verity as a dependency:**
   ```bash
   npm install verity
   ```

2. **Create a simple application:**
   ```javascript
   // Note: This is a conceptual example showing the intended API usage
   // For working examples, see the included applications in src/app/
   import { VerityNode, Identity, makePost } from 'verity';
   
   // Create a Verity node
   const node = await VerityNode.Create({ inMemory: true });
   
   // Create an identity
   const identity = await Identity.Create();
   
   // Make a post
   const post = await makePost("Hello Verity!", { id: identity });
   await node.cubeStore.addCube(post);
   ```

3. **See more examples:** Check out the [Developer Guide](doc/developer-guide.md) and [API Reference](doc/api-reference.md).

### For Network Operators and Developers

To run the included applications or contribute to Verity development:

#### Installing Dependencies
```bash
npm install
```

#### Building and Running the Microblogging Web App
```bash
npm run build
npm run webpack
```
Then open `distweb/index.html` in a browser. Or alternatively start a development server:
```bash
npm run server
```
Open http://localhost:11984/ in your browser.

#### Running a Support Node
Support nodes help maintain the Verity network. End-users typically don't need this.
```bash
npm run build
npm run start -- -w 1984 -t
```

#### Running Tests
```bash
npm test
```

## Documentation

- **[Developer Guide](doc/developer-guide.md)** - Get started building applications
- **[API Reference](doc/api-reference.md)** - Complete API documentation
- **[Technical Specifications](doc/verity.md)** - Detailed technical documentation
- **[Common Cube Interface](doc/cci.md)** - Data format specifications
- **[Example Applications](examples/)** - Working examples and tutorials
