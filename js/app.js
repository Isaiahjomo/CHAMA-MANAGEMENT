/**
 * app.js — ChamaLink main bootstrap and router
 */
import {
  getChamas, saveChamas, getChamaById, upsertChama, deleteChama,
  getAll, insert, update, remove,
  getContributionsByMonth, getContributionsByMember,
  getActiveLoans, getLoanRepayments, insertRepayment, getAllRepayments,
  logActivity, getActivity,
  pushNotification, markNotifsRead, clearNotifications, getUnreadCount,
  exportChamaData, importChamaData
} from './db.js';

import {
  getSession, isAdmin, getChamaId, loginAdmin, loginMember, logout,
  changeAdminPin
} from './auth.js';

import {
  fmt, fmtDate, fmtDateTime, monthLabel,
  currentYearMonth, prevYearMonth, nextYearMonth,
  todayISO, uid, initials, timeAgo, calcLoanSchedule,
  showToast, openModal, closeModal
} from './utils.js';

// ═══════════════════════════════════════════════════════════════════
// BOOTSTRAP
// ═══════════════════════════════════════════════════════════════════
let currentPage = 'dashboard';
let currentContribMonth = currentYearMonth();
let currentLoansTab = 'loans-active';
let currentFinesTab = 'fines-pending';
let currentMeetingsTab = 'meetings-upcoming';
let currentReportTab = 'overview';
let _chartInstances = {};

window.addEventListener('DOMContentLoaded', () => {
  // Hide splash after 1.5s, then show auth
  setTimeout(() => {
    document.getElementById('splash').classList.add('hidden');
    document.getElementById('auth-screen').classList.remove('hidden');
    renderChamaList();
  }, 1500);

  setupAuthListeners();
  setupAppListeners();
  setupModalClosers();
});

// ═══════════════════════════════════════════════════════════════════
// AUTH FLOWS
// ═══════════════════════════════════════════════════════════════════
function renderChamaList() {
  const chamas = getChamas();
  const listEl = document.getElementById('chama-list');
  showAuthView('chama-select-view');

  if (chamas.length === 0) {
    listEl.innerHTML = `<div class="empty-state"><div class="empty-icon">💰</div><p>No Chamas yet. Create your first one!</p></div>`;
    return;
  }

  listEl.innerHTML = chamas.map(c => `
    <div class="chama-card" data-id="${c.id}">
      <div class="chama-card-icon">💰</div>
      <div class="chama-card-info">
        <h3>${escHtml(c.name)}</h3>
        <p>${getAll(c.id,'members').length} members · KES ${Number(c.monthlyContrib || 0).toLocaleString()}/mo</p>
      </div>
      <span class="chama-card-arrow">›</span>
    </div>
  `).join('');

  listEl.querySelectorAll('.chama-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.id;
      showLoginView(id);
    });
  });
}

function showAuthView(viewId) {
  ['chama-select-view','new-chama-view','login-view','member-login-view'].forEach(id => {
    document.getElementById(id).classList.toggle('hidden', id !== viewId);
  });
}

function showLoginView(chamaId) {
  const chama = getChamaById(chamaId);
  document.getElementById('selected-chama-badge').textContent = chama.name;
  document.getElementById('selected-chama-badge-member').textContent = chama.name;
  showAuthView('login-view');
  setupPinPad(chamaId);
}

let _pinBuffer = '';

function setupPinPad(chamaId) {
  _pinBuffer = '';
  updatePinDisplay();
  const pad = document.getElementById('pin-pad');
  pad.onclick = null;
  pad.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-digit]');
    if (!btn) return;
    const d = btn.dataset.digit;
    if (d === 'back') { _pinBuffer = _pinBuffer.slice(0, -1); }
    else if (d === 'ok') { attemptAdminLogin(chamaId); }
    else if (_pinBuffer.length < 6) { _pinBuffer += d; }
    updatePinDisplay();
  });
  document.getElementById('pin-error').classList.add('hidden');
}

function updatePinDisplay() {
  const spans = document.querySelectorAll('#pin-display span');
  spans.forEach((s, i) => s.classList.toggle('filled', i < _pinBuffer.length));
}

function attemptAdminLogin(chamaId) {
  if (loginAdmin(chamaId, _pinBuffer)) {
    enterApp();
  } else {
    _pinBuffer = '';
    updatePinDisplay();
    const err = document.getElementById('pin-error');
    err.classList.remove('hidden');
    setTimeout(() => err.classList.add('hidden'), 2000);
  }
}

function setupAuthListeners() {
  // Create new chama
  document.getElementById('btn-new-chama').addEventListener('click', () => {
    showAuthView('new-chama-view');
    document.getElementById('new-chama-name').value = '';
    document.getElementById('new-chama-pin').value = '';
    document.getElementById('new-chama-contrib').value = '';
  });

  document.getElementById('btn-cancel-chama').addEventListener('click', renderChamaList);

  document.getElementById('btn-create-chama').addEventListener('click', () => {
    const name = document.getElementById('new-chama-name').value.trim();
    const pin  = document.getElementById('new-chama-pin').value.trim();
    const contrib = document.getElementById('new-chama-contrib').value.trim();
    if (!name || !pin || pin.length < 4) {
      showToast('Please fill all fields (PIN must be 4+ digits)', 'error');
      return;
    }
    const chama = {
      id: uid(),
      name,
      adminPin: pin,
      monthlyContrib: Number(contrib) || 0,
      createdAt: new Date().toISOString()
    };
    upsertChama(chama);
    showToast(`Chama "${name}" created!`, 'success');
    renderChamaList();
  });

  // Change chama
  document.getElementById('btn-change-chama').addEventListener('click', renderChamaList);

  // Member login
  document.getElementById('btn-member-login').addEventListener('click', () => {
    // determine which chama we're on from the badge
    const chamaName = document.getElementById('selected-chama-badge').textContent;
    const chama = getChamas().find(c => c.name === chamaName);
    if (!chama) return;
    const memberSel = document.getElementById('member-select');
    const members = getAll(chama.id, 'members');
    memberSel.innerHTML = members.map(m => `<option value="${m.id}">${escHtml(m.name)}</option>`).join('');
    showAuthView('member-login-view');
    memberSel.dataset.chamaId = chama.id;
  });

  document.getElementById('btn-back-to-admin-login').addEventListener('click', () => {
    const chamaId = document.getElementById('member-select').dataset.chamaId;
    showLoginView(chamaId);
  });

  document.getElementById('btn-member-submit').addEventListener('click', () => {
    const chamaId = document.getElementById('member-select').dataset.chamaId;
    const memberId = document.getElementById('member-select').value;
    const pin = document.getElementById('member-pin-input').value.trim();
    const errEl = document.getElementById('member-pin-error');
    if (loginMember(chamaId, memberId, pin)) {
      enterApp();
    } else {
      errEl.classList.remove('hidden');
      setTimeout(() => errEl.classList.add('hidden'), 2000);
    }
  });
}

function enterApp() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('main-app').classList.remove('hidden');
  const session = getSession();
  const chama = getChamaById(session.chamaId);

  // Top bar
  document.getElementById('topbar-chama-name').textContent = chama.name;
  document.getElementById('topbar-role').textContent = session.role === 'admin'
    ? '👑 Admin'
    : `👤 ${session.memberName || 'Member'}`;

  // Admin-only elements
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = isAdmin() ? '' : 'none';
  });

  // Load notifications
  refreshNotifBadge();
  generateSmartNotifications();

  // Load dashboard
  navigateTo('dashboard');
}

