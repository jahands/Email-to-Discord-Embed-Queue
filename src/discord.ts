// @ts-ignore no @types :(
import PostalMime from "postal-mime"
import { convert as convertHTML } from 'html-to-text';

import { DISCORD_EMBED_LIMIT, DISCORD_TOTAL_LIMIT } from "./constants"
import { EmailFromHeader, EmbedQueueData, Env, PostalMimeType } from './types'
import { getAuthHeader, getDiscordHeaders, getRateLimiter, getSentry, parseFromEmailHeader, waitForDiscordReset } from "./utils"
import { logtail, LogLevel } from "./logtail";
import { getGovDeliveryID, getGovDeliveryStats } from "./govdelivery";
import pRetry, { AbortError } from "p-retry";

export interface DiscordEmbed {
	title: string
	description: string
	author: {
		name: string
	}
	footer: {
		text: string
	}

}
export interface MessageWithEmbed {
	message: Message<EmbedQueueData>
	embed: DiscordEmbed
}

export interface Batch {
	hookURL: string
	hookName: string
	embeds: MessageWithEmbed[]
	size: number
}

function newBatch(hookURL: string, hookName: string): Batch {
	return { embeds: [], size: 0, hookURL, hookName }
}

export async function getDiscordEmbedBatches(
	messages: Message<EmbedQueueData>[],
	hookURL: string,
	hookName: string,
	env: Env,
	ctx: ExecutionContext
): Promise<Batch[]> {
	const sentry = getSentry(env, ctx)

	const batches: Batch[] = []

	let batch: Batch = newBatch(hookURL, hookName)
	const govDeliveryStats = getGovDeliveryStats()
	const processMessagePromises: Promise<void>[] = []
	for (const message of messages) {
		const processMessage = async () => {
			const fromHeader: EmailFromHeader = parseFromEmailHeader(message.body.rawFromHeader)
			let rawEmail: R2ObjectBody | null | undefined
			try {
				rawEmail = await pRetry(async () => {
					const res = await env.R2EMAILS.get(message.body.r2path)
					if (res === null) {
						await scheduler.wait(1000)
						throw new Error('R2 returned null, maybe it\'s not available yet due to a race condition?')
					}
					return res
				}, {
					retries: 10, minTimeout: 250, onFailedAttempt: (e) => {
						if (e.retriesLeft === 0) {
							const sentry = getSentry(env, ctx)
							sentry.setExtra('email.r2path', message.body.r2path)
							sentry.setExtra('email.from', message.body.from)
							sentry.setExtra('email.subject', message.body.subject)
							sentry.setExtra('email.to', message.body.to)
							sentry.setExtra('r2Error', e)
						}
					}
				})
			} catch (e) {
				if (e instanceof Error) {
					// Ignore this message but log to sentry
					let msg = 'Unable to get raw email from R2!! Skipping this message: ' + e.message
					logtail({ env, ctx, e, msg, level: LogLevel.Error })
					return
				}
			}

			if (!rawEmail) {
				// Ignore this message but log to sentry
				sentry.withScope((scope) => {
					scope.setExtras({
						email: {
							r2path: message.body.r2path,
							from: message.body.from,
							rawFromHeader: fromHeader.raw,
							subject: message.body.subject,
							to: message.body.to,
							rawEmail,
						},
					})
					const msg = 'Unable to get raw email from R2!! Skipping this message'
					logtail({ env, ctx, msg, level: LogLevel.Error })
				})
				return
			}
			const arrayBuffer = await rawEmail.arrayBuffer()
			const parser = new PostalMime() as PostalMimeType
			const email = await parser.parse(arrayBuffer)
			let text = email.text
			if (!text || ['', '\n', '&nbsp;'].includes(text.trim())) {
				if (email.html) {
					text = convertHTML(email.html)
				}
			}
			if (!text) {
				// Ignore this message but log to sentry
				sentry.withScope((scope) => {
					scope.setExtras({
						email: {
							r2path: message.body.r2path,
							from: message.body.from,
							rawFromHeader: fromHeader.raw,
							subject: message.body.subject,
							to: message.body.to,
						},
						rawEmail,
					})
					const msg = 'Unable to get text from email!! Skipping this message'
					logtail({ env, ctx, msg, level: LogLevel.Error })
				})
				return
			}

			// BEGIN GOVDELIVERY STATS

			// Recording some stats here since we're parsing anyway
			// May have already been recorded by email worker - this is
			// a fallback if it was missing a header
			if (message.body.shouldCheckGovDelivery) {
				for (const next of [text, email.text, email.html]) {
					if (!next) return
					try {
						let govDeliveryID = getGovDeliveryID(next)
						if (!govDeliveryID) throw new Error('No GovDelivery ID found')

						govDeliveryStats.set(govDeliveryID, (govDeliveryStats.get(govDeliveryID) || 0) + 1)
						break // Take first ID we find
					} catch (e) {
						sentry.withScope(scope => {
							if (e instanceof Error) {
								scope.setExtras({
									email: {
										govDelivery: {
											text: next,
											fromHeader,
											subject: message.body.subject,
											to: message.body.to,
											r2path: message.body.r2path,
											headers: email.headers,
										},
									}
								})
								logtail({
									env, ctx, e, msg: 'Failed to get GovDelivery ID: ' + e.message,
									level: LogLevel.Error,
								})
							}
						})
					}
				}
			}

			// END GOVDELIVERY STATS

			const { embed, size } = createEmbedBody(
				text,
				message.body.subject,
				message.body.to,
				message.body.from,
				fromHeader,
				message.body.ts
			)
			if (batch.size + size > DISCORD_TOTAL_LIMIT || batch.embeds.length >= 10) {
				batches.push(batch)
				batch = newBatch(hookURL, hookName)
			}

			batch.embeds.push({ message, embed })
			batch.size += size
		}
		processMessagePromises.push(processMessage())
	}
	await Promise.allSettled(processMessagePromises)

	if (batch.embeds.length > 0) {
		batches.push(batch)
	}

	return batches
}

