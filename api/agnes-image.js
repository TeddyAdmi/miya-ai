const sharp = require("sharp");

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
    let sourceInput=String(body.imageBase64||body.imageUrl||"").trim();
    let source="";
    if(sourceInput) {
      let sourceBytes=null;
      if(sourceInput.startsWith("/api/image-jpeg?") || /^https?:\/\//i.test(sourceInput)) {
        let sourceUrl="";
        try {
          const parsed=new URL(sourceInput,"https://miya-studio.vercel.app");
          const ownHost=parsed.hostname.toLowerCase()==="miya-studio.vercel.app" ||
            parsed.hostname.toLowerCase()==="www.miya-studio.vercel.app";
          if(ownHost && parsed.pathname==="/api/image-jpeg") {
            const original=parsed.searchParams.get("url")||"";
            if(/^https:\/\//i.test(original))sourceUrl=original;
          } else if(parsed.protocol==="https:") {
            sourceUrl=parsed.toString();
          }
        } catch {}
        if(!sourceUrl) return res.status(400).json({ok:false,error:"INVALID_SOURCE_IMAGE_URL"});
        let parsedUrl;
        try{parsedUrl=new URL(sourceUrl)}catch{return res.status(400).json({ok:false,error:"INVALID_SOURCE_IMAGE_URL"})}
        const host=parsedUrl.hostname.toLowerCase();
        const allowedHost=
          host==="overchat.s3.eu-north-1.amazonaws.com" ||
          host==="access.vheer.com" || host.endsWith(".access.vheer.com") ||
          host==="platform-outputs.agnes-ai.space" ||
          host==="ahm7xmakki.com" || host.endsWith(".ahm7xmakki.com") ||
          host==="sora.aritek.app" || host.endsWith(".aritek.app") ||
          host==="cvron.alwaysdata.net" ||
          host==="modelscope.cn" || host.endsWith(".modelscope.cn") ||
          host.endsWith(".aliyuncs.com");
        if(parsedUrl.protocol!=="https:" || !allowedHost) {
          return res.status(400).json({ok:false,error:"SOURCE_IMAGE_HOST_NOT_ALLOWED"});
        }
        let sourceResponse;
        try {
          sourceResponse=await fetch(sourceUrl,{headers:{Accept:"image/*"},cache:"no-store",signal:AbortSignal.timeout(20000)});
        } catch(error) {
          return res.status(502).json({ok:false,error:"SOURCE_IMAGE_FETCH_FAILED",message:String(error?.message||error)});
        }
        if(!sourceResponse.ok) return res.status(400).json({ok:false,error:"SOURCE_IMAGE_FETCH_FAILED",upstreamStatus:sourceResponse.status});
        const sourceType=(sourceResponse.headers.get("content-type")||"image/jpeg").split(";")[0].toLowerCase();
        if(!/^image\/(jpeg|png|webp|avif)$/i.test(sourceType)) {
          return res.status(415).json({ok:false,error:"SOURCE_IMAGE_NOT_SUPPORTED",contentType:sourceType});
        }
        sourceBytes=Buffer.from(await sourceResponse.arrayBuffer());
      } else {
        const dataMatch=sourceInput.match(/^data:image\/([a-z0-9.+-]+);base64,([\s\S]+)$/i);
        const rawBase64=dataMatch?dataMatch[2].replace(/\s+/g,""):sourceInput.replace(/^base64,/i,"").replace(/\s+/g,"");
        if(rawBase64.length<100) return res.status(400).json({ok:false,error:"INVALID_IMAGE_BASE64"});
        if(Math.ceil(rawBase64.length*3/4)>30*1024*1024) return res.status(413).json({ok:false,error:"SOURCE_IMAGE_TOO_LARGE"});
        sourceBytes=Buffer.from(rawBase64,"base64");
      }
      if(!sourceBytes?.length) return res.status(400).json({ok:false,error:"SOURCE_IMAGE_EMPTY"});
      if(sourceBytes.length>30*1024*1024) return res.status(413).json({ok:false,error:"SOURCE_IMAGE_TOO_LARGE"});
      try {
        source=await sharp(sourceBytes)
          .rotate()
          .resize({width:2048,height:2048,fit:"inside",withoutEnlargement:true})
          .jpeg({quality:86,mozjpeg:true})
          .toBuffer()
          .then(buffer=>buffer.toString("base64"));
      } catch(error) {
        return res.status(415).json({ok:false,error:"SOURCE_IMAGE_NORMALIZE_FAILED",message:String(error?.message||error)});
      }
      if(!source || Math.ceil(source.length*3/4)>5*1024*1024) {
        return res.status(413).json({ok:false,error:"SOURCE_IMAGE_TOO_LARGE",message:"Не удалось подготовить исходное изображение для Agnes."});
      }
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