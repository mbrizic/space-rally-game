import { TwitterApi } from "twitter-api-v2";

const client = process.env.TWITTER_API_KEY && process.env.TWITTER_API_SECRET && process.env.TWITTER_ACCESS_TOKEN && process.env.TWITTER_ACCESS_SECRET
    ? new TwitterApi({
        appKey: process.env.TWITTER_API_KEY,
        appSecret: process.env.TWITTER_API_SECRET,
        accessToken: process.env.TWITTER_ACCESS_TOKEN,
        accessSecret: process.env.TWITTER_ACCESS_SECRET,
    }).readWrite
    : null;

export async function postHighScore(name: string, score: number, seed: string) {
    if (!client) {
        console.warn("Twitter client not configured. Skipping post.");
        return;
    }

    try {
        const timeSec = (score / 1000).toFixed(3);
        const text = `New fastest lap on track ${seed}! 🚀\n\n${name} just finished in ${timeSec}s!\n\nCan you beat them? #SpaceRally #GameDev`;
        await client.v2.tweet(text);
        console.log(`Posted to Twitter: ${text}`);
    } catch (error) {
        console.error("Failed to post to Twitter:", error);
    }
}
