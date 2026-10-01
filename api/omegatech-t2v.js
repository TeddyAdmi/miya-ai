export default async function handler(req,res){
  if(req.method!=="POST"){ res.setHeader("Allow","POST"); return res.status(405).json({success:false,error:"Method not allowed"}); }
  try{
    const body=typeof req.body==="string"?JSON.parse(req.body||"{}"):(req.body||{});
    const incoming=String(body.prompt||"").trim();
    const marker="USER VIDEO DESCRIPTION:";
    const markerIndex=incoming.lastIndexOf(marker);
    const userPrompt=(markerIndex>=0?incoming.slice(markerIndex+marker.length):incoming).trim().slice(0,1800);
    if(!userPrompt) return res.status(400).json({success:false,error:"Prompt is empty"});
    const ratio=["16:9","9:16","1:1"].includes(body.ratio)?body.ratio:"16:9";
    const upstreamRatio={"16:9":"landscape","9:16":"portrait","1:1":"square"}[ratio];
    const generationId=crypto.randomUUID();
    const finalPrompt=[userPrompt,"Create a completely new video for this request.","The user description is the only source of truth.","Do not reuse any previous or default scene.","Preserve the exact subject, number of subjects, location, objects and actions named by the user.","Do not invent people, animals, vehicles, props or story events.","Perform all requested actions clearly and in the requested order.","Photorealistic natural motion, stable identity and coherent physical movement.","No text, subtitles, logos or unrelated events.","Unique generation "+generationId].join(" ").slice(0,1900);
    const host="https://"+"api.omegatech.app";
    const upstream=await fetch(host+"/api/ai/grok-3-video",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt:finalPrompt,ratio:upstreamRatio})});
    const raw=await upstream.text();
    if(!upstream.ok) return res.status(502).json({success:false,error:"OmegaTech Grok-3 video upstream error",upstreamStatus:upstream.status,details:raw.slice(0,3000)});
    let data; try{data=JSON.parse(raw);}catch{return res.status(502).json({success:false,error:"OmegaTech Grok-3 video returned invalid JSON",details:raw.slice(0,3000)});}
    const findVideoUrl=(v)=>{
      if(typeof v==="string") return /^https?:\\/\\/.*\\.(mp4|webm)(\\?.*)?$/i.test(v.trim())?v.trim():"";
      if(Array.isArray(v)){for(const x of v){const f=findVideoUrl(x);if(f)return f;}return "";}
      if(v&&typeof v==="object"){for(const k of ["videoUrl","video_url","url","downloadUrl","download_url","mp4"]){const f=findVideoUrl(v[k]);if(f)return f;}for(const k of Object.keys(v)){const f=findVideoUrl(v[k]);if(f)return f;}}
      return "";
    };
    let videoUrl=findVideoUrl(data);
    if(videoUrl) return res.status(200).json({success:true,data:{videoUrl},source:"OmegaTech Grok-3 Video"});
    const findJobId=(v)=>{
      if(!v||typeof v!=="object")return "";
      for(const k of ["jobId","job_id","taskId","task_id","id"]){if(typeof v[k]==="string"&&v[k].trim())return v[k].trim();}
      for(const k of Object.keys(v)){const f=findJobId(v[k]);if(f)return f;} return "";
    };
    const jobId=findJobId(data);
    if(!jobId) return res.status(502).json({success:false,error:"OmegaTech Grok-3 video returned no video URL or job ID",details:JSON.stringify(data).slice(0,3000)});
    const deadline=Date.now()+240000; let lastStatus="";
    while(Date.now()<deadline){
      await new Promise(r=>setTimeout(r,5000));
      const sr=await fetch(host+"/api/ai/grok-3-video-status",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jobId})});
      const srRaw=await sr.text(); lastStatus=srRaw; if(!sr.ok)continue;
      let sd; try{sd=JSON.parse(srRaw);}catch{continue;}
      videoUrl=findVideoUrl(sd);
      if(videoUrl)return res.status(200).json({success:true,data:{videoUrl},source:"OmegaTech Grok-3 Video"});
      const st=JSON.stringify(sd).toLowerCase();
      if(st.includes("failed")||st.includes("error"))return res.status(502).json({success:false,error:"OmegaTech Grok-3 video generation failed",details:srRaw.slice(0,3000)});
    }
    return res.status(504).json({success:false,error:"OmegaTech Grok-3 video generation timed out",jobId,details:lastStatus.slice(0,3000)});
  }catch(error){return res.status(500).json({success:false,error:"OmegaTech Grok-3 video function failed",details:String(error?.message||error||"Unknown error")});}
}