import asyncio
import logging
import os
import uvicorn
from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.fsm.storage.memory import MemoryStorage
from dotenv import load_dotenv

from bot.handlers import menu, expense, debt, list as list_handler, natural_lang
from bot.scheduler import setup_scheduler
from bot.mini_app_server import app as fastapi_app

load_dotenv()

BOT_TOKEN = os.getenv("BOT_TOKEN")
MINI_APP_PORT = int(os.getenv("MINI_APP_PORT", 8080))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)


async def start_bot():
    bot = Bot(
        token=BOT_TOKEN,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML)
    )
    dp = Dispatcher(storage=MemoryStorage())

    # Register routers
    dp.include_router(menu.router)
    dp.include_router(expense.router)
    dp.include_router(debt.router)
    dp.include_router(list_handler.router)
    # Natural language catch-all — MUST be last
    dp.include_router(natural_lang.router)

    # Handle inline menu callbacks that redirect to commands
    from aiogram import F
    from aiogram.types import CallbackQuery

    @dp.callback_query(F.data == "menu_expense")
    async def cb_expense(cb: CallbackQuery):
        await cb.answer()
        await expense.cmd_xarajat(cb.message, None)

    @dp.callback_query(F.data == "menu_income")
    async def cb_income(cb: CallbackQuery):
        await cb.answer()
        await expense.cmd_daromad(cb.message, None)

    @dp.callback_query(F.data == "menu_debt")
    async def cb_debt(cb: CallbackQuery):
        await cb.answer()
        await debt.cmd_qarz(cb.message, None)

    @dp.callback_query(F.data == "menu_debts")
    async def cb_debts(cb: CallbackQuery):
        await cb.answer()
        cb.message.from_user = cb.from_user
        await debt.cmd_qarzlar(cb.message)

    @dp.callback_query(F.data == "menu_report")
    async def cb_report(cb: CallbackQuery):
        await cb.answer()
        cb.message.from_user = cb.from_user
        await list_handler.cmd_hisobot(cb.message)

    @dp.callback_query(F.data == "menu_last")
    async def cb_last(cb: CallbackQuery):
        await cb.answer()
        cb.message.from_user = cb.from_user
        await list_handler.cmd_oxirgi(cb.message)

    # Start scheduler
    setup_scheduler(bot)

    logging.info("Bot started!")
    await dp.start_polling(bot)


async def start_server():
    config = uvicorn.Config(
        fastapi_app,
        host="0.0.0.0",
        port=MINI_APP_PORT,
        log_level="warning"
    )
    server = uvicorn.Server(config)
    await server.serve()


async def main():
    await asyncio.gather(
        start_bot(),
        start_server(),
    )


if __name__ == "__main__":
    asyncio.run(main())
