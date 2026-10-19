# Airtime Withdrawal Flow

This document explains how the frontend should trigger airtime withdrawal from the user's `airtimeBalance`.

## Summary

Use the existing withdrawal endpoint:

`POST /api/v1/transactions/withdraw`

To make it an airtime withdrawal, send:

- `walletType: "airtime"`
- the user's phone number
- the amount of airtime to disburse

The backend will:

1. Check that the user has enough `airtimeBalance`
2. Deduct the amount from `airtimeBalance`
3. Call Mamlaka airtime disbursement
4. Mark the transaction based on Mamlaka's response
5. Refund the airtime balance automatically if Mamlaka returns an immediate failure

## Request

### Endpoint

`POST /api/v1/transactions/withdraw`

### Headers

```http
Authorization: Bearer <token>
Content-Type: application/json
```

### Body

```json
{
  "amount": 10,
  "phone": "0768899729",
  "provider": "TELKOM",
  "walletType": "airtime"
}
```

### Fields

- `amount`: required number
- `phone`: required string
- `provider`: optional string, defaults to backend Mamlaka provider if omitted
- `walletType`: must be `"airtime"` for airtime withdrawal

## Supported Phone Formats

The backend normalizes these formats:

- `254768899729`
- `0768899729`
- `768899729`

## Successful Behavior

If the user has enough `airtimeBalance` and Mamlaka accepts the airtime request:

- the airtime wallet is deducted
- the transaction is saved as a withdrawal
- the transaction currency is stored as `ARTM`
- the transaction wallet type is stored as `airtime`

Example successful transaction response:

```json
{
  "success": true,
  "message": "Withdrawal is being processed",
  "data": {
    "_id": "686e4d3b2fdc0d0012345678",
    "user": "686e4a572fdc0d0012345670",
    "type": "withdrawal",
    "status": "completed",
    "amount": 10,
    "currency": "ARTM",
    "walletType": "airtime",
    "provider": "TELKOM",
    "phone": "254768899729",
    "externalId": "ART-1783599999999-ab12cd34",
    "secureId": "qdml8553ZeInavKorBHzLA==",
    "receipt": "AIRTIME-001",
    "failureReason": null,
    "completedAt": "2026-07-09T10:30:00.000Z",
    "walletAppliedAt": "2026-07-09T10:30:00.000Z",
    "createdAt": "2026-07-09T10:30:00.000Z",
    "updatedAt": "2026-07-09T10:30:00.000Z"
  }
}
```

## Failed Behavior

If the user does not have enough airtime balance, the backend rejects the request before calling Mamlaka.

Example:

```json
{
  "success": false,
  "message": "Insufficient airtime balance"
}
```

If Mamlaka returns an immediate failure:

- the transaction is marked `failed`
- the deducted airtime balance is refunded automatically

Example failed transaction response shape:

```json
{
  "success": true,
  "message": "Withdrawal is being processed",
  "data": {
    "_id": "686e4d3b2fdc0d0012345678",
    "type": "withdrawal",
    "status": "failed",
    "amount": 10,
    "currency": "ARTM",
    "walletType": "airtime",
    "failureReason": "Airtime disbursion failed"
  }
}
```

## Frontend Recommendations

- Always read both `balance` and `airtimeBalance` from `/api/v1/users/me`
- Only show the airtime withdrawal action when `airtimeBalance > 0`
- Validate the amount before submit
- Validate that the phone number field is not empty
- Send `walletType: "airtime"` explicitly
- After a successful request, refresh:
  - `/api/v1/users/me`
  - `/api/v1/transactions`

## Suggested UI Flow

1. User opens Airtime Withdrawal screen
2. Frontend shows current `airtimeBalance`
3. User enters:
   - amount
   - phone number
   - provider if needed
4. Frontend submits `POST /transactions/withdraw` with `walletType: "airtime"`
5. Frontend refreshes profile and transactions after response
6. Frontend shows transaction status from the returned payload

## Example Fetch

```js
const res = await fetch("https://your-api.com/api/v1/transactions/withdraw", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`
  },
  body: JSON.stringify({
    amount: 10,
    phone: "0768899729",
    provider: "TELKOM",
    walletType: "airtime"
  })
});

const data = await res.json();
```

## Notes

- Airtime withdrawal uses the same backend route as normal cash withdrawal
- The difference is `walletType: "airtime"`
- Airtime withdrawals are stored as `currency: "ARTM"`
- The backend normalizes phone numbers before calling Mamlaka
