import { shuffleArray } from '@jahands/msc-utils';
import { Batch, getDiscordEmbedBatches, sendDiscordBatch } from './discord';
import { initGovDeliveryStats, recordGovDeliveryStats } from './govdelivery';
import { logtail, LogLevel } from './logtail';
import { EmbedQueueData, Env } from './types'
import { getDiscordWebhook, initRateLimiter, initSentry } from './utils';

export default {
	async queue(batch: MessageBatch<EmbedQueueData>, env: Env, ctx: ExecutionContext) {
		const sentry = initSentry(env, ctx)
		initGovDeliveryStats()
		initRateLimiter()

		try {
			sentry.setExtra('batch.messages.length', batch.messages.length)

			console.log(`Processing ${batch.messages.length} messages...`)
			const batches: Batch[] = []

			// Different webhooks for different senders, so we need to group by webhook
			const messagesByWebhook = {} as Record<string, { data: Message<EmbedQueueData>[], name: string }>
			// const hookNames = new Map<string, number>()
			for (const msg of batch.messages) {
				const { hook, name } = await getDiscordWebhook(msg.body, env)
				if (!messagesByWebhook[hook]) {
					messagesByWebhook[hook] = { data: [], name }
				}
				messagesByWebhook[hook].data.push(msg)
				// hookNames.set(hook, (hookNames.get(hook) || 0) + 1)
			}

			// Send embeds to discord
			for (const webhook of Object.keys(messagesByWebhook)) {
				// await sendDiscordEmbeds(
				// 	messagesByWebhook[webhook].data.map(m => m.body),
				// 	webhook,
				// 	messagesByWebhook[webhook].name,
				// 	env, ctx)

				// For now, just log the new batches
				const newBatches = await getDiscordEmbedBatches(
					messagesByWebhook[webhook].data,
					webhook,
					messagesByWebhook[webhook].name,
					env, ctx)
				batches.push(...newBatches)
			}
			// logtail({
			// 	env, ctx, msg: 'New batches created', data: {
			// 		batches
			// 	}, level: LogLevel.Debug, useSentry: false
			// })

			// Hopefully this will help with rate limits
			shuffleArray(batches)

			interface Stat {
				totalEmbeds: number
				totalAPICalls: number
				totalSize: number
			}
			interface StatsByHook {
				[hook: string]: Stat
			}
			const statsByHook: StatsByHook = {}
			for (const batch of batches) {
				try {
					await sendDiscordBatch(batch, env, ctx)
					if (!statsByHook[batch.hookName]) {
						statsByHook[batch.hookName] = {
							totalEmbeds: 0,
							totalAPICalls: 0,
							totalSize: 0,
						}
					}
					statsByHook[batch.hookName].totalAPICalls++ // each discord batch is 1 api call to discord
					statsByHook[batch.hookName].totalEmbeds += batch.embeds.length
					statsByHook[batch.hookName].totalSize += batch.size
				} catch (e) {
					if (e instanceof Error) {
						logtail({
							env, ctx, e, msg: 'Failed to send discord batch: ' + e.message,
							level: LogLevel.Error,
						})
					}
				}
			}

			// Write to AE
			// logtail({
			// 	env, ctx, msg: 'Writing Discord stats to AE', data: { statsByHook },
			// 	useSentry: false, level: LogLevel.Debug
			// })
			for (const hookName of Object.keys(statsByHook)) {
				const stat = statsByHook[hookName]
				try {
					env.EMBEDSTATS.writeDataPoint({
						blobs: [hookName],
						doubles: [stat.totalEmbeds, stat.totalSize, stat.totalAPICalls],
						indexes: [hookName]
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

		} catch (e) {
			if (e instanceof Error) {
				logtail({
					env, ctx, e, msg: 'Failed while processing Queues batch: ' + e.message,
					level: LogLevel.Error,
				})
			}
		}

		recordGovDeliveryStats(env, ctx)
	},
};
