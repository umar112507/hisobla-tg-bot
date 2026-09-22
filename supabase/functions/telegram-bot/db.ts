import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

export async function ensureUser(
    userId: number,
    username?: string,
    firstName?: string,
    lastName?: string,
    photoUrl?: string
) {
    const { data } = await supabase.from("users").select("user_id").eq("user_id", userId);
    if (!data || data.length === 0) {
        await supabase.from("users").insert({
            user_id: userId,
            username: username || null,
            first_name: firstName || null,
            last_name: lastName || null,
            photo_url: photoUrl || null,
        });
    } else {
        // Update profile if changed
        await supabase.from("users").update({
            username: username || null,
            first_name: firstName || null,
            last_name: lastName || null,
            photo_url: photoUrl || null,
        }).eq("user_id", userId);
    }
}

export async function addTransaction(
    userId: number,
    type: "income" | "expense",
    amount: number,
    category: string,
    description: string
) {
    const { data, error } = await supabase.from("transactions").insert({
        user_id: userId,
        type,
        amount,
        category,
        description,
    }).select().single();
    if (error) throw error;
    return data;
}

export async function addDebt(
    userId: number,
    direction: "gave" | "received",
    personName: string,
    amount: number,
    description?: string,
    dueDate?: string
) {
    const { data, error } = await supabase.from("debts").insert({
        user_id: userId,
        direction,
        person_name: personName,
        amount,
        description: description || null,
        due_date: dueDate || null,
        is_paid: false,
    }).select().single();
    if (error) throw error;
    return data;
}

export async function getDebts(userId: number) {
    const { data } = await supabase
        .from("debts")
        .select("*")
        .eq("user_id", userId)
        .eq("is_paid", false)
        .order("due_date", { ascending: true });
    return data || [];
}

export async function getSummary(userId: number) {
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

    return {
        totalIncome,
        totalExpense,
        balance: totalIncome - totalExpense,
    };
}

export async function checkAndIncrementUsage(userId: number): Promise<boolean> {
    try {
        const { data: user, error } = await supabase
            .from("users")
            .select("usage_count, usage_reset_date, is_premium, premium_expires_at")
            .eq("user_id", userId)
            .single();

        // Agar ustunlar DB ga hali qo'shilmagan bo'lsa xatolik beradi va ishlashda davom etadi
        if (error || !user) {
            return true;
        }

        let isPremium = user.is_premium || false;
        if (isPremium && user.premium_expires_at) {
            if (new Date(user.premium_expires_at) <= new Date()) {
                isPremium = false;
                await supabase.from("users").update({ is_premium: false }).eq("user_id", userId);
            }
        }

        if (isPremium) return true;

        const now = new Date();
        const resetDate = user.usage_reset_date ? new Date(user.usage_reset_date) : now;

        const diffDays = (now.getTime() - resetDate.getTime()) / (1000 * 3600 * 24);

        let newCount = user.usage_count || 0;
        let newResetDate = user.usage_reset_date || now.toISOString();

        if (diffDays >= 7) {
            newCount = 0;
            newResetDate = now.toISOString();
        }

        if (newCount >= 10) {
            return false; // Limit tugadi
        }

        // Limit o'tmagan bo'lsa sanoqni +1 ga oshiramiz
        await supabase.from("users").update({
            usage_count: newCount + 1,
            usage_reset_date: newResetDate
        }).eq("user_id", userId);

        return true;
    } catch (e) {
        return true;
    }
}

const chatHistoryMemoryMap = new Map<number, Array<{ role: string; content: string }>>();

export async function saveChatMessage(userId: number, role: "user" | "assistant", content: string) {
    // 1. Dual cache: Always store in Edge Function memory map
    if (!chatHistoryMemoryMap.has(userId)) {
        chatHistoryMemoryMap.set(userId, []);
    }
    const memList = chatHistoryMemoryMap.get(userId)!;
    memList.push({ role, content });
    if (memList.length > 30) memList.shift();

    // 2. Try inserting into Supabase DB table
    try {
        await supabase.from("chat_history").insert({
            user_id: userId,
            role,
            content,
        });
    } catch (e) {
        // DB table fallback
    }
}

export async function getChatHistory(userId: number, limit = 15) {
    let history: Array<{ role: string; content: string }> = [];

    try {
        const { data } = await supabase
            .from("chat_history")
            .select("role, content, created_at")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(limit);

        if (data && data.length > 0) {
            history = data.reverse().map(d => ({ role: d.role, content: d.content }));
        }
    } catch (e) {
        // Ignore DB error
    }

    // Fallback to in-memory history if DB returned nothing
    if (history.length === 0 && chatHistoryMemoryMap.has(userId)) {
        history = chatHistoryMemoryMap.get(userId)!.slice(-limit);
    }

    return history;
}

