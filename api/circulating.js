// /api/circulating.js
import { ethers } from "ethers";

/**
 * XALARA mainnet addresses
 */
const TOKEN = "0x20F58aC708D2ebBA5f4B6f1687073f631714f9F3";
const SAFE  = "0x5aBB817aaE8C17fBc97D2E2b4f08B35457aA1405"; // multisig owner
const EOA   = "0x57cBC130C4556F080C55e54da54bB58CCD9A3e71"; // deployer EOA (excluded)

/**
 * RPCs to try, in order. Add ETHEREUM_RPC_URL in Vercel → Settings → Environment Variables
 * if you have a dedicated provider (Alchemy/Infura/etc.)
 */
const RPCS = [
  process.env.ETHEREUM_RPC_URL,           // optional, preferred if set
  "https://cloudflare-eth.com",
  "https://eth.llamarpc.com",
  "https://rpc.ankr.com/eth",
].filter(Boolean);

/**
 * Try each RPC until one works, and ensure we are on MAINNET with real code at TOKEN.
 */
async function withMainnetProvider(run) {
  let lastErr;
  for (const url of RPCS) {
    try {
      // Pin to mainnet (chainId 1) to avoid accidental wrong networks
      const provider = new ethers.JsonRpcProvider(url, 1);
      // Validate the token has bytecode on this RPC (guards against wrong networks)
      const code = await provider.getCode(TOKEN);
      if (code === "0x") {
        throw new Error(
          `No contract code at ${TOKEN} on RPC ${url}. This usually means the RPC is not mainnet.`
        );
      }
      return await run(provider);
    } catch (e) {
      lastErr = e;
      // try next RPC
    }
  }
  throw lastErr || new Error("All RPCs failed");
}

export default async function handler(req, res) {
  try {
    const format = String(req.query.format || "").toLowerCase();
    const pretty = "pretty" in req.query;

    const { total, balSafe, balEoa, circ } = await withMainnetProvider(
      async (provider) => {
        const erc20 = new ethers.Contract(
          TOKEN,
          [
            "function totalSupply() view returns (uint256)",
            "function balanceOf(address) view returns (uint256)",
          ],
          provider
        );

        const [total, balSafe, balEoa] = await Promise.all([
          erc20.totalSupply(),
          erc20.balanceOf(SAFE),
          erc20.balanceOf(EOA),
        ]);

        const circ = total - balSafe - balEoa;
        return { total, balSafe, balEoa, circ };
      }
    );

    // Short CDN cache for 60s; allow stale for 10 minutes
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=600");

    if (format === "wei") {
      // Plain text integer for aggregators like Coinranking
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.status(200).send(circ.toString());
      return;
    }

    const human = {
      token: TOKEN,
      network: "ethereum",
      totalSupply: ethers.formatUnits(total, 18),
      excluded: {
        safe:     { address: SAFE, balance: ethers.formatUnits(balSafe, 18) },
        deployer: { address: EOA,  balance: ethers.formatUnits(balEoa, 18)  },
      },
      circulating: ethers.formatUnits(circ, 18),
      asOf: new Date().toISOString(),
    };

    if (format === "human") {
      res.status(200).json(human);
    } else {
      res.status(200).json({
        ...human,
        raw: {
          total:       total.toString(),
          safe:        balSafe.toString(),
          deployer:    balEoa.toString(),
          circulating: circ.toString(),
        },
      });
    }
  } catch (err) {
    res.status(500).json({
      error: err?.message || String(err),
      // Hide stack traces in production by default
      // stack: process.env.VERCEL_ENV === "development" ? (err?.stack || "") : undefined,
    });
  }
}
