import http from 'k6/http';
import { sleep } from 'k6';
import encoding from 'k6/encoding';
import { Trend } from 'k6/metrics';

export const options = {
  vus: 10,
  duration: '20s',
};

const propagationTrend = new Trend('propagation_latency');

const RPC_A = __ENV.RPC_A_URL || "http://127.0.0.1:18443";
const RPC_B = __ENV.RPC_B_URL || "http://127.0.0.1:18446";

const COOKIE_A = __ENV.RPC_A_COOKIE || ".devenv/state/bitcoin-node-1/regtest/.cookie";
const COOKIE_B = __ENV.RPC_B_COOKIE || ".devenv/state/bitcoin-node-2/regtest/.cookie";

function parseCookie(path) {
  const raw = open(path).trim();
  const sep = raw.indexOf(":");

  if (sep <= 0) {
    throw new Error(`Invalid RPC cookie format at ${path}`);
  }

  return {
    user: raw.slice(0, sep),
    pass: raw.slice(sep + 1)
  };
}

function authHeaders(cookiePath) {
  const { user, pass } = parseCookie(cookiePath);
  const token = encoding.b64encode(`${user}:${pass}`);
  return {
    "Content-Type": "text/plain",
    Authorization: `Basic ${token}`
  };
}

const AUTH_A_HEADERS = authHeaders(COOKIE_A);
const AUTH_B_HEADERS = authHeaders(COOKIE_B);

function rpc(url, headers, method, params = []) {
  const res = http.post(
    url,
    JSON.stringify({
      jsonrpc: "1.0",
      id: "k6",
      method,
      params
    }),
    { headers }
  );

  if (res.status !== 200) {
    throw new Error(
      `RPC ${method} failed: status=${res.status}, body=${res.body}`
    );
  }

  if (!res.body || res.body.length === 0) {
    throw new Error(`RPC ${method} returned empty body`);
  }

  const parsed = JSON.parse(res.body);

  if (parsed.error) {
    throw new Error(
      `RPC ${method} error: ${JSON.stringify(parsed.error)}`
    );
  }

  return parsed.result;
}

export function setup() {
  console.log("Setting up regtest environment...");

  try {
    rpc(RPC_A, AUTH_A_HEADERS, "createwallet", ["loadtest"]);
  } catch (e) {
    // Ignore "already exists"
  }

  const address = rpc(RPC_A, AUTH_A_HEADERS, "getnewaddress");

  rpc(RPC_A, AUTH_A_HEADERS, "generatetoaddress", [101, address]);

  return { address };
}

export default function (data) {
  // Send transaction
  const txid = rpc(RPC_A, AUTH_A_HEADERS, "sendtoaddress", [
    data.address,
    0.1,
    "",
    "",
    false,
    false,
    null,
    "unset",
    null,
    1.0,
    false
  ]);

  const start = Date.now();

  // Poll node B for propagation
  while (true) {
    const mempool = rpc(RPC_B, AUTH_B_HEADERS, "getrawmempool");
    if (mempool.includes(txid)) {
      const latency = Date.now() - start;
      propagationTrend.add(latency);
      break;
    }

    sleep(0.05);
  }
}
