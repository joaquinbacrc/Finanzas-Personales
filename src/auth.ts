import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

const PASSWORD = process.env.APP_PASSWORD || '';
const SECRET   = process.env.SESSION_SECRET || (PASSWORD ? `dev-secret-${PASSWORD}` : '');
const COOKIE   = 'fin_auth';
const MAX_AGE  = 60 * 60 * 24 * 30; // 30 días

export const authEnabled = PASSWORD.length > 0;

if (!authEnabled) {
  console.warn('[auth] APP_PASSWORD no definida — modo abierto (solo OK para localhost).');
}

function sign(value: string): string {
  return createHmac('sha256', SECRET).update(value).digest('hex');
}

function makeToken(): string {
  const issued = Date.now().toString();
  const nonce = randomBytes(8).toString('hex');
  const payload = `${issued}.${nonce}`;
  return `${payload}.${sign(payload)}`;
}

function isValidToken(raw: string | undefined): boolean {
  if (!raw) return false;
  const parts = raw.split('.');
  if (parts.length !== 3) return false;
  const [issued, nonce, given] = parts as [string, string, string];
  const expected = sign(`${issued}.${nonce}`);
  if (given.length !== expected.length) return false;
  if (!timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return false;
  const issuedMs = Number(issued);
  if (!issuedMs || (Date.now() - issuedMs) > MAX_AGE * 1000) return false;
  return true;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k) out[k] = decodeURIComponent(rest.join('='));
  }
  return out;
}

function isAuthed(req: Request): boolean {
  if (!authEnabled) return true;
  const cookies = parseCookies(req.headers.cookie);
  return isValidToken(cookies[COOKIE]);
}

const PUBLIC_PATHS = new Set(['/login', '/login.html', '/api/login', '/manifest.webmanifest', '/sw.js', '/icon-192.png', '/icon-512.png', '/favicon.ico']);

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!authEnabled) return next();
  if (PUBLIC_PATHS.has(req.path)) return next();
  if (isAuthed(req)) return next();

  // API → 401 JSON; HTML → redirect a /login.html
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  return res.redirect('/login.html');
}

export function loginHandler(req: Request, res: Response) {
  const pwd = String(req.body?.password ?? '');
  if (!authEnabled) return res.json({ ok: true });
  if (pwd.length !== PASSWORD.length || !timingSafeEqual(Buffer.from(pwd.padEnd(PASSWORD.length)), Buffer.from(PASSWORD))) {
    return res.status(401).json({ error: 'Contraseña incorrecta' });
  }
  const token = makeToken();
  const secure = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}${secure ? '; Secure' : ''}`);
  res.json({ ok: true });
}

export function logoutHandler(_req: Request, res: Response) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Max-Age=0`);
  res.json({ ok: true });
}
