import {
  DEFAULT_DEVICE_SIZES,
  DEFAULT_IMAGE_SIZES,
  handleImageOptimization,
} from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { authorizeAccess, type AccessEnv } from '../app/lib/access-auth.mjs';

interface Env extends AccessEnv {
  MIGRATION_READ_ONLY?: string;
  ASSETS: Fetcher;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (env.MIGRATION_READ_ONLY === 'true' && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      return new Response('Brief maintenance pause. Please retry shortly.', { status: 503, headers: { 'Retry-After': '60' } });
    }
    if(env.AUTH_MODE==='cloudflare'){
      try{await authorizeAccess(request,env);}catch(error){return error instanceof Response?error:new Response('Unauthorized',{status:403});}
      // A caller cannot smuggle legacy Sites identity into route handlers.
      const headers=new Headers(request.headers);
      headers.delete('oai-authenticated-user-id');headers.delete('oai-authenticated-user-email');
      request=new Request(request,{headers});
    }
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
