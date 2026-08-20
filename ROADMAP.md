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

- [x] **Phase 4 — Signal expansion (partial)** *(L2C + multipath done)*
  - L2C signal generation: real CM/CL codes from the ICD-GPS-200/IS-GPS-200
    27-stage generator polynomial and official per-PRN initial-state table
    (Table 3-IIa), correct chip-by-chip CM/CL multiplexing at 1.023 Mcps,
    synthetic CNAV symbols on CM (dataless CL pilot), correct 1227.60 MHz
    carrier used for Doppler scaling
  - Automatic elevation-dependent multipath: one ground-bounce-style
    reflection per satellite, short chip delay, amplitude strongest near the
    horizon and fading toward zenith
  - **Not yet done — moved to end of roadmap:** selectable L5 signal
    generation (10.23 Mcps codes, ~10x the sample-rate/file-size cost of
    L1/L2, separate 1176.45 MHz carrier — see below)

- [x] **Phase 5 — Performance & proof** *(done)*
  - IQ generation now runs in a Web Worker (embedded as a Blob-URL script
    since this is a single-file app) — UI stays responsive during
    generation regardless of duration/sample rate
  - Duration cap removed (was hard-capped at 10s); now arbitrary, with a
    confirmation prompt above 60s warning about time/memory cost
  - On-demand correlator/acquisition panel: pick a PRN from the last L1 C/A
    recording, runs a code-phase x Doppler search with non-coherent
    integration across up to 20ms, and shows the recovered peak against the
    known truth values plus a heatmap — proves the noise-buried signal is
    actually recoverable, the same principle a real acquisition engine uses
  - Correlator currently supports L1 C/A recordings only (L2C CM
    correlation would need a much larger phase/block search space —
    noted as a future extension, not pursued yet given the cost/benefit)

- [ ] **Phase 6 — Selectable L5 signal generation**
  - Add L5 (1176.45 MHz, 10.23 Mcps I5/Q5 codes with NH secondary codes) as
    a third selectable signal alongside L1 C/A and L2C
  - Needs its own sample-rate tier (~20-25 MHz) given the file-size jump,
    and likely its own output path since real receivers capture it on a
    separate RF chain from L1/L2

## Known limitations (current)

- Correlator only supports L1 C/A recordings; L2C CM correlation isn't
  implemented (would need a much larger phase/block search space)
- Correlator's Doppler search is on a 500 Hz grid (nearest-bin match, not
  fine-resolution), and only searches the first ~20ms of a recording
- L2C CNAV symbols are a synthetic 50 sps stream, not decoded/re-encoded
  real CNAV messages (ephemeris/clock/almanac) — same reason as LNAV below
- Multipath is a single automatic reflection tuned by elevation only; it
  isn't scenario-specific (no manual control over number of reflections,
  delay, or amplitude yet)
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
