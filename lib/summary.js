import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/latest/dist/bundle.js';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';

export function createSummary() {
  return function handleSummary(data) {
    const resultsDir = __ENV.RESULTS_DIR || 'results';

    return {
      [`${resultsDir}/summary.html`]: htmlReport(data),
      [`${resultsDir}/summary.json`]: JSON.stringify(data, null, 2),
      stdout: textSummary(data, {
        indent: ' ',
        enableColors: true,
      }),
    };
  };
}