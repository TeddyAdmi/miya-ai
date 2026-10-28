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

    if (provider === "cinel") {
      const userPrompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
      const allowedRatios = ["1:1","16:9","9:16","4:3","3:4","3:2","2:3","21:9"];
      const ratio = allowedRatios.includes(String(body.ratio || "")) ? String(body.ratio) : "16:9";
      const action = String(body.action || "start").toLowerCase();
      const taskId = typeof body.taskId === "string" ? body.taskId.trim() : "";
      if (requestedModel !== "Kolors") {
        return res.status(400).json({ok:false,error:"CINEL_MODEL_UNSUPPORTED",message:"Неизвестная модель Kolors."});
      }
      if (action === "start" && !userPrompt) return res.status(400).json({ok:false,error:"PROMPT_REQUIRED"});
      if (action !== "start" && action !== "status") {
        return res.status(400).json({ok:false,error:"CINEL_ACTION_UNSUPPORTED"});
      }
      if (action === "status" && !taskId) {
        return res.status(400).json({ok:false,error:"CINEL_TASK_ID_REQUIRED"});
      }
      try {
        let currentTaskId = taskId;
        if (action === "start") {
          const createResponse = await fetch("https://cinel.ai/api/cinel/preview-task", {
            method:"POST",
            headers:{
              "Content-Type":"application/json",
              "Accept":"application/json",
              "Origin":"https://cinel.ai",
              "Referer":"https://cinel.ai/free-ai-text-to-image-generator"
            },
            body:JSON.stringify({
              prompt:userPrompt,
              aiEnhance:false,
              mediaType:"image",
              modelId:"kolors",
              toolSlug:"text-to-image",
              ratio,
              outputCount:1,
              resolution:"1K",
              quality:"Low",
              duration:"5s",
              sound:false,
              videoMode:"standard",
              styleMode:"normal",
              webSearch:false,
              clientRequestId:require("crypto").randomUUID()
            }),
            cache:"no-store",
            signal:AbortSignal.timeout(65000)
          });
          const createRaw = await createResponse.text();
          let created = {};
          try { created = createRaw ? JSON.parse(createRaw) : {}; } catch {}
          if (!createResponse.ok || Number(created?.code) !== 0 || !created?.data?.taskId) {
            return res.status(502).json({
              ok:false,
              error:"CINEL_CREATE_FAILED",
              message:"Cinel не принял задачу генерации.",
              upstreamStatus:createResponse.status,
              upstreamBody:createRaw.slice(0,800)
            });
          }
          currentTaskId = String(created.data.taskId);
          // Keep polling on the server after creation. Cinel's status endpoint can
          // occasionally stall; retry transient timeouts instead of losing a valid task.
          const pollDeadline = Date.now() + 22000;
          let lastPollError = "";
          while (Date.now() < pollDeadline) {
            try {
              const remaining = Math.max(1000, pollDeadline - Date.now());
              const statusResponse = await fetch("https://cinel.ai/api/cinel/preview-task?taskId=" + encodeURIComponent(currentTaskId), {
                headers:{
                  "Accept":"application/json",
                  "Origin":"https://cinel.ai",
                  "Referer":"https://cinel.ai/free-ai-text-to-image-generator"
                },
                cache:"no-store",
                signal:AbortSignal.timeout(Math.min(8000, remaining))
              });
              const statusRaw = await statusResponse.text();
              let statusPayload = {};
              try { statusPayload = statusRaw ? JSON.parse(statusRaw) : {}; } catch {}
              if (!statusResponse.ok || Number(statusPayload?.code) !== 0) {
                return res.status(502).json({
                  ok:false,
                  error:"CINEL_STATUS_FAILED",
                  message:"Не удалось проверить статус Kolors.",
                  upstreamStatus:statusResponse.status,
                  upstreamBody:statusRaw.slice(0,600)
                });
              }
              const taskData = statusPayload.data || {};
              const status = String(taskData.status || "").toLowerCase();
              if (status === "success") {
                const outputPath = String(taskData.outputUrl || taskData.outputUrls?.[0] || "");
                let outputUrl = "";
                try {
                  const parsed = new URL(outputPath, "https://cinel.ai");
                  if (parsed.protocol === "https:" && parsed.hostname === "cinel.ai" && parsed.pathname === "/api/cinel/share") {
                    outputUrl = parsed.toString();
                  }
                } catch {}
                if (!outputUrl) {
                  return res.status(502).json({ok:false,error:"CINEL_OUTPUT_URL_MISSING",message:"Cinel завершил задачу, но не вернул ссылку на изображение."});
                }
                return res.status(200).json({
                  ok:true,
                  mode:"image",
                  status:"completed",
                  provider:"Cinel",
                  model:"Kolors",
                  taskId:currentTaskId,
                  imageUrl:outputUrl,
                  imageUrls:[outputUrl],
                  count:1,
                  meta:{free:true,modelId:"kolors",ratio}
                });
              }
              if (["error","failed","cancelled","canceled"].includes(status)) {
                return res.status(502).json({
                  ok:false,
                  error:"CINEL_GENERATION_FAILED",
                  message:"Cinel не смог создать изображение.",
                  upstreamBody:JSON.stringify(taskData).slice(0,800)
                });
              }
              lastPollError = "";
            } catch (pollError) {
              if (!["TimeoutError","AbortError"].includes(String(pollError?.name || ""))) {
                return res.status(502).json({
                  ok:false,
                  error:"CINEL_STATUS_FAILED",
                  message:"Не удалось проверить статус Kolors."
                });
              }
              lastPollError = String(pollError?.message || pollError);
            }
            await new Promise(resolve => setTimeout(resolve, 900));
          }
          return res.status(504).json({
            ok:false,
            error:"CINEL_STATUS_TIMEOUT",
            message:"Подождите минуту.",
            retryable:true,
            timedOutStatusCheck:Boolean(lastPollError)
          });
        }

        const statusResponse = await fetch("https://cinel.ai/api/cinel/preview-task?taskId=" + encodeURIComponent(currentTaskId), {
          headers:{
            "Accept":"application/json",
            "Origin":"https://cinel.ai",
            "Referer":"https://cinel.ai/free-ai-text-to-image-generator"
          },
          cache:"no-store",
          signal:AbortSignal.timeout(10000)
        });
        const statusRaw = await statusResponse.text();
        let statusPayload = {};
        try { statusPayload = statusRaw ? JSON.parse(statusRaw) : {}; } catch {}
        if (!statusResponse.ok || Number(statusPayload?.code) !== 0) {
          return res.status(502).json({
            ok:false,
            error:"CINEL_STATUS_FAILED",
            message:"Не удалось проверить статус Kolors.",
            upstreamStatus:statusResponse.status,
            upstreamBody:statusRaw.slice(0,600)
          });
        }
        const taskData = statusPayload.data || {};
        const status = String(taskData.status || "").toLowerCase();
        if (status === "success") {
          const outputPath = String(taskData.outputUrl || taskData.outputUrls?.[0] || "");
          let outputUrl = "";
          try {
            const parsed = new URL(outputPath, "https://cinel.ai");
            if (parsed.protocol === "https:" && parsed.hostname === "cinel.ai" && parsed.pathname === "/api/cinel/share") {
              outputUrl = parsed.toString();
            }
          } catch {}
          if (!outputUrl) {
            return res.status(502).json({ok:false,error:"CINEL_OUTPUT_URL_MISSING",message:"Cinel завершил задачу, но не вернул ссылку на изображение."});
          }
          return res.status(200).json({
            ok:true,
            mode:"image",
            status:"completed",
            provider:"Cinel",
            model:"Kolors",
            taskId:currentTaskId,
            imageUrl:outputUrl,
            imageUrls:[outputUrl],
            count:1,
            meta:{free:true,modelId:"kolors",ratio}
          });
        }
        if (["error","failed","cancelled","canceled"].includes(status)) {
          return res.status(502).json({
            ok:false,
            error:"CINEL_GENERATION_FAILED",
            message:"Cinel не смог создать изображение.",
            upstreamBody:JSON.stringify(taskData).slice(0,800)
          });
        }
        return res.status(200).json({
          ok:true,
          mode:"image",
          status:status || "processing",
          provider:"Cinel",
          model:"Kolors",
          taskId:currentTaskId,
          meta:{free:true,modelId:"kolors",ratio}
        });
      } catch (error) {
        return res.status(502).json({
          ok:false,
          error:"CINEL_HANDLER_ERROR",
          message:String(error?.message || error || "Ошибка обращения к Cinel").slice(0,300)
        });
      }
    }

    if (provider === "nanobanana25") {
      const userPrompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
      const referenceImage = typeof body.referenceImage === "string" ? body.referenceImage.trim() : "";
      const allowedAspects = ["1:1", "16:9", "9:16"];
      const aspect = allowedAspects.includes(String(body.ratio || "")) ? String(body.ratio) : "16:9";

      if (requestedModel !== "Nano BananA") {
        return res.status(400).json({
          ok:false,
          error:"NANOBANANA25_MODEL_UNSUPPORTED",
          message:"Неизвестная модель Nano BananA."
        });
      }
      if (!userPrompt) return res.status(400).json({ok:false,error:"PROMPT_REQUIRED"});

      // Send only the user's prompt for Nano BananA; no hidden prompt additions.
      const finalPrompt = userPrompt;

      const deadline = Date.now() + 84000;
      try {
        const createResponse = await fetch("https://nanobanana25.io/api/generate", {
          method:"POST",
          headers:{
            "Content-Type":"application/json",
            "Accept":"application/json",
            "Origin":"https://nanobanana25.io",
            "Referer":"https://nanobanana25.io/"
          },
          // Match the upstream form: prompt + aspect, and referenceImage only for image edits.
          body:JSON.stringify({prompt:finalPrompt,aspect,...(referenceImage?{referenceImage}:{})}),
          cache:"no-store",
          signal:AbortSignal.timeout(18000)
        });

        const createRaw = await createResponse.text();
        let task = {};
        try { task = createRaw ? JSON.parse(createRaw) : {}; } catch {}

        if (!createResponse.ok) {
          const retryAfter = createResponse.headers.get("retry-after") || "";
          return res.status(502).json({
            ok:false,
            error:"NANOBANANA25_CREATE_HTTP",
            message:"Nano BananA не приняла запрос (HTTP " + createResponse.status + ").",
            upstreamStatus:createResponse.status,
            upstreamBody:createRaw.slice(0,800),
            retryAfter
          });
        }

        const taskId = String(task.taskId || "").trim();
        const taskToken = String(task.taskToken || "").trim();
        if (!/^task_[A-Za-z0-9]+$/.test(taskId) || !taskToken) {
          return res.status(502).json({
            ok:false,
            error:"NANOBANANA25_TASK_MISSING",
            message:"Nano BananA не вернула необходимые данные задания."
          });
        }

        let lastStatus = "submitted";
        while (Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 2200));

          let statusResponse;
          try {
            statusResponse = await fetch(
              "https://nanobanana25.io/api/tasks/" + encodeURIComponent(taskId),
              {
                method:"GET",
                headers:{"Accept":"application/json","x-task-token":taskToken},
                cache:"no-store",
                signal:AbortSignal.timeout(6500)
              }
            );
          } catch {
            continue;
          }

          const statusRaw = await statusResponse.text();
          let job = {};
          try { job = statusRaw ? JSON.parse(statusRaw) : {}; } catch {}

          if (!statusResponse.ok) {
            if (statusResponse.status === 429 || statusResponse.status >= 500) continue;
            return res.status(502).json({
              ok:false,
              error:"NANOBANANA25_STATUS_HTTP",
              message:"Не удалось проверить задание Nano BananA (HTTP " + statusResponse.status + ").",
              upstreamStatus:statusResponse.status
            });
          }

          lastStatus = String(job.status || lastStatus).toLowerCase();

          if (["failed","error","cancelled","canceled"].includes(lastStatus)) {
            // Return safe provider diagnostics so failed reference-image edits can be
            // investigated from the Network response without exposing taskToken or image data.
            const safeProviderText = value => typeof value === "string" ? value.slice(0,500) : undefined;
            const providerDiagnostics = {
              taskStatus:lastStatus,
              progress:Number.isFinite(Number(job.progress)) ? Number(job.progress) : undefined,
              errorMessage:safeProviderText(job.errorMessage),
              errorCode:safeProviderText(job.errorCode || job.code),
              reason:safeProviderText(job.reason),
              message:safeProviderText(job.message)
            };
            return res.status(502).json({
              ok:false,
              error:"NANOBANANA25_GENERATION_FAILED",
              message:String(job.errorMessage || job.message || "Nano BananA не смогла создать изображение.").slice(0,240),
              providerDiagnostics
            });
          }

          if (lastStatus === "completed" && typeof job.imageUrl === "string") {
            let imageUrl;
            try { imageUrl = new URL(job.imageUrl); } catch {}
            const validImageUrl = imageUrl &&
              imageUrl.protocol === "https:" &&
              (imageUrl.hostname.toLowerCase() === "getapib.org" ||
               imageUrl.hostname.toLowerCase().endsWith(".getapib.org")) &&
              /^\/f\/images\//.test(imageUrl.pathname);

            if (!validImageUrl) {
              return res.status(502).json({
                ok:false,
                error:"NANOBANANA25_IMAGE_URL_INVALID",
                message:"Nano BananA вернула неподдерживаемый адрес изображения."
              });
            }

            return res.status(200).json({
              ok:true,
              mode:"image",
              status:"completed",
              provider:"NanoBanana25",
              model:"Nano BananA",
              imageUrl:imageUrl.toString(),
              imageUrls:[imageUrl.toString()],
              count:1,
              meta:{free:true,aspect,native:true,noCrop:true,edit:Boolean(referenceImage),resolution:"1K"}
            });
          }
        }

        return res.status(504).json({
          ok:false,
          error:"NANOBANANA25_TIMEOUT",
          message:"Nano BananA не вернула фотографию вовремя. Попробуй ещё раз."
        });
      } catch (error) {
        return res.status(502).json({
          ok:false,
          error:"NANOBANANA25_HANDLER_ERROR",
          message:"Не удалось связаться с Nano BananA: " + String(error?.message || "ошибка запроса").slice(0,180)
        });
      }
    }

    if (provider === "imagefree") {
      const userPrompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
      const allowedRatios = ["1:1", "3:4", "4:3", "16:9", "9:16", "2:3", "3:2", "21:9"];
      const aspectRatio = allowedRatios.includes(String(body.ratio || "")) ? String(body.ratio) : "16:9";
      const action = String(body.action || "start").toLowerCase();
      const taskIdInput = String(body.taskId || "").trim();
      if (requestedModel !== "Z-Image Turbo (ImageFree)") {
        return res.status(400).json({ok:false,error:"IMAGEFREE_MODEL_UNSUPPORTED",message:"Неизвестная модель ImageFree."});
      }
      if (action !== "status" && !userPrompt) return res.status(400).json({ok:false,error:"PROMPT_REQUIRED"});
      if (action === "status" && !taskIdInput) return res.status(400).json({ok:false,error:"IMAGEFREE_TASK_ID_REQUIRED"});

      const requestImageFree = async (url, init) => {
        const isStatusRequest = /\/status\?/.test(url);
        const upstream = await fetch(url, {
          ...init,
          headers: { Accept:"application/json", ...(init?.headers || {}) },
          cache:"no-store",
          signal:AbortSignal.timeout(isStatusRequest ? 9000 : 20000)
        });
        const raw = await upstream.text();
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch {}
        if (!upstream.ok) {
          const error = new Error("ImageFree вернул HTTP " + upstream.status + (data?.message ? ": " + String(data.message) : ""));
          error.status = upstream.status;
          error.body = raw.slice(0, 900);
          throw error;
        }
        return data;
      };

      const normalizeImageFreeStatus = statusData => {
        const status = String(statusData?.status || statusData?.state || "processing").toLowerCase();
        const imageUrl = String(statusData?.image || statusData?.imageUrl || statusData?.image_url || "").trim();
        if (["failed","error","cancelled","canceled"].includes(status)) {
          return {failed:true,status,message:String(statusData?.message || statusData?.error || "ImageFree не смог создать изображение."),upstreamBody:JSON.stringify(statusData).slice(0,900)};
        }
        if (status === "completed" && /^https:\/\//i.test(imageUrl)) {
          let parsed;
          try { parsed = new URL(imageUrl); } catch {}
          if (!parsed || parsed.hostname !== "pub-62e693a7058040f98bba94ed1d6f880b.r2.dev") {
            return {failed:true,status:"error",message:"ImageFree вернул ссылку с неожиданного домена."};
          }
          return {completed:true,status:"completed",imageUrl};
        }
        return {status};
      };

      try {
        if (action === "status") {
          const statusData = await requestImageFree(
            "https://imagefree.net/api/generate/status?taskId=" + encodeURIComponent(taskIdInput),
            {method:"GET"}
          );
          const normalized = normalizeImageFreeStatus(statusData);
          if (normalized.failed) {
            return res.status(502).json({ok:false,error:"IMAGEFREE_GENERATION_FAILED",message:normalized.message,upstreamBody:normalized.upstreamBody || ""});
          }
          if (normalized.completed) {
            return res.status(200).json({
              ok:true,mode:"image",status:"completed",provider:"ImageFree",
              model:"Z-Image Turbo (ImageFree)",imageUrl:normalized.imageUrl,imageUrls:[normalized.imageUrl],count:1,
              meta:{free:true,aspectRatio,taskId:taskIdInput,upstream:"imagefree.net"}
            });
          }
          return res.status(200).json({ok:true,status:normalized.status,provider:"ImageFree",model:"Z-Image Turbo (ImageFree)",taskId:taskIdInput});
        }

        const created = await requestImageFree("https://imagefree.net/api/generate", {
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({prompt:userPrompt,aspect_ratio:aspectRatio,turnstile_token:""})
        });
        const taskId = String(created?.taskId || "").trim();
        if (!taskId) {
          return res.status(502).json({
            ok:false,error:"IMAGEFREE_TASK_ID_MISSING",
            message:String(created?.message || created?.error || "ImageFree не вернул taskId."),
            upstreamBody:JSON.stringify(created).slice(0,900)
          });
        }
        return res.status(200).json({
          ok:true,status:"processing",provider:"ImageFree",model:"Z-Image Turbo (ImageFree)",taskId,
          meta:{free:true,aspectRatio,upstream:"imagefree.net"}
        });
      } catch (error) {
        return res.status(502).json({
          ok:false,error:"IMAGEFREE_HANDLER_ERROR",
          message:String(error?.message || error || "Ошибка обращения к ImageFree."),
          upstreamStatus:error?.status || null,
          upstreamBody:error?.body || ""
        });
      }
    }

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
      const action = String(body.action || "start").toLowerCase();
      const taskId = String(body.taskId || "").trim();
      if (!auraModel) return res.status(400).json({ok:false,error:"AURA_MODEL_UNSUPPORTED",message:"Неизвестная модель Aura."});
      if (action !== "status" && !userPrompt) return res.status(400).json({ok:false,error:"PROMPT_REQUIRED"});

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

      // Status checks are short, independent requests. Never start a second
      // generation when the browser polls an existing task.
      if (action === "status") {
        if (!taskId) return res.status(400).json({ok:false,error:"AURA_TASK_ID_REQUIRED"});
        try {
          const response = await fetch("https://aurasoundai.ru/api/postcard/status?task_id=" + encodeURIComponent(taskId), {
            headers:{Accept:"application/json"},cache:"no-store",signal:AbortSignal.timeout(7000)
          });
          const raw = await response.text();
          let data = {};
          try { data = raw ? JSON.parse(raw) : {}; } catch {}
          if (!response.ok) {
            if (response.status === 429 || response.status >= 500) {
              return res.status(200).json({ok:true,status:"processing",taskId,retryAfter:2,provider:"Aura",model:requestedModel});
            }
            return res.status(502).json({ok:false,error:"AURA_STATUS_HTTP",upstreamStatus:response.status,upstreamBody:raw.slice(0,1000)});
          }
          const status = String(data.status || data.state || "processing");
          const imageUrl = findAuraImage(data);
          if (imageUrl) return res.status(200).json({ok:true,mode:"image",status:"completed",provider:"Aura",model:requestedModel,imageUrl,imageUrls:[imageUrl],count:1,meta:{native:true,noCrop:true,noFrame:true}});
          if (/^(failed|error|cancelled|canceled)$/i.test(status)) {
            return res.status(200).json({ok:true,status:"failed",taskId,message:String(data.error || data.message || "Aura не смогла создать изображение.")});
          }
          return res.status(200).json({ok:true,status:"processing",taskId,retryAfter:2,provider:"Aura",model:requestedModel});
        } catch {
          return res.status(200).json({ok:true,status:"processing",taskId,retryAfter:2,provider:"Aura",model:requestedModel});
        }
      }

      const auraPromptSuffixes = {
        "Nano Banana": "\n\nAn ordinary photograph without postcard styling, filling the image from edge to edge, with no frames, borders, margins, decorative corners, text or greetings.\n\nMaximum achievable image quality, exceptionally fine natural detail, sharp realistic textures, accurate anatomy and realistic material details, lifelike fine detail, balanced exposure, natural lighting, clear details in both highlights and shadows, realistic colors, excellent focus and professional photographic clarity. Avoid artificial sharpening and unnatural textures.",
        "Seedream": "\n\nCreate a normal standalone photorealistic image. Do not create a postcard, greeting card, poster, border, frame, template, or text.\n\nUse the highest available image quality, with exceptionally fine natural detail, accurate anatomy, crisp focus, lifelike textures, balanced exposure, natural lighting, clear highlights and shadows, and true-to-life colors. Preserve a natural photographic appearance without artificial sharpening or excessive processing."
      };
      try {
        const form = new FormData();
        const auraPromptFidelity = "\n\nPROMPT FIDELITY: Treat this as a completely independent image request. Follow only the details explicitly stated in the current prompt; do not carry over, remember, or reuse characters\' clothing, bags, backpacks, briefcases, accessories, props, poses, or composition from any previous generation. Do not invent extra items or clothing that the user did not request. Keep the scene simple and faithful to the current description.";
        const auraPrompt = userPrompt + auraPromptSuffixes[requestedModel] + (requestedModel === "Nano Banana" ? auraPromptFidelity : "");
        form.append("prompt", auraPrompt);
        form.append("model", auraModel);
        const response = await fetch("https://aurasoundai.ru/api/postcard/generate", {
          method:"POST",headers:{Accept:"application/json"},body:form,cache:"no-store",signal:AbortSignal.timeout(20000)
        });
        const raw = await response.text();
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch {}
        if (!response.ok) return res.status(502).json({ok:false,error:"AURA_GENERATE_HTTP",message:"Aura вернула HTTP " + response.status + ".",upstreamStatus:response.status,upstreamBody:raw.slice(0,1200)});
        const imageUrl = findAuraImage(data);
        const newTaskId = String(data.task_id || data.taskId || data.id || "").trim();
        if (imageUrl) return res.status(200).json({ok:true,mode:"image",status:"completed",provider:"Aura",model:requestedModel,imageUrl,imageUrls:[imageUrl],count:1,meta:{native:true,noCrop:true,noFrame:true}});
        if (!newTaskId) return res.status(502).json({ok:false,error:"AURA_TASK_ID_MISSING",message:"Aura не вернула идентификатор задачи.",upstreamBody:raw.slice(0,1200)});
        return res.status(200).json({ok:true,mode:"image",status:"processing",provider:"Aura",model:requestedModel,taskId:newTaskId});
      } catch (error) {
        return res.status(502).json({ok:false,error:"AURA_HANDLER_ERROR",message:String(error?.message||error||"Ошибка обращения к Aura.")});
      }
    }

    if (provider === "qwen21") {
      const qwenPrompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
      const qwenRatio = ["1:1","3:4","4:3","16:9","9:16","2:3","3:2"].includes(String(body.ratio || ""))
        ? String(body.ratio) : "16:9";
      const qwenSize = ["1K","2K","4K"].includes(String(body.quality || "")) ? String(body.quality) : "4K";
      if (requestedModel !== "Qwen Image 2.1 · T2I") {
        return res.status(400).json({ok:false,error:"QWEN21_MODEL_UNSUPPORTED",message:"Неизвестная модель Qwen Image 2.1."});
      }
      if (!qwenPrompt) return res.status(400).json({ok:false,error:"PROMPT_REQUIRED"});
      // Keep the whole Qwen request (including cache retry and image download)
      // inside the studio's shared 70-second generation window. A second upstream
      // attempt must never leave the browser waiting until its XHR is aborted.
      const qwenStartedAt = Date.now();
      const qwenSeed = Math.floor(Math.random() * 2147483647);
      const qwenDeadlineMs = 64000;
      const qwenRemainingMs = () => Math.max(0, qwenDeadlineMs - (Date.now() - qwenStartedAt));
      let qwenQuota = null;
      try {
        // Clipaist documents a 15-images-per-network daily limit. Check it before
        // starting a long synchronous generation request, otherwise an exhausted
        // quota can look like a 55-65 second timeout in the studio.
        try {
          const availability = await fetch("https://clipaist.com/api/tti/availability", {
            method:"GET",
            headers:{
              "Accept":"application/json",
              "Origin":"https://clipaist.com",
              "Referer":"https://clipaist.com/"
            },
            cache:"no-store",
            signal:AbortSignal.timeout(5000)
          });
          if (availability.ok) {
            const availabilityRaw = await availability.text();
            let availabilityData = {};
            try { availabilityData = availabilityRaw ? JSON.parse(availabilityRaw) : {}; } catch {}
            const used = Number(availabilityData.used);
            const limit = Number(availabilityData.limit);
            if (Number.isFinite(used) && Number.isFinite(limit) && limit > 0) {
              qwenQuota = {used,limit};
              if (used >= limit) {
                return res.status(429).json({
                  ok:false,error:"QWEN21_RATE_LIMIT",
                  message:"Лимит Clipaist исчерпан: " + used + "/" + limit + " изображений на сеть за сутки. Это ограничение сервиса, не формата изображения.",
                  upstreamStatus:429,used,limit
                });
              }
            }
          }
        } catch {}
        const upstream = await fetch("https://clipaist.com/api/tti/generate", {
          method:"POST",
          headers:{
            "Content-Type":"application/json",
            "Accept":"application/json",
            "Origin":"https://clipaist.com",
            "Referer":"https://clipaist.com/"
          },
          // Preserve the exact visible prompt. A fresh seed distinguishes this generation
          // from Clipaist's stale cached result without injecting hidden characters.
          body:JSON.stringify({model:"Qwen/Qwen-Image-2.1",prompt:qwenPrompt,size:qwenSize,ratio:qwenRatio,seed:qwenSeed}),
          cache:"no-store",
          // Leave 15 seconds inside the shared 70-second browser deadline for a structured response.
          signal:AbortSignal.timeout(55000)
        });
        let raw = await upstream.text();
        let result = {};
        try { result = raw ? JSON.parse(raw) : {}; } catch {}
        if (!upstream.ok) {
          const status = upstream.status;
          const upstreamRetry = Number(result?.data?.retryAfter ?? result?.retryAfter ?? upstream.headers.get("retry-after") ?? 0);
          const retryAfter = Number.isFinite(upstreamRetry) && upstreamRetry > 0 ? upstreamRetry : 0;
          const isBusyQueue = result?.data?.code === "queue_full" || /queue is busy/i.test(String(result?.message || result?.statusMessage || ""));
          const limitMessage = status === 429
            ? "Clipaist достиг лимита генераций. Подожди, пока лимит обновится."
            : isBusyQueue
              ? "Очередь Clipaist сейчас перегружена." + (retryAfter ? " Попробуй снова через " + retryAfter + " секунд." : " Попробуй снова немного позже.")
              : "Clipaist вернул HTTP " + status + ".";
          return res.status(status === 429 ? 429 : 502).json({
            ok:false,error:status === 429 ? "QWEN21_RATE_LIMIT" : isBusyQueue ? "QWEN21_QUEUE_BUSY" : "QWEN21_UPSTREAM_HTTP",
            message:limitMessage,upstreamStatus:status,upstreamBody:raw.slice(0,700),retryAfter
          });
        }
        let upstreamModelValue = result.model || result.data?.model || result.meta?.model || result.upstreamModel || result.data?.upstreamModel || "";
        let upstreamModel = typeof upstreamModelValue === "string" ? upstreamModelValue.trim() : "";
        const isConfirmedQwen = value => !!value && (/qwen.*image/i.test(value) || value.toLowerCase().includes("qwen/qwen-image"));

        // Clipaist has returned cached Agnes-hosted images with no model metadata.
        // Retry once with a different seed, keeping the user's prompt byte-for-byte unchanged.
        // Never accept the cached image unless the retry explicitly confirms Qwen.
        let qwenCacheRetryAttempted = false;
        if (!isConfirmedQwen(upstreamModel) && result.cached === true) {
          qwenCacheRetryAttempted = true;
          try {
            const retrySeed = Math.floor(Math.random() * 2147483647);
            const retryResponse = await fetch("https://clipaist.com/api/tti/generate", {
              method:"POST",
              headers:{
                "Content-Type":"application/json",
                "Accept":"application/json",
                "Origin":"https://clipaist.com",
                "Referer":"https://clipaist.com/"
              },
              body:JSON.stringify({model:"Qwen/Qwen-Image-2.1",prompt:qwenPrompt,size:qwenSize,ratio:qwenRatio,seed:retrySeed}),
              cache:"no-store",
              // Use only the time remaining before the browser's shared deadline.
              signal:AbortSignal.timeout(Math.max(1000, Math.min(25000, qwenRemainingMs() - 1500)))
            });
            const retryRaw = await retryResponse.text();
            let retryResult = {};
            try { retryResult = retryRaw ? JSON.parse(retryRaw) : {}; } catch {}
            const retryModelValue = retryResult.model || retryResult.data?.model || retryResult.meta?.model || retryResult.upstreamModel || retryResult.data?.upstreamModel || "";
            const retryModel = typeof retryModelValue === "string" ? retryModelValue.trim() : "";
            if (retryResponse.ok && isConfirmedQwen(retryModel)) {
              result = retryResult;
              raw = retryRaw;
              upstreamModelValue = retryModelValue;
              upstreamModel = retryModel;
            }
          } catch {}
        }

        if (!isConfirmedQwen(upstreamModel)) {
          const safeModelValue = value => typeof value === "string" ? value.slice(0,120) : value == null ? null : typeof value;
          return res.status(502).json({
            ok:false,error:"QWEN21_MODEL_UNCONFIRMED",
            message:"Clipaist не подтвердил, что изображение создано Qwen Image 2.1. Результат не будет показан как Qwen.",
            upstreamModel:upstreamModel || null,
            upstreamDiagnostics:{
              topLevelKeys:Object.keys(result).slice(0,40),
              dataKeys:result.data && typeof result.data === "object" ? Object.keys(result.data).slice(0,40) : [],
              metaKeys:result.meta && typeof result.meta === "object" ? Object.keys(result.meta).slice(0,40) : [],
              resultKeys:result.result && typeof result.result === "object" ? Object.keys(result.result).slice(0,40) : [],
              modelFields:{
                model:safeModelValue(result.model),
                dataModel:safeModelValue(result.data?.model),
                metaModel:safeModelValue(result.meta?.model),
                upstreamModel:safeModelValue(result.upstreamModel),
                dataUpstreamModel:safeModelValue(result.data?.upstreamModel),
                status:safeModelValue(result.status),
                message:safeModelValue(result.message)
              },
              taskIdPresent:typeof result.taskId === "string" && !!result.taskId.trim(),
              cached:typeof result.cached === "boolean" ? result.cached : null,
              cacheRetryAttempted:qwenCacheRetryAttempted,
              urlInfo:(() => {
                const value = typeof result.url === "string" ? result.url : "";
                if (!value) return {present:false,host:null,path:null,looksLikeImage:false};
                try {
                  const parsed = new URL(value);
                  return {
                    present:true,
                    host:parsed.hostname.slice(0,180),
                    path:parsed.pathname.slice(0,240),
                    looksLikeImage:/\.(png|jpe?g|webp|avif)(;|$)/i.test(parsed.pathname) || /image|output|result|download/i.test(parsed.pathname)
                  };
                } catch {
                  return {present:true,host:null,path:null,looksLikeImage:/^data:image\//i.test(value)};
                }
              })()
            }
          });
        }
        const imageValue = [
          result.url, result.image, result.imageUrl, result.image_url, result.imageData, result.image_data,
          result.output, result.data?.url, result.data?.image, result.data?.imageUrl, result.data?.image_url,
          result.data?.imageData, result.result?.url, result.result?.image, result.result?.imageUrl
        ].find(value => typeof value === "string" && value.trim());
        let sourceBytes;
        const dataMatch = String(imageValue || "").match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\r\n]+)$/i);
        if (dataMatch) {
          sourceBytes = Buffer.from(dataMatch[2].replace(/\s/g,""),"base64");
        } else if (typeof imageValue === "string" && /^https:\/\//i.test(imageValue)) {
          // Clipaist sometimes returns a cached result as a hosted image URL
          // (platform-outputs.agnes-ai.space) instead of a data URL.
          // Only fetch its known output host; never follow arbitrary URLs from upstream.
          let parsedImageUrl;
          try { parsedImageUrl = new URL(imageValue); } catch {}
          if (!parsedImageUrl || parsedImageUrl.protocol !== "https:") {
            return res.status(502).json({
              ok:false,error:"QWEN21_IMAGE_URL_UNSUPPORTED",
              message:"Clipaist вернул неподдерживаемый адрес изображения."
            });
          }
          if (parsedImageUrl.hostname.toLowerCase() === "platform-outputs.agnes-ai.space" || parsedImageUrl.hostname.toLowerCase().endsWith(".agnes-ai.space")) {
            return res.status(502).json({
              ok:false,error:"QWEN21_WRONG_IMAGE_HOST",
              message:"Clipaist вернул файл с домена Agnes, а не подтверждённый результат Qwen. Файл отклонён.",
              outputHost:parsedImageUrl.hostname,
              outputPath:parsedImageUrl.pathname
            });
          }
          const imageTimeLeft = qwenRemainingMs();
          if (imageTimeLeft <= 1500) {
            return res.status(502).json({
              ok:false,error:"QWEN21_DEADLINE_EXCEEDED",
              message:"Clipaist слишком долго отвечал, чтобы безопасно получить изображение в пределах общего времени генерации."
            });
          }
          const imageResponse = await fetch(parsedImageUrl.toString(), {
            headers:{Accept:"image/*"},
            cache:"no-store",
            redirect:"error",
            signal:AbortSignal.timeout(Math.min(20000, imageTimeLeft - 1000))
          });
          if (!imageResponse.ok) {
            return res.status(502).json({
              ok:false,error:"QWEN21_IMAGE_DOWNLOAD_FAILED",
              message:"Не удалось получить готовое изображение Qwen из Clipaist.",
              upstreamStatus:imageResponse.status
            });
          }
          const contentType = imageResponse.headers.get("content-type") || "";
          if (!/^image\/(png|jpeg|jpg|webp)(;|$)/i.test(contentType)) {
            return res.status(502).json({
              ok:false,error:"QWEN21_IMAGE_CONTENT_TYPE",
              message:"Clipaist вернул ссылку, но по ней нет файла изображения."
            });
          }
          const contentLength = Number(imageResponse.headers.get("content-length") || 0);
          if (contentLength > 15 * 1024 * 1024) {
            return res.status(413).json({ok:false,error:"QWEN21_IMAGE_SIZE",message:"Qwen Image 2.1 вернул слишком большое изображение."});
          }
          sourceBytes = Buffer.from(await imageResponse.arrayBuffer());
        } else {
          return res.status(502).json({
            ok:false,error:"QWEN21_IMAGE_MISSING",
            message:"Clipaist не вернул готовое изображение в ожидаемом формате.",
            upstreamBody:raw.slice(0,700)
          });
        }
        if (!sourceBytes.length || sourceBytes.length > 15 * 1024 * 1024) {
          return res.status(413).json({ok:false,error:"QWEN21_IMAGE_SIZE",message:"Qwen Image 2.1 вернул пустое или слишком большое изображение."});
        }
        const jpeg = await sharp(sourceBytes).rotate().jpeg({quality:90,mozjpeg:true}).toBuffer();
        if (!jpeg.length || jpeg.length > 3 * 1024 * 1024) {
          return res.status(413).json({ok:false,error:"QWEN21_IMAGE_TOO_LARGE",message:"Фотография Qwen Image 2.1 слишком большая для передачи в студию."});
        }
        const imageUrl = "data:image/jpeg;base64," + jpeg.toString("base64");
        return res.status(200).json({
          ok:true,mode:"image",status:"completed",provider:"Clipaist",model:"Qwen Image 2.1 · T2I",
          imageUrl,imageUrls:[imageUrl],count:1,
          meta:{free:true,ratio:qwenRatio,requestedSize:qwenSize,upstreamModel}
        });
      } catch (error) {
        const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError" || /timed? ?out|abort/i.test(String(error?.message||""));
        return res.status(502).json({
          ok:false,
          error:timedOut ? "QWEN21_UPSTREAM_TIMEOUT" : "QWEN21_HANDLER_ERROR",
          message:timedOut
            ? "Clipaist не вернул Qwen Image 2.1 за 55 секунд. Очередь генерации могла зависнуть; попробуй ещё раз позже."
            : "Не удалось связаться с Clipaist: " + String(error?.message||error||"ошибка запроса").slice(0,180),
          ...(qwenQuota ? {upstreamQuota:qwenQuota} : {})
        });
      }
    }

    if (provider === "imagesmith") {
      const imageSmithPrompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
      const imageSmithRatio = ["1:1","3:4","4:3","16:9","9:16","2:3","3:2","21:9"].includes(String(body.ratio || ""))
        ? String(body.ratio) : "16:9";
      const imageSmithReference = typeof body.referenceImage === "string" ? body.referenceImage.trim() : "";
      if (imageSmithReference && (
        imageSmithReference.length > 2_000_000 ||
        !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=\r\n]+$/i.test(imageSmithReference)
      )) {
        return res.status(400).json({ok:false,error:"IMAGESMITH_REFERENCE_INVALID",message:"Не удалось прочитать исходную фотографию для GPT Image 2.5."});
      }
      if (requestedModel !== "ImageSmith") {
        return res.status(400).json({ok:false,error:"IMAGESMITH_MODEL_UNSUPPORTED",message:"Неизвестная модель ImageSmith."});
      }
      if (!imageSmithPrompt) return res.status(400).json({ok:false,error:"PROMPT_REQUIRED"});
      const shape = imageSmithRatio === "1:1" ? "square"
        : ["9:16","2:3","3:4"].includes(imageSmithRatio) ? "portrait" : "landscape";
      try {
        // For fresh GPT Image 2.5 generations only, explicitly isolate the request from prior outputs.
        // Do not append this to edits, where the uploaded source image must remain the editing context.
        const imageSmithFinalPrompt = imageSmithReference ? imageSmithPrompt : imageSmithPrompt +
          "\n\nPROMPT FIDELITY: Treat this as a completely independent image request. Follow only the details explicitly stated in the current prompt; do not carry over, remember, or reuse characters' clothing, bags, backpacks, briefcases, accessories, props, poses, or composition from any previous generation. Do not invent extra items or clothing that the user did not request. Keep the scene simple and faithful to the current description. Make objects interact naturally with the character: if a character is looking at a phone, the phone screen should face the character unless the prompt explicitly asks for a different orientation.";
        const upstream = await fetch("https://aiimagesmith.com/api/image", {
          method:"POST",
          headers:{
            "Content-Type":"application/json",
            "Accept":"application/json",
            "Origin":"https://aiimagesmith.com",
            "Referer":"https://aiimagesmith.com/"
          },
          body:JSON.stringify({bg:"",mode:imageSmithReference?"edit":"generate",prompt:imageSmithFinalPrompt,shape,transparent:false,...(imageSmithReference?{image:imageSmithReference}:{})}),
          cache:"no-store",
          signal:AbortSignal.timeout(65000)
        });
        const raw = await upstream.text();
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch {}
        if (!upstream.ok) {
          return res.status(502).json({
            ok:false,error:"IMAGESMITH_UPSTREAM_HTTP",
            message:"ImageSmith вернул HTTP " + upstream.status + ".",
            upstreamStatus:upstream.status,
            upstreamBody:raw.slice(0,700)
          });
        }
        const imageData = typeof data.image === "string" ? data.image
          : typeof data.data?.image === "string" ? data.data.image : "";
        const match = imageData.match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\r\n]+)$/i);
        if (!match) {
          return res.status(502).json({
            ok:false,error:"IMAGESMITH_IMAGE_MISSING",
            message:"ImageSmith не вернул фотографию в ожидаемом формате.",
            upstreamBody:raw.slice(0,700)
          });
        }
        const sourceBytes = Buffer.from(match[2].replace(/\s/g,""),"base64");
        if (!sourceBytes.length || sourceBytes.length > 15 * 1024 * 1024) {
          return res.status(413).json({ok:false,error:"IMAGESMITH_IMAGE_SIZE",message:"ImageSmith вернул пустое или слишком большое изображение."});
        }
        // Convert the PNG data URL to a compact JPEG data URL so the response
        // fits comfortably within serverless response limits and the existing wall can display it.
        const jpeg = await sharp(sourceBytes).rotate().jpeg({quality:90,mozjpeg:true}).toBuffer();
        if (!jpeg.length || jpeg.length > 3 * 1024 * 1024) {
          return res.status(413).json({ok:false,error:"IMAGESMITH_IMAGE_TOO_LARGE",message:"Фотография ImageSmith слишком большая для передачи в студию."});
        }
        const resultUrl = "data:image/jpeg;base64," + jpeg.toString("base64");
        return res.status(200).json({
          ok:true,mode:"image",status:"completed",provider:"ImageSmith",model:"ImageSmith",
          imageUrl:resultUrl,imageUrls:[resultUrl],count:1,
          meta:{free:true,shape,requestedRatio:imageSmithRatio,native:true,noCrop:true,transparent:false,edit:Boolean(imageSmithReference)}
        });
      } catch (error) {
        const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError" || /timed? ?out|abort/i.test(String(error?.message||""));
        return res.status(502).json({
          ok:false,
          error:timedOut ? "IMAGESMITH_UPSTREAM_TIMEOUT" : "IMAGESMITH_HANDLER_ERROR",
          message:timedOut
            ? "ImageSmith не ответил за 65 секунд. Возможно, сервис временно недоступен."
            : "Не удалось связаться с ImageSmith: " + String(error?.message||error||"ошибка запроса").slice(0,180)
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
        message: "Для Flux Kontext нужно загрузить исходное изображение."
      });
    }

    // Send the user's prompt unchanged, with only the selected ratio.
    if (!isImageToImage) {
      const upstream = await fetch("https://ahm7xmakki.com/api/tti", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ prompt, ratio }),
        signal: AbortSignal.timeout(25000)
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
        host==="getapib.org" || host.endsWith(".getapib.org") ||
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
    if (error?.name === "AbortError" || error?.name === "TimeoutError") {
      return res.status(504).json({
        ok: false,
        error: "FLUX_TIMEOUT",
        message: "AHM7 не завершил запрос в течение 25 секунд."
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
