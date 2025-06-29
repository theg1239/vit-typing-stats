import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/primsa";
import cacheManager from "@/lib/monkeytypeCache";
import { updateScoresInDb } from "@/lib/updateScoresInDb";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { discordId: session.user.id },
    select: { mtUrl: true, discordId: true, mtVerified: true },
  });

  if (!user || !user.mtUrl || !user.mtVerified) {
    return NextResponse.json({ error: "No verified Monkeytype profile found." }, { status: 400 });
  }

  try {
    const cachedData = await cacheManager.getCachedUserData(user.discordId);
    const now = Date.now();
    const FRESH_THRESHOLD = 30 * 1000; 
    if (cachedData && (now - cachedData.lastFetched) < FRESH_THRESHOLD) {
      return NextResponse.json({ 
        message: "Scores are already up to date",
        lastFetched: cachedData.lastFetched,
        scores: cachedData.scores,
        fromCache: true,
      });
    }

    await cacheManager.forceUpdate(user.discordId);
    const updatedData = await cacheManager.getCachedUserData(user.discordId);

    if (!updatedData) {
      console.error(`Failed to fetch updated data for user ${user.discordId} after force update.`);
      return NextResponse.json({ error: "Failed to fetch updated data after force update" }, { status: 500 });
    }

    if (!updatedData.scores) {
      console.error(`Updated data for user ${user.discordId} is missing 'scores' property. Data:`, JSON.stringify(updatedData));
      return NextResponse.json({ error: "Updated data is malformed (missing scores)" }, { status: 500 });
    }

    await updateScoresInDb(user.discordId, updatedData.scores);

    const scoreMap = [
      { type: "60", wpm: updatedData.scores.wpm60, raw: updatedData.scores.raw60, accuracy: updatedData.scores.acc60 },
      { type: "30", wpm: updatedData.scores.wpm30, raw: updatedData.scores.raw30, accuracy: updatedData.scores.acc30 },
      { type: "15", wpm: updatedData.scores.wpm15, raw: updatedData.scores.raw15, accuracy: updatedData.scores.acc15 },
    ];

    return NextResponse.json({ 
      message: "Scores updated successfully and written to database", 
      scores: scoreMap,
      lastFetched: updatedData.lastFetched,
      fromCache: false,
    });

  } catch (err) {
    console.error("Error updating personal score:", err);
    return NextResponse.json({ error: "Failed to fetch/update score." }, { status: 500 });
  }
}
