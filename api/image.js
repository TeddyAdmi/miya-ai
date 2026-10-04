module.exports = async function imageHandler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method === "GET") {
    const jobId = String(req.query?.jobId || "").trim();
    if (jobId) {
      try {
        const upstreamJob = await fetch("https://cleverutils.com/api/v1/jobs/" + encodeURIComponent(jobId), {
          headers: { Accept:"application/json" },
          signal: AbortSignal.timeout(15000)
        });
        const rawJob = await upstreamJob.text();
        let dataJob = {};
        try { dataJob = rawJob ? JSON.parse(rawJob) : {}; } catch {}
        if (!upstreamJob.ok) {
          return res.status(502).json({ok:false,error:"CLEVERUTILS_JOB_HTTP",upstreamStatus:upstreamJob.status,upstreamBody:rawJob.slice(0,800)});
        }
        const job = dataJob?.data || dataJob;
        return res.status(200).json({
          ok:true,
          status:String(job?.status || "processing"),
          jobId:String(job?.job_id || jobId),
          outputUrl:typeof job?.output?.url==="string" ? job.output.url : ""
        });
      } catch (error) {
        return res.status(502).json({ok:false,error:"CLEVERUTILS_JOB_HANDLER_ERROR",message:String(error?.message||error||"Job status failed")});
      }
    }
    try {
      const raw = String(req.query?.url || "").trim();
      if (!raw) return res.status(400).json({ ok: false, error: "IMAGE_URL_REQUIRED" });
      const target = new URL(raw);
      const host = target.hostname.toLowerCase();
      const allowed =
        host === "modelscope.cn" ||
        host.endsWith(".modelscope.cn") ||
        host.endsWith(".aliyuncs.com") ||
        host.endsWith(".oss-cn-beijing.aliyuncs.com");
      if (target.protocol !== "https:" || !allowed) {
        return res.status(400).json({ ok: false, error: "IMAGE_URL_HOST_NOT_ALLOWED" });
      }
      const upstream = await fetch(target.toString(), { cache: "no-store" });
      if (!upstream.ok) return res.status(upstream.status).json({ ok: false, error: "IMAGE_PROXY_FAILED", upstreamStatus: upstream.status });
      const type = upstream.headers.get("content-type") || "image/jpeg";
      if (!/^image\//i.test(type)) return res.status(502).json({ ok: false, error: "UPSTREAM_NOT_IMAGE" });
      res.setHeader("Content-Type", type);
      res.setHeader("Cache-Control", "public, max-age=86400");
      return res.status(200).send(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) {
      return res.status(500).json({ ok: false, error: String(error?.message || error || "Image proxy failed") });
    }
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});

    const action = typeof body.action === "string" ? body.action.trim() : "";
    if (action === "upscale") {
      let bytes;
      let mime = "image/jpeg";
      let filename = "miya-image.jpg";
      const dataInput = typeof body.imageData === "string" ? body.imageData.trim() : "";
      const urlInput = typeof body.imageUrl === "string" ? body.imageUrl.trim() : "";

      if (dataInput) {
        const match = dataInput.match(/^data:(image\\/[^;]+);base64,(.+)$/i);
        if (!match) return res.status(400).json({ ok:false, error:"INVALID_IMAGE_DATA" });
        mime = match[1].toLowerCase();
        bytes = Buffer.from(match[2].replace(/\\s+/g,""), "base64");
        filename = "miya-upload." + (mime.split("/")[1] === "jpeg" ? "jpg" : mime.split("/")[1]);
      } else if (urlInput) {
        let target;
        try { target = new URL(urlInput); } catch {
          return res.status(400).json({ ok:false, error:"INVALID_IMAGE_URL" });
        }
        const host = target.hostname.toLowerCase();
        const allowed =
          host === "ahm7xmakki.com" || host.endsWith(".ahm7xmakki.com") ||
          host === "modelscope.cn" || host.endsWith(".modelscope.cn") ||
          host.endsWith(".aliyuncs.com") ||
          host === "sora.aritek.app" || host.endsWith(".aritek.app") ||
          host === "cleverutils.com" || host.endsWith(".cleverutils.com");
        if (target.protocol !== "https:" || !allowed) {
          return res.status(400).json({ ok:false, error:"IMAGE_URL_HOST_NOT_ALLOWED" });
        }
        const source = await fetch(target.toString(), { headers:{Accept:"image/*"}, signal:AbortSignal.timeout(20000) });
        if (!source.ok) return res.status(400).json({ ok:false, error:"SOURCE_IMAGE_FETCH_FAILED", upstreamStatus:source.status });
        mime = (source.headers.get("content-type") || "image/jpeg").split(";")[0].toLowerCase();
        if (!/^image\\//i.test(mime)) return res.status(400).json({ ok:false, error:"SOURCE_NOT_IMAGE" });
        bytes = Buffer.from(await source.arrayBuffer());
        const ext = mime.split("/")[1] || "jpeg";
        filename = "miya-source." + (ext === "jpeg" ? "jpg" : ext);
      } else {
        return res.status(400).json({ ok:false, error:"IMAGE_REQUIRED" });
      }

      if (!bytes?.length) return res.status(400).json({ ok:false, error:"EMPTY_IMAGE" });
      if (bytes.length > 20 * 1024 * 1024) {
        return res.status(413).json({ ok:false, error:"IMAGE_TOO_LARGE", message:"Для AI upscale CleverUtils принимает изображения до 20 MB." });
      }

      const form = new FormData();
      form.append("file", new Blob([bytes], { type:mime }), filename);
      const endpoint = "https://cleverutils.com/api/v1/tools/upscale-image";

      if (action === "upscale") {
        const scale = String(body.scale || "2");
        const model = String(body.model || "quality");
        if (!["2","3","4"].includes(scale)) return res.status(400).json({ok:false,error:"INVALID_SCALE"});
        if (!["fast","quality"].includes(model)) return res.status(400).json({ok:false,error:"INVALID_MODEL"});
        form.append("scale", scale);
        form.append("model", model);
      }

      const upstreamTool = await fetch(endpoint, {
        method:"POST",
        body:form,
        headers:{Accept:"application/json"},
        signal:AbortSignal.timeout(55000)
      });
      const rawTool = await upstreamTool.text();
      let dataTool = {};
      try { dataTool = rawTool ? JSON.parse(rawTool) : {}; } catch {}

      if (!upstreamTool.ok) {
        return res.status(502).json({
          ok:false,
          error:"CLEVERUTILS_UPSTREAM_HTTP",
          upstreamStatus:upstreamTool.status,
          upstreamBody:rawTool.slice(0,1000)
        });
      }

      const job = dataTool?.data || dataTool;
      const outputUrl =
        typeof job?.output?.url === "string" ? job.output.url :
        typeof job?.output_url === "string" ? job.output_url : "";

      return res.status(200).json({
        ok:true,
        provider:"CleverUtils",
        action:"upscale",
        status:String(job?.status || (outputUrl ? "done" : "processing")),
        jobId:typeof job?.job_id === "string" ? job.job_id : "",
        outputUrl
      });
    }

    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) return res.status(400).json({ ok: false, error: "PROMPT_REQUIRED" });

    const ratio = typeof body.ratio === "string" ? body.ratio : "16:9";

    const model = typeof body.model === "string" ? body.model.trim() : "Flux Dev";
    const options = body.options && typeof body.options === "object" ? body.options : {};
    const imageUrl = typeof options.imageUrl === "string" ? options.imageUrl.trim() : "";
    const imageBase64 = typeof options.imageBase64 === "string" ? options.imageBase64.trim() : "";
    const isImageToImage = /kontext/i.test(model) && Boolean(imageUrl || imageBase64);

    if (/kontext/i.test(model) && !isImageToImage) {
      return res.status(400).json({
        ok: false,
        error: "KONTEXT_SOURCE_REQUIRED",
        message: "Для Flux Kontext Dev нужно загрузить исходное изображение."
      });
    }

    // Keep the proven AHM7 FLUX Dev contract exact: prompt + ratio only.
    // Add a concise anatomy guard because FLUX can otherwise duplicate limbs
    // when several hand/arm poses are described in one scene.
    if (!isImageToImage) {
      const anatomyPrompt = prompt + "\n\nANATOMY CONSISTENCY: exactly one person with exactly two arms and exactly two hands. Each arm must connect naturally to one shoulder and each hand to one wrist. Do not generate extra arms, hands, fingers, duplicated limbs, detached limbs, or limbs growing from the torso, legs, table, or background. Keep the requested pose physically coherent and anatomically realistic.";
      const upstream = await fetch("https://ahm7xmakki.com/api/tti", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ prompt: anatomyPrompt, ratio }),
        signal: AbortSignal.timeout(55000)
      });

      const raw = await upstream.text();
      let data = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch {}

      if (!upstream.ok) {
        if (upstream.status === 403) {
          return res.status(403).json({
            ok: false,
            error: "PROMPT_MODERATION_BLOCKED",
            message: "Промпт отклонён модерацией. Измените формулировку запроса и попробуйте снова."
          });
        }
        return res.status(502).json({
          ok: false,
          error: "FLUX_UPSTREAM_HTTP",
          message: "AHM7 /api/tti вернул HTTP " + upstream.status + ".",
          upstreamStatus: upstream.status,
          upstreamBody: raw.slice(0, 800)
        });
      }

      const imageUrlResult = typeof data.imageUrl === "string" && /^https?:\/\//i.test(data.imageUrl)
        ? data.imageUrl
        : null;

      if (!imageUrlResult) {
        return res.status(502).json({
          ok: false,
          error: "FLUX_IMAGE_URL_MISSING",
          message: "AHM7 /api/tti не вернул imageUrl.",
          upstreamBody: raw.slice(0, 800)
        });
      }

      return res.status(200).json({
        ok: true,
        mode: "image",
        status: "completed",
        provider: "PixelSter",
        model: "Flux Dev",
        imageUrl: imageUrlResult,
        imageUrls: [imageUrlResult],
        count: 1,
        meta: { free: true, endpoint: "/api/tti", edit: false }
      });
    }

    // Kontext keeps the existing proven raw-base64 /api/pti contract.
    let sourceBase64 = imageBase64;
    if (imageUrl) {
      const source = await fetch(imageUrl, { headers: { Accept: "image/*" }, signal: AbortSignal.timeout(15000) });
      if (!source.ok) {
        return res.status(400).json({
          ok: false,
          error: "SOURCE_IMAGE_FETCH_FAILED",
          message: "Не удалось получить исходное изображение (HTTP " + source.status + ")."
        });
      }
      const bytes = Buffer.from(await source.arrayBuffer());
      if (bytes.length > 3.5 * 1024 * 1024) {
        return res.status(413).json({ ok: false, error: "SOURCE_IMAGE_TOO_LARGE" });
      }
      const type = source.headers.get("content-type") || "image/jpeg";
      const mime = /^image\/(jpeg|png|webp)$/i.test(type) ? type.split(";")[0] : "image/jpeg";
      sourceBase64 = "data:" + mime + ";base64," + bytes.toString("base64");
    }

    const match = String(sourceBase64 || "").match(/^data:image\/[^;]+;base64,(.+)$/i);
    const rawBase64 = match
      ? match[1].replace(/\s+/g, "")
      : String(sourceBase64 || "").replace(/^base64,/i, "").replace(/\s+/g, "");

    if (rawBase64.length < 100) {
      return res.status(400).json({ ok: false, error: "INVALID_IMAGE_BASE64" });
    }

    if (Math.ceil(rawBase64.length * 3 / 4) > 3.5 * 1024 * 1024) {
      return res.status(413).json({ ok: false, error: "SOURCE_IMAGE_TOO_LARGE" });
    }

    // Keep the proven Kontext contract: send the user's edit prompt unchanged.
    // Extra moderation-sensitive guard text can cause otherwise valid prompts
    // to be rejected upstream by AHM7.
    const editPrompt = prompt;

    const upstream = await fetch("https://ahm7xmakki.com/api/pti", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        prompt: editPrompt,
        ratio: ratio === "1:1" ? "auto" : ratio,
        imageBase64: rawBase64
      }),
      signal: AbortSignal.timeout(55000)
    });

    const raw = await upstream.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch {}

    if (!upstream.ok) {
      return res.status(502).json({
        ok: false,
        error: "FLUX_KONTEXT_UPSTREAM_HTTP",
        message: "AHM7 /api/pti вернул HTTP " + upstream.status + ".",
        upstreamStatus: upstream.status,
        upstreamBody: raw.slice(0, 800)
      });
    }

    const imageUrlResult = typeof data.imageUrl === "string" && /^https?:\/\//i.test(data.imageUrl)
      ? data.imageUrl
      : Array.isArray(data.imageUrls) && typeof data.imageUrls[0] === "string"
        ? data.imageUrls[0]
        : null;

    if (!imageUrlResult) {
      return res.status(502).json({
        ok: false,
        error: "FLUX_KONTEXT_IMAGE_URL_MISSING",
        message: "AHM7 /api/pti не вернул imageUrl.",
        upstreamBody: raw.slice(0, 800)
      });
    }

    return res.status(200).json({
      ok: true,
      mode: "image",
      status: "completed",
      provider: "PixelSter",
      model: "Flux Kontext Dev",
      imageUrl: imageUrlResult,
      imageUrls: [imageUrlResult],
      count: 1,
      meta: { free: true, endpoint: "/api/pti", edit: true }
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      return res.status(504).json({
        ok: false,
        error: "FLUX_TIMEOUT",
        message: "AHM7 не завершил запрос в течение 55 секунд."
      });
    }

    return res.status(502).json({
      ok: false,
      error: "FLUX_HANDLER_ERROR",
      message: error?.message || "Ошибка обращения к FLUX.",
    });
  }
};
