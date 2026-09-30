export default async function handler(req,res){
  if(req.method!=="POST"){
    res.setHeader("Allow","POST");
    return res.status(405).json({error:"Method not allowed"});
  }
  try{
    const body=typeof req.body==="string"?JSON.parse(req.body||"{}"):(req.body||{});
    const duration=Math.max(1,Math.min(10,Number(body.duration)||5));
    const ratio=["16:9","9:16","1:1"].includes(body.ratio)?body.ratio:"16:9";
    const prompt=String(body.prompt||"");
    let response;
    if(duration>5){
      response=await fetch("https://api.omegatech.app/api/ai/wan",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          action:"generate",
          prompt:prompt+"\\nFORMAT: widescreen "+ratio+".",
          negativePrompt:"unrequested people, characters, animals, vehicles, props, objects, actions or story events",
          duration:10,
          seed:-1,
          steps:4,
          cfg:5,
          motion:4
        })
      });
    }else{
      response=await fetch("https://api.omegatech.app/api/ai/Txt2video",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({action:"generate",prompt,ratio,sound:body.sound!==false})
      });
    }
    let text=await response.text();
    let payload=null; try{payload=JSON.parse(text)}catch{}
    if(duration>5 && response.ok && payload?.sessionId){
      for(let i=0;i<120;i++){
        await new Promise(r=>setTimeout(r,5000));
        const poll=await fetch("https://api.omegatech.app/api/ai/wan",{
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({action:"result",sessionId:String(payload.sessionId)})
        });
        const pollText=await poll.text();
        let pollData=null; try{pollData=JSON.parse(pollText)}catch{}
        const videoUrl=pollData?.data?.videoUrl||pollData?.videoUrl||pollData?.result?.videoUrl;
        if(videoUrl){
          text=JSON.stringify({success:true,statusCode:200,data:{videoUrl}});
          break;
        }
        if(pollData?.success===false) { text=pollText; break; }
      }
    }
    res.status(response.status).setHeader("Content-Type","application/json").send(text);
  }catch(error){
    res.status(500).json({success:false,error:String(error?.message||error||"OmegaTech request failed")});
  }
}
