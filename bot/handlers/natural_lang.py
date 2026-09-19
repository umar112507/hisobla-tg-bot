import json
import re
from aiogram import Router
from aiogram.types import Message
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from groq import Groq
import os
from dotenv import load_dotenv

load_dotenv()
client = Groq(api_key=os.getenv("GROQ_API_KEY"))
router = Router()

INTENT_PROMPT = """Foydalanuvchi yozgan matnni tahlil qil va quyidagi JSON formatda qaytarsin.

Matn: "{text}"

Mumkin bo'lgan intentlar:
- "expense" — xarajat yozish (taksi, ovqat, do'kon, narx yozilgan bo'lsa va daromad emas)
- "income" — daromad yozish (maosh, pul oldi, tushum, earned, received)
- "debt_gave" — qarz berdi (berdi, berdim, qarzga berdim, udolnil)
- "debt_received" — qarz oldi (oldi, oldim, qarz oldim, vzyal)
- "report" — hisobot so'radi (hisobot, balans, necha pul, qancha, statistika, report)
- "debts_list" — qarzlar ro'yxati (qarzlar, qarzlarim, kim qarz)
- "last_transactions" — oxirgi tranzaksiyalar (oxirgi, so'nggi, nima yozdim, ko'rsat)
- "unknown" — boshqa narsa

Agar expense yoki income bo'lsa, miqdor va tavsifni ham chiqar.
Agar debt bo'lsa, ism, miqdor va sana (agar bo'lsa) ni chiqar.

Faqat JSON:
{{
  "intent": "expense|income|debt_gave|debt_received|report|debts_list|last_transactions|unknown",
  "amount": null_yoki_raqam,
  "description": "null_yoki_matn",
  "person": "null_yoki_ism",
  "due_date": "null_yoki_YYYY-MM-DD"
}}"""


async def analyze_intent(text: str) -> dict:
    try:
        response = client.chat.completions.create(
            model="llama3-70b-8192",
            messages=[{"role": "user", "content": INTENT_PROMPT.format(text=text)}],
            temperature=0,
            max_tokens=120,
        )
        content = response.choices[0].message.content.strip()
        match = re.search(r'\{.*?\}', content, re.DOTALL)
        if match:
            return json.loads(match.group())
    except Exception as e:
        print(f"Intent analyze error: {e}")
    return {"intent": "unknown"}


@router.message()
async def handle_natural_language(message: Message, state: FSMContext):
    """Catch-all handler: analyze any plain text with Groq AI."""
    text = message.text or ""

    # Skip if it's a command (starts with /)
    if text.startswith("/"):
        return

    # Skip very short messages (single emoji, etc.)
    if len(text.strip()) < 2:
        return

    # Show typing indicator
    await message.bot.send_chat_action(message.chat.id, "typing")

    result = await analyze_intent(text)
    intent = result.get("intent", "unknown")

    from bot.database import ensure_user
    await ensure_user(message.from_user.id, message.from_user.username, message.from_user.first_name)

    if intent == "expense":
        amount = result.get("amount")
        description = result.get("description") or text
        if not amount:
            await message.answer(
                "💸 Xarajat yozmoqchisiz, lekin miqdor aniqlanmadi.\n"
                "<i>Misol: taksi 15000</i>", parse_mode="HTML"
            )
            return
        from bot.handlers.expense import _process_transaction
        # Fake message text for reuse
        await _process_transaction(message, f"{amount} {description}", "expense", state)

    elif intent == "income":
        amount = result.get("amount")
        description = result.get("description") or text
        if not amount:
            await message.answer(
                "💰 Daromad yozmoqchisiz, lekin miqdor aniqlanmadi.\n"
                "<i>Misol: maosh 3000000</i>", parse_mode="HTML"
            )
            return
        from bot.handlers.expense import _process_transaction
        await _process_transaction(message, f"{amount} {description}", "income", state)

    elif intent == "debt_gave":
        person = result.get("person")
        amount = result.get("amount")
        due_date = result.get("due_date")
        if not person or not amount:
            await message.answer(
                "💳 Qarz berganingizni yozmoqchisiz.\n"
                "<i>Misol: Ali ga 500000 berdim yoki /qarz</i>", parse_mode="HTML"
            )
            return
        from bot.database import add_debt
        await add_debt(message.from_user.id, "gave", person, float(amount), text, due_date)
        from bot.handlers.debt import days_label, format_amount
        await message.answer(
            f"📤 <b>Qarz saqlandi!</b>\n\n"
            f"👤 <b>Kim:</b> {person}\n"
            f"💵 <b>Miqdor:</b> {format_amount(float(amount))}\n"
            f"📋 <b>Tur:</b> Berdim\n"
            f"{days_label(due_date)}",
            parse_mode="HTML"
        )

    elif intent == "debt_received":
        person = result.get("person")
        amount = result.get("amount")
        due_date = result.get("due_date")
        if not person or not amount:
            await message.answer(
                "💳 Qarz olganingizni yozmoqchisiz.\n"
                "<i>Misol: Sardor dan 200000 oldim yoki /qarz</i>", parse_mode="HTML"
            )
            return
        from bot.database import add_debt
        await add_debt(message.from_user.id, "received", person, float(amount), text, due_date)
        from bot.handlers.debt import days_label, format_amount
        await message.answer(
            f"📥 <b>Qarz saqlandi!</b>\n\n"
            f"👤 <b>Kim:</b> {person}\n"
            f"💵 <b>Miqdor:</b> {format_amount(float(amount))}\n"
            f"📋 <b>Tur:</b> Oldim\n"
            f"{days_label(due_date)}",
            parse_mode="HTML"
        )

    elif intent == "report":
        from bot.handlers.list import cmd_hisobot
        await cmd_hisobot(message)

    elif intent == "debts_list":
        from bot.handlers.debt import cmd_qarzlar
        await cmd_qarzlar(message)

    elif intent == "last_transactions":
        from bot.handlers.list import cmd_oxirgi
        await cmd_oxirgi(message)

    else:
        # Unknown — give helpful hint
        await message.answer(
            "🤖 Tushunmadim. Quyidagi misollardan foydalaning:\n\n"
            "💸 <code>taksi 15000</code>\n"
            "💰 <code>maosh 3000000</code>\n"
            "💳 <code>Ali ga 500000 berdim</code>\n"
            "📊 <code>hisobot</code> yoki <code>balans</code>\n"
            "📋 <code>qarzlar</code>\n\n"
            "Yoki /menu tugmasini bosing.",
            parse_mode="HTML"
        )
