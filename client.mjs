
import templates from './templates.mjs'
import * as utils from './utils.mjs'

const noBodyStatus = new Set([204, 304])
const assert = utils.assert

var theFetch = null
var useBrowserCache = false
var testArray = []
var baseUrl = ''
var testResults = {}

export var testUUIDs = {}

export function runTests (tests, myFetch, browserCache, base, chunkSize = 10) {
  theFetch = myFetch
  if (base !== undefined) baseUrl = base
  if (browserCache !== undefined) useBrowserCache = browserCache
  tests.forEach(testSet => {
    testSet.tests.forEach(test => {
      if (test.id === undefined) throw new Error('Missing test id')
      if (test.browser_only === true && !useBrowserCache === true) return
      if (test.browser_skip === true && useBrowserCache === true) return
      testArray.push(
        addTest(test.id, test.timeout, makeCacheTest(test))
      )
    })
  })
  // return Promise.all(testArray)
  return runSome(testArray, chunkSize)
}

export function getResults () {
  const ordered = {}
  Object.keys(testResults).sort().forEach(key => {
    ordered[key] = testResults[key]
  })
  return ordered
}

function runSome (tests, chunkSize) {
  return new Promise(function (resolve, reject) {
    var index = 0
    function next () {
      if (index < tests.length) {
        var these = tests.slice(index, index + chunkSize)
        index += chunkSize
        Promise.all(these).then(next)
      } else {
        resolve()
      }
    }
    next()
  })
}

function addTest (testId, timeout, testFunc) {
  var wrapper = new Promise(function (resolve, reject) {
    testFunc()
      .then(result => { // pass
        if (testId in testResults) throw new Error(`Duplicate test ${testId}`)
        testResults[testId] = true
        resolve()
      })
      .catch(err => { // fail
        if (testId in testResults) throw new Error(`Duplicate test ${testId}`)
        testResults[testId] = [(err.name || 'unknown'), err.message]
        resolve()
      })
  })
  return wrapper
}

function makeCacheTest (test) {
  return function () {
    var uuid = utils.token()
    testUUIDs[test.id] = uuid
    var requests = expandTemplates(test)
    var fetchFunctions = []
    for (let i = 0; i < requests.length; ++i) {
      fetchFunctions.push({
        code: function (idx) {
          var config = requests[idx]
          var url = makeTestUrl(uuid, config)
          var init = fetchInit(idx, config)
          if (test.dump === true) {
            console.log(`=== Client request ${idx}`)
            console.log(`    ${init.method} ${url}`)
            init.headers.forEach((hname, hvalue) => {
              console.log(`    ${hname}: ${hvalue}`)
            })
            console.log('')
            console.log(`init.body || ''`)
          }
          return theFetch(url, init)
            .then(makeCheckResponse(idx, config, test.dump))
            .then(makeCheckResponseBody(config, uuid, test.dump), function (reason) {
              throw reason
            })
        },
        pauseAfter: 'pause_after' in requests[i]
      })
    }
    var idx = 0
    function runNextStep () {
      if (fetchFunctions.length) {
        var nextFetchFunction = fetchFunctions.shift()
        if (nextFetchFunction.pauseAfter === true) {
          return nextFetchFunction.code(idx++)
            .then(pause)
            .then(runNextStep)
        } else {
          return nextFetchFunction.code(idx++)
            .then(runNextStep)
        }
      } else {
        return Promise.resolve()
      }
    }
    return putTestConfig(uuid, requests)
      .then(runNextStep)
      .then(() => {
        return getServerState(uuid)
      }).then(testState => {
        checkRequests(requests, testState)
        return Promise.resolve()
      })
  }
}

function expandTemplates (test) {
  var rawRequests = test.requests
  var requests = []
  for (let i = 0; i < rawRequests.length; i++) {
    var request = rawRequests[i]
    request.name = test.name
    request.id = test.id
    if ('template' in request) {
      var template = templates[request['template']]
      for (let member in template) {
        if (!request.hasOwnProperty(member)) {
          request[member] = template[member]
        }
      }
    }
    requests.push(request)
  }
  return requests
}

