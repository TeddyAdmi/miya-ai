export default async function handler(req,res){
  if(req.method==="GET" && String(req.query?.cloudflareVision||"") === "1"){
    try{
      const account=String(process.env.CLOUDFLARE_ACCOUNT_ID||"").trim();
      const token=String(process.env.CLOUDFLARE_API_TOKEN||"").trim();
      if(!account||!token)return res.status(500).json({ok:false,error:"CLOUDFLARE_ENV_MISSING"});
      const imageUrl=String(req.query?.imageUrl||"").trim();
      let source;
      try{source=new URL(imageUrl);}catch{return res.status(400).json({ok:false,error:"INVALID_IMAGE_URL"});}
      const allowedHost=/^(?:thumb\.)?wikimedia\.org$/i.test(source.hostname)||/^commons\.wikimedia\.org$/i.test(source.hostname);
      if(source.protocol!=="https:"||!allowedHost)return res.status(400).json({ok:false,error:"IMAGE_HOST_NOT_ALLOWED"});
      const question=String(req.query?.question||"Что изображено на этой картинке? Опиши сюжет, стиль, композицию, свет, цвета и важные детали.").trim().slice(0,2000);
      const response=await fetch("https://api.cloudflare.com/client/v4/accounts/"+encodeURIComponent(account)+"/ai/run/@cf/moondream/moondream3.1-9B-A2B",{
        method:"POST",
        headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json","Accept":"application/json"},
        body:JSON.stringify({task:"caption",image:source.toString(),caption_length:"long",stream:false,max_tokens:1200}),
        signal:AbortSignal.timeout(55000)
      });
      const raw=await response.text();
      let data={}; try{data=raw?JSON.parse(raw):{}}catch{data={}};
      const answer=data?.result?.answer||data?.result?.caption||data?.result?.text||"";
      return res.status(response.status).json({ok:response.ok&&!!answer,provider:"Cloudflare Workers AI",model:"@cf/moondream/moondream3.1-9B-A2B",status:response.status,answer});
    }catch(error){return res.status(502).json({ok:false,error:"CLOUDFLARE_VISION_TEST_FAILED",message:String(error?.message||error||"Vision test failed")});}
  }

  if(req.method==="POST"){
    try{
      const account=String(process.env.CLOUDFLARE_ACCOUNT_ID||"").trim();
      const token=String(process.env.CLOUDFLARE_API_TOKEN||"").trim();
      if(!account||!token)return res.status(500).json({ok:false,error:"CLOUDFLARE_ENV_MISSING",message:"CLOUDFLARE_ACCOUNT_ID или CLOUDFLARE_API_TOKEN не настроен в Vercel."});
      const body=typeof req.body==="string"?JSON.parse(req.body||"{}"):(req.body||{});
      const prompt=String(body.prompt||"").trim().slice(0,2500);

      if(body.cloudflareVision===true){
        const image=String(body.image||"").trim();
        const question=String(body.question||"Что изображено на этой картинке? Опиши сюжет, стиль, композицию, свет, цвета и важные детали.").trim().slice(0,2000);
        if(!/^data:image\/(?:png|jpeg|jpg|webp);base64,/i.test(image)) return res.status(400).json({ok:false,error:"IMAGE_REQUIRED"});
        const response=await fetch("https://api.cloudflare.com/client/v4/accounts/"+encodeURIComponent(account)+"/ai/run/@cf/moondream/moondream3.1-9B-A2B",{
          method:"POST",
          headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json","Accept":"application/json"},
          body:JSON.stringify({task:"query",image,question,reasoning:false,max_tokens:1200}),
          signal:AbortSignal.timeout(55000)
        });
        const raw=await response.text();
        let data={}; try{data=raw?JSON.parse(raw):{}}catch{data={}};
        const answer=data?.result?.answer||data?.result?.caption||"";
        return res.status(response.status).json({ok:response.ok&&!!answer,provider:"Cloudflare Workers AI",model:"@cf/moondream/moondream3.1-9B-A2B",status:response.status,answer});
      }

      if(body.cloudflareVideo===true){
        if(!prompt)return res.status(400).json({ok:false,error:"PROMPT_REQUIRED"});
        const resolution=["480P","720P","1080P"].includes(String(body.resolution||""))?String(body.resolution):"480P";
        const ratio=["adaptive","16:9","9:16","1:1","4:3","3:4"].includes(String(body.ratio||""))?String(body.ratio):"16:9";
        const duration=Math.max(1,Math.min(15,Number(body.duration)||5));
        const response=await fetch("https://api.cloudflare.com/client/v4/accounts/"+encodeURIComponent(account)+"/ai/run",{
          method:"POST",
          headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json","Accept":"application/json"},
          body:JSON.stringify({model:"alibaba/wan-3.0",input:{prompt,resolution,ratio,duration}}),
          signal:AbortSignal.timeout(55000)
        });
        const raw=await response.text();
        let data={}; try{data=raw?JSON.parse(raw):{}}catch{data={raw:raw.slice(0,4000)}}
        const videoUrl=data?.result?.video||data?.result?.video_url||null;
        return res.status(response.status).json({ok:response.ok&&!!videoUrl,provider:"Cloudflare Workers AI",model:"alibaba/wan-3.0",status:response.status,videoUrl,response:data});
      }

      const promptForText=prompt||"Проверка Cloudflare Workers AI из Miya Studio. Ответь одним словом: работает.";
      const response=await fetch("https://api.cloudflare.com/client/v4/accounts/"+encodeURIComponent(account)+"/ai/run/@cf/meta/llama-3.1-8b-instruct",{
        method:"POST",
        headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json","Accept":"application/json"},
        body:JSON.stringify({prompt:promptForText}),
        signal:AbortSignal.timeout(55000)
      });
      const raw=await response.text();
      let data={}; try{data=raw?JSON.parse(raw):{}}catch{data={raw:raw.slice(0,4000)}}
      return res.status(response.status).json({ok:response.ok,provider:"Cloudflare Workers AI",model:"@cf/meta/llama-3.1-8b-instruct",status:response.status,response:data});
    }catch(error){return res.status(502).json({ok:false,error:"CLOUDFLARE_REQUEST_FAILED",message:String(error?.message||error||"Cloudflare request failed")});}
  }



  if(req.method!=="GET"&&req.method!=="HEAD"){
    res.setHeader("Allow","GET");
    return res.status(405).json({error:"Method not allowed"});
  }
  try{
    const raw=String(req.query?.url||"");
    let target;
    try{ target=new URL(raw); }catch{
      return res.status(400).json({error:"Invalid OmegaTech video URL"});
    }

    const isAritek=/^(?:sora|cdn|video|media)\.aritek\.app$/i.test(target.hostname);
    const isCloudflare=target.hostname.toLowerCase()==="examples.aig.cloudflare.com";
    const allowedHost=isAritek||isCloudflare;
    const allowedPath=target.hostname.toLowerCase()==="sora.aritek.app"
      ? target.pathname.startsWith("/generated/")
      : true;

    if(target.protocol!=="https:"||!allowedHost||!allowedPath){
      return res.status(400).json({error:"Invalid OmegaTech video URL"});
    }

    const probe=String(req.query?.probe||"") === "1";
    if(probe){
      let upstream;
      try{ upstream=await fetch(target.toString(),{method:"HEAD",cache:"no-store"}); }
      catch{
        upstream=await fetch(target.toString(),{headers:{"Range":"bytes=0-0"},cache:"no-store"});
      }
      if(!upstream.ok && upstream.status!==206){
        return res.status(upstream.status).json({error:"Upstream video is not ready",upstreamStatus:upstream.status});
      }
      res.setHeader("Cache-Control","no-store");
      return res.status(200).json({ok:true,ready:true,status:upstream.status});
    }

    const range=req.headers?.range;
    const upstreamHeaders={};
    if(range)upstreamHeaders.Range=String(range);
    const upstream=await fetch(target.toString(),{headers:upstreamHeaders,cache:"no-store"});
    if(!upstream.ok && upstream.status!==206){
      return res.status(upstream.status).json({error:"Upstream video request failed"});
    }

    const type=upstream.headers.get("content-type")||"video/mp4";
    const contentLength=upstream.headers.get("content-length");
    const contentRange=upstream.headers.get("content-range");
    const acceptRanges=upstream.headers.get("accept-ranges")||"bytes";
    res.setHeader("Content-Type",type);
    res.setHeader("Accept-Ranges",acceptRanges);
    if(contentLength)res.setHeader("Content-Length",contentLength);
    if(contentRange)res.setHeader("Content-Range",contentRange);
    res.setHeader("Cache-Control","public, max-age=14400");
    if(req.method==="HEAD")return res.status(upstream.status).end();
    const buffer=Buffer.from(await upstream.arrayBuffer());
    if(!contentLength)res.setHeader("Content-Length",String(buffer.length));
    return res.status(upstream.status).send(buffer);
  }catch(error){
    return res.status(500).json({error:String(error?.message||error||"OmegaTech video proxy failed")});
  }
}
