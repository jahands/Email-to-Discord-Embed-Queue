import { Env } from './types'

export async function getDiscordWebhook(from: string, env: Env): Promise<{name: string, hook: string}> {
	if (from === 'noreply@github.com'
		|| from === 'notifications@github.com'
		|| from.endsWith('@sgmail.github.com')
	) {
		return {hook: env.GITHUBHOOK, name: 'github'}
	} else if (from === 'notifications@disqus.net') {
		return {hook: env.DISQUSHOOK, name: 'disqus'}
	} else if (from.match(/^postmaster@mail[a-z0-9-]*\.google\.com$/)) {
		return {hook: env.GERRITHOOK, name: 'gerrit'}
	} else if (from.endsWith('@alerts.bounces.google.com')) {
		return { hook: env.GOOGLEALERTSHOOK, name: 'google_alerts' }
	}
	return {hook: env.DISCORDHOOK, name: 'default'}
}

export function getAuthHeader(env: Env): { Authorization: string } {
	return { Authorization: `Bot ${env.BOTTOKEN}` }
}

export function sleep(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}
