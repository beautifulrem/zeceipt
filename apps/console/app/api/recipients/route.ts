import { createRecipientResponse, listRecipientsResponse, recipientsProblem } from "../../../lib/http/recipients.ts";
import { guarded } from "../../../lib/http/route.ts";

export const dynamic = "force-dynamic";

export const GET = guarded(() => listRecipientsResponse(), recipientsProblem);
export const POST = guarded((req) => createRecipientResponse(req), recipientsProblem);
