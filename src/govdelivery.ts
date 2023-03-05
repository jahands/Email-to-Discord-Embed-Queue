import { LogLevel, logtail } from "./logtail";
import { Env } from "./types";

let govDeliveryStats: Map<string, number>
export function initGovDeliveryStats(): Map<string, number> {
  govDeliveryStats = new Map<string, number>()
  return govDeliveryStats
}

export function getGovDeliveryStats(): Map<string, number> {
  if (!govDeliveryStats) {
    govDeliveryStats = new Map<string, number>()
  }
  return govDeliveryStats
}

export function recordGovDeliveryStats(env: Env, ctx: ExecutionContext): void {
  const stats = getGovDeliveryStats()
  if (stats.size > 0) {
    let statsSent = 0
    for (const [id, count] of stats) {
      try {
        if (count > 0) {
          if (statsSent >= 18) { // 24 - 6 (how many channels we have)
            // We better stop or AE will refuse stats
            logtail({
              env, ctx, msg: 'Too many GovDelivery stats to send, stopping',
              level: LogLevel.Warning,
              data: {
                aeDataSet: 'govdelivery',
                stats,
              }
            })
            break
          }
          statsSent++
          env.GOVDELIVERY.writeDataPoint({
            blobs: [id],
            doubles: [count],
            indexes: [id]
          })
        }
      } catch (e) {
        if (e instanceof Error) {
          logtail({
            env, ctx, e, msg: 'Failed to write to AE: ' + e.message,
            level: LogLevel.Error,
            data: {
              aeDataSet: 'govdelivery',
              govID: id,
              govCount: count,
            }
          })
        }
      }
    }
  }
}

export function getGovDeliveryID(emailText: string): string {
  let id: string | undefined
  try {
    id = getGovDeliveryIDByAccount(emailText)
  } catch {
    id = getGovDeliveryIDByFancyImages(emailText)
  }

  if (!id) throw new Error('GovDelivery ID not found')
  return id.trim().toUpperCase()
}

function getGovDeliveryIDByAccount(emailText: string): string {
  const match = emailText.match(
    /https*:\/\/(((public|content)\.govdelivery\.com)|(updates\.loc\.gov))\/accounts\/[a-zA-Z_-]+\/(subscriber|subscribers|bulletins)\//g
  )
  if (!match || match.length === 0) throw new Error('GovDelivery ID not found (match)')

  const idWithPrefix = match[0].match(/\/accounts\/[a-zA-Z_-]+\//)
  if (!idWithPrefix || idWithPrefix.length === 0) throw new Error('GovDelivery ID not found (idWithPrefix)')

  let id: string | undefined
  try {
    id = idWithPrefix[0].split('/')[2].toUpperCase()
  } catch (e) {
    if (e instanceof Error) {
      throw new Error('GovDelivery ID not found (parse): ' + e.message)
    }
  }
  if (!id || id === '') throw new Error('GovDelivery ID not found (id)')
  return id.toUpperCase()
}

function getGovDeliveryIDByFancyImages(emailText: string): string {
  const match = emailText.match(/https*:\/\/((admin\.govdelivery\.com)|(updates\.loc\.gov))\/attachments\/fancy_images\/[a-zA-Z_-]+\//g)
  if (!match || match.length === 0) throw new Error('GovDelivery ID not found (match)')

  const idWithPrefix = match[0].match(/\/attachments\/fancy_images\/[a-zA-Z_-]+\//)
  if (!idWithPrefix || idWithPrefix.length === 0) throw new Error('GovDelivery ID not found (idWithPrefix)')

  let id: string | undefined
  try {
    id = idWithPrefix[0].split('/')[3].toUpperCase()
  } catch (e) {
    if (e instanceof Error) {
      throw new Error('GovDelivery ID not found (parse): ' + e.message)
    }
  }
  if (!id || id === '') throw new Error('GovDelivery ID not found (id)')
  return id.toUpperCase()
}
