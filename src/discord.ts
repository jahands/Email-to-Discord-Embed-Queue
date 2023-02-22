// @ts-ignore no @types :(
import PostalMime from "postal-mime"
import { convert as convertHTML } from 'html-to-text';
import { ThrottledQueue } from '@jahands/msc-utils'

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
			await sendHookWithEmbeds(env, discordHook, embeds)

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
		await sendHookWithEmbeds(env, discordHook, embeds)

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


const throttledQueue = new ThrottledQueue({ concurrency: 1, interval: 1000, limit: 1 });

async function sendHookWithEmbeds(env: Env, hook: string, embeds: any[]) {
	// Send the embeds
	const embedBody = JSON.stringify({ embeds })
	const formData = new FormData()
	formData.append("payload_json", embedBody)
	const sendHook = async () => {
		await throttledQueue.add(async () => { }) // Rate limit ourselves
		return fetch(hook, {
			method: "POST",
			body: formData,
			headers: getAuthHeader(env)
		})
	}
	const discordResponse = await sendHook()
	if (!discordResponse.ok) {
		console.log("Discord Webhook Failed")
		console.log(
			`Discord Response: ${discordResponse.status} ${discordResponse.statusText}`
		)
		if (discordResponse.status === 429) {
			const body = await discordResponse.json() as { retry_after: number | undefined }
			console.log(body)
			await logtail({
				env, msg: JSON.stringify(body),
				level: LogLevel.Error,
				data: {
					discordHook: hook,
					discordResponse: body
				}
			})
			if (body.retry_after) {
				console.log('sleeping...')
				await sleep(body.retry_after * 1000)
				// retry and giveup if it fails again
				await sendHook()
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
						await logtail({
							env, msg: `Bad embed at index ${idx} - ` + JSON.stringify(body),
							level: LogLevel.Error,
							data: {
								discordHook: hook,
								embed: embeds[idx],
								discordResponse: body
							}
						})
						logged = true
					} catch {
						console.log('unable to parse embed index')
					}
				}
			}
			if (!logged) {
				await logtail({
					env, msg: JSON.stringify(body),
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

/** Sends single embed with .txt fallback - currently unused, leaving here for reference */
// export async function sendDiscordEmbed(message: EmbedQueueData, env: Env, ctx: ExecutionContext) {
// 	const rawEmail = await env.R2EMAILS.get(message.r2path)
// 	if (!rawEmail) {
// 		throw new Error('Unable to get raw email from R2!!')
// 	}
// 	try {
// 		const arrayBuffer = await rawEmail.arrayBuffer()
// 		const parser = new PostalMime()
// 		const email = await parser.parse(arrayBuffer)
// 		const embedBody = JSON.stringify({
// 			embeds: [
// 				{
// 					title: `${message.subject}`,
// 					description:
// 						email.text.length > DISCORD_EMBED_LIMIT
// 							? `${email.text.substring(
// 								0,
// 								DISCORD_EMBED_LIMIT - 12
// 							)}...(TRIMMED)`
// 							: email.text,
// 					author: {
// 						name: message.from,
// 					},
// 					footer: {
// 						text: `This email was sent to ${message.to}`,
// 					},
// 				},
// 			],
// 		})
// 		const formData = new FormData()
// 		formData.append("payload_json", embedBody)
// 		if (email.text.length > DISCORD_EMBED_LIMIT) {
// 			const newTextBlob = new Blob([email.text], {
// 				type: "text/plain",
// 			})
// 			// If the text is too big, we need truncate the blob.
// 			if (newTextBlob.size < DISCORD_FILE_LIMIT) {
// 				formData.append("files[0]", newTextBlob, "email.txt")
// 			} else {
// 				formData.append(
// 					"files[0]",
// 					newTextBlob.slice(0, DISCORD_FILE_LIMIT, "text/plain"),
// 					"email-trimmed.txt"
// 				)
// 			}
// 		}
// 		const hook = await getDiscordWebhook(message.from, env)
// 		const discordResponse = await fetch(hook, {
// 			method: "POST",
// 			body: formData,
// 			headers: getAuthHeader(env)
// 		})
// 		if (!discordResponse.ok) {
// 			console.log("Discord Webhook Failed")
// 			console.log(
// 				`Discord Response: ${discordResponse.status} ${discordResponse.statusText}`
// 			)
// 			if (discordResponse.status === 429) {
// 				const body = await discordResponse.json() as { retry_after: number | undefined }
// 				console.log(body)
// 				if (body.retry_after) {
// 					console.log('sleeping...')
// 					await sleep(body.retry_after * 1000)
// 					// retry
// 					await fetch(await getDiscordWebhook(message.from, env), {
// 						method: "POST",
// 						body: formData,
// 						headers: getAuthHeader(env)
// 					})
// 				}
// 			}
// 		}
// 		// You probably will want to forward the mail anyway to an address, in case discord is down,
// 		// Or you could make it fail if the webhook fails, causing the sending mail server to error out.
// 		// Or you could do something more complex with adding it to a Queue and retrying sending to Discord, etc
// 		// For now, I don't really care about those conditions
// 	} catch (e) {
// 		console.log('error!', e)
// 	}
// }
