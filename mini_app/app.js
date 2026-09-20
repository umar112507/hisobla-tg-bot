// ─── Config ───────────────────────────────────────────────────
const API_BASE = "https://dyqmawwyooeqadibnpqc.supabase.co/functions/v1/telegram-bot";
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
let allDebts = [];
let currentFilter = "all";
let currentDebtFilter = "active";
let summaryData = null;

document.addEventListener("DOMContentLoaded", () => {
    renderUserProfile();
    if (!USER_ID) {
        showEmptyAll("Telegram ID topilmadi. Bot orqali oching.");
        return;
    }
    loadAll(false);
    setupTabs();
    setupFilters();
    setupPureEventSync();
});

// ─── Pure Event-Driven Sync (Zero Polling Timers) ─────────────
function setupPureEventSync() {
    // Update data ONLY when user switches back to Mini App tab or window
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) loadAll(true);
    });
    window.addEventListener("focus", () => loadAll(true));

    if (tg) {
        tg.onEvent("viewportChanged", () => loadAll(true));
    }
}

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

// ─── Data Loading (Supports Silent Refresh) ────────────────────
async function loadAll(isSilent = false) {
    await Promise.all([
        loadSummary(isSilent),
        loadTransactions(isSilent),
        loadDebts(isSilent)
    ]);
}

async function loadSummary(isSilent = false) {
    try {
        const res = await fetch(`${API_BASE}/api/summary?user_id=${USER_ID}`);
        const data = await res.json();
        summaryData = data;

        const balance = data.balance || 0;
        const el = document.getElementById("balanceAmount");
        el.textContent = formatAmount(balance);
        el.className = "balance-amount " + (balance >= 0 ? "positive" : "negative");

        document.getElementById("totalIncome").textContent = formatAmount(data.total_income || 0);
        document.getElementById("totalExpense").textContent = formatAmount(data.total_expense || 0);

        renderCharts(data.categories || []);
    } catch (e) {
        if (!isSilent) console.error("Summary load failed:", e);
    }
}

async function loadTransactions(isSilent = false) {
    try {
        const res = await fetch(`${API_BASE}/api/transactions?user_id=${USER_ID}`);
        const newTx = await res.json();

        if (JSON.stringify(newTx) !== JSON.stringify(allTransactions) || !isSilent) {
            allTransactions = newTx;
            renderTransactions(allTransactions);
        }
    } catch (e) {
        if (!isSilent) {
            console.error("Transactions load error:", e);
            document.getElementById("transactionsList").innerHTML = emptyState("📭", "Tranzaksiyalar yuklanmadi");
        }
    }
}

async function loadDebts(isSilent = false) {
    try {
        const res = await fetch(`${API_BASE}/api/debts?user_id=${USER_ID}&include_paid=true`);
        const newDebts = await res.json();

        if (JSON.stringify(newDebts) !== JSON.stringify(allDebts) || !isSilent) {
            allDebts = newDebts;
            renderDebts(allDebts);
        }
    } catch (e) {
        if (!isSilent) {
            console.error("Debts load error:", e);
            document.getElementById("debtsList").innerHTML = emptyState("💳", "Qarzlar yuklanmadi");
        }
    }
}

