# Green_Olive
A web app based GPS signal simulator

`gps-sim.html` is the app entry point:

1. Shows which GPS satellites are overhead for a given location and time,
   using live TLE almanac data and full SGP4/SDP4 propagation.
2. Generates a simulated L1 C/A / L2C / L5 baseband IQ recording (`.wav`,
   I/Q as left/right channels) matching that geometry, carrying real
   broadcast navigation message content — for feeding into SDR/receiver
   test software, not for RF transmission.

Current version: **v1.0.0**.

See [`ROADMAP.md`](ROADMAP.md) for the fidelity development plan and current
known limitations, and [`help.html`](help.html) for user-facing documentation.

## Project structure

The app was originally a single ~1700-line HTML file; it's now split into
focused modules while keeping `gps-sim.html` as the page you open:

```
gps-sim.html          entry point — HTML structure + <script src> tags
help.html              documentation page
css/
  theme.css             shared design tokens (colors, fonts)
  app.css                gps-sim.html-specific styles
  help.css                help.html-specific styles
js/
  dom-utils.js          $ / setStatus helpers (loaded first)
  constants.js           physics/version constants
  tle.js                  almanac fetch/parse, TLE state
  orbit.js                 SGP4 propagation, delay models, ephemeris least-squares fit
  sky-view.js               sky-plot compute & render
  worker/
    codegen-src.js           PRN code generators (C/A, L2C, L5), as a worker-source string
    dsp-src.js                 front-end filter/AGC/quantization, as a worker-source string
    lnav-src.js                  LNAV subframe encoding, as a worker-source string
    cnav-src.js                    CNAV message encoding, as a worker-source string
    main-src.js                      worker message dispatch (generate/correlate)
  worker-bootstrap.js    assembles the above into one WORKER_SRC string
  generation.js            IQ generation UI + Worker dispatch
  correlator.js              correlator UI + Worker dispatch + heatmap
  app.js                       final bootstrap (loads last)
```

All main-thread files are loaded as plain (non-module) `<script src>` tags
deliberately, since that works when the page is opened directly via
`file://`, unlike ES modules or `fetch()`. The `js/worker/*-src.js` files
each define a JS *source-code string* rather than directly-executable code
— they're concatenated and turned into a real Worker via a Blob URL at
runtime, which is what lets Worker creation also work from `file://` (a
plain `new Worker('path.js')` doesn't, in most browsers, when the page
itself is a local file).

## Usage

Open `gps-sim.html` directly in a browser — still no build step, no server
needed, same as before the refactor. For usage help, open `help.html`
(also linked from within the app).

## License

MIT License, Copyright (c) 2026 Numerius Engineering LLC. See [`LICENSE`](LICENSE).

