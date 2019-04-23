(function () {
  'use strict';

  function log() {
    // eslint-disable-next-line no-console
    console.log.apply(this, arguments);
  }

  log.error = function() {
    // eslint-disable-next-line no-console
    console.error.apply(this, arguments);
  };

  log.warn = function() {
    // eslint-disable-next-line no-console
    console.warn.apply(this, arguments);
  };

  log.debug = function() {
    console.log.apply(this, arguments);
  };

  // Universal export function depending on environment.
  // Alternatively, if this proves to be ineffective, different targets for rollup could be considered.
  function exporter(name, obj) {
    // Node.js & node-like environments (export as module)
    if (typeof module === 'object' && typeof module.exports === 'object')
      module.exports = obj;

    // Global export (also applied to Node + node-like environments)
    if (typeof global === 'object')
      global[name] = obj;

    // UMD
    else if (typeof define === 'function' && define.amd)
      define(['exports'], function(exp) {
        exp[name] = obj;
      });

    // Browsers and browser-like environments (Electron, Hybrid web apps, etc)
    else if (typeof window === 'object')
      window[name] = obj;
  }

  // Object helper functions
  function assignObject(target, source) {
    for (const propertyName of Object.getOwnPropertyNames(source)) {
      if (propertyName === 'name')
        continue

      if (typeof source[propertyName] === 'object')
        if (Array.isArray(source[propertyName]))
          target[propertyName] = [];
        else
          target[propertyName] = Object.create(source[propertyName], Object.getOwnPropertyDescriptors(source[propertyName]));
      else
        Object.defineProperty(
          target,
          propertyName,
          Object.getOwnPropertyDescriptor(source, propertyName)
        );
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
    });

    Object.defineProperty(target, 'name', {
      enumerable: false,
      writable: false,
      configurable: (configurable) ? true : false,
      value: value,
    });
  }

  // Destructure user input for parameter destructuring into 'props' object.
  function createDestructure(source, keys) {
    const target = {};

    // If no target exist, stub them so we don't run into issues later.
    if (!source)
      source = {};

    // Create stubs for Array of keys. Example: ['init', 'in', etc]
    for (const key of keys) {
      target[key] = [];
    }

    // Loop through source's keys
    for (const key of Object.keys(source)) {
      target[key] = [];

      // We only support objects for now. Example { init: { 'someKey': 'someDescription' }}
      if (typeof source[key] !== 'object' || Array.isArray(source[key]))
        continue

      // TODO: Support arrays for type checking
      // Example: { init: 'someKey': ['some description', 'string'] }

      const propIndex = [];
      for (const prop of Object.keys(source[key])) {
        propIndex.push({ name: prop, description: source[key][prop] });
      }

      target[key] = propIndex;
    }

    return target
  }

  function destructure(target, props) {
    const sourceProps = (!props) ? [] : Array.from(props);

    if (!target)
      return sourceProps

    const targetProps = {};
    let propIndex = 0;

    // Loop through our target keys, and assign the object's key to the value of the props input.
    for (const targetProp of target) {
      targetProps[targetProp.name] = sourceProps[propIndex];
      propIndex++;
    }

    // If we don't have a valid target; return props array instead. Example: ['prop1', 'prop2']
    if (propIndex === 0)
      return props

    // Example: { someKey: someValue, someOtherKey: someOtherValue }
    return targetProps
  }

  function processFlow() {
    // Already processing this Blueprint's flow.
    if (this.Frame.processingFlow)
      return

    // If no pipes for flow, then nothing to do.
    if (this.Frame.pipes.length < 1)
      return

    // Check that all blueprints are ready
    if (!flowsReady.call(this))
      return

    log.debug('Processing flow for ' + this.name);
    log.debug();
    this.Frame.processingFlow = true;

    // Put this blueprint at the beginning of the flow, that way any .from events trigger the top level first.
    this.Frame.pipes.unshift({ direction: 'to', target: this });

    // Break out event pipes and flow pipes into separate flows.
    let i = 1; // Start at 1, since our worker blueprint instance should be 0
    for (const pipe of this.Frame.pipes) {
      const blueprint = pipe.target;

      if (pipe.direction === 'from') {
        if (typeof blueprint.on !== 'function')
          throw new Error('Blueprint \'' + blueprint.name + '\' does not support events.')

        // Used when target blueprint is part of another flow
        if (blueprint && blueprint.Frame)
          blueprint.Frame.parents.push({ target: this }); // TODO: Check if worker blueprint is already added.

        // .from(Events) start the flow at index 0
        pipe.context = createContext(this, pipe.target, 0);
        this.Frame.events.push(pipe);

      } else if (pipe.direction === 'to') {
        if (typeof blueprint.in !== 'function')
          throw new Error('Blueprint \'' + blueprint.name + '\' does not support input.')

        pipe.context = createContext(this, pipe.target, i);
        this.Frame.flow.push(pipe);
        i++;
      }
    }

    startFlow.call(this);
  }

  function createContext(worker, blueprint, index) {
    return {
      name: blueprint.name,
      state: blueprint.Frame.state,
      out: blueprint.out.bind(worker, index),
      error: blueprint.error.bind(worker, index),
    }
  }

  function flowsReady() {
    // if blueprint has not been initialized yet (i.e. constructor not used.)
    if (!this.Frame.initialized) {
      initBlueprint.call(this, processFlow);
      return false
    }

    // Loop through all blueprints in flow to make sure they have been loaded and initialized.
    let flowsReady = true;
    for (const pipe of this.Frame.pipes) {
      const target = pipe.target;

      // Not a blueprint, either a function or primitive
      if (target.stub)
        continue

      if (!target.Frame.loaded) {
        flowsReady = false;
        continue
      }

      if (!target.Frame.initialized) {
        initBlueprint.call(target, processFlow.bind(this));
        flowsReady = false;
        continue
      }
    }

    return flowsReady
  }

  function startFlow() {
    log.debug('Starting flow for ' + this.name);

    for (const event of this.Frame.events) {
      const blueprint = event.target;
      const props = destructure(blueprint.Frame.describe.on, event.params);
      log.debug(blueprint.name, 'props', props);

      // If not already processing flow.
      if (blueprint.Frame.pipes && blueprint.Frame.pipes.length > 0)
        log.debug(this.name + ' is not starting ' + blueprint.name + ', waiting for it to finish');
      else if (!blueprint.Frame.processingFlow)
        blueprint.on.call(event.context, props);
    }
  }

  function initBlueprint(callback) {
    const blueprint = this;

    try {
      let props = blueprint.Frame.props ? blueprint.Frame.props : {};

      // If Blueprint foregoes the initializer, stub it.
      if (!blueprint.init)
        blueprint.init = function(_, done) {
          done();
        };

      props = destructure(blueprint.Frame.describe.init, props);
      blueprint.init.call(blueprint, props, function(err) {
        if (err)
          return log.error('Error initializing blueprint \'' + blueprint.name + '\'\n' + err)

        // Blueprint intitialzed
        log.debug('Blueprint ' + blueprint.name + ' intialized');

        blueprint.Frame.props = {};
        blueprint.Frame.initialized = true;
        blueprint.Frame.initializing = false;
        setTimeout(function() { callback && callback.call(blueprint); }, 1);
      });

    } catch (err) {
      throw new Error('Blueprint \'' + blueprint.name + '\' could not initialize.\n' + err)
    }
  }

  // Blueprint Methods
  const BlueprintMethods = {
    to: function(target) {
      return addPipe.call(this, 'to', target, Array.from(arguments).slice(1))
    },

    from: function(target) {
      return addPipe.call(this, 'from', target, Array.from(arguments).slice(1))
    },

    out: function(index, data) {
      log.debug('Worker ' + this.name + '.out:', data, arguments);
      queue(nextPipe, this, [index, null, data]);
    },

    error: function(index, err) {
      log.error('Worker ' + this.name + '.error:', err, arguments);
      queue(nextPipe, this, [index, err]);
    },

    get value() {
      // Bail if we're not ready. (Used to get out of ObjectModel and assignObject limbo)
      if (!this.Frame)
        return ''

      const blueprint = this;
      const promiseForValue = new Promise(function(resolve, reject) {
        blueprint.Frame.isPromised = true;
        blueprint.Frame.promise = { resolve: resolve, reject: reject };
      });
      return promiseForValue
    },

    //catch: function(callback){ ... }
  };

  // Flow Method helpers
  function BlueprintStub(target) {
    const blueprint = {};
    assignObject(blueprint, BlueprintMethods);

    blueprint.stub = true;
    blueprint.Frame = {
      parents: [],
      describe: [],
    };

    if (typeof target === 'function') {
      setDescriptor(blueprint, 'Function');
      blueprint.in = target;
      blueprint.on = target;
    } else {
      setDescriptor(blueprint, 'Primitive');
      blueprint.in = function primitiveWrapper() {
        log.debug(this.name + '.in:', target);
        this.out(target);
      };
      blueprint.on = function primitiveWrapper() {
        log.debug(this.name + '.on:', target);
        this.out(target);
      };
    }

    return blueprint
  }

  function debounce(func, wait, blueprint, args) {
    const name = func.name;
    clearTimeout(blueprint.Frame.debounce[name]);
    blueprint.Frame.debounce[name] = setTimeout(function() {
      delete blueprint.Frame.debounce[name];
      func.apply(blueprint, args);
    }, wait);
  }

  function queue(func, blueprint, args) {
    if (!blueprint.Frame.queue)
      blueprint.Frame.queue = [];

    // Queue array is primarily for IDE.
    let queuePosition = blueprint.Frame.queue.length;
    blueprint.Frame.queue.push(setTimeout(function() {
      // TODO: Cleanup queue
      func.apply(blueprint, args);
    }, 1));
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
      target = BlueprintStub(target);
    } else if (typeof target !== 'function') {
      target = BlueprintStub(target);
    }

    // Ensure we're working on a new instance of worker blueprint
    let blueprint = this;
    if (!blueprint.Frame.instance) {
      log.debug('Creating new instance for', blueprint.name);
      blueprint = blueprint(Array.from(blueprint.Frame.props)[0]);
      blueprint.Frame.state = this.Frame.state; // TODO: Should create a new state object?
      blueprint.Frame.instance = true;
    }

    log.debug(blueprint.name + '.' + direction + '(): ' + target.name);
    blueprint.Frame.pipes.push({ direction: direction, target: target, params: params });

    debounce(processFlow, 1, blueprint);
    return blueprint
  }

  function nextPipe(index, err, data) {
    log.debug('next:', index);

    const flow = this.Frame.flow;
    const next = flow[index];

    if (err) {
      if (!next || !next.target)
        return log.debug('No error handler')

      if (next.target.name === 'Error') {
        next.context.handleError = true;
        data = err;
      } else {
        index++;
        return nextPipe.call(this, index, err)
      }
    }

    // If we're at the end of the flow
    if (!next || !next.target) {
      this.Frame.processingFlow = false;

      if (this.Frame.isPromised) {
        this.Frame.promise.resolve(data);
        this.Frame.isPromised = false;
      }

      // If blueprint is part of another flow
      const parents = this.Frame.parents;
      if (parents.length > 0) {
        for (const parent of parents) {
          let blueprint = parent.target;
          log.debug('Calling parent ' + blueprint.name, 'for', this.name);
          queue(nextPipe, blueprint, [0, null, data]);
        }
      }

      return log.debug('End of flow for', this.name, 'at', index)
    }

    callNext(next, data);
  }

  function callNext(next, data) {
    const blueprint = next.target;
    const props = destructure(blueprint.Frame.describe.in, next.params);
    const context = next.context;
    const retValue = blueprint.in.call(context, data, props, new factory(pipeCallback).bind(context));
    const retType = typeof retValue;

    // Blueprint.in does not return anything
    if (retType === 'undefined')
      return

    if (retType === 'object' && retValue instanceof Promise) {
      // Handle promises
      retValue.then(context.out).catch(context.error);
    } else if (retType === 'object' && retValue instanceof Error) {
      // Handle errors
      context.error(retValue);
    } else {
      // Handle regular primitives and objects
      context.out(retValue);
    }
  }

  function pipeCallback(err, data) {
    if (err)
      return this.error(err)

    return this.out(data)
  }

  // Internal Frame props
  const BlueprintBase = {
    name: '',
    describe: ['init', 'in', 'out'], // TODO: Change to object and make separate schema. { init: { name: '', description: ' } }
    props: {},
    state: {},

    loaded: false,
    initialized: false,
    processingFlow: false,
    instance: false,

    debounce: {},
    queue: [],
    parents: [],

    pipes: [], //[FlowSchema],
    events: [], //[FlowSchema],
    flow: [], //[FlowSchema],

    isPromised: false,
    promise: {},
  };

  // Concept based on: http://objectmodel.js.org/
  function ObjectModel(schemaObj) {
    if (typeof schemaObj === 'function') {
      return { type: schemaObj.name, expects: schemaObj }
    } else if (typeof schemaObj !== 'object')
      schemaObj = {};

    // Clone schema object so we don't mutate it.
    const schema = Object.create(schemaObj);
    Object.assign(schema, schemaObj);

    // Loop through Schema object keys
    for (const key of Object.keys(schema)) {
      // Create a schema object with types
      if (typeof schema[key] === 'function')
        schema[key] = { required: true, type: typeof schema[key]() };
      else if (typeof schema[key] === 'object' && Array.isArray(schema[key])) {
        const schemaArr = schema[key];
        schema[key] = { required: false, type: 'optional', types: [] };
        for (const schemaType of schemaArr) {
          if (typeof schemaType === 'function')
            schema[key].types.push(typeof schemaType());
        }
      } else if (typeof schema[key] === 'object' && schema[key].type) {
        schema[key] = { required: true, type: schema[key].type, expects: schema[key].expects };
      } else {
        schema[key] = { required: true, type: typeof schema[key] };
      }
    }

    // Validate schema props
    function isValidSchema(key, value) {
      // TODO: Make more flexible by defining null and undefined types.
      // No schema defined for key
      if (!schema[key])
        return true

      if (schema[key].required && typeof value === schema[key].type) {
        return true
      } else if (!schema[key].required && schema[key].type === 'optional') {
        if (value && !schema[key].types.includes(typeof value))
          return false

        return true
      } else if (schema[key].required && schema[key].type) {
        if (typeof schema[key].expects === 'function') {
          return schema[key].expects(value)
        }
      }

      return false
    }

    // Validate schema (once Schema constructor is called)
    return function validateSchema(objToValidate) {
      const proxyObj = {};
      const obj = objToValidate;

      for (const key of Object.getOwnPropertyNames(objToValidate)) {
        const propDescriptor = Object.getOwnPropertyDescriptor(objToValidate, key);

        // Property already protected
        if (!propDescriptor.writable || !propDescriptor.configurable) {
          Object.defineProperty(obj, key, propDescriptor);
          continue
        }

        // Schema does not exist for prop, passthrough
        if (!schema[key]) {
          Object.defineProperty(obj, key, propDescriptor);
          continue
        }

        proxyObj[key] = objToValidate[key];
        Object.defineProperty(obj, key, {
          enumerable: propDescriptor.enumerable,
          configurable: propDescriptor.configurable,
          get: function() {
            return proxyObj[key]
          },

          set: function(value) {
            if (!isValidSchema(key, value)) {
              if (schema[key].expects) {
                value = (typeof value === 'string') ? value : typeof value;
                throw new Error('Expecting "' + key + '" to be "' + schema[key].type + '", got "' + value + '"')
              } else if (schema[key].type === 'optional') {
                throw new Error('Expecting "' + key + '" to be one of "' + schema[key].types + '", got "' + typeof value + '"')
              } else
                throw new Error('Expecting "' + key + '" to be a "' + schema[key].type + '", got "' + typeof value + '"')
            }

            proxyObj[key] = value;
            return value
          },
        });

        // Any schema leftover should be added back to object for future protection
        for (const key of Object.getOwnPropertyNames(schema)) {
          if (obj[key])
            continue

          proxyObj[key] = objToValidate[key];
          Object.defineProperty(obj, key, {
            enumerable: propDescriptor.enumerable,
            configurable: propDescriptor.configurable,
            get: function() {
              return proxyObj[key]
            },

            set: function(value) {
              if (!isValidSchema(key, value)) {
                if (schema[key].expects) {
                  value = (typeof value === 'string') ? value : typeof value;
                  throw new Error('Expecting "' + key + '" to be "' + schema[key].type + '", got "' + value + '"')
                } else if (schema[key].type === 'optional') {
                  throw new Error('Expecting "' + key + '" to be one of "' + schema[key].types + '", got "' + typeof value + '"')
                } else
                  throw new Error('Expecting "' + key + '" to be a "' + schema[key].type + '", got "' + typeof value + '"')
              }

              proxyObj[key] = value;
              return value
            },
          });
        }

        obj[key] = objToValidate[key];
      }

      return obj
    }
  }

  ObjectModel.StringNotBlank = ObjectModel(function StringNotBlank(str) {
    if (typeof str !== 'string')
      return false

    return str.trim().length > 0
  });

  // Protect Blueprint using a schema
  const BlueprintSchema = new ObjectModel({
    name: ObjectModel.StringNotBlank,

    // Blueprint provides
    init: [Function],
    in: [Function],
    on: [Function],
    describe: [Object],

    // Internals
    out: Function,
    error: Function,
    close: [Function],

    // User facing
    to: Function,
    from: Function,

    value: Function,
  });

  // TODO: ModuleFactory() for loader, which passes the loader + protocol into it.. That way it's recursive...

  function Module(__filename, fileContents, callback) {
    // From iife code
    if (!fileContents)
      __filename = __filename.path || '';

    var module = {
      filename: __filename,
      exports: {},
      Blueprint: null,
      resolve: {},

      require: function(url, callback) {
        let filePath;

        if (url.indexOf('./') !== -1) {
          filePath = url;
        } else if (url.indexOf('http') !== -1) {
          filePath = url;
        } else {
          filePath = '../node_modules/' + url;
        }

        return window.http.module.in.call(window.http.module, filePath, null, callback, true)
      },
    };

    if (!callback)
      return module

    module.resolve[module.filename] = function(exports) {
      callback(null, exports);
      delete module.resolve[module.filename];
    };

    const script = 'module.resolve["' + __filename + '"](function(iifeModule){\n' +
    '  var module = Module(iifeModule)\n' +
    '  var __filename = module.filename\n' +
    '  var __dirname = __filename.slice(0, __filename.lastIndexOf("/"))\n' +
    '  var require = module.require\n' +
    '  var exports = module.exports\n' +
    '  var process = { browser: true }\n' +
    '  var Blueprint = null;\n\n' +

    '(function() {\n' + // Create IIFE for module/blueprint
    '"use strict";\n' +
      fileContents + '\n' +
    '}).call(module.exports);\n' + // Create 'this' binding.
    '  if (Blueprint) { return Blueprint}\n' +
    '  return module.exports\n' +
    '}(module));';

    window.module = module;
    window.global = window;
    window.Module = Module;

    window.require = module.require;

    return script
  }

  // Embedded http loader blueprint.
  const httpLoader = {
    name: 'loaders/http',
    protocol: 'loader', // embedded loader

    // Internals for embed
    loaded: true,
    callbacks: [],

    module: {
      name: 'HTTP Loader',
      protocol: ['http', 'https', 'web://'], // TODO: Create a way for loader to subscribe to multiple protocols

      init: function() {
        this.isBrowser = (typeof window === 'object') ? true : false;
      },

      in: function(fileName, opts, callback, skipNormalization) {
        if (!this.isBrowser)
          return callback('URL loading with node.js not supported yet (Coming soon!).')

        return this.browser.load.call(this, fileName, callback, skipNormalization)
      },

      normalizeFilePath: function(fileName) {
        if (fileName.indexOf('http') >= 0)
          return fileName

        const file = fileName + ((fileName.indexOf('.js') === -1) ? '.js' : '');
        const filePath = 'blueprints/' + file;
        return filePath
      },

      browser: {
        load: function(fileName, callback, skipNormalization) {
          const filePath = (!skipNormalization) ? this.normalizeFilePath(fileName) : fileName;
          log.debug('[http loader] Loading file: ' + filePath);

          var isAsync = true;
          var syncFile = null;
          if (!callback) {
            isAsync = false;
            callback = function(err, file) {
              if (err)
                throw new Error(err)

              return syncFile = file
            };
          }

          const scriptRequest = new XMLHttpRequest();

          // TODO: Needs validating that event handlers work across browsers. More specifically, that they run on ES5 environments.
          // https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest#Browser_compatibility
          const scriptEvents = new this.browser.scriptEvents(this, fileName, callback);
          scriptRequest.addEventListener('load', scriptEvents.onLoad);
          scriptRequest.addEventListener('error', scriptEvents.onError);

          scriptRequest.open('GET', filePath, isAsync);
          scriptRequest.send(null);

          return syncFile
        },

        scriptEvents: function(loader, fileName, callback) {
          this.callback = callback;
          this.fileName = fileName;
          this.onLoad = loader.browser.onLoad.call(this, loader);
          this.onError = loader.browser.onError.call(this, loader);
        },

        onLoad: function(loader) {
          const scriptEvents = this;
          return function() {
            const scriptRequest = this;

            if (scriptRequest.status > 400)
              return scriptEvents.onError.call(scriptRequest, scriptRequest.statusText)

            const scriptContent = Module(scriptRequest.responseURL, scriptRequest.responseText, scriptEvents.callback);

            var html = document.documentElement;
            var scriptTag = document.createElement('script');
            scriptTag.textContent = scriptContent;

            html.appendChild(scriptTag);
            loader.browser.cleanup(scriptTag, scriptEvents);
          }
        },

        onError: function(loader) {
          const scriptEvents = this;
          const fileName = scriptEvents.fileName;

          return function() {
            const scriptTag = this;
            loader.browser.cleanup(scriptTag, scriptEvents);

            // Try to fallback to index.js
            // FIXME: instead of falling back, this should be the default if no `.js` is detected, but URL uglifiers and such will have issues.. hrmmmm..
            if (fileName.indexOf('.js') === -1 && fileName.indexOf('index.js') === -1) {
              log.warn('[http] Attempting to fallback to: ', fileName + '/index.js');
              return loader.in.call(loader, fileName + '/index.js', scriptEvents.callback)
            }

            scriptEvents.callback('Could not load Blueprint');
          }
        },

        cleanup: function(scriptTag, scriptEvents) {
          scriptTag.removeEventListener('load', scriptEvents.onLoad);
          scriptTag.removeEventListener('error', scriptEvents.onError);
          //document.getElementsByTagName('head')[0].removeChild(scriptTag) // TODO: Cleanup
        },
      },

      node: {
        // Stub for node.js HTTP loading support.
      },

    },
  };

  exporter('http', httpLoader); // TODO: Cleanup, expose modules instead

  // Embedded file loader blueprint.
  const fileLoader = {
    name: 'loaders/file',
    protocol: 'embed',

    // Internals for embed
    loaded: true,
    callbacks: [],

    module: {
      name: 'File Loader',
      protocol: 'file',

      init: function() {
        this.isBrowser = (typeof window === 'object') ? true : false;
      },

      in: function(fileName, opts, callback) {
        if (this.isBrowser)
          throw new Error('File:// loading within browser not supported yet. Try relative URL instead.')

        log.debug('[file loader] Loading file: ' + fileName);

        // TODO: Switch to async file loading, improve require(), pass in IIFE to sandbox, use IIFE resolver for callback
        // TODO: Add error reporting.

        const vm = require('vm');
        const fs = require('fs');

        const filePath = this.normalizeFilePath(fileName);

        const file = this.resolveFile(filePath);
        if (!file)
          return callback('Blueprint not found')

        const fileContents = fs.readFileSync(file).toString();

        // TODO: Create a more complete sandbox object
        const sandbox = {
          Blueprint: null,
          require: function(moduleFile) { return require(filePath + '/node_modules/' + moduleFile) },
          console: { log: log, error: log.error, warn: log.warn, info: log.info },
          global: global,
          module: module,
          __dirname: filePath,
        };

        vm.createContext(sandbox);
        vm.runInContext(fileContents, sandbox);
        callback(null, sandbox.Blueprint);
      },

      normalizeFilePath: function(fileName) {
        const path = require('path');
        return path.resolve(process.cwd(), 'blueprints/', fileName)
      },

      resolveFile: function(filePath) {
        const fs = require('fs');
        const path = require('path');

        // If file or directory exists
        if (fs.existsSync(filePath)) {
          // Check if blueprint is a directory first
          if (fs.statSync(filePath).isDirectory())
            return path.resolve(filePath, 'index.js')
          else
            return filePath + ((filePath.indexOf('.js') === -1) ? '.js' : '')
        }

        // Try adding an extension to see if it exists
        const file = filePath + ((filePath.indexOf('.js') === -1) ? '.js' : '');
        if (fs.existsSync(file))
          return file

        return false
      },
    },
  };

  /* eslint-disable prefer-template */

  // Multi-environment async module loader
  const modules = {
    'loaders/http': httpLoader,
    'loaders/file': fileLoader,
  };

  function normalizeName(name) {
    // TODO: loop through each file path and normalize it too:
    return name.trim().toLowerCase()//.capitalize()
  }

  function resolveFileInfo(file) {
    const normalizedFileName = normalizeName(file);
    const protocol = parseProtocol(file);

    return {
      file: file,
      path: file,
      name: normalizedFileName,
      protocol: protocol,
    }
  }

  function parseProtocol(name) {
    // FIXME: name should of been normalized by now. Either remove this code or move it somewhere else..
    if (!name || typeof name !== 'string')
      throw new Error('Invalid loader blueprint name')

    var protoResults = name.match(/:\/\//gi) && name.split(/:\/\//gi);

    // No protocol found, if browser environment then is relative URL else is a file path. (Sane defaults but can be overridden)
    if (!protoResults)
      return (typeof window === 'object') ? 'http' : 'file'

    return protoResults[0]
  }

  function runModuleCallbacks(module) {
    for (const callback of module.callbacks) {
      callback(module.module);
    }

    module.callbacks = [];
  }

  const imports = function(name, opts, callback) {
    try {
      const fileInfo = resolveFileInfo(name);
      const fileName = fileInfo.name;
      const protocol = fileInfo.protocol;

      log.debug('loading module:', fileName);

      // Module has loaded or started to load
      if (modules[fileName])
        if (modules[fileName].loaded)
          return callback(modules[fileName].module) // Return module from Cache
        else
          return modules[fileName].callbacks.push(callback) // Not loaded yet, register callback

      modules[fileName] = {
        fileName: fileName,
        protocol: protocol,
        loaded: false,
        callbacks: [callback],
      };

      // Bootstrapping loader blueprints ;)
      //Frame('Loaders/' + protocol).from(fileName).to(fileName, opts, function(err, exportFile) {})

      const loader = 'loaders/' + protocol;
      modules[loader].module.init(); // TODO: optional init (inside Frame core)
      modules[loader].module.in(fileName, opts, function(err, exportFile){
        if (err)
          log.error('Error: ', err, fileName);
        else {
          log.debug('Loaded Blueprint module: ', fileName);

          if (!exportFile || typeof exportFile !== 'object')
            throw new Error('Invalid Blueprint file, Blueprint is expected to be an object or class')

          if (typeof exportFile.name !== 'string')
            throw new Error('Invalid Blueprint file, Blueprint missing a name')

          const module = modules[fileName];
          if (!module)
            throw new Error('Uh oh, we shouldnt be here')

          // Module already loaded. Not suppose to be here. Only from force-loading would get you here.
          if (module.loaded)
            throw new Error('Blueprint "' + exportFile.name + '" already loaded.')

          module.module = exportFile;
          module.loaded = true;

          runModuleCallbacks(module);
        }
      });

      // TODO: modules[loader].module.bundle support for CLI tooling.

    } catch (err) {
      throw new Error('Could not load blueprint \'' + name + '\'\n' + err)
    }
  };

  // Frame and Blueprint constructors
  const singletons = {};
  function Frame(name, opts) {
    if (!(this instanceof Frame))
      return new Frame(name, opts)

    if (typeof name !== 'string')
      throw new Error('Blueprint name \'' + name + '\' is not valid.\n')

    // If blueprint is a singleton (for shared resources), return it instead of creating new instance.
    if (singletons[name])
      return singletons[name]

    let blueprint = new Blueprint(name);
    imports(name, opts, function(blueprintFile) {
      try {

        log.debug('Blueprint loaded:', blueprintFile.name);

        if (typeof blueprintFile !== 'object')
          throw new Error('Blueprint is expected to be an object or class')

        // Update faux blueprint stub with real module
        assignObject(blueprint, blueprintFile);

        // Update blueprint name
        setDescriptor(blueprint, blueprintFile.name, false);
        blueprint.Frame.name = blueprintFile.name;

        // Apply a schema to blueprint
        blueprint = BlueprintSchema(blueprint);

        // Validate Blueprint input with optional property destructuring (using describe object)
        blueprint.Frame.describe = createDestructure(blueprint.describe, BlueprintBase.describe);

        blueprint.Frame.loaded = true;
        debounce(processFlow, 1, blueprint);

        // If blueprint intends to be a singleton, add it to the list.
        if (blueprint.singleton)
          singletons[blueprint.name] = blueprint;

      } catch (err) {
        throw new Error('Blueprint \'' + name + '\' is not valid.\n' + err)
      }
    });

    return blueprint
  }

  function Blueprint(name) {
    const blueprint = new BlueprintConstructor(name);
    setDescriptor(blueprint, 'Blueprint', true);

    // Blueprint methods
    assignObject(blueprint, BlueprintMethods);

    // Create hidden blueprint.Frame property to keep state
    const blueprintBase = Object.create(BlueprintBase);
    assignObject(blueprintBase, BlueprintBase);
    Object.defineProperty(blueprint, 'Frame', { value: blueprintBase, enumerable: true, configurable: true, writable: false }); // TODO: configurable: false, enumerable: false
    blueprint.Frame.name = name;

    return blueprint
  }

  function BlueprintConstructor(name) {
    // Create blueprint from constructor
    return function() {
      // If blueprint is a singleton (for shared resources), return it instead of creating new instance.
      if (singletons[name])
        return singletons[name]

      const blueprint = new Frame(name);
      blueprint.Frame.props = arguments;

      log.debug('constructor called for', name);

      return blueprint
    }
  }

  // Give Frame an easy descriptor
  setDescriptor(Frame, 'Constructor');
  setDescriptor(Frame.constructor, 'Frame');

  // Export Frame globally
  exporter('Frame', Frame);

}());
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZnJhbWUuZGV2LmpzIiwic291cmNlcyI6WyIuLi9saWIvbG9nZ2VyLmpzIiwiLi4vbGliL2V4cG9ydHMuanMiLCIuLi9saWIvaGVscGVycy5qcyIsIi4uL2xpYi9mbG93LmpzIiwiLi4vbGliL21ldGhvZHMuanMiLCIuLi9saWIvQmx1ZXByaW50QmFzZS5qcyIsIi4uL2xpYi9PYmplY3RNb2RlbC5qcyIsIi4uL2xpYi9zY2hlbWEuanMiLCIuLi9saWIvTW9kdWxlTG9hZGVyLmpzIiwiLi4vYmx1ZXByaW50cy9sb2FkZXJzL2h0dHAuanMiLCIuLi9ibHVlcHJpbnRzL2xvYWRlcnMvZmlsZS5qcyIsIi4uL2xpYi9sb2FkZXIuanMiLCIuLi9saWIvRnJhbWUuanMiXSwic291cmNlc0NvbnRlbnQiOlsiJ3VzZSBzdHJpY3QnXG5cbmZ1bmN0aW9uIGxvZygpIHtcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcbiAgY29uc29sZS5sb2cuYXBwbHkodGhpcywgYXJndW1lbnRzKVxufVxuXG5sb2cuZXJyb3IgPSBmdW5jdGlvbigpIHtcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcbiAgY29uc29sZS5lcnJvci5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG59XG5cbmxvZy53YXJuID0gZnVuY3Rpb24oKSB7XG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb25zb2xlXG4gIGNvbnNvbGUud2Fybi5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG59XG5cbmxvZy5kZWJ1ZyA9IGZ1bmN0aW9uKCkge1xuICBjb25zb2xlLmxvZy5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG59XG5cbmV4cG9ydCBkZWZhdWx0IGxvZ1xuIiwiLy8gVW5pdmVyc2FsIGV4cG9ydCBmdW5jdGlvbiBkZXBlbmRpbmcgb24gZW52aXJvbm1lbnQuXG4vLyBBbHRlcm5hdGl2ZWx5LCBpZiB0aGlzIHByb3ZlcyB0byBiZSBpbmVmZmVjdGl2ZSwgZGlmZmVyZW50IHRhcmdldHMgZm9yIHJvbGx1cCBjb3VsZCBiZSBjb25zaWRlcmVkLlxuZnVuY3Rpb24gZXhwb3J0ZXIobmFtZSwgb2JqKSB7XG4gIC8vIE5vZGUuanMgJiBub2RlLWxpa2UgZW52aXJvbm1lbnRzIChleHBvcnQgYXMgbW9kdWxlKVxuICBpZiAodHlwZW9mIG1vZHVsZSA9PT0gJ29iamVjdCcgJiYgdHlwZW9mIG1vZHVsZS5leHBvcnRzID09PSAnb2JqZWN0JylcbiAgICBtb2R1bGUuZXhwb3J0cyA9IG9ialxuXG4gIC8vIEdsb2JhbCBleHBvcnQgKGFsc28gYXBwbGllZCB0byBOb2RlICsgbm9kZS1saWtlIGVudmlyb25tZW50cylcbiAgaWYgKHR5cGVvZiBnbG9iYWwgPT09ICdvYmplY3QnKVxuICAgIGdsb2JhbFtuYW1lXSA9IG9ialxuXG4gIC8vIFVNRFxuICBlbHNlIGlmICh0eXBlb2YgZGVmaW5lID09PSAnZnVuY3Rpb24nICYmIGRlZmluZS5hbWQpXG4gICAgZGVmaW5lKFsnZXhwb3J0cyddLCBmdW5jdGlvbihleHApIHtcbiAgICAgIGV4cFtuYW1lXSA9IG9ialxuICAgIH0pXG5cbiAgLy8gQnJvd3NlcnMgYW5kIGJyb3dzZXItbGlrZSBlbnZpcm9ubWVudHMgKEVsZWN0cm9uLCBIeWJyaWQgd2ViIGFwcHMsIGV0YylcbiAgZWxzZSBpZiAodHlwZW9mIHdpbmRvdyA9PT0gJ29iamVjdCcpXG4gICAgd2luZG93W25hbWVdID0gb2JqXG59XG5cbmV4cG9ydCBkZWZhdWx0IGV4cG9ydGVyXG4iLCIndXNlIHN0cmljdCdcblxuLy8gT2JqZWN0IGhlbHBlciBmdW5jdGlvbnNcbmZ1bmN0aW9uIGFzc2lnbk9iamVjdCh0YXJnZXQsIHNvdXJjZSkge1xuICBmb3IgKGNvbnN0IHByb3BlcnR5TmFtZSBvZiBPYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcyhzb3VyY2UpKSB7XG4gICAgaWYgKHByb3BlcnR5TmFtZSA9PT0gJ25hbWUnKVxuICAgICAgY29udGludWVcblxuICAgIGlmICh0eXBlb2Ygc291cmNlW3Byb3BlcnR5TmFtZV0gPT09ICdvYmplY3QnKVxuICAgICAgaWYgKEFycmF5LmlzQXJyYXkoc291cmNlW3Byb3BlcnR5TmFtZV0pKVxuICAgICAgICB0YXJnZXRbcHJvcGVydHlOYW1lXSA9IFtdXG4gICAgICBlbHNlXG4gICAgICAgIHRhcmdldFtwcm9wZXJ0eU5hbWVdID0gT2JqZWN0LmNyZWF0ZShzb3VyY2VbcHJvcGVydHlOYW1lXSwgT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcnMoc291cmNlW3Byb3BlcnR5TmFtZV0pKVxuICAgIGVsc2VcbiAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShcbiAgICAgICAgdGFyZ2V0LFxuICAgICAgICBwcm9wZXJ0eU5hbWUsXG4gICAgICAgIE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3Ioc291cmNlLCBwcm9wZXJ0eU5hbWUpXG4gICAgICApXG4gIH1cblxuICByZXR1cm4gdGFyZ2V0XG59XG5cbmZ1bmN0aW9uIHNldERlc2NyaXB0b3IodGFyZ2V0LCB2YWx1ZSwgY29uZmlndXJhYmxlKSB7XG4gIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh0YXJnZXQsICd0b1N0cmluZycsIHtcbiAgICBlbnVtZXJhYmxlOiBmYWxzZSxcbiAgICB3cml0YWJsZTogZmFsc2UsXG4gICAgY29uZmlndXJhYmxlOiB0cnVlLFxuICAgIHZhbHVlOiBmdW5jdGlvbigpIHtcbiAgICAgIHJldHVybiAodmFsdWUpID8gJ1tGcmFtZTogJyArIHZhbHVlICsgJ10nIDogJ1tGcmFtZTogQ29uc3RydWN0b3JdJ1xuICAgIH0sXG4gIH0pXG5cbiAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRhcmdldCwgJ25hbWUnLCB7XG4gICAgZW51bWVyYWJsZTogZmFsc2UsXG4gICAgd3JpdGFibGU6IGZhbHNlLFxuICAgIGNvbmZpZ3VyYWJsZTogKGNvbmZpZ3VyYWJsZSkgPyB0cnVlIDogZmFsc2UsXG4gICAgdmFsdWU6IHZhbHVlLFxuICB9KVxufVxuXG4vLyBEZXN0cnVjdHVyZSB1c2VyIGlucHV0IGZvciBwYXJhbWV0ZXIgZGVzdHJ1Y3R1cmluZyBpbnRvICdwcm9wcycgb2JqZWN0LlxuZnVuY3Rpb24gY3JlYXRlRGVzdHJ1Y3R1cmUoc291cmNlLCBrZXlzKSB7XG4gIGNvbnN0IHRhcmdldCA9IHt9XG5cbiAgLy8gSWYgbm8gdGFyZ2V0IGV4aXN0LCBzdHViIHRoZW0gc28gd2UgZG9uJ3QgcnVuIGludG8gaXNzdWVzIGxhdGVyLlxuICBpZiAoIXNvdXJjZSlcbiAgICBzb3VyY2UgPSB7fVxuXG4gIC8vIENyZWF0ZSBzdHVicyBmb3IgQXJyYXkgb2Yga2V5cy4gRXhhbXBsZTogWydpbml0JywgJ2luJywgZXRjXVxuICBmb3IgKGNvbnN0IGtleSBvZiBrZXlzKSB7XG4gICAgdGFyZ2V0W2tleV0gPSBbXVxuICB9XG5cbiAgLy8gTG9vcCB0aHJvdWdoIHNvdXJjZSdzIGtleXNcbiAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMoc291cmNlKSkge1xuICAgIHRhcmdldFtrZXldID0gW11cblxuICAgIC8vIFdlIG9ubHkgc3VwcG9ydCBvYmplY3RzIGZvciBub3cuIEV4YW1wbGUgeyBpbml0OiB7ICdzb21lS2V5JzogJ3NvbWVEZXNjcmlwdGlvbicgfX1cbiAgICBpZiAodHlwZW9mIHNvdXJjZVtrZXldICE9PSAnb2JqZWN0JyB8fCBBcnJheS5pc0FycmF5KHNvdXJjZVtrZXldKSlcbiAgICAgIGNvbnRpbnVlXG5cbiAgICAvLyBUT0RPOiBTdXBwb3J0IGFycmF5cyBmb3IgdHlwZSBjaGVja2luZ1xuICAgIC8vIEV4YW1wbGU6IHsgaW5pdDogJ3NvbWVLZXknOiBbJ3NvbWUgZGVzY3JpcHRpb24nLCAnc3RyaW5nJ10gfVxuXG4gICAgY29uc3QgcHJvcEluZGV4ID0gW11cbiAgICBmb3IgKGNvbnN0IHByb3Agb2YgT2JqZWN0LmtleXMoc291cmNlW2tleV0pKSB7XG4gICAgICBwcm9wSW5kZXgucHVzaCh7IG5hbWU6IHByb3AsIGRlc2NyaXB0aW9uOiBzb3VyY2Vba2V5XVtwcm9wXSB9KVxuICAgIH1cblxuICAgIHRhcmdldFtrZXldID0gcHJvcEluZGV4XG4gIH1cblxuICByZXR1cm4gdGFyZ2V0XG59XG5cbmZ1bmN0aW9uIGRlc3RydWN0dXJlKHRhcmdldCwgcHJvcHMpIHtcbiAgY29uc3Qgc291cmNlUHJvcHMgPSAoIXByb3BzKSA/IFtdIDogQXJyYXkuZnJvbShwcm9wcylcblxuICBpZiAoIXRhcmdldClcbiAgICByZXR1cm4gc291cmNlUHJvcHNcblxuICBjb25zdCB0YXJnZXRQcm9wcyA9IHt9XG4gIGxldCBwcm9wSW5kZXggPSAwXG5cbiAgLy8gTG9vcCB0aHJvdWdoIG91ciB0YXJnZXQga2V5cywgYW5kIGFzc2lnbiB0aGUgb2JqZWN0J3Mga2V5IHRvIHRoZSB2YWx1ZSBvZiB0aGUgcHJvcHMgaW5wdXQuXG4gIGZvciAoY29uc3QgdGFyZ2V0UHJvcCBvZiB0YXJnZXQpIHtcbiAgICB0YXJnZXRQcm9wc1t0YXJnZXRQcm9wLm5hbWVdID0gc291cmNlUHJvcHNbcHJvcEluZGV4XVxuICAgIHByb3BJbmRleCsrXG4gIH1cblxuICAvLyBJZiB3ZSBkb24ndCBoYXZlIGEgdmFsaWQgdGFyZ2V0OyByZXR1cm4gcHJvcHMgYXJyYXkgaW5zdGVhZC4gRXhhbXBsZTogWydwcm9wMScsICdwcm9wMiddXG4gIGlmIChwcm9wSW5kZXggPT09IDApXG4gICAgcmV0dXJuIHByb3BzXG5cbiAgLy8gRXhhbXBsZTogeyBzb21lS2V5OiBzb21lVmFsdWUsIHNvbWVPdGhlcktleTogc29tZU90aGVyVmFsdWUgfVxuICByZXR1cm4gdGFyZ2V0UHJvcHNcbn1cblxuZXhwb3J0IHtcbiAgYXNzaWduT2JqZWN0LFxuICBzZXREZXNjcmlwdG9yLFxuICBjcmVhdGVEZXN0cnVjdHVyZSxcbiAgZGVzdHJ1Y3R1cmVcbn1cbiIsIid1c2Ugc3RyaWN0J1xuXG5pbXBvcnQgbG9nIGZyb20gJy4vbG9nZ2VyJ1xuaW1wb3J0IHsgZGVzdHJ1Y3R1cmUgfSBmcm9tICcuL2hlbHBlcnMnXG5cbmZ1bmN0aW9uIHByb2Nlc3NGbG93KCkge1xuICAvLyBBbHJlYWR5IHByb2Nlc3NpbmcgdGhpcyBCbHVlcHJpbnQncyBmbG93LlxuICBpZiAodGhpcy5GcmFtZS5wcm9jZXNzaW5nRmxvdylcbiAgICByZXR1cm5cblxuICAvLyBJZiBubyBwaXBlcyBmb3IgZmxvdywgdGhlbiBub3RoaW5nIHRvIGRvLlxuICBpZiAodGhpcy5GcmFtZS5waXBlcy5sZW5ndGggPCAxKVxuICAgIHJldHVyblxuXG4gIC8vIENoZWNrIHRoYXQgYWxsIGJsdWVwcmludHMgYXJlIHJlYWR5XG4gIGlmICghZmxvd3NSZWFkeS5jYWxsKHRoaXMpKVxuICAgIHJldHVyblxuXG4gIGxvZy5kZWJ1ZygnUHJvY2Vzc2luZyBmbG93IGZvciAnICsgdGhpcy5uYW1lKVxuICBsb2cuZGVidWcoKVxuICB0aGlzLkZyYW1lLnByb2Nlc3NpbmdGbG93ID0gdHJ1ZVxuXG4gIC8vIFB1dCB0aGlzIGJsdWVwcmludCBhdCB0aGUgYmVnaW5uaW5nIG9mIHRoZSBmbG93LCB0aGF0IHdheSBhbnkgLmZyb20gZXZlbnRzIHRyaWdnZXIgdGhlIHRvcCBsZXZlbCBmaXJzdC5cbiAgdGhpcy5GcmFtZS5waXBlcy51bnNoaWZ0KHsgZGlyZWN0aW9uOiAndG8nLCB0YXJnZXQ6IHRoaXMgfSlcblxuICAvLyBCcmVhayBvdXQgZXZlbnQgcGlwZXMgYW5kIGZsb3cgcGlwZXMgaW50byBzZXBhcmF0ZSBmbG93cy5cbiAgbGV0IGkgPSAxIC8vIFN0YXJ0IGF0IDEsIHNpbmNlIG91ciB3b3JrZXIgYmx1ZXByaW50IGluc3RhbmNlIHNob3VsZCBiZSAwXG4gIGZvciAoY29uc3QgcGlwZSBvZiB0aGlzLkZyYW1lLnBpcGVzKSB7XG4gICAgY29uc3QgYmx1ZXByaW50ID0gcGlwZS50YXJnZXRcblxuICAgIGlmIChwaXBlLmRpcmVjdGlvbiA9PT0gJ2Zyb20nKSB7XG4gICAgICBpZiAodHlwZW9mIGJsdWVwcmludC5vbiAhPT0gJ2Z1bmN0aW9uJylcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdCbHVlcHJpbnQgXFwnJyArIGJsdWVwcmludC5uYW1lICsgJ1xcJyBkb2VzIG5vdCBzdXBwb3J0IGV2ZW50cy4nKVxuXG4gICAgICAvLyBVc2VkIHdoZW4gdGFyZ2V0IGJsdWVwcmludCBpcyBwYXJ0IG9mIGFub3RoZXIgZmxvd1xuICAgICAgaWYgKGJsdWVwcmludCAmJiBibHVlcHJpbnQuRnJhbWUpXG4gICAgICAgIGJsdWVwcmludC5GcmFtZS5wYXJlbnRzLnB1c2goeyB0YXJnZXQ6IHRoaXMgfSkgLy8gVE9ETzogQ2hlY2sgaWYgd29ya2VyIGJsdWVwcmludCBpcyBhbHJlYWR5IGFkZGVkLlxuXG4gICAgICAvLyAuZnJvbShFdmVudHMpIHN0YXJ0IHRoZSBmbG93IGF0IGluZGV4IDBcbiAgICAgIHBpcGUuY29udGV4dCA9IGNyZWF0ZUNvbnRleHQodGhpcywgcGlwZS50YXJnZXQsIDApXG4gICAgICB0aGlzLkZyYW1lLmV2ZW50cy5wdXNoKHBpcGUpXG5cbiAgICB9IGVsc2UgaWYgKHBpcGUuZGlyZWN0aW9uID09PSAndG8nKSB7XG4gICAgICBpZiAodHlwZW9mIGJsdWVwcmludC5pbiAhPT0gJ2Z1bmN0aW9uJylcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdCbHVlcHJpbnQgXFwnJyArIGJsdWVwcmludC5uYW1lICsgJ1xcJyBkb2VzIG5vdCBzdXBwb3J0IGlucHV0LicpXG5cbiAgICAgIHBpcGUuY29udGV4dCA9IGNyZWF0ZUNvbnRleHQodGhpcywgcGlwZS50YXJnZXQsIGkpXG4gICAgICB0aGlzLkZyYW1lLmZsb3cucHVzaChwaXBlKVxuICAgICAgaSsrXG4gICAgfVxuICB9XG5cbiAgc3RhcnRGbG93LmNhbGwodGhpcylcbn1cblxuZnVuY3Rpb24gY3JlYXRlQ29udGV4dCh3b3JrZXIsIGJsdWVwcmludCwgaW5kZXgpIHtcbiAgcmV0dXJuIHtcbiAgICBuYW1lOiBibHVlcHJpbnQubmFtZSxcbiAgICBzdGF0ZTogYmx1ZXByaW50LkZyYW1lLnN0YXRlLFxuICAgIG91dDogYmx1ZXByaW50Lm91dC5iaW5kKHdvcmtlciwgaW5kZXgpLFxuICAgIGVycm9yOiBibHVlcHJpbnQuZXJyb3IuYmluZCh3b3JrZXIsIGluZGV4KSxcbiAgfVxufVxuXG5mdW5jdGlvbiBmbG93c1JlYWR5KCkge1xuICAvLyBpZiBibHVlcHJpbnQgaGFzIG5vdCBiZWVuIGluaXRpYWxpemVkIHlldCAoaS5lLiBjb25zdHJ1Y3RvciBub3QgdXNlZC4pXG4gIGlmICghdGhpcy5GcmFtZS5pbml0aWFsaXplZCkge1xuICAgIGluaXRCbHVlcHJpbnQuY2FsbCh0aGlzLCBwcm9jZXNzRmxvdylcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8vIExvb3AgdGhyb3VnaCBhbGwgYmx1ZXByaW50cyBpbiBmbG93IHRvIG1ha2Ugc3VyZSB0aGV5IGhhdmUgYmVlbiBsb2FkZWQgYW5kIGluaXRpYWxpemVkLlxuICBsZXQgZmxvd3NSZWFkeSA9IHRydWVcbiAgZm9yIChjb25zdCBwaXBlIG9mIHRoaXMuRnJhbWUucGlwZXMpIHtcbiAgICBjb25zdCB0YXJnZXQgPSBwaXBlLnRhcmdldFxuXG4gICAgLy8gTm90IGEgYmx1ZXByaW50LCBlaXRoZXIgYSBmdW5jdGlvbiBvciBwcmltaXRpdmVcbiAgICBpZiAodGFyZ2V0LnN0dWIpXG4gICAgICBjb250aW51ZVxuXG4gICAgaWYgKCF0YXJnZXQuRnJhbWUubG9hZGVkKSB7XG4gICAgICBmbG93c1JlYWR5ID0gZmFsc2VcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgaWYgKCF0YXJnZXQuRnJhbWUuaW5pdGlhbGl6ZWQpIHtcbiAgICAgIGluaXRCbHVlcHJpbnQuY2FsbCh0YXJnZXQsIHByb2Nlc3NGbG93LmJpbmQodGhpcykpXG4gICAgICBmbG93c1JlYWR5ID0gZmFsc2VcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGZsb3dzUmVhZHlcbn1cblxuZnVuY3Rpb24gc3RhcnRGbG93KCkge1xuICBsb2cuZGVidWcoJ1N0YXJ0aW5nIGZsb3cgZm9yICcgKyB0aGlzLm5hbWUpXG5cbiAgZm9yIChjb25zdCBldmVudCBvZiB0aGlzLkZyYW1lLmV2ZW50cykge1xuICAgIGNvbnN0IGJsdWVwcmludCA9IGV2ZW50LnRhcmdldFxuICAgIGNvbnN0IHByb3BzID0gZGVzdHJ1Y3R1cmUoYmx1ZXByaW50LkZyYW1lLmRlc2NyaWJlLm9uLCBldmVudC5wYXJhbXMpXG4gICAgbG9nLmRlYnVnKGJsdWVwcmludC5uYW1lLCAncHJvcHMnLCBwcm9wcylcblxuICAgIC8vIElmIG5vdCBhbHJlYWR5IHByb2Nlc3NpbmcgZmxvdy5cbiAgICBpZiAoYmx1ZXByaW50LkZyYW1lLnBpcGVzICYmIGJsdWVwcmludC5GcmFtZS5waXBlcy5sZW5ndGggPiAwKVxuICAgICAgbG9nLmRlYnVnKHRoaXMubmFtZSArICcgaXMgbm90IHN0YXJ0aW5nICcgKyBibHVlcHJpbnQubmFtZSArICcsIHdhaXRpbmcgZm9yIGl0IHRvIGZpbmlzaCcpXG4gICAgZWxzZSBpZiAoIWJsdWVwcmludC5GcmFtZS5wcm9jZXNzaW5nRmxvdylcbiAgICAgIGJsdWVwcmludC5vbi5jYWxsKGV2ZW50LmNvbnRleHQsIHByb3BzKVxuICB9XG59XG5cbmZ1bmN0aW9uIGluaXRCbHVlcHJpbnQoY2FsbGJhY2spIHtcbiAgY29uc3QgYmx1ZXByaW50ID0gdGhpc1xuXG4gIHRyeSB7XG4gICAgbGV0IHByb3BzID0gYmx1ZXByaW50LkZyYW1lLnByb3BzID8gYmx1ZXByaW50LkZyYW1lLnByb3BzIDoge31cblxuICAgIC8vIElmIEJsdWVwcmludCBmb3JlZ29lcyB0aGUgaW5pdGlhbGl6ZXIsIHN0dWIgaXQuXG4gICAgaWYgKCFibHVlcHJpbnQuaW5pdClcbiAgICAgIGJsdWVwcmludC5pbml0ID0gZnVuY3Rpb24oXywgZG9uZSkge1xuICAgICAgICBkb25lKClcbiAgICAgIH1cblxuICAgIHByb3BzID0gZGVzdHJ1Y3R1cmUoYmx1ZXByaW50LkZyYW1lLmRlc2NyaWJlLmluaXQsIHByb3BzKVxuICAgIGJsdWVwcmludC5pbml0LmNhbGwoYmx1ZXByaW50LCBwcm9wcywgZnVuY3Rpb24oZXJyKSB7XG4gICAgICBpZiAoZXJyKVxuICAgICAgICByZXR1cm4gbG9nLmVycm9yKCdFcnJvciBpbml0aWFsaXppbmcgYmx1ZXByaW50IFxcJycgKyBibHVlcHJpbnQubmFtZSArICdcXCdcXG4nICsgZXJyKVxuXG4gICAgICAvLyBCbHVlcHJpbnQgaW50aXRpYWx6ZWRcbiAgICAgIGxvZy5kZWJ1ZygnQmx1ZXByaW50ICcgKyBibHVlcHJpbnQubmFtZSArICcgaW50aWFsaXplZCcpXG5cbiAgICAgIGJsdWVwcmludC5GcmFtZS5wcm9wcyA9IHt9XG4gICAgICBibHVlcHJpbnQuRnJhbWUuaW5pdGlhbGl6ZWQgPSB0cnVlXG4gICAgICBibHVlcHJpbnQuRnJhbWUuaW5pdGlhbGl6aW5nID0gZmFsc2VcbiAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7IGNhbGxiYWNrICYmIGNhbGxiYWNrLmNhbGwoYmx1ZXByaW50KSB9LCAxKVxuICAgIH0pXG5cbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdCbHVlcHJpbnQgXFwnJyArIGJsdWVwcmludC5uYW1lICsgJ1xcJyBjb3VsZCBub3QgaW5pdGlhbGl6ZS5cXG4nICsgZXJyKVxuICB9XG59XG5cbmV4cG9ydCB7IHByb2Nlc3NGbG93IH1cbiIsIid1c2Ugc3RyaWN0J1xuXG5pbXBvcnQgbG9nIGZyb20gJy4vbG9nZ2VyJ1xuaW1wb3J0IHsgZGVzdHJ1Y3R1cmUsIGFzc2lnbk9iamVjdCwgc2V0RGVzY3JpcHRvciB9IGZyb20gJy4vaGVscGVycydcbmltcG9ydCB7IHByb2Nlc3NGbG93IH0gZnJvbSAnLi9mbG93J1xuXG4vLyBCbHVlcHJpbnQgTWV0aG9kc1xuY29uc3QgQmx1ZXByaW50TWV0aG9kcyA9IHtcbiAgdG86IGZ1bmN0aW9uKHRhcmdldCkge1xuICAgIHJldHVybiBhZGRQaXBlLmNhbGwodGhpcywgJ3RvJywgdGFyZ2V0LCBBcnJheS5mcm9tKGFyZ3VtZW50cykuc2xpY2UoMSkpXG4gIH0sXG5cbiAgZnJvbTogZnVuY3Rpb24odGFyZ2V0KSB7XG4gICAgcmV0dXJuIGFkZFBpcGUuY2FsbCh0aGlzLCAnZnJvbScsIHRhcmdldCwgQXJyYXkuZnJvbShhcmd1bWVudHMpLnNsaWNlKDEpKVxuICB9LFxuXG4gIG91dDogZnVuY3Rpb24oaW5kZXgsIGRhdGEpIHtcbiAgICBsb2cuZGVidWcoJ1dvcmtlciAnICsgdGhpcy5uYW1lICsgJy5vdXQ6JywgZGF0YSwgYXJndW1lbnRzKVxuICAgIHF1ZXVlKG5leHRQaXBlLCB0aGlzLCBbaW5kZXgsIG51bGwsIGRhdGFdKVxuICB9LFxuXG4gIGVycm9yOiBmdW5jdGlvbihpbmRleCwgZXJyKSB7XG4gICAgbG9nLmVycm9yKCdXb3JrZXIgJyArIHRoaXMubmFtZSArICcuZXJyb3I6JywgZXJyLCBhcmd1bWVudHMpXG4gICAgcXVldWUobmV4dFBpcGUsIHRoaXMsIFtpbmRleCwgZXJyXSlcbiAgfSxcblxuICBnZXQgdmFsdWUoKSB7XG4gICAgLy8gQmFpbCBpZiB3ZSdyZSBub3QgcmVhZHkuIChVc2VkIHRvIGdldCBvdXQgb2YgT2JqZWN0TW9kZWwgYW5kIGFzc2lnbk9iamVjdCBsaW1ibylcbiAgICBpZiAoIXRoaXMuRnJhbWUpXG4gICAgICByZXR1cm4gJydcblxuICAgIGNvbnN0IGJsdWVwcmludCA9IHRoaXNcbiAgICBjb25zdCBwcm9taXNlRm9yVmFsdWUgPSBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlLCByZWplY3QpIHtcbiAgICAgIGJsdWVwcmludC5GcmFtZS5pc1Byb21pc2VkID0gdHJ1ZVxuICAgICAgYmx1ZXByaW50LkZyYW1lLnByb21pc2UgPSB7IHJlc29sdmU6IHJlc29sdmUsIHJlamVjdDogcmVqZWN0IH1cbiAgICB9KVxuICAgIHJldHVybiBwcm9taXNlRm9yVmFsdWVcbiAgfSxcblxuICAvL2NhdGNoOiBmdW5jdGlvbihjYWxsYmFjayl7IC4uLiB9XG59XG5cbi8vIEZsb3cgTWV0aG9kIGhlbHBlcnNcbmZ1bmN0aW9uIEJsdWVwcmludFN0dWIodGFyZ2V0KSB7XG4gIGNvbnN0IGJsdWVwcmludCA9IHt9XG4gIGFzc2lnbk9iamVjdChibHVlcHJpbnQsIEJsdWVwcmludE1ldGhvZHMpXG5cbiAgYmx1ZXByaW50LnN0dWIgPSB0cnVlXG4gIGJsdWVwcmludC5GcmFtZSA9IHtcbiAgICBwYXJlbnRzOiBbXSxcbiAgICBkZXNjcmliZTogW10sXG4gIH1cblxuICBpZiAodHlwZW9mIHRhcmdldCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHNldERlc2NyaXB0b3IoYmx1ZXByaW50LCAnRnVuY3Rpb24nKVxuICAgIGJsdWVwcmludC5pbiA9IHRhcmdldFxuICAgIGJsdWVwcmludC5vbiA9IHRhcmdldFxuICB9IGVsc2Uge1xuICAgIHNldERlc2NyaXB0b3IoYmx1ZXByaW50LCAnUHJpbWl0aXZlJylcbiAgICBibHVlcHJpbnQuaW4gPSBmdW5jdGlvbiBwcmltaXRpdmVXcmFwcGVyKCkge1xuICAgICAgbG9nLmRlYnVnKHRoaXMubmFtZSArICcuaW46JywgdGFyZ2V0KVxuICAgICAgdGhpcy5vdXQodGFyZ2V0KVxuICAgIH1cbiAgICBibHVlcHJpbnQub24gPSBmdW5jdGlvbiBwcmltaXRpdmVXcmFwcGVyKCkge1xuICAgICAgbG9nLmRlYnVnKHRoaXMubmFtZSArICcub246JywgdGFyZ2V0KVxuICAgICAgdGhpcy5vdXQodGFyZ2V0KVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBibHVlcHJpbnRcbn1cblxuZnVuY3Rpb24gZGVib3VuY2UoZnVuYywgd2FpdCwgYmx1ZXByaW50LCBhcmdzKSB7XG4gIGNvbnN0IG5hbWUgPSBmdW5jLm5hbWVcbiAgY2xlYXJUaW1lb3V0KGJsdWVwcmludC5GcmFtZS5kZWJvdW5jZVtuYW1lXSlcbiAgYmx1ZXByaW50LkZyYW1lLmRlYm91bmNlW25hbWVdID0gc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICBkZWxldGUgYmx1ZXByaW50LkZyYW1lLmRlYm91bmNlW25hbWVdXG4gICAgZnVuYy5hcHBseShibHVlcHJpbnQsIGFyZ3MpXG4gIH0sIHdhaXQpXG59XG5cbmZ1bmN0aW9uIHF1ZXVlKGZ1bmMsIGJsdWVwcmludCwgYXJncykge1xuICBpZiAoIWJsdWVwcmludC5GcmFtZS5xdWV1ZSlcbiAgICBibHVlcHJpbnQuRnJhbWUucXVldWUgPSBbXVxuXG4gIC8vIFF1ZXVlIGFycmF5IGlzIHByaW1hcmlseSBmb3IgSURFLlxuICBsZXQgcXVldWVQb3NpdGlvbiA9IGJsdWVwcmludC5GcmFtZS5xdWV1ZS5sZW5ndGhcbiAgYmx1ZXByaW50LkZyYW1lLnF1ZXVlLnB1c2goc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICAvLyBUT0RPOiBDbGVhbnVwIHF1ZXVlXG4gICAgZnVuYy5hcHBseShibHVlcHJpbnQsIGFyZ3MpXG4gIH0sIDEpKVxufVxuXG5mdW5jdGlvbiBmYWN0b3J5KGZuKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gZm4uYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICB9XG59XG5cbi8vIFBpcGUgY29udHJvbFxuZnVuY3Rpb24gYWRkUGlwZShkaXJlY3Rpb24sIHRhcmdldCwgcGFyYW1zKSB7XG4gIGlmICghdGhpcylcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0JsdWVwcmludCBtZXRob2QgY2FsbGVkIHdpdGhvdXQgaW5zdGFuY2UsIGRpZCB5b3UgYXNzaWduIHRoZSBtZXRob2QgdG8gYSB2YXJpYWJsZT8nKVxuXG4gIGlmICghdGhpcy5GcmFtZSB8fCAhdGhpcy5GcmFtZS5waXBlcylcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ05vdCB3b3JraW5nIHdpdGggYSB2YWxpZCBCbHVlcHJpbnQgb2JqZWN0JylcblxuICBpZiAoIXRhcmdldClcbiAgICB0aHJvdyBuZXcgRXJyb3IodGhpcy5GcmFtZS5uYW1lICsgJy4nICsgZGlyZWN0aW9uICsgJygpIHdhcyBjYWxsZWQgd2l0aCBpbXByb3BlciBwYXJhbWV0ZXJzJylcblxuICBpZiAodHlwZW9mIHRhcmdldCA9PT0gJ2Z1bmN0aW9uJyAmJiB0eXBlb2YgdGFyZ2V0LnRvICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgdGFyZ2V0ID0gQmx1ZXByaW50U3R1Yih0YXJnZXQpXG4gIH0gZWxzZSBpZiAodHlwZW9mIHRhcmdldCAhPT0gJ2Z1bmN0aW9uJykge1xuICAgIHRhcmdldCA9IEJsdWVwcmludFN0dWIodGFyZ2V0KVxuICB9XG5cbiAgLy8gRW5zdXJlIHdlJ3JlIHdvcmtpbmcgb24gYSBuZXcgaW5zdGFuY2Ugb2Ygd29ya2VyIGJsdWVwcmludFxuICBsZXQgYmx1ZXByaW50ID0gdGhpc1xuICBpZiAoIWJsdWVwcmludC5GcmFtZS5pbnN0YW5jZSkge1xuICAgIGxvZy5kZWJ1ZygnQ3JlYXRpbmcgbmV3IGluc3RhbmNlIGZvcicsIGJsdWVwcmludC5uYW1lKVxuICAgIGJsdWVwcmludCA9IGJsdWVwcmludChBcnJheS5mcm9tKGJsdWVwcmludC5GcmFtZS5wcm9wcylbMF0pXG4gICAgYmx1ZXByaW50LkZyYW1lLnN0YXRlID0gdGhpcy5GcmFtZS5zdGF0ZSAvLyBUT0RPOiBTaG91bGQgY3JlYXRlIGEgbmV3IHN0YXRlIG9iamVjdD9cbiAgICBibHVlcHJpbnQuRnJhbWUuaW5zdGFuY2UgPSB0cnVlXG4gIH1cblxuICBsb2cuZGVidWcoYmx1ZXByaW50Lm5hbWUgKyAnLicgKyBkaXJlY3Rpb24gKyAnKCk6ICcgKyB0YXJnZXQubmFtZSlcbiAgYmx1ZXByaW50LkZyYW1lLnBpcGVzLnB1c2goeyBkaXJlY3Rpb246IGRpcmVjdGlvbiwgdGFyZ2V0OiB0YXJnZXQsIHBhcmFtczogcGFyYW1zIH0pXG5cbiAgZGVib3VuY2UocHJvY2Vzc0Zsb3csIDEsIGJsdWVwcmludClcbiAgcmV0dXJuIGJsdWVwcmludFxufVxuXG5mdW5jdGlvbiBuZXh0UGlwZShpbmRleCwgZXJyLCBkYXRhKSB7XG4gIGxvZy5kZWJ1ZygnbmV4dDonLCBpbmRleClcblxuICBjb25zdCBmbG93ID0gdGhpcy5GcmFtZS5mbG93XG4gIGNvbnN0IG5leHQgPSBmbG93W2luZGV4XVxuXG4gIGlmIChlcnIpIHtcbiAgICBpZiAoIW5leHQgfHwgIW5leHQudGFyZ2V0KVxuICAgICAgcmV0dXJuIGxvZy5kZWJ1ZygnTm8gZXJyb3IgaGFuZGxlcicpXG5cbiAgICBpZiAobmV4dC50YXJnZXQubmFtZSA9PT0gJ0Vycm9yJykge1xuICAgICAgbmV4dC5jb250ZXh0LmhhbmRsZUVycm9yID0gdHJ1ZVxuICAgICAgZGF0YSA9IGVyclxuICAgIH0gZWxzZSB7XG4gICAgICBpbmRleCsrXG4gICAgICByZXR1cm4gbmV4dFBpcGUuY2FsbCh0aGlzLCBpbmRleCwgZXJyKVxuICAgIH1cbiAgfVxuXG4gIC8vIElmIHdlJ3JlIGF0IHRoZSBlbmQgb2YgdGhlIGZsb3dcbiAgaWYgKCFuZXh0IHx8ICFuZXh0LnRhcmdldCkge1xuICAgIHRoaXMuRnJhbWUucHJvY2Vzc2luZ0Zsb3cgPSBmYWxzZVxuXG4gICAgaWYgKHRoaXMuRnJhbWUuaXNQcm9taXNlZCkge1xuICAgICAgdGhpcy5GcmFtZS5wcm9taXNlLnJlc29sdmUoZGF0YSlcbiAgICAgIHRoaXMuRnJhbWUuaXNQcm9taXNlZCA9IGZhbHNlXG4gICAgfVxuXG4gICAgLy8gSWYgYmx1ZXByaW50IGlzIHBhcnQgb2YgYW5vdGhlciBmbG93XG4gICAgY29uc3QgcGFyZW50cyA9IHRoaXMuRnJhbWUucGFyZW50c1xuICAgIGlmIChwYXJlbnRzLmxlbmd0aCA+IDApIHtcbiAgICAgIGZvciAoY29uc3QgcGFyZW50IG9mIHBhcmVudHMpIHtcbiAgICAgICAgbGV0IGJsdWVwcmludCA9IHBhcmVudC50YXJnZXRcbiAgICAgICAgbG9nLmRlYnVnKCdDYWxsaW5nIHBhcmVudCAnICsgYmx1ZXByaW50Lm5hbWUsICdmb3InLCB0aGlzLm5hbWUpXG4gICAgICAgIHF1ZXVlKG5leHRQaXBlLCBibHVlcHJpbnQsIFswLCBudWxsLCBkYXRhXSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gbG9nLmRlYnVnKCdFbmQgb2YgZmxvdyBmb3InLCB0aGlzLm5hbWUsICdhdCcsIGluZGV4KVxuICB9XG5cbiAgY2FsbE5leHQobmV4dCwgZGF0YSlcbn1cblxuZnVuY3Rpb24gY2FsbE5leHQobmV4dCwgZGF0YSkge1xuICBjb25zdCBibHVlcHJpbnQgPSBuZXh0LnRhcmdldFxuICBjb25zdCBwcm9wcyA9IGRlc3RydWN0dXJlKGJsdWVwcmludC5GcmFtZS5kZXNjcmliZS5pbiwgbmV4dC5wYXJhbXMpXG4gIGNvbnN0IGNvbnRleHQgPSBuZXh0LmNvbnRleHRcbiAgY29uc3QgcmV0VmFsdWUgPSBibHVlcHJpbnQuaW4uY2FsbChjb250ZXh0LCBkYXRhLCBwcm9wcywgbmV3IGZhY3RvcnkocGlwZUNhbGxiYWNrKS5iaW5kKGNvbnRleHQpKVxuICBjb25zdCByZXRUeXBlID0gdHlwZW9mIHJldFZhbHVlXG5cbiAgLy8gQmx1ZXByaW50LmluIGRvZXMgbm90IHJldHVybiBhbnl0aGluZ1xuICBpZiAocmV0VHlwZSA9PT0gJ3VuZGVmaW5lZCcpXG4gICAgcmV0dXJuXG5cbiAgaWYgKHJldFR5cGUgPT09ICdvYmplY3QnICYmIHJldFZhbHVlIGluc3RhbmNlb2YgUHJvbWlzZSkge1xuICAgIC8vIEhhbmRsZSBwcm9taXNlc1xuICAgIHJldFZhbHVlLnRoZW4oY29udGV4dC5vdXQpLmNhdGNoKGNvbnRleHQuZXJyb3IpXG4gIH0gZWxzZSBpZiAocmV0VHlwZSA9PT0gJ29iamVjdCcgJiYgcmV0VmFsdWUgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgIC8vIEhhbmRsZSBlcnJvcnNcbiAgICBjb250ZXh0LmVycm9yKHJldFZhbHVlKVxuICB9IGVsc2Uge1xuICAgIC8vIEhhbmRsZSByZWd1bGFyIHByaW1pdGl2ZXMgYW5kIG9iamVjdHNcbiAgICBjb250ZXh0Lm91dChyZXRWYWx1ZSlcbiAgfVxufVxuXG5mdW5jdGlvbiBwaXBlQ2FsbGJhY2soZXJyLCBkYXRhKSB7XG4gIGlmIChlcnIpXG4gICAgcmV0dXJuIHRoaXMuZXJyb3IoZXJyKVxuXG4gIHJldHVybiB0aGlzLm91dChkYXRhKVxufVxuXG5leHBvcnQgZGVmYXVsdCBCbHVlcHJpbnRNZXRob2RzXG5leHBvcnQgeyBCbHVlcHJpbnRNZXRob2RzLCBkZWJvdW5jZSwgcHJvY2Vzc0Zsb3cgfVxuIiwiJ3VzZSBzdHJpY3QnXG5cbmNvbnN0IEZsb3dTY2hlbWEgPSB7XG4gIGRpcmVjdGlvbjogJycsIC8vIHRvIG9yIGZyb21cbiAgdGFyZ2V0OiBudWxsLFxuICBwYXJhbXM6IFtdLFxuICBjb250ZXh0OiB7XG4gICAgbmFtZTogJycsXG4gICAgc3RhdGU6IHt9LFxuICAgIG91dDogZnVuY3Rpb24oKXt9LFxuICAgIGVycm9yOiBmdW5jdGlvbigpe30sXG4gIH1cbn1cblxuLy8gSW50ZXJuYWwgRnJhbWUgcHJvcHNcbmNvbnN0IEJsdWVwcmludEJhc2UgPSB7XG4gIG5hbWU6ICcnLFxuICBkZXNjcmliZTogWydpbml0JywgJ2luJywgJ291dCddLCAvLyBUT0RPOiBDaGFuZ2UgdG8gb2JqZWN0IGFuZCBtYWtlIHNlcGFyYXRlIHNjaGVtYS4geyBpbml0OiB7IG5hbWU6ICcnLCBkZXNjcmlwdGlvbjogJyB9IH1cbiAgcHJvcHM6IHt9LFxuICBzdGF0ZToge30sXG5cbiAgbG9hZGVkOiBmYWxzZSxcbiAgaW5pdGlhbGl6ZWQ6IGZhbHNlLFxuICBwcm9jZXNzaW5nRmxvdzogZmFsc2UsXG4gIGluc3RhbmNlOiBmYWxzZSxcblxuICBkZWJvdW5jZToge30sXG4gIHF1ZXVlOiBbXSxcbiAgcGFyZW50czogW10sXG5cbiAgcGlwZXM6IFtdLCAvL1tGbG93U2NoZW1hXSxcbiAgZXZlbnRzOiBbXSwgLy9bRmxvd1NjaGVtYV0sXG4gIGZsb3c6IFtdLCAvL1tGbG93U2NoZW1hXSxcblxuICBpc1Byb21pc2VkOiBmYWxzZSxcbiAgcHJvbWlzZToge30sXG59XG5cbmV4cG9ydCBkZWZhdWx0IEJsdWVwcmludEJhc2VcbiIsIid1c2Ugc3RyaWN0J1xuXG4vLyBDb25jZXB0IGJhc2VkIG9uOiBodHRwOi8vb2JqZWN0bW9kZWwuanMub3JnL1xuZnVuY3Rpb24gT2JqZWN0TW9kZWwoc2NoZW1hT2JqKSB7XG4gIGlmICh0eXBlb2Ygc2NoZW1hT2JqID09PSAnZnVuY3Rpb24nKSB7XG4gICAgcmV0dXJuIHsgdHlwZTogc2NoZW1hT2JqLm5hbWUsIGV4cGVjdHM6IHNjaGVtYU9iaiB9XG4gIH0gZWxzZSBpZiAodHlwZW9mIHNjaGVtYU9iaiAhPT0gJ29iamVjdCcpXG4gICAgc2NoZW1hT2JqID0ge31cblxuICAvLyBDbG9uZSBzY2hlbWEgb2JqZWN0IHNvIHdlIGRvbid0IG11dGF0ZSBpdC5cbiAgY29uc3Qgc2NoZW1hID0gT2JqZWN0LmNyZWF0ZShzY2hlbWFPYmopXG4gIE9iamVjdC5hc3NpZ24oc2NoZW1hLCBzY2hlbWFPYmopXG5cbiAgLy8gTG9vcCB0aHJvdWdoIFNjaGVtYSBvYmplY3Qga2V5c1xuICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhzY2hlbWEpKSB7XG4gICAgLy8gQ3JlYXRlIGEgc2NoZW1hIG9iamVjdCB3aXRoIHR5cGVzXG4gICAgaWYgKHR5cGVvZiBzY2hlbWFba2V5XSA9PT0gJ2Z1bmN0aW9uJylcbiAgICAgIHNjaGVtYVtrZXldID0geyByZXF1aXJlZDogdHJ1ZSwgdHlwZTogdHlwZW9mIHNjaGVtYVtrZXldKCkgfVxuICAgIGVsc2UgaWYgKHR5cGVvZiBzY2hlbWFba2V5XSA9PT0gJ29iamVjdCcgJiYgQXJyYXkuaXNBcnJheShzY2hlbWFba2V5XSkpIHtcbiAgICAgIGNvbnN0IHNjaGVtYUFyciA9IHNjaGVtYVtrZXldXG4gICAgICBzY2hlbWFba2V5XSA9IHsgcmVxdWlyZWQ6IGZhbHNlLCB0eXBlOiAnb3B0aW9uYWwnLCB0eXBlczogW10gfVxuICAgICAgZm9yIChjb25zdCBzY2hlbWFUeXBlIG9mIHNjaGVtYUFycikge1xuICAgICAgICBpZiAodHlwZW9mIHNjaGVtYVR5cGUgPT09ICdmdW5jdGlvbicpXG4gICAgICAgICAgc2NoZW1hW2tleV0udHlwZXMucHVzaCh0eXBlb2Ygc2NoZW1hVHlwZSgpKVxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAodHlwZW9mIHNjaGVtYVtrZXldID09PSAnb2JqZWN0JyAmJiBzY2hlbWFba2V5XS50eXBlKSB7XG4gICAgICBzY2hlbWFba2V5XSA9IHsgcmVxdWlyZWQ6IHRydWUsIHR5cGU6IHNjaGVtYVtrZXldLnR5cGUsIGV4cGVjdHM6IHNjaGVtYVtrZXldLmV4cGVjdHMgfVxuICAgIH0gZWxzZSB7XG4gICAgICBzY2hlbWFba2V5XSA9IHsgcmVxdWlyZWQ6IHRydWUsIHR5cGU6IHR5cGVvZiBzY2hlbWFba2V5XSB9XG4gICAgfVxuICB9XG5cbiAgLy8gVmFsaWRhdGUgc2NoZW1hIHByb3BzXG4gIGZ1bmN0aW9uIGlzVmFsaWRTY2hlbWEoa2V5LCB2YWx1ZSkge1xuICAgIC8vIFRPRE86IE1ha2UgbW9yZSBmbGV4aWJsZSBieSBkZWZpbmluZyBudWxsIGFuZCB1bmRlZmluZWQgdHlwZXMuXG4gICAgLy8gTm8gc2NoZW1hIGRlZmluZWQgZm9yIGtleVxuICAgIGlmICghc2NoZW1hW2tleV0pXG4gICAgICByZXR1cm4gdHJ1ZVxuXG4gICAgaWYgKHNjaGVtYVtrZXldLnJlcXVpcmVkICYmIHR5cGVvZiB2YWx1ZSA9PT0gc2NoZW1hW2tleV0udHlwZSkge1xuICAgICAgcmV0dXJuIHRydWVcbiAgICB9IGVsc2UgaWYgKCFzY2hlbWFba2V5XS5yZXF1aXJlZCAmJiBzY2hlbWFba2V5XS50eXBlID09PSAnb3B0aW9uYWwnKSB7XG4gICAgICBpZiAodmFsdWUgJiYgIXNjaGVtYVtrZXldLnR5cGVzLmluY2x1ZGVzKHR5cGVvZiB2YWx1ZSkpXG4gICAgICAgIHJldHVybiBmYWxzZVxuXG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH0gZWxzZSBpZiAoc2NoZW1hW2tleV0ucmVxdWlyZWQgJiYgc2NoZW1hW2tleV0udHlwZSkge1xuICAgICAgaWYgKHR5cGVvZiBzY2hlbWFba2V5XS5leHBlY3RzID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIHJldHVybiBzY2hlbWFba2V5XS5leHBlY3RzKHZhbHVlKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLy8gVmFsaWRhdGUgc2NoZW1hIChvbmNlIFNjaGVtYSBjb25zdHJ1Y3RvciBpcyBjYWxsZWQpXG4gIHJldHVybiBmdW5jdGlvbiB2YWxpZGF0ZVNjaGVtYShvYmpUb1ZhbGlkYXRlKSB7XG4gICAgY29uc3QgcHJveHlPYmogPSB7fVxuICAgIGNvbnN0IG9iaiA9IG9ialRvVmFsaWRhdGVcblxuICAgIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5nZXRPd25Qcm9wZXJ0eU5hbWVzKG9ialRvVmFsaWRhdGUpKSB7XG4gICAgICBjb25zdCBwcm9wRGVzY3JpcHRvciA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3Iob2JqVG9WYWxpZGF0ZSwga2V5KVxuXG4gICAgICAvLyBQcm9wZXJ0eSBhbHJlYWR5IHByb3RlY3RlZFxuICAgICAgaWYgKCFwcm9wRGVzY3JpcHRvci53cml0YWJsZSB8fCAhcHJvcERlc2NyaXB0b3IuY29uZmlndXJhYmxlKSB7XG4gICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShvYmosIGtleSwgcHJvcERlc2NyaXB0b3IpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIC8vIFNjaGVtYSBkb2VzIG5vdCBleGlzdCBmb3IgcHJvcCwgcGFzc3Rocm91Z2hcbiAgICAgIGlmICghc2NoZW1hW2tleV0pIHtcbiAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KG9iaiwga2V5LCBwcm9wRGVzY3JpcHRvcilcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgcHJveHlPYmpba2V5XSA9IG9ialRvVmFsaWRhdGVba2V5XVxuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KG9iaiwga2V5LCB7XG4gICAgICAgIGVudW1lcmFibGU6IHByb3BEZXNjcmlwdG9yLmVudW1lcmFibGUsXG4gICAgICAgIGNvbmZpZ3VyYWJsZTogcHJvcERlc2NyaXB0b3IuY29uZmlndXJhYmxlLFxuICAgICAgICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIHJldHVybiBwcm94eU9ialtrZXldXG4gICAgICAgIH0sXG5cbiAgICAgICAgc2V0OiBmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgICAgIGlmICghaXNWYWxpZFNjaGVtYShrZXksIHZhbHVlKSkge1xuICAgICAgICAgICAgaWYgKHNjaGVtYVtrZXldLmV4cGVjdHMpIHtcbiAgICAgICAgICAgICAgdmFsdWUgPSAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJykgPyB2YWx1ZSA6IHR5cGVvZiB2YWx1ZVxuICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0V4cGVjdGluZyBcIicgKyBrZXkgKyAnXCIgdG8gYmUgXCInICsgc2NoZW1hW2tleV0udHlwZSArICdcIiwgZ290IFwiJyArIHZhbHVlICsgJ1wiJylcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoc2NoZW1hW2tleV0udHlwZSA9PT0gJ29wdGlvbmFsJykge1xuICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0V4cGVjdGluZyBcIicgKyBrZXkgKyAnXCIgdG8gYmUgb25lIG9mIFwiJyArIHNjaGVtYVtrZXldLnR5cGVzICsgJ1wiLCBnb3QgXCInICsgdHlwZW9mIHZhbHVlICsgJ1wiJylcbiAgICAgICAgICAgIH0gZWxzZVxuICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0V4cGVjdGluZyBcIicgKyBrZXkgKyAnXCIgdG8gYmUgYSBcIicgKyBzY2hlbWFba2V5XS50eXBlICsgJ1wiLCBnb3QgXCInICsgdHlwZW9mIHZhbHVlICsgJ1wiJylcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBwcm94eU9ialtrZXldID0gdmFsdWVcbiAgICAgICAgICByZXR1cm4gdmFsdWVcbiAgICAgICAgfSxcbiAgICAgIH0pXG5cbiAgICAgIC8vIEFueSBzY2hlbWEgbGVmdG92ZXIgc2hvdWxkIGJlIGFkZGVkIGJhY2sgdG8gb2JqZWN0IGZvciBmdXR1cmUgcHJvdGVjdGlvblxuICAgICAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMoc2NoZW1hKSkge1xuICAgICAgICBpZiAob2JqW2tleV0pXG4gICAgICAgICAgY29udGludWVcblxuICAgICAgICBwcm94eU9ialtrZXldID0gb2JqVG9WYWxpZGF0ZVtrZXldXG4gICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShvYmosIGtleSwge1xuICAgICAgICAgIGVudW1lcmFibGU6IHByb3BEZXNjcmlwdG9yLmVudW1lcmFibGUsXG4gICAgICAgICAgY29uZmlndXJhYmxlOiBwcm9wRGVzY3JpcHRvci5jb25maWd1cmFibGUsXG4gICAgICAgICAgZ2V0OiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHJldHVybiBwcm94eU9ialtrZXldXG4gICAgICAgICAgfSxcblxuICAgICAgICAgIHNldDogZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgICAgICAgIGlmICghaXNWYWxpZFNjaGVtYShrZXksIHZhbHVlKSkge1xuICAgICAgICAgICAgICBpZiAoc2NoZW1hW2tleV0uZXhwZWN0cykge1xuICAgICAgICAgICAgICAgIHZhbHVlID0gKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpID8gdmFsdWUgOiB0eXBlb2YgdmFsdWVcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0V4cGVjdGluZyBcIicgKyBrZXkgKyAnXCIgdG8gYmUgXCInICsgc2NoZW1hW2tleV0udHlwZSArICdcIiwgZ290IFwiJyArIHZhbHVlICsgJ1wiJylcbiAgICAgICAgICAgICAgfSBlbHNlIGlmIChzY2hlbWFba2V5XS50eXBlID09PSAnb3B0aW9uYWwnKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdFeHBlY3RpbmcgXCInICsga2V5ICsgJ1wiIHRvIGJlIG9uZSBvZiBcIicgKyBzY2hlbWFba2V5XS50eXBlcyArICdcIiwgZ290IFwiJyArIHR5cGVvZiB2YWx1ZSArICdcIicpXG4gICAgICAgICAgICAgIH0gZWxzZVxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRXhwZWN0aW5nIFwiJyArIGtleSArICdcIiB0byBiZSBhIFwiJyArIHNjaGVtYVtrZXldLnR5cGUgKyAnXCIsIGdvdCBcIicgKyB0eXBlb2YgdmFsdWUgKyAnXCInKVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBwcm94eU9ialtrZXldID0gdmFsdWVcbiAgICAgICAgICAgIHJldHVybiB2YWx1ZVxuICAgICAgICAgIH0sXG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIG9ialtrZXldID0gb2JqVG9WYWxpZGF0ZVtrZXldXG4gICAgfVxuXG4gICAgcmV0dXJuIG9ialxuICB9XG59XG5cbk9iamVjdE1vZGVsLlN0cmluZ05vdEJsYW5rID0gT2JqZWN0TW9kZWwoZnVuY3Rpb24gU3RyaW5nTm90Qmxhbmsoc3RyKSB7XG4gIGlmICh0eXBlb2Ygc3RyICE9PSAnc3RyaW5nJylcbiAgICByZXR1cm4gZmFsc2VcblxuICByZXR1cm4gc3RyLnRyaW0oKS5sZW5ndGggPiAwXG59KVxuXG5leHBvcnQgZGVmYXVsdCBPYmplY3RNb2RlbFxuIiwiJ3VzZSBzdHJpY3QnXG5cbmltcG9ydCBPYmplY3RNb2RlbCBmcm9tICcuL09iamVjdE1vZGVsJ1xuXG4vLyBQcm90ZWN0IEJsdWVwcmludCB1c2luZyBhIHNjaGVtYVxuY29uc3QgQmx1ZXByaW50U2NoZW1hID0gbmV3IE9iamVjdE1vZGVsKHtcbiAgbmFtZTogT2JqZWN0TW9kZWwuU3RyaW5nTm90QmxhbmssXG5cbiAgLy8gQmx1ZXByaW50IHByb3ZpZGVzXG4gIGluaXQ6IFtGdW5jdGlvbl0sXG4gIGluOiBbRnVuY3Rpb25dLFxuICBvbjogW0Z1bmN0aW9uXSxcbiAgZGVzY3JpYmU6IFtPYmplY3RdLFxuXG4gIC8vIEludGVybmFsc1xuICBvdXQ6IEZ1bmN0aW9uLFxuICBlcnJvcjogRnVuY3Rpb24sXG4gIGNsb3NlOiBbRnVuY3Rpb25dLFxuXG4gIC8vIFVzZXIgZmFjaW5nXG4gIHRvOiBGdW5jdGlvbixcbiAgZnJvbTogRnVuY3Rpb24sXG5cbiAgdmFsdWU6IEZ1bmN0aW9uLFxufSlcblxuZXhwb3J0IGRlZmF1bHQgQmx1ZXByaW50U2NoZW1hXG4iLCIvLyBUT0RPOiBNb2R1bGVGYWN0b3J5KCkgZm9yIGxvYWRlciwgd2hpY2ggcGFzc2VzIHRoZSBsb2FkZXIgKyBwcm90b2NvbCBpbnRvIGl0Li4gVGhhdCB3YXkgaXQncyByZWN1cnNpdmUuLi5cblxuZnVuY3Rpb24gTW9kdWxlKF9fZmlsZW5hbWUsIGZpbGVDb250ZW50cywgY2FsbGJhY2spIHtcbiAgLy8gRnJvbSBpaWZlIGNvZGVcbiAgaWYgKCFmaWxlQ29udGVudHMpXG4gICAgX19maWxlbmFtZSA9IF9fZmlsZW5hbWUucGF0aCB8fCAnJ1xuXG4gIHZhciBtb2R1bGUgPSB7XG4gICAgZmlsZW5hbWU6IF9fZmlsZW5hbWUsXG4gICAgZXhwb3J0czoge30sXG4gICAgQmx1ZXByaW50OiBudWxsLFxuICAgIHJlc29sdmU6IHt9LFxuXG4gICAgcmVxdWlyZTogZnVuY3Rpb24odXJsLCBjYWxsYmFjaykge1xuICAgICAgbGV0IGZpbGVQYXRoXG5cbiAgICAgIGlmICh1cmwuaW5kZXhPZignLi8nKSAhPT0gLTEpIHtcbiAgICAgICAgZmlsZVBhdGggPSB1cmxcbiAgICAgIH0gZWxzZSBpZiAodXJsLmluZGV4T2YoJ2h0dHAnKSAhPT0gLTEpIHtcbiAgICAgICAgZmlsZVBhdGggPSB1cmw7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBmaWxlUGF0aCA9ICcuLi9ub2RlX21vZHVsZXMvJyArIHVybFxuICAgICAgfVxuXG4gICAgICByZXR1cm4gd2luZG93Lmh0dHAubW9kdWxlLmluLmNhbGwod2luZG93Lmh0dHAubW9kdWxlLCBmaWxlUGF0aCwgbnVsbCwgY2FsbGJhY2ssIHRydWUpXG4gICAgfSxcbiAgfVxuXG4gIGlmICghY2FsbGJhY2spXG4gICAgcmV0dXJuIG1vZHVsZVxuXG4gIG1vZHVsZS5yZXNvbHZlW21vZHVsZS5maWxlbmFtZV0gPSBmdW5jdGlvbihleHBvcnRzKSB7XG4gICAgY2FsbGJhY2sobnVsbCwgZXhwb3J0cylcbiAgICBkZWxldGUgbW9kdWxlLnJlc29sdmVbbW9kdWxlLmZpbGVuYW1lXVxuICB9XG5cbiAgY29uc3Qgc2NyaXB0ID0gJ21vZHVsZS5yZXNvbHZlW1wiJyArIF9fZmlsZW5hbWUgKyAnXCJdKGZ1bmN0aW9uKGlpZmVNb2R1bGUpe1xcbicgK1xuICAnICB2YXIgbW9kdWxlID0gTW9kdWxlKGlpZmVNb2R1bGUpXFxuJyArXG4gICcgIHZhciBfX2ZpbGVuYW1lID0gbW9kdWxlLmZpbGVuYW1lXFxuJyArXG4gICcgIHZhciBfX2Rpcm5hbWUgPSBfX2ZpbGVuYW1lLnNsaWNlKDAsIF9fZmlsZW5hbWUubGFzdEluZGV4T2YoXCIvXCIpKVxcbicgK1xuICAnICB2YXIgcmVxdWlyZSA9IG1vZHVsZS5yZXF1aXJlXFxuJyArXG4gICcgIHZhciBleHBvcnRzID0gbW9kdWxlLmV4cG9ydHNcXG4nICtcbiAgJyAgdmFyIHByb2Nlc3MgPSB7IGJyb3dzZXI6IHRydWUgfVxcbicgK1xuICAnICB2YXIgQmx1ZXByaW50ID0gbnVsbDtcXG5cXG4nICtcblxuICAnKGZ1bmN0aW9uKCkge1xcbicgKyAvLyBDcmVhdGUgSUlGRSBmb3IgbW9kdWxlL2JsdWVwcmludFxuICAnXCJ1c2Ugc3RyaWN0XCI7XFxuJyArXG4gICAgZmlsZUNvbnRlbnRzICsgJ1xcbicgK1xuICAnfSkuY2FsbChtb2R1bGUuZXhwb3J0cyk7XFxuJyArIC8vIENyZWF0ZSAndGhpcycgYmluZGluZy5cbiAgJyAgaWYgKEJsdWVwcmludCkgeyByZXR1cm4gQmx1ZXByaW50fVxcbicgK1xuICAnICByZXR1cm4gbW9kdWxlLmV4cG9ydHNcXG4nICtcbiAgJ30obW9kdWxlKSk7J1xuXG4gIHdpbmRvdy5tb2R1bGUgPSBtb2R1bGVcbiAgd2luZG93Lmdsb2JhbCA9IHdpbmRvd1xuICB3aW5kb3cuTW9kdWxlID0gTW9kdWxlXG5cbiAgd2luZG93LnJlcXVpcmUgPSBtb2R1bGUucmVxdWlyZVxuXG4gIHJldHVybiBzY3JpcHRcbn1cblxuZXhwb3J0IGRlZmF1bHQgTW9kdWxlXG4iLCJpbXBvcnQgbG9nIGZyb20gJy4uLy4uL2xpYi9sb2dnZXInXG5pbXBvcnQgTW9kdWxlIGZyb20gJy4uLy4uL2xpYi9Nb2R1bGVMb2FkZXInXG5pbXBvcnQgZXhwb3J0ZXIgZnJvbSAnLi4vLi4vbGliL2V4cG9ydHMnXG5cbi8vIEVtYmVkZGVkIGh0dHAgbG9hZGVyIGJsdWVwcmludC5cbmNvbnN0IGh0dHBMb2FkZXIgPSB7XG4gIG5hbWU6ICdsb2FkZXJzL2h0dHAnLFxuICBwcm90b2NvbDogJ2xvYWRlcicsIC8vIGVtYmVkZGVkIGxvYWRlclxuXG4gIC8vIEludGVybmFscyBmb3IgZW1iZWRcbiAgbG9hZGVkOiB0cnVlLFxuICBjYWxsYmFja3M6IFtdLFxuXG4gIG1vZHVsZToge1xuICAgIG5hbWU6ICdIVFRQIExvYWRlcicsXG4gICAgcHJvdG9jb2w6IFsnaHR0cCcsICdodHRwcycsICd3ZWI6Ly8nXSwgLy8gVE9ETzogQ3JlYXRlIGEgd2F5IGZvciBsb2FkZXIgdG8gc3Vic2NyaWJlIHRvIG11bHRpcGxlIHByb3RvY29sc1xuXG4gICAgaW5pdDogZnVuY3Rpb24oKSB7XG4gICAgICB0aGlzLmlzQnJvd3NlciA9ICh0eXBlb2Ygd2luZG93ID09PSAnb2JqZWN0JykgPyB0cnVlIDogZmFsc2VcbiAgICB9LFxuXG4gICAgaW46IGZ1bmN0aW9uKGZpbGVOYW1lLCBvcHRzLCBjYWxsYmFjaywgc2tpcE5vcm1hbGl6YXRpb24pIHtcbiAgICAgIGlmICghdGhpcy5pc0Jyb3dzZXIpXG4gICAgICAgIHJldHVybiBjYWxsYmFjaygnVVJMIGxvYWRpbmcgd2l0aCBub2RlLmpzIG5vdCBzdXBwb3J0ZWQgeWV0IChDb21pbmcgc29vbiEpLicpXG5cbiAgICAgIHJldHVybiB0aGlzLmJyb3dzZXIubG9hZC5jYWxsKHRoaXMsIGZpbGVOYW1lLCBjYWxsYmFjaywgc2tpcE5vcm1hbGl6YXRpb24pXG4gICAgfSxcblxuICAgIG5vcm1hbGl6ZUZpbGVQYXRoOiBmdW5jdGlvbihmaWxlTmFtZSkge1xuICAgICAgaWYgKGZpbGVOYW1lLmluZGV4T2YoJ2h0dHAnKSA+PSAwKVxuICAgICAgICByZXR1cm4gZmlsZU5hbWVcblxuICAgICAgY29uc3QgZmlsZSA9IGZpbGVOYW1lICsgKChmaWxlTmFtZS5pbmRleE9mKCcuanMnKSA9PT0gLTEpID8gJy5qcycgOiAnJylcbiAgICAgIGNvbnN0IGZpbGVQYXRoID0gJ2JsdWVwcmludHMvJyArIGZpbGVcbiAgICAgIHJldHVybiBmaWxlUGF0aFxuICAgIH0sXG5cbiAgICBicm93c2VyOiB7XG4gICAgICBsb2FkOiBmdW5jdGlvbihmaWxlTmFtZSwgY2FsbGJhY2ssIHNraXBOb3JtYWxpemF0aW9uKSB7XG4gICAgICAgIGNvbnN0IGZpbGVQYXRoID0gKCFza2lwTm9ybWFsaXphdGlvbikgPyB0aGlzLm5vcm1hbGl6ZUZpbGVQYXRoKGZpbGVOYW1lKSA6IGZpbGVOYW1lXG4gICAgICAgIGxvZy5kZWJ1ZygnW2h0dHAgbG9hZGVyXSBMb2FkaW5nIGZpbGU6ICcgKyBmaWxlUGF0aClcblxuICAgICAgICB2YXIgaXNBc3luYyA9IHRydWVcbiAgICAgICAgdmFyIHN5bmNGaWxlID0gbnVsbFxuICAgICAgICBpZiAoIWNhbGxiYWNrKSB7XG4gICAgICAgICAgaXNBc3luYyA9IGZhbHNlXG4gICAgICAgICAgY2FsbGJhY2sgPSBmdW5jdGlvbihlcnIsIGZpbGUpIHtcbiAgICAgICAgICAgIGlmIChlcnIpXG4gICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihlcnIpXG5cbiAgICAgICAgICAgIHJldHVybiBzeW5jRmlsZSA9IGZpbGVcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBzY3JpcHRSZXF1ZXN0ID0gbmV3IFhNTEh0dHBSZXF1ZXN0KClcblxuICAgICAgICAvLyBUT0RPOiBOZWVkcyB2YWxpZGF0aW5nIHRoYXQgZXZlbnQgaGFuZGxlcnMgd29yayBhY3Jvc3MgYnJvd3NlcnMuIE1vcmUgc3BlY2lmaWNhbGx5LCB0aGF0IHRoZXkgcnVuIG9uIEVTNSBlbnZpcm9ubWVudHMuXG4gICAgICAgIC8vIGh0dHBzOi8vZGV2ZWxvcGVyLm1vemlsbGEub3JnL2VuLVVTL2RvY3MvV2ViL0FQSS9YTUxIdHRwUmVxdWVzdCNCcm93c2VyX2NvbXBhdGliaWxpdHlcbiAgICAgICAgY29uc3Qgc2NyaXB0RXZlbnRzID0gbmV3IHRoaXMuYnJvd3Nlci5zY3JpcHRFdmVudHModGhpcywgZmlsZU5hbWUsIGNhbGxiYWNrKVxuICAgICAgICBzY3JpcHRSZXF1ZXN0LmFkZEV2ZW50TGlzdGVuZXIoJ2xvYWQnLCBzY3JpcHRFdmVudHMub25Mb2FkKVxuICAgICAgICBzY3JpcHRSZXF1ZXN0LmFkZEV2ZW50TGlzdGVuZXIoJ2Vycm9yJywgc2NyaXB0RXZlbnRzLm9uRXJyb3IpXG5cbiAgICAgICAgc2NyaXB0UmVxdWVzdC5vcGVuKCdHRVQnLCBmaWxlUGF0aCwgaXNBc3luYylcbiAgICAgICAgc2NyaXB0UmVxdWVzdC5zZW5kKG51bGwpXG5cbiAgICAgICAgcmV0dXJuIHN5bmNGaWxlXG4gICAgICB9LFxuXG4gICAgICBzY3JpcHRFdmVudHM6IGZ1bmN0aW9uKGxvYWRlciwgZmlsZU5hbWUsIGNhbGxiYWNrKSB7XG4gICAgICAgIHRoaXMuY2FsbGJhY2sgPSBjYWxsYmFja1xuICAgICAgICB0aGlzLmZpbGVOYW1lID0gZmlsZU5hbWVcbiAgICAgICAgdGhpcy5vbkxvYWQgPSBsb2FkZXIuYnJvd3Nlci5vbkxvYWQuY2FsbCh0aGlzLCBsb2FkZXIpXG4gICAgICAgIHRoaXMub25FcnJvciA9IGxvYWRlci5icm93c2VyLm9uRXJyb3IuY2FsbCh0aGlzLCBsb2FkZXIpXG4gICAgICB9LFxuXG4gICAgICBvbkxvYWQ6IGZ1bmN0aW9uKGxvYWRlcikge1xuICAgICAgICBjb25zdCBzY3JpcHRFdmVudHMgPSB0aGlzXG4gICAgICAgIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICAgICAgICBjb25zdCBzY3JpcHRSZXF1ZXN0ID0gdGhpc1xuXG4gICAgICAgICAgaWYgKHNjcmlwdFJlcXVlc3Quc3RhdHVzID4gNDAwKVxuICAgICAgICAgICAgcmV0dXJuIHNjcmlwdEV2ZW50cy5vbkVycm9yLmNhbGwoc2NyaXB0UmVxdWVzdCwgc2NyaXB0UmVxdWVzdC5zdGF0dXNUZXh0KVxuXG4gICAgICAgICAgY29uc3Qgc2NyaXB0Q29udGVudCA9IE1vZHVsZShzY3JpcHRSZXF1ZXN0LnJlc3BvbnNlVVJMLCBzY3JpcHRSZXF1ZXN0LnJlc3BvbnNlVGV4dCwgc2NyaXB0RXZlbnRzLmNhbGxiYWNrKVxuXG4gICAgICAgICAgdmFyIGh0bWwgPSBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnRcbiAgICAgICAgICB2YXIgc2NyaXB0VGFnID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc2NyaXB0JylcbiAgICAgICAgICBzY3JpcHRUYWcudGV4dENvbnRlbnQgPSBzY3JpcHRDb250ZW50XG5cbiAgICAgICAgICBodG1sLmFwcGVuZENoaWxkKHNjcmlwdFRhZylcbiAgICAgICAgICBsb2FkZXIuYnJvd3Nlci5jbGVhbnVwKHNjcmlwdFRhZywgc2NyaXB0RXZlbnRzKVxuICAgICAgICB9XG4gICAgICB9LFxuXG4gICAgICBvbkVycm9yOiBmdW5jdGlvbihsb2FkZXIpIHtcbiAgICAgICAgY29uc3Qgc2NyaXB0RXZlbnRzID0gdGhpc1xuICAgICAgICBjb25zdCBmaWxlTmFtZSA9IHNjcmlwdEV2ZW50cy5maWxlTmFtZVxuXG4gICAgICAgIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICAgICAgICBjb25zdCBzY3JpcHRUYWcgPSB0aGlzXG4gICAgICAgICAgbG9hZGVyLmJyb3dzZXIuY2xlYW51cChzY3JpcHRUYWcsIHNjcmlwdEV2ZW50cylcblxuICAgICAgICAgIC8vIFRyeSB0byBmYWxsYmFjayB0byBpbmRleC5qc1xuICAgICAgICAgIC8vIEZJWE1FOiBpbnN0ZWFkIG9mIGZhbGxpbmcgYmFjaywgdGhpcyBzaG91bGQgYmUgdGhlIGRlZmF1bHQgaWYgbm8gYC5qc2AgaXMgZGV0ZWN0ZWQsIGJ1dCBVUkwgdWdsaWZpZXJzIGFuZCBzdWNoIHdpbGwgaGF2ZSBpc3N1ZXMuLiBocm1tbW0uLlxuICAgICAgICAgIGlmIChmaWxlTmFtZS5pbmRleE9mKCcuanMnKSA9PT0gLTEgJiYgZmlsZU5hbWUuaW5kZXhPZignaW5kZXguanMnKSA9PT0gLTEpIHtcbiAgICAgICAgICAgIGxvZy53YXJuKCdbaHR0cF0gQXR0ZW1wdGluZyB0byBmYWxsYmFjayB0bzogJywgZmlsZU5hbWUgKyAnL2luZGV4LmpzJylcbiAgICAgICAgICAgIHJldHVybiBsb2FkZXIuaW4uY2FsbChsb2FkZXIsIGZpbGVOYW1lICsgJy9pbmRleC5qcycsIHNjcmlwdEV2ZW50cy5jYWxsYmFjaylcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBzY3JpcHRFdmVudHMuY2FsbGJhY2soJ0NvdWxkIG5vdCBsb2FkIEJsdWVwcmludCcpXG4gICAgICAgIH1cbiAgICAgIH0sXG5cbiAgICAgIGNsZWFudXA6IGZ1bmN0aW9uKHNjcmlwdFRhZywgc2NyaXB0RXZlbnRzKSB7XG4gICAgICAgIHNjcmlwdFRhZy5yZW1vdmVFdmVudExpc3RlbmVyKCdsb2FkJywgc2NyaXB0RXZlbnRzLm9uTG9hZClcbiAgICAgICAgc2NyaXB0VGFnLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ2Vycm9yJywgc2NyaXB0RXZlbnRzLm9uRXJyb3IpXG4gICAgICAgIC8vZG9jdW1lbnQuZ2V0RWxlbWVudHNCeVRhZ05hbWUoJ2hlYWQnKVswXS5yZW1vdmVDaGlsZChzY3JpcHRUYWcpIC8vIFRPRE86IENsZWFudXBcbiAgICAgIH0sXG4gICAgfSxcblxuICAgIG5vZGU6IHtcbiAgICAgIC8vIFN0dWIgZm9yIG5vZGUuanMgSFRUUCBsb2FkaW5nIHN1cHBvcnQuXG4gICAgfSxcblxuICB9LFxufVxuXG5leHBvcnRlcignaHR0cCcsIGh0dHBMb2FkZXIpIC8vIFRPRE86IENsZWFudXAsIGV4cG9zZSBtb2R1bGVzIGluc3RlYWRcblxuZXhwb3J0IGRlZmF1bHQgaHR0cExvYWRlclxuIiwiaW1wb3J0IGxvZyBmcm9tICcuLi8uLi9saWIvbG9nZ2VyJ1xuXG4vLyBFbWJlZGRlZCBmaWxlIGxvYWRlciBibHVlcHJpbnQuXG5jb25zdCBmaWxlTG9hZGVyID0ge1xuICBuYW1lOiAnbG9hZGVycy9maWxlJyxcbiAgcHJvdG9jb2w6ICdlbWJlZCcsXG5cbiAgLy8gSW50ZXJuYWxzIGZvciBlbWJlZFxuICBsb2FkZWQ6IHRydWUsXG4gIGNhbGxiYWNrczogW10sXG5cbiAgbW9kdWxlOiB7XG4gICAgbmFtZTogJ0ZpbGUgTG9hZGVyJyxcbiAgICBwcm90b2NvbDogJ2ZpbGUnLFxuXG4gICAgaW5pdDogZnVuY3Rpb24oKSB7XG4gICAgICB0aGlzLmlzQnJvd3NlciA9ICh0eXBlb2Ygd2luZG93ID09PSAnb2JqZWN0JykgPyB0cnVlIDogZmFsc2VcbiAgICB9LFxuXG4gICAgaW46IGZ1bmN0aW9uKGZpbGVOYW1lLCBvcHRzLCBjYWxsYmFjaykge1xuICAgICAgaWYgKHRoaXMuaXNCcm93c2VyKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ZpbGU6Ly8gbG9hZGluZyB3aXRoaW4gYnJvd3NlciBub3Qgc3VwcG9ydGVkIHlldC4gVHJ5IHJlbGF0aXZlIFVSTCBpbnN0ZWFkLicpXG5cbiAgICAgIGxvZy5kZWJ1ZygnW2ZpbGUgbG9hZGVyXSBMb2FkaW5nIGZpbGU6ICcgKyBmaWxlTmFtZSlcblxuICAgICAgLy8gVE9ETzogU3dpdGNoIHRvIGFzeW5jIGZpbGUgbG9hZGluZywgaW1wcm92ZSByZXF1aXJlKCksIHBhc3MgaW4gSUlGRSB0byBzYW5kYm94LCB1c2UgSUlGRSByZXNvbHZlciBmb3IgY2FsbGJhY2tcbiAgICAgIC8vIFRPRE86IEFkZCBlcnJvciByZXBvcnRpbmcuXG5cbiAgICAgIGNvbnN0IHZtID0gcmVxdWlyZSgndm0nKVxuICAgICAgY29uc3QgZnMgPSByZXF1aXJlKCdmcycpXG5cbiAgICAgIGNvbnN0IGZpbGVQYXRoID0gdGhpcy5ub3JtYWxpemVGaWxlUGF0aChmaWxlTmFtZSlcblxuICAgICAgY29uc3QgZmlsZSA9IHRoaXMucmVzb2x2ZUZpbGUoZmlsZVBhdGgpXG4gICAgICBpZiAoIWZpbGUpXG4gICAgICAgIHJldHVybiBjYWxsYmFjaygnQmx1ZXByaW50IG5vdCBmb3VuZCcpXG5cbiAgICAgIGNvbnN0IGZpbGVDb250ZW50cyA9IGZzLnJlYWRGaWxlU3luYyhmaWxlKS50b1N0cmluZygpXG5cbiAgICAgIC8vIFRPRE86IENyZWF0ZSBhIG1vcmUgY29tcGxldGUgc2FuZGJveCBvYmplY3RcbiAgICAgIGNvbnN0IHNhbmRib3ggPSB7XG4gICAgICAgIEJsdWVwcmludDogbnVsbCxcbiAgICAgICAgcmVxdWlyZTogZnVuY3Rpb24obW9kdWxlRmlsZSkgeyByZXR1cm4gcmVxdWlyZShmaWxlUGF0aCArICcvbm9kZV9tb2R1bGVzLycgKyBtb2R1bGVGaWxlKSB9LFxuICAgICAgICBjb25zb2xlOiB7IGxvZzogbG9nLCBlcnJvcjogbG9nLmVycm9yLCB3YXJuOiBsb2cud2FybiwgaW5mbzogbG9nLmluZm8gfSxcbiAgICAgICAgZ2xvYmFsOiBnbG9iYWwsXG4gICAgICAgIG1vZHVsZTogbW9kdWxlLFxuICAgICAgICBfX2Rpcm5hbWU6IGZpbGVQYXRoLFxuICAgICAgfVxuXG4gICAgICB2bS5jcmVhdGVDb250ZXh0KHNhbmRib3gpXG4gICAgICB2bS5ydW5JbkNvbnRleHQoZmlsZUNvbnRlbnRzLCBzYW5kYm94KVxuICAgICAgY2FsbGJhY2sobnVsbCwgc2FuZGJveC5CbHVlcHJpbnQpXG4gICAgfSxcblxuICAgIG5vcm1hbGl6ZUZpbGVQYXRoOiBmdW5jdGlvbihmaWxlTmFtZSkge1xuICAgICAgY29uc3QgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKVxuICAgICAgcmV0dXJuIHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCAnYmx1ZXByaW50cy8nLCBmaWxlTmFtZSlcbiAgICB9LFxuXG4gICAgcmVzb2x2ZUZpbGU6IGZ1bmN0aW9uKGZpbGVQYXRoKSB7XG4gICAgICBjb25zdCBmcyA9IHJlcXVpcmUoJ2ZzJylcbiAgICAgIGNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJylcblxuICAgICAgLy8gSWYgZmlsZSBvciBkaXJlY3RvcnkgZXhpc3RzXG4gICAgICBpZiAoZnMuZXhpc3RzU3luYyhmaWxlUGF0aCkpIHtcbiAgICAgICAgLy8gQ2hlY2sgaWYgYmx1ZXByaW50IGlzIGEgZGlyZWN0b3J5IGZpcnN0XG4gICAgICAgIGlmIChmcy5zdGF0U3luYyhmaWxlUGF0aCkuaXNEaXJlY3RvcnkoKSlcbiAgICAgICAgICByZXR1cm4gcGF0aC5yZXNvbHZlKGZpbGVQYXRoLCAnaW5kZXguanMnKVxuICAgICAgICBlbHNlXG4gICAgICAgICAgcmV0dXJuIGZpbGVQYXRoICsgKChmaWxlUGF0aC5pbmRleE9mKCcuanMnKSA9PT0gLTEpID8gJy5qcycgOiAnJylcbiAgICAgIH1cblxuICAgICAgLy8gVHJ5IGFkZGluZyBhbiBleHRlbnNpb24gdG8gc2VlIGlmIGl0IGV4aXN0c1xuICAgICAgY29uc3QgZmlsZSA9IGZpbGVQYXRoICsgKChmaWxlUGF0aC5pbmRleE9mKCcuanMnKSA9PT0gLTEpID8gJy5qcycgOiAnJylcbiAgICAgIGlmIChmcy5leGlzdHNTeW5jKGZpbGUpKVxuICAgICAgICByZXR1cm4gZmlsZVxuXG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9LFxuICB9LFxufVxuXG5cbmV4cG9ydCBkZWZhdWx0IGZpbGVMb2FkZXJcbiIsIi8qIGVzbGludC1kaXNhYmxlIHByZWZlci10ZW1wbGF0ZSAqL1xuaW1wb3J0IGxvZyBmcm9tICcuL2xvZ2dlcidcbmltcG9ydCBodHRwTG9hZGVyIGZyb20gJy4uL2JsdWVwcmludHMvbG9hZGVycy9odHRwJ1xuaW1wb3J0IGZpbGVMb2FkZXIgZnJvbSAnLi4vYmx1ZXByaW50cy9sb2FkZXJzL2ZpbGUnXG5cbi8vIE11bHRpLWVudmlyb25tZW50IGFzeW5jIG1vZHVsZSBsb2FkZXJcbmNvbnN0IG1vZHVsZXMgPSB7XG4gICdsb2FkZXJzL2h0dHAnOiBodHRwTG9hZGVyLFxuICAnbG9hZGVycy9maWxlJzogZmlsZUxvYWRlcixcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplTmFtZShuYW1lKSB7XG4gIC8vIFRPRE86IGxvb3AgdGhyb3VnaCBlYWNoIGZpbGUgcGF0aCBhbmQgbm9ybWFsaXplIGl0IHRvbzpcbiAgcmV0dXJuIG5hbWUudHJpbSgpLnRvTG93ZXJDYXNlKCkvLy5jYXBpdGFsaXplKClcbn1cblxuZnVuY3Rpb24gcmVzb2x2ZUZpbGVJbmZvKGZpbGUpIHtcbiAgY29uc3Qgbm9ybWFsaXplZEZpbGVOYW1lID0gbm9ybWFsaXplTmFtZShmaWxlKVxuICBjb25zdCBwcm90b2NvbCA9IHBhcnNlUHJvdG9jb2woZmlsZSlcblxuICByZXR1cm4ge1xuICAgIGZpbGU6IGZpbGUsXG4gICAgcGF0aDogZmlsZSxcbiAgICBuYW1lOiBub3JtYWxpemVkRmlsZU5hbWUsXG4gICAgcHJvdG9jb2w6IHByb3RvY29sLFxuICB9XG59XG5cbmZ1bmN0aW9uIHBhcnNlUHJvdG9jb2wobmFtZSkge1xuICAvLyBGSVhNRTogbmFtZSBzaG91bGQgb2YgYmVlbiBub3JtYWxpemVkIGJ5IG5vdy4gRWl0aGVyIHJlbW92ZSB0aGlzIGNvZGUgb3IgbW92ZSBpdCBzb21ld2hlcmUgZWxzZS4uXG4gIGlmICghbmFtZSB8fCB0eXBlb2YgbmFtZSAhPT0gJ3N0cmluZycpXG4gICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIGxvYWRlciBibHVlcHJpbnQgbmFtZScpXG5cbiAgdmFyIHByb3RvUmVzdWx0cyA9IG5hbWUubWF0Y2goLzpcXC9cXC8vZ2kpICYmIG5hbWUuc3BsaXQoLzpcXC9cXC8vZ2kpXG5cbiAgLy8gTm8gcHJvdG9jb2wgZm91bmQsIGlmIGJyb3dzZXIgZW52aXJvbm1lbnQgdGhlbiBpcyByZWxhdGl2ZSBVUkwgZWxzZSBpcyBhIGZpbGUgcGF0aC4gKFNhbmUgZGVmYXVsdHMgYnV0IGNhbiBiZSBvdmVycmlkZGVuKVxuICBpZiAoIXByb3RvUmVzdWx0cylcbiAgICByZXR1cm4gKHR5cGVvZiB3aW5kb3cgPT09ICdvYmplY3QnKSA/ICdodHRwJyA6ICdmaWxlJ1xuXG4gIHJldHVybiBwcm90b1Jlc3VsdHNbMF1cbn1cblxuZnVuY3Rpb24gcnVuTW9kdWxlQ2FsbGJhY2tzKG1vZHVsZSkge1xuICBmb3IgKGNvbnN0IGNhbGxiYWNrIG9mIG1vZHVsZS5jYWxsYmFja3MpIHtcbiAgICBjYWxsYmFjayhtb2R1bGUubW9kdWxlKVxuICB9XG5cbiAgbW9kdWxlLmNhbGxiYWNrcyA9IFtdXG59XG5cbmNvbnN0IGltcG9ydHMgPSBmdW5jdGlvbihuYW1lLCBvcHRzLCBjYWxsYmFjaykge1xuICB0cnkge1xuICAgIGNvbnN0IGZpbGVJbmZvID0gcmVzb2x2ZUZpbGVJbmZvKG5hbWUpXG4gICAgY29uc3QgZmlsZU5hbWUgPSBmaWxlSW5mby5uYW1lXG4gICAgY29uc3QgcHJvdG9jb2wgPSBmaWxlSW5mby5wcm90b2NvbFxuXG4gICAgbG9nLmRlYnVnKCdsb2FkaW5nIG1vZHVsZTonLCBmaWxlTmFtZSlcblxuICAgIC8vIE1vZHVsZSBoYXMgbG9hZGVkIG9yIHN0YXJ0ZWQgdG8gbG9hZFxuICAgIGlmIChtb2R1bGVzW2ZpbGVOYW1lXSlcbiAgICAgIGlmIChtb2R1bGVzW2ZpbGVOYW1lXS5sb2FkZWQpXG4gICAgICAgIHJldHVybiBjYWxsYmFjayhtb2R1bGVzW2ZpbGVOYW1lXS5tb2R1bGUpIC8vIFJldHVybiBtb2R1bGUgZnJvbSBDYWNoZVxuICAgICAgZWxzZVxuICAgICAgICByZXR1cm4gbW9kdWxlc1tmaWxlTmFtZV0uY2FsbGJhY2tzLnB1c2goY2FsbGJhY2spIC8vIE5vdCBsb2FkZWQgeWV0LCByZWdpc3RlciBjYWxsYmFja1xuXG4gICAgbW9kdWxlc1tmaWxlTmFtZV0gPSB7XG4gICAgICBmaWxlTmFtZTogZmlsZU5hbWUsXG4gICAgICBwcm90b2NvbDogcHJvdG9jb2wsXG4gICAgICBsb2FkZWQ6IGZhbHNlLFxuICAgICAgY2FsbGJhY2tzOiBbY2FsbGJhY2tdLFxuICAgIH1cblxuICAgIC8vIEJvb3RzdHJhcHBpbmcgbG9hZGVyIGJsdWVwcmludHMgOylcbiAgICAvL0ZyYW1lKCdMb2FkZXJzLycgKyBwcm90b2NvbCkuZnJvbShmaWxlTmFtZSkudG8oZmlsZU5hbWUsIG9wdHMsIGZ1bmN0aW9uKGVyciwgZXhwb3J0RmlsZSkge30pXG5cbiAgICBjb25zdCBsb2FkZXIgPSAnbG9hZGVycy8nICsgcHJvdG9jb2xcbiAgICBtb2R1bGVzW2xvYWRlcl0ubW9kdWxlLmluaXQoKSAvLyBUT0RPOiBvcHRpb25hbCBpbml0IChpbnNpZGUgRnJhbWUgY29yZSlcbiAgICBtb2R1bGVzW2xvYWRlcl0ubW9kdWxlLmluKGZpbGVOYW1lLCBvcHRzLCBmdW5jdGlvbihlcnIsIGV4cG9ydEZpbGUpe1xuICAgICAgaWYgKGVycilcbiAgICAgICAgbG9nLmVycm9yKCdFcnJvcjogJywgZXJyLCBmaWxlTmFtZSlcbiAgICAgIGVsc2Uge1xuICAgICAgICBsb2cuZGVidWcoJ0xvYWRlZCBCbHVlcHJpbnQgbW9kdWxlOiAnLCBmaWxlTmFtZSlcblxuICAgICAgICBpZiAoIWV4cG9ydEZpbGUgfHwgdHlwZW9mIGV4cG9ydEZpbGUgIT09ICdvYmplY3QnKVxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBCbHVlcHJpbnQgZmlsZSwgQmx1ZXByaW50IGlzIGV4cGVjdGVkIHRvIGJlIGFuIG9iamVjdCBvciBjbGFzcycpXG5cbiAgICAgICAgaWYgKHR5cGVvZiBleHBvcnRGaWxlLm5hbWUgIT09ICdzdHJpbmcnKVxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBCbHVlcHJpbnQgZmlsZSwgQmx1ZXByaW50IG1pc3NpbmcgYSBuYW1lJylcblxuICAgICAgICBjb25zdCBtb2R1bGUgPSBtb2R1bGVzW2ZpbGVOYW1lXVxuICAgICAgICBpZiAoIW1vZHVsZSlcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1VoIG9oLCB3ZSBzaG91bGRudCBiZSBoZXJlJylcblxuICAgICAgICAvLyBNb2R1bGUgYWxyZWFkeSBsb2FkZWQuIE5vdCBzdXBwb3NlIHRvIGJlIGhlcmUuIE9ubHkgZnJvbSBmb3JjZS1sb2FkaW5nIHdvdWxkIGdldCB5b3UgaGVyZS5cbiAgICAgICAgaWYgKG1vZHVsZS5sb2FkZWQpXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdCbHVlcHJpbnQgXCInICsgZXhwb3J0RmlsZS5uYW1lICsgJ1wiIGFscmVhZHkgbG9hZGVkLicpXG5cbiAgICAgICAgbW9kdWxlLm1vZHVsZSA9IGV4cG9ydEZpbGVcbiAgICAgICAgbW9kdWxlLmxvYWRlZCA9IHRydWVcblxuICAgICAgICBydW5Nb2R1bGVDYWxsYmFja3MobW9kdWxlKVxuICAgICAgfVxuICAgIH0pXG5cbiAgICAvLyBUT0RPOiBtb2R1bGVzW2xvYWRlcl0ubW9kdWxlLmJ1bmRsZSBzdXBwb3J0IGZvciBDTEkgdG9vbGluZy5cblxuICB9IGNhdGNoIChlcnIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0NvdWxkIG5vdCBsb2FkIGJsdWVwcmludCBcXCcnICsgbmFtZSArICdcXCdcXG4nICsgZXJyKVxuICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IGltcG9ydHNcbiIsIid1c2Ugc3RyaWN0J1xuXG5pbXBvcnQgbG9nIGZyb20gJy4vbG9nZ2VyJ1xuaW1wb3J0IGV4cG9ydGVyIGZyb20gJy4vZXhwb3J0cydcbmltcG9ydCAqIGFzIGhlbHBlcnMgZnJvbSAnLi9oZWxwZXJzJ1xuaW1wb3J0IEJsdWVwcmludE1ldGhvZHMgZnJvbSAnLi9tZXRob2RzJ1xuaW1wb3J0IHsgZGVib3VuY2UsIHByb2Nlc3NGbG93IH0gZnJvbSAnLi9tZXRob2RzJ1xuaW1wb3J0IEJsdWVwcmludEJhc2UgZnJvbSAnLi9CbHVlcHJpbnRCYXNlJ1xuaW1wb3J0IEJsdWVwcmludFNjaGVtYSBmcm9tICcuL3NjaGVtYSdcbmltcG9ydCBpbXBvcnRzIGZyb20gJy4vbG9hZGVyJ1xuXG4vLyBGcmFtZSBhbmQgQmx1ZXByaW50IGNvbnN0cnVjdG9yc1xuY29uc3Qgc2luZ2xldG9ucyA9IHt9XG5mdW5jdGlvbiBGcmFtZShuYW1lLCBvcHRzKSB7XG4gIGlmICghKHRoaXMgaW5zdGFuY2VvZiBGcmFtZSkpXG4gICAgcmV0dXJuIG5ldyBGcmFtZShuYW1lLCBvcHRzKVxuXG4gIGlmICh0eXBlb2YgbmFtZSAhPT0gJ3N0cmluZycpXG4gICAgdGhyb3cgbmV3IEVycm9yKCdCbHVlcHJpbnQgbmFtZSBcXCcnICsgbmFtZSArICdcXCcgaXMgbm90IHZhbGlkLlxcbicpXG5cbiAgLy8gSWYgYmx1ZXByaW50IGlzIGEgc2luZ2xldG9uIChmb3Igc2hhcmVkIHJlc291cmNlcyksIHJldHVybiBpdCBpbnN0ZWFkIG9mIGNyZWF0aW5nIG5ldyBpbnN0YW5jZS5cbiAgaWYgKHNpbmdsZXRvbnNbbmFtZV0pXG4gICAgcmV0dXJuIHNpbmdsZXRvbnNbbmFtZV1cblxuICBsZXQgYmx1ZXByaW50ID0gbmV3IEJsdWVwcmludChuYW1lKVxuICBpbXBvcnRzKG5hbWUsIG9wdHMsIGZ1bmN0aW9uKGJsdWVwcmludEZpbGUpIHtcbiAgICB0cnkge1xuXG4gICAgICBsb2cuZGVidWcoJ0JsdWVwcmludCBsb2FkZWQ6JywgYmx1ZXByaW50RmlsZS5uYW1lKVxuXG4gICAgICBpZiAodHlwZW9mIGJsdWVwcmludEZpbGUgIT09ICdvYmplY3QnKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0JsdWVwcmludCBpcyBleHBlY3RlZCB0byBiZSBhbiBvYmplY3Qgb3IgY2xhc3MnKVxuXG4gICAgICAvLyBVcGRhdGUgZmF1eCBibHVlcHJpbnQgc3R1YiB3aXRoIHJlYWwgbW9kdWxlXG4gICAgICBoZWxwZXJzLmFzc2lnbk9iamVjdChibHVlcHJpbnQsIGJsdWVwcmludEZpbGUpXG5cbiAgICAgIC8vIFVwZGF0ZSBibHVlcHJpbnQgbmFtZVxuICAgICAgaGVscGVycy5zZXREZXNjcmlwdG9yKGJsdWVwcmludCwgYmx1ZXByaW50RmlsZS5uYW1lLCBmYWxzZSlcbiAgICAgIGJsdWVwcmludC5GcmFtZS5uYW1lID0gYmx1ZXByaW50RmlsZS5uYW1lXG5cbiAgICAgIC8vIEFwcGx5IGEgc2NoZW1hIHRvIGJsdWVwcmludFxuICAgICAgYmx1ZXByaW50ID0gQmx1ZXByaW50U2NoZW1hKGJsdWVwcmludClcblxuICAgICAgLy8gVmFsaWRhdGUgQmx1ZXByaW50IGlucHV0IHdpdGggb3B0aW9uYWwgcHJvcGVydHkgZGVzdHJ1Y3R1cmluZyAodXNpbmcgZGVzY3JpYmUgb2JqZWN0KVxuICAgICAgYmx1ZXByaW50LkZyYW1lLmRlc2NyaWJlID0gaGVscGVycy5jcmVhdGVEZXN0cnVjdHVyZShibHVlcHJpbnQuZGVzY3JpYmUsIEJsdWVwcmludEJhc2UuZGVzY3JpYmUpXG5cbiAgICAgIGJsdWVwcmludC5GcmFtZS5sb2FkZWQgPSB0cnVlXG4gICAgICBkZWJvdW5jZShwcm9jZXNzRmxvdywgMSwgYmx1ZXByaW50KVxuXG4gICAgICAvLyBJZiBibHVlcHJpbnQgaW50ZW5kcyB0byBiZSBhIHNpbmdsZXRvbiwgYWRkIGl0IHRvIHRoZSBsaXN0LlxuICAgICAgaWYgKGJsdWVwcmludC5zaW5nbGV0b24pXG4gICAgICAgIHNpbmdsZXRvbnNbYmx1ZXByaW50Lm5hbWVdID0gYmx1ZXByaW50XG5cbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignQmx1ZXByaW50IFxcJycgKyBuYW1lICsgJ1xcJyBpcyBub3QgdmFsaWQuXFxuJyArIGVycilcbiAgICB9XG4gIH0pXG5cbiAgcmV0dXJuIGJsdWVwcmludFxufVxuXG5mdW5jdGlvbiBCbHVlcHJpbnQobmFtZSkge1xuICBjb25zdCBibHVlcHJpbnQgPSBuZXcgQmx1ZXByaW50Q29uc3RydWN0b3IobmFtZSlcbiAgaGVscGVycy5zZXREZXNjcmlwdG9yKGJsdWVwcmludCwgJ0JsdWVwcmludCcsIHRydWUpXG5cbiAgLy8gQmx1ZXByaW50IG1ldGhvZHNcbiAgaGVscGVycy5hc3NpZ25PYmplY3QoYmx1ZXByaW50LCBCbHVlcHJpbnRNZXRob2RzKVxuXG4gIC8vIENyZWF0ZSBoaWRkZW4gYmx1ZXByaW50LkZyYW1lIHByb3BlcnR5IHRvIGtlZXAgc3RhdGVcbiAgY29uc3QgYmx1ZXByaW50QmFzZSA9IE9iamVjdC5jcmVhdGUoQmx1ZXByaW50QmFzZSlcbiAgaGVscGVycy5hc3NpZ25PYmplY3QoYmx1ZXByaW50QmFzZSwgQmx1ZXByaW50QmFzZSlcbiAgT2JqZWN0LmRlZmluZVByb3BlcnR5KGJsdWVwcmludCwgJ0ZyYW1lJywgeyB2YWx1ZTogYmx1ZXByaW50QmFzZSwgZW51bWVyYWJsZTogdHJ1ZSwgY29uZmlndXJhYmxlOiB0cnVlLCB3cml0YWJsZTogZmFsc2UgfSkgLy8gVE9ETzogY29uZmlndXJhYmxlOiBmYWxzZSwgZW51bWVyYWJsZTogZmFsc2VcbiAgYmx1ZXByaW50LkZyYW1lLm5hbWUgPSBuYW1lXG5cbiAgcmV0dXJuIGJsdWVwcmludFxufVxuXG5mdW5jdGlvbiBCbHVlcHJpbnRDb25zdHJ1Y3RvcihuYW1lKSB7XG4gIC8vIENyZWF0ZSBibHVlcHJpbnQgZnJvbSBjb25zdHJ1Y3RvclxuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgLy8gSWYgYmx1ZXByaW50IGlzIGEgc2luZ2xldG9uIChmb3Igc2hhcmVkIHJlc291cmNlcyksIHJldHVybiBpdCBpbnN0ZWFkIG9mIGNyZWF0aW5nIG5ldyBpbnN0YW5jZS5cbiAgICBpZiAoc2luZ2xldG9uc1tuYW1lXSlcbiAgICAgIHJldHVybiBzaW5nbGV0b25zW25hbWVdXG5cbiAgICBjb25zdCBibHVlcHJpbnQgPSBuZXcgRnJhbWUobmFtZSlcbiAgICBibHVlcHJpbnQuRnJhbWUucHJvcHMgPSBhcmd1bWVudHNcblxuICAgIGxvZy5kZWJ1ZygnY29uc3RydWN0b3IgY2FsbGVkIGZvcicsIG5hbWUpXG5cbiAgICByZXR1cm4gYmx1ZXByaW50XG4gIH1cbn1cblxuLy8gR2l2ZSBGcmFtZSBhbiBlYXN5IGRlc2NyaXB0b3JcbmhlbHBlcnMuc2V0RGVzY3JpcHRvcihGcmFtZSwgJ0NvbnN0cnVjdG9yJylcbmhlbHBlcnMuc2V0RGVzY3JpcHRvcihGcmFtZS5jb25zdHJ1Y3RvciwgJ0ZyYW1lJylcblxuLy8gRXhwb3J0IEZyYW1lIGdsb2JhbGx5XG5leHBvcnRlcignRnJhbWUnLCBGcmFtZSlcbmV4cG9ydCBkZWZhdWx0IEZyYW1lXG4iXSwibmFtZXMiOlsiaGVscGVycy5hc3NpZ25PYmplY3QiLCJoZWxwZXJzLnNldERlc2NyaXB0b3IiLCJoZWxwZXJzLmNyZWF0ZURlc3RydWN0dXJlIl0sIm1hcHBpbmdzIjoiOzs7RUFFQSxTQUFTLEdBQUcsR0FBRztFQUNmO0VBQ0EsRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsU0FBUyxFQUFDO0VBQ3BDLENBQUM7O0VBRUQsR0FBRyxDQUFDLEtBQUssR0FBRyxXQUFXO0VBQ3ZCO0VBQ0EsRUFBRSxPQUFPLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsU0FBUyxFQUFDO0VBQ3RDLEVBQUM7O0VBRUQsR0FBRyxDQUFDLElBQUksR0FBRyxXQUFXO0VBQ3RCO0VBQ0EsRUFBRSxPQUFPLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsU0FBUyxFQUFDO0VBQ3JDLEVBQUM7O0VBRUQsR0FBRyxDQUFDLEtBQUssR0FBRyxXQUFXO0VBQ3ZCLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLFNBQVMsRUFBQztFQUNwQyxDQUFDOztFQ25CRDtFQUNBO0VBQ0EsU0FBUyxRQUFRLENBQUMsSUFBSSxFQUFFLEdBQUcsRUFBRTtFQUM3QjtFQUNBLEVBQUUsSUFBSSxPQUFPLE1BQU0sS0FBSyxRQUFRLElBQUksT0FB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S0FBSyxVQUFVO0VBQ3pDLE1BQU0sTUFBTSxDQUFDLEdBQUcsQ0FBQyxHQUFHLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsT0FBTyxNQUFNLENBQUMsR0FBRyxDQUFDLEVBQUUsR0FBRTtFQUNsRSxTQUFTLElBQUksT0FBTyxNQUFNLENBQUMsR0FBRyxDQUFDLEtBQUssUUFBUSxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUU7RUFDNUUsTUFBTSxNQUFNLFNBQVMsR0FBRyxNQUFNLENBQUMsR0FBRyxFQUFDO0VBQ25DLE1BQU0sTUFBTSxDQUFDLEdBQUcsQ0FBQyxHQUFHLEVBQUUsUUFBUSxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUUsVUFBVSxFQUFFLEtBQUssRUFBRSxFQUFFLEdBQUU7RUFDcEUsTUFBTSxLQUFLLE1BQU0sVUFBVSxJQUFJLFNBQVMsRUFBRTtFQUMxQyxRQUFRLElBQUksT0FBTyxVQUFVLEtBQUssVUFBVTtFQUM1QyxVQUFVLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLE9BQU8sVUFBVSxFQUFFLEVBQUM7RUFDckQsT0FBTztFQUNQLEtBQUssTUFBTSxJQUFJLE9BQU8sTUFBTSxDQUFDLEdBQUcsQ0FBQyxLQUFLLFFBQVEsSUFBSSxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxFQUFFO0VBQ3BFLE1BQU0sTUFBTSxDQUFDLEdBQUcsQ0FBQyxHQUFHLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksRUFBRSxPQUFPLEVBQUUsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLE9BQU8sR0FBRTtFQUM1RixLQUFLLE1BQU07RUFDWCxNQUFNLE1BQU0sQ0FBQyxHQUFHLENBQUMsR0FBRyxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLE9BQU8sTUFBTSxDQUFDLEdBQUcsQ0FBQyxHQUFFO0VBQ2hF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
