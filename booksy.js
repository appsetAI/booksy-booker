// booksy.js
import { chromium } from "playwright";

/* ---------- Browser bootstrap (reuse one Chromium) ---------- */
let browserPromise = null;
export async function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      timeout: 300000, // up to 5 min for cold boot
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-zygote"
      ]
    });
  }
  return browserPromise;
}

/* ---------------------- Small utilities --------------------- */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// case-insensitive contains for XPath
const ci = (s) => `contains(translate(normalize-space(.),
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'),
  '${s.toLowerCase().replace(/'/g, "\\'")}')`;

// Convert ET ISO (e.g. "2025-11-01T17:00:00-04:00") to parts + "h:mm AM/PM" label
function toBooksyTime(dateTimeET) {
  const date = dateTimeET.slice(0,10);
  const HH = Number(dateTimeET.slice(11,13));
  const mm = dateTimeET.slice(14,16);
  const ampm = HH >= 12 ? "PM" : "AM";
  const h12 = ((HH + 11) % 12) + 1;
  return { date, timeLabel: `${h12}:${mm} ${ampm}` };
}

// Correct 2025 ET offset for a given YYYY-MM-DD (no calendar-day shifting)
function offsetFor(d) {
  // EDT -04:00 from 2025-03-09 through 2025-11-01 inclusive; else EST -05:00
  if (d >= "2025-03-09" && d <= "2025-11-01") return "-04:00";
  return "-05:00";
}

// Build an aria-label like "Saturday, November 1, 2025" to match date pickers
function ariaDateLabel(iso) {
  const [y,m,d] = iso.split("-").map(n=>parseInt(n,10));
  const dt = new Date(Date.UTC(y, m-1, d)); // weekday; local not required
  const weekdays = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  return `${weekdays[dt.getUTCDay()]}, ${months[m-1]} ${d}, ${y}`;
}

async function dismissOverlays(page) {
  // Cookie/consent banners vary; try common accept/close buttons quickly
  const buttons = [/accept/i, /agree/i, /allow/i, /got it/i, /^ok$/i, /close/i];
  for (const re of buttons) {
    const b = page.getByRole("button", { name: re }).first();
    if (await b.count()) {
      try { await b.click({ timeout: 750 }); } catch {}
    }
  }
}

