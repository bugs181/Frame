'use strict'

import log from './logger'
import { destructure, assignObject, setDescriptor } from './helpers'
import { processFlow } from './flow'

// Blueprint Methods
const BlueprintMethods = {
  to: function(target) {
    return addPipe.call(this, 'to', target, Array.from(arguments).slice(1))
  },

  from: function(target) {
    return addPipe.call(this, 'from', target, Array.from(arguments).slice(1))
  },

  out: function(index, data) {
    log(this.name + '.out:', data, arguments)
    queue(nextPipe, this, [index, null, data])
  },

  error: function(index, err) {
    queue(nextPipe, this, [index, err])
  },

  get value() {
    // Bail if we're not ready. (Used to get out of ObjectModel and assignObject limbo)
    if (!this.Frame)
      return ''

    const blueprint = this
    const promiseForValue = new Promise(function(resolve, reject) {
      blueprint.Frame.isPromised = true
      blueprint.Frame.promise = { resolve: resolve, reject: reject }
    })
    return promiseForValue
  },
}

// Flow Method helpers
function BlueprintStub(target) {
  const blueprint = {}
  assignObject(blueprint, BlueprintMethods)

  blueprint.stub = true
  blueprint.Frame = {
    parents: [],
    describe: [],
  }

  if (typeof target === 'function') {
    setDescriptor(blueprint, 'Function')
    blueprint.in = target
    blueprint.on = target
  } else {
    setDescriptor(blueprint, 'Primitive')
    blueprint.in = function primitiveWrapper() {
      log(this.name + '.in:', target)
      this.out(target)
    }
    blueprint.on = function primitiveWrapper() {
      log(this.name + '.on:', target)
      this.out(target)
    }
  }

  return blueprint
}

function debounce(func, wait, blueprint, args) {
  const name = func.name
  clearTimeout(blueprint.Frame.debounce[name])
  blueprint.Frame.debounce[name] = setTimeout(function() {
    delete blueprint.Frame.debounce[name]
    func.apply(blueprint, args)
  }, wait)
}

function queue(func, blueprint, args) {
  if (!blueprint.Frame.queue)
    blueprint.Frame.queue = []

  blueprint.Frame.queue.push(setTimeout(function() {
    // TODO: Cleanup queue
    func.apply(blueprint, args)
  }, 1))
}

function factory(fn) {
  return function() {
    return fn.apply(this, arguments)
  }
}

// Pipe control
function addPipe(direction, target, params) {
  if (!this)
    throw new Error('Blueprint method called without instance, did you assign the method to a variable?')

  if (!this.Frame || !this.Frame.pipes)
    throw new Error('Not working with a valid Blueprint object')

  if (!target)
    throw new Error(this.Frame.name + '.' + direction + '() was called with improper parameters')

  if (typeof target === 'function' && typeof target.to !== 'function') {
    target = BlueprintStub(target)
  } else if (typeof target !== 'function') {
    target = BlueprintStub(target)
  }

  // Ensure we're working on a new instance of worker blueprint
  let blueprint = this
  if (!blueprint.Frame.instance) {
    blueprint = blueprint()
    blueprint.Frame.instance = true
  }

  log(blueprint.name + '.' + direction + '(): ' + target.name)
  blueprint.Frame.pipes.push({ direction: direction, target: target, params: params })

  // Used when target blueprint is part of another flow
  if (target && target.Frame)
    target.Frame.parents.push({ target: blueprint, hasCalled: false }) // TODO: Check if worker blueprint is already added.

  debounce(processFlow, 1, blueprint)
  return blueprint
}

function nextPipe(index, err, data) {
  console.log('next:', index)
  if (err) {
    log.error('TODO: handle error:', err)
    this.Frame.processingFlow = false
    return
  }

  const flow = this.Frame.flow
  const next = flow[index]

  // If we're at the end of the flow
  if (!next || !next.target) {
    this.Frame.processingFlow = false

    if (this.Frame.isPromised) {
      this.Frame.promise.resolve(data)
      this.Frame.isPromised = false
    }

    // If blueprint is part of another flow
    const parents = this.Frame.parents
    if (parents.length > 0) {
      for (const parent of parents) {
        let blueprint = parent.target
        log('Calling parent ' + blueprint.name, 'for', this.name)
        log('Data:', data)
        queue(nextPipe, blueprint, [0, null, data])
      }
    }

    return log('End of flow for', this.name, 'at', index)
  }

  callNext(next, data)
}

function callNext(next, data) {
  const blueprint = next.target
  const props = destructure(blueprint.Frame.describe.in, next.params)
  const context = next.context
  const retValue = blueprint.in.call(context, data, props, new factory(pipeCallback).bind(context))
  const retType = typeof retValue

  // Blueprint.in does not return anything
  if (retType === 'undefined')
    return

  if (retType === 'object' && retValue instanceof Promise) {
    // Handle promises
    retValue.then(context.out).catch(context.error)
  } else if (retType === 'object' && retValue instanceof Error) {
    // Handle errors
    context.error(retValue)
  } else {
    // Handle regular primitives and objects
    context.out(retValue)
  }
}

function pipeCallback(err, data) {
  if (err)
    return this.error(err)

  return this.out(data)
}

export default BlueprintMethods
export { BlueprintMethods, debounce, processFlow }
