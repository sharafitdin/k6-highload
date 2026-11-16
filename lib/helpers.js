import { check } from 'k6';
import { BASE_URL, API_URL } from './config.js';

export function checkBatch(responses, label, type = 'post_login') {
  for (const res of responses) {
    const ok = check(
      res,
      {
        [`${res.request.method} ${shortPath(res.request.url)} status is 2xx`]: (r) =>
          r.status >= 200 && r.status < 300,
      },
      { type },
    );

    if (!ok) {
      console.error(
        `${label} FAILED status=${res.status} method=${res.request.method} url=${res.request.url} body=${truncate(res.body, 1500)}`,
      );
    }
  }
}

export function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];

    if (c === '"' && line[i + 1] === '"') {
      current += '"';
      i++;
    } else if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += c;
    }
  }

  result.push(current);

  return result.map((v) => v.trim());
}

export function isJson(res) {
  const contentType = String(
    res.headers['Content-Type'] || res.headers['content-type'] || '',
  );

  return contentType.includes('application/json');
}

export function json(res) {
  try {
    return res.json();
  } catch (_) {
    return undefined;
  }
}

export function findQueryParam(url, name) {
  const match = String(url).match(new RegExp(`[?&]${name}=([^&]+)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

export function shortPath(url) {
  return String(url)
    .replace(BASE_URL, '')
    .replace(API_URL, '')
    .split('?')[0];
}

export function truncate(value, max) {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

export function encode(value) {
  return encodeURIComponent(value);
}