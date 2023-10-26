import { Multiaddr, multiaddr } from '@multiformats/multiaddr'
import * as ma from '@multiformats/multiaddr'
import * as mp from '@multiformats/multiaddr/protocols-table'

const addr = multiaddr("/ip4/0.0.0.0/tcp/1985/wss");
console.log("addr: " + addr.toString());

const reduced = addr.decapsulateCode(mp.getProtocol('wss').code);
console.log("reduced: " + reduced.toString());
console.log("reduced===addr: " + reduced===addr);

const redundant = reduced.decapsulateCode(mp.getProtocol('wss').code);
console.log("redundant: " + redundant.toString());
console.log("redundant===reduced: " + redundant===reduced);