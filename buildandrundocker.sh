#!/bin/bash
docker kill verity
docker rm verity
docker build . -t verity
docker run -d --name verity -p 1984:1984 -p 1984:1984/udp verity
