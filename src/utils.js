const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/** Known MD5 hashes of default placeholder images */
const DEFAULT_IMAGE_HASHES = new Set([
  "ff5c9c8126416466762f014ffabc1b2f", // defaultimages.jpg on 45.64.159.163
]);

/** Sleep utility */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Clean text by stripping HTML tags and unescaping entities */
function cleanText(str) {
  if (!str) return "";
  return str
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Check if an image URL or filename corresponds to the default placeholder image
 */
function isDefaultImage(imageUrl) {
  if (!imageUrl) return true;
  const lower = String(imageUrl).toLowerCase();
  return (
    lower.includes("defaultimages.jpg") ||
    lower.includes("defaultimages.jpeg") ||
    lower.includes("defaultimage") ||
    lower.includes("default_image") ||
    lower.includes("no_image") ||
    lower.includes("noimage") ||
    lower.includes("nophoto")
  );
}

/**
 * Safely read a JSON file (handles missing file, empty file, or unclosed brackets)
 */
function readJsonSafe(filePath, defaultValue = []) {
  if (!fs.existsSync(filePath)) return defaultValue;
  try {
    let content = fs.readFileSync(filePath, "utf8").trim();
    if (!content) return defaultValue;
    if (Array.isArray(defaultValue) && !content.endsWith("]")) {
      content += "\n]";
    }
    return JSON.parse(content);
  } catch (err) {
    console.warn(`[Warning] Could not parse ${filePath}: ${err.message}`);
    return defaultValue;
  }
}

/**
 * O(1) Fast append to a JSON array file.
 * Keeps the file as a 100% valid JSON array at all times so it can be inspected
 * or resumed safely even if interrupted mid-process.
 */
function appendRecordFast(filePath, record) {
  const line = "  " + JSON.stringify(record);

  // If file doesn't exist or is empty, initialize array
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
    fs.writeFileSync(filePath, "[\n" + line + "\n]\n", "utf8");
    return;
  }

  const stat = fs.statSync(filePath);
  const fd = fs.openSync(filePath, "r+");

  try {
    // Read the last up to 64 bytes to locate the closing bracket ']'
    const readLen = Math.min(stat.size, 64);
    const buf = Buffer.alloc(readLen);
    fs.readSync(fd, buf, 0, readLen, stat.size - readLen);
    const str = buf.toString("utf8");
    const lastBracketIndex = str.lastIndexOf("]");

    if (lastBracketIndex !== -1) {
      const bracketPos = stat.size - readLen + lastBracketIndex;
      fs.ftruncateSync(fd, bracketPos);
      const appendStr = ",\n" + line + "\n]\n";
      fs.writeSync(
        fd,
        Buffer.from(appendStr, "utf8"),
        0,
        Buffer.byteLength(appendStr),
        bracketPos
      );
    } else {
      // Fallback
      fs.appendFileSync(filePath, ",\n" + line + "\n]\n", "utf8");
    }
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Download a photo from a URL and save it to destPath.
 * Automatically skips default placeholder images (defaultimages.jpg).
 * Returns true on success, false on failure or if skipped.
 */
async function downloadPhoto(photoUrl, destPath) {
  if (!photoUrl || isDefaultImage(photoUrl)) {
    return false;
  }

  // If already downloaded, check that it is not a previously saved default image
  if (fs.existsSync(destPath) && fs.statSync(destPath).size > 0) {
    const existingBuf = fs.readFileSync(destPath);
    const existingHash = crypto
      .createHash("md5")
      .update(existingBuf)
      .digest("hex");
    if (DEFAULT_IMAGE_HASHES.has(existingHash)) {
      try {
        fs.unlinkSync(destPath);
      } catch {}
      return false;
    }
    return true;
  }

  try {
    const parentDir = path.dirname(destPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    const response = await fetch(photoUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Referer: "http://45.64.159.163/uppolice/login/hc/detail.php",
      },
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      return false;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Verify it's not an empty response
    if (buffer.length < 100) {
      return false;
    }

    // Check if binary payload matches the default placeholder image hash
    const hash = crypto.createHash("md5").update(buffer).digest("hex");
    if (DEFAULT_IMAGE_HASHES.has(hash)) {
      return false;
    }

    fs.writeFileSync(destPath, buffer);
    return true;
  } catch (err) {
    return false;
  }
}

module.exports = {
  sleep,
  cleanText,
  isDefaultImage,
  readJsonSafe,
  appendRecordFast,
  downloadPhoto,
};
