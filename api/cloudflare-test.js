export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  const account = String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  const token = String(process.env.CLOUDFLARE_API_TOKEN || "").trim();

  if (!account || !token) {
    return res.status(500).json({
      ok: false,
      error: "CLOUDFLARE_ENV_MISSING",
      message: "CLOUDFLARE_ACCOUNT_ID или CLOUDFLARE_API_TOKEN не настроен в Vercel."
    });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const prompt = String(body.prompt || "Проверка Cloudflare Workers AI из Miya Studio. Ответь одним словом: работает.").trim().slice(0, 2000);

    const upstream = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai/run`,
      {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + token,
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify({
          model: "@cf/zai-org/glm-4.7-flash",
          input: { prompt }
        }),
        signal: AbortSignal.timeout(55000)
      }
    );

    const raw = await upstream.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw: raw.slice(0, 4000) }; }

    return res.status(upstream.status).json({
      ok: upstream.ok,
      provider: "Cloudflare Workers AI",
      model: "@cf/zai-org/glm-4.7-flash",
      status: upstream.status,
      response: data
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: "CLOUDFLARE_REQUEST_FAILED",
      message: String(error?.message || error || "Cloudflare request failed")
    });
  }
}
