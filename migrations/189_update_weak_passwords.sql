-- Migration 189: Update weak passwords (1111, 2222) to secure passwords
-- Date: 2026-02-04
-- Purpose: Security enhancement - replace weak passwords with strong random passwords

-- Update passwords for users with password '1111' or '2222'

UPDATE public.user_accounts SET password = 'Kp9m#vL2', updated_at = CURRENT_TIMESTAMP WHERE id = 'a83c7b38-e452-4a60-b58f-d0f199a0b476'::uuid;
UPDATE public.user_accounts SET password = 'Hj4r#mN9', updated_at = CURRENT_TIMESTAMP WHERE id = '7d847bfb-8aab-427f-b634-779c06f40cbf'::uuid;
UPDATE public.user_accounts SET password = 'Vz7p#kR3', updated_at = CURRENT_TIMESTAMP WHERE id = '1c406143-522b-451b-b5d4-d8a8dbbc025e'::uuid;
UPDATE public.user_accounts SET password = 'Nx8w#tB5', updated_at = CURRENT_TIMESTAMP WHERE id = 'b3c2670d-f79f-42e1-98f7-847fe3bab6f7'::uuid;
UPDATE public.user_accounts SET password = 'Qw6d#hG9', updated_at = CURRENT_TIMESTAMP WHERE id = 'a09342e3-1660-49c8-847f-9334f4e49ccf'::uuid;
UPDATE public.user_accounts SET password = 'Tz5j#pW8', updated_at = CURRENT_TIMESTAMP WHERE id = 'e4fad5cb-d456-44fb-8b6e-5fc484fd52ae'::uuid;
UPDATE public.user_accounts SET password = 'Lm9x#bK4', updated_at = CURRENT_TIMESTAMP WHERE id = '57ac5be3-b095-4a51-a1c0-6e2a2ab2d702'::uuid;
UPDATE public.user_accounts SET password = 'Rj3g#mQ8', updated_at = CURRENT_TIMESTAMP WHERE id = '3ebf276f-6c96-4e5d-8b78-6b2d062c3732'::uuid;
UPDATE public.user_accounts SET password = 'Bp7y#wS4', updated_at = CURRENT_TIMESTAMP WHERE id = '2cca28bc-a1ba-41f8-92f7-98085fb423de'::uuid;
UPDATE public.user_accounts SET password = 'Dh6k#pV9', updated_at = CURRENT_TIMESTAMP WHERE id = '8dbc057c-9933-43b4-b5b6-0d4fc40b0196'::uuid;
UPDATE public.user_accounts SET password = 'Fz4t#nW7', updated_at = CURRENT_TIMESTAMP WHERE id = 'c4146217-ed0e-4278-9e87-c63e628e1408'::uuid;
UPDATE public.user_accounts SET password = 'Gw8p#vB3', updated_at = CURRENT_TIMESTAMP WHERE id = 'debf5beb-e6cc-462c-9666-777fc920b97e'::uuid;
UPDATE public.user_accounts SET password = 'Yk5h#jS9', updated_at = CURRENT_TIMESTAMP WHERE id = 'c6a48fd2-f107-48c9-a0cc-7c16c08f7c15'::uuid;
UPDATE public.user_accounts SET password = 'Pm6v#kG4', updated_at = CURRENT_TIMESTAMP WHERE id = 'b3749db1-986f-4406-8562-08017eb1463b'::uuid;
UPDATE public.user_accounts SET password = 'Cj9n#tM5', updated_at = CURRENT_TIMESTAMP WHERE id = '79dce47f-dbea-4373-9ec4-9140ca54ec22'::uuid;
UPDATE public.user_accounts SET password = 'Vh7x#bR8', updated_at = CURRENT_TIMESTAMP WHERE id = '6a3d2dd7-a5d5-4361-a6c4-577ed288d2cd'::uuid;
UPDATE public.user_accounts SET password = 'Wz3k#jV6', updated_at = CURRENT_TIMESTAMP WHERE id = '86ab9bbf-aae8-411c-97b8-a8dfb55256ee'::uuid;
UPDATE public.user_accounts SET password = 'Jm8t#nS4', updated_at = CURRENT_TIMESTAMP WHERE id = '1a5e2090-1a7e-4e54-854c-d97190618cfa'::uuid;
UPDATE public.user_accounts SET password = 'Rx5b#pK9', updated_at = CURRENT_TIMESTAMP WHERE id = '0dab0c27-08ce-424a-a42d-c286b339e2c4'::uuid;
UPDATE public.user_accounts SET password = 'Nz6h#tW3', updated_at = CURRENT_TIMESTAMP WHERE id = '1204d1fb-c3be-4dfc-b3b7-21302c1b4542'::uuid;
UPDATE public.user_accounts SET password = 'Qj4w#vL7', updated_at = CURRENT_TIMESTAMP WHERE id = 'cd7e767a-358a-4b28-85a4-07aa7fcdce54'::uuid;
UPDATE public.user_accounts SET password = 'Gh9x#kT5', updated_at = CURRENT_TIMESTAMP WHERE id = '3e6d5349-6045-44de-a2c0-111b4fc9ed9a'::uuid;
UPDATE public.user_accounts SET password = 'Lk7p#nR4', updated_at = CURRENT_TIMESTAMP WHERE id = 'b67aa573-65d6-4180-9b01-2c5bf5c0fd47'::uuid;
UPDATE public.user_accounts SET password = 'Tz6j#mQ9', updated_at = CURRENT_TIMESTAMP WHERE id = 'f1681710-9719-4437-b9a2-d49f73f6b75e'::uuid;
UPDATE public.user_accounts SET password = 'Dm3w#bN8', updated_at = CURRENT_TIMESTAMP WHERE id = 'f70d452a-dbb1-4aad-a590-cbf32ca84ee1'::uuid;
UPDATE public.user_accounts SET password = 'Fh8k#vG4', updated_at = CURRENT_TIMESTAMP WHERE id = '36f011b1-0ae7-4b9d-aaee-c979a295ed11'::uuid;
UPDATE public.user_accounts SET password = 'Vw5m#tL6', updated_at = CURRENT_TIMESTAMP WHERE id = '00ca328d-5225-4ba6-ad43-0f658024f629'::uuid;
UPDATE public.user_accounts SET password = 'Pb9y#kW3', updated_at = CURRENT_TIMESTAMP WHERE id = '7902e814-fe7b-4bfd-a8d1-ebc6ba005929'::uuid;
UPDATE public.user_accounts SET password = 'Xj4t#pG8', updated_at = CURRENT_TIMESTAMP WHERE id = '206f52f5-f7e5-44ec-8c91-5bbf89cdff31'::uuid;
UPDATE public.user_accounts SET password = 'Kz7h#vS5', updated_at = CURRENT_TIMESTAMP WHERE id = '83caf9a1-e071-4068-84cc-26baa1f0a234'::uuid;
UPDATE public.user_accounts SET password = 'Rw6x#bT9', updated_at = CURRENT_TIMESTAMP WHERE id = '2f7c240b-b4c0-4814-bd8b-6c4978dc412e'::uuid;
UPDATE public.user_accounts SET password = 'Yw3j#kV7', updated_at = CURRENT_TIMESTAMP WHERE id = '9313ec99-a2a9-4d36-94d4-26d42db679e8'::uuid;
UPDATE public.user_accounts SET password = 'Nh8p#tG4', updated_at = CURRENT_TIMESTAMP WHERE id = 'a8b8ea56-3bac-4ad9-bc0a-529014332994'::uuid;
UPDATE public.user_accounts SET password = 'Cq5x#bS9', updated_at = CURRENT_TIMESTAMP WHERE id = 'f8f03b16-cc6b-49c4-b31f-123ce0962567'::uuid;
UPDATE public.user_accounts SET password = 'Gm9j#pK3', updated_at = CURRENT_TIMESTAMP WHERE id = 'e59df629-e141-4990-b978-f7b2f32c7239'::uuid;
UPDATE public.user_accounts SET password = 'Tz4w#vL8', updated_at = CURRENT_TIMESTAMP WHERE id = '0bdf644f-34cc-4f55-92cc-82fda94f1f1b'::uuid;

