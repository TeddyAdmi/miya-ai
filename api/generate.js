async function handler(req, res) {

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  try {
    const body =
      typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});

    if (body.mode === "chat") {
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const cleanMessages = messages
        .filter(
          m =>
            m &&
            (m.role === "user" || m.role === "assistant") &&
            typeof m.content === "string"
        )
        .map(m => ({
          role: m.role,
          content: m.content.slice(0, 12000)
        }));

      if (!cleanMessages.length || cleanMessages[cleanMessages.length - 1].role !== "user") {
        return res.status(400).json({ error: "A user message is required" });
      }

      const requestedModel =
        typeof body.model === "string" && body.model.trim()
          ? body.model.trim()
          : "gemini-3.8-flash";

      // Gemini is used when a key is configured. Otherwise use the free
      // no-key text endpoint so Miya Chat works without paid credentials.
      const apiKey = process.env.GEMINI_API_KEY;
      if (apiKey) {
        const modelsToTry = [requestedModel, "gemini-3.6-flash", "gemini-3.5-flash"].filter(
          (value, index, list) => list.indexOf(value) === index
        );

        const contents = cleanMessages.map(m => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }]
        }));

        let response;
        let data = {};
        let model = requestedModel;

        for (const candidate of modelsToTry) {
          model = candidate;
          response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(candidate)}:generateContent?key=${encodeURIComponent(apiKey)}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                systemInstruction: {
                  parts: [{
                    text: "Ты Miya — дружелюбный AI-помощник внутри Miya AI Studio. Отвечай на русском, если пользователь пишет по-русски. Помогай с текстами, идеями, сценариями, промптами, изображениями и видео."
                  }]
                },
                contents,
                generationConfig: {
                  thinkingConfig: { thinkingLevel: "low" },
                  maxOutputTokens: 2048
                }
              })
            }
          );
          data = await response.json().catch(() => ({}));
          if (response.ok) break;
          if (![429, 500, 502, 503, 504].includes(response.status)) break;
        }

        if (response?.ok) {
          const text = data?.candidates?.[0]?.content?.parts
            ?.map(part => part?.text || "")
            .join("")
            .trim();

          if (text) {
            return res.status(200).json({
              ok: true,
              mode: "chat",
              text,
              model,
              provider: "Gemini",
              usage: data?.usageMetadata || null
            });
          }
        }
      }

      // Free fallback: no API key and no payment required.
      const transcript = cleanMessages
        .slice(-12)
        .map(m => (m.role === "assistant" ? "Miya: " : "Пользователь: ") + m.content)
        .join("\\n");

      const system =
        "Ты Miya, дружелюбный AI-помощник внутри Miya AI Studio. " +
        "Отвечай на русском, если пользователь пишет по-русски. " +
        "Помогай с текстами, идеями, сценариями, промптами, изображениями и видео. " +
        "Отвечай полезно и по существу.";

      const fallbackUrl =
        "https://text.pollinations.ai/" +
        encodeURIComponent(system + "\\n\\n" + transcript) +
        "?model=openai&private=true";

      const fallbackResponse = await fetch(fallbackUrl, {
        method: "GET",
        headers: { Accept: "text/plain" }
      });

      const fallbackText = (await fallbackResponse.text()).trim();

      if (!fallbackResponse.ok || !fallbackText) {
        return res.status(502).json({
          ok: false,
          error: "CHAT_UPSTREAM_FAILED",
          message: "Бесплатный AI-сервис чата временно недоступен.",
          upstreamStatus: fallbackResponse.status
        });
      }

      return res.status(200).json({
        ok: true,
        mode: "chat",
        text: fallbackText,
        model: "openai",
        provider: "Free Text",
        usage: null
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
    const endpointPath = isImageToImage ? "/api/pti" : "/api/tti";
    const endpoints = [
      "https://ahm7xmakki.com" + endpointPath,
      "https://www.ahm7xmakki.com" + endpointPath
    ];

    const payload = {
      prompt,
      ratio: isImageToImage && ratio === "1:1" ? "auto" : ratio
    };

    if (imageUrl) {
      // PixelSter's image-to-image endpoint is documented around uploaded image data.
      // Convert library/remote URLs to base64 server-side instead of forwarding imageUrl.
      const sourceResponse = await fetch(imageUrl, {
        method: "GET",
        headers: { Accept: "image/*" }
      });
      if (!sourceResponse.ok) {
        return res.status(400).json({
          ok: false,
          error: "SOURCE_IMAGE_FETCH_FAILED",
          message: "Не удалось получить исходное изображение для редактирования (HTTP " + sourceResponse.status + ")."
        });
      }
      const sourceBuffer = Buffer.from(await sourceResponse.arrayBuffer());
      if (sourceBuffer.length > 3.5 * 1024 * 1024) {
        return res.status(413).json({
          ok: false,
          error: "SOURCE_IMAGE_TOO_LARGE",
          message: "Исходное изображение слишком большое. PixelSter принимает изображения до 3.5 MB."
        });
      }
      const contentType = sourceResponse.headers.get("content-type") || "image/jpeg";
      const mime = /^image\/(jpeg|png|webp)$/i.test(contentType)
        ? contentType.split(";")[0]
        : "image/jpeg";
      payload.imageBase64 = "data:" + mime + ";base64," + sourceBuffer.toString("base64");
    }
    if (imageBase64) payload.imageBase64 = imageBase64;

    if (isImageToImage && imageBase64) {
      const match = imageBase64.match(/^data:image\/[^;]+;base64,(.+)$/i);
      if (!match) {
        return res.status(400).json({ ok: false, error: "INVALID_IMAGE_BASE64" });
      }
      const approxBytes = Math.ceil(match[1].length * 3 / 4);
      if (approxBytes > 3.5 * 1024 * 1024) {
        return res.status(413).json({
          ok: false,
          error: "SOURCE_IMAGE_TOO_LARGE",
          message: "Исходное изображение слишком большое. PixelSter принимает изображения до 3.5 MB."
        });
      }
    }

    let response;
    let raw = "";
    let data = {};
    let lastNetworkError = null;

    for (const endpoint of endpoints) {
      let endpointSucceeded = false;

      for (let attempt = 0; attempt < 3; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 56000);

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

          raw = await response.text();
          try {
            data = raw ? JSON.parse(raw) : {};
          } catch {
            data = {};
          }

          if (response.ok && data?.success !== false) {
            endpointSucceeded = true;
            break;
          }

          if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 2) {
            break;
          }

          await new Promise(resolve => setTimeout(resolve, 700 * (attempt + 1)));
        } catch (error) {
          lastNetworkError = error;

          if (error?.name === "AbortError") {
            return res.status(504).json({
              ok: false,
              error: "FLUX_TIMEOUT",
              message: isImageToImage
                ? "Flux Kontext Dev не завершил генерацию за 56 секунд."
                : "Flux Dev не завершил генерацию за 56 секунд."
            });
          }

          break;
        } finally {
          clearTimeout(timeout);
        }
      }

      if (endpointSucceeded) break;

      // If the first PixelSter hostname is unreachable from the Vercel runtime,
      // try the www hostname before returning a server error.
      if (lastNetworkError && endpoint !== endpoints[endpoints.length - 1]) {
        continue;
      }

      break;
    }

    if (lastNetworkError && (!response || !response.ok)) {
      return res.status(502).json({
        ok: false,
        error: "FLUX_UPSTREAM_UNREACHABLE",
        message: "Сервер Miya не смог подключиться к PixelSter. Попробована резервная точка API.",
        detail: lastNetworkError?.message || "Upstream connection failed"
      });
    }

    if (!response || !response.ok || data?.success === false) {
      return res.status(502).json({
        ok: false,
        error: String(data?.error || data?.message || `FLUX_HTTP_${response.status}`),
        upstreamStatus: response.status,
        upstreamBody: raw.slice(0, 500)
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
        endpoint: endpointPath,
        edit: isImageToImage
      }
    });
  } catch (error) {
    console.error("Miya FLUX:", error);

    return res.status(500).json({
      ok: false,
      error: "GENERATION_ERROR",
      message: error?.message || "Не удалось выполнить запрос генерации.",
      detail: String(error?.stack || "").slice(0, 1200)
    });
  }
}

module.exports = handler;
