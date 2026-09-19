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
