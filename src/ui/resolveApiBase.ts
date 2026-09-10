/**
 * Nginx API prefix for the System Health UI.
 *
 * `/health/` → `/health-api`
 * `/pxh-generator/health/` → `/pxh-generator/health-api`
 * `/ui/` (direct :19090) → `` (same-origin API root)
 *
 * Keep the copy in public/index.html in sync with this function.
 */
export function resolveApiBase(pathname: string): string {
  const m = String(pathname || '').match(/^(.*?)\/health(?:\/|$)/);
  return m ? `${m[1]}/health-api` : '';
}
