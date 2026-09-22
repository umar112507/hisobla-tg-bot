import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const BOT_TOKEN = Deno.env.get("BOT_TOKEN") || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

serve(async (req: Request) => {
    // CORS
    if (req.method === "OPTIONS") {
        return new Response("ok", {
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
                "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
            },
        });
    }

    try {
        // Inpay sends POST with JSON body
        let payload: any = {};

        if (req.method === "POST") {
            const contentType = req.headers.get("content-type") || "";
            if (contentType.includes("application/json")) {
                payload = await req.json();
            } else {
                const text = await req.text();
                try {
                    payload = JSON.parse(text);
                } catch {
                    payload = Object.fromEntries(new URLSearchParams(text));
                }
            }
        } else {
            const url = new URL(req.url);
            for (const [key, value] of url.searchParams.entries()) {
                payload[key] = value;
            }
        }

        console.log("Inpay webhook received:", JSON.stringify(payload));

        // Inpay webhook fields: amount, status, order_id, transaction_id, created_at
        const orderId = payload.order_id;
        const status = String(payload.status || "").toLowerCase();
        const inpayTransId = String(payload.transaction_id || "");
        const amount = payload.amount;

        if (!orderId) {
            return new Response(JSON.stringify({ error: "Missing order_id" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }

        // Check if payment is successful
        const isPaid = status === "success";
        const isFailed = status === "failed" || status === "cancelled";

        if (isFailed) {
            await supabase.from("payments").update({
                status: "failed",
                inpay_trans_id: inpayTransId,
                updated_at: new Date().toISOString(),
            }).eq("order_id", orderId);

            // Must return 200 for Inpay
            return new Response("OK", { status: 200 });
        }

        if (!isPaid) {
            console.log(`Payment status for order ${orderId}: ${status} (not success)`);
            return new Response("OK", { status: 200 });
        }

        // 1. Fetch payment record from our DB
        const { data: payment } = await supabase
            .from("payments")
            .select("*")
            .eq("order_id", orderId)
            .single();

        if (!payment) {
            console.error(`Payment record not found for order_id: ${orderId}`);
            return new Response("OK", { status: 200 });
        }

        // Avoid double processing
        if (payment.status === "paid") {
            console.log(`Order ${orderId} already processed`);
            return new Response("OK", { status: 200 });
        }

        const userId = payment.user_id;
        const plan = payment.plan;

        // 2. Update payment record
        await supabase.from("payments").update({
            status: "paid",
            inpay_trans_id: inpayTransId,
            updated_at: new Date().toISOString(),
        }).eq("order_id", orderId);

        // 3. Grant Premium to User
        const { data: user } = await supabase.from("users").select("premium_expires_at").eq("user_id", userId).single();
        let baseDate = new Date();
        if (user && user.premium_expires_at && new Date(user.premium_expires_at) > baseDate) {
            baseDate = new Date(user.premium_expires_at);
        }

        const expiresAt = new Date(baseDate);
        let planTitle = "1 Oylik Premium";
        if (plan === "1_month") {
            expiresAt.setMonth(expiresAt.getMonth() + 1);
            planTitle = "1 Oylik Premium";
        } else if (plan === "3_months") {
            expiresAt.setMonth(expiresAt.getMonth() + 3);
            planTitle = "3 Oylik Premium";
        } else if (plan === "6_months") {
            expiresAt.setMonth(expiresAt.getMonth() + 6);
            planTitle = "6 Oylik Premium";
        } else if (plan === "1_year") {
            expiresAt.setFullYear(expiresAt.getFullYear() + 1);
            planTitle = "1 Yillik Premium";
        } else if (plan === "lifetime") {
            expiresAt.setFullYear(expiresAt.getFullYear() + 100);
            planTitle = "Lifetime (Umrbod) Premium";
        } else {
            expiresAt.setMonth(expiresAt.getMonth() + 1);
        }

        await supabase.from("users").update({
            is_premium: true,
            premium_expires_at: expiresAt.toISOString(),
        }).eq("user_id", userId);

        // 4. Save to premium history
        try {
            await supabase.from("premium_history").insert({
                user_id: userId,
                plan: plan,
                days: Math.round((expiresAt.getTime() - new Date().getTime()) / (1000 * 86400)),
                expires_at: expiresAt.toISOString(),
            });
        } catch (e) {
            // Premium history table may not exist
        }

        // 5. Send Telegram notification to user
        if (BOT_TOKEN) {
            const formattedDate = expiresAt.toLocaleDateString("uz-UZ", {
                year: "numeric",
                month: "long",
                day: "numeric",
            });

            const msg = `🎉 <b>To'lovingiz muvaffaqiyatli qabul qilindi!</b>\n\n` +
                `👑 <b>Tarif:</b> ${planTitle}\n` +
                `💵 <b>Miqdor:</b> ${Number(amount).toLocaleString()} so'm\n` +
                `📅 <b>Amal qilish muddati:</b> ${formattedDate}\n\n` +
                `Endi botdan va Mini App-dan cheksiz foydalanishingiz mumkin! 🚀`;

            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chat_id: userId,
                    text: msg,
                    parse_mode: "HTML",
                }),
            }).catch(e => console.error("TG notification error:", e));
        }

        // Must return HTTP 200 for Inpay
        return new Response("OK", { status: 200 });
    } catch (e: any) {
        console.error("Inpay webhook error:", e);
        // Still return 200 to avoid retries on our bugs
        return new Response("OK", { status: 200 });
    }
});
