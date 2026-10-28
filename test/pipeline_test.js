const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { parseDetailHtml } = require("../src/parser");
const {
  cleanText,
  readJsonSafe,
  appendRecordFast,
  isDefaultImage,
  downloadPhoto,
} = require("../src/utils");

const sampleHtml = `
<table cellspacing="0" cellpadding="0" border="1" align="center" width="100%" class="tble">
<tbody><tr>
<td width="27%" rowspan="6" >
<center>
<img border="1" width="100" height="120" src="../praroop/emp_image/1403685650112565187.jpeg"> </center>
</td>
<td width="37%" class="row1" style="border-top: 1px solid #B9B9B9;">
<strong>Personnel No(P.No.)</strong>
</td>
<td width="36%" class="row1" style="border-top: 1px solid #B9B9B9;">
<span id="lblCadreYear">112565187</span>
</td>
</tr>
<tr>
<td class="row2">
<strong>Name of Police Official </strong>
</td>
<td class="row2">
<span style="font-weight:bold;" id="lblOfficerName"> ABHISHEK SHARMA</span>
</td>
</tr>
<tr>
<td class="row1">
<strong>Designation / Rank</strong>
</td>
<td class="row1">
<span id="lblCadreYear">HC CP</span>
</td>
</tr>
<tr>
<td class="row2">
<strong>Father's/Spouse Name</strong>
</td>
<td class="row2">
<span style="font-weight:bold;" id="lblFatherName">SANJEEV SHARMA</span>
</td>
</tr>
<tr>
<td class="row1">
<strong>Home District</strong>
</td>
<td class="row1">
<span id="lblHomePlace">AURAIYA</span>
</td>
</tr>
<tr>
<td class="row2">
<strong>Date of Birth</strong>
</td>
<td class="row2">
<span id="lbldateofBirth">10 Mar 1989</span>
</td>
</tr>
</tbody></table>

<table width="100%" border="1" cellpadding="0" cellspacing="0" style="padding:10px; ">
<tr class="ftbl">
<td width="64%" height="34"><strong>Range</strong></td>
<td colspan="2">RANGE KANPUR</td>
</tr>
<tr bgcolor="#F5F5F5" class="ftbl">
<td height="30"><strong>District </strong></td>
<td colspan="2">Kanpur Commissionerate &nbsp;</td>
</tr>
<tr class="ftbl">
<td height="28"><strong>Unit</strong></td>
<td colspan="2">Kanpur Commissionerate</td>
</tr>
<tr bgcolor="#F5F5F5" class="ftbl">
<td height="32"><strong>Sub Unit</strong></td>
<td colspan="2">DIAL 100</td>
</tr>
<tr class="ftbl">
<td height="32"><strong>Date of Joining</strong></td>
<td colspan="2">26 Jan 2011</td>
</tr>
<tr class="ftbl" bgcolor="#F5F5F5">
<td height="32"><strong>Joining Date On Present Rank</strong></td>
<td colspan="2">20 Dec 2022</td>
</tr>
<tr class="ftbl">
<td height="32"><strong>Category of Recruitment</strong></td>
<td colspan="2">Ranker</td>
</tr>
<tr class="ftbl" bgcolor="#F5F5F5">
<td height="32"><strong>Mobile </strong></td>
<td colspan="2">9452238625&nbsp;</td>
</tr>
</table>

Previous Posting Details
<table width="100%" border="0" cellpadding="3" cellspacing="0">
<tr bgcolor="#DEDFF8" class="ftbl">
<td width="20" height="20"><strong>S. No. </strong></td>
<td width="96"><strong>Posting From </strong></td>
<td width="93"><strong>Posting To </strong></td>
<td width="153"><strong>Distt</strong></td>
<td width="138"><strong>Unit</strong></td>
<td width="138"><strong>Sub Unit</strong> </td>
<td width="99"><strong>Rank</strong></td>
</tr>
<tr >
<td class="row1">&nbsp;1</td>
<td class="row1">&nbsp; 26 Jan 2011 </td>
<td class="row1">&nbsp; 25 Dec 2011</td>
<td class="row1">MAHOBA</td>
<td class="row1">MAHOBA</td>
<td class="row1">POLICE LINE</td>
<td class="row1">CONST CP</td>
</tr>
<tr >
<td class="row2">&nbsp;2</td>
<td class="row2">&nbsp; 26 Dec 2011 </td>
<td class="row2">&nbsp; 24 Apr 2013</td>
<td class="row2">JHANSI</td>
<td class="row2">JHANSI</td>
<td class="row2">POLICE LINE</td>
<td class="row2">CONST CP</td>
</tr>
<tr >
<td class="row1">&nbsp;3</td>
<td class="row1">&nbsp; 25 Apr 2013 </td>
<td class="row1">&nbsp; 02 Aug 2014</td>
<td class="row1">ETAWAH</td>
<td class="row1">ETAWAH</td>
<td class="row1">POLICE LINE</td>
<td class="row1">CONST CP</td>
</tr>
<tr>
<td class="row2">&nbsp;4</td>
<td class="row2">&nbsp;02 Aug 2014</td>
<td class="row2">&nbsp;--</td>
<td class="row2">Kanpur Commissionerate</td>
<td class="row2">Kanpur Commissionerate</td>
<td class="row2">DIAL 100</td>
<td class="row2">CONST CP</td>
</tr>
</table>
`;

