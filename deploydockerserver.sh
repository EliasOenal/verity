#!/bin/bash
port="${1:-1984}"
rsync -av . --exclude node_modules/ -e 'ssh -p 10045' verity@verity.hahn.mt:/home/verity/verity/
ssh -p 10045 verity@verity.hahn.mt "cd verity; ./buildandrundocker.sh $port"

