import { chromium } from "playwright";

function toBooksyTime(dateTimeET) {
  // "2025-11-01T17:00:00-04:00" -> { date:"2025-11-01", timeLabel:"5:00 PM" }
  const date = dateTimeET.slice(0,10);
  const HH = Number(dateTimeET.slice(11,13));
  const mm = dateTimeET.slice(14,16);
  const ampm = HH >= 12 ? "PM" : "AM";
  const h12 = ((HH + 11) % 12) + 1;
  return { date, timeLabel: `${h12}:${mm} ${ampm}` };
}

export async function bookOnBooksy({ pageUrl, customer_name, customer_phone, service_name, preferred_barber, dateTime }) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36"
  });

  try {
    await page.goto(pageUrl, { waitUntil: "domcontentloaded" });

    // 1) Find the staff section by exact name
    await page.locator("h3", { hasText: preferred_barber }).first().scrollIntoViewIfNeeded();
    const staffSection = page.locator("section").filter({ has: page.locator("h3", { hasText: preferred_barber }) });

    // 2) Click the desired service → Book
    await staffSection.getByRole("heading", { name: service_name, level: 4 }).first().scrollIntoViewIfNeeded();
    await staffSection.getByRole("button", { name: /book/i }).first().click();

    // 3) Pick date & time
    const { date, timeLabel } = toBooksyTime(dateTime);
    const dayNum = String(Number(date.slice(8,10)));
    await page.waitForLoadState("networkidle");

    // Click the calendar day if visible
    const dayBtn = page.getByRole("button", { name: new RegExp(`^${dayNum}$`) });
    if (await dayBtn.count()) await dayBtn.first().click().catch(()=>{});

    // Click time; if exact not visible, return alternatives
    const exact = page.getByRole("button", { name: new RegExp(`^${timeLabel}$`, "i") });
    const hasExact = await exact.count().then(c => c > 0);
    if (!hasExact) {
      const altSlots = await page.locator('button:has-text("AM"), button:has-text("PM")').allInnerTexts().catch(()=>[]);
      await browser.close();
      return { booked:false, reason:"slot_unavailable", requested: timeLabel, alternatives: altSlots.slice(0,6) };
    }
    await exact.first().click();

    // 4) Fill client details
    const nameField = page.getByLabel(/name/i).first();
    if (await nameField.count()) await nameField.fill(customer_name);
    const phoneField = page.locator('input[type="tel"], input[name*="phone"]').first();
    if (await phoneField.count()) await phoneField.fill(customer_phone);

    // 5) Confirm
    const confirmBtn = page.getByRole("button", { name: /confirm|book/i }).first();
    await confirmBtn.click();
    await page.waitForSelector(/confirmed|appointment created|success/i, { timeout: 15000 });

    await browser.close();
    return { booked:true };
  } catch (err) {
    await browser.close();
    throw err;
  }
}
