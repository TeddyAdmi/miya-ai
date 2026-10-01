export default async function handler(req,res){
  if(req.method!=="POST"){
    res.setHeader("Allow","POST");
    return res.status(405).json({error:"Method not allowed"});
  }

  const safeBody=(text)=>{
    const s=String(text||"").slice(0,1200);
    return s
      .replace(/("?(?:token|access_token|authorization|sign|auth)"?\s*[:=]\s*")[^"]+(")/gi,"$1[REDACTED]$2")
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi,"Bearer [REDACTED]");
  };

  const parseJson=(text)=>{
    try{return JSON.parse(text);}catch(error){return null;}
  };

  const extractUrl=(data)=>{
    return data?.data?.url ||
      data?.url ||
      data?.data?.video_url ||
      data?.video_url ||
      data?.data?.videoUrl ||
      data?.videoUrl ||
      null;
  };

  const extractJobId=(data)=>{
    return data?.data?.jobId ||
      data?.data?.job_id ||
      data?.jobId ||
      data?.job_id ||
      data?.data?.id ||
      data?.id ||
      null;
  };

  try{
    const body=typeof req.body==="string"?JSON.parse(req.body||"{}"):(req.body||{});
    const requestedPrompt=String(body.prompt||"").trim();

    if(!requestedPrompt){
      return res.status(400).json({success:false,error:"Prompt is required"});
    }

    const generationId=crypto.randomUUID();
    const prompt=requestedPrompt.slice(0,1900);
    const deviceID="miya_"+generationId.replace(/-/g,"").slice(0,16);
    const sign="68d6165b72a7f2d8d17b0dc6fe9691abdf77c583";

    const commonHeaders={
      "User-Agent":"okhttp/5.1.0",
      "versionCode":"23",
      "Ctry-Target":"others",
      "Device-Id":deviceID,
      "Sign":sign,
      "Cache-Control":"no-cache"
    };

    // OLD ARITEK T2P PIPELINE: historically associated with t2pStS.../ft300
    // and supports aspect_ratio directly in the v1 generation request.
    try{
      let sessionResponse=await fetch("https://t2p.aritek.app/api/v1/user/info",{
        method:"GET",
        headers:commonHeaders
      });

      const sessionText=await sessionResponse.text();
      const sessionData=parseJson(sessionText);
      const token=sessionData?.data?.token;

      if(sessionResponse.ok && token){
        const videoResponse=await fetch("https://t2p.aritek.app/api/v1/video/t2v",{
          method:"POST",
          headers:{
            ...commonHeaders,
            "Content-Type":"application/json",
            "Authorization":"Bearer "+token
          },
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

        const videoText=await videoResponse.text();
        const videoData=parseJson(videoText);

        if(videoResponse.ok && videoData){
          const directUrl=extractUrl(videoData);
          if(directUrl){
            return res.status(200).json({
              ...videoData,
              source:"Aritek T2P",
              aspect_ratio_requested:"16:9"
            });
          }

          const jobId=extractJobId(videoData);

          if(jobId){
            for(let i=0;i<30;i++){
              await new Promise(resolve=>setTimeout(resolve,2000));

              const statusResponse=await fetch("https://t2p.aritek.app/api/v1/generate/status",{
                method:"POST",
                headers:{
                  ...commonHeaders,
                  "Content-Type":"application/json",
                  "Authorization":"Bearer "+token
                },
                body:JSON.stringify({ids:[jobId]})
              });

              const statusText=await statusResponse.text();
              const statusData=parseJson(statusText);
              const statusUrl=extractUrl(statusData);

              if(statusResponse.ok && statusUrl){
                return res.status(200).json({
                  success:true,
                  data:{url:statusUrl},
                  source:"Aritek T2P",
                  aspect_ratio_requested:"16:9",
                  jobId
                });
              }
            }
          }
        }
      }
    }catch(error){
      // Fall through to the current v3 pipeline.
    }

    // CURRENT ARITEK T2V FALLBACK
    const currentHeaders={
      "User-Agent":"okhttp/4.12.0",
      "versionCode":"85",
      "Ctry-Target":"others",
      "Device-Id":deviceID,
      "Sign":sign,
      "Cache-Control":"no-cache"
    };

    const sessionResponse=await fetch("https://t2v.aritek.app/api/v1/user/info",{
      method:"GET",
      headers:currentHeaders
    });

    const sessionText=await sessionResponse.text();
    const sessionData=parseJson(sessionText);
    const token=sessionData?.data?.token;

    if(!sessionResponse.ok || !token){
      return res.status(502).json({
        success:false,
        error:"ARITEK_SESSION_FAILED",
        upstreamStatus:sessionResponse.status,
        upstreamBody:safeBody(sessionText)
      });
    }

    const videoResponse=await fetch("https://t2v.aritek.app/api/v3/video/t2v",{
      method:"POST",
      headers:{
        ...currentHeaders,
        "Content-Type":"application/json",
        "Authorization":"Bearer "+token
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

    const videoText=await videoResponse.text();
    const videoData=parseJson(videoText);

    if(!videoResponse.ok || !videoData){
      return res.status(502).json({
        success:false,
        error:"ARITEK_VIDEO_FAILED",
        upstreamStatus:videoResponse.status,
        upstreamBody:safeBody(videoText)
      });
    }

    const directUrl=extractUrl(videoData);

    if(directUrl){
      return res.status(200).json({
        ...videoData,
        source:"Aritek T2V",
        aspect_ratio_requested:"16:9"
      });
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