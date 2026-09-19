import { Bot, InlineKeyboard } from "https://esm.sh/grammy@1.27.0";
import { ensureUser, addTransaction, addDebt, getDebts, getSummary } from "./db.ts";
import { categorizeTransaction, parseIntent } from "./ai.ts";

const BOT_TOKEN = Deno.env.get("BOT_TOKEN") || "";
const MINI_APP_URL = Deno.env.get("MINI_APP_URL") || "https://example.com";

export const bot = new Bot(BOT_TOKEN);

// /start command
bot.command("start", async (ctx) => {
    const user = ctx.from!;
    await ensureUser(user.id, user.username, user.first_name);

    const kb = new InlineKeyboard()
        .webApp("📊 Mini App", `${MINI_APP_URL}?user_id=${user.id}`)
        .row()
        .text("💸 Xarajat", "btn_expense")
        .text("💰 Daromad", "btn_income")
        .row()
        .text("💳 Qarz", "btn_debt")
        .text("📋 Qarzlar", "btn_debts")
        .row()
        .text("📊 Hisobot", "btn_report");

    await ctx.reply(
        `👋 Salom, <b>${user.first_name || "Do'stim"}</b>!\n\n` +
        `🏦 <b>Hisobla Bot</b> (Supabase Edge Function) ga xush kelibsiz!\n\n` +
        `Matn shaklida yozishingiz mumkin (masalan: <i>taksi 15000</i>).`,
        { parse_mode: "HTML", reply_markup: kb }
    );
});

// /xarajat command
bot.command("xarajat", async (ctx) => {
    const text = ctx.match;
    if (!text) {
        await ctx.reply("💸 Miqdor va tavsif kiriting:\n<i>Misol: /xarajat 50000 taksi</i>", { parse_mode: "HTML" });
        return;
    }
    await handleExpense(ctx, text);
});

// /daromad command
bot.command("daromad", async (ctx) => {
    const text = ctx.match;
    if (!text) {
        await ctx.reply("💰 Miqdor va tavsif kiriting:\n<i>Misol: /daromad 2000000 maosh</i>", { parse_mode: "HTML" });
        return;
    }
    await handleIncome(ctx, text);
});

// /hisobot command
bot.command("hisobot", async (ctx) => {
    await handleReport(ctx);
});

// /qarzlar command
bot.command("qarzlar", async (ctx) => {
    await handleDebtsList(ctx);
});

// Plain text / Natural Language handler
bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith("/")) return;

    const user = ctx.from;
    await ensureUser(user.id, user.username, user.first_name);

    const parsed = await parseIntent(text);

    if (parsed.intent === "expense" && parsed.amount) {
        await handleExpense(ctx, `${parsed.amount} ${parsed.description || text}`);
    } else if (parsed.intent === "income" && parsed.amount) {
        await handleIncome(ctx, `${parsed.amount} ${parsed.description || text}`);
    } else if (parsed.intent === "debt_gave" && parsed.person && parsed.amount) {
        await addDebt(user.id, "gave", parsed.person, Number(parsed.amount), text, parsed.due_date);
        await ctx.reply(`📤 <b>Qarz berganingiz saqlandi!</b>\n\n👤 ${parsed.person}: ${parsed.amount} so'm`, { parse_mode: "HTML" });
    } else if (parsed.intent === "debt_received" && parsed.person && parsed.amount) {
        await addDebt(user.id, "received", parsed.person, Number(parsed.amount), text, parsed.due_date);
        await ctx.reply(`📥 <b>Qarz olganingiz saqlandi!</b>\n\n👤 ${parsed.person}: ${parsed.amount} so'm`, { parse_mode: "HTML" });
    } else if (parsed.intent === "report") {
        await handleReport(ctx);
    } else if (parsed.intent === "debts_list") {
        await handleDebtsList(ctx);
    } else {
        await ctx.reply(
            "🤖 Tushunmadim. Misollar:\n" +
            "• <code>taksi 15000</code>\n" +
            "• <code>maosh 2000000</code>\n" +
            "• <code>Ali ga 500000 berdim</code>\n" +
            "• <code>hisobot</code>",
            { parse_mode: "HTML" }
        );
    }
});

async function handleExpense(ctx: any, text: string) {
    const user = ctx.from!;
    await ensureUser(user.id, user.username, user.first_name);

    const amountMatch = text.match(/\d+/);
    if (!amountMatch) {
        await ctx.reply("❌ Miqdor topilmadi.");
        return;
    }
    const amount = Number(amountMatch[0]);
    const description = text.replace(amountMatch[0], "").trim() || "Xarajat";

    const category = await categorizeTransaction(description, "expense");
    await addTransaction(user.id, "expense", amount, category, description);

    await ctx.reply(
        `💸 <b>Xarajat qo'shildi!</b>\n\n` +
        `💵 <b>Miqdor:</b> ${amount.toLocaleString()} so'm\n` +
        `📁 <b>Kategoriya:</b> ${category}\n` +
        `📝 <b>Tavsif:</b> ${description}`,
        { parse_mode: "HTML" }
    );
}

async function handleIncome(ctx: any, text: string) {
    const user = ctx.from!;
    await ensureUser(user.id, user.username, user.first_name);

    const amountMatch = text.match(/\d+/);
    if (!amountMatch) {
        await ctx.reply("❌ Miqdor topilmadi.");
        return;
    }
    const amount = Number(amountMatch[0]);
    const description = text.replace(amountMatch[0], "").trim() || "Daromad";

    const category = await categorizeTransaction(description, "income");
    await addTransaction(user.id, "income", amount, category, description);

    await ctx.reply(
        `💰 <b>Daromad qo'shildi!</b>\n\n` +
        `💵 <b>Miqdor:</b> ${amount.toLocaleString()} so'm\n` +
        `📁 <b>Kategoriya:</b> ${category}\n` +
        `📝 <b>Tavsif:</b> ${description}`,
        { parse_mode: "HTML" }
    );
}

async function handleReport(ctx: any) {
    const summary = await getSummary(ctx.from!.id);
    await ctx.reply(
        `📊 <b>Moliyaviy hisobot</b>\n\n` +
        `💰 <b>Daromad:</b> ${summary.totalIncome.toLocaleString()} so'm\n` +
        `💸 <b>Xarajat:</b> ${summary.totalExpense.toLocaleString()} so'm\n` +
        `📈 <b>Balans:</b> ${summary.balance.toLocaleString()} so'm`,
        { parse_mode: "HTML" }
    );
}

async function handleDebtsList(ctx: any) {
    const debts = await getDebts(ctx.from!.id);
    if (!debts.length) {
        await ctx.reply("✅ Faol qarzlar yo'q!");
        return;
    }
    let text = "💳 <b>Qarzlar ro'yxati:</b>\n\n";
    for (const d of debts) {
        const dir = d.direction === "gave" ? "📤 Bergan" : "📥 Olgan";
        text += `• <b>${d.person_name}</b>: ${Number(d.amount).toLocaleString()} so'm (${dir})\n`;
    }
    await ctx.reply(text, { parse_mode: "HTML" });
}
