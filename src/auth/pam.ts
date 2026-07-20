/**
 * PAM authentication via Python ctypes (libpam) — no native Node addon.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, '../../scripts/pam-auth.py');

export async function pamAuthenticate(
  username: string,
  password: string,
): Promise<{ ok: boolean; message: string }> {
  if (!username || !password) {
    return { ok: false, message: 'username and password required' };
  }
  if (process.platform !== 'linux') {
    // Dev convenience on non-Linux: accept only if PXH_DEV_AUTH=1 and user matches
    if (process.env.PXH_DEV_AUTH === '1') {
      return { ok: true, message: 'dev auth' };
    }
    return { ok: false, message: 'PAM auth only supported on Linux' };
  }

  return new Promise((resolvePromise) => {
    const child = spawn('python3', [SCRIPT, username], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      resolvePromise({ ok: false, message: err.message });
    });
    child.on('close', (code) => {
      if (code === 0 && stdout.trim() === 'OK') {
        resolvePromise({ ok: true, message: 'authenticated' });
      } else {
        resolvePromise({
          ok: false,
          message: stderr.trim() || stdout.trim() || 'authentication failed',
        });
      }
    });
    child.stdin.write(password);
    child.stdin.end();
  });
}
