# Betnare API

Betting platform REST API built with Express and MongoDB (Mongoose), organised by domain.

Admin-only routes and examples are documented in [ADMIN.md](./ADMIN.md).

## Stack

- **Express 4** — HTTP framework
- **MongoDB / Mongoose 8** — data layer with tuned connection pooling
- **morgan** — request logging
- **cors** — allow-list based, preflight cached 24h
- **body-parser** — JSON / urlencoded parsing with size limits
- **helmet, compression, express-rate-limit, hpp, express-mongo-sanitize** — security & performance
- **zod** — request validation
- **jsonwebtoken, bcryptjs** — auth

## Project structure

```
src/
  server.js            HTTP server bootstrap + graceful shutdown
  app.js               Express app: middleware pipeline + route mounting
  routes.js            Aggregates domain routers under the API prefix
  config/
    index.js           Validated env config (single source of truth)
    database.js        Mongo connection lifecycle
  middlewares/         cors, auth, validate, rateLimiter, errorHandler, notFound
  utils/               ApiError, asyncHandler, response envelope, logger
  domains/
    user/              model · service · controller · routes · validation
    event/             model · service · controller · routes · validation
    bet/               model · service · controller · routes · validation
  scripts/
    seed.js            Sample data
```

Each domain follows the same pattern: **routes → controller → service → model**. Controllers stay thin; business logic lives in services; HTTP concerns never leak into the data layer.

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Start MongoDB

MongoDB is not installed locally. The quickest option is the bundled Docker instance:

```bash
npm run mongo:up        # starts mongo:7 on localhost:27018
```

Or install MongoDB Community Edition and run `mongod`. Either way the connection string is in `.env`:

```
MONGO_URI=mongodb://127.0.0.1:27018/betnare?replicaSet=rs0&directConnection=true
```

### 3. Configure environment

`.env` is already created from `.env.example`. Change `JWT_SECRET` before deploying.

### 4. Seed and run

```bash
npm run seed            # optional sample data
npm run dev             # nodemon, hot reload
# or
npm start
```

Server: `http://localhost:5050/api/v1`

## API

Base prefix: `/api/v1`

| Method | Endpoint              | Auth   | Description                       |
| ------ | --------------------- | ------ | -------------------------------- |
| GET    | `/health`             | —      | Health check                     |
| POST   | `/users/register`             | —      | Create account and send SMS verification code |
| POST   | `/users/login`                | —      | Login (phone + password), returns token |
| POST   | `/users/verify-phone`         | —      | Verify phone number using SMS code, returns token |
| POST   | `/users/resend-phone-code`    | —      | Resend SMS phone verification code |
| POST   | `/users/request-password-reset` | —    | Send SMS reset code to a registered phone |
| POST   | `/users/reset-password`       | —      | Reset password using phone + SMS code |
| GET    | `/users/me`                   | user   | Current profile                  |
| POST   | `/users/credit`               | admin  | Manual wallet credit (bonus/fix) |
| GET    | `/events`                     | —      | List events (filter + paginate)  |
| GET    | `/events/:id`                 | —      | Event detail                     |
| POST   | `/events`                     | admin  | Create event                     |
| POST   | `/events/:id/settle`          | admin  | Settle event + payout open bets  |
| POST   | `/bets`                       | user   | Place a bet                      |
| GET    | `/bets`                       | user   | List own bets                    |
| GET    | `/bets/:id`                   | user   | Own bet detail                   |
| POST   | `/transactions/deposit`       | user   | M-Pesa deposit (STK push)        |
| POST   | `/transactions/withdraw`      | user   | KES or airtime withdrawal        |
| GET    | `/transactions`               | user   | List own transactions            |
| GET    | `/transactions/:id`           | user   | Transaction detail               |
| POST   | `/transactions/callback/:type`| —      | Mamlaka webhook (`deposit`/`withdraw`) |
| POST   | `/wallet/billOrder`           | user   | Fusion external bill-order deposit |

## Payments

### Mamlaka (mobile money)

