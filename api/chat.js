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
      // Image chat: start the dedicated AHM7 vision service and the free
      // BlockRun vision fallback at the same time. This avoids waiting 25s
      // for one upstream to fail before trying the other.
      const callAhm7Vision = async () => {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 12000);
          try {
            const upstream = await fetch("https://ahm7xmakki.com/api/imgchat", {
              method: "POST",
              headers: { "Content-Type": "application/json", "Accept": "application/json" },
              body: JSON.stringify({
                image: imageBase64,
                userPrompt: lastUserText,
                messages: cleanMessages.slice(-12).map(m => ({
                  type: m.role === "assistant" ? "ai" : "user",
                  content: m.content
                }))
              }),
              signal: controller.signal
            });
            const raw = await upstream.text();
            let data = {};
            try { data = raw ? JSON.parse(raw) : {}; } catch {}
            const answer = String(data?.response || data?.text || data?.message || "").trim();
            if (upstream.ok && answer) {
              return {
                ok: true,
                text: answer,
                model: "VisionSter",
                provider: "AHM7 Vision"
              };
            }
            return {
              ok: false,
              provider: "AHM7 Vision",
              model: "VisionSter",
              status: upstream.status,
              upstreamError: data?.error || data?.message || raw.slice(0, 1000)
            };
          } finally {
            clearTimeout(timer);
          }
        } catch (error) {
          return {
            ok: false,
            provider: "AHM7 Vision",
            model: "VisionSter",
            status: null,
            upstreamError: String(error?.message || error)
          };
        }
      };

      const visionModels = new Set([
        "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
        "nvidia/llama-3.2-11b-vision"
      ]);

      const callBlockRunVision = async () => {
        for (const model of [
          "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
          "nvidia/llama-3.2-11b-vision"
        ]) {
          const attempt = await callBlockRun(model);
          if (attempt.ok && visionModels.has(attempt.model)) return attempt;
          if (!attempt.ok) continue;
        }
        return {
          ok: false,
          provider: "BlockRun",
          model: "vision",
          status: null,
          upstreamError: "No usable BlockRun vision model responded."
        };
      };

      // Whichever valid vision answer arrives first wins. This keeps the
      // normal case fast while retaining AHM7 as the preferred dedicated
      // vision provider when it responds first.
      const firstValid = await Promise.race([
        callAhm7Vision().then(r => r.ok ? r : new Promise(() => {})),
        callBlockRunVision().then(r => r.ok ? r : new Promise(() => {}))
      ]);

      return res.status(200).json({
        ok: true,
        mode: "chat",
        text: firstValid.text,
        model: firstValid.model,
        provider: firstValid.provider,
        vision: true
      });
    }

    const cvronPrompt = cleanMessages.slice(-12).map(m => m.role + ": " + m.content).join("\n");
    result = await callCvronGPT5Nano(cvronPrompt);
    if (!result.ok) result = await callBlockRun("nvidia/gpt-oss-20b");
    if (!result.ok) result = await callBlockRun("nvidia/nemotron-3.5-lightning");
    if (!result.ok) result = await callBlockRun("nvidia/nemotron-3-nano-omni-30b-a3b-reasoning");

    if (result.ok) {
      return res.status(200).json({
        ok: true, mode: "chat", text: result.text,
        model: result.model, provider: result.provider
      });
    }

    return res.status(502).json({
      ok: false,
      error: "CHAT_UPSTREAM_FAILED",
      message: "Бесплатные AI-сервисы чата временно недоступны.",
      upstream: result.provider || "unknown",
      upstreamStatus: result.status,
      upstreamStatusText: result.statusText || "",
      upstreamError: result.upstreamError,
      upstreamBody: result.upstreamBody,
      elapsedMs: result.elapsedMs
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
