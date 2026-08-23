import { NextResponse } from "next/server";
import { stopScan } from "@/lib/remote";

export async function POST() {
  const result = await stopScan();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
