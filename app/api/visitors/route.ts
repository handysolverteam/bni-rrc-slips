import { visitorsGET } from "@/lib/lists";
export async function GET(req: Request) { return visitorsGET(req); }
