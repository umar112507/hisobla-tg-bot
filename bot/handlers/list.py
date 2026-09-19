from aiogram import Router
from aiogram.types import Message
from aiogram.filters import Command

from bot.database import ensure_user, get_transactions, get_summary

router = Router()


def format_amount(amount: float) -> str:
    return f"{amount:,.0f} so'm"


# ─── /hisobot command ─────────────────────────────────────────────────────────

@router.message(Command("hisobot"))
async def cmd_hisobot(message: Message):
    await ensure_user(message.from_user.id, message.from_user.username, message.from_user.first_name)
    summary = await get_summary(message.from_user.id)

    balance = summary["balance"]
    balance_emoji = "📈" if balance >= 0 else "📉"
    balance_sign = "+" if balance >= 0 else ""

    # Top expense categories (max 5)
    expense_cats = [c for c in summary["categories"] if c["type"] == "expense"][:5]
    income_cats = [c for c in summary["categories"] if c["type"] == "income"][:5]

    text = (
        f"📊 <b>Moliyaviy hisobot</b>\n\n"
        f"💰 <b>Daromad:</b> {format_amount(summary['total_income'])}\n"
        f"💸 <b>Xarajat:</b> {format_amount(summary['total_expense'])}\n"
        f"{balance_emoji} <b>Balans:</b> {balance_sign}{format_amount(balance)}\n"
    )

    if expense_cats:
        text += "\n📁 <b>Top xarajat kategoriyalari:</b>\n"
        for cat in expense_cats:
            text += f"  • {cat['category']}: {format_amount(cat['total'])}\n"

    if income_cats:
        text += "\n📁 <b>Top daromad kategoriyalari:</b>\n"
        for cat in income_cats:
            text += f"  • {cat['category']}: {format_amount(cat['total'])}\n"

    await message.answer(text, parse_mode="HTML")


# ─── /oxirgi command ──────────────────────────────────────────────────────────

@router.message(Command("oxirgi"))
async def cmd_oxirgi(message: Message):
    await ensure_user(message.from_user.id, message.from_user.username, message.from_user.first_name)
    transactions = await get_transactions(message.from_user.id, limit=10)

    if not transactions:
        await message.answer(
            "📭 <b>Tranzaksiyalar yo'q</b>\n\n"
            "/xarajat yoki /daromad bilan boshlang.",
            parse_mode="HTML"
        )
        return

    text = "📋 <b>Oxirgi 10 ta tranzaksiya:</b>\n\n"
    for t in transactions:
        emoji = "💸" if t["type"] == "expense" else "💰"
        from datetime import datetime
        dt = datetime.fromisoformat(t["created_at"].replace("Z", "+00:00"))
        date_str = dt.strftime("%d.%m.%Y")
        text += (
            f"{emoji} <b>{format_amount(t['amount'])}</b> — {t['category']}\n"
            f"   📝 {t['description'] or '-'} | 📅 {date_str}\n\n"
        )

    await message.answer(text, parse_mode="HTML")
