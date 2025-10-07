// /api/circulating.js  (Node 18+ on Vercel)
import { ethers } from "ethers";

const TOKEN = "0x20F58aC708D2ebBA5f4B6f1687073f631714f9F3";
const EXCLUDE = [
  "0x5aBB817aaE8C17fBc97D2E2b4f08B35457aA1405", // Safe (treasury)
  "0x57cBC130C4556F080C55e54da54bB58CCD9A3e71"  // Deployer EOA
];

const ABI = [
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)"
];

const RPC = "https://cloudflare-eth.com";

export default async function handler(req, res) {
  try {
    const provider = new ethers.JsonRpcProvider(RPC);
    const erc20 = new ethers.Contract(TOKEN, ABI, provider);

    const [total, ...balances] = await Promise.all([
      erc20.totalSupply(),
      ...EXCLUDE.map(a => erc20.balanceOf(a))
    ]);

    const excluded = balances.reduce((acc, b) => acc + b, 0n);
    const circulating = total - excluded;

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.status(200).json({
      circulatingSupply: ethers.formatUnits(circulating, 18),
      totalSupply: ethers.formatUnits(total, 18),
      excludedAddresses: EXCLUDE,
      updatedAt: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
}

