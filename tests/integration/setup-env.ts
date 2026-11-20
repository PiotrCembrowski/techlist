import "dotenv/config";

// Point the application's DB client at the test database for every integration test file.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
// A fixed, test-only Auth.js secret when none is configured (never used outside tests).
process.env.AUTH_SECRET ??= "integration-test-secret-not-for-production-use";
process.env.STORAGE_LOCAL_DIR = "storage/test-uploads";
