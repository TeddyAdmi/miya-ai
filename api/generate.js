export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  try {
    const body =
      typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});

    if (body.mode === "chat") {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({
          error: "GEMINI_API_KEY is not configured",
          message: "Добавь GEMINI_API_KEY в Vercel Environment Variables."
        });
      }

      const messages = Array.isArray(body.messages) ? body.messages : [];
      const model =
        typeof body.model === "string" && body.model.trim()
          ? body.model.trim()
          : "gemini-3.5-flash-lite";

      const contents = messages
        .filter(
          m =>
            m &&
            (m.role === "user" || m.role === "assistant") &&
            typeof m.content === "string"
        )
        .map(m => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content.slice(0, 12000) }]
        }));

      if (!contents.length || contents[contents.length - 1].role !== "user") {
        return res.status(400).json({ error: "A user message is required" });
      }

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          model
        )}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: {
              parts: [
                {
                  text: "Ты Miya — дружелюбный AI-помощник внутри Miya AI Studio. Отвечай на русском, если пользователь пишет по-русски. Помогай с текстами, идеями, сценариями, промптами, изображениями и видео. Не утверждай, что ты можешь выполнить действие, если оно не подключено."
                }
              ]
            },
            contents,
            generationConfig: {
              thinkingConfig: { thinkingLevel: "low" },
              maxOutputTokens: 2048
            }
          })
        }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        return res.status(response.status).json({
          error:
            data?.error?.message ||
            data?.message ||
            `Gemini API error: HTTP ${response.status}`
        });
      }

      const text = data?.candidates?.[0]?.content?.parts
        ?.map(part => part?.text || "")
        .join("")
        .trim();

      if (!text) {
        return res.status(502).json({ error: "Gemini returned an empty response" });
      }

      return res.status(200).json({
        ok: true,
        mode: "chat",
        text,
        model,
        usage: data?.usageMetadata || null
      });
    }

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
    const timeout = setTimeout(() => controller.abort(), 58000);
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
        return res.status(504).json({ ok: false, error: "FLUX_TIMEOUT", message: isImageToImage ? "Flux Kontext Dev did not finish within 58 seconds. The free PixelSter upstream timed out." : "Flux Dev did not finish within 58 seconds. The free PixelSter upstream timed out." });
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
