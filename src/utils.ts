import { Env } from './types'

export async function getDiscordWebhook(from: string, env: Env): Promise<string> {
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
	} else if (from.endsWith('@alerts.bounces.google.com')) {
		hook = env.GOOGLEALERTSHOOK
	}
	return hook
}

export function getAuthHeader(env: Env): { Authorization: string } {
	return { Authorization: `Bot ${env.BOTTOKEN}` }
}

export function sleep(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}