-- Verify the updates
SELECT
    username,
    CASE
        WHEN password IN ('1111', '2222') THEN 'WEAK PASSWORD STILL EXISTS'
        ELSE 'Password updated'
    END as password_status,
    updated_at
FROM public.user_accounts
WHERE id IN (
    'a83c7b38-e452-4a60-b58f-d0f199a0b476',
    '7d847bfb-8aab-427f-b634-779c06f40cbf',
    '1c406143-522b-451b-b5d4-d8a8dbbc025e',
    'b3c2670d-f79f-42e1-98f7-847fe3bab6f7',
    'a09342e3-1660-49c8-847f-9334f4e49ccf',
    'e4fad5cb-d456-44fb-8b6e-5fc484fd52ae',
    '57ac5be3-b095-4a51-a1c0-6e2a2ab2d702',
    '3ebf276f-6c96-4e5d-8b78-6b2d062c3732',
    '2cca28bc-a1ba-41f8-92f7-98085fb423de',
    '8dbc057c-9933-43b4-b5b6-0d4fc40b0196',
    'c4146217-ed0e-4278-9e87-c63e628e1408',
    'debf5beb-e6cc-462c-9666-777fc920b97e',
    'c6a48fd2-f107-48c9-a0cc-7c16c08f7c15',
    'b3749db1-986f-4406-8562-08017eb1463b',
    '79dce47f-dbea-4373-9ec4-9140ca54ec22',
    '6a3d2dd7-a5d5-4361-a6c4-577ed288d2cd',
    '86ab9bbf-aae8-411c-97b8-a8dfb55256ee',
    '1a5e2090-1a7e-4e54-854c-d97190618cfa',
    '0dab0c27-08ce-424a-a42d-c286b339e2c4',
    '1204d1fb-c3be-4dfc-b3b7-21302c1b4542',
    'cd7e767a-358a-4b28-85a4-07aa7fcdce54',
    '3e6d5349-6045-44de-a2c0-111b4fc9ed9a',
    'b67aa573-65d6-4180-9b01-2c5bf5c0fd47',
    'f1681710-9719-4437-b9a2-d49f73f6b75e',
    'f70d452a-dbb1-4aad-a590-cbf32ca84ee1',
    '36f011b1-0ae7-4b9d-aaee-c979a295ed11',
    '00ca328d-5225-4ba6-ad43-0f658024f629',
    '7902e814-fe7b-4bfd-a8d1-ebc6ba005929',
    '206f52f5-f7e5-44ec-8c91-5bbf89cdff31',
    '83caf9a1-e071-4068-84cc-26baa1f0a234',
    '2f7c240b-b4c0-4814-bd8b-6c4978dc412e',
    '9313ec99-a2a9-4d36-94d4-26d42db679e8',
    'a8b8ea56-3bac-4ad9-bc0a-529014332994',
    'f8f03b16-cc6b-49c4-b31f-123ce0962567',
    'e59df629-e141-4990-b978-f7b2f32c7239',
    '0bdf644f-34cc-4f55-92cc-82fda94f1f1b'
)
ORDER BY username;
