import { NextResponse } from "next/server";
import { triggerScan } from "@/lib/remote";

export async function POST() {
  const result = await triggerScan();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
