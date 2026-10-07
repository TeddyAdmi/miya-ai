export const config = { api: { bodyParser: false } };
export const maxDuration = 300;

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
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

    // Parse the single multipart file as raw bytes. This avoids Vercel/Node
    // FormData coercion that was turning the uploaded File into a non-file value.
    const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    const boundary = boundaryMatch?.[1] || boundaryMatch?.[2];
    if (!boundary) return res.status(400).json({ error: "MULTIPART_BOUNDARY_REQUIRED" });

    const marker = Buffer.from("\r\n--" + boundary);
    const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd < 0) return res.status(400).json({ error: "MULTIPART_FILE_REQUIRED", message: "Please upload an audio file" });

    const headerText = body.subarray(0, headerEnd).toString("utf8");
    const disposition = headerText.match(/content-disposition:\s*form-data;\s*name="file";\s*filename="([^"]*)"/i);
    if (!disposition) return res.status(400).json({ error: "FILE_REQUIRED", message: "Please upload an audio file" });

    const fileStart = headerEnd + 4;
    const fileEnd = body.indexOf(marker, fileStart);
    if (fileEnd < 0) return res.status(400).json({ error: "MULTIPART_FILE_END_REQUIRED" });

    const bytes = body.subarray(fileStart, fileEnd);
    if (!bytes.length) return res.status(400).json({ error: "FILE_EMPTY", message: "Uploaded audio file is empty" });

    const filename = disposition[1] || "miya-split-source.wav";
    const lower = filename.toLowerCase();
    const typeMatch = headerText.match(/content-type:\s*([^\r\n]+)/i);
    const type = String(typeMatch?.[1] || "").trim().toLowerCase() || (
      lower.endsWith(".wav") ? "audio/wav" :
      lower.endsWith(".mp3") ? "audio/mpeg" :
      lower.endsWith(".m4a") ? "audio/mp4" :
      lower.endsWith(".flac") ? "audio/flac" :
      lower.endsWith(".ogg") ? "audio/ogg" :
      "application/octet-stream"
    );
    const upstreamFile = new File([bytes], filename, { type });
    const form = new FormData();
    form.append("file", upstreamFile, filename);

    const upstream = await fetch("https://cleverutils.com/api/v1/tools/vocal-remover", {
      method: "POST",
      headers: { accept: "application/json" },
      body: form
    });

    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader("content-type", upstream.headers.get("content-type") || "application/json");
    res.send(text);
  } catch (error) {
    console.error("CleverUtils vocal proxy failed:", error);
    res.status(502).json({
      error: "CLEVERUTILS_PROXY_FAILED",
      message: String(error?.message || error)
    });
  }
}
