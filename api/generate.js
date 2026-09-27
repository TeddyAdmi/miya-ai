async function handler(req, res) {

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

    async function generatePixelSound(prompt, duration) {
      try {
        const { Client } = await import("@gradio/client");
        const client = await Promise.race([
          Client.connect("declare-lab/TangoFlux"),
          new Promise((_, reject) => setTimeout(() => reject(new Error("TangoFlux connection timeout")), 10000))
        ]);
        const soundPrompt = [
          "Generate synchronized realistic cinematic sound effects for this exact image-to-video action.",
          "No music. No human speech. Use only natural diegetic sounds that match the described action.",
          "Desert canyon ambience, dry wind, fast eagle wing flaps, animal movement, physical impact and dust movement.",
          "If a lion is present, include a deep realistic lion growl/roar when appropriate.",
          "Synchronize the sound events in the same order as the visual actions.",
          String(prompt || "")
        ].join(" ");
        const result = await Promise.race([
          client.predict("/predict", [soundPrompt, 25, 4.5, Math.max(1, Math.min(20, Number(duration) || 5))]),
          new Promise((_, reject) => setTimeout(() => reject(new Error("TangoFlux generation timeout")), 25000))
        ]);
        const value = result?.data?.[0] || result?.data || "";
        const url = typeof value === "string"
          ? value
          : (value?.url || value?.path || value?.value || "");
        if (!/^https?:\/\//i.test(String(url))) throw new Error("TangoFlux returned no audio URL");
        const audioResponse = await fetch(String(url), { headers: { Accept: "audio/*" } });
        if (!audioResponse.ok) throw new Error("TangoFlux audio fetch HTTP " + audioResponse.status);
        const bytes = Buffer.from(await audioResponse.arrayBuffer());
        if (!bytes.length) throw new Error("TangoFlux returned empty audio");
        return {
          audioBase64: bytes.toString("base64"),
          audioMime: audioResponse.headers.get("content-type") || "audio/wav"
        };
      } catch (error) {
        console.warn("Miya Pixel audio:", error?.message || error);
        return null;
      }
    }

  try {
    const body =
      typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});

    if (body.mode === "chat") {
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const cleanMessages = messages
        .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
        .map(m => ({ role: m.role, content: m.content.slice(0, 12000) }));
      const chatImageBase64 = typeof body.imageBase64 === "string" ? body.imageBase64.trim() : "";

      if (!cleanMessages.length || cleanMessages[cleanMessages.length - 1].role !== "user") {
        return res.status(400).json({ error: "A user message is required" });
      }

      const requestedModel =
        typeof body.model === "string" && body.model.trim()
          ? body.model.trim()
          : "gemini-3.8-flash";

      const apiKey = process.env.GEMINI_API_KEY;
      if (apiKey) {
        const modelsToTry = [requestedModel, "gemini-3.1-flash-lite", "gemini-3.1-flash", "gemini-2.5-flash"].filter(
          (value, index, list) => list.indexOf(value) === index
        );

        const contents = cleanMessages.map((m,index) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }, ...(index === cleanMessages.length - 1 && m.role === "user" && chatImageBase64
            ? [{ inline_data: { mime_type: String(chatImageBase64.match(/^data:([^;]+);/i)?.[1] || "image/png"), data: chatImageBase64.replace(/^data:image\/[^;]+;base64,/i, "") } }]
            : [])]
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
              }),
              signal: AbortSignal.timeout(28000)
            }
          );
          data = await response.json().catch(() => ({}));
          if (response.ok) break;
          if (![429, 500, 502, 503, 504].includes(response.status)) break;
        }

        if (response?.ok) {
          const text = data?.candidates?.[0]?.content?.parts?.map(part => part?.text || "").join("").trim();
          if (text) {
            return res.status(200).json({
              ok: true, mode: "chat", text, model,
              provider: "Gemini", usage: data?.usageMetadata || null
            });
          }
        }
      }

      // If a photo is attached and Gemini is unavailable, use the free server-side
      // VisionSter endpoint instead of silently falling back to a text-only model.
      if (chatImageBase64) {
        const visionPayload = {
          image: chatImageBase64,
          userPrompt: cleanMessages[cleanMessages.length - 1].content,
          messages: cleanMessages.slice(-12).map(m => ({
            type: m.role === "assistant" ? "ai" : "user",
            content: m.content
          }))
        };

        // Vision is a free upstream and can occasionally stall on the first
        // request. Use short bounded attempts so the chat never hangs until
        // the browser's 90s timeout. A second attempt also handles transient
        // provider/network failures without changing image generation.
        for (let visionAttempt = 1; visionAttempt <= 2; visionAttempt++) {
          try {
            const visionResponse = await fetch("https://ahm7xmakki.com/api/imgchat", {
              method: "POST",
              headers: { "Content-Type": "application/json", "Accept": "application/json" },
              body: JSON.stringify(visionPayload),
              signal: AbortSignal.timeout(22000)
            });
            const visionData = await visionResponse.json().catch(() => ({}));
            const visionText = String(visionData?.response || visionData?.text || "").trim();
            if (visionResponse.ok && visionText) {
              return res.status(200).json({
                ok: true, mode: "chat", text: visionText,
                model: "VisionSter", provider: "AHM7 Vision", usage: null
              });
            }
            if (visionAttempt === 2) {
              console.warn("Miya VisionSter HTTP:", visionResponse.status);
            }
          } catch (visionError) {
            if (visionAttempt === 2) {
              console.warn("Miya VisionSter fallback:", visionError?.message || visionError);
            }
          }
        }
      }

      const transcript = cleanMessages
        .slice(-12)
        .map(m => (m.role === "assistant" ? "Miya: " : "Пользователь: ") + m.content)
        .join("\n");

      const system =
        "Ты Miya, дружелюбный AI-помощник внутри Miya AI Studio. " +
        "Отвечай на русском, если пользователь пишет по-русски. " +
        "Помогай с текстами, идеями, сценариями, промптами, изображениями и видео. " +
        "Отвечай полезно и по существу.";

      const fallbackUrl =
        "https://text.pollinations.ai/" +
        encodeURIComponent(system + "\n\n" + transcript) +
        "?model=openai&private=true";

      // Free chat fallback. Prefer the legacy OpenAI-compatible POST endpoint
      // because the old GET endpoint has become unreliable. If a current
      // Pollinations key is configured, use the current API first.
      const pollinationsKey = process.env.POLLINATIONS_API_KEY;
      let fallbackText = "";
      let fallbackModel = "openai";
      let lastChatStatus = null;

      if (pollinationsKey) {
        try {
          const currentResponse = await fetch("https://gen.pollinations.ai/v1/chat/completions", {
            method: "POST",
            headers: {
              "Authorization": "Bearer " + pollinationsKey,
              "Content-Type": "application/json",
              "Accept": "application/json"
            },
            body: JSON.stringify({
              model: "openai",
              messages: [
                { role: "system", content: system },
                ...cleanMessages.slice(-12)
              ],
              max_tokens: 2048
            }),
            signal: AbortSignal.timeout(30000)
          });
          lastChatStatus = currentResponse.status;
          const currentData = await currentResponse.json().catch(() => ({}));
          fallbackText = String(currentData?.choices?.[0]?.message?.content || "").trim();
          if (fallbackText) fallbackModel = "openai";
        } catch {}
      }

      if (!fallbackText) {
        try {
          const legacyResponse = await fetch("https://text.pollinations.ai/openai", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Accept": "application/json, text/plain"
            },
            body: JSON.stringify({
              model: "openai",
              messages: [
                { role: "system", content: system },
                ...cleanMessages.slice(-12)
              ]
            }),
            signal: AbortSignal.timeout(30000)
          });
          lastChatStatus = legacyResponse.status;
          const legacyRaw = (await legacyResponse.text()).trim();
          try {
            const legacyData = legacyRaw ? JSON.parse(legacyRaw) : {};
            fallbackText = String(
              legacyData?.choices?.[0]?.message?.content ||
              legacyData?.text ||
              legacyData?.response ||
              ""
            ).trim();
          } catch {
            fallbackText = legacyRaw;
          }
        } catch {}
      }

      if (!fallbackText) {
        try {
          const legacyGet = await fetch(fallbackUrl, {
            method: "GET",
            headers: { Accept: "text/plain" },
            signal: AbortSignal.timeout(30000)
          });
          lastChatStatus = legacyGet.status;
          fallbackText = (await legacyGet.text()).trim();
        } catch {}
      }

      if (!fallbackText) {
        return res.status(502).json({
          ok: false,
          error: "CHAT_UPSTREAM_FAILED",
          message: "Бесплатный AI-сервис чата временно недоступен.",
          upstreamStatus: lastChatStatus
        });
      }

      return res.status(200).json({
        ok: true, mode: "chat", text: fallbackText,
        model: fallbackModel, provider: "Free Text", usage: null
      });
    }

    // Accept the image mode names used by current and older Miya Studio clients.\n    // A missing response from a serverless handler makes Vercel report FUNCTION_INVOCATION_FAILED,\n    // so normalize these aliases before routing instead of falling through.\n    const requestMode = String(body.mode || "").trim().toLowerCase();\n    const isImageMode = ["image", "pixel-image", "legacy-flux", "flux", "generate-image", "tti"].includes(requestMode);\n\n    if (isImageMode) {
      const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) return res.status(400).json({ ok: false, error: "PROMPT_REQUIRED" });

    const ratio = typeof body.ratio === "string" ? body.ratio : "1:1";
    const requestedModel = typeof body.model === "string" ? body.model.trim() : "";
    const options = body.options && typeof body.options === "object" ? body.options : {};

    const imageUrl = typeof options.imageUrl === "string" ? options.imageUrl.trim() : "";
    const imageBase64 = typeof options.imageBase64 === "string" ? options.imageBase64.trim() : "";

    const wantsKontext = /kontext/i.test(requestedModel);
    const isImageToImage = wantsKontext && Boolean(imageUrl || imageBase64);

    if (wantsKontext && !isImageToImage) {
      return res.status(400).json({
        ok: false,
        error: "KONTEXT_SOURCE_REQUIRED",
        message: "Для Flux Kontext Dev нужно загрузить исходное изображение."
      });
    }

    const endpointPath = isImageToImage ? "/api/pti" : "/api/tti";
    const endpoints = [
      "https://ahm7xmakki.com" + endpointPath,
      "https://www.ahm7xmakki.com" + endpointPath
    ];

    const requestedCopies = Number(body.copies ?? body.count ?? 1);
    const copies = Number.isFinite(requestedCopies)
      ? Math.max(1, Math.min(4, Math.round(requestedCopies)))
      : 1;

    const payload = {
      prompt,
      ratio: isImageToImage && ratio === "1:1" ? "auto" : ratio,
      ...(copies > 1 && !isImageToImage ? { copies, count: copies } : {})
    };

    if (imageUrl) {
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

    if (isImageToImage) {
      const sourceData = payload.imageBase64 || "";
      const match = sourceData.match(/^data:image\/[^;]+;base64,(.+)$/i);
      const rawBase64 = match ? match[1].replace(/\s+/g,"") : sourceData.replace(/^base64,/i,"").replace(/\s+/g,"");

      if (!rawBase64 || rawBase64.length < 100) {
        return res.status(400).json({
          ok: false,
          error: "INVALID_IMAGE_BASE64",
          message: "PixelSter не получил корректное исходное изображение."
        });
      }

      const approxBytes = Math.ceil(rawBase64.length * 3 / 4);
      if (approxBytes > 3.5 * 1024 * 1024) {
        return res.status(413).json({
          ok: false,
          error: "SOURCE_IMAGE_TOO_LARGE",
          message: "Исходное изображение слишком большое. PixelSter принимает изображения до 3.5 MB."
        });
      }

      payload.imageBase64 = rawBase64;
      payload.prompt = String(prompt).trim() + "\n\nSTRICT IMAGE EDIT:\n- Use the supplied image as the exact source image.\n- Preserve the original subject, identity, anatomy, clothing, pose, camera angle and environment unless explicitly asked to change them.\n- Make only the requested modification.\n- Return one coherent natural image, not a collage.";
    }

    let response = null;
    let raw = "";
    let data = {};
    let lastNetworkError = null;

    for (let endpointIndex = 0; endpointIndex < endpoints.length; endpointIndex++) {
      const endpoint = endpoints[endpointIndex];
      const maxAttempts = isImageToImage ? 3 : 1;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 58000);

        try {
          response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json"
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

          if (response.ok && data?.success !== false) break;

          if ([408,429,500,502,503,504].includes(response.status) && attempt < maxAttempts-1) {
            await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));
            continue;
          }
          break;
        } catch (error) {
        lastNetworkError = error;

        if (attempt < maxAttempts - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
          continue;
        }
        if (endpointIndex < endpoints.length - 1) continue;
        break;
        } finally {
          clearTimeout(timeout);
        }
      }
      if (response?.ok && data?.success !== false) break;
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
        error: String(data?.error || data?.message || `FLUX_HTTP_${response?.status || "UNKNOWN"}`),
        message: isImageToImage
          ? "Flux Kontext Dev отклонил исходное изображение или запрос."
          : "Flux Dev не вернул изображение.",
        upstreamStatus: response?.status || null,
        upstreamBody: raw.slice(0, 1000)
      });
    }

    const imageUrls = Array.isArray(data?.imageUrls)
      ? data.imageUrls.filter(url => typeof url === "string" && /^https?:\/\//i.test(url))
      : Array.isArray(data?.images)
        ? data.images.map(item => typeof item === "string" ? item : item?.imageUrl)
            .filter(url => typeof url === "string" && /^https?:\/\//i.test(url))
        : data?.imageUrl
          ? [data.imageUrl]
          : [];

    if (!imageUrls.length) {
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
      imageUrl: imageUrls[0],
      imageUrls,
      count: imageUrls.length,
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
