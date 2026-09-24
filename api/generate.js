export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  try {
    const body =
      typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});

    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) {
      return res.status(400).json({ ok: false, error: "PROMPT_REQUIRED" });
    }

    const ratio = typeof body.ratio === "string" ? body.ratio : "1:1";
    const options =
      body.options && typeof body.options === "object" ? body.options : {};

    /*
     * Keep the free FLUX transport used by Miya's original path.
     * The payload now forwards imageUrl/imageBase64 so the same endpoint
     * can receive an Image → Image request when the upstream supports it.
     */
    const payload = {
      prompt,
      ratio
    };

    if (typeof options.imageUrl === "string" && options.imageUrl.trim()) {
      payload.imageUrl = options.imageUrl.trim();
    }

    if (
      typeof options.imageBase64 === "string" &&
      options.imageBase64.trim()
    ) {
      payload.imageBase64 = options.imageBase64.trim();
    }

    const response = await fetch("https://ahm7xmakki.com/api/tti", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const raw = await response.text();

    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      return res.status(502).json({
        ok: false,
        error: "FLUX_NON_JSON_RESPONSE"
      });
    }

    if (!response.ok) {
      return res.status(502).json({
        ok: false,
        error: String(
          data?.error ||
          data?.message ||
          `FLUX_HTTP_${response.status}`
        )
      });
    }

    if (
      !data?.imageUrl ||
      typeof data.imageUrl !== "string" ||
      !/^https?:\/\//i.test(data.imageUrl)
    ) {
      return res.status(502).json({
        ok: false,
        error: "FLUX_IMAGE_URL_MISSING",
        providerResponse: data
      });
    }

    return res.status(200).json({
      ok: true,
      mode: "image",
      status: "completed",
      provider: "Legacy PixelSter",
      model: "Flux Dev",
      imageUrl: data.imageUrl,
      meta: {
        transport: "http-json",
        free: true,
        source: "original-miyaa-flux-path",
        edit: Boolean(payload.imageUrl || payload.imageBase64)
      }
    });
  } catch (error) {
    console.error("Miya FLUX:", error);

    return res.status(500).json({
      ok: false,
      error: error?.message || "GENERATION_ERROR"
    });
  }
}
