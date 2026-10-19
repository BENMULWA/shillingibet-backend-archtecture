# ShilingiBet Dashboard

Admin dashboard for managing the ShilingiBet platform. This project is a Vite + React application used for operations such as user management, bets, transactions, fraud monitoring, jackpot views, and support tooling.

## Stack

- React 19
- Vite 6
- React Router 7
- TanStack Query
- Ant Design
- Tailwind CSS 4
- Recharts
- Socket.IO client

## Project structure

```text
src/
  main.jsx                  App bootstrap
  App.jsx                   Router, providers, theme config
  context/                  Global auth state
  components/               Shared UI building blocks
  hooks/                    Data-fetching and action hooks
  pages/                    Main dashboard screens
  features/jackpot/         Jackpot-specific pages and services
  services/                 API service modules
  utils/                    API config and request helpers
public/
  bg.png                    Login background
  shilingibet.png           Brand asset
```

## Features

- Admin authentication
- Dashboard overview
- User management
- Bets management
- Transactions management
- Fraud alerts
- Jackpot pages
- Support chat via Socket.IO
- Export flows for users, bets, and transactions

## Environment variables

Create a `.env.development` or `.env.production` file from `.env.example`.

```bash
VITE_API_URL=https://your-api-url/api/v1
VITE_SOCKET_URL=https://your-api-url
VITE_API_KEY=your_api_key_here
VITE_API_SECRET=your_api_secret_here
```

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy the example file and update the values for your API:

```bash
cp .env.example .env.development
```

Required values:

- `VITE_API_URL`: base URL for REST API requests
- `VITE_SOCKET_URL`: base URL for Socket.IO connections and file downloads
- `VITE_API_KEY`: API key used by helper utilities where required
- `VITE_API_SECRET`: API secret used by helper utilities where required

### 3. Start the app

```bash
npm run dev
```

Local development server: `http://localhost:5173`

## Scripts

```bash
npm run dev
npm run build
npm run preview
npm run lint
```

## Main routes

- `/login`
- `/`
- `/dashboard`
- `/users`
- `/bets`
- `/transactions`
- `/fraud`
- `/settings`
- `/support-admin`
- `/jackpot`
- `/jackpot/results`
- `/jackpot/results/:drawId`
- `/jackpot/my-bets`
- `/jackpot/my-bets/:betId`
- `/agent/support`

## API integration notes

- Most requests use `VITE_API_URL` through `src/utils/fetchRequest.js`.
- Auth login currently posts to `user/admin-login`.
- Export downloads are built from `VITE_SOCKET_URL`.
- Support chat connects to `${VITE_SOCKET_URL}/support-chat`.

## Required payloads

Unless noted otherwise, protected requests send `Authorization: Bearer <token>`.

### Auth

`POST /user/admin-login`

```json
{
  "phone": "2547XXXXXXXX",
  "password": "your-password",
  "tenantId": "69d8c1a51807400ce8cea129"
}
```

`POST /user/forgot-password`

```json
{
  "phone": "2547XXXXXXXX"
}
```

`POST /user/reset-password`

```json
{
  "phone": "2547XXXXXXXX",
  "newPassword": "new-password",
  "otp": "123456"
}
```

`POST /user/createAdmin`

```json
{
  "phone": "2547XXXXXXXX",
  "password": "admin-password",
  "role": "admin"
}
```

`DELETE /user/delete-account`

- No request body

### Users

`POST /user/getUserByPhone`

```json
{
  "phone": "2547XXXXXXXX"
}
```

`POST /admin/pauseAccount/:id`

- No request body

`POST /admin/pauseDeposit/:id`

- No request body

`POST /admin/pauseWithdrawal/:id`

- No request body

`POST /admin/zeroBalance/:userId`

- No request body

`DELETE /admin/deleteAccount/:userId`

- No request body

### Bets, cashback, and transactions filters

`POST /analytics/getWinLossesByPhone`

```json
{
  "phone": "2547XXXXXXXX",
  "page": 1,
  "limit": 10
}
```

`POST /analytics/getCashbackByPhone?page=1&limit=10`

```json
{
  "phone": "2547XXXXXXXX",
  "page": 1,
  "limit": 10
}
```

`POST /wallet/getUserTransactions?page=1&limit=10`

```json
{
  "phone": "2547XXXXXXXX",
  "page": 1,
  "limit": 10
}
```

### Wallet and transfers

`POST /wallet/make_transfer`

```json
{
  "amount": 1000
}
```

`POST /admin/transferToSecondaryWallet`

```json
{
  "amount": 1000
}
```

### Fraud management

`PATCH /admin/fraud/alerts/:alertId/resolve`

```json
{
  "status": "resolved_legitimate",
  "resolutionNotes": "Reviewed and cleared"
}
```

`PATCH /admin/fraud/alerts/bulk`

```json
{
  "alertIds": ["alert-id-1", "alert-id-2"],
  "status": "resolved_fraud",
  "notes": "Bulk review outcome"
}
```

`PATCH /admin/fraud/alerts/:alertId`

```json
{
  "status": "under_review"
}
```

### Jackpot

`POST /jackpot/bet`

```json
{
  "drawId": "draw-id",
  "stake": 100,
  "selections": []
}
```

The exact shape of `selections` depends on the backend jackpot contract. The frontend forwards the payload as-is from the jackpot feature.

### Export queries

These routes are `GET` requests and do not send JSON bodies:

- `/analytics/generateUserDocument?start=<ISO_DATE>&end=<ISO_DATE>`
- `/analytics/generateTransaction?start=<ISO_DATE>&end=<ISO_DATE>`
- `/analytics/generateBets?start=<ISO_DATE>&end=<ISO_DATE>`
- `/analytics/getAnalytics?startDate=<ISO_DATE>&endDate=<ISO_DATE>`

## Build and deployment

- `vite.config.js` contains the Vite build configuration.
- `vercel.json`, `netlify.toml`, and `public/_redirects` are included for deployment/routing support.

## Notes

- This repository is a frontend dashboard, not the backend API.
- The backend endpoints and authentication flow must be available separately for the dashboard to function.




node - <<'NODE'
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./src/domains/user/user.model');
const { normalizePhone } = require('./src/utils/phone');

const phone = normalizePhone('0704216772');
const amount = 300;

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const before = await User.findOne({ phone }).lean();
  if (!before) {
    console.error(`User not found for phone ${phone}`);
    process.exit(1);
  }

  if (before.balance < amount) {
    console.error({
      error: 'Insufficient balance to reduce by requested amount',
      phone,
      balanceBefore: before.balance,
      requestedReduction: amount,
    });
    process.exit(1);
  }

  const after = await User.findOneAndUpdate(
    { phone },
    { $inc: { balance: -amount } },
    { new: true }
  ).lean();

  console.log({
    userId: String(after._id),
    phone: after.phone,
    reducedBy: amount,
    balanceBefore: before.balance,
    balanceAfter: after.balance,
  });

  await mongoose.disconnect();
})();
NODE