export async function sendDiscordBatch(
	batch: Batch,
	env: Env,
	ctx: ExecutionContext
): Promise<void> {
	try {
		await sendHookWithEmbeds(env, ctx, batch.hookURL, batch.embeds.map(e => e.embed))
		batch.embeds.forEach(embed => embed.message.ack())
	} catch (e) {
		if (e instanceof Error) {
			logtail({
				env, ctx, e, msg: 'Error sending discord embeds (batch)',
				level: LogLevel.Error,
				data: {
					batch
				}
			})
			batch.embeds.forEach(embed => embed.message.retry())
		}
		throw e
	}
}

async function sendHookWithEmbeds(env: Env, ctx: ExecutionContext, hook: string, embeds: DiscordEmbed[]) {
	const rateLimiter = getRateLimiter()

	// Send the embeds
	const embedBody = JSON.stringify({ embeds })
	const formData = new FormData()
	formData.append("payload_json", embedBody)
	const sendHook = async () => {
		const res = await fetch(hook, {
			method: "POST",
			body: formData,
			headers: getAuthHeader(env)
		})
		try {
			await waitForDiscordReset(res) // Rate limit ourselves
		} catch (e) {
			if (e instanceof Error) {
				logtail({
					env, ctx, e, msg: 'Failed to wait for discord reset: ' + e.message,
					level: LogLevel.Error,
					data: {
						discordHook: hook,
						discordResponse: res,
						discordResponseHeaders: getDiscordHeaders(res.headers),
					}
				})
			}
		}
		return res
	}
	const discordResponse = await sendHook()
	// Log all headers:
	// console.log(getDiscordHeaders(discordResponse.headers))

	if (discordResponse.ok) {
		if (rateLimiter.rateLimitedCount > 0) {
			rateLimiter.rateLimitedCount -= 0.25
		}
	} else {
		if (discordResponse.status === 429) {
			rateLimiter.rateLimitedCount++
			console.log({ rateLimiter })
			const body = await discordResponse.json() as { retry_after: number | undefined }
			logtail({
				env, ctx, msg: 'Ratelimited by discord - sleeping: ' + JSON.stringify(body),
				useSentry: false, // No way to fix this
				level: LogLevel.Info,
				data: {
					discordHook: hook,
					discordResponse: body,
					discordResponseHeaders: getDiscordHeaders(discordResponse.headers)
				}
			})
			if (body.retry_after) {
				await scheduler.wait(body.retry_after * 1000)
			}
			// retry and give up if it fails again
			const retryResponse = await sendHook()
			if (!retryResponse.ok) {
				logtail({
					env, ctx, msg: `Failed after 1 retry, giving up: ${JSON.stringify(body)}`,
					level: LogLevel.Error,
					data: {
						discordHook: hook,
						discordResponse: body,
						discordResponseHeaders: getDiscordHeaders(discordResponse.headers),
						discordRetryResponseHeaders: getDiscordHeaders(retryResponse.headers)
					}
				})
				throw new Error(`Failed to send to discord after 1 retry: ${JSON.stringify(body)}`)
			}
		} else if (discordResponse.status === 400) {
			const body = await discordResponse.json() as any
			let logged = false
			if (Array.isArray(body.embeds)) {
				for (const embed of body.embeds) {
					try {
						const idx = parseInt(embed) // Index of bad embed
						logtail({
							env, ctx, msg: `Bad embed at index ${idx} - ` + JSON.stringify(body),
							level: LogLevel.Error,
							data: {
								discordHook: hook,
								embed: embeds[idx],
								discordResponse: body
							}
						})
						logged = true
					} catch (e) {
						if (e instanceof Error) {
							logtail({
								env, ctx, e, msg: `Error parsing embed index: ${e.message}`,
								level: LogLevel.Error,
								data: {
									discordHook: hook,
									embedIndex: embed,
									discordResponse: body
								}
							})
						}
					}
				}
			}
			if (!logged) {
				logtail({
					env, ctx, msg: JSON.stringify(body),
					level: LogLevel.Error,
					data: {
						discordHook: hook,
						discordResponse: body
					}
				})
			}
		}
	}
}

