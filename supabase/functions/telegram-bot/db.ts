import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

export function isUUID(str: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

// ─── Resolve Profile & Default Account ───────────────────────
export async function getProfileAndDefaultAccount(userIdInput: string | number): Promise<{ profileId: string; accountId: string }> {
    const inputStr = String(userIdInput).trim();

    let profileId: string | null = null;

    if (isUUID(inputStr)) {
        // Direct UUID profile lookup
        const { data: prof } = await supabase.from("profiles").select("id").eq("id", inputStr).single();
        if (prof) {
            profileId = prof.id;
        }
    }

    if (!profileId) {
        const numericTgId = Number(inputStr);
        if (!isNaN(numericTgId) && numericTgId > 0) {
            // Check telegram_auth_tokens
            const { data: token } = await supabase
                .from("telegram_auth_tokens")
                .select("user_id")
                .eq("telegram_id", numericTgId)
                .single();

            if (token && token.user_id) {
                profileId = token.user_id;
            } else {
                // Ensure user creates profile + token
                const result = await ensureUser(numericTgId);
                profileId = result.profileId;
            }
        }
    }

    if (!profileId) {
        // Fallback: create default anonymous profile with explicit UUID
        const newProfId = crypto.randomUUID();
        const { data: newProf, error } = await supabase.from("profiles").insert({
            id: newProfId,
            username: `user_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            full_name: "Foydalanuvchi",
        }).select("id").single();

        if (error) {
            console.error("Profile fallback creation error:", error);
            throw new Error(`Profile creation failed: ${error.message}`);
        }
        profileId = newProf?.id || newProfId;
    }

    // Resolve default account
    let accountId: string | null = null;
    const { data: accs } = await supabase.from("accounts").select("id").eq("user_id", profileId).limit(1);
    if (accs && accs.length > 0) {
        accountId = accs[0].id;
    } else {
        const newAccId = crypto.randomUUID();
        const { data: newAcc, error: accErr } = await supabase.from("accounts").insert({
            id: newAccId,
            user_id: profileId,
            name: "Asosiy hisob",
            balance_uzs: 0,
            currency: "UZS",
        }).select("id").single();

        if (accErr) {
            console.error("Account creation error:", accErr);
            throw new Error(`Account creation failed: ${accErr.message}`);
        }
        accountId = newAcc?.id || newAccId;
    }

    return { profileId: profileId!, accountId: accountId! };
}

// ─── Ensure User Profile and Auth Token ───────────────────────
export async function ensureUser(
    telegramId: number,
    username?: string,
    firstName?: string,
    lastName?: string,
    photoUrl?: string
): Promise<{ profileId: string; accountId: string }> {
    const fullName = [firstName, lastName].filter(Boolean).join(" ");
    const cleanUsername = username || `tg_${telegramId}`;

    // 1. Check telegram_auth_tokens
    const { data: existingToken } = await supabase
        .from("telegram_auth_tokens")
        .select("user_id, id")
        .eq("telegram_id", telegramId)
        .single();

    let profileId: string | null = null;

    if (existingToken && existingToken.user_id) {
        profileId = existingToken.user_id;
        // Update profile metadata if provided
        await supabase.from("profiles").update({
            username: cleanUsername,
            full_name: fullName || undefined,
            avatar_url: photoUrl || undefined,
            updated_at: new Date().toISOString(),
        }).eq("id", profileId);
    } else {
        // 2. Check if profile with username already exists
        const { data: existingProf } = await supabase
            .from("profiles")
            .select("id")
            .eq("username", cleanUsername)
            .single();

        if (existingProf) {
            profileId = existingProf.id;
            await supabase.from("profiles").update({
                full_name: fullName || undefined,
                avatar_url: photoUrl || undefined,
                updated_at: new Date().toISOString(),
            }).eq("id", profileId);
        } else {
            // 3. Create new profile with explicit UUID
            const newProfId = crypto.randomUUID();
            const { data: newProf, error: profErr } = await supabase.from("profiles").insert({
                id: newProfId,
                username: cleanUsername,
                full_name: fullName || `Foydalanuvchi #${telegramId}`,
                avatar_url: photoUrl || null,
                is_pro: false,
            }).select("id").single();

            if (profErr) {
                // Fallback username if unique collision happens
                const fallbackUsername = `${cleanUsername}_${telegramId}`;
                const { data: fbProf, error: fbErr } = await supabase.from("profiles").insert({
                    id: newProfId,
                    username: fallbackUsername,
                    full_name: fullName || `Foydalanuvchi #${telegramId}`,
                    avatar_url: photoUrl || null,
                    is_pro: false,
                }).select("id").single();

                if (fbErr) {
                    console.error("ensureUser profile creation error:", fbErr);
                    throw new Error(`Profile creation failed: ${fbErr.message}`);
                }
                profileId = fbProf?.id || newProfId;
            } else {
                profileId = newProf?.id || newProfId;
            }
        }

        // 4. Create or update telegram_auth_token record
        const { data: tokenCheck } = await supabase.from("telegram_auth_tokens").select("id").eq("telegram_id", telegramId).single();
        if (tokenCheck) {
            await supabase.from("telegram_auth_tokens").update({
                user_id: profileId,
                telegram_user: { username, first_name: firstName, last_name: lastName, photo_url: photoUrl },
            }).eq("id", tokenCheck.id);
        } else {
            await supabase.from("telegram_auth_tokens").insert({
                id: crypto.randomUUID(),
                telegram_id: telegramId,
                user_id: profileId,
                state_token: `auth_${telegramId}_${Date.now()}`,
                status: "active",
                telegram_user: { username, first_name: firstName, last_name: lastName, photo_url: photoUrl },
            });
        }
    }

    // 5. Resolve Account
    const { data: accs } = await supabase.from("accounts").select("id").eq("user_id", profileId).limit(1);
    let accountId: string;

    if (accs && accs.length > 0) {
        accountId = accs[0].id;
    } else {
        const newAccId = crypto.randomUUID();
        const { data: newAcc, error: accErr } = await supabase.from("accounts").insert({
            id: newAccId,
            user_id: profileId,
            name: "Asosiy hisob",
            balance_uzs: 0,
            currency: "UZS",
        }).select("id").single();

        if (accErr) {
            console.error("Account creation error:", accErr);
            throw new Error(`Account creation failed: ${accErr.message}`);
        }
        accountId = newAcc?.id || newAccId;
    }

    return { profileId: profileId!, accountId: accountId! };
}

