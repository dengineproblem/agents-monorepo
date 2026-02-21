FROM node:22-alpine

# Install system deps (git needed by openclaw npm deps, psql for DB, curl for Facebook API)
RUN apk add --no-cache git postgresql16-client curl

# Install OpenClaw globally
RUN npm install -g openclaw@2026.2.17

# Create non-root user
RUN adduser -D -h /home/openclaw openclaw
USER openclaw
WORKDIR /home/openclaw

# Pre-create config directory
RUN mkdir -p .openclaw/workspace

EXPOSE 18789

CMD ["openclaw", "gateway"]