Deposits and withdrawals run through the [Mamlaka mobile-money API](https://github.com/Mamlaka-Hub-and-Spoke/Mobile-Payment-Docs). The wallet balance is the source of truth for betting; Mamlaka moves the real money.

**Deposit (collection / STK push)**
1. `POST /transactions/deposit { amount, phone, provider? }` — creates a `pending` transaction and triggers an STK push to the phone.
2. Customer approves on their handset.
3. Mamlaka calls `POST /transactions/callback/deposit`. On `COMPLETE`, the transaction status and wallet credit commit together in one MongoDB transaction. Duplicate callbacks are ignored.

**Withdrawal (payout / B2C / airtime)**
1. `POST /transactions/withdraw { amount, phone, provider?, walletType? }`
2. If `walletType` is `balance` or omitted, Betnare debits the KES wallet and calls Mamlaka transfer payout.
3. If `walletType` is `airtime`, Betnare checks `airtimeBalance`, debits it atomically, and calls Mamlaka airtime disbursement.
4. For cash payouts, Mamlaka calls `POST /transactions/callback/withdraw`. On `FAILED` the debit is refunded automatically.
5. For airtime payouts, Betnare uses the immediate Mamlaka response:
   - `success` => transaction `completed`
   - `failed` => transaction `failed` and the airtime wallet is refunded
   - `pending` => transaction stays `pending`

**Configuration** — set in `.env`:
- `MAMLAKA_API_USERNAME` / `MAMLAKA_API_PASSWORD` — provider credentials.
- `MAMLAKA_MERCHANT_ID` — `impalaMerchantId` (equals the username, `shilingibet`).
- `MAMLAKA_CALLBACK_BASE_URL` — optional dedicated public HTTPS URL Mamlaka posts callbacks to. Useful when mobile-money callbacks should hit an ngrok tunnel or a different host than other providers.
- `PUBLIC_CALLBACK_BASE_URL` — shared public HTTPS callback base URL used when a provider-specific callback URL is not set.
- `MAMLAKA_CALLBACK_SECRET` — optional shared secret appended as `?secret=` to callback URLs and verified on inbound webhooks.
- Limits: `DEPOSIT_MIN/MAX` (1 / 250,000), `WITHDRAWAL_MIN/MAX` (10 / 250,000).

**Test numbers** (from the docs): `0710000000` → success, `0720000000` → failed.

> Auth uses HTTP Basic against `GET /api/v1/` (trailing slash required) to mint a JWT, which is cached and auto-refreshed. The provider may IP-whitelist your server — the assigned live IP is `52.204.58.147`; deposits/withdrawals must originate from there in production.

### Fusion bill-order deposits

Fusion bill orders create a hosted external payment order that the frontend can present to the player. This path creates a **pending** deposit transaction in Betnare for traceability, but it does **not** credit the wallet immediately because the completion callback / reconciliation contract is not part of this repo yet.

`POST /wallet/billOrder`

```json
{
  "amount": 1,
  "currency": "KES",
  "comment": "amazon-cart-123",
  "email": "mburumary556@gmail.com",
  "description": "Amazon order #123",
  "external_ref": "AMZ-ORDER-123",
  "callback_url": "https://stagging.shilingibet.com/api/v1/wallet/billOrder/callback"
}
```

- `email` is optional only if the authenticated Betnare account already has one saved.
- If `external_ref` is omitted, Betnare generates a unique `FUS-...` reference.
- If `callback_url` is omitted, Betnare sends its own default callback endpoint: `POST /api/v1/wallet/billOrder/callback`.
- The route proxies to Fusion `POST /bill-orders/external` using `FUSION_BASE_URL` and returns both the internal `transaction` and the raw `provider` response.
- Betnare understands Fusion's nested response shape and stores:
  `order.ID` as `transaction.secureId`,
  `order.external_ref` as `transaction.externalId`,
  `order.comment_ref` as `transaction.receipt`.

Fusion callback payloads can also arrive as a flat webhook body such as:

```json
{
  "amount": 1,
  "comment_ref": "amazon-cart-123",
  "currency": "KES",
  "external_ref": "AMZ-ORDER-123",
  "order_id": 47,
  "payer_email": "collscodes@gmail.com",
  "status": "approved",
  "updated_at": "2026-07-02T11:13:56.497Z",
  "user_id": 53
}
```

Callback handling:
- `approved` marks the transaction `completed` and credits the Betnare user balance exactly once.
- `declined` marks the transaction `failed` and does not credit the wallet.
- Duplicate approved callbacks are ignored after the first successful credit.
- Pending Fusion orders expire after `FUSION_ORDER_EXPIRY_MINUTES` (default `1`). Once expired, late approval callbacks are ignored and do not credit the wallet.

Example Fusion response:

```json
{
  "order": {
    "CreatedAt": "2026-07-02T10:34:53.471Z",
    "UpdatedAt": "2026-07-02T10:34:53.471Z",
    "DeletedAt": null,
    "ID": 41,
    "external_ref": "AMZ-ORDER-123",
    "comment_ref": "amazon-cart-123",
    "payer_email": "mburumary556@gmail.com",
    "user_id": 22,
    "amount": 1,
    "currency": "KES",
    "status": "pending",
    "description": "Amazon order #123",
    "callback_url": ""
  },
  "status": "success"
}
```

Fusion `.env` values:
- `FUSION_BASE_URL` — default `https://sandbox.fusionfi.io/api/v1`
- `FUSION_API_KEY` — optional API key, if Fusion requires one in your environment
- `FUSION_API_KEY_HEADER` — header name for `FUSION_API_KEY` (default `x-api-key`)
- `FUSION_CURRENCY` — default currency fallback (`KES`)
- `FUSION_CALLBACK_BASE_URL` — base URL used when Betnare auto-builds the callback URL
- `FUSION_CALLBACK_SECRET` — optional secret appended as `?secret=` to the Betnare callback URL and checked on inbound Fusion callbacks
- `FUSION_ORDER_EXPIRY_MINUTES` — how long a pending Fusion order can wait before Betnare marks it `expired` (default `1`)

## Virtual betting (EuroVirtuals / BetKraft)

Virtual games use a **seamless (transfer) wallet**: the provider calls back into Betnare to read the player balance and to debit/credit/rollback as the player plays. The Betnare wallet remains the single source of truth.

**Operator → Provider** (authenticated, in [src/integrations/eurovirtuals/eurovirtuals.client.js](src/integrations/eurovirtuals/eurovirtuals.client.js)):

| Method | Endpoint                                   | Description                          |
| ------ | ------------------------------------------ | ------------------------------------ |
| GET    | `/virtuals/games`                          | Catalog (proxied to provider)        |
| POST   | `/virtuals/launch`                         | Issue a launch URL for the user      |
| GET    | `/virtuals/bet/status/:game_uuid?bet_id=`  | Bet status lookup                    |
| POST   | `/virtuals/shortcode/:game_uuid` (admin)   | USSD/SMS session                     |

**Provider → Operator** seamless-wallet callbacks (signature-verified, in the `virtual` domain). The provider posts to the registered base `https://stagging.shilingibet.com/api/v1/virtuals`, appending the action:

| Method | Endpoint                  | Effect                                            |
| ------ | ------------------------- | ------------------------------------------------- |
| POST   | `/virtuals/player_info`   | Returns player balance + currency                 |
| POST   | `/virtuals/bet`           | Debit (atomic, rejects on insufficient balance)   |
| POST   | `/virtuals/win`           | Credit payout                                     |
| POST   | `/virtuals/rollback`      | Reverse the net ledger effect of a bet            |

**Auth / signing** (in [src/integrations/eurovirtuals/eurovirtuals.signature.js](src/integrations/eurovirtuals/eurovirtuals.signature.js)):
- Token Key = `MD5_hex(SHA1_hex(appKey + timestamp))`.
- Signature = `MD5_hex(sortedHashString + suffixKey)`. Outbound calls use the **App Key** as suffix. Inbound callback validation accepts the documented **App Key** signature and the older **Token Key** variant for compatibility.
- Headers: `x-api-key` (outbound), `x-token-key` + `x-signature-key` + `x-timestamp` (callbacks).
- **GET requests sign the query parameters**; POST requests sign the JSON body.

**Behaviour**
- All callbacks return **HTTP 200** regardless of outcome (the body carries `status_code`); any non-200 makes the provider treat the request as undelivered and retry.
- Every wallet mutation is idempotent on `(bet_id, action)` and uses a `$round` aggregation-pipeline update so decimal payouts never drift.
- `/virtuals/win` accepts payout values from both the top-level body and nested `data` payloads (`payout_amount`, `amount`, `payout`, `won_amount`).
- If a win callback arrives with `payout_amount: 0` and no alternate positive payout value, Betnare treats it as a provider payload issue and does not credit the wallet.
- If a `/virtuals/win` callback fails auth but includes a known `bet_id`, Betnare now attempts a background provider reconciliation by `bet_id` and `game_uuid`. Any recovered positive payout is still applied through the same idempotent `result_bet` path, so the same bet cannot be credited twice.
- `player_id` = the Betnare user `_id`; `player_token` = a short-lived `VirtualSession` issued at launch.
- Config: `EUROVIRTUALS_API_KEY`, `EUROVIRTUALS_APP_KEY`, `EUROVIRTUALS_BASE_URL`, `EUROVIRTUALS_VERIFY_CALLBACKS` (set `false` only for local testing).

**Troubleshooting**
- If Aviator credits correctly but sports virtual wins do not, inspect the `/virtuals/win` callback logs first. A successful HTTP 200 only means the callback reached Betnare; the response body `status_code` still determines whether the wallet credit was accepted.
- Signature failures are logged by [src/middlewares/verifyEurovirtuals.js](src/middlewares/verifyEurovirtuals.js) with the callback `path`, `timestamp`, `body_keys`, and detected payout fields.
- Accepted `/virtuals/win` requests are logged by [src/domains/virtual/virtual.controller.js](src/domains/virtual/virtual.controller.js), including payout debug values, so provider payload mismatches can be compared between games.

Send the token as `Authorization: Bearer <token>`.

Accounts use **phone + password**. Registration requires only `phone` and `password` (`name` and `email` optional). Phone numbers are normalized to `2547XXXXXXXX`. Every account phone number must be verified by SMS before login or access to protected API routes.

## Referrals

- Every user gets a unique `referralCode`.
- New signups can pass an optional `referralCode` to `POST /users/register`.
- `/users/me` now returns a `referral` object with the user's code, referrer, and referred-user count.
- Admin overview now reports real `referredUsers` totals instead of a hardcoded zero.
- If a referred user reaches more than `KES 100` in completed deposits, the referrer gets a one-time `KES 20` bonus.

## SMS notifications and password reset

Betnare can send SMS through the Celcom Africa gateway for:

- phone verification codes on signup
- first-time signup welcome messages
- password reset codes
- deposit success/failure updates
- withdrawal success/failure updates

Required `.env` values:

- `SMS_ENABLED=true`
- `SMS_BASE_URL=https://isms.celcomafrica.com`
- `SMS_PARTNER_ID=323`
- `SMS_API_KEY=...`
- `SMS_SHORTCODE=IMPALA LTD`
- `SMS_PASS_TYPE=plain`
- `SMS_PHPSESSID=...` (only if the gateway session cookie is required in your environment)
- `SMS_RESET_CODE_TTL_MINUTES=10`
- `SMS_PHONE_VERIFICATION_TTL_MINUTES=10`

Signup verification flow:

1. `POST /users/register` with `{ "phone": "0717126550", "password": "password123" }`
2. Player receives a 6-digit verification code by SMS.
3. `POST /users/verify-phone` with `{ "phone": "0717126550", "code": "123456" }`
4. If needed, `POST /users/resend-phone-code` with `{ "phone": "0717126550" }`

Auth payloads:

`POST /users/register`

```json
{
  "phone": "0717126550",
  "password": "password123",
  "name": "Jane Doe",
  "email": "jane@example.com",
  "referralCode": "SB79E9EBB8"
}
```

`POST /users/verify-phone`

```json
{
  "phone": "0717126550",
  "code": "123456"
}
```

`POST /users/resend-phone-code`

```json
{
  "phone": "0717126550"
}
```

Reset flow:

1. `POST /users/request-password-reset` with `{ "phone": "0717126550" }`
2. Player receives a 6-digit code by SMS.
3. `POST /users/reset-password` with `{ "phone": "0717126550", "code": "123456", "newPassword": "newpass123" }`

### Seeded accounts

- 254700000001 / password123 (admin)
- 254700000002 / password123 (balance 1000)

### Example

```bash
TOKEN=$(curl -s localhost:5050/api/v1/users/login \
  -H 'Content-Type: application/json' \
  -d '{"phone":"254700000002","password":"password123"}' | jq -r .data.token)

curl localhost:5050/api/v1/events

curl localhost:5050/api/v1/bets \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"eventId":"<id>","selectionKey":"home","stake":50}'
```

## Notes

- Response shape is uniform: `{ success, message, data, meta? }` on success, `{ success: false, message, details? }` on error.
- CORS origins are an allow-list in `CORS_ORIGINS`; set to `*` for open dev access.

## Rate limiting & abuse protection

Configured in [src/middlewares/rateLimiter.js](src/middlewares/rateLimiter.js):

| Limiter | Scope | Limit | Applied to |
| ------- | ----- | ----- | ---------- |
| Global API | per IP | `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` (default 300 / 15 min) | all `/api/v1/*` |
| Auth | per IP | 20 / 15 min (failed only) | `/users/register`, `/users/login` |
| Deposit | per user | 5 / min (all attempts) | `/transactions/deposit` |
| Withdrawal | per user | 1 / 3 min (successful only) | `/transactions/withdraw` |
| Game launch | per user | 20 / min | `/virtuals/launch` |

- **Deposit** counts every attempt (not just successes) because each one triggers an STK push to a phone — this blocks push-spam/harassment.
- **Withdrawal** counts only successful initiations, so a validation typo doesn't lock the user out for 3 minutes.
- **Bet placement is intentionally not rate-limited** — active bettors can place bets freely; overdraft is already prevented by the atomic transaction.
- **Provider webhooks are exempt from the global IP limiter** (`/transactions/callback/*` and the EuroVirtuals `/virtuals/{player_info,bet,win,rollback}` callbacks). All callbacks arrive from a single provider IP and would otherwise trip the limit and break settlements; they are authenticated by signature/secret instead.

## Concurrency & atomicity

Bet placement and settlement are **fully atomic** ([src/utils/db.js](src/utils/db.js)):

- **Placement** runs inside a MongoDB multi-document transaction: re-read the event, conditionally debit the wallet (`balance >= stake`), and insert the bet — all commit together or not at all. Concurrent bets cannot overdraft (verified: 20 simultaneous stakes against a balance that fits 10 → exactly 10 succeed, balance lands at 0), and a crash can never strand a debit without its bet. Write-conflicts auto-retry.
- **Settlement** marks each bet won/lost and credits winners atomically, guarded by `status: 'open'` so concurrent/duplicate settlements never double-pay. The event-level `already settled` check returns 409.
- Balances mutate via a `$round` aggregation-pipeline update, so decimal odds/payouts never accumulate float drift.
- Transactions require Mongo to run as a **replica set** (the bundled `docker-compose.yml` configures a single-node `rs0` and `MONGO_URI` uses `?directConnection=true`). On a plain standalone Mongo the code automatically falls back to compensating writes (atomic conditional debit + refund-on-failure) so it still runs — just without the cross-document transaction guarantee.
