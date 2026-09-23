export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";

    if (!prompt) {
      return res.status(400).json({ ok: false, error: "PROMPT_REQUIRED" });
    }

    const endpoint = String(process.env.MIYA_VHEER_GENERATE_URL || "").trim();
    if (!endpoint) {
      return res.status(503).json({
        ok: false,
        error: "VHEER_NOT_CONFIGURED",
        message: "MIYA_VHEER_GENERATE_URL is not configured."
      });
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        prompt,
        ratio: typeof body.ratio === "string" ? body.ratio : "1:1",
        model: typeof body.model === "string" ? body.model : "Flux Dev",
        quality: typeof body.quality === "string" ? body.quality : "standard",
        size: typeof body.size === "string" ? body.size : "1024",
        outputFormat: typeof body.outputFormat === "string" ? body.outputFormat : "png",
        ...(body.options && typeof body.options === "object" ? body.options : {})
      })
    });

    const raw = await response.text();
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      return res.status(502).json({ ok: false, error: "VHEER_NON_JSON_RESPONSE" });
    }

    if (!response.ok) {
      return res.status(502).json({
        ok: false,
        error: String(data?.error || data?.message || "VHEER_HTTP_" + response.status)
      });
    }

    const candidates = [
      data?.imageUrl,
      data?.image_url,
      data?.url,
      data?.output?.imageUrl,
      data?.output?.url,
      Array.isArray(data?.images) ? data.images[0] : null,
      Array.isArray(data?.output) ? data.output[0] : null
    ];

    const imageUrl = candidates.find(
      value => typeof value === "string" && (value.startsWith("http://") || value.startsWith("https://"))
    );

    if (!imageUrl) {
      return res.status(502).json({
        ok: false,
        error: "VHEER_IMAGE_URL_MISSING",
        providerResponse: data
      });
    }

    return res.status(200).json({
      ok: true,
      mode: "image",
      status: "completed",
      provider: "vheer",
      model: body.model || "Flux Dev",
      imageUrl,
      meta: { transport: "http-json" }
    });
  } catch (error) {
    console.error("Miya Vheer:", error);
    return res.status(500).json({
      ok: false,
      error: error?.message || "GENERATION_ERROR"
    });
  }
}
