import { webhookCallback } from "https://esm.sh/grammy@1.27.0";
import { bot } from "./bot.ts";
import { supabase, ensureUser, addTransaction, addDebt, getSummary, checkAndIncrementUsage, saveChatMessage, getChatHistory, updateLastDebtPerson, checkAndResolveRecentDebtPerson } from "./db.ts";
import { parseIntent, categorizeTransaction } from "./ai.ts";

const handleUpdate = webhookCallback(bot, "std/http");
// @ts-ignore Deno global
const ADMIN_SECRET = (globalThis as any).Deno?.env.get("ADMIN_SECRET") || "hisobla_admin_2024";
// @ts-ignore Deno global
const ADMIN_IDS_STR = (globalThis as any).Deno?.env.get("ADMIN_IDS") || ""; // e.g. "12345678,98765432"
const ALLOWED_ADMIN_IDS = ADMIN_IDS_STR.split(",").map((s: string) => s.trim()).filter(Boolean);

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

function jsonRes(data: any, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

function checkAdmin(req: Request, url: URL): boolean {
    const secret = url.searchParams.get("secret");
    const userId = url.searchParams.get("user_id");

    if (ALLOWED_ADMIN_IDS.length > 0) {
        if (userId && ALLOWED_ADMIN_IDS.includes(String(userId))) return true;
    }
    if (secret && secret === ADMIN_SECRET) return true;
    if (ALLOWED_ADMIN_IDS.length === 0 && (userId || secret)) return true;

    return false;
}

function checkAdminPost(body: any): boolean {
    if (!body) return false;
    const userId = body.admin_id || body.user_id;
    const secret = body.secret;

    if (ALLOWED_ADMIN_IDS.length > 0) {
        if (userId && ALLOWED_ADMIN_IDS.includes(String(userId))) return true;
    }
    if (secret && secret === ADMIN_SECRET) return true;
    if (ALLOWED_ADMIN_IDS.length === 0 && (userId || secret)) return true;

    return false;
}

Deno.serve(async (req) => {
    const url = new URL(req.url);

    // Handle CORS preflight
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    // API Endpoint: Pay / Settle Debt
    if (req.method === "POST" && url.pathname.endsWith("/api/debts/pay")) {
        try {
            const body = await req.json();
            const { debt_id, user_id } = body;

            if (debt_id && user_id) {
                // Fetch debt details first
                const { data: debt } = await supabase
                    .from("debts")
                    .select("*")
                    .eq("id", debt_id)
                    .eq("user_id", user_id)
                    .single();

                if (debt) {
                    // Mark debt as paid
                    await supabase
                        .from("debts")
                        .update({ is_paid: true })
                        .eq("id", debt_id);

                    // Add transaction & adjust balance automatically
                    if (debt.direction === "received") {
                        // I borrowed money and now paid it back -> EXPENSE
                        await supabase.from("transactions").insert({
                            user_id: user_id,
                            type: "expense",
                            amount: debt.amount,
                            category: "Qarz to'lovi",
                            description: `${debt.person_name} ga qarz to'landi`,
                        });
                    } else if (debt.direction === "gave") {
                        // I gave debt and now received it back -> INCOME
                        await supabase.from("transactions").insert({
                            user_id: user_id,
                            type: "income",
                            amount: debt.amount,
                            category: "Qarz qaytishi",
                            description: `${debt.person_name} dan qarz qaytdi`,
                        });
                    }

                    return new Response(JSON.stringify({ success: true }), {
                        headers: { ...corsHeaders, "Content-Type": "application/json" },
                    });
                }
            }
        } catch (e) {
            console.error("Pay debt error:", e);
        }
        return new Response(JSON.stringify({ success: false }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    // API Endpoint: Process Text / Voice Intent via Groq AI
    if (req.method === "POST" && url.pathname.endsWith("/api/intent")) {
        try {
            const body = await req.json();
            const { text, user_id } = body;

            if (!text || !user_id) {
                return jsonRes({ error: "Text va user_id kerak" }, 400);
            }

            const canUse = await checkAndIncrementUsage(user_id);
            if (!canUse) {
                return jsonRes({ error: "Haftalik limit tugadi!", limit_reached: true }, 403);
            }

            await saveChatMessage(user_id, "user", text);

            // 1. Direct debt target resolver check
            const resolvedDebt = await checkAndResolveRecentDebtPerson(user_id, text);
            if (resolvedDebt) {
                const msg = `✅ Qarz egasi "${resolvedDebt.person_name}" deb saqlandi! (${Number(resolvedDebt.amount).toLocaleString()} so'm)`;
                await saveChatMessage(user_id, "assistant", msg);
                return jsonRes({ success: true, intent: "update_last_debt", message: msg });
            }

            const chatHistory = await getChatHistory(user_id, 15);
            const summary = await getSummary(user_id);
            const parsed = await parseIntent(text, summary, chatHistory);

            if (parsed.intent === "update_last_debt" && parsed.person) {
                const updated = await updateLastDebtPerson(user_id, parsed.person);
                const msg = updated
                    ? `✅ Qarz egasi "${parsed.person}" deb saqlandi! (${Number(updated.amount).toLocaleString()} so'm)`
                    : `✅ Qarz egasi "${parsed.person}" deb saqlandi!`;
                await saveChatMessage(user_id, "assistant", msg);
                return jsonRes({ success: true, intent: "update_last_debt", message: msg });
            } else if (parsed.intent === "expense" && parsed.amount) {
                const category = await categorizeTransaction(parsed.description || text, "expense");
                await addTransaction(user_id, "expense", parsed.amount, category, parsed.description || text);
                const msg = `💸 ${category}: ${Number(parsed.amount).toLocaleString()} so'm qo'shildi`;
                await saveChatMessage(user_id, "assistant", msg);
                return jsonRes({ success: true, intent: "expense", message: msg });
            } else if (parsed.intent === "income" && parsed.amount) {
                const category = await categorizeTransaction(parsed.description || text, "income");
                await addTransaction(user_id, "income", parsed.amount, category, parsed.description || text);
                const msg = `💰 ${category}: ${Number(parsed.amount).toLocaleString()} so'm qo'shildi`;
                await saveChatMessage(user_id, "assistant", msg);
                return jsonRes({ success: true, intent: "income", message: msg });
            } else if (parsed.intent === "debt_gave" && parsed.person && parsed.amount) {
                await addDebt(user_id, "gave", parsed.person, Number(parsed.amount), text, parsed.due_date);
                await addTransaction(user_id, "expense", Number(parsed.amount), `${parsed.person} (Qarz)`, `${parsed.person} ga qarz berildi`);
                const msg = `📤 ${parsed.person} ga ${Number(parsed.amount).toLocaleString()} so'm qarz saqlandi`;
                await saveChatMessage(user_id, "assistant", msg);
                return jsonRes({ success: true, intent: "debt_gave", message: msg });
            } else if (parsed.intent === "debt_received" && parsed.person && parsed.amount) {
                await addDebt(user_id, "received", parsed.person, Number(parsed.amount), text, parsed.due_date);
                await addTransaction(user_id, "income", Number(parsed.amount), `${parsed.person} (Qarz)`, `${parsed.person} dan qarz olindi`);
                const msg = `📥 ${parsed.person} dan ${Number(parsed.amount).toLocaleString()} so'm qarz saqlandi`;
                await saveChatMessage(user_id, "assistant", msg);
                return jsonRes({ success: true, intent: "debt_received", message: msg });
            } else {
                const msg = parsed.reply || "🤖 Tushundim!";
                await saveChatMessage(user_id, "assistant", msg);
                return jsonRes({ success: true, intent: "ai_reply", message: msg });
            }
        } catch (e: any) {
            console.error("Process intent API error:", e);
            return jsonRes({ error: "Xatolik yuz berdi" }, 500);
        }
    }

    // API Endpoint: Delete Transaction
    if ((req.method === "POST" || req.method === "DELETE") && url.pathname.endsWith("/api/transactions/delete")) {
        try {
            const body = await req.json();
            const { id, user_id } = body;

            if (id && user_id) {
                await supabase
                    .from("transactions")
                    .delete()
                    .eq("id", id)
                    .eq("user_id", user_id);

                return new Response(JSON.stringify({ success: true }), {
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                });
            }
        } catch (e) {
            console.error("Delete transaction error:", e);
        }
        return new Response(JSON.stringify({ success: false }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    // API Endpoints (GET Requests)
    if (req.method === "GET") {
        const userId = Number(url.searchParams.get("user_id"));

        if (url.pathname.endsWith("/api/transactions")) {
            if (!userId) {
                return new Response(JSON.stringify([]), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }
            const { data } = await supabase
                .from("transactions")
                .select("*")
                .eq("user_id", userId)
                .order("created_at", { ascending: false });
            return new Response(JSON.stringify(data || []), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        if (url.pathname.endsWith("/api/debts")) {
            if (!userId) {
                return new Response(JSON.stringify([]), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }
            const includePaid = url.searchParams.get("include_paid") === "true";

            let query = supabase.from("debts").select("*").eq("user_id", userId);
            if (!includePaid) {
                query = query.eq("is_paid", false);
            }
            const { data } = await query.order("due_date", { ascending: true });

            return new Response(JSON.stringify(data || []), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        if (url.pathname.endsWith("/api/summary")) {
            if (!userId) {
                return new Response(
                    JSON.stringify({ total_income: 0, total_expense: 0, balance: 0, categories: [] }),
                    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }
            const { data } = await supabase
                .from("transactions")
                .select("*")
                .eq("user_id", userId);

            const { data: userData } = await supabase.from("users").select("is_premium, premium_expires_at, usage_count").eq("user_id", userId).single();

            let isPremium = userData?.is_premium || false;
            let premiumExpiresAt = userData?.premium_expires_at || null;

            if (isPremium && premiumExpiresAt) {
                if (new Date(premiumExpiresAt) <= new Date()) {
                    isPremium = false;
                    await supabase.from("users").update({ is_premium: false }).eq("user_id", userId);
                }
            }

            // Fetch premium history if available
            let premiumHistory = [];
            try {
                const { data: hist } = await supabase.from("premium_history")
                    .select("*")
                    .eq("user_id", userId)
                    .order("created_at", { ascending: false });
                if (hist) premiumHistory = hist;
            } catch (e) {
                // Ignore if table does not exist yet
            }

            const transactions = data || [];
            const totalIncome = transactions
                .filter((t) => t.type === "income")
                .reduce((sum, t) => sum + Number(t.amount), 0);
            const totalExpense = transactions
                .filter((t) => t.type === "expense")
                .reduce((sum, t) => sum + Number(t.amount), 0);
            const balance = totalIncome - totalExpense;

            const catMap: Record<string, number> = {};
            transactions.forEach((t) => {
                const key = `${t.type}:${t.category}`;
                catMap[key] = (catMap[key] || 0) + Number(t.amount);
            });

            const categories = Object.keys(catMap).map((key) => {
                const [type, category] = key.split(":");
                return { type, category, total: catMap[key] };
            });

            return new Response(
                JSON.stringify({
                    total_income: totalIncome,
                    total_expense: totalExpense,
                    balance,
                    categories,
                    is_premium: isPremium,
                    premium_expires_at: premiumExpiresAt,
                    usage_count: userData?.usage_count || 0,
                    weekly_limit: 10,
                    premium_history: premiumHistory,
                }),
                { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }
    }

    // ═══════════════════════════════════════════════════════════
    // ADMIN API ENDPOINTS
    // ═══════════════════════════════════════════════════════════

    // GET /api/admin/stats
    if (req.method === "GET" && url.pathname.endsWith("/api/admin/stats")) {
        if (!checkAdmin(req, url)) return jsonRes({ error: "Unauthorized" }, 401);

        const { count: totalUsers } = await supabase.from("users").select("*", { count: "exact", head: true });
        const { count: premiumUsers } = await supabase.from("users").select("*", { count: "exact", head: true }).eq("is_premium", true);
        const { count: totalTransactions } = await supabase.from("transactions").select("*", { count: "exact", head: true });
        const { count: activeCoupons } = await supabase.from("coupons").select("*", { count: "exact", head: true }).eq("is_active", true);

        return jsonRes({
            total_users: totalUsers || 0,
            premium_users: premiumUsers || 0,
            total_transactions: totalTransactions || 0,
            active_coupons: activeCoupons || 0,
        });
    }

    // GET /api/admin/users
    if (req.method === "GET" && url.pathname.endsWith("/api/admin/users")) {
        if (!checkAdmin(req, url)) return jsonRes({ error: "Unauthorized" }, 401);

        const { data } = await supabase.from("users").select("*").order("created_at", { ascending: false });
        return jsonRes(data || []);
    }

    // GET /api/admin/transactions
    if (req.method === "GET" && url.pathname.endsWith("/api/admin/transactions")) {
        if (!checkAdmin(req, url)) return jsonRes({ error: "Unauthorized" }, 401);

        const { data } = await supabase.from("transactions").select("*").order("created_at", { ascending: false }).limit(50);
        return jsonRes(data || []);
    }

    // POST /api/admin/toggle-premium
    if (req.method === "POST" && url.pathname.endsWith("/api/admin/toggle-premium")) {
        try {
            const body = await req.json();
            if (!checkAdminPost(body)) return jsonRes({ error: "Unauthorized" }, 401);

            await supabase.from("users").update({ is_premium: body.is_premium }).eq("user_id", body.user_id);
            return jsonRes({ success: true });
        } catch (e) {
            return jsonRes({ error: "Failed" }, 400);
        }
    }

    // POST /api/admin/reset-usage
    if (req.method === "POST" && url.pathname.endsWith("/api/admin/reset-usage")) {
        try {
            const body = await req.json();
            if (!checkAdminPost(body)) return jsonRes({ error: "Unauthorized" }, 401);

            await supabase.from("users").update({
                usage_count: 0,
                usage_reset_date: new Date().toISOString(),
            }).eq("user_id", body.user_id);
            return jsonRes({ success: true });
        } catch (e) {
            return jsonRes({ error: "Failed" }, 400);
        }
    }

    // GET /api/admin/coupons
    if (req.method === "GET" && url.pathname.endsWith("/api/admin/coupons")) {
        if (!checkAdmin(req, url)) return jsonRes({ error: "Unauthorized" }, 401);

        const { data } = await supabase.from("coupons").select("*").order("created_at", { ascending: false });
        return jsonRes(data || []);
    }

    // POST /api/admin/coupons/create
    if (req.method === "POST" && url.pathname.endsWith("/api/admin/coupons/create")) {
        try {
            const body = await req.json();
            if (!checkAdminPost(body)) return jsonRes({ error: "Unauthorized" }, 401);

            // Check if code already exists
            const { data: existing } = await supabase.from("coupons").select("id").eq("code", body.code).single();
            if (existing) return jsonRes({ error: "Bu kod allaqachon mavjud!" }, 400);

            const { error } = await supabase.from("coupons").insert({
                code: body.code,
                plan: body.plan,
                max_uses: body.max_uses || 1,
                expires_at: body.expires_at || null,
                is_active: true,
            });

            if (error) return jsonRes({ error: error.message }, 400);
            return jsonRes({ success: true });
        } catch (e) {
            return jsonRes({ error: "Failed" }, 400);
        }
    }

    // POST /api/admin/coupons/toggle
    if (req.method === "POST" && url.pathname.endsWith("/api/admin/coupons/toggle")) {
        try {
            const body = await req.json();
            if (!checkAdminPost(body)) return jsonRes({ error: "Unauthorized" }, 401);

            await supabase.from("coupons").update({ is_active: body.is_active }).eq("id", body.coupon_id);
            return jsonRes({ success: true });
        } catch (e) {
            return jsonRes({ error: "Failed" }, 400);
        }
    }

    // POST /api/admin/coupons/delete
    if (req.method === "POST" && url.pathname.endsWith("/api/admin/coupons/delete")) {
        try {
            const body = await req.json();
            if (!checkAdminPost(body)) return jsonRes({ error: "Unauthorized" }, 401);

            await supabase.from("coupons").delete().eq("id", body.coupon_id);
            return jsonRes({ success: true });
        } catch (e) {
            return jsonRes({ error: "Failed" }, 400);
        }
    }

    // POST /api/admin/broadcast
    if (req.method === "POST" && url.pathname.endsWith("/api/admin/broadcast")) {
        try {
            const body = await req.json();
            if (!checkAdminPost(body)) return jsonRes({ error: "Unauthorized" }, 401);

            const { target, message } = body;
            if (!message) return jsonRes({ error: "Message is required" }, 400);

            let query = supabase.from("users").select("user_id");
            if (target === "premium") query = query.eq("is_premium", true);
            else if (target === "free") query = query.eq("is_premium", false);

            const { data: users, error } = await query;
            if (error || !users) return jsonRes({ error: "Foydalanuvchilarni olishda xatolik" }, 400);

            let sent = 0;
            // Send asynchronously to avoid function timeout
            for (const u of users) {
                if (u.user_id) {
                    try {
                        await bot.api.sendMessage(u.user_id, message, { parse_mode: "HTML" });
                        sent++;
                    } catch (err: any) {
                        const status = err.error_code || err.response?.status;
                        // User blocked bot or deleted account, logic handles graceful failure
                        if (status === 403) {
                            // Optionally flag user as inactive in DB
                        }
                    }
                }
            }

            return jsonRes({ success: true, sent, total_attempted: users.length });
        } catch (e: any) {
            console.error("Broadcast Error:", e);
            return jsonRes({ error: "Failed to broadcast" }, 400);
        }
    }

    // POST /api/coupon/activate (for end-users via Mini App)
    if (req.method === "POST" && url.pathname.endsWith("/api/coupon/activate")) {
        try {
            const body = await req.json();
            const { code, user_id } = body;
            if (!code || !user_id) return jsonRes({ error: "Kod va user_id kerak" }, 400);

            // Find active coupon
            const { data: coupon } = await supabase.from("coupons")
                .select("*")
                .eq("code", code.toUpperCase())
                .eq("is_active", true)
                .single();

            if (!coupon) return jsonRes({ error: "Kupon topilmadi yoki nofaol" }, 404);

            // Check expiry
            if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
                return jsonRes({ error: "Kupon muddati o'tib ketgan" }, 400);
            }

            // Check usage
            if (coupon.used_count >= coupon.max_uses) {
                return jsonRes({ error: "Kupon limiti tugagan" }, 400);
            }

            const discount = coupon.discount_percent ?? 100;

            // Calculate premium duration
            const planDays: Record<string, number> = {
                "1_month": 30, "3_months": 90, "6_months": 180,
                "1_year": 365, "lifetime": 36500,
            };
            const days = planDays[coupon.plan] || 30;

            if (discount === 100) {
                // If 100% discount, activate premium immediately
                // Calculate expiry from now or extend existing
                const { data: userObj } = await supabase.from("users").select("premium_expires_at").eq("user_id", user_id).single();
                let newExpiry = new Date();
                if (userObj?.premium_expires_at && new Date(userObj.premium_expires_at) > new Date()) {
                    newExpiry = new Date(userObj.premium_expires_at);
                }
                newExpiry.setDate(newExpiry.getDate() + days);

                await supabase.from("users").update({
                    is_premium: true,
                    usage_count: 0,
                    premium_expires_at: newExpiry.toISOString()
                }).eq("user_id", user_id);
            }

            // Increment usage
            await supabase.from("coupons").update({
                used_count: coupon.used_count + 1,
            }).eq("id", coupon.id);

            return jsonRes({ success: true, plan: coupon.plan, days, discount });
        } catch (e) {
            return jsonRes({ error: "Xatolik yuz berdi" }, 400);
        }
    }

    // POST /api/premium/test-buy (Activate 10s test premium instantly)
    if (req.method === "POST" && url.pathname.endsWith("/api/premium/test-buy")) {
        try {
            const body = await req.json();
            const { user_id, seconds = 10 } = body;
            if (!user_id) return jsonRes({ error: "user_id kerak" }, 400);

            const newExpiry = new Date(Date.now() + seconds * 1000);

            await supabase.from("users").update({
                is_premium: true,
                usage_count: 0,
                premium_expires_at: newExpiry.toISOString()
            }).eq("user_id", user_id);

            try {
                await supabase.from("premium_history").insert({
                    user_id: user_id,
                    plan: "10_seconds_test",
                    days: 0,
                    expires_at: newExpiry.toISOString(),
                });
            } catch (e) {
                // Ignore if history table not created yet
            }

            return jsonRes({ success: true, seconds, expires_at: newExpiry.toISOString() });
        } catch (e) {
            return jsonRes({ error: "Xatolik yuz berdi" }, 400);
        }
    }

    // Telegram Webhook Handler (POST)
    if (req.method === "POST") {
        try {
            return await handleUpdate(req);
        } catch (err) {
            console.error("Webhook processing error:", err);
            return new Response("OK", { status: 200, headers: corsHeaders });
        }
    }

    return new Response("Hisobla Telegram Bot Edge Function API is running!", {
        headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
    });
});
