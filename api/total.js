// /api/total.js
export default function handler(req, res) {
  // Total supply is fixed at 1,000,000,000 XALRA
  res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.status(200).send("1000000000");
}

