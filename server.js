const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

function loadLocalEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || Object.hasOwn(process.env, match[1])) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
    process.env[match[1]] = value;
  }
}

loadLocalEnv();

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const payments = new Map();
const imageFiles = new Map([
  ["cover.png", path.join(PUBLIC_DIR, "images", "cover.png")],
  ["avatar.png", path.join(PUBLIC_DIR, "images", "avatar.png")],
  ["preview-01.png", path.join(PUBLIC_DIR, "images", "Screenshot 2026-11-08 154303.png")],
  ["profile-cover.png", path.join(PUBLIC_DIR, "images", "Home", "Screenshot 2026-11-08 142047.png")]
]);
const kenyanPlans = [
  { id: "mpesa-30-day", name: "30-day access", amount: 799, regularAmount: 1598, offer: "50% off" }
];
const products = [
  { id: "after-hours", name: "After Hours", type: "Photo set", description: "A private, candlelit photo collection.", price: 1299, offer: "Private offer", symbol: "01" },
  { id: "soft-focus", name: "Soft Focus", type: "Video", description: "An intimate short film, made for your eyes only.", price: 2999, offer: "Private offer", symbol: "02" },
  { id: "the-private-edit", name: "The Private Edit", type: "Bundle", description: "A curated set of photos and exclusive video.", price: 4999, offer: "Best value", symbol: "03" }
];

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".mp4": "video/mp4"
};

function sendJson(response, status, data) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(data));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10_000) {
        reject(new Error("Request body too large"));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    request.on("error", reject);
  });
}

function getDarajaStatus() {
  const required = [
    "MPESA_CONSUMER_KEY",
    "MPESA_CONSUMER_SECRET",
    "MPESA_SHORTCODE",
    "MPESA_PASSKEY",
    "MPESA_CALLBACK_URL"
  ];
  const missing = required.filter((name) => !process.env[name]);
  let callbackIsHttps = false;
  if (process.env.MPESA_CALLBACK_URL) {
    try {
      const callbackUrl = new URL(process.env.MPESA_CALLBACK_URL);
      const hostname = callbackUrl.hostname.toLowerCase();
      callbackIsHttps = callbackUrl.protocol === "https:" &&
        !["localhost", "127.0.0.1", "::1", "your_public_host"].includes(hostname) &&
        !hostname.endsWith(".localhost") &&
        !hostname.endsWith(".example");
    } catch {
      callbackIsHttps = false;
    }
  }
  if (process.env.MPESA_CALLBACK_URL && !callbackIsHttps) {
    missing.push("MPESA_CALLBACK_URL (must use a public HTTPS host, not localhost or a placeholder)");
  }

  return {
    configured: missing.length === 0,
    missing,
    environment: process.env.MPESA_ENVIRONMENT === "production" ? "production" : "sandbox"
  };
}

function normalizeKenyanPhone(input) {
  const digits = String(input || "").replace(/\D/g, "");
  let phone = digits;
  if (phone.startsWith("0")) phone = `254${phone.slice(1)}`;
  if (phone.length === 9 && /^[17]/.test(phone)) phone = `254${phone}`;
  return /^254[17]\d{8}$/.test(phone) ? phone : null;
}

async function getAccessToken(baseUrl) {
  const credentials = Buffer.from(
    `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
  ).toString("base64");
  const response = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${credentials}` }
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error("Unable to authenticate with M-Pesa. Check the Daraja app credentials.");
  }
  return data.access_token;
}

