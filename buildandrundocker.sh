#!/bin/bash
port="${1:-1984}"
docker kill verity$port
docker rm verity$port
docker build . -t verity$port
docker run -dit --name verity$port -p "$port":1984 -p "$port":1984/udp -p "$((port+1)):1985" -p "$((port+1)):1985/udp" verity$port npm run start -- -w 1984 -t -l "/ip4/0.0.0.0/tcp/1985/wss/" --pubaddr verity.hahn.mt
