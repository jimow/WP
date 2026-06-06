// Local authentication + sessions. Passwords are scrypt-hashed; sessions are
// stateless HMAC-signed cookies. The FIRST user to register becomes the
// super_admin (role) and owns the existing/global settings; everyone else is an
// 'owner' with their own tenant workspace. Users are stored locally and mirrored
// to Supabase by the backup service.
import crypto from 'node:crypto';
import { shared as db } from './db.js'; // users live in the shared (cross-tenant) DB
import cfg from './config.js';
import log from './log.js';

function secret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  let s = cfg.get('session_secret');
  if (!s) { s = crypto.randomBytes(32).toString('hex'); cfg.set('session_secret', s); }
  return s;
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt$${salt}$${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}
function verifyPassword(pw, stored) {
  try {
    const [, salt, h] = String(stored).split('$');
    const calc = crypto.scryptSync(pw, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(calc, 'hex'));
  } catch { return false; }
}

const b64u = (b) => Buffer.from(b).toString('base64url');
function sign(payload) {
  const body = b64u(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verify(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  let expect;
  try { expect = crypto.createHmac('sha256', secret()).update(body).digest('base64url'); } catch { return null; }
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString()); if (p.exp && Date.now() > p.exp) return null; return p; } catch { return null; }
}

export function userCount() { return db.prepare('SELECT COUNT(*) n FROM users').get().n; }
// The login gate is ON by default: first visit shows "Create the super-admin
// account", then login. Set AUTH_DISABLED=1 in .env to run open (no login).
export function authActive() { return process.env.AUTH_DISABLED !== '1'; }

export function makeSession(user) { return sign({ uid: user.id, exp: Date.now() + 1000 * 60 * 60 * 24 * 30 }); }
export function userFromToken(token) {
  const p = verify(token); if (!p) return null;
  return db.prepare('SELECT * FROM users WHERE id=?').get(p.uid) || null;
}

export function register({ email, password, name } = {}) {
  email = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a valid email address.');
  if (!password || String(password).length < 8) throw new Error('Password must be at least 8 characters.');
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) throw new Error('An account with this email already exists.');
  const first = userCount() === 0;
  const role = first ? 'super_admin' : 'owner';
  const workspace_id = first ? 'admin' : 'ws_' + crypto.randomBytes(6).toString('hex');
  const info = db.prepare('INSERT INTO users(email,name,password_hash,role,workspace_id) VALUES(?,?,?,?,?)')
    .run(email, name || null, hashPassword(password), role, workspace_id);
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
  log.info('auth', `Registered ${role}: ${email} (workspace ${workspace_id})`);
  return user;
}

export function login({ email, password } = {}) {
  email = String(email || '').trim().toLowerCase();
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!u || !verifyPassword(password, u.password_hash)) throw new Error('Invalid email or password.');
  db.prepare("UPDATE users SET last_login=datetime('now') WHERE id=?").run(u.id);
  return u;
}

// Begin a reset: returns the raw token (caller delivers it). Never reveals
// whether the email exists.
export function startReset(email) {
  email = String(email || '').trim().toLowerCase();
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!u) return null;
  const token = crypto.randomBytes(24).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  db.prepare("UPDATE users SET reset_token=?, reset_expires=datetime('now','+1 hour') WHERE id=?").run(hash, u.id);
  return { token, email: u.email };
}
export function resetPassword({ token, password } = {}) {
  if (!password || String(password).length < 8) throw new Error('Password must be at least 8 characters.');
  const hash = crypto.createHash('sha256').update(String(token || '')).digest('hex');
  const u = db.prepare("SELECT * FROM users WHERE reset_token=? AND reset_expires > datetime('now')").get(hash);
  if (!u) throw new Error('This reset link is invalid or has expired.');
  db.prepare('UPDATE users SET password_hash=?, reset_token=NULL, reset_expires=NULL WHERE id=?').run(hashPassword(password), u.id);
  return u;
}

export function publicUser(u) {
  return u ? { id: u.id, email: u.email, name: u.name, role: u.role, workspace_id: u.workspace_id, isSuperAdmin: u.role === 'super_admin' } : null;
}
export function ctxFor(u) {
  return { userId: u.id, workspaceId: u.workspace_id, role: u.role, isSuperAdmin: u.role === 'super_admin' };
}
export function listUsers() {
  return db.prepare('SELECT id,email,name,role,workspace_id,created_at,last_login FROM users ORDER BY id').all();
}

export default { userCount, authActive, register, login, startReset, resetPassword, makeSession, userFromToken, publicUser, ctxFor, listUsers };
