/**
 * auth.js — ChamaLink authentication
 */
import { getChamaById, upsertChama, getAll } from './db.js';

let _session = null; // { chamaId, role: 'admin'|'member', memberId? }

export function getSession() { return _session; }
export function isAdmin() { return _session?.role === 'admin'; }
export function getChamaId() { return _session?.chamaId || null; }

export function loginAdmin(chamaId, pin) {
  const chama = getChamaById(chamaId);
  if (!chama) return false;
  if (chama.adminPin !== pin) return false;
  _session = { chamaId, role: 'admin' };
  return true;
}

export function loginMember(chamaId, memberId, pin) {
  const members = getAll(chamaId, 'members');
  const member = members.find(m => m.id === memberId);
  if (!member || member.pin !== pin) return false;
  _session = { chamaId, role: 'member', memberId, memberName: member.name };
  return true;
}

export function logout() {
  _session = null;
}

export function changeAdminPin(chamaId, currentPin, newPin) {
  const chama = getChamaById(chamaId);
  if (!chama || chama.adminPin !== currentPin) return false;
  upsertChama({ ...chama, adminPin: newPin });
  return true;
}
