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

## Building and Running ##
```
npm run build
npm run start -- -w 1984 -t
```

## Building the Web Node ##
```
npm run webpack
```
Then open `distweb/index.html` in a browser. Or alternatively directly spawn a web server with:
```
npm run webpack serve
```

## Tests ##
```
npm test
```
