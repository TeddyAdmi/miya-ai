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
        const modelsToTry = [requestedModel, "gemini-3.6-flash", "gemini-3.5-flash"].filter(
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
              })
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

    if (body.mode === "video" && /ltx/i.test(String(body.provider || body.model || ""))) {
      const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
      if (!prompt) return res.status(400).json({ ok:false, error:"PROMPT_REQUIRED" });
      const options = body.options && typeof body.options === "object" ? body.options : {};
      const imageBase64 = typeof options.imageBase64 === "string" ? options.imageBase64.trim() : "";
      const ratioValue = typeof body.ratio === "string" ? body.ratio : "16:9";
      const ratio = ["auto","9:16","16:9","1:1"].includes(ratioValue) ? ratioValue : "16:9";
      const requestedDuration = Number(body.duration ?? 5);
      const duration = Number.isFinite(requestedDuration) ? Math.max(1, Math.min(10, requestedDuration)) : 5;
      try {
        const { Client, handle_file } = await import("@gradio/client");
        const client = await Client.connect("Lightricks/LTX-2-3");
        let inputImage = null;
        if (imageBase64) {
          const raw = imageBase64.replace(/^data:image\/[^;]+;base64,/i, "").replace(/^base64,/i, "").replace(/\s+/g, "");
          if (!raw || raw.length < 100) return res.status(400).json({ ok:false, error:"INVALID_VIDEO_SOURCE", message:"Исходное изображение для LTX-2.3 некорректно." });
          const approxBytes = Math.ceil(raw.length * 3 / 4);
          if (approxBytes > 3.5 * 1024 * 1024) return res.status(413).json({ ok:false, error:"VIDEO_SOURCE_TOO_LARGE", message:"Исходное изображение слишком большое. Максимум 3.5 MB." });
          inputImage = handle_file(new Blob([Buffer.from(raw, "base64")], { type:"image/png" }));
        }
        let width=1536,height=1024;
        if(ratio==="9:16"){width=1024;height=1536}else if(ratio==="1:1"){width=1024;height=1024}
        const result=await client.predict("/generate_video",[inputImage,prompt,duration,false,Math.floor(Math.random()*2147483647),true,height,width]);
        const raw=result?.data?.[0];
        const videoUrl=typeof raw==="string"?raw:String(raw?.url||raw?.path||raw?.data||"");
        if(!videoUrl||!/^https?:\/\//i.test(videoUrl)) return res.status(502).json({ok:false,error:"LTX_VIDEO_URL_MISSING",message:"LTX-2.3 не вернул готовый MP4.",providerResponse:result});
        return res.status(200).json({ok:true,mode:"video",status:"completed",provider:"Lightricks",model:"LTX-2.3 Distilled · Video + Audio",videoUrl,meta:{transport:"server-gradio",free:true,synchronizedAudio:true,duration,ratio}});
      } catch(error) {
        console.error("Miya LTX server:",error);
        return res.status(502).json({ok:false,error:"LTX_UPSTREAM_FAILED",message:"LTX-2.3 со звуком сейчас не завершил запрос. Генерация сброшена — можно сразу повторить.",detail:error?.message||"Gradio request failed"});
      }
    }

    if (body.mode === "video") {
      const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
      if (!prompt) return res.status(400).json({ ok: false, error: "PROMPT_REQUIRED" });

      const options = body.options && typeof body.options === "object" ? body.options : {};
      const imageBase64 = typeof options.imageBase64 === "string" ? options.imageBase64.trim() : "";
      if (!imageBase64) return res.status(400).json({ ok: false, error: "VIDEO_SOURCE_REQUIRED", message: "Для Motion Synthesis нужно исходное изображение." });

      const commaIndex = imageBase64.indexOf(",");
      const rawBase64 = (commaIndex >= 0 ? imageBase64.slice(commaIndex + 1) : imageBase64)
        .replace(/^base64,/i, "").replace(/\\s+/g, "");
      if (!rawBase64 || rawBase64.length < 100) return res.status(400).json({ ok: false, error: "INVALID_VIDEO_SOURCE", message: "Исходное изображение для видео некорректно." });

      const approxBytes = Math.ceil(rawBase64.length * 3 / 4);
      if (approxBytes > 3.5 * 1024 * 1024) return res.status(413).json({ ok: false, error: "VIDEO_SOURCE_TOO_LARGE", message: "Исходное изображение слишком большое. Максимум 3.5 MB." });

      const ratioValue = typeof body.ratio === "string" ? body.ratio : "auto";
      const allowedRatios = new Set(["auto","9:16","16:9"]);
      const ratio = allowedRatios.has(ratioValue) ? ratioValue : "auto";
      const requestedDuration = Number(body.duration ?? 5);
      const duration = Number.isFinite(requestedDuration) ? Math.max(5, Math.min(20, Math.round(requestedDuration))) : 5;
      const payload = { prompt, ratio, duration, imageBase64: rawBase64 };
      const endpoints = ["https://ahm7xmakki.com/api/ptv","https://www.ahm7xmakki.com/api/ptv"];
      let response = null, raw = "", data = {}, lastNetworkError = null;

      for (let endpointIndex = 0; endpointIndex < endpoints.length; endpointIndex++) {
        const endpoint = endpoints[endpointIndex];
        for (let attempt = 0; attempt < 2; attempt++) {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 58000);
          try {
            response = await fetch(endpoint, { method:"POST", headers:{"Content-Type":"application/json",Accept:"application/json"}, body:JSON.stringify(payload), signal:controller.signal });
            raw = await response.text();
            try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
            if (response.ok && data?.success !== false) break;
            if ([408,429,500,502,503,504].includes(response.status) && attempt === 0) { await new Promise(resolve => setTimeout(resolve,1200)); continue; }
            break;
          } catch (error) {
            lastNetworkError = error;
            if (error?.name === "AbortError") return res.status(504).json({ ok:false, error:"VIDEO_TIMEOUT", message:"Motion Synthesis не завершил видео за 58 секунд." });
            if (attempt === 0) { await new Promise(resolve => setTimeout(resolve,1200)); continue; }
            break;
          } finally { clearTimeout(timeout); }
        }
        if (response?.ok && data?.success !== false) break;
      }

      if (lastNetworkError && (!response || !response.ok)) return res.status(502).json({ ok:false, error:"VIDEO_UPSTREAM_UNREACHABLE", message:"Не удалось подключиться к бесплатному Motion Synthesis API.", detail:lastNetworkError?.message || "Upstream connection failed" });
      if (!response || !response.ok || data?.success === false) return res.status(502).json({ ok:false, error:String(data?.error || data?.message || `VIDEO_HTTP_${response?.status || "UNKNOWN"}`), message:"Motion Synthesis не вернул видео.", upstreamStatus:response?.status || null, upstreamBody:raw.slice(0,1000) });

      const videoUrl = typeof data?.videoUrl === "string" && /^https?:\/\//i.test(data.videoUrl) ? data.videoUrl : "";
      if (!videoUrl) return res.status(502).json({ ok:false, error:"VIDEO_URL_MISSING", providerResponse:data });
      return res.status(200).json({ ok:true, mode:"video", status:"completed", provider:"PixelSter", model:"Motion Synthesis", videoUrl, meta:{ transport:"http-json", free:true, endpoint:"/api/ptv", duration, ratio } });
    }

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

    // PixelSter native API. The proven working implementation in the old Miya/Bastyon project used /api/tti and /api/pti.
    const endpointPath = isImageToImage ? "/api/pti" : "/api/tti";
    const endpoints = [
      "https://ahm7xmakki.com" + endpointPath,
      "https://www.ahm7xmakki.com" + endpointPath
    ];

    const requestedCopies = Number(body.copies ?? body.count ?? 1);
    const copies = Number.isFinite(requestedCopies)
      ? Math.max(1, Math.min(4, Math.round(requestedCopies)))
      : 1;

    const safeImagePrompt = isImageToImage
      ? prompt
      : [
          "Create exactly the scene requested by the user.",
          "Do not add water, sand, beach, sea, rain, wet surfaces, puddles, droplets, splashes, mist, smoke, fog, dust, particles, mud or other environmental effects unless the user explicitly asks for them.",
          "Do not add unrequested objects, people, vehicles, props or weather.",
          "Keep the requested scene clean, dry and physically coherent when those effects are not requested.",
          "",
          prompt
        ].join("\n");
    const payload = {
      prompt: safeImagePrompt,
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

      // Proven PixelSter /pti contract: raw base64, without the data-URI prefix.
      payload.imageBase64 = rawBase64;
      payload.prompt = [
        "EDIT THE PROVIDED IMAGE — DO NOT CREATE A DIFFERENT SCENE.",
        "Use the supplied image as the exact source image.",
        "Preserve identity, face, anatomy, clothing, visual style, lighting, camera framing and environment unless the user explicitly asks to change that element.",
        "Apply the user's requested change literally and visibly.",
        "ADD means add exactly the requested object or feature.",
        "REMOVE means remove exactly the requested object or feature.",
        "CHANGE LOCATION means completely replace the surrounding location while keeping the subject. If the user says the subject moved a distance such as 100 meters, change the full visible environment: landscape, buildings, road, vehicles, background objects and perspective should belong to the new location.",
        "CHANGE POSE means visibly change the subject's body position or direction.",
        "Do not add water, rain, droplets, puddles, smoke, fire, particles, extra people, vehicles or props unless explicitly requested.",
        "Do not substitute a similar object. Do not invent an unrelated change. Do not ignore the requested edit.",
        "Return one coherent natural image, not a collage.",
        "",
        "USER EDIT REQUEST:",
        String(prompt).trim()
      ].join("\n");
    }

    let response = null;
    let raw = "";
    let data = {};
    let lastNetworkError = null;

    // One generation request per hostname. The previous implementation
    // retried 3 payload variants x 3 times, which could create nine
    // upstream jobs for one click and trigger fair-use throttling.
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

        if (error?.name === "AbortError") {
          return res.status(504).json({
            ok: false,
            error: "FLUX_TIMEOUT",
            message: isImageToImage
              ? "Flux Kontext Dev не завершил генерацию за 58 секунд."
              : "Flux Dev не завершил генерацию за 58 секунд."
          });
        }

          if (attempt < maxAttempts-1) {
            await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));
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
