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

    const imageUrl =
      typeof options.imageUrl === "string" ? options.imageUrl.trim() : "";
    const imageBase64 =
      typeof options.imageBase64 === "string" ? options.imageBase64.trim() : "";

    const isImageToImage = Boolean(imageUrl || imageBase64);
    const endpoint = isImageToImage
      ? "https://ahm7xmakki.com/api/pti"
      : "https://ahm7xmakki.com/api/tti";

    const payload = {
      prompt,
      ratio: isImageToImage && ratio === "1:1" ? "auto" : ratio
    };

    if (imageUrl) payload.imageUrl = imageUrl;
    if (imageBase64) payload.imageBase64 = imageBase64;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55000);
    let response;
    try {
      response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        return res.status(504).json({ ok: false, error: "FLUX_TIMEOUT", message: "PixelSter did not respond within 55 seconds." });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    const raw = await response.text();

    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      return res.status(502).json({
        ok: false,
        error: "FLUX_NON_JSON_RESPONSE",
        upstreamStatus: response.status,
        upstreamContentType: response.headers.get("content-type") || "",
        upstreamBody: raw.slice(0, 500)
      });
    }

    if (!response.ok || data?.success === false) {
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
      provider: "PixelSter",
      model: isImageToImage ? "Flux Kontext Dev" : "Flux Dev",
      imageUrl: data.imageUrl,
      meta: {
        transport: "http-json",
        free: true,
        endpoint: isImageToImage ? "/api/pti" : "/api/tti",
        edit: isImageToImage
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
