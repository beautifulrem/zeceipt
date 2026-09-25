// Mint the console's Zkool token (slice S3): an ES256 JWT for one account, with write, expiring in N days.
//   node scripts/zkool-token.ts --key <ec-p256-private.pem> --account <n> --out <file> [--days 30]
// The key pair is the operator's (Zkool is started with --jwt-public-key-file <public.pem>):
//   openssl ecparam -name prime256v1 -genkey -noout -out zkool-jwt.key && chmod 600 zkool-jwt.key
//   openssl ec -in zkool-jwt.key -pubout -out zkool-jwt.pub
// The token is written to a new file with mode 0600 (an existing file is never overwritten) and never printed:
// a bearer credential on stdout or in argv lands in terminals, logs and /proc (nix-bitcoin #848, R97).
import { closeSync, openSync, readFileSync, writeSync } from "node:fs";
import { parseArgs } from "node:util";
import { mintZkoolToken } from "../lib/execution/zkool-token.ts";

const { values } = parseArgs({ options: { key: { type: "string" }, account: { type: "string" }, out: { type: "string" }, days: { type: "string", default: "30" } } });
const fail = (m: string): never => {
  console.error(`zkool-token: ${m}`);
  process.exit(2);
};
if (!values.key || !values.account || !values.out) fail("usage: --key <ec-p256-private.pem> --account <n> --out <file> [--days 30]");
const account = Number(values.account);
if (!Number.isInteger(account) || account < 1) fail("--account must be a Zkool account id ≥ 1 (0 would be an admin token)");
const days = Number(values.days);
if (!Number.isInteger(days) || days < 1 || days > 365) fail("--days must be an integer from 1 to 365");
const exp = Math.floor(Date.now() / 1000) + days * 86_400;
let token: string;
try {
  token = mintZkoolToken(readFileSync(values.key!, "utf8"), { exp, sub: account, write: true });
} catch (e) {
  fail(`cannot mint: ${(e as Error).message}`);
}
let fd: number;
try {
  fd = openSync(values.out!, "wx", 0o600);
} catch (e) {
  fail(`cannot create ${values.out} (${(e as NodeJS.ErrnoException).code}); it must not exist yet`);
}
writeSync(fd!, `${token!}\n`);
closeSync(fd!);
console.log(`wrote ${values.out}: Zkool account ${account}, write, expires ${new Date(exp * 1000).toISOString()}`);
