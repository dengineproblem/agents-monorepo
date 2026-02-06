create table if not exists public.robokassa_payments (
  id uuid not null default gen_random_uuid (),
  payment_id uuid not null,
  user_account_id uuid not null,
  plan_slug text not null,
  months integer not null,
  amount numeric(10, 2) not null,
  out_sum numeric(10, 2) not null,
  inv_id text not null,
  signature text null,
  status text not null default 'applied',
  processed_at timestamp with time zone null default now(),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  constraint robokassa_payments_pkey primary key (id),
  constraint robokassa_payments_payment_id_key unique (payment_id),
  constraint robokassa_payments_user_account_id_fkey foreign key (user_account_id) references user_accounts (id) on delete cascade
) tablespace pg_default;

create index if not exists idx_robokassa_payments_user on public.robokassa_payments using btree (user_account_id) tablespace pg_default;
create index if not exists idx_robokassa_payments_plan on public.robokassa_payments using btree (plan_slug) tablespace pg_default;

create or replace function public.apply_robokassa_payment(
  p_payment_id uuid,
  p_user_account_id uuid,
  p_plan_slug text,
  p_months integer,
  p_amount numeric,
  p_out_sum numeric,
  p_inv_id text,
  p_signature text,
  p_payload jsonb,
  p_new_tarif text,
  p_new_tarif_expires date
) returns boolean
language plpgsql
as $$
declare
  inserted boolean;
begin
  insert into public.robokassa_payments (
    payment_id,
    user_account_id,
    plan_slug,
    months,
    amount,
    out_sum,
    inv_id,
    signature,
    payload,
    status,
    processed_at
  )
  values (
    p_payment_id,
    p_user_account_id,
    p_plan_slug,
    p_months,
    p_amount,
    p_out_sum,
    p_inv_id,
    p_signature,
    coalesce(p_payload, '{}'::jsonb),
    'applied',
    now()
  )
  on conflict (payment_id) do nothing
  returning true into inserted;

  if inserted is distinct from true then
    return false;
  end if;

  update public.user_accounts
    set tarif = p_new_tarif,
        tarif_expires = p_new_tarif_expires,
        tarif_renewal_cost = p_amount,
        is_active = true
  where id = p_user_account_id;

  if not found then
    raise exception 'User account not found for robokassa payment';
  end if;

  return true;
end;
$$;