function fetchInit (idx, config) {
  var init = {
    'headers': []
  }
  if (!useBrowserCache) {
    init.cache = 'no-store'
    init.headers.push(['Pragma', 'foo']) // dirty hack for Fetch
    init.headers.push(['Cache-Control', 'nothing-to-see-here']) // ditto
  }
  if ('request_method' in config) init.method = config['request_method']
  if ('request_headers' in config) init.headers = config['request_headers']
  if ('name' in config) init.headers.push(['Test-Name', config.name])
  if ('request_body' in config) init.body = config['request_body']
  if ('mode' in config) init.mode = config['mode']
  if ('credentials' in config) init.mode = config['credentials']
  if ('cache' in config) init.cache = config['cache']
  init.headers.push(['Test-ID', config.id])
  init.headers.push(['Req-Num', (idx + 1).toString()])
  return init
}

function makeCheckResponse (idx, config, dump) {
  return function checkResponse (response) {
    var reqNum = idx + 1
    var resNum = parseInt(response.headers.get('Server-Request-Count'))
    if (dump === true) {
      console.log(`=== Client response ${resNum}`)
      console.log(`    ${response.status} ${response.statusText}`)
      response.headers.forEach((hvalue, hname) => { // for some reason, node-fetch reverses these
        console.log(`    ${hname}: ${hvalue}`)
      })
      console.log('')
    }
    if ('expected_type' in config) {
      var typeSetup = setupCheck(config, 'expected_type')
      if (config.expected_type === 'cached') {
        if (response.status === 304 && isNaN(resNum)) { // some caches will not include the hdr
          // pass
        } else {
          assert(typeSetup, resNum < reqNum, `Response ${reqNum} does not come from cache`)
        }
      }
      if (config.expected_type === 'not_cached') {
        assert(typeSetup, resNum === reqNum, `Response ${reqNum} comes from cache`)
      }
    }
    //  browsers seem to squelch 304 even in no-store mode.
    //    if (!useBrowserCache && 'expected_type' in config && config.expected_type.endsWith('validated')) {
    //      config.expected_status = 304
    //    }
    if ('expected_status' in config) {
      assert(setupCheck(config, 'expected_status'),
        response.status === config.expected_status,
        `Response ${reqNum} status is ${response.status}, not ${config.expected_status}`)
    } else if ('response_status' in config) {
      assert(true, // response status is always setup
        response.status === config.response_status[0],
        `Response ${reqNum} status is ${response.status}, not ${config.response_status[0]}`)
    } else if (response.status === 999) {
      // special condition; the server thought it should have received a conditional request.
      assert(setupCheck(config, 'expected_type'), false,
        `Request ${reqNum} should have been conditional, but it was not.`)
    } else {
      assert(true, // default status is always setup
        response.status === 200,
        `Response ${reqNum} status is ${response.status}, not 200`)
    }
    if ('response_headers' in config) {
      config.response_headers.forEach(header => {
        if (header.len < 3 || header[2] === true) {
          assert(true, // default headers is always setup
            response.headers.get(header[0]) === header[1],
            `Response ${reqNum} header ${header[0]} is "${response.headers.get(header[0])}", not "${header[1]}"`)
        }
      })
    }
    if ('expected_response_headers' in config) {
      var respPresentSetup = setupCheck(config, 'expected_response_headers')
      config.expected_response_headers.forEach(header => {
        if (typeof header === 'string') {
          assert(respPresentSetup, response.headers.has(header),
            `Response ${reqNum} ${header} header not present.`)
        } else if (typeof header[1] === 'function') {
          var prefix = `Response ${reqNum} header ${header[0]}`
          header[1](respPresentSetup, assert, prefix, response.headers.get(header[0]), response)
        } else {
          assert(respPresentSetup, response.headers.get(header[0]) === header[1],
            `Response ${reqNum} header ${header[0]} is "${response.headers.get(header[0])}", not "${header[1]}"`)
        }
      })
    }
    if ('expected_response_headers_missing' in config) {
      var respMissingSetup = setupCheck(config, 'expected_response_headers_missing')
      config.expected_response_headers_missing.forEach(header => {
        assert(respMissingSetup, !response.headers.has(header),
          `Response ${reqNum} includes unexpected header ${header}: "${response.headers.get(header)}"`)
      })
    }
    return response.text()
  }
}

