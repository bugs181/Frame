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
    for (let propertyName of Object.getOwnPropertyNames(source)) {
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
    let target = {};

    // If no target exist, stub them so we don't run into issues later.
    if (!source)
      source = {};

    // Create stubs for Array of keys. Example: ['init', 'in', etc]
    for (let key of keys) {
      target[key] = [];
    }

    // Loop through source's keys
    for (let key of Object.keys(source)) {
      target[key] = [];

      // We only support objects for now. Example { init: { 'someKey': 'someDescription' }}
      if (typeof source[key] !== 'object' || Array.isArray(source[key]))
        continue

      // TODO: Support arrays for type checking
      // Example: { init: 'someKey': ['some description', 'string'] }

      let propIndex = [];
      for (let prop of Object.keys(source[key])) {
        propIndex.push({ name: prop, description: source[key][prop] });
      }

      target[key] = propIndex;
    }

    return target
  }

  function destructure(target, props) {
    props = (!props) ? [] : Array.from(props);

    if (!target)
      return props

    let targetProps = {};
    let propIndex = 0;

    // Loop through our target keys, and assign the object's key to the value of the props input.
    for (let targetProp of target) {
      targetProps[targetProp.name] = props[propIndex];
      propIndex++;
    }

    // If we don't have a valid target; return props array instead. Exemple: ['prop1', 'prop2']
    if (propIndex === 0)
      return props

    // Example: { someKey: someValue, someOtherKey: someOtherValue }
    return targetProps
  }

  // Blueprint Methods
  const BlueprintMethods = {
    to: function(target) {
      addPipe.call(this, 'to', target, Array.from(arguments).slice(1));
      return this
    },

    from: function(target) {
      addPipe.call(this, 'from', target, Array.from(arguments).slice(1));
      return this
    },

    out: function(index, data) {
      debounce(nextPipe, 1, this, [index, null, data]);
    },

    error: function(index, err) {
      debounce(nextPipe, 1, this, [index, err]);
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
  };

  function addPipe(direction, target, params) {
    if (!this)
      throw new Error('Blueprint method called without instance, did you assign the method to a variable?')

    if (!this.Frame || !this.Frame.pipes)
      throw new Error('Not working with a valid Blueprint object')

    if (typeof target !== 'function' || typeof target.to !== 'function')
      throw new Error(this.Frame.name + '.' + direction + '() was called with improper parameters')

    log(direction, '(): ' + this.name);
    this.Frame.pipes.push({ direction: direction, target: target, params: params });

    // Instance of blueprint
    if (target && target.Frame)
      target.Frame.parents.push(this);

    debounce(processFlow, 1, this);
  }

  function debounce(func, wait, blueprint, args) {
    let name = func.name;
    clearTimeout(blueprint.Frame.debounce[name]);
    blueprint.Frame.debounce[name] = setTimeout(function() {
      delete blueprint.Frame.debounce[name];
      func.apply(blueprint, args);
    }, wait);
  }

  function factory(fn) {
    return function() { return fn.apply(this, arguments) }
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

    log('Processing flow for ' + this.name);
    console.log();
    this.Frame.processingFlow = true;

    // Put this blueprint at the beginning of the flow, that way any .from events trigger the top level first.
    this.Frame.pipes.unshift({ direction: 'to', target: this, params: null });

    // Break out event pipes and flow pipes into separate flows.
    let i = 1; // Start at 1, since our main blueprint instance should be 0
    for (let pipe of this.Frame.pipes) {
      let blueprint = pipe.target;
      let out = new factory(pipe.target.out);
      let error = new factory(pipe.target.error);

      if (pipe.direction === 'from') {
        if (typeof blueprint.on !== 'function')
          throw new Error('Blueprint \'' + blueprint.name + '\' does not support events.')
        else {
          // .from(Events) start the flow at index 0
          pipe.target.out = out.bind(this, 0);
          pipe.target.error = error.bind(this, 0);
          this.Frame.events.push(pipe);
        }
      } else if (pipe.direction === 'to') {
        pipe.target.out = out.bind(this, i);
        pipe.target.error = error.bind(this, i);
        this.Frame.flow.push(pipe);
        i++;
      }
    }

    startFlow.call(this);
  }

  function flowsReady() {
    // if blueprint has not been initialized yet (i.e. constructor not used.)
    if (!this.Frame.initialized) {
      initBlueprint.call(this, processFlow);
      return false
    }

    // Loop through all blueprints in flow to make sure they have been loaded and initialized.
    this.Frame.flowsReady = true;
    for (let pipe of this.Frame.pipes) {
      let target = pipe.target;
      if (!target.Frame.loaded) { // TODO: On load, need to reach out to parent to restart processFlow
        this.Frame.flowsReady = false;
        continue
      }

      if (!target.Frame.initialized) {
        initBlueprint.call(target, processFlow.bind(this));
        this.Frame.flowsReady = false;
        continue
      }
    }

    if (!this.Frame.flowsReady)
      return false

    return true
  }

  function startFlow() {
    console.log('Starting flow for ' + this.name);

    for (let event of this.Frame.events) {
      let blueprint = event.target;
      const props = destructure(blueprint.Frame.describe.on, event.params);
      blueprint.on.call(blueprint, props);
    }
  }

  function nextPipe(index, err, data) {
    if (err)
      return console.error('TODO: handle error:', err)

    const flow = this.Frame.flow;
    const next = flow[index];

    // If we're at the end of the flow
    if (!next || !next.target) {
      this.Frame.processingFlow = false;

      if (this.Frame.isPromised) {
        this.Frame.promise.resolve(data);
        this.Frame.isPromised = false;
      }

      return console.log('End of flow')
    }

    const blueprint = next.target;
    const props = destructure(blueprint.Frame.describe.in, next.params);
    const retValue = blueprint.in.call(blueprint, data, props, blueprint.out);
    const retType = typeof retValue;

    // Blueprint.in does not return anything
    if (retType === 'undefined')
      return

    if (retType === 'object' && retValue instanceof Promise) {
      // Handle promises
      retValue.then(blueprint.out).catch(blueprint.error);
    } else if (retType === 'object' && retValue instanceof Error) {
      // Handle errors
      blueprint.error(retValue);
    } else {
      // Handle regular primitives and objects
      blueprint.out(retValue);
    }
  }

  /*
    // If blueprint is part of a flow
    let parents = this.Frame.parents
    if (parents.length >= 1) {
      for (let parent of parents) {
        console.log('Calling parent')
        parent.Frame.nextPipe.call(parent, err, data)
      }
      return
    }
  */

  function initBlueprint(callback) {
    let blueprint = this;

    try {
      let props = blueprint.Frame.props ? blueprint.Frame.props : {};

      // If Blueprint foregoes the initializer, stub it.
      if (!blueprint.init)
        blueprint.init = function(props, callback) { callback(); };

      props = destructure(blueprint.Frame.describe.init, props);
      blueprint.init.call(blueprint, props, function(err) {
        if (err)
          return log('Error initializing blueprint \'' + blueprint.name + '\'\n' + err)

        // Blueprint intitialzed
        log('Blueprint ' + blueprint.name + ' intialized');

        blueprint.Frame.props = {};
        blueprint.Frame.initialized = true;
        callback && callback.call(blueprint);
      });

    } catch (err) {
      throw new Error('Blueprint \'' + blueprint.name + '\' could not initialize.\n' + err)
    }
  }

  // Internal Frame props
  const BlueprintBase = {
    name: '',
    describe: ['init', 'in', 'out'],
    props: {},

    loaded: false,
    initialized: false,
    processingFlow: false,
    debounce: {},
    parents: [],

    pipes: [],
    events: [],
    flow: [],
  };

  // Concept based on: http://objectmodel.js.org/
  function ObjectModel(schemaObj) {
    if (typeof schemaObj === 'function') {
      return { type: schemaObj.name, expects: schemaObj }
    } else if (typeof schemaObj !== 'object')
      schemaObj = {};

    // Clone schema object so we don't mutate it.
    let schema = Object.create(schemaObj);
    Object.assign(schema, schemaObj);

    // Loop through Schema object keys
    for (let key of Object.keys(schema)) {
      // Create a schema object with types
      if (typeof schema[key] === 'function')
        schema[key] = { required: true, type: typeof schema[key]() };
      else if (typeof schema[key] === 'object' && Array.isArray(schema[key])) {
        let schemaArr = schema[key];
        schema[key] = { required: false, type: 'optional', types: [] };
        for (let schemaType of schemaArr) {
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
      let proxyObj = {};
      let obj = objToValidate;

      for (let key of Object.getOwnPropertyNames(objToValidate)) {
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
        for (let key of Object.getOwnPropertyNames(schema)) {
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
        return window.http.module.in.call(window.http.module, url, callback)
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

    window.require = function(url, callback) {
      window.http.module.init.call(window.http.module);
      return window.http.module.in.call(window.http.module, url, callback)
    };


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

      in: function(fileName, opts, callback) {
        if (!this.isBrowser)
          return callback('URL loading with node.js not supported yet (Coming soon!).')

        return this.browser.load.call(this, fileName, callback)
      },

      normalizeFilePath: function(fileName) {
        if (fileName.indexOf('http') >= 0)
          return fileName

        let file = fileName + ((fileName.indexOf('.js') === -1) ? '.js' : '');
        file = 'blueprints/' + file;
        return file
      },

      browser: {
        load: function(fileName, callback) {
          const filePath = this.normalizeFilePath(fileName);
          log('[http loader] Loading file: ' + filePath);

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

        log('[file loader] Loading file: ' + fileName);

        // TODO: Switch to async file loading, improve require(), pass in IIFE to sandbox, use IIFE resolver for callback
        // TODO: Add error reporting.

        const vm = require('vm');
        const fs = require('fs');

        const filePath = this.normalizeFilePath(fileName);

        const file = this.resolveFile(filePath);
        if (!file)
          return callback('Blueprint not found')

        const fileContents = fs.readFileSync(file).toString();

        //const sandbox = { Blueprint: null }
        //vm.createContext(sandbox)
        //vm.runInContext(fileContents, sandbox)

        global.Blueprint = null;
        vm.runInThisContext(fileContents);

        callback(null, global.Blueprint);
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
      }
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
    for (let callback of module.callbacks) {
      callback(module.module);
    }

    module.callbacks = [];
  }

  const imports = function(name, opts, callback) {
    try {
      const fileInfo = resolveFileInfo(name);
      const fileName = fileInfo.name;
      const protocol = fileInfo.protocol;

      log('loading module:', fileName);

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
          log('Error: ', err, fileName);
        else {
          log('Loaded Blueprint module: ', fileName);

          if (!exportFile || typeof exportFile !== 'object')
            throw new Error('Invalid Blueprint file, Blueprint is expected to be an object or class')

          if (typeof exportFile.name !== 'string')
            throw new Error('Invalid Blueprint file, Blueprint missing a name')

          let module = modules[fileName];
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

        log('Blueprint loaded:', blueprintFile.name);

        if (typeof blueprintFile !== 'object')
          throw new Error('Blueprint is expected to be an object or class')

        // Update faux blueprint stub with real module
        assignObject(blueprint, blueprintFile);

        // Update blueprint name
        setDescriptor(blueprint, blueprintFile.name, false);
        blueprint.Frame.name = blueprintFile.name;

        // Apply a schema to blueprint
        blueprint = BlueprintSchema(blueprint);

        // Validate Blueprint input with optional property destructuring (using describe syntax)
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
    let blueprint = new BlueprintConstructor(name);
    setDescriptor(blueprint, 'Blueprint', true);

    // Blueprint methods
    assignObject(blueprint, BlueprintMethods);

    // Create hidden blueprint.Frame property to keep state
    let blueprintBase = Object.create(BlueprintBase);
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

      let blueprint = new Frame(name);
      blueprint.Frame.props = arguments;

      return blueprint
    }
  }

  // Give Frame an easy descriptor
  setDescriptor(Frame, 'Constructor');
  setDescriptor(Frame.constructor, 'Frame');

  // Export Frame globally
  exporter('Frame', Frame);

}());
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZnJhbWUuanMiLCJzb3VyY2VzIjpbIi4uL2xpYi9sb2dnZXIuanMiLCIuLi9saWIvZXhwb3J0cy5qcyIsIi4uL2xpYi9oZWxwZXJzLmpzIiwiLi4vbGliL21ldGhvZHMuanMiLCIuLi9saWIvQmx1ZXByaW50QmFzZS5qcyIsIi4uL2xpYi9PYmplY3RNb2RlbC5qcyIsIi4uL2xpYi9zY2hlbWEuanMiLCIuLi9saWIvTW9kdWxlTG9hZGVyLmpzIiwiLi4vYmx1ZXByaW50cy9sb2FkZXJzL2h0dHAuanMiLCIuLi9ibHVlcHJpbnRzL2xvYWRlcnMvZmlsZS5qcyIsIi4uL2xpYi9sb2FkZXIuanMiLCIuLi9saWIvRnJhbWUuanMiXSwic291cmNlc0NvbnRlbnQiOlsiJ3VzZSBzdHJpY3QnXG5cbmZ1bmN0aW9uIGxvZygpIHtcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcbiAgY29uc29sZS5sb2cuYXBwbHkodGhpcywgYXJndW1lbnRzKVxufVxuXG5sb2cuZXJyb3IgPSBmdW5jdGlvbigpIHtcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcbiAgY29uc29sZS5lcnJvci5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG59XG5cbmxvZy53YXJuID0gZnVuY3Rpb24oKSB7XG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb25zb2xlXG4gIGNvbnNvbGUud2Fybi5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG59XG5cbmV4cG9ydCBkZWZhdWx0IGxvZ1xuIiwiLy8gVW5pdmVyc2FsIGV4cG9ydCBmdW5jdGlvbiBkZXBlbmRpbmcgb24gZW52aXJvbm1lbnQuXG4vLyBBbHRlcm5hdGl2ZWx5LCBpZiB0aGlzIHByb3ZlcyB0byBiZSBpbmVmZmVjdGl2ZSwgZGlmZmVyZW50IHRhcmdldHMgZm9yIHJvbGx1cCBjb3VsZCBiZSBjb25zaWRlcmVkLlxuZnVuY3Rpb24gZXhwb3J0ZXIobmFtZSwgb2JqKSB7XG4gIC8vIE5vZGUuanMgJiBub2RlLWxpa2UgZW52aXJvbm1lbnRzIChleHBvcnQgYXMgbW9kdWxlKVxuICBpZiAodHlwZW9mIG1vZHVsZSA9PT0gJ29iamVjdCcgJiYgdHlwZW9mIG1vZHVsZS5leHBvcnRzID09PSAnb2JqZWN0JylcbiAgICBtb2R1bGUuZXhwb3J0cyA9IG9ialxuXG4gIC8vIEdsb2JhbCBleHBvcnQgKGFsc28gYXBwbGllZCB0byBOb2RlICsgbm9kZS1saWtlIGVudmlyb25tZW50cylcbiAgaWYgKHR5cGVvZiBnbG9iYWwgPT09ICdvYmplY3QnKVxuICAgIGdsb2JhbFtuYW1lXSA9IG9ialxuXG4gIC8vIFVNRFxuICBlbHNlIGlmICh0eXBlb2YgZGVmaW5lID09PSAnZnVuY3Rpb24nICYmIGRlZmluZS5hbWQpXG4gICAgZGVmaW5lKFsnZXhwb3J0cyddLCBmdW5jdGlvbihleHApIHtcbiAgICAgIGV4cFtuYW1lXSA9IG9ialxuICAgIH0pXG5cbiAgLy8gQnJvd3NlcnMgYW5kIGJyb3dzZXItbGlrZSBlbnZpcm9ubWVudHMgKEVsZWN0cm9uLCBIeWJyaWQgd2ViIGFwcHMsIGV0YylcbiAgZWxzZSBpZiAodHlwZW9mIHdpbmRvdyA9PT0gJ29iamVjdCcpXG4gICAgd2luZG93W25hbWVdID0gb2JqXG59XG5cbmV4cG9ydCBkZWZhdWx0IGV4cG9ydGVyXG4iLCIndXNlIHN0cmljdCdcblxuLy8gT2JqZWN0IGhlbHBlciBmdW5jdGlvbnNcbmZ1bmN0aW9uIGFzc2lnbk9iamVjdCh0YXJnZXQsIHNvdXJjZSkge1xuICBmb3IgKGxldCBwcm9wZXJ0eU5hbWUgb2YgT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMoc291cmNlKSkge1xuICAgIGlmIChwcm9wZXJ0eU5hbWUgPT09ICduYW1lJylcbiAgICAgIGNvbnRpbnVlXG5cbiAgICBpZiAodHlwZW9mIHNvdXJjZVtwcm9wZXJ0eU5hbWVdID09PSAnb2JqZWN0JylcbiAgICAgIGlmIChBcnJheS5pc0FycmF5KHNvdXJjZVtwcm9wZXJ0eU5hbWVdKSlcbiAgICAgICAgdGFyZ2V0W3Byb3BlcnR5TmFtZV0gPSBbXVxuICAgICAgZWxzZVxuICAgICAgICB0YXJnZXRbcHJvcGVydHlOYW1lXSA9IE9iamVjdC5jcmVhdGUoc291cmNlW3Byb3BlcnR5TmFtZV0sIE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3JzKHNvdXJjZVtwcm9wZXJ0eU5hbWVdKSlcbiAgICBlbHNlXG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkoXG4gICAgICAgIHRhcmdldCxcbiAgICAgICAgcHJvcGVydHlOYW1lLFxuICAgICAgICBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yKHNvdXJjZSwgcHJvcGVydHlOYW1lKVxuICAgICAgKVxuICB9XG5cbiAgcmV0dXJuIHRhcmdldFxufVxuXG5mdW5jdGlvbiBzZXREZXNjcmlwdG9yKHRhcmdldCwgdmFsdWUsIGNvbmZpZ3VyYWJsZSkge1xuICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGFyZ2V0LCAndG9TdHJpbmcnLCB7XG4gICAgZW51bWVyYWJsZTogZmFsc2UsXG4gICAgd3JpdGFibGU6IGZhbHNlLFxuICAgIGNvbmZpZ3VyYWJsZTogdHJ1ZSxcbiAgICB2YWx1ZTogZnVuY3Rpb24oKSB7XG4gICAgICByZXR1cm4gKHZhbHVlKSA/ICdbRnJhbWU6ICcgKyB2YWx1ZSArICddJyA6ICdbRnJhbWU6IENvbnN0cnVjdG9yXSdcbiAgICB9LFxuICB9KVxuXG4gIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh0YXJnZXQsICduYW1lJywge1xuICAgIGVudW1lcmFibGU6IGZhbHNlLFxuICAgIHdyaXRhYmxlOiBmYWxzZSxcbiAgICBjb25maWd1cmFibGU6IChjb25maWd1cmFibGUpID8gdHJ1ZSA6IGZhbHNlLFxuICAgIHZhbHVlOiB2YWx1ZSxcbiAgfSlcbn1cblxuLy8gRGVzdHJ1Y3R1cmUgdXNlciBpbnB1dCBmb3IgcGFyYW1ldGVyIGRlc3RydWN0dXJpbmcgaW50byAncHJvcHMnIG9iamVjdC5cbmZ1bmN0aW9uIGNyZWF0ZURlc3RydWN0dXJlKHNvdXJjZSwga2V5cykge1xuICBsZXQgdGFyZ2V0ID0ge31cblxuICAvLyBJZiBubyB0YXJnZXQgZXhpc3QsIHN0dWIgdGhlbSBzbyB3ZSBkb24ndCBydW4gaW50byBpc3N1ZXMgbGF0ZXIuXG4gIGlmICghc291cmNlKVxuICAgIHNvdXJjZSA9IHt9XG5cbiAgLy8gQ3JlYXRlIHN0dWJzIGZvciBBcnJheSBvZiBrZXlzLiBFeGFtcGxlOiBbJ2luaXQnLCAnaW4nLCBldGNdXG4gIGZvciAobGV0IGtleSBvZiBrZXlzKSB7XG4gICAgdGFyZ2V0W2tleV0gPSBbXVxuICB9XG5cbiAgLy8gTG9vcCB0aHJvdWdoIHNvdXJjZSdzIGtleXNcbiAgZm9yIChsZXQga2V5IG9mIE9iamVjdC5rZXlzKHNvdXJjZSkpIHtcbiAgICB0YXJnZXRba2V5XSA9IFtdXG5cbiAgICAvLyBXZSBvbmx5IHN1cHBvcnQgb2JqZWN0cyBmb3Igbm93LiBFeGFtcGxlIHsgaW5pdDogeyAnc29tZUtleSc6ICdzb21lRGVzY3JpcHRpb24nIH19XG4gICAgaWYgKHR5cGVvZiBzb3VyY2Vba2V5XSAhPT0gJ29iamVjdCcgfHwgQXJyYXkuaXNBcnJheShzb3VyY2Vba2V5XSkpXG4gICAgICBjb250aW51ZVxuXG4gICAgLy8gVE9ETzogU3VwcG9ydCBhcnJheXMgZm9yIHR5cGUgY2hlY2tpbmdcbiAgICAvLyBFeGFtcGxlOiB7IGluaXQ6ICdzb21lS2V5JzogWydzb21lIGRlc2NyaXB0aW9uJywgJ3N0cmluZyddIH1cblxuICAgIGxldCBwcm9wSW5kZXggPSBbXVxuICAgIGZvciAobGV0IHByb3Agb2YgT2JqZWN0LmtleXMoc291cmNlW2tleV0pKSB7XG4gICAgICBwcm9wSW5kZXgucHVzaCh7IG5hbWU6IHByb3AsIGRlc2NyaXB0aW9uOiBzb3VyY2Vba2V5XVtwcm9wXSB9KVxuICAgIH1cblxuICAgIHRhcmdldFtrZXldID0gcHJvcEluZGV4XG4gIH1cblxuICByZXR1cm4gdGFyZ2V0XG59XG5cbmZ1bmN0aW9uIGRlc3RydWN0dXJlKHRhcmdldCwgcHJvcHMpIHtcbiAgcHJvcHMgPSAoIXByb3BzKSA/IFtdIDogQXJyYXkuZnJvbShwcm9wcylcblxuICBpZiAoIXRhcmdldClcbiAgICByZXR1cm4gcHJvcHNcblxuICBsZXQgdGFyZ2V0UHJvcHMgPSB7fVxuICBsZXQgcHJvcEluZGV4ID0gMFxuXG4gIC8vIExvb3AgdGhyb3VnaCBvdXIgdGFyZ2V0IGtleXMsIGFuZCBhc3NpZ24gdGhlIG9iamVjdCdzIGtleSB0byB0aGUgdmFsdWUgb2YgdGhlIHByb3BzIGlucHV0LlxuICBmb3IgKGxldCB0YXJnZXRQcm9wIG9mIHRhcmdldCkge1xuICAgIHRhcmdldFByb3BzW3RhcmdldFByb3AubmFtZV0gPSBwcm9wc1twcm9wSW5kZXhdXG4gICAgcHJvcEluZGV4KytcbiAgfVxuXG4gIC8vIElmIHdlIGRvbid0IGhhdmUgYSB2YWxpZCB0YXJnZXQ7IHJldHVybiBwcm9wcyBhcnJheSBpbnN0ZWFkLiBFeGVtcGxlOiBbJ3Byb3AxJywgJ3Byb3AyJ11cbiAgaWYgKHByb3BJbmRleCA9PT0gMClcbiAgICByZXR1cm4gcHJvcHNcblxuICAvLyBFeGFtcGxlOiB7IHNvbWVLZXk6IHNvbWVWYWx1ZSwgc29tZU90aGVyS2V5OiBzb21lT3RoZXJWYWx1ZSB9XG4gIHJldHVybiB0YXJnZXRQcm9wc1xufVxuXG5leHBvcnQge1xuICBhc3NpZ25PYmplY3QsXG4gIHNldERlc2NyaXB0b3IsXG4gIGNyZWF0ZURlc3RydWN0dXJlLFxuICBkZXN0cnVjdHVyZVxufVxuIiwiJ3VzZSBzdHJpY3QnXG5cbmltcG9ydCBsb2cgZnJvbSAnLi9sb2dnZXInXG5pbXBvcnQgeyBkZXN0cnVjdHVyZSB9IGZyb20gJy4vaGVscGVycydcblxuLy8gQmx1ZXByaW50IE1ldGhvZHNcbmNvbnN0IEJsdWVwcmludE1ldGhvZHMgPSB7XG4gIHRvOiBmdW5jdGlvbih0YXJnZXQpIHtcbiAgICBhZGRQaXBlLmNhbGwodGhpcywgJ3RvJywgdGFyZ2V0LCBBcnJheS5mcm9tKGFyZ3VtZW50cykuc2xpY2UoMSkpXG4gICAgcmV0dXJuIHRoaXNcbiAgfSxcblxuICBmcm9tOiBmdW5jdGlvbih0YXJnZXQpIHtcbiAgICBhZGRQaXBlLmNhbGwodGhpcywgJ2Zyb20nLCB0YXJnZXQsIEFycmF5LmZyb20oYXJndW1lbnRzKS5zbGljZSgxKSlcbiAgICByZXR1cm4gdGhpc1xuICB9LFxuXG4gIG91dDogZnVuY3Rpb24oaW5kZXgsIGRhdGEpIHtcbiAgICBkZWJvdW5jZShuZXh0UGlwZSwgMSwgdGhpcywgW2luZGV4LCBudWxsLCBkYXRhXSlcbiAgfSxcblxuICBlcnJvcjogZnVuY3Rpb24oaW5kZXgsIGVycikge1xuICAgIGRlYm91bmNlKG5leHRQaXBlLCAxLCB0aGlzLCBbaW5kZXgsIGVycl0pXG4gIH0sXG5cbiAgZ2V0IHZhbHVlKCkge1xuICAgIC8vIEJhaWwgaWYgd2UncmUgbm90IHJlYWR5LiAoVXNlZCB0byBnZXQgb3V0IG9mIE9iamVjdE1vZGVsIGFuZCBhc3NpZ25PYmplY3QgbGltYm8pXG4gICAgaWYgKCF0aGlzLkZyYW1lKVxuICAgICAgcmV0dXJuICcnXG5cbiAgICBjb25zdCBibHVlcHJpbnQgPSB0aGlzXG4gICAgY29uc3QgcHJvbWlzZUZvclZhbHVlID0gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XG4gICAgICBibHVlcHJpbnQuRnJhbWUuaXNQcm9taXNlZCA9IHRydWVcbiAgICAgIGJsdWVwcmludC5GcmFtZS5wcm9taXNlID0geyByZXNvbHZlOiByZXNvbHZlLCByZWplY3Q6IHJlamVjdCB9XG4gICAgfSlcbiAgICByZXR1cm4gcHJvbWlzZUZvclZhbHVlXG4gIH0sXG59XG5cbmZ1bmN0aW9uIGFkZFBpcGUoZGlyZWN0aW9uLCB0YXJnZXQsIHBhcmFtcykge1xuICBpZiAoIXRoaXMpXG4gICAgdGhyb3cgbmV3IEVycm9yKCdCbHVlcHJpbnQgbWV0aG9kIGNhbGxlZCB3aXRob3V0IGluc3RhbmNlLCBkaWQgeW91IGFzc2lnbiB0aGUgbWV0aG9kIHRvIGEgdmFyaWFibGU/JylcblxuICBpZiAoIXRoaXMuRnJhbWUgfHwgIXRoaXMuRnJhbWUucGlwZXMpXG4gICAgdGhyb3cgbmV3IEVycm9yKCdOb3Qgd29ya2luZyB3aXRoIGEgdmFsaWQgQmx1ZXByaW50IG9iamVjdCcpXG5cbiAgaWYgKHR5cGVvZiB0YXJnZXQgIT09ICdmdW5jdGlvbicgfHwgdHlwZW9mIHRhcmdldC50byAhPT0gJ2Z1bmN0aW9uJylcbiAgICB0aHJvdyBuZXcgRXJyb3IodGhpcy5GcmFtZS5uYW1lICsgJy4nICsgZGlyZWN0aW9uICsgJygpIHdhcyBjYWxsZWQgd2l0aCBpbXByb3BlciBwYXJhbWV0ZXJzJylcblxuICBsb2coZGlyZWN0aW9uLCAnKCk6ICcgKyB0aGlzLm5hbWUpXG4gIHRoaXMuRnJhbWUucGlwZXMucHVzaCh7IGRpcmVjdGlvbjogZGlyZWN0aW9uLCB0YXJnZXQ6IHRhcmdldCwgcGFyYW1zOiBwYXJhbXMgfSlcblxuICAvLyBJbnN0YW5jZSBvZiBibHVlcHJpbnRcbiAgaWYgKHRhcmdldCAmJiB0YXJnZXQuRnJhbWUpXG4gICAgdGFyZ2V0LkZyYW1lLnBhcmVudHMucHVzaCh0aGlzKVxuXG4gIGRlYm91bmNlKHByb2Nlc3NGbG93LCAxLCB0aGlzKVxufVxuXG5mdW5jdGlvbiBkZWJvdW5jZShmdW5jLCB3YWl0LCBibHVlcHJpbnQsIGFyZ3MpIHtcbiAgbGV0IG5hbWUgPSBmdW5jLm5hbWVcbiAgY2xlYXJUaW1lb3V0KGJsdWVwcmludC5GcmFtZS5kZWJvdW5jZVtuYW1lXSlcbiAgYmx1ZXByaW50LkZyYW1lLmRlYm91bmNlW25hbWVdID0gc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICBkZWxldGUgYmx1ZXByaW50LkZyYW1lLmRlYm91bmNlW25hbWVdXG4gICAgZnVuYy5hcHBseShibHVlcHJpbnQsIGFyZ3MpXG4gIH0sIHdhaXQpXG59XG5cbmZ1bmN0aW9uIGZhY3RvcnkoZm4pIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkgeyByZXR1cm4gZm4uYXBwbHkodGhpcywgYXJndW1lbnRzKSB9XG59XG5cbmZ1bmN0aW9uIHByb2Nlc3NGbG93KCkge1xuICAvLyBBbHJlYWR5IHByb2Nlc3NpbmcgdGhpcyBCbHVlcHJpbnQncyBmbG93LlxuICBpZiAodGhpcy5GcmFtZS5wcm9jZXNzaW5nRmxvdylcbiAgICByZXR1cm5cblxuICAvLyBJZiBubyBwaXBlcyBmb3IgZmxvdywgdGhlbiBub3RoaW5nIHRvIGRvLlxuICBpZiAodGhpcy5GcmFtZS5waXBlcy5sZW5ndGggPCAxKVxuICAgIHJldHVyblxuXG4gIC8vIENoZWNrIHRoYXQgYWxsIGJsdWVwcmludHMgYXJlIHJlYWR5XG4gIGlmICghZmxvd3NSZWFkeS5jYWxsKHRoaXMpKVxuICAgIHJldHVyblxuXG4gIGxvZygnUHJvY2Vzc2luZyBmbG93IGZvciAnICsgdGhpcy5uYW1lKVxuICBjb25zb2xlLmxvZygpXG4gIHRoaXMuRnJhbWUucHJvY2Vzc2luZ0Zsb3cgPSB0cnVlXG5cbiAgLy8gUHV0IHRoaXMgYmx1ZXByaW50IGF0IHRoZSBiZWdpbm5pbmcgb2YgdGhlIGZsb3csIHRoYXQgd2F5IGFueSAuZnJvbSBldmVudHMgdHJpZ2dlciB0aGUgdG9wIGxldmVsIGZpcnN0LlxuICB0aGlzLkZyYW1lLnBpcGVzLnVuc2hpZnQoeyBkaXJlY3Rpb246ICd0bycsIHRhcmdldDogdGhpcywgcGFyYW1zOiBudWxsIH0pXG5cbiAgLy8gQnJlYWsgb3V0IGV2ZW50IHBpcGVzIGFuZCBmbG93IHBpcGVzIGludG8gc2VwYXJhdGUgZmxvd3MuXG4gIGxldCBpID0gMSAvLyBTdGFydCBhdCAxLCBzaW5jZSBvdXIgbWFpbiBibHVlcHJpbnQgaW5zdGFuY2Ugc2hvdWxkIGJlIDBcbiAgZm9yIChsZXQgcGlwZSBvZiB0aGlzLkZyYW1lLnBpcGVzKSB7XG4gICAgbGV0IGJsdWVwcmludCA9IHBpcGUudGFyZ2V0XG4gICAgbGV0IG91dCA9IG5ldyBmYWN0b3J5KHBpcGUudGFyZ2V0Lm91dClcbiAgICBsZXQgZXJyb3IgPSBuZXcgZmFjdG9yeShwaXBlLnRhcmdldC5lcnJvcilcblxuICAgIGlmIChwaXBlLmRpcmVjdGlvbiA9PT0gJ2Zyb20nKSB7XG4gICAgICBpZiAodHlwZW9mIGJsdWVwcmludC5vbiAhPT0gJ2Z1bmN0aW9uJylcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdCbHVlcHJpbnQgXFwnJyArIGJsdWVwcmludC5uYW1lICsgJ1xcJyBkb2VzIG5vdCBzdXBwb3J0IGV2ZW50cy4nKVxuICAgICAgZWxzZSB7XG4gICAgICAgIC8vIC5mcm9tKEV2ZW50cykgc3RhcnQgdGhlIGZsb3cgYXQgaW5kZXggMFxuICAgICAgICBwaXBlLnRhcmdldC5vdXQgPSBvdXQuYmluZCh0aGlzLCAwKVxuICAgICAgICBwaXBlLnRhcmdldC5lcnJvciA9IGVycm9yLmJpbmQodGhpcywgMClcbiAgICAgICAgdGhpcy5GcmFtZS5ldmVudHMucHVzaChwaXBlKVxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAocGlwZS5kaXJlY3Rpb24gPT09ICd0bycpIHtcbiAgICAgIHBpcGUudGFyZ2V0Lm91dCA9IG91dC5iaW5kKHRoaXMsIGkpXG4gICAgICBwaXBlLnRhcmdldC5lcnJvciA9IGVycm9yLmJpbmQodGhpcywgaSlcbiAgICAgIHRoaXMuRnJhbWUuZmxvdy5wdXNoKHBpcGUpXG4gICAgICBpKytcbiAgICB9XG4gIH1cblxuICBzdGFydEZsb3cuY2FsbCh0aGlzKVxufVxuXG5mdW5jdGlvbiBmbG93c1JlYWR5KCkge1xuICAvLyBpZiBibHVlcHJpbnQgaGFzIG5vdCBiZWVuIGluaXRpYWxpemVkIHlldCAoaS5lLiBjb25zdHJ1Y3RvciBub3QgdXNlZC4pXG4gIGlmICghdGhpcy5GcmFtZS5pbml0aWFsaXplZCkge1xuICAgIGluaXRCbHVlcHJpbnQuY2FsbCh0aGlzLCBwcm9jZXNzRmxvdylcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8vIExvb3AgdGhyb3VnaCBhbGwgYmx1ZXByaW50cyBpbiBmbG93IHRvIG1ha2Ugc3VyZSB0aGV5IGhhdmUgYmVlbiBsb2FkZWQgYW5kIGluaXRpYWxpemVkLlxuICB0aGlzLkZyYW1lLmZsb3dzUmVhZHkgPSB0cnVlXG4gIGZvciAobGV0IHBpcGUgb2YgdGhpcy5GcmFtZS5waXBlcykge1xuICAgIGxldCB0YXJnZXQgPSBwaXBlLnRhcmdldFxuICAgIGlmICghdGFyZ2V0LkZyYW1lLmxvYWRlZCkgeyAvLyBUT0RPOiBPbiBsb2FkLCBuZWVkIHRvIHJlYWNoIG91dCB0byBwYXJlbnQgdG8gcmVzdGFydCBwcm9jZXNzRmxvd1xuICAgICAgdGhpcy5GcmFtZS5mbG93c1JlYWR5ID0gZmFsc2VcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgaWYgKCF0YXJnZXQuRnJhbWUuaW5pdGlhbGl6ZWQpIHtcbiAgICAgIGluaXRCbHVlcHJpbnQuY2FsbCh0YXJnZXQsIHByb2Nlc3NGbG93LmJpbmQodGhpcykpXG4gICAgICB0aGlzLkZyYW1lLmZsb3dzUmVhZHkgPSBmYWxzZVxuICAgICAgY29udGludWVcbiAgICB9XG4gIH1cblxuICBpZiAoIXRoaXMuRnJhbWUuZmxvd3NSZWFkeSlcbiAgICByZXR1cm4gZmFsc2VcblxuICByZXR1cm4gdHJ1ZVxufVxuXG5mdW5jdGlvbiBzdGFydEZsb3coKSB7XG4gIGNvbnNvbGUubG9nKCdTdGFydGluZyBmbG93IGZvciAnICsgdGhpcy5uYW1lKVxuXG4gIGZvciAobGV0IGV2ZW50IG9mIHRoaXMuRnJhbWUuZXZlbnRzKSB7XG4gICAgbGV0IGJsdWVwcmludCA9IGV2ZW50LnRhcmdldFxuICAgIGNvbnN0IHByb3BzID0gZGVzdHJ1Y3R1cmUoYmx1ZXByaW50LkZyYW1lLmRlc2NyaWJlLm9uLCBldmVudC5wYXJhbXMpXG4gICAgYmx1ZXByaW50Lm9uLmNhbGwoYmx1ZXByaW50LCBwcm9wcylcbiAgfVxufVxuXG5mdW5jdGlvbiBuZXh0UGlwZShpbmRleCwgZXJyLCBkYXRhKSB7XG4gIGlmIChlcnIpXG4gICAgcmV0dXJuIGNvbnNvbGUuZXJyb3IoJ1RPRE86IGhhbmRsZSBlcnJvcjonLCBlcnIpXG5cbiAgY29uc3QgZmxvdyA9IHRoaXMuRnJhbWUuZmxvd1xuICBjb25zdCBuZXh0ID0gZmxvd1tpbmRleF1cblxuICAvLyBJZiB3ZSdyZSBhdCB0aGUgZW5kIG9mIHRoZSBmbG93XG4gIGlmICghbmV4dCB8fCAhbmV4dC50YXJnZXQpIHtcbiAgICB0aGlzLkZyYW1lLnByb2Nlc3NpbmdGbG93ID0gZmFsc2VcblxuICAgIGlmICh0aGlzLkZyYW1lLmlzUHJvbWlzZWQpIHtcbiAgICAgIHRoaXMuRnJhbWUucHJvbWlzZS5yZXNvbHZlKGRhdGEpXG4gICAgICB0aGlzLkZyYW1lLmlzUHJvbWlzZWQgPSBmYWxzZVxuICAgIH1cblxuICAgIHJldHVybiBjb25zb2xlLmxvZygnRW5kIG9mIGZsb3cnKVxuICB9XG5cbiAgY29uc3QgYmx1ZXByaW50ID0gbmV4dC50YXJnZXRcbiAgY29uc3QgcHJvcHMgPSBkZXN0cnVjdHVyZShibHVlcHJpbnQuRnJhbWUuZGVzY3JpYmUuaW4sIG5leHQucGFyYW1zKVxuICBjb25zdCByZXRWYWx1ZSA9IGJsdWVwcmludC5pbi5jYWxsKGJsdWVwcmludCwgZGF0YSwgcHJvcHMsIGJsdWVwcmludC5vdXQpXG4gIGNvbnN0IHJldFR5cGUgPSB0eXBlb2YgcmV0VmFsdWVcblxuICAvLyBCbHVlcHJpbnQuaW4gZG9lcyBub3QgcmV0dXJuIGFueXRoaW5nXG4gIGlmIChyZXRUeXBlID09PSAndW5kZWZpbmVkJylcbiAgICByZXR1cm5cblxuICBpZiAocmV0VHlwZSA9PT0gJ29iamVjdCcgJiYgcmV0VmFsdWUgaW5zdGFuY2VvZiBQcm9taXNlKSB7XG4gICAgLy8gSGFuZGxlIHByb21pc2VzXG4gICAgcmV0VmFsdWUudGhlbihibHVlcHJpbnQub3V0KS5jYXRjaChibHVlcHJpbnQuZXJyb3IpXG4gIH0gZWxzZSBpZiAocmV0VHlwZSA9PT0gJ29iamVjdCcgJiYgcmV0VmFsdWUgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgIC8vIEhhbmRsZSBlcnJvcnNcbiAgICBibHVlcHJpbnQuZXJyb3IocmV0VmFsdWUpXG4gIH0gZWxzZSB7XG4gICAgLy8gSGFuZGxlIHJlZ3VsYXIgcHJpbWl0aXZlcyBhbmQgb2JqZWN0c1xuICAgIGJsdWVwcmludC5vdXQocmV0VmFsdWUpXG4gIH1cbn1cblxuLypcbiAgLy8gSWYgYmx1ZXByaW50IGlzIHBhcnQgb2YgYSBmbG93XG4gIGxldCBwYXJlbnRzID0gdGhpcy5GcmFtZS5wYXJlbnRzXG4gIGlmIChwYXJlbnRzLmxlbmd0aCA+PSAxKSB7XG4gICAgZm9yIChsZXQgcGFyZW50IG9mIHBhcmVudHMpIHtcbiAgICAgIGNvbnNvbGUubG9nKCdDYWxsaW5nIHBhcmVudCcpXG4gICAgICBwYXJlbnQuRnJhbWUubmV4dFBpcGUuY2FsbChwYXJlbnQsIGVyciwgZGF0YSlcbiAgICB9XG4gICAgcmV0dXJuXG4gIH1cbiovXG5cbmZ1bmN0aW9uIGluaXRCbHVlcHJpbnQoY2FsbGJhY2spIHtcbiAgbGV0IGJsdWVwcmludCA9IHRoaXNcblxuICB0cnkge1xuICAgIGxldCBwcm9wcyA9IGJsdWVwcmludC5GcmFtZS5wcm9wcyA/IGJsdWVwcmludC5GcmFtZS5wcm9wcyA6IHt9XG5cbiAgICAvLyBJZiBCbHVlcHJpbnQgZm9yZWdvZXMgdGhlIGluaXRpYWxpemVyLCBzdHViIGl0LlxuICAgIGlmICghYmx1ZXByaW50LmluaXQpXG4gICAgICBibHVlcHJpbnQuaW5pdCA9IGZ1bmN0aW9uKHByb3BzLCBjYWxsYmFjaykgeyBjYWxsYmFjaygpIH1cblxuICAgIHByb3BzID0gZGVzdHJ1Y3R1cmUoYmx1ZXByaW50LkZyYW1lLmRlc2NyaWJlLmluaXQsIHByb3BzKVxuICAgIGJsdWVwcmludC5pbml0LmNhbGwoYmx1ZXByaW50LCBwcm9wcywgZnVuY3Rpb24oZXJyKSB7XG4gICAgICBpZiAoZXJyKVxuICAgICAgICByZXR1cm4gbG9nKCdFcnJvciBpbml0aWFsaXppbmcgYmx1ZXByaW50IFxcJycgKyBibHVlcHJpbnQubmFtZSArICdcXCdcXG4nICsgZXJyKVxuXG4gICAgICAvLyBCbHVlcHJpbnQgaW50aXRpYWx6ZWRcbiAgICAgIGxvZygnQmx1ZXByaW50ICcgKyBibHVlcHJpbnQubmFtZSArICcgaW50aWFsaXplZCcpXG5cbiAgICAgIGJsdWVwcmludC5GcmFtZS5wcm9wcyA9IHt9XG4gICAgICBibHVlcHJpbnQuRnJhbWUuaW5pdGlhbGl6ZWQgPSB0cnVlXG4gICAgICBjYWxsYmFjayAmJiBjYWxsYmFjay5jYWxsKGJsdWVwcmludClcbiAgICB9KVxuXG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHRocm93IG5ldyBFcnJvcignQmx1ZXByaW50IFxcJycgKyBibHVlcHJpbnQubmFtZSArICdcXCcgY291bGQgbm90IGluaXRpYWxpemUuXFxuJyArIGVycilcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBCbHVlcHJpbnRNZXRob2RzXG5leHBvcnQgeyBCbHVlcHJpbnRNZXRob2RzLCBkZWJvdW5jZSwgcHJvY2Vzc0Zsb3cgfVxuIiwiJ3VzZSBzdHJpY3QnXG5cbi8vIEludGVybmFsIEZyYW1lIHByb3BzXG5jb25zdCBCbHVlcHJpbnRCYXNlID0ge1xuICBuYW1lOiAnJyxcbiAgZGVzY3JpYmU6IFsnaW5pdCcsICdpbicsICdvdXQnXSxcbiAgcHJvcHM6IHt9LFxuXG4gIGxvYWRlZDogZmFsc2UsXG4gIGluaXRpYWxpemVkOiBmYWxzZSxcbiAgcHJvY2Vzc2luZ0Zsb3c6IGZhbHNlLFxuICBkZWJvdW5jZToge30sXG4gIHBhcmVudHM6IFtdLFxuXG4gIHBpcGVzOiBbXSxcbiAgZXZlbnRzOiBbXSxcbiAgZmxvdzogW10sXG59XG5cbmV4cG9ydCBkZWZhdWx0IEJsdWVwcmludEJhc2VcbiIsIid1c2Ugc3RyaWN0J1xuXG4vLyBDb25jZXB0IGJhc2VkIG9uOiBodHRwOi8vb2JqZWN0bW9kZWwuanMub3JnL1xuZnVuY3Rpb24gT2JqZWN0TW9kZWwoc2NoZW1hT2JqKSB7XG4gIGlmICh0eXBlb2Ygc2NoZW1hT2JqID09PSAnZnVuY3Rpb24nKSB7XG4gICAgcmV0dXJuIHsgdHlwZTogc2NoZW1hT2JqLm5hbWUsIGV4cGVjdHM6IHNjaGVtYU9iaiB9XG4gIH0gZWxzZSBpZiAodHlwZW9mIHNjaGVtYU9iaiAhPT0gJ29iamVjdCcpXG4gICAgc2NoZW1hT2JqID0ge31cblxuICAvLyBDbG9uZSBzY2hlbWEgb2JqZWN0IHNvIHdlIGRvbid0IG11dGF0ZSBpdC5cbiAgbGV0IHNjaGVtYSA9IE9iamVjdC5jcmVhdGUoc2NoZW1hT2JqKVxuICBPYmplY3QuYXNzaWduKHNjaGVtYSwgc2NoZW1hT2JqKVxuXG4gIC8vIExvb3AgdGhyb3VnaCBTY2hlbWEgb2JqZWN0IGtleXNcbiAgZm9yIChsZXQga2V5IG9mIE9iamVjdC5rZXlzKHNjaGVtYSkpIHtcbiAgICAvLyBDcmVhdGUgYSBzY2hlbWEgb2JqZWN0IHdpdGggdHlwZXNcbiAgICBpZiAodHlwZW9mIHNjaGVtYVtrZXldID09PSAnZnVuY3Rpb24nKVxuICAgICAgc2NoZW1hW2tleV0gPSB7IHJlcXVpcmVkOiB0cnVlLCB0eXBlOiB0eXBlb2Ygc2NoZW1hW2tleV0oKSB9XG4gICAgZWxzZSBpZiAodHlwZW9mIHNjaGVtYVtrZXldID09PSAnb2JqZWN0JyAmJiBBcnJheS5pc0FycmF5KHNjaGVtYVtrZXldKSkge1xuICAgICAgbGV0IHNjaGVtYUFyciA9IHNjaGVtYVtrZXldXG4gICAgICBzY2hlbWFba2V5XSA9IHsgcmVxdWlyZWQ6IGZhbHNlLCB0eXBlOiAnb3B0aW9uYWwnLCB0eXBlczogW10gfVxuICAgICAgZm9yIChsZXQgc2NoZW1hVHlwZSBvZiBzY2hlbWFBcnIpIHtcbiAgICAgICAgaWYgKHR5cGVvZiBzY2hlbWFUeXBlID09PSAnZnVuY3Rpb24nKVxuICAgICAgICAgIHNjaGVtYVtrZXldLnR5cGVzLnB1c2godHlwZW9mIHNjaGVtYVR5cGUoKSlcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBzY2hlbWFba2V5XSA9PT0gJ29iamVjdCcgJiYgc2NoZW1hW2tleV0udHlwZSkge1xuICAgICAgc2NoZW1hW2tleV0gPSB7IHJlcXVpcmVkOiB0cnVlLCB0eXBlOiBzY2hlbWFba2V5XS50eXBlLCBleHBlY3RzOiBzY2hlbWFba2V5XS5leHBlY3RzIH1cbiAgICB9IGVsc2Uge1xuICAgICAgc2NoZW1hW2tleV0gPSB7IHJlcXVpcmVkOiB0cnVlLCB0eXBlOiB0eXBlb2Ygc2NoZW1hW2tleV0gfVxuICAgIH1cbiAgfVxuXG4gIC8vIFZhbGlkYXRlIHNjaGVtYSBwcm9wc1xuICBmdW5jdGlvbiBpc1ZhbGlkU2NoZW1hKGtleSwgdmFsdWUpIHtcbiAgICAvLyBUT0RPOiBNYWtlIG1vcmUgZmxleGlibGUgYnkgZGVmaW5pbmcgbnVsbCBhbmQgdW5kZWZpbmVkIHR5cGVzLlxuICAgIC8vIE5vIHNjaGVtYSBkZWZpbmVkIGZvciBrZXlcbiAgICBpZiAoIXNjaGVtYVtrZXldKVxuICAgICAgcmV0dXJuIHRydWVcblxuICAgIGlmIChzY2hlbWFba2V5XS5yZXF1aXJlZCAmJiB0eXBlb2YgdmFsdWUgPT09IHNjaGVtYVtrZXldLnR5cGUpIHtcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfSBlbHNlIGlmICghc2NoZW1hW2tleV0ucmVxdWlyZWQgJiYgc2NoZW1hW2tleV0udHlwZSA9PT0gJ29wdGlvbmFsJykge1xuICAgICAgaWYgKHZhbHVlICYmICFzY2hlbWFba2V5XS50eXBlcy5pbmNsdWRlcyh0eXBlb2YgdmFsdWUpKVxuICAgICAgICByZXR1cm4gZmFsc2VcblxuICAgICAgcmV0dXJuIHRydWVcbiAgICB9IGVsc2UgaWYgKHNjaGVtYVtrZXldLnJlcXVpcmVkICYmIHNjaGVtYVtrZXldLnR5cGUpIHtcbiAgICAgIGlmICh0eXBlb2Ygc2NoZW1hW2tleV0uZXhwZWN0cyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICByZXR1cm4gc2NoZW1hW2tleV0uZXhwZWN0cyh2YWx1ZSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8vIFZhbGlkYXRlIHNjaGVtYSAob25jZSBTY2hlbWEgY29uc3RydWN0b3IgaXMgY2FsbGVkKVxuICByZXR1cm4gZnVuY3Rpb24gdmFsaWRhdGVTY2hlbWEob2JqVG9WYWxpZGF0ZSkge1xuICAgIGxldCBwcm94eU9iaiA9IHt9XG4gICAgbGV0IG9iaiA9IG9ialRvVmFsaWRhdGVcblxuICAgIGZvciAobGV0IGtleSBvZiBPYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcyhvYmpUb1ZhbGlkYXRlKSkge1xuICAgICAgY29uc3QgcHJvcERlc2NyaXB0b3IgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yKG9ialRvVmFsaWRhdGUsIGtleSlcblxuICAgICAgLy8gUHJvcGVydHkgYWxyZWFkeSBwcm90ZWN0ZWRcbiAgICAgIGlmICghcHJvcERlc2NyaXB0b3Iud3JpdGFibGUgfHwgIXByb3BEZXNjcmlwdG9yLmNvbmZpZ3VyYWJsZSkge1xuICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkob2JqLCBrZXksIHByb3BEZXNjcmlwdG9yKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICAvLyBTY2hlbWEgZG9lcyBub3QgZXhpc3QgZm9yIHByb3AsIHBhc3N0aHJvdWdoXG4gICAgICBpZiAoIXNjaGVtYVtrZXldKSB7XG4gICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShvYmosIGtleSwgcHJvcERlc2NyaXB0b3IpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIHByb3h5T2JqW2tleV0gPSBvYmpUb1ZhbGlkYXRlW2tleV1cbiAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShvYmosIGtleSwge1xuICAgICAgICBlbnVtZXJhYmxlOiBwcm9wRGVzY3JpcHRvci5lbnVtZXJhYmxlLFxuICAgICAgICBjb25maWd1cmFibGU6IHByb3BEZXNjcmlwdG9yLmNvbmZpZ3VyYWJsZSxcbiAgICAgICAgZ2V0OiBmdW5jdGlvbigpIHtcbiAgICAgICAgICByZXR1cm4gcHJveHlPYmpba2V5XVxuICAgICAgICB9LFxuXG4gICAgICAgIHNldDogZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgICAgICBpZiAoIWlzVmFsaWRTY2hlbWEoa2V5LCB2YWx1ZSkpIHtcbiAgICAgICAgICAgIGlmIChzY2hlbWFba2V5XS5leHBlY3RzKSB7XG4gICAgICAgICAgICAgIHZhbHVlID0gKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpID8gdmFsdWUgOiB0eXBlb2YgdmFsdWVcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdFeHBlY3RpbmcgXCInICsga2V5ICsgJ1wiIHRvIGJlIFwiJyArIHNjaGVtYVtrZXldLnR5cGUgKyAnXCIsIGdvdCBcIicgKyB2YWx1ZSArICdcIicpXG4gICAgICAgICAgICB9IGVsc2UgaWYgKHNjaGVtYVtrZXldLnR5cGUgPT09ICdvcHRpb25hbCcpIHtcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdFeHBlY3RpbmcgXCInICsga2V5ICsgJ1wiIHRvIGJlIG9uZSBvZiBcIicgKyBzY2hlbWFba2V5XS50eXBlcyArICdcIiwgZ290IFwiJyArIHR5cGVvZiB2YWx1ZSArICdcIicpXG4gICAgICAgICAgICB9IGVsc2VcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdFeHBlY3RpbmcgXCInICsga2V5ICsgJ1wiIHRvIGJlIGEgXCInICsgc2NoZW1hW2tleV0udHlwZSArICdcIiwgZ290IFwiJyArIHR5cGVvZiB2YWx1ZSArICdcIicpXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcHJveHlPYmpba2V5XSA9IHZhbHVlXG4gICAgICAgICAgcmV0dXJuIHZhbHVlXG4gICAgICAgIH0sXG4gICAgICB9KVxuXG4gICAgICAvLyBBbnkgc2NoZW1hIGxlZnRvdmVyIHNob3VsZCBiZSBhZGRlZCBiYWNrIHRvIG9iamVjdCBmb3IgZnV0dXJlIHByb3RlY3Rpb25cbiAgICAgIGZvciAobGV0IGtleSBvZiBPYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcyhzY2hlbWEpKSB7XG4gICAgICAgIGlmIChvYmpba2V5XSlcbiAgICAgICAgICBjb250aW51ZVxuXG4gICAgICAgIHByb3h5T2JqW2tleV0gPSBvYmpUb1ZhbGlkYXRlW2tleV1cbiAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KG9iaiwga2V5LCB7XG4gICAgICAgICAgZW51bWVyYWJsZTogcHJvcERlc2NyaXB0b3IuZW51bWVyYWJsZSxcbiAgICAgICAgICBjb25maWd1cmFibGU6IHByb3BEZXNjcmlwdG9yLmNvbmZpZ3VyYWJsZSxcbiAgICAgICAgICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgcmV0dXJuIHByb3h5T2JqW2tleV1cbiAgICAgICAgICB9LFxuXG4gICAgICAgICAgc2V0OiBmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgICAgICAgaWYgKCFpc1ZhbGlkU2NoZW1hKGtleSwgdmFsdWUpKSB7XG4gICAgICAgICAgICAgIGlmIChzY2hlbWFba2V5XS5leHBlY3RzKSB7XG4gICAgICAgICAgICAgICAgdmFsdWUgPSAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJykgPyB2YWx1ZSA6IHR5cGVvZiB2YWx1ZVxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRXhwZWN0aW5nIFwiJyArIGtleSArICdcIiB0byBiZSBcIicgKyBzY2hlbWFba2V5XS50eXBlICsgJ1wiLCBnb3QgXCInICsgdmFsdWUgKyAnXCInKVxuICAgICAgICAgICAgICB9IGVsc2UgaWYgKHNjaGVtYVtrZXldLnR5cGUgPT09ICdvcHRpb25hbCcpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0V4cGVjdGluZyBcIicgKyBrZXkgKyAnXCIgdG8gYmUgb25lIG9mIFwiJyArIHNjaGVtYVtrZXldLnR5cGVzICsgJ1wiLCBnb3QgXCInICsgdHlwZW9mIHZhbHVlICsgJ1wiJylcbiAgICAgICAgICAgICAgfSBlbHNlXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdFeHBlY3RpbmcgXCInICsga2V5ICsgJ1wiIHRvIGJlIGEgXCInICsgc2NoZW1hW2tleV0udHlwZSArICdcIiwgZ290IFwiJyArIHR5cGVvZiB2YWx1ZSArICdcIicpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHByb3h5T2JqW2tleV0gPSB2YWx1ZVxuICAgICAgICAgICAgcmV0dXJuIHZhbHVlXG4gICAgICAgICAgfSxcbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgb2JqW2tleV0gPSBvYmpUb1ZhbGlkYXRlW2tleV1cbiAgICB9XG5cbiAgICByZXR1cm4gb2JqXG4gIH1cbn1cblxuT2JqZWN0TW9kZWwuU3RyaW5nTm90QmxhbmsgPSBPYmplY3RNb2RlbChmdW5jdGlvbiBTdHJpbmdOb3RCbGFuayhzdHIpIHtcbiAgaWYgKHR5cGVvZiBzdHIgIT09ICdzdHJpbmcnKVxuICAgIHJldHVybiBmYWxzZVxuXG4gIHJldHVybiBzdHIudHJpbSgpLmxlbmd0aCA+IDBcbn0pXG5cbmV4cG9ydCBkZWZhdWx0IE9iamVjdE1vZGVsXG4iLCIndXNlIHN0cmljdCdcblxuaW1wb3J0IE9iamVjdE1vZGVsIGZyb20gJy4vT2JqZWN0TW9kZWwnXG5cbi8vIFByb3RlY3QgQmx1ZXByaW50IHVzaW5nIGEgc2NoZW1hXG5jb25zdCBCbHVlcHJpbnRTY2hlbWEgPSBuZXcgT2JqZWN0TW9kZWwoe1xuICBuYW1lOiBPYmplY3RNb2RlbC5TdHJpbmdOb3RCbGFuayxcblxuICAvLyBCbHVlcHJpbnQgcHJvdmlkZXNcbiAgaW5pdDogW0Z1bmN0aW9uXSxcbiAgaW46IFtGdW5jdGlvbl0sXG4gIG9uOiBbRnVuY3Rpb25dLFxuICBkZXNjcmliZTogW09iamVjdF0sXG5cbiAgLy8gSW50ZXJuYWxzXG4gIG91dDogRnVuY3Rpb24sXG4gIGVycm9yOiBGdW5jdGlvbixcbiAgY2xvc2U6IFtGdW5jdGlvbl0sXG5cbiAgLy8gVXNlciBmYWNpbmdcbiAgdG86IEZ1bmN0aW9uLFxuICBmcm9tOiBGdW5jdGlvbixcbn0pXG5cbmV4cG9ydCBkZWZhdWx0IEJsdWVwcmludFNjaGVtYVxuIiwiLy8gVE9ETzogTW9kdWxlRmFjdG9yeSgpIGZvciBsb2FkZXIsIHdoaWNoIHBhc3NlcyB0aGUgbG9hZGVyICsgcHJvdG9jb2wgaW50byBpdC4uIFRoYXQgd2F5IGl0J3MgcmVjdXJzaXZlLi4uXG5cbmZ1bmN0aW9uIE1vZHVsZShfX2ZpbGVuYW1lLCBmaWxlQ29udGVudHMsIGNhbGxiYWNrKSB7XG4gIC8vIEZyb20gaWlmZSBjb2RlXG4gIGlmICghZmlsZUNvbnRlbnRzKVxuICAgIF9fZmlsZW5hbWUgPSBfX2ZpbGVuYW1lLnBhdGggfHwgJydcblxuICB2YXIgbW9kdWxlID0ge1xuICAgIGZpbGVuYW1lOiBfX2ZpbGVuYW1lLFxuICAgIGV4cG9ydHM6IHt9LFxuICAgIEJsdWVwcmludDogbnVsbCxcbiAgICByZXNvbHZlOiB7fSxcblxuICAgIHJlcXVpcmU6IGZ1bmN0aW9uKHVybCwgY2FsbGJhY2spIHtcbiAgICAgIHJldHVybiB3aW5kb3cuaHR0cC5tb2R1bGUuaW4uY2FsbCh3aW5kb3cuaHR0cC5tb2R1bGUsIHVybCwgY2FsbGJhY2spXG4gICAgfSxcbiAgfVxuXG4gIGlmICghY2FsbGJhY2spXG4gICAgcmV0dXJuIG1vZHVsZVxuXG4gIG1vZHVsZS5yZXNvbHZlW21vZHVsZS5maWxlbmFtZV0gPSBmdW5jdGlvbihleHBvcnRzKSB7XG4gICAgY2FsbGJhY2sobnVsbCwgZXhwb3J0cylcbiAgICBkZWxldGUgbW9kdWxlLnJlc29sdmVbbW9kdWxlLmZpbGVuYW1lXVxuICB9XG5cbiAgY29uc3Qgc2NyaXB0ID0gJ21vZHVsZS5yZXNvbHZlW1wiJyArIF9fZmlsZW5hbWUgKyAnXCJdKGZ1bmN0aW9uKGlpZmVNb2R1bGUpe1xcbicgK1xuICAnICB2YXIgbW9kdWxlID0gTW9kdWxlKGlpZmVNb2R1bGUpXFxuJyArXG4gICcgIHZhciBfX2ZpbGVuYW1lID0gbW9kdWxlLmZpbGVuYW1lXFxuJyArXG4gICcgIHZhciBfX2Rpcm5hbWUgPSBfX2ZpbGVuYW1lLnNsaWNlKDAsIF9fZmlsZW5hbWUubGFzdEluZGV4T2YoXCIvXCIpKVxcbicgK1xuICAnICB2YXIgcmVxdWlyZSA9IG1vZHVsZS5yZXF1aXJlXFxuJyArXG4gICcgIHZhciBleHBvcnRzID0gbW9kdWxlLmV4cG9ydHNcXG4nICtcbiAgJyAgdmFyIHByb2Nlc3MgPSB7IGJyb3dzZXI6IHRydWUgfVxcbicgK1xuICAnICB2YXIgQmx1ZXByaW50ID0gbnVsbDtcXG5cXG4nICtcblxuICAnKGZ1bmN0aW9uKCkge1xcbicgKyAvLyBDcmVhdGUgSUlGRSBmb3IgbW9kdWxlL2JsdWVwcmludFxuICAnXCJ1c2Ugc3RyaWN0XCI7XFxuJyArXG4gICAgZmlsZUNvbnRlbnRzICsgJ1xcbicgK1xuICAnfSkuY2FsbChtb2R1bGUuZXhwb3J0cyk7XFxuJyArIC8vIENyZWF0ZSAndGhpcycgYmluZGluZy5cbiAgJyAgaWYgKEJsdWVwcmludCkgeyByZXR1cm4gQmx1ZXByaW50fVxcbicgK1xuICAnICByZXR1cm4gbW9kdWxlLmV4cG9ydHNcXG4nICtcbiAgJ30obW9kdWxlKSk7J1xuXG4gIHdpbmRvdy5tb2R1bGUgPSBtb2R1bGVcbiAgd2luZG93Lmdsb2JhbCA9IHdpbmRvd1xuICB3aW5kb3cuTW9kdWxlID0gTW9kdWxlXG5cbiAgd2luZG93LnJlcXVpcmUgPSBmdW5jdGlvbih1cmwsIGNhbGxiYWNrKSB7XG4gICAgd2luZG93Lmh0dHAubW9kdWxlLmluaXQuY2FsbCh3aW5kb3cuaHR0cC5tb2R1bGUpXG4gICAgcmV0dXJuIHdpbmRvdy5odHRwLm1vZHVsZS5pbi5jYWxsKHdpbmRvdy5odHRwLm1vZHVsZSwgdXJsLCBjYWxsYmFjaylcbiAgfVxuXG5cbiAgcmV0dXJuIHNjcmlwdFxufVxuXG5leHBvcnQgZGVmYXVsdCBNb2R1bGVcbiIsImltcG9ydCBsb2cgZnJvbSAnLi4vLi4vbGliL2xvZ2dlcidcbmltcG9ydCBNb2R1bGUgZnJvbSAnLi4vLi4vbGliL01vZHVsZUxvYWRlcidcbmltcG9ydCBleHBvcnRlciBmcm9tICcuLi8uLi9saWIvZXhwb3J0cydcblxuLy8gRW1iZWRkZWQgaHR0cCBsb2FkZXIgYmx1ZXByaW50LlxuY29uc3QgaHR0cExvYWRlciA9IHtcbiAgbmFtZTogJ2xvYWRlcnMvaHR0cCcsXG4gIHByb3RvY29sOiAnbG9hZGVyJywgLy8gZW1iZWRkZWQgbG9hZGVyXG5cbiAgLy8gSW50ZXJuYWxzIGZvciBlbWJlZFxuICBsb2FkZWQ6IHRydWUsXG4gIGNhbGxiYWNrczogW10sXG5cbiAgbW9kdWxlOiB7XG4gICAgbmFtZTogJ0hUVFAgTG9hZGVyJyxcbiAgICBwcm90b2NvbDogWydodHRwJywgJ2h0dHBzJywgJ3dlYjovLyddLCAvLyBUT0RPOiBDcmVhdGUgYSB3YXkgZm9yIGxvYWRlciB0byBzdWJzY3JpYmUgdG8gbXVsdGlwbGUgcHJvdG9jb2xzXG5cbiAgICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICAgIHRoaXMuaXNCcm93c2VyID0gKHR5cGVvZiB3aW5kb3cgPT09ICdvYmplY3QnKSA/IHRydWUgOiBmYWxzZVxuICAgIH0sXG5cbiAgICBpbjogZnVuY3Rpb24oZmlsZU5hbWUsIG9wdHMsIGNhbGxiYWNrKSB7XG4gICAgICBpZiAoIXRoaXMuaXNCcm93c2VyKVxuICAgICAgICByZXR1cm4gY2FsbGJhY2soJ1VSTCBsb2FkaW5nIHdpdGggbm9kZS5qcyBub3Qgc3VwcG9ydGVkIHlldCAoQ29taW5nIHNvb24hKS4nKVxuXG4gICAgICByZXR1cm4gdGhpcy5icm93c2VyLmxvYWQuY2FsbCh0aGlzLCBmaWxlTmFtZSwgY2FsbGJhY2spXG4gICAgfSxcblxuICAgIG5vcm1hbGl6ZUZpbGVQYXRoOiBmdW5jdGlvbihmaWxlTmFtZSkge1xuICAgICAgaWYgKGZpbGVOYW1lLmluZGV4T2YoJ2h0dHAnKSA+PSAwKVxuICAgICAgICByZXR1cm4gZmlsZU5hbWVcblxuICAgICAgbGV0IGZpbGUgPSBmaWxlTmFtZSArICgoZmlsZU5hbWUuaW5kZXhPZignLmpzJykgPT09IC0xKSA/ICcuanMnIDogJycpXG4gICAgICBmaWxlID0gJ2JsdWVwcmludHMvJyArIGZpbGVcbiAgICAgIHJldHVybiBmaWxlXG4gICAgfSxcblxuICAgIGJyb3dzZXI6IHtcbiAgICAgIGxvYWQ6IGZ1bmN0aW9uKGZpbGVOYW1lLCBjYWxsYmFjaykge1xuICAgICAgICBjb25zdCBmaWxlUGF0aCA9IHRoaXMubm9ybWFsaXplRmlsZVBhdGgoZmlsZU5hbWUpXG4gICAgICAgIGxvZygnW2h0dHAgbG9hZGVyXSBMb2FkaW5nIGZpbGU6ICcgKyBmaWxlUGF0aClcblxuICAgICAgICB2YXIgaXNBc3luYyA9IHRydWVcbiAgICAgICAgdmFyIHN5bmNGaWxlID0gbnVsbFxuICAgICAgICBpZiAoIWNhbGxiYWNrKSB7XG4gICAgICAgICAgaXNBc3luYyA9IGZhbHNlXG4gICAgICAgICAgY2FsbGJhY2sgPSBmdW5jdGlvbihlcnIsIGZpbGUpIHtcbiAgICAgICAgICAgIGlmIChlcnIpXG4gICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihlcnIpXG5cbiAgICAgICAgICAgIHJldHVybiBzeW5jRmlsZSA9IGZpbGVcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBzY3JpcHRSZXF1ZXN0ID0gbmV3IFhNTEh0dHBSZXF1ZXN0KClcblxuICAgICAgICAvLyBUT0RPOiBOZWVkcyB2YWxpZGF0aW5nIHRoYXQgZXZlbnQgaGFuZGxlcnMgd29yayBhY3Jvc3MgYnJvd3NlcnMuIE1vcmUgc3BlY2lmaWNhbGx5LCB0aGF0IHRoZXkgcnVuIG9uIEVTNSBlbnZpcm9ubWVudHMuXG4gICAgICAgIC8vIGh0dHBzOi8vZGV2ZWxvcGVyLm1vemlsbGEub3JnL2VuLVVTL2RvY3MvV2ViL0FQSS9YTUxIdHRwUmVxdWVzdCNCcm93c2VyX2NvbXBhdGliaWxpdHlcbiAgICAgICAgY29uc3Qgc2NyaXB0RXZlbnRzID0gbmV3IHRoaXMuYnJvd3Nlci5zY3JpcHRFdmVudHModGhpcywgZmlsZU5hbWUsIGNhbGxiYWNrKVxuICAgICAgICBzY3JpcHRSZXF1ZXN0LmFkZEV2ZW50TGlzdGVuZXIoJ2xvYWQnLCBzY3JpcHRFdmVudHMub25Mb2FkKVxuICAgICAgICBzY3JpcHRSZXF1ZXN0LmFkZEV2ZW50TGlzdGVuZXIoJ2Vycm9yJywgc2NyaXB0RXZlbnRzLm9uRXJyb3IpXG5cbiAgICAgICAgc2NyaXB0UmVxdWVzdC5vcGVuKCdHRVQnLCBmaWxlUGF0aCwgaXNBc3luYylcbiAgICAgICAgc2NyaXB0UmVxdWVzdC5zZW5kKG51bGwpXG5cbiAgICAgICAgcmV0dXJuIHN5bmNGaWxlXG4gICAgICB9LFxuXG4gICAgICBzY3JpcHRFdmVudHM6IGZ1bmN0aW9uKGxvYWRlciwgZmlsZU5hbWUsIGNhbGxiYWNrKSB7XG4gICAgICAgIHRoaXMuY2FsbGJhY2sgPSBjYWxsYmFja1xuICAgICAgICB0aGlzLmZpbGVOYW1lID0gZmlsZU5hbWVcbiAgICAgICAgdGhpcy5vbkxvYWQgPSBsb2FkZXIuYnJvd3Nlci5vbkxvYWQuY2FsbCh0aGlzLCBsb2FkZXIpXG4gICAgICAgIHRoaXMub25FcnJvciA9IGxvYWRlci5icm93c2VyLm9uRXJyb3IuY2FsbCh0aGlzLCBsb2FkZXIpXG4gICAgICB9LFxuXG4gICAgICBvbkxvYWQ6IGZ1bmN0aW9uKGxvYWRlcikge1xuICAgICAgICBjb25zdCBzY3JpcHRFdmVudHMgPSB0aGlzXG4gICAgICAgIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICAgICAgICBjb25zdCBzY3JpcHRSZXF1ZXN0ID0gdGhpc1xuXG4gICAgICAgICAgaWYgKHNjcmlwdFJlcXVlc3Quc3RhdHVzID4gNDAwKVxuICAgICAgICAgICAgcmV0dXJuIHNjcmlwdEV2ZW50cy5vbkVycm9yLmNhbGwoc2NyaXB0UmVxdWVzdCwgc2NyaXB0UmVxdWVzdC5zdGF0dXNUZXh0KVxuXG4gICAgICAgICAgY29uc3Qgc2NyaXB0Q29udGVudCA9IE1vZHVsZShzY3JpcHRSZXF1ZXN0LnJlc3BvbnNlVVJMLCBzY3JpcHRSZXF1ZXN0LnJlc3BvbnNlVGV4dCwgc2NyaXB0RXZlbnRzLmNhbGxiYWNrKVxuXG4gICAgICAgICAgdmFyIGh0bWwgPSBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnRcbiAgICAgICAgICB2YXIgc2NyaXB0VGFnID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc2NyaXB0JylcbiAgICAgICAgICBzY3JpcHRUYWcudGV4dENvbnRlbnQgPSBzY3JpcHRDb250ZW50XG5cbiAgICAgICAgICBodG1sLmFwcGVuZENoaWxkKHNjcmlwdFRhZylcbiAgICAgICAgICBsb2FkZXIuYnJvd3Nlci5jbGVhbnVwKHNjcmlwdFRhZywgc2NyaXB0RXZlbnRzKVxuICAgICAgICB9XG4gICAgICB9LFxuXG4gICAgICBvbkVycm9yOiBmdW5jdGlvbihsb2FkZXIpIHtcbiAgICAgICAgY29uc3Qgc2NyaXB0RXZlbnRzID0gdGhpc1xuICAgICAgICBjb25zdCBmaWxlTmFtZSA9IHNjcmlwdEV2ZW50cy5maWxlTmFtZVxuXG4gICAgICAgIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICAgICAgICBjb25zdCBzY3JpcHRUYWcgPSB0aGlzXG4gICAgICAgICAgbG9hZGVyLmJyb3dzZXIuY2xlYW51cChzY3JpcHRUYWcsIHNjcmlwdEV2ZW50cylcblxuICAgICAgICAgIC8vIFRyeSB0byBmYWxsYmFjayB0byBpbmRleC5qc1xuICAgICAgICAgIC8vIEZJWE1FOiBpbnN0ZWFkIG9mIGZhbGxpbmcgYmFjaywgdGhpcyBzaG91bGQgYmUgdGhlIGRlZmF1bHQgaWYgbm8gYC5qc2AgaXMgZGV0ZWN0ZWQsIGJ1dCBVUkwgdWdsaWZpZXJzIGFuZCBzdWNoIHdpbGwgaGF2ZSBpc3N1ZXMuLiBocm1tbW0uLlxuICAgICAgICAgIGlmIChmaWxlTmFtZS5pbmRleE9mKCcuanMnKSA9PT0gLTEgJiYgZmlsZU5hbWUuaW5kZXhPZignaW5kZXguanMnKSA9PT0gLTEpIHtcbiAgICAgICAgICAgIGxvZy53YXJuKCdbaHR0cF0gQXR0ZW1wdGluZyB0byBmYWxsYmFjayB0bzogJywgZmlsZU5hbWUgKyAnL2luZGV4LmpzJylcbiAgICAgICAgICAgIHJldHVybiBsb2FkZXIuaW4uY2FsbChsb2FkZXIsIGZpbGVOYW1lICsgJy9pbmRleC5qcycsIHNjcmlwdEV2ZW50cy5jYWxsYmFjaylcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBzY3JpcHRFdmVudHMuY2FsbGJhY2soJ0NvdWxkIG5vdCBsb2FkIEJsdWVwcmludCcpXG4gICAgICAgIH1cbiAgICAgIH0sXG5cbiAgICAgIGNsZWFudXA6IGZ1bmN0aW9uKHNjcmlwdFRhZywgc2NyaXB0RXZlbnRzKSB7XG4gICAgICAgIHNjcmlwdFRhZy5yZW1vdmVFdmVudExpc3RlbmVyKCdsb2FkJywgc2NyaXB0RXZlbnRzLm9uTG9hZClcbiAgICAgICAgc2NyaXB0VGFnLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ2Vycm9yJywgc2NyaXB0RXZlbnRzLm9uRXJyb3IpXG4gICAgICAgIC8vZG9jdW1lbnQuZ2V0RWxlbWVudHNCeVRhZ05hbWUoJ2hlYWQnKVswXS5yZW1vdmVDaGlsZChzY3JpcHRUYWcpIC8vIFRPRE86IENsZWFudXBcbiAgICAgIH0sXG4gICAgfSxcblxuICAgIG5vZGU6IHtcbiAgICAgIC8vIFN0dWIgZm9yIG5vZGUuanMgSFRUUCBsb2FkaW5nIHN1cHBvcnQuXG4gICAgfSxcblxuICB9LFxufVxuXG5leHBvcnRlcignaHR0cCcsIGh0dHBMb2FkZXIpIC8vIFRPRE86IENsZWFudXAsIGV4cG9zZSBtb2R1bGVzIGluc3RlYWRcblxuZXhwb3J0IGRlZmF1bHQgaHR0cExvYWRlclxuIiwiaW1wb3J0IGxvZyBmcm9tICcuLi8uLi9saWIvbG9nZ2VyJ1xuXG4vLyBFbWJlZGRlZCBmaWxlIGxvYWRlciBibHVlcHJpbnQuXG5jb25zdCBmaWxlTG9hZGVyID0ge1xuICBuYW1lOiAnbG9hZGVycy9maWxlJyxcbiAgcHJvdG9jb2w6ICdlbWJlZCcsXG5cbiAgLy8gSW50ZXJuYWxzIGZvciBlbWJlZFxuICBsb2FkZWQ6IHRydWUsXG4gIGNhbGxiYWNrczogW10sXG5cbiAgbW9kdWxlOiB7XG4gICAgbmFtZTogJ0ZpbGUgTG9hZGVyJyxcbiAgICBwcm90b2NvbDogJ2ZpbGUnLFxuXG4gICAgaW5pdDogZnVuY3Rpb24oKSB7XG4gICAgICB0aGlzLmlzQnJvd3NlciA9ICh0eXBlb2Ygd2luZG93ID09PSAnb2JqZWN0JykgPyB0cnVlIDogZmFsc2VcbiAgICB9LFxuXG4gICAgaW46IGZ1bmN0aW9uKGZpbGVOYW1lLCBvcHRzLCBjYWxsYmFjaykge1xuICAgICAgaWYgKHRoaXMuaXNCcm93c2VyKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ZpbGU6Ly8gbG9hZGluZyB3aXRoaW4gYnJvd3NlciBub3Qgc3VwcG9ydGVkIHlldC4gVHJ5IHJlbGF0aXZlIFVSTCBpbnN0ZWFkLicpXG5cbiAgICAgIGxvZygnW2ZpbGUgbG9hZGVyXSBMb2FkaW5nIGZpbGU6ICcgKyBmaWxlTmFtZSlcblxuICAgICAgLy8gVE9ETzogU3dpdGNoIHRvIGFzeW5jIGZpbGUgbG9hZGluZywgaW1wcm92ZSByZXF1aXJlKCksIHBhc3MgaW4gSUlGRSB0byBzYW5kYm94LCB1c2UgSUlGRSByZXNvbHZlciBmb3IgY2FsbGJhY2tcbiAgICAgIC8vIFRPRE86IEFkZCBlcnJvciByZXBvcnRpbmcuXG5cbiAgICAgIGNvbnN0IHZtID0gcmVxdWlyZSgndm0nKVxuICAgICAgY29uc3QgZnMgPSByZXF1aXJlKCdmcycpXG5cbiAgICAgIGNvbnN0IGZpbGVQYXRoID0gdGhpcy5ub3JtYWxpemVGaWxlUGF0aChmaWxlTmFtZSlcblxuICAgICAgY29uc3QgZmlsZSA9IHRoaXMucmVzb2x2ZUZpbGUoZmlsZVBhdGgpXG4gICAgICBpZiAoIWZpbGUpXG4gICAgICAgIHJldHVybiBjYWxsYmFjaygnQmx1ZXByaW50IG5vdCBmb3VuZCcpXG5cbiAgICAgIGNvbnN0IGZpbGVDb250ZW50cyA9IGZzLnJlYWRGaWxlU3luYyhmaWxlKS50b1N0cmluZygpXG5cbiAgICAgIC8vY29uc3Qgc2FuZGJveCA9IHsgQmx1ZXByaW50OiBudWxsIH1cbiAgICAgIC8vdm0uY3JlYXRlQ29udGV4dChzYW5kYm94KVxuICAgICAgLy92bS5ydW5JbkNvbnRleHQoZmlsZUNvbnRlbnRzLCBzYW5kYm94KVxuXG4gICAgICBnbG9iYWwuQmx1ZXByaW50ID0gbnVsbFxuICAgICAgdm0ucnVuSW5UaGlzQ29udGV4dChmaWxlQ29udGVudHMpXG5cbiAgICAgIGNhbGxiYWNrKG51bGwsIGdsb2JhbC5CbHVlcHJpbnQpXG4gICAgfSxcblxuICAgIG5vcm1hbGl6ZUZpbGVQYXRoOiBmdW5jdGlvbihmaWxlTmFtZSkge1xuICAgICAgY29uc3QgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKVxuICAgICAgcmV0dXJuIHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCAnYmx1ZXByaW50cy8nLCBmaWxlTmFtZSlcbiAgICB9LFxuXG4gICAgcmVzb2x2ZUZpbGU6IGZ1bmN0aW9uKGZpbGVQYXRoKSB7XG4gICAgICBjb25zdCBmcyA9IHJlcXVpcmUoJ2ZzJylcbiAgICAgIGNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJylcblxuICAgICAgLy8gSWYgZmlsZSBvciBkaXJlY3RvcnkgZXhpc3RzXG4gICAgICBpZiAoZnMuZXhpc3RzU3luYyhmaWxlUGF0aCkpIHtcbiAgICAgICAgLy8gQ2hlY2sgaWYgYmx1ZXByaW50IGlzIGEgZGlyZWN0b3J5IGZpcnN0XG4gICAgICAgIGlmIChmcy5zdGF0U3luYyhmaWxlUGF0aCkuaXNEaXJlY3RvcnkoKSlcbiAgICAgICAgICByZXR1cm4gcGF0aC5yZXNvbHZlKGZpbGVQYXRoLCAnaW5kZXguanMnKVxuICAgICAgICBlbHNlXG4gICAgICAgICAgcmV0dXJuIGZpbGVQYXRoICsgKChmaWxlUGF0aC5pbmRleE9mKCcuanMnKSA9PT0gLTEpID8gJy5qcycgOiAnJylcbiAgICAgIH1cblxuICAgICAgLy8gVHJ5IGFkZGluZyBhbiBleHRlbnNpb24gdG8gc2VlIGlmIGl0IGV4aXN0c1xuICAgICAgY29uc3QgZmlsZSA9IGZpbGVQYXRoICsgKChmaWxlUGF0aC5pbmRleE9mKCcuanMnKSA9PT0gLTEpID8gJy5qcycgOiAnJylcbiAgICAgIGlmIChmcy5leGlzdHNTeW5jKGZpbGUpKVxuICAgICAgICByZXR1cm4gZmlsZVxuXG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG4gIH0sXG59XG5cblxuZXhwb3J0IGRlZmF1bHQgZmlsZUxvYWRlclxuIiwiLyogZXNsaW50LWRpc2FibGUgcHJlZmVyLXRlbXBsYXRlICovXG5pbXBvcnQgbG9nIGZyb20gJy4vbG9nZ2VyJ1xuaW1wb3J0IGh0dHBMb2FkZXIgZnJvbSAnLi4vYmx1ZXByaW50cy9sb2FkZXJzL2h0dHAnXG5pbXBvcnQgZmlsZUxvYWRlciBmcm9tICcuLi9ibHVlcHJpbnRzL2xvYWRlcnMvZmlsZSdcblxuLy8gTXVsdGktZW52aXJvbm1lbnQgYXN5bmMgbW9kdWxlIGxvYWRlclxuY29uc3QgbW9kdWxlcyA9IHtcbiAgJ2xvYWRlcnMvaHR0cCc6IGh0dHBMb2FkZXIsXG4gICdsb2FkZXJzL2ZpbGUnOiBmaWxlTG9hZGVyLFxufVxuXG5mdW5jdGlvbiBub3JtYWxpemVOYW1lKG5hbWUpIHtcbiAgLy8gVE9ETzogbG9vcCB0aHJvdWdoIGVhY2ggZmlsZSBwYXRoIGFuZCBub3JtYWxpemUgaXQgdG9vOlxuICByZXR1cm4gbmFtZS50cmltKCkudG9Mb3dlckNhc2UoKS8vLmNhcGl0YWxpemUoKVxufVxuXG5mdW5jdGlvbiByZXNvbHZlRmlsZUluZm8oZmlsZSkge1xuICBjb25zdCBub3JtYWxpemVkRmlsZU5hbWUgPSBub3JtYWxpemVOYW1lKGZpbGUpXG4gIGNvbnN0IHByb3RvY29sID0gcGFyc2VQcm90b2NvbChmaWxlKVxuXG4gIHJldHVybiB7XG4gICAgZmlsZTogZmlsZSxcbiAgICBwYXRoOiBmaWxlLFxuICAgIG5hbWU6IG5vcm1hbGl6ZWRGaWxlTmFtZSxcbiAgICBwcm90b2NvbDogcHJvdG9jb2wsXG4gIH1cbn1cblxuZnVuY3Rpb24gcGFyc2VQcm90b2NvbChuYW1lKSB7XG4gIC8vIEZJWE1FOiBuYW1lIHNob3VsZCBvZiBiZWVuIG5vcm1hbGl6ZWQgYnkgbm93LiBFaXRoZXIgcmVtb3ZlIHRoaXMgY29kZSBvciBtb3ZlIGl0IHNvbWV3aGVyZSBlbHNlLi5cbiAgaWYgKCFuYW1lIHx8IHR5cGVvZiBuYW1lICE9PSAnc3RyaW5nJylcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgbG9hZGVyIGJsdWVwcmludCBuYW1lJylcblxuICB2YXIgcHJvdG9SZXN1bHRzID0gbmFtZS5tYXRjaCgvOlxcL1xcLy9naSkgJiYgbmFtZS5zcGxpdCgvOlxcL1xcLy9naSlcblxuICAvLyBObyBwcm90b2NvbCBmb3VuZCwgaWYgYnJvd3NlciBlbnZpcm9ubWVudCB0aGVuIGlzIHJlbGF0aXZlIFVSTCBlbHNlIGlzIGEgZmlsZSBwYXRoLiAoU2FuZSBkZWZhdWx0cyBidXQgY2FuIGJlIG92ZXJyaWRkZW4pXG4gIGlmICghcHJvdG9SZXN1bHRzKVxuICAgIHJldHVybiAodHlwZW9mIHdpbmRvdyA9PT0gJ29iamVjdCcpID8gJ2h0dHAnIDogJ2ZpbGUnXG5cbiAgcmV0dXJuIHByb3RvUmVzdWx0c1swXVxufVxuXG5mdW5jdGlvbiBydW5Nb2R1bGVDYWxsYmFja3MobW9kdWxlKSB7XG4gIGZvciAobGV0IGNhbGxiYWNrIG9mIG1vZHVsZS5jYWxsYmFja3MpIHtcbiAgICBjYWxsYmFjayhtb2R1bGUubW9kdWxlKVxuICB9XG5cbiAgbW9kdWxlLmNhbGxiYWNrcyA9IFtdXG59XG5cbmNvbnN0IGltcG9ydHMgPSBmdW5jdGlvbihuYW1lLCBvcHRzLCBjYWxsYmFjaykge1xuICB0cnkge1xuICAgIGNvbnN0IGZpbGVJbmZvID0gcmVzb2x2ZUZpbGVJbmZvKG5hbWUpXG4gICAgY29uc3QgZmlsZU5hbWUgPSBmaWxlSW5mby5uYW1lXG4gICAgY29uc3QgcHJvdG9jb2wgPSBmaWxlSW5mby5wcm90b2NvbFxuXG4gICAgbG9nKCdsb2FkaW5nIG1vZHVsZTonLCBmaWxlTmFtZSlcblxuICAgIC8vIE1vZHVsZSBoYXMgbG9hZGVkIG9yIHN0YXJ0ZWQgdG8gbG9hZFxuICAgIGlmIChtb2R1bGVzW2ZpbGVOYW1lXSlcbiAgICAgIGlmIChtb2R1bGVzW2ZpbGVOYW1lXS5sb2FkZWQpXG4gICAgICAgIHJldHVybiBjYWxsYmFjayhtb2R1bGVzW2ZpbGVOYW1lXS5tb2R1bGUpIC8vIFJldHVybiBtb2R1bGUgZnJvbSBDYWNoZVxuICAgICAgZWxzZVxuICAgICAgICByZXR1cm4gbW9kdWxlc1tmaWxlTmFtZV0uY2FsbGJhY2tzLnB1c2goY2FsbGJhY2spIC8vIE5vdCBsb2FkZWQgeWV0LCByZWdpc3RlciBjYWxsYmFja1xuXG4gICAgbW9kdWxlc1tmaWxlTmFtZV0gPSB7XG4gICAgICBmaWxlTmFtZTogZmlsZU5hbWUsXG4gICAgICBwcm90b2NvbDogcHJvdG9jb2wsXG4gICAgICBsb2FkZWQ6IGZhbHNlLFxuICAgICAgY2FsbGJhY2tzOiBbY2FsbGJhY2tdLFxuICAgIH1cblxuICAgIC8vIEJvb3RzdHJhcHBpbmcgbG9hZGVyIGJsdWVwcmludHMgOylcbiAgICAvL0ZyYW1lKCdMb2FkZXJzLycgKyBwcm90b2NvbCkuZnJvbShmaWxlTmFtZSkudG8oZmlsZU5hbWUsIG9wdHMsIGZ1bmN0aW9uKGVyciwgZXhwb3J0RmlsZSkge30pXG5cbiAgICBjb25zdCBsb2FkZXIgPSAnbG9hZGVycy8nICsgcHJvdG9jb2xcbiAgICBtb2R1bGVzW2xvYWRlcl0ubW9kdWxlLmluaXQoKSAvLyBUT0RPOiBvcHRpb25hbCBpbml0IChpbnNpZGUgRnJhbWUgY29yZSlcbiAgICBtb2R1bGVzW2xvYWRlcl0ubW9kdWxlLmluKGZpbGVOYW1lLCBvcHRzLCBmdW5jdGlvbihlcnIsIGV4cG9ydEZpbGUpe1xuICAgICAgaWYgKGVycilcbiAgICAgICAgbG9nKCdFcnJvcjogJywgZXJyLCBmaWxlTmFtZSlcbiAgICAgIGVsc2Uge1xuICAgICAgICBsb2coJ0xvYWRlZCBCbHVlcHJpbnQgbW9kdWxlOiAnLCBmaWxlTmFtZSlcblxuICAgICAgICBpZiAoIWV4cG9ydEZpbGUgfHwgdHlwZW9mIGV4cG9ydEZpbGUgIT09ICdvYmplY3QnKVxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBCbHVlcHJpbnQgZmlsZSwgQmx1ZXByaW50IGlzIGV4cGVjdGVkIHRvIGJlIGFuIG9iamVjdCBvciBjbGFzcycpXG5cbiAgICAgICAgaWYgKHR5cGVvZiBleHBvcnRGaWxlLm5hbWUgIT09ICdzdHJpbmcnKVxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBCbHVlcHJpbnQgZmlsZSwgQmx1ZXByaW50IG1pc3NpbmcgYSBuYW1lJylcblxuICAgICAgICBsZXQgbW9kdWxlID0gbW9kdWxlc1tmaWxlTmFtZV1cbiAgICAgICAgaWYgKCFtb2R1bGUpXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdVaCBvaCwgd2Ugc2hvdWxkbnQgYmUgaGVyZScpXG5cbiAgICAgICAgLy8gTW9kdWxlIGFscmVhZHkgbG9hZGVkLiBOb3Qgc3VwcG9zZSB0byBiZSBoZXJlLiBPbmx5IGZyb20gZm9yY2UtbG9hZGluZyB3b3VsZCBnZXQgeW91IGhlcmUuXG4gICAgICAgIGlmIChtb2R1bGUubG9hZGVkKVxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignQmx1ZXByaW50IFwiJyArIGV4cG9ydEZpbGUubmFtZSArICdcIiBhbHJlYWR5IGxvYWRlZC4nKVxuXG4gICAgICAgIG1vZHVsZS5tb2R1bGUgPSBleHBvcnRGaWxlXG4gICAgICAgIG1vZHVsZS5sb2FkZWQgPSB0cnVlXG5cbiAgICAgICAgcnVuTW9kdWxlQ2FsbGJhY2tzKG1vZHVsZSlcbiAgICAgIH1cbiAgICB9KVxuXG4gICAgLy8gVE9ETzogbW9kdWxlc1tsb2FkZXJdLm1vZHVsZS5idW5kbGUgc3VwcG9ydCBmb3IgQ0xJIHRvb2xpbmcuXG5cbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdDb3VsZCBub3QgbG9hZCBibHVlcHJpbnQgXFwnJyArIG5hbWUgKyAnXFwnXFxuJyArIGVycilcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBpbXBvcnRzXG4iLCIndXNlIHN0cmljdCdcblxuaW1wb3J0IGxvZyBmcm9tICcuL2xvZ2dlcidcbmltcG9ydCBleHBvcnRlciBmcm9tICcuL2V4cG9ydHMnXG5pbXBvcnQgKiBhcyBoZWxwZXJzIGZyb20gJy4vaGVscGVycydcbmltcG9ydCBCbHVlcHJpbnRNZXRob2RzIGZyb20gJy4vbWV0aG9kcydcbmltcG9ydCB7IGRlYm91bmNlLCBwcm9jZXNzRmxvdyB9IGZyb20gJy4vbWV0aG9kcydcbmltcG9ydCBCbHVlcHJpbnRCYXNlIGZyb20gJy4vQmx1ZXByaW50QmFzZSdcbmltcG9ydCBCbHVlcHJpbnRTY2hlbWEgZnJvbSAnLi9zY2hlbWEnXG5pbXBvcnQgaW1wb3J0cyBmcm9tICcuL2xvYWRlcidcblxuLy8gRnJhbWUgYW5kIEJsdWVwcmludCBjb25zdHJ1Y3RvcnNcbmNvbnN0IHNpbmdsZXRvbnMgPSB7fVxuZnVuY3Rpb24gRnJhbWUobmFtZSwgb3B0cykge1xuICBpZiAoISh0aGlzIGluc3RhbmNlb2YgRnJhbWUpKVxuICAgIHJldHVybiBuZXcgRnJhbWUobmFtZSwgb3B0cylcblxuICBpZiAodHlwZW9mIG5hbWUgIT09ICdzdHJpbmcnKVxuICAgIHRocm93IG5ldyBFcnJvcignQmx1ZXByaW50IG5hbWUgXFwnJyArIG5hbWUgKyAnXFwnIGlzIG5vdCB2YWxpZC5cXG4nKVxuXG4gIC8vIElmIGJsdWVwcmludCBpcyBhIHNpbmdsZXRvbiAoZm9yIHNoYXJlZCByZXNvdXJjZXMpLCByZXR1cm4gaXQgaW5zdGVhZCBvZiBjcmVhdGluZyBuZXcgaW5zdGFuY2UuXG4gIGlmIChzaW5nbGV0b25zW25hbWVdKVxuICAgIHJldHVybiBzaW5nbGV0b25zW25hbWVdXG5cbiAgbGV0IGJsdWVwcmludCA9IG5ldyBCbHVlcHJpbnQobmFtZSlcbiAgaW1wb3J0cyhuYW1lLCBvcHRzLCBmdW5jdGlvbihibHVlcHJpbnRGaWxlKSB7XG4gICAgdHJ5IHtcblxuICAgICAgbG9nKCdCbHVlcHJpbnQgbG9hZGVkOicsIGJsdWVwcmludEZpbGUubmFtZSlcblxuICAgICAgaWYgKHR5cGVvZiBibHVlcHJpbnRGaWxlICE9PSAnb2JqZWN0JylcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdCbHVlcHJpbnQgaXMgZXhwZWN0ZWQgdG8gYmUgYW4gb2JqZWN0IG9yIGNsYXNzJylcblxuICAgICAgLy8gVXBkYXRlIGZhdXggYmx1ZXByaW50IHN0dWIgd2l0aCByZWFsIG1vZHVsZVxuICAgICAgaGVscGVycy5hc3NpZ25PYmplY3QoYmx1ZXByaW50LCBibHVlcHJpbnRGaWxlKVxuXG4gICAgICAvLyBVcGRhdGUgYmx1ZXByaW50IG5hbWVcbiAgICAgIGhlbHBlcnMuc2V0RGVzY3JpcHRvcihibHVlcHJpbnQsIGJsdWVwcmludEZpbGUubmFtZSwgZmFsc2UpXG4gICAgICBibHVlcHJpbnQuRnJhbWUubmFtZSA9IGJsdWVwcmludEZpbGUubmFtZVxuXG4gICAgICAvLyBBcHBseSBhIHNjaGVtYSB0byBibHVlcHJpbnRcbiAgICAgIGJsdWVwcmludCA9IEJsdWVwcmludFNjaGVtYShibHVlcHJpbnQpXG5cbiAgICAgIC8vIFZhbGlkYXRlIEJsdWVwcmludCBpbnB1dCB3aXRoIG9wdGlvbmFsIHByb3BlcnR5IGRlc3RydWN0dXJpbmcgKHVzaW5nIGRlc2NyaWJlIHN5bnRheClcbiAgICAgIGJsdWVwcmludC5GcmFtZS5kZXNjcmliZSA9IGhlbHBlcnMuY3JlYXRlRGVzdHJ1Y3R1cmUoYmx1ZXByaW50LmRlc2NyaWJlLCBCbHVlcHJpbnRCYXNlLmRlc2NyaWJlKVxuXG4gICAgICBibHVlcHJpbnQuRnJhbWUubG9hZGVkID0gdHJ1ZVxuICAgICAgZGVib3VuY2UocHJvY2Vzc0Zsb3csIDEsIGJsdWVwcmludClcblxuICAgICAgLy8gSWYgYmx1ZXByaW50IGludGVuZHMgdG8gYmUgYSBzaW5nbGV0b24sIGFkZCBpdCB0byB0aGUgbGlzdC5cbiAgICAgIGlmIChibHVlcHJpbnQuc2luZ2xldG9uKVxuICAgICAgICBzaW5nbGV0b25zW2JsdWVwcmludC5uYW1lXSA9IGJsdWVwcmludFxuXG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0JsdWVwcmludCBcXCcnICsgbmFtZSArICdcXCcgaXMgbm90IHZhbGlkLlxcbicgKyBlcnIpXG4gICAgfVxuICB9KVxuXG4gIHJldHVybiBibHVlcHJpbnRcbn1cblxuZnVuY3Rpb24gQmx1ZXByaW50KG5hbWUpIHtcbiAgbGV0IGJsdWVwcmludCA9IG5ldyBCbHVlcHJpbnRDb25zdHJ1Y3RvcihuYW1lKVxuICBoZWxwZXJzLnNldERlc2NyaXB0b3IoYmx1ZXByaW50LCAnQmx1ZXByaW50JywgdHJ1ZSlcblxuICAvLyBCbHVlcHJpbnQgbWV0aG9kc1xuICBoZWxwZXJzLmFzc2lnbk9iamVjdChibHVlcHJpbnQsIEJsdWVwcmludE1ldGhvZHMpXG5cbiAgLy8gQ3JlYXRlIGhpZGRlbiBibHVlcHJpbnQuRnJhbWUgcHJvcGVydHkgdG8ga2VlcCBzdGF0ZVxuICBsZXQgYmx1ZXByaW50QmFzZSA9IE9iamVjdC5jcmVhdGUoQmx1ZXByaW50QmFzZSlcbiAgaGVscGVycy5hc3NpZ25PYmplY3QoYmx1ZXByaW50QmFzZSwgQmx1ZXByaW50QmFzZSlcbiAgT2JqZWN0LmRlZmluZVByb3BlcnR5KGJsdWVwcmludCwgJ0ZyYW1lJywgeyB2YWx1ZTogYmx1ZXByaW50QmFzZSwgZW51bWVyYWJsZTogdHJ1ZSwgY29uZmlndXJhYmxlOiB0cnVlLCB3cml0YWJsZTogZmFsc2UgfSkgLy8gVE9ETzogY29uZmlndXJhYmxlOiBmYWxzZSwgZW51bWVyYWJsZTogZmFsc2VcbiAgYmx1ZXByaW50LkZyYW1lLm5hbWUgPSBuYW1lXG5cbiAgcmV0dXJuIGJsdWVwcmludFxufVxuXG5mdW5jdGlvbiBCbHVlcHJpbnRDb25zdHJ1Y3RvcihuYW1lKSB7XG4gIC8vIENyZWF0ZSBibHVlcHJpbnQgZnJvbSBjb25zdHJ1Y3RvclxuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgLy8gSWYgYmx1ZXByaW50IGlzIGEgc2luZ2xldG9uIChmb3Igc2hhcmVkIHJlc291cmNlcyksIHJldHVybiBpdCBpbnN0ZWFkIG9mIGNyZWF0aW5nIG5ldyBpbnN0YW5jZS5cbiAgICBpZiAoc2luZ2xldG9uc1tuYW1lXSlcbiAgICAgIHJldHVybiBzaW5nbGV0b25zW25hbWVdXG5cbiAgICBsZXQgYmx1ZXByaW50ID0gbmV3IEZyYW1lKG5hbWUpXG4gICAgYmx1ZXByaW50LkZyYW1lLnByb3BzID0gYXJndW1lbnRzXG5cbiAgICByZXR1cm4gYmx1ZXByaW50XG4gIH1cbn1cblxuLy8gR2l2ZSBGcmFtZSBhbiBlYXN5IGRlc2NyaXB0b3JcbmhlbHBlcnMuc2V0RGVzY3JpcHRvcihGcmFtZSwgJ0NvbnN0cnVjdG9yJylcbmhlbHBlcnMuc2V0RGVzY3JpcHRvcihGcmFtZS5jb25zdHJ1Y3RvciwgJ0ZyYW1lJylcblxuLy8gRXhwb3J0IEZyYW1lIGdsb2JhbGx5XG5leHBvcnRlcignRnJhbWUnLCBGcmFtZSlcbmV4cG9ydCBkZWZhdWx0IEZyYW1lXG4iXSwibmFtZXMiOlsiaGVscGVycy5hc3NpZ25PYmplY3QiLCJoZWxwZXJzLnNldERlc2NyaXB0b3IiLCJoZWxwZXJzLmNyZWF0ZURlc3RydWN0dXJlIl0sIm1hcHBpbmdzIjoiOzs7RUFFQSxTQUFTLEdBQUcsR0FBRztFQUNmO0VBQ0EsRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsU0FBUyxFQUFDO0VBQ3BDLENBQUM7O0VBRUQsR0FBRyxDQUFDLEtBQUssR0FBRyxXQUFXO0VBQ3ZCO0VBQ0EsRUFBRSxPQUFPLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsU0FBUyxFQUFDO0VBQ3RDLEVBQUM7O0VBRUQsR0FBRyxDQUFDLElBQUksR0FBRyxXQUFXO0VBQ3RCO0VBQ0EsRUFBRSxPQUFPLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsU0FBUyxFQUFDO0VBQ3JDLENBQUM7O0VDZkQ7RUFDQTtFQUNBLFNBQVMsUUFBUSxDQUFD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
