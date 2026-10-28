require("dotenv").config();

const { runPart1 } = require("./src/part1_search");
const { runPart2 } = require("./src/part2_details");

async function main() {
  const runPart = (process.env.RUN_PART || "2").toLowerCase().trim();

  console.log("\n===========================================================");
  console.log("       UP POLICE DATA SCRAPER & PHOTO ARCHIVER            ");
  console.log("===========================================================");
  console.log(`[Setting] RUN_PART = ${runPart}`);

  if (runPart === "1" || runPart === "part1") {
    console.log("▶ Executing Part 1: Employee List Search -> employees.json\n");
    await runPart1();
  } else if (runPart === "2" || runPart === "part2") {
    console.log(
      "▶ Executing Part 2: Employee Details & Photos based on PNO -> employee_details.json\n"
    );
    await runPart2();
  } else if (runPart === "all" || runPart === "both") {
    console.log("▶ Executing Both Parts sequentially (Part 1 then Part 2)\n");
    await runPart1();
    console.log("\n-----------------------------------------------------------");
    console.log("Part 1 finished. Starting Part 2...\n");
    await runPart2();
  } else {
    console.error(`\n❌ Unknown RUN_PART value: '${runPart}'`);
    console.log("Please set RUN_PART in your .env file to:");
    console.log("  RUN_PART=1    -> Scrape employee search list to employees.json");
    console.log("  RUN_PART=2    -> Scrape employee details and photos by PNO");
    console.log("  RUN_PART=all  -> Run Part 1 then Part 2 sequentially\n");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\n[Fatal Error]", err);
  process.exit(1);
});
