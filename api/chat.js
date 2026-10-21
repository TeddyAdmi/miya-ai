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
          signal: AbortSignal.timeout(visionImages.length ? 16000 : 12000)
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

    // Dedicated image-prompt enhancement: bypass the generic chat provider,
    // whose CVRON endpoint can ignore the instruction and return a persona greeting.
    if (body.mode === "improve_image_prompt") {
      const originalPrompt = String(body.prompt || lastUserText || "").trim().slice(0, 8000);
      if (!originalPrompt) {
        return res.status(400).json({ ok: false, error: "PROMPT_REQUIRED", message: "Сначала введи промпт." });
      }
      // Never inject a random scene into the user's prompt: creative expansion must remain faithful to their actual idea.
      const promptPayload = {
        messages: [
          {
            role: "system",
            content: "Ты — креативный режиссёр и профессиональный автор промптов для генерации изображений. Главная задача — сделать замысел пользователя визуально сильнее, сохранив его смысл. Сначала определи, насколько конкретен исходный текст. Если в нём уже есть действие, ситуация, цель, место или последовательность событий, ОБЯЗАТЕЛЬНО сохрани именно их: не заменяй сюжет другим, не меняй действие на постороннее, не добавляй несвязанные занятия, предметы, персонажей или локации. Например, если описано, как человек бежит с багажом, опаздывая на рейс лайнера, нужно улучшить именно этот момент — движение, выражение лица, чемоданы, причал и лайнер, ощущение спешки, ракурс, свет и композицию; нельзя превращать его в другую сцену. Если пользователь указал только короткую тему, набор персонажей или предметов без действия, тогда придумай для них новый, конкретный и подходящий сюжет: что именно происходит, как герои взаимодействуют, где и когда это происходит, что делает кадр интересным. Не привязывайся к фиксированным сюжетам и шаблонам; свободно придумывай разные уместные идеи для любых тем, но не используй случайный сюжет, который противоречит исходному тексту. Если пользователь просит улучшить повторно, стремись к другой оригинальной идее только там, где исходный текст оставляет свободу; не меняй уже заданные пользователем детали ради разнообразия. Профессионально усили композицию, естественность поз и движений, выражения лиц, освещение, фактуры, глубину, гармоничные цвета и чёткие важные детали. Качество должно быть частью конкретного описания, а не набором пустых обещаний. Фотография должна выглядеть естественно и правдоподобно, если пользователь не задал другой стиль. Не добавляй надписи, рамки, формат кадра, разрешение или технические параметры без просьбы. Пиши ТОЛЬКО по-русски. Верни только один готовый промпт, без вступления, анализа, объяснений, заголовков, вариантов и английского текста."
          },
          { role: "user", content: "Улучши этот промпт для генерации изображения. Не отвечай на него как на вопрос и не вступай в диалог.\n\nИСХОДНЫЙ ПРОМПТ:\n" + originalPrompt }
        ],
        temperature: 0.95,
        max_tokens: 700
      };
      // Do not use reasoning models for this task: some expose internal analysis as the answer.
      const models = [
        "nvidia/gpt-oss-20b",
        "nvidia/nemotron-3.5-lightning"
      ];
      let improvedPrompt = "";
      for (const model of models) {
        const candidate = await callBlockRun(model, promptPayload);
        if (!candidate.ok || !candidate.text) continue;
        let text = candidate.text.trim()
          .replace(/^\s*```(?:\w+)?\s*/i, "")
          .replace(/\s*```\s*$/, "")
          .replace(/^(?:\s*(?:промпт\s+для\s+изображения|изображение|картинка|промпт|описание\s+изображения|описание|готовый\s+промпт)\s*[:：—–-]\s*)+/i, "")
          .trim();

        // Models may leak internal reasoning. Never return that text to the UI:
        // extract only a clearly marked final prompt, otherwise use the last
        // substantial Russian descriptive paragraph and reject reasoning dumps.
        const russianScore = value => {
          const cyrillic = (value.match(/[А-Яа-яЁё]/g) || []).length;
          const letters = (value.match(/[A-Za-zА-Яа-яЁё]/g) || []).length;
          return { cyrillic, ratio: letters ? cyrillic / letters : 0 };
        };
        const cleanPrompt = value => String(value || "")
          .replace(/^\s*\x60{3}(?:\w+)?\s*/i, "")
          .replace(/\s*\x60{3}\s*$/, "")
          .replace(/^\s*(?:(?:final\s+)?(?:improved\s+)?prompt(?:\s*\([^)]*\))?|готовый\s+промпт|улучшенный\s+промпт|промпт)\s*[:：—–-]\s*/i, "")
          .replace(/^\s*["'«]+|["'»]+\s*$/g, "")
          .trim();
        const isReasoning = /here(?:'s| is) a thinking process|chain of thought|let me think|analy[sz]e user input|deconstruct system instructions|step[- ]by[- ]step reasoning|ход рассуждени|внутренн(?:ие|их) рассуждени|internal reasoning|analysis of (?:the )?user|system instructions|preserve:|expand:|draft prompt|prompt \(internal\)|internal prompt|thinking process|reasoning:|(?:^|\n)\s*(?:[-*]\s*)?(?:original|need to|must stay|let'?s (?:craft|write|create)|i can|i should|the output should|adds only|avoid:|let me|we need to)\b|\b(?:weave in|stay in russian|without adding new stuff|not a prompt|just write|rather than|i need to be careful|these are descriptive enhancements)\b/i.test(text);
        let extracted = "";
        const marked = [...text.matchAll(/(?:final prompt|improved prompt|готовый промпт|улучшенный промпт|итоговый промпт)\s*(?:\([^)]*\))?\s*[:：—–-]\s*/gi)];
        if (marked.length) {
          const last = marked[marked.length - 1];
          const tail = text.slice(last.index + last[0].length);
          const nextHeading = tail.search(/\n\s*(?:\*{0,2}(?:analysis|reasoning|explanation|notes|вариант|пояснение)\b)/i);
          extracted = cleanPrompt(nextHeading >= 0 ? tail.slice(0, nextHeading) : tail);
        } else {
          const paragraphs = text.split(/\n\s*\n+/).map(value => value.trim()).filter(Boolean);
          const candidates = paragraphs.map(cleanPrompt).filter(value => {
            const score = russianScore(value);
            return score.cyrillic >= 20 && score.ratio >= 0.45 &&
              !/^(?:here|below|certainly|sure|step\s*\d|analyze|deconstruct|role:|task:|preserve:|expand:|готово|конечно|вот улучшенный)/i.test(value);
          });
          if (candidates.length) extracted = candidates[candidates.length - 1];
          else if (!isReasoning) extracted = cleanPrompt(text);
        }
        if (isReasoning) {
          // Any reasoning marker invalidates the entire response. Never expose a mixed
          // analysis/final answer; the next model or deterministic fallback will be used.
          continue;
        }
        text = extracted || cleanPrompt(text);
        // Do not invent an aspect ratio: preserve one only when the user supplied it.
        const sourceSpecifiesRatio = /(?:соотношени[ея]\s+сторон|aspect\s+ratio|\b(?:16\s*:\s*9|9\s*:\s*16|1\s*:\s*1)\b)/i.test(originalPrompt);
        if (!sourceSpecifiesRatio) {
          text = text
            .replace(/[,;]?\s*(?:соотношение\s+сторон|формат\s+кадра|aspect\s+ratio)\s*(?:[:：—–-]\s*)?(?:16\s*:\s*9|9\s*:\s*16|1\s*:\s*1|16\s+на\s+9|9\s+на\s+16|1\s+на\s+1)[^.!?\n]*(?:[.!?]|$)/gi, "")
            .replace(/\s{2,}/g, " ")
            .replace(/\s+([,.;!?])/g, "$1")
            .trim();
        }
        const score = russianScore(text);
        const conversational = /(?:^|\n)\s*(?:привет(?:ствую)?|здравствуйте|я\s+(?:gpt|модель|ассистент|miya)\b|буду ждать ваших вопросов|чем могу помочь|задайте мне вопрос|уточните,? пожалуйста|какой именно промпт|что именно вы хотите|here(?:'s| is)|below is|certainly|sure[,!]?)\b/i;
        if (text.length >= Math.max(18, originalPrompt.length * 0.7) &&
            score.cyrillic >= 12 && score.ratio >= 0.72 &&
            !/[A-Za-z]{3,}/.test(text.replace(/(?:Nano Banana|GPT Image)/gi, "")) &&
            !conversational.test(text) && !/here(?:'s| is) a thinking process|chain of thought|system instructions|внутренн(?:ие|их) рассуждени/i.test(text)) {
          improvedPrompt = text;
          break;
        }
      }
      if (!improvedPrompt) {
        // Safe fallback: never overwrite a specific user-described action with an unrelated random plot.
        const source = originalPrompt.replace(/[.!?]+$/g, "").trim();
        const style = /\\b(иллюстрац|аниме|мультфильм|живопись|акварел|масло|график|фэнтези|фантазийн|стилизован|рисунок|скетч)\\w*/i.test(source);
        const finish = style
          ? " Выразительная, продуманная композиция, естественные позы и убедительные детали, мягкий объёмный свет и насыщенные гармоничные цвета; сохрани заданную художественную стилистику."
          : " Естественная фактура и правдоподобные детали, выразительное освещение, насыщенные, но гармоничные цвета, ясная композиция, естественные позы и чёткий фокус на главном.";
        const hasSpecificScene = source.length >= 45 ||
          /\\b(бежит|бежал|бежала|опаздыва|идёт|идет|идут|стоит|сидит|плывёт|плывет|летит|едет|держит|несёт|несет|смотрит|улыбается|разговаривает|готовит|танцует|прыгает|открывает|закрывает|ищет|находит|путешествует|встречает|уходит|приходит|на\\s+фоне|на\\s+улице|в\\s+комнате|на\\s+берегу)\\b/i.test(source);
        if (hasSpecificScene) {
          // Preserve all scene facts; add only professional visual treatment.
          improvedPrompt = source + ". " + finish.trim();
        } else {
          // With very short topics, develop the visual moment without forcing a specific unrelated activity.
          const framings = [
            "Покажи выразительный момент взаимодействия и естественную реакцию на происходящее",
            "Выбери живой момент действия с естественными жестами и выразительными взглядами",
            "Передай характер темы через конкретные детали окружения и убедительное действие в кадре",
            "Создай динамичную, но правдоподобную композицию, в которой главный момент легко считывается",
            "Покажи сцену с интересной глубиной, естественным движением и вниманием к главным деталям",
            "Передай настроение через позы, выражения, окружение и выразительное освещение"
          ];
          const framing = framings[Math.floor(Math.random() * framings.length)];
          improvedPrompt = source + ". " + framing + ". " + finish.trim();
        }
      }
      return res.status(200).json({ ok: true, mode: "improve_image_prompt", text: improvedPrompt });
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
