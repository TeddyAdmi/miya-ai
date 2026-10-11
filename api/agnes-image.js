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
    const requestedQuality=["1K","2K","4K"].includes(String(body.quality))?String(body.quality):"2K";
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
          sourceResponse=await fetch(sourceUrl,{headers:{Accept:"image/*"},cache:"no-store",signal:AbortSignal.timeout(10000)});
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
        // Preserve the source's native geometry and fine texture for edits.
        // The previous 2048px / JPEG-86 conversion softened waves and other fine detail.
        let normalized=sharp(sourceBytes).rotate();
        const metadata=await normalized.metadata();
        if(!metadata.width||!metadata.height) {
          return res.status(415).json({ok:false,error:"SOURCE_IMAGE_DIMENSIONS_MISSING"});
        }
        // Only downscale oversized originals; never enlarge and never crop.
        if(metadata.width>4096||metadata.height>4096) {
          normalized=normalized.resize({width:4096,height:4096,fit:"inside",withoutEnlargement:true});
        }
        let outputBuffer=await normalized.jpeg({quality:94,mozjpeg:true}).toBuffer();
        if(outputBuffer.length>5*1024*1024) {
          outputBuffer=await sharp(outputBuffer).jpeg({quality:89,mozjpeg:true}).toBuffer();
        }
        if(outputBuffer.length>5*1024*1024) {
          outputBuffer=await sharp(outputBuffer).resize({width:3072,height:3072,fit:"inside",withoutEnlargement:true}).jpeg({quality:90,mozjpeg:true}).toBuffer();
        }
        if(outputBuffer.length>5*1024*1024) {
          outputBuffer=await sharp(outputBuffer).resize({width:2560,height:2560,fit:"inside",withoutEnlargement:true}).jpeg({quality:86,mozjpeg:true}).toBuffer();
        }
        source="data:image/jpeg;base64,"+outputBuffer.toString("base64");
      } catch(error) {
        return res.status(415).json({ok:false,error:"SOURCE_IMAGE_NORMALIZE_FAILED",message:String(error?.message||error)});
      }
      if(!source || Math.ceil(source.length*3/4)>5*1024*1024) {
        return res.status(413).json({ok:false,error:"SOURCE_IMAGE_TOO_LARGE",message:"Не удалось подготовить исходное изображение для Agnes."});
      }
    }
    const n=Math.max(1,Math.min(4,Number(body.n)||1));
    // Send the user's prompt to Agnes unchanged, without added instructions.
    const qualityPrompt=prompt;
    // Use the maximum native output size supported by Agnes Image 2.5 Flash (4K).
    // Use Agnes' documented native dimensions so the requested aspect ratio is not subtly distorted.
    const qualitySizes={
      "1K":{"16:9":"1312x736","9:16":"736x1312","1:1":"1024x1024","3:4":"864x1152","4:3":"1152x864","2:3":"832x1248","3:2":"1248x832","21:9":"1568x672"},
      "2K":{"16:9":"2624x1472","9:16":"1472x2624","1:1":"2048x2048","3:4":"1728x2304","4:3":"2304x1728","2:3":"1664x2496","3:2":"2496x1664","21:9":"3136x1344"},
      "4K":{"16:9":"4096x2304","9:16":"2304x4096","1:1":"4096x4096","3:4":"3072x4096","4:3":"4096x3072","2:3":"2730x4096","3:2":"4096x2730","21:9":"4096x1755"}
    };
    // Respect the quality selected in the UI for both generation and editing.
    const quality=requestedQuality;
    const outputSize=qualitySizes[quality]?.[ratio]||qualitySizes["1K"]["16:9"];
    const payload={model:"agnes-image-2.5-flash",prompt:qualityPrompt,n,size:outputSize,ratio,extra_body:{response_format:"url"}};
    const images=[];
    if(source) payload.extra_body.image=[source];

    const upstream=await fetch("https://apihub.agnes-ai.com/v1/images/generations",{
      method:"POST",
      headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json","Accept":"application/json"},
      body:JSON.stringify(payload),
      signal:AbortSignal.timeout(45000)
    });
    const raw=await upstream.text();
    let data={};try{data=raw?JSON.parse(raw):{}}catch{}
    if(!upstream.ok) {
      const upstreamMessage=String(data?.error?.message||data?.message||raw||("Agnes HTTP "+upstream.status));
      if(upstream.status===429) {
        return res.status(429).json({
          ok:false,
          error:"AGNES_IMAGE_RATE_LIMITED",
          message:"Agnes временно ограничил бесплатные запросы. Это лимит сервиса, а не ошибка Miya. Подожди перед следующей генерацией и попробуй ещё раз; повторные запросы подряд могут снова получить 429.",
          upstreamStatus:429,
          upstreamMessage:upstreamMessage.slice(0,500)
        });
      }
      if(upstream.status===400 && /exceeds maximum 4096x4096/i.test(upstreamMessage)) {
        return res.status(502).json({
          ok:false,
          error:"AGNES_IMAGE_SIZE_LIMIT",
          message:"Agnes отклонил размер изображения. Размеры 4K в Miya исправлены с учётом ограничения 4096×4096. Обнови страницу после деплоя и повтори запрос.",
          upstreamStatus:400,
          upstreamMessage:upstreamMessage.slice(0,300)
        });
      }
      return res.status(upstream.status>=400&&upstream.status<500?upstream.status:502).json({ok:false,error:"AGNES_IMAGE_FAILED",message:upstreamMessage,upstreamStatus:upstream.status});
    }
    const urls=Array.isArray(data?.data)?data.data.map(x=>x?.url).filter(x=>typeof x==="string"&&/^https?:\/\//i.test(x)):[];
    if(!urls.length) return res.status(502).json({ok:false,error:"AGNES_IMAGE_URL_MISSING",providerResponse:data});
    return res.status(200).json({ok:true,mode:"image",status:"completed",provider:"Agnes",model:"Agnes Image 2.5 Flash",imageUrl:urls[0],imageUrls:urls,count:urls.length,meta:{freeCandidate:true,size:outputSize,ratio,quality,edit:Boolean(source)}});
  }catch(e){
    return res.status(e?.name==="TimeoutError"?504:502).json({ok:false,error:"AGNES_IMAGE_HANDLER_ERROR",message:e?.message||"Agnes image request failed"});
  }
};

module.exports.config = { maxDuration: 60 };
