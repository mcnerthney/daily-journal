import process from "node:process";
import { performance } from "node:perf_hooks";

function parseArgs(argv) {
  const options = {
    baseUrl: process.env.BENCH_BASE_URL || "http://localhost:4000",
    publicKey: process.env.BENCH_PUBLIC_KEY || "",
    requests: Number(process.env.BENCH_REQUESTS || 200),
    concurrency: Number(process.env.BENCH_CONCURRENCY || 20),
    warmup: Number(process.env.BENCH_WARMUP || 20),
    timeoutMs: Number(process.env.BENCH_TIMEOUT_MS || 10000),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;

    const [key, inlineValue] = arg.split("=", 2);
    const nextValue = inlineValue ?? argv[i + 1];
    const consumesNext = inlineValue === undefined;

    switch (key) {
      case "--base-url":
        options.baseUrl = String(nextValue || options.baseUrl);
        if (consumesNext) i += 1;
        break;
      case "--key":
        options.publicKey = String(nextValue || options.publicKey);
        if (consumesNext) i += 1;
        break;
      case "--requests":
        options.requests = Number(nextValue || options.requests);
        if (consumesNext) i += 1;
        break;
      case "--concurrency":
        options.concurrency = Number(nextValue || options.concurrency);
        if (consumesNext) i += 1;
        break;
      case "--warmup":
        options.warmup = Number(nextValue || options.warmup);
        if (consumesNext) i += 1;
        break;
      case "--timeout-ms":
        options.timeoutMs = Number(nextValue || options.timeoutMs);
        if (consumesNext) i += 1;
        break;
      case "--help":
        options.help = true;
        break;
      default:
        break;
    }
  }

  return options;
}

function printHelp() {
  console.log("Benchmark /api/public/:publicKey");
  console.log("");
  console.log("Usage:");
  console.log("  node scripts/benchmark-public-api.mjs --key <publicKey> [options]");
  console.log("");
  console.log("Options:");
  console.log("  --base-url <url>      API base URL (default: http://localhost:4000)");
  console.log("  --key <publicKey>     Public list key (slug or legacy UUID)");
  console.log("  --requests <n>        Timed requests (default: 200)");
  console.log("  --concurrency <n>     Parallel requests (default: 20)");
  console.log("  --warmup <n>          Warmup requests before timing (default: 20)");
  console.log("  --timeout-ms <n>      Per-request timeout in ms (default: 10000)");
  console.log("");
  console.log("Environment variable alternatives:");
  console.log("  BENCH_BASE_URL, BENCH_PUBLIC_KEY, BENCH_REQUESTS, BENCH_CONCURRENCY, BENCH_WARMUP, BENCH_TIMEOUT_MS");
}

function validateOptions(options) {
  if (!options.publicKey || !String(options.publicKey).trim()) {
    throw new Error("Missing public key. Pass --key <publicKey>.");
  }

  if (!Number.isFinite(options.requests) || options.requests <= 0) {
    throw new Error("--requests must be a positive number.");
  }

  if (!Number.isFinite(options.concurrency) || options.concurrency <= 0) {
    throw new Error("--concurrency must be a positive number.");
  }

  if (!Number.isFinite(options.warmup) || options.warmup < 0) {
    throw new Error("--warmup must be zero or a positive number.");
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive number.");
  }
}

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return 0;
  const index = Math.ceil((p / 100) * sortedValues.length) - 1;
  const safeIndex = Math.max(0, Math.min(index, sortedValues.length - 1));
  return sortedValues[safeIndex];
}

function formatMs(value) {
  return `${value.toFixed(2)} ms`;
}