// ─── Resolve or Create Category ───────────────────────────────
export async function ensureCategory(profileId: string, name: string, type: "income" | "expense"): Promise<string> {
    const cleanName = name.trim() || "Boshqa";
    const { data: existing } = await supabase
        .from("categories")
        .select("id")
        .eq("user_id", profileId)
        .ilike("name", cleanName)
        .single();

    if (existing) return existing.id;

    // Check system default category (user_id IS NULL)
    const { data: sysCat } = await supabase
        .from("categories")
        .select("id")
        .is("user_id", null)
        .ilike("name", cleanName)
        .single();

    if (sysCat) return sysCat.id;

    // Create user category with explicit UUID
    const newCatId = crypto.randomUUID();
    const { data: newCat, error } = await supabase.from("categories").insert({
        id: newCatId,
        user_id: profileId,
        name: cleanName,
        type,
    }).select("id").single();

    if (error) {
        return newCatId;
    }

    return newCat?.id || newCatId;
}

// ─── Add Transaction ──────────────────────────────────────────
export async function addTransaction(
    userIdInput: string | number,
    type: "income" | "expense",
    amount: number,
    categoryName: string,
    description: string
) {
    const { profileId, accountId } = await getProfileAndDefaultAccount(userIdInput);
    const categoryId = await ensureCategory(profileId, categoryName, type);

    const newTxId = crypto.randomUUID();
    const { data, error } = await supabase.from("transactions").insert({
        id: newTxId,
        user_id: profileId,
        account_id: accountId,
        category_id: categoryId || null,
        amount_uzs: amount,
        type,
        description,
    }).select().single();

    if (error) {
        console.error("addTransaction error:", error);
        throw error;
    }

    // Update account balance_uzs
    try {
        const { data: acc } = await supabase.from("accounts").select("balance_uzs").eq("id", accountId).single();
        const currentBal = Number(acc?.balance_uzs || 0);
        const newBal = type === "income" ? currentBal + amount : currentBal - amount;
        await supabase.from("accounts").update({ balance_uzs: newBal }).eq("id", accountId);
    } catch (e) {
        console.error("Account balance update error:", e);
    }

    return { ...(data || { id: newTxId }), category: categoryName, amount };
}

