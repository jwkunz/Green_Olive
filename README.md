# Green_Olive
A web app based GPS signal simulator

Single-file HTML/JS app (`gps-sim.html`) that:

1. Shows which GPS satellites are overhead for a given location and time,
   using live TLE almanac data and full SGP4/SDP4 propagation.
2. Generates a simulated L1 C/A / L2C / L5 baseband IQ recording (`.wav`,
   I/Q as left/right channels) matching that geometry, carrying real
   broadcast navigation message content — for feeding into SDR/receiver
   test software, not for RF transmission.

Current version: **v1.0.0**.

See [`ROADMAP.md`](ROADMAP.md) for the fidelity development plan and current
known limitations, and [`help.html`](help.html) for user-facing documentation.

## Usage

Open `gps-sim.html` directly in a browser. No build step, no server needed.
For usage help, open `help.html` (also linked from within the app).

## License

MIT License, Copyright (c) 2026 Numerius Engineering LLC. See [`LICENSE`](LICENSE).

