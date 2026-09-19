// ─── Config ───────────────────────────────────────────────────
const API_BASE = window.location.origin;
const tg = window.Telegram?.WebApp;

// Get user_id from Telegram WebApp or URL param
let USER_ID = null;
if (tg && tg.initDataUnsafe?.user?.id) {
    USER_ID = tg.initDataUnsafe.user.id;
} else {
    const params = new URLSearchParams(window.location.search);
    USER_ID = params.get("user_id");
}

// ─── Init ─────────────────────────────────────────────────────
if (tg) {
    tg.expand();
    tg.setHeaderColor("#0a0e1a");
    tg.setBackgroundColor("#0a0e1a");
}

let expenseChartInstance = null;
let incomeChartInstance = null;
let allTransactions = [];
let currentFilter = "all";
let summaryData = null;

document.addEventListener("DOMContentLoaded", () => {
    if (!USER_ID) {
        document.getElementById("userBadge").textContent = "User ID yo'q";
        showEmptyAll("User ID topilmadi. Botdan oching.");
        return;
    }
    document.getElementById("userBadge").textContent = `ID: ${USER_ID}`;
    loadAll();
    setupTabs();
    setupFilters();
});

// ─── Data Loading ─────────────────────────────────────────────
async function loadAll() {
    await Promise.all([loadSummary(), loadTransactions(), loadDebts()]);
}

async function loadSummary() {
    try {
        const res = await fetch(`${API_BASE}/api/summary/${USER_ID}`);
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
        console.error("Summary load failed:", e);
    }
}

async function loadTransactions() {
    try {
        const res = await fetch(`${API_BASE}/api/transactions/${USER_ID}?limit=100`);
        allTransactions = await res.json();
        renderTransactions(allTransactions);
    } catch (e) {
        document.getElementById("transactionsList").innerHTML = emptyState("📭", "Tranzaksiyalar yuklanmadi");
    }
}

async function loadDebts() {
    try {
        const res = await fetch(`${API_BASE}/api/debts/${USER_ID}`);
        const debts = await res.json();
        renderDebts(debts);
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
    const totalGave = gave.reduce((s, d) => s + d.amount, 0);
    const totalReceived = received.reduce((s, d) => s + d.amount, 0);

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
        const days = d.days_remaining;
        let urgencyClass = "ok";
        let deadlineText = "📅 Muddat belgilanmagan";
        let deadlineClass = "";

        if (days !== null && days !== undefined) {
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

// ─── Tabs ─────────────────────────────────────────────────────
function setupTabs() {
    document.querySelectorAll(".tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
            document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
            btn.classList.add("active");
            document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");

            if (btn.dataset.tab === "statistics" && summaryData) {
                // Re-render charts after becoming visible
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

function showToast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 3000);
}
