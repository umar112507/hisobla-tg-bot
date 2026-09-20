-- Run this SQL in your Supabase SQL Editor to set up the database schema

-- Users table
CREATE TABLE IF NOT EXISTS users (
    user_id BIGINT PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    last_name TEXT,
    photo_url TEXT,
    currency TEXT DEFAULT 'UZS',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- If users table already exists, add columns if missing
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS usage_count INT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS usage_reset_date TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_premium BOOLEAN DEFAULT FALSE;

-- Transactions table
CREATE TABLE IF NOT EXISTS transactions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id BIGINT REFERENCES users(user_id) ON DELETE CASCADE,
    type TEXT CHECK (type IN ('income', 'expense')) NOT NULL,
    amount NUMERIC(15, 2) NOT NULL,
    category TEXT NOT NULL DEFAULT 'Boshqa',
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Debts table
CREATE TABLE IF NOT EXISTS debts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id BIGINT REFERENCES users(user_id) ON DELETE CASCADE,
    direction TEXT CHECK (direction IN ('gave', 'received')) NOT NULL,
    person_name TEXT NOT NULL,
    amount NUMERIC(15, 2) NOT NULL,
    description TEXT,
    due_date DATE,
    is_paid BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_debts_user_id ON debts(user_id);
CREATE INDEX IF NOT EXISTS idx_debts_due_date ON debts(due_date);

-- Coupons table
CREATE TABLE IF NOT EXISTS coupons (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    plan TEXT NOT NULL CHECK (plan IN ('1_month', '3_months', '6_months', '1_year', 'lifetime')),
    max_uses INT DEFAULT 1,
    used_count INT DEFAULT 0,
    expires_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);

-- Enable Row Level Security (RLS)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE debts ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;

-- Allow all operations
CREATE POLICY "Allow all for users" ON users FOR ALL USING (true);
CREATE POLICY "Allow all for transactions" ON transactions FOR ALL USING (true);
CREATE POLICY "Allow all for debts" ON debts FOR ALL USING (true);
CREATE POLICY "Allow all for coupons" ON coupons FOR ALL USING (true);
