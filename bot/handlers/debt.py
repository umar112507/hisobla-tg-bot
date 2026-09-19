from datetime import date, timedelta
from aiogram import Router, F
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup

from bot.database import ensure_user, add_debt, get_debts, mark_debt_paid

router = Router()


class DebtStates(StatesGroup):
    waiting_direction = State()
    waiting_person = State()
    waiting_amount = State()
    waiting_due_date = State()
    waiting_description = State()


def format_amount(amount: float) -> str:
    return f"{amount:,.0f} so'm"


def days_label(due_date_str: str) -> str:
    if not due_date_str:
        return "📅 Muddat belgilanmagan"
    today = date.today()
    due = date.fromisoformat(due_date_str)
    diff = (due - today).days
    if diff < 0:
        return f"⚠️ Muddati o'tgan ({abs(diff)} kun oldin)"
    elif diff == 0:
        return "🔴 Bugun muddati!"
    elif diff <= 3:
        return f"🟠 {diff} kun qoldi"
    else:
        return f"🟢 {diff} kun qoldi ({due.strftime('%d.%m.%Y')})"


# ─── /qarz command ────────────────────────────────────────────────────────────

@router.message(Command("qarz"))
async def cmd_qarz(message: Message, state: FSMContext):
    await ensure_user(message.from_user.id, message.from_user.username, message.from_user.first_name)
    args = message.text.split()

    # Quick commands: /qarz berdi Ali 500000 2026-10-01
    # or /qarz oldi Ali 500000
    if len(args) >= 4 and args[1] in ("berdi", "oldi"):
        direction = "gave" if args[1] == "berdi" else "received"
        person_name = args[2]
        try:
            amount = float(args[3].replace(",", ""))
        except ValueError:
            await message.answer("❌ Miqdor noto'g'ri kiritildi.")
            return
        due_date = args[4] if len(args) >= 5 else None
        description = " ".join(args[5:]) if len(args) >= 6 else None

        debt = await add_debt(
            user_id=message.from_user.id,
            direction=direction,
            person_name=person_name,
            amount=amount,
            description=description,
            due_date=due_date
        )
        emoji = "📤" if direction == "gave" else "📥"
        dir_text = "Berdim" if direction == "gave" else "Oldim"

        await message.answer(
            f"{emoji} <b>Qarz qo'shildi!</b>\n\n"
            f"👤 <b>Kim:</b> {person_name}\n"
            f"💵 <b>Miqdor:</b> {format_amount(amount)}\n"
            f"📋 <b>Tur:</b> {dir_text}\n"
            f"{days_label(due_date)}",
            parse_mode="HTML"
        )
        return

    # FSM flow
    kb = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="📤 Men berdim", callback_data="debt_dir_gave"),
        InlineKeyboardButton(text="📥 Men oldim", callback_data="debt_dir_received"),
    ]])
    await state.set_state(DebtStates.waiting_direction)
    await message.answer(
        "💳 <b>Yangi qarz</b>\n\nQarz turini tanlang:",
        parse_mode="HTML",
        reply_markup=kb
    )


@router.callback_query(F.data.startswith("debt_dir_"))
async def debt_direction(callback: CallbackQuery, state: FSMContext):
    direction = callback.data.replace("debt_dir_", "")
    await state.update_data(direction=direction)
    await state.set_state(DebtStates.waiting_person)
    dir_text = "bergan" if direction == "gave" else "olgan"
    await callback.message.edit_text(
        f"👤 Qarz {dir_text} kishining ismini kiriting:",
        parse_mode="HTML"
    )
    await callback.answer()


@router.message(DebtStates.waiting_person)
async def debt_person(message: Message, state: FSMContext):
    await state.update_data(person_name=message.text.strip())
    await state.set_state(DebtStates.waiting_amount)
    await message.answer("💵 Miqdorni kiriting (so'mda):")


@router.message(DebtStates.waiting_amount)
async def debt_amount(message: Message, state: FSMContext):
    try:
        amount = float(message.text.strip().replace(",", "").replace(" ", ""))
        if amount <= 0:
            raise ValueError
    except ValueError:
        await message.answer("❌ Noto'g'ri miqdor. Raqam kiriting:")
        return
    await state.update_data(amount=amount)
    await state.set_state(DebtStates.waiting_due_date)
    await message.answer(
        "📅 Qaytarish muddatini kiriting (YYYY-MM-DD):\n"
        "<i>Misol: 2026-12-31</i>\n"
        "Yoki /skip bosing",
        parse_mode="HTML"
    )


