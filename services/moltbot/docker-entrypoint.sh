#!/bin/sh
set -e

echo "Git config:"
cat ~/.gitconfig

# Setup moltbot directory
mkdir -p /root/.moltbot

# Copy multi-agent config template
echo "Setting up Single-Workspace configuration..."
cp /root/clawd/moltbot-config-template.json /root/.moltbot/moltbot.json

# Replace environment variables in config
if [ -n "$MOLTBOT_TELEGRAM_BOT_TOKEN" ]; then
  sed -i "s/\${MOLTBOT_TELEGRAM_BOT_TOKEN}/$MOLTBOT_TELEGRAM_BOT_TOKEN/g" /root/.moltbot/moltbot.json
  echo "  ✓ Telegram bot token injected"
fi

echo "  ✓ Single-Workspace config ready: 1 router agent with 5 subagents (facebook-ads, creatives, crm, tiktok, onboarding)"

# Setup auth profile for router agent
echo "Setting up auth profile for router agent..."
mkdir -p "/root/.moltbot/agents/router/agent"
echo "{\"profiles\":[{\"id\":\"google\",\"provider\":\"google\",\"apiKey\":\"$GEMINI_API_KEY\",\"default\":true},{\"id\":\"openai\",\"provider\":\"openai\",\"apiKey\":\"$OPENAI_API_KEY\",\"model\":\"gpt-5.2\"},{\"id\":\"anthropic\",\"provider\":\"anthropic\",\"apiKey\":\"$ANTHROPIC_API_KEY\"}],\"whisper\":{\"provider\":\"openai\",\"model\":\"gpt-4o\"}}" > "/root/.moltbot/agents/router/agent/auth-profiles.json"
echo "  ✓ Auth profile configured for router agent"

# Start Moltbot Gateway with embedded router agent
echo "Starting Moltbot Gateway with embedded router agent..."
exec moltbot gateway --bind lan --token "moltbot-prod-token-2026" --verbose
