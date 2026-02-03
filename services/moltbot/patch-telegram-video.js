#!/usr/bin/env node
/**
 * Patch grammy to skip getFile() for video files > 20 MB
 *
 * This patches the Bot.prototype.handleUpdate method to:
 * 1. Detect video messages
 * 2. Skip getFile() call
 * 3. Add [File: video] file_id=XXX to message text instead
 */

const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function(id) {
  const module = originalRequire.apply(this, arguments);

  // Patch grammy Bot class
  if (id === 'grammy' && module.Bot) {
    console.log('[PATCH] Patching grammy Bot to handle video files');

    const OriginalBot = module.Bot;

    // Create wrapper class
    class PatchedBot extends OriginalBot {
      constructor(...args) {
        super(...args);

        // Store original handleUpdate
        const originalHandleUpdate = this.handleUpdate.bind(this);

        // Override handleUpdate to inject file_id BEFORE processing
        this.handleUpdate = async function(update, webhookReplyEnvelope) {
          // Check if this is a video message (either as video or document with video mime type)
          const video = update.message?.video;
          const document = update.message?.document;
          const isVideoDocument = document && document.mime_type?.startsWith('video/');

          if (video || isVideoDocument) {
            const mediaObject = video || document;
            const fileId = mediaObject.file_id;
            const fileSize = mediaObject.file_size;
            const fileName = mediaObject.file_name || 'video.mp4';
            const mediaType = video ? 'video' : 'document';

            console.log(`[PATCH] Video detected (as ${mediaType}): ${fileName} (${Math.round(fileSize / 1024 / 1024)} MB)`);
            console.log(`[PATCH] Injecting file_id into message for video upload`);

            // Inject [File: video] prefix with file_id
            const fileInfo = `[File: video] file_id=${fileId} file_name=${fileName} file_size=${fileSize}`;

            // For documents, add to caption if exists, otherwise to message text
            if (document) {
              if (!update.message.caption && !update.message.text) {
                update.message.text = fileInfo;
              } else if (update.message.caption) {
                update.message.caption = `${fileInfo}\n\n${update.message.caption}`;
              } else {
                update.message.text = `${fileInfo}\n\n${update.message.text}`;
              }
            } else {
              // For video type, inject into caption
              if (!update.message.caption) {
                update.message.caption = fileInfo;
              } else {
                update.message.caption = `${fileInfo}\n\n${update.message.caption}`;
              }
            }

            console.log(`[PATCH] Injected into ${document ? 'text/caption' : 'caption'}: ${fileInfo}`);
          }

          // Call original handleUpdate
          return originalHandleUpdate(update, webhookReplyEnvelope);
        };
      }
    }

    // Replace Bot with patched version
    module.Bot = PatchedBot;
    console.log('[PATCH] grammy Bot patched successfully');
  }

  return module;
};

console.log('[PATCH] Module require hook installed');

// Now load moltbot (async import because it's ESM with top-level await)
(async () => {
  await import('/usr/local/lib/node_modules/moltbot/moltbot.mjs');
})();
