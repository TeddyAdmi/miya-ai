const sharp = require("sharp");

module.exports = async function imageHandler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method === "GET") {
    const jobId = String(req.query?.jobId || "").trim();
    if (jobId && String(req.query?.output || "") === "1") {
      try {
        const jobUrl = "https://cleverutils.com/api/v1/jobs/" + encodeURIComponent(jobId) + "/output";
        let outputResponse;
        let rawOutput = "";
        for (let attempt = 0; attempt < 6; attempt++) {
          outputResponse = await fetch(jobUrl, {
            headers: { Accept:"image/*" },
            cache: "no-store",
            signal: AbortSignal.timeout(30000)
          });
          if (outputResponse.ok) break;
          rawOutput = await outputResponse.text().catch(() => "");
          if (outputResponse.status !== 429 || attempt === 5) {
            return res.status(502).json({
              ok:false,
              error:"CLEVERUTILS_OUTPUT_HTTP",
              upstreamStatus:outputResponse.status,
              upstreamBody:rawOutput.slice(0,800)
            });
          }
          const retryAfter = Number(outputResponse.headers.get("retry-after") || "1");
          await new Promise(r => setTimeout(r, Math.max(1000, Math.min(retryAfter * 1000, 5000))));
        }

        const contentType = outputResponse.headers.get("content-type") || "image/png";
        if (!/^image\//i.test(contentType)) {
          const body = await outputResponse.text().catch(() => "");
          return res.status(502).json({
            ok:false,
            error:"CLEVERUTILS_OUTPUT_NOT_IMAGE",
            upstreamBody:body.slice(0,800)
          });
        }

        const outputBuffer = Buffer.from(await outputResponse.arrayBuffer());
        if (!outputBuffer.length) {
          return res.status(502).json({
            ok:false,
            error:"CLEVERUTILS_OUTPUT_EMPTY"
          });
        }

        res.statusCode = 200;
        res.setHeader("Content-Type", contentType.split(";")[0]);
        res.setHeader("Content-Length", String(outputBuffer.length));
        res.setHeader("Cache-Control", "no-store, no-transform");
        res.setHeader("Content-Disposition", "inline; filename=" + String(jobId) + "-upscaled");
        return res.end(outputBuffer);
      } catch (error) {
        return res.status(502).json({
          ok:false,
          error:"CLEVERUTILS_OUTPUT_PROXY_ERROR",
          message:String(error?.message||error||"Output proxy failed")
        });
      }
    }

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
        const status = String(job?.status || "processing");
        const providerOutputUrl =
          typeof job?.output?.url === "string" ? job.output.url :
          typeof job?.output_url === "string" ? job.output_url : "";

        // CleverUtils may report done before /output leaves its short cooldown.
        // Keep the provider output behind Miya's backend and retry 429s here.
        if (status.toLowerCase() === "done" && providerOutputUrl) {
          return res.status(200).json({
            ok:true,
            status,
            jobId:String(job?.job_id || jobId),
            outputUrl:"/api/image?jobId=" + encodeURIComponent(String(job?.job_id || jobId)) + "&output=1"
          });
        }

        return res.status(200).json({
          ok:true,
          status,
          jobId:String(job?.job_id || jobId),
          outputUrl:""
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
    if (action === "upscale-mcp") {
      const imageUrl = typeof body.imageUrl === "string" ? body.imageUrl.trim() : "";
      const imageData = typeof body.imageData === "string" ? body.imageData.trim() : "";
      const scale = String(body.scale || "2");
      const model = String(body.model || "quality");
      if (!imageUrl && !/^data:image\//i.test(imageData)) return res.status(400).json({ok:false,error:"IMAGE_REQUIRED"});
      if (imageUrl && !/^https:\/\//i.test(imageUrl)) return res.status(400).json({ok:false,error:"IMAGE_URL_REQUIRED"});
      if (imageData && !/^data:image\/(jpeg|png|webp);base64,/i.test(imageData)) return res.status(400).json({ok:false,error:"INVALID_IMAGE_DATA"});
      if (["2","3","4"].includes(scale) === false) return res.status(400).json({ok:false,error:"INVALID_SCALE"});
      if (!["fast","quality"].includes(model)) return res.status(400).json({ok:false,error:"INVALID_MODEL"});

      // Prefer the already-cached Miya image bytes when available. This avoids
      // another request to expiring/slow provider URLs such as Vheer.
      let mcpFile = imageData;
      if (!mcpFile) {
        let sourceResponse;
        try {
          sourceResponse = await fetch(imageUrl, {
            headers:{Accept:"image/*"},
            cache:"no-store",
            signal:AbortSignal.timeout(45000)
          });
        } catch (error) {
          return res.status(502).json({ok:false,error:"MCP_SOURCE_FETCH_FAILED",message:String(error?.message||error)});
        }
        if (!sourceResponse.ok) {
          return res.status(502).json({ok:false,error:"MCP_SOURCE_FETCH_FAILED",upstreamStatus:sourceResponse.status});
        }
        const sourceType = (sourceResponse.headers.get("content-type") || "image/jpeg").split(";")[0].toLowerCase();
        if (!/^image\/(jpeg|png|webp)$/i.test(sourceType)) {
          return res.status(415).json({ok:false,error:"MCP_SOURCE_NOT_SUPPORTED",contentType:sourceType});
        }
        const sourceBytes = Buffer.from(await sourceResponse.arrayBuffer());
        if (!sourceBytes.length) return res.status(400).json({ok:false,error:"MCP_SOURCE_EMPTY"});
        if (sourceBytes.length > 20 * 1024 * 1024) return res.status(413).json({ok:false,error:"MCP_SOURCE_TOO_LARGE"});
        mcpFile = "data:" + sourceType + ";base64," + sourceBytes.toString("base64");
      }

      const mcpResponse = await fetch("https://cleverutils.com/mcp", {
        method:"POST",
        headers:{"Content-Type":"application/json","Accept":"application/json"},
        body:JSON.stringify({jsonrpc:"2.0",id:Date.now(),method:"tools/call",params:{name:"upscale_image",arguments:{file:mcpFile,scale:Number(scale),model}}}),
        signal:AbortSignal.timeout(180000)
      });
      const rawMcp = await mcpResponse.text();
      let dataMcp = {};
      try { dataMcp = rawMcp ? JSON.parse(rawMcp) : {}; } catch {}
      if (!mcpResponse.ok) return res.status(502).json({ok:false,error:"CLEVERUTILS_MCP_HTTP",upstreamStatus:mcpResponse.status,upstreamBody:rawMcp.slice(0,1200)});
      if (dataMcp?.error) return res.status(502).json({ok:false,error:"CLEVERUTILS_MCP_ERROR",message:String(dataMcp.error?.message||"MCP tool call failed"),upstreamBody:rawMcp.slice(0,1200)});

      let outputUrl = "";
      const content = Array.isArray(dataMcp?.result?.content) ? dataMcp.result.content : [];
      for (const item of content) {
        if (item && typeof item === "object" && item.type === "resource_link") {
          const candidate = String(item.uri || item.url || "").trim();
          if (/^https?:\/\//i.test(candidate)) { outputUrl = candidate; break; }
        }
        const textValue = item && typeof item.text === "string" ? item.text : "";
        const match = textValue.match(/https?:\/\/[^\\s"']+/i);
        if (match) { outputUrl = match[0].replace(/[),.]+$/,""); break; }
      }
      if (!outputUrl) {
        const fallback = JSON.stringify(dataMcp).replace(/\\\//g,"/");
        const match = fallback.match(/https?:\/\/[^\\s"']+/i);
        if (match) outputUrl = match[0].replace(/[),.]+$/,"");
      }
      if (!outputUrl) return res.status(502).json({ok:false,error:"CLEVERUTILS_MCP_OUTPUT_MISSING",upstreamBody:rawMcp.slice(0,2000)});
      return res.status(200).json({ok:true,provider:"CleverUtils MCP",action:"upscale",status:"done",outputUrl});
    }
    if (action === "upscale") {
      let bytes;
      let mime = "image/jpeg";
      let filename = "miya-image.jpg";
      const dataInput = typeof body.imageData === "string" ? body.imageData.trim() : "";
      const urlInput = typeof body.imageUrl === "string" ? body.imageUrl.trim() : "";

      if (dataInput) {
        const match = dataInput.match(/^data:(image\/[^;]+);base64,(.+)$/i);
        if (!match) return res.status(400).json({ ok:false, error:"INVALID_IMAGE_DATA" });
        mime = match[1].toLowerCase();
        bytes = Buffer.from(match[2].replace(/\s+/g,""), "base64");
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
          host === "access.vheer.com" || host.endsWith(".access.vheer.com") ||
          host === "sora.aritek.app" || host.endsWith(".aritek.app") ||
          host === "cleverutils.com" || host.endsWith(".cleverutils.com");
        if (target.protocol !== "https:" || !allowed) {
          return res.status(400).json({ ok:false, error:"IMAGE_URL_HOST_NOT_ALLOWED" });
        }
        const source = await fetch(target.toString(), { headers:{Accept:"image/*"}, signal:AbortSignal.timeout(20000) });
        if (!source.ok) return res.status(400).json({ ok:false, error:"SOURCE_IMAGE_FETCH_FAILED", upstreamStatus:source.status });
        mime = (source.headers.get("content-type") || "image/jpeg").split(";")[0].toLowerCase();
        if (!/^image\//i.test(mime)) return res.status(400).json({ ok:false, error:"SOURCE_NOT_IMAGE" });
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

      const scale = String(body.scale || "2");
      const model = String(body.model || "quality");
      if (!["2","3","4"].includes(scale)) return res.status(400).json({ok:false,error:"INVALID_SCALE"});
      if (!["fast","quality"].includes(model)) return res.status(400).json({ok:false,error:"INVALID_MODEL"});

      if (model === "quality") {
        try {
          bytes = await sharp(bytes).rotate().png().toBuffer();
          mime = "image/png";
          filename = "miya-source.png";
        } catch (error) {
          return res.status(415).json({ok:false,error:"QUALITY_IMAGE_NORMALIZE_FAILED",message:String(error?.message||error)});
        }
      }

      const form = new FormData();
      form.append("file", new Blob([bytes], { type:mime }), filename);
      const endpoint = "https://cleverutils.com/api/v1/tools/upscale-image";

      form.append("scale", scale);
      form.append("model", model);

      const qualityTimeoutMs = 115000;
      const upstreamTool = await fetch(endpoint, {
        method:"POST",
        body:form,
        headers:{Accept:"application/json"},
        signal:AbortSignal.timeout(qualityTimeoutMs)
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


module.exports.config = { maxDuration: 240 };
