import os
from aiogram import Router
from aiogram.types import Message, InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from aiogram.filters import Command, CommandStart
from dotenv import load_dotenv

from bot.database import ensure_user

load_dotenv()

router = Router()
MINI_APP_URL = os.getenv("MINI_APP_URL", "http://localhost:8080")


def main_menu(user_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(
                text="📊 Mini App orqali ko'rish",
                web_app=WebAppInfo(url=f"{MINI_APP_URL}?user_id={user_id}")
            )
        ],
        [
            InlineKeyboardButton(text="💸 Xarajat", callback_data="menu_expense"),
            InlineKeyboardButton(text="💰 Daromad", callback_data="menu_income"),
        ],
        [
            InlineKeyboardButton(text="💳 Qarz", callback_data="menu_debt"),
            InlineKeyboardButton(text="📋 Qarzlar", callback_data="menu_debts"),
        ],
        [
            InlineKeyboardButton(text="📊 Hisobot", callback_data="menu_report"),
            InlineKeyboardButton(text="🕒 Oxirgi", callback_data="menu_last"),
        ],
    ])


@router.message(CommandStart())
async def cmd_start(message: Message):
    await ensure_user(
        message.from_user.id,
        message.from_user.username,
        message.from_user.first_name
    )
    name = message.from_user.first_name or "Do'stim"
    await message.answer(
        f"👋 Salom, <b>{name}</b>!\n\n"
        f"🏦 <b>Hisobla Bot</b> ga xush kelibsiz!\n\n"
        f"Men sizning moliyangizni boshqarishga yordam beraman:\n"
        f"  💸 Xarajatlar va daromadlarni yozish\n"
        f"  🤖 AI yordamida avtomatik kategoriyalash\n"
        f"  💳 Qarzlarni kuzatish va muddat belgilash\n"
        f"  📊 Batafsil hisobotlar va statistikalar\n\n"
        f"Quyidagi tugmalardan foydalaning:",
        parse_mode="HTML",
        reply_markup=main_menu(message.from_user.id)
    )


@router.message(Command("menu"))
async def cmd_menu(message: Message):
    await message.answer(
        "📋 <b>Asosiy menyu</b>",
        parse_mode="HTML",
        reply_markup=main_menu(message.from_user.id)
    )


@router.message(Command("help"))
async def cmd_help(message: Message):
    await message.answer(
        "📖 <b>Buyruqlar ro'yxati</b>\n\n"
        "💸 /xarajat [summa] [tavsif] — Xarajat qo'shish\n"
        "💰 /daromad [summa] [tavsif] — Daromad qo'shish\n\n"
        "💳 /qarz berdi [ism] [summa] [sana] — Qarz berganim\n"
        "💳 /qarz oldi [ism] [summa] [sana] — Qarz olganim\n"
        "📋 /qarzlar — Barcha qarzlar\n\n"
        "📊 /hisobot — Umumiy hisobot\n"
        "🕒 /oxirgi — Oxirgi 10 tranzaksiya\n"
        "📋 /menu — Asosiy menyu\n\n"
        "<i>Misol: /xarajat 50000 taksi</i>\n"
        "<i>Misol: /qarz berdi Ali 500000 2026-12-31</i>",
        parse_mode="HTML"
    )
