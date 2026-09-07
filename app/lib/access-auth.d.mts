export type AccessEnv = { AUTH_MODE?:string; ACCESS_ISSUER?:string; ACCESS_AUD?:string; ACCESS_SERVICE_CLIENT_IDS?:string; AGENT_OWNER_EMAIL?:string; PORTFOLIO_OWNER_ID?:string };
export function authorizeAccess(request:Request,env:AccessEnv,options?:{fetchImpl?:typeof fetch;now?:number}):Promise<{kind:'owner';ownerId:string;email:string}|{kind:'service';clientId:string}>;
