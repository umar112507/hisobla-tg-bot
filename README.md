# 🏦 Hisobla – Supabase Edge Functions (Deno) Telegram Bot

Telegram bot for personal finance tracking with AI-powered categorization (Groq) and Telegram Mini App dashboard running natively on **Supabase Edge Functions (Deno)**.

## Architecture & Tech Stack

- **Runtime**: Deno (TypeScript) on Supabase Edge Functions
- **Bot Framework**: `grammy` (Webhook handler)
- **Database**: Supabase PostgreSQL
- **AI Categorization**: Groq API (`llama3-70b-8192`) via Deno HTTP fetch
- **Mini App**: Glassmorphism HTML/JS/CSS frontend

## Project Structure

```
├── supabase/
│   └── functions/
│       └── telegram-bot/
│           ├── index.ts     # Deno HTTP Webhook server
│           ├── bot.ts       # grammY bot commands & handlers
│           ├── db.ts        # Supabase client & queries
│           └── ai.ts        # Groq AI categorization & intent parser
├── mini_app/                # Frontend (HTML/CSS/JS)
├── supabase_schema.sql      # Database schema
└── README.md
```

## Quick Deployment Guide

1. Run `supabase_schema.sql` in Supabase SQL Editor.
2. Link project & set secrets:
   ```powershell
   supabase secrets set BOT_TOKEN="your_token" GROQ_API_KEY="your_key" MINI_APP_URL="https://your-mini-app-url"
   ```
3. Deploy function:
   ```powershell
   supabase functions deploy telegram-bot --no-verify-jwt
   ```
4. Set Telegram Webhook:
   `https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://<PROJECT_REF>.supabase.co/functions/v1/telegram-bot`
