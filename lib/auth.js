import http from 'k6/http';
import { check, fail } from 'k6';

import { ACCOUNTS_ORIGIN, BASE_URL, LOGIN_FLOW_MODE, RETURN_TO } from './config.js';
import { loginFlowHeaders, loginSubmitHeaders } from './headers.js';
import { isJson, json, truncate } from './helpers.js';

function getCsrfToken(flowBody) {
  const nodes = flowBody?.ui?.nodes || [];

  for (const node of nodes) {
    const attributes = node?.attributes || {};

    if (attributes.name === 'csrf_token') {
      return attributes.value;
    }
  }

  return undefined;
}

function createBrowserLoginFlow() {
  const url = `${BASE_URL}/self-service/login/browser?return_to=${encodeURIComponent(RETURN_TO)}`;

  const flowRes = http.get(url, {
    headers: loginFlowHeaders(),
    redirects: 0,
    tags: {
      name: 'GET login browser flow',
      type: 'login',
    },
  });

  const ok = check(
    flowRes,
    {
      'login flow created': (r) => r.status === 200,
      'login flow is json': (r) => isJson(r),
      'login flow has action': (r) => Boolean(json(r)?.ui?.action),
      'login flow has csrf token': (r) => Boolean(getCsrfToken(json(r))),
    },
    { type: 'login' },
  );

  if (!ok) {
    fail(`Login flow failed: status=${flowRes.status}, body=${truncate(flowRes.body, 2000)}`);
  }

  const body = json(flowRes);

  return {
    action: body.ui.action,
    csrfToken: getCsrfToken(body),
  };
}

function createApiLoginFlow() {
  const url = `${BASE_URL}/self-service/login/api`;

  const flowRes = http.get(url, {
    headers: {
      Accept: 'application/json',
    },
    redirects: 0,
    tags: {
      name: 'GET login api flow',
      type: 'login',
    },
  });

  const ok = check(
    flowRes,
    {
      'api login flow created': (r) => r.status === 200,
      'api login flow is json': (r) => isJson(r),
      'api login flow has action': (r) => Boolean(json(r)?.ui?.action),
    },
    { type: 'login' },
  );

  if (!ok) {
    fail(`API login flow failed: status=${flowRes.status}, body=${truncate(flowRes.body, 2000)}`);
  }

  const body = json(flowRes);

  return {
    action: body.ui.action,
    csrfToken: null,
  };
}

export function createLoginFlow() {
  if (LOGIN_FLOW_MODE === 'api') {
    return createApiLoginFlow();
  }

  if (LOGIN_FLOW_MODE === 'browser') {
    return createBrowserLoginFlow();
  }

  throw new Error(`Unsupported LOGIN_FLOW_MODE: ${LOGIN_FLOW_MODE}. Expected: browser or api.`);
}

export function login(user) {
  const flow = createLoginFlow();

  let payload;

  if (LOGIN_FLOW_MODE === 'api') {
    payload = JSON.stringify({
      method: 'password',
      identifier: user.identifier,
      password: user.password,
    });
  } else {
    // For browser flow, send application/x-www-form-urlencoded string
    const parts = [
      ['method', 'password'],
      ['identifier', user.identifier],
      ['password', user.password],
      ['csrf_token', flow.csrfToken],
    ];

    payload = parts
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v ?? '')}`)
      .join('&');
  }

  const loginRes = http.post(flow.action, payload, {
    headers:
      LOGIN_FLOW_MODE === 'api'
        ? {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          }
        : loginSubmitHeaders(),
    redirects: 0,
    tags: {
      name: 'POST login flow action',
      type: 'login',
    },
  });

  const ok = check(
    loginRes,
    {
      'login submit accepted or redirected': (r) => [200, 303].includes(r.status),
      'login has session/cookie or json': (r) =>
        r.status === 303 || Object.keys(r.cookies || {}).length > 0 || isJson(r),
    },
    { type: 'login' },
  );

  if (!ok) {
    fail(`Login failed: status=${loginRes.status}, body=${truncate(loginRes.body, 2000)}`);
  }

  const loginBody = json(loginRes);

  if (LOGIN_FLOW_MODE === 'api') {
    const sessionToken = loginBody?.session_token;

    if (!sessionToken) {
      fail(`Login succeeded but session_token not found: status=${loginRes.status}, body=${truncate(loginRes.body, 2000)}`);
    }

    return {
      sessionToken,
    };
  }

  return {
    cookies: loginRes.cookies,
  };

}
