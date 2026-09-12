# Local API contract

- `GET /api/config`: `{configured, provider, model, providers, configurable, managed}`. It never returns an API key. In local development `configurable` is `true` and a key can be held in the local process memory. In Vercel/production `managed` is `true`, `configurable` is `false`, and the service reads `DEEPSEEK_API_KEY` / `DEEPSEEK_MODEL` from the server environment.
- `POST /api/config`: local development only. Body `{provider:'deepseek',model,apiKey}`. Production returns `403 CONFIG_MANAGED_BY_ENV`.
- `DELETE /api/config`: local development only. Production returns `403 CONFIG_MANAGED_BY_ENV`.
- `POST /api/test`: `{ok:true,message}` after a successful model response; it never sends project documents.
- `POST /api/analyze`: `{document:{name,kind,blocks:[{id,location,text}]},focus?:string}`. Whole-document limit 90,000 characters.
- Analysis response: `{documentType,project:{name,phase,evidence:[]},issues:[],actions:[],risks:[],suggestions:[],questions:[],warnings:[],meta:{provider,model,analyzedAt,sourceBlocks,sourceCharacters,reviewed:true}}`.
- Each item: `{id,title,detail,severity:'高'|'中'|'低'|'未标注',owner:null|string,due:null|string,status:'open'|'closed'|'unknown',evidence:[{blockId,quote}]}`.
- Errors: `{error:{code,message}}` with non-2xx status; no fallback results and no credentials in responses.

The supported provider is DeepSeek, using its JSON-output chat completions API. Host and Origin checks allow localhost/127.0.0.1 for local development and the current Vercel/custom configured host over HTTPS in production.
