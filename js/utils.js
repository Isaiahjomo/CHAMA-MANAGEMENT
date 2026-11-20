/**
 * utils.js — Shared utilities for ChamaLink
 */

export function fmt(amount) {
  return 'KES ' + Number(amount || 0).toLocaleString('en-KE', { minimumFractionDigits: 0 });
}

export function fmtDate(isoString) {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtDateTime(isoString) {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleString('en-KE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function monthLabel(yearMonth) {
  if (!yearMonth) return '';
  const [y, m] = yearMonth.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' });
}

export function currentYearMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function prevYearMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function nextYearMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function initials(name = '') {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

export function timeAgo(isoString) {
  if (!isoString) return '';
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ── Loan calculations ──────────────────────────────────────────────
export function calcLoanSchedule(principal, ratePercent, durationMonths, interestType) {
  const rate = ratePercent / 100;
  let totalInterest = 0;
  let monthlyPayment = 0;
  const schedule = [];

  if (interestType === 'flat') {
    totalInterest = principal * rate * durationMonths;
    monthlyPayment = (principal + totalInterest) / durationMonths;
    let balance = principal;
    for (let i = 1; i <= durationMonths; i++) {
      const interestPortion = (principal * rate);
      const principalPortion = principal / durationMonths;
      balance -= principalPortion;
      schedule.push({
        month: i,
        payment: monthlyPayment,
        principal: principalPortion,
        interest: interestPortion,
        balance: Math.max(0, balance)
      });
    }
  } else {
    // Reducing balance
    monthlyPayment = (principal * rate * Math.pow(1 + rate, durationMonths)) /
                     (Math.pow(1 + rate, durationMonths) - 1);
    let balance = principal;
    for (let i = 1; i <= durationMonths; i++) {
      const interestPortion = balance * rate;
      const principalPortion = monthlyPayment - interestPortion;
      totalInterest += interestPortion;
      balance = Math.max(0, balance - principalPortion);
      schedule.push({
        month: i,
        payment: monthlyPayment,
        principal: principalPortion,
        interest: interestPortion,
        balance
      });
    }
  }

  return { monthlyPayment, totalInterest, totalRepayment: principal + totalInterest, schedule };
}

// ── Toast helper ──────────────────────────────────────────────────
export function showToast(msg, type = 'success', duration = 2500) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `toast ${type}`;
  el.classList.remove('hidden');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.add('hidden'), duration);
}

// ── Modal helpers ─────────────────────────────────────────────────
export function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}

export function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

export function confirm(msg) {
  return window.confirm(msg);
}
