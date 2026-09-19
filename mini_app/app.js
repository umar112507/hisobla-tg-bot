// ─── Config ───────────────────────────────────────────────────
const SUPABASE_URL = "https://dyqmawwyooeqadibnpqc.supabase.co";
// Supabase Public Anon Key
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR5cW1hd3d5b29lcWFkaWJucHFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6MjAyMDAwMDAwMH0.placeholder";

let supabaseClient = null;
if (window.supabase) {
    supabaseClient = window.supabase.createClient(
        SUPABASE_URL,
        "sbp_placeholder" // Will fall back or fetch via REST if anon key isn't passed
    );
}

const tg = window.Telegram?.WebApp;

let USER_ID = null;
let tgUser = null;

if (tg && tg.initDataUnsafe?.user) {
    tgUser = tg.initDataUnsafe.user;
    USER_ID = tgUser.id;
} else {
    const params = new URLSearchParams(window.location.search);
    USER_ID = params.get("user_id") || params.get("id");
}

// ─── Init Telegram WebApp ─────────────────────────────────────
if (tg) {
    tg.expand();
    try {
        tg.setHeaderColor("#0a0e1a");
        tg.setBackgroundColor("#0a0e1a");
    } catch (e) { }
}

let expenseChartInstance = null;
let incomeChartInstance = null;
let allTransactions = [];
let currentFilter = "all";
let summaryData = null;

document.addEventListener("DOMContentLoaded", () => {
    renderUserProfile();
    if (!USER_ID) {
        showEmptyAll("Telegram ID topilmadi. Bot orqali oching.");
        return;
    }
    loadAll();
    setupTabs();
    setupFilters();
});

// ─── Render Telegram Profile ──────────────────────────────────
function renderUserProfile() {
    const avatarEl = document.getElementById("userAvatar");
    const nameEl = document.getElementById("userName");
    const usernameEl = document.getElementById("userUsername");

    if (tgUser) {
        const fullName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ");
        nameEl.textContent = fullName || "Foydalanuvchi";
        usernameEl.textContent = tgUser.username ? `@${tgUser.username}` : `ID: ${tgUser.id}`;

        if (tgUser.photo_url) {
            avatarEl.src = tgUser.photo_url;
        } else {
            avatarEl.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName)}&background=448aff&color=fff`;
        }
    } else if (USER_ID) {
        nameEl.textContent = `Foydalanuvchi #${USER_ID}`;
        usernameEl.textContent = `@user${USER_ID}`;
        avatarEl.src = `https://ui-avatars.com/api/?name=User+${USER_ID}&background=448aff&color=fff`;
    } else {
        nameEl.textContent = "Mehmon";
        usernameEl.textContent = "ID aniqlanmadi";
    }
}

// ─── Data Loading ─────────────────────────────────────────────
async function loadAll() {
    await Promise.all([loadTransactionsAndSummary(), loadDebts()]);
}

async function fetchSupabaseRest(endpoint) {
    const url = `${SUPABASE_URL}/rest/v1/${endpoint}`;
    const res = await fetch(url, {
        headers: {
            "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR5cW1hd3d5b29lcWFkaWJucHFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6MjAyMDAwMDAwMH0",
            "Authorization": `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR5cW1hd3d5b29lcWFkaWJucHFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6MjAyMDAwMDAwMH0`
        }
    });
    return res.json();
}

