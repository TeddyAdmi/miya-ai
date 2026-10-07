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

  const marker = Buffer.from("--" + boundary);
  const start = body.indexOf(marker);
  if (start < 0) throw new Error("MULTIPART_FILE_MISSING");

  const headerStart = start + marker.length + 2;
  const headerEnd = body.indexOf(Buffer.from("    const links = chooseOutputLinks(uniqueLinks(extractResourceLinks(payload?.result)));
    if (links.length < 2) {
      return res.status(502).json({ error:"CLEVERUTILS_MCP_OUTPUT_MISSING", message:"CleverUtils MCP did not return both vocal and instrumental download URLs.", filename, mime, received:links });
    }
    const score = link => {
      const s=(link.url+" "+link.name+" "+link.description).toLowerCase();
      return { vocals:/(vocal|vocals|acapella|voice)/.test(s)&&!/(instrumental|instrument|karaoke|backing|accompaniment|minus)/.test(s), instrumental:/(instrumental|instrument|karaoke|backing|accompaniment|minus)/.test(s) };
    };
    const vocalLink=links.find(x=>score(x).vocals)||links[0];
    const instrumentalLink=links.find(x=>x.url!==vocalLink.url&&score(x).instrumental)||links.find(x=>x.url!==vocalLink.url)||links[1];r\n\r\n"), headerStart);
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

function extractResourceLinks(value, out = []) {
  if (!value) return out;
  const add = (url, name = "", mime = "", description = "") => {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return;
    if (/^https?:\/\/(?:www\.)?cleverutils\.com\/?$/i.test(url.trim())) return;
    out.push({ url:url.trim(), name:String(name||""), mime:String(mime||""), description:String(description||"") });
  };
  if (Array.isArray(value)) { value.forEach(item => extractResourceLinks(item,out)); return out; }
  if (typeof value === "object") {
    const name=String(value.name||""), mime=String(value.mimeType||value.mime||""), description=String(value.description||value.text||"");
    if (value.type==="resource_link") add(value.uri||value.url,name,mime,description);
    if (typeof value.url==="string") add(value.url,name,mime,description);
    if (typeof value.uri==="string") add(value.uri,name,mime,description);
    Object.values(value).forEach(child=>extractResourceLinks(child,out));
    return out;
  }
  if (typeof value==="string") (value.match(/https?:\/\/[^\s"'<>\\]+/g)||[]).forEach(url=>add(url.replace(/[),.;]+$/g,"")));
  return out;
}
function uniqueLinks(links) {
  const seen=new Set();
  return links.filter(link=>link?.url&&!seen.has(link.url)&&seen.add(link.url));
}
function chooseOutputLinks(links) {
  const rank=link=>{const s=(link.url+" "+link.name+" "+link.description).toLowerCase();let n=0;if(/download|output|result|job|resource|file|media/.test(s))n+=10;if(/\.mp3(?:$|\?)/.test(s))n+=5;if(/audio/.test(s))n+=3;if(/\.wav(?:$|\?)/.test(s))n+=2;return n};
  return [...links].sort((x,y)=>rank(y)-rank(x));
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
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
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "vocal_remover",
          arguments: {
            file: fileBase64
          }
        }
      }),
      cache: "no-store"
    });

    const raw = await mcp.text();
    let payload = {};
    try { payload = JSON.parse(raw); } catch {
      return res.status(502).json({ error: "CLEVERUTILS_MCP_INVALID_JSON", message: raw.slice(0, 500) });
    }

    if (!mcp.ok || payload?.error) {
      const message = payload?.error?.message || "CLEVERUTILS_MCP_FAILED";
      return res.status(mcp.status >= 400 ? mcp.status : 502).json({ error: "CLEVERUTILS_MCP_FAILED", message });
    }

    const links = uniqueLinks(extractResourceLinks(payload?.result));
    if (links.length < 2) {
      const textParts = [];
      const collectText = value => {
        if (!value) return;
        if (Array.isArray(value)) return value.forEach(collectText);
        if (typeof value === "object") return Object.entries(value).forEach(([k,v]) => k === "text" ? textParts.push(String(v)) : collectText(v));
      };
      collectText(payload?.result);
      const urls = [...new Set(textParts.join("\n").match(/https?:\/\/[^\s"'<>]+/g) || [])];
      urls.forEach(url => links.push({ url, name: "", mime: "", description: "" }));
    }

    if (links.length < 2) {
      return res.status(502).json({
        error: "CLEVERUTILS_MCP_OUTPUT_MISSING",
        message: "CleverUtils MCP did not return both vocal and instrumental files.",
        filename,
        mime
      });
    }

    const score = link => {
      const s = (link.name + " " + link.description).toLowerCase();
      return {
        vocals: /(vocal|vocals|acapella|voice)/.test(s),
        instrumental: /(instrumental|instrument|karaoke|backing|accompaniment|minus)/.test(s)
      };
    };

    const vocalLink = links.find(x => score(x).vocals && !score(x).instrumental) || links[0];
    const instrumentalLink = links.find(x => x.url !== vocalLink.url && score(x).instrumental) || links.find(x => x.url !== vocalLink.url) || links[1];

    return res.status(200).json({
      data: {
        status: "done",
        outputs: {
          vocals: { url: vocalLink.url, filename: vocalLink.name || "vocals.mp3", mime: vocalLink.mime || "audio/mpeg" },
          instrumental: { url: instrumentalLink.url, filename: instrumentalLink.name || "instrumental.mp3", mime: instrumentalLink.mime || "audio/mpeg" }
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
