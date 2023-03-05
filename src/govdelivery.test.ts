import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { getGovDeliveryID } from './govdelivery'

describe('govdelivery', () => {

  beforeAll(async () => {

  })

  afterAll(async () => {
  })

  describe('getGovDeliveryID()', async () => {
    describe('should return TXDOT', async () => {
      const cases = [
        'https://public.govdelivery.com/accounts/TXDOT/subscriber/new?topic_id=sdfsdf',
        'http://public.govdelivery.com/accounts/TXDOT/subscriber/new?topic_id=sdfsdf', // http
        'https://public.govdelivery.com/accounts/TXDOT/bulletins/sasfd',
        'https://content.govdelivery.com/accounts/TXDOT/subscriber/asdf?topic_id=sdfsdf',
        'https://content.govdelivery.com/accounts/TXDOT/bulletins/aasdff',
        'https://updates.loc.gov/accounts/TXDOT/bulletins/aasdff',
        'https://admin.govdelivery.com/attachments/fancy_images/TXDOT/2014/12/409029/usfsis-footer-blue-logo_original.jpg',
        'http://public.govdelivery.com/accounts/TXDOT/subscribers/new?preferences=true',

        // msc from Sentry
        'https://content.govdelivery.com/accounts/TXDOT/bulletins/34cb08e',
      ]
      function padCase(c: string): string {
        return `sdflkjsdflksdhjfgsdg\nsdflkjsdflksdhjfgsdg${c}sdflkjsdflksdhjfgsdg\nsdflkjsdflksdhjfgsdg`
      }
      for (const nextCase of cases) {
        it(nextCase, async () => {
          const c = padCase(nextCase)
          expect(getGovDeliveryID(c)).toBe('TXDOT')
        })
      }
    })
  })
})
