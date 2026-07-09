# Betnare Admin API

Admin operations for managing the Betnare platform. This guide covers the protected routes that require an account with the `admin` role.

## Stack

- Express 4
- MongoDB / Mongoose 8
- Zod validation
- JWT bearer authentication
- EuroVirtuals / BetKraft virtual provider integration

## Features

- Dashboard staff login on the same account used for betting
- Staff access levels: `support`, `admin`, `super_admin`
- Overview analytics summary
- Manual wallet credit
- Sportsbook event creation
- Event settlement and payout processing
- Virtual shortcode session initiation

## Environment

Base API URL:

```bash
http://localhost:5050/api/v1
```

Admin routes require:

- `Authorization: Bearer <token>`
- a user account with staff access enabled

Seeded admin account:

- Phone: `254700000001`
- Password: `password123`

## Getting started

### 1. Log in as admin

```bash
curl -s http://localhost:5050/api/v1/users/staff-login \
  -H 'Content-Type: application/json' \
  -d '{"phone":"254700000001","password":"password123"}'
```

### 2. Reuse the token

```bash
ADMIN_TOKEN="REPLACE_ADMIN_TOKEN"
```

## Main routes

- `POST /users/staff-login`
- `PATCH /users/:id/staff-access`
- `GET /admin/analytics/overview`
- `POST /admin/virtuals/reconcile-bet`
- `POST /users/credit`
- `POST /events`
- `POST /events/:id/settle`
- `POST /virtuals/shortcode/:game_uuid`

## API integration notes

- Betting-site login still uses `/users/login`.
- Dashboard login uses `/users/staff-login` and requires `isStaff=true` or legacy `role=admin`.
- Staff access levels are enforced with `authorizeStaff(...)`.
- The overview analytics endpoint now returns real referral counts. Cashback and tax still return `0` because they are not yet persisted in this API.
- Referral bonuses are awarded once: when a referred user exceeds the configured completed-deposit threshold (`REFERRAL_QUALIFYING_DEPOSIT_AMOUNT`, default `100`), the referrer receives `REFERRAL_BONUS_AMOUNT` (default `20`).
- Event settlement triggers sportsbook bet resolution and winner payouts.
- Virtual shortcode requests are proxied to the provider through the virtual integration client.
- Virtual bet reconciliation can query the provider by `betId` and apply a missing positive payout idempotently when callback delivery was inconsistent.
- Failed `/virtuals/win` auth checks now also trigger an automatic background reconciliation attempt for known bet IDs, so the admin route is mainly a manual backup.

## Required payloads

Unless noted otherwise, protected requests send `Authorization: Bearer <token>`.

### Auth

`POST /users/login`

```json
{
  "phone": "254700000001",
  "password": "password123"
}
```

`POST /users/staff-login`

```json
{
  "phone": "254700000001",
  "password": "password123"
}
```

`PATCH /users/:id/staff-access`

```json
{
  "isStaff": true,
  "adminLevel": "support"
}
```

Example:

```bash
USER_ID="507f1f77bcf86cd799439011"

curl -s http://localhost:5050/api/v1/users/$USER_ID/staff-access \
  -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"isStaff":true,"adminLevel":"support"}'
```

### Analytics

`GET /admin/analytics/overview`

Optional query params:

- `dateFrom`
- `dateTo`

Example:

```bash
curl -s "http://localhost:5050/api/v1/admin/analytics/overview?dateFrom=2026-06-01T00:00:00.000Z&dateTo=2026-06-30T23:59:59.999Z" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

### Virtuals

`POST /admin/virtuals/reconcile-bet`

```json
{
  "betId": "00JD-01KW9Y5E3F-9B5T5ABAK8MZ",
  "gameUuid": "2d15e5a3-c9ee-4b83-91c2-bfaed9f4f17f"
}
```

Example:

```bash
curl -s http://localhost:5050/api/v1/admin/virtuals/reconcile-bet \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "betId":"00JD-01KW9Y5E3F-9B5T5ABAK8MZ",
    "gameUuid":"2d15e5a3-c9ee-4b83-91c2-bfaed9f4f17f"
  }'
```

### Wallet management

`POST /users/credit`

```json
{
  "userId": "507f1f77bcf86cd799439011",
  "amount": 500,
  "walletType": "airtime"
}
```

`walletType` is optional. If omitted, the credit goes to the user's current `activeWallet`.

Example:

```bash
curl -s http://localhost:5050/api/v1/users/credit \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"userId":"507f1f77bcf86cd799439011","amount":500}'
```

### Events

`POST /events`

```json
{
  "sport": "football",
  "league": "Premier League",
  "homeTeam": "The Reds",
  "awayTeam": "London Reds",
  "startTime": "2026-07-01T12:00:00.000Z",
  "selections": [
    { "key": "home", "label": "Home Team wins", "odds": 1.78 },
    { "key": "draw", "label": "Draw", "odds": 3.2 },
    { "key": "away", "label": "Away Team wins", "odds": 4.1 }
  ]
}
```

Example:

```bash
curl -s http://localhost:5050/api/v1/events \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "sport":"football",
    "league":"Premier League",
    "homeTeam":"The Reds",
    "awayTeam":"London Reds",
    "startTime":"2026-07-01T12:00:00.000Z",
    "selections":[
      {"key":"home","label":"Home Team wins","odds":1.78},
      {"key":"draw","label":"Draw","odds":3.2},
      {"key":"away","label":"Away Team wins","odds":4.1}
    ]
  }'
```

`POST /events/:id/settle`

```json
{
  "result": "home"
}
```

Example:

```bash
EVENT_ID="REPLACE_EVENT_ID"

curl -s http://localhost:5050/api/v1/events/$EVENT_ID/settle \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"result":"home"}'
```

### Virtuals

`POST /virtuals/shortcode/:game_uuid`

```json
{
  "player_id": "507f1f77bcf86cd799439011",
  "player_name": "Jimmy",
  "currency": "KES",
  "content": "1",
  "channel": "ussd"
}
```

Example:

```bash
GAME_UUID="REPLACE_GAME_UUID"

curl -s http://localhost:5050/api/v1/virtuals/shortcode/$GAME_UUID \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "player_id":"507f1f77bcf86cd799439011",
    "player_name":"Jimmy",
    "currency":"KES",
    "content":"1",
    "channel":"ussd"
  }'
```

## Notes

- Phone numbers are normalized to `2547XXXXXXXX` by the API.
- Public and standard user flows remain documented in [README.md](./README.md).