// ─── Add Debt ─────────────────────────────────────────────────
export async function addDebt(
    userIdInput: string | number,
    direction: "gave" | "received",
    personName: string,
    amount: number,
    description?: string,
    dueDate?: string
) {
    const { profileId } = await getProfileAndDefaultAccount(userIdInput);

    const newDebtId = crypto.randomUUID();
    const { data, error } = await supabase.from("debts").insert({
        id: newDebtId,
        user_id: profileId,
        person_name: personName,
        amount_uzs: amount,
        type: direction,
        description: description || null,
        due_date: dueDate || null,
        status: "unpaid",
        amount: amount,
        currency: "UZS",
    }).select().single();

    if (error) {
        console.error("addDebt error:", error);
        throw error;
    }
    return { ...(data || { id: newDebtId }), is_paid: false, direction, amount };
}

// ─── Get Debts ────────────────────────────────────────────────
export async function getDebts(userIdInput: string | number) {
    const { profileId } = await getProfileAndDefaultAccount(userIdInput);

    const { data } = await supabase
        .from("debts")
        .select("*")
        .eq("user_id", profileId)
        .or("status.eq.unpaid,status.is.null")
        .order("due_date", { ascending: true });

    return (data || []).map(d => ({
        ...d,
        direction: d.type || "gave",
        amount: Number(d.amount_uzs || d.amount || 0),
        is_paid: d.status === "paid",
    }));
}

// ─── Get Summary ──────────────────────────────────────────────
export async function getSummary(userIdInput: string | number) {
    const { profileId } = await getProfileAndDefaultAccount(userIdInput);

    const { data } = await supabase
        .from("transactions")
        .select("*, categories(name)")
        .eq("user_id", profileId);

    const transactions = data || [];
    const totalIncome = transactions
        .filter((t) => t.type === "income")
        .reduce((sum, t) => sum + Number(t.amount_uzs || 0), 0);
    const totalExpense = transactions
        .filter((t) => t.type === "expense")
        .reduce((sum, t) => sum + Number(t.amount_uzs || 0), 0);

    return {
        totalIncome,
        totalExpense,
        balance: totalIncome - totalExpense,
    };
}

// ─── Check & Increment Usage ──────────────────────────────────
export async function checkAndIncrementUsage(userIdInput: string | number): Promise<boolean> {
    try {
        const { profileId } = await getProfileAndDefaultAccount(userIdInput);

        const { data: profile, error } = await supabase
            .from("profiles")
            .select("is_pro, pro_expires_at")
            .eq("id", profileId)
            .single();

        if (error || !profile) {
            return true;
        }

        let isPro = profile.is_pro || false;
        if (isPro && profile.pro_expires_at) {
            if (new Date(profile.pro_expires_at) <= new Date()) {
                isPro = false;
                await supabase.from("profiles").update({ is_pro: false }).eq("id", profileId);
            }
        }

        return true;
    } catch (e) {
        return true;
    }
}

// ─── Chat History ─────────────────────────────────────────────
const chatHistoryMemoryMap = new Map<string, Array<{ role: string; content: string }>>();

export async function saveChatMessage(userIdInput: string | number, role: "user" | "assistant", content: string) {
    const key = String(userIdInput);
    if (!chatHistoryMemoryMap.has(key)) {
        chatHistoryMemoryMap.set(key, []);
    }
    const memList = chatHistoryMemoryMap.get(key)!;
    memList.push({ role, content });
    if (memList.length > 30) memList.shift();
}

export async function getChatHistory(userIdInput: string | number, limit = 15) {
    const key = String(userIdInput);
    if (chatHistoryMemoryMap.has(key)) {
        return chatHistoryMemoryMap.get(key)!.slice(-limit);
    }
    return [];
}

