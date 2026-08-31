/**
 * Set a staff account's password.
 *
 * Kiara has no self-service reset — the team signs in with an email the salon
 * handed them, so a forgotten password is an admin job. This resolves the
 * email against the auth users and writes the new password with the service
 * role key, which is the only way in without the old one.
 *
 *   node --env-file=.env.local scripts/set-staff-password.mjs jannat@kiara.co jannat1234
 *   node --env-file=.env.local scripts/set-staff-password.mjs --file passwords.txt
 *
 * The file form takes one `email password` pair per line, `#` for comments,
 * so a whole team can be reset in one pass. Nothing is echoed back except the
 * account that changed.
 */
import { readFileSync } from "node:fs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
};

function pairsFromArgs(argv) {
  const fileFlag = argv.indexOf("--file");
  if (fileFlag !== -1) {
    const path = argv[fileFlag + 1];
    if (!path) throw new Error("--file needs a path");
    return readFileSync(path, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const [email, ...rest] = line.split(/\s+/);
        return [email, rest.join(" ")];
      });
  }
  const [email, password] = argv;
  if (!email || !password) {
    throw new Error("usage: set-staff-password.mjs <email> <password>  |  --file <path>");
  }
  return [[email, password]];
}

let pairs;
try {
  pairs = pairsFromArgs(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

/** One page is plenty: this is a salon, not a directory. */
const res = await fetch(`${url}/auth/v1/admin/users?per_page=500`, { headers });
if (!res.ok) {
  console.error(`Could not list users: ${res.status} ${await res.text()}`);
  process.exit(1);
}
const users = (await res.json()).users ?? [];
const byEmail = new Map(
  users.filter((user) => user.email).map((user) => [user.email.toLowerCase(), user]),
);

let failed = 0;
for (const [email, password] of pairs) {
  const user = byEmail.get(String(email).toLowerCase());
  if (!user) {
    console.error(`✗ ${email} — no such account`);
    failed += 1;
    continue;
  }
  // Supabase's own floor is 6; 8 is the app's, and a password that is refused
  // on write would leave the employee locked out with nothing changed.
  if (password.length < 8) {
    console.error(`✗ ${email} — password must be at least 8 characters`);
    failed += 1;
    continue;
  }

  const update = await fetch(`${url}/auth/v1/admin/users/${user.id}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ password, email_confirm: true }),
  });
  if (!update.ok) {
    console.error(`✗ ${email} — ${update.status} ${await update.text()}`);
    failed += 1;
    continue;
  }
  console.log(`✓ ${email} (${user.user_metadata?.name ?? user.id})`);
}

console.log(`${pairs.length - failed} updated, ${failed} failed`);
process.exit(failed ? 1 : 0);
