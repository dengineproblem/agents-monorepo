#!/bin/bash
# Load environment variables from .env.agent
set -a
source ../../.env.agent
set +a

# Start agent-service
node dist/server.js