function makeCheckResponseBody (config, uuid, dump) {
  return function checkResponseBody (resBody) {
    if (dump === true) {
      console.log(resBody)
      console.log('')
    }
    var statusCode = 200
    if ('expected_status' in config) {
      statusCode = config.expected_status
    } else if ('response_status' in config) {
      statusCode = config.response_status[0]
    }
    if ('expected_response_text' in config) {
      if (config.expected_response_text !== null) {
        assert(setupCheck(config, 'expected_response_text'),
          resBody === config.expected_response_text,
          `Response body is "${resBody}", not "${config.expected_response_text}"`)
      }
    } else if ('response_body' in config && config.response_body !== null) {
      assert(true, // response_body is always setup
        resBody === config.response_body,
        `Response body is "${resBody}", not "${config.response_body}"`)
    } else if (!noBodyStatus.has(statusCode) && config.request_method !== 'HEAD') {
      assert(true, // no_body is always setup
        resBody === uuid,
        `Response body is "${resBody}", not "${uuid}"`)
    }
  }
}

function checkRequests (requests, testState) {
  // compare a test's requests array against the server-side testState
  var testIdx = 0
  for (let i = 0; i < requests.length; ++i) {
    var expectedValidatingHeaders = []
    var config = requests[i]
    var serverRequest = testState[testIdx]
    var reqNum = i + 1
    if ('expected_type' in config) {
      var typeSetup = setupCheck(config, 'expected_type')
      if (config.expected_type === 'cached') continue // the server will not see the request
      if (config.expected_type === 'not_cached') {
        assert(typeSetup, serverRequest.request_num === reqNum, `Response ${reqNum} comes from cache (${serverRequest.request_num} on server)`)
      }
      if (config.expected_type === 'etag_validated') {
        expectedValidatingHeaders.push('if-none-match')
      }
      if (config.expected_type === 'lm_validated') {
        expectedValidatingHeaders.push('if-modified-since')
      }
    }
    testIdx++ // only increment for requests the server sees
    expectedValidatingHeaders.forEach(vhdr => {
      assert(typeSetup, typeof (serverRequest) !== 'undefined', `request ${reqNum} wasn't sent to server`)
      assert(typeSetup, serverRequest.request_headers.hasOwnProperty(vhdr),
        `request ${reqNum} doesn't have ${vhdr} header`)
    })
    if ('expected_request_headers' in config) {
      var reqPresentSetup = setupCheck(config, 'expected_request_headers')
      config.expected_request_headers.forEach(header => {
        if (typeof header === 'string') {
          var headerName = header.toLowerCase()
          assert(reqPresentSetup, serverRequest.request_headers.hasOwnProperty(headerName),
            `Request ${reqNum} ${header} header not present.`)
        } else {
          var reqValue = serverRequest.request_headers[header[0].toLowerCase()]
          assert(reqPresentSetup, reqValue === header[1],
            `Request ${reqNum} header ${header[0]} is "${reqValue}", not "${header[1]}"`)
        }
      })
    }
  }
}

function pause () {
  return new Promise(function (resolve, reject) {
    setTimeout(() => {
      return resolve()
    }, 3000)
  })
}

function makeTestUrl (uuid, config) {
  var extra = ''
  if ('filename' in config) {
    extra += `/${config.filename}`
  }
  if ('query_arg' in config) {
    extra += `?${config.query_arg}`
  }
  return `${baseUrl}/test/${uuid}${extra}`
}

function putTestConfig (uuid, requests) {
  var init = {
    'method': 'PUT',
    'headers': [['content-type', 'application/json']],
    'body': JSON.stringify(requests)
  }
  return theFetch(`${baseUrl}/config/${uuid}`, init)
    .then(response => {
      if (response.status !== 201) {
        throw new utils.SetupError({message: `PUT config resulted in ${response.status} ${response.statusText}`})
      }
    })
}

function getServerState (uuid) {
  return theFetch(`${baseUrl}/state/${uuid}`)
    .then(response => {
      if (response.status === 200) {
        return response.text()
      }
    }).then(text => {
      if (text === undefined) return []
      return JSON.parse(text)
    })
}

function setupCheck (config, memberName) {
  return config.setup === true || ('setup_tests' in config && config.setup_tests.indexOf(memberName) > -1)
}
