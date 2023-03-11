import { Toucan } from 'toucan-js'
import { EmailFromHeader, EmbedQueueData, Env } from './types'
import addrs from 'email-addresses'

export async function getDiscordWebhook(data: EmbedQueueData, env: Env): Promise<{ name: string, hook: string }> {
	const fromHeader = parseFromEmailHeader(data.rawFromHeader)
	const bulk = {
		to: [
		],
		fromAddress: [
			'everyone@enron.email',
			'alerts@alerts.craigslist.org',
			'noreply@caddy.community',
			'do.not.reply@linustechtips.com',
			'subscriptions@medium.com',
			'forum@linuxquestions.org',
			'access@interactive.wsj.com',
		],
		fromAddressEndsWith: [
			'@arstechnica.com',
			'@stackoverflow.email',
			'@em.atlassian.com',
			'@grabagun.com',
			'.grabagun.com',
			'@blu-ray.com',
			'@bugs.launchpad.net',
			'@substack.com',
			'@e.newscientist.com',
			'.camaro5.com',
			'@dailyhodl.com',
			'@terraria.org',
			'@atlasobscura.com',
			'.beehiiv.com',
			'@atlasobscura.com',
			'.foodnetwork.com',
			'@theinformation.com',
			'.theskimm.com',
			'@creatorwizard.com',
			'.sltrib.com', // salt lake tribune
			'@steelersdepot.com',
			'.msnbc.com',
			'@flylady.net',
			'@technologyreview.com',
			'.biblegateway.com',
			'@forum.rclone.org',
			'.theguardian.com',
			'@buzzfeed.com',
			'@nectarsleep.com',
			'.newsmax.com',
			'.cnn.com',
			'@ebay.com',
			'@theinformation.com',
			'@divenewsletter.com',
			'.groupon.com',
			'@nytimes.com',
			'@games4grandma.com', // wholesome tbh
			'@atlasobscura.com',
			'.rd.com',
			'.itprotoday.com',
			'.time.com',
			'.nbcchicago.com',
			'.cbsnews.com',
			'@ayushchat.com', // almost sus
			'.today.com',
			'.nbcnews.com',
			'@iphonephotographyschool.com', // selling courses
			'@thehustle.co',
			'.bloombergbusiness.com',
			'.milkroad.com',
			'@decryptmedia.com',
		],
		fromAddressRegex: [
			/^notifications@[\w-]+\.discoursemail\.com$/,
		],
	}

	const sus = {
		fromAddressEndsWith: [
			'@benzinga.com', // stocks
			'.freecryptorewards.com',
			'@1xbit.com', // crypto
		]
	}

	if (fromHeader.address === 'notifications@github.com') {
		return { hook: env.GITHUBHOOK, name: 'github' }

	} else if (fromHeader.address === 'notifications@disqus.net') {
		return { hook: env.DISQUSHOOK, name: 'disqus' }

	} else if (isGerrit(fromHeader.address)) {
		return { hook: env.GERRITHOOK, name: 'gerrit' }

	} else if (fromHeader.address === 'googlealerts-noreply@google.com') {
		return { hook: env.GOOGLEALERTSHOOK, name: 'google_alerts' }

	} else if ([
		'usa-gov-lists@', 'uscis@', 'dol@', 'fda@', 'uk-gov-lists@'
	].some(s => data.to.startsWith(s))) {
		return { hook: env.GOVHOOK, name: 'gov-lists' }

	} else if (
		bulk.to.some(s => data.to.startsWith(s)) ||
		bulk.fromAddress.includes(fromHeader.address) ||
		bulk.fromAddressEndsWith.some(s => fromHeader.address.endsWith(s)) ||
		bulk.fromAddressRegex.some(re => re.test(fromHeader.address))
	) {
		return { hook: env.BULKHOOK, name: 'bulk' }

	} else if (
		sus.fromAddressEndsWith.some(s => fromHeader.address.endsWith(s))
	) {
		return { hook: env.SUSHOOK, name: 'sus' }

	} else if (fromHeader.address === 'alerts@weatherusa.net') {
		return { hook: env.WEATHERHOOK, name: 'weather' }
	}

	return { hook: env.DISCORDHOOK, name: 'default' }
}

function isGerrit(from: string) {
	const fromRe = [
		/^noreply-gerritcodereview-[\w-]+=+@chromium\.org$/,
		/^jenkinsci-commits@googlegroups\.com$/, // not Gerrit but feels similar
		/^.*@chromium\.org$/, // might not be Gerrit, but feels similar
	]
	return fromRe.some(re => re.test(from))
}

/** Parses out the email address from a From header */
export function parseFromEmailHeader(from: string): EmailFromHeader {
	const ad = addrs.parseOneAddress(
		{
			input: from,
			oneResult: true,
			rfc6532: true, // unicode
		}
	) as emailAddresses.ParsedMailbox | null
	if (!ad) throw new Error(`unable to parse from: ${from}`)
	// @ts-expect-error - comments is not in the type
	const comments: string | undefined = ad.comments
	let name = ad.name || ''
	if (comments && comments.length > 0) {
		name = `${name} ${comments}`
	}
	return { address: ad.address, name, raw: from, local: ad.local || '' }
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
