# UP Police Employee Data Scraper & Photo Archiver

This project provides a complete, robust two-part pipeline to scrape employee records from UP Police portal, parse detailed service information, store previous postings in a nested sub-JSON format, and download official photos saved by Personnel Number (PNO).

---

## 🚀 Key Features

1. **Two-Part Workflow**:
   - **Part 1**: Scrapes search result pages (`search3.php?page=...`) and compiles the master employee index into `employees.json`.
   - **Part 2**: Reads PNOs from `employees.json`, visits `detail.php?id=<PNO>`, extracts all personnel and service details, formats previous posting history as a nested sub-JSON array, downloads official photos into `employee_photos/<PNO>.jpeg`, and saves everything to `employee_details.json`.
2. **Execution Controller via `.env`**:
   - Easily select whether to run Part 1 (`RUN_PART=1`), Part 2 (`RUN_PART=2`), or both sequentially (`RUN_PART=all`).
3. **Dual Fetch Modes for Part 2**:
   - `FETCH_MODE=http`: Ultra-fast native HTTP requests without browser overhead.
   - `FETCH_MODE=puppeteer`: Full Chrome browser emulation for environments requiring browser sessions.
4. **Smart Default Photo Filtering**:
   - Detects placeholder/default images (`defaultimages.jpg`, `no_image`, etc.) via URL pattern and binary fingerprint.
   - Automatically skips downloading default images to save disk space and bandwidth.
   - For employees with default images, `photoFile: null` and `photoUrl: null` are recorded, while **all other information** (name, designation, service details, and previous posting history) remains fully preserved.
5. **Crash-Resilient & Resume Capability**:
   - Incremental JSON array writing keeps output files 100% valid at all times.
   - `progress.json` tracks Part 1 page numbers.
   - `details_progress.json` tracks processed PNOs in Part 2. If stopped, restarting resumes exactly where it left off without duplicate network requests or re-downloading existing photos.
5. **Single PNO Test Mode**:
   - Set `TEST_PNO=112565187` in `.env` to test an individual employee detail page instantly.

---

## 📁 Project Structure

```
emplooyeeData/
├── .env                     # Configuration (RUN_PART, paths, delay, modes)
├── package.json             # NPM scripts and dependencies
├── index.js                 # Master entry point executing Part 1 / Part 2
├── src/
│   ├── parser.js            # HTML parser for detail.php pages
│   ├── part1_search.js      # Part 1 search list scraper
│   ├── part2_details.js     # Part 2 detail scraper & photo downloader
│   └── utils.js             # Safe JSON streaming, photo downloader, helpers
├── test/
│   └── pipeline_test.js     # Automated test suite
├── employee_photos/         # Downloaded employee photos (<PNO>.jpeg)
├── employees.json           # Part 1 output (employee list with PNOs)
├── employee_details.json    # Part 2 output (comprehensive details + sub-JSON postings)
├── progress.json            # Part 1 progress tracking
└── details_progress.json    # Part 2 progress tracking
```

---

## ⚙️ Configuration (`.env`)

```env
# ─── Workflow Execution Controller ──────────────────────────────
# 1   = Run Part 1 only (scrape search list to employees.json)
# 2   = Run Part 2 only (fetch details & photos for PNOs)
# all = Run Part 1 first, then Part 2 sequentially
RUN_PART=2

# ─── Part 2 (Details & Photos) Configuration ─────────────────────
# "http" (ultra-fast) or "puppeteer" (Chrome browser)
FETCH_MODE=http

# Output directory for employee photos (named <PNO>.jpeg)
PHOTO_DIR=employee_photos

# JSON file storing full employee details and previous postings
DETAILS_OUTPUT_FILE=employee_details.json

# Delay between requests in milliseconds (rate limit / polite scraping)
DELAY_MS=1200

# Optional: Limit number of employees to fetch (0 or empty = all)
LIMIT=0

# Optional: Test a single PNO directly
TEST_PNO=

# ─── Browser Settings (for Puppeteer mode / Part 1) ─────────────
OS=mac
HEADLESS=false
CHROME_PATH_MAC=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
CHROME_PATH_WINDOWS=C:\Program Files\Google\Chrome\Application\chrome.exe
```

---

## 🏃 Usage

### 1. Run via Master Entry Point
```bash
# Uses the RUN_PART setting in .env
node index.js
```

### 2. Run via NPM Scripts
```bash
# Run Part 1 only:
npm run part1

# Run Part 2 only:
npm run part2

# Run both sequentially:
npm run all

# Run unit tests:
npm test
```

---

## 📊 Output Data Format (`employee_details.json`)

Each employee in `employee_details.json` contains full personal details, service details, photo file reference, and the previous postings formatted as a nested sub-JSON array:

```json
[
  {
    "personalNumber": "112565187",
    "name": "ABHISHEK SHARMA",
    "rank": "HC CP",
    "fatherOrSpouseName": "SANJEEV SHARMA",
    "homeDistrict": "AURAIYA",
    "dob": "10 Mar 1989",
    "photoUrl": "http://45.64.159.163/uppolice/login/praroop/emp_image/1403685650112565187.jpeg",
    "photoFile": "employee_photos/112565187.jpeg",
    "serviceDetails": {
      "range": "RANGE KANPUR",
      "district": "Kanpur Commissionerate",
      "unit": "Kanpur Commissionerate",
      "subUnit": "DIAL 100",
      "dateOfJoining": "26 Jan 2011",
      "joiningDateOnPresentRank": "20 Dec 2022",
      "categoryOfRecruitment": "Ranker",
      "mobile": "9452238625"
    },
    "previousPostingDetails": [
      {
        "sNo": 1,
        "postingFrom": "26 Jan 2011",
        "postingTo": "25 Dec 2011",
        "distt": "MAHOBA",
        "unit": "MAHOBA",
        "subUnit": "POLICE LINE",
        "rank": "CONST CP"
      },
      {
        "sNo": 2,
        "postingFrom": "26 Dec 2011",
        "postingTo": "24 Apr 2013",
        "distt": "JHANSI",
        "unit": "JHANSI",
        "subUnit": "POLICE LINE",
        "rank": "CONST CP"
      },
      {
        "sNo": 3,
        "postingFrom": "25 Apr 2013",
        "postingTo": "02 Aug 2014",
        "distt": "ETAWAH",
        "unit": "ETAWAH",
        "subUnit": "POLICE LINE",
        "rank": "CONST CP"
      },
      {
        "sNo": 4,
        "postingFrom": "02 Aug 2014",
        "postingTo": "",
        "distt": "Kanpur Commissionerate",
        "unit": "Kanpur Commissionerate",
        "subUnit": "DIAL 100",
        "rank": "CONST CP"
      }
    ]
  }
]
```

