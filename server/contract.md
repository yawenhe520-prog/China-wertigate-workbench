# Local API contract

- GET `/api/config`: `{configured, provider, model, providers:[{id,label,defaultModel}]}`; no key is ever returned. Initial provider is `deepseek`, default model `deepseek-flash`.
- POST `/api/config`: `{provider:'deepseek',model,apiKey}`. Credentials stay in memory. A blank key keeps the current key only for the same provider.
- DELETE `/api/config`: removes the in-memory key.
- POST `/api/test`: `{ok:true,message}` after a successful model response (no project data).
- POST `/api/analyze`: `{document:{name,kind,blocks:[{id,location,text}]},focus?:string}`. Whole-document limit 90,000 characters.
- Analysis response: `{documentType,project:{name,phase,evidence:[]},issues:[],actions:[],risks:[],suggestions:[],questions:[],warnings:[],meta:{provider,model,analyzedAt,sourceBlocks,sourceCharacters,reviewed:true}}`.
- Each item: `{id,title,detail,severity:'高'|'中'|'低'|'未标注',owner:null|string,due:null|string,status:'open'|'closed'|'unknown',evidence:[{blockId,quote}]}`.
- Errors: `{error:{code,message}}` with non-2xx status; no fallback results.

The supported provider is DeepSeek, using its JSON-output chat completions API.
