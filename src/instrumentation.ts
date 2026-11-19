export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getEnv } = await import("@/config/env");
    // Fail fast at server startup if the environment is misconfigured.
    getEnv();
  }
}
