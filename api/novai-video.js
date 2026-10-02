export default async function handler(req,res){
  if(req.method==="POST"){
    try{
      const key=String(process.env.NOVAI_API_KEY||"").trim();
      if(!key)return res.status(500).json({ok:false,error:"NOVAI_API_KEY is not configured"});

      const body=typeof req.body==="string"?JSON.parse(req.body||"{}"):(req.body||{});
      const prompt=String(body.prompt||"").trim();
      if(!prompt)return res.status(400).json({ok:false,error:"Prompt is required"});

      const response=await fetch("https://aiapi-pro.com/v1/video/generations",{
        method:"POST",
        headers:{
          "Authorization":"Bearer "+key,
          "Content-Type":"application/json"
        },
        body:JSON.stringify({
          model:"cogvideox-flash",
          prompt:prompt.slice(0,4000),
          resolution:"720p",
          duration:6
        })
      });

      const text=await response.text();
      let data={};
      try{data=text?JSON.parse(text):{}}catch{data={raw:text}};

      return res.status(response.status).json(data);
    }catch(error){
      return res.status(500).json({
        ok:false,
        error:String(error?.message||error||"NovAI request failed")
      });
    }
  }

  if(req.method==="GET"){
    try{
      const key=String(process.env.NOVAI_API_KEY||"").trim();
      if(!key)return res.status(500).json({ok:false,error:"NOVAI_API_KEY is not configured"});

      const id=String(req.query?.id||"").trim();
      if(!id)return res.status(400).json({ok:false,error:"Task id is required"});

      const response=await fetch(
        "https://aiapi-pro.com/v1/video/generations/"+encodeURIComponent(id),
        {
          headers:{
            "Authorization":"Bearer "+key,
            "Accept":"application/json"
          }
        }
      );

      const text=await response.text();
      let data={};
      try{data=text?JSON.parse(text):{}}catch{data={raw:text}};

      return res.status(response.status).json(data);
    }catch(error){
      return res.status(500).json({
        ok:false,
        error:String(error?.message||error||"NovAI status request failed")
      });
    }
  }

  res.setHeader("Allow","GET,POST");
  return res.status(405).json({ok:false,error:"Method not allowed"});
}