// ═══════════════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════════════
function setupAppListeners() {
  // Bottom nav
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = btn.dataset.page;
      if (page === 'more-menu') {
        document.getElementById('more-drawer').classList.remove('hidden');
        return;
      }
      navigateTo(page);
    });
  });

  // More drawer items
  document.querySelectorAll('.more-item').forEach(btn => {
    btn.addEventListener('click', () => {
      closeMoreDrawer();
      navigateTo(btn.dataset.page);
    });
  });

  document.getElementById('more-drawer').addEventListener('click', (e) => {
    if (e.target === e.currentTarget || e.target.classList.contains('more-backdrop')) {
      closeMoreDrawer();
    }
  });

  // Logout
  document.getElementById('btn-logout').addEventListener('click', () => {
    if (window.confirm('Log out?')) {
      logout();
      destroyAllCharts();
      document.getElementById('main-app').classList.add('hidden');
      document.getElementById('auth-screen').classList.remove('hidden');
      renderChamaList();
    }
  });

  // Notifications bell
  document.getElementById('btn-notifications').addEventListener('click', () => {
    navigateTo('notifications');
  });

  // Tabs (generic)
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const container = tab.closest('.tab-bar');
      container.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      if (tab.dataset.tab) {
        if (tab.dataset.tab.startsWith('loans')) { currentLoansTab = tab.dataset.tab; renderLoans(); }
        if (tab.dataset.tab.startsWith('fines')) { currentFinesTab = tab.dataset.tab; renderFines(); }
        if (tab.dataset.tab.startsWith('meetings')) { currentMeetingsTab = tab.dataset.tab; renderMeetings(); }
      }
      if (tab.dataset.reportTab) {
        currentReportTab = tab.dataset.reportTab;
        renderReports();
      }
    });
  });

  setupMembersListeners();
  setupContributionsListeners();
  setupLoansListeners();
  setupFinesListeners();
  setupMeetingsListeners();
  setupNotificationsListeners();
  setupSettingsListeners();
}

function closeMoreDrawer() {
  document.getElementById('more-drawer').classList.add('hidden');
}

function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const target = document.getElementById(`page-${page}`);
  if (target) {
    target.classList.add('active');
    currentPage = page;
  }

  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === page);
  });

  // Render page content
  switch (page) {
    case 'dashboard':     renderDashboard();     break;
    case 'members':       renderMembers();        break;
    case 'contributions': renderContributions(); break;
    case 'loans':         renderLoans();          break;
    case 'fines':         renderFines();          break;
    case 'meetings':      renderMeetings();       break;
    case 'notifications': renderNotifications();  break;
    case 'reports':       renderReports();        break;
    case 'settings':      renderSettings();       break;
  }
}

