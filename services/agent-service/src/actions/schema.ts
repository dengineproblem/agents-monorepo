import { z } from 'zod';

export const AccountSchema = z.object({
  userAccountId: z.string().uuid().nullish(),
  adAccountId: z.string().min(5).nullish(),
  accessToken: z.string().min(10).nullish(),
  whatsappPhoneNumber: z.string().nullish(), // WhatsApp phone number from Supabase
  accountId: z.string().uuid().nullish(), // UUID из ad_accounts для мультиаккаунтного режима
  pageId: z.string().nullish(), // Facebook Page ID
}).refine(
  (data) => Boolean(data.accessToken || data.userAccountId),
  { message: 'Either accessToken or userAccountId must be provided' }
);

// Универсальная схема под манифестные типы
export const ActionSchema = z.object({
  type: z.string().min(2),
  params: z.record(z.any())
});
export type ActionInput = z.infer<typeof ActionSchema>;

export const ActionsEnvelope = z.object({
  idempotencyKey: z.string().min(5),
  account: AccountSchema,
  actions: z.array(ActionSchema).min(0), // Разрешаем пустой массив для reportOnlyMode и случаев когда действия не нужны
  source: z.string().optional(),
});
export type ActionsEnvelope = z.infer<typeof ActionsEnvelope>;
