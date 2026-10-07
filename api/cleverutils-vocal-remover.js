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

    // Forward the browser multipart body byte-for-byte. CleverUtils expects
    // a normal multipart/form-data request with a file part; rebuilding the part
    // inside Node was causing its validator to miss the audio payload.
    const upstream = await fetch("https://cleverutils.com/api/v1/tools/vocal-remover", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": contentType
      },
      body
    });

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
