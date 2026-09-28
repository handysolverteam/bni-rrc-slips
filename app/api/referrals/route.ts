import { referralsGET } from "@/lib/lists";
export async function GET(req: Request) { return referralsGET(req); }
