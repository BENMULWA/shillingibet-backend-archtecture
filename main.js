const crypto = require("crypto");

const apiKey = "PGW-PUBLICKEY-E3ADF420896D4D5C813FDCBEFCED5DE1";
const encryptionKey =
  "NDA5NiE8UlNBS2V5VmFsdWU+PE1vZHVsdXM+MVZXU1V3ZWZoRUx4T2tTYU1TbDZkUm42WHdLTUIwMS9hc1FraWhsUjVJNWpFdDJlM1FFNXFiQXZTWlF6dmRDSk5lVXJhWFpJS3pITDFWditPOURvRVFvMlpPTTJ3cWJ1MWQ4SlloTjZ6U3pmcHQwZ29LUVVSL1UyQ0hWaEEzd0pwTy8vaG0wYnNNSURtUjB5bTNicDV5ZEpOYzJNVFZ3NmM2bUxTK0t1aTNNTllONUlFVE1hU3UzQmRhTUh1SWg3aUR4L3kxd1EwaXZ0MVkrSjVDQlRXSytMNkU0UEx6Vmh0Q0RDK2hRSUFPZjNCUEhiTzg3dnVFbmVDQWFwaVpTS200ZDVMMmVhTnlWRTAzYSt1akI3Qkt3MS9zT1JVZ2xhd0hLOHBlYVBBMGluV0dXRERzemczSjZCQ1RWTXo2Ujl0MTVqWFlTOXpVdlRkdTEvNkJSUHkzOGlLZlNWbG1hVnJMWWpvcWVJMTBEdEJEbTNFdXFOOU1hM1h4UHZpS3Qxc1hxYVNaODZXcSsvWm1SZ3orOEI2M0Q2UWhqRTdaYklkUyt2VTZ1MHAxc1Nrd28ybi9OZ0QydEpYcjJBNEplQWNJNExTOXBTcmlMbTNKUFZBYkpPWmprTWE0QVAzazBTam5jZnRVZ1RHTUx6WXB2ZDVLSklxSTRkR3JXMjc2NFlVVnR1TzF5Z0lFVlpnQVRzL1JyeWViTFZqZjk1NnZydVJkc0J4eFRPMmlKV0VxWEdtN0c1WTFhOERjU1ZtK2ZJZ25lWndyazZzbUtkRTRFUTlMTm1mQVhHOXRhZCtCV2V6MThtTTVVK25ta0VjWTZBRTd0V2F4azNWSzNwUUdRZTNxcXRHZTFzWS93dHdoM3MzbitzcHRWV2l5bEFKRGN3N21SbXI5aFM3aFU9PC9Nb2R1bHVzPjxFeHBvbmVudD5BUUFCPC9FeHBvbmVudD48L1JTQUtleVZhbHVlPg==";
const baseURL = "https://payment-api-service.transactpay.ai";

function prettyJSON(value) {
  return JSON.stringify(value, null, 2);
}

