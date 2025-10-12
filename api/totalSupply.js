// /api/totalSupply.js
import { ethers } from "ethers";

/** XALARA mainnet token */
const TOKEN = "0x20F58aC708D2ebBA5f4B6f1687073f631714f9F3";

/** RPCs (prefers ETHEREUM_RPC_URL if set on Vercel) */
const RPCS = [
  process.env.ETHEREUM_RPC_URL,
  "https://cloudflare-eth.com",
  "https://eth.llamarpc.com",
  "https://rpc.ankr.com/eth",
].filter(Boolean);

async function withMainnetProvider(run) {
  let lastErr;
  for (const url of RPCS) {
    try {
      const provider = new ethers.JsonRpcProvider(url, 1);
      const code = await provider.getCode(TOKEN);
      if (code === "0x") throw new Error("No code at TOKEN on this RPC");
      return await run(provider);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("All RPCs failed");
}

export default async function handler(req, res) {
  try {
    const format = String(req.query.format || "").toLowerCase();

    const total = await withMainnetProvider(async (provider) => {
      const erc20 = new ethers.Contract(
        TOKEN,
        ["function totalSupply() view returns (uint256)"],
        provider
      );
      return await erc20.totalSupply();
    });

    // cache for 1 minute, allow stale 10 minutes
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=600");

    if (format === "wei") {
      // plain integer (wei)
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.status(200).send(total.toString());
      return;
    }

    // DEFAULT: plain decimal token units (no JSON, just the number)
    // This matches “numerical only” requirement some forms enforce.
    const decimal = ethers.formatUnits(total, 18);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.status(200).send(decimal);
  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) });
  }
}

