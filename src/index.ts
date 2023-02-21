import { sendDiscordEmbeds } from './discord';
import { EmbedQueueData, Env } from './types'
import { getDiscordWebhook } from './utils';

export default {
	async queue(batch: MessageBatch<EmbedQueueData>, env: Env, ctx: ExecutionContext) {
		console.log(`Processing ${batch.messages.length} messages...`)
		// Different webhooks for different senders, so we need to group by webhook
		const messages = batch.messages.map((m) => m.body)
		const messagesByWebhook = {} as Record<string, { data: EmbedQueueData[], name: string }>
		const hookNames = new Map<string, number>()
		for (const msg of messages) {
			const { hook, name } = await getDiscordWebhook(msg.from, env)
			if (!messagesByWebhook[hook]) {
				messagesByWebhook[hook] = { data: [], name }
			}
			messagesByWebhook[hook].data.push(msg)
			hookNames.set(hook, (hookNames.get(hook) || 0) + 1)
		}

		// Send embeds to discord
		for (const webhook of Object.keys(messagesByWebhook)) {
			await sendDiscordEmbeds(
				messagesByWebhook[webhook].data,
				webhook,
				messagesByWebhook[webhook].name,
				env, ctx)
		}
	},
};
