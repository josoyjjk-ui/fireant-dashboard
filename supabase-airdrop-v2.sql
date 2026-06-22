-- ANTINFO airdrop v2 migration
-- Write-only migration draft. Do not execute from Codex.

-- 1) airdrop_tasks: verification method for each mission.
ALTER TABLE public.airdrop_tasks
  ADD COLUMN IF NOT EXISTS verify_method text DEFAULT 'capture';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'airdrop_tasks_verify_method_check'
      AND conrelid = 'public.airdrop_tasks'::regclass
  ) THEN
    ALTER TABLE public.airdrop_tasks
      ADD CONSTRAINT airdrop_tasks_verify_method_check
      CHECK (verify_method IN ('onchain', 'telegram', 'capture'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS airdrop_tasks_active_sort_idx
  ON public.airdrop_tasks (status, sort_order, created_at DESC);

-- 2) profiles: one account can bind one EVM wallet, and each wallet is unique.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS wallet_address text;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_wallet_address_unique_idx
  ON public.profiles (wallet_address)
  WHERE wallet_address IS NOT NULL;

-- 3) raffle_winners: weekly winner records.
CREATE TABLE IF NOT EXISTS public.raffle_winners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start date,
  user_id uuid REFERENCES public.profiles(id),
  telegram text,
  prize text,
  entries int,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS raffle_winners_week_start_idx
  ON public.raffle_winners (week_start, created_at);

CREATE INDEX IF NOT EXISTS raffle_winners_user_id_idx
  ON public.raffle_winners (user_id);

-- 4) raffle_winners RLS: public read, admin-only writes.
ALTER TABLE public.raffle_winners ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'raffle_winners'
      AND policyname = 'raffle_winners_public_select'
  ) THEN
    CREATE POLICY raffle_winners_public_select
      ON public.raffle_winners
      FOR SELECT
      TO anon, authenticated
      USING (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'raffle_winners'
      AND policyname = 'raffle_winners_admin_insert'
  ) THEN
    CREATE POLICY raffle_winners_admin_insert
      ON public.raffle_winners
      FOR INSERT
      TO authenticated
      WITH CHECK (public.is_admin());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'raffle_winners'
      AND policyname = 'raffle_winners_admin_update'
  ) THEN
    CREATE POLICY raffle_winners_admin_update
      ON public.raffle_winners
      FOR UPDATE
      TO authenticated
      USING (public.is_admin())
      WITH CHECK (public.is_admin());
  END IF;
END $$;
