// server.js
import express from "express";
import { bookOnBooksy, getBrowser } from "./booksy.js";

const app = express();
app.use(express.json());

// (Optional) simple API key guard — add x-api-key header in ElevenLabs tool
if (process.env.API_KEY) {
  app.use((req, res, next) => {
    const key = req.get("x-api-key");
    if (key === process.env.API_KEY) return next();
    return res.status(401).json({ ok: false, error: "unauthorized" });
  });
}

app.get("/", (req, res) => {
  res.type("text").send("Booksy Booker is running. Try GET /healthz or POST /booksy/book (JSON).");
});

app.get("/healthz", (req, res) => res.json({ ok: true }));

app.post("/booksy/book", async (req, res) => {
  try {
    const { customer_name, customer_phone, service_name, preferred_barber, dateTime } = req.body || {};
    if (!customer_name || !customer_phone || !service_name || !preferred_barber || !dateTime) {
      return res.status(400).json({ ok: false, error: "Missing fields" });
    }

    const result = await bookOnBooksy({
      pageUrl: "https://booksy.com/en-ca/4124_executive-styles-hair-studio_barbershop_979936_maple",
      customer_name,
      customer_phone,
      service_name,
      preferred_barber,
      dateTime
    });

    return res.json({ ok: true, ...result });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

// IMPORTANT: define PORT once, and listen once
const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => {
  console.log("Booksy booker listening on", PORT);
  // Prewarm Playwright so first call is fast
  try {
    await getBrowser();
    console.log("Playwright browser prewarmed");
  } catch (e) {
    console.error("Prewarm failed (will retry on first request):", e.message);
  }
});
