require("dotenv").config();

const puppeteer = require("puppeteer-core");
const fs        = require("fs");
const path      = require("path");

// ─── Config from .env ────────────────────────────────────────────────────────
const OS       = (process.env.OS || "mac").toLowerCase().trim();
const HEADLESS = process.env.HEADLESS === "true";

const CHROME_PATH =
  OS === "windows"
    ? process.env.CHROME_PATH_WINDOWS ||
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : process.env.CHROME_PATH_MAC ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// Output / progress files
const OUTPUT_FILE   = path.resolve("employees.json");
const PROGRESS_FILE = path.resolve("progress.json");

console.log(`\n[Config] OS=${OS} | headless=${HEADLESS}`);
console.log(`[Config] Chrome → ${CHROME_PATH}`);
console.log(`[Output] ${OUTPUT_FILE}`);
console.log(`[Progress] ${PROGRESS_FILE}\n`);

// ─── Helpers ─────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Build the target URL for a given page number */
function buildUrl(pageNo) {
  return (
    `http://45.64.159.163/uppolice/login/hc/search3.php?page=${pageNo}` +
    `&sname=&fatherName=&p_num=&join_year=&rank=&dist=&unit=` +
    `&thana=&txtDob=&txtDojoin=&txthomeDist=&gender=&badge_no=` +
    `&dateText=&dateText1=&previour=`
  );
}

/**
 * Wait until the data table has at least 2 rows (header + 1 data row).
 * Retries up to maxRetries times, reloading between attempts.
 */
async function waitForTable(page, pageNo, maxRetries = 5) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await page.waitForFunction(
        () => document.querySelectorAll("table.ftbl tr").length > 1,
        { timeout: 20000 }
      );
      return true;
    } catch {
      console.warn(
        `  ⚠ Page ${pageNo}: table not ready — retry ${attempt}/${maxRetries}`
      );
      if (attempt === maxRetries) return false;
      await sleep(8000);
      await page.reload({ waitUntil: "networkidle2", timeout: 120000 });
    }
  }
  return false;
}

/**
 * Detect the total number of pages from the "Result Pages:" pagination block.
 * Fallback: parse "कुल X परिणाम" total count and divide by rows-per-page.
 */
async function detectTotalPages(page) {
  return page.evaluate(() => {
    // Strategy 1: find the highest page link in "Result Pages:" section
    const links = Array.from(document.querySelectorAll("a[href*='page=']"));
    const nums  = links
      .map((a) => {
        const m = a.href.match(/page=(\d+)/);
        return m ? parseInt(m[1], 10) : 0;
      })
      .filter((n) => n > 0);

    if (nums.length > 0) return Math.max(...nums);

    // Strategy 2: parse "कुल X परिणाम" total and assume ~20 rows/page
    const text = document.body.innerText;
    const m    = text.match(/कुल\s*([\d,]+)\s*परिणाम/);
    if (m) {
      const total = parseInt(m[1].replace(/,/g, ""), 10);
      return Math.ceil(total / 20);
    }

    return null; // unknown
  });
}

/**
 * Extract employee rows from the current page.
 */
async function extractEmployees(page) {
  return page.evaluate(() => {
    const rows = document.querySelectorAll("table.ftbl tr");
    const data = [];

    rows.forEach((row, index) => {
      if (index === 0) return; // skip header

      const cols = row.querySelectorAll("td");
      if (cols.length >= 8) {
        // personalNumber cell may contain a status note on a second line
        const pnCell    = cols[0]?.innerText?.trim() || "";
        const pnLines   = pnCell.split("\n").map((l) => l.trim()).filter(Boolean);
        const pn        = pnLines[0] || "";
        const statusNote = pnLines.slice(1).join(" ") || "";

        data.push({
          personalNumber:  pn,
          statusNote:      statusNote,
          employeeName:    cols[1]?.querySelector("a")?.innerText?.trim() || "",
          fatherName:      cols[1]?.innerText
                             ?.split("\n")
                             ?.pop()
                             ?.replace(/[()]/g, "")
                             ?.trim() || "",
          dob:             cols[2]?.innerText?.trim() || "",
          recruitmentDate: cols[3]?.innerText?.trim() || "",
          rank:            cols[4]?.innerText?.trim() || "",
          presentUnit:     cols[5]?.innerText?.trim() || "",
          subUnit:         cols[6]?.innerText?.trim() || "",
          homeDistrict:    cols[7]?.innerText?.trim() || "",
        });
      }
    });

    return data;
  });
}

// ─── Progress helpers ─────────────────────────────────────────────────────────

