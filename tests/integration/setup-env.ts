import "dotenv/config";

// Point the application's DB client at the test database for every integration test file.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
