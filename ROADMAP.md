# Fidelity Roadmap

Phased plan for improving `gps-sim.html`, a single-file GPS sky-view and
simulated L1 C/A baseband IQ generator. Each phase is independently shippable.

- [x] **Phase 1 — Orbital accuracy** *(done)*
  - Full SGP4/SDP4 propagation via `satellite.js` (replaces two-body Kepler)
  - SDP4 matters specifically here: GPS's ~12h period puts it in the
    "deep-space" regime where lunar/solar resonance terms are needed
  - Future option: RINEX broadcast ephemeris support for higher precision

- [ ] **Phase 2 — Signal realism**
  - 50 bps navigation message bits modulated onto the C/A code
  - Elevation-dependent signal power (weaker near horizon)
  - Ionospheric/tropospheric delay (Klobuchar model)
  - Satellite clock bias terms

- [ ] **Phase 3 — Receiver-side realism**
  - IF filtering / front-end bandwidth limiting
  - AGC simulation
  - Quantization noise modeling beyond basic int16 clipping

- [ ] **Phase 4 — Signal expansion**
  - L2C and/or L5 signal support alongside L1 C/A
  - Multipath modeling

- [ ] **Phase 5 — Performance & proof**
  - Move IQ generation into a Web Worker (unblocks higher sample
    rates/durations without freezing the UI)
  - Correlator view to despread the noise-buried signal live, proving
    satellites are recoverable — same principle a real receiver uses

## Known limitations (current)

- No navigation message bit modulation yet (raw repeating C/A code only)
- No atmospheric delay or clock bias modeling yet
- App depends on one CDN script (`satellite.js` from cdnjs) rather than
  being fully offline-capable; can be vendored in later if that matters
- Not for RF transmission — this generates test/simulation data files only
