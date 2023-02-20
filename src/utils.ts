import { ThrottledQueue } from '@jahands/msc-utils'
import { Env } from './types'

// Inject rate-limiting (this is not a great way to do this, but it works..)
const defaultQueue = new ThrottledQueue({ concurrency: 1, interval: 1000, limit: 1 });

export async function getDiscordWebhook(from: string, env: Env): Promise<string> {
	await defaultQueue.add(async () => { })
	let hook = env.DISCORDHOOK
	if (from === 'noreply@github.com'
		|| from === 'notifications@github.com'
		|| from.endsWith('@sgmail.github.com')
	) {
		hook = env.GITHUBHOOK
	} else if (from === 'notifications@disqus.net') {
		hook = env.DISQUSHOOK
	} else if (from.match(/^postmaster@mail[a-z0-9-]*\.google\.com$/)) {
		hook = env.GERRITHOOK
	}
	return hook
}

export function getAuthHeader(env: Env): { Authorization: string } {
	return { Authorization: `Bot ${env.BOTTOKEN}` }
}

export function sleep(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}
