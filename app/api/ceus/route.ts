import { ceusGET } from "@/lib/lists";
export async function GET(req: Request) { return ceusGET(req); }
