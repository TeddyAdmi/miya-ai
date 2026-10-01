export default async function handler(req,res){
  if(req.method!=="POST" && !(req.method==="GET" && req.query?.debug==="home")){
    res.setHeader("Allow","POST,GET");
    return res.status(405).json({error:"Method not allowed"});
  }

  const safeBody=(text)=>{
    const s=String(text||"").slice(0,1200);
    return s
      .replace(/("?(?:token|access_token|authorization|sign|auth)"?\s*[:=]\s*")[^"]+(")/gi,"$1[REDACTED]$2")
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi,"Bearer [REDACTED]");
  };

  try{
    const body=typeof req.body==="string"?JSON.parse(req.body||"{}"):(req.body||{});

    if(body.debug==="home"){
      const generationId=crypto.randomUUID();
      const deviceID="miya_"+generationId.replace(/-/g,"").slice(0,16);
      const r=await fetch("https://t2v.aritek.app/api/v2/t2v/home?v=85",{
        method:"GET",
        headers:{
          "User-Agent":"okhttp/4.12.0",
          "versionCode":"85",
          "Ctry-Target":"others",
          "Device-Id":deviceID,
          "Sign":"68d6165b72a7f2d8d17b0dc6fe9691abdf77c583",
          "Cache-Control":"no-cache"
        }
      });
      const t=await r.text();
      return res.status(200).json({
        success:r.ok,
        upstreamStatus:r.status,
        upstreamBody:safeBody(t)
      });
    }

    const requestedPrompt=String(body.prompt||"").trim();

    if(!requestedPrompt){
      return res.status(400).json({success:false,error:"Prompt is required"});
    }

    const generationId=crypto.randomUUID();
    const prompt=requestedPrompt.slice(0,1900);
    const deviceID="miya_"+generationId.replace(/-/g,"").slice(0,16);

    let sessionResponse=null;
    let sessionError=null;

    try{
      sessionResponse=await fetch("https://t2v.aritek.app/api/v1/user/info",{
        method:"GET",
        headers:{
          "User-Agent":"okhttp/4.12.0",
          "versionCode":"85",
          "Ctry-Target":"others",
          "Device-Id":deviceID,
          "Sign":"68d6165b72a7f2d8d17b0dc6fe9691abdf77c583",
          "Cache-Control":"no-cache"
        }
      });
    }catch(error){
      sessionError=String(error?.message||error);
    }

    if(!sessionResponse){
      return res.status(502).json({
        success:false,
        error:"ARITEK_SESSION_REQUEST_FAILED",
        detail:sessionError
      });
    }

    const sessionText=await sessionResponse.text();
    let sessionData=null;
    try{ sessionData=JSON.parse(sessionText); }catch(error){}

    const token=sessionData?.data?.token;

    if(!sessionResponse.ok){
      return res.status(502).json({
        success:false,
        error:"ARITEK_SESSION_FAILED",
        upstreamStatus:sessionResponse.status,
        upstreamBody:safeBody(sessionText)
      });
    }

    if(!token){
      return res.status(502).json({
        success:false,
        error:"ARITEK_SESSION_TOKEN_MISSING",
        upstreamStatus:sessionResponse.status,
        upstreamBody:safeBody(sessionText)
      });
    }

    let videoResponse=null;
    let videoError=null;

    try{
      videoResponse=await fetch("https://t2v.aritek.app/api/v3/video/t2v",{
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          "Authorization":"Bearer "+token,
          "User-Agent":"okhttp/4.12.0",
          "versionCode":"85",
          "Ctry-Target":"others",
          "Device-Id":deviceID,
          "Sign":"68d6165b72a7f2d8d17b0dc6fe9691abdf77c583",
          "Cache-Control":"no-cache"
        },
        body:JSON.stringify({
          prompt,
          versionCode:85,
          deviceID,
          isPremium:1,
          ctry_target:"others",
          used:[],
          aspect_ratio:"16:9",
          ai_sound:body.sound!==false?1:0
        })
      });
    }catch(error){
      videoError=String(error?.message||error);
    }

    if(!videoResponse){
      return res.status(502).json({
        success:false,
        error:"ARITEK_VIDEO_REQUEST_FAILED",
        detail:videoError
      });
    }

    const videoText=await videoResponse.text();

    if(!videoResponse.ok){
      return res.status(502).json({
        success:false,
        error:"ARITEK_VIDEO_FAILED",
        upstreamStatus:videoResponse.status,
        upstreamBody:safeBody(videoText)
      });
    }

    let videoData=null;
    try{ videoData=JSON.parse(videoText); }catch(error){}

    if(!videoData){
      return res.status(502).json({
        success:false,
        error:"ARITEK_VIDEO_INVALID_JSON",
        upstreamStatus:videoResponse.status,
        upstreamBody:safeBody(videoText)
      });
    }

    if(videoData?.data?.url || videoData?.url){
      return res.status(200).json(videoData);
    }

    return res.status(502).json({
      success:false,
      error:"ARITEK_VIDEO_URL_MISSING",
      upstreamStatus:videoResponse.status,
      upstreamBody:safeBody(videoText)
    });
  }catch(error){
    return res.status(500).json({
      success:false,
      error:String(error?.message||error||"Aritek request failed")
    });
  }
}