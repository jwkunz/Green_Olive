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

- [x] **Phase 6 — Selectable L5 signal generation** *(done)*
  - Real I5/Q5 code generation per IS-GPS-705 (fetched primary spec directly
    rather than working from memory, given this is meaningfully more complex
    than L1/L2C): 13-stage XA generator (short-cycled 8190/8191) XORed with
    a per-satellite/per-component XB generator, composite 10230-chip
    (1ms) codes — verified via a self-consistency check derived from the
    spec's own stated invariant (complement of the first 13 composite chips
    equals the reversed initial-state vector), plus balance/distinctness/
    autocorrelation checks against synthetic test data
  - NH10 (I5) and NH20 (Q5, dataless pilot) Neuman-Hofman overlay codes from
    the spec, applied at their correct 1 kHz rate
  - True dual-quadrature modulation (I5 and Q5 are independent real bit
    streams on the I/Q rails, not a single stream rotated by carrier phase
    like L1/L2C) — implemented as a genuinely different combination path,
    not a reuse of the L1/L2C structure
  - Correct 1176.45 MHz carrier for Doppler scaling; new 20.46/25.575 MHz
    sample-rate tiers (auto-filtered in the UI based on selected signal,
    since L1/L2C's existing rates are far below L5's Nyquist requirement)
    with an explicit file-size warning given the ~10x jump
  - Correlator remains L1 C/A only, as previously scoped — not extended to
    L5 in this phase

- [x] **Phase 7 — Real broadcast ephemeris (LNAV) + CNAV** *(LNAV + CNAV done, correlator worker remains)*
  - **Done, verified:** genuine least-squares (Levenberg-Marquardt) curve
    fit of real IS-GPS-200 Table 20-IV broadcast ephemeris parameters
    against SGP4 truth over a +/-1hr window — converges to ~2cm RMS in
    isolated testing (sub-meter in the live app)
  - **Done, verified:** real GPS LNAV parity algorithm and exact subframe
    1/2/3 bit layout (cross-checked against an open-source decoder plus
    the official field-width table). L1 C/A now transmits real encoded
    LNAV subframes built from the fitted ephemeris — verified via full
    generate-then-independently-decode round trip, every field to
    sub-LSB precision
  - **Done, verified:** real CNAV framing for L2C/L5 — preamble, PRN,
    message type, TOW, alert flag bit offsets cross-checked against
    gnss-sdr's open-source CNAV decoder; CRC-24Q (verified: linear-code
    zero-property, deterministic, single-bit sensitive) computed over the
    correct 276 bits; real rate-1/2 K=7 convolutional encoder (171/133
    octal polynomials, continuous state across message boundaries per
    spec) verified against IS-GPS-200's own encoder description, with
    chunked-vs-whole encoding equivalence confirmed. Message types 10, 11,
    30 cycle continuously carrying the same genuine fitted ephemeris/clock
    values. Full round trip verified: encode → independently recompute
    CRC over extracted bits → matches; convolutional output matches an
    independent manual re-encode bit-for-bit
  - **Documented limitation:** the 238-bit payload within each CNAV
    message uses the same field widths verified for LNAV rather than the
    exact real CNAV Table 30-I bit positions, which could not be
    independently verified from a primary source this session despite
    extensive searching (found the framing/CRC/FEC details from
    open-source decoders, but not the exact payload field table) — the
    framing/CRC/FEC layer is authentic and would satisfy a real decoder's
    outer checks, but the inner field layout is a documented simplification
  - **Not yet done:** correlator moved to a Worker with L2C/L5 support
  - Mid-session note: an earlier, less-accurate ephemeris-fit
    implementation (harmonic regression on osculating elements, ~300m
    residual) was found already in the codebase mid-phase and replaced
    with the verified LM version above once it was confirmed more accurate
    and more faithful to "real least-squares fit"

## Roadmap notation
`[x]` = done and verified. `[~]` = partially done, see sub-bullets for
exactly what's shipped vs still pending.

## Known limitations (current)

- CNAV's 238-bit payload field layout is a documented simplification (see
  Phase 7) — real framing/CRC/FEC, LNAV-style field widths for the payload

- L5 code generation was validated via self-consistency checks (matches the
  spec's own stated bit-ordering invariant) and statistical checks
  (balance, distinctness, autocorrelation), but not cross-checked against
  an independent third-party reference vector the way L2C's PRN1 state was
  — flagging this as a slightly lower confidence tier than L2C
- L5 CNAV symbols are synthetic (same caveat as L1 LNAV / L2 CNAV below)
- Correlator only supports L1 C/A recordings; L2C/L5 correlation isn't
  implemented
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