// ─── Render Transactions ──────────────────────────────────────
function renderTransactions(transactions) {
    const filtered = currentFilter === "all"
        ? transactions
        : transactions.filter(t => t.type === currentFilter);

    const container = document.getElementById("transactionsList");
    if (!filtered || !filtered.length) {
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
        <div class="tx-right">
          <div class="tx-amount ${t.type}">${sign}${formatAmount(t.amount)}</div>
          <button class="tx-delete-btn" onclick="deleteTx('${t.id}')" title="O'chirish">🗑️</button>
        </div>
      </div>`;
    }).join("");
}

// ─── Delete Transaction ───────────────────────────────────────
async function deleteTx(id) {
    if (!confirm("Ushbu tranzaksiyani o'chirmoqchimisiz?")) return;
    try {
        const res = await fetch(`${API_BASE}/api/transactions/delete`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, user_id: USER_ID }),
        });
        if (res.ok) {
            showToast("🗑️ Tranzaksiya o'chirildi");
            loadAll(false);
        } else {
            showToast("❌ O'chirishda xatolik yuz berdi");
        }
    } catch (e) {
        console.error("Delete failed:", e);
        showToast("❌ Xatolik yuz berdi");
    }
}

// ─── Render Debts ─────────────────────────────────────────────
function renderDebts(debts) {
    const container = document.getElementById("debtsList");
    const summaryRow = document.getElementById("debtSummary");

    const activeDebts = debts.filter(d => !d.is_paid);
    const gave = activeDebts.filter(d => d.direction === "gave");
    const received = activeDebts.filter(d => d.direction === "received");
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

    let filteredDebts = [];
    if (currentDebtFilter === "active") {
        filteredDebts = debts.filter(d => !d.is_paid);
    } else if (currentDebtFilter === "gave") {
        filteredDebts = debts.filter(d => !d.is_paid && d.direction === "gave");
    } else if (currentDebtFilter === "received") {
        filteredDebts = debts.filter(d => !d.is_paid && d.direction === "received");
    } else if (currentDebtFilter === "paid") {
        filteredDebts = debts.filter(d => d.is_paid);
    }

    if (!filteredDebts.length) {
        container.innerHTML = emptyState("💳", "Ushbu bo'limda qarzlar yo'q!");
        return;
    }

    container.innerHTML = filteredDebts.map(d => {
        let days = null;
        if (d.due_date && !d.is_paid) {
            const todayDate = new Date();
            todayDate.setHours(0, 0, 0, 0);
            const dueDate = new Date(d.due_date);
            dueDate.setHours(0, 0, 0, 0);

            const diffTime = dueDate.getTime() - todayDate.getTime();
            days = Math.round(diffTime / (1000 * 60 * 60 * 24));
        }

        let urgencyClass = d.is_paid ? "paid-item" : "ok";
        let deadlineText = d.is_paid ? "✅ Qaytarilgan / To'langan" : "📅 Muddat belgilanmagan";
        let deadlineClass = d.is_paid ? "paid" : "";

        if (!d.is_paid && days !== null) {
            if (days < 0) {
                urgencyClass = "overdue";
                deadlineClass = "overdue";
                deadlineText = `⚠️ Muddati ${Math.abs(days)} kun oldin o'tgan! (${formatDate(d.due_date)})`;
            } else if (days === 0) {
                urgencyClass = "overdue";
                deadlineClass = "overdue";
                deadlineText = `🔴 Bugun muddati! (${formatDate(d.due_date)})`;
            } else if (days <= 3) {
                urgencyClass = "due-soon";
                deadlineClass = "due-soon";
                deadlineText = `🟠 ${days} kun qoldi (${formatDate(d.due_date)})`;
            } else {
                deadlineText = `🟢 ${days} kun qoldi (${formatDate(d.due_date)})`;
            }
        }

        const dirText = d.direction === "gave" ? "📤 Berdim" : "📥 Oldim";
        const payBtnText = d.direction === "received" ? "✅ To'ladim (Balansdan ayirish)" : "✅ Qaytdi (Balansga qo'shish)";

        return `
      <div class="debt-item ${urgencyClass}">
        <div class="debt-header">
          <div class="debt-person">👤 ${escHtml(d.person_name)}</div>
          <div class="debt-direction-badge ${d.direction}">${dirText}</div>
        </div>
        <div class="debt-amount ${d.direction}">${formatAmount(d.amount)}</div>
        ${d.description ? `<div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px;">📝 ${escHtml(d.description)}</div>` : ""}
        <div class="debt-footer">
          <div class="debt-deadline ${deadlineClass}">${deadlineText}</div>
          ${!d.is_paid ? `<button class="debt-pay-btn" onclick="payDebt('${d.id}')">${payBtnText}</button>` : `<span class="debt-paid-badge">✅ To'langan</span>`}
        </div>
      </div>`;
    }).join("");
}

// ─── Pay / Settle Debt ────────────────────────────────────────
async function payDebt(debtId) {
    if (!confirm("Ushbu qarzni qaytarilgan deb belgilamoqchimisiz? (Balansingiz mos ravishda yangilanadi)")) return;

    try {
        const res = await fetch(`${API_BASE}/api/debts/pay`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ debt_id: debtId, user_id: USER_ID }),
        });

        if (res.ok) {
            showToast("🎉 Qarz to'langan deb belgilandi va balans yangilandi!");
            loadAll(false);
        } else {
            showToast("❌ Xatolik yuz berdi");
        }
    } catch (e) {
        console.error("Pay debt error:", e);
        showToast("❌ Xatolik yuz berdi");
    }
}

// ─── Render Charts ────────────────────────────────────────────
function renderCharts(categories) {
    if (!categories) return;
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

    if (!data || !data.length) {
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
            if (btn.dataset.filter) {
                document.querySelectorAll(".filter-btn[data-filter]").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                currentFilter = btn.dataset.filter;
                renderTransactions(allTransactions);
            }
            if (btn.dataset.debtFilter) {
                document.querySelectorAll(".debt-filter-btn").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                currentDebtFilter = btn.dataset.debtFilter;
                renderDebts(allDebts);
            }
        });
    });
}

// ─── Toast Notification ───────────────────────────────────────
function showToast(msg) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2500);
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

// ─── Premium Actions ──────────────────────────────────────────
function buyPremium(planId) {
    showToast("💳 To'lov xizmati (inpay.uz) tez orada ulanadi! 🔥");
}
