export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    return;
  }
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    const headers = new Headers();
    if (req.headers["content-type"]) headers.set("content-type", String(req.headers["content-type"]));
    if (req.headers["content-length"]) headers.set("content-length", String(req.headers["content-length"]));
    headers.set("accept", "application/json");
    const upstream = await fetch("https://cleverutils.com/api/v1/tools/vocal-remover", { method:"POST", headers, body });
    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader("content-type", upstream.headers.get("content-type") || "application/json");
    res.send(text);
  } catch (error) {
    console.error("CleverUtils vocal proxy failed:", error);
    res.status(502).json({ error:"CLEVERUTILS_PROXY_FAILED", message:String(error?.message || error) });
  }
}