// ═══════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════
function renderDashboard() {
  const cid = getChamaId();
  const chama = getChamaById(cid);
  const members = getAll(cid, 'members');
  const loans = getAll(cid, 'loans');
  const fines = getAll(cid, 'fines');
  const ym = currentYearMonth();
  const contribs = getContributionsByMonth(cid, ym);
  const paidThisMonth = contribs.reduce((s, c) => s + Number(c.amount), 0);
  const expectedThisMonth = members.length * Number(chama.monthlyContrib || 0);
  const activeLoans = loans.filter(l => l.status === 'active');
  const totalLoanBook = activeLoans.reduce((s, l) => s + Number(l.balance || l.amount), 0);
  const pendingFines = fines.filter(f => f.status === 'pending').reduce((s, f) => s + Number(f.amount), 0);

  document.getElementById('dash-month-label').textContent = monthLabel(ym);

  // Summary cards
  document.getElementById('summary-cards').innerHTML = `
    <div class="summary-card green">
      <div class="summary-card-icon">💳</div>
      <div class="summary-card-label">Contributions</div>
      <div class="summary-card-value">${fmt(paidThisMonth)}</div>
      <div class="summary-card-sub">of ${fmt(expectedThisMonth)} expected</div>
    </div>
    <div class="summary-card blue">
      <div class="summary-card-icon">🏦</div>
      <div class="summary-card-label">Loan Book</div>
      <div class="summary-card-value">${fmt(totalLoanBook)}</div>
      <div class="summary-card-sub">${activeLoans.length} active loan(s)</div>
    </div>
    <div class="summary-card red">
      <div class="summary-card-icon">⚠️</div>
      <div class="summary-card-label">Pending Fines</div>
      <div class="summary-card-value">${fmt(pendingFines)}</div>
      <div class="summary-card-sub">${fines.filter(f=>f.status==='pending').length} unpaid</div>
    </div>
    <div class="summary-card gold">
      <div class="summary-card-icon">👥</div>
      <div class="summary-card-label">Members</div>
      <div class="summary-card-value">${members.length}</div>
      <div class="summary-card-sub">${contribs.length} paid this month</div>
    </div>
  `;

  // Quick actions (admin only)
  const qActions = isAdmin() ? [
    { icon:'👤', label:'Add Member', page:'members', action:'add-member' },
    { icon:'💳', label:'Record Payment', page:'contributions', action:'add' },
    { icon:'🏦', label:'New Loan', page:'loans', action:'add' },
    { icon:'⚠️', label:'Issue Fine', page:'fines', action:'add' },
  ] : [
    { icon:'💳', label:'Contributions', page:'contributions' },
    { icon:'🏦', label:'Loans', page:'loans' },
    { icon:'⚠️', label:'Fines', page:'fines' },
    { icon:'📊', label:'Reports', page:'reports' },
  ];

  document.getElementById('quick-actions').innerHTML = qActions.map(q =>
    `<button class="quick-action" data-page="${q.page}" data-action="${q.action||''}">
      <span>${q.icon}</span><span>${q.label}</span>
    </button>`
  ).join('');

  document.querySelectorAll('.quick-action').forEach(btn => {
    btn.addEventListener('click', () => {
      navigateTo(btn.dataset.page);
      if (btn.dataset.action === 'add') {
        setTimeout(() => {
          const page = btn.dataset.page;
          if (page === 'contributions') document.getElementById('btn-add-contribution')?.click();
          if (page === 'loans') document.getElementById('btn-add-loan')?.click();
          if (page === 'fines') document.getElementById('btn-add-fine')?.click();
          if (page === 'meetings') document.getElementById('btn-add-meeting')?.click();
        }, 100);
      }
      if (btn.dataset.action === 'add-member') {
        setTimeout(() => document.getElementById('btn-add-member')?.click(), 100);
      }
    });
  });

  // Activity feed
  const activity = getActivity(cid, 8);
  const actEl = document.getElementById('activity-feed');
  if (activity.length === 0) {
    actEl.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><p>No activity yet</p></div>`;
  } else {
    actEl.innerHTML = activity.map(a => `
      <div class="activity-item">
        <div class="activity-icon ${a.color || 'green'}">${a.icon || '📌'}</div>
        <div class="activity-info">
          <div class="title">${escHtml(a.title)}</div>
          <div class="sub">${timeAgo(a.time)}</div>
        </div>
        ${a.amount ? `<div class="activity-amount ${a.type || 'credit'}">${fmt(a.amount)}</div>` : ''}
      </div>
    `).join('');
  }

  // Upcoming meeting
  const meetings = getAll(cid, 'meetings').filter(m => new Date(m.datetime) >= new Date()).sort((a,b) => new Date(a.datetime) - new Date(b.datetime));
  const nextMeet = meetings[0];
  const meetEl = document.getElementById('upcoming-meeting-card');
  if (nextMeet) {
    meetEl.innerHTML = `
      <div class="meet-title">📅 ${escHtml(nextMeet.title)}</div>
      <div class="meet-meta">
        <span>🕐 ${fmtDateTime(nextMeet.datetime)}</span>
        <span>📍 ${escHtml(nextMeet.venue || 'TBD')}</span>
      </div>
    `;
  } else {
    meetEl.innerHTML = `<p style="color:var(--text-muted);font-size:14px">No upcoming meetings scheduled.</p>`;
  }
}

// ═══════════════════════════════════════════════════════════════════
// MEMBERS
// ═══════════════════════════════════════════════════════════════════
function setupMembersListeners() {
  document.getElementById('btn-add-member').addEventListener('click', () => {
    if (!isAdmin()) return;
    document.getElementById('modal-member-title').textContent = 'Add Member';
    document.getElementById('mem-name').value = '';
    document.getElementById('mem-phone').value = '';
    document.getElementById('mem-role').value = 'member';
    document.getElementById('mem-pin').value = '';
    document.getElementById('mem-join-date').value = todayISO();
    document.getElementById('mem-id').value = '';
    openModal('modal-member');
  });

  document.getElementById('btn-save-member').addEventListener('click', saveMember);

  document.getElementById('member-search').addEventListener('input', (e) => {
    renderMembers(e.target.value);
  });
}

function saveMember() {
  const cid = getChamaId();
  const name = document.getElementById('mem-name').value.trim();
  const phone = document.getElementById('mem-phone').value.trim();
  const role = document.getElementById('mem-role').value;
  const pin = document.getElementById('mem-pin').value.trim();
  const joinDate = document.getElementById('mem-join-date').value;
  const id = document.getElementById('mem-id').value;

  if (!name) { showToast('Name is required', 'error'); return; }
  if (!/^\d{4,6}$/.test(pin)) {
    showToast('Member PIN must be 4–6 digits', 'error');
    return;
  }

  const duplicateName = getAll(cid, 'members').find(m =>
    m.id !== id && m.name.toLowerCase() === name.toLowerCase()
  );
  if (duplicateName) {
    showToast('A member with this name already exists', 'error');
    return;
  }

  if (phone) {
    const duplicatePhone = getAll(cid, 'members').find(m =>
      m.id !== id && (m.phone || '').replace(/\D/g, '') === phone.replace(/\D/g, '')
    );
    if (duplicatePhone) {
      showToast('A member with this phone number already exists', 'error');
      return;
    }
  }

  if (id) {
    update(cid, 'members', id, { name, phone, role, pin, joinDate });
    showToast('Member updated ✓', 'success');
    logActivity(cid, { title: `Member updated: ${name}`, icon: '👤', color: 'blue' });
  } else {
    insert(cid, 'members', { name, phone, role, pin, joinDate });
    showToast('Member added ✓', 'success');
    logActivity(cid, { title: `New member: ${name}`, icon: '👤', color: 'green' });
  }

  closeModal('modal-member');
  renderMembers();
}

function renderMembers(query = '') {
  const cid = getChamaId();
  let members = getAll(cid, 'members');
  if (query) {
    const q = query.toLowerCase();
    members = members.filter(m => m.name.toLowerCase().includes(q) || (m.phone||'').includes(q));
  }

  const el = document.getElementById('members-list');
  if (members.length === 0) {
    const isSearchEmpty = Boolean(query);
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${isSearchEmpty ? '🔍' : '👥'}</div>
        <p>${isSearchEmpty ? 'No members match your search.' : 'No members added yet.'}</p>
        ${!isSearchEmpty && isAdmin() ? '<button class="btn btn-primary empty-state-action" id="empty-add-member">+ Add First Member</button>' : ''}
      </div>
    `;
    document.getElementById('empty-add-member')?.addEventListener('click', () => {
      document.getElementById('btn-add-member')?.click();
    });
    return;
  }

  el.innerHTML = members.map(m => `
    <div class="member-card">
      <div class="member-avatar">${initials(m.name)}</div>
      <div class="member-info">
        <div class="name">${escHtml(m.name)}</div>
        <div class="role">${capitalize(m.role || 'member')}</div>
        <div class="phone">${m.phone || '—'}</div>
      </div>
      ${isAdmin() ? `
      <div class="member-actions">
        <button class="btn-icon" data-edit="${m.id}" title="Edit">✏️</button>
        <button class="btn-icon" data-del="${m.id}" title="Remove">🗑️</button>
      </div>` : ''}
    </div>
  `).join('');

  el.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => editMember(btn.dataset.edit));
  });
  el.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (window.confirm('Remove this member?')) {
        remove(getChamaId(), 'members', btn.dataset.del);
        renderMembers();
        showToast('Member removed', 'success');
      }
    });
  });
}

function editMember(id) {
  const m = getAll(getChamaId(), 'members').find(x => x.id === id);
  if (!m) return;
  document.getElementById('modal-member-title').textContent = 'Edit Member';
  document.getElementById('mem-name').value = m.name;
  document.getElementById('mem-phone').value = m.phone || '';
  document.getElementById('mem-role').value = m.role || 'member';
  document.getElementById('mem-pin').value = m.pin || '';
  document.getElementById('mem-join-date').value = m.joinDate || '';
  document.getElementById('mem-id').value = m.id;
  openModal('modal-member');
}

// ═══════════════════════════════════════════════════════════════════
// CONTRIBUTIONS
// ═══════════════════════════════════════════════════════════════════
function setupContributionsListeners() {
  document.getElementById('contrib-prev-month').addEventListener('click', () => {
    currentContribMonth = prevYearMonth(currentContribMonth);
    renderContributions();
  });
  document.getElementById('contrib-next-month').addEventListener('click', () => {
    if (currentContribMonth < currentYearMonth()) {
      currentContribMonth = nextYearMonth(currentContribMonth);
      renderContributions();
    }
  });

  document.getElementById('btn-add-contribution').addEventListener('click', () => {
    if (!isAdmin()) return;
    const cid = getChamaId();
    const members = getAll(cid, 'members');
    const sel = document.getElementById('contrib-member');
    sel.innerHTML = members.map(m => `<option value="${m.id}">${escHtml(m.name)}</option>`).join('');
    document.getElementById('contrib-month').value = currentContribMonth;
    document.getElementById('contrib-amount').value = getChamaById(cid)?.monthlyContrib || '';
    document.getElementById('contrib-method').value = 'M-Pesa';
    document.getElementById('contrib-ref').value = '';
    openModal('modal-contribution');
  });

  document.getElementById('btn-save-contribution').addEventListener('click', saveContribution);
}

