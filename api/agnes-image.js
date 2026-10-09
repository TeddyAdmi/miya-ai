module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control","no-store");
  res.setHeader("Content-Type","application/json; charset=utf-8");
  if(req.method!=="POST") return res.status(405).json({ok:false,error:"METHOD_NOT_ALLOWED"});
  const key=process.env.AGNES_API_KEY;
  if(!key) return res.status(500).json({ok:false,error:"AGNES_API_KEY_MISSING",message:"Добавьте AGNES_API_KEY в Vercel Environment Variables."});
  try{
    const body=typeof req.body==="string"?JSON.parse(req.body):(req.body||{});
    const prompt=typeof body.prompt==="string"?body.prompt.trim():"";
    if(!prompt) return res.status(400).json({ok:false,error:"PROMPT_REQUIRED"});
    const ratio=["1:1","3:4","4:3","16:9","9:16","2:3","3:2","21:9"].includes(String(body.ratio))?String(body.ratio):"16:9";
    const quality=["1K","2K","4K"].includes(String(body.quality))?String(body.quality):"2K";
    let source=String(body.imageBase64||body.imageUrl||"").trim();
    // The UI can pass a saved image's Miya proxy URL in imageBase64.
    // Unwrap our public image proxy so Agnes receives the actual provider URL.
    if (source.startsWith("/api/image-jpeg?") || /^https?:\/\//i.test(source)) {
      try {
        const parsedSource=new URL(source,"https://miya-studio.vercel.app");
        const ownHost=parsedSource.hostname.toLowerCase()==="miya-studio.vercel.app" ||
          parsedSource.hostname.toLowerCase()==="www.miya-studio.vercel.app";
        if (ownHost && parsedSource.pathname==="/api/image-jpeg") {
          const unwrapped=parsedSource.searchParams.get("url")||"";
          if (/^https?:\/\//i.test(unwrapped)) source=unwrapped;
        }
      } catch {}
    }
    // Agnes expects raw base64 for inline image input, not a data-URI prefix.
    if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(source)) {
      source=source.slice(source.indexOf(",")+1).replace(/\\s+/g,"");
    }
    const n=Math.max(1,Math.min(4,Number(body.n)||1));
    const generationPrompt=[
      "Create a bright, vivid, premium-quality photorealistic image with rich, lively colors.",
      "Use luminous natural lighting, clean whites, crisp highlights, balanced contrast, deep but detailed shadows, and accurate skin/material colors.",
      "Avoid a dull, gray, muddy, desaturated, hazy, foggy, washed-out or low-contrast look.",
      "Prioritize tack-sharp focus, high micro-contrast, fine texture detail and clean edges at pixel level.",
      "For close-ups, preserve extremely fine facial, hair, fur, fabric and surface detail; do not blur, smear, soften or watercolor the subject.",
      "Keep the requested composition, subject identity and scene faithful to the user prompt. Do not add decorative elements that were not requested.",
      "Whenever the prompt includes a person, people, a woman, a man, a girl, a boy, or any human subject without a specifically requested ethnicity, depict them with natural Slavic / Eastern European appearance. Use realistic Slavic facial features, proportions, hair and skin characteristics. Do not default to East Asian, Southeast Asian, or other regional facial features unless the user explicitly requests them.",
      "Use the same practical output quality as FLUX Dev, prioritizing fast-loading preview size without sacrificing useful detail.",
      "USER PROMPT:\\n"+prompt
    ].join("\\n");
    const editPrompt=[
      "Edit the supplied source photograph rather than creating a new scene.",
      "Keep the original framing, camera viewpoint, composition, background, lighting, colors, textures and all unrelated subjects unchanged.",
      "Apply only the change explicitly requested by the user.",
      "When removing an object, reconstruct only the area behind it from the surrounding background. Do not introduce a new person, animal, object or decoration into that area.",
      "The output should look like the same photograph after a precise local edit.",
      "USER EDIT INSTRUCTION:\\n"+prompt
    ].join("\\n");
    const qualityPrompt=source ? editPrompt : generationPrompt;
    // Use the maximum native output size supported by Agnes Image 2.5 Flash (4K).
    const qualitySizes={
      "1K":{"16:9":"1376x768","9:16":"768x1376","1:1":"1024x1024","3:4":"896x1200","4:3":"1200x896","2:3":"848x1264","3:2":"1264x848","21:9":"1584x672"},
      "2K":{"16:9":"2752x1536","9:16":"1536x2752","1:1":"2048x2048","3:4":"1792x2400","4:3":"2400x1792","2:3":"1696x2528","3:2":"2528x1696","21:9":"3168x1344"},
      "4K":{"16:9":"2048x1152","9:16":"1152x2048","1:1":"2048x2048","3:4":"1536x2048","4:3":"2048x1536","2:3":"1365x2048","3:2":"2048x1365","21:9":"2048x878"}
    };
    const outputSize=qualitySizes[quality]?.[ratio]||qualitySizes["1K"]["16:9"];
    const payload={model:"agnes-image-2.5-flash",prompt:qualityPrompt,n,size:outputSize,ratio,extra_body:{response_format:"url"}};
    const images=[];
    if(source) payload.extra_body.image=[source];

    const upstream=await fetch("https://apihub.agnes-ai.com/v1/images/generations",{
      method:"POST",
      headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json","Accept":"application/json"},
      body:JSON.stringify(payload),
      signal:AbortSignal.timeout(55000)
    });
    const raw=await upstream.text();
    let data={};try{data=raw?JSON.parse(raw):{}}catch{}
    if(!upstream.ok) return res.status(upstream.status>=400&&upstream.status<500?upstream.status:502).json({ok:false,error:"AGNES_IMAGE_FAILED",message:data?.error?.message||data?.message||raw||("Agnes HTTP "+upstream.status),upstreamStatus:upstream.status});
    const urls=Array.isArray(data?.data)?data.data.map(x=>x?.url).filter(x=>typeof x==="string"&&/^https?:\/\//i.test(x)):[];
    if(!urls.length) return res.status(502).json({ok:false,error:"AGNES_IMAGE_URL_MISSING",providerResponse:data});
    return res.status(200).json({ok:true,mode:"image",status:"completed",provider:"Agnes",model:"Agnes Image 2.5 Flash",imageUrl:urls[0],imageUrls:urls,count:urls.length,meta:{freeCandidate:true,size:outputSize,ratio,quality,edit:Boolean(source)}});
  }catch(e){
    return res.status(e?.name==="TimeoutError"?504:502).json({ok:false,error:"AGNES_IMAGE_HANDLER_ERROR",message:e?.message||"Agnes image request failed"});
  }
};