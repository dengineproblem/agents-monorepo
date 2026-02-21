#!/bin/bash
set -e

# OpenClaw gateway binds to 127.0.0.1:18789 (hardcoded, no config to change).
# socat exposes it on 0.0.0.0:18790 so Docker port mapping works.

# Start gateway in background
openclaw gateway &
GATEWAY_PID=$!

# Wait for gateway to start listening
for i in $(seq 1 30); do
  if curl -s -o /dev/null http://127.0.0.1:18789 2>/dev/null; then
    break
  fi
  sleep 1
done

# Forward external connections to gateway
socat TCP-LISTEN:18790,bind=0.0.0.0,reuseaddr,fork TCP:127.0.0.1:18789 &
SOCAT_PID=$!

echo "OpenClaw gateway running on 127.0.0.1:18789"
echo "socat forwarding 0.0.0.0:18790 → 127.0.0.1:18789"

# Wait for either process to exit
wait -n $GATEWAY_PID $SOCAT_PID
