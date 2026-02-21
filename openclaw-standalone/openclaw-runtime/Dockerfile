FROM node:22-alpine

# Install OpenClaw globally
RUN npm install -g openclaw@2026.2.17

# Install psql (for direct DB access) and curl (for Facebook API)
RUN apk add --no-cache postgresql16-client curl

# Create non-root user
RUN adduser -D -h /home/openclaw openclaw
USER openclaw
WORKDIR /home/openclaw

# Pre-create config directory
RUN mkdir -p .openclaw/workspace

EXPOSE 18789

CMD ["openclaw", "gateway"]
