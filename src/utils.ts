import { Toucan } from 'toucan-js'
import { Env } from './types'

export async function getDiscordWebhook(from: string, to: string, env: Env): Promise<{ name: string, hook: string }> {
	if (from === 'noreply@github.com'
		|| from === 'notifications@github.com'
		|| from.endsWith('@sgmail.github.com')
	) {
		return { hook: env.GITHUBHOOK, name: 'github' }
	} else if (from === 'notifications@disqus.net') {
		return { hook: env.DISQUSHOOK, name: 'disqus' }
	} else if (isGerrit(from)) {
		return { hook: env.GERRITHOOK, name: 'gerrit' }
	} else if (from.endsWith('@alerts.bounces.google.com')) {
		return { hook: env.GOOGLEALERTSHOOK, name: 'google_alerts' }
	} else if (to === 'usa-gov-lists@eemailme.com') {
		return { hook: env.GOVHOOK, name: 'gov-lists' }
	}
	return { hook: env.DISCORDHOOK, name: 'default' }
}

function isGerrit(from: string) {
	const fromRe = [
		/^postmaster@mail[a-z0-9-]*\.google\.com$/, // most gerrit
		/^chromium-reviews\+\w+@chromium\.org$/, // chromium gerrit
	]
	return fromRe.some(re => re.test(from))
}

export function getAuthHeader(env: Env): { Authorization: string } {
	return { Authorization: `Bot ${env.BOTTOKEN}` }
}

let sentry: Toucan | undefined
export function getSentry(env: Env, ctx: ExecutionContext): Toucan {
	if (!sentry) {
		sentry = new Toucan({
			dsn: env.SENTRY_DSN,
			context: ctx,
		});
	}
	return sentry
}
