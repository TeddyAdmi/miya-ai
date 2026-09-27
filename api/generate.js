async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  try {
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : (req.body && typeof req.body === "object" ? req.body : {});

    const requestMode = String(body.mode || "").trim().toLowerCase();
    const isImageMode = ["image", "pixel-image", "legacy-flux", "flux", "generate-image", "tti"].includes(requestMode);


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
    console.warn("Miya FLUX:", error?.message || error);
    return res.status(500).json({
      ok: false,
      error: "GENERATION_ERROR",
      message: error?.message || "Не удалось выполнить запрос генерации."
    });
  }
}

module.exports = handler;
