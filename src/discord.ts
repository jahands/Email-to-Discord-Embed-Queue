// @ts-ignore no @types :(
import PostalMime from "postal-mime"
import { DISCORD_EMBED_LIMIT, DISCORD_TOTAL_LIMIT } from "./constants"
import { EmbedQueueData, Env } from './types'
import { getAuthHeader, sleep } from "./utils"

/** Sends multiple embeds with no .txt fallback */
export async function sendDiscordEmbeds(messages: EmbedQueueData[], discordHook: string, env: Env, ctx: ExecutionContext) {
	let nextSize = 0 // max = DISCORD_TOTAL_LIMIT
	let embeds = []
	for (const message of messages) {
		const rawEmail = await env.R2EMAILS.get(message.r2path)
		if (!rawEmail) {
			throw new Error('Unable to get raw email from R2!!')
		}
		const arrayBuffer = await rawEmail.arrayBuffer()
		const parser = new PostalMime()
		const email = await parser.parse(arrayBuffer)
		const embed = createEmbedBody(email.text, message.subject, message.to, message.from)
		if (nextSize + embed.size < DISCORD_TOTAL_LIMIT) {
			embeds.push(embed.embed)
			nextSize += embed.size
		} else {
			// Send using the first message as the from. Hopefully messages are separated
			// before it makes it to sendDiscordEmbeds()
			await sendHookWithEmbeds(env, discordHook, embeds)
			nextSize = 0
			embeds = []
		}
	}
	if (embeds.length > 0) {
		await sendHookWithEmbeds(env, discordHook, embeds)
	}
}

async function sendHookWithEmbeds(env: Env, hook: string, embeds: any[]) {
	// Send the embeds
	const embedBody = JSON.stringify({ embeds })
	const formData = new FormData()
	formData.append("payload_json", embedBody)
	const sendHook = async () => fetch(hook, {
		method: "POST",
		body: formData,
		headers: getAuthHeader(env)
	})
	const discordResponse = await sendHook()
	if (!discordResponse.ok) {
		console.log("Discord Webhook Failed")
		console.log(
			`Discord Response: ${discordResponse.status} ${discordResponse.statusText}`
		)
		if (discordResponse.status === 429) {
			const body = await discordResponse.json() as { retry_after: number | undefined }
			console.log(body)
			if (body.retry_after) {
				console.log('sleeping...')
				await sleep(body.retry_after * 1000)
				// retry and giveup if it fails again
				await sendHook()
			}
		}
	}
}

function createEmbedBody(emailText: string, subject: string, to: string, from: string) {
	const embed = {
		title: `${subject}`,
		description:
			emailText.length > DISCORD_EMBED_LIMIT
				? `${emailText.substring(
					0,
					DISCORD_EMBED_LIMIT - 12
				)}...(TRIMMED)`
				: emailText,
		author: {
			name: from,
		},
		footer: {
			text: `This email was sent to ${to}`,
		},
	}
	const size = embed.title.length +
		embed.description.length +
		embed.author.name.length +
		embed.footer.text.length
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
