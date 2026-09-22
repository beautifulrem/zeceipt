import { handleCreate, handleList } from "../../../lib/http/batches.ts";

export const dynamic = "force-dynamic";

export function GET(): Promise<Response> {
  return handleList();
}

export function POST(req: Request): Promise<Response> {
  return handleCreate(req);
}
