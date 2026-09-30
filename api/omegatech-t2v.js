export default async function handler(req,res){
  if(req.method!=="POST"){
    res.setHeader("Allow","POST");
    return res.status(405).json({error:"Method not allowed"});
  }

  try{
    const body=typeof req.body==="string"?JSON.parse(req.body||"{}"):(req.body||{});
    const requestedDuration=Math.max(1,Math.min(10,Number(body.duration)||5));
    const duration=requestedDuration>5?10:5.1;
    const ratio=["16:9","9:16","1:1"].includes(body.ratio)?body.ratio:"16:9";
    const userPrompt=String(body.prompt||"").trim();

    /*
     * Do not use Txt2video here.
     * OmegaTech's documented Txt2video endpoint has no duration parameter and
     * has produced portrait output even when ratio=16:9. Wan 2.2 exposes the
     * real duration control and accepts a negative prompt.
     */
    const prompt=[
      "Generate ONLY the scene described by the USER DESCRIPTION.",
      "The user description is the complete storyboard. Do not continue or reuse any previous scene.",
      "Do not invent, restore or remember characters, people, animals, vehicles, weapons, uniforms, props or events from another generation.",
      "If the user names one subject, generate exactly one of that subject.",
      "A location is only a location and must never introduce additional characters.",
      "Follow every requested action literally and in the exact order.",
      "Use realistic physical motion and coherent cause and effect.",
      "Keep anatomy stable and correct. No duplicate subjects, extra limbs, heads, tails, wings or appendages.",
      "No text, logos, subtitles, decorative effects, random action or cinematic story additions unless explicitly requested.",
      "Requested output aspect ratio: "+ratio+". Prefer a true widescreen composition for 16:9.",
      "USER DESCRIPTION:",
      userPrompt
    ].join("\n");

    const lower=userPrompt.toLowerCase();
    const asksPeople=/\b(man|woman|person|people|human|soldier|soldiers|military|boy|girl|child|children|crowd|человек|люди|мужчина|женщина|солдат|солдаты|военные|ребенок|дети)\b/i.test(lower);
    const asksAnimals=/\b(dog|cat|horse|boar|pig|wolf|bear|fox|deer|eagle|bird|animal|собак|собака|кот|кошка|лошад|кабан|свин|волк|медвед|лиса|олень|орел|птиц|животн)\b/i.test(lower);
    const negativeParts=[
      "unrequested characters",
      "unrequested people",
      "unrequested animals",
      "unrequested vehicles",
      "unrequested weapons",
      "unrequested props",
      "unrequested actions",
      "extra subjects",
      "duplicate subjects",
      "scene continuation from a previous generation",
      "previous prompt content"
    ];
    if(!asksPeople) negativeParts.push("people, humans, soldiers, military, armed men, uniforms");
    if(!asksAnimals) negativeParts.push("animals");
    const negativePrompt=negativeParts.join(", ");

    const requestBody={
      action:"generate",
      prompt,
      negativePrompt,
      duration,
      seed:-1,
      steps:8,
      cfg:5,
      motion:4,
      ratio
    };
    const gateways=[
      "https://api.omegatech.app",
      "https://omegatech-api.dixonomega.tech"
    ];
    let gateway=gateways[0];
    let response=await fetch(gateway+"/api/ai/wan",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(requestBody)
    });
    if(response.status===404){
      gateway=gateways[1];
      response=await fetch(gateway+"/api/ai/wan",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(requestBody)
      });
    }

    let text=await response.text();
    let payload=null;
    try{payload=JSON.parse(text)}catch{}

    if(duration>5 && response.ok && payload?.sessionId){
      let completed=false;
      for(let i=0;i<120;i++){
        await new Promise(r=>setTimeout(r,5000));
        const poll=await fetch(gateway+"/api/ai/wan",{
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({action:"result",sessionId:String(payload.sessionId)})
        });
        const pollText=await poll.text();
        let pollData=null;
        try{pollData=JSON.parse(pollText)}catch{}
        const videoUrl=
          pollData?.data?.videoUrl||
          pollData?.videoUrl||
          pollData?.result?.videoUrl||
          pollData?.data?.result?.videoUrl;
        if(videoUrl){
          text=JSON.stringify({success:true,statusCode:200,data:{videoUrl}});
          completed=true;
          break;
        }
        if(pollData?.success===false){
          text=pollText;
          break;
        }
      }
      if(!completed && !payload?.data?.videoUrl){
        text=JSON.stringify({success:false,error:"OmegaTech Wan video generation timed out"});
      }
    }

    if(!response.ok){
      return res.status(502).json({success:false,error:"OmegaTech Wan upstream error",upstreamStatus:response.status,details:text.slice(0,2000)});
    }
    res.status(200).setHeader("Content-Type","application/json").send(text);
  }catch(error){
    res.status(500).json({success:false,error:String(error?.message||error||"OmegaTech request failed")});
  }
}