function saveContribution() {
  const cid = getChamaId();
  const memberId = document.getElementById('contrib-member').value;
  const month = document.getElementById('contrib-month').value;
  const amount = Number(document.getElementById('contrib-amount').value);
  const method = document.getElementById('contrib-method').value;
  const ref = document.getElementById('contrib-ref').value.trim();

  if (!memberId || !month || !amount) { showToast('Fill all required fields', 'error'); return; }

  const member = getAll(cid, 'members').find(m => m.id === memberId);
  insert(cid, 'contributions', { memberId, memberName: member?.name, month, amount, method, ref, paidAt: new Date().toISOString() });
  logActivity(cid, { title: `${member?.name} paid ${monthLabel(month)}`, icon: '💳', color: 'green', amount, type: 'credit' });
  pushNotification(cid, {
    title: 'Contribution Received',
    body: `${member?.name} paid ${fmt(amount)} for ${monthLabel(month)}`,
    icon: '💳',
    color: 'green'
  });
  refreshNotifBadge();
  closeModal('modal-contribution');
  showToast('Contribution recorded ✓', 'success');
  currentContribMonth = month;
  renderContributions();
}

function renderContributions() {
  const cid = getChamaId();
  const chama = getChamaById(cid);
  const members = getAll(cid, 'members');
  const paid = getContributionsByMonth(cid, currentContribMonth);
  const expected = Number(chama?.monthlyContrib || 0);

  document.getElementById('contrib-month-label').textContent = monthLabel(currentContribMonth);

  const totalPaid = paid.reduce((s, c) => s + Number(c.amount), 0);
  const paidCount = [...new Set(paid.map(c => c.memberId))].length;
  const notPaid = members.length - paidCount;

  document.getElementById('contributions-summary').innerHTML = `
    <div class="contrib-stat">
      <div class="contrib-stat-label">Collected</div>
      <div class="contrib-stat-value green">KES ${Number(totalPaid).toLocaleString()}</div>
    </div>
    <div class="contrib-stat">
      <div class="contrib-stat-label">Paid</div>
      <div class="contrib-stat-value green">${paidCount}</div>
    </div>
    <div class="contrib-stat">
      <div class="contrib-stat-label">Defaulters</div>
      <div class="contrib-stat-value red">${notPaid}</div>
    </div>
  `;

  const el = document.getElementById('contributions-grid');
  if (members.length === 0) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">💳</div><p>No members yet. Add members first.</p></div>`;
    return;
  }

  // Build grid: for each member show their contributions this month
  const paidMap = {};
  paid.forEach(c => {
    if (!paidMap[c.memberId]) paidMap[c.memberId] = [];
    paidMap[c.memberId].push(c);
  });

  el.innerHTML = members.map(m => {
    const mContribs = paidMap[m.id] || [];
    const totalMPaid = mContribs.reduce((s, c) => s + Number(c.amount), 0);
    const hasPaid = mContribs.length > 0;
    const statusClass = hasPaid ? (totalMPaid >= expected ? 'paid' : 'pending') : 'overdue';
    const statusLabel = hasPaid ? (totalMPaid >= expected ? 'Paid' : 'Partial') : 'Not Paid';
    const latestRef = mContribs[mContribs.length - 1];

    return `
      <div class="contribution-row">
        <div class="contrib-status ${statusClass}"></div>
        <div class="contrib-info">
          <div class="name">${escHtml(m.name)}</div>
          <div class="method">${latestRef ? `${latestRef.method} ${latestRef.ref ? '· ' + latestRef.ref : ''}` : 'No payment this month'}</div>
        </div>
        <div class="contrib-amount">
          <div class="amount">${hasPaid ? 'KES ' + Number(totalMPaid).toLocaleString() : '—'}</div>
          <div class="status-label ${statusClass}">${statusLabel}</div>
        </div>
      </div>
    `;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════════
// LOANS
// ═══════════════════════════════════════════════════════════════════
function setupLoansListeners() {
  document.getElementById('btn-add-loan').addEventListener('click', () => {
    if (!isAdmin()) return;
    const cid = getChamaId();
    const members = getAll(cid, 'members');
    document.getElementById('loan-member').innerHTML = members.map(m => `<option value="${m.id}">${escHtml(m.name)}</option>`).join('');
    document.getElementById('loan-amount').value = '';
    document.getElementById('loan-interest-type').value = 'flat';
    document.getElementById('loan-interest-rate').value = '10';
    document.getElementById('loan-duration').value = '3';
    document.getElementById('loan-date').value = todayISO();
    document.getElementById('loan-preview').innerHTML = '';
    openModal('modal-loan');
  });

  // Live loan preview
  ['loan-amount','loan-interest-type','loan-interest-rate','loan-duration'].forEach(id => {
    document.getElementById(id).addEventListener('input', updateLoanPreview);
  });

  document.getElementById('btn-save-loan').addEventListener('click', saveLoan);
  document.getElementById('btn-save-repayment').addEventListener('click', saveRepayment);
}

function updateLoanPreview() {
  const principal = Number(document.getElementById('loan-amount').value) || 0;
  const type = document.getElementById('loan-interest-type').value;
  const rate = Number(document.getElementById('loan-interest-rate').value) || 0;
  const dur = Number(document.getElementById('loan-duration').value) || 1;

  if (!principal) { document.getElementById('loan-preview').innerHTML = ''; return; }

  const { monthlyPayment, totalInterest, totalRepayment } = calcLoanSchedule(principal, rate, dur, type);
  document.getElementById('loan-preview').innerHTML = `
    Monthly Payment: <strong>${fmt(monthlyPayment)}</strong><br>
    Total Interest: <strong>${fmt(totalInterest)}</strong><br>
    Total Repayable: <strong>${fmt(totalRepayment)}</strong><br>
    Duration: <strong>${dur} month(s)</strong>
  `;
}

function saveLoan() {
  const cid = getChamaId();
  const memberId = document.getElementById('loan-member').value;
  const amount = Number(document.getElementById('loan-amount').value);
  const type = document.getElementById('loan-interest-type').value;
  const rate = Number(document.getElementById('loan-interest-rate').value);
  const duration = Number(document.getElementById('loan-duration').value);
  const date = document.getElementById('loan-date').value;

  if (!memberId || !amount || !duration) { showToast('Fill all fields', 'error'); return; }

  const member = getAll(cid, 'members').find(m => m.id === memberId);
  const { monthlyPayment, totalInterest, totalRepayment } = calcLoanSchedule(amount, rate, duration, type);

  const loan = insert(cid, 'loans', {
    memberId, memberName: member?.name,
    amount, balance: totalRepayment, totalRepayment,
    monthlyPayment, totalInterest, interestType: type,
    interestRate: rate, duration, disbursedAt: date,
    status: 'active', repaidAmount: 0
  });

  logActivity(cid, { title: `Loan disbursed to ${member?.name}`, icon: '🏦', color: 'blue', amount, type: 'debit' });
  pushNotification(cid, {
    title: 'Loan Disbursed',
    body: `${member?.name} received a loan of ${fmt(amount)}. Monthly: ${fmt(monthlyPayment)}`,
    icon: '🏦', color: 'blue'
  });

  refreshNotifBadge();
  closeModal('modal-loan');
  showToast('Loan disbursed ✓', 'success');
  renderLoans();
}

function openRepaymentModal(loanId) {
  const cid = getChamaId();
  const loan = getAll(cid, 'loans').find(l => l.id === loanId);
  if (!loan) return;
  document.getElementById('repayment-loan-id').value = loanId;
  document.getElementById('repayment-amount').value = '';
  document.getElementById('repayment-date').value = todayISO();
  document.getElementById('repayment-ref').value = '';
  document.getElementById('repayment-loan-info').innerHTML = `
    <strong>${escHtml(loan.memberName)}</strong><br>
    Balance: ${fmt(loan.balance)} · Monthly: ${fmt(loan.monthlyPayment)}
  `;
  openModal('modal-repayment');
}

function saveRepayment() {
  const cid = getChamaId();
  const loanId = document.getElementById('repayment-loan-id').value;
  const amount = Number(document.getElementById('repayment-amount').value);
  const date = document.getElementById('repayment-date').value;
  const ref = document.getElementById('repayment-ref').value.trim();

  if (!amount || !date) { showToast('Fill all fields', 'error'); return; }

  const loan = getAll(cid, 'loans').find(l => l.id === loanId);
  if (!loan) return;

  insertRepayment(cid, { loanId, amount, date, ref, memberName: loan.memberName });

  const newBalance = Math.max(0, Number(loan.balance) - amount);
  const repaidAmount = Number(loan.repaidAmount || 0) + amount;
  const newStatus = newBalance <= 0 ? 'repaid' : 'active';
  update(cid, 'loans', loanId, { balance: newBalance, repaidAmount, status: newStatus });

  logActivity(cid, { title: `Repayment by ${loan.memberName}`, icon: '💰', color: 'green', amount, type: 'credit' });
  if (newStatus === 'repaid') {
    pushNotification(cid, { title: 'Loan Fully Repaid! 🎉', body: `${loan.memberName} has fully repaid their loan.`, icon: '✅', color: 'green' });
  }

  refreshNotifBadge();
  closeModal('modal-repayment');
  showToast('Repayment recorded ✓', 'success');
  renderLoans();
}

function renderLoans() {
  const cid = getChamaId();
  const all = getAll(cid, 'loans');
  let loans;
  if (currentLoansTab === 'loans-active')  loans = all.filter(l => l.status === 'active');
  else if (currentLoansTab === 'loans-repaid') loans = all.filter(l => l.status === 'repaid');
  else loans = all;

  const el = document.getElementById('loans-list');
  if (loans.length === 0) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">🏦</div><p>No loans in this category.</p></div>`;
    return;
  }

  el.innerHTML = loans.map(l => {
    const pct = Math.min(100, Math.round((Number(l.repaidAmount || 0) / Number(l.totalRepayment || 1)) * 100));
    const isOverdue = l.status === 'active' && new Date(l.disbursedAt) < new Date(Date.now() - l.duration * 30 * 86400000);
    const statusClass = l.status === 'repaid' ? 'repaid' : (isOverdue ? 'overdue' : 'active');
    const statusLabel = l.status === 'repaid' ? 'Repaid' : (isOverdue ? 'Overdue' : 'Active');

    return `
      <div class="loan-card">
        <div class="loan-card-header">
          <span class="member-name">${escHtml(l.memberName)}</span>
          <span class="loan-status ${statusClass}">${statusLabel}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:8px">
          <span style="color:var(--text-muted)">Principal</span>
          <strong>${fmt(l.amount)}</strong>
        </div>
        <div class="loan-progress">
          <div class="loan-progress-bar"><div class="loan-progress-fill" style="width:${pct}%"></div></div>
          <div class="loan-progress-labels">
            <span>Repaid: ${fmt(l.repaidAmount || 0)}</span>
            <span>Balance: ${fmt(l.balance)}</span>
          </div>
        </div>
        <div class="loan-meta">
          <div class="loan-meta-item"><strong>${fmt(l.monthlyPayment)}</strong>Monthly</div>
          <div class="loan-meta-item"><strong>${l.interestRate}% ${l.interestType}</strong>Interest</div>
          <div class="loan-meta-item"><strong>${l.duration} mo</strong>Duration</div>
          <div class="loan-meta-item"><strong>${fmtDate(l.disbursedAt)}</strong>Disbursed</div>
        </div>
        ${l.status === 'active' && isAdmin() ? `
        <div class="loan-actions">
          <button class="btn btn-primary btn-sm" data-repay="${l.id}">Record Repayment</button>
        </div>` : ''}
      </div>
    `;
  }).join('');

  el.querySelectorAll('[data-repay]').forEach(btn => {
    btn.addEventListener('click', () => openRepaymentModal(btn.dataset.repay));
  });
}

// ═══════════════════════════════════════════════════════════════════
// FINES
// ═══════════════════════════════════════════════════════════════════
function setupFinesListeners() {
  document.getElementById('btn-add-fine').addEventListener('click', () => {
    if (!isAdmin()) return;
    const cid = getChamaId();
    const members = getAll(cid, 'members');
    document.getElementById('fine-member').innerHTML = members.map(m => `<option value="${m.id}">${escHtml(m.name)}</option>`).join('');
    document.getElementById('fine-amount').value = '';
    document.getElementById('fine-date').value = todayISO();
    document.getElementById('fine-notes').value = '';
    openModal('modal-fine');
  });

  document.getElementById('btn-save-fine').addEventListener('click', saveFine);
}

function saveFine() {
  const cid = getChamaId();
  const memberId = document.getElementById('fine-member').value;
  const reason = document.getElementById('fine-reason').value;
  const amount = Number(document.getElementById('fine-amount').value);
  const date = document.getElementById('fine-date').value;
  const notes = document.getElementById('fine-notes').value.trim();

  if (!memberId || !amount) { showToast('Fill required fields', 'error'); return; }

  const member = getAll(cid, 'members').find(m => m.id === memberId);
  insert(cid, 'fines', { memberId, memberName: member?.name, reason, amount, date, notes, status: 'pending' });

  logActivity(cid, { title: `Fine issued to ${member?.name}: ${reason}`, icon: '⚠️', color: 'red', amount, type: 'debit' });
  pushNotification(cid, { title: 'Fine Issued', body: `${member?.name} fined ${fmt(amount)} for "${reason}"`, icon: '⚠️', color: 'red' });
  refreshNotifBadge();
  closeModal('modal-fine');
  showToast('Fine issued ✓', 'success');
  renderFines();
}

function renderFines() {
  const cid = getChamaId();
  const all = getAll(cid, 'fines');
  const fines = currentFinesTab === 'fines-pending' ? all.filter(f => f.status === 'pending') : all.filter(f => f.status === 'paid');

  const el = document.getElementById('fines-list');
  if (fines.length === 0) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>No fines here.</p></div>`;
    return;
  }

  el.innerHTML = fines.map(f => `
    <div class="fine-card">
      <div class="fine-icon">⚠️</div>
      <div class="fine-info">
        <div class="name">${escHtml(f.memberName)}</div>
        <div class="reason">${escHtml(f.reason)}</div>
        <div class="date">${fmtDate(f.date)}${f.notes ? ' · ' + escHtml(f.notes) : ''}</div>
      </div>
      <div class="fine-right">
        <div class="amount">${fmt(f.amount)}</div>
        <div class="status ${f.status}">${capitalize(f.status)}</div>
        ${f.status === 'pending' && isAdmin() ? `<button class="btn btn-sm btn-outline" style="margin-top:6px" data-mark-paid="${f.id}">Mark Paid</button>` : ''}
      </div>
    </div>
  `).join('');

  el.querySelectorAll('[data-mark-paid]').forEach(btn => {
    btn.addEventListener('click', () => {
      const f = getAll(getChamaId(), 'fines').find(x => x.id === btn.dataset.markPaid);
      update(getChamaId(), 'fines', btn.dataset.markPaid, { status: 'paid', paidAt: new Date().toISOString() });
      logActivity(getChamaId(), { title: `Fine settled by ${f?.memberName}`, icon: '✅', color: 'green', amount: f?.amount, type: 'credit' });
      showToast('Fine marked as paid ✓', 'success');
      renderFines();
    });
  });
}

// ═══════════════════════════════════════════════════════════════════
// MEETINGS
// ═══════════════════════════════════════════════════════════════════
function setupMeetingsListeners() {
  document.getElementById('btn-add-meeting').addEventListener('click', () => {
    if (!isAdmin()) return;
    document.getElementById('modal-meeting-title').textContent = 'Schedule Meeting';
    document.getElementById('meeting-title').value = '';
    document.getElementById('meeting-datetime').value = '';
    document.getElementById('meeting-venue').value = '';
    document.getElementById('meeting-agenda').value = '';
    document.getElementById('meeting-id').value = '';
    openModal('modal-meeting');
  });

  document.getElementById('btn-save-meeting').addEventListener('click', saveMeeting);
  document.getElementById('btn-save-attendance').addEventListener('click', saveAttendance);
}

function saveMeeting() {
  const cid = getChamaId();
  const title = document.getElementById('meeting-title').value.trim();
  const datetime = document.getElementById('meeting-datetime').value;
  const venue = document.getElementById('meeting-venue').value.trim();
  const agenda = document.getElementById('meeting-agenda').value.trim();
  const id = document.getElementById('meeting-id').value;

  if (!title || !datetime) { showToast('Title and date are required', 'error'); return; }

  if (id) {
    update(cid, 'meetings', id, { title, datetime, venue, agenda });
    showToast('Meeting updated ✓', 'success');
  } else {
    insert(cid, 'meetings', { title, datetime, venue, agenda, attendance: [] });
    logActivity(cid, { title: `Meeting scheduled: ${title}`, icon: '📅', color: 'blue' });
    pushNotification(cid, { title: 'Meeting Scheduled', body: `${title} on ${fmtDateTime(datetime)} at ${venue||'TBD'}`, icon: '📅', color: 'blue' });
    refreshNotifBadge();
    showToast('Meeting scheduled ✓', 'success');
  }

  closeModal('modal-meeting');
  renderMeetings();
}

function openAttendanceModal(meetingId) {
  const cid = getChamaId();
  const members = getAll(cid, 'members');
  const meeting = getAll(cid, 'meetings').find(m => m.id === meetingId);
  if (!meeting) return;

  const attended = meeting.attendance || [];
  const list = document.getElementById('attendance-list');
  list.innerHTML = members.map(m => `
    <div class="attendance-item">
      <div class="member-avatar" style="width:32px;height:32px;font-size:13px">${initials(m.name)}</div>
      <label for="att-${m.id}">${escHtml(m.name)}</label>
      <input type="checkbox" id="att-${m.id}" data-member-id="${m.id}" ${attended.includes(m.id) ? 'checked' : ''} />
    </div>
  `).join('');

  document.getElementById('meeting-minutes').value = meeting.minutes || '';
  document.getElementById('attendance-meeting-id').value = meetingId;
  openModal('modal-attendance');
}

function saveAttendance() {
  const cid = getChamaId();
  const meetingId = document.getElementById('attendance-meeting-id').value;
  const checkboxes = document.querySelectorAll('#attendance-list input[type="checkbox"]');
  const attended = [...checkboxes].filter(c => c.checked).map(c => c.dataset.memberId);
  const minutes = document.getElementById('meeting-minutes').value.trim();

  update(cid, 'meetings', meetingId, { attendance: attended, minutes, status: 'done' });
  showToast('Attendance saved ✓', 'success');
  closeModal('modal-attendance');
  renderMeetings();
}

function renderMeetings() {
  const cid = getChamaId();
  const now = new Date();
  const all = getAll(cid, 'meetings').sort((a, b) => new Date(b.datetime) - new Date(a.datetime));
  const meetings = currentMeetingsTab === 'meetings-upcoming'
    ? all.filter(m => new Date(m.datetime) >= now)
    : all.filter(m => new Date(m.datetime) < now);

  const el = document.getElementById('meetings-list');
  if (meetings.length === 0) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">📅</div><p>No meetings here.</p></div>`;
    return;
  }

  el.innerHTML = meetings.map(m => `
    <div class="meeting-card">
      <div class="m-title">📅 ${escHtml(m.title)}</div>
      <div class="meeting-info-row">🕐 ${fmtDateTime(m.datetime)}</div>
      <div class="meeting-info-row">📍 ${escHtml(m.venue || 'TBD')}</div>
      ${m.agenda ? `<div class="meeting-info-row" style="margin-top:6px;white-space:pre-wrap;font-size:12px">📋 ${escHtml(m.agenda)}</div>` : ''}
      ${m.attendance?.length ? `<div class="meeting-info-row">✅ ${m.attendance.length} attended</div>` : ''}
      ${m.minutes ? `<div class="meeting-info-row" style="font-size:12px;white-space:pre-wrap">📝 ${escHtml(m.minutes)}</div>` : ''}
      ${isAdmin() ? `
      <div class="meeting-actions">
        <button class="btn btn-outline btn-sm" data-edit-meeting="${m.id}">Edit</button>
        ${currentMeetingsTab === 'meetings-upcoming' ? `<button class="btn btn-primary btn-sm" data-attendance="${m.id}">Attendance</button>` : `<button class="btn btn-outline btn-sm" data-attendance="${m.id}">View Attendance</button>`}
        <button class="btn btn-danger btn-sm" data-del-meeting="${m.id}">🗑</button>
      </div>` : ''}
    </div>
  `).join('');

  el.querySelectorAll('[data-edit-meeting]').forEach(btn => {
    btn.addEventListener('click', () => {
      const m = getAll(getChamaId(), 'meetings').find(x => x.id === btn.dataset.editMeeting);
      document.getElementById('modal-meeting-title').textContent = 'Edit Meeting';
      document.getElementById('meeting-title').value = m.title;
      document.getElementById('meeting-datetime').value = m.datetime;
      document.getElementById('meeting-venue').value = m.venue || '';
      document.getElementById('meeting-agenda').value = m.agenda || '';
      document.getElementById('meeting-id').value = m.id;
      openModal('modal-meeting');
    });
  });

  el.querySelectorAll('[data-attendance]').forEach(btn => {
    btn.addEventListener('click', () => openAttendanceModal(btn.dataset.attendance));
  });

  el.querySelectorAll('[data-del-meeting]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (window.confirm('Delete this meeting?')) {
        remove(getChamaId(), 'meetings', btn.dataset.delMeeting);
        renderMeetings();
        showToast('Meeting deleted', 'success');
      }
    });
  });
}

