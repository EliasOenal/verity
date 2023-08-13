#!/bin/bash
port="${1:-1984}"
ssh verity@docker "docker kill verity$port; docker rm verity$port"

