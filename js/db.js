/**
 * db.js — ChamaLink localStorage database layer
 * All data is namespaced by chamaId so multiple chamas are isolated.
 */

const DB_VERSION = '1';
const GLOBAL_KEY = 'chamalink_global';

// ── Global (cross-chama) ──────────────────────────────────────────
export function getGlobal() {
  try { return JSON.parse(localStorage.getItem(GLOBAL_KEY)) || {}; }
  catch { return {}; }
}
export function saveGlobal(data) {
  localStorage.setItem(GLOBAL_KEY, JSON.stringify(data));
}

export function getChamas() {
  const g = getGlobal();
  return g.chamas || [];
}

export function saveChamas(chamas) {
  const g = getGlobal();
  g.chamas = chamas;
  saveGlobal(g);
}

export function getChamaById(id) {
  return getChamas().find(c => c.id === id) || null;
}

export function upsertChama(chama) {
  const chamas = getChamas();
  const idx = chamas.findIndex(c => c.id === chama.id);
  if (idx >= 0) chamas[idx] = chama;
  else chamas.push(chama);
  saveChamas(chamas);
}

export function deleteChama(id) {
  const chamas = getChamas().filter(c => c.id !== id);
  saveChamas(chamas);
  // also wipe chama data
  ['members','contributions','loans','fines','meetings','notifications','activity'].forEach(table => {
    localStorage.removeItem(`cl_${id}_${table}`);
  });
}

// ── Per-chama table helpers ───────────────────────────────────────
function key(chamaId, table) { return `cl_${chamaId}_${table}`; }

function getTable(chamaId, table) {
  try { return JSON.parse(localStorage.getItem(key(chamaId, table))) || []; }
  catch { return []; }
}

function saveTable(chamaId, table, data) {
  localStorage.setItem(key(chamaId, table), JSON.stringify(data));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── Generic CRUD ──────────────────────────────────────────────────
export function getAll(chamaId, table) {
  return getTable(chamaId, table);
}

export function getById(chamaId, table, id) {
  return getTable(chamaId, table).find(r => r.id === id) || null;
}

export function insert(chamaId, table, record) {
  const rows = getTable(chamaId, table);
  const newRecord = { ...record, id: uid(), createdAt: new Date().toISOString() };
  rows.push(newRecord);
  saveTable(chamaId, table, rows);
  return newRecord;
}

export function update(chamaId, table, id, changes) {
  const rows = getTable(chamaId, table);
  const idx = rows.findIndex(r => r.id === id);
  if (idx < 0) return null;
  rows[idx] = { ...rows[idx], ...changes, updatedAt: new Date().toISOString() };
  saveTable(chamaId, table, rows);
  return rows[idx];
}

export function remove(chamaId, table, id) {
  const rows = getTable(chamaId, table).filter(r => r.id !== id);
  saveTable(chamaId, table, rows);
}

// ── Contributions helpers ─────────────────────────────────────────
export function getContributionsByMonth(chamaId, yearMonth) {
  // yearMonth = 'YYYY-MM'
  return getAll(chamaId, 'contributions').filter(c => c.month === yearMonth);
}

export function getContributionsByMember(chamaId, memberId) {
  return getAll(chamaId, 'contributions').filter(c => c.memberId === memberId);
}

// ── Loans helpers ─────────────────────────────────────────────────
export function getActiveLoans(chamaId) {
  return getAll(chamaId, 'loans').filter(l => l.status === 'active');
}

export function getLoanRepayments(chamaId, loanId) {
  return getAll(chamaId, 'repayments').filter(r => r.loanId === loanId);
}

export function insertRepayment(chamaId, repayment) {
  return insert(chamaId, 'repayments', repayment);
}

export function getAllRepayments(chamaId) {
  return getAll(chamaId, 'repayments');
}

// ── Activity log ──────────────────────────────────────────────────
export function logActivity(chamaId, entry) {
  const rows = getTable(chamaId, 'activity');
  rows.unshift({ ...entry, id: uid(), time: new Date().toISOString() });
  if (rows.length > 100) rows.length = 100; // keep last 100
  saveTable(chamaId, 'activity', rows);
}

export function getActivity(chamaId, limit = 20) {
  return getTable(chamaId, 'activity').slice(0, limit);
}

// ── Notifications ─────────────────────────────────────────────────
export function pushNotification(chamaId, notif) {
  return insert(chamaId, 'notifications', { ...notif, read: false });
}

export function markNotifsRead(chamaId) {
  const rows = getAll(chamaId, 'notifications').map(n => ({ ...n, read: true }));
  saveTable(chamaId, 'notifications', rows);
}

export function clearNotifications(chamaId) {
  saveTable(chamaId, 'notifications', []);
}

export function getUnreadCount(chamaId) {
  return getAll(chamaId, 'notifications').filter(n => !n.read).length;
}

// ── Export / Import ───────────────────────────────────────────────
export function exportChamaData(chamaId) {
  const tables = ['members','contributions','loans','repayments','fines','meetings','notifications','activity'];
  const data = { version: DB_VERSION, chamaId, exported: new Date().toISOString() };
  tables.forEach(t => { data[t] = getAll(chamaId, t); });
  data.chamaInfo = getChamaById(chamaId);
  return JSON.stringify(data, null, 2);
}

export function importChamaData(jsonString) {
  const data = JSON.parse(jsonString);
  const tables = ['members','contributions','loans','repayments','fines','meetings','notifications','activity'];
  const chamaId = data.chamaId;
  tables.forEach(t => {
    if (data[t]) saveTable(chamaId, t, data[t]);
  });
  if (data.chamaInfo) upsertChama(data.chamaInfo);
  return chamaId;
}