// ═══════════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════
function setupNotificationsListeners() {
  document.getElementById('btn-clear-notifs').addEventListener('click', () => {
    clearNotifications(getChamaId());
    refreshNotifBadge();
    renderNotifications();
  });
}

function refreshNotifBadge() {
  const count = getUnreadCount(getChamaId());
  const badge = document.getElementById('notif-badge');
  badge.textContent = count;
  badge.classList.toggle('hidden', count === 0);
}

function renderNotifications() {
  const cid = getChamaId();
  markNotifsRead(cid);
  refreshNotifBadge();
  const notifs = getAll(cid, 'notifications').reverse();

  const el = document.getElementById('notifs-list');
  if (notifs.length === 0) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">🔔</div><p>No notifications yet.</p></div>`;
    return;
  }

  el.innerHTML = notifs.map(n => `
    <div class="notif-item ${n.read ? '' : 'unread'}">
      <div class="notif-icon" style="background:rgba(0,229,160,0.12)">${n.icon || '🔔'}</div>
      <div class="notif-info">
        <div class="n-title">${escHtml(n.title)}</div>
        <div class="n-body">${escHtml(n.body || '')}</div>
        <div class="n-time">${timeAgo(n.createdAt)}</div>
      </div>
    </div>
  `).join('');
}