/** Load saved progress (last completed page + total count so far) */
function loadProgress() {
  if (fs.existsSync(PROGRESS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8"));
    } catch {
      /* ignore corrupt file */
    }
  }
  return { lastPage: 0, totalSaved: 0 };
}

/** Save progress after each page */
function saveProgress(lastPage, totalSaved) {
  fs.writeFileSync(
    PROGRESS_FILE,
    JSON.stringify({ lastPage, totalSaved }, null, 2)
  );
}

/**
 * Append employees to the JSON output file incrementally.
 * The file is kept as a valid JSON array by managing brackets manually.
 */
function appendToJsonFile(employees, isFirstWrite) {
  if (employees.length === 0) return;

  const lines = employees.map((e) => JSON.stringify(e));

  if (isFirstWrite) {
    // Start fresh file
    fs.writeFileSync(OUTPUT_FILE, "[\n" + lines.join(",\n"));
  } else {
    // Append to existing (file ends without closing bracket)
    fs.appendFileSync(OUTPUT_FILE, ",\n" + lines.join(",\n"));
  }
}

/** Close the JSON array bracket when all pages are done */
function closeJsonFile() {
  if (fs.existsSync(OUTPUT_FILE)) {
    fs.appendFileSync(OUTPUT_FILE, "\n]\n");
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function getEmployeeTable() {
  const progress = loadProgress();
  let { lastPage, totalSaved } = progress;
  const startPage = lastPage + 1;
  const isResuming = lastPage > 0;

  if (isResuming) {
    console.log(`\n▶ Resuming from page ${startPage} (${totalSaved} employees already saved)\n`);
  }

  // If resuming, the JSON file already exists without a closing bracket.
  // If starting fresh, we'll create a new file on first write.
  let isFirstWrite = !isResuming || !fs.existsSync(OUTPUT_FILE);

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless:        HEADLESS,
    defaultViewport: null,
    args: [
      "--start-maximized",
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

  const page = await browser.newPage();

  try {
    // ── Step 1: Load page 1 (or startPage) to detect total pages ─────────────
    console.log(`[Step 1] Loading page ${startPage} to detect total pages…`);

    await page.goto(buildUrl(startPage), {
      waitUntil: "networkidle2",
      timeout:   120000,
    });

    let totalPages = await detectTotalPages(page);

    if (!totalPages) {
      console.warn("⚠  Could not auto-detect total pages — defaulting to 18987");
      totalPages = 18987; // ceil(379740 / 20)
    }

    console.log(`[Info] Total pages detected: ${totalPages}`);
    console.log(`[Info] Scraping pages ${startPage} → ${totalPages}\n`);

    // ── Step 2: Iterate pages ─────────────────────────────────────────────────
    for (let i = startPage; i <= totalPages; i++) {

      try {
        // Navigate (skip if we're already on startPage from Step 1)
        if (i !== startPage) {
          await page.goto(buildUrl(i), {
            waitUntil: "networkidle2",
            timeout:   120000,
          });
        }

        // Wait for table to be fully loaded
        const tableLoaded = await waitForTable(page, i);

        if (!tableLoaded) {
          console.error(`✗ Page ${i}: table never loaded — skipping`);
          await page.screenshot({ path: `failed-page-${i}.png`, fullPage: true });
          continue;
        }

        // Extract data
        const employees = await extractEmployees(page);

        if (employees.length === 0) {
          console.warn(`  ⚠ Page ${i}: 0 employees found — skipping`);
          continue;
        }

        // ── Save incrementally ──────────────────────────────────────────────
        appendToJsonFile(employees, isFirstWrite);
        isFirstWrite = false;

        totalSaved += employees.length;
        saveProgress(i, totalSaved);

        console.log(
          `✓ Page ${i}/${totalPages} — saved ${employees.length} rows` +
          `  (cumulative: ${totalSaved})`
        );

        // Polite delay before next page
        await sleep(2500);

      } catch (err) {
        console.error(`✗ Page ${i} error: ${err.message}`);
        // Save progress up to previous page and continue
        continue;
      }
    }

    // ── Step 3: Close the JSON array ─────────────────────────────────────────
    closeJsonFile();

    // Clean up progress tracker on successful completion
    if (fs.existsSync(PROGRESS_FILE)) fs.unlinkSync(PROGRESS_FILE);

    console.log(`\n✅ All done! Total employees saved: ${totalSaved}`);
    console.log(`   Output: ${OUTPUT_FILE}`);

  } finally {
    await browser.close();
    console.log("\n[Browser closed]");
  }
}

getEmployeeTable().catch((err) => {
  console.error("\n[Fatal]", err.message);
  process.exit(1);
});