const { cleanText, isDefaultImage } = require("./utils");

/**
 * Extract field value by matching label inside <strong>
 */
function parseField(html, labelPattern) {
  const re = new RegExp(
    "<td[^>]*>\\s*<strong>\\s*" +
      labelPattern +
      "\\s*<\\/strong>\\s*<\\/td>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>",
    "i"
  );
  const match = html.match(re);
  return match ? cleanText(match[1]) : "";
}

/**
 * Parse the full HTML of detail.php?id=<PNO>
 *
 * @param {string} rawHtml - The raw HTML response string
 * @param {string} pageUrl - The URL of the detail page (used to resolve relative links)
 * @param {string} defaultPno - Fallback PNO from search list if not found in HTML
 * @returns {object} Structured employee details object
 */
function parseDetailHtml(
  rawHtml,
  pageUrl = "http://45.64.159.163/uppolice/login/hc/detail.php",
  defaultPno = ""
) {
  // Strip comments first to prevent matching commented-out elements
  const html = (rawHtml || "").replace(/<!--[\s\S]*?-->/g, "");

  // ── 1. Photo URL (Skip default images like defaultimages.jpg) ──────────────
  let photoUrl = null;
  const imgMatches = html.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi) || [];
  for (const tag of imgMatches) {
    const srcMatch = tag.match(/src=["']([^"']+)["']/i);
    if (
      srcMatch &&
      (srcMatch[1].includes("emp_image") ||
        srcMatch[1].includes("praroop") ||
        srcMatch[1].match(/\.(jpeg|jpg|png|gif)/i)) &&
      !srcMatch[1].includes("print.gif")
    ) {
      const candidate = srcMatch[1];
      // If it is the default placeholder image, treat as no photo
      if (!isDefaultImage(candidate)) {
        try {
          photoUrl = new URL(candidate, pageUrl).href;
        } catch {
          photoUrl = candidate;
        }
      }
      break;
    }
  }

  // ── 2. Personnel Details ───────────────────────────────────────────────────
  const pno =
    parseField(html, "Personnel No\\s*\\(P\\.No\\.\\)") ||
    parseField(html, "Personnel No") ||
    defaultPno;

  const name =
    parseField(html, "Name of Police Official") ||
    parseField(html, "Name");

  const rank =
    parseField(html, "Designation\\s*\\/\\s*Rank") ||
    parseField(html, "Designation") ||
    parseField(html, "Rank");

  const fatherOrSpouseName =
    parseField(html, "Father['’]s\\/Spouse Name") ||
    parseField(html, "Father Name") ||
    parseField(html, "Father['’]s Name");

  const homeDistrict =
    parseField(html, "Home District") ||
    parseField(html, "Home Place");

  const dob =
    parseField(html, "Date of Birth") ||
    parseField(html, "DOB");

  // ── 3. Service Details ─────────────────────────────────────────────────────
  const serviceDetails = {
    range: parseField(html, "Range"),
    district: parseField(html, "District"),
    unit: parseField(html, "Unit"),
    subUnit: parseField(html, "Sub Unit"),
    dateOfJoining: parseField(html, "Date of Joining"),
    joiningDateOnPresentRank: parseField(html, "Joining Date On Present Rank"),
    categoryOfRecruitment: parseField(html, "Category of Recruitment"),
    mobile: parseField(html, "Mobile"),
  };

  const marks = parseField(html, "Marks Obtained at Present Rank");
  if (marks) serviceDetails.marksObtainedAtPresentRank = marks;

  const totalMarks = parseField(html, "Total Marks");
  if (totalMarks) serviceDetails.totalMarks = totalMarks;

  // ── 4. Previous Posting Details (Sub-JSON format) ──────────────────────────
  const previousPostings = [];
  const postingSection = html.match(
    /Previous Posting Details[\s\S]*?<table[^>]*>([\s\S]*?)<\/table>/i
  );

  if (postingSection) {
    const tableHtml = postingSection[1];
    const rowMatches = tableHtml.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];

    for (const rowHtml of rowMatches) {
      // Skip table header
      if (
        rowHtml.includes("Posting From") ||
        rowHtml.includes("S. No.") ||
        rowHtml.includes("<strong>S. No.</strong>")
      ) {
        continue;
      }

      const cols = (rowHtml.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || []).map(
        cleanText
      );

      // Check if valid row with S. No. as a number
      if (cols.length >= 7 && cols[0] && /^\d+$/.test(cols[0])) {
        previousPostings.push({
          sNo: parseInt(cols[0], 10),
          postingFrom: cols[1] || "",
          postingTo: cols[2] === "--" ? "" : cols[2] || "",
          distt: cols[3] || "",
          unit: cols[4] || "",
          subUnit: cols[5] || "",
          rank: cols[6] || "",
        });
      }
    }
  }

  return {
    personalNumber: pno,
    name: name,
    rank: rank,
    fatherOrSpouseName: fatherOrSpouseName,
    homeDistrict: homeDistrict,
    dob: dob,
    photoUrl: photoUrl,
    serviceDetails: serviceDetails,
    previousPostingDetails: previousPostings,
  };
}

module.exports = {
  parseDetailHtml,
  parseField,
};
