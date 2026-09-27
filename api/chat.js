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

    // Image chat is intentionally isolated from text chat.
    if (imageBase64) {
      const visionPayload = {
        image: imageBase64,
        userPrompt: cleanMessages[cleanMessages.length - 1].content,
        messages: cleanMessages.slice(-12).map(m => ({
          type: m.role === "assistant" ? "ai" : "user",
          content: m.content
        }))
      };

      for (let attempt = 1; attempt <= 2; attempt++) {
        let timer = null;
        try {
          const controller = new AbortController();
          timer = setTimeout(() => controller.abort(), 25000);

          const upstream = await fetch("https://ahm7xmakki.com/api/imgchat", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Accept": "application/json"
            },
            body: JSON.stringify(visionPayload),
            signal: controller.signal
          });

          const raw = await upstream.text();
          let data = {};
          try {
            data = raw ? JSON.parse(raw) : {};
          } catch {}

          const answer = String(
            data?.response ||
            data?.text ||
            data?.message ||
            ""
          ).trim();

          if (upstream.ok && answer) {
            return res.status(200).json({
              ok: true,
              mode: "chat",
              text: answer,
              model: "VisionSter",
              provider: "AHM7 Vision"
            });
          }

          if (attempt === 2) {
            return res.status(502).json({
              ok: false,
              error: "VISION_UPSTREAM_FAILED",
              message: "Сервис анализа изображения временно недоступен.",
              upstreamStatus: upstream.status
            });
          }
        } catch (error) {
          if (attempt === 2) {
            return res.status(502).json({
              ok: false,
              error: "VISION_UPSTREAM_FAILED",
              message: "Не удалось подключиться к сервису анализа изображения.",
              detail: String(error?.message || error)
            });
          }
        } finally {
          if (timer) clearTimeout(timer);
        }
      }
    }

    const chatPayload = {
      messages: [
        { role: "system", content: system },
        ...cleanMessages.slice(-12)
      ],
      max_tokens: 1024
    };

    async function callLlm7(model) {
      try {
        const response = await fetch("https://api.llm7.io/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify({ model, ...chatPayload }),
          signal: AbortSignal.timeout(10000)
        });
        const raw = await response.text();
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch {}
        const answer = String(data?.choices?.[0]?.message?.content || "").trim();
        return response.ok && answer
          ? { ok:true, text:answer, model:String(data?.model || model), provider:"LLM7" }
          : { ok:false, status:response.status };
      } catch {
        return { ok:false, status:null };
      }
    }

    async function callFaucet(model) {
      try {
        const response = await fetch("https://api.llmfaucet.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": "Bearer free",
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          body: JSON.stringify({ ...chatPayload, model }),
          signal: AbortSignal.timeout(7000)
        });
        const raw = await response.text();
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch {}
        const answer = String(data?.choices?.[0]?.message?.content || "").trim();
        return response.ok && answer
          ? { ok:true, text:answer, model:String(data?.model || model), provider:"LLM Faucet" }
          : { ok:false, status:response.status };
      } catch {
        return { ok:false, status:null };
      }
    }

    // Prefer fast, explicit LLM7 models instead of "default": the default
    // route is dynamically randomized and can land on a slow/degraded model.
    // LLM7 currently reports healthy fast traffic for these models.
    async function firstSuccessful(calls) {
      const wrapped = calls.map(call =>
        call().then(result => result?.ok ? result : Promise.reject(result))
      );
      try {
        return await Promise.any(wrapped);
      } catch {
        return null;
      }
    }

    // Use provider routing selectors instead of hard-coded model IDs.
    // This keeps the free chat path working when an individual model is
    // unavailable or temporarily requires authenticated access.
    const firstWave = [
      () => callLlm7("fast"),
      () => callLlm7("default"),
      () => callFaucet("auto:fast")
    ];

    const winner = await firstSuccessful(firstWave);
    if (winner) {
      return res.status(200).json({
        ok:true, mode:"chat", text:winner.text,
        model:winner.model, provider:winner.provider
      });
    }

    const secondWave = [
      () => callLlm7("default"),
      () => callFaucet("auto"),
      () => callFaucet("auto:smart")
    ];

    const fallbackWinner = await firstSuccessful(secondWave);
    if (fallbackWinner) {
      return res.status(200).json({
        ok:true, mode:"chat", text:fallbackWinner.text,
        model:fallbackWinner.model, provider:fallbackWinner.provider
      });
    }

    return res.status(502).json({
      ok:false,
      error:"CHAT_UPSTREAM_FAILED",
      message:"Бесплатные AI-сервисы чата временно недоступны.",
      upstream:"llm7/faucet"
    });
  } catch (error) {
    console.error("Miya Chat:", error);
    return res.status(500).json({
      ok: false,
      error: "CHAT_HANDLER_ERROR",
      message: "Ошибка обработки запроса Miya.",
      detail: String(error?.message || error)
    });
  }
}

module.exports = handler;
