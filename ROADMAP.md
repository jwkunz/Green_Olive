# Fidelity Roadmap

Phased plan for improving `gps-sim.html`, a single-file GPS sky-view and
simulated L1 C/A baseband IQ generator. Each phase is independently shippable.

- [x] **Phase 1 — Orbital accuracy** *(done)*
  - Full SGP4/SDP4 propagation via `satellite.js` (replaces two-body Kepler)
  - SDP4 matters specifically here: GPS's ~12h period puts it in the
    "deep-space" regime where lunar/solar resonance terms are needed
  - Future option: RINEX broadcast ephemeris support for higher precision

- [x] **Phase 2 — Signal realism** *(done)*
  - 50 bps navigation message bits modulated onto the C/A code
  - Elevation-dependent signal power (weaker near horizon)
  - Ionospheric/tropospheric delay (Klobuchar model)
  - Satellite clock bias terms

- [x] **Phase 3 — Receiver-side realism** *(done)*
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

- Front-end filter and AGC are baseband-equivalent approximations (real
  lowpass applied independently to I/Q), not a modeled real/complex bandpass
  RF chain
- ADC quantizer step sizes are tuned to commonly-cited near-optimal values
  for a Gaussian-dominated input, not derived per-signal from first
  principles — exact optimal thresholds are their own design problem
- Nav message bits are a synthetic 50 bps stream with the real TLM preamble,
  not decoded/re-encoded real subframes (ephemeris/clock/almanac words) —
  that requires the actual broadcast nav message, unavailable from TLE data
- Klobuchar ionospheric coefficients are plausible example values, not live
  broadcast alpha/beta — same reason
- Satellite clock bias is a synthetic deterministic-per-PRN offset, not a
  real af0/af1/af2 correction
- App depends on one CDN script (`satellite.js` from cdnjs) rather than
  being fully offline-capable; can be vendored in later if that matters
- Not for RF transmission — this generates test/simulation data files only
