// @ts-ignore no @types :(
import PostalMime from "postal-mime"
import { convert as convertHTML } from 'html-to-text';

import { DISCORD_EMBED_LIMIT, DISCORD_TOTAL_LIMIT } from "./constants"
import { EmbedQueueData, Env } from './types'
import { getAuthHeader, getDiscordHeaders, getSentry, waitForDiscordReset } from "./utils"
import { logtail, LogLevel } from "./logtail";
import { getGovDeliveryID, getGovDeliveryStats } from "./govdelivery";
import pRetry from "p-retry";

/** Sends multiple embeds with no .txt fallback */
export async function sendDiscordEmbeds(messages: EmbedQueueData[],
	discordHook: string, discordHookName: string, env: Env, ctx: ExecutionContext): Promise<void> {
	let nextSize = 0 // max = DISCORD_TOTAL_LIMIT
	let embeds = []
	let totalEmbeds = 0
	let totalAPICalls = 0
	let totalSize = 0
	const govDeliveryStats = getGovDeliveryStats()
	for (const message of messages) {
		let rawEmail: R2ObjectBody | null | undefined
		try {
			rawEmail = await pRetry(() => env.R2EMAILS.get(message.r2path), {
				retries: 10, minTimeout: 250, onFailedAttempt: (e) => {
					if (e.retriesLeft === 0) {
						const sentry = getSentry(env, ctx)
						sentry.setExtra('email.r2path', message.r2path)
						sentry.setExtra('email.from', message.from)
						sentry.setExtra('email.subject', message.subject)
						sentry.setExtra('email.to', message.to)
						sentry.setExtra('r2Error', e)
						throw e
					}
				}
			})
		} catch (e) {
			if (e instanceof Error) {
				// Ignore this message but log to sentry
				let msg = 'Unable to get raw email from R2!! Skipping this message: ' + e.message
				logtail({ env, ctx, e, msg, level: LogLevel.Error })
				continue
			}
		}

		if (!rawEmail) {
			// Ignore this message but log to sentry
			const sentry = getSentry(env, ctx)
			sentry.setExtra('email.r2path', message.r2path)
			sentry.setExtra('email.from', message.from)
			sentry.setExtra('email.subject', message.subject)
			sentry.setExtra('email.to', message.to)
			sentry.setExtra('rawEmail', rawEmail)
			const msg = 'Unable to get raw email from R2!! Skipping this message'
			logtail({ env, ctx, msg, level: LogLevel.Error })
			continue
		}
		const arrayBuffer = await rawEmail.arrayBuffer()
		const parser = new PostalMime()
		const email = await parser.parse(arrayBuffer) as {
			text: string,
			html: string,
			headers: { key: string, value: string }[]
		}
		let text = email.text
		if (!text || text.trim() === '' || text.trim() === '\n') {
			text = convertHTML(email.html)
		}

		// Recording some stats here since we're parsing anyway
		// May have already been recorded by email worker - this is
		// a fallback if it was missing a header
		if (message.shouldCheckGovDelivery) {
			for (const next of [text, email.text, email.html]) {
				if (!next) continue
				try {
					logtail({
						env, ctx, msg: 'Attempting to get GovDelivery ID', level: LogLevel.Debug, data: {
							message
						}
					})
					let govDeliveryID = getGovDeliveryID(next)
					if (!govDeliveryID) throw new Error('No GovDelivery ID found')

					govDeliveryStats.set(govDeliveryID, (govDeliveryStats.get(govDeliveryID) || 0) + 1)
					break // Take first ID we find
				} catch (e) {
					if (e instanceof Error) {
						const sentry = getSentry(env, ctx)
						sentry.setExtra('email.govdelivery.text', next)
						sentry.setExtra('email.govdelivery.from', message.from)
						sentry.setExtra('email.govdelivery.subject', message.subject)
						sentry.setExtra('email.govdelivery.to', message.to)
						sentry.setExtra('email.govdelivery.r2path', message.r2path)
						sentry.setExtra('email.govdelivery.headers', email.headers)
						logtail({
							env, ctx, e, msg: 'Failed to get GovDelivery ID: ' + e.message,
							level: LogLevel.Error,
						})
					}
				}
			}
		}

		const embed = createEmbedBody(text, message.subject, message.to, message.from, message.ts)
		if (nextSize + embed.size > DISCORD_TOTAL_LIMIT || embeds.length >= 10) {
			await sendHookWithEmbeds(env, ctx, discordHook, embeds)

			totalEmbeds += embeds.length
			totalAPICalls += 1
			totalSize += nextSize

			nextSize = 0
			embeds = []
		}

		embeds.push(embed.embed)
		nextSize += embed.size
	}

	if (embeds.length > 0) {
		await sendHookWithEmbeds(env, ctx, discordHook, embeds)

		totalEmbeds += embeds.length
		totalAPICalls += 1
		totalSize += nextSize
	}
	try {
		env.EMBEDSTATS.writeDataPoint({
			blobs: [discordHookName],
			doubles: [totalEmbeds, totalSize, totalAPICalls],
			indexes: [discordHookName]
		})
	} catch (e) {
		if (e instanceof Error) {
			logtail({
				env, ctx, msg: 'Failed to write to AE' + e.message,
				level: LogLevel.Error,
				data: {
					aeDataSet: 'embedstats',
					error: {
						message: e.message,
						stack: e.stack
					},
				}
			})
		}
	}
}

async function sendHookWithEmbeds(env: Env, ctx: ExecutionContext, hook: string, embeds: any[]) {
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
		await waitForDiscordReset(res) // Rate limit ourselves
		return res
	}
	const discordResponse = await sendHook()
	// Log all headers:
	// console.log(getDiscordHeaders(discordResponse.headers))

	if (!discordResponse.ok) {
		if (discordResponse.status === 429) {
			const body = await discordResponse.json() as { retry_after: number | undefined }
			logtail({
				env, ctx, msg: 'Ratelimited by discord - sleeping: ' + JSON.stringify(body),
				level: LogLevel.Warning,
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

function createEmbedBody(emailText: string, subject: string, to: string, from: string, ts: number) {
	const footer = `This email was sent to ${to}`
	const author = from

	// Add timestamp to the end of the email text
	let title = subject

	if (title.length > 256) {
		// Truncate title and add to description
		emailText = title.substring(256) + '\n\n' + emailText
		title = title.substring(0, 253) + '...'
	}

	// Remove excessive newlines
	emailText = emailText.replace(/\n\s*\n/g, '\n\n')
	const sizeWithoutDescription = title.length +
		author.length +
		footer.length

	const timestamp = `<t:${Math.round((ts || new Date().getTime()) / 1000)}:f>`
	const timestampLength = timestamp.length + 1 // +1 for the newline we may need to prefix
	const trimmedMessage = ' ...(TRIMMED)'
	let description = emailText
	if ((emailText.length + sizeWithoutDescription + timestampLength) > DISCORD_EMBED_LIMIT) {
		description = emailText.substring(0,
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
