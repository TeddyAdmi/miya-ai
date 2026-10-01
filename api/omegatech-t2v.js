export default async function handler(req,res){
  if(req.method!=="POST"){
    res.setHeader("Allow","POST");
    return res.status(405).json({error:"Method not allowed"});
  }

  const safeBody=(text)=>{
    const s=String(text||"").slice(0,4000);
    return s
      .replace(/("?(?:token|access_token|authorization|sign|auth)"?\s*[:=]\s*")[^"]+(")/gi,"$1[REDACTED]$2")
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi,"Bearer [REDACTED]");
  };
  const parseJson=(text)=>{try{return JSON.parse(text);}catch(error){return null;}};
  const extractUrl=(data)=>data?.data?.url||data?.url||data?.data?.video_url||data?.video_url||data?.data?.videoUrl||data?.videoUrl||null;
  const extractJobId=(data)=>data?.data?.jobId||data?.data?.job_id||data?.jobId||data?.job_id||data?.data?.id||data?.id||null;

  try{
    const body=typeof req.body==="string"?JSON.parse(req.body||"{}"):(req.body||{});
    const requestedPrompt=String(body.prompt||"").trim();
    if(!requestedPrompt)return res.status(400).json({success:false,error:"Prompt is required"});

    const generationId=crypto.randomUUID();
    const prompt=requestedPrompt.slice(0,1900);
    const deviceID="miya_"+generationId.replace(/-/g,"").slice(0,16);
    const sign="68d6165b72a7f2d8d17b0dc6fe9691abdf77c583";
    const headers={"User-Agent":"okhttp/5.1.0","versionCode":"23","Ctry-Target":"others","Device-Id":deviceID,"Sign":sign,"Cache-Control":"no-cache"};
    const diagnostics={endpoint:"https://t2p.aritek.app",session:null,generation:null,statusPoll:null};

    let sessionResponse;
    try{
      sessionResponse=await fetch("https://t2p.aritek.app/api/v1/user/info",{method:"GET",headers});
    }catch(error){
      return res.status(502).json({success:false,error:"T2P_SESSION_NETWORK_ERROR",message:String(error?.message||error),diagnostics});
    }

    const sessionText=await sessionResponse.text();
    const sessionData=parseJson(sessionText);
    const token=sessionData?.data?.token;
    diagnostics.session={
      httpStatus:sessionResponse.status,
      ok:sessionResponse.ok,
      body:safeBody(sessionText),
      json:Boolean(sessionData),
      tokenPresent:Boolean(token)
    };

    if(!sessionResponse.ok||!token){
      return res.status(502).json({success:false,error:"T2P_SESSION_FAILED",diagnostics});
    }

    let videoResponse;
    try{
      videoResponse=await fetch("https://t2p.aritek.app/api/v1/video/t2v",{
        method:"POST",
        headers:{...headers,"Content-Type":"application/json","Authorization":"Bearer "+token},
        body:JSON.stringify({
          prompt,
          versionCode:23,
          deviceID,
          isPremium:0,
          ctry_target:"others",
          used:[],
          aspect_ratio:"16:9",
          ai_sound:body.sound!==false?1:0
        })
      });
    }catch(error){
      return res.status(502).json({success:false,error:"T2P_GENERATION_NETWORK_ERROR",message:String(error?.message||error),diagnostics});
    }

    const videoText=await videoResponse.text();
    const videoData=parseJson(videoText);
    const directUrl=extractUrl(videoData);
    const jobId=extractJobId(videoData);

    diagnostics.generation={
      httpStatus:videoResponse.status,
      ok:videoResponse.ok,
      body:safeBody(videoText),
      json:Boolean(videoData),
      directUrlPresent:Boolean(directUrl),
      jobId:jobId||null,
      responseKeys:videoData&&typeof videoData==="object"?Object.keys(videoData):[]
    };

    if(!videoResponse.ok||!videoData){
      return res.status(502).json({success:false,error:"T2P_GENERATION_FAILED",diagnostics});
    }

    if(directUrl){
      diagnostics.generation.url=directUrl;
      return res.status(200).json({success:true,mode:"t2p-diagnostic",diagnostics});
    }

    if(!jobId){
      return res.status(502).json({success:false,error:"T2P_JOB_ID_MISSING",diagnostics});
    }

    for(let i=0;i<30;i++){
      await new Promise(resolve=>setTimeout(resolve,2000));

      let statusResponse;
      try{
        statusResponse=await fetch("https://t2p.aritek.app/api/v1/generate/status",{
          method:"POST",
          headers:{...headers,"Content-Type":"application/json","Authorization":"Bearer "+token},
          body:JSON.stringify({ids:[jobId]})
        });
      }catch(error){
        diagnostics.statusPoll={attempt:i+1,networkError:String(error?.message||error)};
        continue;
      }

      const statusText=await statusResponse.text();
      const statusData=parseJson(statusText);
      const statusUrl=extractUrl(statusData);

      diagnostics.statusPoll={
        attempt:i+1,
        httpStatus:statusResponse.status,
        ok:statusResponse.ok,
        body:safeBody(statusText),
        json:Boolean(statusData),
        urlPresent:Boolean(statusUrl)
      };

      if(statusResponse.ok&&statusUrl){
        diagnostics.statusPoll.url=statusUrl;
        return res.status(200).json({success:true,mode:"t2p-diagnostic",diagnostics});
      }
    }

    return res.status(504).json({success:false,error:"T2P_STATUS_TIMEOUT",diagnostics});
  }catch(error){
    return res.status(500).json({success:false,error:String(error?.message||error||"T2P request failed")});
  }
}