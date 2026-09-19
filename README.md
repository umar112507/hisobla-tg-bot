# 🏦 Hisobla – Moliyaviy Hisoblar Telegram Bot

Telegram bot for personal finance tracking with AI-powered categorization and a Mini App dashboard.

## Features

- 💸 Track **expenses** and **incomes** with AI auto-categorization (Groq)
- 💳 Manage **debts** with deadlines and auto-reminders
- 📊 Telegram **Mini App** with balance dashboard, charts, and debt tracker
- 🤖 Natural language input: just type "taksi 15000"

## Setup

### 1. Install dependencies
```powershell
pip install -r requirements.txt
```

### 2. Configure environment
```powershell
copy .env.example .env
```
Edit `.env` and fill in:
- `BOT_TOKEN` — from [@BotFather](https://t.me/BotFather)
- `GROQ_API_KEY` — from [console.groq.com](https://console.groq.com)
- `SUPABASE_URL` and `SUPABASE_KEY` — from your Supabase project settings
- `MINI_APP_URL` — your public URL (use [ngrok](https://ngrok.com) for local dev)

### 3. Set up Supabase
Run `supabase_schema.sql` in your Supabase project's **SQL Editor**.

### 4. Set Mini App URL in BotFather
In BotFather → your bot → **Bot Settings → Menu Button** → set URL to your `MINI_APP_URL`.

### 5. Run the bot
```powershell
python bot/main.py
```

## Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome + Mini App button |
| `/xarajat [summa] [tavsif]` | Add expense |
| `/daromad [summa] [tavsif]` | Add income |
| `/qarz berdi [ism] [summa] [sana]` | Debt: I gave money |
| `/qarz oldi [ism] [summa] [sana]` | Debt: I received money |
| `/qarzlar` | List all active debts |
| `/hisobot` | Full financial summary |
| `/oxirgi` | Last 10 transactions |
| `/help` | All commands |

## Project Structure
```
├── bot/
│   ├── main.py              # Entry point
│   ├── database.py          # Supabase CRUD
│   ├── ai_categorizer.py    # Groq AI integration
│   ├── scheduler.py         # Debt reminder scheduler
│   ├── mini_app_server.py   # FastAPI REST API
│   └── handlers/            # Telegram command handlers
├── mini_app/                # Frontend (HTML/CSS/JS)
├── supabase_schema.sql      # Database setup SQL
├── requirements.txt
└── .env.example
```
