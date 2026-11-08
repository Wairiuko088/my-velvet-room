# Velvet Room storefront

An adults-only digital media storefront with Kenyan M-Pesa STK Push checkout. It uses Node.js built-ins only and requires Node 18 or newer.

## Run locally

```powershell
npm start
```

Open `http://localhost:3000`. Without Daraja credentials, the catalogue works but checkout returns a configuration message.

## Configure M-Pesa Daraja

1. Register a Daraja app with Safaricom and obtain its sandbox keys and STK Push details.
2. Copy `.env.example` to `.env` in the project folder.
3. Fill in the sandbox consumer key, consumer secret, shortcode, and passkey in `.env`.
4. Set `MPESA_CALLBACK_URL` to a public HTTPS URL ending in `/api/mpesa/callback`. Safaricom cannot reach a `localhost` callback; use a secure HTTPS tunnel for local testing.
5. Keep `MPESA_ENVIRONMENT=sandbox` while testing, then restart the server with `npm start`.

The server loads `.env` locally without an extra dependency. `.env` is ignored by Git. Never put Daraja secrets in browser code or send them in chat.

The Kenyan M-Pesa subscription offer is a one-time KES 799 payment for 30-day access, discounted 50% from KES 1,598. It does not renew automatically; customers must choose to pay again.

Required server-side settings:

| Variable | Description |
| --- | --- |
| `MPESA_CONSUMER_KEY` | Daraja app consumer key |
| `MPESA_CONSUMER_SECRET` | Daraja app consumer secret |
| `MPESA_SHORTCODE` | Paybill or shortcode registered for STK Push |
| `MPESA_PASSKEY` | Lipa Na M-Pesa passkey |
| `MPESA_CALLBACK_URL` | Public HTTPS URL ending in `/api/mpesa/callback` |
| `MPESA_ENVIRONMENT` | `sandbox` (default) or `production` |
| `PORT` | Optional server port (default `3000`) |

Check readiness at `http://localhost:3000/api/checkout-status`. Use Daraja sandbox credentials for testing. Switch to production only after Safaricom has approved the account and intended content/payment use. Confirm directly with Safaricom that this type of content is permitted before attempting live transactions.

For a deployed server, set the variables in your hosting provider's secret/environment-variable settings instead of using a local `.env` file.

## Before launch

- Replace the sample collection and prices in `server.js` with your own content, and provide secure, payment-gated delivery for purchased files. The sample app does not contain media or implement file delivery.
- Current private offer prices are KES 1,299 (After Hours), KES 2,999 (Soft Focus), and KES 4,999 (The Private Edit). M-Pesa checkout uses each product's `price`.
- The eight images in `public/images/` are storefront previews and are publicly accessible. Do not put paid-only originals there; use authenticated, payment-verified delivery for those.
- The sample payment state is held in memory and is lost when the server restarts. Use durable storage and verify callbacks/signatures and orders before handling real payments.
- A payment confirmation currently confirms payment only; it does not expose a download link.
- The age gate is a self-attestation, not robust age verification. Add the age-verification and privacy/legal requirements that apply in your market.
- Confirm that your content is legal, consensual, features adults only, and that your M-Pesa/provider account permits this type of sale before going live.
