import { group, sleep } from 'k6';
import exec from 'k6/execution';

import { THINK_TIME_SECONDS, buildOptions } from '../lib/config.js';
import { getUserByVuId } from '../lib/users.js';
import { login } from '../lib/auth.js';
import { createSummary } from '../lib/summary.js';

export const options = buildOptions('login_flow', {
  'checks{type:login}': ['rate>0.95'],
});

export default function () {
  const user = getUserByVuId(exec.vu.idInTest);

  group('01_login', () => {
    login(user);
  });

  sleep(THINK_TIME_SECONDS);
}
export const handleSummary = createSummary('login-flow');