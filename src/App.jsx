import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  Plus, X, Edit2, Trash2, Copy, Search, Calendar as CalendarIcon,
  Download, Upload, Settings, Home, List, PieChart as PieIcon, Wallet,
  Smartphone, CreditCard, Landmark, MoreHorizontal, Utensils, Bus,
  ShoppingBag, Receipt, Film, Stethoscope, GraduationCap, User,
  ChevronLeft, ChevronRight, Sun, Moon, TrendingUp, TrendingDown,
  AlertTriangle, CheckCircle2, RefreshCw, ArrowLeftRight, SlidersHorizontal,
  ArrowDownToLine, WifiOff, ShieldCheck,
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { idbGet, idbSet } from "./db";

/* ------------------------------------------------------------------ */
/* Constants                                                          */
/* ------------------------------------------------------------------ */

const CATEGORIES = [
  { id: "Food", icon: Utensils, color: "#E2574C" },
  { id: "Travel", icon: Bus, color: "#3B82C4" },
  { id: "Shopping", icon: ShoppingBag, color: "#C99A3D" },
  { id: "Bills", icon: Receipt, color: "#8B5CF6" },
  { id: "Rent", icon: Home, color: "#1B8A5A" },
  { id: "Entertainment", icon: Film, color: "#EC4899" },
  { id: "Medical", icon: Stethoscope, color: "#EF4444" },
  { id: "Education", icon: GraduationCap, color: "#2563EB" },
  { id: "Personal", icon: User, color: "#F59E0B" },
  { id: "Other", icon: MoreHorizontal, color: "#6B7280" },
];

const PAYMENT_METHODS = [
  { id: "Cash", icon: Wallet },
  { id: "UPI", icon: Smartphone },
  { id: "Debit Card", icon: CreditCard },
  { id: "Credit Card", icon: CreditCard },
  { id: "Bank Transfer", icon: Landmark },
  { id: "Other", icon: MoreHorizontal },
];

const FREQUENCIES = ["Daily", "Weekly", "Monthly", "Yearly"];

const THEMES = {
  light: {
    bg: "#F7F5F0", surface: "#FFFFFF", surfaceAlt: "#EFEBE2",
    text: "#17231D", textMuted: "#5B6B63", border: "#E2DDD0",
    primary: "#1B8A5A", primarySoft: "#E4F2EA", primaryText: "#FFFFFF",
    accent: "#C99A3D", accentSoft: "#F7EDD8",
    danger: "#E2574C", dangerSoft: "#FBE7E4",
    warn: "#D98A2B", warnSoft: "#FBEEDA",
  },
  dark: {
    bg: "#0E1512", surface: "#161F1A", surfaceAlt: "#1E2A23",
    text: "#EEEDE6", textMuted: "#8DA096", border: "#28352E",
    primary: "#34C08A", primarySoft: "#173327", primaryText: "#06140E",
    accent: "#E0B563", accentSoft: "#2E260F",
    danger: "#F07268", dangerSoft: "#331715",
    warn: "#F0B15C", warnSoft: "#332512",
  },
};

const CAT_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
const PAY_MAP = Object.fromEntries(PAYMENT_METHODS.map((p) => [p.id, p]));

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

const pad = (n) => String(n).padStart(2, "0");
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayKey = () => dateKey(new Date());
const timeStr = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

const fmtINR = (n) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(
    Math.round(n || 0)
  );

