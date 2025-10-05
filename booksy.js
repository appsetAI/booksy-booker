// booksy.js
import { chromium } from "playwright";

/* ---------- Reuse one browser ---------- */
let browserPromise = null;
export async function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      timeout: 300000,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--no-zygote"]
    });
  }
  return browserPromise;
}

/* ---------- Helpers ---------- */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ci = (s) => `contains(translate(normalize-space(.),
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),
  '${s.toLowerCase().replace(/'/g,"\\'")}')`;

function toParts(dateTimeET) {
  // "2025-11-01T17:00:00-04:00" -> {date:"2025-11-01", timeLabel:"5:00 PM"}
  const date = dateTimeET.slice(0,10);
  const HH = Number(dateTimeET.slice(11,13));
  const mm = dateTimeET.slice(14,16);
  const ampm = HH >= 12 ? "PM" : "AM";
  const h12 = ((HH + 11) % 12) + 1;
  return { date, timeLabel: `${h12}:${mm} ${ampm}` };
}
function offsetFor(d) {
  // EDT -04:00 2025-03-09..2025-11-01, else EST -05:00
  return (d >= "2025-03-09" && d <= "2025-11-01") ? "-04:00" : "-05:00";
}
function ariaDateLabel(iso) {
  const [y,m,d] = iso.split("-").map(n=>parseInt(n,10));
  const dt = new Date(Date.UTC(y,m-1,d));
  const wd = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][dt.getUTCDay()];
  const mo = ["January","February","March","April","May","June","July","August","September","October","November","December"][m-1];
  return `${wd}, ${mo} ${d}, ${y}`;
}
async function dismissOverlays(page){
  for (const re of [/accept/i,/agree/i,/allow/i,/ok/i,/close/i,/got it/i]){
    const b = page.getByRole("button",{name:re}).first();
    if (await b.count()) { try { await b.click({timeout:700}); } catch{} }
  }
}

/* ---------- Core: prepare booking page & fetch alternatives ---------- */
export async function prepareOnBooksy({
  pageUrl, service_name, preferred_barber, dateTime
}) {
  const browser = await getBrowser();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.setDefaultTimeout(45000);
  page.setDefaultNavigationTimeout(45000);

  try {
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("networkidle").catch(()=>{});
    await dismissOverlays(page);

    // trigger lazy sections
    for (let i=0;i<8;i++){ await page.mouse.wheel(0,1200); await sleep(180); }

    // 1) Click the Book button for the chosen barber+service (or service anywhere)
    let clicked = false;
    if (preferred_barber && preferred_barber.toLowerCase() !== "no preference"){
      const section = page.locator(
        `xpath=//*[self::h2 or self::h3 or self::h4][${ci(preferred_barber)}]/ancestor::section[1]`
      ).first();
      if (await section.count()){
        const svc = section.locator(
          `xpath=.//h4[normalize-space(.)='${service_name}'] | .//*[self::h4 or self::h5][${ci(service_name)}]`
        ).first();
        if (await svc.count()){
          const bookBtn = section.locator(`xpath=.//button[${ci("book")}]`).first();
          await bookBtn.click(); clicked = true;
        }
      }
    }
    if (!clicked){
      const svc = page.locator(
        `xpath=//h4[normalize-space(.)='${service_name}'] | //*[self::h4 or self::h5][${ci(service_name)}]`
      ).first();
      if (!(await svc.count())){
        await ctx.close();
        return { available:false, reason:"not_found_service_or_barber" };
      }
      const bookBtn = svc.locator(
        `xpath=ancestor::*[self::article or self::div][.//button[${ci("book")}]][1]//button[${ci("book")}]`
      ).first();
      await bookBtn.click();
    }

    // 2) Land on time selection; pick the right calendar date
    const { date, timeLabel } = toParts(dateTime);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(300);

    const ariaBtn = page.getByRole("button",{ name: new RegExp(`^${ariaDateLabel(date)}$`, "i") }).first();
    if (await ariaBtn.count()){ try { await ariaBtn.click({timeout:2000}); } catch{} }
    else {
      const dayNum = String(Number(date.slice(8,10)));
      const dayBtn = page.getByRole("button",{ name: new RegExp(`^${dayNum}$`) }).first();
      if (await dayBtn.count()){ try { await dayBtn.click({timeout:2000}); } catch{} }
    }

    // capture deep URL (service/staff context)
    const confirmUrl = page.url();

    // 3) Check if exact time is visible; otherwise gather alternatives
    const exact = page.getByRole("button",{ name: new RegExp(`^${timeLabel}$`, "i") });
    if (await exact.count()){
      await ctx.close();
      return { available:true, requested: timeLabel, confirmUrl };
    }

    // harvest times (robust pass over all buttons)
    const timeRx = /^(?:0?[1-9]|1[0-2]):[0-5]\d\s?(?:AM|PM)$/i;
    const buttons = page.locator("button");
    const n = await buttons.count();
    const found = new Set();
    for (let i=0;i<n;i++){
      const t = (await buttons.nth(i).innerText().catch(()=> "")).trim();
      if (timeRx.test(t)) found.add(t.toUpperCase());
    }

    const alternatives = Array.from(found).slice(0,8);
    const alternativesISO = alternatives.map(label=>{
      const [hm, ampmRaw] = label.split(" ");
      const [hStr, mStr] = hm.split(":");
      let h = parseInt(hStr,10), m = parseInt(mStr,10);
      const ampm = (ampmRaw||"").toUpperCase();
      if (ampm==="PM" && h!==12) h += 12;
      if (ampm==="AM" && h===12) h = 0;
      const HH = String(h).padStart(2,"0");
      const MM = String(m).padStart(2,"0");
      return `${date}T${HH}:${MM}:00${offsetFor(date)}`;
    });

    await ctx.close();
    return { available:false, reason:"slot_unavailable", requested: timeLabel, alternatives, alternativesISO, confirmUrl };

  } catch (e) {
    await ctx.close();
    throw e;
  }
}