export async function updateLastDebtPerson(userId: number, personName: string) {
    try {
        const { data: debts } = await supabase
            .from("debts")
            .select("*")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(1);

        if (debts && debts.length > 0) {
            const lastDebt = debts[0];
            const oldPerson = lastDebt.person_name || "Noma'lum";

            await supabase
                .from("debts")
                .update({ person_name: personName })
                .eq("id", lastDebt.id);

            // Also update matching transaction description
            const { data: txs } = await supabase
                .from("transactions")
                .select("*")
                .eq("user_id", userId)
                .order("created_at", { ascending: false })
                .limit(2);

            if (txs) {
                for (const tx of txs) {
                    if (tx.description && (tx.description.includes("Noma'lum") || tx.description.includes(oldPerson) || tx.description.includes("qarz") || tx.description.includes("Qarz"))) {
                        const newDesc = `${personName} ${lastDebt.direction === "gave" ? "ga qarz berildi" : "dan qarz olindi"}`;
                        await supabase.from("transactions").update({ description: newDesc, category: `${personName} (Qarz)` }).eq("id", tx.id);
                        break;
                    }
                }
            }
            return { ...lastDebt, person_name: personName };
        }
    } catch (e) {
        console.error("Error updating last debt person:", e);
    }
    return null;
}

export async function checkAndResolveRecentDebtPerson(userId: number, text: string) {
    try {
        const { data: debts } = await supabase
            .from("debts")
            .select("*")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(1);

        if (debts && debts.length > 0) {
            const lastDebt = debts[0];
            const isUnknown = !lastDebt.person_name || lastDebt.person_name === "Noma'lum";

            // Check if last debt was created within last 24h
            const debtTime = new Date(lastDebt.created_at || Date.now()).getTime();
            const isRecent = (Date.now() - debtTime) < 24 * 3600 * 1000;

            if (isUnknown && isRecent) {
                let clean = text.trim();
                // Strip common suffix endings like -ga, -gi, -dan, -ni
                clean = clean.replace(/(?:ga|gi|dan|ni|da|mga|imga)$/i, "").trim();
                if (clean.length > 0 && clean.length < 30) {
                    clean = clean.charAt(0).toUpperCase() + clean.slice(1);
                    return await updateLastDebtPerson(userId, clean);
                }
            }
        }
    } catch (e) {
        console.error("checkAndResolveRecentDebtPerson error:", e);
    }
    return null;
}

export async function createPaymentRecord(userId: number, orderId: string, amount: number, plan: string) {
    const { data, error } = await supabase.from("payments").insert({
        user_id: userId,
        order_id: orderId,
        amount,
        plan,
        status: "pending",
        provider: "inpay",
    }).select().single();
    if (error) {
        console.error("createPaymentRecord error:", error);
    }
    return data;
}

export async function updatePaymentStatus(orderId: string, status: "paid" | "failed" | "cancelled", inpayTransId?: string) {
    const { data, error } = await supabase.from("payments").update({
        status,
        inpay_trans_id: inpayTransId || null,
        updated_at: new Date().toISOString(),
    }).eq("order_id", orderId).select().single();
    if (error) {
        console.error("updatePaymentStatus error:", error);
    }
    return data;
}

export async function grantUserPremium(userId: number, plan: string) {
    try {
        const { data: user } = await supabase.from("users").select("premium_expires_at").eq("user_id", userId).single();
        let baseDate = new Date();
        if (user && user.premium_expires_at && new Date(user.premium_expires_at) > baseDate) {
            baseDate = new Date(user.premium_expires_at);
        }

        const expiresAt = new Date(baseDate);
        if (plan === "1_month") {
            expiresAt.setMonth(expiresAt.getMonth() + 1);
        } else if (plan === "3_months") {
            expiresAt.setMonth(expiresAt.getMonth() + 3);
        } else if (plan === "6_months") {
            expiresAt.setMonth(expiresAt.getMonth() + 6);
        } else if (plan === "1_year") {
            expiresAt.setFullYear(expiresAt.getFullYear() + 1);
        } else if (plan === "lifetime") {
            expiresAt.setFullYear(expiresAt.getFullYear() + 100);
        } else {
            expiresAt.setMonth(expiresAt.getMonth() + 1);
        }

        await supabase.from("users").update({
            is_premium: true,
            premium_expires_at: expiresAt.toISOString(),
        }).eq("user_id", userId);

        return expiresAt;
    } catch (e) {
        console.error("grantUserPremium error:", e);
        return null;
    }
}