async function initiatePayment(item, phone) {
  const environment = process.env.MPESA_ENVIRONMENT === "production" ? "production" : "sandbox";
  const baseUrl = environment === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const shortcode = process.env.MPESA_SHORTCODE;
  const password = Buffer.from(`${shortcode}${process.env.MPESA_PASSKEY}${timestamp}`).toString("base64");
  const token = await getAccessToken(baseUrl);
  const response = await fetch(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: item.price ?? item.amount,
      PartyA: phone,
      PartyB: shortcode,
      PhoneNumber: phone,
      CallBackURL: process.env.MPESA_CALLBACK_URL,
      AccountReference: item.id,
      TransactionDesc: `Purchase ${item.name}`.slice(0, 20)
    })
  });
  const data = await response.json();
  if (!response.ok || data.ResponseCode !== "0" || !data.CheckoutRequestID) {
    throw new Error(data.errorMessage || data.ResponseDescription || "M-Pesa could not start the payment.");
  }
  return data;
}

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/products") {
    return sendJson(response, 200, { products });
  }

  if (request.method === "GET" && url.pathname === "/api/mpesa-plans") {
    return sendJson(response, 200, { plans: kenyanPlans });
  }

  if (request.method === "GET" && url.pathname === "/api/checkout-status") {
    return sendJson(response, 200, getDarajaStatus());
  }

  if (request.method === "POST" && url.pathname === "/api/payments") {
    let body;
    try {
      body = await readJson(request);
    } catch (error) {
      return sendJson(response, 400, { error: error.message });
    }

    const product = products.find((item) => item.id === body.productId);
    const plan = kenyanPlans.find((item) => item.id === body.planId);
    const item = product || plan;
    const phone = normalizeKenyanPhone(body.phone);
    if (!item) return sendJson(response, 400, { error: "Choose a valid item." });
    if (!phone) return sendJson(response, 400, { error: "Enter a valid Kenyan mobile number, e.g. 0712 345 678." });
    const darajaStatus = getDarajaStatus();
    if (!darajaStatus.configured) {
      return sendJson(response, 503, {
        error: `M-Pesa is not ready. Configure the required settings in .env: ${darajaStatus.missing.join(", ")}.`
      });
    }

    try {
      const result = await initiatePayment(item, phone);
      payments.set(result.CheckoutRequestID, {
        productId: product?.id || null,
        planId: plan?.id || null,
        phone,
        status: "pending",
        createdAt: Date.now()
      });
      return sendJson(response, 202, {
        checkoutRequestId: result.CheckoutRequestID,
        customerMessage: result.CustomerMessage || "Check your phone and enter your M-Pesa PIN to complete payment."
      });
    } catch (error) {
      console.error("M-Pesa checkout error:", error.message);
      return sendJson(response, 502, { error: error.message });
    }
  }

  if (request.method === "GET" && url.pathname.startsWith("/api/payments/")) {
    const id = decodeURIComponent(url.pathname.slice("/api/payments/".length));
    const payment = payments.get(id);
    if (!payment) return sendJson(response, 404, { error: "Payment not found." });
    if (payment.status === "pending" && Date.now() - payment.createdAt > 3 * 60 * 1000) {
      payment.status = "expired";
    }
    return sendJson(response, 200, { status: payment.status });
  }

  if (request.method === "POST" && url.pathname === "/api/mpesa/callback") {
    let body;
    try {
      body = await readJson(request);
    } catch (error) {
      return sendJson(response, 400, { error: error.message });
    }
    const callback = body?.Body?.stkCallback;
    const payment = callback && payments.get(callback.CheckoutRequestID);
    if (payment) {
      payment.status = Number(callback.ResultCode) === 0 ? "paid" : "failed";
      payment.receipt = callback.CallbackMetadata?.Item?.find((item) => item.Name === "MpesaReceiptNumber")?.Value || null;
    }
    return sendJson(response, 200, { ResultCode: 0, ResultDesc: "Accepted" });
  }

  return sendJson(response, 404, { error: "Not found." });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) {
    try {
      await handleApi(request, response, url);
    } catch (error) {
      console.error("Request error:", error.message);
      if (!response.headersSent) sendJson(response, 500, { error: "An unexpected server error occurred." });
    }
    return;
  }

  const imageName = url.pathname.startsWith("/images/")
    ? url.pathname.slice("/images/".length)
    : null;
  const videoName = url.pathname.startsWith("/video/")
    ? url.pathname.slice("/video/".length)
    : null;
  const fileName = url.pathname === "/" ? "index.html" : path.basename(url.pathname);
  const isPublicFile = ["index.html", "styles.css", "app.js"].includes(fileName);
  const imagePath = imageFiles.get(imageName);
  const isAgeVideo = videoName === "njoki.mp4";
  if (!isPublicFile && !imagePath && !isAgeVideo) {
    response.writeHead(404);
    return response.end("Not found");
  }
  const filePath = imagePath || (isAgeVideo
      ? path.join(PUBLIC_DIR, "video", videoName)
      : path.join(PUBLIC_DIR, fileName));
  if (isAgeVideo) {
    fs.stat(filePath, (error, stats) => {
      if (error) {
        response.writeHead(500);
        return response.end("Unable to load storefront");
      }

      const range = request.headers.range;
      let start = 0;
      let end = stats.size - 1;
      let status = 200;
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match || (!match[1] && !match[2])) {
          response.writeHead(416, { "Content-Range": `bytes */${stats.size}` });
          return response.end();
        }
        if (match[1]) {
          start = Number(match[1]);
          end = match[2] ? Number(match[2]) : end;
        } else {
          start = Math.max(0, stats.size - Number(match[2]));
        }
        if (start >= stats.size || end < start) {
          response.writeHead(416, { "Content-Range": `bytes */${stats.size}` });
          return response.end();
        }
        end = Math.min(end, stats.size - 1);
        status = 206;
      }

      response.writeHead(status, {
        "Content-Type": mimeTypes[path.extname(filePath)],
        "Content-Length": end - start + 1,
        "Accept-Ranges": "bytes",
        ...(status === 206 ? { "Content-Range": `bytes ${start}-${end}/${stats.size}` } : {}),
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin"
      });
      fs.createReadStream(filePath, { start, end }).pipe(response);
    });
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(500);
      return response.end("Unable to load storefront");
    }
    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)],
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin"
    });
    response.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`Storefront running at http://localhost:${PORT}`);
  const darajaStatus = getDarajaStatus();
  if (!darajaStatus.configured) {
    console.log(`M-Pesa is not configured. Missing settings: ${darajaStatus.missing.join(", ")}`);
  } else {
    console.log(`M-Pesa is configured for ${darajaStatus.environment}.`);
  }
});
