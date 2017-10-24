const { describe, it, expect, fail, xit } = global

const Breadcrumb = require('../breadcrumb')

describe('base/breadcrumb', () => {
  describe('constructor', () => {
    xit('can handle bad input', () => fail('TODO'))
  })

  describe('BugsnagBreadcrumb.ensureBreadcrumb()', () => {
    it('sets type=manual when called with signature fn(name, message, metaData, timestamp*)', () => {
      expect(Breadcrumb.ensureBreadcrumb('artisan sourdough', {}).type).toBe('manual')
      expect(Breadcrumb.ensureBreadcrumb('artisan sourdough', {}).type).toBe('manual')
    })

    it('sets type=manual when called with signature fn(BugsnagBreadcrumb)', () => {
      const b = new Breadcrumb('aaa', 'bbb', {})
      expect(Breadcrumb.ensureBreadcrumb(b)).toBe(b)
    })
  })

  describe('toJSON()', () => {
    it('returns the correct data structure', () => {
      const d = (new Date()).toISOString()
      expect(new Breadcrumb('manual', 'artisan sourdough', {}, d).toJSON()).toEqual({
        type: 'manual',
        name: 'artisan sourdough',
        metaData: {},
        timestamp: d
      })
    })
  })
})
