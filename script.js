import http from 'k6/http';
import { sleep } from 'k6';
import encoding from 'k6/encoding';
import { Trend, Rate } from 'k6/metrics';

export const options = {
  setupTimeout: '10m',
  scenarios: {
    tx_blast: {
      executor: 'ramping-arrival-rate',
      startRate: 50,
      timeUnit: '1s',
      preAllocatedVUs: 200,
      maxVUs: 2000,
      stages: [
        { duration: '10s', target: 200 },
        { duration: '15s', target: 500 },
        { duration: '15s', target: 1000 },
        { duration: '10s', target: 2000 },
        { duration: '10s', target: 0 }
      ],
      gracefulStop: '30s'
    }
  },
  thresholds: {
    send_success_rate: ['rate>0.95'],
    http_req_failed: ['rate<0.10']
  }
};

const propagationTrend = new Trend('propagation_latency');
const sendSuccessRate = new Rate('send_success_rate');

const RPC_A = __ENV.RPC_A_URL || "http://127.0.0.1:18443";
const RPC_B = __ENV.RPC_B_URL || "http://127.0.0.1:18446";
const WALLET_NAME = __ENV.WALLET_NAME || "loadtest";
const RPC_A_WALLET = `${RPC_A}/wallet/${encodeURIComponent(WALLET_NAME)}`;
const MIN_TRUSTED_BALANCE = Number(__ENV.MIN_TRUSTED_BALANCE || "1");
const TOP_UP_BLOCKS = Number(__ENV.TOP_UP_BLOCKS || "300");
const AUTO_TOP_UP = (__ENV.AUTO_TOP_UP || "1") === "1";
const TX_AMOUNT = Number(__ENV.TX_AMOUNT || "0.00001");
const FEE_RATE = Number(__ENV.FEE_RATE || "1.0");

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

  const loadedWallets = rpc(RPC_A, AUTH_A_HEADERS, "listwallets");
  if (!loadedWallets.includes(WALLET_NAME)) {
    try {
      rpc(RPC_A, AUTH_A_HEADERS, "loadwallet", [WALLET_NAME]);
    } catch (e) {
      if (
        e.message.includes("\"code\":-18") ||
        e.message.includes("not found") ||
        e.message.includes("Path does not exist")
      ) {
        rpc(RPC_A, AUTH_A_HEADERS, "createwallet", [WALLET_NAME]);
      } else if (!e.message.includes("already loaded")) {
        throw e;
      }
    }
  }

  const address = rpc(RPC_A_WALLET, AUTH_A_HEADERS, "getnewaddress");
  const balances = rpc(RPC_A_WALLET, AUTH_A_HEADERS, "getbalances");
  const trustedBalance = balances.mine ? balances.mine.trusted : 0;
  console.log(`Trusted wallet balance: ${trustedBalance} BTC`);
  if (trustedBalance < MIN_TRUSTED_BALANCE && AUTO_TOP_UP) {
    console.log(`Topping up wallet with ${TOP_UP_BLOCKS} blocks...`);
    rpc(RPC_A, AUTH_A_HEADERS, "generatetoaddress", [TOP_UP_BLOCKS, address]);
  } else if (trustedBalance < MIN_TRUSTED_BALANCE) {
    console.log(
      "Wallet balance below threshold and AUTO_TOP_UP is disabled; setup will continue without mining."
    );
  }

  return { address };
}

export default function (data) {
  try {
    const txid = rpc(RPC_A_WALLET, AUTH_A_HEADERS, "sendtoaddress", [
      data.address,
      TX_AMOUNT,
      "",
      "",
      false,
      false,
      null,
      "unset",
      null,
      FEE_RATE,
      false
    ]);
    sendSuccessRate.add(true);

    // Optional: measure propagation without blocking load generation.
    if (__ENV.CHECK_PROPAGATION === "1") {
      const start = Date.now();
      for (let i = 0; i < 20; i++) {
        const mempool = rpc(RPC_B, AUTH_B_HEADERS, "getrawmempool");
        if (mempool.includes(txid)) {
          propagationTrend.add(Date.now() - start);
          break;
        }
        sleep(0.05);
      }
    }
  } catch (e) {
    sendSuccessRate.add(false);
  }
}
