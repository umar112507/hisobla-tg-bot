import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const BOT_TOKEN = Deno.env.get("BOT_TOKEN") || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

serve(async (req: Request) => {
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

        const isPaid = status === "success";
        const isFailed = status === "failed" || status === "cancelled";

        if (isFailed) {
            await supabase
                .from("payments")
                .update({ status: "failed" })
                .filter("metadata->>order_id", "eq", orderId);

            return new Response("OK", { status: 200 });
        }

        if (!isPaid) {
            console.log(`Payment status for order ${orderId}: ${status} (not success)`);
            return new Response("OK", { status: 200 });
        }

        // 1. Fetch payment record from DB
        const { data: payments } = await supabase
            .from("payments")
            .select("*")
            .filter("metadata->>order_id", "eq", orderId)
            .limit(1);

        const payment = payments && payments.length > 0 ? payments[0] : null;

        if (!payment) {
            console.error(`Payment record not found for order_id: ${orderId}`);
            return new Response("OK", { status: 200 });
        }

        if (payment.status === "paid") {
            console.log(`Order ${orderId} already processed`);
            return new Response("OK", { status: 200 });
        }

        const profileId = payment.profile_id;
        const monthsCount = Number(payment.months || 1);

        // 2. Update payment status
        await supabase
            .from("payments")
            .update({ status: "paid" })
            .eq("id", payment.id);

        // 3. Grant PRO to User Profile
        const { data: profile } = await supabase.from("profiles").select("pro_expires_at").eq("id", profileId).single();
        let baseDate = new Date();
        if (profile && profile.pro_expires_at && new Date(profile.pro_expires_at) > baseDate) {
            baseDate = new Date(profile.pro_expires_at);
        }

        const expiresAt = new Date(baseDate);
        expiresAt.setMonth(expiresAt.getMonth() + monthsCount);

        await supabase.from("profiles").update({
            is_pro: true,
            pro_expires_at: expiresAt.toISOString(),
            updated_at: new Date().toISOString(),
        }).eq("id", profileId);

        // 4. Find telegram_id for Telegram notification
        const { data: token } = await supabase.from("telegram_auth_tokens").select("telegram_id").eq("user_id", profileId).single();
        const tgId = token?.telegram_id;

        if (BOT_TOKEN && tgId) {
            const formattedDate = expiresAt.toLocaleDateString("uz-UZ", {
                year: "numeric",
                month: "long",
                day: "numeric",
            });

            const msg = `🎉 <b>To'lovingiz muvaffaqiyatli qabul qilindi!</b>\n\n` +
                `👑 <b>PRO Obuna:</b> ${monthsCount} oy\n` +
                `💵 <b>Miqdor:</b> ${Number(amount).toLocaleString()} so'm\n` +
                `📅 <b>Amal qilish muddati:</b> ${formattedDate}\n\n` +
                `Endi botdan va Mini App-dan cheksiz foydalanishingiz mumkin! 🚀`;

            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chat_id: tgId,
                    text: msg,
                    parse_mode: "HTML",
                }),
            }).catch(e => console.error("TG notification error:", e));
        }

        return new Response("OK", { status: 200 });
    } catch (e: any) {
        console.error("Inpay webhook error:", e);
        return new Response("OK", { status: 200 });
    }
});
