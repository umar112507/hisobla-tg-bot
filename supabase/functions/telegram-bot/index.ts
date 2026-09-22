import { webhookCallback } from "https://esm.sh/grammy@1.27.0";
import { bot } from "./bot.ts";
import { supabase, getProfileAndDefaultAccount, addTransaction, addDebt, getSummary, checkAndIncrementUsage, saveChatMessage, getChatHistory, updateLastDebtPerson, checkAndResolveRecentDebtPerson, ensureCategory, isUUID } from "./db.ts";
import { parseIntent, categorizeTransaction } from "./ai.ts";

const handleUpdate = webhookCallback(bot, "std/http");
// @ts-ignore Deno global
const ADMIN_SECRET = (globalThis as any).Deno?.env.get("ADMIN_SECRET") || "hisobla_admin_2024";
// @ts-ignore Deno global
const ADMIN_IDS_STR = (globalThis as any).Deno?.env.get("ADMIN_IDS") || "";
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

    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    // API Endpoint: Pay / Settle Debt
    if (req.method === "POST" && url.pathname.endsWith("/api/debts/pay")) {
        try {
            const body = await req.json();
            const { debt_id, user_id } = body;

            if (debt_id && user_id) {
                const { profileId, accountId } = await getProfileAndDefaultAccount(user_id);

                const { data: debt } = await supabase
                    .from("debts")
                    .select("*")
                    .eq("id", debt_id)
                    .eq("user_id", profileId)
                    .single();

                if (debt) {
                    await supabase
                        .from("debts")
                        .update({ status: "paid" })
                        .eq("id", debt_id);

                    const amount = Number(debt.amount_uzs || debt.amount || 0);

                    if (debt.type === "received") {
                        // I borrowed money and paid back -> EXPENSE
                        const catId = await ensureCategory(profileId, "Qarz to'lovi", "expense");
                        await supabase.from("transactions").insert({
                            user_id: profileId,
                            account_id: accountId,
                            category_id: catId || null,
                            amount_uzs: amount,
                            type: "expense",
                            description: `${debt.person_name} ga qarz to'landi`,
                        });
                    } else if (debt.type === "gave") {
                        // I gave debt and received back -> INCOME
                        const catId = await ensureCategory(profileId, "Qarz qaytishi", "income");
                        await supabase.from("transactions").insert({
                            user_id: profileId,
                            account_id: accountId,
                            category_id: catId || null,
                            amount_uzs: amount,
                            type: "income",
                            description: `${debt.person_name} dan qarz qaytdi`,
                        });
                    }

                    return jsonRes({ success: true });
                }
            }
        } catch (e) {
            console.error("Pay debt error:", e);
        }
        return jsonRes({ success: false }, 400);
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
                await addTransaction(user_id, "income", Number(parsed.amount), `${parsed.person} dan qarz olindi`, `${parsed.person} dan qarz olindi`);
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
                const { profileId } = await getProfileAndDefaultAccount(user_id);
                await supabase
                    .from("transactions")
                    .delete()
                    .eq("id", id)
                    .eq("user_id", profileId);

                return jsonRes({ success: true });
            }
        } catch (e) {
            console.error("Delete transaction error:", e);
        }
        return jsonRes({ success: false }, 400);
    }

    // API Endpoints (GET Requests)
    if (req.method === "GET") {
        const userInput = url.searchParams.get("user_id");

        if (url.pathname.endsWith("/api/transactions")) {
            if (!userInput) {
                return jsonRes([]);
            }
            try {
                const { profileId } = await getProfileAndDefaultAccount(userInput);
                const { data } = await supabase
                    .from("transactions")
                    .select("*, categories(name)")
                    .eq("user_id", profileId)
                    .order("created_at", { ascending: false });

                const formatted = (data || []).map(t => ({
                    id: t.id,
                    type: t.type,
                    amount: Number(t.amount_uzs || 0),
                    category: t.categories?.name || "Boshqa",
                    description: t.description || "",
                    created_at: t.created_at,
                }));
                return jsonRes(formatted);
            } catch (e) {
                return jsonRes([]);
            }
        }

        if (url.pathname.endsWith("/api/debts")) {
            if (!userInput) {
                return jsonRes([]);
            }
            try {
                const { profileId } = await getProfileAndDefaultAccount(userInput);
                const includePaid = url.searchParams.get("include_paid") === "true";

                let query = supabase.from("debts").select("*").eq("user_id", profileId);
                if (!includePaid) {
                    query = query.or("status.eq.unpaid,status.is.null");
                }
                const { data } = await query.order("due_date", { ascending: true });

                const formatted = (data || []).map(d => ({
                    id: d.id,
                    person_name: d.person_name,
                    amount: Number(d.amount_uzs || d.amount || 0),
                    direction: d.type || "gave",
                    description: d.description,
                    due_date: d.due_date,
                    is_paid: d.status === "paid",
                    created_at: d.created_at,
                }));
                return jsonRes(formatted);
            } catch (e) {
                return jsonRes([]);
            }
        }

        if (url.pathname.endsWith("/api/summary")) {
            if (!userInput) {
                return jsonRes({ total_income: 0, total_expense: 0, balance: 0, categories: [] });
            }
            try {
                const { profileId } = await getProfileAndDefaultAccount(userInput);

                const { data: txData } = await supabase
                    .from("transactions")
                    .select("*, categories(name)")
                    .eq("user_id", profileId);

                const { data: profile } = await supabase
                    .from("profiles")
                    .select("is_pro, pro_expires_at")
                    .eq("id", profileId)
                    .single();

                let isPro = profile?.is_pro || false;
                let proExpiresAt = profile?.pro_expires_at || null;

                if (isPro && proExpiresAt) {
                    if (new Date(proExpiresAt) <= new Date()) {
                        isPro = false;
                        await supabase.from("profiles").update({ is_pro: false }).eq("id", profileId);
                    }
                }

                const transactions = txData || [];
                const totalIncome = transactions
                    .filter((t) => t.type === "income")
                    .reduce((sum, t) => sum + Number(t.amount_uzs || 0), 0);
                const totalExpense = transactions
                    .filter((t) => t.type === "expense")
                    .reduce((sum, t) => sum + Number(t.amount_uzs || 0), 0);
                const balance = totalIncome - totalExpense;

                const catMap: Record<string, number> = {};
                transactions.forEach((t) => {
                    const catName = t.categories?.name || "Boshqa";
                    const key = `${t.type}:${catName}`;
                    catMap[key] = (catMap[key] || 0) + Number(t.amount_uzs || 0);
                });

                const categories = Object.keys(catMap).map((key) => {
                    const [type, category] = key.split(":");
                    return { type, category, total: catMap[key] };
                });

                return jsonRes({
                    total_income: totalIncome,
                    total_expense: totalExpense,
                    balance,
                    categories,
                    is_premium: isPro,
                    premium_expires_at: proExpiresAt,
                    usage_count: 0,
                    weekly_limit: 10,
                });
            } catch (e) {
                return jsonRes({ total_income: 0, total_expense: 0, balance: 0, categories: [] });
            }
        }
    }

    // ADMIN API ENDPOINTS
    if (req.method === "GET" && url.pathname.endsWith("/api/admin/stats")) {
        if (!checkAdmin(req, url)) return jsonRes({ error: "Unauthorized" }, 401);

        const { count: totalUsers } = await supabase.from("profiles").select("*", { count: "exact", head: true });
        const { count: premiumUsers } = await supabase.from("profiles").select("*", { count: "exact", head: true }).eq("is_pro", true);
        const { count: totalTransactions } = await supabase.from("transactions").select("*", { count: "exact", head: true });
        const { count: activeCoupons } = await supabase.from("referral_codes").select("*", { count: "exact", head: true }).eq("active", true);

        return jsonRes({
            total_users: totalUsers || 0,
            premium_users: premiumUsers || 0,
            total_transactions: totalTransactions || 0,
            active_coupons: activeCoupons || 0,
        });
    }

    if (req.method === "GET" && url.pathname.endsWith("/api/admin/users")) {
        if (!checkAdmin(req, url)) return jsonRes({ error: "Unauthorized" }, 401);

        const { data } = await supabase.from("profiles").select("*").order("updated_at", { ascending: false });
        return jsonRes(data || []);
    }

    if (req.method === "GET" && url.pathname.endsWith("/api/admin/transactions")) {
        if (!checkAdmin(req, url)) return jsonRes({ error: "Unauthorized" }, 401);

        const { data } = await supabase.from("transactions").select("*, categories(name)").order("created_at", { ascending: false }).limit(50);
        return jsonRes(data || []);
    }

    if (req.method === "POST" && url.pathname.endsWith("/api/admin/toggle-premium")) {
        try {
            const body = await req.json();
            if (!checkAdminPost(body)) return jsonRes({ error: "Unauthorized" }, 401);

            const { profileId } = await getProfileAndDefaultAccount(body.user_id);
            await supabase.from("profiles").update({ is_pro: body.is_premium }).eq("id", profileId);
            return jsonRes({ success: true });
        } catch (e) {
            return jsonRes({ error: "Failed" }, 400);
        }
    }

    if (req.method === "GET" && url.pathname.endsWith("/api/admin/coupons")) {
        if (!checkAdmin(req, url)) return jsonRes({ error: "Unauthorized" }, 401);

        const { data } = await supabase.from("referral_codes").select("*").order("created_at", { ascending: false });
        return jsonRes(data || []);
    }

    if (req.method === "POST" && url.pathname.endsWith("/api/admin/coupons/create")) {
        try {
            const body = await req.json();
            if (!checkAdminPost(body)) return jsonRes({ error: "Unauthorized" }, 401);

            const { data: existing } = await supabase.from("referral_codes").select("id").eq("code", body.code).single();
            if (existing) return jsonRes({ error: "Bu kod allaqachon mavjud!" }, 400);

            const { error } = await supabase.from("referral_codes").insert({
                code: body.code,
                discount_percent: body.discount_percent || 100,
                uses_left: body.max_uses || 1,
                active: true,
                discount_month: body.discount_month || 1,
            });

            if (error) return jsonRes({ error: error.message }, 400);
            return jsonRes({ success: true });
        } catch (e) {
            return jsonRes({ error: "Failed" }, 400);
        }
    }

    // POST /api/coupon/activate
    if (req.method === "POST" && url.pathname.endsWith("/api/coupon/activate")) {
        try {
            const body = await req.json();
            const { code, user_id } = body;
            if (!code || !user_id) return jsonRes({ error: "Kod va user_id kerak" }, 400);

            const { profileId } = await getProfileAndDefaultAccount(user_id);

            const { data: coupon } = await supabase.from("referral_codes")
                .select("*")
                .eq("code", code.toUpperCase())
                .eq("active", true)
                .single();

            if (!coupon) return jsonRes({ error: "Kupon topilmadi yoki nofaol" }, 404);

            if (coupon.uses_left <= 0) {
                return jsonRes({ error: "Kupon limiti tugagan" }, 400);
            }

            const discount = coupon.discount_percent ?? 100;
            const months = coupon.discount_month || 1;

            if (discount === 100) {
                const { data: prof } = await supabase.from("profiles").select("pro_expires_at").eq("id", profileId).single();
                let newExpiry = new Date();
                if (prof?.pro_expires_at && new Date(prof.pro_expires_at) > new Date()) {
                    newExpiry = new Date(prof.pro_expires_at);
                }
                newExpiry.setMonth(newExpiry.getMonth() + months);

                await supabase.from("profiles").update({
                    is_pro: true,
                    pro_expires_at: newExpiry.toISOString()
                }).eq("id", profileId);
            }

            await supabase.from("referral_codes").update({
                uses_left: Math.max(0, coupon.uses_left - 1),
            }).eq("id", coupon.id);

            return jsonRes({ success: true, days: months * 30, discount });
        } catch (e) {
            return jsonRes({ error: "Xatolik yuz berdi" }, 400);
        }
    }

    // POST /api/inpay/create-payment
    if (req.method === "POST" && url.pathname.endsWith("/api/inpay/create-payment")) {
        try {
            const body = await req.json();
            const { user_id, plan } = body;
            if (!user_id || !plan) return jsonRes({ error: "user_id va plan kerak" }, 400);

            const { profileId } = await getProfileAndDefaultAccount(user_id);

            const INPAY_MERCHANT_ID = Deno.env.get("INPAY_MERCHANT_ID") || "12313";
            const INPAY_MERCHANT_TOKEN = Deno.env.get("INPAY_MERCHANT_TOKEN") || "c6051ee8b0e7eb8b7cfa77349a17afbb";
            const WEBHOOK_BASE = Deno.env.get("SUPABASE_URL") || "";

            const prices: Record<string, { amount: number; months: number; title: string }> = {
                "1_month": { amount: 15000, months: 1, title: "Hisobla Premium 1 oy" },
                "3_months": { amount: 40000, months: 3, title: "Hisobla Premium 3 oy" },
                "6_months": { amount: 70000, months: 6, title: "Hisobla Premium 6 oy" },
                "1_year": { amount: 130000, months: 12, title: "Hisobla Premium 1 yil" },
                "lifetime": { amount: 300000, months: 1200, title: "Hisobla Premium Umrbod" },
            };

            const planInfo = prices[plan];
            if (!planInfo) return jsonRes({ error: "Noto'g'ri tarif" }, 400);

            const authRes = await fetch(
                `https://inpay.uz/api/v1/authorization/?merchant_id=${INPAY_MERCHANT_ID}&merchant_token=${INPAY_MERCHANT_TOKEN}`,
                { headers: { "Accept": "application/json" } }
            );
            const authData = await authRes.json();

            if (!authData.success || !authData.bearer_token) {
                return jsonRes({ error: "Inpay autentifikatsiya xatosi", details: authData }, 500);
            }

            const bearerToken = authData.bearer_token;
            const callbackUrl = `${WEBHOOK_BASE}/functions/v1/inpay-webhook`;

            const createRes = await fetch("https://inpay.uz/api/v1/create/", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${bearerToken}`,
                },
                body: JSON.stringify({
                    merchant_id: INPAY_MERCHANT_ID,
                    token: INPAY_MERCHANT_TOKEN,
                    amount: planInfo.amount,
                    description: `${planInfo.title} — User #${user_id}`,
                    callback_url: callbackUrl,
                }),
            });
            const createData = await createRes.json();

            if (!createData.success || !createData.pay_url) {
                return jsonRes({ error: "Inpay to'lov yaratishda xato", details: createData }, 500);
            }

            const orderId = createData.order_id;
            await supabase.from("payments").insert({
                profile_id: profileId,
                amount: planInfo.amount,
                months: planInfo.months,
                type: "inpay",
                status: "pending",
                metadata: { order_id: orderId, plan },
            });

            return jsonRes({
                success: true,
                pay_url: createData.pay_url,
                order_id: orderId,
            });
        } catch (e: any) {
            console.error("Inpay create-payment error:", e);
            return jsonRes({ error: "Server xatosi: " + (e.message || "") }, 500);
        }
    }

    // Telegram Webhook Handler
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
