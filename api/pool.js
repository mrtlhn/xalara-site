// /api/pool.js
import { ethers } from "ethers";

// Allow env overrides; fall back to known addresses
const TOKEN = (process.env.TOKEN_ADDRESS || "0x20F58aC708D2ebBA5f4B6f1687073f631714f9F3").toLowerCase(); // XALRA
const PAIR  = (process.env.PAIR_ADDRESS  || "0x87D0F6e909C459B1dA253F1A9570cceC8F59Bb91").trim();       // Uniswap v2 pair
const SAFE  = (process.env.SAFE_ADDRESS  || "0x5aBB817aaE8C17fBc97D2E2b4f08B35457aA1405").trim();       // multisig owner
const WETH  = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2".toLowerCase();

const RPCS = [
  process.env.ETHEREUM_RPC_URL, // preferred (Alchemy/Infura)
  "https://cloudflare-eth.com",
  "https://eth.llamarpc.com",
  "https://rpc.ankr.com/eth",
].filter(Boolean);

const PAIR_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint112,uint112,uint32)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)"
];

function isAddress(x){ try { return ethers.isAddress(x) } catch { return false } }

async function withProvider(run) {
  let lastErr;
  for (const url of RPCS) {
    try {
      const provider = new ethers.JsonRpcProvider(url, 1);
      const code = await provider.getCode(PAIR);
      if (code === "0x") throw new Error(`No pair code at ${PAIR} on ${url} (likely not mainnet).`);
      return await run(provider);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("All RPCs failed");
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "Method Not Allowed" });
    }
    if (!isAddress(PAIR) || !isAddress(SAFE) || !isAddress(TOKEN)) {
      return res.status(500).json({ error: "Invalid address configuration" });
    }

    const data = await withProvider(async (provider) => {
      const pair = new ethers.Contract(PAIR, PAIR_ABI, provider);
      const [t0, t1] = await Promise.all([pair.token0(), pair.token1()]);
      const [r0, r1] = await pair.getReserves();
      const [lpTotal, lpSafe] = await Promise.all([pair.totalSupply(), pair.balanceOf(SAFE)]);

      // Map reserves to XALRA vs ETH regardless of token0/1 order
      let xRes, eRes;
      const a0 = t0.toLowerCase(), a1 = t1.toLowerCase();
      if (a0 === TOKEN && a1 === WETH) { xRes = r0; eRes = r1; }
      else if (a1 === TOKEN && a0 === WETH) { xRes = r1; eRes = r0; }
      else { throw new Error("Unexpected pair composition (expected TOKEN/WETH)"); }

      // Human readable
      const reserveXalra = ethers.formatUnits(xRes, 18);
      const reserveEth   = ethers.formatUnits(eRes, 18);
      const priceEthPerXalra = Number(reserveEth) / Number(reserveXalra);

      const lpTotalDec = Number(ethers.formatUnits(lpTotal, 18));
      const lpSafeDec  = Number(ethers.formatUnits(lpSafe, 18));
      const lpSafePct  = lpTotalDec > 0 ? (lpSafeDec / lpTotalDec) * 100 : 0;

      return {
        pair: PAIR,
        token: TOKEN,
        reserveXalra,
        reserveEth,
        priceEthPerXalra,
        lpSafe:  ethers.formatUnits(lpSafe,  18),
        lpTotal: ethers.formatUnits(lpTotal, 18),
        lpSafePct: lpSafePct.toFixed(4),
        asOf: new Date().toISOString(),
        raw: {
          xRes: xRes.toString(),
          eRes: eRes.toString(),
          lpSafe: lpSafe.toString(),
          lpTotal: lpTotal.toString()
        }
      };
    });

    // Cache at edge for 60s; allow stale for 10m
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=600");

    // Format controls
    const format = String(req.query.format || "").toLowerCase();
    if (format === "human") {
      return res.status(200).json({
        pair: data.pair,
        token: data.token,
        reserveXalra: data.reserveXalra,
        reserveEth: data.reserveEth,
        priceEthPerXalra: data.priceEthPerXalra,
        lpSafe: data.lpSafe,
        lpTotal: data.lpTotal,
        lpSafePct: data.lpSafePct,
        asOf: data.asOf
      });
    }
    // default: full object with raw ints too
    return res.status(200).json(data);

  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) });
  }
}

