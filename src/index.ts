import { sendDiscordEmbeds } from './discord';
import { EmbedQueueData, Env } from './types'
import { getDiscordWebhook } from './utils';

export default {
	async queue(batch: MessageBatch<EmbedQueueData>, env: Env, ctx: ExecutionContext) {
		console.log(`Processing ${batch.messages.length} messages...`)
		// Different webhooks for different senders, so we need to group by webhook
		const messages = batch.messages.map((m) => m.body)
		const messagesByWebhook = {} as Record<string, EmbedQueueData[]>
		for (const m of messages) {
			const webhook = await getDiscordWebhook(m.from, env)
			if (!messagesByWebhook[webhook]) {
				messagesByWebhook[webhook] = []
			}
			messagesByWebhook[webhook].push(m)
		}
	
		for (const webhook of Object.keys(messagesByWebhook)) {
			await sendDiscordEmbeds(messagesByWebhook[webhook], webhook, env, ctx)
		}
	},
};