// HTML with default placeholder image
const sampleDefaultImageHtml = sampleHtml.replace(
  "../praroop/emp_image/1403685650112565187.jpeg",
  "../praroop/emp_image/defaultimages.jpg"
);

console.log("🧪 Running unit tests...");

// 1. Test HTML Parser with valid image
const parsed = parseDetailHtml(
  sampleHtml,
  "http://45.64.159.163/uppolice/login/hc/detail.php?id=112565187"
);

assert.strictEqual(parsed.personalNumber, "112565187");
assert.strictEqual(parsed.name, "ABHISHEK SHARMA");
assert.strictEqual(parsed.rank, "HC CP");
assert.strictEqual(parsed.fatherOrSpouseName, "SANJEEV SHARMA");
assert.strictEqual(parsed.homeDistrict, "AURAIYA");
assert.strictEqual(parsed.dob, "10 Mar 1989");
assert.strictEqual(
  parsed.photoUrl,
  "http://45.64.159.163/uppolice/login/praroop/emp_image/1403685650112565187.jpeg"
);
assert.strictEqual(parsed.previousPostingDetails.length, 4);

console.log("✓ HTML parser verified for genuine photo!");

// 2. Test HTML Parser with default image (defaultimages.jpg)
const parsedDefault = parseDetailHtml(
  sampleDefaultImageHtml,
  "http://45.64.159.163/uppolice/login/hc/detail.php?id=892160022"
);

// photoUrl MUST be null because it was defaultimages.jpg
assert.strictEqual(parsedDefault.photoUrl, null);

// ALL OTHER DATA MUST REMAIN SAVED
assert.strictEqual(parsedDefault.personalNumber, "112565187");
assert.strictEqual(parsedDefault.name, "ABHISHEK SHARMA");
assert.strictEqual(parsedDefault.rank, "HC CP");
assert.strictEqual(parsedDefault.serviceDetails.range, "RANGE KANPUR");
assert.strictEqual(parsedDefault.previousPostingDetails.length, 4);

console.log("✓ Default image correctly skipped while preserving all other data!");

// 3. Test isDefaultImage helper
assert.strictEqual(isDefaultImage("http://45.64.159.163/uppolice/login/praroop/emp_image/defaultimages.jpg"), true);
assert.strictEqual(isDefaultImage("defaultimages.jpg"), true);
assert.strictEqual(isDefaultImage("http://.../images/defaultimage.png"), true);
assert.strictEqual(isDefaultImage("1403685650112565187.jpeg"), false);
assert.strictEqual(isDefaultImage(null), true);

console.log("✓ isDefaultImage helper verified!");

// 4. Test JSON fast append
const testJsonPath = path.resolve(__dirname, "temp_test_details.json");
if (fs.existsSync(testJsonPath)) fs.unlinkSync(testJsonPath);

appendRecordFast(testJsonPath, parsed);
appendRecordFast(testJsonPath, parsedDefault);

const readBack = readJsonSafe(testJsonPath);
assert.strictEqual(readBack.length, 2);
assert.strictEqual(readBack[0].photoUrl !== null, true);
assert.strictEqual(readBack[1].photoUrl, null);
fs.unlinkSync(testJsonPath);

console.log("✓ JSON fast append & safe reading verified!");

console.log("\n🎉 ALL UNIT TESTS PASSED SUCCESSFULLY!");