function generateSmartNotifications() {
  const cid = getChamaId();
  const chama = getChamaById(cid);
  const members = getAll(cid, 'members');
  const loans = getAll(cid, 'loans');
  const ym = currentYearMonth();
  const paid = getContributionsByMonth(cid, ym);
  const paidIds = new Set(paid.map(c => c.memberId));

  // Defaulters notification
  const defaulters = members.filter(m => !paidIds.has(m.id));
  if (defaulters.length > 0) {
    const names = defaulters.slice(0, 3).map(m => m.name).join(', ') + (defaulters.length > 3 ? '...' : '');
    pushNotification(cid, {
      title: `${defaulters.length} member(s) haven't paid this month`,
      body: names,
      icon: '⚠️', color: 'red'
    });
  }

  // Overdue loans
  const overdueLoans = loans.filter(l => l.status === 'active' && new Date(l.disbursedAt) < new Date(Date.now() - l.duration * 30 * 86400000));
  if (overdueLoans.length > 0) {
    pushNotification(cid, {
      title: `${overdueLoans.length} loan(s) are overdue`,
      body: overdueLoans.map(l => l.memberName).join(', '),
      icon: '🏦', color: 'red'
    });
  }

  refreshNotifBadge();
}

// ═══════════════════════════════════════════════════════════════════
// REPORTS
// ═══════════════════════════════════════════════════════════════════
function destroyAllCharts() {
  Object.values(_chartInstances).forEach(c => { try { c.destroy(); } catch {} });
  _chartInstances = {};
}