async function requestOnce(url, timeoutMs) {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    const text = await response.text();
    const elapsedMs = performance.now() - startedAt;

    return {
      ok: response.ok,
      status: response.status,
      elapsedMs,
      bytes: Buffer.byteLength(text, "utf8"),
      error: null,
    };
  } catch (err) {
    const elapsedMs = performance.now() - startedAt;
    return {
      ok: false,
      status: 0,
      elapsedMs,
      bytes: 0,
      error: err,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function runBatch({ totalRequests, concurrency, url, timeoutMs }) {
  const workers = Math.min(concurrency, totalRequests);
  let nextIndex = 0;
  const results = [];

  async function worker() {
    while (nextIndex < totalRequests) {
      nextIndex += 1;
      const result = await requestOnce(url, timeoutMs);
      results.push(result);
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

function summarizeResults(results, elapsedWallMs) {
  const durations = results.map((r) => r.elapsedMs).sort((a, b) => a - b);
  const successes = results.filter((r) => r.ok).length;
  const failures = results.length - successes;
  const totalBytes = results.reduce((sum, r) => sum + r.bytes, 0);
  const totalDuration = durations.reduce((sum, n) => sum + n, 0);

  return {
    total: results.length,
    successes,
    failures,
    successRate: results.length > 0 ? (successes / results.length) * 100 : 0,
    minMs: durations[0] || 0,
    maxMs: durations[durations.length - 1] || 0,
    avgMs: durations.length > 0 ? totalDuration / durations.length : 0,
    p50Ms: percentile(durations, 50),
    p90Ms: percentile(durations, 90),
    p95Ms: percentile(durations, 95),
    p99Ms: percentile(durations, 99),
    rps: elapsedWallMs > 0 ? (results.length / elapsedWallMs) * 1000 : 0,
    avgBytes: results.length > 0 ? totalBytes / results.length : 0,
    non2xxStatuses: Array.from(new Set(results.filter((r) => !r.ok && r.status).map((r) => r.status))).sort((a, b) => a - b),
    timeoutOrNetworkErrors: results.filter((r) => r.error).length,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  validateOptions(options);

  const baseUrl = String(options.baseUrl).replace(/\/$/, "");
  const publicKey = encodeURIComponent(String(options.publicKey));
  const url = `${baseUrl}/api/public/${publicKey}`;

  console.log("Running benchmark for /api/public/:publicKey");
  console.log(`URL: ${url}`);
  console.log(`Warmup: ${options.warmup} requests`);
  console.log(`Benchmark: ${options.requests} requests, concurrency ${options.concurrency}`);
  console.log("");

  if (options.warmup > 0) {
    await runBatch({
      totalRequests: options.warmup,
      concurrency: options.concurrency,
      url,
      timeoutMs: options.timeoutMs,
    });
  }

  const startedAt = performance.now();
  const results = await runBatch({
    totalRequests: options.requests,
    concurrency: options.concurrency,
    url,
    timeoutMs: options.timeoutMs,
  });
  const elapsedWallMs = performance.now() - startedAt;

  const summary = summarizeResults(results, elapsedWallMs);

  console.log("Results");
  console.log(`Total requests: ${summary.total}`);
  console.log(`Successes: ${summary.successes}`);
  console.log(`Failures: ${summary.failures}`);
  console.log(`Success rate: ${summary.successRate.toFixed(2)}%`);
  console.log(`RPS: ${summary.rps.toFixed(2)}`);
  console.log(`Latency min: ${formatMs(summary.minMs)}`);
  console.log(`Latency avg: ${formatMs(summary.avgMs)}`);
  console.log(`Latency p50: ${formatMs(summary.p50Ms)}`);
  console.log(`Latency p90: ${formatMs(summary.p90Ms)}`);
  console.log(`Latency p95: ${formatMs(summary.p95Ms)}`);
  console.log(`Latency p99: ${formatMs(summary.p99Ms)}`);
  console.log(`Latency max: ${formatMs(summary.maxMs)}`);
  console.log(`Avg response size: ${summary.avgBytes.toFixed(0)} bytes`);

  if (summary.non2xxStatuses.length > 0) {
    console.log(`Non-2xx statuses: ${summary.non2xxStatuses.join(", ")}`);
  }
  if (summary.timeoutOrNetworkErrors > 0) {
    console.log(`Timeout/network errors: ${summary.timeoutOrNetworkErrors}`);
  }
}

main().catch((err) => {
  console.error("Benchmark failed:", err.message || err);
  process.exit(1);
});
