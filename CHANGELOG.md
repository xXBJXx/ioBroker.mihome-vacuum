# Changelog

## Unreleased

- Replaced the unreliable Xiaomi username/password cloud login with Xiaomi's QR-code long-polling login.
- Added `auth.status`, `auth.loginUrl`, `auth.lastError`, and `auth.expiresAt` runtime states.
- Store reusable Xiaomi Cloud session data only in encrypted and protected adapter configuration.
- Kept local IP/token control independent from Cloud authentication.
