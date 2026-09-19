import asyncio
import logging
from datetime import date
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from bot.database import get_upcoming_debts

scheduler = AsyncIOScheduler(timezone="Asia/Tashkent")
_bot = None


def setup_scheduler(bot):
    """Initialize the scheduler with a bot instance."""
    global _bot
    _bot = bot
    scheduler.add_job(check_debts, "cron", hour=9, minute=0, id="debt_check")
    scheduler.start()
    logging.info("Scheduler started")


async def check_debts():
    """Send debt deadline alerts to users."""
    if not _bot:
        return
    try:
        debts = await get_upcoming_debts()
        for debt in debts:
            user_id = debt.get("user_id")
            if not user_id:
                continue

            today = date.today()
            due_date_str = debt.get("due_date")
            if not due_date_str:
                continue

            due = date.fromisoformat(due_date_str)
            diff = (due - today).days
            person = debt["person_name"]
            amount = f"{debt['amount']:,.0f} so'm"
            direction = "bergan" if debt["direction"] == "gave" else "olgan"

            if diff < 0:
                emoji = "🔴"
                time_text = f"Muddati {abs(diff)} kun oldin o'tgan!"
            elif diff == 0:
                emoji = "🔴"
                time_text = "Bugun muddati!"
            else:
                emoji = "🟠"
                time_text = f"{diff} kun qoldi"

            text = (
                f"{emoji} <b>Qarz eslatmasi!</b>\n\n"
                f"Sen {person} ga {amount} {direction}san.\n"
                f"📅 {time_text}\n\n"
                f"/qarzlar — barcha qarzlarni ko'rish"
            )
            try:
                await _bot.send_message(user_id, text, parse_mode="HTML")
            except Exception as e:
                logging.warning(f"Failed to send debt alert to {user_id}: {e}")
    except Exception as e:
        logging.error(f"Scheduler check_debts error: {e}")
