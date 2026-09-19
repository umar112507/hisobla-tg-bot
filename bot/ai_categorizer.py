import os
import json
import re
from groq import Groq
from dotenv import load_dotenv

load_dotenv()

client = Groq(api_key=os.getenv("GROQ_API_KEY"))

EXPENSE_CATEGORIES = [
    "Ovqat", "Transport", "Uy", "Salomatlik", "Ta'lim",
    "Kiyim", "Ko'ngil ochar", "Kommunal", "Telefon/Internet", "Boshqa"
]
INCOME_CATEGORIES = [
    "Maosh", "Biznes", "Sovg'a", "Freelance", "Ijara", "Boshqa"
]


async def categorize_transaction(description: str, transaction_type: str) -> str:
    """
    Use Groq AI to categorize a transaction description.
    Returns category name string.
    """
    categories = EXPENSE_CATEGORIES if transaction_type == "expense" else INCOME_CATEGORIES

    prompt = f"""Siz moliyaviy tranzaksiyalarni kategoriyalashtiradigan yordamchisiz.

Tranzaksiya turi: {"Xarajat" if transaction_type == "expense" else "Daromad"}
Tavsif: {description}

Mavjud kategoriyalar: {", ".join(categories)}

Faqat eng mos kategoriya nomini qaytaring. JSON format:
{{"category": "Kategoriya nomi"}}

Agar hech biri mos kelmasa, "Boshqa" deb qaytaring. Izoh yozmang."""

    try:
        response = client.chat.completions.create(
            model="llama3-70b-8192",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=50,
        )
        content = response.choices[0].message.content.strip()
        # Parse JSON response
        match = re.search(r'\{.*?\}', content, re.DOTALL)
        if match:
            data = json.loads(match.group())
            category = data.get("category", "Boshqa")
            # Validate it's in our list
            if category in categories:
                return category
        return "Boshqa"
    except Exception as e:
        print(f"AI categorization error: {e}")
        return "Boshqa"


async def parse_natural_language(text: str, transaction_type: str) -> dict:
    """
    Parse natural language like "taksi 15000" or "non tuxum 25000 so'm"
    Returns {"amount": float, "description": str} or None
    """
    prompt = f"""Foydalanuvchi kiritgan matni tahlil qiling va moliyaviy tranzaksiya ma'lumotlarini chiqaring.

Matn: "{text}"
Tur: {"Xarajat" if transaction_type == "expense" else "Daromad"}

Faqat JSON qaytaring:
{{"amount": raqam, "description": "tavsif_matni"}}

Agar miqdor topilmasa: {{"amount": null, "description": null}}
Faqat JSON, hech qanday izoh yo'q."""

    try:
        response = client.chat.completions.create(
            model="llama3-70b-8192",
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            max_tokens=80,
        )
        content = response.choices[0].message.content.strip()
        match = re.search(r'\{.*?\}', content, re.DOTALL)
        if match:
            data = json.loads(match.group())
            if data.get("amount"):
                return data
        return None
    except Exception as e:
        print(f"NLP parse error: {e}")
        return None