// ─── Debt Updates ─────────────────────────────────────────────
export async function updateLastDebtPerson(userIdInput: string | number, personName: string) {
    try {
        const { profileId } = await getProfileAndDefaultAccount(userIdInput);

        const { data: debts } = await supabase
            .from("debts")
            .select("*")
            .eq("user_id", profileId)
            .order("created_at", { ascending: false })
            .limit(1);

        if (debts && debts.length > 0) {
            const lastDebt = debts[0];
            const oldPerson = lastDebt.person_name || "Noma'lum";

            await supabase
                .from("debts")
                .update({ person_name: personName })
                .eq("id", lastDebt.id);

            const { data: txs } = await supabase
                .from("transactions")
                .select("*")
                .eq("user_id", profileId)
                .order("created_at", { ascending: false })
                .limit(2);

            if (txs) {
                for (const tx of txs) {
                    if (tx.description && (tx.description.includes("Noma'lum") || tx.description.includes(oldPerson) || tx.description.includes("qarz") || tx.description.includes("Qarz"))) {
                        const newDesc = `${personName} ${lastDebt.type === "gave" ? "ga qarz berildi" : "dan qarz olindi"}`;
                        await supabase.from("transactions").update({ description: newDesc }).eq("id", tx.id);
                        break;
                    }
                }
            }
            return { ...lastDebt, person_name: personName, amount: Number(lastDebt.amount_uzs || lastDebt.amount || 0) };
        }
    } catch (e) {
        console.error("Error updating last debt person:", e);
    }
    return null;
}

export async function checkAndResolveRecentDebtPerson(userIdInput: string | number, text: string) {
    try {
        const { profileId } = await getProfileAndDefaultAccount(userIdInput);

        const { data: debts } = await supabase
            .from("debts")
            .select("*")
            .eq("user_id", profileId)
            .order("created_at", { ascending: false })
            .limit(1);

        if (debts && debts.length > 0) {
            const lastDebt = debts[0];
            const isUnknown = !lastDebt.person_name || lastDebt.person_name === "Noma'lum";

            const debtTime = new Date(lastDebt.created_at || Date.now()).getTime();
            const isRecent = (Date.now() - debtTime) < 24 * 3600 * 1000;

            if (isUnknown && isRecent) {
                let clean = text.trim();
                clean = clean.replace(/(?:ga|gi|dan|ni|da|mga|imga)$/i, "").trim();
                if (clean.length > 0 && clean.length < 30) {
                    clean = clean.charAt(0).toUpperCase() + clean.slice(1);
                    return await updateLastDebtPerson(userIdInput, clean);
                }
            }
        }
    } catch (e) {
        console.error("checkAndResolveRecentDebtPerson error:", e);
    }
    return null;
}

// ─── Payments & Pro Status ────────────────────────────────────
export async function createPaymentRecord(userIdInput: string | number, orderId: string, amount: number, months: number = 1) {
    const { profileId } = await getProfileAndDefaultAccount(userIdInput);

    const { data, error } = await supabase.from("payments").insert({
        id: crypto.randomUUID(),
        profile_id: profileId,
        amount: amount,
        months: months,
        status: "pending",
        metadata: { order_id: orderId },
    }).select().single();

    if (error) {
        console.error("createPaymentRecord error:", error);
    }
    return data;
}

export async function updatePaymentStatus(orderId: string, status: "paid" | "failed" | "cancelled", receiptUrl?: string) {
    const { data, error } = await supabase.from("payments").update({
        status,
        receipt_url: receiptUrl || null,
    }).filter("metadata->>order_id", "eq", orderId).select().single();

    if (error) {
        console.error("updatePaymentStatus error:", error);
    }
    return data;
}

export async function grantUserPremium(userIdInput: string | number, monthsCount: number = 1) {
    try {
        const { profileId } = await getProfileAndDefaultAccount(userIdInput);

        const { data: profile } = await supabase.from("profiles").select("pro_expires_at").eq("id", profileId).single();
        let baseDate = new Date();
        if (profile && profile.pro_expires_at && new Date(profile.pro_expires_at) > baseDate) {
            baseDate = new Date(profile.pro_expires_at);
        }

        const expiresAt = new Date(baseDate);
        expiresAt.setMonth(expiresAt.getMonth() + (monthsCount || 1));

        await supabase.from("profiles").update({
            is_pro: true,
            pro_expires_at: expiresAt.toISOString(),
        }).eq("id", profileId);

        return expiresAt;
    } catch (e) {
        console.error("grantUserPremium error:", e);
        return null;
    }
}