function renderReports() {
  destroyAllCharts();
  const cid = getChamaId();
  const el = document.getElementById('reports-content');
  const chama = getChamaById(cid);
  const members = getAll(cid, 'members');
  const loans = getAll(cid, 'loans');
  const fines = getAll(cid, 'fines');
  const allContribs = getAll(cid, 'contributions');

  if (currentReportTab === 'overview') {
    const totalContribs = allContribs.reduce((s, c) => s + Number(c.amount), 0);
    const totalLoanBook = loans.filter(l => l.status === 'active').reduce((s, l) => s + Number(l.balance), 0);
    const totalInterestEarned = getAllRepayments(cid).reduce((s, r) => {
      // rough — interest portion from repayments
      return s;
    }, 0);
    const totalFinesPending = fines.filter(f => f.status === 'pending').reduce((s, f) => s + Number(f.amount), 0);
    const totalFinesPaid = fines.filter(f => f.status === 'paid').reduce((s, f) => s + Number(f.amount), 0);

    el.innerHTML = `
      <div class="report-metric-grid">
        <div class="report-metric"><div class="r-label">Total Contributions</div><div class="r-value green">KES ${Number(totalContribs).toLocaleString()}</div></div>
        <div class="report-metric"><div class="r-label">Active Loan Book</div><div class="r-value blue">KES ${Number(totalLoanBook).toLocaleString()}</div></div>
        <div class="report-metric"><div class="r-label">Members</div><div class="r-value gold">${members.length}</div></div>
        <div class="report-metric"><div class="r-label">Fines Collected</div><div class="r-value green">KES ${Number(totalFinesPaid).toLocaleString()}</div></div>
        <div class="report-metric"><div class="r-label">Pending Fines</div><div class="r-value red">KES ${Number(totalFinesPending).toLocaleString()}</div></div>
        <div class="report-metric"><div class="r-label">Total Loans</div><div class="r-value blue">${loans.length}</div></div>
      </div>
      <div class="chart-container"><h4>Contributions by Member</h4><canvas id="chart-members" height="220"></canvas></div>
    `;

    // Contributions by member chart
    const memberTotals = {};
    allContribs.forEach(c => {
      memberTotals[c.memberName] = (memberTotals[c.memberName] || 0) + Number(c.amount);
    });
    const labels = Object.keys(memberTotals);
    const values = Object.values(memberTotals);

    if (labels.length > 0) {
      const ctx = document.getElementById('chart-members').getContext('2d');
      _chartInstances['members'] = new Chart(ctx, {
        type: 'bar',
        data: {
          labels,
          datasets: [{ label: 'Total (KES)', data: values, backgroundColor: 'rgba(0,229,160,0.7)', borderRadius: 6 }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: '#8ca0c0', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
            y: { ticks: { color: '#8ca0c0' }, grid: { color: 'rgba(255,255,255,0.05)' } }
          }
        }
      });
    }

  } else if (currentReportTab === 'contributions') {
    // Monthly trend
    const monthMap = {};
    allContribs.forEach(c => {
      monthMap[c.month] = (monthMap[c.month] || 0) + Number(c.amount);
    });
    const sortedMonths = Object.keys(monthMap).sort();
    const monthValues = sortedMonths.map(m => monthMap[m]);

    el.innerHTML = `
      <div class="chart-container"><h4>Monthly Contribution Trend</h4><canvas id="chart-trend" height="220"></canvas></div>
      <div class="chart-container"><h4>Payment Methods</h4><canvas id="chart-methods" height="200"></canvas></div>
    `;

    if (sortedMonths.length > 0) {
      const ctx1 = document.getElementById('chart-trend').getContext('2d');
      _chartInstances['trend'] = new Chart(ctx1, {
        type: 'line',
        data: {
          labels: sortedMonths.map(monthLabel),
          datasets: [{
            label: 'KES', data: monthValues, borderColor: '#00e5a0',
            backgroundColor: 'rgba(0,229,160,0.1)', fill: true,
            pointBackgroundColor: '#00e5a0', tension: 0.4
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: '#8ca0c0', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
            y: { ticks: { color: '#8ca0c0' }, grid: { color: 'rgba(255,255,255,0.05)' } }
          }
        }
      });
    }

    const methodMap = {};
    allContribs.forEach(c => { methodMap[c.method] = (methodMap[c.method] || 0) + 1; });
    if (Object.keys(methodMap).length > 0) {
      const ctx2 = document.getElementById('chart-methods').getContext('2d');
      _chartInstances['methods'] = new Chart(ctx2, {
        type: 'doughnut',
        data: {
          labels: Object.keys(methodMap),
          datasets: [{ data: Object.values(methodMap), backgroundColor: ['#00e5a0','#3b82f6','#fbbf24','#8b5cf6'], borderWidth: 0 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#8ca0c0' } } } }
      });
    }

  } else if (currentReportTab === 'loans') {
    const active = loans.filter(l => l.status === 'active').length;
    const repaid = loans.filter(l => l.status === 'repaid').length;
    const totalDisbursed = loans.reduce((s, l) => s + Number(l.amount), 0);
    const totalRepaid = loans.reduce((s, l) => s + Number(l.repaidAmount || 0), 0);

    el.innerHTML = `
      <div class="report-metric-grid">
        <div class="report-metric"><div class="r-label">Active Loans</div><div class="r-value blue">${active}</div></div>
        <div class="report-metric"><div class="r-label">Repaid Loans</div><div class="r-value green">${repaid}</div></div>
        <div class="report-metric"><div class="r-label">Total Disbursed</div><div class="r-value gold">KES ${Number(totalDisbursed).toLocaleString()}</div></div>
        <div class="report-metric"><div class="r-label">Total Repaid</div><div class="r-value green">KES ${Number(totalRepaid).toLocaleString()}</div></div>
      </div>
      <div class="chart-container"><h4>Loan Status</h4><canvas id="chart-loan-status" height="200"></canvas></div>
      <div class="chart-container"><h4>Loan Book by Member</h4><canvas id="chart-loan-members" height="220"></canvas></div>
    `;

    const ctx3 = document.getElementById('chart-loan-status').getContext('2d');
    _chartInstances['loanStatus'] = new Chart(ctx3, {
      type: 'doughnut',
      data: {
        labels: ['Active', 'Repaid'],
        datasets: [{ data: [active, repaid], backgroundColor: ['#3b82f6', '#00e5a0'], borderWidth: 0 }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#8ca0c0' } } } }
    });

    const memberLoanTotals = {};
    loans.filter(l => l.status === 'active').forEach(l => {
      memberLoanTotals[l.memberName] = (memberLoanTotals[l.memberName] || 0) + Number(l.balance);
    });
    if (Object.keys(memberLoanTotals).length > 0) {
      const ctx4 = document.getElementById('chart-loan-members').getContext('2d');
      _chartInstances['loanMembers'] = new Chart(ctx4, {
        type: 'bar',
        data: {
          labels: Object.keys(memberLoanTotals),
          datasets: [{ label: 'Balance (KES)', data: Object.values(memberLoanTotals), backgroundColor: 'rgba(59,130,246,0.7)', borderRadius: 6 }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: '#8ca0c0', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
            y: { ticks: { color: '#8ca0c0' }, grid: { color: 'rgba(255,255,255,0.05)' } }
          }
        }
      });
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════════
function setupSettingsListeners() {
  document.getElementById('btn-edit-chama-settings').addEventListener('click', () => {
    const chama = getChamaById(getChamaId());
    document.getElementById('edit-chama-name').value = chama.name;
    document.getElementById('edit-chama-contrib').value = chama.monthlyContrib || '';
    openModal('modal-chama-settings');
  });

  document.getElementById('btn-save-chama-settings').addEventListener('click', () => {
    const name = document.getElementById('edit-chama-name').value.trim();
    const contrib = Number(document.getElementById('edit-chama-contrib').value);
    if (!name) { showToast('Name required', 'error'); return; }
    const chama = getChamaById(getChamaId());
    upsertChama({ ...chama, name, monthlyContrib: contrib });
    document.getElementById('topbar-chama-name').textContent = name;
    closeModal('modal-chama-settings');
    showToast('Settings saved ✓', 'success');
    renderSettings();
  });

  document.getElementById('btn-change-admin-pin').addEventListener('click', () => {
    document.getElementById('pin-current').value = '';
    document.getElementById('pin-new').value = '';
    document.getElementById('pin-confirm').value = '';
    document.getElementById('change-pin-error').classList.add('hidden');
    openModal('modal-change-pin');
  });

  document.getElementById('btn-save-pin').addEventListener('click', () => {
    const current = document.getElementById('pin-current').value;
    const newPin = document.getElementById('pin-new').value;
    const confirm = document.getElementById('pin-confirm').value;
    const errEl = document.getElementById('change-pin-error');

    if (newPin !== confirm) { errEl.textContent = 'PINs do not match'; errEl.classList.remove('hidden'); return; }
    if (newPin.length < 4) { errEl.textContent = 'PIN must be at least 4 digits'; errEl.classList.remove('hidden'); return; }

    if (changeAdminPin(getChamaId(), current, newPin)) {
      closeModal('modal-change-pin');
      showToast('PIN changed ✓', 'success');
    } else {
      errEl.textContent = 'Current PIN is incorrect';
      errEl.classList.remove('hidden');
    }
  });

  document.getElementById('btn-export-data').addEventListener('click', () => {
    const json = exportChamaData(getChamaId());
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chamalink_backup_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Data exported ✓', 'success');
  });

  document.getElementById('btn-import-data').addEventListener('click', () => {
    document.getElementById('import-file-input').click();
  });

  document.getElementById('import-file-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        importChamaData(ev.target.result);
        showToast('Data imported ✓', 'success');
        navigateTo('dashboard');
      } catch {
        showToast('Import failed — invalid file', 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  document.getElementById('btn-switch-chama').addEventListener('click', () => {
    logout();
    destroyAllCharts();
    document.getElementById('main-app').classList.add('hidden');
    document.getElementById('auth-screen').classList.remove('hidden');
    renderChamaList();
  });

  document.getElementById('btn-delete-chama').addEventListener('click', () => {
    if (!isAdmin()) return;
    const name = getChamaById(getChamaId())?.name;
    if (window.confirm(`DELETE "${name}" and all its data? This cannot be undone.`)) {
      const cid = getChamaId();
      logout();
      deleteChama(cid);
      destroyAllCharts();
      document.getElementById('main-app').classList.add('hidden');
      document.getElementById('auth-screen').classList.remove('hidden');
      renderChamaList();
      showToast('Chama deleted', 'error');
    }
  });
}

function renderSettings() {
  const cid = getChamaId();
  const chama = getChamaById(cid);
  document.getElementById('set-chama-name').textContent = chama?.name || '—';
  document.getElementById('set-contrib-amount').textContent = `KES ${Number(chama?.monthlyContrib || 0).toLocaleString()}`;

  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = isAdmin() ? '' : 'none';
  });
}

// ═══════════════════════════════════════════════════════════════════
// MODAL CLOSE HELPERS
// ═══════════════════════════════════════════════════════════════════
function setupModalClosers() {
  document.querySelectorAll('.modal-backdrop').forEach(bd => {
    bd.addEventListener('click', () => {
      bd.closest('.modal')?.classList.add('hidden');
    });
  });

  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.modal;
      if (id) closeModal(id);
      else btn.closest('.modal')?.classList.add('hidden');
    });
  });
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════
function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ═══════════════════════════════════════════════════════════════════
// SERVICE WORKER REGISTRATION
// ═══════════════════════════════════════════════════════════════════
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
