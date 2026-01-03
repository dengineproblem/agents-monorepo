#!/bin/bash
# Script to apply Evolution API Facebook Ad metadata patch on server
# Works with Evolution API 2.3.6 and 2.3.7

set -e

echo "🚀 Applying Evolution API Facebook Ad Metadata Patch"
echo "===================================================="

# Navigate to Evolution API directory
EVOLUTION_DIR="${1:-/root/evolution-api-official}"
cd "$EVOLUTION_DIR"

echo "📁 Working directory: $EVOLUTION_DIR"

# Find the correct line number for prepareMessage
BAILEYS_FILE="src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts"
PREPARE_LINE=$(grep -n "const messageRaw = this.prepareMessage(received);" "$BAILEYS_FILE" | head -1 | cut -d: -f1)

if [ -z "$PREPARE_LINE" ]; then
    echo "❌ Could not find prepareMessage line"
    exit 1
fi

echo "✅ Found prepareMessage at line $PREPARE_LINE"

echo "✅ Creating backup..."
cp "$BAILEYS_FILE" "${BAILEYS_FILE}.backup-$(date +%Y%m%d-%H%M%S)"

echo "✅ Applying patch..."

# Add the extraction call after prepareMessage
sed -i "${PREPARE_LINE}a\\
\
          // Extract Facebook Ad metadata and add to messageRaw.key\
          const adMetadata = this.extractAdMetadata(received);\
          if (adMetadata) {\
            messageRaw.key.sourceId = adMetadata.sourceId;\
            messageRaw.key.sourceType = adMetadata.sourceType;\
            messageRaw.key.sourceUrl = adMetadata.sourceUrl;\
            messageRaw.key.mediaUrl = adMetadata.mediaUrl;\
            messageRaw.key.showAdAttribution = adMetadata.showAdAttribution;\
            this.logger.info(\`Facebook Ad detected: sourceId=\${adMetadata.sourceId}, sourceUrl=\${adMetadata.sourceUrl}\`);\
          }\
" "$BAILEYS_FILE"

# Add the extractAdMetadata function before the last closing brace
LINE_NUM=$(grep -n '^}$' "$BAILEYS_FILE" | tail -1 | cut -d: -f1)

echo "✅ Adding extractAdMetadata function at line $LINE_NUM"

sed -i "${LINE_NUM}i\\
\\
  /**\\
   * Extract Facebook Ad metadata from WhatsApp message\\
   * Extracts sourceId, sourceUrl, and other ad attribution data from extendedTextMessage\\
   */\\
  private extractAdMetadata(message: WAMessage): {\\
    sourceId: string | null;\\
    sourceType: string;\\
    sourceUrl: string | null;\\
    mediaUrl: string | null;\\
    title: string | null;\\
    showAdAttribution: boolean;\\
  } | null {\\
    try {\\
      const extMsg = message.message?.extendedTextMessage;\\
      if (!extMsg) return null;\\
\\
      // Check for external ad reply (main source of ad metadata)\\
      const contextInfo = extMsg.contextInfo as any;\\
      const adReply = contextInfo?.externalAdReply;\\
      \\
      if (adReply && (adReply.sourceId || adReply.sourceUrl)) {\\
        return {\\
          sourceId: adReply.sourceId || null,\\
          sourceType: adReply.sourceType || 'ad',\\
          sourceUrl: adReply.sourceUrl || null,\\
          mediaUrl: adReply.mediaUrl || null,\\
          title: adReply.title || null,\\
          showAdAttribution: true,\\
        };\\
      }\\
\\
      // Check for showAdAttribution flag\\
      if (contextInfo?.showAdAttribution) {\\
        return {\\
          sourceId: contextInfo?.stanzaId || null,\\
          sourceType: 'ad',\\
          sourceUrl: null,\\
          mediaUrl: null,\\
          title: null,\\
          showAdAttribution: true,\\
        };\\
      }\\
\\
      return null;\\
    } catch (error) {\\
      this.logger.warn(\\\`Error extracting ad metadata: \\\${error.message}\\\`);\\
      return null;\\
    }\\
  }\\
" "$BAILEYS_FILE"

echo "✅ Patch applied successfully!"
echo ""
echo "📋 Next steps:"
echo "1. Build Docker image: docker build -t atendai/evolution-api:2.3.7-patched ."
echo "2. Update docker-compose.yml: sed -i 's/2.3.6-patched/2.3.7-patched/' /root/agents-monorepo/docker-compose.yml"
echo "3. Restart: cd /root/agents-monorepo && docker-compose up -d evolution-api"