function trimEmbedBody(fromHeader: EmailFromHeader, body: string): string {
	if (fromHeader.address === 'notifications@github.com') {
		[
			['Reply to this email directly or view it on GitHub:\n', ''],
			['View it on GitHub:\n', ''],
			['You are receiving this because you are subscribed to this thread.\n', '']
		]
			.forEach(([search, replace]) => {
				body = body.replace(search, replace)
			})
	} else if (fromHeader.address === 'notifications@disqus.net') {
		const search = '-----'
		const lastIdx = body.lastIndexOf(search)
		if (lastIdx !== -1) {
			body = body.substring(0, lastIdx)
		}
	} else if (fromHeader.address === 'alerts@weatherusa.net') {
		const search = '--------------------------------------------------'
		const lastIdx = body.lastIndexOf(search)
		if (lastIdx !== -1) {
			body = body.substring(0, lastIdx)
		}
	}
	return body
}

function createEmbedBody(
	emailText: string,
	subject: string,
	to: string,
	from: string,
	fromHeader: EmailFromHeader,
	ts: number
) {
	const skipFromHeader = [
		'notifications@github.com', // Save a tiny bit of space for GH
		'notifications@disqus.net'
	]
	let footer = `Sent to ${to}`
	if (!skipFromHeader.includes(fromHeader.address)) {
		footer += `\nFrom ${from}`
	}

	let author = `${fromHeader.name} <${fromHeader.address}>`
	if (author.length > 64) {
		author = `${fromHeader.name}\n${fromHeader.address}`
	}
	if (author.length > 256) {
		author = fromHeader.address
	}

	// Add timestamp to the end of the email text
	let title = subject

	if (title.length > 256) {
		// Truncate title and add to description
		emailText = title.substring(256) + '\n\n' + emailText
		title = title.substring(0, 253) + '...'
	}

	// Trim certain emails
	emailText = trimEmbedBody(fromHeader, emailText)

	// Remove excessive newlines
	emailText = emailText.replace(/\n\s*\n/g, '\n\n')
	const sizeWithoutDescription = title.length +
		author.length +
		footer.length

	const timestamp = `<t:${Math.round((ts || new Date().getTime()) / 1000)}:f>`
	const timestampLength = timestamp.length + 1 // +1 for the newline we may need to prefix
	const trimmedMessage = ' ...(TRIMMED)'
	let description = emailText
	if ((description.length + sizeWithoutDescription + timestampLength) > DISCORD_EMBED_LIMIT) {
		description = description.substring(0,
			DISCORD_EMBED_LIMIT - trimmedMessage.length - sizeWithoutDescription - timestampLength
		).trim() + trimmedMessage
	}
	if (!description.endsWith('\n')) {
		description += '\n'
	}
	description += timestamp

	const embed = {
		title,
		description,
		author: {
			name: author,
		},
		footer: {
			text: footer,
		},
	}
	const size = title.length +
		embed.description.length +
		author.length +
		footer.length
	return { embed, size }
}
