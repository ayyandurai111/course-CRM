/**
 * Creates/updates a dedicated STUDENT test account — separate from the
 * account seeded by scripts/seedTestAccount.js (which this project uses
 * as the admin-side test login).
 *
 * Uses its own env vars so the two test accounts never collide:
 *   TEST_STUDENT_ACCOUNT_EMAIL
 *   TEST_STUDENT_ACCOUNT_PASSWORD
 *   TEST_STUDENT_ACCOUNT_NAME (optional, defaults to "Test Student")
 *
 * Usage:
 *   TEST_STUDENT_ACCOUNT_EMAIL=test-student@example.com \
 *   TEST_STUDENT_ACCOUNT_PASSWORD='...' \
 *   node scripts/seedTestStudentAccount.js
 *
 * (Or just set them in backend/.env and run `npm run seed:test:student`.)
 */
require("dotenv").config();
const { seedTestStudent } = require("./lib/seedTestStudent");

seedTestStudent({
  email: process.env.TEST_STUDENT_ACCOUNT_EMAIL || "",
  password: process.env.TEST_STUDENT_ACCOUNT_PASSWORD || "",
  name: process.env.TEST_STUDENT_ACCOUNT_NAME || "Test Student",
  label: "Test student account",
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
