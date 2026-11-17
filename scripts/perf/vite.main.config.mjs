// The game only (no prototype pages): same plugins / chunking as vite.config.js, so size and timing numbers of the main page stay comparable across the perf pass.
import cfg from '../../vite.config.js';
cfg.build.rolldownOptions.input = { main: 'index.html' };
export default cfg;
