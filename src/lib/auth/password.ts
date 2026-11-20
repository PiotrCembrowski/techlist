import { hash, verify } from "@node-rs/argon2";

/** argon2id (algorithm 2) with the library's OWASP-aligned defaults (m=19 MiB, t=2, p=1). */
const OPTIONS = { algorithm: 2 } as const;

export const MIN_PASSWORD_LENGTH = 12;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  try {
    return await verify(hashed, password);
  } catch {
    return false;
  }
}

let dummy: Promise<string> | undefined;
/** Verifies against a throwaway hash so unknown emails take as long as wrong passwords. */
export async function burnVerifyTime(password: string): Promise<void> {
  dummy ??= hashPassword("timing-equaliser-not-a-real-password");
  await verifyPassword(await dummy, password);
}
