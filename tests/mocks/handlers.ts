import { http, HttpResponse } from 'msw'

// Default MSW handlers for external API mocking
export const handlers = [
  // Alby NWC mock
  http.post('https://api.getalby.com/*', () => {
    return HttpResponse.json({ success: true })
  }),

  // Veintiuno card designs mock
  http.get('https://veintiuno.lat/api/cards.json', () => {
    return HttpResponse.json([])
  }),
]