/* ---------------------- Core booker logic ------------------- */
export async function bookOnBooksy({
  pageUrl,
  customer_name,
  customer_phone,
  service_name,
  preferred_barber,
  dateTime
}) {
  const browser = await getBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  page.setDefaultNavigationTimeout(45000);

  try {
    /* 1) Open page & prep */
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("networkidle").catch(()=>{});
    await dismissOverlays(page);

    // Lazy-load sections: scroll down a bit
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 1200); await sleep(200); }

    /* 2) Find the right service (under barber section if specified) */
    let clickedBook = false;

    if (preferred_barber && preferred_barber.toLowerCase() !== "no preference") {
      const staffSection = page.locator(
        `xpath=//*[self::h2 or self::h3 or self::h4][${ci(preferred_barber)}]/ancestor::section[1]`
      ).first();

      if (await staffSection.count()) {
        try { await staffSection.scrollIntoViewIfNeeded({ timeout: 2500 }); } catch {}
        const svcHeading = staffSection.locator(
          `xpath=.//h4[normalize-space(.)='${service_name}'] | .//*[self::h4 or self::h5][${ci(service_name)}]`
        ).first();

        if (await svcHeading.count()) {
          try { await svcHeading.scrollIntoViewIfNeeded({ timeout: 2500 }); } catch {}
          // Click the BOOK button within the same card/container
          const bookBtn = staffSection.locator(
            `xpath=.//button[${ci("book")}]`
          ).first();
          await bookBtn.click();
          clickedBook = true;
        }
      }
    }

    // Fallback: find the service anywhere on the page
    if (!clickedBook) {
      const anySvc = page.locator(
        `xpath=//h4[normalize-space(.)='${service_name}'] | //*[self::h4 or self::h5][${ci(service_name)}]`
      ).first();
      if (!(await anySvc.count())) {
        await context.close();
        return { booked:false, reason:"not_found_service_or_barber",
                 details:`Could not find service "${service_name}" (barber: "${preferred_barber}")` };
      }
      try { await anySvc.scrollIntoViewIfNeeded({ timeout: 2500 }); } catch {}
      const serviceCardBook = anySvc.locator(
        `xpath=ancestor::*[self::article or self::div][.//button[${ci("book")}]][1]//button[${ci("book")}]`
      ).first();
      await serviceCardBook.click();
    }

    /* 3) Pick date & time */
    const { date, timeLabel } = toBooksyTime(dateTime);
    const ariaLabel = ariaDateLabel(date);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(400);

    // Try specific aria-label (best) then day number (fallback)
    let datePicked = false;
    const ariaBtn = page.getByRole("button", { name: new RegExp(`^${ariaLabel}$`, "i") }).first();
    if (await ariaBtn.count()) {
      try { await ariaBtn.click({ timeout: 2000 }); datePicked = true; } catch {}
    }
    if (!datePicked) {
      const dayNum = String(Number(date.slice(8,10)));
      const dayBtn = page.getByRole("button", { name: new RegExp(`^${dayNum}$`) }).first();
      if (await dayBtn.count()) {
        try { await dayBtn.click({ timeout: 2000 }); datePicked = true; } catch {}
      }
    }

    // Try exact requested time first
    const exact = page.getByRole("button", { name: new RegExp(`^${timeLabel}$`, "i") });
    const hasExact = await exact.count().then(c => c > 0);
    if (!hasExact) {
      // Harvest visible time buttons robustly
      const timeBtnRegex = /^(?:0?[1-9]|1[0-2]):[0-5]\d\s?(?:AM|PM)$/i;
      const labels = new Set();

      // Primary pass: scan all buttons
      const allButtons = page.locator("button");
      const n = await allButtons.count();
      for (let i = 0; i < n; i++) {
        const txt = (await allButtons.nth(i).innerText().catch(() => "")).trim();
        if (timeBtnRegex.test(txt)) labels.add(txt.toUpperCase());
      }

      // Secondary pass: scan likely containers
      if (labels.size === 0) {
        const containers = [
          '[data-testid*="times"]', '[data-test*="times"]',
          '[aria-label*="Available"]', 'section:has(button)'
        ];
        for (const sel of containers) {
          const btns = page.locator(`${sel} button`);
          const m = await btns.count();
          for (let i = 0; i < m; i++) {
            const t = (await btns.nth(i).innerText().catch(() => "")).trim();
            if (timeBtnRegex.test(t)) labels.add(t.toUpperCase());
          }
        }
      }

      // Convert labels to ISO strings on the same calendar date (ET with correct offset)
      const altText = Array.from(labels);
      const alternativesText = altText.slice(0, 8);
      const alternativesISO = alternativesText.map(label => {
        // "h:mm AM/PM" -> "YYYY-MM-DDTHH:mm:00±offset"
        const parts = label.split(" ");
        const [hStr, mStr] = (parts[0] || "").split(":");
        let h = parseInt(hStr, 10), m = parseInt(mStr, 10);
        const ampm = (parts[1] || "").toUpperCase();
        if (ampm === "PM" && h !== 12) h += 12;
        if (ampm === "AM" && h === 12) h = 0;
        const HH = String(h).padStart(2, "0");
        const MM = String(m).padStart(2, "0");
        return `${date}T${HH}:${MM}:00${offsetFor(date)}`;
      });

      await context.close();
      return {
        booked: false,
        reason: "slot_unavailable",
        requested: timeLabel,
        alternatives: alternativesText,  // human-readable
        alternativesISO                  // ISO to rebook immediately
      };
    }

    await exact.first().click();

    /* 4) Client details */
    const nameField = page.getByLabel(/name/i).first();
    if (await nameField.count()) await nameField.fill(customer_name);
    const phoneField = page.locator('input[type="tel"], input[name*="phone"]').first();
    if (await phoneField.count()) await phoneField.fill(customer_phone);

    // Confirm: try "Confirm" then "Book" then "Continue"
    const tryClick = async (re) => {
      const btn = page.getByRole("button", { name: re }).first();
      if (await btn.count()) { try { await btn.click({ timeout: 2000 }); return true; } catch {} }
      return false;
    };
    if (!(await tryClick(/confirm/i))) {
      if (!(await tryClick(/book/i))) { await tryClick(/continue/i); }
    }

    // Wait for any success indicator
    await page.waitForSelector(/confirmed|appointment created|success|thank you/i, { timeout: 15000 }).catch(()=>{});
    await context.close();
    return { booked: true };

  } catch (err) {
    try { console.error("Booksy error:", await page.title()); } catch {}
    await context.close();
    throw err;
  }
}
