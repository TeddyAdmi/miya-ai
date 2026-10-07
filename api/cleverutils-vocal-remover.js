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
      res.status(upstream.status);
      res.setHeader("content-type", upstream.headers.get("content-type") || "application/json");
      res.send(text);
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

    const mcp = await fetch("https://cleverutils.com/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "vocal_remover",
          arguments: { file: fileBase64 }
        }
      }),
      cache: "no-store"
    });

    const raw = await mcp.text();
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return res.status(502).json({
        error: "CLEVERUTILS_MCP_INVALID_JSON",
        message: raw.slice(0, 1000)
      });
    }

    if (!mcp.ok || payload?.error) {
      const message = payload?.error?.message || "CLEVERUTILS_MCP_FAILED";
      return res.status(mcp.status >= 400 ? mcp.status : 502).json({
        error: "CLEVERUTILS_MCP_FAILED",
        message
      });
    }

    let links = chooseOutputLinks(collectUrls(payload?.result));

    if (links.length < 2) {
      const textParts = [];
      const collectText = value => {
        if (value == null) return;
        if (Array.isArray(value)) return value.forEach(collectText);
        if (typeof value === "object") {
          return Object.entries(value).forEach(([key, child]) => {
            if (key === "text" && typeof child === "string") textParts.push(child);
            else collectText(child);
          });
        }
      };
      collectText(payload?.result);

      const textUrls = [];
      for (const match of textParts.join("\n").match(/https?:\/\/[^\s"'<>]+/g) || []) {
        const clean = match.replace(/[),.;]+$/g, "");
        if (!textUrls.includes(clean)) textUrls.push(clean);
      }
      links = chooseOutputLinks(collectUrls(textUrls));
    }

    if (links.length < 2) {
      return res.status(502).json({
        error: "CLEVERUTILS_MCP_OUTPUT_MISSING",
        message: "CleverUtils MCP did not return both vocal and instrumental download URLs.",
        filename,
        mime,
        received: links
      });
    }

    const vocalLink =
      links.find(link => classifyLink(link).vocals) || links[0];

    const instrumentalLink =
      links.find(link => link.url !== vocalLink.url && classifyLink(link).instrumental) ||
      links.find(link => link.url !== vocalLink.url) ||
      links[1];

    if (!vocalLink?.url || !instrumentalLink?.url) {
      return res.status(502).json({
        error: "CLEVERUTILS_MCP_OUTPUT_MISSING",
        message: "CleverUtils MCP returned incomplete stem links."
      });
    }

    return res.status(200).json({
      data: {
        status: "done",
        outputs: {
          vocals: {
            url: localOutputUrl(req, vocalLink.url),
            filename: vocalLink.name || "vocals.mp3",
            mime: vocalLink.mime || "audio/mpeg"
          },
          instrumental: {
            url: localOutputUrl(req, instrumentalLink.url),
            filename: instrumentalLink.name || "instrumental.mp3",
            mime: instrumentalLink.mime || "audio/mpeg"
          }
        }
      }
    });
  } catch (error) {
    console.error("CleverUtils vocal MCP proxy failed:", error);
    return res.status(502).json({
      error: "CLEVERUTILS_PROXY_FAILED",
      message: String(error?.message || error)
    });
  }
}
