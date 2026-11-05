// fab0-work's client of fab0's /api/v1/work/ (agent interface section 9), for a routine's session, where the plugin's
// MCP tools aren't installed. It runs under Node 22 or newer, with no dependency.
//
//   node fab0.mjs <operation> --api <api> <<'FAB0_BODY'
//   { "token": "<step token>", and the rest of the operation's input, on one line }
//   FAB0_BODY
//
// The operation is one of the Work tools that take a step token: get_envelope, complete, fail, link or start_child.
// It takes the step token, fab0_s_…, from the body's `token`, and posts the rest of the body to
// <api>/work/<operation> with the token as the bearer. The token is never this script's argument, which a process
// listing shows; the command's text, heredoc included, still holds it.
//
// It prints fab0's answer as JSON. It exits 1 when fab0 answers an error, which it prints as fab0 gives it
// ({ error, message, retryAfter? }), or can't be reached or redirects, and 2 when it sends nothing: for an argument
// other than the operation and --api (--token among them), an api that isn't https, a body that isn't a JSON object,
// or a body whose `token` isn't a step token. It never prints the token, or any part of a body it can't parse.
//
// To complete it adds the session's usage, as the bundled usage.mjs reads it from the transcript, unless the body
// holds `usage` (J.5). When usage.mjs fails, prints nothing or prints something that isn't usage, or takes over 10
// seconds, complete is sent without usage.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const OPERATIONS = ["get_envelope", "complete", "fail", "link", "start_child"];
const USAGE = `usage: fab0.mjs <${OPERATIONS.join("|")}> --api https://<host>/api/v1 <<< '{ "token": "<token>", … }'`;
// A step token (executor contract section 2): fab0_s_<run id>_<secret>.
const STEP_TOKEN = /^fab0_s_[0-7][0-9A-HJKMNP-TV-Z]{25}_[A-Za-z0-9_-]{43}$/;

// fab0's answer, as JSON. It never holds the token, whatever fab0 or an error says. Called only once `token` is set.
function answer(json, code) {
  process.stdout.write(`${JSON.stringify(json, null, 2).replaceAll(token, "[token]")}\n`);
  process.exit(code);
}

// A refusal's reason never quotes the arguments or the body.
function refuse(reason) {
  process.stderr.write(`fab0.mjs: ${reason}\n${USAGE}\n`);
  process.exit(2);
}

let args;
try {
  args = parseArgs({ options: { api: { type: "string" } }, allowPositionals: true });
} catch {
  refuse(`the arguments aren't an operation and --api; the token goes in the body's "token"`);
}
const [operation, ...rest] = args.positionals;

if (!OPERATIONS.includes(operation) || rest.length > 0) refuse("the operation isn't one of /api/v1/work/'s");
let api;
try {
  api = new URL(args.values.api ?? "");
} catch {
  refuse("--api isn't a URL");
}
if (api.protocol !== "https:") refuse("--api must be an https URL");
if (api.username !== "" || api.password !== "" || api.search !== "" || api.hash !== "")
  refuse("--api must be https://<host>/api/v1, with no credentials, query or fragment");

let input = "";
if (!process.stdin.isTTY) for await (const chunk of process.stdin) input += chunk;
let body;
try {
  body = JSON.parse(input);
} catch {
  refuse("the body on standard input isn't JSON");
}
if (typeof body !== "object" || body === null || Array.isArray(body)) refuse("the body isn't a JSON object");
// It is sent as the bearer only, never in the body.
if (typeof body.token !== "string" || !STEP_TOKEN.test(body.token)) refuse(`the body's "token" isn't a step token`);
const token = body.token;
delete body.token;

// The session's usage: a row per model and `long`, as fab0's Usage. usage.mjs runs as its own process, since it exits
// when it finds no transcript. Its error, timeout or partial output is no usage.
const COUNTS = ["input", "output", "cacheRead", "cacheWrite"];
const isRow = (row) =>
  typeof row?.model === "string" &&
  (row.long === undefined || row.long === true) &&
  COUNTS.every((count) => Number.isSafeInteger(row[count]) && row[count] >= 0);
function sessionUsage() {
  const run = spawnSync(process.execPath, [fileURLToPath(new URL("usage.mjs", import.meta.url))], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    // SIGKILL, so a usage.mjs that ignores SIGTERM can't hold the report back.
    timeout: 10_000,
    killSignal: "SIGKILL",
  });
  if (run.status !== 0) return [];
  try {
    const rows = JSON.parse(run.stdout);
    return Array.isArray(rows) && rows.every(isRow) ? rows : [];
  } catch {
    return [];
  }
}
if (operation === "complete" && !Object.hasOwn(body, "usage") && (process.env.CLAUDE_CODE_SESSION_ID ?? "") !== "") {
  const usage = sessionUsage();
  if (usage.length > 0) body.usage = usage;
}

let response;
try {
  response = await fetch(`${api.href.replace(/\/+$/, "")}/work/${operation}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    // A redirect would carry the bearer elsewhere.
    redirect: "error",
    signal: AbortSignal.timeout(120_000),
  });
} catch (error) {
  answer({ error: "unreachable", message: String(error?.cause?.message ?? error?.message ?? error) }, 1);
}

const text = await response.text();
let json;
try {
  json = JSON.parse(text);
} catch {
  answer({ error: "unexpected", message: `fab0 answered ${response.status} with no JSON` }, 1);
}
answer(json, response.ok ? 0 : 1);
