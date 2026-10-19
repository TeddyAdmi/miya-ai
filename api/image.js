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
      if (imageUrl) {
        try {
          const sourceUrl = new URL(imageUrl);
          if (sourceUrl.pathname === "/" && !sourceUrl.search && !sourceUrl.hash && /(?:^|\.)cleverutils\.com$/i.test(sourceUrl.hostname)) {
            return res.status(400).json({ok:false,error:"MCP_SOURCE_INVALID",message:"Источник изображения указывает на главную страницу CleverUtils, а не на готовое изображение."});
          }
        } catch {}
      }
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

      // CleverUtils exposes Streamable HTTP MCP. Discover the tool first,
      // then call it. The tool result is returned as MCP content/resource_link.
      const mcpEndpoint = "https://cleverutils.com/mcp";
      const mcpHeaders = {
        "Content-Type":"application/json",
        "Accept":"application/json, text/event-stream"
      };

      const parseMcpPayload = raw => {
        const text = String(raw || "").trim();
        if (!text) return {};
        try { return JSON.parse(text); } catch {}
        const events = text
          .split(/\r?\n/)
          .filter(line => /^data:/i.test(line))
          .map(line => line.replace(/^data:\s*/i, "").trim())
          .filter(Boolean);
        for (let i = events.length - 1; i >= 0; i--) {
          try { return JSON.parse(events[i]); } catch {}
        }
        return {};
      };

      const mcpPost = async payload => {
        const response = await fetch(mcpEndpoint, {
          method:"POST",
          headers:mcpHeaders,
          body:JSON.stringify(payload),
          signal:AbortSignal.timeout(180000)
        });
        const raw = await response.text();
        const data = parseMcpPayload(raw);
        if (!response.ok) {
          const error = data?.error;
          throw Object.assign(new Error(String(error?.message || "CleverUtils MCP HTTP error")), {
            code:"CLEVERUTILS_MCP_HTTP",
            status:response.status,
            raw:raw.slice(0,2000)
          });
        }
        if (data?.error) {
          throw Object.assign(new Error(String(data.error?.message || "CleverUtils MCP protocol error")), {
            code:"CLEVERUTILS_MCP_RPC_ERROR",
            raw:raw.slice(0,2000)
          });
        }
        return data;
      };

      // Per CleverUtils' current MCP transport, begin with initialization,
      // then discover the current tool catalog before invoking upscale_image.
      await mcpPost({
        jsonrpc:"2.0",
        id:Date.now(),
        method:"initialize",
        params:{
          protocolVersion:"2025-06-18",
          capabilities:{},
          clientInfo:{name:"Miya Studio",version:"1.0"}
        }
      });

      const toolList = await mcpPost({
        jsonrpc:"2.0",
        id:Date.now()+1,
        method:"tools/list",
        params:{}
      });

      const tools = Array.isArray(toolList?.result?.tools) ? toolList.result.tools : [];
      const upscaleTool = tools.find(tool => tool?.name === "upscale_image");
      if (!upscaleTool) {
        return res.status(502).json({
          ok:false,
          error:"CLEVERUTILS_MCP_TOOL_MISSING",
          message:"CleverUtils MCP не объявил инструмент upscale_image.",
          tools:tools.map(tool => String(tool?.name || "")).filter(Boolean).slice(0,50)
        });
      }

      const callData = await mcpPost({
        jsonrpc:"2.0",
        id:Date.now()+2,
        method:"tools/call",
        params:{
          name:"upscale_image",
          arguments:{
            file:mcpFile,
            scale:Number(scale),
            model
          }
        }
      });

      const callResult = callData?.result || {};
      const contentBlocks = Array.isArray(callResult?.content) ? callResult.content : [];
      if (callResult?.isError) {
        const message = contentBlocks
          .filter(block => block?.type === "text")
          .map(block => String(block.text || ""))
          .join("\n")
          .trim();
        return res.status(502).json({
          ok:false,
          error:"CLEVERUTILS_MCP_TOOL_ERROR",
          message:message || "CleverUtils upscale_image вернул ошибку.",
          upstreamBody:JSON.stringify(callResult).slice(0,2000)
        });
      }

      // MCP resource_link is the canonical CleverUtils output format.
      // Also inspect text/structuredContent because different MCP clients
      // may expose the same resource in slightly different envelopes.
      const urlCandidates = [];
      const addCandidate = value => {
        const candidate = String(value || "").trim().replace(/[),.]+$/, "");
        if (/^https?:\/\//i.test(candidate)) urlCandidates.push(candidate);
      };
      const collectUrls = value => {
        if (typeof value === "string") {
          const matches = value.match(/https?:\/\/[^\s"'<>)]+/gi) || [];
          matches.forEach(addCandidate);
          return;
        }
        if (Array.isArray(value)) {
          value.forEach(collectUrls);
          return;
        }
        if (value && typeof value === "object") {
          if (value.type === "resource_link" && value.uri) addCandidate(value.uri);
          if (value.resource?.uri) addCandidate(value.resource.uri);
          Object.values(value).forEach(collectUrls);
        }
      };

      collectUrls(contentBlocks);
      collectUrls(callResult?.structuredContent);
      collectUrls(callData);

      const uniqueCandidates = [...new Set(urlCandidates)];
      const scoreUrl = value => {
        try {
          const u = new URL(value);
          const path = u.pathname.toLowerCase();
          let score = 0;
          if (path === "/" || path === "") return -100;
          if (/\/api\/v1\/jobs\/[^/]+\/output/.test(path)) score += 100;
          if (/\/output(?:\/|$)/.test(path)) score += 80;
          if (/\/(download|files?)\//.test(path)) score += 40;
          if (/\.(png|jpe?g|webp|gif)(?:$|[?&])/i.test(path)) score += 30;
          return score;
        } catch {
          return -100;
        }
      };

      uniqueCandidates.sort((a,b) => scoreUrl(b) - scoreUrl(a));
      let outputUrl = uniqueCandidates.find(candidate => scoreUrl(candidate) > 0) || uniqueCandidates[0] || "";

      if (outputUrl) {
        try {
          const normalized = new URL(outputUrl);
          if (normalized.hostname.toLowerCase() === "cleverutil" || normalized.hostname.toLowerCase() === "cleverutil.com") {
            normalized.hostname = "cleverutils.com";
            outputUrl = normalized.toString();
          }
        } catch {}
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

    const provider = typeof body.provider === "string" ? body.provider.trim().toLowerCase() : "";
    const requestedModel = typeof body.model === "string" ? body.model.trim() : "";

    if (provider === "kapy") {
      const userPrompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
      const allowedRatios = ["1:1", "4:3", "3:2", "16:9", "2:1", "9:16"];
      const aspectRatio = allowedRatios.includes(String(body.ratio || "")) ? String(body.ratio) : "16:9";
      if (requestedModel !== "Z-Image Turbo") {
        return res.status(400).json({ ok:false, error:"KAPY_MODEL_UNSUPPORTED", message:"Неизвестная модель Kapy." });
      }
      if (!userPrompt) return res.status(400).json({ ok:false, error:"PROMPT_REQUIRED" });

      const requestKapyJson = async (url, init) => {
        const upstream = await fetch(url, {
          ...init,
          headers: { Accept:"application/json", ...(init?.headers || {}) },
          cache:"no-store",
          signal: AbortSignal.timeout(18000)
        });
        const raw = await upstream.text();
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch {}
        if (!upstream.ok) {
          const err = new Error("Kapy вернул HTTP " + upstream.status + (data?.message ? ": " + String(data.message) : ""));
          err.status = upstream.status;
          err.body = raw.slice(0, 700);
          throw err;
        }
        return data;
      };

      try {
        const created = await requestKapyJson("https://kapy.co/api/generate", {
          method:"POST",
          headers: { "Content-Type":"application/json" },
          body:JSON.stringify({
            prompt:userPrompt,
            aspectRatio,
            modelId:"z-image-turbo",
            upscaleFactor:"0",
            enhancePrompt:false,
            turnstileToken:""
          })
        });
        const jobId = String(created?.jobId || created?.job?.id || created?.data?.jobId || "").trim();
        if (!created?.success || !jobId) {
          return res.status(502).json({
            ok:false, error:"KAPY_JOB_CREATE_FAILED",
            message:String(created?.message || created?.error || "Kapy не вернул идентификатор задания.")
          });
        }

        const findValue = (root, keys) => {
          const seen = new Set();
          const visit = value => {
            if (!value || typeof value !== "object" || seen.has(value)) return "";
            seen.add(value);
            for (const key of keys) {
              if (typeof value[key] === "string" && value[key].trim()) return value[key].trim();
            }
            for (const child of Object.values(value)) {
              const found = visit(child);
              if (found) return found;
            }
            return "";
          };
          return visit(root);
        };
        let lastStatus = {};
        let finalImageUrl = "";
        let wallpaperId = "";
        for (let attempt = 0; attempt < 65; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 1200));
          lastStatus = await requestKapyJson("https://kapy.co/api/job-status/" + encodeURIComponent(jobId), { method:"GET" });
          const statusText = String(findValue(lastStatus, ["status", "state"]) || "").toLowerCase();
          finalImageUrl = findValue(lastStatus, ["originalImage", "imageUrl", "image_url", "outputUrl", "output_url"]);
          wallpaperId = findValue(lastStatus, ["wallpaperId", "wallpaper_id"]);
          const idCandidate = findValue(lastStatus, ["id"]);
          if (!wallpaperId && /^wallpaper_/.test(idCandidate)) wallpaperId = idCandidate;
          if (finalImageUrl && /^https:\/\//i.test(finalImageUrl)) break;
          if (["failed", "error", "cancelled", "canceled"].includes(statusText)) {
            return res.status(502).json({
              ok:false, error:"KAPY_GENERATION_FAILED",
              message:String(findValue(lastStatus, ["message", "error"]) || "Kapy не смог создать изображение.")
            });
          }
          if (["completed", "complete", "done", "success", "succeeded"].includes(statusText)) break;
        }

        if (!finalImageUrl && wallpaperId) {
          const wallpaper = await requestKapyJson("https://kapy.co/api/wallpaper/" + encodeURIComponent(wallpaperId), { method:"GET" });
          finalImageUrl = findValue(wallpaper, ["originalImage", "imageUrl", "image_url", "outputUrl", "output_url"]);
        }
        if (!finalImageUrl || !/^https:\/\//i.test(finalImageUrl)) {
          return res.status(502).json({
            ok:false, error:"KAPY_IMAGE_URL_MISSING",
            message:"Kapy принял задание, но Miya не смогла получить ссылку на готовую картинку.",
            jobId
          });
        }
        return res.status(200).json({
          ok:true, mode:"image", status:"completed", provider:"Kapy",
          model:"Z-Image Turbo", imageUrl:finalImageUrl, imageUrls:[finalImageUrl], count:1,
          meta:{ free:true, aspectRatio, jobId, upstream:"kapy.co" }
        });
      } catch (error) {
        return res.status(502).json({
          ok:false, error:"KAPY_GENERATION_ERROR",
          message:String(error?.message || error || "Ошибка обращения к Kapy."),
          upstreamStatus:error?.status || null,
          upstreamBody:error?.body || ""
        });
      }
    }

    if (provider === "aura") {
      const auraModels = {"Nano Banana":"nano-banana","Seedream":"seedream"};
      const auraModel = auraModels[requestedModel];
      const userPrompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
      if (!auraModel) return res.status(400).json({ok:false,error:"AURA_MODEL_UNSUPPORTED",message:"Неизвестная модель Aura."});
      if (!userPrompt) return res.status(400).json({ok:false,error:"PROMPT_REQUIRED"});

      // Keep the two Aura models' proven no-frame instructions separate.
      // Add only natural-photo quality guidance; preserve the user's requested subject and composition.
      const auraPromptSuffixes = {
        "Nano Banana": "\n\nAn ordinary photograph without postcard styling, filling the image from edge to edge, with no frames, borders, margins, decorative corners, text or greetings.\n\nMaximum achievable image quality, exceptionally fine natural detail, sharp realistic textures, accurate anatomy and realistic material details, lifelike fine detail, balanced exposure, natural lighting, clear details in both highlights and shadows, realistic colors, excellent focus and professional photographic clarity. Avoid artificial sharpening and unnatural textures.",
        "Seedream": "\n\nCreate a normal standalone photorealistic image. Do not create a postcard, greeting card, poster, border, frame, template, or text.\n\nUse the highest available image quality, with exceptionally fine natural detail, accurate anatomy, crisp focus, lifelike textures, balanced exposure, natural lighting, clear highlights and shadows, and true-to-life colors. Preserve a natural photographic appearance without artificial sharpening or excessive processing."
      };
      const auraPrompt = userPrompt + auraPromptSuffixes[requestedModel];
      try {
        const form = new FormData();
        form.append("prompt", auraPrompt);
        form.append("model", auraModel);
        const createResponse = await fetch("https://aurasoundai.ru/api/postcard/generate", {
          method:"POST", headers:{Accept:"application/json"}, body:form,
          cache:"no-store", signal:AbortSignal.timeout(30000)
        });
        const createRaw = await createResponse.text();
        let createData = {};
        try { createData = createRaw ? JSON.parse(createRaw) : {}; } catch {}
        if (!createResponse.ok) return res.status(502).json({
          ok:false,error:"AURA_GENERATE_HTTP",message:"Aura вернула HTTP " + createResponse.status + ".",
          upstreamStatus:createResponse.status,upstreamBody:createRaw.slice(0,1200)
        });

        const findAuraImage = value => {
          if (!value || typeof value !== "object") return "";
          for (const key of ["image_url","imageUrl","output_url","outputUrl","url"]) {
            if (typeof value[key] !== "string") continue;
            const candidate = value[key].trim();
            if (/^https?:\/\//i.test(candidate)) return candidate;
            if (candidate.startsWith("/") || candidate.startsWith("postcard-results/")) {
              return new URL(candidate.startsWith("/") ? candidate : "/" + candidate, "https://aurasoundai.ru").toString();
            }
          }
          for (const key of ["data","result","output"]) {
            const found = findAuraImage(value[key]);
            if (found) return found;
          }
          return "";
        };
        let imageUrl = findAuraImage(createData);
        const taskId = String(createData.task_id || createData.taskId || createData.id || "");
        if (!imageUrl && !taskId) return res.status(502).json({
          ok:false,error:"AURA_TASK_ID_MISSING",message:"Aura не вернула идентификатор задачи.",
          upstreamBody:createRaw.slice(0,1200)
        });

        const deadline = Date.now() + 95000;
        let lastStatus = "";
        while (!imageUrl && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 1800));
          const statusResponse = await fetch(
            "https://aurasoundai.ru/api/postcard/status?task_id=" + encodeURIComponent(taskId),
            {headers:{Accept:"application/json"},cache:"no-store",signal:AbortSignal.timeout(12000)}
          );
          const statusRaw = await statusResponse.text();
          let statusData = {};
          try { statusData = statusRaw ? JSON.parse(statusRaw) : {}; } catch {}
          if (!statusResponse.ok) return res.status(502).json({
            ok:false,error:"AURA_STATUS_HTTP",upstreamStatus:statusResponse.status,upstreamBody:statusRaw.slice(0,1000)
          });
          lastStatus = String(statusData.status || "");
          imageUrl = findAuraImage(statusData);
          if (imageUrl) break;
          if (/^(failed|error|cancelled|canceled)$/i.test(lastStatus)) return res.status(502).json({
            ok:false,error:"AURA_GENERATION_FAILED",
            message:String(statusData.error || statusData.message || "Aura не смогла создать изображение."),
            upstreamBody:statusRaw.slice(0,1000)
          });
        }
        if (!imageUrl) return res.status(504).json({
          ok:false,error:"AURA_GENERATION_TIMEOUT",message:"Aura не завершила генерацию вовремя.",
          taskId,status:lastStatus
        });
        return res.status(200).json({
          ok:true,mode:"image",status:"completed",provider:"Aura",model:requestedModel,
          imageUrl,imageUrls:[imageUrl],count:1,meta:{native:true,noCrop:true,noFrame:true}
        });
      } catch (error) {
        return res.status(502).json({ok:false,error:"AURA_HANDLER_ERROR",message:String(error?.message||error||"Ошибка обращения к Aura.")});
      }
    }

    if (provider === "cvron") {
      const cvronModels = {
        "Nano Banana 2": "https://cvron.alwaysdata.net/cvronai/nanobanana2.php",
        "GPT Image 2.5": "https://cvron.alwaysdata.net/cvronai/gpt-image-2-5-flare.php"
      };
      const endpoint = cvronModels[requestedModel];
      const cvronPrompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
      const cvronRatio = ["1:1","3:4","4:3","16:9","9:16","2:3","3:2","21:9"].includes(String(body.ratio || "")) ? String(body.ratio) : "16:9";
      if (!endpoint) {
        return res.status(400).json({
          ok:false,
          error:"CVRON_MODEL_UNSUPPORTED",
          message:"Неизвестная CVRON-модель."
        });
      }
      if (!cvronPrompt) {
        return res.status(400).json({ok:false,error:"PROMPT_REQUIRED"});
      }

      try {
        // Keep the original prompt untouched. Send the selected canvas ratio and
        // explicit dimensions to CVRON; never post-process a square into a wide image.
        const nativeSize = {
          "1:1":  {width:1024,height:1024},
          "16:9": {width:1376,height:768},
          "9:16": {width:768,height:1376},
          "3:4":  {width:896,height:1200},
          "4:3":  {width:1200,height:896},
          "2:3":  {width:848,height:1264},
          "3:2":  {width:1264,height:848},
          "21:9": {width:1584,height:672}
        }[cvronRatio] || {width:1024,height:1024};

        // Preserve the provider's original working request: send the user's prompt unchanged.
        const target =
          endpoint +
          (endpoint.includes("?") ? "&" : "?") +
          "prompt=" + encodeURIComponent(cvronPrompt) +
          "&ratio=" + encodeURIComponent(cvronRatio) +
          "&aspect_ratio=" + encodeURIComponent(cvronRatio) +
          "&size=" + encodeURIComponent(cvronRatio) +
          "&width=" + nativeSize.width +
          "&height=" + nativeSize.height +
          "&resolution=1K";
        let upstream;
        let raw = "";
        let data = {};
        for (let attempt = 0; attempt < 2; attempt++) {
          upstream = await fetch(target, {
            method:"GET",
            headers:{Accept:"application/json, text/plain, */*"},
            cache:"no-store",
            signal:AbortSignal.timeout(180000)
          });
          raw = await upstream.text();
          data = {};
          try { data = raw ? JSON.parse(raw) : {}; } catch {}
          if (upstream.ok || upstream.status < 500 || attempt === 1) break;
          await new Promise(resolve => setTimeout(resolve, 1200));
        }

        if (!upstream.ok) {
          return res.status(502).json({
            ok:false,
            error:"CVRON_UPSTREAM_HTTP",
            message:"CVRON вернул HTTP " + upstream.status + ".",
            upstreamStatus:upstream.status,
            upstreamBody:raw.slice(0,1000)
          });
        }

        const findImageUrl = (value, seen=new Set()) => {
          if (value == null) return "";
          if (typeof value === "string") {
            const v=value.trim();
            if (/^https?:\/\//i.test(v) && /\.(?:png|jpe?g|webp|gif)(?:[?#]|$)/i.test(v)) return v;
            if (/^https?:\/\//i.test(v) && /(image|img|photo|picture|output|result|generated)/i.test(v)) return v;
            return "";
          }
          if (typeof value !== "object" || seen.has(value)) return "";
          seen.add(value);
          const preferred=["imageUrl","image_url","url","image","output","outputUrl","output_url","result","data"];
          for (const key of preferred) {
            const found=findImageUrl(value[key],seen);
            if(found)return found;
          }
          for (const key of Object.keys(value)) {
            const found=findImageUrl(value[key],seen);
            if(found)return found;
          }
          return "";
        };

        const imageUrl=findImageUrl(data) || findImageUrl(raw);
        if (!imageUrl) {
          return res.status(502).json({
            ok:false,
            error:"CVRON_IMAGE_URL_MISSING",
            message:"CVRON не вернул ссылку на изображение.",
            upstreamBody:raw.slice(0,1500)
          });
        }

        const outputImageUrl = imageUrl;

        return res.status(200).json({
          ok:true,
          mode:"image",
          status:"completed",
          provider:"CVRON",
          model:requestedModel,
          imageUrl:outputImageUrl,
          imageUrls:[outputImageUrl],
          count:1,
          meta:{
            free:true,
            endpoint,
            requestedRatio:cvronRatio,
            native:true,
            noCrop:true,
            enhanced:false,
            edit:false,
            sourceImageUrl:""
          }
        });
      } catch (error) {
        return res.status(502).json({
          ok:false,
          error:"CVRON_HANDLER_ERROR",
          message:String(error?.message||error||"Ошибка обращения к CVRON.")
        });
      }
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

    // Send the user's prompt unchanged, with only the selected ratio.
    if (!isImageToImage) {
      const upstream = await fetch("https://ahm7xmakki.com/api/tti", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ prompt, ratio }),
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

    // Normalize source images before sending them to AHM7. Generated PNGs can
    // exceed the upstream size limit, and Miya proxy URLs must be unwrapped first.
    const unwrapMiyaImageUrl = value => {
      const raw=String(value||"").trim();
      if(!raw)return "";
      try {
        const parsed=new URL(raw,"https://miya-studio.vercel.app");
        const ownHost=parsed.hostname.toLowerCase()==="miya-studio.vercel.app" ||
          parsed.hostname.toLowerCase()==="www.miya-studio.vercel.app";
        if(ownHost && parsed.pathname==="/api/image-jpeg") {
          const original=parsed.searchParams.get("url")||"";
          if(/^https:\/\//i.test(original))return original;
        }
        if(parsed.protocol==="https:")return parsed.toString();
      }catch{}
      return "";
    };
    const allowedImageHost = hostname => {
      const host=String(hostname||"").toLowerCase();
      return host==="overchat.s3.eu-north-1.amazonaws.com" ||
        host==="access.vheer.com" || host.endsWith(".access.vheer.com") ||
        host==="platform-outputs.agnes-ai.space" ||
        host==="ahm7xmakki.com" || host.endsWith(".ahm7xmakki.com") ||
        host==="sora.aritek.app" || host.endsWith(".aritek.app") ||
        host==="cvron.alwaysdata.net" ||
        host==="modelscope.cn" || host.endsWith(".modelscope.cn") ||
        host.endsWith(".aliyuncs.com");
    };

    let sourceBytes=null;
    let sourceMime="image/jpeg";
    if(imageUrl) {
      const sourceUrl=unwrapMiyaImageUrl(imageUrl);
      if(!sourceUrl) return res.status(400).json({ok:false,error:"INVALID_SOURCE_IMAGE_URL"});
      let parsedSource;
      try{parsedSource=new URL(sourceUrl)}catch{return res.status(400).json({ok:false,error:"INVALID_SOURCE_IMAGE_URL"})}
      if(parsedSource.protocol!=="https:" || !allowedImageHost(parsedSource.hostname)) {
        return res.status(400).json({ok:false,error:"SOURCE_IMAGE_HOST_NOT_ALLOWED"});
      }
      let sourceResponse;
      try {
        sourceResponse=await fetch(sourceUrl,{headers:{Accept:"image/*"},cache:"no-store",signal:AbortSignal.timeout(10000)});
      } catch(error) {
        return res.status(502).json({ok:false,error:"SOURCE_IMAGE_FETCH_FAILED",message:String(error?.message||error)});
      }
      if(!sourceResponse.ok) return res.status(400).json({ok:false,error:"SOURCE_IMAGE_FETCH_FAILED",upstreamStatus:sourceResponse.status});
      sourceMime=(sourceResponse.headers.get("content-type")||"image/jpeg").split(";")[0].toLowerCase();
      if(!/^image\/(jpeg|png|webp|avif)$/i.test(sourceMime)) return res.status(415).json({ok:false,error:"SOURCE_IMAGE_NOT_SUPPORTED",contentType:sourceMime});
      sourceBytes=Buffer.from(await sourceResponse.arrayBuffer());
    } else {
      const dataInput=String(imageBase64||"").trim();
      const dataMatch=dataInput.match(/^data:image\/([a-z0-9.+-]+);base64,([\s\S]+)$/i);
      const rawBase64=dataMatch?dataMatch[2].replace(/\s+/g,""):dataInput.replace(/^base64,/i,"").replace(/\s+/g,"");
      if(rawBase64.length<100) return res.status(400).json({ok:false,error:"INVALID_IMAGE_BASE64"});
      if(Math.ceil(rawBase64.length*3/4)>30*1024*1024) return res.status(413).json({ok:false,error:"SOURCE_IMAGE_TOO_LARGE"});
      sourceBytes=Buffer.from(rawBase64,"base64");
      if(dataMatch) sourceMime="image/"+dataMatch[1].toLowerCase();
    }

    if(!sourceBytes?.length) return res.status(400).json({ok:false,error:"SOURCE_IMAGE_EMPTY"});
    if(sourceBytes.length>30*1024*1024) return res.status(413).json({ok:false,error:"SOURCE_IMAGE_TOO_LARGE"});

    let sourceBase64="";
    try {
      const normalized=await sharp(sourceBytes)
        .rotate()
        .resize({width:2048,height:2048,fit:"inside",withoutEnlargement:true})
        .jpeg({quality:85,mozjpeg:true})
        .toBuffer();
      sourceBase64=normalized.toString("base64");
    } catch(error) {
      return res.status(415).json({ok:false,error:"SOURCE_IMAGE_NORMALIZE_FAILED",message:String(error?.message||error)});
    }
    if(!sourceBase64 || Math.ceil(sourceBase64.length*3/4)>3.5*1024*1024) {
      return res.status(413).json({ok:false,error:"SOURCE_IMAGE_TOO_LARGE",message:"Не удалось уменьшить исходное изображение до размера, допустимого для Flux Kontext."});
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
        imageBase64: sourceBase64
      }),
      signal: AbortSignal.timeout(45000)
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
