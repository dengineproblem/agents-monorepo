-- Subscription Bot: таблица подписок и RPC для обработки платежей

create table if not exists public.bot_subscriptions (
  id uuid not null default gen_random_uuid(),
  telegram_id bigint not null,
  user_account_id uuid not null,
  channel_status text not null default 'none',
  last_invite_link text,
  last_invite_at timestamp with time zone,
  current_plan_slug text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),

  constraint bot_subscriptions_pkey primary key (id),
  constraint bot_subscriptions_telegram_id_key unique (telegram_id),
  constraint bot_subscriptions_user_account_id_fkey foreign key (user_account_id)
    references user_accounts(id) on delete cascade,
  constraint bot_subscriptions_channel_status_check
    check (channel_status in ('none', 'invited', 'active', 'kicked'))
);

create index if not exists idx_bot_subscriptions_user on public.bot_subscriptions using btree (user_account_id);
create index if not exists idx_bot_subscriptions_channel_status on public.bot_subscriptions using btree (channel_status);

-- Auto-update updated_at
create or replace function public.bot_subscriptions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_bot_subscriptions_updated_at on public.bot_subscriptions;
create trigger trg_bot_subscriptions_updated_at
  before update on public.bot_subscriptions
  for each row execute function public.bot_subscriptions_updated_at();

-- Atomic RPC: create/update user + subscription + payment record
create or replace function public.apply_bot_subscription_payment(
  p_telegram_id bigint,
  p_payment_id uuid,
  p_plan_slug text,
  p_months integer,
  p_amount numeric,
  p_out_sum numeric,
  p_inv_id text,
  p_signature text,
  p_payload jsonb,
  p_new_tarif text,
  p_new_tarif_expires date
) returns jsonb
language plpgsql
as $$
declare
  v_user_account_id uuid;
  v_is_new_user boolean := false;
  v_inserted boolean;
begin
  -- 1. Check if subscription exists for this telegram_id
  select user_account_id into v_user_account_id
  from public.bot_subscriptions
  where telegram_id = p_telegram_id;

  -- 2. If no subscription — create user_account + bot_subscription
  if v_user_account_id is null then
    v_is_new_user := true;

    insert into public.user_accounts (
      id, telegram_id, tarif, tarif_expires, tarif_renewal_cost,
      is_active, multi_account_enabled, created_at, updated_at
    ) values (
      gen_random_uuid(),
      p_telegram_id::text,
      p_new_tarif,
      p_new_tarif_expires,
      p_amount,
      true,
      true,
      now(),
      now()
    )
    returning id into v_user_account_id;

    insert into public.bot_subscriptions (
      telegram_id, user_account_id, current_plan_slug
    ) values (
      p_telegram_id, v_user_account_id, p_plan_slug
    );
  else
    -- 3. Existing user — update tarif
    update public.user_accounts
    set tarif = p_new_tarif,
        tarif_expires = p_new_tarif_expires,
        tarif_renewal_cost = p_amount,
        is_active = true
    where id = v_user_account_id;

    update public.bot_subscriptions
    set current_plan_slug = p_plan_slug
    where telegram_id = p_telegram_id;
  end if;

  -- 4. Record payment (idempotent)
  insert into public.robokassa_payments (
    payment_id, user_account_id, plan_slug, months,
    amount, out_sum, inv_id, signature, payload,
    status, processed_at
  ) values (
    p_payment_id, v_user_account_id, p_plan_slug, p_months,
    p_amount, p_out_sum, p_inv_id, p_signature,
    coalesce(p_payload, '{}'::jsonb),
    'applied', now()
  )
  on conflict (payment_id) do nothing
  returning true into v_inserted;

  -- If duplicate payment — return without changes
  if v_inserted is distinct from true and not v_is_new_user then
    return jsonb_build_object(
      'user_account_id', v_user_account_id,
      'is_new_user', false,
      'duplicate', true
    );
  end if;

  return jsonb_build_object(
    'user_account_id', v_user_account_id,
    'is_new_user', v_is_new_user,
    'duplicate', false
  );
end;
$$;
