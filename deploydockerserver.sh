#!/bin/bash
rsync -av . --exclude node_modules/ -e 'ssh -p 10045' verity@verity.hahn.mt:/home/verity/verity/
ssh verity@docker 'cd verity; ./buildandrundocker.sh'

