/**
 * Create an admin user. There is no public registration and no default password.
 *
 *   pnpm admin:create --email you@example.com --name "Your Name" [--role owner|editor]
 *
 * The password is read from a hidden prompt, or from stdin when piped:
 *   printf '%s' "$ADMIN_PASSWORD" | pnpm admin:create --email … --name …
 * The first admin is always an owner.
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { createInterface } from "node:readline";
import { count } from "drizzle-orm";
import { adminUsers } from "@/db/schema";
import { closeDb, getDb } from "@/lib/db";
import { createAdminUser } from "@/modules/admin-users/service";
import { ServiceError } from "@/modules/_shared/errors";

async function readHidden(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
  let muted = false;
  out._writeToOutput = (s: string) => {
    if (!muted || s.includes(prompt)) out.output.write(s);
  };
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks)
    .toString("utf8")
    .replace(/\r?\n$/, "");
}

const { values } = parseArgs({
  options: { email: { type: "string" }, name: { type: "string" }, role: { type: "string" } },
});

try {
  if (!values.email || !values.name) {
    throw new Error(
      'Usage: pnpm admin:create --email you@example.com --name "Your Name" [--role owner|editor]',
    );
  }
  if (values.role && values.role !== "owner" && values.role !== "editor")
    throw new Error("--role must be owner or editor");
  let password: string;
  if (process.stdin.isTTY) {
    password = await readHidden("Password (min. 12 characters): ");
    const again = await readHidden("Repeat password: ");
    if (password !== again) throw new Error("Passwords do not match");
  } else {
    password = await readStdin();
  }
  const db = getDb();
  const [{ n }] = (await db.select({ n: count() }).from(adminUsers)) as [{ n: number }];
  const role = n === 0 ? "owner" : ((values.role as "owner" | "editor" | undefined) ?? "editor");
  const user = await createAdminUser(
    { db, actorId: null },
    { email: values.email, name: values.name, password, role },
  );
  console.log(
    `Created ${user.role} ${user.email}${n === 0 && values.role === "editor" ? " (the first admin is always an owner)" : ""}.`,
  );
} catch (e) {
  console.error(e instanceof ServiceError || e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await closeDb();
}
