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

      // If a photo is attached and Gemini is unavailable, use the free server-side
      // VisionSter endpoint instead of silently falling back to a text-only model.
      if (chatImageBase64) {
        try {
          const visionResponse = await fetch("https://ahm7xmakki.com/api/imgchat", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify({
              image: chatImageBase64,
              userPrompt: cleanMessages[cleanMessages.length - 1].content,
              messages: cleanMessages.slice(-12).map(m => ({
                type: m.role === "assistant" ? "ai" : "user",
                content: m.content
              }))
            }),
            signal: AbortSignal.timeout(45000)
          });
          const visionData = await visionResponse.json().catch(() => ({}));
          const visionText = String(visionData?.response || visionData?.text || "").trim();
          if (visionResponse.ok && visionText) {
            return res.status(200).json({
              ok: true, mode: "chat", text: visionText,
              model: "VisionSter", provider: "AHM7 Vision", usage: null
            });
          }
        } catch (visionError) {
          console.warn("Miya VisionSter fallback:", visionError?.message || visionError);
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

    if (body.mode === "pixel-audio") {
      const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
      if (!prompt) return res.status(400).json({ok:false,error:"PROMPT_REQUIRED"});
      const requestedDuration = Number(body.duration ?? 10);
      const duration = Number.isFinite(requestedDuration) ? Math.max(5, Math.min(20, Math.round(requestedDuration))) : 10;
      const generatedAudio = await generatePixelSound(prompt, duration);
      if (!generatedAudio) {
        return res.status(502).json({ok:false,error:"PIXEL_AUDIO_FAILED",message:"TangoFlux не вернул звуковую дорожку. Повторите генерацию звука."});
      }
      return res.status(200).json({
        ok:true, mode:"pixel-audio", provider:"TangoFlux",
        audioBase64:generatedAudio.audioBase64, audioMime:generatedAudio.audioMime,
        duration
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
      const duration = Number.isFinite(requestedDuration) ? Math.max(1, Math.min(10, requestedDuration)) : 3;
      try {
        const { Client, handle_file } = await import("@gradio/client");
        const client = await Promise.race([
          Client.connect("Lightricks/LTX-2-3"),
          new Promise((_, reject) => setTimeout(() => reject(new Error("LTX Space connection timeout")), 15000))
        ]);
        // Current LTX-2.3 Space signature:
        // image, prompt, duration, enhance_prompt, seed, randomize_seed, height, width.
        // Keep prompt enhancement OFF so the user's exact motion instructions remain authoritative.
        let inputImage = null;
        if (imageBase64) {
          const raw = imageBase64.replace(/^data:image\/[^;]+;base64,/i, "").replace(/^base64,/i, "").replace(/\s+/g, "");
          if (!raw || raw.length < 100) return res.status(400).json({ok:false, error:"INVALID_VIDEO_SOURCE", message:"Исходное изображение для LTX-2.3 некорректно."});
          const approxBytes = Math.ceil(raw.length * 3 / 4);
          if (approxBytes > 3.5 * 1024 * 1024) return res.status(413).json({ok:false, error:"VIDEO_SOURCE_TOO_LARGE", message:"Исходное изображение слишком большое. Максимум 3.5 MB."});
          inputImage = handle_file(new Blob([Buffer.from(raw, "base64")], { type:"image/png" }));
        }

        // LTX-2.3 Distilled ZeroGPU exposes the exact generate_video signature
        // used here. Keep the dimensions explicit so the selected ratio is not
        // silently replaced by the Space's UI preset.
        let width=1536,height=1024;
        if(ratio==="9:16"){width=1024;height=1536}
        else if(ratio==="1:1"){width=1024;height=1024}

        const highFidelityPrompt = String(prompt || "").trim();
        const enhancePrompt = false;
        const randomizeSeed = true;
        const seed = Math.floor(Math.random()*2147483647);

        const result=await client.predict("/generate_video",[
          inputImage,
          highFidelityPrompt,
          duration,
          enhancePrompt,
          seed,
          randomizeSeed,
          height,
          width
        ]);

        // Gradio's FileData shape can vary between Space/SDK versions.
        // Walk the returned object instead of assuming data[0].url.
        const findVideoUrl=(value,seen=new Set())=>{
          if(value==null)return "";
          if(typeof value==="string"){
            return /^https?:\/\//i.test(value) ? value : "";
          }
          if(typeof value!=="object"||seen.has(value))return "";
          seen.add(value);
          const preferred=["url","videoUrl","video_url","path","file","data","value"];
          for(const key of preferred){
            const found=findVideoUrl(value[key],seen);
            if(found)return found;
          }
          for(const key of Object.keys(value)){
            const found=findVideoUrl(value[key],seen);
            if(found)return found;
          }
          return "";
        };
        const videoUrl=findVideoUrl(result?.data)||findVideoUrl(result);
        if(!videoUrl) {
          console.error("LTX-2.3 returned no public video URL",result);
          return res.status(502).json({ok:false,error:"LTX_VIDEO_URL_MISSING",message:"LTX-2.3 не вернул доступный MP4.",providerResponse:result});
        }
        return res.status(200).json({
          ok:true,mode:"video",status:"completed",provider:"Lightricks",
          model:"LTX-2.3 Distilled · Video + Audio",videoUrl,
          meta:{transport:"server-gradio",free:true,synchronizedAudio:true,duration,ratio,width,height,highResolution:true,enhancePrompt:false,randomizeSeed:true}
        });
      } catch(error) {
        console.error("Miya LTX server:",error);
        return res.status(502).json({ok:false,error:"LTX_UPSTREAM_FAILED",message:"LTX-2.3 не завершил генерацию. Генерация сброшена — можно сразу повторить.",detail:error?.message||"Gradio request failed"});
      }
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
    const endpoint = "https://ahm7xmakki.com" + endpointPath;
    const endpoints = [
      endpoint,
      "https://www.ahm7xmakki.com" + endpointPath
    ];

    const payload = {
      prompt,
      ratio: isImageToImage && ratio === "1:1" ? "auto" : ratio
    };

    if (imageUrl) payload.imageUrl = imageUrl;
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

    let response = null;
    let raw = "";
    let data = {};
    let lastError = null;

    for (const currentEndpoint of endpoints) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 50000);
      try {
        response = await fetch(currentEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        raw = await response.text();
        try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
        if (response.ok && data?.success !== false) break;
        lastError = new Error("HTTP " + response.status);
        if (![408,429,500,502,503,504].includes(response.status)) break;
      } catch (error) {
        lastError = error;
      } finally {
        clearTimeout(timeout);
      }
    }

    if (!response || !response.ok || data?.success === false) {
      if (lastError?.name === "AbortError") {
        return res.status(504).json({
          ok: false,
          error: "FLUX_TIMEOUT",
          message: isImageToImage
            ? "Flux Kontext Dev не завершил генерацию вовремя."
            : "Flux Dev не завершил генерацию вовремя."
        });
      }
      return res.status(502).json({
        ok: false,
        error: String(data?.error || data?.message || (response ? "FLUX_HTTP_" + response.status : "FLUX_UPSTREAM_UNREACHABLE")),
        upstreamStatus: response?.status || 0,
        upstreamBody: raw.slice(0, 500)
      });
    }

    if (!response.ok || data?.success === false) {
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
        endpoint: isImageToImage ? "/api/pti" : "/api/tti",
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
