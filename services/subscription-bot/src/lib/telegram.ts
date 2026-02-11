import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config.js';
import { createLogger } from './logger.js';

const logger = createLogger({ module: 'telegram-helpers' });

export async function createInviteLink(bot: TelegramBot): Promise<string> {
  const result = await bot.createChatInviteLink(config.communityChannelId, {
    member_limit: 1,
    name: `sub-${Date.now()}`,
  });
  return result.invite_link;
}

export async function kickMember(bot: TelegramBot, telegramId: number): Promise<boolean> {
  try {
    // Ban then unban — kicks without permanent ban, allowing re-join later
    await bot.banChatMember(config.communityChannelId, telegramId);
    await bot.unbanChatMember(config.communityChannelId, telegramId, { only_if_banned: true });
    return true;
  } catch (err: any) {
    // User already left or was never in the channel
    if (err.message?.includes('user is not a member') || err.message?.includes('PARTICIPANT_NOT_FOUND')) {
      logger.warn({ telegramId }, 'User already not in channel');
      return true;
    }
    logger.error({ telegramId, error: err.message }, 'Failed to kick member');
    return false;
  }
}

export async function isMember(bot: TelegramBot, telegramId: number): Promise<boolean> {
  try {
    const member = await bot.getChatMember(config.communityChannelId, telegramId);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch {
    return false;
  }
}
