import { writeConfig, startWorker, resolve, root } from '../lib-test.mjs';
const dist = resolve(root, 'scripts/.dist-qa1');
const config = writeConfig('qa1', dist);
const persist = resolve(root, 'scripts/.qa1-state');
const w = await startWorker({ config, persist, port: 8801, vars: { RATE_ROUNDS_PER_HOUR: 1000 } });
console.log('READY ' + w.base);
setInterval(() => {}, 1e9);
