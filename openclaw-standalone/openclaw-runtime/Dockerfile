FROM node:22-slim

# Install system deps:
#   git, cmake, make, g++ — needed by node-llama-cpp (openclaw dep)
#   postgresql-client — psql for direct DB access
#   curl — for Facebook API calls
RUN apt-get update && apt-get install -y --no-install-recommends \
    git cmake make g++ postgresql-client curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install OpenClaw globally
RUN npm install -g openclaw@2026.2.17

# Create non-root user
RUN useradd -m -d /home/openclaw openclaw
USER openclaw
WORKDIR /home/openclaw

# Pre-create config directory
RUN mkdir -p .openclaw/workspace

EXPOSE 18789

CMD ["openclaw", "gateway"]
