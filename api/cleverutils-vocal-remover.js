export const config = { api: { bodyParser: false } };
export const maxDuration = 300;

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function parseMultipartFile(body, contentType) {
  const match = String(contentType || "").match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const boundary = match?.[1] || match?.[2];
  if (!boundary) throw new Error("MULTIPART_BOUNDARY_MISSING");

  const headerStart = body.indexOf(Buffer.from("--" + boundary)) + boundary.length + 2;
  if (headerStart < boundary.length + 2) throw new Error("MULTIPART_FILE_MISSING");

  const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), headerStart);
  if (headerEnd < 0) throw new Error("MULTIPART_HEADERS_MISSING");

  const headers = body.subarray(headerStart, headerEnd).toString("utf8");
  const disposition = headers.match(/Content-Disposition:[^\r\n]*name="file"[^\r\n]*/i);
  if (!disposition) throw new Error("MULTIPART_FILE_FIELD_MISSING");

  const fileStart = headerEnd + 4;
  const fileEnd = body.indexOf(Buffer.from("\r\n--" + boundary), fileStart);
  if (fileEnd < 0 || fileEnd <= fileStart) throw new Error("MULTIPART_FILE_DATA_MISSING");

  const filename = (disposition[0].match(/filename="([^"]*)"/i)?.[1] || "miya-audio.mp3").trim();
  const mime = (headers.match(/Content-Type:\s*([^\r\n]+)/i)?.[1] || "audio/mpeg").trim().toLowerCase();
  const file = body.subarray(fileStart, fileEnd);
  if (!file.length) throw new Error("AUDIO_EMPTY");

  return { file, filename, mime };
}

