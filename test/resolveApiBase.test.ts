import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveApiBase } from '../src/ui/resolveApiBase.js';

describe('resolveApiBase', () => {
  it('maps the preferred nginx UI path to /health-api', () => {
    assert.equal(resolveApiBase('/health/'), '/health-api');
    assert.equal(resolveApiBase('/health'), '/health-api');
    assert.equal(resolveApiBase('/health/index.html'), '/health-api');
  });

  it('keeps a reverse-proxy prefix so sister-chamber pages hit the right host', () => {
    assert.equal(resolveApiBase('/pxh-generator/health/'), '/pxh-generator/health-api');
    assert.equal(resolveApiBase('/pxh-control/health/'), '/pxh-control/health-api');
    assert.equal(resolveApiBase('/pxh-elevator/health'), '/pxh-elevator/health-api');
  });

  it('uses same-origin API on the :19090 /ui/ fallback', () => {
    assert.equal(resolveApiBase('/ui/'), '');
    assert.equal(resolveApiBase('/ui'), '');
    assert.equal(resolveApiBase('/'), '');
  });

  it('does not treat /healthcheck as the UI path', () => {
    assert.equal(resolveApiBase('/something/healthcheck'), '');
  });
});
