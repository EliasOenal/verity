#!/bin/bash
port="${1:-1984}"
rsync -av . --delete --exclude node_modules/ --exclude cubes.db/ --exclude identity.db/ --exclude testidentity.db/ -e 'ssh -p 10045' verity@verity.hahn.mt:/home/verity/verity/
ssh -p 10045 verity@verity.hahn.mt "cd verity; ./buildandrundocker.sh $port"

