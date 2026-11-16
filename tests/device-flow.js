import http from 'k6/http';
import { check, fail, group, sleep } from 'k6';
import exec from 'k6/execution';

import {
  API_URL,
  THINK_TIME_SECONDS,
  buildOptions,
} from '../lib/config.js';

import { getUserByVuId } from '../lib/users.js';
import { login } from '../lib/auth.js';
import { teamHeaders } from '../lib/headers.js';
import { createSummary } from '../lib/summary.js';

export const options = buildOptions('device_flow', {
  'checks{type:login}': ['rate>0.95'],
  'checks{type:device}': ['rate>0.95'],
});

const ICLOCK_BASE = __ENV.ICLOCK_BASE || `${API_URL}/service/wtm`;
const DEVICE_SERIALS = (__ENV.DEVICE_SERIALS || 'WJA6244800003,HDP1254500162')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const PIN_LIST = (__ENV.DEVICE_PINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const PINS_PER_DEVICE = parseInt(__ENV.PINS_PER_DEVICE || '100', 10);
const PIN_START = parseInt(__ENV.PIN_START || '1', 10);
const VERIFY_MODE = parseInt(__ENV.VERIFY || '15', 10);
const SEND_HEARTBEAT = (__ENV.SEND_HEARTBEAT || 'true').toLowerCase() === 'true';

function deviceNow() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function attlogLine(pin, punchType) {
  //return `${pin}\t${deviceNow()}\t255\t${VERIFY_MODE}\t0\t0\t0\t0\t0\t0\n`;
  //
  return `${pin}\t${deviceNow()}\t255\t15\t0\t0\t0\t0\t0\t0\n`; 
}

export default function () {
  const user = getUserByVuId(exec.vu.idInTest);
  const auth = login(user);
  const sessionToken = auth?.sessionToken;

  if (!sessionToken) {
    fail('Device flow requires LOGIN_FLOW_MODE=api so login returns sessionToken. Set LOGIN_FLOW_MODE=api.');
  }

  const authHeader = {
    Authorization: `Bearer ${sessionToken}`,
  };

  const teamAuthHeaders = () => ({
    ...teamHeaders(),
    headers: {
      ...teamHeaders().headers,
      ...authHeader,
    },
  });

  const serial = DEVICE_SERIALS[(exec.vu.idInTest - 1) % DEVICE_SERIALS.length];
  const pinSlot = (exec.vu.idInTest - 1) + exec.vu.iterationInInstance;
  const pin =
    PIN_LIST.length > 0
      ? PIN_LIST[pinSlot % PIN_LIST.length]
      : PIN_START + (pinSlot % PINS_PER_DEVICE);

  const cdataUrl = `${ICLOCK_BASE}/iclock/cdata?SN=${encodeURIComponent(serial)}&table=ATTLOG`;

  group('01_device_login', () => {
    check(
      { status: 200 },
      { 'login completed': () => Boolean(sessionToken) },
      { type: 'login' },
    );
  });

  group('02_device_heartbeat', () => {
    if (!SEND_HEARTBEAT) {
      return;
    }

    const res = http.get(
      `${ICLOCK_BASE}/iclock/getrequest?SN=${encodeURIComponent(serial)}&INFO=loadtest`,
      {
        headers: teamAuthHeaders().headers,
        tags: { name: 'GET iclock/getrequest', type: 'device' },
      },
    );

    check(
      res,
      { 'heartbeat status is 200': (r) => r.status === 200 },
      { type: 'device' },
    );
  });

  group('03_device_check_in', () => {
    const res = http.post(cdataUrl, attlogLine(pin, 0), {
      headers: {
        ...teamAuthHeaders().headers,
        'Content-Type': 'text/plain',
      },
      tags: { name: 'POST iclock/cdata check-in', type: 'device' },
    });

    check(
      res,
      {
        'check-in status is 200': (r) => r.status === 200,
        'check-in body is OK': (r) => (r.body || '').trim() === 'OK',
      },
      { type: 'device' },
    );
  });

  group('04_device_check_out', () => {
    const res = http.post(cdataUrl, attlogLine(pin, 1), {
      headers: {
        ...teamAuthHeaders().headers,
        'Content-Type': 'text/plain',
      },
      tags: { name: 'POST iclock/cdata check-out', type: 'device' },
    });

    check(
      res,
      {
        'check-out status is 200': (r) => r.status === 200,
        'check-out body is OK': (r) => (r.body || '').trim() === 'OK',
      },
      { type: 'device' },
    );
  });

  sleep(THINK_TIME_SECONDS);
}

export const handleSummary = createSummary('device-flow');
