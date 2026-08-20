# Green_Olive
A web app based GPS signal simulator

Single-file HTML/JS app (`gps-sim.html`) that:

1. Shows which GPS satellites are overhead for a given location and time,
   using live TLE almanac data and full SGP4/SDP4 propagation.
2. Generates a simulated L1 C/A baseband IQ recording (`.wav`, I/Q as left/
   right channels) matching that geometry — for feeding into SDR/receiver
   test software, not for RF transmission.

See [`ROADMAP.md`](ROADMAP.md) for the fidelity development plan and current
known limitations.

## Usage

Open `gps-sim.html` directly in a browser. No build step, no server needed.

