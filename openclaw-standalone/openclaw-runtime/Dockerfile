FROM node:22-slim

# Install system deps: git (npm deps), psql (DB access), curl (Facebook API),
# socat (forward 0.0.0.0 → 127.0.0.1 because openclaw binds localhost only)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git postgresql-client curl ca-certificates socat \
    && rm -rf /var/lib/apt/lists/*

# Skip node-llama-cpp native build — we use Anthropic API, not local LLMs
ENV NODE_LLAMA_CPP_SKIP_DOWNLOAD=true

# Install OpenClaw globally
RUN npm install -g --ignore-scripts openclaw@2026.2.17

# Run postinstall for everything except node-llama-cpp
RUN cd /usr/local/lib/node_modules/openclaw && npm rebuild --ignore-scripts 2>/dev/null; true

# Create non-root user (node:22-slim already has 'node' at UID 1000, so openclaw gets 1001)
RUN useradd -m -d /home/openclaw -u 1001 openclaw

# Copy entrypoint
COPY --chown=openclaw:openclaw entrypoint.sh /home/openclaw/entrypoint.sh
RUN chmod +x /home/openclaw/entrypoint.sh

# Copy WhatsApp hook and CAPI scripts
COPY --chown=openclaw:openclaw scripts/wa-message-hook.js /home/openclaw/scripts/wa-message-hook.js
COPY --chown=openclaw:openclaw scripts/send-capi.sh /home/openclaw/scripts/send-capi.sh
RUN chmod +x /home/openclaw/scripts/send-capi.sh

USER openclaw
WORKDIR /home/openclaw

# Pre-create config directory
RUN mkdir -p .openclaw/workspace

# socat exposes gateway on 0.0.0.0:18790 → 127.0.0.1:18789
EXPOSE 18790

ENTRYPOINT ["/home/openclaw/entrypoint.sh"]
