#!/bin/bash
# Script to apply Evolution API Facebook Ad metadata patch on server

set -e

echo "🚀 Applying Evolution API Facebook Ad Metadata Patch"
echo "===================================================="

# Navigate to Evolution API directory
cd /root/evolution-api

echo "✅ Creating backup..."
cp src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts.backup-$(date +%Y%m%d-%H%M%S)

echo "✅ Applying patch..."

# Add the extraction call after prepareMessage (line 1186)
sed -i '1186a\
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
' src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts

# Add the extractAdMetadata function before the last closing brace
LINE_NUM=$(grep -n '^}$' src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts | tail -1 | cut -d: -f1)

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
" src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts

echo "✅ Patch applied successfully!"
echo ""
echo "📋 Next steps:"
echo "1. Build Docker image: docker build -t atendai/evolution-api:2.3.6-ad-metadata ."
echo "2. Update docker-compose.yml in agents-monorepo"
echo "3. Restart Evolution API container"



