async function handler(req, res) {

  // Keep the handler alive even if Vercel/Node hands us an unexpected request object.
  // This also makes platform/runtime failures visible as JSON instead of a generic
  // FUNCTION_INVOCATION_FAILED response.
  try {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");

    if (!req || req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
    }
  } catch (bootstrapError) {
    try {
      return res.status(500).json({
        ok: false,
        error: "HANDLER_BOOTSTRAP_FAILED",
        message: String(bootstrapError?.message || bootstrapError || "Handler bootstrap failed")
      });
    } catch {}
    throw bootstrapError;
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
          let visionTimer = null;
          try {
            const visionController = new AbortController();
            visionTimer = setTimeout(() => visionController.abort(), 22000);

            const visionResponse = await fetch("https://ahm7xmakki.com/api/imgchat", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Accept": "application/json"
              },
              body: JSON.stringify(visionPayload),
              signal: visionController.signal
            });

            const visionRaw = await visionResponse.text();
            let visionData = {};
            try {
              visionData = visionRaw ? JSON.parse(visionRaw) : {};
            } catch {}

            const visionText = String(
              visionData?.response ||
              visionData?.text ||
              visionData?.message ||
              ""
            ).trim();

            if (visionResponse.ok && visionText) {
              return res.status(200).json({
                ok: true,
                mode: "chat",
                text: visionText,
                model: "VisionSter",
                provider: "AHM7 Vision",
                usage: null
              });
            }

            if (visionAttempt === 2) {
              console.warn("Miya VisionSter HTTP:", visionResponse.status);
            }
          } catch (visionError) {
            if (visionAttempt === 2) {
              console.warn("Miya VisionSter fallback:", visionError?.message || visionError);
            }
          } finally {
            if (visionTimer) clearTimeout(visionTimer);
          }
        }
      }

      const system =
        "Ты Miya, дружелюбный AI-помощник внутри Miya AI Studio. " +
        "Отвечай на русском, если пользователь пишет по-русски. " +
        "Помогай с текстами, идеями, сценариями, промптами, изображениями и видео. " +
        "Отвечай полезно и по существу.";

      // Anonymous free text chat: no Google login and no user API key.
      if (!chatImageBase64) {
        try {
          const faucetResponse = await fetch("https://api.llmfaucet.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              "Authorization": "Bearer free",
              "Content-Type": "application/json",
              "Accept": "application/json"
            },
            body: JSON.stringify({
              model: "auto:fast",
              messages: [
                { role: "system", content: system },
                ...cleanMessages.slice(-12)
              ],
              max_tokens: 2048
            }),
            signal: AbortSignal.timeout(22000)
          });
          const faucetData = await faucetResponse.json().catch(() => ({}));
          const faucetText = String(faucetData?.choices?.[0]?.message?.content || "").trim();
          if (faucetText) {
            return res.status(200).json({
              ok: true,
              mode: "chat",
              text: faucetText,
              model: String(faucetData?.model || "auto:fast"),
              provider: "LLM Faucet",
              usage: faucetData?.usage || null
            });
          }
        } catch (error) {
          console.warn("Miya LLM Faucet:", error?.message || error);
        }
      }

      const transcript = cleanMessages
        .slice(-12)
        .map(m => (m.role === "assistant" ? "Miya: " : "Пользователь: ") + m.content)
        .join("\n");

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

    // Accept the image mode names used by current and older Miya Studio clients.
    // A missing response from a serverless handler makes Vercel report FUNCTION_INVOCATION_FAILED,
    // so normalize these aliases before routing instead of falling through.
    const requestMode = String(body.mode || "").trim().toLowerCase();
    const isImageMode = ["image", "pixel-image", "legacy-flux", "flux", "generate-image", "tti"].includes(requestMode);

    if (body.mode === "minimax-h3") {
      const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
      if (!prompt) return res.status(400).json({ ok:false, error:"PROMPT_REQUIRED" });

      try {
        const { Client, handle_file } = await import("@gradio/client");
        const sourceBase64 = typeof body.imageBase64 === "string" ? body.imageBase64.trim() : "";
        let inputImage = null;

        if (sourceBase64) {
          const match = sourceBase64.match(/^data:image\/[^;]+;base64,(.+)$/i);
          const raw = match ? match[1].replace(/\s+/g, "") : sourceBase64.replace(/^base64,/i, "").replace(/\s+/g, "");
          if (raw.length < 100) {
            return res.status(400).json({ ok:false, error:"INVALID_IMAGE_BASE64" });
          }
          inputImage = handle_file(Buffer.from(raw, "base64"));
        }

        const canvas = typeof body.canvas === "string" && body.canvas.trim()
          ? body.canvas.trim()
          : "960x544 · 16:9 fast";
        const requestedDuration = Number(body.duration);
        const duration = Number.isFinite(requestedDuration)
          ? Math.max(5, Math.min(14, Math.round(requestedDuration)))
          : 5;
        const requestedSteps = Number(body.steps);
        const steps = Number.isFinite(requestedSteps)
          ? Math.max(10, Math.min(40, Math.round(requestedSteps)))
          : 28;
        const seed = Number.isFinite(Number(body.seed))
          ? Math.round(Number(body.seed))
          : Math.floor(Math.random() * 2147483647);

        const client = await Promise.race([
          Client.connect("multimodalart/minimax-h3", { events:["status","data"] }),
          new Promise((_, reject) => setTimeout(() => reject(new Error("MiniMax H3 Space не отвечает за 20 секунд")), 20000))
        ]);

        const job = client.submit("/generate", [
          prompt,
          inputImage,
          null,
          canvas,
          duration,
          steps,
          seed,
          false
        ]);

        let resultData = null;
        let lastStatus = "";

        for await (const message of job) {
          if (message.type === "status") {
            lastStatus = String(message.stage || "");
            if (message.stage === "error") {
              throw new Error(message.message || "MiniMax H3 завершил запрос с ошибкой");
            }
          } else if (message.type === "data") {
            resultData = message.data;
          }
        }

        const findVideoUrl = (value, seen = new Set()) => {
          if (value == null) return "";
          if (typeof value === "string") return /^https?:\/\//i.test(value) && /\.(mp4|webm)(?:$|[?#])/i.test(value) ? value : "";
          if (typeof value !== "object" || seen.has(value)) return "";
          seen.add(value);
          for (const key of ["url","videoUrl","video_url","path","file","data","value"]) {
            const found = findVideoUrl(value[key], seen);
            if (found) return found;
          }
          for (const key of Object.keys(value)) {
            const found = findVideoUrl(value[key], seen);
            if (found) return found;
          }
          return "";
        };

        const videoUrl = findVideoUrl(resultData);
        if (!videoUrl) {
          throw new Error("MiniMax H3 не вернул доступный MP4" + (lastStatus ? " (" + lastStatus + ")" : ""));
        }

        return res.status(200).json({
          ok:true,
          mode:"video",
          provider:"Hugging Face ZeroGPU",
          model:"MiniMax H3",
          videoUrl,
          meta:{ free:true, space:"multimodalart/minimax-h3", canvas, duration, steps, imageToVideo:Boolean(sourceBase64) }
        });
      } catch (error) {
        const message = String(error?.message || "MiniMax H3 request failed");
        console.warn("Miya MiniMax H3:", message);
        return res.status(502).json({
          ok:false,
          error:"MINIMAX_H3_FAILED",
          message,
          provider:"Hugging Face ZeroGPU"
        });
      }
    }

    if (isImageMode) {
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
      payload.prompt = String(prompt).trim() + "\n\nSTRICT IMAGE EDIT — FLUX KONTEXT DEV:\n- Use the supplied image as the exact source image and preserve everything that was not explicitly requested to change.\n- Preserve the original subject, identity, face, anatomy, body proportions, clothing, pose, camera angle, composition, lighting, shadows, background and environment.\n- Make only the requested modifications and integrate every new object naturally into the original photograph.\n- OBJECT COUNT IS STRICT: create exactly the number of objects explicitly requested in the user's prompt. Never duplicate, clone, merge or multiply an object.\n- ANIMAL ANATOMY IS STRICT: every animal must have exactly one coherent body and head with normal anatomy. A cat must have one body, one head, four legs and one tail unless the user explicitly requests otherwise. Never create duplicate bodies, heads, tails, limbs or overlapping copies of the same animal.\n- SPORTS BALL REALISM IS STRICT: a soccer ball must be exactly one realistic spherical physical ball with authentic panel construction, correct proportions, natural perspective, believable scale, contact with the surface and a realistic contact shadow. It must look like a real photographed object, not a decorative object, toy, illustration, distorted sphere or abstract shape.\n- New objects must have physically correct placement, scale, perspective, lighting, materials and shadows consistent with the source image.\n- Return one coherent photorealistic image, not a collage, duplicate-object composition or surreal result.\n- Do not add any unrequested objects, animals, limbs, tails, balls, people, text or watermarks.";
    }

    let response = null;
    let raw = "";
    let data = {};
    let lastNetworkError = null;

    for (let endpointIndex = 0; endpointIndex < endpoints.length; endpointIndex++) {
      const endpoint = endpoints[endpointIndex];
      // Text-to-image can also receive transient 5xx/429 responses from the
      // free upstream. Retry it without changing the Flux Dev prompt/model.
      const maxAttempts = isImageToImage ? 3 : 2;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const controller = new AbortController();
        const timeoutMs = isImageToImage ? 58000 : 30000;
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

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
