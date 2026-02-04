#!/usr/bin/env ts-node

/**
 * Script to send password reset notifications to users via Telegram
 *
 * This script:
 * 1. Reads the password reset data from password_reset_data.json
 * 2. Sends a Telegram message to each user with their new password
 * 3. Handles multiple telegram IDs per user (telegram_id, telegram_id_2, telegram_id_3, telegram_id_4)
 *
 * Usage: ts-node scripts/send_password_reset_notifications.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// Telegram Bot Configuration
const TELEGRAM_BOT_TOKEN = '8584683514:AAHzoE31UbNNCDexse9hYeJQLWT9Ay2pBhE';
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

interface UserPasswordData {
  id: string;
  username: string;
  old_password: string;
  new_password: string;
  telegram_id: string | null;
  telegram_id_2: string | null;
  telegram_id_3: string | null;
  telegram_id_4: string | null;
}

interface SendResult {
  username: string;
  telegram_id: string;
  success: boolean;
  error?: string;
}

/**
 * Send a message via Telegram Bot API
 */
async function sendTelegramMessage(chatId: string, text: string): Promise<boolean> {
  try {
    const response = await fetch(`${TELEGRAM_API_URL}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown',
      }),
    });

    const data = await response.json();

    if (!data.ok) {
      console.error(`Failed to send message to ${chatId}:`, data.description);
      return false;
    }

    return true;
  } catch (error) {
    console.error(`Error sending message to ${chatId}:`, error);
    return false;
  }
}

/**
 * Format the message text for a user
 */
function formatMessage(username: string, newPassword: string): string {
  return `В целях безопасности мы поменяли ваш пароль на более надежный:

\`${newPassword}\`

не показывайте его никому, даже сотрудникам performante.ai

Техподдержка переехала в [бот техподдержки](https://t.me/Moltbot_prfmnt_bot)`;
}

/**
 * Send notifications to all users
 */
async function sendNotifications(): Promise<void> {
  // Read password data
  const dataPath = path.join(__dirname, '..', 'password_reset_data.json');
  const rawData = fs.readFileSync(dataPath, 'utf-8');
  const users: UserPasswordData[] = JSON.parse(rawData);

  console.log(`\nLoaded ${users.length} users from password_reset_data.json\n`);

  const results: SendResult[] = [];
  let totalSent = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  // Process each user
  for (const user of users) {
    const telegramIds = [
      user.telegram_id,
      user.telegram_id_2,
      user.telegram_id_3,
      user.telegram_id_4,
    ].filter(id => id !== null) as string[];

    if (telegramIds.length === 0) {
      console.log(`⊘ Skipping ${user.username} - no telegram_id`);
      totalSkipped++;
      continue;
    }

    const message = formatMessage(user.username, user.new_password);

    // Send to all telegram IDs for this user
    for (const telegramId of telegramIds) {
      console.log(`→ Sending to ${user.username} (${telegramId})...`);

      const success = await sendTelegramMessage(telegramId, message);

      results.push({
        username: user.username,
        telegram_id: telegramId,
        success,
      });

      if (success) {
        console.log(`✓ Sent to ${user.username} (${telegramId})`);
        totalSent++;
      } else {
        console.log(`✗ Failed to send to ${user.username} (${telegramId})`);
        totalFailed++;
      }

      // Rate limiting: wait 100ms between messages to avoid hitting Telegram API limits
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('Summary:');
  console.log('='.repeat(60));
  console.log(`Total users: ${users.length}`);
  console.log(`Messages sent: ${totalSent}`);
  console.log(`Messages failed: ${totalFailed}`);
  console.log(`Users skipped (no telegram_id): ${totalSkipped}`);
  console.log('='.repeat(60));

  // Print failed sends
  const failed = results.filter(r => !r.success);
  if (failed.length > 0) {
    console.log('\nFailed sends:');
    failed.forEach(f => {
      console.log(`- ${f.username} (${f.telegram_id})`);
    });
  }

  // Save results to file
  const resultsPath = path.join(__dirname, '..', 'password_reset_results.json');
  fs.writeFileSync(resultsPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    summary: {
      total_users: users.length,
      messages_sent: totalSent,
      messages_failed: totalFailed,
      users_skipped: totalSkipped,
    },
    results,
  }, null, 2));

  console.log(`\nResults saved to: ${resultsPath}`);
}

// Run the script
if (require.main === module) {
  sendNotifications()
    .then(() => {
      console.log('\n✓ Done!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n✗ Error:', error);
      process.exit(1);
    });
}

export { sendNotifications };
