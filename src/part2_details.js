const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");
const {
  sleep,
  isDefaultImage,
  readJsonSafe,
  appendRecordFast,
  downloadPhoto,
} = require("./utils");
const { parseDetailHtml } = require("./parser");

/** Build detail URL for a specific PNO */
function buildDetailUrl(pno) {
  return `http://45.64.159.163/uppolice/login/hc/detail.php?id=${encodeURIComponent(
    pno
  )}`;
}

/** Fetch HTML using direct HTTP request */
async function fetchHtmlDirect(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          Referer: "http://45.64.159.163/uppolice/login/hc/search3.php",
        },
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const text = await response.text();
      if (!text || text.length < 50) {
        throw new Error("Received empty or incomplete response");
      }
      return text;
    } catch (err) {
      if (attempt === retries) throw err;
      await sleep(2000 * attempt);
    }
  }
}

/**
 * Run Part 2: Fetch details, previous postings sub-JSON & photos for employees
 */
async function runPart2(options = {}) {
  const OS = (process.env.OS || "mac").toLowerCase().trim();
  const HEADLESS = process.env.HEADLESS === "true";
  const CHROME_PATH =
    OS === "windows"
      ? process.env.CHROME_PATH_WINDOWS ||
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
      : process.env.CHROME_PATH_MAC ||
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

  const fetchMode = (
    process.env.FETCH_MODE ||
    options.fetchMode ||
    "http"
  ).toLowerCase();

  const inputFile = path.resolve(
    options.inputFile || process.env.LIST_OUTPUT_FILE || "employees.json"
  );
  const outputFile = path.resolve(
    options.outputFile ||
      process.env.DETAILS_OUTPUT_FILE ||
      "employee_details.json"
  );
  const progressFile = path.resolve(
    options.progressFile || "details_progress.json"
  );
  const photoDir = path.resolve(
    options.photoDir || process.env.PHOTO_DIR || "employee_photos"
  );

  const delayMs = parseInt(process.env.DELAY_MS || options.delayMs || "1200", 10);
  const limit = parseInt(process.env.LIMIT || options.limit || "0", 10);
  const testPno = (process.env.TEST_PNO || options.testPno || "").trim();

  // Ensure photo directory exists
  if (!fs.existsSync(photoDir)) {
    fs.mkdirSync(photoDir, { recursive: true });
  }

  console.log("=================================================");
  console.log("🚀 STARTING PART 2: EMPLOYEE DETAILS & PHOTOS");
  console.log("=================================================");
  console.log(`[Mode] Fetch mode: ${fetchMode.toUpperCase()}`);
  console.log(`[Input] Employees list: ${inputFile}`);
  console.log(`[Output] Details file: ${outputFile}`);
  console.log(`[Output] Photo folder: ${photoDir}`);
  console.log(`[Filter] Default images (defaultimages.jpg) will be SKIPPED from saving`);
  console.log(`[Delay] ${delayMs}ms between requests\n`);

  // ── Step 1: Collect PNO list ────────────────────────────────────────────────
  let pnosToProcess = [];

  if (testPno) {
    console.log(`[Mode] Running in single TEST_PNO mode for: ${testPno}`);
    pnosToProcess = [{ personalNumber: testPno, employeeName: "Test Target" }];
  } else {
    if (!fs.existsSync(inputFile)) {
      console.error(
        `\n❌ Error: Input file '${inputFile}' not found!` +
          `\nPlease run Part 1 first (RUN_PART=1) to scrape the employee list,` +
          `\nor set TEST_PNO=112565187 in .env to test a single employee.\n`
      );
      process.exit(1);
    }

    const employees = readJsonSafe(inputFile, []);
    if (!employees || employees.length === 0) {
      console.error(
        `\n❌ Error: '${inputFile}' is empty. Run Part 1 first to collect employees.\n`
      );
      process.exit(1);
    }

    // Deduplicate by personalNumber
    const seen = new Set();
    for (const emp of employees) {
      const pno = (emp.personalNumber || "").trim();
      if (pno && !seen.has(pno)) {
        seen.add(pno);
        pnosToProcess.push(emp);
      }
    }

    console.log(
      `[Info] Loaded ${employees.length} records (${pnosToProcess.length} unique PNOs) from ${inputFile}`
    );
  }

  // Apply optional limit
  if (limit > 0 && pnosToProcess.length > limit) {
    console.log(`[Info] Applying LIMIT=${limit} records`);
    pnosToProcess = pnosToProcess.slice(0, limit);
  }

  // ── Step 2: Load completed PNOs for resume support ─────────────────────────
  const completedMap = {};
  if (fs.existsSync(progressFile)) {
    try {
      const saved = JSON.parse(fs.readFileSync(progressFile, "utf8"));
      if (saved.completedPnos && typeof saved.completedPnos === "object") {
        Object.assign(completedMap, saved.completedPnos);
      }
    } catch {}
  }

  // Also check already saved records in outputFile to avoid any duplicate
  if (fs.existsSync(outputFile)) {
    const existingDetails = readJsonSafe(outputFile, []);
    for (const d of existingDetails) {
      if (d.personalNumber) {
        completedMap[d.personalNumber] = true;
      }
    }
  }

  const alreadyDoneCount = Object.keys(completedMap).length;
  if (alreadyDoneCount > 0) {
    console.log(
      `[Resume] Found ${alreadyDoneCount} already completed employees. Skipping duplicates.\n`
    );
  }

  // Filter remaining queue
  const queue = pnosToProcess.filter(
    (item) => !completedMap[item.personalNumber]
  );
  console.log(`[Queue] ${queue.length} employees remaining to fetch.\n`);

  if (queue.length === 0) {
    console.log("✅ All employees have already been processed! Nothing to do.");
    return;
  }

  // ── Step 3: Initialize Browser if using Puppeteer mode ──────────────────────
  let browser = null;
  let page = null;

  if (fetchMode === "puppeteer") {
    console.log(`[Browser] Launching Chrome (${CHROME_PATH})...`);
    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: HEADLESS,
      defaultViewport: null,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });
    page = await browser.newPage();
  }

  // ── Step 4: Process Queue ──────────────────────────────────────────────────
  let processedCount = alreadyDoneCount;
  let successCount = 0;
  let failCount = 0;

  try {
    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];
      const pno = item.personalNumber;
      const targetUrl = buildDetailUrl(pno);
      processedCount++;

      const logPrefix = `[${processedCount}/${pnosToProcess.length}] PNO ${pno}`;

      try {
        let html = "";

        if (fetchMode === "puppeteer") {
          await page.goto(targetUrl, {
            waitUntil: "domcontentloaded",
            timeout: 60000,
          });
          html = await page.content();
        } else {
          // Direct HTTP fetch
          html = await fetchHtmlDirect(targetUrl);
        }

        // Parse HTML into structured data
        const details = parseDetailHtml(html, targetUrl, pno);

        // Ensure personalNumber is populated
        if (!details.personalNumber) {
          details.personalNumber = pno;
        }

        // ── Download Photo (Skip if default or null) ─────────────────────────
        let localPhotoFile = null;
        if (details.photoUrl && !isDefaultImage(details.photoUrl)) {
          try {
            // Determine file extension (default .jpeg)
            const extMatch = details.photoUrl.match(/\.(jpeg|jpg|png|gif)/i);
            const ext = extMatch ? extMatch[0].toLowerCase() : ".jpeg";
            const photoFileName = `${pno}${ext}`;
            const photoFilePath = path.join(photoDir, photoFileName);

            const downloaded = await downloadPhoto(
              details.photoUrl,
              photoFilePath
            );
            if (downloaded) {
              // Store relative path for clean portability
              localPhotoFile = path.relative(process.cwd(), photoFilePath);
            }
          } catch (imgErr) {
            console.warn(`  ⚠ Photo download warning for ${pno}: ${imgErr.message}`);
          }
        }

        // Attach local photo file path (null if skipped or unavailable)
        details.photoFile = localPhotoFile;

        // ── Save to JSON (All employee details + previous postings saved!) ────
        appendRecordFast(outputFile, details);

        // Update progress
        completedMap[pno] = true;
        fs.writeFileSync(
          progressFile,
          JSON.stringify(
            {
              lastProcessedPno: pno,
              totalCompleted: Object.keys(completedMap).length,
              completedPnos: completedMap,
              lastUpdated: new Date().toISOString(),
            },
            null,
            2
          )
        );

        const postingCount = (details.previousPostingDetails || []).length;
        const photoStatus = localPhotoFile
          ? "📷 photo saved"
          : (details.photoUrl ? "no photo" : "⏭️  default image skipped (not saved)");

        console.log(
          `✓ ${logPrefix} (${details.name || item.employeeName || "N/A"}) ` +
            `| Rank: ${details.rank || "N/A"} | Postings: ${postingCount} | ${photoStatus}`
        );

        successCount++;
      } catch (err) {
        failCount++;
        console.error(`✗ ${logPrefix} failed: ${err.message}`);
      }

      // Delay between requests
      if (delayMs > 0 && i < queue.length - 1) {
        await sleep(delayMs);
      }
    }

    console.log("\n=================================================");
    console.log("🎉 PART 2 COMPLETED!");
    console.log("=================================================");
    console.log(`✓ Total successful: ${successCount}`);
    console.log(`✗ Failed: ${failCount}`);
    console.log(`📄 Details JSON: ${outputFile}`);
    console.log(`🖼️  Photos folder: ${photoDir}`);
  } finally {
    if (browser) {
      await browser.close();
      console.log("[Browser closed]");
    }
  }
}

module.exports = { runPart2, buildDetailUrl };
