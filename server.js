// server.js
import express from "express";
import { prepareOnBooksy, getBrowser } from "./booksy.js";
import twilioPkg from "twilio";

const app = express();
app.use(express.json());

// Twilio (optional but recommended)
const twilio = (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN)
  ? twilioPkg(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

if (process.env.API_KEY) {
  app.use((req,res,next)=>{
    const key = req.get("x-api-key");
    if (key === process.env.API_KEY) return next();
    return res.status(401).json({ ok:false, error:"unauthorized" });
  });
}

app.get("/", (_req,res)=>res.type("text").send("OK. GET /healthz, POST /booksy/book"));
app.get("/healthz", (_req,res)=>res.json({ ok:true }));

app.post("/booksy/book", async (req,res)=>{
  try{
    const { customer_name, customer_phone, service_name, preferred_barber, dateTime } = req.body || {};
    if (!customer_name || !customer_phone || !service_name || !preferred_barber || !dateTime){
      return res.status(400).json({ ok:false, error:"Missing fields" });
    }

    const pageUrl = "https://booksy.com/en-ca/4124_executive-styles-hair-studio_barbershop_979936_maple";
    const prep = await prepareOnBooksy({ pageUrl, service_name, preferred_barber, dateTime });

    // compose SMS if we have Twilio
    let smsSent = false, smsError = null;
    const pretty = (iso) => {
      // quick pretty formatter "Sat Nov 1 @ 5:00 PM ET"
      const d = new Date(iso.replace(/([-+]\d\d:\d\d)$/,"Z")); // rough
      return d.toLocaleString("en-US", { weekday:"short", month:"short", day:"numeric", hour:"numeric", minute:"2-digit", hour12:true, timeZone:"America/New_York" }) + " ET";
    };

    if (twilio) {
      const whenText = pretty(dateTime);
      const { confirmUrl } = prep;
      const msg = (prep.available)
        ? `Executive Styles: tap to finish booking ${service_name} with ${preferred_barber} on ${whenText}. Sign in and confirm: ${confirmUrl}`
        : `Executive Styles: your requested time is full. Pick another time here (service & barber preselected): ${confirmUrl}`;
      try{
        await twilio.messages.create({
          from: process.env.TWILIO_FROM, to: customer_phone, body: msg
        });
        smsSent = true;
      }catch(err){ smsError = String(err); }
    }

    return res.json({
      ok: true,
      result: prep,          // available/alternatives/confirmUrl
      smsSent, smsError
    });

  }catch(err){
    return res.status(500).json({ ok:false, error: String(err) });
  }
});

// ONE listen only
const PORT = process.env.PORT || 10000;
app.listen(PORT, async ()=>{
  console.log("Booksy booker listening on", PORT);
  try { await getBrowser(); console.log("Playwright browser prewarmed"); } catch(e){ console.error("Prewarm failed:", e.message); }
});

// safety logging
process.on("unhandledRejection", e=>console.error("UNHANDLED",e));
process.on("uncaughtException", e=>console.error("UNCAUGHT",e));
