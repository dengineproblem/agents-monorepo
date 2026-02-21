FROM node:22-slim

# Install system deps: git (npm deps), psql (DB access), curl (Facebook API)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git postgresql-client curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Skip node-llama-cpp native build — we use Anthropic API, not local LLMs
ENV NODE_LLAMA_CPP_SKIP_DOWNLOAD=true

# Install OpenClaw globally
RUN npm install -g --ignore-scripts openclaw@2026.2.17

# Run postinstall for everything except node-llama-cpp
RUN cd /usr/local/lib/node_modules/openclaw && npm rebuild --ignore-scripts 2>/dev/null; true

# Create non-root user
RUN useradd -m -d /home/openclaw openclaw
USER openclaw
WORKDIR /home/openclaw

# Pre-create config directory
RUN mkdir -p .openclaw/workspace

EXPOSE 18789

CMD ["openclaw", "gateway"]
