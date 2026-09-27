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
      max_tokens: 2048
    };

    // First choice: the anonymous multi-provider gateway.
    // Try fast routing, then balanced routing if the fast pool is temporarily empty.
    const faucetModels = ["auto:fast", "auto"];
    let faucetStatus = null;

    for (const model of faucetModels) {
      try {
        const faucet = await fetch("https://api.llmfaucet.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": "Bearer free",
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          body: JSON.stringify({ ...chatPayload, model }),
          signal: AbortSignal.timeout(22000)
        });

        faucetStatus = faucet.status;
        const raw = await faucet.text();
        let data = {};
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch {}

        const answer = String(data?.choices?.[0]?.message?.content || "").trim();

        if (faucet.ok && answer) {
          return res.status(200).json({
            ok: true,
            mode: "chat",
            text: answer,
            model: String(data?.model || model),
            provider: "LLM Faucet"
          });
        }
      } catch {}
    }

    // Direct keyless LLM7 fallback. Its anonymous turbo tier does not
    // require an account or an API key.
    const llm7Models = ["minimax-m2.7", "gpt-oss:20b"];
    let llm7Status = null;

    for (const model of llm7Models) {
      try {
        const llm7 = await fetch("https://api.llm7.io/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          body: JSON.stringify({
            model,
            ...chatPayload
          }),
          signal: AbortSignal.timeout(22000)
        });

        llm7Status = llm7.status;
        const raw = await llm7.text();
        let data = {};
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch {}

        const answer = String(data?.choices?.[0]?.message?.content || "").trim();

        if (llm7.ok && answer) {
          return res.status(200).json({
            ok: true,
            mode: "chat",
            text: answer,
            model: String(data?.model || model),
            provider: "LLM7"
          });
        }
      } catch {}
    }

    return res.status(502).json({
      ok: false,
      error: "CHAT_UPSTREAM_FAILED",
      message: "Бесплатные AI-сервисы чата временно недоступны.",
      upstream: {
        llmFaucet: faucetStatus,
        llm7: llm7Status
      }
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
