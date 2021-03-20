# This project has moved to [FlowJS](https://github.com/NuFlow/FlowJS) 

# Why the move?
The code has been dranatically simplified and easier to reason about. Rather than trying to solve too many problems (like dynamic imports), it leaves these to your builder or toolchain of choice (New ES6 Imports can do this for you). <br>
<br>
**Instead, we now focus solely on Code Flow Control.**

---

# Frame
Frame is a flow based programming library for databases, APIs, utilities, objects, schemas and more!

# Features:
- Cross Platform - Runs everywhere Javascript does
- Declarative style (tell the library WHAT you want, not how you want it) - [1](https://codeburst.io/declarative-vs-imperative-programming-a8a7c93d9ad2) [2](http://latentflip.com/imperative-vs-declarative) [3](https://stackoverflow.com/a/39561818) [4](https://tylermcginnis.com/imperative-vs-declarative-programming/)
- Custom module loaders (Browserify, Webpack, RequireJS, [Github](https://github.com), [Gist](https://gist.github.com), [GunDB](https://github.com/gundb/gun), [any other module loader here])
- Easy NodeRED-like Syntax
- Modules known as Blueprints are easily shareable!
- Blueprints have an extremely easy syntax, with Schema support.
- Singletons offer optional Shared resources built right in! (New flows don't need multiple connections, etc)
- Functions have a lot of freedom, they can use return values, Promises, async/await, or use the callback. Frame gets out of your preferred way/style of coding.

<br>

# Coming Soon:
- Full featured drag and drop Web + Electron IDE for building the future of apps
- Mobile IDE (React Native) for iOS, Android, etc
- Transpiling + Build steps for truly cross platform libraries
- Hosted solution without having to upload your Blueprints somewhere (along with transpiling configurations)
- Error propagation via the flow (with custom paths), without falling over

<br>

# Pseudo-Examples:
## Custom Loaders ##

```
// From Github files
const SomeBlueprint = Frame("git://pathToYourFile.js")

// From Github repos
const SomeBlueprintFromRepo = Frame("git://SomeOrganization/YourFavoriteRepo")

// From HTTP URLs
const BlueprintFromURL = Frame("http://example.com/yourFile.js")

// From many different databases and stores
const BlueprintFromDB = Frame("mongodb://fileInDb.js")
```

## Easy syntax ##
### Render HTML/CSS with a Message from a database (Gun) ###

```
Message
  .from(Gun) // Receive a message from a database
  .to(Schema) // Validate message format
  .to(HTML) // Convert to HTML
  .to(Style) // Dynamic styles!
  .to(RenderFunction) // Finally render it, using our own function
```

### Order does not matter ###

```
// Example #1: Multiple event handlers (Left to right processing.)
Message
  .from(Slack)
  .from(Gitter)
  .to(Console)

// Example #2: (Right to left processing.)
Message
  .to(Console)
  .from(Slack)
  .from(Gitter)

Example #3: (Somewhere in the middle)
Message
  .from(Slack)
  .to(Console)
  .from(Gitter)
```

<br>

## Using setters to chain to/from: ##

```
// Can be a function
Message.from = function(data, props, cb) {}

// Can be an arrow function
Message.from = (data, _, cb) => cb()

// Can be a Blueprint module
Message.from = Slack

// Can be a primitive value
Message.from = 'Something'
```

<br>

### Blueprint.js Example: ###

```
Blueprint = {
  name: 'Console',

  in: function(data) {
    return console.log(data)
  },
}
```

### Functional Programming: ###

```
function registerGunMessage() {
    gun.get(“app”).get(“users”).on(this.out)
}

Gun.from(registerGunMessage).to(Console)
```

### Multiple flow paths (Coming soon): ###

```
Message.from(Gun).to(Schema).or.to(Error)
```

### Fallback support for API, Databases, etc: ###

```
Message
  .from(Socket)
  .to(DB1)
  .or() // call it like a function
  .to(DB2)
  .or // can also be used with dot notation
  .to(DB3)
  .or
  .to(Sentry)
  .timeout(5000) // Timeouts for any of the Blueprints!
```

### Property Descriptions for automatic destructuring: ###
```
Blueprint = {
  describe: {
    in: {
      firstPropName: 'Some property desscription.',
      secPropName: 'Some other prop description.',
    }
  }

  in: function(data, props) {
    // props.firstPropName
    // props.secPropName
  }
}
```

### Multiple return styles: ###
```
Blueprint = {
  // Callback style - follows (err, data) callback convention
  in: function(data, props, callback) {
    callback(null, 'some data')
  },

  // return primitives
  in: function(data, props) {
    return 'some data'
  },
  
  // return promises
  in: function(data) {
    return new Promise(function(resolve, reject) {
      resolve('some data')
    })
  },
  
  // async/await
  in: async function(data) {
    return await someAsyncFunction()
  },
  
  // Out event
  in: function(data) {
    this.out('some data')
  },
}
```

# More Examples coming soon! #
