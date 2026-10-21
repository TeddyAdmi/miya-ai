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

    // Accept both current clients (imageBase64/imageBase64s) and older chat
    // clients that attach the data URL directly to messages[n].image.
    const suppliedImages = Array.isArray(body.imageBase64s)
      ? body.imageBase64s.filter(value => typeof value === "string" && value.trim()).slice(0, 5).map(value => value.trim())
      : [];
    const bodyImage = typeof body.imageBase64 === "string" ? body.imageBase64.trim() : "";
    const embeddedImages = messages
      .filter(m => m && m.role === "user")
      .flatMap(m => [
        ...(typeof m.image === "string" ? [m.image] : []),
        ...(Array.isArray(m.images) ? m.images.filter(value => typeof value === "string") : [])
      ])
      .map(value => value.trim())
      .filter(Boolean)
      .slice(0, 5);
    let visionImages = suppliedImages.length ? suppliedImages : (bodyImage ? [bodyImage] : embeddedImages);
    let imageBase64 = visionImages[0] || "";
    let imageBytesApprox = visionImages.reduce((sum, value) => sum + Math.floor((value.length * 3) / 4), 0);

    if (visionImages.some(value => !/^data:image\/(jpeg|jpg|png|webp|gif|avif);base64,/i.test(value))) {
      return res.status(400).json({
        ok: false,
        error: "INVALID_IMAGE_DATA",
        message: "Не удалось прочитать прикреплённую фотографию. Прикрепи изображение ещё раз."
      });
    }

    // Keep the upstream payload small enough for free vision services. Older
    // clients may send an uncompressed image, so downscale/re-encode it here.
    if (visionImages.length && imageBytesApprox > 520000) {
      try {
        const sharp = require("sharp");
        visionImages = await Promise.all(visionImages.map(async value => {
          const comma = value.indexOf(",");
          const input = Buffer.from(value.slice(comma + 1), "base64");
          const output = await sharp(input)
            .rotate()
            .resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true })
            .jpeg({ quality: 76, mozjpeg: true })
            .toBuffer();
          return "data:image/jpeg;base64," + output.toString("base64");
        }));
        imageBase64 = visionImages[0] || "";
        imageBytesApprox = visionImages.reduce((sum, value) => sum + Math.floor((value.length * 3) / 4), 0);
      } catch (error) {
        console.error("Miya vision image normalization failed", error?.message || error);
        return res.status(415).json({
          ok: false,
          error: "IMAGE_PREPROCESSING_FAILED",
          message: "Не удалось подготовить фотографию для анализа. Попробуй загрузить её ещё раз."
        });
      }
    }

    if (imageBytesApprox > 600000) {
      return res.status(413).json({
        ok: false,
        error: "IMAGE_TOO_LARGE",
        message: "Фотография слишком большая даже после сжатия. Попробуй загрузить изображение меньшего размера."
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
      "Всегда отвечай пользователю на русском языке независимо от языка его сообщения. Переключайся на другой язык только если пользователь прямо попросил ответить на нём. " +
      "Помогай с текстами, идеями, сценариями, промптами, изображениями и видео. " +
      "Отвечай полезно и по существу. " +
      "Оформляй ответы чистым Markdown: используй короткие понятные заголовки для смысловых разделов, " +
      "абзацы с хорошими отступами и списки только там, где они реально упрощают чтение. " +
      "Выделяй важные термины и выводы жирным; добавляй уместные эмодзи умеренно, не в каждой строке. " +
      "Не делай длинные сплошные полотна, не превращай каждое предложение в пункт и не дублируй выводы. " +
      "Любые готовые промпты для генерации изображений и видео пиши исключительно на русском языке, включая описание сцены, персонажей, действий, камеры, освещения, стиля и деталей. " +
      "Промпты для изображений и видео всегда пиши на русском языке, даже если модель или сервис обычно использует английский. Для каждого промпта обязательно выведи отдельный заголовок «Промпт для изображения:» или «Промпт для видео:», а сам промпт помести в отдельный fenced code block. Не добавляй английскую копию промпта, если пользователь прямо её не попросил. " +
      "Для готовых промптов, кода и текста для копирования используй отдельный fenced code block. " +
      "Не показывай служебные символы форматирования как буквальный текст и не используй звёздочки как декоративные маркеры.";

    const lastUserText = cleanMessages[cleanMessages.length - 1].content;

    // Some upstream chat endpoints ignore the persona instruction and emit a canned
    // "I'm GPT-6 Luna, not Miya" correction. Reject that answer and use a fallback.
    const isWrongMiyaIdentity = value => {
      const text = String(value || "").trim();
      if (!text) return true;
      // Reject alternate identity claims and canned corrections from upstream providers.
      const claimsForeignIdentity =
        /(?:^|[.!?\n])\s*(?:я|меня зовут|мо[её] имя|на самом деле я|я на самом деле|i am|i'm|my name is|actually,?\s*i am)\b[^.!?\n]{0,100}\b(?:gpt\s*[- ]?6(?:\s*[- ]?luna)?|gpt\s*[- ]?5\s*nano|luna|луна)\b/i.test(text) ||
        /(?:gpt\s*[- ]?6(?:\s*[- ]?luna)?|luna|луна)[^.!?\n]{0,100}(?:это я|я на самом деле|меня зовут|моя модель|my name is|i am|i'm)/i.test(text);
      const arguesAboutName =
        /(?:вы\s+(?:ошиблись|ошибочно\s+назвали)|ошибочно\s+назвали|вы\s+сказали,?\s*что\s+(?:ваше\s+имя|меня)|не\s+называйте\s+меня|я\s+не\s+(?:мия|miya)|не\s+являюсь\s+(?:мией|miya)|i am not miya|you (?:are|have) (?:mistaken|wrong)|you called me incorrectly)/i.test(text);
      const identityName = /(?:gpt\s*[- ]?6|gpt\s*[- ]?5\s*nano|luna|луна|мия|miya)/i.test(text);
      return claimsForeignIdentity || (arguesAboutName && identityName);
    };

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

    function extractProviderText(payload) {
      const excludedType = /^(?:analysis|reasoning|thinking|thought|chain_of_thought|tool_call|tool_use|refusal|meta)$/i;
      const preferredKeys = ["output_text", "response", "text", "answer", "generated_text", "completion", "content", "choices", "candidates", "result", "output", "data", "message"];
      const read = (value, depth = 0, inheritedType = "") => {
        if (depth > 7 || value == null) return "";
        if (typeof value === "string") return value.trim();
        if (typeof value === "number" || typeof value === "boolean") return "";
        if (Array.isArray(value)) {
          return value.map(item => {
            const kind = item && typeof item === "object" ? String(item.type || item.kind || "") : "";
            if (excludedType.test(kind)) return "";
            return read(item, depth + 1, kind);
          }).filter(Boolean).join("\n").trim();
        }
        if (typeof value !== "object") return "";
        const kind = String(value.type || value.kind || inheritedType || "");
        if (excludedType.test(kind)) return "";
        for (const key of preferredKeys) {
          if (value[key] == null) continue;
          const result = read(value[key], depth + 1, key);
          if (result) return result;
        }
        return "";
      };
      return read(payload);
    }

    async function callCvronGPT5Nano(prompt, timeoutMs = 12000) {
      const started = Date.now();
      try {
        const endpoint = "https://cvron.alwaysdata.net/cvronai/gpt-5-nano.php";
        const target = new URL(endpoint);
        target.searchParams.set("prompt", prompt);
        const response = await fetch(target.toString(), {
          method:"GET",
          headers:{Accept:"application/json, text/plain, */*"},
          cache:"no-store",
          signal:AbortSignal.timeout(Number(timeoutMs) > 0 ? Number(timeoutMs) : 12000)
        });
        const raw = await response.text();
        let data = {};
        let parsedJson = false;
        try { data = raw ? JSON.parse(raw) : {}; parsedJson = !!raw; } catch {}
        const answer = (extractProviderText(data) || (!parsedJson ? raw : "")).trim();
        if(response.ok && answer){
          return {ok:true,text:answer,model:"GPT-5 Nano",provider:"CVRON",status:response.status,elapsedMs:Date.now()-started};
        }
        return {ok:false,status:response.status,provider:"CVRON",model:"GPT-5 Nano",elapsedMs:Date.now()-started,upstreamBody:raw.slice(0,3000),upstreamError:data?.error||data?.message||null};
      }catch(error){
        return {ok:false,status:null,provider:"CVRON",model:"GPT-5 Nano",elapsedMs:Date.now()-started,upstreamBody:"",upstreamError:String(error?.message||error)};
      }
    }

    async function callBlockRun(model, payload = chatPayload, timeoutMs = 0) {
      const started = Date.now();
      try {
        const response = await fetch("https://blockrun.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          body: JSON.stringify({ ...payload, model }),
          signal: AbortSignal.timeout(Number(timeoutMs) > 0 ? Number(timeoutMs) : (visionImages.length ? 16000 : 12000))
        });

        const raw = await response.text();
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch {}

        const answer = extractProviderText(data);

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

    async function callCloudflarePrompt(messages, timeoutMs = 10000) {
      const started = Date.now();
      const token = process.env.CLOUDFLARE_API_TOKEN;
      const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
      if (!token || !accountId) {
        return { ok: false, provider: "Cloudflare Workers AI", model: "@cf/openai/gpt-oss-20b", status: null, elapsedMs: Date.now() - started, upstreamError: "CLOUDFLARE_NOT_CONFIGURED" };
      }
      try {
        const response = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/v1/chat/completions`,
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${token}`,
              "Content-Type": "application/json",
              "Accept": "application/json"
            },
            body: JSON.stringify({
              model: "@cf/openai/gpt-oss-20b",
              messages,
              temperature: 0.95,
              top_p: 0.92,
              max_tokens: 650,
              stream: false
            }),
            signal: AbortSignal.timeout(timeoutMs)
          }
        );
        const raw = await response.text();
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch {}
        const answer = extractProviderText(data);
        if (response.ok && answer) {
          return { ok: true, text: answer, model: String(data?.model || "@cf/openai/gpt-oss-20b"), provider: "Cloudflare Workers AI", status: response.status, elapsedMs: Date.now() - started };
        }
        return {
          ok: false,
          provider: "Cloudflare Workers AI",
          model: "@cf/openai/gpt-oss-20b",
          status: response.status,
          elapsedMs: Date.now() - started,
          upstreamBody: raw.slice(0, 1800),
          upstreamError: data?.errors?.map(item => item?.message || item?.code || "").filter(Boolean).join("; ") || data?.error?.message || data?.message || "CLOUDFLARE_EMPTY_RESPONSE"
        };
      } catch (error) {
        return { ok: false, provider: "Cloudflare Workers AI", model: "@cf/openai/gpt-oss-20b", status: null, elapsedMs: Date.now() - started, upstreamError: String(error?.message || error) };
      }
    }

    let result;

    // Dedicated image-prompt enhancement: bypass the generic chat provider,
    // whose CVRON endpoint can ignore the instruction and return a persona greeting.
    if (body.mode === "improve_image_prompt") {
      const originalPrompt = String(body.prompt || lastUserText || "").trim().slice(0, 8000);
      if (!originalPrompt) {
        return res.status(400).json({ ok: false, error: "PROMPT_REQUIRED", message: "Сначала введи промпт." });
      }

      const creativeId = Math.random().toString(36).slice(2, 9) + "-" + Date.now().toString(36);
      const systemPrompt = "Ты — художник-концептуалист. По короткой идее пользователя самостоятельно придумай цельную, выразительную сцену для одного статичного изображения. Сохрани смысл и все явно заданные условия; всё неуказанное реши сам, руководствуясь логикой идеи. При каждом новом запуске с тем же запросом находи новую самостоятельную трактовку: меняй само визуальное решение и содержание сцены, а не только ракурс или прилагательные. Все детали должны быть естественно связаны между собой. Не используй готовые сюжеты, повторяющиеся наборы деталей или заученные формулировки. Пиши грамотным естественным русским, одним содержательным абзацем примерно на 50–90 слов. Верни только видимую сцену — без анализа, пояснений, заголовка и технических параметров. Ключ творческого варианта: " + creativeId + ". Не упоминай ключ в ответе.";
      const promptPayload = {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: "Исходная идея:\n" + originalPrompt + "\nПридумай самостоятельный новый вариант и верни только готовое описание сцены." }
        ],
        temperature: 1.0,
        max_tokens: 700
      };

      let lastNormalizationReason = "EMPTY_RESPONSE";
      const normalizeCandidate = (rawValue, provider) => {
        let value = String(rawValue || "").trim()
          .replace(/^\s*\x60{3}(?:\w+)?\s*/i, "")
          .replace(/\s*\x60{3}\s*$/, "")
          .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, " ")
          .replace(/<analysis\b[^>]*>[\s\S]*?<\/analysis>/gi, " ")
          .replace(/<reasoning\b[^>]*>[\s\S]*?<\/reasoning>/gi, " ")
          .trim();
        const reject = reason => { lastNormalizationReason = reason; return null; };
        if (!value) return reject("EMPTY_TEXT");

        const metaLead = /^(?:пользователь\s+(?:просит|хочет|говорит|предлагает)|задача\s*[:：—-]|задание\s*[:：—-]|план\s*[:：—-]|анализ\s*[:：—-]|рассуждение\s*[:：—-]|нужно\s+(?:написать|описать|создать|превратить|придумать)|ответ\s+должен|требуется\s+(?:написать|описать|создать)|сначала\s+нужно|вот\s+как\s+нужно|the user (?:asks|wants)|we need to|let me think|analysis\s*:|reasoning\s*:|draft\s*:|task\s*:)/i;
        const markers = [...value.matchAll(/(?:^|\n)\s*(?:финальный ответ|final answer|final prompt|improved prompt|готовый промпт|улучшенный промпт|итоговый промпт|итоговый вариант|финальный вариант|промпт для изображения|описание сцены|готовое описание|сцена|черновик|draft)\s*[:：—–-]\s*/gi)];
        if (markers.length) {
          const marker = markers[markers.length - 1];
          value = value.slice(marker.index + marker[0].length).trim();
          value = value.split(/\n\s*\n+/)[0].trim();
        } else {
          const paragraphs = value.split(/\n\s*\n+/).map(part => part.trim()).filter(Boolean);
          if (paragraphs.length > 1) {
            const candidates = paragraphs.filter(part =>
              !metaLead.test(part) &&
              !/^(?:analysis|reasoning|notes|explanation|task|requirements|draft|план|анализ|рассуждение|требования)\s*[:：—-]/i.test(part) &&
              (/[А-Яа-яЁё]/.test(part) || !/[A-Za-z]{3,}/.test(part))
            );
            if (candidates.length) value = candidates[candidates.length - 1];
          }
        }

        value = value
          .replace(/^\s*(?:(?:готовый|улучшенный|итоговый|финальный)\s+промпт|промпт\s+для\s+изображения|промпт|описание\s+изображения|описание\s+сцены|готовое описание|сцена|финальный ответ|final answer|final prompt|draft)\s*[:：—–-]\s*/i, "")
          .replace(/^["'«]+|["'»]+$/g, "")
          .replace(/\s+/g, " ")
          .trim();
        if (!value) return reject("EMPTY_AFTER_CLEANUP");

        // If the provider returned planning text only, reject that text; don't mistake one meta phrase
        // inside an otherwise valid scene for a reason to discard the entire answer.
        if (metaLead.test(value)) return reject("PLANNING_TEXT_ONLY");
        if (/^(?:as an ai|i cannot help|i am an ai|я не могу выполнить|я не могу создать|я должен объяснить)/i.test(value)) return reject("NOT_A_SCENE");

        const wordCount = value.split(/\s+/).filter(Boolean).length;
        const cyrillic = (value.match(/[А-Яа-яЁё]/g) || []).length;
        const latin = (value.match(/[A-Za-z]/g) || []).length;
        const normalized = text => String(text || "").replace(/[\s.!?,;:—–-]+/g, " ").trim().toLocaleLowerCase("ru-RU");
        if (value.length < 24 || wordCount < 4 || cyrillic < 10) return reject("TOO_SHORT_OR_NOT_RUSSIAN");
        if (latin > Math.max(35, cyrillic * 1.5)) return reject("NOT_RUSSIAN_ENOUGH");
        if (normalized(value) === normalized(originalPrompt)) return reject("NO_EXPANSION");
        if (/^(?:создай|выбери|придумай|добавь|покажи|опиши|сгенерируй|напиши|укажи|представь себе)(?=$|[\s,.:;—–])/i.test(value)) return reject("INSTRUCTION_NOT_SCENE");
        if (value.length > 2000 || wordCount > 240) return reject("RESPONSE_TOO_LONG");
        if (!/[.!?…]$/.test(value)) value += ".";
        lastNormalizationReason = "";
        return { text: value, provider, wordCount, length: value.length };
      }

      const cvronPrompt = systemPrompt + "\n\nЗАДУМКА ПОЛЬЗОВАТЕЛЯ:\n" + originalPrompt + "\n\nВерни только готовый промпт.";
      const attempts = [
        {
          provider: "Cloudflare Workers AI / GPT-OSS 20B",
          promise: callCloudflarePrompt(promptPayload.messages, 10000)
        },
        {
          provider: "BlockRun / GPT-OSS",
          promise: callBlockRun("nvidia/gpt-oss-20b", promptPayload, 18000)
        },
        {
          provider: "BlockRun / Nemotron",
          promise: callBlockRun("nvidia/nemotron-3.5-lightning", promptPayload, 18000)
        },
        {
          provider: "CVRON / GPT-5 Nano",
          promise: callCvronGPT5Nano(systemPrompt + "\n\nИсходная идея:\n" + originalPrompt + "\n\nВерни только готовое описание сцены.", 18000)
        }      ].map((attempt, index) => ({
        index,
        provider: attempt.provider,
        promise: attempt.promise.then(result => ({ result, index, provider: attempt.provider }))
      }));

      // Providers race in parallel; a valid scene is returned as soon as one is ready.
      const providerDiagnostics = [];
      // This avoids spending another full timeout on a second-stage rescue call.
      while (attempts.length) {
        const settled = await Promise.race(attempts.map(attempt => attempt.promise));
        const position = attempts.findIndex(attempt => attempt.index === settled.index);
        if (position >= 0) attempts.splice(position, 1);

        const result = settled.result || {};
        const rawText = String(result.text || "").trim();
        const normalized = result.ok ? normalizeCandidate(rawText, settled.provider) : null;
        const diagnostic = {
          provider: settled.provider,
          ok: !!result.ok,
          status: result.status || null,
          elapsedMs: result.elapsedMs || null,
          error: String(typeof result.upstreamError === "string" ? result.upstreamError : (result.upstreamError?.message || result.upstreamError || "")).slice(0, 180),
          responseLength: rawText.length,
          rejected: result.ok && rawText ? (normalized ? null : lastNormalizationReason) : null
        };
        providerDiagnostics.push(diagnostic);
        if (normalized) {
          return res.status(200).json({ ok: true, mode: "improve_image_prompt", text: normalized.text });
        }

        console.warn("Miya image prompt provider result rejected", diagnostic);
      }

      // One more independent attempt is important for intermittently slow free providers.
      // It uses the same abstract creative brief and contains no preset subjects or scene examples.
      const rescuePrompt = systemPrompt + "\n\nИсходная идея пользователя:\n" + originalPrompt +
        "\n\nПридумай новый, самостоятельный вариант сцены по этой идее. Сразу верни только один готовый русский абзац без рассуждений и заголовков.";
      const rescue = await callCvronGPT5Nano(rescuePrompt, 12000);
      const rescueRaw = String(rescue?.text || "").trim();
      const rescueCandidate = rescue?.ok ? normalizeCandidate(rescueRaw, "CVRON / GPT-5 Nano (повторная попытка)") : null;
      providerDiagnostics.push({
        provider: "CVRON / GPT-5 Nano (повторная попытка)",
        ok: !!rescue?.ok,
        status: rescue?.status || null,
        elapsedMs: rescue?.elapsedMs || null,
        error: String(typeof rescue?.upstreamError === "string" ? rescue.upstreamError : (rescue?.upstreamError?.message || rescue?.upstreamError || "")).slice(0, 180),
        responseLength: rescueRaw.length,
        rejected: rescue?.ok && rescueRaw ? (rescueCandidate ? null : "RESPONSE_NOT_ACCEPTED") : null
      });
      if (rescueCandidate) {
        return res.status(200).json({ ok: true, mode: "improve_image_prompt", text: rescueCandidate.text });
      }

      return res.status(502).json({
        ok: false,
        error: "IMAGE_PROMPT_CREATION_FAILED",
        message: "Не удалось получить ответ от генераторов описания сцены.",
        diagnostics: providerDiagnostics
      });
    }

    if (visionImages.length) {
      // AHM7 VisionSter documents and accepts the exact data:image/... URL
      // used by Miya. Prefer it over generic BlockRun completions, which can
      // return a successful text-only answer while claiming no image exists.
      const ahm7Started = Date.now();
      let ahm7Result = null;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 16000);
      try {
        const upstream = await fetch("https://www.ahm7xmakki.com/api/imgchat", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify({
            image: imageBase64,
            userPrompt:
              "Ты Miya. В сообщении приложено изображение в поле image. Обязательно проанализируй именно это изображение, а не только текст вопроса. Не говори, что фото не прикреплено, если запрос содержит image. Отвечай по-русски. Опиши только действительно видимые детали, композицию, людей, предметы, фон, освещение и стиль; не выдумывай невидимое. Сначала ответь на вопрос пользователя. Если пользователь просит промпт для изображения или видео, обязательно напиши полноценный, подробный промпт на русском языке. После заголовка «Промпт для изображения:» или «Промпт для видео:» всегда должен идти сам текст промпта; никогда не заканчивай ответ на одном заголовке. Сам промпт не помещай в цитату, пиши его отдельным fenced code block, с переносами строк при необходимости. Вопрос пользователя: " + lastUserText,
            messages: cleanMessages.slice(-12).map(m => ({
              type: m.role === "assistant" ? "ai" : "user", content: m.content
            }))
          }),
          signal: controller.signal
        });
        const raw = await upstream.text();
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch {}
        const answer = String(data?.response || data?.text || data?.message || "").trim();
        const saysNoImage = /(?:cannot|can't|can not|unable to|don't|do not) (?:see|view|access|analy[sz]e) (?:the |any |this |that )?(?:image|photo|picture)|(?:no|not) image (?:was )?(?:attached|provided|uploaded)|please (?:upload|attach|send) (?:an? )?(?:image|photo|picture)|не вижу (?:изображени|фотографи|фото)|не прикреплен[аоы]? (?:изображени|фотографи|фото)/i.test(answer);
        if (upstream.ok && answer && data?.success !== false && !saysNoImage) {
          let finalAnswer = answer;
          const emptyPromptHeading = answer.match(/(?:^|\n)\s*(?:#{1,6}\s*)?(?:\*\*)?(Промпт для (изображения|видео))\s*[:：]?\s*(?:\*\*)?\s*$/i);
          if (emptyPromptHeading) {
            const promptTitle = /видео/i.test(emptyPromptHeading[1]) ? "Промпт для видео:" : "Промпт для изображения:";
            const analysisText = answer.slice(0, emptyPromptHeading.index).trim();
            try {
              const promptResponse = await fetch("https://www.ahm7xmakki.com/api/imgchat", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Accept": "application/json" },
                body: JSON.stringify({
                  image: imageBase64,
                  userPrompt:
                    "Ты Miya. По прикреплённому изображению и описанию ниже составь только готовый подробный промпт на русском языке для генерации изображения. Не описывай свой процесс, не отвечай на исходный вопрос, не добавляй цитату, вступление или заголовок. Верни только сам текст промпта, минимум 3 конкретных предложения. Сохрани композицию, объекты, цвета, формы, пропорции и стиль исходного изображения; не придумывай невидимые детали. Описание изображения: " + analysisText + "\nЗапрос пользователя: " + lastUserText
                }),
                signal: AbortSignal.timeout(9000)
              });
              const promptData = await promptResponse.json().catch(() => null);
              let generatedPrompt = String(promptData?.response || promptData?.text || promptData?.message || "").trim();
              generatedPrompt = generatedPrompt
                .replace(/^\s*\x60{3}[^\n]*\n?/,"")
                .replace(/\n?\x60{3}\s*$/,"")
                .replace(/^(?:#{1,6}\s*)?(?:\*\*)?Промпт для (?:изображения|видео)\s*[:：]?\s*(?:\*\*)?\s*/i,"")
                .trim();
              if (promptResponse.ok && promptData?.success !== false && generatedPrompt.length >= 40 &&
                  !/не могу|не удалось|недостаточно информации|please upload/i.test(generatedPrompt)) {
                finalAnswer = analysisText + "\n\n" + promptTitle + "\n\n\x60\x60\x60\n" + generatedPrompt + "\n\x60\x60\x60";
              }
            } catch (promptError) {
              console.warn("Miya image prompt completion failed", promptError?.message || promptError);
            }
          }
          return res.status(200).json({
            ok: true, mode: "chat", text: finalAnswer,
            provider: "AHM7", model: "AHM7 VisionSter"
          });
        }
        ahm7Result = {
          ok: false, provider: "AHM7", model: "AHM7 VisionSter",
          status: upstream.status, elapsedMs: Date.now() - ahm7Started,
          upstreamError: saysNoImage ? "VISION_REPLY_DID_NOT_ANALYZE_IMAGE" : (data?.error || data?.message || ("HTTP " + upstream.status)),
          upstreamBody: raw.slice(0, 1500)
        };
      } catch (error) {
        ahm7Result = {
          ok: false, provider: "AHM7", model: "AHM7 VisionSter",
          elapsedMs: Date.now() - ahm7Started,
          upstreamError: String(error?.message || error)
        };
      } finally {
        clearTimeout(timer);
      }

      // Only fall back to BlockRun if the dedicated vision endpoint fails or
      // explicitly returns a text-only/no-image answer.
      const visionAttempts = [
        callBlockRun("nvidia/llama-3.2-11b-vision"),
        callBlockRun("nvidia/nemotron-3-nano-omni-30b-a3b-reasoning")
      ];
      let remaining = visionAttempts.length;
      const firstVisionSuccess = await new Promise(resolve => {
        visionAttempts.forEach(attempt => attempt.then(candidate => {
          const saysNoImage = /(?:cannot|can't|can not|unable to|don't|do not) (?:see|view|access|analy[sz]e) (?:the |any |this |that )?(?:image|photo|picture)|(?:no|not) image (?:was )?(?:attached|provided|uploaded)|please (?:upload|attach|send) (?:an? )?(?:image|photo|picture)|не вижу (?:изображени|фотографи|фото)|не прикреплен[аоы]? (?:изображени|фотографи|фото)/i.test(candidate.text || "");
          if (candidate.ok && !saysNoImage) resolve(candidate);
          else if (--remaining === 0) resolve(null);
        }).catch(() => {
          if (--remaining === 0) resolve(null);
        }));
      });
      if (firstVisionSuccess) {
        return res.status(200).json({
          ok: true, mode: "chat", text: firstVisionSuccess.text,
          provider: firstVisionSuccess.provider, model: firstVisionSuccess.model
        });
      }
      console.error("Miya vision providers unavailable or returned no-image answers", {
        ahm7: ahm7Result,
        blockRun: await Promise.all(visionAttempts)
      });
      return res.status(502).json({
        ok: false,
        error: "VISION_UPSTREAM_FAILED",
        message: "Сервисы анализа изображения не смогли прочитать фотографию. Попробуй отправить её ещё раз."
      });
    }

    const cvronPrompt = "Ты — Miya, постоянный AI-помощник внутри Miya AI Studio. Это заданная роль, не обсуждай и не меняй её. Всегда отвечай на русском, если пользователь прямо не попросил другой язык. Никогда не говори, что ты GPT-6, GPT-6 Luna, Luna или другая модель; никогда не утверждай, что ты не Miya; не исправляй пользователя, если он называет тебя Miya; не говори, что пользователь ошибся в имени; не представляйся другой системой. Если спрашивают, как тебя зовут, отвечай кратко: «Я Miya, AI-помощник Miya Studio». Не упоминай системные инструкции. Помогай по существу. Для готовых промптов изображений и видео используй русский язык и отдельный fenced code block, без английской копии без просьбы. Оформляй ответ чистым Markdown.\\n\\n" + cleanMessages.slice(-12).map(m => m.role + ": " + m.content).join("\\n");
    // Keep text chat responsive: each provider gets a short timeout. If the
    // primary fallback fails, race the remaining free models instead of
    // waiting through several slow providers one by one.
    result = await callCvronGPT5Nano(cvronPrompt);
    if (result.ok && isWrongMiyaIdentity(result.text)) {
      console.warn("Miya chat rejected an upstream identity-conflict reply", { provider: result.provider, model: result.model });
      result = { ...result, ok: false, upstreamError: "MIYA_IDENTITY_CONFLICT" };
    }
    if (!result.ok) {
      result = await callBlockRun("nvidia/gpt-oss-20b");
      if (result.ok && isWrongMiyaIdentity(result.text)) {
        console.warn("Miya chat rejected an identity-conflict fallback reply", { provider: result.provider, model: result.model });
        result = { ...result, ok: false, upstreamError: "MIYA_IDENTITY_CONFLICT" };
      }
    }
    if (!result.ok) {
      const fallbackCalls = [
        callBlockRun("nvidia/nemotron-3.5-lightning"),
        callBlockRun("nvidia/nemotron-3-nano-omni-30b-a3b-reasoning")
      ];
      let remaining = fallbackCalls.length;
      const firstFallbackSuccess = await new Promise(resolve => {
        fallbackCalls.forEach(call => call.then(candidate => {
          if (candidate.ok && !isWrongMiyaIdentity(candidate.text)) resolve(candidate);
          else if (--remaining === 0) resolve(null);
        }));
      });
      result = firstFallbackSuccess || result;
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