@router.message(DebtStates.waiting_due_date)
async def debt_due_date(message: Message, state: FSMContext):
    text = message.text.strip()
    due_date = None
    if text != "/skip":
        try:
            date.fromisoformat(text)
            due_date = text
        except ValueError:
            await message.answer("❌ Noto'g'ri sana. YYYY-MM-DD formatida kiriting yoki /skip:")
            return
    await state.update_data(due_date=due_date)
    await state.set_state(DebtStates.waiting_description)
    await message.answer("📝 Izoh kiriting (ixtiyoriy) yoki /skip:")


@router.message(DebtStates.waiting_description)
async def debt_description(message: Message, state: FSMContext):
    text = message.text.strip()
    description = None if text == "/skip" else text

    data = await state.get_data()
    await state.clear()

    debt = await add_debt(
        user_id=message.from_user.id,
        direction=data["direction"],
        person_name=data["person_name"],
        amount=data["amount"],
        description=description,
        due_date=data.get("due_date")
    )

    emoji = "📤" if data["direction"] == "gave" else "📥"
    dir_text = "Berdim" if data["direction"] == "gave" else "Oldim"
    await message.answer(
        f"{emoji} <b>Qarz qo'shildi!</b>\n\n"
        f"👤 <b>Kim:</b> {data['person_name']}\n"
        f"💵 <b>Miqdor:</b> {format_amount(data['amount'])}\n"
        f"📋 <b>Tur:</b> {dir_text}\n"
        f"{days_label(data.get('due_date'))}" +
        (f"\n📝 <b>Izoh:</b> {description}" if description else ""),
        parse_mode="HTML"
    )


# ─── /qarzlar command ─────────────────────────────────────────────────────────

@router.message(Command("qarzlar"))
async def cmd_qarzlar(message: Message):
    await ensure_user(message.from_user.id, message.from_user.username, message.from_user.first_name)
    debts = await get_debts(message.from_user.id, only_unpaid=True)

    if not debts:
        await message.answer(
            "✅ <b>Faol qarzlar yo'q!</b>\n\n"
            "Yangi qarz qo'shish uchun /qarz buyrug'idan foydalaning.",
            parse_mode="HTML"
        )
        return

    gave = [d for d in debts if d["direction"] == "gave"]
    received = [d for d in debts if d["direction"] == "received"]

    total_gave = sum(d["amount"] for d in gave)
    total_received = sum(d["amount"] for d in received)

    text = "💳 <b>Qarzlar ro'yxati</b>\n\n"

    if gave:
        text += f"📤 <b>Men berganlar:</b> {format_amount(total_gave)}\n"
        for d in gave:
            text += (
                f"  • {d['person_name']} — <b>{format_amount(d['amount'])}</b>\n"
                f"    {days_label(d.get('due_date'))}\n"
            )
        text += "\n"

    if received:
        text += f"📥 <b>Men olganlar:</b> {format_amount(total_received)}\n"
        for d in received:
            text += (
                f"  • {d['person_name']} — <b>{format_amount(d['amount'])}</b>\n"
                f"    {days_label(d.get('due_date'))}\n"
            )

    # Build pay-off buttons
    buttons = []
    for d in debts:
        dir_icon = "📤" if d["direction"] == "gave" else "📥"
        buttons.append([InlineKeyboardButton(
            text=f"{dir_icon} {d['person_name']} — {format_amount(d['amount'])} ✅",
            callback_data=f"paid_{d['id']}"
        )])

    kb = InlineKeyboardMarkup(inline_keyboard=buttons) if buttons else None
    await message.answer(text, parse_mode="HTML", reply_markup=kb)


@router.callback_query(F.data.startswith("paid_"))
async def mark_paid(callback: CallbackQuery):
    debt_id = callback.data.replace("paid_", "")
    result = await mark_debt_paid(debt_id, callback.from_user.id)
    if result:
        await callback.answer("✅ Qarz to'landi deb belgilandi!", show_alert=True)
        await callback.message.delete()
        # Re-send updated list
        debts = await get_debts(callback.from_user.id, only_unpaid=True)
        if debts:
            msg = await callback.message.answer("♻️ Yangilangan ro'yxat...")
            await msg.delete()
        # Trigger /qarzlar re-render
        class FakeMsg:
            from_user = callback.from_user
            text = "/qarzlar"
        await cmd_qarzlar(callback.message)
    else:
        await callback.answer("❌ Xatolik yuz berdi", show_alert=True)
