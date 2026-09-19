import { webhookCallback } from "https://esm.sh/grammy@1.27.0";
import { bot } from "./bot.ts";
import { supabase } from "./db.ts";

const handleUpdate = webhookCallback(bot, "std/http");

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

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
                }),
                { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
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
