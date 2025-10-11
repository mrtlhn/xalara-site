// /api/pool.js
import { ethers } from "ethers";

/** Mainnet constants */
const TOKEN = "0x20F58aC708D2ebBA5f4B6f1687073f631714f9F3"; // XALRA
const PAIR  = "0x87D0F6e909C459B1dA253F1A9570cceC8F59Bb91"; // Uniswap v2 XALRA/ETH
const WETH  = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const SAFE  = "0x5aBB817aaE8C17fBc97D2E2b4f08B35457aA1405";

/** RPCs to try (ENV first if you set ETHEREUM_RPC_URL in Vercel) */
const RPCS = [
  process.env.ETHEREUM_RPC_URL,
  "https://cloudflare-eth.com",
  "https://eth.llamarpc.com",
  "https://rpc.ankr.com/eth",
].filter(Boolean);

const PAIR_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint112,uint112,uint32)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
];

async function withMainnetProvider(run) {
  let lastErr;
  for (const url of RPCS) {
    try {
      const provider = new ethers.JsonRpcProvider(url, 1);
      const code = await provider.getCode(PAIR);
      if (code === "0x") throw new Error(`No pair code on ${url}`);
      return await run(provider);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("All RPCs failed");
}

export default async function handler(req, res) {
  try {
    const format = String(req.query.format || "").toLowerCase();
    const pretty = "pretty" in req.query;

    const { reserveX, reserveE, lpSafe, lpTotal } = await withMainnetProvider(
      async (provider) => {
        const pair = new ethers.Contract(PAIR, PAIR_ABI, provider);
        const [t0, t1] = await Promise.all([pair.token0(), pair.token1()]);
        const [r0, r1] = await pair.getReserves();
        const [ts, lp] = await Promise.all([pair.totalSupply(), pair.balanceOf(SAFE)]);

        // Map reserves so X = XALRA, E = WETH
        let reserveX, reserveE;
        if (t0.toLowerCase() === TOKEN.toLowerCase() && t1.toLowerCase() === WETH.toLowerCase()) {
          reserveX = r0; reserveE = r1;
        } else if (t1.toLowerCase() === TOKEN.toLowerCase() && t0.toLowerCase() === WETH.toLowerCase()) {
          reserveX = r1; reserveE = r0;
        } else {
          throw new Error("Unexpected token ordering in pair");
        }
        return { reserveX, reserveE, lpSafe: lp, lpTotal: ts };
      }
    );

    // Mid price (ETH per XALRA)
    const x = Number(ethers.formatUnits(reserveX, 18));
    const e = Number(ethers.formatUnits(reserveE, 18));
    const price = e / x;

    // Cache for 60s; allow stale for 10 min
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=600");

    const human = {
      token: TOKEN,
      pair: PAIR,
      reserveXalara: ethers.formatUnits(reserveX, 18),
      reserveEth:    ethers.formatUnits(reserveE, 18),
      priceEthPerXalara: price.toString(),
      lp: {
        safe:  ethers.formatUnits(lpSafe, 18),
        total: ethers.formatUnits(lpTotal, 18),
      },
      asOf: new Date().toISOString(),
    };

    if (format === "human") {
      res.status(200).json(human);
    } else if (format === "raw") {
      res.status(200).json({
        token: TOKEN,
        pair:  PAIR,
        raw: {
          reserveXalara: reserveX.toString(),
          reserveEth:    reserveE.toString(),
          lpSafe:        lpSafe.toString(),
          lpTotal:       lpTotal.toString(),
        },
        asOf: new Date().toISOString(),
      });
    } else {
      // default: both
      res.status(200).json({
        ...human,
        raw: {
          reserveXalara: reserveX.toString(),
          reserveEth:    reserveE.toString(),
          lpSafe:        lpSafe.toString(),
          lpTotal:       lpTotal.toString(),
        },
      });
    }
  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) });
  }
}

