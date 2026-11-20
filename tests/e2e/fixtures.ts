/** Test-only admin account, created by the e2e global setup in the TEST database. */
export const E2E_ADMIN = {
  email: "e2e-admin@example.test",
  name: "E2E Admin",
  password: "e2e-only-password-not-a-secret",
} as const;
