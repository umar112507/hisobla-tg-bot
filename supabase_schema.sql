-- Run this SQL in your Supabase SQL Editor to set up the updated database schema

-- Enable UUID extension if not enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Drop foreign key constraint on profiles.id if created by Supabase Auth template
ALTER TABLE IF EXISTS public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;

-- Drop old foreign keys referencing 'users' table and update to 'profiles' table
ALTER TABLE IF EXISTS public.accounts DROP CONSTRAINT IF EXISTS accounts_user_id_fkey;
ALTER TABLE IF EXISTS public.categories DROP CONSTRAINT IF EXISTS categories_user_id_fkey;
ALTER TABLE IF EXISTS public.transactions DROP CONSTRAINT IF EXISTS transactions_user_id_fkey;
ALTER TABLE IF EXISTS public.debts DROP CONSTRAINT IF EXISTS debts_user_id_fkey;
ALTER TABLE IF EXISTS public.debts DROP CONSTRAINT IF EXISTS debts_status_check;
ALTER TABLE IF EXISTS public.budgets DROP CONSTRAINT IF EXISTS budgets_user_id_fkey;
ALTER TABLE IF EXISTS public.telegram_auth_tokens DROP CONSTRAINT IF EXISTS telegram_auth_tokens_user_id_fkey;

-- 1. Profiles table
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT NOT NULL,
    full_name TEXT,
    avatar_url TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    is_pro BOOLEAN DEFAULT FALSE,
    pro_expires_at TIMESTAMPTZ,
    trial_started_at TIMESTAMPTZ,
    expo_token TEXT,
    push_token TEXT
);

-- 2. Telegram Auth Tokens table
CREATE TABLE IF NOT EXISTS telegram_auth_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    state_token TEXT NOT NULL,
    telegram_id BIGINT,
    telegram_user JSONB,
    status TEXT NOT NULL,
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ
);

-- 3. Accounts table
CREATE TABLE IF NOT EXISTS accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    balance_uzs BIGINT DEFAULT 0,
    icon TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    currency TEXT DEFAULT 'UZS'
);

-- 4. Categories table
CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    icon TEXT,
    color TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Transactions table
CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    amount_uzs BIGINT NOT NULL,
    type TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Budgets table
CREATE TABLE IF NOT EXISTS budgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    amount_uzs BIGINT NOT NULL,
    period TEXT,
    start_date DATE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Debts table
CREATE TABLE IF NOT EXISTS debts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    person_name TEXT NOT NULL,
    amount_uzs BIGINT NOT NULL,
    type TEXT NOT NULL, -- 'gave' or 'received'
    description TEXT,
    due_date DATE,
    status TEXT DEFAULT 'unpaid', -- 'unpaid' or 'paid'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    amount NUMERIC,
    currency TEXT DEFAULT 'UZS',
    original_amount NUMERIC,
    original_currency TEXT
);

-- 8. Payments table
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    amount BIGINT NOT NULL,
    type TEXT,
    months NUMERIC NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    status TEXT DEFAULT 'pending',
    receipt_url TEXT,
    metadata JSONB
);

-- 9. Referral Codes table
CREATE TABLE IF NOT EXISTS referral_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    discount_percent INTEGER NOT NULL,
    uses_left INTEGER NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    discount_month INTEGER
);

-- 10. Scheduled Transactions table
CREATE TABLE IF NOT EXISTS scheduled_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    amount_uzs BIGINT NOT NULL,
    frequency TEXT NOT NULL,
    next_run_date DATE NOT NULL,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. Notification Logs table
CREATE TABLE IF NOT EXISTS notification_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT,
    type TEXT,
    status TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. Payment SMS Logs table
CREATE TABLE IF NOT EXISTS payment_sms_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    card_last4 TEXT,
    transaction_type TEXT,
    amount NUMERIC,
    description TEXT,
    sms_timestamp TEXT,
    raw_message TEXT,
    processed_at TIMESTAMPTZ DEFAULT NOW(),
    match_status TEXT
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_telegram_auth_telegram_id ON telegram_auth_tokens(telegram_id);
CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_account_id ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_debts_user_id ON debts(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_profile_id ON payments(profile_id);

-- Enable Row Level Security (RLS)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_auth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE debts ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_sms_logs ENABLE ROW LEVEL SECURITY;

-- Allow all operations policy for Supabase client
CREATE POLICY "Allow all for profiles" ON profiles FOR ALL USING (true);
CREATE POLICY "Allow all for telegram_auth_tokens" ON telegram_auth_tokens FOR ALL USING (true);
CREATE POLICY "Allow all for accounts" ON accounts FOR ALL USING (true);
CREATE POLICY "Allow all for categories" ON categories FOR ALL USING (true);
CREATE POLICY "Allow all for transactions" ON transactions FOR ALL USING (true);
CREATE POLICY "Allow all for budgets" ON budgets FOR ALL USING (true);
CREATE POLICY "Allow all for debts" ON debts FOR ALL USING (true);
CREATE POLICY "Allow all for payments" ON payments FOR ALL USING (true);
CREATE POLICY "Allow all for referral_codes" ON referral_codes FOR ALL USING (true);
CREATE POLICY "Allow all for scheduled_transactions" ON scheduled_transactions FOR ALL USING (true);
CREATE POLICY "Allow all for notification_logs" ON notification_logs FOR ALL USING (true);
CREATE POLICY "Allow all for payment_sms_logs" ON payment_sms_logs FOR ALL USING (true);
