import os
import logging
from fastapi import FastAPI, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

from bot.database import get_summary, get_transactions, get_debts

app = FastAPI(title="Hisobla API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve Mini App static files
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MINI_APP_DIR = os.path.join(BASE_DIR, "mini_app")


@app.get("/api/summary/{user_id}")
async def api_summary(user_id: int):
    return await get_summary(user_id)


@app.get("/api/transactions/{user_id}")
async def api_transactions(user_id: int, limit: int = 50, type: str = Query(None)):
    return await get_transactions(user_id, limit=limit, type_filter=type)


@app.get("/api/debts/{user_id}")
async def api_debts(user_id: int):
    debts = await get_debts(user_id, only_unpaid=True)
    from datetime import date
    today = date.today()
    for d in debts:
        if d.get("due_date"):
            due = date.fromisoformat(d["due_date"])
            d["days_remaining"] = (due - today).days
        else:
            d["days_remaining"] = None
    return debts


@app.get("/", include_in_schema=False)
async def serve_index():
    return FileResponse(os.path.join(MINI_APP_DIR, "index.html"))


# Mount static files last
app.mount("/", StaticFiles(directory=MINI_APP_DIR, html=True), name="static")
