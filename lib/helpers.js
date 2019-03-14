'use strict'

// Object helper functions
function assignObject(target, source) {
  for (let propertyName of Object.getOwnPropertyNames(source)) {
    if (propertyName === 'name')
      continue

    if (typeof source[propertyName] === 'object')
      if (Array.isArray(source[propertyName]))
        target[propertyName] = []
      else
        target[propertyName] = Object.create(source[propertyName], Object.getOwnPropertyDescriptors(source[propertyName]))
    else
      Object.defineProperty(
        target,
        propertyName,
        Object.getOwnPropertyDescriptor(source, propertyName)
      )
  }

  return target
}

function setDescriptor(target, value, configurable) {
  Object.defineProperty(target, 'toString', {
    enumerable: false,
    writable: false,
    configurable: true,
    value: function() {
      return (value) ? '[Frame: ' + value + ']' : '[Frame: Constructor]'
    },
  })

  Object.defineProperty(target, 'name', {
    enumerable: false,
    writable: false,
    configurable: (configurable) ? true : false,
    value: value,
  })
}

// Sanitize user input for parameter destructuring into 'props' object.
function createSanitizers(source, keys) {
  let target = {}

  // If no sanitizers exist, stub them so we don't run into issues with sanitize() later.
  if (!source)
    source = {}

  // Create stubs for Array of keys to sanitize. Example: ['init', 'in', etc]
  for (let key of keys) {
    target[key] = []
  }

  // Loop through source's keys
  for (let key of Object.keys(source)) {
    target[key] = []

    // We only support objects for now. Example { init: { 'someKey': 'someDescription' }}
    if (typeof source[key] !== 'object' || Array.isArray(source[key]))
      continue

    // TODO: Support arrays for type checking
    // Example: { init: 'someKey': ['some description', 'string'] }

    let propIndex = []
    for (let prop of Object.keys(source[key])) {
      propIndex.push({ name: prop, description: source[key][prop] })
    }

    target[key] = propIndex
  }

  return target
}

function sanitize(target, props) {
  props = (!props) ? [] : Array.from(props)

  if (!target)
    return props

  let sanitizedProps = {}
  let propIndex = 0

  // Loop through our target sanitizer keys, and assign the object's key to the value of the props input.
  for (let targetProp of target) {
    sanitizedProps[targetProp.name] = props[propIndex]
    propIndex++
  }

  // If we don't have a valid sanitizer; return props array instead. Exemple: ['prop1', 'prop2']
  if (propIndex === 0)
    return props

  // Example: { someKey: someValue, someOtherKey: someOtherValue }
  return sanitizedProps
}

export {
  assignObject,
  setDescriptor,
  createSanitizers,
  sanitize
}