function maskValue(value) {
  if (value.length <= 8) {
    return "****";
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function toBase64Url(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function parsePublicKey(encodedKey) {
  const decodedKey = Buffer.from(encodedKey, "base64").toString("utf8");
  const xmlData = decodedKey.startsWith("4096!")
    ? decodedKey.slice("4096!".length)
    : decodedKey;

  const modulusMatch = xmlData.match(/<Modulus>([^<]+)<\/Modulus>/);
  const exponentMatch = xmlData.match(/<Exponent>([^<]+)<\/Exponent>/);

  if (!modulusMatch || !exponentMatch) {
    throw new Error("Unable to parse RSA key");
  }

  const modulus = Buffer.from(modulusMatch[1], "base64");
  const exponent = Buffer.from(exponentMatch[1], "base64");

  return crypto.createPublicKey({
    key: {
      kty: "RSA",
      n: toBase64Url(modulus),
      e: toBase64Url(exponent),
    },
    format: "jwk",
  });
}

function encryptPayload(payload) {
  const publicKey = parsePublicKey(encryptionKey);
  const rawPayload = Buffer.from(JSON.stringify(payload), "utf8");
  const encrypted = crypto.publicEncrypt(
    {
      key: publicKey,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    },
    rawPayload
  );

  return encrypted.toString("base64");
}

function logRequest(endpoint, payload) {
  console.log();
  console.log("==================================================");
  console.log("Request:", endpoint);
  console.log("Time:", new Date().toISOString());
  console.log("Method: POST");
  console.log("URL:", `${baseURL}${endpoint}`);
  console.log("Headers:");
  console.log("  accept: application/json");
  console.log("  Content-Type: application/json");
  console.log("  api-key:", maskValue(apiKey));
  console.log("Plain payload before RSA encryption:");
  console.log(prettyJSON(payload));
  console.log("==================================================");
}

function logEncryptedRequest(endpoint, payload) {
  console.log();
  console.log("==================================================");
  console.log("Encrypted request:", endpoint);
  console.log("Time:", new Date().toISOString());
  console.log("Method: POST");
  console.log("URL:", `${baseURL}${endpoint}`);
  console.log("Headers:");
  console.log("  accept: application/json");
  console.log("  Content-Type: application/json");
  console.log("  api-key:", maskValue(apiKey));
  console.log("Encrypted payload being sent:");
  console.log(prettyJSON(payload));
  console.log("==================================================");
}

function logRawRequest(endpoint, payload) {
  console.log();
  console.log("==================================================");
  console.log("Request:", endpoint);
  console.log("Time:", new Date().toISOString());
  console.log("Method: POST");
  console.log("URL:", `${baseURL}${endpoint}`);
  console.log("Headers:");
  console.log("  accept: application/json");
  console.log("  Content-Type: application/json");
  console.log("  api-key:", maskValue(apiKey));
  console.log("Payload:");
  console.log(prettyJSON(payload));
  console.log("==================================================");
}

function logResponse(endpoint, status, body) {
  let formattedBody = body;

  try {
    formattedBody = prettyJSON(JSON.parse(body));
  } catch (_) {
    // Keep the original body when it is not valid JSON.
  }

  console.log();
  console.log("Response:", endpoint);
  console.log("Status:", status);
  console.log("Body:");
  console.log(formattedBody);
  console.log("--------------------------------------------------");
}

async function postRequest(endpoint, payload, encrypted = true) {
  if (encrypted) {
    logRequest(endpoint, payload);
  } else {
    logRawRequest(endpoint, payload);
  }

  const bodyPayload = encrypted
    ? { data: encryptPayload(payload) }
    : payload;

  if (encrypted) {
    logEncryptedRequest(endpoint, bodyPayload);
  }

  const response = await fetch(`${baseURL}${endpoint}`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify(bodyPayload),
  });

  const responseText = await response.text();
  logResponse(endpoint, `${response.status} ${response.statusText}`, responseText);

  if (!response.ok) {
    throw new Error(`${endpoint} failed: ${response.status} ${response.statusText}`);
  }

  return JSON.parse(responseText);
}

async function createOrder(reference) {
  const payload = {
    customer: {
      firstname: "Cradle",
      lastname: "Customer",
      mobile: "0906678941",
      country: "CD",
      email: "customer@mhs.com",
    },
    order: {
      amount: 200,
      reference,
      currency: "CDF",
      description: `Payment ${reference}`,
    },
    payment: {
      RedirectUrl: "https://yourdomain.com/payment/callback",
    },
    paymentMeta: {
      ipAddress: "127.0.0.1",
    },
  };

  const response = await postRequest("/payment/order/create", payload, true);
  if (response.status !== "success") {
    throw new Error(`create order failed: ${response.message}`);
  }

  return response.data.order.reference;
}

async function payOrder(reference) {
  const payload = {
    reference,
    paymentoption: "momo",
    country: "CD",
    mobileMoney: {
      mobileNumber: "906678941",
      MobileMoneyCode: "348",
    },
  };

  await postRequest("/payment/order/pay", payload, true);
}

async function payOrderWithCard(reference) {
  const payload = {
    reference,
    paymentoption: "C",
    country: "NG",
    card: {
      cardnumber: "5123450000784608",
      expirymonth: "01",
      expiryyear: "39",
      cvv: "193",
    },
  };

  await postRequest("/payment/order/pay", payload, true);
}

async function initiatePayout(reference) {
  const payload = {
    payoutDetails: [
      {
        clientReference: reference,
        accountNumber: "906678941",
        bankCode: "348",
        amount: 1000,
        description: `DRC 348 payout test ${reference}`,
        accountName: "Glob Pay  Customer",
        creditCurrency: "CDF",
        debitCurrency: "CDF",
      },
    ],
  };

  const response = await postRequest("/payout/initiate", payload, true);
  if (response.status !== "success") {
    throw new Error(`payout failed: ${response.message}`);
  }

  return response;
}

async function createPaymentLink(reference) {
  const payload = {
    customer: {
      firstname: "Transact",
      lastname: "Pay",
      mobile: "09150691727",
      country: "NG",
      email: "test@email.com",
    },
    order: {
      amount: 100,
      reference,
      description: `Card payment ${reference}`,
      currency: "NGN",
    },
    payment: {
      RedirectUrl: "https://www.yourredirecturl.com",
    },
  };

  const response = await postRequest("/payment/create", payload, true);
  if (!response.isSuccess) {
    throw new Error(`payment link failed: ${response.message}`);
  }

  return response;
}

async function createUSDPaymentLink(reference) {
  const payload = {
    customer: {
      firstname: "Transact",
      lastname: "Pay",
      mobile: "09150691727",
      country: "US",
      email: "test@email.com",
    },
    order: {
      amount: 1,
      reference,
      description: `USD payment ${reference}`,
      currency: "USD",
    },
    payment: {
      RedirectUrl: "https://www.yourredirecturl.com",
    },
  };

  const response = await postRequest("/payment/create", payload, true);
  if (!response.isSuccess) {
    throw new Error(`payment link failed: ${response.message}`);
  }

  return response;
}

async function main() {
  const reference = `USD-LINK-${Date.now()}`;
  const paymentLink = await createUSDPaymentLink(reference);

  console.log("Payment link created successfully");
  console.log("Reference:", reference);
  console.log("Order ID:", paymentLink.orderId);
  console.log("Redirect URL:", paymentLink.redirectUrl);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
