const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");
const { sleep, appendRecordFast, readJsonSafe } = require("./utils");

/** Build search URL for a given page number */
function buildSearchUrl(pageNo) {
  return (
    `http://45.64.159.163/uppolice/login/hc/search3.php?page=${pageNo}` +
    `&sname=&fatherName=&p_num=&join_year=&rank=&dist=&unit=` +
    `&thana=&txtDob=&txtDojoin=&txthomeDist=&gender=&badge_no=` +
    `&dateText=&dateText1=&previour=`
  );
}

/** Wait for data table rows */
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
      await sleep(5000);
      try {
        await page.reload({ waitUntil: "networkidle2", timeout: 120000 });
      } catch {}
    }
  }
  return false;
}

/** Detect total pagination pages */
async function detectTotalPages(page) {
  return page.evaluate(() => {
    const links = Array.from(document.querySelectorAll("a[href*='page=']"));
    const nums = links
      .map((a) => {
        const m = a.href.match(/page=(\d+)/);
        return m ? parseInt(m[1], 10) : 0;
      })
      .filter((n) => n > 0);

    if (nums.length > 0) return Math.max(...nums);

    const text = document.body.innerText;
    const m = text.match(/कुल\s*([\d,]+)\s*परिणाम/);
    if (m) {
      const total = parseInt(m[1].replace(/,/g, ""), 10);
      return Math.ceil(total / 20);
    }

    return null;
  });
}

/** Extract employees from current search page */
async function extractEmployees(page) {
  return page.evaluate(() => {
    const rows = document.querySelectorAll("table.ftbl tr");
    const data = [];

    rows.forEach((row, index) => {
      if (index === 0) return; // skip header

      const cols = row.querySelectorAll("td");
      if (cols.length >= 8) {
        const pnCell = cols[0]?.innerText?.trim() || "";
        const pnLines = pnCell
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);
        const pn = pnLines[0] || "";
        const statusNote = pnLines.slice(1).join(" ") || "";

        data.push({
          personalNumber: pn,
          statusNote: statusNote,
          employeeName: cols[1]?.querySelector("a")?.innerText?.trim() || "",
          fatherName:
            cols[1]?.innerText
              ?.split("\n")
              ?.pop()
              ?.replace(/[()]/g, "")
              ?.trim() || "",
          dob: cols[2]?.innerText?.trim() || "",
          recruitmentDate: cols[3]?.innerText?.trim() || "",
          rank: cols[4]?.innerText?.trim() || "",
          presentUnit: cols[5]?.innerText?.trim() || "",
          subUnit: cols[6]?.innerText?.trim() || "",
          homeDistrict: cols[7]?.innerText?.trim() || "",
        });
      }
    });

    return data;
  });
}

/** Run Part 1: Scrape search list -> employees.json */
async function runPart1(options = {}) {
  const OS = (process.env.OS || "mac").toLowerCase().trim();
  const HEADLESS = process.env.HEADLESS === "true";
  const CHROME_PATH =
    OS === "windows"
      ? process.env.CHROME_PATH_WINDOWS ||
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
      : process.env.CHROME_PATH_MAC ||
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

  const outputFile = path.resolve(
    options.outputFile || process.env.LIST_OUTPUT_FILE || "employees.json"
  );
  const progressFile = path.resolve(
    options.progressFile || "progress.json"
  );

  console.log("=================================================");
  console.log("🚀 STARTING PART 1: EMPLOYEE SEARCH LIST SCRAPER");
  console.log("=================================================");
  console.log(`[Config] OS=${OS} | headless=${HEADLESS}`);
  console.log(`[Config] Chrome → ${CHROME_PATH}`);
  console.log(`[Output] ${outputFile}`);
  console.log(`[Progress] ${progressFile}\n`);

  // Load progress
  let progress = { lastPage: 0, totalSaved: 0 };
  if (fs.existsSync(progressFile)) {
    try {
      progress = JSON.parse(fs.readFileSync(progressFile, "utf8"));
    } catch {}
  }

  let { lastPage, totalSaved } = progress;
  const startPage = lastPage + 1;
  if (lastPage > 0) {
    console.log(
      `▶ Resuming Part 1 from page ${startPage} (${totalSaved} employees already saved)\n`
    );
  }

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: HEADLESS,
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
    console.log(`[Step 1] Loading page ${startPage} to detect total pages...`);
    await page.goto(buildSearchUrl(startPage), {
      waitUntil: "networkidle2",
      timeout: 120000,
    });

    let totalPages = await detectTotalPages(page);
    if (!totalPages) {
      console.warn("⚠ Could not auto-detect total pages — defaulting to 18987");
      totalPages = 18987;
    }

    console.log(`[Info] Total pages: ${totalPages}`);
    console.log(`[Info] Scraping pages ${startPage} → ${totalPages}\n`);

    for (let i = startPage; i <= totalPages; i++) {
      try {
        if (i !== startPage) {
          await page.goto(buildSearchUrl(i), {
            waitUntil: "networkidle2",
            timeout: 120000,
          });
        }

        const tableLoaded = await waitForTable(page, i);
        if (!tableLoaded) {
          console.error(`✗ Page ${i}: table never loaded — skipping`);
          continue;
        }

        const employees = await extractEmployees(page);
        if (employees.length === 0) {
          console.warn(`  ⚠ Page ${i}: 0 employees found — skipping`);
          continue;
        }

        // Save each employee safely
        for (const emp of employees) {
          appendRecordFast(outputFile, emp);
        }

        totalSaved += employees.length;
        fs.writeFileSync(
          progressFile,
          JSON.stringify({ lastPage: i, totalSaved }, null, 2)
        );

        console.log(
          `✓ Page ${i}/${totalPages} — saved ${employees.length} rows (total: ${totalSaved})`
        );

        await sleep(2000);
      } catch (err) {
        console.error(`✗ Page ${i} error: ${err.message}`);
        continue;
      }
    }

    console.log(`\n✅ Part 1 complete! Total saved: ${totalSaved}`);
    console.log(`   Output file: ${outputFile}`);
  } finally {
    await browser.close();
    console.log("[Browser closed]");
  }
}

module.exports = { runPart1 };

