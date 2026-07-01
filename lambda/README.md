# Gemini proxy Lambda

Holds `GEMINI_API_KEY` server-side so it never ships in the client bundle. The
browser calls this Function URL instead of talking to Google directly.

## Why this exists

The app used to be a static SPA that called Gemini directly, which baked the API
key into the client bundle (`vite.config.ts` `define`). Anyone could extract it
and run unlimited Gemini calls on our bill. This proxy moves the key off the
client. See `../terraform/proxy.tf`.

## Endpoints

Single Function URL, `POST` with a JSON body:

| `action`  | request                          | response                          |
|-----------|----------------------------------|-----------------------------------|
| `chat`    | `{ prompt, context, history, deviceId }` | streamed `text/plain` deltas |
| `summary` | `{ url, deviceId }`              | `{ text, groundingSources }`      |
| `speech`  | `{ text, deviceId }`            | `{ audio }` (base64 PCM) or `{ audio: null }` |

Defence in depth: DynamoDB rate limiting (`rateLimit.mjs`), per-call input caps,
and `maxOutputTokens` on generation.

## Build & deploy

Terraform zips this directory as-is, so `node_modules` must be present before
`terraform apply`:

```bash
cd lambda
npm install --omit=dev   # or: npm ci --omit=dev
cd ../terraform
terraform apply          # first rotate the Gemini key; set gemini_api_key in terraform.tfvars
```

After apply, Terraform sets `VITE_PROXY_URL` on the Amplify app. Trigger an
Amplify rebuild so the frontend picks it up.

## Environment variables (set by Terraform)

- `GEMINI_API_KEY` — the rotated Gemini key (required)
- `DDB_TABLE_NAME` — rate-limit counter table
- Optional overrides: `PER_IP_MINUTE_LIMIT` (20), `PER_IP_DAY_LIMIT` (1000),
  `PER_DEVICE_MINUTE_LIMIT` (20), `PER_DEVICE_DAY_LIMIT` (300)
