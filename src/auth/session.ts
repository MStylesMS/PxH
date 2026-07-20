/** Signed session cookies for action gating. */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { PxhConfig } from '../types.js';

const COOKIE = 'pxh_session';

export interface SessionPayload {
  u: string;
  exp: number;
}

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function encodeSession(cfg: PxhConfig, username: string): string {
  const exp = Date.now() + cfg.actions.sessionHours * 3600_000;
  const body = Buffer.from(JSON.stringify({ u: username, exp } satisfies SessionPayload)).toString(
    'base64url',
  );
  const sig = sign(cfg.actions.sessionSecret, body);
  return `${body}.${sig}`;
}

export function decodeSession(cfg: PxhConfig, token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = sign(cfg.actions.sessionSecret, body);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (!payload.u || !payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function getSession(req: FastifyRequest, cfg: PxhConfig): SessionPayload | null {
  const raw = (req.cookies as Record<string, string | undefined> | undefined)?.[COOKIE];
  return decodeSession(cfg, raw);
}

export function setSessionCookie(reply: FastifyReply, cfg: PxhConfig, username: string): void {
  const token = encodeSession(cfg, username);
  reply.setCookie(COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: cfg.actions.sessionHours * 3600,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(COOKIE, { path: '/' });
}

export function requireSession(
  req: FastifyRequest,
  reply: FastifyReply,
  cfg: PxhConfig,
): SessionPayload | null {
  const session = getSession(req, cfg);
  if (!session) {
    void reply.code(401).send({ ok: false, message: 'login required' });
    return null;
  }
  return session;
}