async function loadTransactionsAndSummary() {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/transactions?user_id=eq.${USER_ID}&order=created_at.desc`, {
            headers: {
                "Prefer": "return=representation"
            }
        });

        let transactions = [];
        if (res.ok) {
            transactions = await res.json();
        } else {
            // Fallback local or backend call
            const backRes = await fetch(`/api/transactions/${USER_ID}`);
            transactions = await backRes.json();
        }

        allTransactions = Array.isArray(transactions) ? transactions : [];

        // Calculate Summary
        const totalIncome = allTransactions
            .filter(t => t.type === "income")
            .reduce((sum, t) => sum + Number(t.amount), 0);
        const totalExpense = allTransactions
            .filter(t => t.type === "expense")
            .reduce((sum, t) => sum + Number(t.amount), 0);
        const balance = totalIncome - totalExpense;

        // Category Breakdown
        const catMap = {};
        allTransactions.forEach(t => {
            const key = `${t.type}:${t.category}`;
            catMap[key] = (catMap[key] || 0) + Number(t.amount);
        });

        const categories = Object.keys(catMap).map(key => {
            const [type, category] = key.split(":");
            return { type, category, total: catMap[key] };
        });

        summaryData = { total_income: totalIncome, total_expense: totalExpense, balance, categories };

        // Update Balance UI
        const el = document.getElementById("balanceAmount");
        el.textContent = formatAmount(balance);
        el.className = "balance-amount " + (balance >= 0 ? "positive" : "negative");

        document.getElementById("totalIncome").textContent = formatAmount(totalIncome);
        document.getElementById("totalExpense").textContent = formatAmount(totalExpense);

        renderTransactions(allTransactions);
        renderCharts(categories);
    } catch (e) {
        console.error("Transactions load failed:", e);
        renderTransactions([]);
    }
}

async function loadDebts() {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/debts?user_id=eq.${USER_ID}&is_paid=eq.false&order=due_date.asc`);
        let debts = [];
        if (res.ok) {
            debts = await res.json();
        }
        renderDebts(Array.isArray(debts) ? debts : []);
    } catch (e) {
        document.getElementById("debtsList").innerHTML = emptyState("💳", "Qarzlar yuklanmadi");
    }
}

// ─── Render Transactions ──────────────────────────────────────
function renderTransactions(transactions) {
    const filtered = currentFilter === "all"
        ? transactions
        : transactions.filter(t => t.type === currentFilter);

    const container = document.getElementById("transactionsList");
    if (!filtered.length) {
        container.innerHTML = emptyState("📭", "Tranzaksiyalar yo'q");
        return;
    }

    container.innerHTML = filtered.map(t => {
        const isIncome = t.type === "income";
        const emoji = isIncome ? "💰" : "💸";
        const dateStr = formatDate(t.created_at);
        const sign = isIncome ? "+" : "-";
        return `
      <div class="tx-item">
        <div class="tx-icon-wrap ${t.type}">${emoji}</div>
        <div class="tx-info">
          <div class="tx-desc">${escHtml(t.description || "—")}</div>
          <div class="tx-meta">
            <span class="tx-cat">${escHtml(t.category)}</span>
            <span class="tx-date">${dateStr}</span>
          </div>
        </div>
        <div class="tx-amount ${t.type}">${sign}${formatAmount(t.amount)}</div>
      </div>`;
    }).join("");
}

