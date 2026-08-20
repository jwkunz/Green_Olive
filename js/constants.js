// ---------- version / license ----------
// GPS Sky & Signal Simulator
// Copyright (c) 2026 Numerius Engineering LLC
// Released under the MIT License — see LICENSE / help.html for full text.
const APP_VERSION = '1.0.0';

// ---------- constants ----------
const WGS84_A = 6378137.0, WGS84_F = 1/298.257223563;
const WGS84_E2 = WGS84_F*(2-WGS84_F);
const GM = 3.986005e14;      // GPS ICD earth gravitational constant
const OMEGA_E = 7.2921151467e-5; // rad/s
const C_LIGHT = 299792458;
const L1_FREQ = 1575.42e6;
const L2_FREQ = 1227.60e6;
const L5_FREQ = 1176.45e6;
const DEG = Math.PI/180, RAD = 180/Math.PI;
