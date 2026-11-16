import { ACCOUNTS_ORIGIN, TEAM_ORIGIN } from './config.js';

export function accountHeaders(extraHeaders = {}) {
  return {
    headers: {
      accept: 'application/json, text/plain, */*',
      referer: `${ACCOUNTS_ORIGIN}/`,
      ...extraHeaders,
    },
  };
}

export function teamHeaders(extraHeaders = {}) {
  return {
    headers: {
      accept: 'application/json, text/plain, */*',
      origin: TEAM_ORIGIN,
      referer: `${TEAM_ORIGIN}/`,
      ...extraHeaders,
    },
  };
}

//export function loginSubmitHeaders() {
//  return {
//    accept: 'application/json, text/plain, */*',
//    'content-type': 'application/x-www-form-urlencoded',
//    origin: ACCOUNTS_ORIGIN,
//    referer: `${ACCOUNTS_ORIGIN}/`,
// };
//}

export function loginSubmitHeaders() {
  return {
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/x-www-form-urlencoded',
    Origin: 'https://dev-sso.mylink.kz',
    Referer: 'https://dev-sso.mylink.kz/login',
    'User-Agent': 'Mozilla/5.0 k6',
  };
}

export function loginFlowHeaders() {
  return {
    accept: 'application/json, text/plain, */*',
    origin: ACCOUNTS_ORIGIN,
    referer: `${ACCOUNTS_ORIGIN}/`,
  };
}