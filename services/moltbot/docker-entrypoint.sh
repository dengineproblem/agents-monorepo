#!/bin/sh
set -e

echo "Git config:"
cat ~/.gitconfig

# Setup moltbot directory
mkdir -p /root/.moltbot

# Copy multi-agent config template
echo "Setting up multi-agent configuration..."
cp /root/clawd/moltbot-config-template.json /root/.moltbot/moltbot.json

# Replace environment variables in config
if [ -n "$MOLTBOT_TELEGRAM_BOT_TOKEN" ]; then
  sed -i "s/\${MOLTBOT_TELEGRAM_BOT_TOKEN}/$MOLTBOT_TELEGRAM_BOT_TOKEN/g" /root/.moltbot/moltbot.json
  echo "  ✓ Telegram bot token injected"
fi

echo "  ✓ Multi-agent config ready (6 agents: router, facebook-ads, creatives, crm, tiktok, onboarding)"

# Setup auth profiles for ALL agents
echo "Setting up auth profiles for all agents..."
for agent in router facebook-ads creatives crm tiktok onboarding; do
  mkdir -p "/root/.moltbot/agents/$agent/agent"
  echo "{\"profiles\":[{\"id\":\"openai\",\"provider\":\"openai\",\"apiKey\":\"$OPENAI_API_KEY\",\"model\":\"gpt-5.2\",\"default\":true},{\"id\":\"anthropic\",\"provider\":\"anthropic\",\"apiKey\":\"$ANTHROPIC_API_KEY\"}],\"whisper\":{\"provider\":\"openai\",\"model\":\"gpt-4o\"}}" > "/root/.moltbot/agents/$agent/agent/auth-profiles.json"
done
echo "  ✓ Auth profiles configured for all 6 agents"

# Start Moltbot Gateway with multi-agent routing
echo "Starting Moltbot Gateway with multi-agent routing..."
exec moltbot gateway --bind lan --token "moltbot-dev-token-2026" --verbose
