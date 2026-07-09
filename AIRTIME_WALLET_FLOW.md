# Airtime Wallet Flow

This backend now supports two user wallets:

- `balance`: the existing KES wallet
- `airtimeBalance`: the new airtime wallet

The user also has:

- `activeWallet`: either `balance` or `airtime`

By default:

- `balance` works exactly as before
- `airtimeBalance` starts at `0`
- `activeWallet` defaults to `balance`

## User Object

Example user payload from login or `/api/v1/users/me`:

```json
{
  "_id": "6a45121911ad11cdf2bca573",
  "phone": "254717126550",
  "balance": 300,
  "airtimeBalance": 0,
  "activeWallet": "balance"
}
```

## Frontend Flow

### 1. Login

```http
POST /api/v1/users/login
```

Example response:

```json
{
  "success": true,
  "message": "Logged in",
  "data": {
    "user": {
      "_id": "6a45121911ad11cdf2bca573",
      "balance": 300,
      "airtimeBalance": 0,
      "activeWallet": "balance"
    },
    "token": "JWT_TOKEN"
  }
}
```

Use `data.user.activeWallet` to show the currently selected wallet in the UI.

### 2. Read the current wallet state

```http
GET /api/v1/users/me
Authorization: Bearer JWT_TOKEN
```

This is the safest endpoint to refresh wallet balances and the current active wallet after login, switching, betting, or payment completion.

### 3. Switch the active wallet

```http
PATCH /api/v1/users/wallet/active
Authorization: Bearer JWT_TOKEN
Content-Type: application/json
```

Request body:

```json
{
  "wallet": "airtime"
}
```

Allowed values:

- `balance`
- `airtime`

Example success response:

```json
{
  "success": true,
  "message": "Active wallet updated",
  "data": {
    "_id": "6a45121911ad11cdf2bca573",
    "balance": 300,
    "airtimeBalance": 0,
    "activeWallet": "airtime"
  }
}
```

## Betting Flow

### Default behavior

If the frontend does not send a `walletType`, betting uses the user’s current `activeWallet`.

### Explicit behavior

The frontend can also send `walletType` on the bet request to make the wallet choice explicit.

```http
POST /api/v1/bets
Authorization: Bearer JWT_TOKEN
Content-Type: application/json
```

```json
{
  "eventId": "668f7a0f1e7f1d29d4d82311",
  "selectionKey": "home_win",
  "stake": 50,
  "walletType": "airtime"
}
```

If `walletType` is omitted:

- backend uses `activeWallet`

If the bet wins:

- winnings are credited back to the same wallet used for the bet

## Deposit Flow

### Mobile money deposit

```http
POST /api/v1/transactions/deposit
Authorization: Bearer JWT_TOKEN
Content-Type: application/json
```

```json
{
  "amount": 100,
  "phone": "254717126550",
  "walletType": "airtime"
}
```

If `walletType` is omitted:

- backend uses `activeWallet`

When the provider confirms the deposit:

- if `walletType` was `balance`, `balance` is credited
- if `walletType` was `airtime`, `airtimeBalance` is credited

### Card deposit link

```http
POST /api/v1/wallet/card-link
Authorization: Bearer JWT_TOKEN
Content-Type: application/json
```

```json
{
  "amount": 100,
  "currency": "USD",
  "country": "US",
  "email": "user@example.com",
  "phone": "254717126550",
  "first_name": "Jay",
  "last_name": "Doe",
  "redirect_url": "https://shilingibet.com/deposit",
  "walletType": "airtime"
}
```

If `walletType` is omitted:

- backend uses `activeWallet`

Example success response:

```json
{
  "success": true,
  "message": "Card payment link created",
  "data": {
    "transaction": {
      "walletType": "airtime",
      "status": "pending"
    },
    "redirectUrl": "https://payment-link.transactpay.ai/payment/checkout/..."
  }
}
```

Frontend behavior:

1. Call the endpoint.
2. Read `data.redirectUrl`.
3. Redirect the user to that TransactPay checkout URL.

Important note:

- the pending card transaction now stores which wallet should receive the funds
- this codebase still needs a TransactPay completion callback or status-confirmation flow before the wallet is actually credited after checkout

## Recommended Frontend Rules

- Always display both `balance` and `airtimeBalance`.
- Store the selected wallet in UI state.
- After switching wallets, refresh local user state from the response.
- For bets and deposits, prefer sending `walletType` explicitly even though `activeWallet` exists.
- After a successful deposit callback or completed bet flow, refresh `/api/v1/users/me`.

## Example Frontend `fetch`

### Switch to airtime wallet

```js
await fetch("https://your-api.com/api/v1/users/wallet/active", {
  method: "PATCH",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`
  },
  body: JSON.stringify({ wallet: "airtime" })
});
```

### Place a bet with airtime

```js
await fetch("https://your-api.com/api/v1/bets", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`
  },
  body: JSON.stringify({
    eventId: "668f7a0f1e7f1d29d4d82311",
    selectionKey: "home_win",
    stake: 50,
    walletType: "airtime"
  })
});
```

### Create a card link for airtime wallet

```js
const res = await fetch("https://your-api.com/api/v1/wallet/card-link", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`
  },
  body: JSON.stringify({
    amount: 100,
    currency: "USD",
    country: "US",
    email: "user@example.com",
    phone: "254717126550",
    first_name: "Jay",
    last_name: "Doe",
    redirect_url: "https://shilingibet.com/deposit",
    walletType: "airtime"
  })
});

const json = await res.json();
window.location.href = json.data.redirectUrl;
```