const fmt12h = (hhmm) => {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${period}`;
};

const startOfWeek = (d) => {
  const dt = new Date(d);
  const day = dt.getDay();
  dt.setDate(dt.getDate() - day);
  dt.setHours(0, 0, 0, 0);
  return dt;
};

const monthKey = (dateStr) => dateStr.slice(0, 7); // YYYY-MM
const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();

const parseLocalDate = (dateStr) => {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
};

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function toCSV(expenses) {
  const header = "Date,Time,Category,Description,Payment Method,Amount,Notes";
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = expenses.map((e) =>
    [e.date, e.time, e.category, e.description, e.paymentMethod, e.amount, e.notes || ""].map(esc).join(",")
  );
  return [header, ...rows].join("\n");
}

/* ------------------------------------------------------------------ */
/* Storage layer (persists across sessions via IndexedDB, on-device)  */
/* ------------------------------------------------------------------ */

async function loadKey(key, fallback) {
  try {
    const value = await idbGet(key);
    return value !== undefined && value !== null ? value : fallback;
  } catch {
    return fallback;
  }
}
async function saveKey(key, value) {
  try {
    await idbSet(key, value);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Recurring expense generation                                       */
/* ------------------------------------------------------------------ */

function nextOccurrence(dateStr, frequency) {
  const d = parseLocalDate(dateStr);
  if (frequency === "Daily") d.setDate(d.getDate() + 1);
  else if (frequency === "Weekly") d.setDate(d.getDate() + 7);
  else if (frequency === "Monthly") d.setMonth(d.getMonth() + 1);
  else if (frequency === "Yearly") d.setFullYear(d.getFullYear() + 1);
  return dateKey(d);
}

function generateDueExpenses(recurringList, existingExpenses) {
  const today = todayKey();
  const newExpenses = [];
  const updatedRecurring = recurringList.map((r) => {
    if (!r.active) return r;
    let cursor = r.lastGenerated || r.startDate;
    let generatedFromStart = !r.lastGenerated;
    let safety = 0;
    // If never generated, the first occurrence is the start date itself.
    let next = generatedFromStart ? r.startDate : nextOccurrence(cursor, r.frequency);
    while (next <= today && safety < 1000) {
      const alreadyExists = existingExpenses.some(
        (e) => e.recurringId === r.id && e.date === next
      );
      if (!alreadyExists) {
        newExpenses.push({
          id: uid(),
          date: next,
          time: "09:00",
          category: r.category,
          description: r.description,
          paymentMethod: r.paymentMethod,
          amount: r.amount,
          notes: r.notes || "",
          recurringId: r.id,
          createdAt: Date.now(),
        });
      }
      cursor = next;
      next = nextOccurrence(cursor, r.frequency);
      safety++;
    }
    return { ...r, lastGenerated: cursor > (r.lastGenerated || "") ? cursor : r.lastGenerated };
  });
  return { newExpenses, updatedRecurring };
}

/* ------------------------------------------------------------------ */
/* PWA install-prompt hook                                             */
/* ------------------------------------------------------------------ */

function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [installed, setInstalled] = useState(
    () => window.matchMedia && window.matchMedia("(display-mode: standalone)").matches
  );

  useEffect(() => {
    const onBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return false;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    return outcome === "accepted";
  }, [deferredPrompt]);

  return { canPrompt: !!deferredPrompt, installed, promptInstall };
}

function useOnlineStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

/* ------------------------------------------------------------------ */
/* Main App                                                            */
/* ------------------------------------------------------------------ */

export default function ExpenseTracker() {
  const [theme, setTheme] = useState("light");
  const [loading, setLoading] = useState(true);
  const [expenses, setExpenses] = useState([]);
  const [recurring, setRecurring] = useState([]);
  const [budget, setBudget] = useState({ monthly: 0, categories: {} });
  const [tab, setTab] = useState("home");
  const [toast, setToast] = useState(null);
  const [editingExpense, setEditingExpense] = useState(null); // expense object or null
  const [showAddModal, setShowAddModal] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(null); // {message, onConfirm}
  const [selectedDate, setSelectedDate] = useState(todayKey());
  const online = useOnlineStatus();

  const T = THEMES[theme];

  /* -------------------- initial load -------------------- */
  useEffect(() => {
    (async () => {
      const [exp, rec, bud, settings] = await Promise.all([
        loadKey("expenses", []),
        loadKey("recurring", []),
        loadKey("budget", { monthly: 0, categories: {} }),
        loadKey("settings", { theme: "light" }),
      ]);
      const { newExpenses, updatedRecurring } = generateDueExpenses(rec, exp);
      const mergedExpenses = [...exp, ...newExpenses];
      setExpenses(mergedExpenses);
      setRecurring(updatedRecurring);
      setBudget(bud);
      setTheme(settings.theme || "light");
      setLoading(false);
      if (newExpenses.length > 0) {
        saveKey("expenses", mergedExpenses);
        saveKey("recurring", updatedRecurring);
      }
    })();
  }, []);

  const showToast = useCallback((msg, kind = "success") => {
    setToast({ msg, kind, id: uid() });
    setTimeout(() => setToast((t) => (t && t.msg === msg ? null : t)), 2600);
  }, []);

  /* -------------------- persistence helpers -------------------- */
  const persistExpenses = useCallback(async (next) => {
    setExpenses(next);
    await saveKey("expenses", next);
  }, []);
  const persistRecurring = useCallback(async (next) => {
    setRecurring(next);
    await saveKey("recurring", next);
  }, []);
  const persistBudget = useCallback(async (next) => {
    setBudget(next);
    await saveKey("budget", next);
  }, []);
  const persistTheme = useCallback(async (next) => {
    setTheme(next);
    await saveKey("settings", { theme: next });
  }, []);

  /* -------------------- expense CRUD -------------------- */
  const addExpense = useCallback(
    async (data) => {
      const now = new Date();
      const record = {
        id: uid(),
        date: data.date || todayKey(),
        time: data.time || timeStr(now),
        category: data.category,
        description: data.description,
        paymentMethod: data.paymentMethod,
        amount: Number(data.amount),
        notes: data.notes || "",
        createdAt: Date.now(),
      };
      await persistExpenses([record, ...expenses]);
      showToast("Expense added");
    },
    [expenses, persistExpenses, showToast]
  );

  const updateExpense = useCallback(
    async (id, data) => {
      const next = expenses.map((e) => (e.id === id ? { ...e, ...data, amount: Number(data.amount) } : e));
      await persistExpenses(next);
      showToast("Expense updated");
    },
    [expenses, persistExpenses, showToast]
  );

  const deleteExpense = useCallback(
    (id) => {
      setConfirmDialog({
        title: "Delete expense?",
        message: "This action cannot be undone.",
        danger: true,
        onConfirm: async () => {
          await persistExpenses(expenses.filter((e) => e.id !== id));
          showToast("Expense deleted", "danger");
          setConfirmDialog(null);
        },
      });
    },
    [expenses, persistExpenses, showToast]
  );

  const duplicateExpense = useCallback(
    async (e) => {
      const record = { ...e, id: uid(), date: todayKey(), time: timeStr(new Date()), createdAt: Date.now() };
      delete record.recurringId;
      await persistExpenses([record, ...expenses]);
      showToast("Expense duplicated");
    },
    [expenses, persistExpenses, showToast]
  );

  /* -------------------- derived stats -------------------- */
  const stats = useMemo(() => {
    const today = todayKey();
    const now = new Date();
    const wkStart = dateKey(startOfWeek(now));
    const mStart = today.slice(0, 7);

    const todayTotal = expenses.filter((e) => e.date === today).reduce((s, e) => s + e.amount, 0);
    const weekTotal = expenses.filter((e) => e.date >= wkStart && e.date <= today).reduce((s, e) => s + e.amount, 0);
    const monthTotal = expenses.filter((e) => e.date.slice(0, 7) === mStart).reduce((s, e) => s + e.amount, 0);
    const allTotal = expenses.reduce((s, e) => s + e.amount, 0);
    const count = expenses.length;
    const uniqueDays = new Set(expenses.map((e) => e.date)).size || 1;
    const avgDaily = allTotal / uniqueDays;
    const amounts = expenses.map((e) => e.amount);
    const highest = amounts.length ? Math.max(...amounts) : 0;
    const lowest = amounts.length ? Math.min(...amounts) : 0;

    return { todayTotal, weekTotal, monthTotal, allTotal, count, avgDaily, highest, lowest, mStart };
  }, [expenses]);

  /* -------------------- render -------------------- */

  if (loading) {
    return (
      <div style={{ background: T.bg, color: T.text }} className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="animate-spin" size={28} style={{ color: T.primary }} />
          <span className="text-sm" style={{ color: T.textMuted }}>Loading your ledger…</span>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        background: T.bg,
        color: T.text,
        fontFamily: "'Inter', sans-serif",
        paddingBottom: "calc(6rem + env(safe-area-inset-bottom))",
      }}
      className="min-h-screen"
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600;700&display=swap');
        .font-display { font-family: 'Fraunces', serif; }
        .font-mono-num { font-family: 'JetBrains Mono', monospace; font-variant-numeric: tabular-nums; }
        * { box-sizing: border-box; }
        html, body { overflow-x: hidden; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-thumb { background: ${T.border}; border-radius: 4px; }
        .card-anim { animation: rise 0.28s ease both; }
        @keyframes rise { from { opacity:0; transform: translateY(6px);} to { opacity:1; transform:none;} }
        input, select, textarea { outline: none; font-size: 16px; }
        input:focus, select:focus, textarea:focus { box-shadow: 0 0 0 2px ${T.primary}55; }
        button { -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
        @media (prefers-reduced-motion: reduce) { .card-anim { animation: none; } }
      `}</style>

      {!online && (
        <div
          className="flex items-center justify-center gap-1.5 text-[11px] font-medium py-1.5"
          style={{ background: T.warnSoft, color: T.warn }}
        >
          <WifiOff size={11} /> Offline — changes are saved on this device
        </div>
      )}

      <TopBar T={T} theme={theme} setTheme={persistTheme} />

      <main className="max-w-5xl mx-auto px-4 pt-4">
        {tab === "home" && (
          <HomeTab
            T={T}
            stats={stats}
            budget={budget}
            expenses={expenses}
            onQuickAdd={() => setShowAddModal(true)}
            goTab={setTab}
          />
        )}
        {tab === "expenses" && (
          <ExpensesTab
            T={T}
            expenses={expenses}
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            onEdit={setEditingExpense}
            onDelete={deleteExpense}
            onDuplicate={duplicateExpense}
          />
        )}
        {tab === "analytics" && <AnalyticsTab T={T} expenses={expenses} />}
        {tab === "budget" && <BudgetTab T={T} budget={budget} expenses={expenses} onSave={persistBudget} />}
        {tab === "more" && (
          <MoreTab
            T={T}
            expenses={expenses}
            recurring={recurring}
            onSaveRecurring={persistRecurring}
            onImport={async (data) => {
              await persistExpenses(data.expenses || []);
              await persistRecurring(data.recurring || []);
              await persistBudget(data.budget || { monthly: 0, categories: {} });
              showToast("Backup restored");
            }}
            onClearAll={() => {
              setConfirmDialog({
                title: "Clear ALL data?",
                message: "Every expense, recurring rule and budget will be permanently deleted. Type DELETE to confirm.",
                danger: true,
                requireText: "DELETE",
                onConfirm: async () => {
                  await persistExpenses([]);
                  await persistRecurring([]);
                  await persistBudget({ monthly: 0, categories: {} });
                  showToast("All data cleared", "danger");
                  setConfirmDialog(null);
                },
              });
            }}
            showToast={showToast}
          />
        )}
      </main>

      <BottomNav T={T} tab={tab} setTab={setTab} onAdd={() => setShowAddModal(true)} />

      {(showAddModal || editingExpense) && (
        <ExpenseFormModal
          T={T}
          initial={editingExpense}
          onClose={() => {
            setShowAddModal(false);
            setEditingExpense(null);
          }}
          onSave={async (data) => {
            if (editingExpense) await updateExpense(editingExpense.id, data);
            else await addExpense(data);
            setShowAddModal(false);
            setEditingExpense(null);
          }}
        />
      )}

      {confirmDialog && <ConfirmDialog T={T} dialog={confirmDialog} onCancel={() => setConfirmDialog(null)} />}

      {toast && <Toast T={T} toast={toast} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* TopBar                                                              */
/* ------------------------------------------------------------------ */

function TopBar({ T, theme, setTheme }) {
  return (
    <header
      className="sticky top-0 z-30 backdrop-blur px-4 py-3 flex items-center justify-between"
      style={{
        background: `${T.bg}E6`,
        borderBottom: `1px solid ${T.border}`,
        paddingTop: "calc(0.75rem + env(safe-area-inset-top))",
      }}
    >
      <div className="flex items-center gap-2">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center font-display font-semibold"
          style={{ background: T.primary, color: T.primaryText }}
        >
          ₹
        </div>
        <span className="font-display text-lg font-semibold">Khata</span>
      </div>
      <button
        onClick={() => setTheme(theme === "light" ? "dark" : "light")}
        className="w-9 h-9 rounded-full flex items-center justify-center transition"
        style={{ background: T.surfaceAlt, color: T.text }}
        aria-label="Toggle theme"
      >
        {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
      </button>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Bottom Nav                                                          */
/* ------------------------------------------------------------------ */

function BottomNav({ T, tab, setTab, onAdd }) {
  const items = [
    { id: "home", label: "Home", icon: Home },
    { id: "expenses", label: "Expenses", icon: List },
    { id: "__add__", label: "Add", icon: Plus },
    { id: "analytics", label: "Charts", icon: PieIcon },
    { id: "more", label: "More", icon: Settings },
  ];
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-30 flex items-stretch justify-around px-2"
      style={{
        background: T.surface,
        borderTop: `1px solid ${T.border}`,
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {items.map((it) => {
        const Icon = it.icon;
        if (it.id === "__add__") {
          return (
            <button
              key={it.id}
              onClick={onAdd}
              className="flex flex-col items-center justify-center -mt-5"
            >
              <span
                className="w-12 h-12 rounded-full flex items-center justify-center shadow-lg"
                style={{ background: T.primary, color: T.primaryText }}
              >
                <Plus size={22} />
              </span>
            </button>
          );
        }
        const active = tab === it.id;
        return (
          <button
            key={it.id}
            onClick={() => setTab(it.id)}
            className="flex flex-col items-center justify-center gap-1 py-2 px-3 flex-1"
            style={{ color: active ? T.primary : T.textMuted }}
          >
            <Icon size={19} />
            <span className="text-[10px] font-medium">{it.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* Home Tab                                                            */
/* ------------------------------------------------------------------ */

function HomeTab({ T, stats, budget, expenses, onQuickAdd, goTab }) {
  const monthlyBudget = budget.monthly || 0;
  const pct = monthlyBudget > 0 ? Math.min(100, (stats.monthTotal / monthlyBudget) * 100) : 0;
  const remaining = monthlyBudget - stats.monthTotal;
  const barColor = pct >= 100 ? T.danger : pct >= 90 ? T.danger : pct >= 75 ? T.warn : T.primary;

  const recent = expenses.slice(0, 5);

  return (
    <div className="space-y-4 pb-4">
      <div className="grid grid-cols-2 gap-3 card-anim">
        <StatCard T={T} label="Today's Spending" value={fmtINR(stats.todayTotal)} accent={T.primary} />
        <StatCard T={T} label="This Month" value={fmtINR(stats.monthTotal)} accent={T.accent} />
      </div>

      <div
        className="rounded-2xl p-4 card-anim"
        style={{ background: T.surface, border: `1px solid ${T.border}` }}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium" style={{ color: T.textMuted }}>Monthly Budget</span>
          <button onClick={() => goTab("budget")} className="text-xs font-medium" style={{ color: T.primary }}>
            Manage
          </button>
        </div>
        {monthlyBudget > 0 ? (
          <>
            <div className="flex items-baseline justify-between mb-2">
              <span className="font-mono-num text-xl font-semibold">{fmtINR(stats.monthTotal)}</span>
              <span className="text-sm font-mono-num" style={{ color: T.textMuted }}>
                / {fmtINR(monthlyBudget)}
              </span>
            </div>
            <div className="h-2.5 rounded-full overflow-hidden" style={{ background: T.surfaceAlt }}>
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${pct}%`, background: barColor }}
              />
            </div>
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs" style={{ color: T.textMuted }}>
                {remaining >= 0 ? "Remaining" : "Over budget"}
              </span>
              <span className="text-xs font-mono-num font-semibold" style={{ color: remaining < 0 ? T.danger : T.text }}>
                {fmtINR(Math.abs(remaining))}
              </span>
            </div>
            {pct >= 75 && (
              <div
                className="mt-3 rounded-lg px-3 py-2 text-xs flex items-center gap-2"
                style={{ background: pct >= 90 ? T.dangerSoft : T.warnSoft, color: pct >= 90 ? T.danger : T.warn }}
              >
                <AlertTriangle size={14} />
                {pct >= 100 ? "Budget exceeded for this month." : pct >= 90 ? "90% of budget used — slow down." : "75% of budget used."}
              </div>
            )}
          </>
        ) : (
          <button onClick={() => goTab("budget")} className="text-sm" style={{ color: T.primary }}>
            Set a monthly budget →
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3 card-anim">
        <MiniStat T={T} label="This Week" value={fmtINR(stats.weekTotal)} />
        <MiniStat T={T} label="Avg / Day" value={fmtINR(stats.avgDaily)} />
        <MiniStat T={T} label="Transactions" value={stats.count} />
      </div>

      <div
        className="rounded-2xl p-4 card-anim"
        style={{ background: T.surface, border: `1px solid ${T.border}` }}
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium" style={{ color: T.textMuted }}>Recent Activity</span>
          <button onClick={() => goTab("expenses")} className="text-xs font-medium" style={{ color: T.primary }}>
            View all
          </button>
        </div>
        {recent.length === 0 ? (
          <EmptyState T={T} text="No expenses yet. Tap + to add your first one." />
        ) : (
          <div className="space-y-1">
            {recent.map((e) => (
              <ExpenseRow key={e.id} T={T} e={e} compact />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ T, label, value, accent }) {
  return (
    <div className="rounded-2xl p-4" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
      <div className="text-xs font-medium mb-1" style={{ color: T.textMuted }}>{label}</div>
      <div className="font-mono-num text-xl font-bold" style={{ color: accent }}>{value}</div>
    </div>
  );
}

function MiniStat({ T, label, value }) {
  return (
    <div className="rounded-xl p-3 text-center" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
      <div className="font-mono-num text-sm font-semibold">{value}</div>
      <div className="text-[10px] mt-0.5" style={{ color: T.textMuted }}>{label}</div>
    </div>
  );
}

function EmptyState({ T, text }) {
  return (
    <div className="text-center py-8">
      <div className="text-sm" style={{ color: T.textMuted }}>{text}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Expense Row                                                         */
/* ------------------------------------------------------------------ */

function ExpenseRow({ T, e, compact, onEdit, onDelete, onDuplicate }) {
  const cat = CAT_MAP[e.category] || CAT_MAP.Other;
  const pay = PAY_MAP[e.paymentMethod] || PAY_MAP.Other;
  const Icon = cat.icon;
  const PayIcon = pay.icon;
  const [open, setOpen] = useState(false);

  return (
    <div
      className="rounded-xl px-3 py-2.5 flex items-center gap-3"
      style={{ background: compact ? "transparent" : T.surfaceAlt }}
    >
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
        style={{ background: `${cat.color}22`, color: cat.color }}
      >
        <Icon size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium truncate">{e.description || e.category}</span>
          <span className="font-mono-num text-sm font-semibold shrink-0">{fmtINR(e.amount)}</span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] mt-0.5" style={{ color: T.textMuted }}>
          <span>{fmt12h(e.time)}</span>
          <span>·</span>
          <PayIcon size={10} />
          <span>{e.paymentMethod}</span>
          {e.recurringId && (
            <>
              <span>·</span>
              <RefreshCw size={9} />
            </>
          )}
        </div>
      </div>
      {!compact && (onEdit || onDelete || onDuplicate) && (
        <div className="relative shrink-0">
          <button
            onClick={() => setOpen((o) => !o)}
            className="w-7 h-7 rounded-full flex items-center justify-center"
            style={{ color: T.textMuted }}
          >
            <MoreHorizontal size={16} />
          </button>
          {open && (
            <div
              className="absolute right-0 top-8 z-20 rounded-lg overflow-hidden shadow-lg w-32"
              style={{ background: T.surface, border: `1px solid ${T.border}` }}
              onMouseLeave={() => setOpen(false)}
            >
              <button
                className="w-full text-left px-3 py-2 text-xs flex items-center gap-2"
                onClick={() => { onEdit(e); setOpen(false); }}
              >
                <Edit2 size={12} /> Edit
              </button>
              <button
                className="w-full text-left px-3 py-2 text-xs flex items-center gap-2"
                onClick={() => { onDuplicate(e); setOpen(false); }}
              >
                <Copy size={12} /> Duplicate
              </button>
              <button
                className="w-full text-left px-3 py-2 text-xs flex items-center gap-2"
                style={{ color: T.danger }}
                onClick={() => { onDelete(e.id); setOpen(false); }}
              >
                <Trash2 size={12} /> Delete
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Expenses Tab (calendar + daily list + search/filter)                */
/* ------------------------------------------------------------------ */

function ExpensesTab({ T, expenses, selectedDate, setSelectedDate, onEdit, onDelete, onDuplicate }) {
  const [viewMonth, setViewMonth] = useState(() => parseLocalDate(selectedDate));
  const [query, setQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({ category: "", paymentMethod: "", min: "", max: "", from: "", to: "" });
  const [sortBy, setSortBy] = useState("time-desc");

  const daysWithExpenses = useMemo(() => {
    const s = new Set();
    expenses.forEach((e) => s.add(e.date));
    return s;
  }, [expenses]);

  const filtersActive = query || filters.category || filters.paymentMethod || filters.min || filters.max || filters.from || filters.to;

  const filteredList = useMemo(() => {
    let list = filtersActive ? expenses.slice() : expenses.filter((e) => e.date === selectedDate);
    if (query) list = list.filter((e) => e.description.toLowerCase().includes(query.toLowerCase()));
    if (filters.category) list = list.filter((e) => e.category === filters.category);
    if (filters.paymentMethod) list = list.filter((e) => e.paymentMethod === filters.paymentMethod);
    if (filters.min) list = list.filter((e) => e.amount >= Number(filters.min));
    if (filters.max) list = list.filter((e) => e.amount <= Number(filters.max));
    if (filters.from) list = list.filter((e) => e.date >= filters.from);
    if (filters.to) list = list.filter((e) => e.date <= filters.to);

    list = list.slice().sort((a, b) => {
      if (sortBy === "time-desc") return (b.date + b.time).localeCompare(a.date + a.time);
      if (sortBy === "time-asc") return (a.date + a.time).localeCompare(b.date + b.time);
      if (sortBy === "amount-desc") return b.amount - a.amount;
      if (sortBy === "amount-asc") return a.amount - b.amount;
      return 0;
    });
    return list;
  }, [expenses, selectedDate, query, filters, filtersActive, sortBy]);

  const dayTotal = filteredList.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="space-y-4 pb-4">
      <MiniCalendar
        T={T}
        viewMonth={viewMonth}
        setViewMonth={setViewMonth}
        selectedDate={selectedDate}
        setSelectedDate={setSelectedDate}
        daysWithExpenses={daysWithExpenses}
      />

      <div className="flex items-center gap-2">
        <div
          className="flex-1 flex items-center gap-2 rounded-xl px-3 py-2"
          style={{ background: T.surface, border: `1px solid ${T.border}` }}
        >
          <Search size={15} style={{ color: T.textMuted }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search descriptions…"
            className="bg-transparent text-sm flex-1"
            style={{ color: T.text }}
          />
        </div>
        <button
          onClick={() => setShowFilters((s) => !s)}
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: showFilters ? T.primary : T.surface, color: showFilters ? T.primaryText : T.text, border: `1px solid ${T.border}` }}
        >
          <SlidersHorizontal size={15} />
        </button>
      </div>

      {showFilters && (
        <div className="rounded-xl p-3 space-y-2 card-anim" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
          <div className="grid grid-cols-2 gap-2">
            <Select T={T} value={filters.category} onChange={(v) => setFilters((f) => ({ ...f, category: v }))} placeholder="Category" options={CATEGORIES.map((c) => c.id)} />
            <Select T={T} value={filters.paymentMethod} onChange={(v) => setFilters((f) => ({ ...f, paymentMethod: v }))} placeholder="Payment" options={PAYMENT_METHODS.map((p) => p.id)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input type="number" placeholder="Min ₹" value={filters.min} onChange={(e) => setFilters((f) => ({ ...f, min: e.target.value }))} className="rounded-lg px-3 py-2 text-sm" style={{ background: T.surfaceAlt, color: T.text }} />
            <input type="number" placeholder="Max ₹" value={filters.max} onChange={(e) => setFilters((f) => ({ ...f, max: e.target.value }))} className="rounded-lg px-3 py-2 text-sm" style={{ background: T.surfaceAlt, color: T.text }} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} className="rounded-lg px-3 py-2 text-sm" style={{ background: T.surfaceAlt, color: T.text }} />
            <input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} className="rounded-lg px-3 py-2 text-sm" style={{ background: T.surfaceAlt, color: T.text }} />
          </div>
          <div className="flex justify-between items-center pt-1">
            <Select T={T} value={sortBy} onChange={setSortBy} placeholder="Sort" options={["time-desc", "time-asc", "amount-desc", "amount-asc"]} labels={{ "time-desc": "Newest first", "time-asc": "Oldest first", "amount-desc": "Amount ↓", "amount-asc": "Amount ↑" }} />
            <button
              onClick={() => setFilters({ category: "", paymentMethod: "", min: "", max: "", from: "", to: "" })}
              className="text-xs font-medium"
              style={{ color: T.danger }}
            >
              Clear filters
            </button>
          </div>
        </div>
      )}

      <div className="rounded-2xl p-4" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium" style={{ color: T.textMuted }}>
            {filtersActive ? `${filteredList.length} result${filteredList.length === 1 ? "" : "s"}` : parseLocalDate(selectedDate).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
          </span>
          <span className="font-mono-num text-sm font-semibold">{fmtINR(dayTotal)}</span>
        </div>
        {filteredList.length === 0 ? (
          <EmptyState T={T} text="No expenses found." />
        ) : (
          <div className="space-y-1.5">
            {filteredList.map((e) => (
              <ExpenseRow key={e.id} T={T} e={e} onEdit={onEdit} onDelete={onDelete} onDuplicate={onDuplicate} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Select({ T, value, onChange, placeholder, options, labels }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg px-3 py-2 text-sm"
      style={{ background: T.surfaceAlt, color: T.text }}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o} value={o}>{labels ? labels[o] : o}</option>
      ))}
    </select>
  );
}

function MiniCalendar({ T, viewMonth, setViewMonth, selectedDate, setSelectedDate, daysWithExpenses }) {
  const y = viewMonth.getFullYear();
  const m = viewMonth.getMonth();
  const firstDay = new Date(y, m, 1).getDay();
  const numDays = daysInMonth(y, m);
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= numDays; d++) cells.push(d);

  return (
    <div className="rounded-2xl p-4" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
      <div className="flex items-center justify-between mb-3">
        <button onClick={() => setViewMonth(new Date(y, m - 1, 1))} className="w-7 h-7 flex items-center justify-center rounded-full" style={{ background: T.surfaceAlt }}>
          <ChevronLeft size={14} />
        </button>
        <span className="text-sm font-semibold font-display">{viewMonth.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</span>
        <button onClick={() => setViewMonth(new Date(y, m + 1, 1))} className="w-7 h-7 flex items-center justify-center rounded-full" style={{ background: T.surfaceAlt }}>
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center mb-1">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <span key={i} className="text-[10px] font-medium" style={{ color: T.textMuted }}>{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const key = `${y}-${pad(m + 1)}-${pad(d)}`;
          const has = daysWithExpenses.has(key);
          const isSelected = key === selectedDate;
          const isToday = key === todayKey();
          return (
            <button
              key={i}
              onClick={() => setSelectedDate(key)}
              className="aspect-square rounded-lg flex flex-col items-center justify-center text-xs relative"
              style={{
                background: isSelected ? T.primary : "transparent",
                color: isSelected ? T.primaryText : T.text,
                fontWeight: isToday ? 700 : 500,
              }}
            >
              {d}
              {has && !isSelected && (
                <span className="w-1 h-1 rounded-full absolute bottom-1" style={{ background: T.accent }} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Analytics Tab (monthly dashboard + charts + comparison)             */
/* ------------------------------------------------------------------ */

function AnalyticsTab({ T, expenses }) {
  const months = useMemo(() => {
    const s = new Set(expenses.map((e) => monthKey(e.date)));
    s.add(todayKey().slice(0, 7));
    return Array.from(s).sort().reverse();
  }, [expenses]);

  const [month, setMonth] = useState(months[0]);
  const [compareMonth, setCompareMonth] = useState(months[1] || months[0]);

  useEffect(() => {
    if (!months.includes(month)) setMonth(months[0]);
  }, [months]); // eslint-disable-line

  const monthExpenses = expenses.filter((e) => monthKey(e.date) === month);
  const total = monthExpenses.reduce((s, e) => s + e.amount, 0);
  const days = new Set(monthExpenses.map((e) => e.date));
  const avgDaily = monthExpenses.length ? total / days.size : 0;

  const dailyTotals = useMemo(() => {
    const map = {};
    monthExpenses.forEach((e) => { map[e.date] = (map[e.date] || 0) + e.amount; });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [monthExpenses]);

  const highestDay = dailyTotals.reduce((h, [d, v]) => (v > (h?.[1] || -1) ? [d, v] : h), null);
  const lowestDay = dailyTotals.reduce((l, [d, v]) => (l === null || v < l[1] ? [d, v] : l), null);

  const categoryTotals = useMemo(() => {
    const map = {};
    monthExpenses.forEach((e) => { map[e.category] = (map[e.category] || 0) + e.amount; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [monthExpenses]);

  const paymentTotals = useMemo(() => {
    const map = {};
    monthExpenses.forEach((e) => { map[e.paymentMethod] = (map[e.paymentMethod] || 0) + e.amount; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [monthExpenses]);

  const trendData = useMemo(() => {
    return months.slice(0, 6).reverse().map((mk) => {
      const t = expenses.filter((e) => monthKey(e.date) === mk).reduce((s, e) => s + e.amount, 0);
      const [y, m] = mk.split("-");
      return { month: new Date(Number(y), Number(m) - 1).toLocaleDateString("en-IN", { month: "short" }), total: t };
    });
  }, [expenses, months]);

  const dailyChartData = dailyTotals.map(([d, v]) => ({ day: d.slice(8), total: v }));

  // comparison
  const compExpenses = expenses.filter((e) => monthKey(e.date) === compareMonth);
  const compTotal = compExpenses.reduce((s, e) => s + e.amount, 0);
  const diff = total - compTotal;
  const pctChange = compTotal > 0 ? (diff / compTotal) * 100 : 0;
  const compCatTotals = useMemo(() => {
    const map = {};
    compExpenses.forEach((e) => { map[e.category] = (map[e.category] || 0) + e.amount; });
    return map;
  }, [compExpenses]);
  const catMapForCompare = Object.fromEntries(categoryTotals);
  const allCatsForCompare = Array.from(new Set([...Object.keys(catMapForCompare), ...Object.keys(compCatTotals)]));

  const monthLabel = (mk) => {
    const [y, m] = mk.split("-");
    return new Date(Number(y), Number(m) - 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  };

  return (
    <div className="space-y-4 pb-4">
      <div className="flex items-center gap-2">
        <CalendarIcon size={15} style={{ color: T.textMuted }} />
        <select value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-lg px-3 py-2 text-sm flex-1" style={{ background: T.surface, border: `1px solid ${T.border}`, color: T.text }}>
          {months.map((mk) => <option key={mk} value={mk}>{monthLabel(mk)}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard T={T} label="Monthly Total" value={fmtINR(total)} accent={T.primary} />
        <StatCard T={T} label="Avg / Day" value={fmtINR(avgDaily)} accent={T.accent} />
        <MiniStat T={T} label="Transactions" value={monthExpenses.length} />
        <MiniStat T={T} label="Active Days" value={days.size} />
      </div>

      {(highestDay || lowestDay) && (
        <div className="grid grid-cols-2 gap-3">
          {highestDay && (
            <div className="rounded-xl p-3" style={{ background: T.dangerSoft }}>
              <div className="text-[10px] font-medium" style={{ color: T.danger }}>Highest Spending Day</div>
              <div className="font-mono-num text-sm font-semibold mt-1" style={{ color: T.text }}>{fmtINR(highestDay[1])}</div>
              <div className="text-[10px]" style={{ color: T.textMuted }}>{parseLocalDate(highestDay[0]).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</div>
            </div>
          )}
          {lowestDay && (
            <div className="rounded-xl p-3" style={{ background: T.primarySoft }}>
              <div className="text-[10px] font-medium" style={{ color: T.primary }}>Lowest Spending Day</div>
              <div className="font-mono-num text-sm font-semibold mt-1" style={{ color: T.text }}>{fmtINR(lowestDay[1])}</div>
              <div className="text-[10px]" style={{ color: T.textMuted }}>{parseLocalDate(lowestDay[0]).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</div>
            </div>
          )}
        </div>
      )}

      <ChartCard T={T} title="Monthly Spending Trend">
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={trendData}>
            <CartesianGrid strokeDasharray="3 3" stroke={T.border} />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: T.textMuted }} />
            <YAxis tick={{ fontSize: 11, fill: T.textMuted }} tickFormatter={(v) => `₹${v >= 1000 ? (v/1000)+'k' : v}`} />
            <Tooltip formatter={(v) => fmtINR(v)} contentStyle={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 12 }} />
            <Line type="monotone" dataKey="total" stroke={T.primary} strokeWidth={2.5} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard T={T} title="Category-wise Spending">
        {categoryTotals.length === 0 ? <EmptyState T={T} text="No data for this month." /> : (
          <>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={categoryTotals.map(([k, v]) => ({ name: k, value: v }))} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
                  {categoryTotals.map(([k]) => <Cell key={k} fill={CAT_MAP[k]?.color || "#999"} />)}
                </Pie>
                <Tooltip formatter={(v) => fmtINR(v)} contentStyle={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-1.5 mt-2">
              {categoryTotals.map(([k, v]) => (
                <div key={k} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: CAT_MAP[k]?.color }} />
                    {k}
                  </span>
                  <span className="font-mono-num">{fmtINR(v)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </ChartCard>

      <ChartCard T={T} title="Payment Method Breakdown">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={paymentTotals.map(([k, v]) => ({ name: k, total: v }))}>
            <CartesianGrid strokeDasharray="3 3" stroke={T.border} />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: T.textMuted }} interval={0} angle={-20} textAnchor="end" height={50} />
            <YAxis tick={{ fontSize: 11, fill: T.textMuted }} tickFormatter={(v) => `₹${v >= 1000 ? (v/1000)+'k' : v}`} />
            <Tooltip formatter={(v) => fmtINR(v)} contentStyle={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 12 }} />
            <Bar dataKey="total" fill={T.accent} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard T={T} title="Daily Spending">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={dailyChartData}>
            <CartesianGrid strokeDasharray="3 3" stroke={T.border} />
            <XAxis dataKey="day" tick={{ fontSize: 10, fill: T.textMuted }} />
            <YAxis tick={{ fontSize: 11, fill: T.textMuted }} tickFormatter={(v) => `₹${v >= 1000 ? (v/1000)+'k' : v}`} />
            <Tooltip formatter={(v) => fmtINR(v)} contentStyle={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 12 }} />
            <Bar dataKey="total" fill={T.primary} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="rounded-2xl p-4" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
        <div className="flex items-center gap-2 mb-3">
          <ArrowLeftRight size={15} style={{ color: T.textMuted }} />
          <span className="text-sm font-medium" style={{ color: T.textMuted }}>Compare with</span>
          <select value={compareMonth} onChange={(e) => setCompareMonth(e.target.value)} className="rounded-lg px-2 py-1 text-sm ml-auto" style={{ background: T.surfaceAlt, color: T.text }}>
            {months.filter((m) => m !== month).map((mk) => <option key={mk} value={mk}>{monthLabel(mk)}</option>)}
          </select>
        </div>
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-xs" style={{ color: T.textMuted }}>{monthLabel(month)}</div>
            <div className="font-mono-num text-lg font-semibold">{fmtINR(total)}</div>
          </div>
          <div className="text-right">
            <div className="text-xs" style={{ color: T.textMuted }}>{monthLabel(compareMonth)}</div>
            <div className="font-mono-num text-lg font-semibold">{fmtINR(compTotal)}</div>
          </div>
        </div>
        <div
          className="rounded-lg px-3 py-2 text-sm flex items-center gap-2"
          style={{ background: diff <= 0 ? T.primarySoft : T.dangerSoft, color: diff <= 0 ? T.primary : T.danger }}
        >
          {diff <= 0 ? <TrendingDown size={15} /> : <TrendingUp size={15} />}
          You spent {fmtINR(Math.abs(diff))} {diff <= 0 ? "less" : "more"} in {monthLabel(month)}
          {compTotal > 0 ? ` (${Math.abs(pctChange).toFixed(1)}% ${diff <= 0 ? "decrease" : "increase"})` : ""}.
        </div>
        {allCatsForCompare.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {allCatsForCompare.map((c) => {
              const a = catMapForCompare[c] || 0;
              const b = compCatTotals[c] || 0;
              const d = a - b;
              return (
                <div key={c} className="flex items-center justify-between text-xs">
                  <span>{c}</span>
                  <span className="font-mono-num" style={{ color: d === 0 ? T.textMuted : d < 0 ? T.primary : T.danger }}>
                    {d === 0 ? "—" : `${d < 0 ? "−" : "+"}${fmtINR(Math.abs(d))}`}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ChartCard({ T, title, children }) {
  return (
    <div className="rounded-2xl p-4" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
      <div className="text-sm font-medium mb-2" style={{ color: T.textMuted }}>{title}</div>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Budget Tab                                                          */
/* ------------------------------------------------------------------ */

function BudgetTab({ T, budget, expenses, onSave }) {
  const [monthly, setMonthly] = useState(budget.monthly || 0);
  const [catBudgets, setCatBudgets] = useState(budget.categories || {});

  useEffect(() => { setMonthly(budget.monthly || 0); setCatBudgets(budget.categories || {}); }, [budget]);

  const mStart = todayKey().slice(0, 7);
  const monthExpenses = expenses.filter((e) => e.date.slice(0, 7) === mStart);
  const spent = monthExpenses.reduce((s, e) => s + e.amount, 0);
  const catSpent = useMemo(() => {
    const map = {};
    monthExpenses.forEach((e) => { map[e.category] = (map[e.category] || 0) + e.amount; });
    return map;
  }, [monthExpenses]);

  const save = () => {
    onSave({ monthly: Number(monthly) || 0, categories: Object.fromEntries(Object.entries(catBudgets).map(([k, v]) => [k, Number(v) || 0])) });
  };

  const pct = monthly > 0 ? Math.min(100, (spent / monthly) * 100) : 0;
  const barColor = pct >= 100 || pct >= 90 ? T.danger : pct >= 75 ? T.warn : T.primary;

  return (
    <div className="space-y-4 pb-4">
      <div className="rounded-2xl p-4" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
        <div className="text-sm font-medium mb-2" style={{ color: T.textMuted }}>Monthly Budget</div>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg font-mono-num" style={{ color: T.textMuted }}>₹</span>
          <input
            type="number"
            value={monthly}
            onChange={(e) => setMonthly(e.target.value)}
            className="flex-1 rounded-lg px-3 py-2 font-mono-num text-lg font-semibold"
            style={{ background: T.surfaceAlt, color: T.text }}
          />
        </div>
        {monthly > 0 && (
          <>
            <div className="flex items-baseline justify-between mb-1 text-sm">
              <span className="font-mono-num font-semibold">{fmtINR(spent)}</span>
              <span className="font-mono-num" style={{ color: T.textMuted }}>/ {fmtINR(monthly)}</span>
            </div>
            <div className="h-2.5 rounded-full overflow-hidden" style={{ background: T.surfaceAlt }}>
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: barColor }} />
            </div>
            <div className="flex justify-between mt-2 text-xs">
              <span style={{ color: T.textMuted }}>{pct.toFixed(0)}% used</span>
              <span style={{ color: monthly - spent < 0 ? T.danger : T.text }} className="font-mono-num">
                {monthly - spent >= 0 ? `${fmtINR(monthly - spent)} left` : `${fmtINR(spent - monthly)} over`}
              </span>
            </div>
          </>
        )}
      </div>

      <div className="rounded-2xl p-4" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
        <div className="text-sm font-medium mb-3" style={{ color: T.textMuted }}>Category Budgets</div>
        <div className="space-y-3">
          {CATEGORIES.map((c) => {
            const Icon = c.icon;
            const catBudget = Number(catBudgets[c.id]) || 0;
            const catSp = catSpent[c.id] || 0;
            const cpct = catBudget > 0 ? Math.min(100, (catSp / catBudget) * 100) : 0;
            return (
              <div key={c.id}>
                <div className="flex items-center gap-2 mb-1">
                  <Icon size={13} style={{ color: c.color }} />
                  <span className="text-xs font-medium flex-1">{c.id}</span>
                  <input
                    type="number"
                    placeholder="₹0"
                    value={catBudgets[c.id] || ""}
                    onChange={(e) => setCatBudgets((b) => ({ ...b, [c.id]: e.target.value }))}
                    className="w-24 rounded-md px-2 py-1 text-xs font-mono-num text-right"
                    style={{ background: T.surfaceAlt, color: T.text }}
                  />
                </div>
                {catBudget > 0 && (
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: T.surfaceAlt }}>
                    <div className="h-full rounded-full" style={{ width: `${cpct}%`, background: cpct >= 90 ? T.danger : cpct >= 75 ? T.warn : c.color }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <button
        onClick={save}
        className="w-full rounded-xl py-3 font-semibold text-sm"
        style={{ background: T.primary, color: T.primaryText }}
      >
        Save Budget
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* More Tab: Recurring + Backup/Settings                               */
/* ------------------------------------------------------------------ */

function MoreTab({ T, expenses, recurring, onSaveRecurring, onImport, onClearAll, showToast }) {
  const [section, setSection] = useState("recurring");
  const fileInputRef = useRef(null);
  const [recForm, setRecForm] = useState(null); // null = closed, {} = new

  const addRecurring = (data) => {
    const rec = {
      id: uid(),
      category: data.category,
      description: data.description,
      paymentMethod: data.paymentMethod,
      amount: Number(data.amount),
      frequency: data.frequency,
      startDate: data.startDate,
      notes: data.notes || "",
      active: true,
      lastGenerated: null,
    };
    onSaveRecurring([rec, ...recurring]);
    setRecForm(null);
    showToast("Recurring expense created");
  };

  const toggleRecurring = (id) => {
    onSaveRecurring(recurring.map((r) => (r.id === id ? { ...r, active: !r.active } : r)));
  };
  const deleteRecurring = (id) => {
    onSaveRecurring(recurring.filter((r) => r.id !== id));
    showToast("Recurring rule removed", "danger");
  };

  const handleExportCSV = () => {
    downloadBlob(toCSV(expenses), `expenses-${todayKey()}.csv`, "text/csv");
    showToast("CSV exported");
  };
  const handleExportJSON = () => {
    downloadBlob(JSON.stringify({ expenses, recurring, exportedAt: new Date().toISOString() }, null, 2), `expense-backup-${todayKey()}.json`, "application/json");
    showToast("JSON backup exported");
  };
  const handleImportFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        onImport(data);
      } catch {
        showToast("Invalid backup file", "danger");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <div className="space-y-4 pb-4">
      <div className="flex gap-2">
        {["recurring", "backup", "install"].map((s) => (
          <button
            key={s}
            onClick={() => setSection(s)}
            className="flex-1 rounded-xl py-2 text-xs sm:text-sm font-medium"
            style={{ background: section === s ? T.primary : T.surface, color: section === s ? T.primaryText : T.text, border: `1px solid ${T.border}` }}
          >
            {s === "recurring" ? "Recurring" : s === "backup" ? "Backup & Data" : "Install App"}
          </button>
        ))}
      </div>

      {section === "recurring" && (
        <div className="space-y-3">
          <button
            onClick={() => setRecForm({})}
            className="w-full rounded-xl py-3 text-sm font-semibold flex items-center justify-center gap-2"
            style={{ background: T.primarySoft, color: T.primary }}
          >
            <Plus size={15} /> New Recurring Expense
          </button>
          {recurring.length === 0 ? (
            <div className="rounded-2xl p-4" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
              <EmptyState T={T} text="No recurring expenses set up. Add rent, EMI, subscriptions, etc." />
            </div>
          ) : (
            recurring.map((r) => {
              const cat = CAT_MAP[r.category] || CAT_MAP.Other;
              const Icon = cat.icon;
              return (
                <div key={r.id} className="rounded-xl p-3 flex items-center gap-3" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
                  <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: `${cat.color}22`, color: cat.color }}>
                    <Icon size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{r.description}</div>
                    <div className="text-[11px]" style={{ color: T.textMuted }}>{r.frequency} · from {r.startDate}</div>
                  </div>
                  <span className="font-mono-num text-sm font-semibold shrink-0">{fmtINR(r.amount)}</span>
                  <button onClick={() => toggleRecurring(r.id)} className="text-[10px] px-2 py-1 rounded-full shrink-0" style={{ background: r.active ? T.primarySoft : T.surfaceAlt, color: r.active ? T.primary : T.textMuted }}>
                    {r.active ? "Active" : "Paused"}
                  </button>
                  <button onClick={() => deleteRecurring(r.id)} className="shrink-0" style={{ color: T.danger }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}

      {section === "backup" && (
        <div className="space-y-3">
          <div className="rounded-2xl p-4" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
            <div className="text-sm font-medium mb-3" style={{ color: T.textMuted }}>Export</div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={handleExportCSV} className="rounded-xl py-3 text-sm font-medium flex flex-col items-center gap-1" style={{ background: T.surfaceAlt }}>
                <Download size={16} /> Export CSV
              </button>
              <button onClick={handleExportJSON} className="rounded-xl py-3 text-sm font-medium flex flex-col items-center gap-1" style={{ background: T.surfaceAlt }}>
                <Download size={16} /> Export JSON
              </button>
            </div>
          </div>
          <div className="rounded-2xl p-4" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
            <div className="text-sm font-medium mb-3" style={{ color: T.textMuted }}>Import</div>
            <button onClick={() => fileInputRef.current?.click()} className="w-full rounded-xl py-3 text-sm font-medium flex items-center justify-center gap-2" style={{ background: T.surfaceAlt }}>
              <Upload size={16} /> Import JSON Backup
            </button>
            <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={handleImportFile} />
          </div>
          <div className="rounded-2xl p-4" style={{ background: T.dangerSoft, border: `1px solid ${T.border}` }}>
            <div className="text-sm font-medium mb-2" style={{ color: T.danger }}>Danger Zone</div>
            <button onClick={onClearAll} className="w-full rounded-xl py-3 text-sm font-semibold" style={{ background: T.danger, color: "#fff" }}>
              Clear All Data
            </button>
          </div>
          <div
            className="rounded-xl px-3 py-2.5 flex items-start gap-2 text-xs"
            style={{ background: T.warnSoft, color: T.warn }}
          >
            <ShieldCheck size={14} className="shrink-0 mt-0.5" />
            <span>
              {expenses.length} expenses stored on this device only. Nothing is sent to the cloud automatically —
              take an Export JSON backup regularly, and always before uninstalling the app, clearing browser/app
              data, or switching phones.
            </span>
          </div>
        </div>
      )}

      {section === "install" && <InstallSection T={T} />}

      {recForm !== null && (
        <RecurringFormModal T={T} onClose={() => setRecForm(null)} onSave={addRecurring} />
      )}
    </div>
  );
}

function InstallSection({ T }) {
  const { canPrompt, installed, promptInstall } = useInstallPrompt();

  const steps = [
    "Open this website in Chrome on your Android phone.",
    "Tap the Chrome menu (⋮) in the top-right corner.",
    'Select "Add to Home screen" or "Install app".',
    "Confirm the installation when prompted.",
    'Open "Khata" from your Android home screen, just like any other app.',
  ];

  return (
    <div className="space-y-3">
      {installed ? (
        <div
          className="rounded-2xl p-4 flex items-center gap-3"
          style={{ background: T.primarySoft, color: T.primary, border: `1px solid ${T.border}` }}
        >
          <CheckCircle2 size={20} />
          <div>
            <div className="text-sm font-semibold">Already installed</div>
            <div className="text-xs mt-0.5" style={{ color: T.textMuted }}>
              You're running Khata as an installed app.
            </div>
          </div>
        </div>
      ) : canPrompt ? (
        <button
          onClick={promptInstall}
          className="w-full rounded-xl py-3.5 text-sm font-semibold flex items-center justify-center gap-2"
          style={{ background: T.primary, color: T.primaryText }}
        >
          <ArrowDownToLine size={16} /> Install App
        </button>
      ) : (
        <div
          className="rounded-xl px-3 py-2.5 text-xs flex items-start gap-2"
          style={{ background: T.surfaceAlt, color: T.textMuted }}
        >
          <Smartphone size={14} className="shrink-0 mt-0.5" />
          Your browser doesn't support one-tap install here — follow the manual steps below instead.
        </div>
      )}

      <div className="rounded-2xl p-4" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
        <div className="text-sm font-medium mb-3" style={{ color: T.textMuted }}>How to install on Android Chrome</div>
        <ol className="space-y-2.5">
          {steps.map((step, i) => (
            <li key={i} className="flex items-start gap-3 text-sm">
              <span
                className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0 mt-0.5"
                style={{ background: T.primarySoft, color: T.primary }}
              >
                {i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      </div>

      <div className="rounded-2xl p-4" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
        <div className="text-sm font-medium mb-2" style={{ color: T.textMuted }}>Why install it?</div>
        <ul className="space-y-1.5 text-xs" style={{ color: T.textMuted }}>
          <li>• Opens full-screen, without Chrome's address bar — feels like a native app.</li>
          <li>• Gets its own icon on your home screen and app drawer.</li>
          <li>• Keeps working offline once it has loaded the first time.</li>
          <li>• Still uses the exact same on-device data as the browser tab — nothing is duplicated.</li>
        </ul>
      </div>
    </div>
  );
}

function RecurringFormModal({ T, onClose, onSave }) {
  const [form, setForm] = useState({
    category: "Bills", description: "", paymentMethod: "UPI", amount: "",
    frequency: "Monthly", startDate: todayKey(), notes: "",
  });
  const valid = form.description.trim() && Number(form.amount) > 0;

  return (
    <ModalShell T={T} title="New Recurring Expense" onClose={onClose}>
      <FormField label="Description" T={T}>
        <input autoFocus value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="e.g. Rent, Netflix, EMI" className="w-full rounded-lg px-3 py-2 text-sm" style={{ background: T.surfaceAlt, color: T.text }} />
      </FormField>
      <FormField label="Amount (₹)" T={T}>
        <input type="number" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} placeholder="0" className="w-full rounded-lg px-3 py-2 text-sm font-mono-num" style={{ background: T.surfaceAlt, color: T.text }} />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Category" T={T}>
          <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className="w-full rounded-lg px-3 py-2 text-sm" style={{ background: T.surfaceAlt, color: T.text }}>
            {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.id}</option>)}
          </select>
        </FormField>
        <FormField label="Payment" T={T}>
          <select value={form.paymentMethod} onChange={(e) => setForm((f) => ({ ...f, paymentMethod: e.target.value }))} className="w-full rounded-lg px-3 py-2 text-sm" style={{ background: T.surfaceAlt, color: T.text }}>
            {PAYMENT_METHODS.map((p) => <option key={p.id} value={p.id}>{p.id}</option>)}
          </select>
        </FormField>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Frequency" T={T}>
          <select value={form.frequency} onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value }))} className="w-full rounded-lg px-3 py-2 text-sm" style={{ background: T.surfaceAlt, color: T.text }}>
            {FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </FormField>
        <FormField label="Start Date" T={T}>
          <input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} className="w-full rounded-lg px-3 py-2 text-sm" style={{ background: T.surfaceAlt, color: T.text }} />
        </FormField>
      </div>
      <button
        disabled={!valid}
        onClick={() => onSave(form)}
        className="w-full rounded-xl py-3 font-semibold text-sm mt-1"
        style={{ background: valid ? T.primary : T.surfaceAlt, color: valid ? T.primaryText : T.textMuted }}
      >
        Create Recurring Expense
      </button>
    </ModalShell>
  );
}

/* ------------------------------------------------------------------ */
/* Expense Form Modal (add / edit)                                     */
/* ------------------------------------------------------------------ */

function ExpenseFormModal({ T, initial, onClose, onSave }) {
  const [form, setForm] = useState(() =>
    initial
      ? { ...initial, amount: String(initial.amount) }
      : { date: todayKey(), time: timeStr(new Date()), category: "Food", description: "", paymentMethod: "UPI", amount: "", notes: "" }
  );

  const valid = Number(form.amount) > 0 && form.description.trim().length > 0;

  return (
    <ModalShell T={T} title={initial ? "Edit Expense" : "Add Expense"} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Amount (₹)" T={T}>
          <input
            autoFocus
            type="number"
            inputMode="decimal"
            value={form.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            placeholder="0"
            className="w-full rounded-lg px-3 py-2 text-lg font-mono-num font-semibold"
            style={{ background: T.surfaceAlt, color: T.text }}
          />
        </FormField>
        <FormField label="Date" T={T}>
          <input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className="w-full rounded-lg px-3 py-2 text-sm" style={{ background: T.surfaceAlt, color: T.text }} />
        </FormField>
      </div>

      <FormField label="Category" T={T}>
        <div className="grid grid-cols-5 gap-2">
          {CATEGORIES.map((c) => {
            const Icon = c.icon;
            const active = form.category === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setForm((f) => ({ ...f, category: c.id }))}
                className="flex flex-col items-center gap-1 rounded-lg py-2"
                style={{ background: active ? `${c.color}22` : T.surfaceAlt, border: active ? `1.5px solid ${c.color}` : "1.5px solid transparent" }}
              >
                <Icon size={16} style={{ color: c.color }} />
                <span className="text-[9px]" style={{ color: T.text }}>{c.id}</span>
              </button>
            );
          })}
        </div>
      </FormField>

      <FormField label="Description" T={T}>
        <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="e.g. Lunch at cafe" className="w-full rounded-lg px-3 py-2 text-sm" style={{ background: T.surfaceAlt, color: T.text }} />
      </FormField>

      <FormField label="Payment Method" T={T}>
        <div className="flex flex-wrap gap-2">
          {PAYMENT_METHODS.map((p) => {
            const Icon = p.icon;
            const active = form.paymentMethod === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setForm((f) => ({ ...f, paymentMethod: p.id }))}
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs"
                style={{ background: active ? T.primary : T.surfaceAlt, color: active ? T.primaryText : T.text }}
              >
                <Icon size={12} /> {p.id}
              </button>
            );
          })}
        </div>
      </FormField>

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Time" T={T}>
          <input type="time" value={form.time} onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))} className="w-full rounded-lg px-3 py-2 text-sm" style={{ background: T.surfaceAlt, color: T.text }} />
        </FormField>
        <FormField label="Notes (optional)" T={T}>
          <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Optional" className="w-full rounded-lg px-3 py-2 text-sm" style={{ background: T.surfaceAlt, color: T.text }} />
        </FormField>
      </div>

      <button
        disabled={!valid}
        onClick={() => onSave(form)}
        className="w-full rounded-xl py-3 font-semibold text-sm mt-1"
        style={{ background: valid ? T.primary : T.surfaceAlt, color: valid ? T.primaryText : T.textMuted }}
      >
        {initial ? "Save Changes" : "Add Expense"}
      </button>
    </ModalShell>
  );
}

function FormField({ label, T, children }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium" style={{ color: T.textMuted }}>{label}</label>
      {children}
    </div>
  );
}

function ModalShell({ T, title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0" style={{ background: "#00000066" }} onClick={onClose} />
      <div
        className="relative w-full sm:max-w-md sm:mx-4 rounded-t-2xl sm:rounded-2xl p-5 space-y-3 max-h-[90vh] overflow-y-auto card-anim"
        style={{
          background: T.bg,
          color: T.text,
          paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))",
        }}
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-display text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: T.surfaceAlt }}>
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Confirm Dialog                                                       */
/* ------------------------------------------------------------------ */

function ConfirmDialog({ T, dialog, onCancel }) {
  const [text, setText] = useState("");
  const canConfirm = !dialog.requireText || text === dialog.requireText;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0" style={{ background: "#00000077" }} onClick={onCancel} />
      <div className="relative w-full max-w-sm rounded-2xl p-5 card-anim" style={{ background: T.surface, color: T.text }}>
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle size={18} style={{ color: T.danger }} />
          <h3 className="font-display text-base font-semibold">{dialog.title}</h3>
        </div>
        <p className="text-sm mb-3" style={{ color: T.textMuted }}>{dialog.message}</p>
        {dialog.requireText && (
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`Type ${dialog.requireText} to confirm`}
            className="w-full rounded-lg px-3 py-2 text-sm mb-3"
            style={{ background: T.surfaceAlt, color: T.text }}
          />
        )}
        <div className="flex gap-2">
          <button onClick={onCancel} className="flex-1 rounded-xl py-2.5 text-sm font-medium" style={{ background: T.surfaceAlt, color: T.text }}>
            Cancel
          </button>
          <button
            disabled={!canConfirm}
            onClick={dialog.onConfirm}
            className="flex-1 rounded-xl py-2.5 text-sm font-semibold"
            style={{ background: canConfirm ? T.danger : T.surfaceAlt, color: canConfirm ? "#fff" : T.textMuted }}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Toast                                                                */
/* ------------------------------------------------------------------ */

function Toast({ T, toast }) {
  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 card-anim">
      <div
        className="rounded-full px-4 py-2.5 text-sm font-medium flex items-center gap-2 shadow-lg"
        style={{ background: toast.kind === "danger" ? T.danger : T.text, color: toast.kind === "danger" ? "#fff" : T.bg }}
      >
        {toast.kind === "danger" ? <Trash2 size={14} /> : <CheckCircle2 size={14} />}
        {toast.msg}
      </div>
    </div>
  );
}
