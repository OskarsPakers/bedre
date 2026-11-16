import { openRef, camFor } from './ref-lib.mjs';
const R = await openRef();
await R.shot(camFor({ x: -330, z: 80, dist: 260, el: 28, az: 200 }), '/tmp/ref-test.png', 40000);
await R.browser.close();
