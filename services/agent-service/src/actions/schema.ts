import { z } from 'zod';

export const AccountSchema = z.object({
  userAccountId: z.string().uuid().optional(),
  adAccountId: z.string().min(5).optional(),
  accessToken: z.string().min(10).optional(),
  whatsappPhoneNumber: z.string().optional(), // WhatsApp phone number from Supabase
  accountId: z.string().uuid().optional(), // UUID из ad_accounts для мультиаккаунтного режима
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
