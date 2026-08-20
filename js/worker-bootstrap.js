// Assembles the full worker source from its module pieces (see js/worker/*.js)
// into one string, which is then run inside a Web Worker via a Blob URL.
// This keeps the app fully self-contained and working when opened directly
// via file://, where Worker() can't load external script files due to
// same-origin restrictions in most browsers -- the Blob URL approach
// sidesteps that since it shares the page's own origin.
const WORKER_SRC = WORKER_CODEGEN_SRC + WORKER_DSP_SRC + WORKER_LNAV_SRC + WORKER_CNAV_SRC + WORKER_MAIN_SRC;
