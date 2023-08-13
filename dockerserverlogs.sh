#!/bin/bash
port="${1:-1984}"
ssh verity@docker "docker logs -f verity$port"

