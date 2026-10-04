const addCloudflareTestOption = () => {
  const select = document.querySelector("#videoModel");
  if (!select || select.querySelector('option[data-cloudflare-test="1"]')) return;
  const option = document.createElement("option");
  option.value = "Cloudflare Wan 3.0";
  option.textContent = "☁ Cloudflare Wan 3.0";
  option.dataset.cloudflareTest = "1";
  select.appendChild(option);
};

const runCloudflareTest = async () => {
  const input = document.querySelector("#composerInput");
  const status = document.querySelector("#composerStatus");
  const send = document.querySelector("#composerSend");
  const canvas = document.querySelector("#canvas");
  const prompt = String(input?.value || "").trim() ||
    "A cinematic shot of a futuristic city at sunset, realistic motion, detailed lighting.";

  if (send) send.disabled = true;
  if (status) status.textContent = "Cloudflare Workers AI · проверка…";

  try {
    const response = await fetch("/api/omegatech-video", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ prompt, cloudflareVideo:true, resolution:"480P", ratio:"16:9", duration:5 })
    });

    const data = await response.json().catch(() => ({}));
    const ok = response.ok && data?.ok && !!data?.videoUrl;

    if (canvas) {
      canvas.innerHTML = "";
      if (ok && data.videoUrl) {
        const video = document.createElement("video");
        video.controls = true; video.autoplay = true; video.playsInline = true;
        video.style.cssText = "display:block;width:min(900px,100%);margin:30px auto;border-radius:20px;";
        video.src = "/api/omegatech-video?url=" + encodeURIComponent(data.videoUrl);
        canvas.appendChild(video);
      }
      const card = document.createElement("div");
      card.style.cssText = "max-width:760px;margin:40px auto;padding:24px;border-radius:20px;background:rgba(20,20,35,.72);border:1px solid rgba(160,120,255,.25);color:inherit;white-space:pre-wrap;font-family:inherit;";
      const title = document.createElement("h3");
      title.textContent = ok ? "☁ Cloudflare Wan 3.0 работает" : "☁ Cloudflare Wan 3.0: ошибка";
      const pre = document.createElement("pre");
      pre.style.cssText = "margin-top:16px;white-space:pre-wrap;overflow:auto;font:13px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;";
      pre.textContent = JSON.stringify(data, null, 2);
      card.append(title, pre);
      canvas.appendChild(card);
    }

    if (status) status.textContent = ok
      ? "Cloudflare Wan 3.0 · видео готово"
      : "Cloudflare Wan 3.0 · ошибка " + response.status;
  } catch (error) {
    if (status) status.textContent = "Cloudflare Wan 3.0 · NetworkError";
    if (canvas) canvas.textContent = "Cloudflare test error: " + String(error?.message || error);
  } finally {
    if (send) send.disabled = false;
  }
};

const initCloudflareStudioTest = () => {
  addCloudflareTestOption();

  const send = document.querySelector("#composerSend");
  if (send) {
    send.addEventListener("click", (event) => {
      const select = document.querySelector("#videoModel");
      if (select?.value !== "Cloudflare Wan 3.0") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      runCloudflareTest();
    }, true);
  }

  const select = document.querySelector("#videoModel");
  select?.addEventListener("change", () => {
    if (select.value === "Cloudflare Wan 3.0") {
      const status = document.querySelector("#composerStatus");
      if (status) status.textContent = "Cloudflare Wan 3.0 · готов к тесту";
    }
  });
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initCloudflareStudioTest, { once: true });
} else {
  initCloudflareStudioTest();
}