function collectUrls(value, out = []) {
  if (value == null) return out;

  const add = (url, name = "", mime = "", description = "") => {
    if (typeof url !== "string") return;
    const clean = url.trim();
    if (!/^https?:\/\//i.test(clean)) return;
    if (/^https?:\/\/(?:www\.)?cleverutils\.com\/?$/i.test(clean)) return;
    if (out.some(x => x.url === clean)) return;
    out.push({
      url: clean,
      name: String(name || ""),
      mime: String(mime || ""),
      description: String(description || "")
    });
  };

  if (Array.isArray(value)) {
    value.forEach(item => collectUrls(item, out));
    return out;
  }

  if (typeof value === "object") {
    const name = String(value.name || "");
    const mime = String(value.mimeType || value.mime || "");
    const description = String(value.description || value.text || "");

    if (value.type === "resource_link") add(value.uri || value.url, name, mime, description);
    if (typeof value.url === "string") add(value.url, name, mime, description);
    if (typeof value.uri === "string") add(value.uri, name, mime, description);

    Object.values(value).forEach(child => collectUrls(child, out));
    return out;
  }

  if (typeof value === "string") {
    const matches = value.match(/https?:\/\/[^\s"'<>\\]+/g) || [];
    matches.forEach(url => add(url.replace(/[),.;]+$/g, "")));
  }

  return out;
}

function chooseOutputLinks(links) {
  const rank = link => {
    const s = (link.url + " " + link.name + " " + link.description).toLowerCase();
    let score = 0;
    if (/download|output|result|job|resource|file|media/.test(s)) score += 20;
    if (/\.mp3(?:$|\?)/.test(s)) score += 8;
    if (/\.wav(?:$|\?)/.test(s)) score += 6;
    if (/audio|music|stem/.test(s)) score += 3;
    return score;
  };
  return [...links].sort((a, b) => rank(b) - rank(a));
}

function classifyLink(link) {
  const s = (link.url + " " + link.name + " " + link.description).toLowerCase();
  return {
    vocals: /(vocal|vocals|acapella|voice)/.test(s) && !/(instrumental|instrument|karaoke|backing|accompaniment|minus)/.test(s),
    instrumental: /(instrumental|instrument|karaoke|backing|accompaniment|minus)/.test(s)
  };
}

function localOutputUrl(req, externalUrl) {
  const protocol = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host = String(req.headers.host || "miya-studio.vercel.app").split(",")[0].trim();
  return protocol + "://" + host + "/api/cleverutils-vocal-remover?output=" + encodeURIComponent(externalUrl);
}

function isAllowedOutputHost(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "cleverutils.com" || host.endsWith(".cleverutils.com");
  } catch {
    return false;
  }
}

function parseMcpResponse(raw) { try { return JSON.parse(raw); } catch {} const messages=[]; for (const line of String(raw||"").split(/\r?\n/)) { const m=line.match(/^data:\s*(.+)$/i); if (!m) continue; try { messages.push(JSON.parse(m[1])); } catch {} } for (let i=messages.length-1;i>=0;i--) { const item=messages[i]; if (item?.result||item?.error||item?.data) return item; } if (messages.length) return messages[messages.length-1]; throw new Error("CLEVERUTILS_MCP_INVALID_JSON"); }

async function proxyOutput(req, res, externalUrl) {
  if (!isAllowedOutputHost(externalUrl)) {
    return res.status(400).json({ error: "OUTPUT_URL_NOT_ALLOWED" });
  }

  const upstream = await fetch(externalUrl, {
    method: "GET",
    headers: { accept: "audio/*,application/octet-stream,*/*" },
    cache: "no-store"
  });

  if (!upstream.ok) {
    const message = await upstream.text().catch(() => "");
    return res.status(upstream.status).json({
      error: "CLEVERUTILS_OUTPUT_FETCH_FAILED",
      message: message.slice(0, 500)
    });
  }

  const buffer = Buffer.from(await upstream.arrayBuffer());
  const contentType = upstream.headers.get("content-type") || "audio/mpeg";
  const disposition = upstream.headers.get("content-disposition");
  res.status(200);
  res.setHeader("content-type", contentType);
  res.setHeader("cache-control", "private, no-store, max-age=0");
  if (disposition) res.setHeader("content-disposition", disposition);
  res.send(buffer);
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const output = String(req.query?.output || "").trim();
      if (output) return await proxyOutput(req, res, output);

      const jobId = String(req.query?.job || "").trim();
      if (!jobId) return res.status(400).json({ error: "JOB_ID_REQUIRED" });

      const upstream = await fetch(
        "https://cleverutils.com/api/v1/jobs/" + encodeURIComponent(jobId),
        { method: "GET", headers: { accept: "application/json" }, cache: "no-store" }
      );
      const text = await upstream.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        res.status(upstream.status);
        res.setHeader("content-type", upstream.headers.get("content-type") || "application/json");
        res.send(text);
        return;
      }
      const data = payload?.data || payload;
      const rewrite = value => {
        if (!value || typeof value !== "object") return;
        if (typeof value.url === "string" && isAllowedOutputHost(value.url)) {
          value.url = localOutputUrl(req, value.url);
        }
        if (typeof value.outputUrl === "string" && isAllowedOutputHost(value.outputUrl)) {
          value.outputUrl = localOutputUrl(req, value.outputUrl);
        }
      };
      rewrite(data?.output);
      rewrite(data?.outputs?.vocals);
      rewrite(data?.outputs?.instrumental);
      if (data?.links && typeof data.links === "object" && typeof data.links.output === "string" && isAllowedOutputHost(data.links.output)) {
        data.links.output = localOutputUrl(req, data.links.output);
      }
      res.status(upstream.status);
      res.setHeader("content-type", upstream.headers.get("content-type") || "application/json");
      res.send(JSON.stringify(payload));
      return;
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    }

    const body = await readRequestBody(req);
    const contentType = String(req.headers["content-type"] || "");
    if (!body.length || !contentType.toLowerCase().startsWith("multipart/form-data")) {
      return res.status(400).json({ error: "MULTIPART_FILE_REQUIRED" });
    }

    const { file, filename, mime } = parseMultipartFile(body, contentType);
    const fileBase64 = file.toString("base64");

    const upstreamForm = new FormData();
    upstreamForm.append("file", new Blob([file], { type: mime || "application/octet-stream" }), filename);

    // Use the documented REST endpoint instead of MCP for this heavy operation.
    // REST returns a job_id quickly; the browser polls the job while Vercel
    // avoids holding a serverless request open for the 1–3 minute Demucs run.
    const upstream = await fetch("https://cleverutils.com/api/v1/tools/vocal-remover", {
      method: "POST",
      body: upstreamForm,
      headers: { accept: "application/json" },
      cache: "no-store"
    });

    const upstreamText = await upstream.text();
    let payload;
    try {
      payload = JSON.parse(upstreamText);
    } catch {
      return res.status(502).json({
        error: "CLEVERUTILS_REST_INVALID_JSON",
        message: upstreamText.slice(0, 1000)
      });
    }

    if (!upstream.ok) {
      return res.status(upstream.status).json(payload);
    }

    const data = payload?.data || payload;
    const rewriteOutput = value => {
      if (!value || typeof value !== "object") return;
      if (typeof value.url === "string" && isAllowedOutputHost(value.url)) {
        value.url = localOutputUrl(req, value.url);
      }
      if (typeof value.outputUrl === "string" && isAllowedOutputHost(value.outputUrl)) {
        value.outputUrl = localOutputUrl(req, value.outputUrl);
      }
    };
    rewriteOutput(data?.output);
    rewriteOutput(data?.outputs?.vocals);
    rewriteOutput(data?.outputs?.instrumental);
    if (data?.links && typeof data.links === "object") {
      if (typeof data.links.output === "string" && isAllowedOutputHost(data.links.output)) {
        data.links.output = localOutputUrl(req, data.links.output);
      }
      if (typeof data.links.self === "string") {
        data.links.self = "/api/cleverutils-vocal-remover?job=" + encodeURIComponent(String(data.job_id || ""));
      }
    }

    return res.status(upstream.status).json(payload);
  } catch (error) {
    console.error("CleverUtils vocal MCP proxy failed:", error);
    return res.status(502).json({
      error: "CLEVERUTILS_PROXY_FAILED",
      message: String(error?.message || error)
    });
  }
}
