const { map, reduce, filter } = require('@bugsnag/core/lib/es-utils')
const MAX_LINE_LENGTH = 200
const MAX_SCRIPT_LENGTH = 500000

module.exports = {
  init: (client, doc = document, win = window) => {
    if (!client.config.trackInlineScripts) return

    const originalLocation = win.location.href
    let html = ''
    let DOMContentLoaded = false
    const getHtml = () => doc.documentElement.outerHTML

    // get whatever HTML exists at this point in time
    html = getHtml()
    const prev = doc.onreadystatechange
    // then update it when the DOM content has loaded
    doc.onreadystatechange = function () {
      // IE8 compatible alternative to document#DOMContentLoaded
      if (doc.readyState === 'interactive') {
        html = getHtml()
        DOMContentLoaded = true
      }
      if (typeof prev === 'function') prev.apply(this, arguments)
    }

    var _lastScript = null
    const updateLastScript = script => {
      _lastScript = script
    }

    const getCurrentScript = () => {
      var script = doc.currentScript || _lastScript
      if (!script && !DOMContentLoaded) {
        var scripts = doc.scripts || doc.getElementsByTagName('script')
        script = scripts[scripts.length - 1]
      }
      return script
    }

    const addSurroundingCode = lineNumber => {
      // get whatever html has rendered at this point
      if (!DOMContentLoaded || !html) html = getHtml()
      // simulate the raw html
      const htmlLines = [ '<!-- DOC START -->' ].concat(html.split('\n'))
      const zeroBasedLine = lineNumber - 1
      const start = Math.max(zeroBasedLine - 3, 0)
      const end = Math.min(zeroBasedLine + 3, htmlLines.length - 1)
      return reduce(htmlLines.slice(start, end), (accum, line, i) => {
        accum[i + lineNumber - 3] = line.length <= MAX_LINE_LENGTH ? line : line.substr(0, MAX_LINE_LENGTH)
        return accum
      }, {})
    }

    client.config.beforeSend.unshift(report => {
      // remove any of our own frames that may be part the stack this
      // happens before the inline script check as it happens for all errors
      report.stacktrace = filter(report.stacktrace, f => !(/__trace__$/.test(f.method)))

      const frame = report.stacktrace[0]

      // if frame.file exists and is not the original location of the page, this can't be an inline script
      if (frame && frame.file && frame.file.replace(/#.*$/, '') !== originalLocation.replace(/#.*$/, '')) return

      // grab the last script known to have run
      const currentScript = getCurrentScript()
      if (currentScript) {
        const content = currentScript.innerHTML
        report.updateMetaData(
          'script',
          'content',
          content.length <= MAX_SCRIPT_LENGTH ? content : content.substr(0, MAX_SCRIPT_LENGTH)
        )
      }

      // only attempt to grab some surrounding code if we have a line number
      if (frame === undefined || frame.lineNumber === undefined) return
      frame.code = addSurroundingCode(frame.lineNumber)
    })

    // Proxy all the timer functions whose callback is their 0th argument.
    // Keep a reference to the original setTimeout because we need it later
    const [ _setTimeout ] = map([
      'setTimeout',
      'setInterval',
      'setImmediate',
      'requestAnimationFrame'
    ], fn =>
      __proxy(win, fn, original =>
        __traceOriginalScript(original, args => ({
          get: () => args[0],
          replace: fn => { args[0] = fn }
        }))
      )
    )

    // Proxy all the host objects whose prototypes have an addEventListener function
    map([
      'EventTarget', 'Window', 'Node', 'ApplicationCache', 'AudioTrackList', 'ChannelMergerNode',
      'CryptoOperation', 'EventSource', 'FileReader', 'HTMLUnknownElement', 'IDBDatabase',
      'IDBRequest', 'IDBTransaction', 'KeyOperation', 'MediaController', 'MessagePort', 'ModalWindow',
      'Notification', 'SVGElementInstance', 'Screen', 'TextTrack', 'TextTrackCue', 'TextTrackList',
      'WebSocket', 'WebSocketWorker', 'Worker', 'XMLHttpRequest', 'XMLHttpRequestEventTarget', 'XMLHttpRequestUpload'
    ], o => {
      if (!win[o] || !win[o].prototype || typeof win[o].prototype.addEventListener !== 'function') return
      __proxy(win[o].prototype, 'addEventListener', original =>
        __traceOriginalScript(original, eventTargetCallbackAccessor)
      )
      __proxy(win[o].prototype, 'removeEventListener', original =>
        __traceOriginalScript(original, eventTargetCallbackAccessor)
      )
    })

    function __traceOriginalScript (fn, callbackAccessor) {
      return function () {
        var args = Array.prototype.slice.call(arguments)
        var cba = callbackAccessor(args)
        var cb = cba.get()
        if (typeof cb !== 'function') return fn.apply(this, args)
        try {
          if (cb.__trace__) {
            cba.replace(cb.__trace__)
          } else {
            var script = getCurrentScript()
            // this function mustn't be annonymous due to a bug in the stack
            // generation logic, meaning it gets tripped up
            // see: https://github.com/stacktracejs/stack-generator/issues/6
            cb.__trace__ = function __trace__ () {
              // set the script that called this function
              updateLastScript(script)
              // immediately unset the currentScript synchronously below, however
              // if this cb throws an error the line after will not get run so schedule
              // an almost-immediate aysnc update too
              _setTimeout(function () { updateLastScript(null) }, 0)
              const ret = cb.apply(this, arguments)
              updateLastScript(null)
              return ret
            }
            cb.__trace__.__trace__ = cb.__trace__
            cba.replace(cb.__trace__)
          }
        } catch (e) {
          // swallow these errors on Selenium:
          // Permission denied to access property '__trace__'
        }
        // IE8 doesn't let you call .apply() on setTimeout/setInterval
        if (fn.apply) return fn.apply(this, args)
        switch (args.length) {
          case 1: return fn(args[0])
          case 2: return fn(args[0], args[1])
          default: return fn()
        }
      }
    }
  },
  configSchema: {
    trackInlineScripts: {
      validate: value => value === true || value === false,
      defaultValue: () => true,
      message: 'should be true|false'
    }
  }
}

function __proxy (host, name, replacer) {
  var original = host[name]
  if (!original) return original
  var replacement = replacer(original)
  host[name] = replacement
  return original
}

function eventTargetCallbackAccessor (args) {
  var isEventHandlerObj = !!args[1] && typeof args[1].handleEvent === 'function'
  return {
    get: function () {
      return isEventHandlerObj ? args[1].handleEvent : args[1]
    },
    replace: function (fn) {
      if (isEventHandlerObj) {
        args[1].handleEvent = fn
      } else {
        args[1] = fn
      }
    }
  }
}
