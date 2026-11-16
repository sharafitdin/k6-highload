import { SharedArray } from 'k6/data';
import { USERS_FILE } from './config.js';
import { parseCsvLine } from './helpers.js';

export const users = new SharedArray('users', () => {
  const raw = open(`../${USERS_FILE}`).trim();
  const lines = raw.split(/\r?\n/).filter(Boolean);

  if (lines.length === 0) {
    throw new Error(`${USERS_FILE} is empty`);
  }

  const header = lines.shift().split(',').map((h) => h.trim());

  const identifierIndex = header.indexOf('identifier');
  const passwordIndex = header.indexOf('password');

  if (identifierIndex === -1 || passwordIndex === -1) {
    throw new Error('users.csv must contain header: identifier,password');
  }

  return lines.map((line) => {
    const cols = parseCsvLine(line);

    return {
      identifier: cols[identifierIndex],
      password: cols[passwordIndex],
    };
  });
});

export function getUserByVuId(vuId) {
  return users[(vuId - 1) % users.length];
}