#!/bin/sh
set -e

echo "Git config:"
cat ~/.gitconfig

# Copy moltbot.json config to working directory
mkdir -p /root/clawd/.moltbot
cp /root/clawd/moltbot-workspace-router/moltbot.json /root/clawd/.moltbot/config.json

# Replace environment variables in config
if [ -n "$MOLTBOT_TELEGRAM_BOT_TOKEN" ]; then
  sed -i "s/\${MOLTBOT_TELEGRAM_BOT_TOKEN}/$MOLTBOT_TELEGRAM_BOT_TOKEN/g" /root/clawd/.moltbot/config.json
  echo "  ✓ Telegram bot token injected into config"
fi

echo "Moltbot config copied to /root/clawd/.moltbot/config.json"

# Setup auth profiles for ALL agents (router + specialists)
echo "Setting up auth profiles for all agents..."
for agent in router facebook-ads creatives crm tiktok onboarding; do
  mkdir -p "/root/clawd/.moltbot/agents/$agent/agent"
  echo "{\"profiles\":[{\"id\":\"openai\",\"provider\":\"openai\",\"apiKey\":\"$OPENAI_API_KEY\",\"model\":\"gpt-5.2\",\"default\":true},{\"id\":\"anthropic\",\"provider\":\"anthropic\",\"apiKey\":\"$ANTHROPIC_API_KEY\"}],\"whisper\":{\"provider\":\"openai\",\"model\":\"gpt-4o\"}}" > "/root/clawd/.moltbot/agents/$agent/agent/auth-profiles.json"
  echo "  ✓ Auth profile created for agent: $agent"
done
echo "Auth profiles configured: GPT-5.2 (default), Anthropic (fallback), Whisper (gpt-4o)"

# Start Moltbot Gateway with multi-agent routing
echo "Starting Moltbot Gateway with multi-agent routing..."
exec moltbot gateway --bind lan --token "moltbot-dev-token-2026" --allow-unconfigured --verbose
