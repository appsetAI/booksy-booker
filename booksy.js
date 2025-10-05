import { chromium } from "playwright";

// helper: pause a bit
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// case-insensitive contains for XPath
const ci = (s) => `contains(translate(normalize-space(.),
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'),
  '${s.toLowerCase().replace(/'/g, "\\'")}')`;

function toBooksyTime(dateTimeET) {
  // "2025-11-01T17:00:00-04:00" -> { date:"2025-11-01", timeLabel:"5:00 PM" }
  const date = dateTimeET.slice(0,10);
  const HH = Number(dateTimeET.slice(11,13));
  const mm = dateTimeET.slice(14,16);
  const ampm = HH >= 12 ? "PM" : "AM";
  const h12 = ((HH + 11) % 12) + 1;
  return { date, timeLabel: `${h12}:${mm} ${ampm}` };
}

async function dismissOverlays(page) {
  // Cookie/consent banners vary; try a few common buttons
  const buttons = [
    /accept/i, /agree/i, /allow/i, /got it/i, /ok/i, /close/i,
  ];
  for (const re of buttons) {
    const b = page.getByRole('button', { name: re }).first();
    if (await b.count()) {
      try { await b.click({ timeout: 1000 }); } catch {}
    }
  }
}

export async function bookOnBooksy({
  pageUrl, customer_name, customer_phone, service_name, preferred_barber, dateTime
}) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36"
  });
  page.setDefaultTimeout(30000);

  try {
    await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(()=>{});
    await dismissOverlays(page);

    // Some Booksy pages lazy-load content. Gently scroll from top to bottom to force load.
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    for (let i = 0; i < 8; i++) {
      await page.mouse.wheel(0, 1200);
      await sleep(250);
    }

    // Try to find the staff section first (h2/h3/h4 with the barber name), then the service card inside
    let bookedFromSection = false;
    if (preferred_barber && preferred_barber.toLowerCase() !== "no preference") {
      const staffSection = page.locator(
        `xpath=//*[self::h2 or self::h3 or self::h4][${ci(preferred_barber)}]/ancestor::section[1]`
      ).first();

      if (await staffSection.count()) {
        // ensure visible
        try { await staffSection.scrollIntoViewIfNeeded({ timeout: 3000 }); } catch {}
        await sleep(200);

        const svcHeading = staffSection.locator(
          `xpath=.//h4[normalize-space(.)='${service_name}'] | .//*[self::h4 or self::h5][${ci(service_name)}]`
        ).first();

        if (await svcHeading.count()) {
          try { await svcHeading.scrollIntoViewIfNeeded({ timeout: 3000 }); } catch {}
          const bookBtn = staffSection.getByRole('button', { name: /book/i }).first();
          await bookBtn.click();
          bookedFromSection = true;
        }
      }
    }

    // Fallback: find the service anywhere on the page and click its nearest Book button
    if (!bookedFromSection) {
      const anySvc = page.locator(
        `xpath=//h4[normalize-space(.)='${service_name}'] | //*[self::h4 or self::h5][${ci(service_name)}]`
      ).first();
      if (!(await anySvc.count())) {
        await browser.close();
        return { booked:false, reason:"not_found_service_or_barber",
                 details:`Could not find service "${service_name}" (barber: "${preferred_barber}")` };
      }
      try { await anySvc.scrollIntoViewIfNeeded({ timeout: 3000 }); } catch {}
      // A Book button near the service heading (search up to the card)
      const serviceCardBook = anySvc.locator(
        `xpath=ancestor::*[self::article or self::div][.//button[contains(., 'Book')]][1]//button[contains(., 'Book')]`
      ).first();
      await serviceCardBook.click();
    }

    // === PICK DATE & TIME ===
    const { date, timeLabel } = toBooksyTime(dateTime);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(400);

    // Click the calendar day if it exists (some flows auto-select day)
    const dayNum = String(Number(date.slice(8,10)));
    const dayBtn = page.getByRole("button", { name: new RegExp(`^${dayNum}$`) });
    if (await dayBtn.count()) { try { await dayBtn.first().click({ timeout: 2000 }); } catch {} }

    // Try exact time
    const exact = page.getByRole("button", { name: new RegExp(`^${timeLabel}$`, "i") });
    const hasExact = await exact.count().then(c => c > 0);
    if (!hasExact) {
      // collect visible time options
      const altSlots = await page.locator('button:has-text("AM"), button:has-text("PM")').allInnerTexts().catch(()=>[]);
      await browser.close();
      return {
        booked:false, reason:"slot_unavailable", requested: timeLabel,
        alternatives: (altSlots || []).filter(Boolean).slice(0,6)
      };
    }
    await exact.first().click();

    // === CLIENT DETAILS ===
    // name
    const nameField = page.getByLabel(/name/i).first();
    if (await nameField.count()) await nameField.fill(customer_name);
    // phone
    const phoneField = page.locator('input[type="tel"], input[name*="phone"]').first();
    if (await phoneField.count()) await phoneField.fill(customer_phone);

    // confirm
    const confirmBtn = page.getByRole("button", { name: /confirm|book/i }).first();
    await confirmBtn.click();

    // wait for success message
    await page.waitForSelector(/confirmed|appointment created|success/i, { timeout: 15000 }).catch(()=>{});
    await browser.close();
    return { booked:true };

  } catch (err) {
    // try to leave a breadcrumb for debugging
    try {
      const title = await page.title();
      console.error('Booksy error on page title:', title);
    } catch {}
    await browser.close();
    throw err;
  }
}
