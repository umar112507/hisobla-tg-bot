import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


# ─── Users ────────────────────────────────────────────────────────────────────

async def ensure_user(user_id: int, username: str = None, first_name: str = None):
    """Create user if not exists."""
    existing = supabase.table("users").select("user_id").eq("user_id", user_id).execute()
    if not existing.data:
        supabase.table("users").insert({
            "user_id": user_id,
            "username": username,
            "first_name": first_name,
        }).execute()


# ─── Transactions ─────────────────────────────────────────────────────────────

async def add_transaction(user_id: int, type_: str, amount: float, category: str, description: str):
    """Add income or expense transaction."""
    result = supabase.table("transactions").insert({
        "user_id": user_id,
        "type": type_,
        "amount": amount,
        "category": category,
        "description": description,
    }).execute()
    return result.data[0] if result.data else None


async def get_transactions(user_id: int, limit: int = 50, type_filter: str = None):
    """Get transactions for a user, optionally filtered by type."""
    query = (
        supabase.table("transactions")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(limit)
    )
    if type_filter:
        query = query.eq("type", type_filter)
    result = query.execute()
    return result.data or []


async def get_summary(user_id: int):
    """Get total income, expense and balance for a user."""
    transactions = await get_transactions(user_id, limit=10000)
    total_income = sum(t["amount"] for t in transactions if t["type"] == "income")
    total_expense = sum(t["amount"] for t in transactions if t["type"] == "expense")
    balance = total_income - total_expense

    # Category breakdown
    categories = {}
    for t in transactions:
        key = (t["category"], t["type"])
        categories[key] = categories.get(key, 0) + t["amount"]

    return {
        "total_income": total_income,
        "total_expense": total_expense,
        "balance": balance,
        "categories": [
            {"category": k[0], "type": k[1], "total": v}
            for k, v in sorted(categories.items(), key=lambda x: -x[1])
        ],
    }


# ─── Debts ────────────────────────────────────────────────────────────────────

async def add_debt(user_id: int, direction: str, person_name: str, amount: float,
                   description: str = None, due_date: str = None):
    """Add a debt record. direction: 'gave' or 'received'."""
    result = supabase.table("debts").insert({
        "user_id": user_id,
        "direction": direction,
        "person_name": person_name,
        "amount": amount,
        "description": description,
        "due_date": due_date,
        "is_paid": False,
    }).execute()
    return result.data[0] if result.data else None


async def get_debts(user_id: int, only_unpaid: bool = True):
    """Get all debts for a user."""
    query = (
        supabase.table("debts")
        .select("*")
        .eq("user_id", user_id)
        .order("due_date", desc=False)
    )
    if only_unpaid:
        query = query.eq("is_paid", False)
    result = query.execute()
    return result.data or []


async def mark_debt_paid(debt_id: str, user_id: int):
    """Mark a debt as paid."""
    result = (
        supabase.table("debts")
        .update({"is_paid": True})
        .eq("id", debt_id)
        .eq("user_id", user_id)
        .execute()
    )
    return result.data[0] if result.data else None


async def get_upcoming_debts():
    """Get all unpaid debts with due dates (for scheduler)."""
    from datetime import date, timedelta
    today = date.today().isoformat()
    in_3_days = (date.today() + timedelta(days=3)).isoformat()
    result = (
        supabase.table("debts")
        .select("*, users(user_id)")
        .eq("is_paid", False)
        .lte("due_date", in_3_days)
        .gte("due_date", today)
        .execute()
    )
    overdue = (
        supabase.table("debts")
        .select("*, users(user_id)")
        .eq("is_paid", False)
        .lt("due_date", today)
        .execute()
    )
    return (result.data or []) + (overdue.data or [])
