![](img/vera_150px_nobg.png)

# Project Verity
This project aims to create a decentralized and censorship-resistant social networking platform akin to Twitter, Threads or Reddit. It leverages unique cube structures, each containing 1kB of data, which are then synchronized across participating nodes. To ensure data integrity and authenticity, posts are signed with user-specific cryptographic keys and utilize a hashcash challenge to mitigate spam. The platform supports 1:1 and 1:n encrypted messaging, protecting user privacy by minimizing metadata leakage and allowing secure, private communication between users. By offering a high degree of privacy, security, and resistance to censorship, this project offers a compelling alternative to traditional, centralized social networks.

Although light nodes are supported, nodes are encouraged to be operated as full nodes, replicating all cubes.

> Disclaimer: this project does not implement a cryptocurrency, nor does it resemble a blockchain.

## Installing Dependencies ##
```
npm install
```

## Building and Running ##
```
tsc
cd dist
node fullNode.js
```

## Building the Web Node ##
```
npm run webpack
```
Then open `distweb/index.html` in a browser.

## Tests ##
```
npm test
```
