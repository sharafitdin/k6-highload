export const BASE_URL = requiredEnv('BASE_URL').replace(/\/$/, '');
export const API_URL = requiredEnv('API_URL').replace(/\/$/, '');
export const ACCOUNTS_ORIGIN = requiredEnv('ACCOUNTS_ORIGIN').replace(/\/$/, '');
export const TEAM_ORIGIN = requiredEnv('TEAM_ORIGIN').replace(/\/$/, '');

export const USERS_FILE = requiredEnv('USERS_FILE');

export const TEST_MODE = __ENV.TEST_MODE || 'smoke';

export const LOGIN_FLOW_MODE = __ENV.LOGIN_FLOW_MODE || 'browser'; 
// browser | api | static

export const RETURN_TO = __ENV.RETURN_TO || `${TEAM_ORIGIN}/`;

export const INCLUDE_DUPLICATES =
  (__ENV.INCLUDE_DUPLICATES || 'false').toLowerCase() === 'true';

export const THINK_TIME_SECONDS = Number(__ENV.THINK_TIME_SECONDS || 1);

export const USER_AGENT =
  __ENV.USER_AGENT ||
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

export function requiredEnv(name) {
  const value = __ENV[name];

  if (!value) {
    throw new Error(`Missing required env variable: ${name}`);
  }

  return value;
}

export function buildOptions(flowName, thresholds = {}) {
  const defaultThresholds = {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<2000'],
    ...thresholds,
  };

  if (TEST_MODE === 'smoke') {
    return {
      scenarios: {
        [`${flowName}_smoke`]: {
          executor: 'shared-iterations',
          vus: Number(__ENV.VUS || 1),
          iterations: Number(__ENV.ITERATIONS || 1),
          maxDuration: __ENV.MAX_DURATION || '1m',
        },
      },
      thresholds: defaultThresholds,
      userAgent: USER_AGENT,
    };
  }

  return {
    scenarios: {
      [`${flowName}_load`]: {
        executor: 'ramping-vus',
        stages: [
          { duration: __ENV.RAMP_1 || '5m', target: Number(__ENV.VUS_1 || 500) },
          { duration: __ENV.RAMP_2 || '10m', target: Number(__ENV.VUS || 2000) },
          { duration: __ENV.HOLD || '10m', target: Number(__ENV.VUS || 2000) },
          { duration: __ENV.RAMP_DOWN || '5m', target: 0 },
        ],
        gracefulRampDown: __ENV.GRACEFUL_RAMP_DOWN || '1m',
      },
    },
    thresholds: defaultThresholds,
    userAgent: USER_AGENT,
  };
}