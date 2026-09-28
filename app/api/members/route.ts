import { membersGET } from "@/lib/lists";
export async function GET(req: Request) { return membersGET(req); }
