async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const cleanMessages = messages
      .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .map(m => ({ role: m.role, content: m.content.slice(0, 12000) }));

    const imageBase64 = typeof body.imageBase64 === "string" ? body.imageBase64.trim() : "";
    const imageBytesApprox = imageBase64 ? Math.floor((imageBase64.length * 3) / 4) : 0;
    if (imageBase64 && imageBytesApprox > 120000) {
      return res.status(413).json({
        ok: false,
        error: "IMAGE_TOO_LARGE",
        message: "Изображение слишком большое для бесплатного vision-запроса."
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
      if (imageBase64 && index === arr.length - 1 && m.role === "user") {
        return {
          role: "user",
          content: [
            { type: "text", text: m.content },
            { type: "image_url", image_url: { url: imageBase64 } }
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
          signal:AbortSignal.timeout(90000)
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
          signal: AbortSignal.timeout(imageBase64 ? 30000 : 20000)
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

    if (imageBase64) {
      // AHM7 is tried first for image understanding. The instruction asks for
      // concrete visual details rather than a short generic caption.
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 40000);
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

      // If AHM7 is temporarily unavailable, keep the previously working free
      // vision models as a silent fallback.
      const visionModels = new Set([
        "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
        "nvidia/llama-3.2-11b-vision"
      ]);

      const visionCandidates = [
        "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
        "nvidia/llama-3.2-11b-vision"
      ];

      for (const model of visionCandidates) {
        result = await callBlockRun(model);

        if (result.ok && visionModels.has(result.model)) {
          return res.status(200).json({
            ok: true,
            mode: "chat",
            text: result.text
          });
        }

        if (result.ok) {
          result = {
            ...result,
            ok: false,
            upstreamError: "Vision provider returned an unsupported route."
          };
        }
      }

      return res.status(502).json({
        ok: false,
        error: "VISION_UPSTREAM_FAILED",
        message: "Бесплатные сервисы анализа изображения временно недоступны."
      });
    }

    const cvronPrompt = cleanMessages.slice(-12).map(m => m.role + ": " + m.content).join("\n");
    result = await callCvronGPT5Nano(cvronPrompt);
    if (!result.ok) result = await callBlockRun("nvidia/gpt-oss-20b");
    if (!result.ok) result = await callBlockRun("nvidia/nemotron-3.5-lightning");
    if (!result.ok) result = await callBlockRun("nvidia/nemotron-3-nano-omni-30b-a3b-reasoning");

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