// ─── Render Debts ─────────────────────────────────────────────
function renderDebts(debts) {
    const container = document.getElementById("debtsList");
    const summaryRow = document.getElementById("debtSummary");

    if (!debts.length) {
        summaryRow.innerHTML = "";
        container.innerHTML = emptyState("✅", "Faol qarzlar yo'q!");
        return;
    }

    const gave = debts.filter(d => d.direction === "gave");
    const received = debts.filter(d => d.direction === "received");
    const totalGave = gave.reduce((s, d) => s + Number(d.amount), 0);
    const totalReceived = received.reduce((s, d) => s + Number(d.amount), 0);

    summaryRow.innerHTML = `
    <div class="debt-sum-card gave">
      <div class="debt-sum-label">📤 Berganlarim</div>
      <div class="debt-sum-amount gave">${formatAmount(totalGave)}</div>
    </div>
    <div class="debt-sum-card received">
      <div class="debt-sum-label">📥 Olganlarim</div>
      <div class="debt-sum-amount received">${formatAmount(totalReceived)}</div>
    </div>`;

    container.innerHTML = debts.map(d => {
        let days = null;
        if (d.due_date) {
            const diffTime = new Date(d.due_date).getTime() - new Date().getTime();
            days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        }

        let urgencyClass = "ok";
        let deadlineText = "📅 Muddat belgilanmagan";
        let deadlineClass = "";

        if (days !== null) {
            if (days < 0) {
                urgencyClass = "overdue";
                deadlineClass = "overdue";
                deadlineText = `⚠️ Muddati ${Math.abs(days)} kun oldin o'tgan!`;
            } else if (days === 0) {
                urgencyClass = "overdue";
                deadlineClass = "overdue";
                deadlineText = "🔴 Bugun muddati!";
            } else if (days <= 3) {
                urgencyClass = "due-soon";
                deadlineClass = "due-soon";
                deadlineText = `🟠 ${days} kun qoldi`;
            } else {
                deadlineText = `🟢 ${days} kun qoldi`;
            }
        }

        const dirText = d.direction === "gave" ? "Berdim" : "Oldim";
        return `
      <div class="debt-item ${urgencyClass}">
        <div class="debt-header">
          <div class="debt-person">👤 ${escHtml(d.person_name)}</div>
          <div class="debt-direction-badge ${d.direction}">${dirText}</div>
        </div>
        <div class="debt-amount ${d.direction}">${formatAmount(d.amount)}</div>
        ${d.description ? `<div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px;">📝 ${escHtml(d.description)}</div>` : ""}
        <div class="debt-deadline ${deadlineClass}">${deadlineText}</div>
      </div>`;
    }).join("");
}

// ─── Render Charts ────────────────────────────────────────────
function renderCharts(categories) {
    const expenseCats = categories.filter(c => c.type === "expense");
    const incomeCats = categories.filter(c => c.type === "income");

    const palette = [
        "#448aff", "#00e676", "#ff9800", "#ce93d8", "#ff5252",
        "#26c6da", "#ffee58", "#ef5350", "#ab47bc", "#66bb6a"
    ];

    renderPieChart("expenseChart", expenseCats, palette, "expenseChartInstance");
    renderPieChart("incomeChart", incomeCats, palette, "incomeChartInstance");
}

function renderPieChart(canvasId, data, palette, instanceVar) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    if (window[instanceVar]) {
        window[instanceVar].destroy();
    }

    if (!data.length) {
        canvas.parentElement.innerHTML = emptyState("📊", "Ma'lumot yo'q");
        return;
    }

    const labels = data.map(d => d.category);
    const values = data.map(d => d.total);
    const colors = palette.slice(0, data.length);

    window[instanceVar] = new Chart(canvas, {
        type: "doughnut",
        data: { labels, datasets: [{ data: values, backgroundColor: colors, borderColor: "rgba(255,255,255,0.1)", borderWidth: 2, hoverOffset: 8 }] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: "bottom",
                    labels: { color: "rgba(255,255,255,0.7)", font: { size: 11, family: "Inter" }, padding: 14, boxWidth: 12, boxHeight: 12 }
                },
                tooltip: {
                    callbacks: {
                        label: ctx => ` ${ctx.label}: ${formatAmount(ctx.raw)}`
                    }
                }
            },
            cutout: "65%",
        }
    });
}

// ─── Tabs & Filters ───────────────────────────────────────────
function setupTabs() {
    document.querySelectorAll(".tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
            document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
            btn.classList.add("active");
            document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");

            if (btn.dataset.tab === "statistics" && summaryData) {
                setTimeout(() => renderCharts(summaryData.categories || []), 50);
            }
        });
    });
}

function setupFilters() {
    document.querySelectorAll(".filter-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            currentFilter = btn.dataset.filter;
            renderTransactions(allTransactions);
        });
    });
}

// ─── Helpers ──────────────────────────────────────────────────
function formatAmount(n) {
    return `${Number(n || 0).toLocaleString("uz-UZ")} so'm`;
}

function formatDate(isoStr) {
    if (!isoStr) return "";
    const d = new Date(isoStr);
    return d.toLocaleDateString("uz-UZ", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function escHtml(str) {
    return String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function emptyState(icon, text) {
    return `<div class="empty-state"><div class="empty-state-icon">${icon}</div><div class="empty-state-text">${text}</div></div>`;
}

function showEmptyAll(msg) {
    document.getElementById("transactionsList").innerHTML = emptyState("⚠️", msg);
    document.getElementById("debtsList").innerHTML = emptyState("⚠️", msg);
}
