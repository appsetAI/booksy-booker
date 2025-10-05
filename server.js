import express from "express";
import { bookOnBooksy } from "./booksy.js";

const app = express();
app.use(express.json());

app.get("/healthz", (_, res) => res.json({ ok: true }));

app.post("/booksy/book", async (req, res) => {
  try {
    const { customer_name, customer_phone, service_name, preferred_barber, dateTime } = req.body;
    if (!customer_name || !customer_phone || !service_name || !preferred_barber || !dateTime) {
      return res.status(400).json({ ok:false, error:"Missing fields" });
    }
    const result = await bookOnBooksy({
      pageUrl: "https://booksy.com/en-ca/4124_executive-styles-hair-studio_barbershop_979936_maple",
      customer_name, customer_phone, service_name, preferred_barber, dateTime
    });
    return res.json({ ok:true, ...result });
  } catch (e) {
    return res.status(500).json({ ok:false, error:String(e) });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("Booksy booker listening on", PORT));
