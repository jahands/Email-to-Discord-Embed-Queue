// @ts-ignore no @types :(
import PostalMime from "postal-mime"
import { convert as convertHTML } from 'html-to-text';
// import { ThrottledQueue } from '@jahands/msc-utils'

import { DISCORD_EMBED_LIMIT, DISCORD_TOTAL_LIMIT } from "./constants"
import { EmbedQueueData, Env } from './types'
import { getAuthHeader, sleep } from "./utils"
import { logtail, LogLevel } from "./logtail";

/** Sends multiple embeds with no .txt fallback */
export async function sendDiscordEmbeds(messages: EmbedQueueData[],
	discordHook: string, discordHookName: string, env: Env, ctx: ExecutionContext) {
	let nextSize = 0 // max = DISCORD_TOTAL_LIMIT
	let embeds = []
	let totalEmbeds = 0
	let totalAPICalls = 0
	let totalSize = 0
	for (const message of messages) {
		const rawEmail = await env.R2EMAILS.get(message.r2path)
		if (!rawEmail) {
			throw new Error('Unable to get raw email from R2!!')
		}
		const arrayBuffer = await rawEmail.arrayBuffer()
		const parser = new PostalMime()
		const email = await parser.parse(arrayBuffer)
		let text = email.text
		if (!text) {
			text = convertHTML(email.html)
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
			await logtail({
				env, msg: e.message,
				level: LogLevel.Error,
				data: {
					error: {
						message: e.message,
						stack: e.stack
					},
				}
			})
		}
	}
}

// Turning off throttling for now because we have proper rate limit handling
// const throttledQueue = new ThrottledQueue({ concurrency: 1, interval: 1000, limit: 1 });

async function sendHookWithEmbeds(env: Env, ctx: ExecutionContext, hook: string, embeds: any[]) {
	// Send the embeds
	const embedBody = JSON.stringify({ embeds })
	const formData = new FormData()
	formData.append("payload_json", embedBody)
	const sendHook = async () => {
		// await throttledQueue.add(async () => { }) // Rate limit ourselves
		return fetch(hook, {
			method: "POST",
			body: formData,
			headers: getAuthHeader(env)
		})
	}
	const discordResponse = await sendHook()
	// Try to preimptively ratelimit if needed
	try {
		const rateLimitRemaining = discordResponse.headers.get('X-RateLimit-Remaining')
		if (rateLimitRemaining && parseInt(rateLimitRemaining) <= 0) {
			const rateLimitResetAfter = discordResponse.headers.get('X-RateLimit-Reset-After')
			if (rateLimitResetAfter) {
				const resetAfter = parseInt(rateLimitResetAfter)
				if (resetAfter > 0) {
					console.log(`Ratelimited! Sleeping for ${resetAfter} seconds...`)
					ctx.waitUntil(logtail({
						env, msg: `Ratelimited! Sleeping for ${resetAfter} seconds...`,
						level: LogLevel.Info,
						data: {
							discordResponseHeaders: {
								'X-RateLimit-Limit': discordResponse.headers.get('X-RateLimit-Limit'),
								'X-RateLimit-Remaining': discordResponse.headers.get('X-RateLimit-Remaining'),
								'X-RateLimit-Reset': discordResponse.headers.get('X-RateLimit-Reset'),
								'X-RateLimit-Reset-After': discordResponse.headers.get('X-RateLimit-Reset-After'),
								'X-RateLimit-Bucket': discordResponse.headers.get('X-RateLimit-Bucket'),
							}
						}
					}))
					await sleep(resetAfter * 1000)
				}
			}
		}
	} catch (e) {
		if (e instanceof Error) {
			ctx.waitUntil(logtail({
				env, msg: `Failed to preimptively avoid ratelimits: ${e.message}`,
				level: LogLevel.Error,
				data: {
					error: {
						message: e.message,
						stack: e.stack
					}
				}
			}))
		}
	}
	// Log all headers:
	console.log('X-RateLimit-Limit', discordResponse.headers.get('X-RateLimit-Limit'))
	console.log('X-RateLimit-Remaining', discordResponse.headers.get('X-RateLimit-Remaining'))
	console.log('X-RateLimit-Reset', discordResponse.headers.get('X-RateLimit-Reset'))
	console.log('X-RateLimit-Reset-After', discordResponse.headers.get('X-RateLimit-Reset-After'))
	console.log('X-RateLimit-Bucket', discordResponse.headers.get('X-RateLimit-Bucket'))

	if (!discordResponse.ok) {
		console.log("Discord Webhook Failed")
		console.log(
			`Discord Response: ${discordResponse.status} ${discordResponse.statusText}`
		)
		if (discordResponse.status === 429) {
			const body = await discordResponse.json() as { retry_after: number | undefined }
			console.log(body)
			ctx.waitUntil(logtail({
				env, msg: JSON.stringify(body),
				level: LogLevel.Error,
				data: {
					discordHook: hook,
					discordResponse: body
				}
			}))
			if (body.retry_after) {
				console.log('sleeping...')
				await sleep(body.retry_after * 1000)
				// retry and give up if it fails again
				const retryResponse = await sendHook()
				if (!retryResponse.ok) {
					ctx.waitUntil(logtail({
						env, msg: `Failed after 1 retry, giving up: ${JSON.stringify(body)}`,
						level: LogLevel.Error,
						data: {
							discordHook: hook,
							discordResponse: body
						}
					}))
				}
			}
		} else if (discordResponse.status === 400) {
			const body = await discordResponse.json() as any
			console.log(body)
			let logged = false
			if (Array.isArray(body.embeds)) {
				for (const embed of body.embeds) {
					try {
						const idx = parseInt(embed) // Index of bad embed
						console.log(`Bad embed at index ${idx}`)
						console.log(embeds[idx])
						ctx.waitUntil(logtail({
							env, msg: `Bad embed at index ${idx} - ` + JSON.stringify(body),
							level: LogLevel.Error,
							data: {
								discordHook: hook,
								embed: embeds[idx],
								discordResponse: body
							}
						}))
						logged = true
					} catch {
						console.log('unable to parse embed index')
					}
				}
			}
			if (!logged) {
				ctx.waitUntil(logtail({
					env, msg: JSON.stringify(body),
					level: LogLevel.Error,
					data: {
						discordHook: hook,
						discordResponse: body
					}
				}))
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
