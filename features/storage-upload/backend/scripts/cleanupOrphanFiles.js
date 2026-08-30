/**
 * Manual run of the orphan-Storage-file cleanup (spec #5E verification).
 *
 * Usage:
 *   node scripts/cleanupOrphanFiles.js            # deletes proven orphans
 *   node scripts/cleanupOrphanFiles.js --dry-run   # reports only, deletes nothing
 *   node scripts/cleanupOrphanFiles.js --min-age-hours=1
 */
require("dotenv").config();
const { findAndDeleteOrphanFiles, DEFAULT_MIN_AGE_HOURS } = require("../orphanCleanupService");

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const ageArg = args.find((a) => a.startsWith("--min-age-hours="));
  const minAgeHours = ageArg ? Number(ageArg.split("=")[1]) : Number(process.env.ORPHAN_FILE_MIN_AGE_HOURS) || DEFAULT_MIN_AGE_HOURS;

  console.log(`Scanning for orphaned Storage objects (minAgeHours=${minAgeHours}, dryRun=${dryRun})...`);
  const summary = await findAndDeleteOrphanFiles({ minAgeHours, dryRun });
  console.log(dryRun ? "Dry-run summary (nothing deleted):" : "Cleanup summary:", summary);
}

main().catch((err) => {
  console.error("Orphan cleanup script failed:", err);
  process.exit(1);
});
