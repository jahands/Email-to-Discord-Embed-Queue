import { Toucan } from 'toucan-js'
import { Env } from './types'

export async function getDiscordWebhook(from: string, to: string, env: Env): Promise<{ name: string, hook: string }> {
	const bulk = {
		to: [
			'rorymonroe@eemailme.com',
			'terraria@eemailme.com',
			'flyaf@eemailme.com',
			'bloomberg@eemailme.com',
			'steelersdepot@eemailme.com',
			'nbc-news@eemailme.com',
			'crooked@eemailme.com', // crooked.com newsletter
			'reddit.com@eemailme.com',
		],
		from: [
			'everyone@enron.email'
		],
		fromEndsWith: [
			'@alerts.craigslist.org',
			'.discoursemail.com',
			'@em.atlassian.com',
			'@linustechtips.com',
			'@googlegroups.com',
			'@forum.rclone.org',
			'@chromium.org',
			'@newsletters.cnn.com',
			'@bounce.buzzfeed.com',
			'@launchpad.net',
			'.substack.com',
			'@latest.newsmax.com',
			'.groupon.com',
			'.theinformation.com',
			'.theguardian.com',
			'@email.paireyewear.com',
			'@notifications.arstechnica.com',
			'@email.sltrib.com',
			'.officedepot.com',
			'.propublica.net',
			'.nytimes.com',
			'@cmail20.com', // wsj.com
			'@cmail19.com', // wsj.com
			'.cbssports.com',
			'@email.caddyserver.com',
			'@email.medium.com',
			'.lifehacker.com',
			'.benzinga.com',
			'@ubuntuforums.org',
			'.grabagun.com',
			'.appsumo.com',
			'.cbinsights.com',
		]
	}

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
	} else if ([
		'usa-gov-lists@eemailme.com', 'uscis@eemailme.com', 'dol@eemailme.com', 'fda@eemailme.com'
	].includes(to)) {
		return { hook: env.GOVHOOK, name: 'gov-lists' }
	} else if (
		bulk.to.includes(to) ||
		bulk.from.includes(from) ||
		bulk.fromEndsWith.some(s => from.endsWith(s))
	) {
		return { hook: env.BULKHOOK, name: 'bulk' }
	} else if (from === 'alerts@weatherusa.net') {
		return { hook: env.WEATHERHOOK, name: 'weather' }
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
		initSentry(env, ctx)
	}
	if (!sentry) throw new Error('unable to initSentry')
	return sentry
}

export function initSentry(env: Env, ctx: ExecutionContext): Toucan {
	sentry = new Toucan({
		dsn: env.SENTRY_DSN,
		context: ctx,
		environment: env.ENVIRONMENT,
		release: env.SENTRY_RELEASE,
	})
	return sentry
}

let rateLimiter: { rateLimitedCount: number } | undefined
export function initRateLimiter(): void {
	rateLimiter = { rateLimitedCount: 0 }
}

export function getRateLimiter(): { rateLimitedCount: number } {
	if (!rateLimiter) {
		initRateLimiter()
	}
	if (!rateLimiter) throw new Error('unable to initRateLimiter')
	return rateLimiter
}

export function getDiscordHeaders(headers: Headers) {
	return {
		'X-RateLimit-Limit': headers.get('X-RateLimit-Limit'),
		'X-RateLimit-Remaining': headers.get('X-RateLimit-Remaining'),
		'X-RateLimit-Reset': headers.get('X-RateLimit-Reset'),
		'X-RateLimit-Reset-After': headers.get('X-RateLimit-Reset-After'),
		'X-RateLimit-Bucket': headers.get('X-RateLimit-Bucket'),
	}
}

export async function waitForDiscordReset(response: Response): Promise<void> {
	// Try to avoid ratelimiting constantly
	const rateLimiter = getRateLimiter()
	if (rateLimiter.rateLimitedCount >= 3) {
		console.log('waiting extra!!')
		await scheduler.wait(1700)
	}

	const headers = response.headers
	const remaining = headers.get('X-RateLimit-Remaining')
	if (!remaining || parseFloat(remaining) >= 1) return

	const resetAfterSeconds = headers.get('X-RateLimit-Reset-After')
	if (!resetAfterSeconds) return

	const resetAfterMs = parseFloat(resetAfterSeconds) * 1000
	await scheduler.wait(resetAfterMs)
}
