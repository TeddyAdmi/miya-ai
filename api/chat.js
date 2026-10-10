async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});

    // Keep transcription inside the existing chat function so Hobby deployments
    // do not need an additional Serverless Function.
    if (body.mode === "transcribe") {
      const token = process.env.CLOUDFLARE_API_TOKEN;
      const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
      if (!token || !accountId) {
        return res.status(500).json({ ok: false, error: "CLOUDFLARE_NOT_CONFIGURED" });
      }
      const audioData = String(body.audio || "").trim();
      const comma = audioData.indexOf(",");
      if (!audioData.startsWith("data:") || comma < 0 || !audioData.slice(comma + 1)) {
        return res.status(400).json({ ok: false, error: "INVALID_AUDIO_DATA_URL" });
      }
      try {
        const upstream = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/@cf/openai/whisper-large-v3-turbo`,
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${token}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              audio: audioData.slice(comma + 1),
              language: String(body.language || "ru"),
              task: "transcribe"
            }),
            signal: AbortSignal.timeout(55000)
          }
        );
        const data = await upstream.json().catch(() => null);
        if (!upstream.ok) {
          console.error("Cloudflare Workers AI STT failed", upstream.status, data);
          return res.status(upstream.status).json({
            ok: false,
            error: "CLOUDFLARE_STT_FAILED",
            details: data?.errors || data?.error || null
          });
        }
        const transcript = String(data?.result?.text || "").trim();
        if (!transcript) return res.status(422).json({ ok: false, error: "TRANSCRIPT_EMPTY" });
        return res.status(200).json({
          ok: true,
          mode: "transcribe",
          text: transcript,
          language: String(body.language || "ru"),
          model: "@cf/openai/whisper-large-v3-turbo"
        });
      } catch (error) {
        console.error("Cloudflare Workers AI STT exception", error);
        return res.status(500).json({ ok: false, error: "CLOUDFLARE_STT_EXCEPTION" });
      }
    }
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const cleanMessages = messages
      .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .map(m => ({ role: m.role, content: m.content.slice(0, 12000) }));

    const suppliedImages = Array.isArray(body.imageBase64s)
      ? body.imageBase64s.filter(value => typeof value === "string" && value.trim()).slice(0, 5).map(value => value.trim())
      : [];
    const imageBase64 = suppliedImages[0] || (typeof body.imageBase64 === "string" ? body.imageBase64.trim() : "");
    const visionImages = suppliedImages.length ? suppliedImages : (imageBase64 ? [imageBase64] : []);
    const imageBytesApprox = visionImages.reduce((sum, value) => sum + Math.floor((value.length * 3) / 4), 0);
    if (visionImages.some(value => !value.startsWith("data:image/")) || imageBytesApprox > 600000) {
      return res.status(413).json({
        ok: false,
        error: "IMAGE_TOO_LARGE",
        message: "Слишком большой набор фотографий для бесплатного vision-запроса. Добавь меньше фото или уменьши их размер."
      });
    }

    if (!cleanMessages.length || cleanMessages[cleanMessages.length - 1].role !== "user") {
      return res.status(400).json({
        ok: false,
        error: "USER_MESSAGE_REQUIRED",
        message: "Нужно сообщение пользователя."
      });
    }

    const system =
      "Ты Miya, дружелюбный AI-помощник внутри Miya AI Studio. " +
      "Отвечай на русском, если пользователь пишет по-русски. " +
      "Помогай с текстами, идеями, сценариями, промптами, изображениями и видео. " +
      "Отвечай полезно и по существу.";

    const lastUserText = cleanMessages[cleanMessages.length - 1].content;

    const blockRunMessages = cleanMessages.slice(-12).map((m, index, arr) => {
      if (visionImages.length && index === arr.length - 1 && m.role === "user") {
        return {
          role: "user",
          content: [
            { type: "text", text: m.content },
            ...visionImages.map(url => ({ type: "image_url", image_url: { url } }))
          ]
        };
      }
      return m;
    });

    const chatPayload = {
      messages: [
        { role: "system", content: system },
        ...blockRunMessages
      ],
      max_tokens: 1024
    };

    async function callCvronGPT5Nano(prompt) {
      const started = Date.now();
      try {
        const endpoint = "https://cvron.alwaysdata.net/cvronai/gpt-5-nano.php";
        const target = new URL(endpoint);
        target.searchParams.set("prompt", prompt);
        const response = await fetch(target.toString(), {
          method:"GET",
          headers:{Accept:"application/json, text/plain, */*"},
          cache:"no-store",
          signal:AbortSignal.timeout(12000)
        });
        const raw = await response.text();
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch {}
        const answer = String(data?.response || data?.text || data?.message || "").trim();
        if(response.ok && answer){
          return {ok:true,text:answer,model:"GPT-5 Nano",provider:"CVRON",status:response.status,elapsedMs:Date.now()-started};
        }
        return {ok:false,status:response.status,provider:"CVRON",model:"GPT-5 Nano",elapsedMs:Date.now()-started,upstreamBody:raw.slice(0,3000),upstreamError:data?.error||data?.message||null};
      }catch(error){
        return {ok:false,status:null,provider:"CVRON",model:"GPT-5 Nano",elapsedMs:Date.now()-started,upstreamBody:"",upstreamError:String(error?.message||error)};
      }
    }

    async function callBlockRun(model, payload = chatPayload) {
      const started = Date.now();
      try {
        const response = await fetch("https://blockrun.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          body: JSON.stringify({ ...payload, model }),
          signal: AbortSignal.timeout(visionImages.length ? 22000 : 12000)
        });

        const raw = await response.text();
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch {}

        const answer = String(data?.choices?.[0]?.message?.content || "").trim();

        if (response.ok && answer) {
          return {
            ok: true,
            text: answer,
            model: String(data?.model || model),
            provider: "BlockRun",
            status: response.status,
            elapsedMs: Date.now() - started
          };
        }

        return {
          ok: false,
          status: response.status,
          statusText: response.statusText,
          provider: "BlockRun",
          model,
          elapsedMs: Date.now() - started,
          upstreamBody: raw.slice(0, 4000),
          upstreamError: data?.error || data?.message || null
        };
      } catch (error) {
        return {
          ok: false,
          status: null,
          provider: "BlockRun",
          model,
          elapsedMs: Date.now() - started,
          upstreamBody: "",
          upstreamError: String(error?.message || error)
        };
      }
    }

    let result;

    if (visionImages.length) {
      // Primary free vision model: NVIDIA Nemotron 3 Nano Omni via BlockRun.
      // It accepts native OpenAI-style image_url content and is free without
      // an API key or wallet. AHM7 remains the next fallback.
      const visionCandidates = [
        "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"
      ];

      for (const model of visionCandidates) {
        result = await callBlockRun(model);

        if (result.ok && result.model === model) {
          return res.status(200).json({
            ok: true,
            mode: "chat",
            text: result.text
          });
        }
      }

      // AHM7 is the second free vision fallback.
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20000);
        const upstream = await fetch("https://ahm7xmakki.com/api/imgchat", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify({
            image: imageBase64,
            userPrompt:
              "Проанализируй это изображение максимально внимательно и точно. " +
              "Не ограничивайся общей подписью. Опиши только то, что действительно видно: " +
              "людей и их внешний вид, позы и действия, одежду, лицо и волосы если различимы, " +
              "предметы и их расположение, фон, помещение или место, освещение, цвета, " +
              "композицию, перспективу, текст и надписи если они читаются, а также заметные " +
              "мелкие детали. Не выдумывай детали, которых невозможно уверенно увидеть. " +
              "Если пользователь задал вопрос об изображении, сначала ответь на него точно, " +
              "а затем добавь полезные наблюдения. Пользовательский запрос: " + lastUserText,
            messages: cleanMessages.slice(-12).map(m => ({
              type: m.role === "assistant" ? "ai" : "user", content: m.content
            }))
          }),
          signal: controller.signal
        });
        clearTimeout(timer);
        const raw = await upstream.text();
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch {}
        const answer = String(data?.response || data?.text || data?.message || "").trim();
        if (upstream.ok && answer) {
          return res.status(200).json({
            ok: true,
            mode: "chat",
            text: answer
          });
        }
      } catch {}

      // Last fallback: the older free vision model.
      result = await callBlockRun("nvidia/llama-3.2-11b-vision");
      if (result.ok && result.model === "nvidia/llama-3.2-11b-vision") {
        return res.status(200).json({
          ok: true,
          mode: "chat",
          text: result.text
        });
      }

      return res.status(502).json({
        ok: false,
        error: "VISION_UPSTREAM_FAILED",
        message: "Бесплатные сервисы анализа изображения временно недоступны."
      });
    }

    const cvronPrompt = cleanMessages.slice(-12).map(m => m.role + ": " + m.content).join("\n");
    // Keep text chat responsive: each provider gets a short timeout. If the
    // primary fallback fails, race the remaining free models instead of
    // waiting through several slow providers one by one.
    result = await callCvronGPT5Nano(cvronPrompt);
    if (!result.ok) result = await callBlockRun("nvidia/gpt-oss-20b");
    if (!result.ok) {
      const fallbackResults = await Promise.all([
        callBlockRun("nvidia/nemotron-3.5-lightning"),
        callBlockRun("nvidia/nemotron-3-nano-omni-30b-a3b-reasoning")
      ]);
      result = fallbackResults.find(candidate => candidate.ok) || result;
    }

    if (result.ok) {
      return res.status(200).json({
        ok: true,
        mode: "chat",
        text: result.text
      });
    }

    return res.status(502).json({
      ok: false,
      error: "CHAT_UPSTREAM_FAILED",
      message: "Бесплатные AI-сервисы чата временно недоступны."
    });

  } catch (error) {
    console.error("Miya Chat:", error);
    return res.status(500).json({
      ok: false,
      error: "CHAT_HANDLER_ERROR",
      message: "Ошибка обработки запроса Miya."
    });
  }
}

module.exports = handler;
