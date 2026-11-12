# Loyalty Wallet POC

Local proof-of-concept for a single demo business. It exercises a shared loyalty model and separate Apple/Google Wallet adapters.

## What is implemented

- Configure one demo business as stamps **or** points.
- Create a customer membership with a high-entropy opaque QR token.
- Simulate a qualifying visit by scanning/pasting the QR token.
- Stamp threshold creates an available reward.
- Explicit reward accept/reject. Rejecting preserves the reward.
- Integer point awards and deductions with balance validation.
- Google Wallet save URL + object creation/update when credentials are configured.
- Apple `.pkpass` generation when Pass Type ID signing credentials are configured.
- Local JSON persistence in `data/db.json`.

## Important POC limitations

This is a technical experiment, **not production software**. It has no login, authorization, tenant isolation, rate limiting, audit-grade database transactions, consent management, payment/billing, production QR anti-replay, or hardened secrets management. Do not enter real customer data.

The Apple Wallet web-service routes are placeholders; they do not persist device registrations, serve updated passes, or send APNs pushes. Apple pass signing and installation require an Apple Pass Type ID certificate. Apple Wallet pass update push delivery is a separate production-environment validation.

Google Wallet starts in demo mode for a new issuer. Test with an authorized Google account. Google may require issuer setup and review before public distribution. Wallet notifications are not guaranteed and must be tested separately from pass field updates.

## Requirements

- Node.js 20+ recommended
- npm
- Google account and Android phone with Google Wallet for the Google path
- Apple Developer account with Pass Type ID certificate for genuine Apple pass installation (not needed to run the app or test the loyalty engine)

## Run locally

```bash
cp .env.example .env
npm install
npm run dev
```

Open `http://localhost:3000`.

The server binds to `0.0.0.0`, so a phone on the same Wi-Fi can reach it at `http://YOUR_COMPUTER_LAN_IP:3000` for basic page access. Browser camera APIs generally require a secure context (HTTPS) or localhost. For camera testing on a phone, expose the local server through a trusted HTTPS tunnel. Do not expose this unauthenticated POC to the public internet longer than necessary.

## Google Wallet setup

1. Create or select a Google Cloud project and enable the Google Wallet API.
2. Complete issuer onboarding in the Google Wallet console. A new issuer can use demo mode.
3. Create a service account and grant it access to the Wallet issuer. Download its JSON key.
4. Save the JSON locally as `credentials/google-service-account.json`. Never commit it.
5. Set `GOOGLE_ISSUER_ID` in `.env` to the issuer ID shown in the Wallet console.
6. Restart the server, create a member, then choose **Añadir a Google Wallet**.
7. Open the generated save link on the Android phone using a Google account authorized as a test user.

If Google returns a class review or authorization error, verify issuer access and demo-user configuration in the Wallet console. The POC uses a minimal loyalty class/object payload; Google may require additional issuer-specific review or fields.

## Apple Wallet setup (later)

1. Enroll in the Apple Developer Program.
2. Register a Pass Type ID and create its Pass Type ID certificate.
3. Export the signer certificate and private key as PEM files. Obtain the Apple WWDR intermediate certificate.
4. Place the files under `credentials/` using the names in `.env.example`.
5. Set `APPLE_PASS_TYPE_ID` and `APPLE_TEAM_ID`.
6. Restart and download the `.pkpass` from the member row.

The pass model in `assets/apple-pass` contains the basic images. Replace the sample images with production-quality 1x/2x artwork before evaluating appearance.

## Testing sequence

1. Create a business in stamps mode with a low threshold, e.g. 3.
2. Create a member and scan their QR twice; confirm the balance is 2/3.
3. Scan a third time; confirm one reward becomes available and the stamp cycle resets.
4. Scan again; confirm a qualifying visit is recorded. Use the reward button to accept or reject. Reject must preserve the reward.
5. Switch the demo to points mode; create a new member, award visits, and test point deductions.
6. Configure Google Wallet and test initial save + update after a visit on Android.
7. When Apple signing credentials are available, install the pass on iPhone and validate the appearance. Then implement/test full Apple registration, pass fetch, and APNs update flow.

## Design notes

- QR token is random and contains no PII. It is a static bearer credential in this POC and can be copied; production needs a threat model and mitigation.
- JSON persistence is deliberately simple and not concurrency-safe.
- Program switching is allowed in this POC for experimentation only. Production policy remains a product decision.
- Wallet update failures are surfaced in the scan response but do not roll back the loyalty action; a production implementation should use a transactional outbox and retry worker.
