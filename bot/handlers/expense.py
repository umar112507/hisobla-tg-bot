import re
from aiogram import Router, F
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup

from bot.database import ensure_user, add_transaction
from bot.ai_categorizer import categorize_transaction, parse_natural_language, EXPENSE_CATEGORIES, INCOME_CATEGORIES

router = Router()


class TransactionStates(StatesGroup):
    waiting_amount = State()
    waiting_description = State()
    confirm_category = State()


def format_amount(amount: float) -> str:
    return f"{amount:,.0f} so'm"


def make_category_keyboard(categories: list, tx_type: str) -> InlineKeyboardMarkup:
    buttons = []
    row = []
    for i, cat in enumerate(categories):
        row.append(InlineKeyboardButton(text=cat, callback_data=f"cat_{tx_type}_{cat}"))
        if len(row) == 2:
            buttons.append(row)
            row = []
    if row:
        buttons.append(row)
    return InlineKeyboardMarkup(inline_keyboard=buttons)


# ─── /xarajat command ─────────────────────────────────────────────────────────

@router.message(Command("xarajat"))
async def cmd_xarajat(message: Message, state: FSMContext):
    await ensure_user(message.from_user.id, message.from_user.username, message.from_user.first_name)
    args = message.text.split(maxsplit=1)

    if len(args) > 1:
        # Inline: /xarajat 50000 taksi
        await _process_transaction(message, args[1], "expense", state)
    else:
        await state.set_state(TransactionStates.waiting_amount)
        await state.update_data(tx_type="expense")
        await message.answer(
            "💸 <b>Xarajat qo'shish</b>\n\n"
            "Miqdor va tavsifni kiriting:\n"
            "<i>Misol: 50000 taksi</i>",
            parse_mode="HTML"
        )


# ─── /daromad command ─────────────────────────────────────────────────────────

@router.message(Command("daromad"))
async def cmd_daromad(message: Message, state: FSMContext):
    await ensure_user(message.from_user.id, message.from_user.username, message.from_user.first_name)
    args = message.text.split(maxsplit=1)

    if len(args) > 1:
        await _process_transaction(message, args[1], "income", state)
    else:
        await state.set_state(TransactionStates.waiting_amount)
        await state.update_data(tx_type="income")
        await message.answer(
            "💰 <b>Daromad qo'shish</b>\n\n"
            "Miqdor va tavsifni kiriting:\n"
            "<i>Misol: 2000000 oylik maosh</i>",
            parse_mode="HTML"
        )


# ─── FSM: waiting for amount input ───────────────────────────────────────────

@router.message(TransactionStates.waiting_amount)
async def process_amount_input(message: Message, state: FSMContext):
    data = await state.get_data()
    tx_type = data.get("tx_type", "expense")
    await _process_transaction(message, message.text, tx_type, state)


async def _process_transaction(message: Message, text: str, tx_type: str, state: FSMContext):
    """Core logic: parse amount + description, AI categorize, save."""
    amount = None
    description = text.strip()

    # Try to extract amount from text like "50000 taksi" or "taksi 50000"
    numbers = re.findall(r'\d[\d\s]*(?:\.\d+)?', text)
    if numbers:
        # Take the largest number as amount
        for num_str in numbers:
            try:
                val = float(num_str.replace(" ", ""))
                if val > 0:
                    amount = val
                    description = text.replace(num_str.strip(), "").strip()
                    break
            except Exception:
                pass

    # If still no amount, try AI parsing
    if not amount:
        parsed = await parse_natural_language(text, tx_type)
        if parsed and parsed.get("amount"):
            amount = float(parsed["amount"])
            description = parsed.get("description") or text

    if not amount or amount <= 0:
        await state.clear()
        await message.answer(
            "❌ Miqdor topilmadi. Qayta urinib ko'ring.\n"
            "<i>Misol: /xarajat 50000 taksi</i>",
            parse_mode="HTML"
        )
        return

    if not description:
        description = "Tavsif yo'q"

    # AI categorization
    processing_msg = await message.answer("🤖 AI kategoriyani aniqlamoqda...")
    category = await categorize_transaction(description, tx_type)

    # Save to Supabase
    tx = await add_transaction(
        user_id=message.from_user.id,
        type_=tx_type,
        amount=amount,
        category=category,
        description=description
    )

    await processing_msg.delete()
    await state.clear()

    emoji = "💸" if tx_type == "expense" else "💰"
    type_text = "Xarajat" if tx_type == "expense" else "Daromad"

    categories = EXPENSE_CATEGORIES if tx_type == "expense" else INCOME_CATEGORIES
    kb = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="✏️ Kategoriyani o'zgartir", callback_data=f"change_cat_{tx['id']}_{tx_type}")
    ]])

    await message.answer(
        f"{emoji} <b>{type_text} qo'shildi!</b>\n\n"
        f"💵 <b>Miqdor:</b> {format_amount(amount)}\n"
        f"📁 <b>Kategoriya:</b> {category}\n"
        f"📝 <b>Tavsif:</b> {description}",
        parse_mode="HTML",
        reply_markup=kb
    )


# ─── Category change callback ─────────────────────────────────────────────────

@router.callback_query(F.data.startswith("change_cat_"))
async def change_category_start(callback: CallbackQuery, state: FSMContext):
    parts = callback.data.split("_")
    tx_id = parts[2]
    tx_type = parts[3]
    categories = EXPENSE_CATEGORIES if tx_type == "expense" else INCOME_CATEGORIES
    await state.update_data(edit_tx_id=tx_id)
    await callback.message.edit_reply_markup(
        reply_markup=make_category_keyboard(categories, tx_type)
    )
    await callback.answer()


@router.callback_query(F.data.startswith("cat_"))
async def set_category(callback: CallbackQuery, state: FSMContext):
    parts = callback.data.split("_", 2)
    tx_type = parts[1]
    category = parts[2]

    data = await state.get_data()
    tx_id = data.get("edit_tx_id")

    if tx_id:
        from bot.database import supabase
        supabase.table("transactions").update({"category": category}).eq("id", tx_id).execute()

    await callback.message.edit_reply_markup(reply_markup=None)
    await callback.message.answer(f"✅ Kategoriya <b>{category}</b> ga o'zgartirildi!", parse_mode="HTML")
    await state.clear()
    await callback.answer()
