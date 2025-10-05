// server.js
import express from "express";
import { prepareOnBooksy, getBrowser } from "./booksy.js";
import twilioPkg from "twilio";

const app = express();
app.disable("x-powered-by");
app.set("etag", false); // prevent 304s
app.use(express.json());

// Global no-cache headers (esp. for /healthz)
app.use((req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  next();
});

// ---------- Twilio (optional) ----------
const twilio = (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN)
  ? twilioPkg(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

// ---------- Helpers ----------
const guard = (req, res, next) => {
  // Protect only booking route (leave / and /healthz open)
  if (!process.env.API_KEY) return next();
  if (req.get("x-api-key") === process.env.API_KEY) return next();
  return res.status(401).json({ ok: false, error: "unauthorized" });
};

const prettyET = (iso) => {
  // "Sat Nov 1, 5:00 PM ET"
  const d = new Date(iso.replace(/([-+]\d\d:\d\d)$/,"Z")); // display-only
  return d.toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
    timeZone: "America/New_York"
  }) + " ET";
};

// ---------- Routes ----------
app.get("/", (_req, res) =>
  res.type("text").send("OK. GET /healthz, POST /booksy/book")
);

// Health MUST always be 200 for Render
app.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));

app.post("/booksy/book", guard, async (req, res) => {
  const started = Date.now();
  try {
    const { customer_name, customer_phone, service_name, preferred_barber, dateTime } = req.body || {};
    const required = { customer_name, customer_phone, service_name, preferred_barber, dateTime };
    for (const k of Object.keys(required)) {
      if (!required[k]) return res.status(400).json({ ok:false, error:`Missing ${k}` });
    }

    const pageUrl = "https://booksy.com/en-ca/4124_executive-styles-hair-studio_barbershop_979936_maple";

    // Try once; on error, retry once
    let prep;
    try {
      prep = await prepareOnBooksy({ pageUrl, service_name, preferred_barber, dateTime });
    } catch (e1) {
      console.warn("[BOOK] first attempt failed:", e1?.message || e1);
      prep = await prepareOnBooksy({ pageUrl, service_name, preferred_barber, dateTime });
    }

    // Optional SMS
    let smsSent = false, smsError = null;
    if (twilio) {
      const whenText = prettyET(dateTime);
      const { confirmUrl } = prep;
      const body = prep.available
        ? `Executive Styles: tap to finish booking ${service_name} with ${preferred_barber} on ${whenText}. Sign in and confirm: ${confirmUrl}`
        : `Executive Styles: your requested time is full. Pick another time here (service & barber preselected): ${confirmUrl}`;

      try {
        await twilio.messages.create({
          from: process.env.TWILIO_FROM,
          to: customer_phone,
          body
        });
        smsSent = true;
      } catch (err) {
        smsError = String(err);
      }
    }

    console.log(`[BOOK] ok in ${Date.now() - started}ms`);
    return res.json({ ok: true, result: prep, smsSent, smsError });

  } catch (err) {
    console.error(`[BOOK] error after ${Date.now() - started}ms`, err);
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

// ---------- Listen (prewarm Playwright) ----------
const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => {
  console.log("Booksy booker listening on", PORT);
  try {
    await getBrowser();
    console.log("Playwright browser prewarmed");
  } catch (e) {
    console.error("Prewarm failed:", e.message);
  }
});

// Safety logging
process.on("unhandledRejection", e => console.error("UNHANDLED", e));
process.on("uncaughtException", e => console.error("UNCAUGHT", e));
