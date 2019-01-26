import * as utils from '../utils.mjs'

export default

{
  name: 'Other Caching Requirements',
  id: 'other',
  tests: [
    {
      name: 'HTTP cache must generate an Age header',
      id: 'other-age-gen',
      requests: [
        {
          response_headers: [
            ['Expires', 30 * 24 * 60 * 60],
            ['Date', 0]
          ],
          pause_after: true,
          setup: true
        },
        {
          expected_type: 'cached',
          expected_response_headers: [
            ['Age', function (s, assert, p, a) {
              assert(s, a !== undefined, `${p} isn't present`)
              assert(s, parseInt(a) > 2, `${p} is ${a}, should be bigger`)
            }]
          ]
        }
      ]
    },
    {
      name: 'HTTP cache must update the Age header (Expires)',
      id: 'other-age-update-expires',
      requests: [
        {
          response_headers: [
            ['Expires', 30 * 24 * 60 * 60],
            ['Date', 0],
            ['Age', '30']
          ],
          pause_after: true,
          setup: true
        },
        {
          expected_type: 'cached',
          expected_response_headers: [
            ['Age', function (s, assert, p, a) {
              assert(s, a !== undefined, `${p} isn't present`)
              assert(s, parseInt(a) > 32, `${p} is ${a}, should be bigger`)
            }]
          ]
        }
      ]
    },
    {
      name: 'HTTP cache must update the Age header (CC: max-age)',
      id: 'other-age-update-max-age',
      requests: [
        {
          response_headers: [
            ['Cache-Control', 'max-age=600'],
            ['Date', 0],
            ['Age', '30']
          ],
          pause_after: true,
          setup: true
        },
        {
          expected_type: 'cached',
          expected_response_headers: [
            ['Age', function (s, assert, p, a) {
              assert(s, a !== undefined, `${p} isn't present`)
              assert(s, parseInt(a) > 32, `${p} is ${a}, should be bigger`)
            }]
          ]
        }
      ]
    },
    {
      name: 'HTTP cache must not update the Date header',
      id: 'other-date-update',
      requests: [
        {
          response_headers: [
            ['Expires', 30 * 24 * 60 * 60],
            ['Date', 0]
          ],
          pause_after: true,
          setup: true
        },
        {
          expected_type: 'cached',
          expected_response_headers: [
            ['Date', function (s, assert, p, a, r) {
              assert(s, a === r.headers.get('Server-Now'), `${p} is ${a}, should be ${r.headers.get('Server-Now')}`)
            }]
          ]
        }
      ]
    },
    {
      name: 'Different query arguments must be different cache keys',
      id: 'query-args-different',
      requests: [
        {
          template: 'fresh',
          query_arg: 'test=' + utils.httpContent('query-args-different-1')
        },
        {
          query_arg: 'test=' + utils.httpContent('query-args-different-2'),
          expected_type: 'not_cached'
        }
      ]
    },
    {
      name: 'An optimal HTTP cache should not be affected by the presence of a URL query',
      id: 'query-args-same',
      kind: 'optimal',
      requests: [
        {
          template: 'fresh',
          query_arg: 'test=' + utils.httpContent('query-args-same')
        },
        {
          query_arg: 'test=' + utils.httpContent('query-args-same'),
          expected_type: 'cached'
        }
      ]
    },
    {
      name: 'An optimal HTTP cache reuses a fresh response with a Set-Cookie header',
      id: 'other-set-cookie',
      kind: 'optimal',
      requests: [
        {
          response_headers: [
            ['Cache-Control', 'max-age=3600'],
            ['Set-Cookie', 'a=b']
          ],
          setup: true
        },
        {
          expected_type: 'cached'
        }
      ]
    },
    {
      name: 'An optimal HTTP cache reuses a fresh response when the request has a Cookie header',
      id: 'other-cookie',
      kind: 'optimal',
      requests: [
        {
          response_headers: [
            ['Cache-Control', 'max-age=3600']
          ],
          setup: true
        },
        {
          request_headers: [
            ['Cookie', 'a=b']
          ],
          expected_type: 'cached'
        }
      ]
    }
  ]
}
